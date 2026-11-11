// Trang "Thưởng bốc hàng quý": thả file nhập hàng của các văn phòng → đọc từng đợt (boc-engine.js) → chọn quý →
// bảng tổng thưởng theo Mã NV. Sửa tay từng đợt (thêm/bớt người, số kiện), bỏ tick đợt không tính.
// Kết quả theo quý lưu trên trình duyệt và — nếu máy đã kết nối hệ thống — đồng bộ lên kho riêng tư (thư mục thuong-boc/).
(function () {
  'use strict';
  const root = document.getElementById('bh');
  if (!root) return;
  const E = window.BocEngine;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-thuongboc-v1', LS_SEL = 'kvh-thuongboc-sel', TOKEN_KEY = 'kvh-gh-token', CD_KEY = 'kvh-thuongboc-caidat';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = n => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';
  const num = n => Math.round(n || 0).toLocaleString('vi-VN');
  const k1 = n => (n || 0).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const msg = (el, html, ok) => { el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const vnDate = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  const fold = E.fold;
  const pkey = p => p.ma || E.key(p.ten);

  // ------------------------------------------------------------ lưu trữ + đồng bộ (giống Thưởng quý GH)
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

  // ------------------------------------------------------------ cài đặt: nhớ văn phòng theo Mã NV (để tự đoán file không ghi tên văn phòng)
  let caiDat = {}; try { caiDat = JSON.parse(localStorage.getItem(CD_KEY) || '{}'); } catch (e) {}
  let cdSha = null;
  async function pullCaiDat() {
    if (!token) return;
    try {
      const meta = await gh(`/contents/${DIR}/cai-dat.json?ref=main&t=${Date.now()}`);
      cdSha = meta.sha;
      const remote = JSON.parse(b64dec(meta.content || '') || '{}');
      if ((remote.savedAt || '') >= (caiDat.savedAt || '')) { caiDat = remote; try { localStorage.setItem(CD_KEY, JSON.stringify(caiDat)); } catch (e) {} }
      else saveCaiDat();
    } catch (e) { if (e.status === 404 && caiDat.savedAt) saveCaiDat(); }
  }
  async function saveCaiDat() {
    try { localStorage.setItem(CD_KEY, JSON.stringify(caiDat)); } catch (e) {}
    if (!token) return;
    try {
      const body = { message: `${DIR} cai dat (tu web)`, content: b64enc(JSON.stringify(caiDat)), branch: 'main' };
      if (cdSha) body.sha = cdSha;
      const r = await gh(`/contents/${DIR}/cai-dat.json`, { method: 'PUT', body: JSON.stringify(body) });
      cdSha = r.content.sha;
    } catch (e) { cdSha = null; }
  }
  function vpTuMa(book) {
    const m = caiDat.vpTheoMa || {}, n = {};
    book.sheets.forEach(s => s.batches.forEach(b => b.nguoi.forEach(p => { const v = m[p.ma]; if (v) n[v] = (n[v] || 0) + 1; })));
    return (Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [''])[0];
  }

  // ------------------------------------------------------------ Mã NV / tên còn thiếu: lấy từ bảng chấm công
  let staffDir = null;
  async function loadStaffDir() {
    if (staffDir) return staffDir;
    const dir = { ten: {}, ma: {} };
    const addSheet = sh => ((sh && sh.rows) || []).forEach(r => {
      if (!r || r.t !== 'nv' || !r.ma || !r.ten) return;
      const ma = String(r.ma).trim(), kk = E.key(r.ten);
      if (!dir.ten[kk]) dir.ten[kk] = { ma, ten: String(r.ten).trim() };
      if (!dir.ma[ma]) dir.ma[ma] = String(r.ten).trim();
    });
    const local = {}; try { Object.assign(local, JSON.parse(localStorage.getItem('kvh-chamcong-v1') || '{}')); } catch (e) {}
    let remote = [];
    if (token) { try { remote = (await gh(`/contents/cham-cong?ref=main&t=${Date.now()}`)).map(i => i.name).filter(n => /^\d{4}-\d{2}\.json$/.test(n)).map(n => n.slice(0, 7)); } catch (e) {} }
    const months = [...new Set([...Object.keys(local).filter(k => /^\d{4}-\d{2}$/.test(k)), ...remote])].sort().reverse().slice(0, 6);
    for (const k of months) {
      if (local[k]) { addSheet(local[k]); continue; }
      try { const meta = await gh(`/contents/cham-cong/${k}.json?ref=main`); addSheet(JSON.parse(b64dec(meta.content || '') || '{}')); } catch (e) {}
    }
    staffDir = dir;
    return dir;
  }
  async function fillThieu(q) {
    const a = archive[q]; if (!a || !a.result) return 0;
    const all = [...a.result.batches.flatMap(b => b.nguoi), ...Object.values(a.sua || {}).flatMap(s => s.nguoi || [])];
    if (!all.some(p => !p.ma || !p.ten)) return 0;
    const dir = await loadStaffDir();
    let n = 0;
    all.forEach(p => {
      if (!p.ma && p.ten) { const d = dir.ten[E.key(p.ten)]; if (d) { p.ma = d.ma; n++; } }
      if (p.ma && !p.ten && dir.ma[p.ma]) { p.ten = dir.ma[p.ma]; n++; }
    });
    if (n) { touch(q); renderAll(); }
    return n;
  }

  // ------------------------------------------------------------ trạng thái
  const quarters = () => Object.keys(archive).filter(q => archive[q] && archive[q].result).sort().reverse();
  const current = () => (archive[sel] && archive[sel].result) ? sel : (quarters()[0] || '');
  const A = () => { const q = current(); return q ? archive[q] : null; };
  const res = () => { const a = A(); return a ? a.result : null; };
  const dots = () => { const a = A(); return a ? E.apDung(a.result, a.sua) : []; };
  const tinhSet = () => { const a = A() || {}; return { skip: new Set(a.boQua || []), add: new Set(a.chonThem || []) }; };
  const listNV = () => { const a = A(); return a ? E.tong(dots(), a.boQua, a.chonThem) : []; };
  // Ghi chú từng nhân viên trong bảng tổng (vd nghỉ việc) — lưu theo quý: archive[q].ghiChu = { mã NV (hoặc tên): chữ }
  const ghiChu = () => { const a = A(); return (a && a.ghiChu) || {}; };
  let search = '', vpF = '', editId = null, draft = null, sugList = [], uploadOpen = false, pending = null, busy = false;
  const files = [];
  const TABS = ['bang-tong', 'van-phong', 'chi-tiet', 'loc-du-lieu'];
  const tab = () => TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'bang-tong';
  const match = p => { const q = fold(search.trim()); return !q || fold(`${p.ma} ${p.ten}`).includes(q); };

  // ------------------------------------------------------------ render
  function renderTop() {
    const r = res(), has = !!r;
    $('bhTop').hidden = !has;
    $('bhUpload').hidden = !(uploadOpen || !has) || !!pending;
    $('bhUpCancel').hidden = !has;
    $('bhPending').hidden = !pending;
    $('bhMain').hidden = !has || !!pending;
    if (!has) return;
    $('bhChips').innerHTML = quarters().map(q => `<button type="button" class="b sm${q === r.quarterKey ? ' pri' : ''}" data-q="${q}">${E.quarterLabel(q)}</button>`).join('');
    const T = tinhSet(), D = dots().filter(b => E.dotTinh(b, T.skip, T.add)), vps = [...new Set(r.files.map(f => f.vp))];
    $('bhBanner').innerHTML = `✓ ${r.files.length} file · <b>${D.length}</b> đợt bốc hàng của ${vps.length} văn phòng (${esc(vps.join(', '))}) · Đang xem <b>${E.quarterLabel(r.quarterKey)}</b>`;
    $('bhSync').textContent = syncMsg;
  }
  function renderStats() {
    const r = res(); if (!r) return;
    const L = listNV(), T = tinhSet(), D = dots().filter(b => E.dotTinh(b, T.skip, T.add));
    $('stNV').textContent = `${L.filter(p => p.thuong > 0).length}/${L.length}`;
    $('stDot').textContent = D.length;
    $('stKien').textContent = num(D.reduce((a, b) => a + b.kien, 0));
    $('stTong').textContent = money(L.reduce((a, p) => a + p.thuong, 0));
  }
  function renderTabs() {
    const t = tab();
    document.querySelectorAll('#bhTabs [data-tab]').forEach(a => a.classList.toggle('pri', a.dataset.tab === t));
    document.querySelectorAll('#bh [data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('bhSearchBox').hidden = t === 'loc-du-lieu' || t === 'van-phong';
    if (res() && t === 'bang-tong') $('bhFoot').textContent = `${listNV().filter(match).length} nhân viên`;
    else if (t !== 'chi-tiet') $('bhFoot').textContent = '';
  }
  function renderTong() {
    const r = res(); if (!r) return;
    const all = listNV(), list = all.filter(match);
    $('btHead').innerHTML = '<th class="r" style="width:36px">STT</th><th>Mã NV</th><th style="min-width:170px">Họ và tên</th><th>Văn phòng</th>'
      + r.months.map(m => `<th class="r">${E.monthLabel(m)}<div class="muted" style="font-weight:400">thưởng</div></th>`).join('')
      + '<th class="r">Số đợt</th><th class="r">Tổng kiện</th><th class="r">Tổng thưởng quý ↓</th><th>Ghi chú <span class="muted" style="font-weight:400">(vd: nghỉ việc từ …)</span></th>';
    const gc = ghiChu();
    let html = list.map((p, i) => `<tr class="${p.thuong ? '' : 'off'}"><td class="r" style="color:#9ca3af">${i + 1}</td><td>${esc(p.ma) || '<span class="tag ng">thiếu mã</span>'}</td><td class="name">${esc(p.ten)}</td><td>${esc(p.vp)}</td>`
      + r.months.map(m => `<td class="r">${p.thang[m] ? money(p.thang[m]) : '<span class="muted">—</span>'}</td>`).join('')
      + `<td class="r">${p.dot}</td><td class="r">${k1(p.kien)}</td><td class="r money">${money(p.thuong)}</td>`
      + `<td><input type="text" class="gc-in${gc[pkey(p)] ? ' co' : ''}" data-gc="${esc(pkey(p))}" value="${esc(gc[pkey(p)] || '')}" placeholder="ghi chú…" aria-label="Ghi chú cho ${esc(p.ten)}"></td></tr>`).join('');
    if (!search) {
      html += `<tr class="total"><td colspan="4">TỔNG CỘNG</td>${r.months.map(m => `<td class="r">${money(all.reduce((a, p) => a + (p.thang[m] || 0), 0))}</td>`).join('')}`
        + `<td class="r">${num(all.reduce((a, p) => a + p.dot, 0))}</td><td class="r">${k1(all.reduce((a, p) => a + p.kien, 0))}</td><td class="r">${money(all.reduce((a, p) => a + p.thuong, 0))}</td><td></td></tr>`;
    }
    $('btBody').innerHTML = html;
  }
  function vpStats() {
    const r = res(), T = tinhSet(), by = new Map();
    r.files.forEach(f => { if (!by.has(f.vp)) by.set(f.vp, { vp: f.vp, dot: 0, kien: 0, nv: new Set(), co: new Set(), thuong: 0, files: [] }); by.get(f.vp).files.push(f.file); });
    dots().forEach(b => {
      if (!by.has(b.vp)) by.set(b.vp, { vp: b.vp, dot: 0, kien: 0, nv: new Set(), co: new Set(), thuong: 0, files: [] });
      if (!E.dotTinh(b, T.skip, T.add)) return;
      const x = by.get(b.vp); x.dot++; x.kien += b.kien; x.thuong += b.thuong * b.soNguoi;
      b.nguoi.forEach(p => { x.nv.add(pkey(p)); if (b.thuong > 0) x.co.add(pkey(p)); });
    });
    return [...by.values()].sort((a, b) => b.thuong - a.thuong);
  }
  function renderVP() {
    if (!res()) return;
    const V = vpStats(), s = k => V.reduce((a, x) => a + x[k], 0);
    $('vpBody').innerHTML = V.map(x => `<tr><td class="name">${esc(x.vp)}</td><td class="r">${x.dot}</td><td class="r">${num(x.kien)}</td><td class="r">${x.nv.size}</td><td class="r">${x.co.size}</td><td class="r money">${money(x.thuong)}</td><td class="muted">${esc(x.files.join(', '))}</td></tr>`).join('')
      + `<tr class="total"><td>TỔNG CỘNG</td><td class="r">${s('dot')}</td><td class="r">${num(s('kien'))}</td><td class="r">${listNV().length}</td><td class="r">${listNV().filter(p => p.thuong > 0).length}</td><td class="r">${money(s('thuong'))}</td><td></td></tr>`;
  }
  const noteOf = b => [...String(b.note || '').split(' · ').filter(x => x && !/^nhap trong\s*gio$/.test(fold(x))),
    b.trung ? `${b.trung} tên ghi trùng — tính 1 lần` : '', /\+/.test(b.kienText || '') ? `Số kiện ghi "${b.kienText}"` : ''].filter(Boolean).join(' · ');
  function renderChiTiet() {
    const r = res(); if (!r) return;
    const T = tinhSet(), D = dots(), vps = [...new Set(D.map(b => b.vp))];
    if (vpF && !vps.includes(vpF)) vpF = '';
    $('ctVP').innerHTML = ['', ...vps].map(v => `<button type="button" class="b sm${v === vpF ? ' pri' : ''}" data-vpf="${esc(v)}">${v ? esc(v) : 'Tất cả văn phòng'}</button>`).join('');
    const q = fold(search.trim());
    const list = D.filter(b => (!vpF || b.vp === vpF) && (!q || b.id === editId || b.nguoi.some(p => fold(`${p.ma} ${p.ten}`).includes(q))));
    $('ctBody').innerHTML = list.map(b => {
      const on = E.dotTinh(b, T.skip, T.add);
      const tags = (b.daSua ? '<span class="tag sua">đã sửa</span>' : '') + (b.dao ? `<span class="tag dao" title="File ghi ${vnDate(b.goc)} — Excel đảo ngày/tháng">đã đảo ngày</span>` : '') + (b.ngoaiGio ? '<span class="tag ng">ngoài giờ</span>' : '');
      return `<tr class="${on ? '' : 'off'}"><td class="ck"><input type="checkbox" data-tinh="${esc(b.id)}"${on ? ' checked' : ''} aria-label="Tính đợt ${esc(b.vp)} ${vnDate(b.ngay)}"></td>`
        + `<td>${esc(b.vp)}</td><td>${vnDate(b.ngay)}${tags}</td><td class="r">${num(b.kien)}</td><td class="r">${b.soNguoi}</td><td class="r">${k1(b.tb)}</td>`
        + `<td class="r${b.thuong && on ? ' money' : ''}">${money(b.thuong)}</td>`
        + `<td class="ppl">${b.nguoi.map(p => p.ma ? esc(p.ten || p.ma) : `${esc(p.ten)} <span class="tag ng">thiếu mã</span>`).join(', ')}</td>`
        + `<td class="note">${esc(noteOf(b))}</td><td><button type="button" class="b xs" data-sua="${esc(b.id)}">${b.id === editId ? 'Đang sửa' : 'Sửa'}</button></td></tr>`
        + (b.id === editId ? editorRow(b) : '');
    }).join('') || '<tr><td colspan="10" class="muted" style="text-align:center">Không có đợt nào</td></tr>';
    if (tab() === 'chi-tiet') $('bhFoot').textContent = `${list.length} đợt`;
  }

  // ---- sửa từng đợt
  const goc = id => res().batches.find(b => b.id === id);
  function editorRow(b) {
    const g = goc(b.id), gk = new Set(g.nguoi.map(pkey)), a = A();
    const n = draft.nguoi.length, tb = n ? draft.kien / n : 0, R = res().rules, th = tb > R.nguong ? (tb - R.nguong) * R.donGia : 0;
    return `<tr class="edit"><td></td><td colspan="9">
      <div class="tk-row" style="gap:12px;margin-bottom:8px"><b>Sửa đợt ${esc(b.vp)} · ${vnDate(b.ngay)}</b><span class="muted">Theo file: ${num(g.kien)} kiện, ${g.nguoi.length} người</span></div>
      <div class="tk-row" style="margin-bottom:8px"><span class="tk-lbl">Số kiện</span><input type="number" min="0" id="edKien" value="${draft.kien}">
        <span class="muted" style="margin-left:10px">→ ${k1(tb)} kiện/người · thưởng <b>${money(th)}</b>/người</span></div>
      <div style="margin-bottom:4px">${draft.nguoi.map((p, i) => `<span class="chip${gk.has(pkey(p)) ? '' : ' moi'}">${esc(p.ma || 'thiếu mã')} · ${esc(p.ten)}<button type="button" data-edrm="${i}" aria-label="Bỏ ${esc(p.ten)} khỏi đợt">×</button></span>`).join('') || '<span class="muted">Chưa có ai</span>'}</div>
      <div class="tk-row"><span class="ed-add"><input type="text" id="edAdd" placeholder="Thêm người: gõ tên hoặc mã NV (không dấu cũng được)" autocomplete="off"><div class="ed-sug" id="edSug" hidden></div></span>
        <button type="button" class="b sm pri" data-edsave="1">Lưu đợt này</button><button type="button" class="b sm" data-edcancel="1">Huỷ</button>${a.sua && a.sua[b.id] ? '<button type="button" class="b sm" data-edreset="1">Về như file</button>' : ''}</div>
    </td></tr>`;
  }
  function pool() {
    const m = new Map(), add = p => { if (p && (p.ma || p.ten) && !m.has(pkey(p))) m.set(pkey(p), { ma: p.ma || '', ten: p.ten || '' }); };
    Object.values(archive).forEach(a => { if (!a || !a.result) return; a.result.batches.forEach(b => b.nguoi.forEach(add)); Object.values(a.sua || {}).forEach(s => (s.nguoi || []).forEach(add)); });
    if (staffDir) Object.values(staffDir.ten).forEach(add);
    return [...m.values()];
  }
  function showSug() {
    const inp = $('edAdd'), box = $('edSug'); if (!inp || !box) return;
    const raw = inp.value.trim(), q = fold(raw);
    if (!q) { box.hidden = true; return; }
    const have = new Set(draft.nguoi.map(pkey));
    sugList = pool().filter(p => !have.has(pkey(p)) && fold(`${p.ma} ${p.ten}`).includes(q)).slice(0, 8);
    const mm = raw.match(/^(\d{5,6})\s*[-·.,]?\s*(.*)$/), typed = mm ? { ma: mm[1].padStart(6, '0'), ten: mm[2].trim() } : { ma: '', ten: raw };
    if (!sugList.length) sugList.push(Object.assign(typed, { moi: true }));
    box.innerHTML = sugList.map((p, i) => `<button type="button" data-edadd="${i}">${p.moi ? `Thêm "${esc(raw)}"${p.ma ? '' : ' (chưa có mã — gõ "mã tên" để có mã)'}` : `${esc(p.ma || 'thiếu mã')} · ${esc(p.ten)}`}</button>`).join('');
    box.hidden = false;
  }
  function openEdit(id) {
    const b = dots().find(x => x.id === id); if (!b) return;
    editId = id; draft = { kien: b.kien, nguoi: b.nguoi.map(p => ({ ma: p.ma, ten: p.ten })) };
    renderChiTiet();
    loadStaffDir().catch(() => {});
    const inp = $('edAdd'); if (inp) inp.focus();
  }
  function rerenderEdit(focus) { renderChiTiet(); if (focus) { const i = $('edAdd'); if (i) i.focus(); } }

  function renderLoc() {
    const r = res(); if (!r) return;
    const L = r.loc, D = dots(), T = tinhSet(), a = A();
    const sec = (title, items, note) => `<div style="margin-bottom:12px"><b>${title}</b> <span class="muted">(${items.length})</span>${note ? ` <span class="muted">— ${note}</span>` : ''}`
      + (items.length ? (items.length > 8 ? `<details><summary class="muted" style="cursor:pointer">bấm để xem</summary><ul class="loc">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : `<ul class="loc">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`) : '') + '</div>';
    const thieuMa = [...new Set(D.flatMap(b => b.nguoi.filter(p => !p.ma).map(p => `${p.ten} (${b.vp})`)))];
    $('locBody').innerHTML = `<table class="dt" style="max-width:900px;margin-bottom:16px"><thead><tr><th>File</th><th>Văn phòng</th><th>Sheet đã đọc</th></tr></thead><tbody>`
      + r.files.map(f => `<tr><td>${esc(f.file)}</td><td class="name">${esc(f.vp)}</td><td class="note">${esc((f.sheets || []).join(', '))}</td></tr>`).join('') + '</tbody></table>'
      + sec('Sheet ghi quý khác — bỏ qua', L.sheetKhacQuy)
      + sec('Đợt có ngày ngoài quý — bỏ qua', L.ngoaiQuy)
      + sec('Đợt thiếu số kiện hoặc không có người — bỏ qua', L.thieu)
      + sec('Đợt trùng hệt giữa các file — chỉ tính 1 lần', L.trungDot)
      + sec('Ngày bị Excel đảo ngày/tháng — đã sửa', L.daoNgay.map(x => x.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1')), 'kiểm tra lại ở tab Chi tiết từng đợt')
      + sec('Đợt có tên ghi trùng — mỗi người tính 1 lần', D.filter(b => b.trung).map(b => `${b.vp} ${vnDate(b.ngay)}: ${b.trung} tên trùng`))
      + sec('Đợt đã sửa tay', D.filter(b => b.daSua).map(b => `${b.vp} ${vnDate(b.ngay)}: ${num(b.kien)} kiện, ${b.soNguoi} người`))
      + sec('Đợt không tính thưởng (bỏ tick / ngoài giờ)', D.filter(b => !E.dotTinh(b, T.skip, T.add)).map(b => `${b.vp} ${vnDate(b.ngay)}: ${num(b.kien)} kiện${b.ngoaiGio ? ' (ngoài giờ)' : ''}`))
      + sec('Người còn thiếu Mã NV', thieuMa, thieuMa.length ? 'bấm Sửa ở đợt đó, bỏ người và thêm lại dạng "mã tên"' : '');
    void a;
  }
  function renderAll() { renderTop(); renderStats(); renderTabs(); renderTong(); renderVP(); renderChiTiet(); renderLoc(); renderFiles(); }
  document.querySelectorAll('#bh [data-rule]').forEach(el => { el.textContent = E.RULES[el.dataset.rule].toLocaleString('vi-VN'); });
  window.addEventListener('hashchange', () => {
    if (location.hash === '#nap-du-lieu') { uploadOpen = true; renderTop(); $('bhUpload').scrollIntoView({ behavior: 'smooth' }); return; }
    if (location.hash === '#huong-dan') { $('huong-dan').scrollIntoView({ behavior: 'smooth' }); return; }
    renderTabs(); renderChiTiet();
  });

  // ------------------------------------------------------------ nạp file
  function renderFiles() {
    $('bhFiles').innerHTML = files.length ? files.map((f, i) => `<div class="f"><span>📄 ${esc(f.name)}</span><button type="button" data-rmf="${i}" aria-label="Bỏ file">×</button></div>`).join('') : '<div class="none">Chưa chọn file</div>';
    $('bhZone').classList.toggle('has', files.length > 0);
  }
  function addFiles(list) {
    [...list].filter(f => /\.xlsx?$/i.test(f.name)).forEach(f => { if (!files.some(x => x.name === f.name && x.size === f.size)) files.push(f); });
    msg($('bhUpMsg'), ''); renderFiles();
  }
  const zone = $('bhZone');
  zone.addEventListener('click', e => { if (e.target.closest('[data-rmf]')) return; $('bhFile').click(); });
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('bhFile').click(); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); addFiles(e.dataTransfer.files); });
  $('bhFile').addEventListener('change', () => { addFiles($('bhFile').files); $('bhFile').value = ''; });

  const hintLabel = h => `Quý ${h.q}${h.y ? '/' + h.y : ''}`;
  const sheetQ = (s, b) => { const q = E.quarterOf(b.ngay); if (!s.hint) return q; const [y, n] = q.split('-Q').map(Number); return s.hint.q === n && (!s.hint.y || s.hint.y === y) ? q : null; };
  $('bhRead').addEventListener('click', async () => {
    if (busy) return;
    if (!files.length) { msg($('bhUpMsg'), 'Hãy chọn hoặc thả ít nhất 1 file nhập hàng.'); return; }
    busy = true; $('bhRead').disabled = true; msg($('bhUpMsg'), '');
    try {
      const books = [], warns = [];
      for (const f of files) {
        $('bhStep').textContent = `Đang đọc ${f.name}…`;
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
        const b = E.parseWorkbook(XLSX, wb, f.name);
        if (!b.sheets.length) { warns.push(`<b>${esc(f.name)}</b>: không thấy bảng nhập hàng (cần hàng tiêu đề có cột Ngày, Số kiện, Mã NV, Tên).`); continue; }
        if (!b.vp) b.vp = vpTuMa(b);
        books.push(b);
      }
      if (!books.length) throw new Error('Không đọc được đợt nhập hàng nào. ' + warns.join(' '));
      pending = { books, warns }; showPending();
    } catch (e) { msg($('bhUpMsg'), 'Lỗi: ' + esc(e.message)); }
    finally { busy = false; $('bhRead').disabled = false; $('bhStep').textContent = ''; }
  });
  function showPending() {
    const qn = {};
    $('bhPendBody').innerHTML = pending.books.map((b, i) => {
      const per = {};
      b.sheets.forEach(s => s.batches.forEach(x => { const q = sheetQ(s, x); if (q) { per[q] = (per[q] || 0) + 1; qn[q] = (qn[q] || 0) + 1; } }));
      return `<tr><td>${esc(b.file)}</td><td><input type="text" list="bhVPs" data-vpi="${i}" value="${esc(b.vp)}" placeholder="Nhập tên văn phòng" style="width:150px"></td>`
        + `<td class="note">${b.sheets.map(s => `${esc(s.sheet)}${s.hint ? ` <span class="muted">(${hintLabel(s.hint)})</span>` : ''}`).join(', ')}</td>`
        + `<td class="note">${Object.keys(per).sort().reverse().map(q => `${E.quarterLabel(q)}: <b>${per[q]}</b> đợt`).join('<br>')}</td></tr>`;
    }).join('');
    const warns = [...pending.warns];
    if (pending.books.some(b => !b.vp)) warns.push('Có file chưa rõ <b>văn phòng</b> — hãy gõ tên văn phòng (vd Khánh Hòa) để bảng tổng tách đúng.');
    $('bhPendWarn').innerHTML = warns.length ? `<div class="gh-warn">⚠ ${warns.join('<br>⚠ ')}</div>` : '';
    const qs = Object.keys(qn).sort().reverse(), best = Object.entries(qn).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];
    $('bhPendQ').innerHTML = qs.map(q => `<option value="${q}"${best && q === best[0] ? ' selected' : ''}>${E.quarterLabel(q)} — ${qn[q]} đợt${archive[q] ? ' (đã có — sẽ thay, giữ các chỗ đã sửa tay)' : ''}</option>`).join('');
    renderTop();
  }
  $('bhCancel').addEventListener('click', () => { pending = null; renderTop(); });
  $('bhConfirm').addEventListener('click', () => {
    if (!pending) return;
    document.querySelectorAll('#bhPendBody [data-vpi]').forEach(inp => { const b = pending.books[Number(inp.dataset.vpi)]; b.vp = inp.value.trim() || b.file.replace(/\.xlsx?$/i, ''); });
    const q = $('bhPendQ').value; if (!q) return;
    const r = E.compute(pending.books, q), old = archive[q] || {}, ids = new Set(r.batches.map(b => b.id));
    const sua = {}; Object.entries(old.sua || {}).forEach(([id, s]) => { if (ids.has(id)) sua[id] = s; });
    archive[q] = { result: r, boQua: (old.boQua || []).filter(id => ids.has(id)), chonThem: (old.chonThem || []).filter(id => ids.has(id)), sua, ghiChu: old.ghiChu || {} };
    const m = Object.assign({}, caiDat.vpTheoMa || {});
    r.batches.forEach(b => b.nguoi.forEach(p => { if (p.ma) m[p.ma] = b.vp; }));
    caiDat = Object.assign({}, caiDat, { vpTheoMa: m, savedAt: new Date().toISOString() }); saveCaiDat();
    sel = q; pending = null; uploadOpen = false; files.length = 0; editId = null; vpF = '';
    touch(q); renderAll();
    const kept = Object.keys(sua).length;
    msg($('bhMsg'), `Đã tính ${E.quarterLabel(q)}: ${r.batches.length} đợt bốc hàng, ${listNV().length} nhân viên${kept ? ` — giữ lại ${kept} đợt đã sửa tay trước đó` : ''}. Kiểm tra tab <b>Chi tiết từng đợt</b> nếu cần thêm người được tính (vd tài xế phụ bốc).`, true);
    fillThieu(q).then(n => { if (n) msg($('bhMsg'), `Đã tự điền ${n} Mã NV / tên còn thiếu từ bảng chấm công.`, true); });
  });

  // ------------------------------------------------------------ sự kiện khác
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-q],[data-vpf],[data-rmf],[data-sua],[data-edrm],[data-edadd],[data-edsave],[data-edcancel],[data-edreset]');
    if (!t) { const s = $('edSug'); if (s && !e.target.closest('.ed-add')) s.hidden = true; return; }
    const d = t.dataset, q = current(), a = A();
    if (d.q) { sel = d.q; vpF = ''; editId = null; persistLocal(); renderAll(); }
    else if (d.vpf !== undefined) { vpF = d.vpf; renderChiTiet(); }
    else if (d.rmf !== undefined) { files.splice(Number(d.rmf), 1); renderFiles(); }
    else if (d.sua) { if (editId === d.sua) { editId = null; renderChiTiet(); } else openEdit(d.sua); }
    else if (d.edrm !== undefined) { draft.nguoi.splice(Number(d.edrm), 1); rerenderEdit(true); }
    else if (d.edadd !== undefined) { const p = sugList[Number(d.edadd)]; if (p) draft.nguoi.push({ ma: p.ma || '', ten: p.ten || '' }); rerenderEdit(true); }
    else if (d.edcancel) { editId = null; renderChiTiet(); }
    else if (d.edreset) { delete a.sua[editId]; editId = null; touch(q); renderAll(); }
    else if (d.edsave) {
      const g = goc(editId), same = draft.kien === g.kien && draft.nguoi.length === g.nguoi.length && draft.nguoi.every((p, i) => pkey(p) === pkey(g.nguoi[i]));
      a.sua = a.sua || {};
      if (same) delete a.sua[editId]; else a.sua[editId] = { kien: draft.kien, nguoi: draft.nguoi };
      editId = null; touch(q); renderAll();
    }
  });
  $('ctBody').addEventListener('input', e => {
    if (e.target.id === 'edAdd') showSug();
    if (e.target.id === 'edKien') { draft.kien = Math.max(0, Number(e.target.value) || 0); }
  });
  $('ctBody').addEventListener('change', e => {
    if (e.target.id === 'edKien') { rerenderEdit(false); return; }
    const id = e.target.dataset.tinh; if (id === undefined) return;
    const q = current(), a = A(), b = dots().find(x => x.id === id); if (!b) return;
    const k = b.ngoaiGio ? 'chonThem' : 'boQua', s = new Set(a[k] || []);
    if (b.ngoaiGio === e.target.checked) s.add(id); else s.delete(id);
    a[k] = [...s]; touch(q); renderAll();
  });
  $('ctBody').addEventListener('keydown', e => {
    if (e.target.id === 'edAdd' && e.key === 'Enter') { e.preventDefault(); if (sugList[0] && !$('edSug').hidden) { draft.nguoi.push({ ma: sugList[0].ma || '', ten: sugList[0].ten || '' }); rerenderEdit(true); } }
    if (e.target.id === 'edKien' && e.key === 'Enter') { e.preventDefault(); draft.kien = Math.max(0, Number(e.target.value) || 0); rerenderEdit(false); }
  });
  // ---- ghi chú ở bảng tổng: lưu khi rời ô / bấm Enter
  $('btBody').addEventListener('change', e => {
    const k = e.target.dataset.gc; if (k === undefined) return;
    const q = current(), a = A(); if (!a) return;
    const v = e.target.value.replace(/\s+/g, ' ').trim();
    a.ghiChu = Object.assign({}, a.ghiChu);
    if (v) a.ghiChu[k] = v; else delete a.ghiChu[k];
    e.target.value = v; e.target.classList.toggle('co', !!v);
    touch(q);
    const ok = document.createElement('span'); ok.className = 'gc-ok'; ok.textContent = '✓ đã lưu';
    e.target.after(ok); setTimeout(() => ok.remove(), 1500);
  });
  $('btBody').addEventListener('keydown', e => { if (e.target.dataset.gc !== undefined && e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
  $('bhSearch').addEventListener('input', e => { search = e.target.value; renderTong(); renderChiTiet(); renderTabs(); });
  $('bhReload').addEventListener('click', () => { uploadOpen = true; renderTop(); $('bhUpload').scrollIntoView({ behavior: 'smooth' }); });
  $('bhUpCancel').addEventListener('click', () => { uploadOpen = false; msg($('bhUpMsg'), ''); renderTop(); });
  $('bhDelete').addEventListener('click', () => {
    const q = current(); if (!q) return;
    if (!confirm(`Xoá toàn bộ kết quả ${E.quarterLabel(q)} (cả các đợt đã sửa tay)${token ? ' trên máy này và trên hệ thống' : ''}?`)) return;
    delete archive[q]; if (sel === q) sel = ''; persistLocal();
    if (token && repoSha[q]) gh(`/contents/${DIR}/${q}.json`, { method: 'DELETE', body: JSON.stringify({ message: `Xoa ${DIR} ${q} (tu web)`, sha: repoSha[q], branch: 'main' }) }).then(() => { delete repoSha[q]; }).catch(() => {});
    renderAll();
  });

  // ------------------------------------------------------------ xuất Excel (định dạng sẵn để gửi quản lý — giống Thưởng quý GH)
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
  // cols: [{ h, t: 'stt'|'ma'|'name'|'text'|'int'|'money'|'k1', w, accent }]; groups: [{ label, span, accent }] (span 1 = cột đứng 2 tầng)
  // muted(i) → chữ xám; shade(i) → tô nền dòng (mặc định xen kẽ); gop: [{ r0, r1, cols }] gộp ô theo chiều dọc trong phần dữ liệu.
  function bangDep(wb, name, { title, sub, cols, groups, rows, total, muted, shade, gop, kyTen = true }) {
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
      for (let i = 0; i < 4; i++) { aoa.push([]); rowsH.push({ hpt: 16 }); }
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
      const grey = muted && muted(i), dark = shade ? shade(i) : i % 2;
      cols.forEach((col, c) => put(first + i, c, cell(col.t, {
        fill: col.accent ? (dark ? 'FBEAEA' : 'FDF3F3') : (dark ? 'F3F6FA' : null),
        bold: col.accent && !grey, color: grey ? '9CA3AF' : (col.accent ? '7F1D1D' : null) })));
    });
    (gop || []).forEach(g => { if (g.r1 > g.r0) g.cols.forEach(c => merges.push({ s: { r: first + g.r0, c }, e: { r: first + g.r1, c } })); });
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
    const idx = wb.SheetNames.length - 1;
    wb.Workbook = wb.Workbook || { Names: [] };
    wb.Workbook.Names.push({ Name: '_xlnm.Print_Titles', Sheet: idx, Ref: `'${name}'!$${headTop + 1}:$${headTop + headRows}` });
    (wb.__freeze = wb.__freeze || [])[idx] = headTop + headRows;
    (wb.__fitTall = wb.__fitTall || [])[idx] = rows.length <= 30;
  }
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

  function taoExcel() {
    const r = res(), wb = XLSX.utils.book_new();
    const L = listNV(), T = tinhSet(), D = dots(), Q = E.quarterLabel(r.quarterKey).toUpperCase(), R = r.rules;
    const vnd = v => v.toLocaleString('vi-VN'), m0 = x => Math.round(x || 0), r1 = x => Math.round((x || 0) * 10) / 10;
    const vps = vpStats();
    const quyTac = `Thưởng mỗi đợt = (Số kiện ÷ số người − ${R.nguong}) × ${vnd(R.donGia)}đ khi trên ${R.nguong} kiện/người  ·  Thưởng quý = cộng các đợt`;
    const S = { stt: { h: 'STT', t: 'stt', w: 5 }, ma: { h: 'MÃ NV', t: 'ma', w: 10 }, ten: { h: 'HỌ VÀ TÊN', t: 'name', w: 27 }, vp: { h: 'VĂN PHÒNG', t: 'text', w: 13 } };
    const M = r.months;
    // 1) Bảng tổng
    bangDep(wb, 'Bảng tổng thưởng', {
      title: `BẢNG TỔNG HỢP THƯỞNG BỐC HÀNG ${Q}`,
      sub: `Văn phòng: ${vps.map(x => x.vp).join(', ')}  ·  ${quyTac}`,
      groups: [{ span: 1 }, { span: 1 }, { span: 1 }, { span: 1 }, { label: 'THƯỞNG THEO THÁNG (đ)', span: M.length }, { label: 'CẢ QUÝ', span: 3, accent: true }, { span: 1 }],
      cols: [S.stt, S.ma, S.ten, S.vp, ...M.map(m => ({ h: E.monthLabel(m), t: 'money', w: 12 })),
        { h: 'Số đợt', t: 'int', w: 7, accent: true }, { h: 'Tổng kiện', t: 'k1', w: 10, accent: true }, { h: 'Tổng thưởng (đ)', t: 'money', w: 15, accent: true }, { h: 'GHI CHÚ', t: 'text', w: 22 }],
      rows: L.map((p, i) => [i + 1, p.ma, p.ten, p.vp, ...M.map(m => m0(p.thang[m])), p.dot, r1(p.kien), m0(p.thuong), ghiChu()[pkey(p)] || '']),
      muted: i => !L[i].thuong,
      total: ['TỔNG CỘNG', null, null, null, ...M.map(m => m0(L.reduce((a, p) => a + (p.thang[m] || 0), 0))), L.reduce((a, p) => a + p.dot, 0), r1(L.reduce((a, p) => a + p.kien, 0)), m0(L.reduce((a, p) => a + p.thuong, 0)), ''],
    });
    // 2) Theo văn phòng
    bangDep(wb, 'Theo văn phòng', {
      title: `THƯỞNG BỐC HÀNG THEO VĂN PHÒNG ${Q}`, sub: quyTac, kyTen: false,
      cols: [{ h: 'VĂN PHÒNG', t: 'name', w: 20 }, { h: 'SỐ ĐỢT', t: 'int', w: 9 }, { h: 'TỔNG KIỆN NHẬP', t: 'int', w: 12 }, { h: 'SỐ NV THAM GIA', t: 'int', w: 11 }, { h: 'SỐ NV CÓ THƯỞNG', t: 'int', w: 11 }, { h: 'TỔNG THƯỞNG (đ)', t: 'money', w: 16, accent: true }],
      rows: vps.map(x => [x.vp, x.dot, x.kien, x.nv.size, x.co.size, m0(x.thuong)]),
      total: ['TỔNG CỘNG', vps.reduce((a, x) => a + x.dot, 0), vps.reduce((a, x) => a + x.kien, 0), L.length, L.filter(p => p.thuong > 0).length, m0(vps.reduce((a, x) => a + x.thuong, 0))],
    });
    // 3) Chi tiết đợt: mỗi người 1 dòng, gộp ô theo đợt (như bảng bên trái file quý 2)
    const inc = D.filter(b => E.dotTinh(b, T.skip, T.add)), rows = [], gop = [], band = [], xam = [];
    inc.forEach((b, k) => {
      const r0 = rows.length;
      b.nguoi.forEach((p, j) => { rows.push([j ? null : k + 1, j ? null : b.vp, j ? null : vnDate(b.ngay), j ? null : b.kien, j ? null : b.soNguoi, p.ma, p.ten, j ? null : r1(b.tb), j ? null : m0(b.thuong), j ? null : noteOf(b) + (b.daSua ? (noteOf(b) ? ' · ' : '') + 'đã sửa tay' : '')]); band.push(k % 2); xam.push(!b.thuong); });
      gop.push({ r0, r1: rows.length - 1, cols: [0, 1, 2, 3, 4, 7, 8, 9] });
    });
    bangDep(wb, 'Chi tiết đợt bốc', {
      title: `CHI TIẾT CÁC ĐỢT BỐC HÀNG ${Q}`, sub: quyTac, kyTen: false,
      cols: [{ h: 'ĐỢT', t: 'stt', w: 5 }, { h: 'VĂN PHÒNG', t: 'text', w: 12 }, { h: 'NGÀY', t: 'ma', w: 11 }, { h: 'SỐ KIỆN', t: 'int', w: 8 }, { h: 'SỐ NGƯỜI', t: 'int', w: 8 },
        S.ma, S.ten, { h: 'KIỆN / NGƯỜI', t: 'k1', w: 10 }, { h: 'THƯỞNG / NGƯỜI (đ)', t: 'money', w: 13, accent: true }, { h: 'GHI CHÚ', t: 'text', w: 24 }],
      rows, gop, shade: i => band[i], muted: i => xam[i],
    });
    const ngoai = D.filter(b => !E.dotTinh(b, T.skip, T.add));
    if (ngoai.length) bangDep(wb, 'Đợt không tính', {
      title: `CÁC ĐỢT KHÔNG TÍNH THƯỞNG ${Q}`, sub: 'Bỏ tick trên trang hoặc đợt ghi "ngoài giờ" — không cộng vào bảng tổng', kyTen: false,
      cols: [S.stt, { h: 'VĂN PHÒNG', t: 'text', w: 12 }, { h: 'NGÀY', t: 'ma', w: 11 }, { h: 'SỐ KIỆN', t: 'int', w: 8 }, { h: 'NGƯỜI THAM GIA', t: 'text', w: 60 }, { h: 'LÝ DO', t: 'text', w: 16 }],
      rows: ngoai.map((b, i) => [i + 1, b.vp, vnDate(b.ngay), b.kien, b.nguoi.map(p => p.ten).join(', '), b.ngoaiGio && !T.add.has(b.id) ? 'Ngoài giờ' : 'Bỏ tick']),
    });
    return { wb, fname: `ThuongBocHang_${r.quarterKey}.xlsx` };
  }
  $('bhExport').addEventListener('click', async () => {
    if (!res()) return;
    const { wb, fname } = taoExcel();
    try { luuFile(await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []), fname); }
    catch (e) { XLSX.writeFile(wb, fname); }
  });
  // để kiểm thử file Excel (không dùng trong giao diện)
  window.__bocExcel = async () => { const { wb, fname } = taoExcel(); return { fname, bytes: await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []) }; };

  if (location.hash === '#nap-du-lieu') uploadOpen = true;
  renderAll();
  if (token) { pullFromRepo(); pullCaiDat(); }
})();
