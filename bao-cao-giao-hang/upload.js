// Khung "Tải dữ liệu lên hệ thống": đưa file Excel thẳng vào thư mục data/
// của kho riêng tư qua GitHub API, rồi theo dõi lần tự động tính lại.
// Cần 1 token (fine-grained) chỉ có quyền trên đúng kho này, người dùng tự
// dán vào ô "Kết nối" — token lưu trong trình duyệt của máy đó (localStorage).
(function () {
  'use strict';
  const box = document.getElementById('uploadBox');
  if (!box) return;
  const OWNER = box.dataset.owner, REPO = box.dataset.repo, DIR = box.dataset.dir, WORKFLOW = box.dataset.workflow;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const TOKEN_KEY = 'kvh-gh-token';
  const $ = id => document.getElementById(id);

  const connectView = $('upConnect'), mainView = $('upMain');
  const tokenInput = $('upToken'), connectBtn = $('upConnectBtn'), connectMsg = $('upConnectMsg');
  const dz = $('upDrop'), fileInput = $('upFile'), dzTitle = $('upDropTitle'), dzSub = $('upDropSub');
  const checkBox = $('upCheck'), sendBtn = $('upSend'), statusBox = $('upStatus');
  const listBody = $('upList'), whoEl = $('upWho');

  let token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  let files = [];      // [{name, sha, size}]
  let picked = null;   // {file, buf}

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB';

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

  function setStatus(html, kind) {
    statusBox.hidden = !html;
    statusBox.className = 'up-status' + (kind ? ' ' + kind : '');
    statusBox.innerHTML = html || '';
  }

  // ------------------------------------------------------------ kết nối
  async function connect(t) {
    token = t;
    connectMsg.textContent = 'Đang kiểm tra…';
    try {
      const repo = await gh('');
      if (!repo.permissions || !repo.permissions.push) throw new Error('Token chưa có quyền ghi (Contents: Read and write).');
      try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
      whoEl.textContent = repo.full_name;
      connectView.hidden = true; mainView.hidden = false; connectMsg.textContent = '';
      await refreshList();
    } catch (e) {
      token = '';
      connectView.hidden = false; mainView.hidden = true;
      connectMsg.textContent = e.status === 401 ? 'Token không đúng hoặc đã hết hạn.'
        : e.status === 404 ? 'Token không truy cập được kho ' + OWNER + '/' + REPO + ' — kiểm tra mục "Repository access".'
        : 'Không kết nối được: ' + e.message;
    }
  }
  connectBtn.addEventListener('click', () => { const t = tokenInput.value.trim(); if (t) connect(t); });
  tokenInput.addEventListener('keydown', e => { if (e.key === 'Enter') connectBtn.click(); });
  $('upLogout').addEventListener('click', () => {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    token = ''; tokenInput.value = '';
    mainView.hidden = true; connectView.hidden = false;
  });

  // ------------------------------------------------------------ danh sách file
  async function refreshList() {
    listBody.innerHTML = '<tr><td colspan="3" class="note">Đang tải danh sách…</td></tr>';
    try {
      const items = await gh(`/contents/${encodeURIComponent(DIR)}?ref=main`);
      files = items.filter(i => i.type === 'file' && /\.xlsx$/i.test(i.name)).map(i => ({ name: i.name, sha: i.sha, size: i.size }));
      listBody.innerHTML = files.length ? files.map(f => `<tr>
          <td>${esc(f.name)}</td><td>${kb(f.size)}</td>
          <td><button type="button" class="linkbtn" data-dl="${esc(f.name)}">Tải về</button></td></tr>`).join('')
        : '<tr><td colspan="3" class="note">Chưa có file nào.</td></tr>';
    } catch (e) {
      listBody.innerHTML = `<tr><td colspan="3" class="note">Không đọc được danh sách: ${esc(e.message)}</td></tr>`;
    }
  }
  listBody.addEventListener('click', async e => {
    const name = e.target.dataset && e.target.dataset.dl;
    if (!name) return;
    e.target.disabled = true; e.target.textContent = 'Đang tải…';
    try {
      const res = await gh(`/contents/${encodeURIComponent(DIR)}/${encodeURIComponent(name)}?ref=main`, { raw: true, headers: { Accept: 'application/vnd.github.raw' } });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) { alert('Tải về thất bại: ' + err.message); }
    e.target.disabled = false; e.target.textContent = 'Tải về';
  });
  $('upRefresh').addEventListener('click', refreshList);

  // ------------------------------------------------------------ chọn file + kiểm tra
  function pick(file) {
    if (!/\.xlsx$/i.test(file.name)) { setStatus('Chỉ nhận file <b>.xlsx</b>.', 'bad'); return; }
    setStatus('');
    dzTitle.textContent = 'Đã chọn file';
    dzSub.innerHTML = `<span class="dz-file">📄 ${esc(file.name)}</span>`;
    const reader = new FileReader();
    reader.onload = ev => {
      const buf = ev.target.result;
      picked = { file, buf };
      const exists = files.find(f => f.name === file.name);
      let check = '';
      let ok = true;
      try {
        const wb = XLSX.read(buf, { type: 'array', cellDates: false });
        const r = window.KVH_runPipeline(wb, () => {});
        check = `<li class="good">✓ Đọc được dữ liệu: <b>${r.tongHopNV.length} nhân viên · ${r.donGiao.length} đơn giao · Tháng ${r.params.thangApDung}/${r.params.namApDung}</b></li>`;
      } catch (err) {
        ok = false;
        check = `<li class="bad">✗ File chưa đúng mẫu: ${esc(err.message)}</li>`;
      }
      check += exists
        ? `<li>↻ Sẽ <b>ghi đè</b> file cùng tên đang có (cập nhật trong tháng). Bản cũ vẫn được lưu trong lịch sử.</li>`
        : `<li>＋ Là <b>file mới</b> — hệ thống sẽ dùng file này làm tháng hiện tại.</li>`;
      checkBox.innerHTML = `<ul>${check}</ul>`;
      checkBox.hidden = false;
      sendBtn.disabled = !ok;
      sendBtn.textContent = exists ? 'Cập nhật file lên hệ thống' : 'Tải file mới lên hệ thống';
    };
    reader.readAsArrayBuffer(file);
  }
  dz.addEventListener('click', () => fileInput.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) pick(fileInput.files[0]); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(t => dz.addEventListener(t, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) pick(f); });

  // ------------------------------------------------------------ tải lên + theo dõi
  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  sendBtn.addEventListener('click', async () => {
    if (!picked) return;
    sendBtn.disabled = true;
    const name = picked.file.name;
    setStatus('⏳ Đang tải file lên…');
    try {
      // lấy sha mới nhất (file có thể vừa được hệ thống tính lại)
      await refreshList();
      const exists = files.find(f => f.name === name);
      const body = { message: `Cap nhat du lieu: ${name} (tai len tu web)`, content: toBase64(picked.buf), branch: 'main' };
      if (exists) body.sha = exists.sha;
      const res = await gh(`/contents/${encodeURIComponent(DIR)}/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) });
      const sha = res.commit.sha;
      setStatus('✅ Đã tải lên. ⏳ Hệ thống đang tự tính lại (khoảng 1–2 phút)…', 'good');
      await refreshList();
      watchRun(sha);
    } catch (e) {
      setStatus('❌ Tải lên thất bại: ' + esc(e.message), 'bad');
      sendBtn.disabled = false;
    }
  });

  async function watchRun(sha) {
    const started = Date.now();
    while (Date.now() - started < 6 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 6000));
      let run = null;
      try {
        const r = await gh(`/actions/workflows/${WORKFLOW}/runs?head_sha=${sha}&per_page=1`);
        run = r.workflow_runs && r.workflow_runs[0];
      } catch (e) { /* token chưa có quyền Actions: bỏ qua theo dõi */ break; }
      if (!run) continue;
      const link = `<a href="${run.html_url}" target="_blank" rel="noopener">xem chi tiết ↗</a>`;
      if (run.status !== 'completed') { setStatus(`✅ Đã tải lên. ⏳ Đang tính lại… (${link})`, 'good'); continue; }
      if (run.conclusion === 'success') {
        setStatus(`✅ Xong! File đã được tính lại và lưu vào hệ thống. Mail sẽ tự gửi theo lịch. (${link})`, 'good');
        refreshList();
      } else {
        setStatus(`❌ Tính lại bị lỗi — ${link}`, 'bad');
      }
      return;
    }
    setStatus(`✅ Đã tải lên. Xem tiến trình tính lại tại <a href="https://github.com/${OWNER}/${REPO}/actions" target="_blank" rel="noopener">tab Actions ↗</a>`, 'good');
  }

  if (token) connect(token);
})();
