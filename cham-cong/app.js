// Trang "Chấm công": nạp file bảng chấm công tổng (các tháng cũ) 1 lần, hằng tháng thả file BCC từ hệ thống
// -> dựng sheet tháng mới theo mẫu tháng trước, xem / sửa trên web, xuất Excel đủ các tháng (giữ công thức).
// Lưu theo tháng trong trình duyệt và (nếu đã kết nối token) đồng bộ lên kho riêng tư thư mục cham-cong/.
(function () {
  'use strict';
  const root = document.getElementById('tk');
  if (!root) return;
  const CC = window.CC, T = CC.T;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-chamcong-v1', LS_SEL = 'kvh-chamcong-sel', TOKEN_KEY = 'kvh-gh-token';
  const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const ID_RE = /^\d{4}-\d{2}(~[a-z0-9-]+)?$/;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = v => (v === '' || v === null || v === undefined) ? '' : (typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : String(v));
  const msg = (el, html, ok) => { if (el) el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const label = s => s ? (s.phu ? `T${s.thang}/${s.nam} · ${s.phu}` : `T${s.thang}/${s.nam}`) : '';

  // ------------------------------------------------------------ lưu trữ + đồng bộ (giống trang KPIs)
  let archive = {}; try { archive = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {}, timers = {};
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  const persist = () => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(archive)); localStorage.setItem(LS_SEL, sel); }
    catch (e) { syncMsg = 'Bộ nhớ trình duyệt đầy — dữ liệu chỉ còn lưu trên hệ thống (GitHub).'; }
  };
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
      for (const it of items.filter(i => ID_RE.test(i.name.replace(/\.json$/, '')) && i.name.endsWith('.json'))) {
        const k = it.name.replace(/\.json$/, ''); repoSha[k] = it.sha;
        const meta = await gh(`/contents/${DIR}/${encodeURIComponent(it.name)}?ref=main`);
        let txt = meta.content ? b64dec(meta.content) : '';
        if (!txt && meta.download_url) txt = await (await fetch(meta.download_url, { headers: { Authorization: `Bearer ${token}` } })).text();
        if (!txt) { const blob = await gh(`/git/blobs/${it.sha}`); txt = b64dec(blob.content); }
        const remote = JSON.parse(txt || '{}');
        if (!archive[k] || (remote.savedAt || '') >= (archive[k].savedAt || '')) archive[k] = remote;
        else save(k, 0);
      }
      for (const k of Object.keys(archive)) if (!repoSha[k]) save(k, 0);
      syncMsg = 'Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.'; persist(); renderAll();
    } catch (e) { syncMsg = 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.'; renderTop(); }
  }
  const saving = {}, saveAgain = {};
  function save(k, delay = 1200) { if (!token) return; clearTimeout(timers[k]); timers[k] = setTimeout(() => putKy(k), delay); }
  async function putKy(k) {
    if (!archive[k]) return;
    if (saving[k]) { saveAgain[k] = true; return; }
    saving[k] = true;
    const path = `/contents/${DIR}/${encodeURIComponent(k)}.json`;
    try {
      for (let lan = 0; lan < 3; lan++) {
        const body = { message: `Cham cong ${k} (tu web)`, content: b64enc(JSON.stringify(archive[k])), branch: 'main' };
        if (repoSha[k]) body.sha = repoSha[k];
        try {
          const r = await gh(path, { method: 'PUT', body: JSON.stringify(body) });
          repoSha[k] = r.content.sha; syncMsg = `Đã lưu ${label(archive[k])} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && lan < 2) {
            try { repoSha[k] = (await gh(`${path}?ref=main&t=${Date.now()}`)).sha; } catch (e2) { if (e2.status === 404) delete repoSha[k]; else throw e2; }
            continue;
          }
          throw e;
        }
      }
    } catch (e) { syncMsg = `Chưa lưu được ${label(archive[k])} lên hệ thống (${e.message}). Thử thao tác lại hoặc tải lại trang.`; }
    saving[k] = false;
    renderTop();
    if (saveAgain[k]) { saveAgain[k] = false; putKy(k); }
  }
  const touch = k => { archive[k].savedAt = new Date().toISOString(); persist(); save(k); };

  // ------------------------------------------------------------ trạng thái
  const ids = () => CC.sortSheets(Object.values(archive)).map(s => s.id);
  const cur = () => archive[sel] ? sel : (ids()[0] || '');
  const sheet = () => archive[cur()];
  let startOpen = false, pending = null, ev = null, lastBao = null;
  const TABS = ['bang-cong', 'phep', 'doi-chieu', 'nhan-vien', 'huong-dan'];
  let lc = null; // kết quả đối chiếu phiếu của sheet đang mở
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'bang-cong';
  const FR = 8; // dòng Excel của rows[0]
  const teamOf = sh => { const out = []; let t = ''; sh.rows.forEach((r, i) => { if (r.t === 'team') t = r.text; out[i] = t; }); return out; };
  function filtIdx(sh) {
    const g = $('fGroup').value, q = CC.fold($('fSearch').value.trim()), tm = teamOf(sh);
    return sh.rows.map((r, i) => i).filter(i => {
      const r = sh.rows[i];
      if (g && tm[i] !== g) return false;
      if (r.t !== 'nv') return !q && r.t === 'team';
      return !q || r.ma.includes(q) || CC.fold(r.ten).includes(q);
    });
  }
  const tv = (sh, i, k) => { const v = ev.tailVal(sh, FR + i, k); return v === '' ? '' : Number(v) || 0; };
  function unknownCodes(sh, r) {
    const set = CC.codesCounted(sh, r), out = [];
    r.d.forEach((v, k) => { if (v && !set.has(CC.fold(v))) out.push(k); });
    return out;
  }
  const codeClass = v => {
    const s = (v || '').toLowerCase();
    if (!s || s === 'x') return '';
    if (s === 'p' || s === 'p.s') return 'k-P';
    if (s.startsWith('ro')) return 'k-Ro';
    if (s === 'l' || s.startsWith('ct') || s === 't') return 'k-L';
    if (s.startsWith('n')) return 'k-N';
    return 'k-half';
  };

  // ------------------------------------------------------------ render
  function renderTop() {
    const k = cur(), sh = sheet(), has = !!sh;
    $('tkTop').hidden = !has;
    $('tkStart').hidden = has && !startOpen && !pending;
    $('startCancelRow').hidden = !has;
    $('tkMainView').hidden = !has;
    const mains = Object.values(archive).filter(s => !s.phu).length;
    $('masterInfo').textContent = Object.keys(archive).length ? `Đang có ${Object.keys(archive).length} sheet (${mains} tháng chính).` : 'Chưa nạp.';
    if (!has) return;
    $('tkChips').innerHTML = ids().map(x => `<button type="button" class="b sm${x === k ? ' pri' : ''}" data-ky="${x}" title="${esc(archive[x].ten)}">${esc(label(archive[x]))}</button>`).join('');
    const nv = sh.rows.filter(r => r.t === 'nv').length;
    $('tkBanner').innerHTML = `✓ Sheet <b>${esc(sh.ten)}</b> · ${nv} nhân viên · ${sh.n} ngày · nguồn: ${sh.nguon === 'BCC' ? `file BCC${sh.bcc && sh.bcc.file ? ` "${esc(sh.bcc.file)}"` : ''}` : 'file tổng'}`;
    $('tkSync').textContent = syncMsg;
  }
  function renderStats() {
    const sh = sheet(), idx = filtIdx(sh).filter(i => sh.rows[i].t === 'nv');
    let tg = 0, p = 0, nP = 0, unk = 0, unkNv = 0, miss = 0;
    idx.forEach(i => {
      const r = sh.rows[i]; tg += tv(sh, i, T.TG) || 0; const pp = tv(sh, i, T.P) || 0; p += pp; if (pp) nP++;
      const u = unknownCodes(sh, r).length; unk += u; if (u) unkNv++;
      if (!r.d.some(v => v)) miss++;
    });
    $('stNV').textContent = idx.length; $('stNVSub').textContent = miss ? `${miss} người chưa có ngày công` : 'Đủ ngày công';
    $('stTG').textContent = fmt(tg); $('stTGSub').textContent = idx.length ? `Bình quân ${fmt(Math.round(tg / idx.length * 10) / 10)} công/người` : '';
    $('stP').textContent = fmt(p); $('stPSub').textContent = `${nP} người nghỉ phép`;
    $('stUnk').textContent = unk; $('stUnkSub').textContent = unk ? `${unkNv} người — ô viền đỏ trên bảng` : 'Không có';
  }
  function renderBC() {
    const sh = sheet(), n = sh.n;
    $('titleBC').innerHTML = `BẢNG CHẤM CÔNG THÁNG ${sh.thang} NĂM ${sh.nam}${sh.phu ? ` <span class="muted">(${esc(sh.phu)})</span>` : ''}`;
    const wd = k => new Date(sh.nam, sh.thang - 1, k + 1).getDay();
    const days = [...Array(n).keys()];
    const SUM = [['TG', T.TG], ['P', T.P], ['Ro', T.RO], ['L&CT', T.L], ['Tổng', T.TONG]];
    $('bcHead').innerHTML = `<tr><th class="stk c0">TT</th><th class="stk c1">Mã NV</th><th class="stk c2" style="text-align:left">Họ và tên</th>${days.map(k => `<th class="${wd(k) === 0 ? 'sun' : ''}">${k + 1}</th>`).join('')}${SUM.map(s => `<th>${s[0]}</th>`).join('')}<th style="text-align:left">Ghi chú</th></tr>
      <tr><th class="stk c0"></th><th class="stk c1"></th><th class="stk c2"></th>${days.map(k => `<th class="${wd(k) === 0 ? 'sun' : ''}">${wd(k) === 0 ? 'CN' : 'T' + (wd(k) + 1)}</th>`).join('')}${SUM.map(() => '<th></th>').join('')}<th></th></tr>`;
    let html = '', stt = 0;
    const missing = new Set((lastBao && lastBao.ky === sh.id ? lastBao.thieu : []).map(x => x.ma));
    const issCell = new Set(lc.issues.map(x => x.i + '|' + x.k));
    filtIdx(sh).forEach(i => {
      const r = sh.rows[i];
      if (r.t === 'team') { html += `<tr class="grp"><td class="stk c0"></td><td class="stk c1"></td><td class="stk c2">${esc(r.text)}</td><td colspan="${n + SUM.length + 1}"></td></tr>`; return; }
      if (r.t !== 'nv') return;
      stt++;
      const unk = new Set(unknownCodes(sh, r)), bb = r.tail && r.tail[T.BB];
      html += `<tr data-i="${i}" class="${missing.has(r.ma) || !r.d.some(v => v) ? 'miss' : ''}${r.moi ? ' new' : ''}"><td class="stk c0">${stt}</td><td class="stk c1">${esc(r.ma)}</td><td class="stk c2" title="${esc(r.cv)} · ${esc(r.pb)}">${esc(r.ten)}</td>`;
      days.forEach(k => {
        const ps = lc.cell[i + '|' + k] || [];
        const v = r.d[k] || '', cls = ['d', wd(k) === 0 ? 'sun' : '', r.hl && r.hl[k] ? 'hl' : '', r.cm && r.cm[k] ? 'cm' : '', unk.has(k) ? 'unk' : (issCell.has(i + '|' + k) ? 'iss' : ''), ps.length ? 'lv' : '', codeClass(v)].filter(Boolean).join(' ');
        const tip = [r.cm && r.cm[k], ...ps.map(CC.leaveText), unk.has(k) ? `Mã "${v}" không có trong công thức của dòng này → không được tính.` : ''].filter(Boolean).join('\n');
        html += `<td class="${cls}" data-k="${k}"${tip ? ` title="${esc(tip)}"` : ''}>${esc(v)}</td>`;
      });
      SUM.forEach((s, j) => { html += `<td class="num${j === 0 || j === 4 ? ' b' : ''}">${fmt(tv(sh, i, s[1]))}</td>`; });
      html += `<td class="note">${esc(bb && bb.v !== undefined ? bb.v : '')}</td></tr>`;
    });
    $('bcBody').innerHTML = html || `<tr><td colspan="${n + 9}" style="text-align:center;color:#9ca3af;padding:20px">Không có nhân viên phù hợp</td></tr>`;
  }
  function renderPhep() {
    const sh = sheet();
    $('thPhepTon').textContent = sh.phepTon || 'Phép tồn';
    let html = '', stt = 0;
    filtIdx(sh).forEach(i => {
      const r = sh.rows[i];
      if (r.t === 'team') { html += `<tr class="grp"><td colspan="10">${esc(r.text)}</td></tr>`; return; }
      if (r.t !== 'nv') return;
      stt++;
      const aw = r.tail && r.tail[T.AW], ay = r.tail && r.tail[T.AY], bb = r.tail && r.tail[T.BB];
      const ed = (k, o) => o && o.x !== undefined ? fmt(tv(sh, i, k)) : `<input class="cell" type="number" step="0.5" data-t="${k}" value="${esc(o && o.v !== undefined ? o.v : '')}">`;
      html += `<tr data-i="${i}"><td class="r">${stt}</td><td>${esc(r.ma)}</td><td class="name">${esc(r.ten)}</td><td class="r">${ed(T.AW, aw)}</td><td class="r">${fmt(tv(sh, i, T.AX))}</td><td class="r">${ed(T.AY, ay)}</td>
        <td class="r">${fmt(tv(sh, i, T.AZ))}</td><td class="r">${fmt(tv(sh, i, T.P))}</td><td class="r bold">${fmt(tv(sh, i, T.BA))}</td><td class="note">${esc(bb && bb.v !== undefined ? bb.v : '')}</td></tr>`;
    });
    $('phepBody').innerHTML = html;
  }
  function renderNV() {
    const sh = sheet();
    const teams = sh.rows.map((r, i) => r.t === 'team' ? `<option value="${i}">${esc(r.text)}</option>` : '').join('');
    const tv0 = $('nTeam').value; $('nTeam').innerHTML = teams || '<option value="-1">(không có nhóm)</option>'; if (tv0) $('nTeam').value = tv0;
    const nvs = sh.rows.filter(r => r.t === 'nv');
    $('pbList').innerHTML = [...new Set(nvs.map(r => r.pb).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('');
    $('cvList').innerHTML = [...new Set(nvs.map(r => r.cv).filter(Boolean))].map(v => `<option value="${esc(v)}">`).join('');
    let html = '', stt = 0;
    filtIdx(sh).forEach(i => {
      const r = sh.rows[i];
      if (r.t === 'team') { html += `<tr class="grp"><td colspan="7">${esc(r.text)}</td></tr>`; return; }
      if (r.t !== 'nv') return;
      stt++;
      const bb = r.tail && r.tail[T.BB];
      html += `<tr data-i="${i}"><td class="r">${stt}</td><td>${esc(r.ma)}</td><td><input class="cell w" data-f="ten" value="${esc(r.ten)}"></td><td><input class="cell w" data-f="pb" value="${esc(r.pb)}"></td>
        <td><input class="cell w" data-f="cv" value="${esc(r.cv)}"></td><td><input class="cell wide" data-f="bb" value="${esc(bb && bb.v !== undefined ? bb.v : '')}"></td>
        <td style="text-align:center"><input type="checkbox" data-f="auto"${CC.isAuto(r) ? ' checked' : ''}></td>
        <td><button class="b sm del" type="button" data-rm="${i}">Xóa</button></td></tr>`;
    });
    $('nvBody').innerHTML = html;
  }
  function renderBao() {
    const b = lastBao; $('baoCard').hidden = !b;
    if (!b) return;
    const sh = archive[b.ky];
    $('baoTitle').textContent = `Kết quả nạp file BCC — ${sh ? sh.ten : b.ky}${b.capNhat ? ' (cập nhật tháng đã có)' : ' (tạo tháng mới)'}`;
    const li = (arr, f) => arr.map(f).join('<br>');
    $('bao').innerHTML = `
      <div class="ok"><h4>✓ Đã điền ngày công: ${b.khop.length} người</h4>Khớp theo Mã NV giữa file BCC và danh sách tháng${b.capNhat ? '' : ' trước'}.${b.tuDong ? `<br>Tự động đủ công cho sếp: ${b.tuDong} ô.` : ''}</div>
      <div class="${b.moi.length ? 'warn' : 'ok'}"><h4>Người mới thêm vào: ${b.moi.length}</h4>${b.moi.length ? li(b.moi, x => `${esc(x.ma)} — ${esc(x.ten)} <span class="muted">→ ${esc(x.nhom)}</span>`) + '<div class="muted">Phép tồn = 0, Phép tháng = 0; kiểm tra lại Chức vụ / ghi chú ở tab Danh sách NV.</div>' : 'Không có.'}</div>
      <div class="${b.thieu.length ? 'warn' : 'ok'}"><h4>Có trong bảng nhưng không có trong BCC: ${b.thieu.length}</h4>${b.thieu.length ? li(b.thieu, x => `${esc(x.ma)} — ${esc(x.ten)} <button class="b sm del" type="button" data-rmma="${esc(x.ma)}" style="padding:1px 8px;margin-left:6px">Xóa khỏi tháng này</button>`) + '<div class="muted">Đang để trống ngày công — chấm tay trên bảng hoặc xóa nếu đã nghỉ việc.</div>' : 'Không có.'}</div>
      <div class="${b.boQua.length ? 'warn' : 'ok'}"><h4>Trong BCC nhưng không có ngày công nào (bỏ qua): ${b.boQua.length}</h4>${b.boQua.length ? li(b.boQua, x => `${esc(x.ma)} — ${esc(x.ten)} <span class="muted">(${esc(x.pb)})</span>`) : 'Không có.'}</div>
      ${b.lech.length ? `<div class="warn"><h4>Tên khác nhau giữa BCC và bảng: ${b.lech.length}</h4>${li(b.lech, x => `${esc(x.ma)}: bảng "${esc(x.ten)}" · BCC "${esc(x.tenBCC)}"`)}</div>` : ''}
      ${b.unk && b.unk.length ? `<div class="bad"><h4>Mã công không được công thức tính: ${b.unk.length} ô</h4>${li(b.unk, x => `${esc(x.ten)} — ngày ${x.ngay}: <b>${esc(x.ma)}</b>`)}<div class="muted">Viền đỏ trên bảng; bấm vào ô để đổi mã (vd X/P.c → S/P.c).</div></div>` : ''}`;
  }
  const ttCls = t => /duyet/.test(CC.fold(t)) ? 'tt-ok' : /huy|tu choi/.test(CC.fold(t)) ? 'tt-no' : 'tt-new';
  const dcShown = () => { const moi = $('dcMoiTao').checked, sh = sheet(), keep = new Set(filtIdx(sh)); return lc.issues.filter(x => keep.has(x.i) && (moi || x.kieu !== 'phieu' || /duyet|chinh sua/.test(CC.fold(x.p.tt)))); };
  function renderDC() {
    const sh = sheet(), L = dcShown();
    $('dcCount').hidden = !lc.issues.length; $('dcCount').textContent = lc.issues.length;
    const np = (sh.phieu || []).length;
    $('dcInfo').innerHTML = np ? `Đã nối <b>${np}</b> dòng phiếu (file "${esc(sh.phieuFile || '')}", ngày ${sh.phieuNgay ? sh.phieuNgay.join('–') : ''}) với bảng công. <b>${L.length}</b> việc cần xem.` : 'Chưa nạp file phiếu nghỉ cho tháng này — bấm "Nạp file phiếu nghỉ".';
    $('dcNghiViec').innerHTML = lc.nghiViec.length ? `<div class="tk-notes"><b>Đăng ký nghỉ việc:</b><br>${lc.nghiViec.map(x => `• ${esc(x.ma)} — ${esc(x.ten)}: nghỉ từ <b>${esc(x.ngay || x.kt)}</b> <span class="${ttCls(x.tt)}">(${esc(x.tt)})</span>${x.ly ? ` · ${esc(x.ly)}` : ''}`).join('<br>')}</div>` : '';
    $('dcBody').innerHTML = L.length ? L.map((x, j) => `<tr data-j="${j}"><td>${esc(x.ma)}</td><td class="name">${esc(x.ten)}</td><td class="r">${x.k + 1}/${sh.thang}</td><td><b>${esc(x.code) || '<span class="muted">(trống)</span>'}</b></td>
      <td>${x.kieu === 'phieu' ? 'Có phiếu, mã công chưa thể hiện' : '<span style="color:#b91c1c">Mã nghỉ nhưng không có phiếu</span>'}</td>
      <td class="wrap">${x.p ? `<span class="${ttCls(x.p.tt)}">${esc(x.p.tt)}</span> · ${esc(x.p.loai)}${x.p.buoi === 's' ? ' (sáng)' : x.p.buoi === 'c' ? ' (chiều)' : ''}${x.p.ly ? ' · ' + esc(x.p.ly) : ''} <span class="muted">#${esc(x.p.mp)}</span>` : '<span class="muted">Không có phiếu nào ngày này</span>'}</td>
      <td><b>${esc(x.goiY)}</b></td><td>${x.goiY ? `<button class="b sm pri" type="button" data-apply="${j}">Áp dụng</button>` : ''}</td></tr>`).join('')
      : `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">${np ? 'Phiếu và mã công đã khớp.' : 'Chưa có dữ liệu phiếu.'}</td></tr>`;
  }
  function applyIssue(x) {
    const sh = sheet(), r = sh.rows[x.i];
    r.d[x.k] = x.goiY;
    const t = CC.leaveText(x.p); r.cm = r.cm || {};
    if (!(r.cm[x.k] || '').includes(t)) r.cm[x.k] = (r.cm[x.k] ? r.cm[x.k] + '\n' : '') + t;
  }
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('#tkTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('tkFilter').hidden = t === 'huong-dan';
  }
  function renderAll() {
    ev = CC.evaluator(archive);
    renderTop(); renderBao();
    const sh = sheet(); if (!sh) return;
    // sếp "tự động đủ công": ô trống được điền ngay khi mở tháng (cả tháng đã tạo từ trước)
    if (CC.autoFill(sh)) { touch(sh.id); ev = CC.evaluator(archive); }
    const gv = $('fGroup').value, G = [...new Set(sh.rows.filter(r => r.t === 'team').map(r => r.text))];
    $('fGroup').innerHTML = '<option value="">Tất cả nhóm</option>' + G.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
    $('fGroup').value = G.includes(gv) ? gv : '';
    lc = CC.leaveCheck(sh);
    renderStats(); renderBC(); renderPhep(); renderDC(); renderNV(); renderTabs();
  }
  const keepScroll = fn => { const y = window.scrollY, tw = document.querySelector('.tw.cc'), sx = tw && tw.scrollLeft, sy = tw && tw.scrollTop; fn(); window.scrollTo(0, y); const t2 = document.querySelector('.tw.cc'); if (t2) { t2.scrollLeft = sx; t2.scrollTop = sy; } };

  // ------------------------------------------------------------ sửa trên bảng
  // sửa mã công: bấm ô -> ô nhập
  $('bcBody').addEventListener('click', e => {
    const td = e.target.closest('td.d'); if (!td || td.querySelector('input')) return;
    const i = +td.parentElement.dataset.i, k = +td.dataset.k, sh = sheet(), r = sh.rows[i];
    const inp = document.createElement('input'); inp.value = r.d[k] || ''; td.textContent = ''; td.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      if (ok && inp.value.trim() !== (r.d[k] || '')) { r.d[k] = inp.value.trim(); touch(sh.id); }
      keepScroll(renderAll);
    };
    inp.addEventListener('keydown', ev2 => { if (ev2.key === 'Enter') finish(true); else if (ev2.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
  });
  $('phepBody').addEventListener('change', e => {
    const t = e.target; if (!t.dataset.t) return;
    const sh = sheet(), r = sh.rows[+t.closest('tr').dataset.i], k = +t.dataset.t;
    const o = r.tail[k] = Object.assign({}, r.tail[k] || {}); delete o.x;
    if (t.value === '') delete o.v; else o.v = Number(t.value);
    touch(sh.id); keepScroll(renderAll);
  });
  $('nvBody').addEventListener('change', e => {
    const t = e.target; if (!t.dataset.f) return;
    const sh = sheet(), r = sh.rows[+t.closest('tr').dataset.i], v = t.value.trim();
    if (t.dataset.f === 'auto') { r.tuDong = t.checked; if (t.checked) CC.autoFill(sh); }
    else if (t.dataset.f === 'bb') { const o = r.tail[T.BB] = Object.assign({}, r.tail[T.BB] || {}); if (v) o.v = v; else delete o.v; }
    else r[t.dataset.f] = v;
    touch(sh.id); keepScroll(renderAll);
  });
  function removeRow(sh, i) {
    const r = sh.rows[i];
    if (!r || r.t !== 'nv' || !confirm(`Xóa ${r.ten} (${r.ma}) khỏi ${sh.ten}?\n(Chỉ xóa ở tháng này, các tháng khác giữ nguyên.)`)) return;
    sh.rows.splice(i, 1);
    if (lastBao && lastBao.ky === sh.id) lastBao.thieu = lastBao.thieu.filter(x => x.ma !== r.ma);
    touch(sh.id); keepScroll(renderAll);
  }
  $('nAdd').addEventListener('click', () => {
    const sh = sheet(); if (!sh) return;
    const ma = $('nMa').value.trim().padStart(6, '0'), ten = $('nTen').value.trim();
    if (!/^\d{6,}$/.test(ma) || !ten) { msg($('nMsg'), 'Nhập Mã NV (số) và Họ tên.'); return; }
    if (sh.rows.some(r => r.t === 'nv' && r.ma === ma)) { msg($('nMsg'), `Mã ${esc(ma)} đã có trong ${esc(sh.ten)}.`); return; }
    const tIdx = +$('nTeam').value;
    let pos = tIdx + 1; for (let i = tIdx + 1; i < sh.rows.length && sh.rows[i].t !== 'team'; i++) if (sh.rows[i].t === 'nv') pos = i + 1;
    const mate = sh.rows.slice(0, pos).filter(r => r.t === 'nv').pop() || sh.rows.find(r => r.t === 'nv');
    const tail = CC.TAIL.map((_, k) => {
      if (k === T.AX || k === T.AY) return { v: 0 };
      if (k === T.AW) return null;
      if (k === T.BB) return $('nBb').value.trim() ? { v: $('nBb').value.trim() } : null;
      const m = mate && mate.tail && mate.tail[k];
      return m && m.x !== undefined ? { x: m.x } : null;
    });
    sh.rows.splice(pos, 0, { t: 'nv', ma, ten, pb: $('nPb').value.trim(), cv: $('nCv').value.trim(), d: Array(sh.n).fill(''), tail, moi: true });
    ['nMa', 'nTen', 'nBb'].forEach(id => { $(id).value = ''; });
    msg($('nMsg'), `Đã thêm ${esc(ten)} vào ${esc(sh.ten)}.`, true); setTimeout(() => msg($('nMsg'), ''), 5000);
    touch(sh.id); keepScroll(renderAll);
  });

  // ------------------------------------------------------------ sự kiện chung
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { startOpen = true; renderTop(); $('tkStart').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTabs();
  });
  $('fGroup').addEventListener('change', () => keepScroll(renderAll));
  $('fSearch').addEventListener('input', () => { renderStats(); renderBC(); renderPhep(); renderDC(); renderNV(); });
  $('dcMoiTao').addEventListener('change', renderDC);
  $('dcBody').addEventListener('click', e => {
    const b = e.target.closest('[data-apply]'); if (!b) return;
    applyIssue(dcShown()[+b.dataset.apply]); touch(cur()); keepScroll(renderAll);
  });
  $('dcApplyAll').addEventListener('click', () => {
    const L = dcShown().filter(x => x.goiY); if (!L.length) return;
    if (!confirm(`Đổi mã công ${L.length} ô theo gợi ý từ phiếu (kèm ghi chú lý do vào ô)?`)) return;
    L.forEach(applyIssue); touch(cur()); keepScroll(renderAll);
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-ky],[data-rm],[data-rmma],[data-build]'); if (!t) return;
    if (t.dataset.ky) { sel = t.dataset.ky; persist(); renderAll(); return; }
    if (t.dataset.rm !== undefined) { removeRow(sheet(), +t.dataset.rm); return; }
    if (t.dataset.rmma) { const sh = archive[lastBao.ky]; const i = sh.rows.findIndex(r => r.t === 'nv' && r.ma === t.dataset.rmma); if (i >= 0) removeRow(sh, i); return; }
    if (t.dataset.build !== undefined) buildPending();
  });
  $('btnBcc').addEventListener('click', () => $('fileBcc').click());
  $('btnMaster').addEventListener('click', () => $('fileMaster').click());
  $('btnLeave').addEventListener('click', () => $('fileLeave').click());
  $('btnHoliday').addEventListener('click', () => {
    const sh = sheet(); if (!sh) return;
    const v = prompt(`Các ngày lễ trong ${sh.ten} (cách nhau bằng dấu phẩy, vd 1,2):`, sh.thang === 9 ? '1,2' : ''); if (!v) return;
    const days = [...new Set(v.split(/[,;\s]+/).map(Number).filter(n => n >= 1 && n <= sh.n))].sort((a, b) => a - b);
    if (!days.length) { alert('Không đọc được ngày nào.'); return; }
    const res = CC.applyHoliday(sh, days);
    touch(sh.id); keepScroll(renderAll);
    const ppl = l => [...new Map(l.map(x => [x.ma, x])).values()];
    msg($('tkMsg'), `Ngày lễ ${days.join(', ')}/${sh.thang}: điền <b>L</b> ${ppl(res.L).length} người, <b>Ro</b> (thử việc) ${ppl(res.Ro).length} người${res.Ro.length ? ` (${ppl(res.Ro).map(x => esc(x.ten)).join(', ')})` : ''}.`
      + (res.giu.length ? `<br>Giữ mã sẵn có: ${res.giu.map(x => `${esc(x.ten)} ngày ${x.ngay} = ${esc(x.code)}`).join('; ')}.` : '')
      + (res.boQua.length ? `<br>Bỏ qua: ${ppl(res.boQua).map(x => `${esc(x.ten)} (${esc(x.ly)})`).join('; ')}.` : ''), true);
  });
  $('startCancel').addEventListener('click', () => { startOpen = false; pending = null; $('bccConfirm').innerHTML = ''; renderTop(); });
  $('baoClose').addEventListener('click', () => { lastBao = null; renderAll(); });
  $('tkDelete').addEventListener('click', () => {
    const k = cur(), sh = sheet(); if (!sh || !confirm(`Xoá sheet "${sh.ten}"${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
    delete archive[k]; if (sel === k) sel = ''; persist();
    if (token && repoSha[k]) gh(`/contents/${DIR}/${encodeURIComponent(k)}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa cham cong ${k} (tu web)`, sha: repoSha[k], branch: 'main' }) }).then(() => { delete repoSha[k]; }).catch(() => {});
    renderAll();
  });

  // ------------------------------------------------------------ nạp file
  function readBuf(file) { return new Promise((ok, fail) => { const r = new FileReader(); r.onload = e => ok(e.target.result); r.onerror = () => fail(new Error('Không đọc được file')); r.readAsArrayBuffer(file); }); }
  function loadScript(src) { return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Không tải được thư viện ' + src)); document.head.appendChild(s); }); }
  const note = (html, ok) => { msg($('startMsg'), html, ok); msg($('tkMsg'), html, ok); };

  async function importMaster(file) {
    try {
      note(`⏳ Đang đọc "${esc(file.name)}"…`, true);
      if (!window.ExcelJS) await loadScript(EXCELJS_URL);
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(await readBuf(file));
      const list = CC.parseMaster(wb);
      if (!list.length) throw new Error('Không thấy sheet nào tên "Chấm công Tm.yy" trong file.');
      const dup = list.filter(s => archive[s.id]);
      let over = true;
      if (dup.length) over = confirm(`Đã có ${dup.length} sheet trùng (${dup.map(s => s.ten).join(', ')}).\n\nOK = ghi đè bằng dữ liệu trong file này\nHủy = chỉ thêm các sheet chưa có`);
      let n = 0;
      list.forEach(s => { if (archive[s.id] && !over) return; s.savedAt = new Date().toISOString(); archive[s.id] = s; n++; save(s.id, 300 + n * 400); });
      persist();
      sel = CC.sortSheets(list)[0].id; persist(); startOpen = false; renderAll();
      note(`Đã nạp ${n} sheet từ "${esc(file.name)}": ${CC.sortSheets(list).map(s => esc(label(s))).join(', ')}. Từ tháng sau chỉ cần thả file BCC.`, true);
    } catch (err) { note('File tổng: ' + esc(err.message)); console.error(err); }
  }
  async function importBcc(file) {
    try {
      const wb = XLSX.read(await readBuf(file), { type: 'array' });
      const b = CC.parseBCC(XLSX, wb, file.name);
      const latest = CC.mainSheets(archive).pop();
      if (!b.thang && latest) { b.thang = latest.thang === 12 ? 1 : latest.thang + 1; b.nam = latest.thang === 12 ? latest.nam + 1 : latest.nam; }
      if (!b.nam) b.nam = new Date().getFullYear();
      pending = b; startOpen = true;
      $('bccInfo').textContent = `"${file.name}": ${b.nv.length} nhân viên, ${b.n} cột ngày.`;
      showConfirm(); renderTop(); $('tkStart').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { note('File BCC: ' + esc(err.message)); console.error(err); }
  }
  function showConfirm() {
    const b = pending; if (!b) { $('bccConfirm').innerHTML = ''; return; }
    const id = `${b.nam}-${pad2(b.thang)}`, ex = archive[id];
    $('bccConfirm').innerHTML = `<div class="confirm">File BCC <b>${esc(b.fileName)}</b> (${b.nv.length} NV) là chấm công
      tháng <select id="cfThang">${[...Array(12).keys()].map(k => `<option value="${k + 1}"${k + 1 === b.thang ? ' selected' : ''}>${k + 1}</option>`).join('')}</select>
      năm <input type="number" id="cfNam" value="${b.nam}">
      <button class="b pri" type="button" data-build>${ex ? `Cập nhật ${esc(ex.ten)}` : `Tạo bảng công T${b.thang}/${b.nam}`}</button>
      <span class="muted">${ex ? 'Tháng này đã có — chỉ ghi đè mã công của những người có trong BCC.' : `Lấy danh sách + công thức từ ${esc((CC.prevMain(archive, id) || {}).ten || '(chưa có tháng trước)')}.`}</span></div>`;
    ['cfThang', 'cfNam'].forEach(x => $(x).addEventListener('change', () => { b.thang = +$('cfThang').value; b.nam = +$('cfNam').value; showConfirm(); }));
  }
  function buildPending() {
    const b = pending; if (!b) return;
    try {
      const dim = CC.daysIn(b.nam, b.thang);
      if (b.n > dim) throw new Error(`File có ${b.n} cột ngày nhưng tháng ${b.thang}/${b.nam} chỉ có ${dim} ngày — kiểm tra lại tháng.`);
      const { sheet: sh, bao } = CC.buildFromBCC(archive, b, b.thang, b.nam);
      archive[sh.id] = sh;
      // mã công không có trong công thức
      bao.unk = [];
      sh.rows.forEach(r => { if (r.t !== 'nv') return; const set = CC.codesCounted(sh, r); r.d.forEach((v, k) => { if (v && !set.has(CC.fold(v))) bao.unk.push({ ten: r.ten, ngay: k + 1, ma: v }); }); });
      lastBao = bao; sel = sh.id; pending = null; startOpen = false; $('bccConfirm').innerHTML = '';
      touch(sh.id); location.hash = '#bang-cong'; renderAll();
      note(`Đã ${bao.capNhat ? 'cập nhật' : 'tạo'} ${esc(sh.ten)} từ file BCC. Xem kết quả bên dưới rồi bấm "Xuất Excel tất cả tháng".`, true);
      $('baoCard').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { msg($('startMsg'), esc(err.message)); }
  }
  async function importLeave(file) {
    try {
      const wb = XLSX.read(await readBuf(file), { type: 'array', cellDates: true });
      const lv = CC.parseLeave(XLSX, wb, file.name);
      if (!lv.rows.length) throw new Error('File không có dòng phiếu nào.');
      if (!Object.keys(archive).length) throw new Error('Nạp file tổng hoặc file BCC trước, rồi mới nạp file phiếu.');
      const res = CC.attachLeave(archive, lv);
      res.gan.forEach(g => touch(g.id));
      const nv = CC.mainSheets(archive).pop(); if (nv) touch(nv.id);
      const main = res.gan.filter(g => !archive[g.id].phu).sort((a, b) => b.n - a.n)[0];
      if (main) sel = main.id;
      startOpen = false; location.hash = '#doi-chieu'; renderAll();
      $('leaveInfo').textContent = `"${file.name}": ${lv.rows.length} dòng phiếu.`;
      note(`Đã nối file phiếu "${esc(file.name)}" (${lv.rows.length} dòng): ${res.gan.map(g => `${esc(g.ten)} ${g.n} dòng`).join(', ')}${res.thieuThang.length ? ` · bỏ qua ${res.thieuThang.map(t => `${t.n} dòng tháng ${t.ky.slice(5)}/${t.ky.slice(0, 4)} (chưa có bảng công)`).join(', ')}` : ''}. Xem tab "Đối chiếu phiếu".`, true);
    } catch (err) { note('File phiếu nghỉ: ' + esc(err.message)); console.error(err); }
  }
  function wireZone(zone, input, handler) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) handler(input.files[0]); input.value = ''; });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]); });
  }
  wireZone($('zoneMaster'), $('fileMaster'), importMaster);
  wireZone($('zoneBcc'), $('fileBcc'), importBcc);
  wireZone($('zoneLeave'), $('fileLeave'), importLeave);
  // thả file ở bất kỳ đâu: file nhiều sheet "Chấm công T…" -> file tổng, còn lại -> BCC
  document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (e.defaultPrevented || !e.dataTransfer || !e.dataTransfer.files[0]) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    const fn = CC.fold(f.name);
    if (/dang k|lich lam viec|phieu|nghi phep/.test(fn)) importLeave(f);
    else if (/cham cong|final/.test(fn) && !/^bcc/.test(fn)) importMaster(f); else importBcc(f);
  });

  // ------------------------------------------------------------ xuất Excel
  async function exportX(onlyCur, btn) {
    const old = btn.innerHTML; btn.disabled = true; btn.textContent = 'Đang tạo file…';
    try {
      if (!window.ExcelJS) await loadScript(EXCELJS_URL);
      const sh = sheet();
      const wb = CC.exportWorkbook(window.ExcelJS, archive, onlyCur ? [sh.id] : null);
      const buf = await wb.xlsx.writeBuffer();
      const latest = CC.mainSheets(archive).pop();
      const name = onlyCur ? `${sh.ten}.xlsx` : `BẢNG CHẤM CÔNG ${latest ? latest.nam : ''}_CN.HCM (đến T${latest ? latest.thang : ''}).xlsx`;
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
      msg($('tkMsg'), `Đã tải ${esc(name)}${onlyCur ? ' (cột Phép tồn ghi số vì file không kèm tháng trước)' : ` — ${Object.keys(archive).length} sheet`}.`, true);
    } catch (e) { msg($('tkMsg'), 'Không xuất được: ' + esc(e.message || String(e))); console.error(e); }
    btn.disabled = false; btn.innerHTML = old;
  }
  $('tkExport').addEventListener('click', () => exportX(false, $('tkExport')));
  $('tkExportOne').addEventListener('click', () => exportX(true, $('tkExportOne')));

  if (location.hash === '#nap-du-lieu') startOpen = true;
  renderAll();
  pull();
})();
