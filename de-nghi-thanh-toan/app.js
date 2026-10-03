// Trang "Đề nghị thanh toán": lập Giấy đề nghị thanh toán theo mẫu BM-01/KT-CPC1HN từ các mẫu đơn vị nhận tiền
// đã lưu (nạp 1 lần từ file "BM 01_ĐN thanh toán.xlsx"), tự tính tổng + số tiền bằng chữ, in A5/A4, xuất Excel.
// Mẫu + phiếu đã lập lưu trong trình duyệt và (nếu đã kết nối token) đồng bộ lên kho riêng tư thư mục de-nghi-thanh-toan/.
// Trang công khai KHÔNG chứa số tài khoản nào — tất cả nằm trong dữ liệu riêng.
(function () {
  'use strict';
  const root = document.getElementById('tk');
  if (!root) return;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const FILE = `${DIR}/du-lieu.json`;
  const LS_DB = 'kvh-dntt-v1', LS_DRAFT = 'kvh-dntt-draft', TOKEN_KEY = 'kvh-gh-token';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vnd = n => Math.round(n || 0).toLocaleString('vi-VN');
  const msg = (el, html, ok) => { if (el) el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const nowIso = () => new Date().toISOString();
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const isoToVN = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : (s || '');
  function vnToIso(s) {
    if (s instanceof Date) return `${s.getFullYear()}-${pad2(s.getMonth() + 1)}-${pad2(s.getDate())}`;
    if (typeof s === 'number' && s > 20000 && s < 80000) { const d = new Date(Math.round((s - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
    const m = String(s || '').trim().match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    return m ? `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}` : (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '').trim()) ? String(s).trim() : '');
  }
  const parseMoney = v => { if (typeof v === 'number') return Math.round(v); const t = String(v || '').replace(/[^\d-]/g, ''); return t ? Number(t) : 0; };

  // ------------------------------------------------------------ số tiền bằng chữ
  const SO = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  function doc3(n, du) { // du = đọc đủ "không trăm" khi đứng sau nhóm lớn hơn
    const h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), u = n % 10, p = [];
    if (h || du) p.push(SO[h] + ' trăm');
    if (t === 0) { if (u && (h || du)) p.push('lẻ'); }
    else p.push(t === 1 ? 'mười' : SO[t] + ' mươi');
    if (u) p.push(u === 1 && t >= 2 ? 'mốt' : u === 5 && t >= 1 ? 'lăm' : SO[u]);
    return p.join(' ');
  }
  function docSo(n, du) {
    const ty = Math.floor(n / 1e9), r = n % 1e9, p = [];
    let bat = !!du;
    if (ty) { p.push(docSo(ty, du) + ' tỷ'); bat = true; }
    [[Math.floor(r / 1e6), 'triệu'], [Math.floor(r % 1e6 / 1000), 'nghìn'], [r % 1000, '']].forEach(([g, dv]) => {
      if (g) { p.push(doc3(g, bat) + (dv ? ' ' + dv : '')); bat = true; }
    });
    return p.join(' ');
  }
  function bangChu(n) {
    n = Math.round(n || 0);
    if (!n) return 'Không đồng';
    const s = (n < 0 ? 'âm ' : '') + docSo(Math.abs(n), false) + ' đồng';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  window.KVH_bangChu = bangChu;

  // ------------------------------------------------------------ dữ liệu + đồng bộ
  const emptyDb = () => ({ mau: [], phieu: [], cd: [], cfg: null, xoa: {}, savedAt: '' });
  let db = emptyDb(); try { db = Object.assign(emptyDb(), JSON.parse(localStorage.getItem(LS_DB) || '{}')); } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  let repoSha = null, timer = null, saving = false, again = false;
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — mẫu và phiếu chỉ lưu trên trình duyệt máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  const persist = () => { try { localStorage.setItem(LS_DB, JSON.stringify(db)); } catch (e) {} };
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
    if (!res.ok) { let m = res.status + ''; try { m = (await res.json()).message || m; } catch (e) {} const err = new Error(m); err.status = res.status; throw err; }
    return res.status === 204 ? null : res.json();
  }
  const b64enc = t => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  // gộp 2 bản: theo id, bản sửa sau thắng; mục đã xóa (xoa[id]) bị bỏ
  function merge(a, b) {
    const xoa = Object.assign({}, a.xoa || {}, b.xoa || {});
    const gop = (x, y) => {
      const m = {};
      [...(x || []), ...(y || [])].forEach(it => { if (!m[it.id] || (it.sua || '') > (m[it.id].sua || '')) m[it.id] = it; });
      return Object.values(m).filter(it => !xoa[it.id]);
    };
    const cfg = ((a.cfg && a.cfg.sua) || '') >= ((b.cfg && b.cfg.sua) || '') ? (a.cfg || b.cfg) : b.cfg;
    return { mau: gop(a.mau, b.mau), phieu: gop(a.phieu, b.phieu), cd: gop(a.cd, b.cd), cfg: cfg || null, xoa, savedAt: nowIso() };
  }
  async function fetchRemote() {
    try { const f = await gh(`/contents/${FILE}?ref=main&t=${Date.now()}`); repoSha = f.sha; return JSON.parse(b64dec(f.content || '') || '{}'); }
    catch (e) { if (e.status === 404) { repoSha = null; return null; } throw e; }
  }
  async function pull() {
    if (!token) return;
    try {
      const remote = await fetchRemote();
      if (remote) db = merge(db, remote);
      persist(); renderAll();
      syncMsg = 'Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.';
      if (!remote || ['mau', 'phieu', 'cd', 'cfg'].some(k => JSON.stringify(remote[k] || null) !== JSON.stringify(db[k] || null))) save(0);
    } catch (e) { syncMsg = 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.'; }
    renderSync();
  }
  function save(delay = 1200) { if (!token) return; clearTimeout(timer); timer = setTimeout(push, delay); }
  async function push() {
    if (saving) { again = true; return; }
    saving = true;
    try {
      for (let lan = 0; lan < 3; lan++) {
        const body = { message: 'De nghi thanh toan (tu web)', content: b64enc(JSON.stringify(db)), branch: 'main' };
        if (repoSha) body.sha = repoSha;
        try {
          const r = await gh(`/contents/${FILE}`, { method: 'PUT', body: JSON.stringify(body) });
          repoSha = r.content.sha; syncMsg = `Đã lưu lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
          break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && lan < 2) { const remote = await fetchRemote(); if (remote) { db = merge(db, remote); persist(); } continue; }
          throw e;
        }
      }
    } catch (e) { syncMsg = `Chưa lưu được lên hệ thống (${e.message}). Dữ liệu vẫn trên máy này; thao tác lại hoặc tải lại trang.`; }
    saving = false; renderSync();
    if (again) { again = false; push(); }
  }
  const touch = () => { db.savedAt = nowIso(); persist(); save(); };
  const renderSync = () => { $('tkSync').textContent = syncMsg; };

  // ------------------------------------------------------------ phiếu đang lập (nháp)
  function kyMacDinh() { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  const today = () => vnToIso(new Date());
  const blankItem = (gc = '') => ({ ngay: '', ct: '', tien: 0, gc });
  function newDraft(keep) {
    return {
      id: '', mauId: '', mauTen: '',
      nguoi: keep ? keep.nguoi : '', boPhan: keep ? keep.boPhan : 'VP.Hồ Chí Minh',
      ky: kyMacDinh(), items: [blankItem()], lyDo: '', ht: 'ck', tenTK: '', soTK: '', nh: '',
      ngayLap: today(), ngayTrong: keep ? keep.ngayTrong : true, kho: keep ? keep.kho : 'A5', inTen: keep ? keep.inTen : true,
    };
  }
  let d = null; try { d = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null'); } catch (e) {}
  if (!d || !Array.isArray(d.items)) d = newDraft();
  const saveDraft = () => { try { localStorage.setItem(LS_DRAFT, JSON.stringify(d)); } catch (e) {} };
  const tong = x => (x.items || []).reduce((s, it) => s + (Number(it.tien) || 0), 0);

  // "Tháng 8/2026", "tháng 9+10/2024", "T5/2025" -> theo kỳ đang chọn
  function doiKy(text, ky) {
    if (!text || !/^\d{4}-\d{2}$/.test(ky || '')) return text;
    const m = +ky.slice(5), y = ky.slice(0, 4);
    return text
      .replace(/(tháng|Tháng|THÁNG)\s*\d{1,2}(\s*\+\s*\d{1,2})*\s*\/\s*\d{4}/g, (_, w) => `${w} ${m}/${y}`)
      .replace(/\bT\d{1,2}\/\d{4}\b/g, `T${m}/${y}`);
  }

  // ------------------------------------------------------------ tờ phiếu (HTML để xem trước + in)
  function phieuHtml(x) {
    const items = (x.items || []).filter(it => it.ngay || it.ct || it.tien || it.gc);
    const rows = (items.length ? items : [blankItem()]).map((it, i) => `<tr><td>${items.length ? i + 1 : ''}</td><td>${esc(isoToVN(it.ngay))}</td><td>${esc(it.ct)}</td><td class="tien">${it.tien ? vnd(it.tien) : ''}</td><td class="gc">${esc(it.gc)}</td></tr>`).join('');
    const t = tong(x);
    const nd = x.ngayLap || today();
    const ngay = x.ngayTrong
      ? `Tp.Hồ Chí Minh, ngày&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;tháng&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;năm ${nd.slice(0, 4)}`
      : `Tp.Hồ Chí Minh, ngày ${nd.slice(8, 10)} tháng ${nd.slice(5, 7)} năm ${nd.slice(0, 4)}`;
    const box = on => `<span class="box">${on ? '☑' : '☐'}</span>`;
    return `<div class="phieu${x.kho === 'A4' ? ' a4' : ''}">
      <div class="hd"><img class="logo" src="../assets/logo.svg?v=2" alt="CPC1HN"><h1>GIẤY ĐỀ NGHỊ THANH TOÁN</h1><div class="ma">BM-01/KT-CPC1HN<br>AD: 18/09/2020</div></div>
      <div class="kg"><div>KÍNH GỬI:</div><div>- BAN GIÁM ĐỐC<br>- PHÒNG KẾ TOÁN</div></div>
      <div class="ln" style="margin-top:8px">Tên tôi là: ${esc(x.nguoi)}</div>
      <div class="ln">Bộ phận công tác: ${esc(x.boPhan)}</div>
      <div class="ln">Xin được thanh toán các hóa đơn chứng từ sau:</div>
      <table class="ct"><colgroup><col style="width:8.6%"><col style="width:18%"><col style="width:25.6%"><col style="width:20.6%"><col style="width:27.2%"></colgroup>
        <thead><tr><th>STT</th><th>Ngày tháng</th><th>Hóa đơn/Chứng từ</th><th>Thành tiền</th><th>Ghi chú</th></tr></thead>
        <tbody>${rows}<tr class="tong"><td></td><td colspan="2" class="lbl">Tổng cộng</td><td class="tien">${t ? vnd(t) : ''}</td><td></td></tr></tbody></table>
      <div class="bc">(Bằng chữ: <b>${t ? esc(bangChu(t)) : ''}</b>)</div>
      <div class="ld">Lý do thanh toán: ${esc(x.lyDo)}</div>
      <div class="ht"><div>Hình thức nhận tiền:</div><div>Tiền mặt ${box(x.ht === 'tm')}</div><div>Chuyển khoản ${box(x.ht === 'ck')}</div></div>
      <div class="ln">- Tên Tài khoản nhận tiền: ${esc(x.tenTK)}</div>
      <div class="ln">- Số tài khoản: ${esc(x.soTK)}</div>
      <div class="ln">- Tại Ngân hàng: ${esc(x.nh)}</div>
      <div class="ngay">${ngay}</div>
      <div class="ky"><div>Người đề nghị${x.inTen ? `<div class="nm">${esc(x.nguoi)}</div>` : ''}</div><div>Phụ trách bộ phận</div><div>Kế toán trưởng</div><div>Thủ trưởng đv</div></div>
    </div>`;
  }
  function renderPreview() {
    const pv = $('pv');
    pv.innerHTML = phieuHtml(d);
    const el = pv.firstElementChild;
    const w = el.offsetWidth, h = el.offsetHeight, target = 560;
    const sc = w > target ? target / w : 1;
    el.style.transform = sc < 1 ? `scale(${sc})` : '';
    $('pvPaper').style.width = Math.round(w * sc) + 'px';
    $('pvPaper').style.height = Math.round(h * sc) + 'px';
    $('pvKho').textContent = `Khổ ${d.kho}`;
  }

  // ------------------------------------------------------------ form lập phiếu
  const F = { fNguoi: 'nguoi', fBoPhan: 'boPhan', fKy: 'ky', fLyDo: 'lyDo', fTenTK: 'tenTK', fSoTK: 'soTK', fNH: 'nh', fNgay: 'ngayLap' };
  function renderForm() {
    Object.entries(F).forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = d[k] || ''; });
    $('fNgayTrong').checked = !!d.ngayTrong; $('fInTen').checked = !!d.inTen;
    document.querySelectorAll('input[name=ht]').forEach(r => { r.checked = r.value === d.ht; });
    document.querySelectorAll('input[name=kho]').forEach(r => { r.checked = r.value === d.kho; });
    renderItems(); renderTong(); renderChips(); renderPreview();
  }
  function renderItems() {
    $('itBody').innerHTML = d.items.map((it, i) => `<tr data-i="${i}">
      <td class="stt">${i + 1}</td>
      <td><input type="date" data-k="ngay" value="${esc(it.ngay)}"></td>
      <td><input data-k="ct" value="${esc(it.ct)}" placeholder="HĐ: 1234"></td>
      <td><input class="money" data-k="tien" inputmode="numeric" value="${it.tien ? vnd(it.tien) : ''}" placeholder="0"></td>
      <td><input data-k="gc" value="${esc(it.gc)}"></td>
      <td class="x"><button type="button" title="Xóa dòng" data-del="${i}">×</button></td></tr>`).join('');
    const m = db.mau.find(x => x.id === d.mauId);
    $('lastHint').innerHTML = m && m.lastTien ? `Lần trước: <b>${vnd(m.lastTien)}</b>${m.lastCt ? ' · ' + esc(m.lastCt) : ''}${m.lastNgay ? ' (' + esc(isoToVN(m.lastNgay)) + ')' : ''} · <a id="useLast">dùng lại số tiền</a>` : '';
    const ul = $('useLast');
    if (ul) ul.onclick = () => { const it = d.items[0] || (d.items[0] = blankItem()); it.tien = m.lastTien; changed(); renderItems(); };
  }
  function renderTong() {
    const t = tong(d);
    $('tongTien').textContent = t ? vnd(t) : '';
    $('bangChu').textContent = t ? bangChu(t) : '—';
  }
  function changed() { saveDraft(); renderTong(); renderPreview(); }

  Object.entries(F).forEach(([id, k]) => $(id).addEventListener('input', () => {
    if (k === 'ky') { d.ky = $(id).value; d.lyDo = doiKy(d.lyDo, d.ky); $('fLyDo').value = d.lyDo; }
    else d[k] = $(id).value;
    changed();
  }));
  $('fNgayTrong').addEventListener('change', e => { d.ngayTrong = e.target.checked; changed(); });
  $('fInTen').addEventListener('change', e => { d.inTen = e.target.checked; changed(); });
  document.querySelectorAll('input[name=ht]').forEach(r => r.addEventListener('change', () => { d.ht = r.value; changed(); }));
  document.querySelectorAll('input[name=kho]').forEach(r => r.addEventListener('change', () => { d.kho = r.value; changed(); }));
  $('fNguoi').addEventListener('change', () => { // chọn người quen -> điền bộ phận đã dùng
    const p = db.phieu.slice().reverse().find(x => x.nguoi === d.nguoi) || db.mau.find(x => x.nguoi === d.nguoi && x.boPhan);
    if (p && p.boPhan && !$('fBoPhan').value) { d.boPhan = p.boPhan; $('fBoPhan').value = p.boPhan; changed(); }
  });

  $('itBody').addEventListener('input', e => {
    const tr = e.target.closest('tr'), k = e.target.dataset.k; if (!tr || !k) return;
    const it = d.items[+tr.dataset.i];
    it[k] = k === 'tien' ? parseMoney(e.target.value) : e.target.value;
    changed();
  });
  $('itBody').addEventListener('focusout', e => { if (e.target.dataset.k === 'tien') { const v = parseMoney(e.target.value); e.target.value = v ? vnd(v) : ''; } });
  $('itBody').addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    d.items.splice(+b.dataset.del, 1); if (!d.items.length) d.items.push(blankItem());
    renderItems(); changed();
  });
  // dán nhiều dòng từ Excel: Ngày | Chứng từ | Tiền | Ghi chú
  $('itBody').addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    const tr = e.target.closest('tr'); let i = tr ? +tr.dataset.i : d.items.length;
    text.replace(/\r/g, '').split('\n').filter(l => l.trim()).forEach(line => {
      const c = line.split('\t');
      let ngay = vnToIso(c[0]), rest = c;
      if (ngay || c.length >= 4) rest = c.slice(1); else ngay = '';
      const it = { ngay, ct: clean(rest[0]), tien: parseMoney(rest[1]), gc: clean(rest.slice(2).join(' ')) };
      if (!it.tien && /^[\d.,\s]+$/.test(rest[0] || '') && rest.length === 1) { it.tien = parseMoney(rest[0]); it.ct = ''; }
      const cur = d.items[i];
      if (cur && !cur.ct && !cur.tien && !cur.ngay) d.items[i] = Object.assign(cur, it); else d.items.splice(i, 0, it);
      i++;
    });
    renderItems(); changed();
  });
  $('btnAddRow').addEventListener('click', () => {
    const last = d.items[d.items.length - 1];
    d.items.push(blankItem(last ? last.gc : '')); renderItems(); changed();
    const ins = $('itBody').querySelectorAll('tr:last-child input'); if (ins[0]) ins[0].focus();
  });
  $('btnNew').addEventListener('click', () => { d = newDraft(d); saveDraft(); renderForm(); msg($('lpMsg'), ''); });

  // ------------------------------------------------------------ áp dụng mẫu
  function applyMau(m) {
    const keep = d;
    d = newDraft(keep);
    Object.assign(d, {
      mauId: m.id, mauTen: m.ten,
      nguoi: m.nguoi || keep.nguoi, boPhan: m.boPhan || keep.boPhan,
      lyDo: doiKy(m.lyDo || '', d.ky), ht: m.ht || 'ck', tenTK: m.tenTK || '', soTK: m.soTK || '', nh: m.nh || '',
      items: [{ ngay: '', ct: m.ctPrefix || 'HĐ: ', tien: 0, gc: m.ghiChu || '' }],
    });
    m.dung = nowIso();
    persist();
    saveDraft(); renderForm();
    msg($('lpMsg'), `Đã điền theo mẫu <b>${esc(m.ten)}</b>. Kiểm tra lại kỳ, số hóa đơn và số tiền rồi bấm In.`, true);
    const f = $('itBody').querySelector('input[data-k=ngay]'); if (f) f.focus();
  }
  const mauSorted = () => db.mau.slice().sort((a, b) => (b.dung || b.sua || '').localeCompare(a.dung || a.sua || ''));
  function renderChips() {
    const list = mauSorted();
    $('mauEmpty').hidden = !!list.length;
    $('mauList').innerHTML = list.map(m => `<option value="${esc(m.ten)}">${esc(clean(m.tenTK).slice(0, 60))}</option>`).join('');
    $('mauChips').innerHTML = list.slice(0, 16).map(m => `<button type="button" data-mau="${esc(m.id)}" class="${m.id === d.mauId ? 'on' : ''}" title="${esc(m.lyDo)}">${esc(m.ten)}</button>`).join('');
    const ng = [...new Set([...db.mau.map(m => m.nguoi), ...db.phieu.map(p => p.nguoi)].filter(Boolean))];
    $('nguoiList').innerHTML = ng.map(n => `<option value="${esc(n)}">`).join('');
  }
  $('mauChips').addEventListener('click', e => { const b = e.target.closest('[data-mau]'); if (b) { const m = db.mau.find(x => x.id === b.dataset.mau); if (m) applyMau(m); } });
  $('mauSearch').addEventListener('input', e => {
    const v = e.target.value.trim().toLowerCase(); if (!v) return;
    const m = db.mau.find(x => x.ten.toLowerCase() === v);
    if (m) { e.target.value = ''; applyMau(m); }
  });
  $('mauSearch').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim().toLowerCase(); if (!v) return;
    const m = mauSorted().find(x => (x.ten + ' ' + x.tenTK + ' ' + x.lyDo).toLowerCase().includes(v));
    if (m) { e.target.value = ''; applyMau(m); }
  });

  // ------------------------------------------------------------ thả hóa đơn điện tử (PDF bản thể hiện / XML) -> tự điền phiếu
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const CPC1_MST = ['0104089394', '0101243150']; // MST bên mua (CPC1) + MISA (nhà phát hành) — không phải người bán
  const soChu = s => String(s || '').replace(/\D/g, '');
  const tienHD = s => { const t = String(s || '').trim(); if (!t) return 0; return /,\d{1,2}$/.test(t) ? Math.round(parseFloat(t.replace(/\./g, '').replace(',', '.'))) : parseMoney(t); };
  async function pdfLines(buf) {
    if (!window.pdfjsLib) { await loadScript(PDFJS + 'pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; }
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise, out = [];
    for (let n = 1; n <= Math.min(pdf.numPages, 3); n++) {
      const items = (await (await pdf.getPage(n)).getTextContent()).items.filter(it => it.str && it.str.trim());
      const rows = {};
      items.forEach(it => { const k = Math.round(it.transform[5] / 3); (rows[k] = rows[k] || []).push(it); });
      Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(k => {
        let line = '', end = null; // ghép các mảnh sát nhau (pdf.js tách "10.260.000" thành "10" "." "260"…)
        rows[k].sort((a, b) => a.transform[4] - b.transform[4]).forEach(it => {
          const x = it.transform[4];
          line += (end !== null && x - end > 1.5 ? ' ' : '') + it.str;
          end = x + (it.width || 0);
        });
        out.push(line.replace(/\s+/g, ' ').trim());
      });
    }
    return out;
  }
  function docHdPdf(lines) {
    const hd = {}, all = lines.join('\n');
    let m;
    if ((m = all.match(/Ký hiệu\s*(?:\(Serial\))?\s*:\s*([0-9A-Z]{5,9})/i))) hd.kyHieu = m[1];
    for (const l of lines) if ((m = l.match(/^Số\s*(?:\(No\.?\))?\s*:\s*(\d{1,10})\b/i))) { hd.so = m[1]; break; }
    if ((m = all.match(/Ngày\s*(?:\(Date\))?\s*(\d{1,2})\s*tháng\s*(?:\(month\))?\s*(\d{1,2})\s*năm\s*(?:\(year\))?\s*(\d{4})/i))) hd.ngay = `${m[3]}-${pad2(+m[2])}-${pad2(+m[1])}`;
    const iBan = lines.findIndex(l => /^(Đơn vị bán( hàng)?|Tên người bán|Người bán( hàng)?|Tên đơn vị bán)\s*(\([^)]*\))?\s*:/i.test(l));
    const iMua = lines.findIndex(l => /(người mua|Tên đơn vị\s*:|Đơn vị mua)/i.test(l));
    if (iBan >= 0) {
      hd.ban = clean(lines[iBan].replace(/^[^:]*:/, ''));
      const vung = lines.slice(iBan + 1, iMua > iBan ? iMua : iBan + 8);
      for (const l of vung) {
        if (!hd.mst && (m = l.match(/Mã số thuế[^:]*:\s*([\d\s-]{10,20})/i))) hd.mst = m[1].replace(/\s/g, '');
        if (!hd.stk && (m = l.match(/Số tài khoản[^:]*:\s*([\d\s.-]{5,30})(.*)$/i))) { hd.stk = clean(m[1]).replace(/[\s.]/g, ''); const nh = clean(m[2]).replace(/^[-–,\s]*(tại\s*)?/i, ''); if (nh) hd.nh = nh; }
        if (!hd.nh && (m = l.match(/(?:Tại\s*)?Ngân hàng[^:]*:\s*(.+)$/i))) hd.nh = clean(m[1]);
      }
    }
    if ((m = all.match(/Tổng (?:cộng )?tiền thanh toán[^:\d]*:?\s*([\d.,]+)/i))) hd.tong = tienHD(m[1]);
    // tên hàng hóa: các dòng giữa tiêu đề bảng và "Cộng tiền hàng"
    const i0 = lines.findIndex(l => /Tên hàng hóa/i.test(l)), i1 = lines.findIndex((l, i) => i > i0 && /Cộng tiền hàng|Tổng tiền thanh toán/i.test(l));
    if (i0 >= 0) {
      const ten = [];
      lines.slice(i0 + 1, i1 > i0 ? i1 : i0 + 12).forEach(l => {
        if (/^[\d\s=x]+$/i.test(l) || l.split(' ').length < 2 && !/[a-zà-ỹ]{3,}/i.test(l)) return;
        if (/MISA|MeInvoice|Phát hành|Cổ phần/i.test(l) && l.length < 25) return;
        let w = l.split(' ');
        const iSo = w.findIndex((t, j) => j > 0 && /^\d{1,3}([.,]\d{3})+$|^\d+,\d+$/.test(t));
        if (iSo > 0) { w = w.slice(0, iSo); if (/^\d+$/.test(w[0])) w.shift(); w.pop(); } else if (/^\d+$/.test(w[0]) && w.length > 1) w.shift();
        if (w.length) ten.push(w.join(' '));
      });
      hd.hang = clean(ten.join(' '));
    }
    return hd;
  }
  function docHdXml(text) {
    const x = new DOMParser().parseFromString(text, 'application/xml');
    if (x.getElementsByTagName('parsererror').length) throw new Error('file XML lỗi');
    const g = (el, tag) => { const n = el && el.getElementsByTagName(tag)[0]; return n ? clean(n.textContent) : ''; };
    const ban = x.getElementsByTagName('NBan')[0];
    const hd = { kyHieu: g(x, 'KHHDon'), so: g(x, 'SHDon'), ngay: (g(x, 'NLap') || '').slice(0, 10),
      ban: g(ban, 'Ten'), mst: g(ban, 'MST'), stk: soChu(g(ban, 'STKNHang')), nh: g(ban, 'TNHang'), tong: tienHD(g(x, 'TgTTTBSo')) };
    hd.hang = [...x.getElementsByTagName('HHDVu')].map(h => g(h, 'THHDVu')).filter(Boolean).join(', ');
    if (!hd.ban && !hd.tong) throw new Error('không phải hóa đơn điện tử');
    return hd;
  }
  async function docHoaDon(file) {
    const ten = file.name || '';
    let hd;
    if (/\.xml$/i.test(ten)) hd = docHdXml(await file.text());
    else if (/\.pdf$/i.test(ten)) hd = docHdPdf(await pdfLines(await file.arrayBuffer()));
    else throw new Error('chỉ đọc được PDF hoặc XML');
    if (!hd.so && (/_(\d{3,10})\.(pdf|xml)$/i.exec(ten))) hd.so = /_(\d{3,10})\.(pdf|xml)$/i.exec(ten)[1];
    if (CPC1_MST.includes(soChu(hd.mst).slice(0, 10))) hd.mst = '';
    hd.file = ten;
    return hd;
  }
  const tenGon = s => clean(String(s || '').toUpperCase().normalize('NFC')
    .replace(/CÔNG TY|CTY|TNHH|CỔ PHẦN|\bCP\b|THƯƠNG MẠI|DỊCH VỤ|SẢN XUẤT|MỘT THÀNH VIÊN|MTV|CHI NHÁNH|[-–.,()]/g, ' '));
  function timMau(hd) {
    const stk = soChu(hd.stk), mst = soChu(hd.mst), ten = tenGon(hd.ban);
    return db.mau.find(m => mst && soChu(m.mst) === mst)
      || db.mau.find(m => stk.length >= 6 && soChu(m.soTK) === stk)
      || db.mau.find(m => ten.length >= 6 && tenGon(m.tenTK) && (tenGon(m.tenTK) === ten || tenGon(m.tenTK).includes(ten) || ten.includes(tenGon(m.tenTK))));
  }
  let hdHang = []; // các nhóm hóa đơn (theo đơn vị bán) chưa lập phiếu
  function lapTuHoaDon(nhom) {
    const hd0 = nhom[0], m = timMau(hd0);
    const ky = hd0.ngay ? hd0.ngay.slice(0, 7) : kyMacDinh();
    if (m) applyMau(m); else { d = newDraft(d); }
    const pre = (m && m.ctPrefix) || 'HĐ: ';
    Object.assign(d, {
      ky, mst: hd0.mst || (m && m.mst) || '',
      items: nhom.map(h => ({ ngay: h.ngay || '', ct: h.so ? pre + String(Number(h.so)) : '', tien: h.tong || 0, gc: (m && m.ghiChu) || '' })),
    });
    if (m) d.lyDo = doiKy(m.lyDo || '', ky);
    else Object.assign(d, { mauId: '', mauTen: hd0.ban, ht: 'ck', tenTK: hd0.ban || '', soTK: hd0.stk || '', nh: hd0.nh || '',
      lyDo: `Thanh toán ${hd0.hang || 'tiền hàng/dịch vụ'}_CN.HCM` });
    if (m && hd0.mst && !m.mst) { m.mst = hd0.mst; m.sua = nowIso(); touch(); }
    saveDraft(); renderForm();
    const canhBao = [];
    if (m && hd0.stk && soChu(m.soTK) && soChu(m.soTK) !== soChu(hd0.stk)) canhBao.push(`⚠ Số tài khoản trên hóa đơn (${esc(hd0.stk)}) <b>khác</b> mẫu (${esc(m.soTK)}) — kiểm tra lại.`);
    if (!m) canhBao.push('Chưa có mẫu cho đơn vị này — đã điền theo hóa đơn. Kiểm tra lý do + <b>ngân hàng</b>, rồi bấm "Lưu làm mẫu" để lần sau tự nhận.');
    if (nhom.some(h => !h.tong)) canhBao.push('⚠ Có hóa đơn không đọc được tổng tiền — nhập tay.');
    msg($('lpMsg'), `Đã điền từ ${nhom.length} hóa đơn của <b>${esc(hd0.ban || '?')}</b>${m ? ` (mẫu <b>${esc(m.ten)}</b>)` : ''}: ${nhom.map(h => `HĐ ${esc(h.so || '?')} ngày ${esc(isoToVN(h.ngay))} = ${vnd(h.tong)}`).join('; ')}.${canhBao.length ? '<br>' + canhBao.join('<br>') : ''}`, !canhBao.some(t => t.startsWith('⚠')));
  }
  function renderHdHang() {
    $('hdHang').innerHTML = hdHang.length ? `<span class="hint">Còn hóa đơn của đơn vị khác — bấm để lập phiếu tiếp:</span> ` + hdHang.map((n, i) => `<button type="button" class="b sm" data-hd="${i}">${esc(n[0].ban || n[0].file)} · ${n.length} HĐ · ${vnd(n.reduce((s, h) => s + (h.tong || 0), 0))}</button>`).join(' ') : '';
  }
  async function napHoaDon(files) {
    msg($('lpMsg'), 'Đang đọc hóa đơn…', true);
    const ok = [], loi = [];
    for (const f of files) { try { ok.push(await docHoaDon(f)); } catch (e) { loi.push(`${esc(f.name)}: ${esc(e.message)}`); } }
    if (!ok.length) { msg($('lpMsg'), 'Không đọc được hóa đơn nào. ' + loi.join('; ')); return; }
    const nhom = {};
    ok.forEach(h => { const k = soChu(h.mst) || tenGon(h.ban) || h.file; (nhom[k] = nhom[k] || []).push(h); });
    const ds = Object.values(nhom).map(n => n.sort((a, b) => (a.ngay || '').localeCompare(b.ngay || '')));
    hdHang = ds.slice(1);
    lapTuHoaDon(ds[0]); renderHdHang();
    if (loi.length) $('lpMsg').innerHTML += `<div class="tk-err">Không đọc được: ${loi.join('; ')}</div>`;
  }
  $('hdHang').addEventListener('click', e => { const b = e.target.closest('[data-hd]'); if (!b) return; const n = hdHang.splice(+b.dataset.hd, 1)[0]; lapTuHoaDon(n); renderHdHang(); });
  const hdZone = $('hdZone'), hdFile = $('hdFile');
  hdZone.addEventListener('click', () => hdFile.click());
  hdZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hdFile.click(); } });
  hdFile.addEventListener('change', () => { if (hdFile.files.length) napHoaDon([...hdFile.files]); hdFile.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => hdZone.addEventListener(ev, e => { e.preventDefault(); hdZone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => hdZone.addEventListener(ev, e => { e.preventDefault(); hdZone.classList.remove('drag'); }));
  hdZone.addEventListener('drop', e => { if (e.dataTransfer.files.length) napHoaDon([...e.dataTransfer.files]); });

  // ------------------------------------------------------------ lưu phiếu / mẫu, in, Excel
  function kiemTra() {
    const loi = [];
    if (!tong(d)) loi.push('chưa có số tiền');
    if (!clean(d.nguoi)) loi.push('chưa có tên người đề nghị');
    if (!clean(d.lyDo)) loi.push('chưa có lý do thanh toán');
    if (d.ht === 'ck' && (!clean(d.tenTK) || !clean(d.soTK))) loi.push('chuyển khoản nhưng thiếu tên/số tài khoản');
    return loi;
  }
  function luuPhieu() {
    if (!tong(d)) return null;
    if (!d.id) d.id = newId();
    const rec = JSON.parse(JSON.stringify(d));
    rec.items = rec.items.filter(it => it.ngay || it.ct || it.tien || it.gc);
    rec.tong = tong(rec); rec.sua = nowIso(); rec.tao = rec.tao || rec.sua;
    const i = db.phieu.findIndex(p => p.id === rec.id);
    if (i >= 0) { rec.tao = db.phieu[i].tao || rec.tao; db.phieu[i] = rec; } else db.phieu.push(rec);
    const m = db.mau.find(x => x.id === d.mauId);
    if (m) { m.lastTien = rec.tong; m.lastCt = rec.items.map(it => it.ct).filter(Boolean).join(', '); m.lastNgay = (rec.items[0] || {}).ngay || ''; m.dung = rec.sua; m.sua = rec.sua; }
    saveDraft(); touch(); renderLists();
    return rec;
  }
  $('btnSave').addEventListener('click', () => {
    const r = luuPhieu();
    msg($('lpMsg'), r ? 'Đã lưu phiếu vào "Phiếu đã lập".' : 'Phiếu chưa có số tiền — chưa lưu.', !!r);
  });
  function inTrang(htmls, pageCss) {
    const old = document.getElementById('khungIn'); if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'khungIn'; f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const css = [...document.querySelectorAll('style')].filter(st => st.id !== 'pageSize').map(st => st.textContent).join(' ');
    const doc = f.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><base href="${esc(location.href)}"><title>In</title>
      <style>${css}</style><style>${pageCss} html, body { margin: 0; padding: 0; background: #fff; } #printArea { display: block !important; }
      #printArea > * { box-shadow: none; } #printArea > * + * { break-before: page; page-break-before: always; } #printArea .phieu.p5 { page: pA5; }</style>
      </head><body><div id="printArea">${htmls.join('')}</div></body></html>`);
    doc.close();
    const imgs = [...doc.images].map(im => im.complete ? null : new Promise(ok => { im.onload = im.onerror = ok; })).filter(Boolean);
    Promise.race([Promise.all(imgs), new Promise(ok => setTimeout(ok, 2500))]).then(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch (e) { $('printArea').innerHTML = htmls.join(''); $('pageSize').textContent = pageCss; window.print(); }
    });
  }
  function inPhieu(list) {
    const kho = list[0].kho === 'A4' ? 'A4' : 'A5';
    inTrang(list.map(phieuHtml), `@page { size: ${kho} portrait; margin: ${kho === 'A4' ? '10mm' : '6mm'}; }`);
  }
  $('btnPrint').addEventListener('click', () => {
    const loi = kiemTra();
    if (loi.length && !confirm('Phiếu ' + loi.join(', ') + '.\nVẫn in?')) return;
    luuPhieu(); inPhieu([d]);
    msg($('lpMsg'), 'Đã gửi lệnh in và lưu phiếu. Muốn lập phiếu khác: chọn mẫu khác hoặc bấm "Phiếu mới".', true);
  });
  $('btnExcel').addEventListener('click', () => {
    const loi = kiemTra();
    if (loi.length && !confirm('Phiếu ' + loi.join(', ') + '.\nVẫn xuất Excel?')) return;
    luuPhieu(); xuatExcel([d]);
  });
  $('btnSaveMau').addEventListener('click', () => {
    let m = db.mau.find(x => x.id === d.mauId);
    if (m && !confirm(`Cập nhật mẫu "${m.ten}" theo phiếu đang lập (lý do, người nhận, tài khoản)?\nBấm Cancel để lưu thành mẫu mới.`)) m = null;
    if (!m) {
      const ten = clean(prompt('Đặt tên gợi nhớ cho mẫu (vd: Thang máy, Lavie, Nhất Tín):', d.mauTen || ''));
      if (!ten) return;
      m = { id: newId(), ten }; db.mau.push(m);
    }
    Object.assign(m, { nguoi: d.nguoi, boPhan: d.boPhan, lyDo: d.lyDo, ht: d.ht, tenTK: d.tenTK, soTK: d.soTK, nh: d.nh, ghiChu: (d.items[0] || {}).gc || '', sua: nowIso() });
    if (d.mst) m.mst = d.mst;
    d.mauId = m.id; d.mauTen = m.ten; saveDraft(); touch(); renderAll();
    msg($('lpMsg'), `Đã lưu mẫu <b>${esc(m.ten)}</b>.`, true);
  });

  // Xuất Excel bằng ExcelJS (chèn được logo + đặt khổ A5 như file mẫu)
  const EXCELJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const loadScript = src => new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('không tải được ' + src)); document.head.appendChild(s); });
  async function logoBase64() {
    try {
      const blob = await fetch('../assets/logo.png?v=2').then(r => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      return await new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
    } catch (e) { return null; }
  }
  async function xuatExcel(list) {
    try {
      if (!window.ExcelJS) await loadScript(EXCELJS_URL);
      const wb = new ExcelJS.Workbook(), used = {};
      const logo = await logoBase64();
      const imgId = logo ? wb.addImage({ base64: logo, extension: 'png' }) : null;
      list.forEach(x => {
        let name = clean(x.mauTen || 'Phieu').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 28) || 'Phieu';
        if (used[name]) name = name.slice(0, 25) + ' ' + (++used[name]); else used[name] = 1;
        sheetPhieu(wb, name, x, imgId);
      });
      const buf = await wb.xlsx.writeBuffer();
      const x = list[0];
      const ten = clean(x.mauTen || x.tenTK || 'phieu').replace(/[\\\/?*\[\]:"<>|]/g, ' ').slice(0, 40);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `ĐNTT ${ten} ${isoToVN(x.ngayLap || today()).replace(/\//g, '.')}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { alert('Không xuất được Excel: ' + e.message + '. Kiểm tra mạng rồi thử lại.'); }
  }
  function sheetPhieu(wb, name, x, imgId) {
    const ws = wb.addWorksheet(name, {
      pageSetup: { paperSize: 11, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.16, right: 0.16, top: 0.18, bottom: 0.18, header: 0.1, footer: 0.1 } },
    });
    ws.columns = [1.57, 6.29, 13.14, 18.71, 15, 19.14].map(w => ({ width: w }));
    const thin = { style: 'thin', color: { argb: 'FF000000' } };
    const box = { top: thin, bottom: thin, left: thin, right: thin };
    const put = (ref, v, o = {}) => {
      const cell = ws.getCell(ref);
      cell.value = v;
      cell.font = Object.assign({ name: 'Times New Roman', size: 12 }, o.font || {});
      cell.alignment = Object.assign({ vertical: 'middle' }, o.align || {});
      if (o.border) cell.border = box;
      if (o.numFmt) cell.numFmt = o.numFmt;
      return cell;
    };
    const h = (r, v) => { ws.getRow(r).height = v; };
    [1, 5, 6, 7, 8, 9].forEach(r => h(r, 15.75)); h(2, 16.5); h(4, 6.75);
    if (imgId !== null) ws.addImage(imgId, { tl: { col: 1.15, row: 0 }, ext: { width: 56, height: 56 }, editAs: 'oneCell' });
    put('C1', 'GIẤY ĐỀ NGHỊ THANH TOÁN', { font: { size: 16, bold: true }, align: { horizontal: 'center' } }); ws.mergeCells('C1:E2');
    put('F1', 'BM-01/KT-CPC1HN', { font: { size: 9, italic: true }, align: { horizontal: 'center' } });
    put('F2', 'AD: 18/09/2020', { font: { size: 10, italic: true }, align: { horizontal: 'center' } });
    put('B5', 'KÍNH GỬI:  ', { font: { size: 10, bold: true } }); put('D5', '- BAN GIÁM ĐỐC', { font: { size: 11, bold: true } });
    put('D6', '- PHÒNG KẾ TOÁN', { font: { size: 11, bold: true } });
    put('B7', 'Tên tôi là: ' + (x.nguoi || ''));
    put('B8', 'Bộ phận công tác: ' + (x.boPhan || ''), { font: { size: 11 } });
    put('B9', 'Xin được thanh toán các hóa đơn chứng từ sau:');
    ['STT', 'Ngày tháng', 'Hóa đơn/Chứng từ', 'Thành tiền', 'Ghi chú'].forEach((t, i) => put('BCDEF'[i] + 10, t, { font: { size: 11, bold: true }, align: { horizontal: 'center', wrapText: true }, border: true }));
    h(10, 22.5);
    const items = (x.items || []).filter(it => it.ngay || it.ct || it.tien || it.gc);
    const list = items.length ? items : [blankItem()];
    let r = 11;
    const cen = { align: { horizontal: 'center', wrapText: true }, border: true };
    list.forEach((it, i) => {
      put('B' + r, items.length ? i + 1 : '', cen);
      put('C' + r, isoToVN(it.ngay), Object.assign({ font: { size: 11 } }, cen));
      put('D' + r, it.ct || '', cen);
      put('E' + r, it.tien ? Number(it.tien) : '', { align: { horizontal: 'right' }, border: true, numFmt: '#,##0' });
      put('F' + r, it.gc || '', { font: { size: 10 }, align: { horizontal: 'left', wrapText: true }, border: true });
      h(r, 30); r++;
    });
    const t = tong(x);
    put('B' + r, '', { border: true });
    put('C' + r, 'Tổng cộng', { font: { size: 14, bold: true, italic: true }, align: { horizontal: 'center' }, border: true }); put('D' + r, '', { border: true }); ws.mergeCells(`C${r}:D${r}`);
    put('E' + r, { formula: `SUM(E11:E${r - 1})`, result: t }, { font: { bold: true }, align: { horizontal: 'right' }, border: true, numFmt: '#,##0' });
    put('F' + r, '', { border: true }); h(r, 29.25); r++;
    put('B' + r, `(Bằng chữ: ${t ? bangChu(t) : ''})`, { font: { italic: true }, align: { wrapText: true } }); ws.mergeCells(`B${r}:F${r}`); h(r, 26.25); r++;
    const ld = 'Lý do thanh toán: ' + (x.lyDo || '');
    put('B' + r, ld, { align: { wrapText: true } }); ws.mergeCells(`B${r}:F${r}`); h(r, Math.max(20, Math.ceil(ld.length / 70) * 18)); r++;
    put('B' + r, 'Hình thức nhận tiền: '); put('D' + r, 'Tiền mặt ' + (x.ht === 'tm' ? '☑' : '☐')); put('E' + r, 'Chuyển khoản ' + (x.ht === 'ck' ? '☑' : '☐')); h(r, 20.25); r++;
    [['- Tên Tài khoản nhận tiền: ', x.tenTK], ['- Số tài khoản: ', x.soTK], ['- Tại Ngân hàng: ', x.nh]].forEach(([l, v]) => {
      put('B' + r, l + (v || ''), { align: { wrapText: true } }); ws.mergeCells(`B${r}:F${r}`); h(r, 21); r++;
    });
    r++;
    const nd = x.ngayLap || today();
    put('D' + r, x.ngayTrong ? `Tp.Hồ Chí Minh, ngày      tháng      năm ${nd.slice(0, 4)}` : `Tp.Hồ Chí Minh, ngày ${nd.slice(8, 10)} tháng ${nd.slice(5, 7)} năm ${nd.slice(0, 4)}`, { font: { italic: true }, align: { horizontal: 'right' } });
    ws.mergeCells(`D${r}:F${r}`); r++;
    const ky = { font: { size: 11, bold: true }, align: { horizontal: 'center' } };
    put('B' + r, 'Người đề nghị', ky); ws.mergeCells(`B${r}:C${r}`); put('D' + r, 'Phụ trách bộ phận', ky); put('E' + r, 'Kế toán trưởng', ky); put('F' + r, 'Thủ trưởng đv', ky);
    r += 6;
    if (x.inTen) { put('B' + r, x.nguoi || '', ky); ws.mergeCells(`B${r}:C${r}`); }
    ws.pageSetup.printArea = `A1:F${r}`;
    return ws;
  }

  // ------------------------------------------------------------ tab Mẫu
  const MF = { mTen: 'ten', mNguoi: 'nguoi', mHT: 'ht', mLyDo: 'lyDo', mTenTK: 'tenTK', mSoTK: 'soTK', mNH: 'nh', mGhiChu: 'ghiChu' };
  let editId = '';
  function fillMauForm(m) { editId = m ? m.id : ''; Object.entries(MF).forEach(([id, k]) => { $(id).value = m ? (m[k] || (k === 'ht' ? 'ck' : '')) : (k === 'ht' ? 'ck' : ''); }); $('mSave').textContent = m ? 'Lưu thay đổi' : 'Lưu mẫu'; }
  $('mClear').addEventListener('click', () => { fillMauForm(null); msg($('mMsg'), ''); });
  $('mSave').addEventListener('click', () => {
    const v = {}; Object.entries(MF).forEach(([id, k]) => { v[k] = k === 'lyDo' ? $(id).value.trim() : clean($(id).value); });
    if (!v.ten) { msg($('mMsg'), 'Nhập tên mẫu.'); return; }
    let m = db.mau.find(x => x.id === editId);
    if (!m) { m = { id: newId() }; db.mau.push(m); }
    Object.assign(m, v, { sua: nowIso() });
    touch(); fillMauForm(null); renderAll();
    msg($('mMsg'), `Đã lưu mẫu <b>${esc(v.ten)}</b>.`, true);
  });
  function renderMau() {
    const q = $('mSearch').value.trim().toLowerCase();
    const list = db.mau.slice().sort((a, b) => a.ten.localeCompare(b.ten, 'vi')).filter(m => !q || (m.ten + ' ' + m.tenTK + ' ' + m.lyDo + ' ' + m.soTK).toLowerCase().includes(q));
    $('mCount').textContent = `${db.mau.length} mẫu`;
    $('mauBody').innerHTML = list.map(m => `<tr><td class="name">${esc(m.ten)}</td><td class="wrap">${esc(m.lyDo)}</td><td class="wrap">${esc(m.tenTK)}</td><td>${esc(m.soTK)}</td><td class="wrap" style="min-width:160px">${esc(m.nh)}</td>
      <td class="r">${m.lastTien ? vnd(m.lastTien) : ''}</td>
      <td class="act"><button class="b pri sm" type="button" data-use="${m.id}">Dùng</button> <button class="b sm" type="button" data-edit="${m.id}">Sửa</button> <button class="b del sm" type="button" data-delm="${m.id}">Xóa</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">Chưa có mẫu. Nạp file Excel ở tab "Nạp file mẫu Excel" hoặc điền form phía trên.</td></tr>';
  }
  $('mSearch').addEventListener('input', renderMau);
  $('mauBody').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.use || b.dataset.edit || b.dataset.delm, m = db.mau.find(x => x.id === id); if (!m) return;
    if (b.dataset.use) { location.hash = '#lap-phieu'; applyMau(m); }
    else if (b.dataset.edit) { fillMauForm(m); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (confirm(`Xóa mẫu "${m.ten}"?`)) { db.mau = db.mau.filter(x => x.id !== id); db.xoa[id] = nowIso(); touch(); renderAll(); }
  });

  // ------------------------------------------------------------ tab Phiếu đã lập
  function renderPhieu() {
    const q = $('pSearch').value.trim().toLowerCase();
    const list = db.phieu.slice().sort((a, b) => (b.ngayLap || '').localeCompare(a.ngayLap || '') || (b.sua || '').localeCompare(a.sua || ''))
      .filter(p => !q || [p.mauTen, p.lyDo, p.tenTK, p.nguoi, ...(p.items || []).map(it => it.ct)].join(' ').toLowerCase().includes(q));
    $('pCount').textContent = `${db.phieu.length} phiếu · tổng ${vnd(list.reduce((s, p) => s + (p.tong || 0), 0))}đ (đang lọc ${list.length})`;
    $('phieuBody').innerHTML = list.map(p => `<tr><td>${esc(isoToVN(p.ngayLap))}</td><td class="name">${esc(p.mauTen)}</td><td class="wrap">${esc(p.lyDo)}</td><td class="wrap">${esc(p.tenTK)}</td>
      <td class="wrap" style="min-width:120px">${esc((p.items || []).map(it => it.ct).filter(Boolean).join(', '))}</td><td class="r money">${vnd(p.tong)}</td>
      <td class="act"><button class="b sm" type="button" data-open="${p.id}" title="Mở để sửa / in lại">Mở</button> <button class="b sm" type="button" data-copy="${p.id}" title="Tạo phiếu mới giống phiếu này">Lập lại</button> <button class="b del sm" type="button" data-delp="${p.id}">Xóa</button></td></tr>`).join('')
      || '<tr><td colspan="7" class="muted">Chưa có phiếu nào. Phiếu tự lưu khi bấm In / Xuất Excel / Lưu phiếu.</td></tr>';
  }
  $('pSearch').addEventListener('input', renderPhieu);
  $('phieuBody').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.open || b.dataset.copy || b.dataset.delp, p = db.phieu.find(x => x.id === id); if (!p) return;
    if (b.dataset.delp) { if (confirm('Xóa phiếu này?')) { db.phieu = db.phieu.filter(x => x.id !== id); db.xoa[id] = nowIso(); touch(); renderAll(); } return; }
    d = Object.assign(newDraft(d), JSON.parse(JSON.stringify(p)));
    if (!d.items.length) d.items.push(blankItem());
    if (b.dataset.copy) { d.id = ''; d.tao = ''; d.ngayLap = today(); d.ky = kyMacDinh(); d.lyDo = doiKy(d.lyDo, d.ky); d.items = d.items.map(it => ({ ngay: '', ct: '', tien: 0, gc: it.gc })); }
    saveDraft(); location.hash = '#lap-phieu'; renderForm();
    msg($('lpMsg'), b.dataset.copy ? 'Đã tạo phiếu mới giống phiếu cũ — điền số HĐ, ngày, số tiền.' : 'Đang mở phiếu đã lưu — sửa xong bấm In / Lưu phiếu để cập nhật.', true);
  });

  // ------------------------------------------------------------ nạp file mẫu Excel (mỗi sheet = 1 mẫu)
  function docSheet(name, ws) {
    if (!ws['!ref']) return null;
    const rg = XLSX.utils.decode_range(ws['!ref']); rg.s.r = 0; rg.s.c = 0; // luôn tính từ A1 (có sheet bắt đầu ở cột B)
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '', range: rg }).slice(0, 40);
    const m = { ten: clean(name) }, after = (s, re) => clean(String(s).replace(re, '').replace(/^\s*:\s*/, ''));
    let hdr = -1;
    rows.forEach((row, r) => {
      for (let c = 0; c < Math.min(row.length, 6); c++) {
        const s = typeof row[c] === 'string' ? row[c] : '';
        if (!s) continue;
        const nextVal = () => { for (let k = c + 1; k < Math.min(row.length, 6); k++) if (clean(row[k])) return clean(row[k]); return ''; };
        if (/^\s*STT\s*$/i.test(s) && hdr < 0) hdr = r;
        else if (/Tên tôi là/i.test(s) && !m.nguoi) m.nguoi = after(s, /^.*?Tên tôi là/i) || nextVal();
        else if (/Bộ phận công tác/i.test(s) && !m.boPhan) m.boPhan = after(s, /^.*?Bộ phận công tác/i) || nextVal();
        else if (/Lý do thanh toán/i.test(s) && m.lyDo === undefined) m.lyDo = after(s, /^.*?Lý do thanh toán/i) || nextVal();
        else if (/Tên Tài khoản/i.test(s) && m.tenTK === undefined) m.tenTK = after(s, /^.*?Tên Tài khoản\s*(nhận tiền)?/i) || nextVal();
        else if (/Số tài khoản/i.test(s) && m.soTK === undefined) m.soTK = after(s, /^.*?Số tài khoản/i) || nextVal();
        else if (/Ngân hàng\s*:/i.test(s) && m.nh === undefined) m.nh = after(s, /^.*?Ngân hàng\s*:/i).replace(/^tại\s+/i, '') || nextVal();
        else if (/Bằng chữ/i.test(s) || /Tổng cộng/i.test(s)) {/* bỏ */}
      }
    });
    const items = [];
    if (hdr >= 0) for (let r = hdr + 1; r < rows.length; r++) {
      const row = rows[r]; if (typeof row[1] !== 'number') break;
      items.push({ ngay: vnToIso(row[2]), ct: clean(row[3]), tien: parseMoney(row[4]), gc: clean(row[5]) });
    }
    ['lyDo', 'tenTK', 'soTK', 'nh'].forEach(k => { m[k] = m[k] || ''; });
    m.ht = 'ck';
    m.ghiChu = '';
    const t = items.reduce((s, it) => s + it.tien, 0);
    if (t) { m.lastTien = t; m.lastCt = items.map(it => it.ct).filter(Boolean).join(', '); m.lastNgay = (items[0] || {}).ngay || ''; }
    const pre = (items.find(it => it.ct) || {}).ct;
    if (pre) { const mm = pre.match(/^(.*?[:\s])\s*[\w.\-]*\d[\w.\-]*\s*$/); if (mm) m.ctPrefix = mm[1].trimEnd() + ' '; }
    return (m.lyDo || m.tenTK || m.soTK) ? m : null;
  }
  async function napFile(file) {
    msg($('napMsg'), '');
    if (!window.XLSX) { msg($('napMsg'), 'Chưa tải được thư viện Excel — kiểm tra mạng rồi thử lại.'); return; }
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      let moi = 0, cn = 0; const bo = [];
      wb.SheetNames.forEach(sn => {
        const m = docSheet(sn, wb.Sheets[sn]);
        if (!m) { bo.push(sn); return; }
        const old = db.mau.find(x => x.ten.toLowerCase() === m.ten.toLowerCase());
        if (old) { Object.assign(old, m, { sua: nowIso() }); cn++; } else { db.mau.push(Object.assign({ id: newId(), sua: nowIso() }, m)); moi++; }
      });
      touch(); renderAll();
      msg($('napMsg'), `Đã nạp <b>${moi}</b> mẫu mới, cập nhật <b>${cn}</b> mẫu từ "${esc(file.name)}".${bo.length ? ' Bỏ qua sheet không đúng mẫu: ' + bo.map(esc).join(', ') + '.' : ''} Vào tab <a href="#mau">Mẫu đơn vị nhận tiền</a> để xem/sửa tên mẫu cho dễ nhớ.`, true);
    } catch (e) { msg($('napMsg'), 'Không đọc được file: ' + esc(e.message)); }
  }
  const zone = $('zone'), fin = $('fileMau');
  zone.addEventListener('click', () => fin.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fin.click(); } });
  fin.addEventListener('change', () => { if (fin.files[0]) napFile(fin.files[0]); fin.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) napFile(f); });

  // ------------------------------------------------------------ CHẾ ĐỘ CÔNG ĐOÀN (mẫu BM-03/HC-CPC1HN)
  // Mức chi mặc định = cột "Đề xuất điều chỉnh từ 1/1/2026" của file "Chế độ bổ sung Công đoàn-ĐX 1.1.2026.xlsx"
  const MUC_CHI_GOC = [
    { id: 'om-noi-tru', nhom: 'Thăm hỏi', ten: 'CBNV ốm đau – nằm viện nội trú', lyDo: 'CBNV ốm đau phải nằm viện điều trị nội trú.', cty: 700000, cd: 300000, gc: '' },
    { id: 'om-thu-thuat', nhom: 'Thăm hỏi', ten: 'CBNV ốm đau – làm thủ thuật, không nội trú', lyDo: 'CBNV ốm đau, có làm thủ thuật tại bệnh viện, không nằm nội trú.', cty: 300000, cd: 200000, gc: '' },
    { id: 'nguoi-than-om', nhom: 'Thăm hỏi', ten: 'Người thân CBNV ốm đau – nằm viện nội trú', lyDo: 'Người thân CBNV ốm đau, phải nằm viện điều trị nội trú.', cty: 300000, cd: 200000, gc: 'Tứ thân phụ mẫu 2 bên, chồng/vợ, con đẻ' },
    { id: 'ket-hon', nhom: 'Thăm hỏi', ten: 'CBNV kết hôn', lyDo: 'CBNV đăng ký kết hôn.', cty: 1000000, cd: 500000, gc: '' },
    { id: 'sinh-con', nhom: 'Thăm hỏi', ten: 'CBNV sinh con', lyDo: 'Gia đình CBNV có thành viên mới (sinh con).', cty: 0, cd: 0, gc: 'Combo quà tặng sản phẩm Công ty' },
    { id: 'dam-hieu', nhom: 'Thăm hỏi', ten: 'Đám hiếu (tứ thân phụ mẫu, chồng/vợ, con)', lyDo: 'Tứ thân phụ mẫu, chồng/vợ, con của CBNV qua đời.', cty: 1000000, cd: 500000, gc: 'Đã bao gồm vòng hoa viếng' },
    { id: 'trung-thu', nhom: 'Sự kiện', ten: 'Quà Trung Thu (con 0–18 tuổi)', lyDo: 'Quà Trung Thu cho con CBNV (0–18 tuổi).', cty: 200000, cd: 150000, gc: '' },
    { id: 'quoc-te-thieu-nhi', nhom: 'Sự kiện', ten: 'Quà 1/6 (con 0–15 tuổi)', lyDo: 'Quà 1/6 cho con CBNV (0–15 tuổi).', cty: 150000, cd: 100000, gc: 'Cả bố và mẹ cùng làm Công ty: 200.000' },
    { id: 'sinh-nhat', nhom: 'Sự kiện', ten: 'Quà sinh nhật', lyDo: 'Quà sinh nhật CBNV.', cty: 200000, cd: 0, gc: 'Quỹ CĐ: quà tặng' },
    { id: 'hs-tien-tien', nhom: 'Sự kiện', ten: 'Con CBNV – học sinh tiên tiến', lyDo: 'Quà cho con CBNV đạt danh hiệu học sinh tiên tiến.', cty: 200000, cd: 0, gc: 'Các con từ lớp 1 đến lớp 12' },
    { id: 'hs-gioi', nhom: 'Sự kiện', ten: 'Con CBNV – học sinh giỏi/xuất sắc', lyDo: 'Quà cho con CBNV đạt danh hiệu học sinh giỏi/xuất sắc.', cty: 300000, cd: 0, gc: 'Các con từ lớp 1 đến lớp 12' },
    { id: 'do-dh', nhom: 'Sự kiện', ten: 'Con CBNV – đỗ Đại học/THPT công lập', lyDo: 'Quà cho con CBNV đỗ Đại học/THPT công lập.', cty: 500000, cd: 0, gc: '' },
    { id: 'khac', nhom: 'Khác', ten: 'Khác (nhập tay)', lyDo: '', cty: 0, cd: 0, gc: '' },
  ];
  const mucChi = () => (db.cfg && Array.isArray(db.cfg.mucChi) && db.cfg.mucChi.length) ? db.cfg.mucChi : MUC_CHI_GOC;
  const cheDo = id => mucChi().find(x => x.id === id);
  const LS_CD = 'kvh-dntt-cd-draft';
  const blankRow = () => ({ ten: '', ma: '', cheDo: '', tien: 0, lyDo: '', nguoiThan: '', laGi: '', quanHe: '', gc: '', soTK: '', nh: '' });
  // bộ hồ sơ: inTT = Giấy ĐN thanh toán (A5) · inBM03 = Giấy ĐN hỗ trợ theo chế độ (1 tờ/NV) · inPT = Phiếu trình V/v thăm hỏi (1 tờ)
  const newCd = keep => ({ id: '', inTT: keep ? keep.inTT !== false : true, inBM03: keep ? keep.inBM03 !== false : true, inPT: keep ? keep.inPT !== false : true,
    boPhan: keep ? keep.boPhan : 'Bộ phận Hành chính HCM', donVi: keep ? keep.donVi : 'HÀNH CHÍNH CN HCM', noiKy: keep ? keep.noiKy : 'Hà Nội',
    ngayLap: today(), ngayTrong: keep ? keep.ngayTrong : true, dienCD: keep ? keep.dienCD : false,
    vv: '', vvTay: false, yk: '', ykTay: false, dienGiai: '', nguoiDN: keep ? keep.nguoiDN || '' : '', nguoiTT: keep && keep.nguoiTT ? keep.nguoiTT : 'Phạm Thị Nhung', giamDoc: keep && keep.giamDoc !== undefined ? keep.giamDoc : 'Phương Thu',
    rows: [blankRow()] });
  let c = null; try { c = JSON.parse(localStorage.getItem(LS_CD) || 'null'); } catch (e) {}
  c = (!c || !Array.isArray(c.rows)) ? newCd() : Object.assign(newCd(), c);
  let cdPv = 0;
  const saveCd = () => { try { localStorage.setItem(LS_CD, JSON.stringify(c)); } catch (e) {} };
  const cdRows = x => (x.rows || []).filter(r => r.ten || r.ma || r.tien);

  // danh sách NV gợi ý: roster mới nhất ở trang KPIs + các đề nghị trước
  function nvGoiY() {
    const m = {};
    try {
      const a = JSON.parse(localStorage.getItem('kvh-kpi-v1') || '{}');
      const k = Object.keys(a).sort().reverse()[0];
      ((k && a[k].roster) || []).forEach(e => { if (e.ten) m[(e.ma || e.ten)] = { ma: String(e.ma || ''), ten: e.ten }; });
    } catch (e) {}
    (db.cd || []).slice().sort((a, b) => (a.sua || '').localeCompare(b.sua || '')).forEach(x => (x.rows || []).forEach(r => {
      if (!r.ten) return; const o = m[r.ma || r.ten] || {};
      m[r.ma || r.ten] = { ma: r.ma || o.ma || '', ten: r.ten, soTK: r.soTK || o.soTK || '', nh: r.nh || o.nh || '' };
    }));
    return Object.values(m).sort((a, b) => a.ten.localeCompare(b.ten, 'vi'));
  }

  const DOTS = '…'.repeat(120);
  function cdHtml(x, r) {
    const nd = x.ngayLap || today();
    const ngay = x.ngayTrong ? `${esc(x.noiKy)}, ngày&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;tháng&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;năm ${nd.slice(0, 4)}` : `${esc(x.noiKy)}, ngày ${nd.slice(8, 10)} tháng ${nd.slice(5, 7)} năm ${nd.slice(0, 4)}`;
    const cdTien = (cheDo(r.cheDo) || {}).cd || 0;
    const dl = t => `<div class="p" style="overflow:hidden;white-space:nowrap">${t}${DOTS}</div>`;
    return `<div class="cdp">
      <div class="ma">BM - 03/HC-CPC1HN<br>AD: 01/08/2015</div>
      <div class="top"><img src="../assets/logo.svg?v=2" alt="CPC1HN">
        <div class="cty">CÔNG TY CỔ PHẦN<br>DƯỢC PHẨM CPC1 HÀ NỘI<b>${esc(x.donVi)}</b></div>
        <div class="qh">CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM<br><span>Độc lập - Tự do - Hạnh phúc</span></div></div>
      <h1>GIẤY ĐỀ NGHỊ</h1><h2>HỖ TRỢ THEO CHẾ ĐỘ</h2>
      <div class="mt">I/ Ý kiến của BP đề xuất:</div>
      <div class="p in1">${esc(x.boPhan)} đề nghị Giám đốc xét duyệt hỗ trợ theo chế độ cho CBCNV:</div>
      <div class="p in2">- Họ tên: ${esc(r.ten)} - Mã NV: ${esc(r.ma)}</div>
      <div class="p in2">- Số tiền hỗ trợ theo chế độ công ty: <b>${r.tien ? vnd(r.tien) + ' VNĐ' : ''}</b></div>
      <div class="p in2 it">Số tiền bằng chữ: ${r.tien ? esc(bangChu(r.tien)) + './.' : ''}</div>
      <div class="p in2 it">Lý do: ${esc(r.lyDo)}</div>
      <div class="ky2"><div>TM BCH CÔNG ĐOÀN BỘ PHẬN</div><div>PHỤ TRÁCH BỘ PHẬN</div></div>
      <div class="mt">II/ Ý kiến Công đoàn cơ sở :</div>
      ${dl('- Xác nhận: ')}${dl('')}
      <div class="p">- Đề nghị hỗ trợ theo chế độ: ${x.dienCD && cdTien ? vnd(cdTien) : '…………..…'} đồng</div>
      <div class="kyr">TM BCH CÔNG ĐOÀN CƠ SỞ</div>
      <div class="mt">III/ Xét duyệt của Giám đốc:</div>
      <div class="p">- Quyết định hỗ trợ cho CBCNV:</div>${dl('')}
      <div class="p">- Số tiền: ………………đồng.</div>
      <div class="p in1 it" style="overflow:hidden;white-space:nowrap">Bằng chữ:&nbsp; ${DOTS}</div>
      <div class="ngay">${ngay}</div><div class="tgd">TỔNG GIÁM ĐỐC</div>
    </div>`;
  }
  // ---- Phiếu trình V/v thăm hỏi
  const XUNG = ['Ông', 'Bà', 'Anh', 'Chị', 'Em', 'Cháu', 'Cô', 'Chú', 'Bác', 'Cụ'];
  // "Người thân là" (quan hệ của người thân với NV) -> NV là gì của người thân (dùng trong bảng phiếu trình)
  const NGUOC = { 'con': 'Bố/Mẹ', 'con trai': 'Bố/Mẹ', 'con gái': 'Bố/Mẹ', 'bố': 'Con', 'mẹ': 'Con', 'cha': 'Con', 'bố vợ': 'Con rể', 'mẹ vợ': 'Con rể',
    'bố chồng': 'Con dâu', 'mẹ chồng': 'Con dâu', 'vợ': 'Chồng', 'chồng': 'Vợ' };
  const boXung = s => { const w = clean(s).split(' '); return XUNG.some(t => t.toLowerCase() === (w[0] || '').toLowerCase()) ? w.slice(1).join(' ') : clean(s); };
  const capHoa = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  function noiDungPt(r) {
    const nv = `${r.ten}${r.ma ? ' – Mã NV ' + r.ma : ''}`;
    if (!clean(r.nguoiThan)) return nv;
    const w = clean(r.nguoiThan).split(' '), x = XUNG.find(t => t.toLowerCase() === (w[0] || '').toLowerCase());
    const ten = x ? `${x} : ${w.slice(1).join(' ')}` : clean(r.nguoiThan);
    const nvLa = clean(r.quanHe) || NGUOC[clean(r.laGi).toLowerCase()] || 'Người thân';
    return `${ten} (${capHoa(nvLa)} : ${nv})`;
  }
  // "(con Lê Phúc Khang)" chèn vào lý do phiếu thanh toán
  const ngoacNguoiThan = r => clean(r.nguoiThan) ? ` (${clean(r.laGi) ? clean(r.laGi).toLowerCase() + ' ' : ''}${boXung(r.nguoiThan)})` : '';
  function autoPt() {
    const rows = cdRows(c);
    if (!c.vvTay) {
      const chuDe = [...new Set(rows.map(r => ((cheDo(r.cheDo) || {}).ten || '').split(' – ')[0].split(' (')[0]).filter(Boolean))];
      c.vv = 'V/v thăm hỏi ' + (chuDe.length ? chuDe.join(', ') : 'CBNV') + ' CN HCM';
    }
    if (!c.ykTay) {
      const ai = rows.map(r => clean(r.nguoiThan) ? `người thân${clean(r.laGi) ? ' (' + capHoa(clean(r.laGi)) + ')' : ''} CBNV ${r.ten} là ${clean(r.nguoiThan)}` : `CBNV ${r.ten}`);
      c.yk = `Thăm hỏi động viên tinh thần ${ai.join('; ') || 'CBNV'}${clean(c.dienGiai) ? ' ' + clean(c.dienGiai) : ''}, chuyên viên kính đề nghị Ban Lãnh Đạo và Phòng Kế Toán duyệt chi cho việc như sau:`;
    }
    ['cVv', 'cYk'].forEach(id => { if (document.activeElement !== $(id)) $(id).value = c[id === 'cVv' ? 'vv' : 'yk'] || ''; });
  }
  function ptHtml(x) {
    const rows = cdRows(x), list = rows.length ? rows : [blankRow()];
    const t = rows.reduce((s, r) => s + (r.tien || 0), 0);
    const nd = x.ngayLap || today(), nam = nd.slice(0, 4);
    const ngay = x.ngayTrong ? `TP.HCM, ngày&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;tháng&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;năm ${nam}` : `TP.HCM, ngày ${nd.slice(8, 10)} tháng ${nd.slice(5, 7)} năm ${nam}`;
    const dl = () => `<div class="dl">${'.'.repeat(400)}</div>`;
    const ngay2 = `<div class="ngay2">Tp. HCM, ngày&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;tháng&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;năm&nbsp; ${nam}</div>`;
    return `<div class="ptp">
      <div class="top"><img src="../assets/logo.svg?v=2" alt="CPC1HN">
        <div class="cty">CÔNG TY CỔ PHẦN<br><span>DƯỢC PHẨM CPC1 HÀ NỘI</span></div>
        <div class="qh">CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM<br><span>Độc lập – Tự do – Hạnh phúc</span></div></div>
      <h1>PHIẾU TRÌNH</h1><h2><span>${esc(x.vv)}</span></h2>
      <div class="kg"><i>Kính gửi:</i><div>- BAN LÃNH ĐẠO CÔNG TY<br>- PHÒNG KẾ TOÁN</div></div>
      <div class="mt n1"><span>1.</span><span>Ý kiến của chuyên viên:</span></div>
      <div class="p in1">${esc(x.yk)}</div>
      <table><colgroup><col style="width:11%"><col style="width:37%"><col style="width:24%"><col style="width:28%"></colgroup>
        <thead><tr><th>STT</th><th>Nội dung</th><th>Đồng</th><th>Ghi chú</th></tr></thead>
        <tbody>${list.map((r, i) => `<tr><td>${rows.length ? i + 1 : ''}</td><td class="nd">${esc(r.ten || r.nguoiThan ? noiDungPt(r) : '')}</td><td>${r.tien ? vnd(r.tien) : ''}</td><td>${esc(r.gc || '')}</td></tr>`).join('')}
        <tr class="tong"><td></td><td>Tổng cộng</td><td>${t ? vnd(t) : ''}</td><td></td></tr></tbody></table>
      <div class="bc">(Bằng chữ: ${t ? esc(bangChu(t)) + './' : ''})</div>
      <div class="km">Kính mong Ban Lãnh Đạo, Phòng Kế Toán xem xét, phê duyệt!</div>
      <div class="ngay">${ngay}</div>
      <div class="ky"><div>Người đề Nghị</div><div>Giám đốc</div></div>
      <div class="ten"><div>${esc(x.nguoiDN)}</div><div>${esc(x.giamDoc)}</div></div>
      <div class="mt">2. Ý kiến của Ban Lãnh Đạo:</div>${dl()}${dl()}${dl()}${ngay2}
      <div class="mt" style="margin-top:8mm">3. Ý kiến của Phòng Kế Toán:</div>${dl()}${dl()}${dl()}${ngay2}
    </div>`;
  }
  // Giấy đề nghị thanh toán gộp các khoản Công đoàn (người đề nghị ứng tiền rồi xin thanh toán)
  // Giấy đề nghị thanh toán cho 1 NV: người đề nghị = bên Công đoàn (nguoiTT), người nhận tiền = NV được hỗ trợ
  function buildTT(x, r) {
    r = r || blankRow();
    const m = cheDo(r.cheDo) || {};
    const t = newDraft(d);
    return Object.assign(t, {
      id: r.ttId || '', mauTen: 'Công đoàn' + (r.ten ? ' – ' + r.ten : ''), nguoi: clean(x.nguoiTT) || 'Phạm Thị Nhung', boPhan: d.boPhan || t.boPhan,
      ht: 'ck', ngayLap: x.ngayLap || today(), ngayTrong: x.ngayTrong,
      lyDo: m.nhom === 'Sự kiện' ? `Chi tiền ${(m.ten || 'hỗ trợ chế độ').charAt(0).toLowerCase() + (m.ten || 'hỗ trợ chế độ').slice(1)}_CN.HCM`
        : `Chi tiền thăm hỏi nhân viên${m.ten ? ' – ' + (m.ten.includes(' – ') ? m.ten.replace(' – ', ngoacNguoiThan(r) + ' – ') : m.ten + ngoacNguoiThan(r)) : ngoacNguoiThan(r)}_CN.HCM`,
      tenTK: r.ten || '', soTK: clean(r.soTK), nh: clean(r.nh),
      items: [{ ngay: x.ngayLap || today(), ct: 'Giấy ĐN hỗ trợ', tien: r.tien || 0, gc: r.ten ? `${r.ten}${r.ma ? ' – Mã NV ' + r.ma : ''}` : '' }],
    });
  }
  // bộ hồ sơ in: 1 ĐN thanh toán · 2 Giấy ĐN hỗ trợ (mỗi NV 1 tờ) · 3 Phiếu trình
  function cdBundle(x) {
    const rows = cdRows(x), list = rows.length ? rows : [blankRow()], pages = [];
    if (x.inTT) list.forEach(r => { const t = buildTT(x, r); pages.push({ ten: `1. Giấy ĐN thanh toán – ${r.ten || '(chưa có tên)'}`, kho: t.kho === 'A4' ? 'A4' : 'A5', html: phieuHtml(t).replace('class="phieu', `class="phieu${t.kho === 'A4' ? '' : ' p5'}`) }); });
    if (x.inBM03) list.forEach(r => pages.push({ ten: `2. Giấy ĐN hỗ trợ – ${r.ten || '(chưa có tên)'}`, kho: 'A4', html: cdHtml(x, r) }));
    if (x.inPT) pages.push({ ten: '3. Phiếu trình', kho: 'A4', html: ptHtml(x) });
    return pages;
  }
  function renderCdPreview() {
    const pages = cdBundle(c);
    if (cdPv >= pages.length) cdPv = 0;
    $('cdPvSel').innerHTML = pages.map((p, i) => `<option value="${i}"${i === cdPv ? ' selected' : ''}>${esc(p.ten)}</option>`).join('') || '<option>(chưa chọn tờ nào)</option>';
    $('cdPvKho').textContent = pages[cdPv] ? `Khổ ${pages[cdPv].kho} · bộ ${pages.length} tờ` : '';
    const pv = $('cdPv'); pv.innerHTML = pages[cdPv] ? pages[cdPv].html : '<div class="cdp"></div>';
    const el = pv.firstElementChild, w = el.offsetWidth, h = el.offsetHeight, sc = w > 560 ? 560 / w : 1;
    el.style.transformOrigin = 'top left'; el.style.transform = sc < 1 ? `scale(${sc})` : '';
    $('cdPaper').style.width = Math.round(w * sc) + 'px'; $('cdPaper').style.height = Math.round(h * sc) + 'px';
  }
  $('cdPvSel').addEventListener('change', e => { cdPv = +e.target.value; renderCdPreview(); });
  const CF = { cBoPhan: 'boPhan', cDonVi: 'donVi', cNoiKy: 'noiKy', cNgay: 'ngayLap', cDienGiai: 'dienGiai', cNguoiDN: 'nguoiDN', cNguoiTT: 'nguoiTT', cGiamDoc: 'giamDoc' };
  function renderCd() {
    Object.entries(CF).forEach(([id, k]) => { if (document.activeElement !== $(id)) $(id).value = c[k] || ''; });
    $('cNgayTrong').checked = !!c.ngayTrong; $('cDienCD').checked = !!c.dienCD;
    const pane = document.querySelector('[data-pane="cong-doan"]');
    pane.dataset.bm03 = c.inBM03 ? '1' : '0'; pane.dataset.pt = c.inPT ? '1' : '0';
    pane.dataset.tt = c.inTT ? '1' : '0'; pane.dataset.nt = c.inTT || c.inPT ? '1' : '0';
    $('inTT').checked = !!c.inTT; $('inBM03').checked = !!c.inBM03; $('inPT').checked = !!c.inPT;
    autoPt();
    const opts = sel => mucChi().map(m => `<option value="${esc(m.id)}"${m.id === sel ? ' selected' : ''}>${esc(m.ten)}${m.cty ? ' — ' + vnd(m.cty) : ''}</option>`).join('');
    $('cdBody').innerHTML = c.rows.map((r, i) => `<tr data-i="${i}"><td class="stt">${i + 1}</td>
      <td><input data-k="ten" list="nvList" value="${esc(r.ten)}" placeholder="Họ tên"></td>
      <td><input data-k="ma" list="maList" value="${esc(r.ma)}" placeholder="Mã NV"></td>
      <td class="only-nt"><input data-k="nguoiThan" value="${esc(r.nguoiThan)}" placeholder="vd: Lê Phúc Khang"></td>
      <td class="only-nt"><input data-k="laGi" list="laGiList" value="${esc(r.laGi)}" placeholder="con / bố / mẹ…"></td>
      <td><select data-k="cheDo"><option value="">— chọn chế độ —</option>${opts(r.cheDo)}</select></td>
      <td><input class="money" data-k="tien" inputmode="numeric" value="${r.tien ? vnd(r.tien) : ''}"></td>
      <td class="only-tt"><input data-k="soTK" inputmode="numeric" value="${esc(r.soTK)}" placeholder="Số tài khoản"></td>
      <td class="only-tt"><input data-k="nh" value="${esc(r.nh)}" placeholder="vd: ACB"></td>
      <td class="only-bm03"><input data-k="lyDo" value="${esc(r.lyDo)}"></td>
      <td class="only-pt"><input data-k="gc" value="${esc(r.gc)}"></td>
      <td class="x"><button type="button" data-del="${i}" title="Xóa dòng">×</button></td></tr>`).join('');
    const nv = nvGoiY();
    if (!$('laGiList')) { const dl = document.createElement('datalist'); dl.id = 'laGiList'; dl.innerHTML = Object.keys(NGUOC).map(k => `<option value="${k}">`).join(''); document.body.appendChild(dl); }
    $('nvList').innerHTML = nv.map(e => `<option value="${esc(e.ten)}">${esc(e.ma)}</option>`).join('');
    $('maList').innerHTML = nv.filter(e => e.ma).map(e => `<option value="${esc(e.ma)}">${esc(e.ten)}</option>`).join('');
    renderCdTong(); renderCdHist(); renderCdPreview();
  }
  function renderCdTong() { const t = cdRows(c).reduce((s, r) => s + (r.tien || 0), 0); $('cdTong').innerHTML = t ? `<b>${vnd(t)}</b>` : ''; }
  function cdChanged() { autoPt(); saveCd(); renderCdTong(); renderCdPreview(); }
  Object.entries(CF).forEach(([id, k]) => $(id).addEventListener('input', () => { c[k] = $(id).value; cdChanged(); }));
  [['inTT', 'inTT'], ['inBM03', 'inBM03'], ['inPT', 'inPT']].forEach(([id, k]) => $(id).addEventListener('change', e => { c[k] = e.target.checked; cdPv = 0; saveCd(); renderCd(); }));
  $('cVv').addEventListener('input', e => { c.vv = e.target.value; c.vvTay = true; cdChanged(); });
  $('cYk').addEventListener('input', e => { c.yk = e.target.value; c.ykTay = true; cdChanged(); });
  $('cYkLai').addEventListener('click', () => { c.vvTay = false; c.ykTay = false; $('cVv').blur(); $('cYk').blur(); cdChanged(); });
  $('cNgayTrong').addEventListener('change', e => { c.ngayTrong = e.target.checked; cdChanged(); });
  $('cDienCD').addEventListener('change', e => { c.dienCD = e.target.checked; cdChanged(); });
  function cdEdit(e) {
    const tr = e.target.closest('tr'), k = e.target.dataset.k; if (!tr || !k) return;
    const i = +tr.dataset.i, r = c.rows[i];
    if (k === 'tien') r.tien = parseMoney(e.target.value);
    else if (k === 'cheDo') {
      r.cheDo = e.target.value; const m = cheDo(r.cheDo);
      if (m) { r.tien = m.cty || 0; r.lyDo = m.lyDo || ''; tr.querySelector('[data-k=tien]').value = r.tien ? vnd(r.tien) : ''; tr.querySelector('[data-k=lyDo]').value = r.lyDo; }
    } else {
      r[k] = e.target.value;
      if (k === 'ten' || k === 'ma') { // khớp tên <-> mã
        const nv = nvGoiY().find(x => k === 'ten' ? x.ten === r.ten : x.ma === r.ma);
        if (nv) {
          const o = k === 'ten' ? 'ma' : 'ten'; if (!r[o]) { r[o] = nv[o]; tr.querySelector(`[data-k=${o}]`).value = nv[o]; }
          ['soTK', 'nh'].forEach(f => { if (!r[f] && nv[f]) { r[f] = nv[f]; tr.querySelector(`[data-k=${f}]`).value = nv[f]; } });
        }
      }
    }
    cdPv = i; cdChanged();
  }
  $('cdBody').addEventListener('input', e => { if (e.target.tagName !== 'SELECT') cdEdit(e); });
  $('cdBody').addEventListener('change', e => { if (e.target.tagName === 'SELECT') cdEdit(e); });
  $('cdBody').addEventListener('focusout', e => { if (e.target.dataset.k === 'tien') { const v = parseMoney(e.target.value); e.target.value = v ? vnd(v) : ''; } });
  $('cdBody').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; c.rows.splice(+b.dataset.del, 1); if (!c.rows.length) c.rows.push(blankRow()); saveCd(); renderCd(); });
  $('cdAdd').addEventListener('click', () => {
    const last = c.rows[c.rows.length - 1], r = blankRow();
    if (last && last.cheDo) { r.cheDo = last.cheDo; r.tien = last.tien; r.lyDo = last.lyDo; }
    c.rows.push(r); saveCd(); renderCd();
    const ins = $('cdBody').querySelectorAll('tr:last-child input'); if (ins[0]) ins[0].focus();
  });
  $('cdNew').addEventListener('click', () => { c = newCd(c); cdPv = 0; saveCd(); renderCd(); msg($('cdMsg'), ''); });
  function luuCd() {
    const rows = cdRows(c); if (!rows.length) return null;
    if (!c.id) c.id = newId();
    const rec = JSON.parse(JSON.stringify(c)); rec.rows = rows; rec.tong = rows.reduce((s, r) => s + (r.tien || 0), 0); rec.sua = nowIso();
    const i = db.cd.findIndex(x => x.id === rec.id); if (i >= 0) db.cd[i] = rec; else db.cd.push(rec);
    saveCd(); touch(); renderCdHist();
    return rec;
  }
  $('cdSave').addEventListener('click', () => { const r = luuCd(); msg($('cdMsg'), r ? 'Đã lưu đề nghị.' : 'Chưa có nhân viên nào.', !!r); });
  $('cdPrint').addEventListener('click', () => {
    const rows = cdRows(c);
    if (!rows.length) { msg($('cdMsg'), 'Chưa có nhân viên nào.'); return; }
    if (!c.inTT && !c.inBM03 && !c.inPT) { msg($('cdMsg'), 'Chưa tích tờ nào để in.'); return; }
    const loi = [];
    const thieu = rows.filter(r => !r.ten || !r.tien || (c.inBM03 && !r.lyDo));
    if (thieu.length) loi.push(`${thieu.length} dòng còn thiếu tên / số tiền${c.inBM03 ? ' / lý do' : ''}`);
    if (c.inTT) { const k = rows.filter(r => !clean(r.soTK) || !clean(r.nh)); if (k.length) loi.push(`${k.map(r => r.ten || '?').join(', ')} chưa có số tài khoản / ngân hàng (cột "Số TK của NV")`); }
    if (loi.length && !confirm(loi.join('\n') + '.\nVẫn in?')) return;
    luuCd();
    if (c.inTT) { // lưu luôn các phiếu thanh toán (mỗi NV 1 phiếu) vào "Phiếu đã lập"
      c.rows.filter(r => r.tien).forEach(r => {
        if (!r.ttId) r.ttId = newId();
        const t = buildTT(c, r); t.tong = tong(t); t.sua = nowIso();
        const i = db.phieu.findIndex(p => p.id === t.id); if (i >= 0) { t.tao = db.phieu[i].tao; db.phieu[i] = t; } else { t.tao = t.sua; db.phieu.push(t); }
      });
      luuCd(); renderLists();
    }
    const pages = cdBundle(c);
    inTrang(pages.map(p => p.html), '@page { size: A4 portrait; margin: 8mm 0 8mm 0; } @page pA5 { size: A5 portrait; margin: 6mm; }');
    msg($('cdMsg'), `Đã gửi lệnh in ${pages.length} tờ (${pages.map(p => p.ten.split(' – ')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')}) và lưu hồ sơ.`, true);
  });
  // gộp các khoản thành 1 Giấy đề nghị thanh toán (người đề nghị ứng tiền rồi xin thanh toán)
  $('cdToTT').addEventListener('click', () => {
    const rows = cdRows(c).filter(r => r.tien);
    if (!rows.length) { msg($('cdMsg'), 'Chưa có khoản nào có số tiền.'); return; }
    luuCd();
    const pages = cdBundle(c), cur = pages[cdPv] && pages[cdPv].ten.split(' – ')[1];
    const r = rows.find(x => x.ten === cur) || rows[0];
    d = buildTT(c, r);
    saveDraft(); location.hash = '#lap-phieu'; renderForm();
    msg($('lpMsg'), `Đang sửa phiếu thanh toán của <b>${esc(r.ten)}</b>${rows.length > 1 ? ` (1 trong ${rows.length} nhân viên — chọn tờ ở ô Xem trước bên Công đoàn để mở phiếu NV khác)` : ''}.`, true);
  });
  function renderCdHist() {
    const list = (db.cd || []).slice().sort((a, b) => (b.ngayLap || '').localeCompare(a.ngayLap || '') || (b.sua || '').localeCompare(a.sua || ''));
    $('cdHist').innerHTML = list.map(x => `<tr><td>${esc(isoToVN(x.ngayLap))}</td><td class="wrap">${x.rows.map(r => esc(r.ten) + (r.ma ? ` <span class="muted">${esc(r.ma)}</span>` : '')).join('<br>')}</td>
      <td class="wrap">${x.rows.map(r => esc((cheDo(r.cheDo) || {}).ten || r.lyDo)).join('<br>')}</td><td class="r money">${vnd(x.tong)}</td>
      <td class="act"><button class="b sm" type="button" data-cdopen="${x.id}">Mở</button> <button class="b del sm" type="button" data-cddel="${x.id}">Xóa</button></td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">Chưa có đề nghị nào.</td></tr>';
  }
  $('cdHist').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.cdopen || b.dataset.cddel, x = db.cd.find(y => y.id === id); if (!x) return;
    if (b.dataset.cddel) { if (confirm('Xóa đề nghị này?')) { db.cd = db.cd.filter(y => y.id !== id); db.xoa[id] = nowIso(); touch(); renderCdHist(); } return; }
    c = Object.assign(newCd(c), JSON.parse(JSON.stringify(x))); cdPv = 0; saveCd(); renderCd();
    msg($('cdMsg'), 'Đang mở đề nghị đã lưu — sửa xong bấm In / Lưu để cập nhật.', true);
  });

  // bảng mức chi Công đoàn (sửa trực tiếp, lưu chung dữ liệu)
  function setMucChi(list) { db.cfg = { mucChi: list, sua: nowIso() }; touch(); }
  function renderMc() {
    $('mcBody').innerHTML = mucChi().map((m, i) => `<tr data-i="${i}">
      <td><input class="cell" data-k="nhom" value="${esc(m.nhom)}" style="width:90px"></td>
      <td><input class="cell" data-k="ten" value="${esc(m.ten)}" style="min-width:230px"></td>
      <td><input class="cell" data-k="lyDo" value="${esc(m.lyDo)}" style="min-width:300px"></td>
      <td class="r"><input class="cell r" data-k="cty" value="${m.cty ? vnd(m.cty) : ''}"></td>
      <td class="r"><input class="cell r" data-k="cd" value="${m.cd ? vnd(m.cd) : ''}"></td>
      <td><input class="cell" data-k="gc" value="${esc(m.gc)}" style="min-width:200px"></td>
      <td class="act"><button class="b del sm" type="button" data-mcdel="${i}">Xóa</button></td></tr>`).join('');
  }
  $('mcBody').addEventListener('change', e => {
    const tr = e.target.closest('tr'), k = e.target.dataset.k; if (!tr || !k) return;
    const list = JSON.parse(JSON.stringify(mucChi())), m = list[+tr.dataset.i];
    m[k] = (k === 'cty' || k === 'cd') ? parseMoney(e.target.value) : e.target.value.trim();
    setMucChi(list); renderMc(); renderCd();
    $('mcMsg').innerHTML = '<span class="tk-banner">Đã lưu</span>';
  });
  $('mcBody').addEventListener('click', e => {
    const b = e.target.closest('[data-mcdel]'); if (!b) return;
    const list = JSON.parse(JSON.stringify(mucChi())), m = list[+b.dataset.mcdel];
    if (!confirm(`Xóa chế độ "${m.ten}"?`)) return;
    list.splice(+b.dataset.mcdel, 1); setMucChi(list); renderMc(); renderCd();
  });
  $('mcAdd').addEventListener('click', () => { const list = JSON.parse(JSON.stringify(mucChi())); list.push({ id: newId(), nhom: 'Khác', ten: 'Chế độ mới', lyDo: '', cty: 0, cd: 0, gc: '' }); setMucChi(list); renderMc(); renderCd(); });
  $('mcReset').addEventListener('click', () => { if (confirm('Đưa bảng mức chi về mặc định 1/1/2026?')) { setMucChi(JSON.parse(JSON.stringify(MUC_CHI_GOC))); renderMc(); renderCd(); } });

  // ------------------------------------------------------------ tab + render chung
  const TABS = ['lap-phieu', 'cong-doan', 'mau', 'da-lap', 'nap-mau', 'muc-chi'];
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'lap-phieu';
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    document.querySelectorAll('#tkTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    if (t === 'lap-phieu') renderPreview();
    if (t === 'cong-doan') renderCdPreview();
  }
  function renderLists() { renderChips(); renderMau(); renderPhieu(); }
  function renderAll() { renderLists(); renderForm(); renderCd(); renderMc(); renderSync(); }
  window.addEventListener('hashchange', renderTabs);
  renderTabs(); renderAll();
  pull();
})();
