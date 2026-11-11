// Trang "Thưởng quý GH" (giao hàng): thả 3 loại file → đọc trong worker → chọn quý → tính thưởng đơn hàng
// và thưởng theo KM (gh-engine.js). Kết quả theo quý lưu trên trình duyệt và — nếu máy đã kết nối hệ thống
// (token ở Báo cáo giao hàng → Cập nhật dữ liệu) — đồng bộ lên kho riêng tư (thư mục thuong-gh/).
(function () {
  'use strict';
  const root = document.getElementById('gh');
  if (!root) return;
  const E = window.GhEngine;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-thuonggh-v1', LS_SEL = 'kvh-thuonggh-sel', TOKEN_KEY = 'kvh-gh-token';
  const VER = '20261111e';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
  const num = n => Math.round(n || 0).toLocaleString('vi-VN');
  const km1 = n => (n || 0).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const msg = (el, html, ok) => { el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const vnDate = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();

  // ------------------------------------------------------------ lưu trữ + đồng bộ (giống Thưởng kho)
  let archive = {};
  try { archive = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {}, saveTimers = {};
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  function persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(archive)); } catch (e) {}
    try { localStorage.setItem(LS_SEL, sel); } catch (e) {}
  }
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
    if (!res.ok) { let m = res.status + ''; try { m = (await res.json()).message || m; } catch (e) {} const err = new Error(m); err.status = res.status; throw err; }
    return res.status === 204 ? null : res.json();
  }
  const b64enc = text => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
  async function pullFromRepo() {
    if (!token) return;
    try {
      let items = [];
      try { items = await gh(`/contents/${DIR}?ref=main&t=${Date.now()}`); } catch (e) { if (e.status !== 404) throw e; }
      for (const it of items.filter(i => /^\d{4}-Q\d\.json$/.test(i.name))) {
        const q = it.name.replace('.json', '');
        repoSha[q] = it.sha;
        const meta = await gh(`/contents/${DIR}/${it.name}?ref=main`);
        const remote = JSON.parse(b64dec(meta.content || '') || '{}');
        if (!archive[q] || (remote.savedAt || '') >= (archive[q].savedAt || '')) archive[q] = remote;
      }
      for (const q of Object.keys(archive)) if (!repoSha[q]) scheduleSave(q, 0);
      syncMsg = 'Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.';
      persistLocal(); renderAll();
      fillAll();
    } catch (e) {
      syncMsg = e.status === 401 ? 'Token hết hạn/không đúng — kết nối lại ở Báo cáo giao hàng → Cập nhật dữ liệu. Dữ liệu vẫn lưu trên máy này.'
        : 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.';
      renderTop();
      fillAll();
    }
  }
  function scheduleSave(q, delay = 1500) {
    if (!token) return;
    clearTimeout(saveTimers[q]);
    saveTimers[q] = setTimeout(async () => {
      if (!archive[q]) return;
      try {
        const body = { message: `${DIR} ${q} (tu web)`, content: b64enc(JSON.stringify(archive[q])), branch: 'main' };
        if (repoSha[q]) body.sha = repoSha[q];
        const r = await gh(`/contents/${DIR}/${q}.json`, { method: 'PUT', body: JSON.stringify(body) });
        repoSha[q] = r.content.sha;
        syncMsg = `Đã lưu ${E.quarterLabel(q)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
      } catch (e) {
        syncMsg = `Chưa lưu được ${E.quarterLabel(q)} lên hệ thống (${e.message}) — vẫn còn trên máy này.`;
        if (e.status === 409 || e.status === 422) delete repoSha[q];
      }
      renderTop();
    }, delay);
  }
  function touch(q) { archive[q].savedAt = new Date().toISOString(); persistLocal(); scheduleSave(q); }

  // ------------------------------------------------------------ cài đặt dùng chung (lưu máy + hệ thống: thuong-gh/cai-dat.json)
  const CD_KEY = 'kvh-thuonggh-caidat';
  let caiDat = {}; try { caiDat = JSON.parse(localStorage.getItem(CD_KEY) || '{}'); } catch (e) {}
  let cdSha = null;
  const diemList = () => Array.isArray(caiDat.diemLoaiTru) ? caiDat.diemLoaiTru : E.DIEM_LOAI_TRU;
  function renderCaiDat() { if (document.activeElement !== $('diemList')) $('diemList').value = diemList().join('\n'); }
  async function pullCaiDat() {
    if (!token) return;
    try {
      const meta = await gh(`/contents/${DIR}/cai-dat.json?ref=main&t=${Date.now()}`);
      cdSha = meta.sha;
      const remote = JSON.parse(b64dec(meta.content || '') || '{}');
      if ((remote.savedAt || '') >= (caiDat.savedAt || '')) { caiDat = remote; try { localStorage.setItem(CD_KEY, JSON.stringify(caiDat)); } catch (e) {} renderCaiDat(); }
      else saveCaiDat();
    } catch (e) { if (e.status === 404 && caiDat.savedAt) saveCaiDat(); }
  }
  async function saveCaiDat() {
    try { localStorage.setItem(CD_KEY, JSON.stringify(caiDat)); } catch (e) {}
    if (!token) return 'đã lưu trên máy này (chưa kết nối hệ thống)';
    try {
      const body = { message: `${DIR} cai dat (tu web)`, content: b64enc(JSON.stringify(caiDat)), branch: 'main' };
      if (cdSha) body.sha = cdSha;
      const r = await gh(`/contents/${DIR}/cai-dat.json`, { method: 'PUT', body: JSON.stringify(body) });
      cdSha = r.content.sha;
      return 'đã lưu lên hệ thống';
    } catch (e) { cdSha = null; return 'đã lưu trên máy này, chưa lưu được lên hệ thống (' + e.message + ')'; }
  }

  // ------------------------------------------------------------ Mã NV còn thiếu: lấy từ bảng chấm công
  // Trên máy: dữ liệu trang Chấm công (localStorage kvh-chamcong-v1); thêm 6 tháng gần nhất trên hệ thống (nếu có token).
  // Tháng mới nhất được ưu tiên. Người không có trong chấm công thì nhập tay ở tab Danh sách tính thưởng.
  let staffDir = null;
  async function loadStaffDir() {
    if (staffDir) return staffDir;
    const dir = {}, done = new Set();
    const addSheet = (k, sh) => {
      done.add(k);
      ((sh && sh.rows) || []).forEach(r => {
        if (!r || r.t !== 'nv' || !r.ma || !r.ten) return;
        const kk = E.key(r.ten);
        if (!dir[kk]) dir[kk] = { ma: String(r.ma).trim(), nguon: `bảng chấm công T${Number(k.slice(5))}/${k.slice(0, 4)}` };
      });
    };
    const local = {}; try { Object.assign(local, JSON.parse(localStorage.getItem('kvh-chamcong-v1') || '{}')); } catch (e) {}
    let remote = [];
    if (token) {
      try { remote = (await gh(`/contents/cham-cong?ref=main&t=${Date.now()}`)).map(i => i.name).filter(n => /^\d{4}-\d{2}\.json$/.test(n)).map(n => n.slice(0, 7)); } catch (e) {}
    }
    const months = [...new Set([...Object.keys(local).filter(k => /^\d{4}-\d{2}$/.test(k)), ...remote])].sort().reverse().slice(0, 6);
    for (const k of months) {
      if (local[k]) { addSheet(k, local[k]); continue; }
      try { const meta = await gh(`/contents/cham-cong/${k}.json?ref=main`); addSheet(k, JSON.parse(b64dec(meta.content || '') || '{}')); } catch (e) {}
    }
    staffDir = dir;
    return dir;
  }
  async function fillMaNV(q) {
    const r = archive[q] && archive[q].result;
    if (!r || !r.nhanVien.some(p => !p.maNV)) return 0;
    const dir = await loadStaffDir();
    let n = 0;
    r.nhanVien.forEach(p => { if (p.maNV) return; const d = dir[E.key(p.nv)]; if (d) { p.maNV = d.ma; p.maNguon = d.nguon; n++; } });
    if (n) { touch(q); renderAll(); }
    return n;
  }
  async function fillAll() { for (const q of quarters()) await fillMaNV(q); }

  // ------------------------------------------------------------ trạng thái
  const quarters = () => Object.keys(archive).filter(q => archive[q] && archive[q].result).sort().reverse();
  const current = () => (archive[sel] && archive[sel].result) ? sel : (quarters()[0] || '');
  const res = () => { const q = current(); return q ? archive[q].result : null; };
  let search = '', ctMonth = '', uploadOpen = false, pending = null, busy = false;
  const slotFiles = { giao: [], kien: [], ngoai: [], ds: [] };
  const TABS = ['thuong-quy', 'thuong-don', 'thuong-km', 'chi-tiet', 'danh-sach', 'loc-du-lieu'];
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'thuong-quy';
  const match = name => { const q = fold(search.trim()); return !q || fold(name).includes(q); };
  // Người được tính thưởng của quý: archive[q].chon = danh sách khoá tên (E.key); null/chưa có = tất cả.
  const chonSet = () => { const q = current(); const c = q && archive[q].chon; return Array.isArray(c) ? new Set(c) : null; };
  const incl = (p, set) => !set || set.has(E.key(p.nv));
  const listNV = () => { const r = res(); if (!r) return []; const set = chonSet(); return r.nhanVien.filter(p => incl(p, set)); };

  // ------------------------------------------------------------ render
  function renderTop() {
    const r = res(), has = !!r;
    $('ghTop').hidden = !has;
    $('ghUpload').hidden = !(uploadOpen || !has) || !!pending;
    $('ghUpCancel').hidden = !has;
    $('ghPending').hidden = !pending;
    $('ghMain').hidden = !has || !!pending;
    if (!has) return;
    $('ghChips').innerHTML = quarters().map(q => `<button type="button" class="b sm${q === r.quarterKey ? ' pri' : ''}" data-q="${q}">${E.quarterLabel(q)}</button>`).join('');
    const files = [...(r.files.giao || []), ...(r.files.kien || []), ...(r.files.ngoai || [])];
    $('ghBanner').innerHTML = `✓ ${files.length} file (${esc(files.join(', '))}) · <b>${num(r.stats.tinh)}</b> dòng giao trực tiếp được tính · Đang xem <b>${E.quarterLabel(r.quarterKey)}</b>`;
    $('ghSync').textContent = syncMsg;
    $('ghRuleWarn').innerHTML = r.stats.diemLoai === undefined ? '<div class="gh-warn">⚠ Quý này được tính trước khi có quy tắc <b>địa điểm trả Check là kho / văn phòng không tính thưởng</b> — bấm <b>Nạp file quý khác</b> và nạp lại 3 file (+ danh sách NV) để tính lại cho đúng.</div>' : '';
  }
  function renderStats() {
    const r = res(); if (!r) return;
    const L = listNV(), s = L.reduce((a, p) => { a.d += p.thuongDon; a.k += p.thuongKm; return a; }, { d: 0, k: 0 });
    $('stNV').textContent = L.length;
    $('stDon').textContent = money(s.d); $('stKm').textContent = money(s.k); $('stTong').textContent = money(s.d + s.k);
  }
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('#ghTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    document.querySelectorAll('#gh [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('ghSearchBox').hidden = t === 'loc-du-lieu';
    const r = res();
    if (r) $('ghFoot').textContent = (t === 'chi-tiet' || t === 'loc-du-lieu' || t === 'danh-sach') ? '' : `${listNV().filter(p => match(p.nv)).length} nhân viên được tính thưởng`;
  }
  function renderQuy() {
    const r = res(); if (!r) return;
    const all = listNV(), list = all.filter(p => match(p.nv));
    $('tqHead').innerHTML = '<th class="r" style="width:36px">STT</th><th>Mã NV</th><th style="min-width:160px">Họ và tên</th><th class="r">Số ngày giao</th><th class="r">Tổng đơn</th><th class="r">Thưởng đơn hàng</th><th class="r">Tổng km</th><th class="r">Thưởng theo KM</th><th class="r">Tổng thưởng ↓</th>';
    let html = list.map((p, i) => `<tr><td class="r" style="color:#9ca3af">${i + 1}</td><td>${esc(p.maNV)}</td><td class="name">${esc(p.nv)}</td><td class="r">${p.ngayLam}</td><td class="r">${num(p.don)}</td><td class="r">${money(p.thuongDon)}</td><td class="r">${km1(p.km)}</td><td class="r">${money(p.thuongKm)}</td><td class="r money">${money(p.tong)}</td></tr>`).join('');
    if (!search) {
      const s = k => all.reduce((a, p) => a + p[k], 0);
      html += `<tr class="total"><td colspan="4">TỔNG CỘNG</td><td class="r">${num(s('don'))}</td><td class="r">${money(s('thuongDon'))}</td><td class="r">${km1(s('km'))}</td><td class="r">${money(s('thuongKm'))}</td><td class="r">${money(s('tong'))}</td></tr>`;
    }
    $('tqBody').innerHTML = html;
  }
  function renderLoai(kind, headId, bodyId) {
    const r = res(); if (!r) return;
    const T = kind === 'don' ? 'thuongDon' : 'thuongKm', Q = kind === 'don' ? 'don' : 'km', fmtQ = kind === 'don' ? num : km1;
    const all = listNV(), list = all.filter(p => match(p.nv)).sort((a, b) => b[T] - a[T] || a.nv.localeCompare(b.nv, 'vi'));
    $(headId).innerHTML = `<th class="r" style="width:36px">STT</th><th>Mã NV</th><th style="min-width:160px">Họ và tên</th>`
      + r.months.map(m => `<th class="r">${E.monthLabel(m)}<div class="muted" style="font-weight:400">${kind === 'don' ? 'đơn' : 'km'} · thưởng</div></th>`).join('')
      + `<th class="r">${kind === 'don' ? 'Tổng đơn' : 'Tổng km'}</th><th class="r">${kind === 'don' ? 'Thưởng đơn hàng' : 'Thưởng theo KM'} quý ↓</th>`;
    let html = list.map((p, i) => `<tr><td class="r" style="color:#9ca3af">${i + 1}</td><td>${esc(p.maNV)}</td><td class="name">${esc(p.nv)}</td>`
      + r.months.map(m => { const t = p.thang[m]; return `<td class="r">${t ? `<span class="muted">${fmtQ(t[Q])} ·</span> ${money(t[T])}` : '<span class="muted">—</span>'}</td>`; }).join('')
      + `<td class="r">${fmtQ(p[Q])}</td><td class="r money">${money(p[T])}</td></tr>`).join('');
    if (!search) html += `<tr class="total"><td colspan="3">TỔNG CỘNG</td>${r.months.map(m => `<td class="r">${money(all.reduce((a, p) => a + ((p.thang[m] || {})[T] || 0), 0))}</td>`).join('')}<td class="r">${fmtQ(all.reduce((a, p) => a + p[Q], 0))}</td><td class="r">${money(all.reduce((a, p) => a + p[T], 0))}</td></tr>`;
    $(bodyId).innerHTML = html;
  }
  function renderChiTiet() {
    const r = res(); if (!r) return;
    $('ctMonths').innerHTML = ['', ...r.months].map(m => `<button type="button" class="b sm${m === ctMonth ? ' pri' : ''}" data-ctm="${m}">${m ? E.monthLabel(m) : 'Cả quý'}</button>`).join('');
    const only = $('ctOnly').checked;
    const set = chonSet();
    const list = r.days.filter(d => (!set || set.has(E.key(d.nv))) && match(d.nv) && (!ctMonth || d.ngay.startsWith(ctMonth)) && (!only || d.thuongDon + d.thuongKm > 0));
    const MAX = 1500;
    $('ctBody').innerHTML = list.slice(0, MAX).map(d => `<tr><td class="name">${esc(d.nv)}</td><td>${vnDate(d.ngay)}</td><td class="r">${d.don}</td><td class="r">${km1(d.km)}</td><td class="r${d.thuongDon ? ' money' : ''}">${d.thuongDon ? money(d.thuongDon) : '0'}</td><td class="r${d.thuongKm ? ' money' : ''}">${d.thuongKm ? money(d.thuongKm) : '0'}</td><td class="r muted">${d.trungDon || d.trungDiem ? `${d.trungDon} / ${d.trungDiem}` : ''}</td></tr>`).join('')
      + (list.length > MAX ? `<tr><td colspan="7" class="muted" style="text-align:center">… còn ${list.length - MAX} dòng — lọc theo tháng hoặc tên để xem, hoặc Xuất Excel</td></tr>` : '');
    if (tab() === 'chi-tiet') $('ghFoot').textContent = `${list.length} dòng (người × ngày)`;
  }
  function renderLoc() {
    const r = res(); if (!r) return;
    const s = r.stats;
    const row = (a, b, note) => `<tr><td>${a}</td><td class="r">${num(b)}</td><td class="muted">${note || ''}</td></tr>`;
    $('locBody').innerHTML = `<table class="dt" style="max-width:820px"><thead><tr><th>Bước lọc</th><th class="r">Số dòng</th><th>Ghi chú</th></tr></thead><tbody>`
      + row(`Dòng giao hàng có ngày trả trong ${E.quarterLabel(r.quarterKey)}`, s.tong, s.ngoaiQuy ? `${num(s.ngoaiQuy)} dòng ngoài quý đã bỏ` : '')
      + row('− Đơn chành / đối tác khác (không có chữ "trực tiếp")', s.chanh)
      + row('− Không tìm thấy đối tác vận chuyển', s.khongRoDoiTac, s.khongRoDoiTac ? 'Mã kiện hàng không có trong file 2 — kiểm tra lại file kiện hàng' : '')
      + row('− Đi ô tô', s.oto)
      + row('− Đơn ngoài giờ (đã được trả ngoài giờ)', s.ngoaiGio, `${num(r.ngoaiGioCount)} mã đơn ngoài giờ "Đạt" đọc được từ file`)
      + (s.diemLoai === undefined ? `<tr><td colspan="3" class="muted">⚠ Quý này tính trước khi có quy tắc "địa điểm trả Check là kho / văn phòng không tính thưởng" — bấm Nạp file quý khác và nạp lại file để tính lại.</td></tr>`
        : row('− Trả check tại kho / văn phòng (không tính thưởng)', s.diemLoai, (s.diemLoaiChiTiet || []).length ? `<details><summary style="cursor:pointer">${(s.diemLoaiChiTiet || []).length} địa điểm — bấm để xem</summary>${(s.diemLoaiChiTiet || []).map(([d, n]) => `${num(n)} · ${esc(d)}`).join('<br>')}</details>` : ''))
      + (s.khongDatTinh ? row('(trong số còn lại) đơn ngoài giờ "Không đạt" vẫn tính thưởng', s.khongDatTinh, `${num(r.khongDatCount)} mã "Không đạt" trong bảng chấm — không được trả ngoài giờ nên vẫn tính thưởng giao hàng`) : '')
      + `<tr class="total"><td>= Dòng giao trực tiếp được tính thưởng</td><td class="r">${num(s.tinh)}</td><td>${num(s.kmSua)} dòng quãng đường &gt; ${r.rules.kmMax} km đã thay bằng km trung bình</td></tr>`
      + `</tbody></table><div class="muted" style="margin-top:12px;line-height:1.7">File đã đọc — giao hàng: ${esc((r.giaoSheets || []).join('; ') || '—')} · kiện hàng: ${esc((r.files.kien || []).join(', ') || '—')} (${num(r.kienCount)} mã kiện) · ngoài giờ: ${esc((r.files.ngoai || []).join(', ') || '—')}</div>`;
  }
  function renderDS() {
    const r = res(); if (!r) return;
    const set = chonSet(), on = p => incl(p, set);
    const list = [...r.nhanVien].filter(p => match(p.nv)).sort((a, b) => (on(b) - on(a)) || b.tong - a.tong || a.nv.localeCompare(b.nv, 'vi'));
    const n = r.nhanVien.filter(on).length;
    $('dsInfo').innerHTML = `<b>${n}</b>/${r.nhanVien.length} nhân viên được tính thưởng`
      + (set ? (r.coDS ? ` — theo file danh sách ${esc((r.files.ds || []).join(', '))}${set.size !== r.nhanVien.filter(p => p.trongDS).length ? ' (đã tick chỉnh thêm)' : ''}` : ' — đã chọn tay') : ' — chưa có danh sách, đang tính tất cả');
    $('dsBody').innerHTML = list.map(p => {
      const k = E.key(p.nv), note = [];
      if (r.coDS) note.push(p.trongDS ? 'Có trong file danh sách' : 'Không có trong file danh sách');
      if (!p.ngayLam) note.push('không có đơn giao trực tiếp trong quý');
      if (p.maNguon) note.push(p.maNguon === 'nhập tay' ? 'Mã NV nhập tay' : `Mã NV lấy từ ${p.maNguon}`);
      return `<tr class="${on(p) ? '' : 'off'}"><td class="ck"><input type="checkbox" data-chon="${esc(k)}"${on(p) ? ' checked' : ''} aria-label="Tính thưởng cho ${esc(p.nv)}"></td>`
        + `<td><input type="text" class="ma-in${p.maNV ? '' : ' miss'}" data-ma="${esc(k)}" value="${esc(p.maNV)}" placeholder="nhập mã" aria-label="Mã NV của ${esc(p.nv)}"></td>`
        + `<td class="name">${esc(p.nv)}</td><td class="r">${p.ngayLam}</td><td class="r">${money(p.thuongDon)}</td><td class="r">${money(p.thuongKm)}</td><td class="r${on(p) ? ' money' : ''}">${money(p.tong)}</td><td class="muted">${note.join(' · ')}</td></tr>`;
    }).join('');
  }
  function renderAll() { renderTop(); renderStats(); renderTabs(); renderQuy(); renderLoai('don', 'tdHead', 'tdBody'); renderLoai('km', 'tkmHead', 'tkmBody'); renderChiTiet(); renderDS(); renderLoc(); renderSlots(); }
  document.querySelectorAll('#gh [data-rule]').forEach(el => { el.textContent = E.RULES[el.dataset.rule].toLocaleString('vi-VN'); });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { uploadOpen = true; renderTop(); $('ghUpload').scrollIntoView({ behavior: 'smooth' }); return; }
    if (location.hash === '#huong-dan') { $('huong-dan').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTabs(); renderChiTiet();
  });

  // ------------------------------------------------------------ 3 ô thả file
  let pickSlot = 'giao';
  function renderSlots() {
    document.querySelectorAll('#gh [data-files]').forEach(box => {
      const s = box.dataset.files, fs = slotFiles[s];
      box.innerHTML = fs.length ? fs.map((f, i) => `<div class="f"><span title="${esc(f.name)}">📄 ${esc(f.name)}</span><button type="button" data-rmf="${s}|${i}" aria-label="Bỏ file">×</button></div>`).join('')
        : `<div class="none">Bấm hoặc thả file vào đây${s === 'kien' ? ' (bỏ trống được nếu file 1 đã có cột Đối tác vận chuyển)' : ''}</div>`;
      box.closest('.gh-slot').classList.toggle('has', fs.length > 0);
    });
  }
  function addFiles(slot, list) {
    [...list].filter(f => /\.xlsx?$/i.test(f.name)).forEach(f => { if (!slotFiles[slot].some(x => x.name === f.name && x.size === f.size)) slotFiles[slot].push(f); });
    msg($('ghUpMsg'), ''); renderSlots();
  }
  document.querySelectorAll('#gh .gh-slot').forEach(z => {
    const s = z.dataset.slot;
    z.addEventListener('click', e => { if (e.target.closest('[data-rmf]')) return; pickSlot = s; $('ghFile').click(); });
    z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickSlot = s; $('ghFile').click(); } });
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('drag'); });
    z.addEventListener('dragleave', () => z.classList.remove('drag'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('drag'); addFiles(s, e.dataTransfer.files); });
  });
  $('ghFile').addEventListener('change', () => { addFiles(pickSlot, $('ghFile').files); $('ghFile').value = ''; });

  $('ghRead').addEventListener('click', async () => {
    if (busy) return;
    if (!slotFiles.giao.length) { msg($('ghUpMsg'), 'Cần ít nhất 1 file ở ô <b>1. Danh sách check kiện hàng</b>.'); return; }
    busy = true; $('ghRead').disabled = true; msg($('ghUpMsg'), '');
    const step = t => { $('ghStep').textContent = t; };
    step('Đang chuẩn bị file…');
    try {
      const files = [];
      for (const s of ['giao', 'kien', 'ngoai', 'ds']) for (const f of slotFiles[s]) files.push({ slot: s, name: f.name, buf: await f.arrayBuffer() });
      const parsed = await new Promise((ok, bad) => {
        const w = new Worker(`gh-worker.js?v=${VER}`);
        w.onmessage = m => { if (m.data.step) { step(m.data.step); return; } w.terminate(); m.data.ok ? ok(m.data.parsed) : bad(new Error(m.data.error)); };
        w.onerror = err => { w.terminate(); bad(new Error(err.message || 'lỗi đọc file')); };
        w.postMessage({ files }, files.map(f => f.buf));
      });
      if (!parsed.giao.length) throw new Error('Không đọc được dòng giao hàng nào. ' + parsed.warnings.join(' '));
      pending = parsed; showPending();
    } catch (e) {
      msg($('ghUpMsg'), 'Lỗi: ' + esc(e.message));
    } finally { busy = false; $('ghRead').disabled = false; step(''); }
  });
  function showPending() {
    const p = pending, hasDT = p.kienCount > 0 || p.giao.some(r => r.dt);
    $('ghPendingInfo').innerHTML = `Đã đọc <b>${num(p.giao.length)}</b> dòng giao hàng (${esc(p.giaoSheets.join('; '))})`
      + ` · <b>${num(p.kienCount)}</b> mã kiện có đối tác vận chuyển · <b>${num(p.ngoaiGio.length)}</b> mã đơn ngoài giờ bị trừ${(p.khongDat || []).length ? ` (${num(p.khongDat.length)} mã "Không đạt" vẫn được tính)` : ''} · ${Object.keys(p.names).length} nhân viên có Mã NV`
      + (p.roster.length ? ` · danh sách tính thưởng: <b>${p.roster.length}</b> người.` : ' · chưa có danh sách tính thưởng (sẽ tính tất cả, chọn lại được sau).');
    $('ghVols').innerHTML = E.monthCounts(p).map(v => `<tr><td>${E.monthLabel(v.monthKey)}/${v.monthKey.slice(0, 4)}</td><td class="r">${num(v.n)}</td></tr>`).join('');
    const warns = [...p.warnings];
    if (!hasDT) warns.push('Chưa có thông tin <b>Đối tác vận chuyển</b> (thiếu file 2 và file 1 không có cột này) — mọi dòng sẽ bị loại. Hãy thêm file Bảng check kiện hàng.');
    if (!p.ngoaiGio.length) warns.push('Chưa có danh sách <b>đơn ngoài giờ</b> — sẽ không loại đơn ngoài giờ nào.');
    $('ghPendingWarn').innerHTML = warns.length ? `<div class="gh-warn">⚠ ${warns.join('<br>⚠ ')}</div>` : '';
    const sug = E.suggestQuarter(p), qs = [...new Set(E.monthCounts(p).map(v => { const [y, m] = v.monthKey.split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}`; }))].sort();
    $('ghPendingQ').innerHTML = qs.map(q => `<option value="${q}"${q === sug ? ' selected' : ''}>${E.quarterLabel(q)}${archive[q] ? ' (đã có — sẽ thay)' : ''}</option>`).join('');
    renderTop();
  }
  $('ghCancel').addEventListener('click', () => { pending = null; renderTop(); });
  $('ghConfirm').addEventListener('click', () => {
    if (!pending) return;
    const q = $('ghPendingQ').value;
    const rs = E.compute(pending, q, { diemLoaiTru: diemList() });
    archive[q] = { result: rs, chon: rs.coDS ? rs.nhanVien.filter(p => p.trongDS).map(p => E.key(p.nv)) : null };
    sel = q; pending = null; uploadOpen = false; ctMonth = '';
    slotFiles.giao = []; slotFiles.kien = []; slotFiles.ngoai = []; slotFiles.ds = [];
    touch(q); renderAll();
    fillMaNV(q).then(n => { if (n) msg($('ghMsg'), `Đã tự điền ${n} Mã NV còn thiếu từ bảng chấm công — xem tab Danh sách tính thưởng.`, true); });
    const r = archive[q].result;
    msg($('ghMsg'), `Đã tính ${E.quarterLabel(q)}: ${num(r.stats.tinh)} dòng giao trực tiếp, ${listNV().length}/${r.nhanVien.length} nhân viên được tính thưởng${r.coDS ? ' (theo file danh sách)' : ''}.`, true);
    setTimeout(() => msg($('ghMsg'), ''), 8000);
  });

  // ------------------------------------------------------------ sự kiện khác
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-q],[data-ctm],[data-rmf]');
    if (t && t.closest('#dsBody')) return;
    if (!t) return;
    if (t.dataset.q) { sel = t.dataset.q; ctMonth = ''; persistLocal(); renderAll(); }
    else if (t.dataset.ctm !== undefined) { ctMonth = t.dataset.ctm; renderChiTiet(); }
    else if (t.dataset.rmf) { const [s, i] = t.dataset.rmf.split('|'); slotFiles[s].splice(Number(i), 1); renderSlots(); }
  });
  $('ctOnly').addEventListener('change', renderChiTiet);
  // ---- Danh sách tính thưởng: tick / chọn tất cả / nạp file danh sách cho quý đang xem
  function setChon(keys) { const q = current(); if (!q) return; archive[q].chon = keys; touch(q); renderAll(); }
  $('dsBody').addEventListener('change', e => {
    const k = e.target.dataset.chon; if (k === undefined) return;
    const r = res(), set = chonSet() || new Set(r.nhanVien.map(p => E.key(p.nv)));
    if (e.target.checked) set.add(k); else set.delete(k);
    setChon([...set]);
  });
  $('dsBody').addEventListener('change', e => {
    const k = e.target.dataset.ma; if (k === undefined) return;
    const q = current(), r = res(), p = r && r.nhanVien.find(x => E.key(x.nv) === k); if (!p) return;
    p.maNV = e.target.value.trim(); p.maNguon = p.maNV ? 'nhập tay' : '';
    touch(q); renderAll();
  });
  $('dsAll').addEventListener('click', () => { const r = res(); if (r) setChon(r.nhanVien.map(p => E.key(p.nv))); });
  $('dsNone').addEventListener('click', () => setChon([]));
  $('dsLoad').addEventListener('click', () => $('dsFile').click());
  $('dsFile').addEventListener('change', async () => {
    const f = $('dsFile').files[0]; $('dsFile').value = '';
    const q = current(), r = res(); if (!f || !r) return;
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false }), roster = [];
      E.collectRoster(XLSX, wb, roster);
      if (!roster.length) throw new Error('không thấy danh sách nhân viên trong file (cần cột Họ và tên, hoặc kiểu sheet "mã nv": cột A mã NV, cột B họ tên)');
      E.markRoster(r.nhanVien, roster);
      r.coDS = true; r.files.ds = [f.name];
      archive[q].chon = r.nhanVien.filter(p => p.trongDS).map(p => E.key(p.nv));
      touch(q); renderAll();
      const coDon = r.nhanVien.filter(p => p.trongDS && p.ngayLam).length;
      msg($('dsMsg'), `Đã nạp ${roster.length} người từ "${esc(f.name)}": ${coDon} người có đơn giao trực tiếp trong quý, ${roster.length - coDon} người không có đơn (thưởng 0đ).`, true);
    } catch (err) { msg($('dsMsg'), 'Lỗi: ' + esc(err.message)); }
  });
  $('ghSearch').addEventListener('input', e => { search = e.target.value; renderQuy(); renderLoai('don', 'tdHead', 'tdBody'); renderLoai('km', 'tkmHead', 'tkmBody'); renderChiTiet(); renderTabs(); });
  $('ghReload').addEventListener('click', () => { uploadOpen = true; renderTop(); $('ghUpload').scrollIntoView({ behavior: 'smooth' }); });
  $('ghUpCancel').addEventListener('click', () => { uploadOpen = false; msg($('ghUpMsg'), ''); renderTop(); });
  $('ghDelete').addEventListener('click', () => {
    const q = current(); if (!q) return;
    if (!confirm(`Xoá toàn bộ kết quả ${E.quarterLabel(q)}${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
    delete archive[q]; if (sel === q) sel = ''; persistLocal();
    if (token && repoSha[q]) gh(`/contents/${DIR}/${q}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa ${DIR} ${q} (tu web)`, sha: repoSha[q], branch: 'main' }) }).then(() => { delete repoSha[q]; }).catch(() => {});
    renderAll();
  });

  // ------------------------------------------------------------ xuất Excel
  $('ghExport').addEventListener('click', () => {
    const r = res(); if (!r) return;
    const wb = XLSX.utils.book_new();
    const width = aoa => { const w = []; aoa.forEach(row => row.forEach((c, i) => { w[i] = Math.max(w[i] || 8, Math.min((c == null ? 0 : String(c).length) + 2, 42)); })); return w.map(x => ({ wch: x })); };
    const add = (name, aoa) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = width(aoa); XLSX.utils.book_append_sheet(wb, ws, name); };
    const L = listNV(), set = chonSet();
    const tot = k => L.reduce((a, p) => a + p[k], 0);
    add('Thưởng quý', [['MÃ NV', 'HỌ VÀ TÊN', 'SỐ NGÀY GIAO', 'TỔNG ĐƠN', 'THƯỞNG ĐƠN HÀNG', 'TỔNG KM', 'THƯỞNG THEO KM', 'TỔNG THƯỞNG'],
      ...L.map(p => [p.maNV, p.nv, p.ngayLam, p.don, Math.round(p.thuongDon), Math.round(p.km * 10) / 10, Math.round(p.thuongKm), Math.round(p.tong)]),
      ['Tổng cộng', null, null, tot('don'), Math.round(tot('thuongDon')), Math.round(tot('km') * 10) / 10, Math.round(tot('thuongKm')), Math.round(tot('tong'))]]);
    for (const [name, T, Q] of [['Thưởng đơn hàng', 'thuongDon', 'don'], ['Thưởng theo KM', 'thuongKm', 'km']]) {
      add(name, [['MÃ NV', 'HỌ VÀ TÊN', ...r.months.flatMap(m => [`${Q === 'don' ? 'Đơn' : 'KM'} ${E.monthLabel(m)}`, `Thưởng ${E.monthLabel(m)}`]), `Thưởng quý`],
        ...[...L].sort((a, b) => b[T] - a[T]).map(p => [p.maNV, p.nv, ...r.months.flatMap(m => { const t = p.thang[m] || {}; return [Q === 'km' ? Math.round((t.km || 0) * 10) / 10 : (t.don || 0), Math.round(t[T] || 0)]; }), Math.round(p[T])])]);
    }
    add('Chi tiết thưởng', [['Nhân viên', 'Ngày', 'Đơn/ngày', 'KM/ngày', 'Thưởng đơn (ngày)', 'Thưởng KM (ngày)', 'Dòng trùng đơn', 'Dòng trùng điểm giao'],
      ...r.days.filter(d => !set || set.has(E.key(d.nv))).map(d => [d.nv, vnDate(d.ngay), d.don, Math.round(d.km * 100) / 100, Math.round(d.thuongDon), Math.round(d.thuongKm), d.trungDon, d.trungDiem])]);
    const ngoai = r.nhanVien.filter(p => !incl(p, set));
    if (ngoai.length) add('Không tính thưởng', [['MÃ NV', 'HỌ VÀ TÊN', 'SỐ NGÀY GIAO', 'THƯỞNG ĐƠN (nếu tính)', 'THƯỞNG KM (nếu tính)', 'TỔNG (nếu tính)'], ...ngoai.map(p => [p.maNV, p.nv, p.ngayLam, Math.round(p.thuongDon), Math.round(p.thuongKm), Math.round(p.tong)])]);
    const s = r.stats;
    add('Lọc dữ liệu', [['Bước', 'Số dòng'], ['Dòng có ngày trả trong quý', s.tong], ['Đơn chành / đối tác khác', s.chanh], ['Không rõ đối tác', s.khongRoDoiTac], ['Đi ô tô', s.oto], ['Đơn ngoài giờ', s.ngoaiGio], ['Trả check tại kho / văn phòng', s.diemLoai || 0], ['Dòng được tính thưởng', s.tinh], [`Quãng đường > ${r.rules.kmMax} km đã thay bằng trung bình`, s.kmSua]]);
    XLSX.writeFile(wb, `ThuongGiaoHang_${r.quarterKey}.xlsx`);
  });

  $('diemSave').addEventListener('click', async () => {
    const lines = [...new Set($('diemList').value.split(/\r?\n/).map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean))];
    caiDat = Object.assign({}, caiDat, { diemLoaiTru: lines, savedAt: new Date().toISOString() });
    $('diemMsg').textContent = 'Đang lưu…';
    $('diemMsg').textContent = `${lines.length} địa điểm — ${await saveCaiDat()}. Nạp lại file quý để áp dụng cho quý đã tính.`;
    renderCaiDat();
  });
  $('diemReset').addEventListener('click', () => { $('diemList').value = E.DIEM_LOAI_TRU.join('\n'); $('diemMsg').textContent = 'Đã điền lại danh sách mặc định — bấm Lưu danh sách để áp dụng.'; });

  if (location.hash === '#nap-du-lieu') uploadOpen = true;
  renderAll(); renderCaiDat();
  if (token) { pullFromRepo(); pullCaiDat(); } else fillAll();
})();
