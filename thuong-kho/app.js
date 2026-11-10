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
  const LS_KEY = 'kvh-thuongkho-v1', LS_SEL = 'kvh-thuongkho-sel', TOKEN_KEY = 'kvh-gh-token';
  const VER = '20261110a';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
  const num = n => Math.round(n || 0).toLocaleString('vi-VN');
  const numSmart = n => !n ? '' : (Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const msg = (el, html, ok) => { el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };

  // Người đóng cặp ngoài danh sách thưởng (theo ghi chú file gốc: Thoa đóng cùng vẫn chia 2).
  const DEFAULT_EXTRA_HELPERS = [{ maNV: '__extra_thoa__', hoTen: 'Thoa (ngoài DS thưởng)' }];
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
        const body = { message: `Thuong kho ${q} (tu web)`, content: b64enc(JSON.stringify(archive[q])), branch: 'main' };
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

  function recompute() { const q = current(); result = q ? E.computeResult(archive[q].cached, q, archive[q].adjustments || []) : null; }
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
      + (result.payrollFiltered ? ` · Đã lọc theo sheet "THƯỞNG" (${result.perEmployee.length}/${result.employees.length} nhân viên)` : '');
    $('tkSync').textContent = syncMsg;
  }
  function renderStats() {
    if (!result) return;
    $('stNV').textContent = result.employees.length;
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
  function renderGrid() {
    if (!result) return;
    if (monthIdx >= result.months.length) monthIdx = 0;
    $('ttMonths').innerHTML = result.months.map((mk, i) => `<button type="button" class="b sm${i === monthIdx ? ' pri' : ''}" data-m="${i}">${E.monthLabel(mk)}</button>`).join('');
    const mk = result.months[monthIdx], [y, m] = mk.split('-').map(Number);
    const paired = new Map();
    result.adjustments.forEach(a => {
      if (result.skippedAdj.includes(a.id)) return;
      for (let d = 1; d <= 31; d++) {
        const k = `${y}-${E.pad2(m)}-${E.pad2(d)}`;
        if (k >= a.dateFrom && k <= a.dateTo) {
          [[a.maNV1, a.maNV2], [a.maNV2, a.maNV1]].forEach(([u, o]) => { const key = `${u}|${d}`; paired.set(key, [...(paired.get(key) || []), { o, b: a.buoi || '' }]); });
        }
      }
    });
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
  document.querySelectorAll('[data-rule]').forEach(el => { el.textContent = E.RULES[el.dataset.rule].toLocaleString('vi-VN'); });
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
    if (token && repoSha[q]) gh(`/contents/${DIR}/${q}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa thuong kho ${q} (tu web)`, sha: repoSha[q], branch: 'main' }) }).then(() => { delete repoSha[q]; }).catch(() => {});
    renderAll();
  });

  // ------------------------------------------------------------ nạp file
  function handleFile(file) {
    if (!file) return;
    msg($('tkUpMsg'), '');
    $('tkZoneTitle').textContent = 'Đang xử lý... (file lớn, có thể mất khoảng 20–60 giây)';
    $('tkZoneSub').textContent = file.name;
    const reset = () => { $('tkZoneTitle').textContent = 'Tải file Excel thưởng kho theo quý (.xlsx)'; $('tkZoneSub').innerHTML = 'File cần đúng 2 sheet: <b>Bảng check kiện hàng</b>, <b>bảng mã nv</b>. Nếu file có thêm sheet <b>THƯỞNG</b>, trang sẽ lấy đúng danh sách Mã NV trong đó để lọc kết quả.'; };
    const reader = new FileReader();
    reader.onload = ev => {
      const w = new Worker(`worker.js?v=${VER}`);
      w.onmessage = m => {
        if (m.data.step) { $('tkZoneTitle').textContent = m.data.step; return; }
        w.terminate(); reset();
        if (!m.data.ok) { msg($('tkUpMsg'), esc(m.data.error)); return; }
        pending = m.data.cached;
        const vols = E.monthVolumes(pending);
        $('tkPendingInfo').innerHTML = `Đã đọc <b>${pending.soDongTho.toLocaleString('vi-VN')}</b> dòng thô, <b>${pending.employees.length}</b> nhân viên${pending.payrollMaNV ? ` (sheet THƯỞNG: ${pending.payrollMaNV.length} NV)` : ''}. Số lượt bốc/đóng hàng theo từng tháng tìm thấy trong file (có thể lẫn vài ngày đầu/cuối quý kề bên):`;
        $('tkVols').innerHTML = vols.map(v => `<tr><td>${E.monthLabel(v.monthKey)}/${v.monthKey.split('-')[0]}</td><td class="r">${num(v.total)}</td></tr>`).join('');
        const kk = (pending.khongKhop || []).filter(([n]) => n);
        $('tkUnmatched').innerHTML = kk.length ? `<details style="font-size:12px;margin-bottom:8px"><summary style="cursor:pointer;color:#1a56db">${kk.length} tên / username trong dữ liệu không khớp "bảng mã nv" (không được tính) — bấm để soát</summary><div class="muted" style="margin:6px 0">Thường là người ngoài danh sách thưởng. Nếu thấy nhân viên của mình ở đây, thêm dòng vào "bảng mã nv" (cột B ghi đúng như dữ liệu) rồi nạp lại.</div><ol style="margin:0;padding-left:20px">${kk.map(([n, c]) => `<li>${esc(n)} — ${c.toLocaleString('vi-VN')} lượt</li>`).join('')}</ol></details>` : '';
        const sug = E.suggestQuarter(pending);
        $('tkPendingQ').innerHTML = E.quartersOf(pending).map(q => `<option value="${q}"${q === sug ? ' selected' : ''}>${E.quarterLabel(q)}${archive[q] ? ' (đã có — sẽ thay)' : ''}</option>`).join('');
        renderTop();
      };
      w.onerror = err => { w.terminate(); reset(); msg($('tkUpMsg'), 'Lỗi đọc file: ' + esc(err.message || '')); };
      w.postMessage({ buf: ev.target.result, fileName: file.name }, [ev.target.result]);
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

  // ------------------------------------------------------------ xuất Excel
  $('tkExport').addEventListener('click', () => {
    if (!result) return;
    const wb = XLSX.utils.book_new();
    const width = aoa => { const w = []; aoa.forEach(r => r.forEach((c, i) => { w[i] = Math.max(w[i] || 8, Math.min((c == null ? 0 : String(c).length) + 2, 42)); })); return w.map(x => ({ wch: x })); };
    result.months.forEach((mk, mi) => {
      const header = ['Mã NV', 'Họ và tên', ...Array.from({ length: 31 }, (_, i) => i + 1), 'Tổng', 'Thành tiền'];
      const body = result.perEmployee.map(e => { const m = e.monthlyDetail[mi]; return [e.maNV, e.hoTen, ...m.counts32.slice(1, 32), m.soKien, m.tongTien]; });
      const aoa = [[`Tổng số lượt (Tạo kiện + Bốc hàng + Đóng hàng) theo Mã NV - ${E.monthLabel(mk)}`], [], header, ...body];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = width([header, ...body]);
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
      XLSX.utils.book_append_sheet(wb, ws, E.monthLabel(mk));
    });
    const th = [['Mã Nv', 'Họ và Tên', 'Thành tiền', 'Ghi Chú'], ...result.perEmployee.map(e => [e.maNV, e.hoTen, Math.round(e.thuong), e.ghiChu || null]),
      ['Tổng cộng', null, Math.round(result.perEmployee.reduce((s, e) => s + e.thuong, 0)), null]];
    const wsT = XLSX.utils.aoa_to_sheet(th); wsT['!cols'] = width(th);
    XLSX.utils.book_append_sheet(wb, wsT, 'THƯỞNG');
    XLSX.writeFile(wb, `ThuongKho_${result.quarterKey}.xlsx`);
  });

  if (location.hash === '#nap-du-lieu') uploadOpen = true;
  renderAll();
  pullFromRepo();
})();
