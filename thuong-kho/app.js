// Trang "Thưởng kho HCM": nạp file quý (đọc trong worker), lưu kết quả gộp theo
// quý, khai báo đóng cặp, xem/xuất thưởng. Lưu trong trình duyệt và — nếu máy
// đã kết nối hệ thống (token ở mục Báo cáo giao hàng → Cập nhật dữ liệu) —
// đồng bộ lên kho riêng tư (thư mục thuong-kho/) để máy khác cũng xem được.
(function () {
  'use strict';
  const root = document.getElementById('tk');
  if (!root) return;
  const E = window.KhoEngine;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-thuongkho-v1', LS_SEL = 'kvh-thuongkho-sel', TOKEN_KEY = 'kvh-gh-token';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
  const num = n => Math.round(n || 0).toLocaleString('vi-VN');
  const numSmart = n => !n ? '' : (Number.isInteger(n) ? n.toLocaleString('vi-VN') : n.toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

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

  // ------------------------------------------------------------ lưu trữ
  let archive = {};
  try { archive = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  let repoSha = {};          // qKey -> sha file trên hệ thống
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này.';
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
        const local = archive[q];
        const meta = await gh(`/contents/${DIR}/${it.name}?ref=main`);
        const remote = JSON.parse(b64dec(meta.content || '') || '{}');
        if (!local || (remote.savedAt || '') >= (local.savedAt || '')) archive[q] = remote;
      }
      // quý chỉ có trên máy này -> đẩy lên
      for (const q of Object.keys(archive)) if (!repoSha[q]) scheduleSave(q, 0);
      syncMsg = `Đã đồng bộ với hệ thống (${OWNER}/${REPO}/${DIR}) — mở trên máy khác cũng thấy.`;
      persistLocal(); renderAll();
    } catch (e) {
      syncMsg = e.status === 401 ? 'Token hết hạn/không đúng — kết nối lại ở mục Báo cáo giao hàng → Cập nhật dữ liệu. Dữ liệu vẫn lưu trên máy này.'
        : 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.';
      renderStatus();
    }
  }
  function scheduleSave(q, delay = 1500) {
    if (!token) return;
    clearTimeout(saveTimers[q]);
    saveTimers[q] = setTimeout(async () => {
      try {
        const body = { message: `Thuong kho ${q} (tu web)`, content: b64enc(JSON.stringify(archive[q])), branch: 'main' };
        if (repoSha[q]) body.sha = repoSha[q];
        const r = await gh(`/contents/${DIR}/${q}.json`, { method: 'PUT', body: JSON.stringify(body) });
        repoSha[q] = r.content.sha;
        syncMsg = `Đã lưu ${E.quarterLabel(q)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
      } catch (e) {
        syncMsg = `Chưa lưu được ${E.quarterLabel(q)} lên hệ thống (${e.message}) — vẫn còn trên máy này.`;
        if (e.status === 409 || e.status === 422) { delete repoSha[q]; }
      }
      renderStatus();
    }, delay);
  }
  function touch(q) { archive[q].savedAt = new Date().toISOString(); persistLocal(); scheduleSave(q); }

  // ------------------------------------------------------------ trạng thái xem
  const quarters = () => Object.keys(archive).sort().reverse();
  const current = () => archive[sel] ? sel : (quarters()[0] || '');
  let result = null, monthIdx = 0, search = '';

  function recompute() {
    const q = current();
    result = q ? E.computeResult(archive[q].cached, q, archive[q].adjustments || []) : null;
  }
  function helpers() {
    const q = current(); const custom = (q && archive[q].extraHelpers) || [];
    const out = [...DEFAULT_EXTRA_HELPERS];
    custom.forEach(h => { if (!out.some(m => m.maNV === h.maNV)) out.push(h); });
    return out;
  }
  const displayName = e => !e ? '' : (e.maNV && !String(e.maNV).startsWith('__extra_') ? `${e.maNV} - ${e.hoTen}` : e.hoTen);

  // ------------------------------------------------------------ render
  function renderStatus() {
    $('tkStore').textContent = syncMsg;
    const qs = quarters();
    $('tkQuarterChips').innerHTML = qs.length ? qs.map(q => `<a class="btn${q === current() ? ' primary' : ''}" href="#thuong-quy" data-q="${q}">${E.quarterLabel(q)}</a>`).join('')
      : '<span class="note">Chưa có quý nào — <a href="#nap-du-lieu">nạp file quý đầu tiên</a>.</span>';
  }
  function renderQbar() {
    const qs = quarters(), cur = current();
    const html = qs.map(q => `<button type="button" class="btn${q === cur ? ' primary' : ''}" data-q="${q}">${E.quarterLabel(q)}</button>`).join('')
      + (cur ? `<button type="button" class="linkbtn tk-del" data-del="${cur}">Xoá ${E.quarterLabel(cur)}</button>` : '');
    document.querySelectorAll('[data-tk-qbar]').forEach(el => { el.innerHTML = html; });
    document.querySelectorAll('[data-tk-need]').forEach(el => { el.hidden = !result; });
    document.querySelectorAll('[data-tk-empty]').forEach(el => { el.hidden = !!result; });
  }
  function renderThuong() {
    if (!result) return;
    const months = result.months;
    const q = search.trim().toLowerCase();
    const list = q ? result.perEmployee.filter(e => e.hoTen.toLowerCase().includes(q) || e.maNV.toLowerCase().includes(q)) : result.perEmployee;
    const tong = result.perEmployee.reduce((s, e) => s + e.thuong, 0);
    const soKien = result.perEmployee.reduce((s, e) => s + e.monthlyDetail.reduce((a, m) => a + m.soKien, 0), 0);
    $('tkTiles').innerHTML = [['Quý', E.quarterLabel(result.quarterKey)], ['Nhân viên được thưởng', result.perEmployee.length], ['Tổng lượt (quý)', num(soKien)], ['Tổng thưởng quý', money(tong)]]
      .map(([a, b]) => `<div class="tile"><div class="tile-label">${a}</div><div class="tile-value">${b}</div></div>`).join('');
    $('tkInfo').textContent = `${result.fileName} · ${result.soDongTho.toLocaleString('vi-VN')} dòng thô` + (result.payrollFiltered ? ` · lọc theo sheet THƯỞNG (${result.perEmployee.length}/${result.employees.length} NV)` : '') + (result.adjustments.length ? ` · ${result.adjustments.length} điều chỉnh đóng cặp` : '');
    $('tkHead').innerHTML = `<th>Mã NV</th><th>Họ và tên</th>${months.map(mk => `<th>${E.monthLabel(mk)}</th>`).join('')}<th>Thưởng quý</th><th>Ghi chú</th>`;
    $('tkBody').innerHTML = list.map(e => `<tr><td>${esc(e.maNV)}</td><td>${esc(e.hoTen)}</td>${e.monthlyDetail.map(m => `<td>${money(m.tongTien)}</td>`).join('')}<td><b>${money(e.thuong)}</b></td><td style="text-align:left;white-space:normal;min-width:160px">${esc(e.ghiChu)}</td></tr>`).join('');
    $('tkFoot').innerHTML = q ? '' : `<td>TỔNG CỘNG</td><td></td>${months.map(mk => `<td>${money(result.perEmployee.reduce((s, e) => s + (e.monthlyDetail.find(m => m.monthKey === mk) || {}).tongTien || 0, 0))}</td>`).join('')}<td>${money(tong)}</td><td></td>`;
  }
  function renderGrid() {
    if (!result) return;
    if (monthIdx >= result.months.length) monthIdx = 0;
    $('tkMonthTabs').innerHTML = result.months.map((mk, i) => `<button type="button" class="btn${i === monthIdx ? ' primary' : ''}" data-m="${i}">${E.monthLabel(mk)}</button>`).join('');
    const mk = result.months[monthIdx];
    const [y, m] = mk.split('-').map(Number);
    const paired = new Map();
    result.adjustments.forEach(a => { for (let d = 1; d <= 31; d++) { const k = `${y}-${E.pad2(m)}-${E.pad2(d)}`; if (k >= a.dateFrom && k <= a.dateTo) { paired.set(`${a.maNV1}|${d}`, a.maNV2); paired.set(`${a.maNV2}|${d}`, a.maNV1); } } });
    const byMa = {}; [...result.employees, ...helpers()].forEach(e => { byMa[e.maNV] = e; });
    $('tkGridHead').innerHTML = `<th>Mã NV</th><th>Họ và tên</th>${Array.from({ length: 31 }, (_, i) => `<th>${i + 1}</th>`).join('')}<th>Tổng lượt</th><th>Tiền</th>`;
    $('tkGridBody').innerHTML = result.perEmployee.map(e => {
      const md = e.monthlyDetail[monthIdx];
      const cells = md.counts32.slice(1, 32).map((c, i) => {
        const p = paired.get(`${e.maNV}|${i + 1}`);
        const cls = [c > result.rules.nguong ? 'over' : '', p ? 'pair' : ''].join(' ').trim();
        return `<td${cls ? ` class="${cls}"` : ''}${p ? ` title="Đóng cặp cùng: ${esc(displayName(byMa[p]))}"` : ''}>${numSmart(c)}</td>`;
      }).join('');
      return `<tr><td>${esc(e.maNV)}</td><td>${esc(e.hoTen)}</td>${cells}<td><b>${numSmart(md.soKien)}</b></td><td><b>${money(md.tongTien)}</b></td></tr>`;
    }).join('');
  }
  function renderAdjust() {
    if (!result) return;
    const opts = [...result.employees, ...helpers()];
    const optHtml = '<option value="">— chọn —</option>' + opts.map(e => `<option value="${esc(e.maNV)}">${esc(displayName(e))}</option>`).join('');
    ['adj1', 'adj2'].forEach(id => { const v = $(id).value; $(id).innerHTML = optHtml; $(id).value = v; });
    const [m0, , m2] = result.months;
    $('adjFrom').min = $('adjTo').min = `${m0}-01`; $('adjFrom').max = $('adjTo').max = `${m2}-31`;
    const byMa = {}; opts.forEach(e => { byMa[e.maNV] = e; });
    const adjs = result.adjustments;
    $('adjList').innerHTML = adjs.length ? adjs.map(a => `<tr><td>${esc(displayName(byMa[a.maNV1]) || a.maNV1)}</td><td>${esc(displayName(byMa[a.maNV2]) || a.maNV2)}</td><td>${a.dateFrom}</td><td>${a.dateTo}</td><td><button type="button" class="linkbtn" data-rm="${a.id}">Xoá</button></td></tr>`).join('')
      : '<tr><td colspan="5" class="note">Chưa có điều chỉnh nào.</td></tr>';
    $('helperList').innerHTML = helpers().map(h => `<span class="pill warn">${esc(h.hoTen)}${DEFAULT_EXTRA_HELPERS.some(d => d.maNV === h.maNV) ? '' : ` <button type="button" class="linkbtn" data-rmh="${esc(h.maNV)}">×</button>`}</span>`).join(' ');
  }
  function renderAll() {
    recompute(); renderStatus(); renderQbar(); renderThuong(); renderGrid(); renderAdjust();
  }
  document.querySelectorAll('[data-rule]').forEach(el => { el.textContent = E.RULES[el.dataset.rule].toLocaleString('vi-VN'); });

  // ------------------------------------------------------------ sự kiện chung
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-q],[data-del],[data-m],[data-rm],[data-rmh]');
    if (!t) return;
    if (t.dataset.q) { sel = t.dataset.q; persistLocal(); renderAll(); }
    else if (t.dataset.del) {
      const q = t.dataset.del;
      if (!confirm(`Xoá toàn bộ dữ liệu ${E.quarterLabel(q)} (cả khai báo đóng cặp)${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
      delete archive[q]; if (sel === q) sel = ''; persistLocal();
      if (token && repoSha[q]) gh(`/contents/${DIR}/${q}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa thuong kho ${q} (tu web)`, sha: repoSha[q], branch: 'main' }) }).then(() => { delete repoSha[q]; }).catch(() => {});
      renderAll();
    }
    else if (t.dataset.m) { monthIdx = Number(t.dataset.m); renderGrid(); }
    else if (t.dataset.rm) { const q = current(); archive[q].adjustments = archive[q].adjustments.filter(a => String(a.id) !== t.dataset.rm); touch(q); renderAll(); }
    else if (t.dataset.rmh) { const q = current(); archive[q].extraHelpers = (archive[q].extraHelpers || []).filter(h => h.maNV !== t.dataset.rmh); touch(q); renderAll(); }
  });
  $('tkSearch').addEventListener('input', e => { search = e.target.value; renderThuong(); });

  // ------------------------------------------------------------ nạp file
  let pending = null;
  function setLoad(html, kind) { const el = $('tkLoadStatus'); el.hidden = !html; el.className = 'up-status' + (kind ? ' ' + kind : ''); el.innerHTML = html || ''; }
  function handleFile(file) {
    if (!file) return;
    $('tkPending').hidden = true; pending = null;
    $('tkDropTitle').textContent = 'Đã chọn file';
    $('tkDropSub').innerHTML = `<span class="dz-file">📄 ${esc(file.name)}</span>`;
    setLoad('⏳ Đang đọc file… (file lớn có thể mất 20–60 giây)');
    const reader = new FileReader();
    reader.onload = ev => {
      const w = new Worker('worker.js?v=20260929e');
      w.onmessage = m => {
        if (m.data.step) { setLoad('⏳ ' + esc(m.data.step)); return; }
        w.terminate();
        if (!m.data.ok) { setLoad('❌ ' + esc(m.data.error), 'bad'); return; }
        pending = m.data.cached;
        setLoad('');
        const vols = E.monthVolumes(pending);
        $('tkPendingInfo').innerHTML = `Đã đọc <b>${pending.soDongTho.toLocaleString('vi-VN')}</b> dòng thô, <b>${pending.employees.length}</b> nhân viên${pending.payrollMaNV ? ` (sheet THƯỞNG: ${pending.payrollMaNV.length} NV)` : ''}. Số lượt theo tháng trong file (có thể lẫn vài ngày của quý kề bên):`;
        const kk = (pending.khongKhop || []).filter(([n]) => n);
        $('tkPendingInfo').innerHTML += kk.length ? `<details class="up-help" style="margin:8px 0"><summary>${kk.length} tên / username trong dữ liệu không khớp "bảng mã nv" (không được tính) — bấm để soát</summary><p class="note">Thường là người ngoài danh sách thưởng. Nếu thấy nhân viên của mình ở đây, thêm dòng vào "bảng mã nv" (cột B ghi đúng như dữ liệu) rồi nạp lại.</p><ol>${kk.map(([n, c]) => `<li>${esc(n)} — ${c.toLocaleString('vi-VN')} lượt</li>`).join('')}</ol></details>` : '';
        $('tkVols').innerHTML = vols.map(v => `<tr><td>${E.monthLabel(v.monthKey)}/${v.monthKey.split('-')[0]}</td><td style="text-align:right">${num(v.total)}</td></tr>`).join('');
        const sug = E.suggestQuarter(pending);
        $('tkPendingQ').innerHTML = E.quartersOf(pending).map(q => `<option value="${q}"${q === sug ? ' selected' : ''}>${E.quarterLabel(q)}${archive[q] ? ' (đã có — sẽ thay)' : ''}</option>`).join('');
        $('tkPending').hidden = false;
      };
      w.onerror = err => { w.terminate(); setLoad('❌ Lỗi đọc file: ' + esc(err.message || ''), 'bad'); };
      w.postMessage({ buf: ev.target.result, fileName: file.name }, [ev.target.result]);
    };
    reader.readAsArrayBuffer(file);
  }
  const dz = $('tkDrop'), fi = $('tkFile');
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { handleFile(fi.files[0]); fi.value = ''; });
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => handleFile(e.dataTransfer.files[0]));
  $('tkCancel').addEventListener('click', () => { pending = null; $('tkPending').hidden = true; });
  $('tkConfirm').addEventListener('click', () => {
    if (!pending) return;
    const q = $('tkPendingQ').value;
    const old = archive[q] || {};
    archive[q] = { cached: pending, adjustments: old.adjustments || [], extraHelpers: old.extraHelpers || [] };
    sel = q; pending = null; $('tkPending').hidden = true;
    touch(q); renderAll();
    setLoad(`✅ Đã tính ${E.quarterLabel(q)} — xem ở mục <a href="#thuong-quy">Thưởng quý</a>. Nhớ khai báo <a href="#dong-cap">đóng cặp</a> nếu có.`, 'good');
  });

  // ------------------------------------------------------------ đóng cặp
  function adjMsg(html, kind) { const el = $('adjStatus'); el.hidden = !html; el.className = 'up-status' + (kind ? ' ' + kind : ''); el.innerHTML = html || ''; }
  $('adjAdd').addEventListener('click', () => {
    const q = current(); if (!q) return;
    const a1 = $('adj1').value, a2 = $('adj2').value, f = $('adjFrom').value, t = $('adjTo').value;
    if (!a1 || !a2 || !f || !t) { adjMsg('Chọn đủ 2 người và khoảng ngày.', 'bad'); return; }
    if (a1 === a2) { adjMsg('Hai người phải khác nhau.', 'bad'); return; }
    if (f > t) { adjMsg('"Từ ngày" phải trước "Đến ngày".', 'bad'); return; }
    archive[q].adjustments = [...(archive[q].adjustments || []), { id: Date.now(), maNV1: a1, maNV2: a2, dateFrom: f, dateTo: t }];
    touch(q); adjMsg(''); ['adj1', 'adj2', 'adjFrom', 'adjTo'].forEach(id => { $(id).value = ''; }); renderAll();
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
    adjMsg(`Đã nạp ${add.length} điều chỉnh` + (skip ? ` — bỏ qua ${skip} dòng không khớp tên nhân viên trong quý này` : '') + (add.length === 0 && !skip ? ' (đã có đủ từ trước)' : '') + '.', skip ? 'bad' : 'good');
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

  renderAll();
  pullFromRepo();
})();
