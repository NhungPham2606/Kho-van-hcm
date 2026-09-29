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
  const VER = '20260929g';
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
    const months = result.months, list = filtered();
    $('tqHead').innerHTML = `<th>Mã NV</th><th style="min-width:150px">Họ và tên</th>${months.map(mk => `<th class="r">${E.monthLabel(mk)}</th>`).join('')}<th class="r">Thưởng quý</th><th style="min-width:200px">Ghi chú (từ file)</th>`;
    let html = list.map(e => `<tr><td>${esc(e.maNV)}</td><td class="name">${esc(e.hoTen)}</td>${e.monthlyDetail.map(m => `<td class="r">${money(m.tongTien)}</td>`).join('')}<td class="r money">${money(e.thuong)}</td><td class="note">${esc(e.ghiChu)}</td></tr>`).join('');
    if (!search) {
      html += `<tr class="total"><td colspan="2">TỔNG CỘNG</td>${months.map(mk => `<td class="r">${money(result.perEmployee.reduce((s, e) => s + ((e.monthlyDetail.find(m => m.monthKey === mk) || {}).tongTien || 0), 0))}</td>`).join('')}<td class="r">${money(result.perEmployee.reduce((s, e) => s + e.thuong, 0))}</td><td></td></tr>`;
    }
    $('tqBody').innerHTML = html;
  }
  function renderGrid() {
    if (!result) return;
    if (monthIdx >= result.months.length) monthIdx = 0;
    $('ttMonths').innerHTML = result.months.map((mk, i) => `<button type="button" class="b sm${i === monthIdx ? ' pri' : ''}" data-m="${i}">${E.monthLabel(mk)}</button>`).join('');
    const mk = result.months[monthIdx], [y, m] = mk.split('-').map(Number);
    const paired = new Map();
    result.adjustments.forEach(a => { for (let d = 1; d <= 31; d++) { const k = `${y}-${E.pad2(m)}-${E.pad2(d)}`; if (k >= a.dateFrom && k <= a.dateTo) { paired.set(`${a.maNV1}|${d}`, a.maNV2); paired.set(`${a.maNV2}|${d}`, a.maNV1); } } });
    const byMa = {}; [...result.employees, ...helpers()].forEach(e => { byMa[e.maNV] = e; });
    $('ttHead').innerHTML = `<th>Mã NV</th><th style="min-width:140px">Họ và tên</th>${Array.from({ length: 31 }, (_, i) => `<th class="r">${i + 1}</th>`).join('')}<th class="r">Tổng lượt</th><th class="r">Tổng tiền</th>`;
    $('ttBody').innerHTML = filtered().map(e => {
      const md = e.monthlyDetail[monthIdx];
      const cells = md.counts32.slice(1, 32).map((c, i) => {
        const p = paired.get(`${e.maNV}|${i + 1}`);
        const cls = ['r', c > result.rules.nguong ? 'over' : '', p ? 'pair' : ''].join(' ').trim();
        return `<td class="${cls}"${p ? ` title="Đóng cặp cùng: ${esc(displayName(byMa[p]))}"` : ''}>${numSmart(c)}</td>`;
      }).join('');
      return `<tr><td>${esc(e.maNV)}</td><td class="name">${esc(e.hoTen)}</td>${cells}<td class="r bold">${numSmart(md.soKien)}</td><td class="r money">${money(md.tongTien)}</td></tr>`;
    }).join('');
  }
  function renderAdjust() {
    if (!result) return;
    const opts = [...result.employees, ...helpers()];
    const optHtml = '<option value="">-- chọn --</option>' + opts.map(e => `<option value="${esc(e.maNV)}">${esc(displayName(e))}</option>`).join('');
    ['adj1', 'adj2'].forEach(id => { const v = $(id).value; $(id).innerHTML = optHtml; $(id).value = v; });
    const byMa = {}; opts.forEach(e => { byMa[e.maNV] = e; });
    const adjs = result.adjustments;
    $('adjList').innerHTML = adjs.length ? adjs.map(a => `<tr><td>${esc(displayName(byMa[a.maNV1]) || a.maNV1)}</td><td>${esc(displayName(byMa[a.maNV2]) || a.maNV2)}</td><td>${a.dateFrom}</td><td>${a.dateTo}</td><td><button type="button" class="b del sm" data-rm="${a.id}">Xóa</button></td></tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:20px">Chưa có điều chỉnh nào</td></tr>';
    $('helperList').innerHTML = helpers().map(h => `<span class="chip">${esc(h.hoTen)}${DEFAULT_EXTRA_HELPERS.some(d => d.maNV === h.maNV) ? '' : ` <button type="button" data-rmh="${esc(h.maNV)}" aria-label="Bỏ">×</button>`}</span>`).join('');
  }
  function renderAll() { recompute(); renderTop(); renderStats(); renderTabs(); renderThuong(); renderGrid(); renderAdjust(); }
  document.querySelectorAll('[data-rule]').forEach(el => { el.textContent = E.RULES[el.dataset.rule].toLocaleString('vi-VN'); });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { uploadOpen = true; renderTop(); $('tkUpload').scrollIntoView({ behavior: 'smooth' }); return; }
    if (location.hash === '#huong-dan') { renderTop(); $('huong-dan').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTabs();
  });

  // ------------------------------------------------------------ sự kiện
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-q],[data-m],[data-rm],[data-rmh]');
    if (!t) return;
    if (t.dataset.q) { sel = t.dataset.q; persistLocal(); renderAll(); }
    else if (t.dataset.m) { monthIdx = Number(t.dataset.m); renderGrid(); }
    else if (t.dataset.rm) { const q = current(); archive[q].adjustments = archive[q].adjustments.filter(a => String(a.id) !== t.dataset.rm); touch(q); renderAll(); }
    else if (t.dataset.rmh) { const q = current(); archive[q].extraHelpers = (archive[q].extraHelpers || []).filter(h => h.maNV !== t.dataset.rmh); touch(q); renderAll(); }
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
    const a1 = $('adj1').value, a2 = $('adj2').value, f = $('adjFrom').value, t = $('adjTo').value;
    if (!a1 || !a2 || !f || !t) { msg($('adjMsg'), 'Chọn đủ 2 người và khoảng ngày.'); return; }
    if (a1 === a2) { msg($('adjMsg'), 'Hai người phải khác nhau.'); return; }
    if (f > t) { msg($('adjMsg'), '"Từ ngày" phải trước "Đến ngày".'); return; }
    archive[q].adjustments = [...(archive[q].adjustments || []), { id: Date.now(), maNV1: a1, maNV2: a2, dateFrom: f, dateTo: t }];
    touch(q); msg($('adjMsg'), ''); ['adj1', 'adj2', 'adjFrom', 'adjTo'].forEach(id => { $(id).value = ''; }); renderAll();
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
