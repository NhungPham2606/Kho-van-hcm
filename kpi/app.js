// Trang "Tổng hợp KPIs": danh sách NV theo kỳ, nạp nhiều file KPIs con (Excel Kho / PDF Kế toán),
// nhập điểm trừ, xếp loại + mức thưởng, dashboard, xuất Excel theo mẫu sheet "VP.HCM", xuất ảnh.
// Lưu theo kỳ trong trình duyệt và (nếu đã kết nối token) đồng bộ lên kho riêng tư thư mục kpi/.
(function () {
  'use strict';
  const root = document.getElementById('tk');
  if (!root) return;
  const K = window.KPI;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-kpi-v1', LS_SEL = 'kvh-kpi-sel', TOKEN_KEY = 'kvh-gh-token';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vnd = n => Math.round(n || 0).toLocaleString('vi-VN');
  const fmtD = n => (n === '' || n === null || n === undefined || !n) ? '' : String(Math.round(n * 100) / 100).replace('.', ',');
  const msg = (el, html, ok) => { if (el) el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const kyLabel = k => /^\d{4}-\d{2}$/.test(k) ? `T${Number(k.slice(5))}/${k.slice(0, 4)}` : k;
  const pad2 = n => (n < 10 ? '0' : '') + n;

  // ------------------------------------------------------------ lưu trữ + đồng bộ
  let archive = {}; try { archive = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {}, timers = {};
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(archive)); localStorage.setItem(LS_SEL, sel); } catch (e) {} };
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
    if (!res.ok) { let m = res.status + ''; try { m = (await res.json()).message || m; } catch (e) {} const err = new Error(m); err.status = res.status; throw err; }
    return res.status === 204 ? null : res.json();
  }
  const b64enc = t => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  async function pull() {
    if (!token) return;
    try {
      let items = []; try { items = await gh(`/contents/${DIR}?ref=main&t=${Date.now()}`); } catch (e) { if (e.status !== 404) throw e; }
      for (const it of items.filter(i => /^\d{4}-\d{2}\.json$/.test(i.name))) {
        const k = it.name.replace('.json', ''); repoSha[k] = it.sha;
        const remote = JSON.parse(b64dec((await gh(`/contents/${DIR}/${it.name}?ref=main`)).content || '') || '{}');
        if (!archive[k] || (remote.savedAt || '') >= (archive[k].savedAt || '')) archive[k] = remote;
        else save(k, 0); // bản trên máy mới hơn (lần lưu trước bị lỗi) -> đẩy lên
      }
      for (const k of Object.keys(archive)) if (!repoSha[k]) save(k, 0);
      syncMsg = 'Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.'; persist(); renderAll();
    } catch (e) { syncMsg = 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.'; renderTop(); }
  }
  const saving = {}, saveAgain = {};
  function save(k, delay = 1200) {
    if (!token) return;
    clearTimeout(timers[k]);
    timers[k] = setTimeout(() => putKy(k), delay);
  }
  async function putKy(k) {
    if (!archive[k]) return;
    if (saving[k]) { saveAgain[k] = true; return; }
    saving[k] = true;
    const path = `/contents/${DIR}/${k}.json`;
    try {
      for (let lan = 0; lan < 3; lan++) {
        const body = { message: `KPIs ${k} (tu web)`, content: b64enc(JSON.stringify(archive[k])), branch: 'main' };
        if (repoSha[k]) body.sha = repoSha[k];
        try {
          const r = await gh(path, { method: 'PUT', body: JSON.stringify(body) });
          repoSha[k] = r.content.sha; syncMsg = `Đã lưu kỳ ${kyLabel(k)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && lan < 2) {
            try { repoSha[k] = (await gh(`${path}?ref=main&t=${Date.now()}`)).sha; } catch (e2) { if (e2.status === 404) delete repoSha[k]; else throw e2; }
            continue;
          }
          throw e;
        }
      }
    } catch (e) { syncMsg = `Chưa lưu được kỳ ${kyLabel(k)} lên hệ thống (${e.message}). Thử thao tác lại hoặc tải lại trang.`; }
    saving[k] = false;
    renderTop();
    if (saveAgain[k]) { saveAgain[k] = false; putKy(k); }
  }
  const touch = k => { archive[k].savedAt = new Date().toISOString(); persist(); save(k); };

  // ------------------------------------------------------------ trạng thái
  const kys = () => Object.keys(archive).sort().reverse();
  const cur = () => archive[sel] ? sel : (kys()[0] || '');
  let rows = null, startOpen = false;
  const TABS = ['tong-hop', 'dashboard', 'file-kpi', 'danh-sach', 'cai-dat'];
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'tong-hop';
  // ---- ngày phép từ trang Chấm công (cột P của sheet tháng, theo Mã NV)
  const CC_LS = 'kvh-chamcong-v1', ccRemote = {};
  function ccSheet(k) {
    let loc = null; try { loc = (JSON.parse(localStorage.getItem(CC_LS) || '{}'))[k] || null; } catch (e) {}
    const rem = ccRemote[k] || null;
    return loc && rem ? ((rem.savedAt || '') > (loc.savedAt || '') ? rem : loc) : (loc || rem);
  }
  async function pullCC(k) {
    if (!token || !k || k in ccRemote) return;
    ccRemote[k] = null;
    try { const m = await gh(`/contents/cham-cong/${k}.json?ref=main&t=${Date.now()}`); ccRemote[k] = JSON.parse(b64dec(m.content || '') || 'null'); renderAll(); } catch (e) {}
  }
  function phepCC(k) {
    const CC = window.CC; if (!CC) return {};
    const sh0 = ccSheet(k); if (!sh0) return {};
    const sh = JSON.parse(JSON.stringify(sh0));
    if (sh.ky >= '2026-09' && CC.normCodes) CC.normCodes(sh);
    if (CC.autoFill) CC.autoFill(sh);
    const ev = CC.evaluator({ [sh.id]: sh }), out = {};
    sh.rows.forEach((r, i) => {
      if (r.t !== 'nv') return;
      const so = Number(ev.tailVal(sh, 8 + i, CC.T.P)) || 0;
      if (!so) return;
      const ngay = r.d.map((v, j) => {
        const p = String(v || '').toLowerCase().split('/').find(x => x === 'p' || x === 'p.s' || x === 'p.c');
        return p ? `${j + 1}${p === 'p' ? '' : p === 'p.s' ? ' sáng' : ' chiều'}` : '';
      }).filter(Boolean);
      out[r.ma] = { so, ngay: ngay.length ? 'ngày ' + ngay.join(', ') + `/${sh.thang}` : '' };
    });
    return out;
  }
  let ccInfo = '';
  function recompute() {
    const k = cur(); if (!k) { rows = null; return; }
    pullCC(k);
    const pc = phepCC(k); const sh = ccSheet(k);
    ccInfo = sh ? `Ngày phép lấy tự động từ bảng chấm công "${sh.ten}" (${Object.keys(pc).length} người có phép) — gõ số khác vào ô để sửa tay, xóa trống để lấy lại số từ chấm công.` : `Chưa có bảng chấm công tháng ${kyLabel(k)} (trang Chấm Công) — nhập ngày phép tay.`;
    rows = K.compute(archive[k].roster || [], archive[k].files || [], archive[k].inputs || {}, k, pc);
  }
  // cho mục Tổng hợp quý: bảng đã tính của 1 kỳ đã lưu (cùng cách tính bảng tháng)
  window.KPI_rowsOf = k => archive[k] ? K.compute(archive[k].roster || [], archive[k].files || [], archive[k].inputs || {}, k, phepCC(k)) : null;
  const groupsOf = list => { const g = []; list.forEach(e => { if (!g.includes(e.group)) g.push(e.group); }); return g; };
  function filt(list) {
    const g = $('fGroup').value, q = $('fSearch').value.trim().toLowerCase();
    return list.filter(r => (!g || r.group === g) && (!q || r.ma.includes(q) || r.ten.toLowerCase().includes(q)));
  }
  // tạo kỳ mới: chép danh sách kỳ gần nhất; TV1 -> TV2
  function ensureKy(k) {
    if (archive[k]) return archive[k];
    const prev = kys().find(x => x < k) || kys()[0];
    const roster = prev ? (archive[prev].roster || []).map(e => Object.assign({}, e, { loai: e.loai === 'TV1' ? 'TV2' : e.loai }, e.ts ? { ts: Object.assign({}, e.ts) } : {})) : [];
    archive[k] = { roster, files: [], inputs: {} };
    return archive[k];
  }

  // ------------------------------------------------------------ render
  function renderTop() {
    const has = !!(rows && cur()), quy = location.hash === '#tong-hop-quy';
    $('tkQuy').hidden = !quy;
    if (quy) { $('tkTop').hidden = $('tkStart').hidden = $('tkMainView').hidden = true; if (window.KPI_quyRender) window.KPI_quyRender(); return; }
    $('tkTop').hidden = !has;
    $('tkStart').hidden = has && !startOpen;
    $('startCancelRow').hidden = !has;
    $('tkMainView').hidden = !has;
    const k = cur(), e = k ? archive[k] : null;
    $('rosterInfo').textContent = e && e.roster && e.roster.length ? `Kỳ ${kyLabel(k)} đang có ${e.roster.length} nhân viên.` : 'Chưa có danh sách nhân viên.';
    $('filesInfo').textContent = e && e.files ? `Kỳ ${kyLabel(k)} đã nạp ${e.files.length} file.` : '';
    if (!has) return;
    $('tkChips').innerHTML = kys().map(x => `<button type="button" class="b sm${x === k ? ' pri' : ''}" data-ky="${x}">${kyLabel(x)}</button>`).join('');
    const lam = rows.filter(r => !r.ts), nop = lam.filter(r => r.nop).length, nts = rows.length - lam.length;
    $('tkBanner').innerHTML = `✓ Kỳ <b>${kyLabel(k)}</b> · ${rows.length} nhân viên${nts ? ` (${nts} nghỉ thai sản)` : ''} · ${(e.files || []).length} file KPIs đã nạp · ${nop}/${lam.length} người đã nộp`;
    const seen = {}, dup = rows.filter(r => (seen[r.ma] = (seen[r.ma] || 0) + 1) === 2);
    if (dup.length) $('tkBanner').innerHTML += `<div class="tk-err" style="margin-top:6px">⚠ Mã NV bị trùng trong danh sách (sẽ tính thưởng 2 lần): ${dup.map(r => `${esc(r.ma)} ${esc(r.ten)}`).join(', ')} — vào tab "Danh sách NV" xóa dòng thừa.</div>`;
    $('tkSync').textContent = syncMsg;
  }
  function renderStats() {
    const L = filt(rows), cnt = l => L.filter(r => r.loai === l).length;
    const lam = L.filter(r => !r.ts), nop = lam.filter(r => r.nop).length, tien = L.reduce((s, r) => s + r.thuong, 0), nts = L.length - lam.length;
    $('stNV').textContent = L.length; $('stNVSub').textContent = `${groupsOf(L).length} bộ phận${nts ? ` · ${nts} nghỉ thai sản` : ''}`;
    $('stNop').textContent = `${nop}/${lam.length}`; $('stNopSub').textContent = lam.length - nop ? `${lam.length - nop} người chưa nộp` : 'Đủ cả';
    $('stXL').innerHTML = ['A', 'B', 'C', 'D'].map(l => `<span class="xl ${l}">${cnt(l)}</span>`).join(' ');
    $('stXLSub').textContent = `A ${cnt('A')} · B ${cnt('B')} · C ${cnt('C')} · D ${cnt('D')}`;
    $('stTien').textContent = vnd(tien) + 'đ'; $('stTienSub').textContent = `Kế toán ${vnd(L.filter(r => K.isKeToan(r.kv)).reduce((s, r) => s + r.thuong, 0))}đ · Kho/GH/LX ${vnd(L.filter(r => !K.isKeToan(r.kv)).reduce((s, r) => s + r.thuong, 0))}đ`;
  }
  function renderTH() {
    $('ccInfo').textContent = ccInfo;
    const k = cur(), [y, m] = [k.slice(0, 4), Number(k.slice(5))];
    $('titleTH').innerHTML = `DANH SÁCH XÉT THƯỞNG KPIs THÁNG ${m} NĂM ${y}<br>Bộ phận: Kế toán - Kho vận CN Hồ Chí Minh`;
    const L = filt(rows); let html = '', stt = 0, g = null;
    L.forEach(r => {
      if (r.group !== g) { g = r.group; html += `<tr class="grp"><td colspan="17">${esc(g || '(chưa có bộ phận)')}</td></tr>`; }
      stt++;
      const tsO = archiveTs(r.ma) || {};
      html += `<tr class="${r.ts ? 'tsan' : r.nop ? '' : 'nonop'}" data-ma="${esc(r.ma)}"><td class="r">${stt}</td><td>${esc(r.ma)}</td><td class="name">${esc(r.ten)}${r.ts ? ' <span class="src">(nghỉ thai sản)</span>' : r.nop ? '' : ' <span class="src">(chưa nộp)</span>'}</td>
        <td class="r">${r.nop ? fmtD(r.ban) : ''}</td><td class="r">${fmtD(r.tFile)}</td>
        <td class="r"><input class="cell${r.phepNguon === 'cc' ? ' cc' : ''}" type="number" min="0" step="0.5" data-f="phep" value="${esc(r.phep)}" title="${r.phepNguon === 'cc' ? 'Lấy từ bảng chấm công — gõ số khác để sửa tay' : 'Số ngày nghỉ phép'}"></td>
        <td class="r"><input class="cell" type="number" min="0" step="1" data-f="truKhac" value="${esc(r.truKhac)}" title="Điểm trừ khác"></td>
        <td class="r bold">${fmtD(r.tru)}</td><td class="r bold">${r.nop ? fmtD(r.conLai) : 0}</td><td class="r">${r.nop ? (r.pct * 100).toFixed(1).replace('.', ',') + '%' : '0%'}</td>
        <td><span class="xl ${r.loai}">${r.loai}</span></td><td class="r">${vnd(r.muc)}</td><td class="r money">${vnd(r.thuong)}</td>
        <td>${r.loai === 'TV1' ? 'TV' : r.loai === 'TV2' ? 'TV' : 'CT'}${r.loai === 'TV1' ? ' <span class="src">tháng đầu</span>' : ''}</td><td class="kv-badge">${esc(r.kv)}</td>
        <td class="ts-cell"><label class="ts-chk"><input type="checkbox" data-ts="on"${tsO.on ? ' checked' : ''}> Nghỉ TS</label>${tsO.on ? `
          <span class="ts-d">từ <input class="cell d" type="date" data-ts="tu" value="${esc(tsO.tu || '')}"></span><span class="ts-d">đến <input class="cell d" type="date" data-ts="den" value="${esc(tsO.den || '')}" title="Ngày đi làm lại — bỏ trống nếu chưa biết"></span>` : ''}</td>
        <td><input class="cell txt" type="text" data-f="lyDo" value="${esc(r.lyDoKhac)}" placeholder="${r.ts ? 'Nghỉ thai sản – không tính thưởng' : 'Lý do trừ khác…'}" title="${esc(r.lyDo)}"></td></tr>`;
    });
    $('thBody').innerHTML = html || '<tr><td colspan="17" style="text-align:center;color:#9ca3af;padding:20px">Chưa có nhân viên — nạp file tổng hợp tháng trước ở bước ①</td></tr>';
    $('thFoot').innerHTML = `<td colspan="12">Tổng cộng (${L.length} nhân viên)</td><td class="r">${vnd(L.reduce((s, r) => s + r.thuong, 0))}</td><td colspan="4"></td>`;
    // ô "Trạng thái" (fix loai text) — hiển thị đúng loại
    L.forEach(r => { const tr = $('thBody').querySelector(`tr[data-ma="${CSS.escape(r.ma)}"] td:nth-child(11) .xl`); if (tr) { tr.className = 'xl ' + r.loai; tr.textContent = r.loai; } });
  }
  function bars(list, colorOf) {
    const max = Math.max(1, ...list.map(r => r.v));
    return `<div class="bars">${list.map(r => `<div class="bar-row" title="${esc(r.tip || '')}"><span class="lbl">${esc(r.l)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(0.5, r.v / max * 100)}%;background:${colorOf(r)}"></span></span><span class="val">${esc(r.t)}</span></div>`).join('')}</div>`;
  }
  function renderDash() {
    const L = filt(rows), G = groupsOf(L);
    const byG = G.map(g => { const rs = L.filter(r => r.group === g); const nop = rs.filter(r => r.nop); return { g, rs, nop, tien: rs.reduce((s, r) => s + r.thuong, 0), avg: nop.length ? nop.reduce((s, r) => s + r.conLai, 0) / nop.length : 0 }; });
    const XLC = { A: '#0e9f6e', B: '#1a56db', C: '#d97706', D: '#e02424' };
    const xl = ['A', 'B', 'C', 'D'].map(l => { const n = L.filter(r => r.loai === l).length; return { l: 'Loại ' + l, v: n, t: `${n} người`, c: XLC[l] }; });
    const tru = L.filter(r => r.tru > 0).sort((a, b) => b.tru - a.tru).slice(0, 10).map(r => ({ l: `${r.ma} · ${r.ten}`, v: r.tru, t: `−${fmtD(r.tru)} điểm`, tip: r.lyDo }));
    const chua = L.filter(r => !r.nop && !r.ts);
    $('dash').innerHTML = `
      <div class="chart"><h4>Tổng thưởng theo bộ phận</h4><div class="sub">${vnd(L.reduce((s, r) => s + r.thuong, 0))}đ · ${L.length} nhân viên</div>
        ${bars(byG.map(o => ({ l: o.g, v: o.tien, t: vnd(o.tien) + 'đ', tip: `${o.g}: ${o.rs.length} người` })), () => '#1a56db')}</div>
      <div class="chart"><h4>Điểm KPIs bình quân theo bộ phận</h4><div class="sub">Tổng điểm còn lại, chỉ tính người đã nộp</div>
        ${bars(byG.map(o => ({ l: o.g, v: o.avg, t: fmtD(Math.round(o.avg * 10) / 10), tip: `${o.nop.length}/${o.rs.length} đã nộp` })), r => r.v >= 951 ? '#0e9f6e' : r.v >= 901 ? '#1a56db' : r.v >= 850 ? '#d97706' : '#e02424')}</div>
      <div class="chart"><h4>Phân bố xếp loại</h4><div class="sub">A &gt; 950 · B 901–950 · C 850–900 · D &lt; 850 hoặc không nộp</div>${bars(xl, r => r.c)}</div>
      <div class="chart"><h4>Bị trừ điểm nhiều nhất</h4><div class="sub">Rê chuột để xem lý do</div>${tru.length ? bars(tru, () => '#e02424') : '<div class="muted">Không ai bị trừ điểm.</div>'}</div>
      <div class="chart" style="grid-column:1/-1"><h4>Chưa nộp KPIs (${chua.length})</h4><div class="sub">Xếp loại D, không thưởng</div>
        ${chua.length ? `<div class="tk-notes">${chua.map(r => `• ${esc(r.ma)} — ${esc(r.ten)} <span class="muted">(${esc(r.group)})</span>`).join('<br>')}</div>` : '<div class="muted">Mọi người đã nộp đủ.</div>'}</div>`;
  }
  function renderFiles() {
    const e = archive[cur()], R = e.roster || [];
    const fs = (e.files || []).map(f => ({ f, nv: K.matchFile(R, f) })).sort((a, b) => !a.nv - !b.nv || (a.nv ? a.nv.ma : '').localeCompare(b.nv ? b.nv.ma : ''));
    const un = fs.filter(x => !x.nv);
    $('unmatched').innerHTML = un.length ? `<div class="tk-err" style="margin-bottom:12px">${un.length} file <b>chưa khớp được nhân viên nào</b> (không có Mã NV và họ tên không trùng danh sách) — bấm "Thêm vào danh sách" hoặc kiểm tra lại.</div>` : '';
    const k = cur();
    $('fileBody').innerHTML = fs.length ? fs.map(({ f, nv }) => `<tr><td style="white-space:normal">${esc(f.fileName)}</td><td>${f.loaiFile === 'pdf' ? 'PDF' : 'Excel'}</td>
      <td>${nv ? esc(nv.ma) : esc(f.ma)}${nv && nv.ma !== f.ma ? ` <span class="src">${f.ma ? `(file ghi ${esc(f.ma)}) ` : ''}khớp theo tên</span>` : ''}</td><td>${esc(nv ? nv.ten : f.ten)}</td>
      <td>${f.thang ? `T${f.thang}/${f.nam}` : ''}${f.thang && `${f.nam}-${pad2(f.thang)}` !== k ? ' <span class="xl D">khác kỳ</span>' : ''}</td><td class="r bold">${fmtD(f.tongDiem)}</td><td class="r">${fmtD(f.truFile)}</td>
      <td>${nv ? '✓' : `<button class="b sm" type="button" data-addfrom="${esc(f.fileName)}">+ Thêm vào danh sách</button>`}</td>
      <td><button class="b sm del" type="button" data-rmfile="${esc(f.fileName)}">Xóa</button></td></tr>`).join('')
      : '<tr><td colspan="9" style="text-align:center;color:#9ca3af;padding:20px">Chưa nạp file KPIs nào</td></tr>';
  }
  function renderRoster() {
    const e = archive[cur()], R = e.roster || [];
    $('groupList').innerHTML = groupsOf(R).map(g => `<option value="${esc(g)}">`).join('');
    $('kvList').innerHTML = [...new Set(R.map(r => r.kv).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('');
    $('rosterBody').innerHTML = R.length ? R.map((r, i) => `<tr><td>${esc(r.group)}</td><td>${esc(r.ma)}</td><td>${esc(r.ten)}</td><td>${esc(r.kv)}</td><td>${K.isKeToan(r.kv) ? 'Kế toán' : 'Kho/GH/LX'}</td>
      <td><select class="cell" data-loai="${i}"><option value="CT"${r.loai === 'CT' ? ' selected' : ''}>CT – Chính thức</option><option value="TV1"${r.loai === 'TV1' ? ' selected' : ''}>TV – tháng đầu (không thưởng)</option><option value="TV2"${r.loai === 'TV2' ? ' selected' : ''}>TV – từ tháng 2</option></select></td>
      <td><button class="b sm del" type="button" data-rmnv="${i}">Xóa</button></td></tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:20px">Chưa có nhân viên</td></tr>';
  }
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('#tkTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('tkFilter').hidden = !['tong-hop', 'dashboard'].includes(t);
    $('tkFoot').hidden = true;
  }
  function renderAll() {
    recompute(); renderTop();
    if (!rows || !cur()) return;
    const gv = $('fGroup').value, G = groupsOf(archive[cur()].roster || []);
    $('fGroup').innerHTML = '<option value="">Tất cả bộ phận</option>' + G.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    $('fGroup').value = G.includes(gv) ? gv : '';
    renderStats(); renderTH(); renderDash(); renderFiles(); renderRoster(); renderTabs();
    window.dispatchEvent(new Event('kpi:render'));
  }
  const refilter = () => { renderStats(); renderTH(); renderDash(); };

  // ------------------------------------------------------------ sự kiện chung
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { startOpen = true; renderTop(); $('tkStart').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTop(); if (rows && cur()) renderTabs();
  });
  $('fGroup').addEventListener('change', refilter);
  $('fSearch').addEventListener('input', refilter);
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ky],[data-rmfile],[data-rmnv],[data-addfrom]'); if (!t) return;
    const k = cur();
    if (t.dataset.ky) { sel = t.dataset.ky; persist(); renderAll(); return; }
    if (t.dataset.rmfile) { archive[k].files = archive[k].files.filter(f => f.fileName !== t.dataset.rmfile); touch(k); renderAll(); return; }
    if (t.dataset.rmnv !== undefined) {
      const r = archive[k].roster[+t.dataset.rmnv];
      if (!confirm(`Xóa ${r.ten} (${r.ma}) khỏi danh sách kỳ ${kyLabel(k)}?`)) return;
      archive[k].roster.splice(+t.dataset.rmnv, 1); touch(k); renderAll(); return;
    }
    if (t.dataset.addfrom) {
      const f = archive[k].files.find(x => x.fileName === t.dataset.addfrom); if (!f) return;
      location.hash = '#danh-sach';
      $('nMa').value = f.ma; $('nTen').value = f.ten.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()); $('nLoai').value = 'TV1';
      $('nGroup').focus(); msg($('nMsg'), 'Chọn Bộ phận, KV, Loại rồi bấm "+ Thêm nhân viên".', true);
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.loai !== undefined) { const k = cur(); archive[k].roster[+t.dataset.loai].loai = t.value; touch(k); renderAll(); }
  });
  // nhập ngày phép / trừ khác / lý do trên bảng tổng hợp
  function archiveTs(ma) { const k = cur(), e = k && (archive[k].roster || []).find(x => x.ma === ma); return e && e.ts; }
  $('thBody').addEventListener('change', e => {
    const t = e.target;
    if (t.dataset && t.dataset.ts) {
      const k = cur(), ma = t.closest('tr').dataset.ma, nv = (archive[k].roster || []).find(x => x.ma === ma);
      if (!nv) return;
      const ts = nv.ts = nv.ts || {};
      if (t.dataset.ts === 'on') { ts.on = t.checked; if (t.checked && !ts.tu) ts.tu = `${k}-01`; if (!t.checked) delete nv.ts; }
      else ts[t.dataset.ts] = t.value;
      touch(k); const y = window.scrollY; renderAll(); window.scrollTo(0, y);
      return;
    }
    if (!t.dataset || !t.dataset.f) return;
    const k = cur(), ma = t.closest('tr').dataset.ma;
    const inp = archive[k].inputs = archive[k].inputs || {};
    const o = inp[ma] = inp[ma] || {};
    if (t.value === '') delete o[t.dataset.f]; else o[t.dataset.f] = t.dataset.f === 'lyDo' ? t.value : Number(t.value);
    if (!Object.keys(o).length) delete inp[ma];
    touch(k);
    const y = window.scrollY, f = t.dataset.f;
    renderAll(); window.scrollTo(0, y);
    const nx = $('thBody').querySelector(`tr[data-ma="${CSS.escape(ma)}"] [data-f="${f}"]`); // giữ chỗ nhập
    if (nx && f !== 'lyDo') nx.blur();
  });
  $('nAdd').addEventListener('click', () => {
    const k = cur(); if (!k) return;
    const r = { group: $('nGroup').value.trim(), ma: K.normMa($('nMa').value), ten: $('nTen').value.trim(), kv: $('nKV').value.trim().toUpperCase(), loai: $('nLoai').value };
    if (!r.group || !r.ma || !r.ten || !r.kv) { msg($('nMsg'), 'Nhập đủ Bộ phận, Mã NV, Họ và tên, KV.'); return; }
    if ((archive[k].roster || []).some(x => x.ma === r.ma)) { msg($('nMsg'), `Mã NV ${esc(r.ma)} đã có trong danh sách.`); return; }
    const R = archive[k].roster = archive[k].roster || [];
    const last = R.map(x => x.group).lastIndexOf(r.group);
    R.splice(last >= 0 ? last + 1 : R.length, 0, r);
    ['nMa', 'nTen'].forEach(id => { $(id).value = ''; });
    msg($('nMsg'), `Đã thêm ${esc(r.ten)} vào "${esc(r.group)}".`, true); setTimeout(() => msg($('nMsg'), ''), 5000);
    touch(k); renderAll();
  });
  $('btnFiles').addEventListener('click', () => $('fileKpi').click());
  $('btnNewKy').addEventListener('click', () => {
    const d = new Date(); const def = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    const v = prompt('Tạo kỳ mới (năm-tháng), vd 2026-09:', def); if (!v) return;
    if (!/^\d{4}-\d{2}$/.test(v.trim())) { alert('Nhập dạng YYYY-MM, vd 2026-09'); return; }
    const k = v.trim(); ensureKy(k); sel = k; touch(k); renderAll();
    msg($('tkMsg'), `Đã tạo kỳ ${kyLabel(k)} (chép danh sách nhân viên kỳ trước). Kéo thả file KPIs để nạp điểm.`, true);
  });
  $('startCancel').addEventListener('click', () => { startOpen = false; renderTop(); });
  $('tkDelete').addEventListener('click', () => {
    const k = cur(); if (!k || !confirm(`Xoá dữ liệu kỳ ${kyLabel(k)}${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
    delete archive[k]; if (sel === k) sel = ''; persist();
    if (token && repoSha[k]) gh(`/contents/${DIR}/${k}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa KPIs ${k} (tu web)`, sha: repoSha[k], branch: 'main' }) }).then(() => { delete repoSha[k]; }).catch(() => {});
    renderAll();
  });

  // ------------------------------------------------------------ nạp file
  function readBuf(file) { return new Promise((ok, fail) => { const r = new FileReader(); r.onload = e => ok(e.target.result); r.onerror = () => fail(new Error('Không đọc được file')); r.readAsArrayBuffer(file); }); }
  function loadScript(src) { return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Không tải được thư viện ' + src)); document.head.appendChild(s); }); }
  async function pdfText(buf) {
    if (!window.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let out = '';
    for (let i = 1; i <= doc.numPages; i++) { const c = await (await doc.getPage(i)).getTextContent(); out += c.items.map(it => it.str).join(' ') + '\n'; }
    return out;
  }
  async function importRoster(file) {
    try {
      const wb = XLSX.read(await readBuf(file), { type: 'array' });
      const r = K.parseRoster(XLSX, wb);
      // danh sách theo tháng ghi trong file; các kỳ sau tự chép danh sách này
      let k = r.thang ? `${r.nam}-${pad2(r.thang)}` : cur();
      if (!k) { const d = new Date(); k = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
      const e = archive[k] || (archive[k] = { roster: [], files: [], inputs: {} });
      e.roster = r.list; sel = k; touch(k); startOpen = true; renderAll();
      note(`Đã nạp ${r.list.length} nhân viên từ "${esc(file.name)}"${r.thang ? ` (T${r.thang}/${r.nam})` : ''} làm danh sách cho kỳ <b>${kyLabel(k)}</b>. Giờ kéo thả các file KPIs của kỳ này vào ô ②.`, true);
    } catch (err) { note('File danh sách: ' + esc(err.message)); }
  }
  const note = (html, ok) => { msg($('startMsg'), html, ok); msg($('tkMsg'), html, ok); };
  async function importFiles(fileList) {
    try { await importFilesInner(fileList); } catch (err) { note('Lỗi khi nạp file: ' + esc(err && err.message || err)); console.error(err); }
  }
  async function importFilesInner(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) { note('Trình duyệt không nhận được file nào. Nếu kéo file từ Zalo / Outlook, hãy <b>lưu file về một thư mục trên máy</b> trước, rồi bấm "Nạp file KPI" chọn từ thư mục đó.'); return; }
    note(`⏳ Đang đọc ${files.length} file…`, true);
    const ok = [], bad = [];
    for (const f of files) {
      try {
        const buf = await readBuf(f);
        const p = /\.pdf$/i.test(f.name) ? K.parsePdfText(await pdfText(buf), f.name) : K.parseKpiFile(XLSX, XLSX.read(buf, { type: 'array' }), f.name);
        ok.push(p);
      } catch (err) { bad.push(`${esc(f.name)}: ${esc(err.message)}`); }
    }
    if (ok.length) {
      // kỳ = kỳ đang mở (file hay ghi nhầm tháng do chép mẫu tháng trước); chưa có kỳ nào thì lấy tháng ghi trong đa số file
      const kyFile = p => p.thang ? `${p.nam}-${pad2(p.thang)}` : '';
      const cnt = {}; ok.forEach(p => { const kk = kyFile(p); if (kk) cnt[kk] = (cnt[kk] || 0) + 1; });
      const k = cur() || Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
      if (!k) { note('Không xác định được kỳ (tháng) trong file — bấm "Tạo kỳ mới" trước.'); return; }
      const khacKy = ok.filter(p => kyFile(p) && kyFile(p) !== k);
      const e = ensureKy(k);
      // mỗi nhân viên giữ 1 file (file nạp sau thay file trước); khóa = mã NV đã khớp, không khớp thì theo mã/tên trong file
      const R = e.roster || [];
      const key = x => { const nv = K.matchFile(R, x); return nv ? 'nv:' + nv.ma : x.ma ? 'ma:' + x.ma : 'ten:' + K.nameKey(x.ten || x.fileName); };
      const byKey = {}; (e.files || []).forEach(x => { byKey[key(x)] = x; }); ok.forEach(p => { byKey[key(p)] = p; });
      e.files = Object.values(byKey); sel = k; touch(k); renderAll();
      const lech = ok.filter(p => !K.matchFile(R, p)).length;
      note(`Đã nạp ${ok.length} file vào kỳ <b>${kyLabel(k)}</b>${lech ? ` · <b>${lech}</b> file chưa khớp được nhân viên nào (xem tab "File KPIs đã nạp")` : ''}${khacKy.length ? `<br>⚠ ${khacKy.length} file ghi tháng khác kỳ đang mở (vẫn nạp vào kỳ ${kyLabel(k)} — nếu muốn nạp kỳ khác, chọn kỳ đó trước): ${khacKy.map(p => `${esc(p.fileName)} (tháng ${p.thang}/${p.nam})`).join(', ')}` : ''}${bad.length ? `<br>Không đọc được ${bad.length} file:<br>${bad.join('<br>')}` : ''}`, !bad.length && !khacKy.length);
    } else note(`Không đọc được file nào:<br>${bad.join('<br>')}`);
  }
  function wireZone(zone, input, handler) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { handler(input.multiple ? input.files : input.files[0]); input.value = ''; });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handler(input.multiple ? e.dataTransfer.files : e.dataTransfer.files[0]); });
  }
  wireZone($('zoneRoster'), $('fileRoster'), f => f && importRoster(f));
  wireZone($('zoneFiles'), $('fileKpi'), fs => fs && importFiles(fs));
  // thả file KPIs ở bất kỳ đâu trên trang (ngoài 2 ô) cũng nạp được, tránh trình duyệt tự mở file
  document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (e.defaultPrevented || location.hash === '#tong-hop-quy' || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault(); importFiles(e.dataTransfer.files);
  });

  // ------------------------------------------------------------ xuất Excel theo mẫu "VP.HCM"
  $('tkExport').addEventListener('click', () => {
    if (!rows) return;
    const k = cur(), y = +k.slice(0, 4), m = +k.slice(5), today = new Date();
    const thin = { style: 'thin', color: { rgb: '000000' } }, B = { top: thin, bottom: thin, left: thin, right: thin };
    const ctr = { horizontal: 'center', vertical: 'center', wrapText: true };
    const hdr = ['STT', 'Mã NV', 'Họ và tên', 'Điểm đánh giá ban đầu', 'Điểm trừ', 'Tổng điểm\ncòn lại', 'Tổng chỉ tiêu đánh giá (%)', 'Xếp loại', 'Mức thưởng', 'Tổng thưởng', 'Ghi chú', 'KV', 'Lý do Điểm trừ'];
    const aoa = [[null, null, 'Công ty Cổ Phần Dược Phẩm CPC1 Hà Nội'], [`DANH SÁCH XÉT THƯỞNG KPIs THÁNG ${m} NĂM ${y}`], ['Bộ phận: Kế toán - Kho vận CN Hồ Chí Minh'], hdr];
    const kind = []; let stt = 0, g = null;
    rows.forEach(r => {
      if (r.group !== g) { g = r.group; aoa.push([g]); kind.push('g'); }
      stt++;
      aoa.push([stt, r.ma, r.ten, r.nop ? r.ban : null, r.tru || null, r.nop ? r.conLai : 0, r.nop ? r.pct : 0, r.loai, r.muc, r.thuong, r.loai === 'TV1' || r.loai === 'TV2' ? 'TV' : 'CT', r.kv, r.lyDo || null]);
      kind.push('r');
    });
    aoa.push(['Tổng Cộng', null, null, null, null, null, null, null, null, rows.reduce((s, r) => s + r.thuong, 0)]); kind.push('t');
    aoa.push([], [null, null, null, null, null, null, null, `TP.HCM, ngày ${pad2(today.getDate())} tháng ${pad2(today.getMonth() + 1)} năm ${today.getFullYear()}`],
      ['Người lập biểu', null, 'Giám đốc chi nhánh', null, null, null, 'P.TCKT', null, null, null, 'Phòng TCHC'], [], [], [], ['Phạm Thị Nhung', null, 'Phương Thu']);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const set = (r, c, s) => { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = s; };
    set(0, 2, { font: { bold: true, sz: 11 } });
    for (let c = 0; c < 13; c++) { set(1, c, { font: { bold: true, sz: 14 }, alignment: ctr }); set(2, c, { font: { bold: true }, alignment: ctr }); set(3, c, { font: { bold: true }, alignment: ctr, border: B, fill: { patternType: 'solid', fgColor: { rgb: 'D9E1F2' } } }); }
    const merges = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 12 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 12 } }];
    kind.forEach((kd, i) => {
      const R = 4 + i;
      for (let c = 0; c < 13; c++) {
        const base = { border: B, alignment: { vertical: 'center', wrapText: c === 12, horizontal: [0, 1, 7, 10, 11].includes(c) ? 'center' : c >= 3 && c <= 9 ? 'right' : 'left' } };
        if (kd === 'g') set(R, c, Object.assign({}, base, { font: { bold: true }, alignment: { vertical: 'center', horizontal: 'center' } }));
        else if (kd === 't') set(R, c, Object.assign({}, base, { font: { bold: true } }));
        else set(R, c, base);
      }
      if (kd === 'g') merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 2 } }); // như mẫu: tên nhóm ở đầu dòng, gộp A:C
      if (kd === 't') merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 8 } });
      if (kd === 'r') { [8, 9].forEach(c => { ws[XLSX.utils.encode_cell({ r: R, c })].z = '#,##0'; }); ws[XLSX.utils.encode_cell({ r: R, c: 6 })].z = '0.0%'; }
      if (kd === 't') ws[XLSX.utils.encode_cell({ r: R, c: 9 })].z = '#,##0';
    });
    const sig = 4 + kind.length + 2;
    [0, 2, 6, 10].forEach(c => set(sig, c, { font: { bold: true }, alignment: { horizontal: 'center' } }));
    set(sig - 1, 7, { font: { italic: true }, alignment: { horizontal: 'center' } });
    [0, 2].forEach(c => set(sig + 4, c, { font: { bold: true }, alignment: { horizontal: 'center' } }));
    ws['!merges'] = merges;
    ws['!cols'] = [6, 10, 26, 12, 9, 11, 13, 9, 12, 13, 8, 9, 36].map(w => ({ wch: w }));
    ws['!rows'] = [{}, { hpt: 22 }, {}, { hpt: 42 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'VP.HCM');
    XLSX.writeFile(wb, `00 TỔNG HỢP THƯỞNG KPIS VP.HCM ${m}.${y}.xlsx`);
  });

  // ------------------------------------------------------------ xuất ảnh (bảng tổng hợp / dashboard)
  function loadH2C() { return window.html2canvas ? Promise.resolve() : loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'); }
  async function snapPng() {
    await loadH2C();
    const t = tab() === 'dashboard' ? 'dashboard' : 'tong-hop', k = cur();
    const wrap = document.createElement('div'); wrap.className = 'tk snap' + (t === 'dashboard' ? '' : ' snap-table');
    const g = $('fGroup').value;
    wrap.innerHTML = `<div class="snap-head"><img src="../assets/logo.png?v=2" alt="CPC1HN"><div><h2>${t === 'dashboard' ? `DASHBOARD KPIs · KẾ TOÁN - KHO VẬN CN HCM · THÁNG ${+k.slice(5)}/${k.slice(0, 4)}` : 'Kho Vận CN.HCM'}</h2><p>${g ? esc(g) : 'Tất cả bộ phận'} · Xuất lúc ${new Date().toLocaleString('vi-VN')}</p></div></div>`;
    if (t === 'dashboard') { wrap.append(document.querySelector('#tkMainView .tk-stats').cloneNode(true)); const d = $('dash').cloneNode(true); d.removeAttribute('id'); wrap.append(d); }
    else {
      const pane = document.querySelector('[data-pane="tong-hop"]').cloneNode(true); pane.hidden = false;
      pane.querySelectorAll('.no-snap').forEach(x => x.remove());
      // bỏ 2 cột nhập (ngày phép, trừ khác), ô lý do -> chữ đầy đủ
      pane.querySelectorAll('tr').forEach(tr => { if (tr.classList.contains('grp')) { const td = tr.querySelector('td'); if (td) td.colSpan = 14; return; } [...tr.children].forEach((c, i) => { if (i === 5 || i === 6) c.remove(); }); });
      pane.querySelectorAll('tfoot td').forEach((c, i) => { if (i === 0) c.colSpan = 10; });
      pane.querySelectorAll('tbody tr[data-ma]').forEach(tr => { const ma = tr.dataset.ma, r = rows.find(x => x.ma === ma), td = tr.lastElementChild; if (td) td.textContent = r ? r.lyDo : ''; });
      const card = document.createElement('div'); card.className = 'snap-card'; card.append(pane); wrap.append(card);
    }
    const foot = document.createElement('div'); foot.className = 'snap-foot'; foot.textContent = 'Kho Vận CN.HCM'; wrap.append(foot);
    document.body.appendChild(wrap);
    try {
      await Promise.all([...wrap.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
      const scale = Math.max(1, Math.min(2, 30000 / Math.max(wrap.scrollHeight, 1)));
      const canvas = await window.html2canvas(wrap, { scale, backgroundColor: '#f0f2f5', useCORS: true, logging: false, windowWidth: wrap.scrollWidth + 40 });
      return { blob: await new Promise(ok => canvas.toBlob(ok, 'image/png')), name: `${t === 'dashboard' ? 'Dashboard_KPIs' : 'TongHop_KPIs'}_T${+k.slice(5)}-${k.slice(0, 4)}.png` };
    } finally { wrap.remove(); }
  }
  async function snap(copy) {
    const btn = copy ? $('tkSnapCopy') : $('tkSnap'), label = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Đang tạo ảnh…';
    try {
      const { blob, name } = await snapPng();
      if (copy) { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); msg($('tkMsg'), 'Đã sao chép ảnh — dán (Ctrl + V) vào Zalo / email / Word.', true); }
      else { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); msg($('tkMsg'), `Đã tải ảnh ${name}.`, true); }
    } catch (e) { msg($('tkMsg'), esc(e.message || String(e))); }
    btn.disabled = false; btn.innerHTML = label;
  }
  $('tkSnap').addEventListener('click', () => snap(false));
  $('tkSnapCopy').addEventListener('click', () => snap(true));

  if (location.hash === '#nap-du-lieu') startOpen = true;
  renderAll();
  pull();
})();
