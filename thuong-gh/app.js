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
  const VER = '20261111h';
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

  // ------------------------------------------------------------ xuất Excel (định dạng sẵn để gửi quản lý — xlsx-js-style)
  const FONT = 'Times New Roman', NAVY = '0F4573', RED = 'B5232A';
  const BD = { style: 'thin', color: { rgb: 'A3AEBD' } }, BORDER = { top: BD, bottom: BD, left: BD, right: BD };
  const XST = {
    title: { font: { name: FONT, sz: 16, bold: true, color: { rgb: NAVY } }, alignment: { horizontal: 'center', vertical: 'center' } },
    sub: { font: { name: FONT, sz: 11, italic: true, color: { rgb: '4B5563' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } },
    head: fill => ({ font: { name: FONT, sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: fill } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: BORDER }),
    date: { font: { name: FONT, sz: 12, italic: true }, alignment: { horizontal: 'center' } },
    sign: { font: { name: FONT, sz: 12, bold: true }, alignment: { horizontal: 'center' } },
    signNote: { font: { name: FONT, sz: 10, italic: true, color: { rgb: '6B7280' } }, alignment: { horizontal: 'center' } },
  };
  // số 0 hiện "–" cho bảng thoáng
  const XFMT = { money: '#,##0;-#,##0;"–"', int: '#,##0;-#,##0;"–"', km: '#,##0.0;-#,##0.0;"–"' };
  // Một bảng đẹp: tiêu đề + giải thích + hàng tiêu đề (1 hoặc 2 tầng) + dữ liệu (tô xen kẽ, cột nhấn) + dòng tổng + ngày lập & chỗ ký.
  // cols: [{ h, t: 'stt'|'ma'|'name'|'text'|'int'|'money'|'km', w, accent }]; groups: [{ label, span, accent }] — span 1 = cột đứng 2 tầng.
  // muted(rowIndex) = true → chữ xám (người không có thưởng).
  function bangDep(wb, name, { title, sub, cols, groups, rows, total, muted, kyTen = true }) {
    const n = cols.length, aoa = [], merges = [], rowsH = [];
    aoa.push([title]); merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: n - 1 } }); rowsH.push({ hpt: 28 });
    aoa.push([sub]); merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: n - 1 } }); rowsH.push({ hpt: 34 });
    aoa.push([]); rowsH.push({ hpt: 6 });
    const headTop = aoa.length, headFill = [];
    if (groups) {
      const top = [], bot = []; let c = 0;
      groups.forEach(g => {
        if (g.span === 1) { top.push(cols[c].h); bot.push(null); headFill[c] = cols[c].accent ? RED : NAVY; merges.push({ s: { r: headTop, c }, e: { r: headTop + 1, c } }); c++; }
        else { top.push(g.label); for (let i = 1; i < g.span; i++) top.push(null); merges.push({ s: { r: headTop, c }, e: { r: headTop, c: c + g.span - 1 } }); for (let i = 0; i < g.span; i++) { bot.push(cols[c + i].h); headFill[c + i] = g.accent ? RED : NAVY; } c += g.span; }
      });
      aoa.push(top, bot); rowsH.push({ hpt: 22 }, { hpt: 32 });
    } else { aoa.push(cols.map(x => x.h)); cols.forEach((x, c) => { headFill[c] = x.accent ? RED : NAVY; }); rowsH.push({ hpt: 40 }); }
    const headRows = groups ? 2 : 1, first = aoa.length;
    rows.forEach(row => { aoa.push(row); rowsH.push({ hpt: 21 }); });
    const totalRow = total ? aoa.length : -1;
    if (total) { aoa.push(total); rowsH.push({ hpt: 24 }); }
    const half = Math.ceil(n / 2);
    let dateRow = -1, signRow = -1;
    if (kyTen) {
      const d = new Date();
      aoa.push([]); rowsH.push({ hpt: 12 });
      dateRow = aoa.length; const dr = []; dr[half] = `TP. Hồ Chí Minh, ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`; aoa.push(dr); rowsH.push({ hpt: 20 });
      signRow = aoa.length; const sr = []; sr[0] = 'NGƯỜI LẬP BIỂU'; sr[half] = 'QUẢN LÝ DUYỆT'; aoa.push(sr); rowsH.push({ hpt: 20 });
      const nr = []; nr[0] = '(Ký, ghi rõ họ tên)'; nr[half] = '(Ký, ghi rõ họ tên)'; aoa.push(nr); rowsH.push({ hpt: 18 });
      for (let i = 0; i < 4; i++) { aoa.push([]); rowsH.push({ hpt: 16 }); } // chỗ ký
      [dateRow, signRow, signRow + 1].forEach((r, i) => {
        if (i) merges.push({ s: { r, c: 0 }, e: { r, c: half - 1 } });
        merges.push({ s: { r, c: half }, e: { r, c: n - 1 } });
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const put = (r, c, s) => { const ref = XLSX.utils.encode_cell({ r, c }); if (!ws[ref]) ws[ref] = { t: 's', v: '' }; ws[ref].s = s; };
    const cell = (t, { fill, bold, color } = {}) => {
      const s = { font: { name: FONT, sz: 11, bold: !!bold, color: { rgb: color || '1F2937' } }, border: BORDER,
        alignment: { vertical: 'center', horizontal: (t === 'name' || t === 'text') ? 'left' : (t === 'stt' || t === 'ma') ? 'center' : 'right', indent: (t === 'name' || t === 'text') ? 1 : 0, wrapText: t === 'text' } };
      if (fill) s.fill = { patternType: 'solid', fgColor: { rgb: fill } };
      if (XFMT[t]) s.numFmt = XFMT[t];
      return s;
    };
    put(0, 0, XST.title); put(1, 0, XST.sub);
    for (let r = headTop; r < headTop + headRows; r++) for (let c = 0; c < n; c++) put(r, c, XST.head(headFill[c] || NAVY));
    rows.forEach((row, i) => {
      const grey = muted && muted(i);
      cols.forEach((col, c) => put(first + i, c, cell(col.t, {
        fill: col.accent ? (i % 2 ? 'FBEAEA' : 'FDF3F3') : (i % 2 ? 'F3F6FA' : null),
        bold: col.accent && !grey, color: grey ? '9CA3AF' : (col.accent ? '7F1D1D' : null) })));
    });
    if (total) {
      const nameCol = Math.max(0, cols.findIndex(x => x.t === 'name'));
      cols.forEach((col, c) => put(totalRow, c, cell(c <= nameCol ? 'name' : col.t, { fill: col.accent ? 'F5D0D0' : 'D9E4F2', bold: true, color: col.accent ? '7F1D1D' : NAVY })));
      if (nameCol > 0) merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: nameCol } });
    }
    if (kyTen) { put(dateRow, half, XST.date); put(signRow, 0, XST.sign); put(signRow, half, XST.sign); put(signRow + 1, 0, XST.signNote); put(signRow + 1, half, XST.signNote); }
    ws['!merges'] = merges;
    ws['!cols'] = cols.map(x => ({ wch: x.w }));
    ws['!rows'] = rowsH;
    ws['!margins'] = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    XLSX.utils.book_append_sheet(wb, ws, name);
    // lặp hàng tiêu đề khi in nhiều trang + cố định tiêu đề khi cuộn
    const idx = wb.SheetNames.length - 1;
    wb.Workbook = wb.Workbook || { Names: [] };
    wb.Workbook.Names.push({ Name: '_xlnm.Print_Titles', Sheet: idx, Ref: `'${name}'!$${headTop + 1}:$${headTop + headRows}` });
    (wb.__freeze = wb.__freeze || [])[idx] = headTop + headRows;
    (wb.__fitTall = wb.__fitTall || [])[idx] = rows.length <= 30; // bảng ngắn: in gọn 1 trang (cả chỗ ký)
  }
  // Thư viện không ghi được hướng giấy → sửa thẳng file .xlsx bằng JSZip: khổ A4 ngang, vừa 1 trang bề ngang,
  // căn giữa, cố định hàng tiêu đề khi cuộn. Lỗi thì vẫn xuất file bình thường.
  const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  let jszipLoad = null;
  const loadJSZip = () => window.JSZip ? Promise.resolve(window.JSZip) : (jszipLoad = jszipLoad || new Promise((ok, bad) => {
    const s = document.createElement('script'); s.src = JSZIP_URL; s.onload = () => ok(window.JSZip); s.onerror = () => { jszipLoad = null; bad(new Error('Không tải được JSZip')); }; document.head.appendChild(s);
  }));
  async function chinhTrangIn(buf, JSZip, freeze, fitTall) {
    const zip = await JSZip.loadAsync(buf);
    for (let i = 0; i < freeze.length; i++) {
      const p = `xl/worksheets/sheet${i + 1}.xml`, f = zip.file(p); if (!f) continue;
      let x = await f.async('string');
      if (!/<sheetPr[\s>/]/.test(x)) x = x.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
      if (freeze[i]) x = x.replace(/<sheetView workbookViewId="0"\s*\/>/, `<sheetView workbookViewId="0"><pane ySplit="${freeze[i]}" topLeftCell="A${freeze[i] + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`);
      x = x.replace(/<pageMargins/, '<printOptions horizontalCentered="1"/><pageMargins');
      x = x.replace(/(<pageMargins[^>]*\/>)/, `$1<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="${fitTall && fitTall[i] ? 1 : 0}"/>`);
      zip.file(p, x);
    }
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }
  function luuFile(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  $('ghExport').addEventListener('click', async () => {
    const r = res(); if (!r) return;
    const wb = XLSX.utils.book_new();
    const L = listNV(), set = chonSet(), Q = E.quarterLabel(r.quarterKey).toUpperCase();
    const R = Object.assign({}, E.RULES, r.rules || {}), vnd = v => v.toLocaleString('vi-VN');
    const tot = k => L.reduce((a, p) => a + p[k], 0), r1 = x => Math.round(x * 10) / 10, m0 = x => Math.round(x || 0);
    const quyTac = `Thưởng đơn hàng: trên ${R.donNguong} đơn/ngày × ${vnd(R.donGia)}đ  ·  Thưởng theo KM: trên ${R.kmNguong} km/ngày × ${vnd(R.kmGia)}đ  ·  Thưởng quý = cộng các ngày trong quý`;
    const S = { stt: { h: 'STT', t: 'stt', w: 5 }, ma: { h: 'MÃ NV', t: 'ma', w: 10 }, ten: { h: 'HỌ VÀ TÊN', t: 'name', w: 27 } };

    // 1) Thưởng quý
    const q1 = [...L].sort((a, b) => b.tong - a.tong || a.nv.localeCompare(b.nv, 'vi'));
    bangDep(wb, 'Thưởng quý', {
      title: `BẢNG TỔNG HỢP THƯỞNG GIAO HÀNG ${Q}`,
      sub: `Kho vận CN.HCM  ·  ${quyTac}`,
      cols: [S.stt, S.ma, S.ten, { h: 'SỐ NGÀY GIAO', t: 'int', w: 9 }, { h: 'TỔNG SỐ ĐƠN', t: 'int', w: 10 }, { h: 'THƯỞNG ĐƠN HÀNG (đ)', t: 'money', w: 15 },
        { h: 'TỔNG KM', t: 'km', w: 11 }, { h: 'THƯỞNG THEO KM (đ)', t: 'money', w: 15 }, { h: 'TỔNG THƯỞNG (đ)', t: 'money', w: 16, accent: true }, { h: 'GHI CHÚ', t: 'text', w: 18 }],
      rows: q1.map((p, i) => [i + 1, p.maNV, p.nv, p.ngayLam, p.don, m0(p.thuongDon), r1(p.km), m0(p.thuongKm), m0(p.tong), '']),
      muted: i => !q1[i].tong,
      total: ['TỔNG CỘNG', null, null, q1.reduce((a, p) => a + p.ngayLam, 0), tot('don'), m0(tot('thuongDon')), r1(tot('km')), m0(tot('thuongKm')), m0(tot('tong')), ''],
    });

    // 2) + 3) theo tháng
    for (const [name, T, K, nhan, giai] of [
      ['Thưởng đơn hàng', 'thuongDon', 'don', 'Số đơn', `Mỗi ngày: (số đơn − ${R.donNguong}) × ${vnd(R.donGia)}đ khi trên ${R.donNguong} đơn  ·  không tính đơn trùng (cùng người nhận trong ${R.trungDonPhut} phút), đơn chành, ô tô, ngoài giờ đã trả, trả check tại kho / văn phòng`],
      ['Thưởng theo KM', 'thuongKm', 'km', 'Số km', `Mỗi ngày: (số km − ${R.kmNguong}) × ${vnd(R.kmGia)}đ khi trên ${R.kmNguong} km  ·  không cộng km điểm giao trùng (cùng khách trong ${R.trungDiemPhut} phút)  ·  quãng đường > ${R.kmMax} km (GPS lỗi) thay bằng km trung bình`]]) {
      const isKm = K === 'km', t = isKm ? 'km' : 'int', v = x => isKm ? r1(x || 0) : (x || 0);
      const list = [...L].sort((a, b) => b[T] - a[T] || b[K] - a[K] || a.nv.localeCompare(b.nv, 'vi'));
      bangDep(wb, name, {
        title: `BẢNG ${name.toUpperCase()} ${Q}`,
        sub: `Kho vận CN.HCM  ·  ${giai}`,
        groups: [{ span: 1 }, { span: 1 }, { span: 1 }, ...r.months.map(m => ({ label: E.monthLabel(m).toUpperCase(), span: 2 })), { label: 'CẢ QUÝ', span: 2, accent: true }],
        cols: [S.stt, S.ma, S.ten, ...r.months.flatMap(() => [{ h: nhan, t, w: 9 }, { h: 'Thưởng (đ)', t: 'money', w: 13 }]),
          { h: isKm ? 'Tổng km' : 'Tổng đơn', t, w: 10, accent: true }, { h: 'Thưởng quý (đ)', t: 'money', w: 15, accent: true }],
        rows: list.map((p, i) => [i + 1, p.maNV, p.nv, ...r.months.flatMap(m => { const x = p.thang[m] || {}; return [v(x[K]), m0(x[T])]; }), v(p[K]), m0(p[T])]),
        muted: i => !list[i][T],
        total: ['TỔNG CỘNG', null, null, ...r.months.flatMap(m => [v(L.reduce((a, p) => a + ((p.thang[m] || {})[K] || 0), 0)), m0(L.reduce((a, p) => a + ((p.thang[m] || {})[T] || 0), 0))]), v(tot(K)), m0(tot(T))],
      });
    }

    // sheet phụ (định dạng gọn, không chỗ ký)
    const days = r.days.filter(d => !set || set.has(E.key(d.nv)));
    bangDep(wb, 'Chi tiết thưởng', {
      title: `CHI TIẾT THƯỞNG GIAO HÀNG THEO NGÀY ${Q}`, sub: 'Mỗi dòng = 1 nhân viên × 1 ngày giao hàng', kyTen: false,
      cols: [S.stt, { h: 'NHÂN VIÊN', t: 'name', w: 26 }, { h: 'NGÀY', t: 'ma', w: 12 }, { h: 'ĐƠN/NGÀY', t: 'int', w: 9 }, { h: 'KM/NGÀY', t: 'km', w: 10 },
        { h: 'THƯỞNG ĐƠN (đ)', t: 'money', w: 13 }, { h: 'THƯỞNG KM (đ)', t: 'money', w: 13 }, { h: 'DÒNG TRÙNG ĐƠN', t: 'int', w: 10 }, { h: 'DÒNG TRÙNG ĐIỂM GIAO', t: 'int', w: 11 }],
      rows: days.map((d, i) => [i + 1, d.nv, vnDate(d.ngay), d.don, r1(d.km), m0(d.thuongDon), m0(d.thuongKm), d.trungDon, d.trungDiem]),
      muted: i => !(days[i].thuongDon + days[i].thuongKm),
    });
    const ngoai = r.nhanVien.filter(p => !incl(p, set));
    if (ngoai.length) bangDep(wb, 'Không tính thưởng', {
      title: `NHÂN VIÊN KHÔNG NẰM TRONG DANH SÁCH TÍNH THƯỞNG ${Q}`, sub: 'Số liệu để tham khảo — không cộng vào bảng thưởng', kyTen: false,
      cols: [S.stt, S.ma, S.ten, { h: 'SỐ NGÀY GIAO', t: 'int', w: 9 }, { h: 'THƯỞNG ĐƠN (nếu tính)', t: 'money', w: 14 }, { h: 'THƯỞNG KM (nếu tính)', t: 'money', w: 14 }, { h: 'TỔNG (nếu tính)', t: 'money', w: 14 }],
      rows: ngoai.map((p, i) => [i + 1, p.maNV, p.nv, p.ngayLam, m0(p.thuongDon), m0(p.thuongKm), m0(p.tong)]),
    });
    const s = r.stats;
    bangDep(wb, 'Lọc dữ liệu', {
      title: `CÁC BƯỚC LỌC DỮ LIỆU GIAO HÀNG ${Q}`, sub: `File: ${[...(r.files.giao || []), ...(r.files.kien || []), ...(r.files.ngoai || [])].join(', ')}`, kyTen: false,
      cols: [{ h: 'BƯỚC LỌC', t: 'name', w: 52 }, { h: 'SỐ DÒNG', t: 'int', w: 12 }],
      rows: [['Dòng giao hàng có ngày trả trong quý', s.tong], ['− Đơn chành / đối tác khác', s.chanh], ['− Không rõ đối tác vận chuyển', s.khongRoDoiTac], ['− Đi ô tô', s.oto],
        ['− Đơn ngoài giờ đã được trả', s.ngoaiGio], ['− Trả check tại kho / văn phòng', s.diemLoai || 0], ['= Dòng giao trực tiếp được tính thưởng', s.tinh],
        ['(trong đó) đơn ngoài giờ "Không đạt" vẫn tính', s.khongDatTinh || 0], [`Quãng đường > ${R.kmMax} km đã thay bằng km trung bình`, s.kmSua]],
    });
    const fname = `ThuongGiaoHang_${r.quarterKey}.xlsx`;
    try {
      const bytes = await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []);
      luuFile(bytes, fname);
    } catch (e) { XLSX.writeFile(wb, fname); }
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
