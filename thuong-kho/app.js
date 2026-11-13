// Trang "Thưởng kho HCM" — bố cục giống trang ThuongKho của app cũ (thanh công cụ +
// 3 thẻ số liệu + 3 tab). Nạp file quý (đọc trong worker), lưu kết quả gộp theo
// quý trong trình duyệt và — nếu máy đã kết nối hệ thống (token ở mục Báo cáo
// giao hàng → Cập nhật dữ liệu) — đồng bộ lên kho riêng tư (thư mục thuong-kho/).
(function () {
  'use strict';
  const root = document.getElementById('tk');
  if (!root) return;
  const E = window.KhoEngine;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  // Cấu hình theo trang (data-* trên #tk) — dùng chung code cho Thưởng kho và Thưởng sàn.
  // Không khai báo gì = Thưởng kho như cũ.
  const CFG = root.dataset;
  const LS_BASE = CFG.ls || 'kvh-thuongkho';
  const LS_KEY = `${LS_BASE}-v1`, LS_SEL = `${LS_BASE}-sel`, TOKEN_KEY = 'kvh-gh-token';
  const IS_KHO = CFG.kho !== '0';             // dữ liệu mặc định riêng của kho (chị Thoa, đóng cặp T6/2026)
  const NGUON = CFG.nguon ? CFG.nguon.split(',') : ['tao', 'boc', 'dong'];
  const NGUON_TEN = NGUON.map(n => ({ tao: 'Tạo kiện', boc: 'Bốc hàng', dong: 'Đóng hàng' }[n])).join(' + ');
  const ROSTER = CFG.roster ? CFG.roster.split(',') : ['THƯỞNG'];
  const RULES = { nguong: Number(CFG.nguong) || E.RULES.nguong, donGia: Number(CFG.dongia) || E.RULES.donGia };
  const BASE = CFG.base || '';                // thư mục chứa worker.js/engine.js
  const FILE_PREFIX = CFG.file || 'ThuongKho';
  const VER = '20261110e';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
  const num = n => Math.round(n || 0).toLocaleString('vi-VN');
  const numSmart = n => !n ? '' : (Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const msg = (el, html, ok) => { el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };

  // Người đóng cặp ngoài danh sách thưởng (theo ghi chú file gốc: Thoa đóng cùng vẫn chia 2).
  const DEFAULT_EXTRA_HELPERS = IS_KHO ? [{ maNV: '__extra_thoa__', hoTen: 'Thoa (ngoài DS thưởng)' }] : [];
  // Đóng cặp tháng 6/2026 tổng hợp từ ghi chú tay trong "bảng mã nv" (đã xác nhận với người dùng).
  const DEFAULT_PAIRINGS = [
    ['Nguyễn Thị Hoàng Anh', 'Phạm Thị Kiều Mi', '2026-06-01', '2026-06-06'],
    ['Trần Xuân Thu Hằng', 'Bùi Thị Diễm Duy', '2026-06-01', '2026-06-06'],
    ['Trịnh Thu Huyền', 'THOA', '2026-06-01', '2026-06-06'],
    ['Nguyễn Thị Trang Thảo', 'Nguyễn Thị Bích Vân', '2026-06-08', '2026-06-13'],
    ['Bùi Nguyễn Yến Nhi', 'Tăng Thùy Trang', '2026-06-08', '2026-06-13'],
    ['Lê Thị Mỹ Duyên', 'THOA', '2026-06-08', '2026-06-13'],
    ['Trần Xuân Thu Hằng', 'Bùi Thị Diễm Duy', '2026-06-15', '2026-06-20'],
    ['Nguyễn Thị Hoàng Anh', 'Phạm Thị Kiều Mi', '2026-06-15', '2026-06-20'],
    ['Trịnh Thu Huyền', 'THOA', '2026-06-15', '2026-06-20'],
    ['Nguyễn Thị Trang Thảo', 'Nguyễn Thị Bích Vân', '2026-06-22', '2026-06-27'],
    ['Trần Thị Xuân Mai', 'Tăng Thùy Trang', '2026-06-22', '2026-06-27'],
    ['Lê Thị Mỹ Duyên', 'THOA', '2026-06-22', '2026-06-27'],
    ['Bùi Thị Diễm Duy', 'Trần Xuân Thu Hằng', '2026-06-29', '2026-06-30'],
    ['Nguyễn Thị Hoàng Anh', 'Phạm Thị Kiều Mi', '2026-06-29', '2026-06-30'],
    ['Trịnh Thu Huyền', 'THOA', '2026-06-29', '2026-06-30'],
  ];

  // ------------------------------------------------------------ lưu trữ + đồng bộ
  let archive = {};
  try { archive = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {};
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  const saveTimers = {};

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
      syncMsg = `Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.`;
      persistLocal(); renderAll();
    } catch (e) {
      syncMsg = e.status === 401 ? 'Token hết hạn/không đúng — kết nối lại ở Báo cáo giao hàng → Cập nhật dữ liệu. Dữ liệu vẫn lưu trên máy này.'
        : 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.';
      renderTop();
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

  // ------------------------------------------------------------ trạng thái
  const quarters = () => Object.keys(archive).sort().reverse();
  const current = () => archive[sel] ? sel : (quarters()[0] || '');
  let result = null, monthIdx = 0, search = '', uploadOpen = false, pending = null;
  const TABS = ['thuong-quy', 'theo-thang', 'dong-cap'];
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'thuong-quy';

  function recompute() {
    const q = current();
    result = q ? E.computeResult(archive[q].cached, q, archive[q].adjustments || [], RULES) : null;
    // Thưởng sàn: bảng mã lấy chung của kho nên chỉ hiện người có lượt trong quý
    if (result && CFG.anKhongLuot === '1') result.perEmployee = result.perEmployee.filter(e => e.monthlyDetail.some(m => m.soKien > 0));
  }
  function helpers() {
    const q = current(); const custom = (q && archive[q].extraHelpers) || [];
    const out = [...DEFAULT_EXTRA_HELPERS];
    custom.forEach(h => { if (!out.some(m => m.maNV === h.maNV)) out.push(h); });
    return out;
  }
  const BUOI = { '': 'Cả ngày', sang: 'Sáng', chieu: 'Chiều' };
  const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const vnDate = s => s ? `<span class="muted" style="font-size:11px">${THU[new Date(s + 'T00:00:00').getDay()]}</span> ${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  const displayName = e => !e ? '' : (e.maNV && !String(e.maNV).startsWith('__extra_') ? `${e.maNV} - ${e.hoTen}` : e.hoTen);
  function filtered() {
    if (!result) return [];
    const q = search.trim().toLowerCase();
    return q ? result.perEmployee.filter(e => e.hoTen.toLowerCase().includes(q) || e.maNV.toLowerCase().includes(q)) : result.perEmployee;
  }

  // ------------------------------------------------------------ render
  function renderTop() {
    const has = !!result;
    $('tkTop').hidden = !has;
    $('tkUpload').hidden = !(uploadOpen || !has) || !!pending;
    $('tkUpCancelRow').hidden = !has;
    $('tkPending').hidden = !pending;
    $('tkMainView').hidden = !has || !!pending;
    // Giống app cũ: khung "Ghi chú & giả định" chỉ hiện khi đã có dữ liệu (hoặc mở từ menu)
    $('huong-dan').hidden = !(has || location.hash === '#huong-dan');
    if (!has) return;
    $('tkChips').innerHTML = quarters().map(q => `<button type="button" class="b sm${q === result.quarterKey ? ' pri' : ''}" data-q="${q}">${E.quarterLabel(q)}</button>`).join('');
    $('tkBanner').innerHTML = `✓ <b>${esc(result.fileName)}</b> — ${result.soDongTho.toLocaleString('vi-VN')} dòng thô · Đang xem <b>${E.quarterLabel(result.quarterKey)}</b>`
      + (result.adjustments.length ? ` · ${result.adjustments.length} điều chỉnh đóng cặp` : '')
      + (result.payrollFiltered ? ` · Đã lọc theo sheet "${esc(result.rosterSheet)}" (${result.perEmployee.length}/${result.employees.length} nhân viên)` : '');
    $('tkSync').textContent = syncMsg;
  }
  function renderStats() {
    if (!result) return;
    $('stNV').textContent = CFG.anKhongLuot === '1' ? result.perEmployee.length : result.employees.length;
    $('stKien').textContent = num(result.perEmployee.reduce((s, e) => s + e.monthlyDetail.reduce((a, m) => a + m.soKien, 0), 0));
    $('stTien').textContent = money(result.perEmployee.reduce((s, e) => s + e.thuong, 0));
  }
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('#tkTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('tkSearchBox').hidden = t === 'dong-cap';
    $('tkFoot').hidden = t === 'dong-cap';
    if (result) $('tkFoot').textContent = `${filtered().length} nhân viên`;
  }
  function renderThuong() {
    if (!result) return;
    // Xếp theo thưởng quý từ cao xuống thấp (bằng nhau thì theo tên); STT = thứ hạng
    const months = result.months, list = [...filtered()].sort((x, y) => (y.thuong - x.thuong) || x.hoTen.localeCompare(y.hoTen, 'vi'));
    $('tqHead').innerHTML = `<th class="r" style="width:36px">STT</th><th>Mã NV</th><th style="min-width:150px">Họ và tên</th>${months.map(mk => `<th class="r">${E.monthLabel(mk)}</th>`).join('')}<th class="r">Thưởng quý ↓</th><th style="min-width:200px">Ghi chú (từ file)</th>`;
    let html = list.map((e, i) => `<tr><td class="r" style="color:#9ca3af">${i + 1}</td><td>${esc(e.maNV)}</td><td class="name">${esc(e.hoTen)}</td>${e.monthlyDetail.map(m => `<td class="r">${money(m.tongTien)}</td>`).join('')}<td class="r money">${money(e.thuong)}</td><td class="note">${esc(e.ghiChu)}</td></tr>`).join('');
    if (!search) {
      html += `<tr class="total"><td colspan="3">TỔNG CỘNG</td>${months.map(mk => `<td class="r">${money(result.perEmployee.reduce((s, e) => s + ((e.monthlyDetail.find(m => m.monthKey === mk) || {}).tongTien || 0), 0))}</td>`).join('')}<td class="r">${money(result.perEmployee.reduce((s, e) => s + e.thuong, 0))}</td><td></td></tr>`;
    }
    $('tqBody').innerHTML = html;
  }
  // Ngày đóng cặp trong tháng mk: Map `${maNV}|${ngày}` → [{ o: mã người cùng cặp, b: buổi }]
  function pairMap(mk) {
    const [y, m] = mk.split('-').map(Number), paired = new Map();
    result.adjustments.forEach(a => {
      if (result.skippedAdj.includes(a.id)) return;
      for (let d = 1; d <= 31; d++) {
        const k = `${y}-${E.pad2(m)}-${E.pad2(d)}`;
        if (k >= a.dateFrom && k <= a.dateTo) {
          [[a.maNV1, a.maNV2], [a.maNV2, a.maNV1]].forEach(([u, o]) => { const key = `${u}|${d}`; paired.set(key, [...(paired.get(key) || []), { o, b: a.buoi || '' }]); });
        }
      }
    });
    return paired;
  }
  function renderGrid() {
    if (!result) return;
    if (monthIdx >= result.months.length) monthIdx = 0;
    $('ttMonths').innerHTML = result.months.map((mk, i) => `<button type="button" class="b sm${i === monthIdx ? ' pri' : ''}" data-m="${i}">${E.monthLabel(mk)}</button>`).join('');
    const paired = pairMap(result.months[monthIdx]);
    const byMa = {}; [...result.employees, ...helpers()].forEach(e => { byMa[e.maNV] = e; });
    $('ttHead').innerHTML = `<th>Mã NV</th><th style="min-width:140px">Họ và tên</th>${Array.from({ length: 31 }, (_, i) => `<th class="r">${i + 1}</th>`).join('')}<th class="r">Tổng lượt</th><th class="r">Tổng tiền</th>`;
    $('ttBody').innerHTML = filtered().map(e => {
      const md = e.monthlyDetail[monthIdx];
      const cells = md.counts32.slice(1, 32).map((c, i) => {
        const p = paired.get(`${e.maNV}|${i + 1}`);
        const cls = ['r', c > result.rules.nguong ? 'over' : '', p ? 'pair' : ''].join(' ').trim();
        const tip = p ? p.map(x => `Đóng cặp${x.b ? ' buổi ' + BUOI[x.b].toLowerCase() : ''} cùng: ${displayName(byMa[x.o]) || x.o}`).join('\n') : '';
        return `<td class="${cls}"${p ? ` title="${esc(tip)}"` : ''}>${numSmart(c)}</td>`;
      }).join('');
      return `<tr><td>${esc(e.maNV)}</td><td class="name">${esc(e.hoTen)}</td>${cells}<td class="r bold">${numSmart(md.soKien)}</td><td class="r money">${money(md.tongTien)}</td></tr>`;
    }).join('');
  }
  function renderAdjust() {
    if (!result) return;
    const opts = [...result.employees, ...helpers()];
    cAdj1.refresh(); cAdj2.refresh();
    qRows.forEach((r, i) => qStatus(i));
    const byMa = {}; opts.forEach(e => { byMa[e.maNV] = e; });
    // Hiển thị theo thứ tự ngày, chia nhóm theo tháng, kẻ vạch giữa các tuần (chỉ đổi cách hiện, không đổi dữ liệu)
    const nameOf = u => displayName(byMa[u]) || u;
    const adjs = [...result.adjustments].sort((x, y) => x.dateFrom.localeCompare(y.dateFrom) || x.dateTo.localeCompare(y.dateTo)
      || nameOf(x.maNV1).localeCompare(nameOf(y.maNV1), 'vi') || (x.buoi || '').localeCompare(y.buoi || ''));
    if (editId !== null && !adjs.some(a => String(a.id) === editId)) editId = null;
    const monthOf = s => s.slice(0, 7);
    const weekOf = s => { const t = new Date(s + 'T00:00:00'); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toDateString(); };
    const perMonth = {}; adjs.forEach(a => { perMonth[monthOf(a.dateFrom)] = (perMonth[monthOf(a.dateFrom)] || 0) + 1; });
    let prevMonth = '', prevWeek = '';
    $('adjList').innerHTML = adjs.length ? adjs.map(a => {
      let head = '', wk = '';
      const mk = monthOf(a.dateFrom);
      if (mk !== prevMonth) { head = `<tr class="grp"><td colspan="6">Tháng ${Number(mk.slice(5))}/${mk.slice(0, 4)} <span>· ${perMonth[mk]} cặp</span></td></tr>`; prevMonth = mk; prevWeek = weekOf(a.dateFrom); }
      else if (weekOf(a.dateFrom) !== prevWeek) { wk = ' class="wk"'; prevWeek = weekOf(a.dateFrom); }
      return head + rowHtml(a, wk);
    }).join('')
      : '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:20px">Chưa có điều chỉnh nào</td></tr>';
    function rowHtml(a, wk) {
      if (String(a.id) === editId) {
        // Dòng đang sửa: đổi người / ngày / buổi tại chỗ rồi bấm Lưu
        const bOpts = Object.entries(BUOI).map(([v, l]) => `<option value="${v}"${v === (a.buoi || '') ? ' selected' : ''}>${l}</option>`).join('');
        return `<tr class="editing${wk ? ' wk' : ''}"><td><span class="tk-combo"><input type="text" id="eAdj1" placeholder="Gõ tên để tìm…"></span></td><td><span class="tk-combo"><input type="text" id="eAdj2" placeholder="Gõ tên để tìm…"></span></td>`
          + `<td><input type="date" id="eFrom" value="${a.dateFrom}"></td><td><input type="date" id="eTo" value="${a.dateTo}"></td><td><select id="eBuoi" class="buoi">${bOpts}</select></td>`
          + `<td style="white-space:nowrap"><button type="button" class="b ok sm" data-save="${a.id}">Lưu</button> <button type="button" class="b sm" data-cancel="1">Hủy</button></td></tr>`;
      }
      const skip = result.skippedAdj.includes(a.id);
      return `<tr${wk}><td>${esc(nameOf(a.maNV1))}</td><td>${esc(nameOf(a.maNV2))}</td><td>${vnDate(a.dateFrom)}</td><td>${vnDate(a.dateTo)}</td>`
        + `<td>${BUOI[a.buoi || '']}${skip ? ' <span style="color:#991b1b" title="Quý này nạp file trước khi có chia theo buổi — nạp lại file quý để áp dụng">(chưa áp dụng — cần nạp lại file)</span>' : ''}</td>`
        + `<td style="white-space:nowrap"><button type="button" class="b sm" data-edit="${a.id}">Sửa</button> <button type="button" class="b del sm" data-rm="${a.id}">Xóa</button></td></tr>`;
    }
    if (editId !== null) {
      const a = adjs.find(x => String(x.id) === editId);
      eC1 = makeCombo($('eAdj1'), optList); eC1.set(a.maNV1);
      eC2 = makeCombo($('eAdj2'), optList); eC2.set(a.maNV2);
    }
    // Quý nạp trước khi có dữ liệu giờ quét: nhắc rõ + nút nạp lại ngay (không làm mờ lựa chọn — người dùng
    // tưởng bị lỗi). Chọn Sáng/Chiều lúc này sẽ bị chặn khi bấm Thêm/Lưu kèm lời nhắc này.
    $('buoiNote').innerHTML = result.hasBuoi ? '' : `<div class="tk-warnmsg" style="margin:0 0 12px">${reloadHint()}</div>`;
    $('helperList').innerHTML = helpers().map(h => `<span class="chip">${esc(h.hoTen)}${DEFAULT_EXTRA_HELPERS.some(d => d.maNV === h.maNV) ? '' : ` <button type="button" data-rmh="${esc(h.maNV)}" aria-label="Bỏ">×</button>`}</span>`).join('');
  }
  function renderAll() { recompute(); renderTop(); renderStats(); renderTabs(); renderThuong(); renderGrid(); renderAdjust(); }
  const reloadHint = () => `⚠ <b>${E.quarterLabel(result.quarterKey)}</b> đang dùng dữ liệu nạp <b>trước</b> khi có tính năng chia buổi (chưa có giờ quét), nên chưa chia Sáng/Chiều được. `
    + `Bấm <button type="button" class="b pri sm" data-reload="1">Nạp lại file quý này</button> rồi chọn lại đúng file <b>${esc(result.fileName)}</b> — các cặp đã khai báo vẫn giữ nguyên, nạp xong là chọn được buổi.`;
  function warnReload() {
    // khung nhắc (buoiNote) luôn hiện khi quý chưa có giờ quét — chỉ nháy nó lên cho dễ thấy
    msg($('adjMsg'), '');
    const n = $('buoiNote').firstElementChild;
    if (!n) return;
    n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash');
    n.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // Sửa 1 dòng đóng cặp đã khai báo (người / ngày / buổi)
  let editId = null, eC1 = null, eC2 = null;
  function saveEdit(id) {
    const q = current(); if (!q) return;
    const a = (archive[q].adjustments || []).find(x => String(x.id) === String(id)); if (!a) return;
    const m1 = eC1 && eC1.value, m2 = eC2 && eC2.value, f = $('eFrom').value, t = $('eTo').value || f, b = $('eBuoi').value;
    if (!m1 || !m2 || !f) { msg($('adjMsg'), 'Chọn đủ 2 người (gõ tên rồi bấm chọn trong danh sách) và ngày.'); return; }
    if (m1 === m2) { msg($('adjMsg'), 'Hai người phải khác nhau.'); return; }
    if (f > t) { msg($('adjMsg'), '"Từ ngày" phải trước "Đến ngày".'); return; }
    if (b && b !== (a.buoi || '') && result && !result.hasBuoi) { warnReload(); return; }
    Object.assign(a, { maNV1: m1, maNV2: m2, dateFrom: f, dateTo: t });
    if (b) a.buoi = b; else delete a.buoi;
    editId = null; touch(q); renderAll();
    msg($('adjMsg'), 'Đã lưu thay đổi — thưởng đã được tính lại.', true);
    setTimeout(() => msg($('adjMsg'), ''), 5000);
  }
  document.querySelectorAll('[data-rule]').forEach(el => { el.textContent = RULES[el.dataset.rule].toLocaleString('vi-VN'); });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { uploadOpen = true; renderTop(); $('tkUpload').scrollIntoView({ behavior: 'smooth' }); return; }
    if (location.hash === '#huong-dan') { renderTop(); $('huong-dan').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTabs();
  });

  // ------------------------------------------------------------ sự kiện
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-q],[data-m],[data-rm],[data-rmh],[data-edit],[data-save],[data-cancel],[data-reload]');
    if (!t) return;
    if (t.dataset.reload) { uploadOpen = true; renderTop(); $('tkUpload').scrollIntoView({ behavior: 'smooth' }); $('tkFile').click(); }
    else if (t.dataset.q) { sel = t.dataset.q; editId = null; persistLocal(); renderAll(); }
    else if (t.dataset.m) { monthIdx = Number(t.dataset.m); renderGrid(); }
    else if (t.dataset.edit) { editId = t.dataset.edit; msg($('adjMsg'), ''); renderAdjust(); const d = $('eFrom'); if (d) d.focus(); }
    else if (t.dataset.cancel) { editId = null; msg($('adjMsg'), ''); renderAdjust(); }
    else if (t.dataset.save) saveEdit(t.dataset.save);
    else if (t.dataset.rm) { const q = current(); if (editId === t.dataset.rm) editId = null; archive[q].adjustments = archive[q].adjustments.filter(a => String(a.id) !== t.dataset.rm); touch(q); renderAll(); }
    else if (t.dataset.rmh) { const q = current(); archive[q].extraHelpers = (archive[q].extraHelpers || []).filter(h => h.maNV !== t.dataset.rmh); touch(q); renderAll(); }
  });
  // Chọn Sáng/Chiều (ô Buổi ở form thêm hoặc dòng đang sửa) khi quý chưa có giờ quét → nhắc nạp lại ngay
  document.addEventListener('change', e => {
    if (!result || result.hasBuoi || !e.target.matches('#adjBuoi, #eBuoi') || !e.target.value) return;
    warnReload();
  });
  $('tkSearch').addEventListener('input', e => { search = e.target.value; renderThuong(); renderGrid(); renderTabs(); });
  $('tkReload').addEventListener('click', () => { uploadOpen = true; renderTop(); $('tkFile').click(); });
  $('tkUpCancel').addEventListener('click', () => { uploadOpen = false; msg($('tkUpMsg'), ''); renderTop(); });
  $('tkDelete').addEventListener('click', () => {
    const q = current(); if (!q) return;
    if (!confirm(`Xoá toàn bộ dữ liệu ${E.quarterLabel(q)} (cả khai báo đóng cặp)${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
    delete archive[q]; if (sel === q) sel = ''; persistLocal();
    if (token && repoSha[q]) gh(`/contents/${DIR}/${q}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa ${DIR} ${q} (tu web)`, sha: repoSha[q], branch: 'main' }) }).then(() => { delete repoSha[q]; }).catch(() => {});
    renderAll();
  });

  // ------------------------------------------------------------ nạp file
  // Thưởng sàn (data-mnv-tu-kho="1"): file sàn không có sheet "bảng mã nv" → dùng bảng mã của quý Thưởng kho mới nhất
  // (trên máy này, nếu không có thì lấy trên hệ thống). Có dòng "Họ tên (SĐT)" (mnvRows) thì dùng, không thì danh sách NV.
  async function khoRoster() {
    if (CFG.mnvTuKho !== '1') return null;
    let q = '', c = null;
    try {
      const a = JSON.parse(localStorage.getItem('kvh-thuongkho-v1') || '{}');
      q = Object.keys(a).filter(k => /^\d{4}-Q\d$/.test(k) && a[k] && a[k].cached).sort().pop() || '';
      if (q) c = a[q].cached;
    } catch (e) {}
    if (!c && token) {
      try {
        const items = await gh(`/contents/thuong-kho?ref=main&t=${Date.now()}`);
        const f = items.map(i => i.name).filter(n => /^\d{4}-Q\d\.json$/.test(n)).sort().pop();
        if (f) { const meta = await gh(`/contents/thuong-kho/${f}?ref=main`); c = JSON.parse(b64dec(meta.content || '') || '{}').cached; q = f.replace('.json', ''); }
      } catch (e) {}
    }
    if (!c || !c.employees) return null;
    const rows = (c.mnvRows || c.employees.map(e => [e.maNV, '', e.hoTen])).map(([m, h, t]) => [m, h, null, t]);
    return { rows, label: `bảng mã nv của Thưởng kho ${E.quarterLabel(q)}` };
  }
  function handleFile(file) {
    if (!file) return;
    msg($('tkUpMsg'), '');
    $('tkZoneTitle').textContent = 'Đang xử lý... (file lớn, có thể mất khoảng 20–60 giây)';
    $('tkZoneSub').textContent = file.name;
    const reset = () => { $('tkZoneTitle').textContent = ZONE_TITLE; $('tkZoneSub').innerHTML = ZONE_SUB; };
    const reader = new FileReader();
    reader.onload = async ev => {
      const fb = await khoRoster(); // bảng mã nv dự phòng (Thưởng sàn: lấy của Thưởng kho)
      const w = new Worker(`${BASE}worker.js?v=${VER}`);
      w.onmessage = m => {
        if (m.data.step) { $('tkZoneTitle').textContent = m.data.step; return; }
        w.terminate(); reset();
        if (!m.data.ok) { msg($('tkUpMsg'), esc(m.data.error)); return; }
        pending = m.data.cached;
        const vols = E.monthVolumes(pending);
        $('tkPendingInfo').innerHTML = `Đã đọc <b>${pending.soDongTho.toLocaleString('vi-VN')}</b> dòng thô`
          + (pending.soSheetTho > 1 ? ` từ <b>${pending.soSheetTho}</b> sheet${pending.trungBoQua ? ` (bỏ ${pending.trungBoQua.toLocaleString('vi-VN')} kiện trùng)` : ''}` : '')
          + `, <b>${pending.employees.length}</b> nhân viên${pending.payrollMaNV ? ` (sheet ${esc(pending.rosterSheet || 'THƯỞNG')}: ${pending.payrollMaNV.length} NV)` : ''}`
          + (pending.mnvNguon ? ` — bảng mã nv: <b>${esc(pending.mnvNguon)}</b>` : '')
          + `. Số lượt bốc/đóng hàng theo từng tháng tìm thấy trong file (có thể lẫn vài ngày đầu/cuối quý kề bên):`;
        $('tkVols').innerHTML = vols.map(v => `<tr><td>${E.monthLabel(v.monthKey)}/${v.monthKey.split('-')[0]}</td><td class="r">${num(v.total)}</td></tr>`).join('');
        // Thưởng sàn (data-an-khong-khop="1"): không liệt kê tên không khớp bảng mã
        const kk = CFG.anKhongKhop === '1' ? [] : (pending.khongKhop || []).filter(([n]) => n);
        $('tkUnmatched').innerHTML = kk.length ? `<details style="font-size:12px;margin-bottom:8px"><summary style="cursor:pointer;color:#1a56db">${kk.length} tên / username trong dữ liệu không khớp "bảng mã nv" (không được tính) — bấm để soát</summary><div class="muted" style="margin:6px 0">Thường là người ngoài danh sách thưởng. Nếu thấy nhân viên của mình ở đây, thêm dòng vào "bảng mã nv" (cột B ghi đúng như dữ liệu) rồi nạp lại.</div><ol style="margin:0;padding-left:20px">${kk.map(([n, c]) => `<li>${esc(n)} — ${c.toLocaleString('vi-VN')} lượt</li>`).join('')}</ol></details>` : '';
        const sug = E.suggestQuarter(pending);
        $('tkPendingQ').innerHTML = E.quartersOf(pending).map(q => `<option value="${q}"${q === sug ? ' selected' : ''}>${E.quarterLabel(q)}${archive[q] ? ' (đã có — sẽ thay)' : ''}</option>`).join('');
        renderTop();
      };
      w.onerror = err => { w.terminate(); reset(); msg($('tkUpMsg'), 'Lỗi đọc file: ' + esc(err.message || '')); };
      w.postMessage({ buf: ev.target.result, fileName: file.name, opts: { nguon: NGUON, roster: ROSTER,
        mnv: fb && fb.rows, mnvLabel: fb && fb.label,
        mnvHint: CFG.mnvTuKho === '1' ? 'cũng chưa lấy được bảng mã của Thưởng kho (mở trang Thưởng kho trên máy này một lần, hoặc kết nối hệ thống)' : '' } }, [ev.target.result]);
    };
    reader.readAsArrayBuffer(file);
  }
  const ZONE_TITLE = $('tkZoneTitle').textContent, ZONE_SUB = $('tkZoneSub').innerHTML; // chữ gốc của trang
  const zone = $('tkZone'), fi = $('tkFile');
  zone.addEventListener('click', () => fi.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { handleFile(fi.files[0]); fi.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handleFile(e.dataTransfer.files[0]); });
  $('tkCancel').addEventListener('click', () => { pending = null; renderTop(); });
  $('tkConfirm').addEventListener('click', () => {
    if (!pending) return;
    const q = $('tkPendingQ').value;
    const old = archive[q] || {};
    archive[q] = { cached: pending, adjustments: old.adjustments || [], extraHelpers: old.extraHelpers || [] };
    sel = q; pending = null; uploadOpen = false; monthIdx = 0;
    touch(q); renderAll();
    msg($('tkMsg'), `Đã tính ${E.quarterLabel(q)}. Nhớ khai báo <a href="#dong-cap">đóng cặp</a> nếu có.`, true);
    setTimeout(() => msg($('tkMsg'), ''), 8000);
  });

  // ------------------------------------------------------------ đóng cặp
  $('adjAdd').addEventListener('click', () => {
    const q = current(); if (!q) return;
    const a1 = cAdj1.value, a2 = cAdj2.value, f = $('adjFrom').value, t = $('adjTo').value || f, b = $('adjBuoi').value;
    if (!a1 || !a2 || !f) { msg($('adjMsg'), 'Chọn đủ 2 người (gõ tên rồi bấm chọn trong danh sách) và ngày.'); return; }
    if (a1 === a2) { msg($('adjMsg'), 'Hai người phải khác nhau.'); return; }
    if (f > t) { msg($('adjMsg'), '"Từ ngày" phải trước "Đến ngày".'); return; }
    if (b && result && !result.hasBuoi) { warnReload(); return; }
    archive[q].adjustments = [...(archive[q].adjustments || []), { id: Date.now(), maNV1: a1, maNV2: a2, dateFrom: f, dateTo: t, ...(b ? { buoi: b } : {}) }];
    touch(q); msg($('adjMsg'), ''); cAdj1.set(''); cAdj2.set(''); ['adjFrom', 'adjTo', 'adjBuoi'].forEach(id => { $(id).value = ''; }); renderAll();
  });
  $('adjImport').closest('.tk-row').hidden = !IS_KHO; // danh sách T6/2026 chỉ dành cho kho
  $('adjImport').addEventListener('click', () => {
    const q = current(); if (!q || !result) return;
    const byName = new Map(result.employees.map(e => [e.hoTen, e.maNV]));
    const thoa = helpers().find(h => h.hoTen.startsWith('Thoa'));
    const cur = archive[q].adjustments || [];
    const add = []; let skip = 0;
    DEFAULT_PAIRINGS.forEach(([n1, n2, f, t], i) => {
      const m1 = byName.get(n1), m2 = n2 === 'THOA' ? thoa && thoa.maNV : byName.get(n2);
      if (!m1 || !m2) { skip++; return; }
      const dup = cur.some(a => ((a.maNV1 === m1 && a.maNV2 === m2) || (a.maNV1 === m2 && a.maNV2 === m1)) && a.dateFrom === f && a.dateTo === t);
      if (!dup) add.push({ id: Date.now() + i, maNV1: m1, maNV2: m2, dateFrom: f, dateTo: t });
    });
    if (add.length) { archive[q].adjustments = [...cur, ...add]; touch(q); }
    msg($('adjMsg'), `Đã nạp ${add.length} điều chỉnh` + (skip ? ` — bỏ qua ${skip} dòng vì không khớp được tên nhân viên trong quý này` : '') + (!add.length && !skip ? ' (đã có đủ từ trước)' : '') + '.', !skip);
    renderAll();
  });

  // ------------------------------------------------------------ lấy cặp đã khai ở trang Đánh Giá CL NS (danh-gia/)
  // Bên đó khai theo khoảng ngày (thường cả tuần); sang đây chỉ giữ những ngày / buổi CẢ HAI người cùng đi làm theo
  // chấm công (quy tắc đã chốt 10/11/2026 — "để thưởng về đúng người thực hiện"), gộp các ngày liền nhau thành 1 dòng.
  // Ngày nào ở đây đã khai sẵn cặp đó (tay / ghi chú) thì giữ nguyên, không thêm. Bấm lại không bị trùng.
  const DG_AP = IS_KHO ? ['kho', 'ca'] : ['san', 'ca'];
  const newerOf = (loc, rem) => loc && rem ? ((rem.savedAt || '') > (loc.savedAt || '') ? rem : loc) : (loc || rem);
  async function repoJSON(path) {
    if (!token) return null;
    try { const m = await gh(`/contents/${path}?ref=main&t=${Date.now()}`); return JSON.parse(b64dec(m.content || '') || 'null'); } catch (e) { return null; }
  }
  async function dgDongCap() {
    let loc = null; try { loc = JSON.parse(localStorage.getItem('kvh-danhgia-dongcap') || 'null'); } catch (e) {}
    return newerOf(loc, await repoJSON('danh-gia/dong-cap.json'));
  }
  async function chamCongMa(mk) {
    let loc = null; try { loc = (JSON.parse(localStorage.getItem('kvh-chamcong-v1') || '{}'))[mk] || null; } catch (e) {}
    const sh = newerOf(loc, await repoJSON(`cham-cong/${mk}.json`)), map = {};
    if (sh && Array.isArray(sh.rows)) sh.rows.forEach(r => { if (r && r.t === 'nv' && r.ma) map[String(r.ma).trim()] = r.d || []; });
    return Object.keys(map).length ? map : null;
  }
  // buổi đi làm theo mã chấm công: 'sc' cả ngày, 's' sáng, 'c' chiều, '' nghỉ (giống danh-gia/dg-engine.js buoiLam)
  function buoiLam(code) {
    const c = String(code ?? '').normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    if (!c) return '';
    if (c === 'x/p.s') return 'c';
    if (c === 'x/p.c') return 's';
    let s = false, ch = false;
    c.split('/').forEach(p => { if (p === 'x') s = ch = true; else if (p === 's') s = true; else if (p === 'c') ch = true; });
    return (s ? 's' : '') + (ch ? 'c' : '');
  }
  const isoOf = t => `${t.getFullYear()}-${E.pad2(t.getMonth() + 1)}-${E.pad2(t.getDate())}`;
  $('adjFromDG').addEventListener('click', async () => {
    const q = current(); if (!q || !result) return;
    const btn = $('adjFromDG'); btn.disabled = true;
    msg($('dgImpMsg'), 'Đang lấy danh sách đóng cặp và chấm công…', true);
    try {
      const dc = await dgDongCap();
      const months = E.quarterMonths(q), [ly, lm] = months[2].split('-').map(Number);
      const qf = months[0] + '-01', qt = `${months[2]}-${E.pad2(new Date(ly, lm, 0).getDate())}`;
      const inQ = ((dc && dc.list) || []).filter(a => DG_AP.includes(a.ap || 'kho') && a.dateTo >= qf && a.dateFrom <= qt);
      if (!inQ.length) {
        msg($('dgImpMsg'), `Trang Đánh Giá CL NS chưa có cặp ${IS_KHO ? 'kho' : 'sàn'} nào trong ${E.quarterLabel(q)}` + (dc ? '.' : ' (chưa thấy dữ liệu — mở trang Đánh Giá CL NS trên máy này hoặc kết nối hệ thống).'));
        return;
      }
      const cc = {}; for (const mk of months) cc[mk] = await chamCongMa(mk);
      const emp = new Set(result.employees.map(e => e.maNV)), ngoai = new Map(((dc && dc.ngoai) || []).map(h => [h.maNV, h.hoTen]));
      const cur = archive[q].adjustments || [], add = [], newHelpers = [], lech = new Set(), noCC = new Set();
      let trung = 0, boNgay = 0, daCo = 0;
      const sameRow = (x, y) => samePair(x, y.maNV1, y.maNV2) && x.dateFrom === y.dateFrom && x.dateTo === y.dateTo && (x.buoi || '') === (y.buoi || '');
      inQ.forEach(a => {
        const ok = [a.maNV1, a.maNV2].every(u => {
          if (emp.has(u) || helpers().some(h => h.maNV === u) || newHelpers.some(h => h.maNV === u)) return true;
          if (ngoai.has(u)) { newHelpers.push({ maNV: u, hoTen: `${ngoai.get(u)} (ngoài DS thưởng)` }); return true; }
          lech.add(u); return false;
        });
        if (!ok) return;
        const days = [];
        const t = new Date((a.dateFrom > qf ? a.dateFrom : qf) + 'T00:00:00');
        for (; isoOf(t) <= a.dateTo && isoOf(t) <= qt; t.setDate(t.getDate() + 1)) {
          const iso = isoOf(t), map = cc[iso.slice(0, 7)];
          // ngày này ở đây đã khai sẵn cặp đó (không phải dòng lấy từ Đánh giá) → giữ nguyên
          if (cur.some(x => !x.tu && samePair(x, a.maNV1, a.maNV2) && x.dateFrom <= iso && x.dateTo >= iso)) { daCo++; continue; }
          let want = a.buoi === 'sang' ? 's' : a.buoi === 'chieu' ? 'c' : 'sc';
          if (want === 'sc' && t.getDay() === 6) want = 's'; // thứ Bảy chỉ làm buổi sáng
          let both = want;
          if (map) [a.maNV1, a.maNV2].forEach(u => { if (map[u]) { const w = buoiLam(map[u][t.getDate() - 1]); both = both.split('').filter(h => w.includes(h)).join(''); } });
          else noCC.add(iso.slice(0, 7));
          if (!both) { boNgay++; continue; }
          days.push({ iso, buoi: (both === want && !a.buoi) || both === 'sc' ? '' : both === 's' ? 'sang' : 'chieu' });
        }
        // gộp các ngày liền nhau cùng buổi thành 1 dòng
        let run = null;
        const flush = () => {
          if (!run) return;
          const adj = { maNV1: a.maNV1, maNV2: a.maNV2, dateFrom: run.from, dateTo: run.to, ...(run.buoi ? { buoi: run.buoi } : {}), tu: 'dg:' + a.id };
          if (cur.concat(add).some(x => sameRow(x, adj))) trung++; else add.push(adj);
          run = null;
        };
        days.forEach(d => {
          const next = run && (() => { const n = new Date(run.to + 'T00:00:00'); n.setDate(n.getDate() + 1); return isoOf(n); })();
          if (run && run.buoi === d.buoi && d.iso === next) run.to = d.iso;
          else { flush(); run = { from: d.iso, to: d.iso, buoi: d.buoi }; }
        });
        flush();
      });
      if (add.length || newHelpers.length) {
        const base = Date.now();
        archive[q].adjustments = [...cur, ...add.map((x, i) => ({ id: base + i, ...x }))];
        if (newHelpers.length) archive[q].extraHelpers = [...(archive[q].extraHelpers || []), ...newHelpers];
        touch(q); renderAll();
      }
      const ten = u => (result.employees.find(e => e.maNV === u) || {}).hoTen || ngoai.get(u) || u;
      msg($('dgImpMsg'), `Lấy ${inQ.length} cặp từ Đánh Giá CL NS → thêm <b>${add.length}</b> dòng (chỉ những ngày cả 2 cùng đi làm)`
        + (boNgay ? ` · bỏ ${boNgay} ngày có người nghỉ` : '') + (daCo ? ` · ${daCo} ngày đã khai sẵn cặp đó ở đây nên giữ nguyên` : '')
        + (trung ? ` · ${trung} dòng đã lấy từ trước` : '')
        + (lech.size ? ` · <span style="color:#991b1b">không có trong bảng mã của quý này: ${[...lech].map(u => esc(ten(u))).join(', ')}</span>` : '')
        + (noCC.size ? ` · chưa có chấm công ${[...noCC].map(E.monthLabel).join(', ')} — các ngày đó lấy nguyên, chưa lọc ngày nghỉ` : '') + '.', !lech.size);
    } finally { btn.disabled = false; }
  });
  $('helperAdd').addEventListener('click', () => {
    const q = current(); const name = $('helperName').value.trim(); if (!q || !name) return;
    archive[q].extraHelpers = [...(archive[q].extraHelpers || []), { maNV: `__extra_${Date.now()}__`, hoTen: `${name} (ngoài DS thưởng)` }];
    $('helperName').value = ''; touch(q); renderAll();
  });

  // ------------------------------------------------------------ ô chọn nhân viên có gõ tìm
  // foldKeep giữ nguyên độ dài chuỗi (chữ dựng sẵn NFC → 1 ký tự không dấu) để cắt chuỗi gốc theo vị trí.
  const foldKeep = s => String(s ?? '').normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const fold = s => foldKeep(s).replace(/\s+/g, ' ').trim();
  const lowerNFC = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const optList = () => result ? [...result.employees, ...helpers()].map(e => ({ value: e.maNV, label: displayName(e) })) : [];
  const comboList = document.createElement('div');
  comboList.className = 'tkc-list'; comboList.hidden = true; comboList.setAttribute('role', 'listbox');
  document.body.appendChild(comboList);
  let comboOwner = null;
  comboList.addEventListener('mousedown', e => {
    e.preventDefault(); // giữ con trỏ trong ô đang gõ
    const d = e.target.closest('[data-i]');
    if (d && comboOwner) comboOwner.pickIdx(Number(d.dataset.i));
  });
  window.addEventListener('scroll', () => { if (comboOwner) comboOwner.place(); }, true);
  window.addEventListener('resize', () => { if (comboOwner) comboOwner.place(); });

  function makeCombo(input, getOpts) {
    let value = '', items = [], act = -1;
    input.autocomplete = 'off'; input.spellcheck = false;
    const labelOf = v => { const o = getOpts().find(x => x.value === v); return o ? o.label : ''; };
    const api = {
      onChange: null,
      get value() { return value; },
      set(v) { value = v && getOpts().some(o => o.value === v) ? v : ''; input.value = labelOf(value); input.classList.remove('bad'); },
      setText(t) { value = ''; input.value = t || ''; input.classList.toggle('bad', !!t); },
      refresh() { if (value && !getOpts().some(o => o.value === value)) value = ''; if (value) input.value = labelOf(value); },
      pickIdx(i) { pick(items[i]); },
      place() {
        const r = input.getBoundingClientRect();
        if (!r.width) { close(); return; }
        const below = innerHeight - r.bottom;
        comboList.style.left = r.left + 'px'; comboList.style.minWidth = r.width + 'px';
        if (below < 220 && r.top > below) { comboList.style.top = ''; comboList.style.bottom = (innerHeight - r.top + 2) + 'px'; comboList.style.maxHeight = Math.max(120, Math.min(260, r.top - 10)) + 'px'; }
        else { comboList.style.bottom = ''; comboList.style.top = (r.bottom + 2) + 'px'; comboList.style.maxHeight = Math.max(120, Math.min(260, below - 10)) + 'px'; }
      },
    };
    function draw() {
      comboList.innerHTML = items.length
        ? items.map((o, i) => `<div data-i="${i}" role="option" class="${i === act ? 'act' : ''}${o.value === value ? ' cur' : ''}">${esc(o.label)}</div>`).join('')
        : '<div class="none">Không thấy tên nào khớp</div>';
      const a = comboList.children[act];
      if (a) { const t = a.offsetTop, b = t + a.offsetHeight; if (t < comboList.scrollTop) comboList.scrollTop = t; else if (b > comboList.scrollTop + comboList.clientHeight) comboList.scrollTop = b - comboList.clientHeight; }
    }
    function open() {
      const all = getOpts(), q = fold(input.value);
      const showAll = !q || (value && input.value === labelOf(value));
      const words = q.split(' ');
      items = showAll ? all : all.filter(o => { const k = fold(o.label); return words.every(w => k.includes(w)); });
      act = items.findIndex(o => o.value === value);
      if (act < 0 && !showAll && items.length) act = 0;
      comboOwner = api; comboList.hidden = false; comboList.scrollTop = 0; draw(); api.place();
    }
    function close() { if (comboOwner === api) { comboList.hidden = true; comboOwner = null; } }
    function pick(o) {
      if (!o) return;
      value = o.value; input.value = o.label; input.classList.remove('bad'); close();
      if (api.onChange) api.onChange(value);
    }
    input.addEventListener('focus', () => { setTimeout(() => input.select(), 0); open(); });
    input.addEventListener('click', () => { if (comboOwner !== api) open(); });
    input.addEventListener('input', () => { const had = value; value = ''; input.classList.remove('bad'); open(); if (had && api.onChange) api.onChange(''); });
    input.addEventListener('keydown', e => {
      const isOpen = comboOwner === api;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) { open(); return; }
        if (!items.length) return;
        const dn = e.key === 'ArrowDown';
        act = act < 0 ? (dn ? 0 : items.length - 1) : (act + (dn ? 1 : -1) + items.length) % items.length;
        draw();
      } else if (e.key === 'Enter') { if (isOpen && items[act]) { e.preventDefault(); pick(items[act]); } }
      else if (e.key === 'Escape') { if (isOpen) { e.preventDefault(); close(); } }
    });
    input.addEventListener('blur', () => {
      // gõ ra đúng 1 người thì tự chọn luôn khi rời ô
      if (!value && input.value.trim() && comboOwner === api && items.length === 1) pick(items[0]);
      close();
      input.classList.toggle('bad', !value && !!input.value.trim());
    });
    return api;
  }
  const cAdj1 = makeCombo($('adj1'), optList), cAdj2 = makeCombo($('adj2'), optList);

  // ------------------------------------------------------------ nhập nhanh từ ghi chú (chữ hoặc ảnh)
  // Ví dụ ghi chú: "Đóng hàng từ ngày 29/6 đến 4/7 / Cặp 1: Thu Hằng + Diễm Duy / Cặp 3: Thu Huyền + chị Thoa".
  // Dòng chỉ có ngày = khoảng ngày cho các cặp phía dưới; dòng có "Tên + Tên" = một cặp.
  const DATE_RE = /(?<![\d\/.])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.]\s*(\d{4}|\d{2}))?(?!\d)/g;
  const JOIN_RE = /\s*[+&＋†]\s*|\s+(?:và|với|cùng|va|voi)\s+/iu;
  const STOPW = new Set(['từ', 'ngày', 'đến', 'tới', 'đóng', 'bốc', 'hàng', 'cặp', 'gồm', 'là', 'tuần', 'tháng', 'đợt', 'buổi', 'ca', 'sáng', 'chiều']);
  // "sáng"/"chiều" (có dấu) trong dòng ghi chú → buổi; có cả hai = cả ngày. Không dò chữ không dấu vì
  // "Sang" cũng là tên người.
  const buoiOf = line => {
    const s = line.normalize('NFC').toLowerCase();
    const sa = /(^|[^\p{L}])sáng(?!\p{L})/u.test(s), ch = /(^|[^\p{L}])chiều(?!\p{L})/u.test(s);
    return sa && ch ? '' : sa ? 'sang' : ch ? 'chieu' : null;
  };
  const HONOR = /^(?:chị|chi|c|anh|a|em|e|cô|co|chú|chu|bạn|ban|bà|ông|bé|mr|ms|mrs)\s+(?=\S)/iu;
  const isoD = (y, m, d) => `${y}-${E.pad2(m)}-${E.pad2(d)}`;
  const okDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
  const ddmm = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '';

  function takeRange(line, year, qNum) {
    const ms = [...line.matchAll(DATE_RE)];
    if (!ms.length) return null;
    const part = m => ({ d: +m[1], mo: +m[2], y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0 });
    let a, b, start, end;
    if (ms.length >= 2) { a = part(ms[0]); b = part(ms[1]); start = ms[0].index; end = ms[1].index + ms[1][0].length; }
    else {
      b = part(ms[0]); start = ms[0].index; end = start + ms[0][0].length;
      // "29 - 4/7", "1 đến 4/7": ngày đầu không ghi tháng
      const pre = line.slice(0, start), pm = pre.match(/(\d{1,2})\s*(?:-|–|—|~|→|->|đến|tới|den|toi)\s*$/iu);
      if (pm && !/[\d\/.]$/.test(pre.slice(0, pm.index))) { const d1 = +pm[1]; a = { d: d1, mo: d1 <= b.d ? b.mo : (b.mo === 1 ? 12 : b.mo - 1), y: 0 }; start = pm.index; }
      else a = { ...b };
    }
    if (!a.y && !b.y) { a.y = b.y = year; if (a.mo > b.mo) { if (qNum >= 3) b.y = year + 1; else a.y = year - 1; } }
    else if (!b.y) b.y = a.mo > b.mo ? a.y + 1 : a.y;
    else if (!a.y) a.y = a.mo > b.mo ? b.y - 1 : b.y;
    if (!okDate(a.y, a.mo, a.d) || !okDate(b.y, b.mo, b.d)) return null;
    return { from: isoD(a.y, a.mo, a.d), to: isoD(b.y, b.mo, b.d), rest: line.slice(0, start) + ' ' + line.slice(end) };
  }
  function cleanName(p) {
    const w = p.normalize('NFC').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    while (w.length && STOPW.has(w[0].toLowerCase())) w.shift();
    while (w.length && STOPW.has(w[w.length - 1].toLowerCase())) w.pop();
    return w.join(' ');
  }
  function pairsInLine(line) {
    const pairs = [], bad = [];
    // tách thêm khi 1 dòng có nhiều "Cặp N" hoặc dấu ;
    const f = foldKeep(line), cuts = [0];
    for (const m of f.matchAll(/cap\s*\d/g)) if (m.index > 0) cuts.push(m.index);
    const pieces = cuts.map((c, i) => line.slice(c, cuts[i + 1])).flatMap(p => p.split(';'));
    pieces.forEach(piece => {
      let s = piece.replace(/[()[\]{}"“”‘’:|]/g, ' ').replace(/^[\s\-–—•*·>]+/, '');
      const pre = foldKeep(s).match(/^\s*cap(?![a-z])\s*(?:so\s*)?\d*\s*[.)\-]?\s*/);
      if (pre) s = s.slice(pre[0].length);
      s = s.replace(/^\s*\d{1,2}\s*[.)\-]\s+/, '');
      if (!JOIN_RE.test(s)) return;
      s.split(',').filter(x => JOIN_RE.test(x)).forEach(sub => {
        const parts = sub.split(JOIN_RE).map(cleanName).filter(Boolean);
        if (parts.length === 2) pairs.push(parts);
        else if (parts.length > 2) bad.push(sub.trim());
      });
    });
    return { pairs, bad };
  }
  function parseNote(text, year, qNum) {
    const rows = [], bad = [];
    let range = null, lastRange = null, curBuoi = '';
    String(text || '').normalize('NFC').split(/\r?\n/).forEach(raw => {
      let line = raw.trim(); if (!line) return;
      const r = takeRange(line, year, qNum), b = buoiOf(line);
      if (r) { line = r.rest; lastRange = r; }
      const found = pairsInLine(line), rg = r || range;
      found.pairs.forEach(([n1, n2]) => rows.push({ n1, n2, from: rg ? rg.from : '', to: rg ? rg.to : '', buoi: b !== null ? b : curBuoi, src: raw.trim() }));
      bad.push(...found.bad);
      if (!found.pairs.length) {
        // dòng tiêu đề (ngày và/hoặc buổi) áp cho các cặp bên dưới; ngày mới mà không ghi buổi = cả ngày
        if (r) { range = r; curBuoi = b || ''; }
        else if (b !== null) curBuoi = b;
      }
    });
    if (lastRange) rows.forEach(x => { if (!x.from) { x.from = lastRange.from; x.to = lastRange.to; } });
    return { rows, bad };
  }

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // Tên ngắn trong ghi chú ("Thu Hằng") khớp phần cuối họ tên đầy đủ ("Trần Xuân Thu Hằng").
  function nameHits(q, opts, mode) {
    const norm = mode === 'exact' ? lowerNFC : fold;
    const qw = norm(q).split(' ').filter(Boolean);
    if (!qw.length) return [];
    // Đoán gần đúng (chữ đọc sai 1 ký tự) chỉ khi tên có ≥2 chữ và ít nhất 1 chữ khớp hẳn — tên 1 chữ ngắn
    // như "Lan"/"Vân" rất dễ đoán nhầm.
    if (mode === 'fuzzy' && qw.length < 2) return [];
    const near = (x, y) => x === y || (mode === 'fuzzy' && Math.min(x.length, y.length) >= 3 && lev(x, y) <= 1);
    const fits = (w, s) => qw.every((x, i) => near(x, w[s + i])) && (mode !== 'fuzzy' || qw.some((x, i) => x === w[s + i]));
    const L = opts.map(o => ({ o, w: norm(o.name).split(' ') }));
    const tail = L.filter(({ w }) => w.length >= qw.length && fits(w, w.length - qw.length));
    if (tail.length) return tail.map(t => t.o);
    const seq = L.filter(({ w }) => { for (let s = 0; s + qw.length <= w.length; s++) if (fits(w, s)) return true; return false; });
    return seq.map(t => t.o);
  }
  function matchName(text, opts) {
    const t = text.trim();
    const code = opts.filter(o => lowerNFC(o.value) === lowerNFC(t));
    if (code.length === 1) return { hits: code, mode: 'exact', query: t };
    const variants = [t], st = t.replace(HONOR, '').trim();
    if (st && st !== t) variants.push(st);
    for (const mode of ['exact', 'fold', 'fuzzy']) for (const v of variants) { const hits = nameHits(v, opts, mode); if (hits.length) return { hits, mode, query: v }; }
    return { hits: [], mode: '', query: variants[variants.length - 1] };
  }
  const matchOpts = () => !result ? [] : [
    ...result.employees.map(e => ({ value: e.maNV, name: e.hoTen })),
    ...helpers().map(h => ({ value: h.maNV, name: h.hoTen.replace(/\s*\(ngoài DS thưởng\)\s*$/, '') })),
  ];

  let qRows = [], qBad = [], qTimer = null;
  const samePair = (a, x, y) => (a.maNV1 === x && a.maNV2 === y) || (a.maNV1 === y && a.maNV2 === x);
  function qCheck(r) {
    const q = current();
    if (!q) return { level: 'no', text: '' };
    if (!r.v1 || !r.v2) return { level: 'no', text: 'Chưa chọn đủ 2 người' };
    if (r.v1 === r.v2) return { level: 'no', text: 'Hai người trùng nhau' };
    if (!r.from || !r.to) return { level: 'no', text: 'Thiếu ngày' };
    if (r.from > r.to) return { level: 'no', text: '"Từ ngày" sau "Đến ngày"' };
    if (r.buoi && result && !result.hasBuoi) return { level: 'no', text: 'Quý này cần nạp lại file một lần mới chia theo buổi được' };
    if ((archive[q].adjustments || []).some(a => samePair(a, r.v1, r.v2) && a.dateFrom === r.from && a.dateTo === r.to && (a.buoi || '') === (r.buoi || ''))) return { level: 'no', text: 'Đã có trong danh sách bên dưới' };
    const ms = E.quarterMonths(q), [ly, lm] = ms[2].split('-').map(Number);
    const qf = ms[0] + '-01', qt = isoD(ly, lm, new Date(ly, lm, 0).getDate());
    if (r.to < qf || r.from > qt) return { level: 'no', text: `Nằm ngoài ${E.quarterLabel(q)} — không ảnh hưởng quý này` };
    const guessed = [1, 2].some(k => r['m' + k].mode === 'fuzzy' && r['m' + k].hits.some(h => h.value === r['v' + k]));
    const partial = r.from < qf || r.to > qt;
    const notes = [];
    if (guessed) notes.push('kiểm tra lại tên đoán gần đúng');
    if (partial) notes.push(`${E.quarterLabel(q)} chỉ tính ${ddmm(r.from < qf ? qf : r.from)}–${ddmm(r.to > qt ? qt : r.to)}, ngày ngoài quý tự bỏ qua`);
    return { level: notes.length ? 'warn' : 'ok', text: '✓ Sẵn sàng' + (notes.length ? ' · ' + notes.join(' · ') : '') };
  }
  function qHint(r, k) {
    const m = r['m' + k], v = r['v' + k];
    if (v) return m.mode === 'fuzzy' && m.hits.length === 1 && m.hits[0].value === v ? `Đoán gần đúng từ “${esc(m.query)}” — kiểm tra lại` : '';
    if (m.hits.length > 1) return `${m.hits.length} người khớp “${esc(m.query)}” — bấm vào ô để chọn đúng người`;
    if (m.query) return `Không thấy “${esc(m.query)}” trong danh sách<button type="button" data-qhelper="${r.key}|${k}">+ Thêm làm người ngoài DS</button>`;
    return '';
  }
  function qStatus(i) {
    const r = qRows[i], tr = $('qBody').children[i];
    if (!r || !tr) return;
    const st = qCheck(r);
    if (r.lastLevel !== undefined && (r.lastLevel === 'no') !== (st.level === 'no')) r.include = st.level !== 'no';
    if (r.lastLevel === undefined) r.include = st.level !== 'no';
    r.lastLevel = st.level;
    tr.querySelector('[data-qk=inc]').checked = r.include;
    const s = tr.querySelector('[data-qs]'); s.className = 'qst ' + st.level; s.textContent = st.text;
    [1, 2].forEach(k => { tr.querySelector(`[data-qh="${k}"]`).innerHTML = qHint(r, k); });
  }
  function renderQuick() {
    $('qPrev').hidden = !qRows.length;
    $('qBody').innerHTML = qRows.map((r, i) => `<tr data-qi="${i}">
      <td><input type="checkbox" data-qk="inc" aria-label="Thêm dòng này"></td>
      <td><span class="tk-combo"><input type="text" data-qk="n1" placeholder="Gõ tên để tìm…"></span><div class="qhint" data-qh="1"></div></td>
      <td><span class="tk-combo"><input type="text" data-qk="n2" placeholder="Gõ tên để tìm…"></span><div class="qhint" data-qh="2"></div></td>
      <td><input type="date" data-qk="from" value="${r.from}"></td>
      <td><input type="date" data-qk="to" value="${r.to}"></td>
      <td><select data-qk="buoi" class="buoi">${Object.entries(BUOI).map(([v, l]) => `<option value="${v}"${v === (r.buoi || '') ? ' selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><div class="qst" data-qs></div><div class="qsrc">${esc(r.src)}</div></td></tr>`).join('');
    qRows.forEach((r, i) => {
      const tr = $('qBody').children[i];
      [1, 2].forEach(k => {
        const c = makeCombo(tr.querySelector(`[data-qk=n${k}]`), optList);
        if (r['v' + k]) c.set(r['v' + k]); else c.setText(r['m' + k].query);
        c.onChange = v => { r['v' + k] = v; qStatus(qRows.indexOf(r)); };
      });
      qStatus(i);
    });
  }
  const qInfo = text => { $('qMsg').innerHTML = `<div class="tk-okmsg" style="background:#eff6ff;color:#1e40af">${esc(text)}</div>`; };
  function qParse() {
    const q = current();
    if (!q || !result) { qRows = []; renderQuick(); return; }
    const [y, n] = q.split('-Q').map(Number);
    const { rows, bad } = parseNote($('qText').value, y, n);
    const opts = matchOpts();
    qRows = rows.map((r, i) => {
      const m1 = matchName(r.n1, opts), m2 = matchName(r.n2, opts);
      return { ...r, key: i, m1, m2, v1: m1.hits.length === 1 ? m1.hits[0].value : '', v2: m2.hits.length === 1 ? m2.hits[0].value : '', include: true };
    });
    qBad = bad;
    renderQuick();
    const txt = $('qText').value.trim();
    const badNote = qBad.length ? ` Dòng có hơn 2 người chưa tách được: ${qBad.map(b => `“${esc(b)}”`).join(', ')}.` : '';
    if (txt && !qRows.length) msg($('qMsg'), 'Chưa nhận ra cặp nào — mỗi cặp ghi dạng “Tên + Tên”, khoảng ngày ghi kiểu “từ 29/6 đến 4/7”.' + badNote);
    else if (txt && !qRows.some(r => r.from)) msg($('qMsg'), `Nhận ra ${qRows.length} cặp nhưng chưa thấy khoảng ngày (ví dụ “từ 29/6 đến 4/7”) — điền ngày trong bảng dưới.` + badNote);
    else msg($('qMsg'), badNote.trim());
  }
  function resetThumb() {
    const im = $('qThumb');
    if (im.src) URL.revokeObjectURL(im.src);
    im.removeAttribute('src'); im.hidden = true; $('qDropTxt').hidden = false;
  }

  // Đọc chữ trong ảnh ngay trên trình duyệt (Tesseract.js, tiếng Việt) — ảnh không gửi đi đâu.
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  let tessLoad = null, ocrWorker = null, ocrBusy = false;
  const loadScript = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('không tải được bộ đọc chữ — kiểm tra kết nối mạng')); document.head.appendChild(s); });
  async function getOcr() {
    if (!window.Tesseract) { tessLoad = tessLoad || loadScript(TESS_URL).catch(e => { tessLoad = null; throw e; }); await tessLoad; }
    if (!ocrWorker) {
      ocrWorker = Tesseract.createWorker('vie', 1, { logger: m => { if (m.status === 'recognizing text' && ocrBusy) qInfo(`Đang đọc chữ trong ảnh… ${Math.round((m.progress || 0) * 100)}%`); } })
        .catch(e => { ocrWorker = null; throw e; });
    }
    return ocrWorker;
  }
  const loadImg = url => new Promise((ok, bad) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => bad(new Error('file không phải ảnh')); im.src = url; });
  async function prepImage(url) {
    // Phóng to ảnh chụp nhỏ + chuyển xám (chữ nhỏ trên ảnh chụp màn hình đọc chính xác hơn nhiều)
    const im = await loadImg(url);
    const s = Math.max(1, Math.min(4, 1600 / im.naturalWidth));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = v; sum += v; }
    const dark = sum / (p.length / 4) < 110; // ảnh nền tối (chế độ tối) → đảo màu
    for (let i = 0; i < p.length; i += 4) { let v = dark ? 255 - p[i] : p[i]; if (v > 200) v = 255; p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0);
    return c;
  }
  async function readImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { msg($('qMsg'), 'Chỉ nhận file ảnh (PNG, JPG…).'); return; }
    if (!result || ocrBusy) return;
    ocrBusy = true;
    resetThumb();
    const url = URL.createObjectURL(file);
    $('qThumb').src = url; $('qThumb').hidden = false; $('qDropTxt').hidden = true;
    qInfo(window.Tesseract ? 'Đang đọc chữ trong ảnh…' : 'Đang tải bộ đọc chữ tiếng Việt (chỉ lần đầu, khoảng 5–15 giây)…');
    try {
      const [w, img] = await Promise.all([getOcr(), prepImage(url)]);
      qInfo('Đang đọc chữ trong ảnh…');
      const { data } = await w.recognize(img);
      const text = String(data.text || '').normalize('NFC').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
      if (!text) throw new Error('không thấy chữ nào trong ảnh');
      $('qText').value = text;
      ocrBusy = false;
      qParse();
      if (qRows.length) msg($('qMsg'), `Đã đọc ảnh: nhận ra <b>${qRows.length}</b> cặp. Chữ đọc được nằm ở ô bên phải — nếu đọc sai thì sửa ở đó, bảng dưới tự cập nhật. Kiểm tra lại rồi bấm “Thêm các cặp đã đánh dấu”.`, true);
    } catch (e) {
      msg($('qMsg'), 'Không đọc được ảnh: ' + esc(e.message || String(e)) + '. Bạn có thể gõ/dán chữ vào ô bên phải.');
    } finally { ocrBusy = false; }
  }

  const qBox = document.querySelector('.tk-quick'), qDrop = $('qDrop');
  qDrop.addEventListener('click', () => $('qFile').click());
  qDrop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('qFile').click(); } });
  $('qFile').addEventListener('change', () => { readImage($('qFile').files[0]); $('qFile').value = ''; });
  ['dragenter', 'dragover'].forEach(ev => qBox.addEventListener(ev, e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); qDrop.classList.add('drag'); } }));
  qBox.addEventListener('dragleave', e => { if (!qBox.contains(e.relatedTarget)) qDrop.classList.remove('drag'); });
  qBox.addEventListener('drop', e => {
    const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type));
    qDrop.classList.remove('drag');
    if (e.dataTransfer.files.length) { e.preventDefault(); if (f) readImage(f); else msg($('qMsg'), 'Chỉ nhận file ảnh (PNG, JPG…).'); }
  });
  document.addEventListener('paste', e => {
    if (tab() !== 'dong-cap' || !result || !e.clipboardData) return;
    const cd = e.clipboardData, txt = cd.getData('text/plain') || '';
    const inField = e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]');
    // Copy từ Excel/Word thường kèm cả ảnh — đang gõ trong ô thì ưu tiên dán chữ như bình thường.
    if (inField && txt) return;
    const f = [...(cd.files || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); readImage(f); return; }
    if (!inField && txt.trim()) { e.preventDefault(); $('qText').value = txt; qParse(); }
  });
  $('qText').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(qParse, 300); });
  $('qBody').addEventListener('change', e => {
    const tr = e.target.closest('[data-qi]'); if (!tr) return;
    const i = Number(tr.dataset.qi), r = qRows[i], k = e.target.dataset.qk; if (!r) return;
    if (k === 'inc') r.include = e.target.checked;
    else if (k === 'from' || k === 'to' || k === 'buoi') { r[k] = e.target.value; qStatus(i); }
  });
  $('qBody').addEventListener('click', e => {
    const b = e.target.closest('[data-qhelper]'); if (!b) return;
    const q = current(); if (!q) return;
    const [key, k] = b.dataset.qhelper.split('|').map(Number), r = qRows.find(x => x.key === key); if (!r) return;
    const name = r['m' + k].query.replace(HONOR, '').trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const h = { maNV: `__extra_${Date.now()}__`, hoTen: `${name} (ngoài DS thưởng)` };
    archive[q].extraHelpers = [...(archive[q].extraHelpers || []), h];
    r['v' + k] = h.maNV; r['m' + k] = { hits: [{ value: h.maNV, name }], mode: 'exact', query: name };
    touch(q); renderAll(); renderQuick();
  });
  $('qAdd').addEventListener('click', () => {
    const q = current(); if (!q) return;
    const ok = qRows.filter(r => r.include && qCheck(r).level !== 'no');
    if (!ok.length) { msg($('qMsg'), 'Chưa có dòng nào hợp lệ được đánh dấu.'); return; }
    const base = Date.now();
    archive[q].adjustments = [...(archive[q].adjustments || []), ...ok.map((r, i) => ({ id: base + i, maNV1: r.v1, maNV2: r.v2, dateFrom: r.from, dateTo: r.to, ...(r.buoi ? { buoi: r.buoi } : {}) }))];
    touch(q);
    qRows = qRows.filter(r => !ok.includes(r));
    if (!qRows.length) { $('qText').value = ''; resetThumb(); }
    renderQuick(); renderAll();
    msg($('qMsg'), `Đã thêm <b>${ok.length}</b> cặp vào ${E.quarterLabel(q)} (xem bảng bên dưới).` + (qRows.length ? ` Còn ${qRows.length} dòng chưa thêm — sửa rồi bấm Thêm lần nữa.` : ''), true);
  });
  $('qClear').addEventListener('click', () => { qRows = []; $('qText').value = ''; resetThumb(); msg($('qMsg'), ''); renderQuick(); });

  // ------------------------------------------------------------ xuất Excel (định dạng sẵn để gửi quản lý — cùng kiểu Thưởng quý GH / Thưởng bốc hàng)
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
  const XFMT = { money: '#,##0;-#,##0;"–"', int: '#,##0;-#,##0;"–"', k1: '#,##0.0;-#,##0.0;"–"' };
  // cột số lượt ('k1'): số chẵn hiện không có ",0", chỉ ngày đóng cặp (lượt chia đôi) mới có số lẻ
  const soLe = (t, v) => (t === 'k1' && typeof v === 'number' && Number.isInteger(v)) ? 'int' : t;
  // Một bảng đẹp: tiêu đề + giải thích + tiêu đề cột (1 hoặc 2 tầng) + dữ liệu + dòng tổng + ngày lập & chỗ ký.
  // cols: [{ h, t: 'stt'|'ma'|'name'|'text'|'int'|'money'|'k1', w, accent, hf (màu nền tiêu đề), sz }]; groups: [{ label, span, accent }] (span 1 = cột đứng 2 tầng)
  // muted(i) → chữ xám; to(i, c) → { fill, bold, color, t } tô riêng từng ô dữ liệu.
  function bangDep(wb, name, { title, sub, cols, groups, rows, total, muted, to, kyTen = true }) {
    const n = cols.length, aoa = [], merges = [], rowsH = [];
    aoa.push([title]); merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: n - 1 } }); rowsH.push({ hpt: 28 });
    aoa.push([sub]); merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: n - 1 } }); rowsH.push({ hpt: 34 });
    aoa.push([]); rowsH.push({ hpt: 6 });
    const headTop = aoa.length, headFill = [];
    const fillOf = (x, accent) => x.hf || (accent ? RED : NAVY);
    if (groups) {
      const top = [], bot = []; let c = 0;
      groups.forEach(g => {
        if (g.span === 1) { top.push(cols[c].h); bot.push(null); headFill[c] = fillOf(cols[c], cols[c].accent); merges.push({ s: { r: headTop, c }, e: { r: headTop + 1, c } }); c++; }
        else { top.push(g.label); for (let i = 1; i < g.span; i++) top.push(null); merges.push({ s: { r: headTop, c }, e: { r: headTop, c: c + g.span - 1 } }); for (let i = 0; i < g.span; i++) { bot.push(cols[c + i].h); headFill[c + i] = fillOf(cols[c + i], g.accent); } c += g.span; }
      });
      aoa.push(top, bot); rowsH.push({ hpt: 22 }, { hpt: 32 });
    } else { aoa.push(cols.map(x => x.h)); cols.forEach((x, c) => { headFill[c] = fillOf(x, x.accent); }); rowsH.push({ hpt: 40 }); }
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
      for (let i = 0; i < 4; i++) { aoa.push([]); rowsH.push({ hpt: 16 }); }
      [dateRow, signRow, signRow + 1].forEach((r, i) => {
        if (i) merges.push({ s: { r, c: 0 }, e: { r, c: half - 1 } });
        merges.push({ s: { r, c: half }, e: { r, c: n - 1 } });
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const put = (r, c, s) => { const ref = XLSX.utils.encode_cell({ r, c }); if (!ws[ref]) ws[ref] = { t: 's', v: '' }; ws[ref].s = s; };
    const cell = (t, { fill, bold, color, sz } = {}) => {
      const s = { font: { name: FONT, sz: sz || 11, bold: !!bold, color: { rgb: color || '1F2937' } }, border: BORDER,
        alignment: { vertical: 'center', horizontal: (t === 'name' || t === 'text') ? 'left' : (t === 'stt' || t === 'ma') ? 'center' : 'right', indent: (t === 'name' || t === 'text') ? 1 : 0, wrapText: t === 'text' } };
      if (fill) s.fill = { patternType: 'solid', fgColor: { rgb: fill } };
      if (XFMT[t]) s.numFmt = XFMT[t];
      return s;
    };
    put(0, 0, XST.title); put(1, 0, XST.sub);
    for (let r = headTop; r < headTop + headRows; r++) for (let c = 0; c < n; c++) put(r, c, XST.head(headFill[c] || NAVY));
    rows.forEach((row, i) => {
      const grey = muted && muted(i), dark = i % 2;
      cols.forEach((col, c) => {
        const o = Object.assign({ fill: col.accent ? (dark ? 'FBEAEA' : 'FDF3F3') : (dark ? 'F3F6FA' : null), bold: col.accent && !grey, color: grey ? '9CA3AF' : (col.accent ? '7F1D1D' : null), sz: col.sz }, (to && to(i, c)) || {});
        put(first + i, c, cell(soLe(o.t || col.t, row[c]), o));
      });
    });
    if (total) {
      const nameCol = Math.max(0, cols.findIndex(x => x.t === 'name'));
      cols.forEach((col, c) => put(totalRow, c, cell(c <= nameCol ? 'name' : soLe(col.t, total[c]), { fill: col.accent ? 'F5D0D0' : 'D9E4F2', bold: true, color: col.accent ? '7F1D1D' : NAVY, sz: col.sz })));
      if (nameCol > 0) merges.push({ s: { r: totalRow, c: 0 }, e: { r: totalRow, c: nameCol } });
    }
    if (kyTen) { put(dateRow, half, XST.date); put(signRow, 0, XST.sign); put(signRow, half, XST.sign); put(signRow + 1, 0, XST.signNote); put(signRow + 1, half, XST.signNote); }
    ws['!merges'] = merges;
    ws['!cols'] = cols.map(x => ({ wch: x.w }));
    ws['!rows'] = rowsH;
    ws['!margins'] = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    XLSX.utils.book_append_sheet(wb, ws, name);
    const idx = wb.SheetNames.length - 1;
    wb.Workbook = wb.Workbook || { Names: [] };
    wb.Workbook.Names.push({ Name: '_xlnm.Print_Titles', Sheet: idx, Ref: `'${name}'!$${headTop + 1}:$${headTop + headRows}` });
    (wb.__freeze = wb.__freeze || [])[idx] = { row: headTop + headRows, col: cols.findIndex(x => x.t === 'name') + 1 };
    (wb.__fitTall = wb.__fitTall || [])[idx] = rows.length <= 30;
  }
  // Thư viện không ghi được hướng giấy → sửa thẳng file .xlsx bằng JSZip: A4 ngang, vừa 1 trang bề ngang, căn giữa,
  // cố định hàng tiêu đề (+ cột họ tên) khi cuộn. Lỗi thì vẫn xuất file bình thường (chưa chỉnh trang in).
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
      const fr = freeze[i];
      if (fr) {
        const cell = XLSX.utils.encode_cell({ r: fr.row, c: fr.col });
        const pane = fr.col > 0 ? `<pane xSplit="${fr.col}" ySplit="${fr.row}" topLeftCell="${cell}" activePane="bottomRight" state="frozen"/>` : `<pane ySplit="${fr.row}" topLeftCell="${cell}" activePane="bottomLeft" state="frozen"/>`;
        x = x.replace(/<sheetView workbookViewId="0"\s*\/>/, `<sheetView workbookViewId="0">${pane}</sheetView>`);
      }
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

  function taoExcel() {
    const wb = XLSX.utils.book_new(), R = result.rules || RULES, M = result.months;
    const Q = E.quarterLabel(result.quarterKey).toUpperCase(), TEN = (document.title || 'Thưởng').toUpperCase();
    const vnd = v => Math.round(v).toLocaleString('vi-VN'), m0 = x => Math.round(x || 0);
    // cùng thứ tự với bảng trên trang: thưởng quý cao → thấp
    const list = [...result.perEmployee].sort((x, y) => (y.thuong - x.thuong) || x.hoTen.localeCompare(y.hoTen, 'vi'));
    const quyTac = `Số lượt ${NGUON_TEN} mỗi ngày  ·  Thưởng mỗi ngày = (số lượt − ${R.nguong}) × ${vnd(R.donGia)}đ khi trên ${R.nguong} lượt  ·  Thưởng quý = trung bình ${M.length} tháng`;
    const S = { stt: { h: 'STT', t: 'stt', w: 5 }, ma: { h: 'MÃ NV', t: 'ma', w: 9 }, ten: { h: 'HỌ VÀ TÊN', t: 'name', w: 26 } };
    const luotThang = e => e.monthlyDetail.reduce((a, m) => a + m.soKien, 0);

    // 1) Thưởng quý — bảng gửi quản lý
    bangDep(wb, 'Thưởng quý', {
      title: `BẢNG TỔNG HỢP ${TEN} ${Q}`, sub: `Kho vận CN.HCM  ·  ${quyTac}`,
      groups: [{ span: 1 }, { span: 1 }, { span: 1 }, { label: 'THƯỞNG THEO THÁNG (đ)', span: M.length }, { label: 'CẢ QUÝ', span: 3, accent: true }, { span: 1 }],
      cols: [S.stt, S.ma, S.ten, ...M.map(mk => ({ h: E.monthLabel(mk), t: 'money', w: 12 })),
        { h: 'Tổng lượt', t: 'k1', w: 10, accent: true }, { h: `Tổng ${M.length} tháng (đ)`, t: 'money', w: 13, accent: true }, { h: `Thưởng quý (đ)`, t: 'money', w: 14, accent: true }, { h: 'GHI CHÚ', t: 'text', w: 28 }],
      rows: list.map((e, i) => [i + 1, e.maNV, e.hoTen, ...e.monthlyDetail.map(m => m0(m.tongTien)), luotThang(e), m0(e.monthlyDetail.reduce((a, m) => a + m.tongTien, 0)), m0(e.thuong), e.ghiChu || '']),
      muted: i => !list[i].thuong,
      total: ['TỔNG CỘNG', null, null, ...M.map((mk, mi) => m0(list.reduce((a, e) => a + e.monthlyDetail[mi].tongTien, 0))), list.reduce((a, e) => a + luotThang(e), 0),
        m0(list.reduce((a, e) => a + e.monthlyDetail.reduce((s, m) => s + m.tongTien, 0), 0)), m0(list.reduce((a, e) => a + e.thuong, 0)), ''],
    });

    // 2) Mỗi tháng 1 sheet: số lượt từng ngày (ô xanh = trên ngưỡng, ô tím = ngày đóng cặp)
    const THU_X = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    M.forEach((mk, mi) => {
      const [y, mo] = mk.split('-').map(Number), soNgay = new Date(y, mo, 0).getDate(), pm = pairMap(mk);
      const days = Array.from({ length: soNgay }, (_, i) => i + 1);
      const ds = [...list].sort((a, b) => b.monthlyDetail[mi].tongTien - a.monthlyDetail[mi].tongTien || b.monthlyDetail[mi].soKien - a.monthlyDetail[mi].soKien || a.hoTen.localeCompare(b.hoTen, 'vi'));
      const val = v => (v ? Math.round(v * 10) / 10 : 0);
      bangDep(wb, E.monthLabel(mk), {
        title: `SỐ LƯỢT ${NGUON_TEN.toUpperCase()} THEO NGÀY — ${E.monthLabel(mk).toUpperCase()}/${y}`,
        sub: `Ô xanh = trên ${R.nguong} lượt (có thưởng)  ·  ${result.adjustments.length ? 'Ô tím = ngày đóng cặp (lượt chia đôi)  ·  ' : ''}Thành tiền = Σ (số lượt − ${R.nguong}) × ${vnd(R.donGia)}đ các ngày trên ${R.nguong} lượt`,
        cols: [S.stt, S.ma, { h: 'HỌ VÀ TÊN', t: 'name', w: 24 },
          ...days.map(d => { const w = new Date(y, mo - 1, d).getDay(); return { h: `${d}\n${THU_X[w]}`, t: 'k1', w: 5.2, sz: 10, hf: w === 0 ? '6B7F99' : null }; }),
          { h: 'TỔNG LƯỢT', t: 'k1', w: 9, accent: true }, { h: 'THÀNH TIỀN (đ)', t: 'money', w: 12, accent: true }],
        rows: ds.map((e, i) => { const m = e.monthlyDetail[mi]; return [i + 1, e.maNV, e.hoTen, ...days.map(d => val(m.counts32[d])), val(m.soKien), m0(m.tongTien)]; }),
        muted: i => !ds[i].monthlyDetail[mi].soKien,
        to: (i, c) => {
          const d = c - 2; if (d < 1 || d > soNgay) return null;
          const e = ds[i], v = e.monthlyDetail[mi].counts32[d] || 0, p = pm.has(`${e.maNV}|${d}`), over = v > R.nguong;
          const o = {};
          if (p) Object.assign(o, { fill: 'EDE9FE', color: '5B21B6', bold: over });
          else if (over) Object.assign(o, { fill: 'D1FAE5', color: '065F46', bold: true });
          return o;
        },
        total: ['TỔNG CỘNG', null, null, ...days.map(d => val(ds.reduce((a, e) => a + (e.monthlyDetail[mi].counts32[d] || 0), 0))), val(ds.reduce((a, e) => a + e.monthlyDetail[mi].soKien, 0)), m0(ds.reduce((a, e) => a + e.monthlyDetail[mi].tongTien, 0))],
        kyTen: false,
      });
    });

    // 3) Danh sách đóng cặp (nếu có)
    const byMa = {}; [...result.employees, ...helpers()].forEach(e => { byMa[e.maNV] = e; });
    const adjs = [...result.adjustments].sort((a, b) => a.dateFrom.localeCompare(b.dateFrom) || a.dateTo.localeCompare(b.dateTo));
    const dd = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
    if (adjs.length) bangDep(wb, 'Đóng cặp', {
      title: `DANH SÁCH ĐÓNG CẶP ${Q}`, sub: 'Những ngày 2 người đóng chung: số lượt trong ngày (hoặc buổi) được chia đôi cho mỗi người', kyTen: false,
      cols: [S.stt, { h: 'TỪ NGÀY', t: 'ma', w: 12 }, { h: 'ĐẾN NGÀY', t: 'ma', w: 12 }, { h: 'BUỔI', t: 'ma', w: 9 }, { h: 'NHÂN VIÊN 1', t: 'name', w: 30 }, { h: 'NHÂN VIÊN 2', t: 'name', w: 30 }, { h: 'GHI CHÚ', t: 'text', w: 22 }],
      rows: adjs.map((a, i) => [i + 1, dd(a.dateFrom), dd(a.dateTo), BUOI[a.buoi || ''], displayName(byMa[a.maNV1]) || a.maNV1, displayName(byMa[a.maNV2]) || a.maNV2, result.skippedAdj.includes(a.id) ? 'Không áp dụng (ngoài quý / thiếu người)' : '']),
      muted: i => result.skippedAdj.includes(adjs[i].id),
    });
    return { wb, fname: `${FILE_PREFIX}_${result.quarterKey}.xlsx` };
  }
  $('tkExport').addEventListener('click', async () => {
    if (!result) return;
    const { wb, fname } = taoExcel();
    try { luuFile(await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []), fname); }
    catch (e) { XLSX.writeFile(wb, fname); }
  });
  // để kiểm thử file Excel (không dùng trong giao diện)
  window.__khoExcel = async () => { const { wb, fname } = taoExcel(); return { fname, bytes: await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []) }; };

  if (location.hash === '#nap-du-lieu') uploadOpen = true;
  renderAll();
  pullFromRepo();
})();
