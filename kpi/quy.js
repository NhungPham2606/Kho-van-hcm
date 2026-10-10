// Mục "Tổng hợp quý" (kpi/#tong-hop-quy): thả 3 file tổng hợp tháng ("00 TỔNG HỢP THƯỞNG KPIS VP.HCM m.yyyy.xlsx",
// sheet VP.HCM) -> bảng xét thưởng KPIs quý của Kế toán theo mẫu "Danh xét thưởng KPIs VP.HCM - Quý 2.2026.xlsx":
// điểm từng tháng = Tổng điểm còn lại, Trung bình, Xếp loại (A ≥960 · B ≥910 · C ≥850 · D), Mức thưởng (1,5tr/1,2tr/1tr).
// Tháng chưa thả file thì lấy kỳ đã lưu trên trang (nếu có). Lưu trong trình duyệt + kho riêng tư kpi/quy-YYYY-Qn.json.
(function () {
  'use strict';
  const root = document.getElementById('tkQuy');
  if (!root) return;
  const K = window.KPI;
  const tk = document.getElementById('tk');
  const API = `https://api.github.com/repos/${tk.dataset.owner}/${tk.dataset.repo}`, DIR = tk.dataset.dir;
  const LS_KEY = 'kvh-kpi-quy-v1', LS_SEL = 'kvh-kpi-quy-sel';
  const RULES = { nguong: { A: 960, B: 910, C: 850 }, muc: { A: 1500000, B: 1200000, C: 1000000, D: 0 } };
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const vnd = n => Math.round(n || 0).toLocaleString('vi-VN');
  const fmt = n => n === null || n === undefined ? '' : String(Math.round(n * 100) / 100).replace('.', ',');
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const msg = (html, ok) => { $('qMsg').innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const quyOf = k => `${k.slice(0, 4)}-Q${Math.ceil(+k.slice(5) / 3)}`;
  const thangOf = q => { const y = q.slice(0, 4), n = +q.slice(6); return [1, 2, 3].map(i => `${y}-${pad2((n - 1) * 3 + i)}`); };
  const quyLabel = q => `Quý ${+q.slice(6)}/${q.slice(0, 4)}`;
  const xepLoai = d => d >= RULES.nguong.A ? 'A' : d >= RULES.nguong.B ? 'B' : d >= RULES.nguong.C ? 'C' : 'D';

  // ------------------------------------------------------------ lưu trữ + đồng bộ
  let store = {}; try { store = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) {}
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  const token = (() => { try { return localStorage.getItem('kvh-gh-token') || ''; } catch (e) { return ''; } })();
  const sha = {}, timers = {};
  let syncMsg = token ? '' : 'Chưa kết nối hệ thống — dữ liệu quý chỉ lưu trên trình duyệt của máy này.';
  const persist = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); localStorage.setItem(LS_SEL, sel); } catch (e) {} };
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
    if (!res.ok) { let m = res.status + ''; try { m = (await res.json()).message || m; } catch (e) {} const err = new Error(m); err.status = res.status; throw err; }
    return res.status === 204 ? null : res.json();
  }
  const b64enc = t => { const b = new TextEncoder().encode(t); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  async function pull() {
    if (!token) return;
    try {
      let items = []; try { items = await gh(`/contents/${DIR}?ref=main&t=${Date.now()}`); } catch (e) { if (e.status !== 404) throw e; }
      for (const it of items.filter(i => /^quy-\d{4}-Q[1-4]\.json$/.test(i.name))) {
        const q = it.name.slice(4, -5); sha[q] = it.sha;
        const remote = JSON.parse(b64dec((await gh(`/contents/${DIR}/${it.name}?ref=main`)).content || '') || '{}');
        if (!store[q] || (remote.savedAt || '') >= (store[q].savedAt || '')) store[q] = remote; else save(q, 0);
      }
      for (const q of Object.keys(store)) if (!sha[q]) save(q, 0);
      syncMsg = 'Đã đồng bộ với hệ thống.'; persist(); render();
    } catch (e) { syncMsg = 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.'; render(); }
  }
  function save(q, delay = 1200) { if (!token) return; clearTimeout(timers[q]); timers[q] = setTimeout(() => put(q), delay); }
  async function put(q) {
    const path = `/contents/${DIR}/quy-${q}.json`;
    try {
      for (let lan = 0; lan < 3; lan++) {
        try {
          if (!store[q]) { if (sha[q]) { await gh(path, { method: 'DELETE', body: JSON.stringify({ message: `Xoa KPIs ${q} (tu web)`, sha: sha[q], branch: 'main' }) }); delete sha[q]; } return; }
          const body = { message: `KPIs ${q} (tu web)`, content: b64enc(JSON.stringify(store[q])), branch: 'main' };
          if (sha[q]) body.sha = sha[q];
          sha[q] = (await gh(path, { method: 'PUT', body: JSON.stringify(body) })).content.sha;
          syncMsg = `Đã lưu ${quyLabel(q)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`; break;
        } catch (e) {
          if ((e.status === 409 || e.status === 422) && lan < 2) { try { sha[q] = (await gh(`${path}?ref=main&t=${Date.now()}`)).sha; } catch (e2) { if (e2.status === 404) delete sha[q]; else throw e2; } continue; }
          throw e;
        }
      }
    } catch (e) { syncMsg = `Chưa lưu được ${quyLabel(q)} lên hệ thống (${e.message}).`; }
    render();
  }
  const touch = q => { store[q].savedAt = new Date().toISOString(); persist(); save(q); };

  // ------------------------------------------------------------ đọc file tổng hợp tháng (sheet VP.HCM)
  const nk = s => K.nameKey(s);
  function parseMonth(wb, fileName) {
    const names = wb.SheetNames.slice().sort((a, b) => (b === 'VP.HCM') - (a === 'VP.HCM'));
    for (const sn of names) {
      const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
      const hi = aoa.findIndex(r => (r || []).some(c => ['ma nv', 'ma nhan vien'].includes(nk(c))));
      if (hi < 0) continue;
      const H = aoa[hi].map(nk), col = f => H.findIndex(f);
      const c = {
        ma: col(h => h === 'ma nv' || h === 'ma nhan vien'), ten: col(h => h === 'ho va ten' || h === 'ho ten'),
        ban: col(h => h.startsWith('diem danh gia ban dau')), tru: col(h => h === 'diem tru'),
        con: col(h => h.startsWith('tong diem')), xl: col(h => h === 'xep loai'), kv: col(h => h === 'kv'),
      };
      if (c.ma < 0 || c.ten < 0 || (c.ban < 0 && c.con < 0)) continue;
      let thang = null, nam = null;
      for (const r of aoa.slice(0, hi)) for (const v of r || []) { const m = String(v ?? '').match(/TH[ÁA]NG\s*(\d{1,2})\s*N[ĂA]M\s*(\d{4})/i); if (m && !thang) { thang = +m[1]; nam = +m[2]; } }
      if (!thang) { const m = fileName.match(/(?:^|\D)(\d{1,2})[.\-_ ](20\d{2})(?:\D|$)/); if (m) { thang = +m[1]; nam = +m[2]; } }
      if (!thang) throw new Error('không thấy "THÁNG … NĂM …" trong file');
      const num = v => typeof v === 'number' ? v : (v === null || v === '' || isNaN(Number(String(v).replace(',', '.'))) ? null : Number(String(v).replace(',', '.')));
      const list = []; let group = '';
      for (const r of aoa.slice(hi + 1)) {
        if (!r || r.every(v => v === null || v === '')) continue;
        const a = String(r[0] ?? '').trim(), ma = r[c.ma];
        if (/^t[oổ]ng/i.test(nk(a)) || /^nguoi lap/.test(nk(a))) break;
        if ((ma === null || ma === '') && a && isNaN(Number(a))) { group = a; continue; }
        if (ma === null || ma === '') continue;
        const maS = typeof ma === 'number' ? String(ma).padStart(6, '0') : K.normMa(ma);
        const ban = c.ban >= 0 ? num(r[c.ban]) : null, tru = c.tru >= 0 ? num(r[c.tru]) || 0 : 0;
        const xl = c.xl >= 0 ? String(r[c.xl] ?? '').trim().toUpperCase() : '';
        const diem = xl === 'TS' ? null : ban !== null ? ban - tru : null;
        list.push({ group, ma: maS, ten: String(r[c.ten] ?? '').trim(), kv: c.kv >= 0 ? String(r[c.kv] ?? '').trim() : '', diem, ts: xl === 'TS' });
      }
      if (!list.length) continue;
      return { ky: `${nam}-${pad2(thang)}`, fileName, list };
    }
    throw new Error('không thấy bảng có cột "Mã NV" + "Điểm đánh giá ban đầu" (sheet VP.HCM)');
  }
  // thưởng quý chỉ cho Kế toán + Admin (KV bắt đầu KT… hoặc ADETC); Kho / Giao hàng / Lái xe không có thưởng quý
  const laKeToan = e => e.kv ? K.isKeToan(e.kv) : nk(e.group).startsWith('ke toan');
  const vpOf = (group, kv) => {
    const g = nk(group);
    return /can tho/.test(g) ? 'VP.CT' : /tay nguyen|da lat|dak lak/.test(g) ? 'VP.ĐL' : /khanh hoa|nha trang/.test(g) ? 'VP.KH' : /hcm|ho chi minh/.test(g) ? 'VP.HCM' : kv;
  };

  // tháng chưa thả file -> lấy kỳ đã lưu trên trang (bảng tổng hợp tháng)
  function monthData(q, k) {
    const f = store[q] && store[q].months && store[q].months[k];
    if (f) return { src: 'file', fileName: f.fileName, list: f.list };
    const rows = window.KPI_rowsOf ? window.KPI_rowsOf(k) : null;
    if (rows && rows.length) return { src: 'ky', list: rows.map(r => ({ group: r.group, ma: r.ma, ten: r.ten, kv: r.kv, diem: r.ts || !r.nop ? null : r.conLai, ts: !!r.ts })) };
    return null;
  }
  function compute(q) {
    const ks = thangOf(q), md = ks.map(k => monthData(q, k)), inp = (store[q] && store[q].inputs) || {};
    const by = {}, order = [];
    [2, 1, 0].forEach(i => (md[i] ? md[i].list : []).filter(laKeToan).forEach(e => {
      if (!by[e.ma]) { by[e.ma] = { ma: e.ma, ten: e.ten, group: e.group, kv: e.kv, diem: [null, null, null], ts: [false, false, false], co: [false, false, false] }; order.push(e.ma); }
      const o = by[e.ma]; o.diem[i] = e.diem; o.ts[i] = e.ts; o.co[i] = true;
    }));
    // đã nghỉ việc (không còn trong danh sách tháng mới nhất của quý) -> không tổng hợp
    const iLast = [2, 1, 0].find(i => md[i]);
    const conLam = ma => iLast === undefined || by[ma].co[iLast];
    const nghiViec = order.filter(ma => !conLam(ma)).map(ma => by[ma]);
    const keep = order.filter(conLam);
    const groups = []; keep.forEach(ma => { if (!groups.includes(by[ma].group)) groups.push(by[ma].group); });
    const rows = [];
    groups.forEach(g => keep.filter(ma => by[ma].group === g).forEach(ma => {
      const o = by[ma], d = o.diem.filter(v => v !== null);
      const tsT = ks.filter((k, i) => o.ts[i]).map(k => +k.slice(5));
      o.tsan = tsT.length > 0;
      o.tb = d.length ? d.reduce((s, v) => s + v, 0) / d.length : null;
      // nghỉ thai sản: vẫn thống kê điểm các tháng còn đi làm, xếp loại TS, không thưởng quý
      o.xl = o.tsan ? 'TS' : o.tb === null ? '' : xepLoai(o.tb);
      o.du = d.length === 3 && !o.tsan;
      o.xet = inp[ma] && typeof inp[ma].xet === 'boolean' ? inp[ma].xet : o.du;
      o.xetTay = !!(inp[ma] && typeof inp[ma].xet === 'boolean');
      o.muc = o.xet && o.tb !== null ? RULES.muc[xepLoai(o.tb)] : 0;
      o.vp = vpOf(o.group, o.kv);
      o.ghiChu = o.tsan ? `${o.vp} - Nghỉ thai sản${tsT.length < 3 ? ' T' + tsT.join(', T') : ' cả quý'}` : o.vp;
      o.nx = ks.map((k, i) => !md[i] || o.ts[i] ? '' : !o.co[i] ? `T${+k.slice(5)} không có trong danh sách` : o.diem[i] === null ? `T${+k.slice(5)} không có điểm` : '').filter(Boolean)
        .concat(o.tsan ? ['Nghỉ thai sản – không tính thưởng quý'] : []).join('; ');
      rows.push(o);
    }));
    return { ks, md, rows, nghiViec };
  }

  // ------------------------------------------------------------ hiển thị
  const quys = () => {
    const d = new Date(), q0 = quyOf(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
    const prev = +q0.slice(6) === 1 ? `${+q0.slice(0, 4) - 1}-Q4` : `${q0.slice(0, 4)}-Q${+q0.slice(6) - 1}`;
    return [...new Set([...Object.keys(store), prev])].sort().reverse();
  };
  const cur = () => quys().includes(sel) ? sel : (Object.keys(store).sort().reverse()[0] || quys()[0]);
  let last = null;
  function render() {
    if (root.hidden) return;
    const q = cur(), r = last = compute(q), L = r.rows;
    $('qChips').innerHTML = quys().map(x => `<button type="button" class="b sm${x === q ? ' pri' : ''}" data-quy="${x}">${quyLabel(x)}</button>`).join('');
    $('qMonths').innerHTML = r.ks.map((k, i) => {
      const m = r.md[i], t = `Tháng ${+k.slice(5)}/${k.slice(0, 4)}`;
      return `<span class="chip" style="${m ? 'background:#ecfdf5;color:#065f46' : 'background:#fee2e2;color:#991b1b'}">${t}: ${!m ? 'chưa có' : m.src === 'file' ? `${esc(m.fileName)} <button type="button" title="Bỏ file này" data-qrm="${k}">✕</button>` : 'lấy từ kỳ đã lưu trên trang'}</span>`;
    }).join(' ');
    $('qSync').textContent = syncMsg;
    $('qTitle').innerHTML = `DANH SÁCH XÉT THƯỞNG KPIs QUÝ ${+q.slice(6)} NĂM ${q.slice(0, 4)}<br>Bộ phận: Kế toán - CN HCM`;
    const cnt = l => L.filter(o => o.xl === l).length, tien = L.reduce((s, o) => s + o.muc, 0);
    $('qStats').innerHTML = `<div class="tk-stat blue"><div class="l">Kế toán + Admin</div><div class="v">${L.length}</div><div class="stat-sub">${L.filter(o => o.tsan).length} nghỉ thai sản · ${L.filter(o => !o.du && !o.tsan).length} chưa đủ 3 tháng</div></div>
      <div class="tk-stat"><div class="l">Xếp loại A / B / C / D</div><div class="v" style="font-size:20px">${['A', 'B', 'C', 'D'].map(l => `<span class="xl ${l}">${cnt(l)}</span>`).join(' ')}</div><div class="stat-sub">Theo điểm trung bình 3 tháng</div></div>
      <div class="tk-stat green"><div class="l">Tổng thưởng quý</div><div class="v">${vnd(tien)}đ</div><div class="stat-sub">${esc(window.KVH_bangChu ? window.KVH_bangChu(tien) : bangChu(tien))}</div></div>`;
    $('qHead').innerHTML = `<th class="r">STT</th><th>Mã NV</th><th style="min-width:170px">Họ và tên</th>${r.ks.map(k => `<th class="r">Tháng ${+k.slice(5)}</th>`).join('')}<th class="r">Trung bình</th><th>Xếp loại</th><th class="r">Mức thưởng</th><th class="r">Tổng thưởng</th><th>Ghi chú</th><th>Xét thưởng</th><th style="min-width:200px">Nhận xét</th>`;
    let html = '', g = null;
    L.forEach((o, i) => {
      if (o.group !== g) { g = o.group; html += `<tr class="grp"><td colspan="13">${esc(g)}</td></tr>`; }
      html += `<tr class="${o.tsan ? 'tsan' : o.xet ? '' : 'nonop'}"><td class="r">${i + 1}</td><td>${esc(o.ma)}</td><td class="name">${esc(o.ten)}</td>
        ${o.diem.map(v => `<td class="r">${fmt(v)}</td>`).join('')}<td class="r bold">${fmt(o.tb)}</td><td>${o.xl ? `<span class="xl ${o.xl}">${o.xl}</span>` : ''}</td>
        <td class="r">${o.xet ? vnd(o.muc) : ''}</td><td class="r money">${o.xet ? vnd(o.muc) : ''}</td><td class="kv-badge">${esc(o.ghiChu)}</td>
        <td><label class="ts-chk"><input type="checkbox" data-qxet="${esc(o.ma)}"${o.xet ? ' checked' : ''}> ${o.xetTay ? '<span class="src">(sửa tay)</span>' : o.du ? '' : `<span class="src">(${o.tsan ? 'nghỉ thai sản' : 'chưa đủ 3 tháng'})</span>`}</label></td>
        <td class="note">${esc(o.nx)}</td></tr>`;
    });
    $('qBody').innerHTML = html || `<tr><td colspan="13" style="text-align:center;color:#9ca3af;padding:20px">Chưa có dữ liệu — thả file tổng hợp tháng ${r.ks.map(k => +k.slice(5)).join(', ')} vào ô phía trên</td></tr>`;
    $('qMonths').innerHTML += r.nghiViec.length ? `<div class="muted" style="width:100%;margin-top:6px">Không tổng hợp (đã nghỉ việc — không còn trong danh sách tháng cuối): ${r.nghiViec.map(o => `${esc(o.ma)} ${esc(o.ten)}`).join(', ')}</div>` : '';
    $('qFoot').innerHTML = `<td colspan="10">Tổng (${L.length} nhân viên)</td><td class="r">${vnd(tien)}</td><td colspan="2"></td>`;
  }

  // ------------------------------------------------------------ số tiền bằng chữ (như trang Đề nghị thanh toán)
  const SO = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
  function doc3(n, du) {
    const h = Math.floor(n / 100), t = Math.floor(n % 100 / 10), u = n % 10, p = [];
    if (h || du) p.push(SO[h] + ' trăm');
    if (t === 0) { if (u && (h || du)) p.push('lẻ'); } else p.push(t === 1 ? 'mười' : SO[t] + ' mươi');
    if (u) p.push(u === 1 && t >= 2 ? 'mốt' : u === 5 && t >= 1 ? 'lăm' : SO[u]);
    return p.join(' ');
  }
  function docSo(n, du) {
    const ty = Math.floor(n / 1e9), r = n % 1e9, p = []; let bat = !!du;
    if (ty) { p.push(docSo(ty, du) + ' tỷ'); bat = true; }
    [[Math.floor(r / 1e6), 'triệu'], [Math.floor(r % 1e6 / 1000), 'nghìn'], [r % 1000, '']].forEach(([g, dv]) => { if (g) { p.push(doc3(g, bat) + (dv ? ' ' + dv : '')); bat = true; } });
    return p.join(' ');
  }
  function bangChu(n) { n = Math.round(n || 0); if (!n) return 'Không đồng'; const s = docSo(n, false) + ' đồng'; return s.charAt(0).toUpperCase() + s.slice(1); }

  // ------------------------------------------------------------ nạp file
  const readBuf = f => new Promise((ok, fail) => { const r = new FileReader(); r.onload = e => ok(e.target.result); r.onerror = () => fail(new Error('Không đọc được file')); r.readAsArrayBuffer(f); });
  async function importFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) { msg('Trình duyệt không nhận được file nào — lưu file về máy trước rồi chọn lại.'); return; }
    const ok = [], bad = [];
    for (const f of files) {
      try { ok.push(parseMonth(XLSX.read(await readBuf(f), { type: 'array' }), f.name)); }
      catch (e) { bad.push(`${esc(f.name)}: ${esc(e.message)}`); }
    }
    let qLast = '';
    ok.forEach(p => {
      const q = quyOf(p.ky), e = store[q] = store[q] || { months: {}, inputs: {} };
      e.months = e.months || {}; e.months[p.ky] = { fileName: p.fileName, list: p.list };
      if (!qLast || q > qLast) qLast = q;
    });
    [...new Set(ok.map(p => quyOf(p.ky)))].forEach(touch);
    if (qLast) sel = qLast; persist(); render();
    const kt = p => p.list.filter(laKeToan).length;
    msg((ok.length ? `Đã nạp: ${ok.map(p => `<b>T${+p.ky.slice(5)}/${p.ky.slice(0, 4)}</b> (${esc(p.fileName)} · ${kt(p)} NV kế toán + admin)`).join(', ')}` : '') +
      (bad.length ? `${ok.length ? '<br>' : ''}Không đọc được ${bad.length} file:<br>${bad.join('<br>')}` : ''), !bad.length);
  }
  const zone = $('qZone'), input = $('qFile');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { importFiles(input.files); input.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  // thả ở đâu trong mục quý cũng nạp vào quý (chặn trang tháng nhận nhầm)
  root.addEventListener('dragover', e => e.preventDefault());
  root.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag'); importFiles(e.dataTransfer.files); });

  root.addEventListener('click', e => {
    const t = e.target.closest('[data-quy],[data-qrm]'); if (!t) return;
    if (t.dataset.quy) { sel = t.dataset.quy; persist(); render(); return; }
    const q = cur(); delete store[q].months[t.dataset.qrm]; touch(q); render();
  });
  root.addEventListener('change', e => {
    const t = e.target; if (!t.dataset || !t.dataset.qxet) return;
    const q = cur(), e2 = store[q] = store[q] || { months: {}, inputs: {} }, inp = e2.inputs = e2.inputs || {};
    const o = last && last.rows.find(x => x.ma === t.dataset.qxet);
    if (o && t.checked === o.du) delete inp[t.dataset.qxet]; else inp[t.dataset.qxet] = { xet: t.checked }; // trùng mặc định -> bỏ sửa tay
    touch(q); const y = window.scrollY; render(); window.scrollTo(0, y);
  });
  $('qDelete').addEventListener('click', () => {
    const q = cur(); if (!store[q] || !confirm(`Xoá các file đã nạp và phần sửa tay của ${quyLabel(q)}?`)) return;
    delete store[q]; persist(); save(q, 0); render();
  });

  // ------------------------------------------------------------ xuất Excel theo mẫu Quý 2.2026
  $('qExport').addEventListener('click', () => {
    const q = cur(), r = compute(q), L = r.rows, today = new Date();
    if (!L.length) { msg('Chưa có dữ liệu để xuất.'); return; }
    const thin = { style: 'thin', color: { rgb: '000000' } }, B = { top: thin, bottom: thin, left: thin, right: thin };
    const ctr = { horizontal: 'center', vertical: 'center', wrapText: true };
    const aoa = [[], [null, 'Công ty Cổ phần Dược phẩm CPC1 Hà Nội - Chi Nhánh Thành Phố Hồ Chí Minh'], [],
      [`DANH SÁCH XÉT THƯỞNG KPIs QUÝ ${+q.slice(6)} NĂM ${q.slice(0, 4)}`], ['Bộ phận: kế toán - CN HCM'], [],
      ['STT', 'Mã nhân viên', 'Họ và tên', ...r.ks.map(k => `Tháng ${+k.slice(5)}`), 'Trung bình', 'Xếp loại', 'Mức thưởng', 'Tổng thưởng', 'Ghi chú']];
    const kind = []; let g = null, stt = 0;
    L.forEach(o => {
      if (o.group !== g) { g = o.group; aoa.push([g]); kind.push('g'); }
      aoa.push([++stt, o.ma, o.ten, ...o.diem, o.tb, o.xl || null, o.xet ? o.muc : null, o.xet ? o.muc : null, o.ghiChu]); kind.push(o);
    });
    const tien = L.reduce((s, o) => s + o.muc, 0);
    aoa.push(['Tổng', null, null, null, null, null, null, null, null, tien]); kind.push('t');
    aoa.push(['Bằng chữ: ', null, bangChu(tien)], [], [null, null, null, null, null, null, `Tp.Hồ Chí Minh, ngày ${pad2(today.getDate())} tháng ${pad2(today.getMonth() + 1)} năm ${today.getFullYear()}`],
      ['Người lập biểu', null, null, 'Kế toán trưởng', null, null, null, null, null, 'Giám đốc CN'], [], [], [], [], [], ['Phạm Thị Nhung', null, null, null, null, null, null, null, null, 'Phương Thu']);
    const ws = XLSX.utils.aoa_to_sheet(aoa), A = (rr, c) => XLSX.utils.encode_cell({ r: rr, c });
    const set = (rr, c, s) => { const a = A(rr, c); if (!ws[a]) ws[a] = { t: 's', v: '' }; ws[a].s = s; };
    set(1, 1, { font: { bold: true } });
    for (let c = 0; c < 11; c++) { set(3, c, { font: { bold: true, sz: 14 }, alignment: ctr }); set(4, c, { font: { bold: true }, alignment: ctr }); set(6, c, { font: { bold: true }, alignment: ctr, border: B }); }
    const merges = [{ s: { r: 1, c: 1 }, e: { r: 1, c: 6 } }, { s: { r: 3, c: 0 }, e: { r: 3, c: 10 } }, { s: { r: 4, c: 0 }, e: { r: 4, c: 10 } }];
    const first = 7, last = first + kind.length - 1; // dòng "Tổng" = last
    kind.forEach((kd, i) => {
      const R = first + i, n = R + 1; // n = số dòng Excel
      for (let c = 0; c < 11; c++) set(R, c, { border: B, font: { bold: kd === 'g' || kd === 't' }, alignment: { vertical: 'center', horizontal: kd === 'g' ? 'left' : [0, 1, 7, 10].includes(c) ? 'center' : c >= 3 ? 'right' : 'left' } });
      if (kd === 'g') { merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 2 } }); return; }
      if (kd === 't') {
        merges.push({ s: { r: R, c: 0 }, e: { r: R, c: 8 } });
        ws[A(R, 9)] = { t: 'n', v: tien, f: `SUM(J${first + 1}:J${n - 1})`, z: '#,##0', s: ws[A(R, 9)].s };
        set(R, 0, { border: B, font: { bold: true }, alignment: { horizontal: 'center', vertical: 'center' } });
        return;
      }
      const s = c => ws[A(R, c)].s;
      if (kd.tb !== null) ws[A(R, 6)] = { t: 'n', v: kd.tb, f: `+AVERAGE(D${n}:F${n})`, z: '0.00', s: s(6) };
      if (kd.xl && !kd.tsan) ws[A(R, 7)] = { t: 's', v: kd.xl, f: `+IF(G${n}>=${RULES.nguong.A},"A",IF(G${n}>=${RULES.nguong.B},"B",IF(G${n}>=${RULES.nguong.C},"C",IF(G${n}<${RULES.nguong.C},"D",""))))`, s: s(7) };
      if (kd.xet && !kd.tsan) {
        ws[A(R, 8)] = { t: 'n', v: kd.muc, f: `+IF(H${n}="A",${RULES.muc.A},IF(H${n}="B",${RULES.muc.B},IF(H${n}="C",${RULES.muc.C},0)))`, z: '#,##0', s: s(8) };
        ws[A(R, 9)] = { t: 'n', v: kd.muc, f: `I${n}`, z: '#,##0', s: s(9) };
      }
    });
    const bc = last + 1;
    set(bc, 0, { font: { bold: true } }); set(bc, 2, { font: { bold: true, italic: true } });
    merges.push({ s: { r: bc, c: 2 }, e: { r: bc, c: 10 } }, { s: { r: bc + 2, c: 6 }, e: { r: bc + 2, c: 10 } },
      { s: { r: bc + 3, c: 0 }, e: { r: bc + 3, c: 2 } }, { s: { r: bc + 3, c: 3 }, e: { r: bc + 3, c: 7 } }, { s: { r: bc + 3, c: 9 }, e: { r: bc + 3, c: 10 } },
      { s: { r: bc + 9, c: 0 }, e: { r: bc + 9, c: 2 } }, { s: { r: bc + 9, c: 9 }, e: { r: bc + 9, c: 10 } });
    set(bc + 2, 6, { font: { italic: true }, alignment: { horizontal: 'center' } });
    [0, 3, 9].forEach(c => set(bc + 3, c, { font: { bold: true }, alignment: { horizontal: 'center' } }));
    [0, 9].forEach(c => set(bc + 9, c, { font: { bold: true }, alignment: { horizontal: 'center' } }));
    ws['!merges'] = merges;
    ws['!cols'] = [7.1, 12.6, 25.6, 10.1, 10.1, 10.1, 11, 9, 12.7, 15.1, 15.9].map(w => ({ wch: w }));
    ws['!rows'] = [{}, {}, {}, { hpt: 22 }, {}, {}, { hpt: 30 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `Danh xét thưởng KPIs VP.HCM - Quý ${+q.slice(6)}.${q.slice(0, 4)}.xlsx`);
  });

  window.addEventListener('kpi:render', render); // trang tháng vẽ lại (vd vừa đồng bộ kỳ) -> cập nhật tháng lấy từ kỳ đã lưu
  window.KPI_quyRender = render;
  render();
  pull();
})();
