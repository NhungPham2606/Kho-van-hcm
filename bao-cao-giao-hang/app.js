// Trang "Báo cáo giao hàng": kết nối kho riêng tư trên GitHub (token do người
// dùng tự dán, lưu trong trình duyệt), tải file dữ liệu lên, xem kết quả đã
// tính (hệ thống GitHub Actions tính, trang này chỉ đọc) và sửa chính sách
// (config/chinh_sach.json). Mọi phép tính lương nằm ở script Python trên hệ
// thống — trang này KHÔNG tự tính để tránh lệch số.
(function () {
  'use strict';
  const app = document.getElementById('app');
  if (!app) return;
  const OWNER = app.dataset.owner, REPO = app.dataset.repo, DIR = app.dataset.dir;
  const POLICY = app.dataset.policy, WORKFLOW = app.dataset.workflow;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const TOKEN_KEY = 'kvh-gh-token';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';
  const fmt = n => { if (n === null || n === undefined || n === '') return ''; if (typeof n !== 'number') return esc(n); const r = Math.round(n * 1000) / 1000; return Number.isInteger(r) ? String(r) : String(r).replace('.', ','); };
  const pathOf = name => `${encodeURIComponent(DIR)}/${encodeURIComponent(name)}`;

  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  let connected = false;
  let files = [];            // [{name, sha, size}] trong data/
  let latestName = null;     // file dùng làm tháng hiện tại (tải lên gần nhất)

  // ------------------------------------------------------------ GitHub API
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
    });
    if (!res.ok) {
      let msg = res.status + '';
      try { msg = (await res.json()).message || msg; } catch (e) {}
      const err = new Error(msg); err.status = res.status; throw err;
    }
    return opts.raw ? res : res.json();
  }
  async function getRaw(path) {
    const res = await gh(`/contents/${path}?ref=main&t=${Date.now()}`, { raw: true, headers: { Accept: 'application/vnd.github.raw' } });
    return res;
  }
  function toBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function setStatus(el, html, kind) {
    el.hidden = !html;
    el.className = 'up-status' + (kind ? ' ' + kind : '');
    el.innerHTML = html || '';
  }

  // Theo dõi lần tự động tính lại ứng với 1 commit, gọi onDone(success) khi xong.
  async function watchRun(sha, statusEl, prefix, onDone) {
    const started = Date.now();
    while (Date.now() - started < 6 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 6000));
      let run = null;
      try {
        const r = await gh(`/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&per_page=1`);
        run = r.workflow_runs && r.workflow_runs[0];
      } catch (e) { break; }
      if (!run) continue;
      const link = `<a href="${run.html_url}" target="_blank" rel="noopener">xem chi tiết ↗</a>`;
      if (run.status !== 'completed') { setStatus(statusEl, `${prefix} ⏳ Hệ thống đang tính lại… (${link})`, 'good'); continue; }
      if (run.conclusion === 'success') {
        setStatus(statusEl, `${prefix} ✅ Đã tính lại xong — xem ở mục <a href="#ket-qua">Kết quả tính</a>. Mail tự gửi theo lịch. (${link})`, 'good');
        if (onDone) onDone(true);
      } else {
        setStatus(statusEl, `${prefix} ❌ Tính lại bị lỗi — ${link}`, 'bad');
        if (onDone) onDone(false);
      }
      return;
    }
    setStatus(statusEl, `${prefix} Xem tiến trình tính lại tại <a href="https://github.com/${OWNER}/${REPO}/actions" target="_blank" rel="noopener">tab Actions ↗</a>`, 'good');
  }

  // ------------------------------------------------------------ kết nối
  function renderConnection() {
    $('upConnect').hidden = connected;
    $('upMain').hidden = !connected;
    document.querySelectorAll('[data-need-connect]').forEach(el => { el.hidden = connected; });
    $('kqCard').hidden = !connected;
    $('polForm').hidden = !connected;
  }
  async function connect(t) {
    token = t;
    $('upConnectMsg').textContent = 'Đang kiểm tra…';
    try {
      const repo = await gh('');
      if (!repo.permissions || !repo.permissions.push) throw new Error('Token chưa có quyền ghi (Contents: Read and write).');
      try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
      $('upWho').textContent = repo.full_name;
      $('upConnectMsg').textContent = '';
      connected = true;
      renderConnection();
      await refreshList();
      loadSectionData(location.hash.slice(1));
    } catch (e) {
      token = ''; connected = false;
      renderConnection();
      $('upConnectMsg').textContent = e.status === 401 ? 'Token không đúng hoặc đã hết hạn.'
        : e.status === 404 ? `Token không truy cập được kho ${OWNER}/${REPO} — kiểm tra mục "Repository access".`
        : 'Không kết nối được: ' + e.message;
    }
  }
  $('upConnectBtn').addEventListener('click', () => { const t = $('upToken').value.trim(); if (t) connect(t); });
  $('upToken').addEventListener('keydown', e => { if (e.key === 'Enter') $('upConnectBtn').click(); });
  $('upLogout').addEventListener('click', () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    token = ''; connected = false; $('upToken').value = '';
    kqLoadedFor = null; polLoaded = false;
    renderConnection();
  });

  // ------------------------------------------------------------ danh sách file
  async function refreshList() {
    const body = $('upList');
    body.innerHTML = '<tr><td colspan="3" class="note">Đang tải danh sách…</td></tr>';
    try {
      const items = await gh(`/contents/${encodeURIComponent(DIR)}?ref=main&t=${Date.now()}`);
      files = items.filter(i => i.type === 'file' && /\.xlsx$/i.test(i.name)).map(i => ({ name: i.name, sha: i.sha, size: i.size }));
      // file "tháng hiện tại" = file có commit thêm vào gần nhất (giống cách hệ thống chọn)
      latestName = files.length ? files[files.length - 1].name : null;
      if (files.length > 1) {
        const added = await Promise.all(files.map(async f => {
          try {
            const c = await gh(`/commits?path=${encodeURIComponent(DIR + '/' + f.name)}&per_page=100`);
            return { name: f.name, t: c.length ? Date.parse(c[c.length - 1].commit.committer.date) : 0 };
          } catch (e) { return { name: f.name, t: 0 }; }
        }));
        added.sort((a, b) => b.t - a.t);
        latestName = added[0].name;
      }
      body.innerHTML = files.length ? files.map(f => `<tr>
          <td>${esc(f.name)}${f.name === latestName ? ' <span class="pill good">đang dùng</span>' : ''}</td><td>${kb(f.size)}</td>
          <td><button type="button" class="linkbtn" data-dl="${esc(f.name)}">Tải về</button></td></tr>`).join('')
        : '<tr><td colspan="3" class="note">Chưa có file nào.</td></tr>';
      fillFilePicker();
    } catch (e) {
      body.innerHTML = `<tr><td colspan="3" class="note">Không đọc được danh sách: ${esc(e.message)}</td></tr>`;
    }
  }
  async function downloadFile(name, btn) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Đang tải…'; }
    try { saveBlob(await (await getRaw(pathOf(name))).blob(), name); }
    catch (err) { alert('Tải về thất bại: ' + err.message); }
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
  $('upList').addEventListener('click', e => { const n = e.target.dataset && e.target.dataset.dl; if (n) downloadFile(n, e.target); });
  $('upRefresh').addEventListener('click', refreshList);

  // ------------------------------------------------------------ kiểm tra 4 sheet
  function checkWorkbook(wb) {
    const names = wb.SheetNames;
    const found = { check: null, cc: null, gc: null, mnv: null };
    for (const n of names) {
      const low = n.toLowerCase();
      if (!found.cc && (low.includes('chấm công') || low.includes('cham cong'))) { found.cc = n; continue; }
      if (!found.gc && (low.includes('ghi chú') || low.includes('ghi chu'))) { found.gc = n; continue; }
      if (!found.mnv && n.trim().toUpperCase() === 'MNV') { found.mnv = n; continue; }
      if (!found.check) {
        const head = (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, range: 0, blankrows: false })[0] || []).map(v => String(v || '').toLowerCase());
        if (head.some(h => h.includes('mã các đơn hàng')) && head.some(h => h.includes('thời gian trả check'))) found.check = n;
      }
    }
    let thang = null, nam = null;
    const m = (found.cc || '').match(/T\s*(\d{1,2})\s*[.\-/]\s*(\d{2,4})/i);
    if (m) { thang = +m[1]; nam = +m[2] + (m[2].length === 2 ? 2000 : 0); }
    else { const m2 = (found.check || '').match(/th[áa]ng\s*(\d{1,2})/i); if (m2) thang = +m2[1]; }
    const known = new Set(Object.values(found).filter(Boolean));
    const outputs = /^(Đơn giao|Chi tiết giao hàng theo ngày|TH Tỷ lệ|Theo ngày|Tổng hợp NV)/;
    const extra = names.filter(n => !known.has(n) && !outputs.test(n));
    return { found, thang, nam, extra };
  }

  // ------------------------------------------------------------ tải file lên
  let picked = null;
  function pick(file) {
    const status = $('upStatus');
    if (!/\.xlsx$/i.test(file.name)) { setStatus(status, 'Chỉ nhận file <b>.xlsx</b>.', 'bad'); return; }
    setStatus(status, '');
    $('upDropTitle').textContent = 'Đã chọn file';
    $('upDropSub').innerHTML = `<span class="dz-file">📄 ${esc(file.name)}</span>`;
    const reader = new FileReader();
    reader.onload = ev => {
      const buf = ev.target.result;
      picked = { file, bytes: new Uint8Array(buf) };
      const exists = files.find(f => f.name === file.name);
      let items = [], ok = true;
      try {
        const wb = XLSX.read(buf, { type: 'array', bookSheets: false, sheetRows: 2 });
        const r = checkWorkbook(wb);
        const line = (v, label) => v ? `<li class="good">✓ ${label}: <b>${esc(v)}</b></li>` : `<li class="bad">✗ Thiếu sheet ${label}</li>`;
        items.push(line(r.found.check, 'Dữ liệu check đơn'));
        items.push(line(r.found.cc, 'Chấm công'));
        items.push(line(r.found.gc, 'GHI CHÚ'));
        items.push(line(r.found.mnv, 'MNV'));
        ok = !!(r.found.check && r.found.cc && r.found.gc && r.found.mnv);
        if (r.thang) items.push(`<li class="good">✓ Kỳ tính: <b>Tháng ${r.thang}${r.nam ? '/' + r.nam : ''}</b> (nhận từ tên sheet)</li>`);
        else if (ok) items.push(`<li>• Không đọc được tháng từ tên sheet Chấm công (dạng "Chấm công T9.26") — hệ thống sẽ lấy theo ngày trong dữ liệu.</li>`);
        if (r.extra.length) items.push(`<li>• Sheet khác (${r.extra.map(esc).join(', ')}) được giữ nguyên, không dùng để tính.</li>`);
      } catch (err) {
        ok = false; items.push(`<li class="bad">✗ Không đọc được file: ${esc(err.message)}</li>`);
      }
      items.push(exists
        ? `<li>↻ Sẽ <b>ghi đè</b> file cùng tên đang có (cập nhật trong tháng). Bản cũ vẫn lưu trong lịch sử.</li>`
        : `<li>＋ Là <b>file mới</b> — hệ thống sẽ dùng file này làm tháng hiện tại.</li>`);
      $('upCheck').innerHTML = `<ul>${items.join('')}</ul>`;
      $('upCheck').hidden = false;
      $('upSend').disabled = !ok;
      $('upSend').textContent = exists ? 'Cập nhật file lên hệ thống' : 'Tải file mới lên hệ thống';
    };
    reader.readAsArrayBuffer(file);
  }
  const dz = $('upDrop'), fileInput = $('upFile');
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) pick(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) pick(f); });

  $('upSend').addEventListener('click', async () => {
    if (!picked) return;
    const btn = $('upSend'), status = $('upStatus');
    btn.disabled = true;
    const name = picked.file.name;
    setStatus(status, '⏳ Đang tải file lên…');
    try {
      await refreshList();
      const exists = files.find(f => f.name === name);
      const body = { message: `Cap nhat du lieu: ${name} (tai len tu web)`, content: toBase64(picked.bytes), branch: 'main' };
      if (exists) body.sha = exists.sha;
      const res = await gh(`/contents/${pathOf(name)}`, { method: 'PUT', body: JSON.stringify(body) });
      picked = null;
      setStatus(status, '✅ Đã tải lên.', 'good');
      await refreshList();
      kqLoadedFor = null;
      watchRun(res.commit.sha, status, '✅ Đã tải lên.', () => { refreshList(); kqLoadedFor = null; });
    } catch (e) {
      setStatus(status, '❌ Tải lên thất bại: ' + esc(e.message), 'bad');
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------------ kết quả tính
  let kqLoadedFor = null, kqBlob = null, kqName = null, kqDaily = [];
  function fillFilePicker() {
    const sel = $('kqFile');
    const cur = sel.value;
    sel.innerHTML = files.map(f => `<option value="${esc(f.name)}">${esc(f.name)}${f.name === latestName ? ' (đang dùng)' : ''}</option>`).join('');
    sel.value = files.some(f => f.name === cur) ? cur : (latestName || '');
  }
  $('kqFile').addEventListener('change', () => loadResults($('kqFile').value));

  function sheetRows(wb, name) { return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }); }
  async function loadResults(name) {
    if (!name) return;
    kqLoadedFor = name;
    $('kqInfo').textContent = 'Đang tải kết quả…';
    $('kqBody').innerHTML = ''; $('kqHead').innerHTML = ''; $('kqFoot').innerHTML = ''; $('kqTiles').innerHTML = ''; $('kqDetail').hidden = true;
    try {
      kqBlob = await (await getRaw(pathOf(name))).blob();
      kqName = name;
      const wb = XLSX.read(await kqBlob.arrayBuffer(), { type: 'array', cellDates: false });
      const thName = wb.SheetNames.find(n => n.startsWith('TH Tỷ lệ'));
      if (!thName) { $('kqInfo').textContent = 'File này chưa có kết quả tính (hệ thống có thể đang tính lại — thử lại sau 1–2 phút).'; return; }
      const rows = sheetRows(wb, thName);
      const hi = rows.findIndex(r => r && r[0] === 'Mã NV');
      const head = rows[hi];
      const body = rows.slice(hi + 1).filter(r => r && (r[1] || r[0] === 'TỔNG CỘNG'));
      const total = body.find(r => r[0] === 'TỔNG CỘNG');
      const emps = body.filter(r => r[0] !== 'TỔNG CỘNG');
      const col = label => head.indexOf(label);
      const show = ['Mã NV', 'Họ và tên', 'Số ngày công', 'Số đơn giao', 'Điểm hiệu lực', 'Hệ số lương BQ', 'Ngày đạt 100%', 'Ngày đạt 95%', 'Ngày đạt 85%', 'Phép (100% lương)', 'Ngày Lễ', 'Nghỉ khác (Ro)'].filter(l => col(l) >= 0);
      const short = { 'Số ngày công': 'Ngày công', 'Số đơn giao': 'Đơn giao', 'Điểm hiệu lực': 'Hiệu lực', 'Hệ số lương BQ': 'Hệ số BQ', 'Ngày đạt 100%': '100%', 'Ngày đạt 95%': '95%', 'Ngày đạt 85%': '85%', 'Phép (100% lương)': 'Phép', 'Nghỉ khác (Ro)': 'Ro', 'Ngày Lễ': 'Lễ' };
      $('kqHead').innerHTML = show.map(l => `<th>${esc(short[l] || l)}</th>`).join('');
      const hsCol = col('Hệ số lương BQ');
      $('kqBody').innerHTML = emps.map(r => `<tr class="clickable" data-nv="${esc(r[1])}">${show.map(l => {
        const v = r[col(l)];
        if (l === 'Hệ số lương BQ') { const p = v >= 0.98 ? 'good' : v >= 0.92 ? 'warn' : 'bad'; return `<td><span class="pill ${p}">${Number(v).toFixed(3).replace('.', ',')}</span></td>`; }
        return `<td>${fmt(v)}</td>`;
      }).join('')}</tr>`).join('');
      if (total) $('kqFoot').innerHTML = show.map((l, i) => `<td>${i === 0 ? 'Tổng cộng' : (l === 'Họ và tên' ? '' : fmt(total[col(l)]))}</td>`).join('');
      const avg = emps.length ? emps.reduce((s, r) => s + (Number(r[hsCol]) || 0), 0) / emps.length : 0;
      const sum = l => emps.reduce((s, r) => s + (Number(r[col(l)]) || 0), 0);
      $('kqTiles').innerHTML = [['Nhân viên', emps.length], ['Tổng ngày công', fmt(sum('Số ngày công'))], ['Tổng đơn giao', fmt(sum('Số đơn giao'))], ['Hệ số lương BQ', avg.toFixed(3).replace('.', ',')]]
        .map(([a, b]) => `<div class="tile"><div class="tile-label">${a}</div><div class="tile-value">${b}</div></div>`).join('');
      const title = (rows[0] && rows[0][0]) || thName;
      $('kqInfo').textContent = title;
      // chi tiết theo ngày
      const dName = wb.SheetNames.find(n => n === 'Chi tiết giao hàng theo ngày');
      kqDaily = dName ? sheetRows(wb, dName) : [];
    } catch (e) {
      $('kqInfo').textContent = 'Không tải được kết quả: ' + e.message;
    }
  }
  $('kqBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-nv]');
    if (!tr || !kqDaily.length) return;
    $('kqBody').querySelectorAll('tr').forEach(r => r.classList.toggle('sel', r === tr));
    const nv = tr.dataset.nv;
    const head = kqDaily[0];
    const idx = l => head.indexOf(l);
    const rows = kqDaily.slice(1).filter(r => r && r[0] === nv);
    const cols = ['Ngày', 'Định mức ngày', 'Số đơn giao', 'Điểm hiệu lực', 'Trạng thái', 'Hệ số lương', 'Ghi chú'];
    // ngay luu dang so serial Excel -> doi theo UTC de khong lech mui gio
    const d = v => { if (typeof v !== 'number') return fmt(v); const t = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5); return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
    $('kqDetail').innerHTML = `<p class="kq-detail-title">Chi tiết theo ngày — ${esc(nv)}</p>
      <div class="table-scroll"><table class="ledger"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${cols.map(c => { const v = r[idx(c)]; return `<td style="${c === 'Ghi chú' || c === 'Trạng thái' ? 'text-align:left;white-space:normal;min-width:180px' : ''}">${c === 'Ngày' ? d(v) : fmt(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    $('kqDetail').hidden = false;
    $('kqDetail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  $('kqDownload').addEventListener('click', () => { if (kqBlob) saveBlob(kqBlob, kqName.replace(/\.xlsx$/i, '') + ' (đã tính).xlsx'); });

  // ------------------------------------------------------------ chính sách
  let polLoaded = false, polSha = null, polData = null;
  const form = $('polForm');
  const tableSpec = {
    polK: { key: 'heSoK', cols: [['tu', 'number'], ['den', 'number'], ['heSoK', 'number'], ['diem', 'number']] },
    polL: { key: 'heSoLuong', cols: [['tu', 'number'], ['den', 'number'], ['heSo', 'number'], ['trangThai', 'text']] },
  };
  function addRow(tableId, row = {}) {
    const spec = tableSpec[tableId];
    const tr = document.createElement('tr');
    tr.innerHTML = spec.cols.map(([k, t]) => `<td><input type="${t}" ${t === 'number' ? 'step="any"' : ''} data-k="${k}" value="${esc(row[k] ?? '')}" required></td>`).join('')
      + '<td><button type="button" class="linkbtn" data-del>Xoá</button></td>';
    $(tableId).querySelector('tbody').appendChild(tr);
  }
  form.addEventListener('click', e => {
    if (e.target.dataset.add) addRow(e.target.dataset.add);
    if (e.target.hasAttribute('data-del')) e.target.closest('tr').remove();
  });
  function fillPolicy(p) {
    ['dinhMucNgayThuong', 'dinhMucThu7', 'dinhMucNuaNgay', 'dinhMucNghiPhep', 'gioTraCheckTrongGio', 'gioTraCheckNgoaiGio', 'gioNhanCheckNgoaiGio', 'gioChiaSangChieu']
      .forEach(k => { form.elements[k].value = p[k] ?? ''; });
    form.elements.trangThaiDonDuocTinh.value = (p.trangThaiDonDuocTinh || []).join('\n');
    form.elements.loaiKhoiTongHop.value = (p.loaiKhoiTongHop || []).join('\n');
    Object.keys(tableSpec).forEach(id => {
      $(id).querySelector('tbody').innerHTML = '';
      (p[tableSpec[id].key] || []).forEach(r => addRow(id, r));
    });
  }
  async function loadPolicy() {
    setStatus($('polStatus'), 'Đang tải chính sách…');
    try {
      const meta = await gh(`/contents/${POLICY}?ref=main&t=${Date.now()}`);
      polSha = meta.sha;
      const bytes = Uint8Array.from(atob(meta.content.replace(/\n/g, '')), c => c.charCodeAt(0));
      polData = JSON.parse(new TextDecoder().decode(bytes));
      fillPolicy(polData);
      polLoaded = true;
      setStatus($('polStatus'), '');
    } catch (e) {
      setStatus($('polStatus'), 'Không tải được chính sách: ' + esc(e.message), 'bad');
    }
  }
  $('polReload').addEventListener('click', loadPolicy);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const num = k => Number(form.elements[k].value);
    const lines = k => form.elements[k].value.split('\n').map(s => s.trim()).filter(Boolean);
    const readTable = id => [...$(id).querySelectorAll('tbody tr')].map(tr => {
      const o = {};
      tr.querySelectorAll('input').forEach(inp => { o[inp.dataset.k] = inp.type === 'number' ? Number(inp.value) : inp.value.trim(); });
      return o;
    }).sort((a, b) => a.tu - b.tu);
    const next = Object.assign({}, polData, {
      heSoK: readTable('polK'), heSoLuong: readTable('polL'),
      dinhMucNgayThuong: num('dinhMucNgayThuong'), dinhMucThu7: num('dinhMucThu7'),
      dinhMucNuaNgay: num('dinhMucNuaNgay'), dinhMucNghiPhep: num('dinhMucNghiPhep'),
      gioTraCheckTrongGio: form.elements.gioTraCheckTrongGio.value, gioTraCheckNgoaiGio: form.elements.gioTraCheckNgoaiGio.value,
      gioNhanCheckNgoaiGio: form.elements.gioNhanCheckNgoaiGio.value, gioChiaSangChieu: form.elements.gioChiaSangChieu.value,
      trangThaiDonDuocTinh: lines('trangThaiDonDuocTinh'), loaiKhoiTongHop: lines('loaiKhoiTongHop'),
    });
    if (!next.heSoK.length || !next.heSoLuong.length) { setStatus($('polStatus'), 'Bảng hệ số K và hệ số lương phải có ít nhất 1 dòng.', 'bad'); return; }
    if (!next.trangThaiDonDuocTinh.length) { setStatus($('polStatus'), 'Cần ít nhất 1 trạng thái đơn được tính.', 'bad'); return; }
    if (!confirm('Lưu chính sách mới? Hệ thống sẽ tính lại file dữ liệu mới nhất theo chính sách này.')) return;
    const btn = $('polSave'); btn.disabled = true;
    setStatus($('polStatus'), '⏳ Đang lưu…');
    try {
      const text = JSON.stringify(next, null, 2) + '\n';
      const res = await gh(`/contents/${POLICY}`, { method: 'PUT', body: JSON.stringify({
        message: 'Cap nhat chinh sach (tu web)', content: toBase64(new TextEncoder().encode(text)), sha: polSha, branch: 'main' }) });
      polSha = res.content.sha; polData = next;
      setStatus($('polStatus'), '✅ Đã lưu chính sách.', 'good');
      kqLoadedFor = null;
      watchRun(res.commit.sha, $('polStatus'), '✅ Đã lưu chính sách.', () => { kqLoadedFor = null; });
    } catch (err) {
      setStatus($('polStatus'), err.status === 409 ? '❌ Chính sách vừa bị sửa ở nơi khác — bấm "Bỏ thay đổi" để tải bản mới rồi sửa lại.' : '❌ Lưu thất bại: ' + esc(err.message), 'bad');
      if (err.status === 409) polLoaded = false;
    }
    btn.disabled = false;
  });

  // ------------------------------------------------------------ nạp dữ liệu theo mục đang xem
  function loadSectionData(id) {
    if (!connected) return;
    if (id === 'ket-qua' && kqLoadedFor !== ($('kqFile').value || latestName)) loadResults($('kqFile').value || latestName);
    if (id === 'quy-tac' && !polLoaded) loadPolicy();
  }
  document.addEventListener('kvh:section', e => loadSectionData(e.detail));

  renderConnection();
  if (token) connect(token);
})();
