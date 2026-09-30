// Trang "Báo cáo Cận date & Chậm luân chuyển": nạp file nhập xuất tồn theo lô, lưu
// theo kỳ (trình duyệt + kho riêng tư nếu đã kết nối), dashboard, bảng theo mẫu,
// xuất Excel đúng bố cục mẫu "BÁO CÁO TỒN KHO VẬT TƯ CHẬM LUÂN CHUYỂN".
(function () {
  'use strict';
  const root = document.getElementById('tk');
  if (!root) return;
  const T = window.TonKho;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-tonkho-v1', LS_SEL = 'kvh-tonkho-sel', TOKEN_KEY = 'kvh-gh-token';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => (!n ? '-' : Math.round(n).toLocaleString('vi-VN'));
  const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
  const ty = n => { const a = Math.abs(n || 0), s = n < 0 ? '−' : '';
    return a >= 1e9 ? s + (a / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ'
      : a >= 1e6 ? s + (a / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' triệu'
      : s + Math.round(a).toLocaleString('vi-VN') + 'đ'; };
  const msg = (el, html, ok) => { el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const kyKey = T.kyKey, kyLabel = T.kyLabel;

  // ------------------------------------------------------------ lưu trữ + đồng bộ (giống trang Thưởng kho)
  let archive = {}; try { archive = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  // khoá kỳ đổi thành "YYYY-MM" (1 tháng) / "YYYY-MM_YYYY-MM" (gộp) — đổi khoá dữ liệu cũ nếu cần
  Object.keys(archive).forEach(k => { const e = archive[k]; const nk = e && e.data ? kyKey(e.data) : k; if (nk !== k && !archive[nk]) { archive[nk] = e; delete archive[k]; } });
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {}, saveTimers = {};
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
      let items = [];
      try { items = await gh(`/contents/${DIR}?ref=main&t=${Date.now()}`); } catch (e) { if (e.status !== 404) throw e; }
      for (const it of items.filter(i => i.name.endsWith('.json'))) {
        let k = it.name.replace('.json', '');
        const remote = JSON.parse(b64dec((await gh(`/contents/${DIR}/${encodeURIComponent(it.name)}?ref=main`)).content || '') || '{}');
        if (remote.data && kyKey(remote.data) !== k) { k = kyKey(remote.data); } else repoSha[k] = it.sha;
        if (!archive[k] || (remote.savedAt || '') >= (archive[k].savedAt || '')) archive[k] = remote;
      }
      for (const k of Object.keys(archive)) if (!repoSha[k]) save(k, 0);
      syncMsg = 'Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.'; persist(); renderAll();
    } catch (e) { syncMsg = 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.'; renderTop(); }
  }
  function save(k, delay = 1200) {
    if (!token) return;
    clearTimeout(saveTimers[k]);
    saveTimers[k] = setTimeout(async () => {
      if (!archive[k]) return;
      try {
        const body = { message: `Ton kho ${k} (tu web)`, content: b64enc(JSON.stringify(archive[k])), branch: 'main' };
        if (repoSha[k]) body.sha = repoSha[k];
        const r = await gh(`/contents/${DIR}/${encodeURIComponent(k)}.json`, { method: 'PUT', body: JSON.stringify(body) });
        repoSha[k] = r.content.sha; syncMsg = `Đã lưu kỳ ${kyLabel(k)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
      } catch (e) { syncMsg = `Chưa lưu được kỳ ${kyLabel(k)} lên hệ thống (${e.message}).`; if (e.status === 409 || e.status === 422) delete repoSha[k]; }
      renderTop();
    }, delay);
  }
  const touch = k => { archive[k].savedAt = new Date().toISOString(); persist(); save(k); };

  // ------------------------------------------------------------ trạng thái
  const kys = () => Object.keys(archive).sort().reverse();
  const cur = () => archive[sel] ? sel : (kys()[0] || '');
  let res = null, uploadOpen = false;
  const TABS = ['dashboard', 'cham-luan-chuyen', 'can-date', 'ton-theo-lo', 'cai-dat'];
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
  // truyền mọi kỳ đã lưu để ghép "số tháng chưa xuất" qua nhiều file
  function recompute() { const k = cur(); res = k ? T.analyse(archive[k].data, archive[k].opt || {}, Object.values(archive).map(e => e.data)) : null; }
  const kyMY = () => { const dn = archive[cur()].data.den || ''; return { m: Number(dn.slice(5, 7)) || '', y: dn.slice(0, 4) }; };
  function filt(list) {
    const kho = $('fKho').value, q = $('fSearch').value.trim().toLowerCase();
    return list.filter(r => (!kho || r.kho === kho) && (!q || r.ma.toLowerCase().includes(q) || r.ten.toLowerCase().includes(q)));
  }

  // ------------------------------------------------------------ render
  function renderTop() {
    const has = !!res;
    $('tkTop').hidden = !has;
    $('tkUpload').hidden = !(uploadOpen || !has);
    $('tkUpCancelRow').hidden = !has;
    $('tkMainView').hidden = !has;
    if (!has) return;
    const k = cur(), d = archive[k].data;
    $('tkChips').innerHTML = kys().map(x => `<button type="button" class="b sm${x === k ? ' pri' : ''}" data-ky="${esc(x)}">${esc(kyLabel(x))}</button>`).join('');
    $('tkBanner').innerHTML = `✓ <b>${esc(d.fileName)}</b> — ${d.soDong.toLocaleString('vi-VN')} dòng · Kỳ <b>${T.vnDate(d.tu)} – ${T.vnDate(d.den)}</b> · Tuổi thuốc tính đến <b>${T.vnDate(res.ref)}</b>`;
    $('tkSync').textContent = syncMsg;
  }
  function renderStats() {
    const L = filt(res.list), C = filt(res.cham), N = filt(res.canDate);
    const gt = a => a.reduce((s, r) => s + r.tcGT, 0);
    $('stLo').textContent = L.length.toLocaleString('vi-VN');
    $('stLoSub').textContent = `${new Set(L.map(r => r.ma)).size} mã vật tư`;
    $('stGT').textContent = ty(gt(L));
    $('stCham').textContent = C.length.toLocaleString('vi-VN') + ' lô';
    $('stChamSub').textContent = `${ty(gt(C))} · ${L.length ? Math.round(gt(C) / (gt(L) || 1) * 100) : 0}% giá trị tồn`;
    $('stCan').textContent = N.length.toLocaleString('vi-VN') + ' lô';
    const het = N.filter(r => r.tuoi < 0).length;
    $('stCanSub').textContent = `${ty(gt(N))} · ≤ ${res.opt.canDateThang} tháng${het ? ` · ${het} lô đã hết hạn` : ''}`;
  }
  function bars(rows, colorOf) {
    const max = Math.max(1, ...rows.map(r => r.v));
    return `<div class="bars">${rows.map(r => `<div class="bar-row" title="${esc(r.tip || '')}"><span class="lbl">${esc(r.l)}</span><span class="track"><span class="fill" style="display:block;width:${Math.max(0.5, r.v / max * 100)}%;background:${colorOf(r)}"></span></span><span class="val">${esc(r.t)}</span></div>`).join('')}</div>`;
  }
  function chamBands(C) {
    const G = [['≥ 12 tháng chưa xuất', c => c.n >= 12, '#7f1d1d'], ['6–11 tháng chưa xuất', c => c.n >= 6 && c.n < 12, '#b91c1c'],
      ['3–5 tháng chưa xuất', c => c.n >= 3 && c.n < 6, '#f97316'], ['Nhập trong kỳ, chưa xuất (đã bật tính)', c => c.n === 0 && c.note === 'nhapTrongKy', '#f59e0b'],
      ['Xuất ít trong kỳ', c => c.n < 3 && c.note !== 'nhapTrongKy', '#fbbf24']];
    return G.map(([l, f, col]) => { const rs = C.filter(r => f(r.chuaXuat)); const v = rs.reduce((s, r) => s + r.tcGT, 0); return { l, v, c: col, t: `${ty(v)} · ${rs.length} lô`, tip: `${l}: ${rs.length} lô · ${money(v)}` }; }).filter(x => x.t.indexOf('· 0 lô') < 0);
  }
  function renderDash() {
    const L = filt(res.list), C = filt(res.cham);
    const BANDS = [['Đã hết hạn', -1e9, -1], ['0–8 tháng', 0, 8], ['9–10 tháng', 9, 10], ['11–12 tháng', 11, 12], ['13–23 tháng', 13, 23], ['24–26 tháng', 24, 26], ['≥ 27 tháng', 27, 1e9]];
    const band = BANDS.map(([l, a, b]) => { const rs = L.filter(r => r.tuoi !== null && r.tuoi >= a && r.tuoi <= b); return { l, v: rs.reduce((s, r) => s + r.tcGT, 0), n: rs.length, c: T.tuoiColor(a < 0 ? -1 : a).bg }; });
    const noHd = L.filter(r => r.tuoi === null);
    if (noHd.length) band.push({ l: 'Không có hạn dùng', v: noHd.reduce((s, r) => s + r.tcGT, 0), n: noHd.length, c: '#D1D5DB' });
    const khoMap = {}; C.forEach(r => { (khoMap[r.kho] = khoMap[r.kho] || { v: 0, n: 0 }); khoMap[r.kho].v += r.tcGT; khoMap[r.kho].n++; });
    const kho = Object.entries(khoMap).map(([k, o]) => ({ l: 'Kho ' + k, v: o.v, t: ty(o.v), tip: `${o.n} lô · ${money(o.v)}` })).sort((a, b) => b.v - a.v);
    const itemMap = {}; C.forEach(r => { const o = itemMap[r.ma] = itemMap[r.ma] || { ten: r.ten, v: 0, n: 0 }; o.v += r.tcGT; o.n++; });
    const top = Object.entries(itemMap).map(([m, o]) => ({ l: `${m} · ${o.ten}`, v: o.v, t: ty(o.v), tip: `${m} — ${o.ten}: ${o.n} lô · ${money(o.v)}` })).sort((a, b) => b.v - a.v).slice(0, 10);
    $('dash').innerHTML = `
      <div class="chart"><h4>Giá trị tồn theo tuổi thuốc</h4><div class="sub">Tất cả lô còn tồn · màu giống cột Tuổi thuốc của báo cáo</div>
        ${bars(band.map(b => ({ l: b.l, v: b.v, t: `${ty(b.v)} · ${b.n} lô`, tip: `${b.l}: ${b.n} lô · ${money(b.v)}`, c: b.c })), r => r.c)}</div>
      <div class="chart"><h4>Giá trị chậm luân chuyển theo kho</h4><div class="sub">${C.length} lô · ${ty(C.reduce((s, r) => s + r.tcGT, 0))}</div>
        ${kho.length ? bars(kho, () => '#1a56db') : '<div class="muted">Không có lô chậm luân chuyển.</div>'}</div>
      <div class="chart"><h4>Chậm luân chuyển theo thời gian chưa xuất</h4><div class="sub">Giá trị tồn · số lô (ghép từ các kỳ đã nạp)</div>
        ${C.length ? bars(chamBands(C), r => r.c) : '<div class="muted">Không có lô chậm luân chuyển.</div>'}</div>
      <div class="chart"><h4>Cận date theo tuổi thuốc</h4><div class="sub">Lô còn tồn có tuổi thuốc ≤ ${res.opt.canDateThang} tháng</div>
        ${bars(band.slice(0, 4).map(b => ({ l: b.l, v: b.v, t: `${ty(b.v)} · ${b.n} lô`, tip: `${b.l}: ${b.n} lô · ${money(b.v)}`, c: b.c })), r => r.c)}</div>
      <div class="chart" style="grid-column:1/-1"><h4>Top 10 mặt hàng chậm luân chuyển (theo giá trị tồn)</h4><div class="sub">Rê chuột vào từng dòng để xem số lô và giá trị</div>
        ${top.length ? bars(top, () => '#1a56db') : '<div class="muted">Không có lô chậm luân chuyển.</div>'}</div>`;
  }
  function headCells(withCham) {
    const d = archive[cur()].data;
    return `<th class="r">Stt</th><th>Mã vật tư</th><th style="min-width:220px">Tên vật tư</th><th>Mã kho</th><th>Đvt</th><th>Mã lô</th><th>Hạn dùng</th><th>Tuổi thuốc<br>(Tháng)</th><th class="r">Tồn đầu<br>(${T.vnDate(d.tu)})</th><th class="r">SL nhập</th><th class="r">SL xuất</th><th class="r">Tồn cuối<br>(${T.vnDate(d.den)})</th>${withCham ? '<th>Số tháng<br>chậm luân chuyển</th>' : ''}<th class="r">Giá trị tồn</th><th>Hướng xử lý</th>`;
  }
  const chamStyle = c => c.n >= 6 ? 'color:#b91c1c' : c.n >= 3 ? 'color:#c2410c' : 'color:#374151';
  const lotId = r => `${r.ma}|${r.kho}|${r.lo}`;
  const huongMap = () => { const e = archive[cur()]; return (e && e.huong) || {}; };
  function rowsHtml(list, huong, withCham, editable) {
    if (!list.length) return '<tr><td colspan="15" style="text-align:center;color:#9ca3af;padding:20px">Không có lô nào</td></tr>';
    return list.map((r, i) => {
      const c = T.tuoiColor(r.tuoi);
      return `<tr><td class="r">${i + 1}</td><td>${esc(r.ma)}</td><td style="white-space:normal">${esc(r.ten)}</td><td>${esc(r.kho)}</td><td>${esc(r.dvt)}</td><td>${esc(r.lo)}</td><td>${T.vnDate(r.hd)}</td>
        <td class="tuoi" style="background:${c.bg};color:${c.fg}">${r.tuoi === null ? '—' : r.tuoi < 0 ? 'Hết hạn' : r.tuoi}</td>
        <td class="r">${num(r.tdSL)}</td><td class="r">${num(r.nhSL)}</td><td class="r">${num(r.xuSL)}</td><td class="r bold">${num(r.tcSL)}</td>${withCham ? `<td class="bold" style="${chamStyle(r.chuaXuat)}">${esc(r.chuaXuatText)}</td>` : ''}<td class="r">${num(r.tcGT)}</td>
        ${editable ? `<td class="huong-edit"><textarea data-hx="${esc(lotId(r))}" rows="1" placeholder="Nhập hướng xử lý…">${esc(huongMap()[lotId(r)] || '')}</textarea></td>`
          : i === 0 ? `<td class="huong" rowspan="${list.length}">${esc(huong)}</td>` : ''}</tr>`;
    }).join('');
  }
  function renderTables() {
    const { m, y } = kyMY();
    const leg = [['Hết hạn', -1], ['≤ 8', 8], ['9–10', 9], ['11–12', 11], ['13–23', 13], ['24–26', 24], ['≥ 27', 27]];
    document.querySelectorAll('[data-legend]').forEach(el => { el.innerHTML = 'Tuổi thuốc (tháng): ' + leg.map(([l, t]) => `<span><i style="background:${T.tuoiColor(t).bg}"></i>${l}</span>`).join(''); });
    document.querySelectorAll('[data-head]').forEach(el => { el.innerHTML = headCells(el.dataset.head === 'cham'); });
    $('titleCham').innerHTML = `BÁO CÁO TỒN KHO VẬT TƯ CHẬM LUÂN CHUYỂN<br>CHI NHÁNH HỒ CHÍ MINH T${m}/${y}`;
    $('titleCan').innerHTML = `BÁO CÁO TỒN KHO VẬT TƯ CẬN DATE (≤ ${res.opt.canDateThang} THÁNG)<br>CHI NHÁNH HỒ CHÍ MINH T${m}/${y}`;
    $('bodyCham').innerHTML = rowsHtml(filt(res.cham), res.opt.huongCham, true);
    $('bodyCan').innerHTML = rowsHtml(filt(res.canDate), res.opt.huongCanDate, false, true);
    $('headAll').innerHTML = '<th class="r">Stt</th><th>Mã vật tư</th><th style="min-width:220px">Tên vật tư</th><th>Kho</th><th>Đvt</th><th>Lô</th><th>Hạn dùng</th><th>Tuổi thuốc</th><th class="r">Tồn đầu</th><th class="r">Nhập</th><th class="r">Xuất</th><th class="r">Tồn cuối</th><th class="r">Giá trị tồn</th><th class="r">% xuất</th><th>Số tháng chưa xuất</th><th>Phân loại</th>';
    $('bodyAll').innerHTML = filt(res.list).map((r, i) => { const c = T.tuoiColor(r.tuoi); return `<tr><td class="r">${i + 1}</td><td>${esc(r.ma)}</td><td style="white-space:normal">${esc(r.ten)}</td><td>${esc(r.kho)}</td><td>${esc(r.dvt)}</td><td>${esc(r.lo)}</td><td>${T.vnDate(r.hd)}</td><td class="tuoi" style="background:${c.bg};color:${c.fg}">${r.tuoi === null ? '—' : r.tuoi < 0 ? 'Hết hạn' : r.tuoi}</td><td class="r">${num(r.tdSL)}</td><td class="r">${num(r.nhSL)}</td><td class="r">${num(r.xuSL)}</td><td class="r bold">${num(r.tcSL)}</td><td class="r">${num(r.tcGT)}</td><td class="r">${Math.round(r.tyLeXuat)}%</td><td style="${chamStyle(r.chuaXuat)}">${esc(r.chuaXuatText)}</td><td>${[r.cham ? 'Chậm LC' : '', r.canDate ? 'Cận date' : ''].filter(Boolean).join(' · ')}</td></tr>`; }).join('');
  }
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('#tkTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('tkFilter').hidden = t === 'cai-dat';
    if (!res) return;
    const n = { dashboard: filt(res.list).length, 'cham-luan-chuyen': filt(res.cham).length, 'can-date': filt(res.canDate).length, 'ton-theo-lo': filt(res.list).length }[t];
    $('tkFoot').hidden = t === 'cai-dat'; $('tkFoot').textContent = n === undefined ? '' : `${n} lô`;
  }
  function renderSettings() {
    const o = res.opt, d = archive[cur()].data;
    $('sRef').value = o.ngayThamChieu || T.refDefault(d);
    $('sRefHint').textContent = `Mặc định: ${T.vnDate(T.refDefault(d))} (${d.ngayXuat ? 'ngày xuất file' : 'hôm nay'})`;
    $('sCan').value = o.canDateThang; $('sTyLe').value = o.tyLeXuatToiDa; $('sCham').value = o.chamThang; $('sNhap').checked = !!o.tinhNhapTrongKy;
    $('sHuongCham').value = o.huongCham; $('sHuongCan').value = o.huongCanDate;
  }
  function renderAll() {
    recompute(); renderTop();
    if (!res) return;
    const khoList = [...new Set(res.list.map(r => r.kho))].sort();
    const kv = $('fKho').value;
    $('fKho').innerHTML = '<option value="">Tất cả kho</option>' + khoList.map(k => `<option value="${esc(k)}">Kho ${esc(k)}</option>`).join('');
    $('fKho').value = khoList.includes(kv) ? kv : '';
    renderStats(); renderDash(); renderTables(); renderSettings(); renderTabs();
    document.querySelectorAll('#bodyCan textarea').forEach(autoH);
  }
  const refilter = () => { renderStats(); renderDash(); renderTables(); renderTabs(); document.querySelectorAll('#bodyCan textarea').forEach(t => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }); };

  // ------------------------------------------------------------ sự kiện
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { uploadOpen = true; renderTop(); $('tkUpload').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTabs();
  });
  $('fKho').addEventListener('change', refilter);
  $('fSearch').addEventListener('input', refilter);
  function autoH(t) { t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }
  $('bodyCan').addEventListener('input', e => {
    const t = e.target; if (!t.dataset || !t.dataset.hx) return;
    autoH(t);
    const k = cur(); if (!k) return;
    const m = archive[k].huong = archive[k].huong || {};
    const v = t.value.trim();
    if (v) m[t.dataset.hx] = t.value; else delete m[t.dataset.hx];
    touch(k);
  });
  document.addEventListener('click', e => { const b = e.target.closest('[data-ky]'); if (b) { sel = b.dataset.ky; persist(); renderAll(); } });
  $('tkReload').addEventListener('click', () => { uploadOpen = true; renderTop(); $('tkFile').click(); });
  $('tkUpCancel').addEventListener('click', () => { uploadOpen = false; msg($('tkUpMsg'), ''); renderTop(); });
  $('tkDelete').addEventListener('click', () => {
    const k = cur(); if (!k || !confirm(`Xoá dữ liệu kỳ ${kyLabel(k)}${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
    delete archive[k]; if (sel === k) sel = ''; persist();
    if (token && repoSha[k]) gh(`/contents/${DIR}/${encodeURIComponent(k)}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa ton kho ${k} (tu web)`, sha: repoSha[k], branch: 'main' }) }).then(() => { delete repoSha[k]; }).catch(() => {});
    renderAll();
  });
  $('sApply').addEventListener('click', () => {
    const k = cur(); if (!k) return;
    archive[k].opt = { ngayThamChieu: $('sRef').value || '', canDateThang: Number($('sCan').value) || 0, tyLeXuatToiDa: Number($('sTyLe').value) || 0, chamThang: Number($('sCham').value) || T.DEFAULTS.chamThang, tinhNhapTrongKy: $('sNhap').checked,
      huongCham: $('sHuongCham').value.trim() || T.DEFAULTS.huongCham, huongCanDate: $('sHuongCan').value.trim() || T.DEFAULTS.huongCanDate };
    touch(k); renderAll();
  });
  $('sReset').addEventListener('click', () => { const k = cur(); if (!k) return; archive[k].opt = {}; touch(k); renderAll(); });

  // ------------------------------------------------------------ nạp file
  function handleFile(file) {
    if (!file) return;
    msg($('tkUpMsg'), '');
    $('tkZoneTitle').textContent = 'Đang đọc file…';
    const reader = new FileReader();
    reader.onload = ev => {
      setTimeout(() => {
        try {
          const wb = XLSX.read(ev.target.result, { type: 'array', cellDates: false });
          const data = T.parse(XLSX, wb, file.name);
          const k = kyKey(data);
          const old = archive[k] || {};
          archive[k] = { data, opt: old.opt || {} };
          sel = k; uploadOpen = false; touch(k); renderAll();
          location.hash = '#dashboard';
        } catch (err) { msg($('tkUpMsg'), esc(err.message || String(err))); }
        $('tkZoneTitle').textContent = 'Tải file "Báo cáo nhập xuất tồn theo kho số lượng và giá trị" (.xlsx)';
      }, 30);
    };
    reader.readAsArrayBuffer(file);
  }
  const zone = $('tkZone'), fi = $('tkFile');
  zone.addEventListener('click', () => fi.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { handleFile(fi.files[0]); fi.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });

  // ------------------------------------------------------------ xuất Excel theo mẫu
  $('tkExport').addEventListener('click', () => {
    if (!res) return;
    const k = cur(), d = archive[k].data, { m, y } = kyMY();
    const thin = { style: 'thin', color: { rgb: '000000' } }, B = { top: thin, bottom: thin, left: thin, right: thin };
    const title = { font: { bold: true, sz: 12 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, fill: { patternType: 'solid', fgColor: { rgb: 'C6EFCE' } } };
    const head = { font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: B };
    const cell = (h, extra) => Object.assign({ border: B, alignment: { horizontal: h || 'left', vertical: 'center', wrapText: true } }, extra || {});
    const NUM = '#,##0;-#,##0;"-"';
    const wb = XLSX.utils.book_new();
    function sheet(name, t1, list, huong, withCham, perRow) {
      const hdr = ['Stt', 'Mã vật tư', 'Tên vật tư', 'Mã kho', 'Đvt', 'Mã lô', 'Hạn dùng', 'Tuổi thuốc\n(Tháng)', `Tồn đầu\n(${T.vnDate(d.tu)})`, 'Sl nhập', 'Sl xuất', `Tồn cuối\n(${T.vnDate(d.den)})`]
        .concat(withCham ? ['Số tháng\nchậm luân chuyển'] : [], ['Giá trị tồn', 'Hướng xử lý']);
      const H = hdr.length - 1, GT = H - 1, CH = withCham ? H - 2 : -1;
      const aoa = [[t1], [`CHI NHÁNH HỒ CHÍ MINH T${m}/${y}`], [], hdr, ...list.map((r, i) => [i + 1, r.ma, r.ten, r.kho, r.dvt, r.lo, T.vnDate(r.hd), r.tuoi === null ? '' : r.tuoi < 0 ? 'Hết hạn' : r.tuoi, r.tdSL, r.nhSL, r.xuSL, r.tcSL]
        .concat(withCham ? [r.chuaXuatText] : [], [r.tcGT, perRow ? (perRow[lotId(r)] || '') : i === 0 ? huong : ''])) ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const ref = (r, c) => XLSX.utils.encode_cell({ r, c });
      const set = (r, c, st) => { const a = ref(r, c); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = st; };
      for (let c = 0; c < hdr.length; c++) { set(0, c, title); set(1, c, title); set(3, c, head); }
      list.forEach((r, i) => {
        const Rw = 4 + i, col = T.tuoiColor(r.tuoi);
        [0, 3, 4, 5, 6].forEach(c => set(Rw, c, cell('center')));
        [1, 2].forEach(c => set(Rw, c, cell(c === 1 ? 'center' : 'left')));
        set(Rw, 7, cell('center', { fill: { patternType: 'solid', fgColor: { rgb: col.bg.slice(1) } }, font: { bold: true, color: { rgb: col.fg.slice(1) } } }));
        [8, 9, 10, 11, GT].forEach(c => { set(Rw, c, cell('right')); ws[ref(Rw, c)].z = NUM; });
        if (CH >= 0) set(Rw, CH, cell('center', { font: { bold: true, color: { rgb: r.chuaXuat.n >= 6 ? 'B91C1C' : r.chuaXuat.n >= 3 ? 'C2410C' : '374151' } } }));
        set(Rw, H, perRow ? cell('left') : cell('center', { font: { bold: true } }));
      });
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: H } }, { s: { r: 1, c: 0 }, e: { r: 1, c: H } }];
      if (!perRow && list.length > 1) ws['!merges'].push({ s: { r: 4, c: H }, e: { r: 3 + list.length, c: H } });
      ws['!cols'] = [6, 11, 42, 9, 7, 13, 12, 11, 14, 9, 9, 14].concat(withCham ? [22] : [], [15, 32]).map(w => ({ wch: w }));
      ws['!rows'] = [{ hpt: 22 }, { hpt: 22 }, {}, { hpt: 32 }];
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    sheet('Chậm luân chuyển', 'BÁO CÁO TỒN KHO VẬT TƯ CHẬM LUÂN CHUYỂN', filt(res.cham), res.opt.huongCham, true);
    // Cận date: có nhập tay thì ghi từng dòng; chưa nhập dòng nào thì dùng câu mặc định gộp như mẫu
    const hm = huongMap();
    sheet('Cận date', `BÁO CÁO TỒN KHO VẬT TƯ CẬN DATE (≤ ${res.opt.canDateThang} THÁNG)`, filt(res.canDate), res.opt.huongCanDate, false,
      Object.keys(hm).length ? hm : null);
    XLSX.writeFile(wb, `BaoCao_CanDate_ChamLuanChuyen_T${m}-${y}.xlsx`);
  });

  if (location.hash === '#nap-du-lieu') uploadOpen = true;
  renderAll();
  pull();
})();
