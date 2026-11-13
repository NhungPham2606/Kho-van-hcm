// Trang "Đánh Giá CL NS" — đánh giá chất lượng – năng suất nhân viên kho vận HCM theo tháng.
// Mỗi tháng thả file kho (giống Thưởng kho) + file sàn (giống Thưởng sàn) → bảng điểm, xếp loại, dashboard,
// chi tiết theo ngày, xu hướng nhiều tháng; lỗi chất lượng nhập tay. Lưu theo tháng trong trình duyệt và —
// nếu máy đã kết nối hệ thống (token ở Báo cáo giao hàng → Cập nhật dữ liệu) — kho riêng tư, thư mục danh-gia/.
(function () {
  'use strict';
  const root = document.getElementById('dg');
  if (!root) return;
  const OWNER = root.dataset.owner, REPO = root.dataset.repo, DIR = root.dataset.dir;
  const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
  const LS_KEY = 'kvh-danhgia-v1', LS_CFG = 'kvh-danhgia-caidat', LS_CAP = 'kvh-danhgia-dongcap', LS_SEL = 'kvh-danhgia-sel', TOKEN_KEY = 'kvh-gh-token';
  const VER = '20261113g';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => Math.round(n || 0).toLocaleString('vi-VN');
  const n1 = n => (Math.round((n || 0) * 10) / 10).toLocaleString('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nSmart = n => { const r = Math.round((n || 0) * 10) / 10; return r.toLocaleString('vi-VN', { maximumFractionDigits: 1 }); };
  const pct = x => Math.round((x || 0) * 100) + '%';
  const hm = m => m === null || m === undefined ? '–' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const msg = (el, html, ok) => { el.innerHTML = html ? `<div class="${ok ? 'tk-okmsg' : 'tk-err'}">${html}</div>` : ''; };
  const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const fold = s => DG.fold(s);
  const xlBadge = x => `<span class="xl-b xl-${esc(x)}">${esc(x)}</span>`;

  // ------------------------------------------------------------ lưu trữ + đồng bộ
  const lsJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') || d; } catch (e) { return d; } };
  let archive = lsJSON(LS_KEY, {});
  const CAI_DAT_MD = () => ({ cfg: {}, chon: {}, nhom: {}, mnvRows: null, mnvKy: '', dungCC: true, dungCap: true, savedAt: '' });
  let caiDat = Object.assign(CAI_DAT_MD(), lsJSON(LS_CFG, {}));
  // Đóng cặp: 1 danh sách chung cho mọi tháng (cặp áp theo ngày), người ngoài danh sách, cặp lấy từ Thưởng kho/sàn mà bỏ qua
  const DONG_CAP_MD = () => ({ list: [], ngoai: [], boQua: [], savedAt: '' });
  let dongCap = Object.assign(DONG_CAP_MD(), lsJSON(LS_CAP, {}));
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {};
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  const saveTimers = {};

  function persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(archive)); } catch (e) { syncMsg = 'Bộ nhớ trình duyệt đầy — chưa lưu được trên máy này.'; }
    try { localStorage.setItem(LS_CFG, JSON.stringify(caiDat)); } catch (e) {}
    try { localStorage.setItem(LS_CAP, JSON.stringify(dongCap)); } catch (e) {}
    try { localStorage.setItem(LS_SEL, sel); } catch (e) {}
  }
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, { ...opts, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) } });
    if (!res.ok) { let m = res.status + ''; try { m = (await res.json()).message || m; } catch (e) {} const err = new Error(m); err.status = res.status; throw err; }
    return res.status === 204 ? null : res.json();
  }
  const b64enc = text => { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), c => c.charCodeAt(0)));
  const KY_RE = /^\d{4}-\d{2}$/;

  async function pullFromRepo() {
    if (!token) return;
    try {
      let items = [];
      try { items = await gh(`/contents/${DIR}?ref=main&t=${Date.now()}`); } catch (e) { if (e.status !== 404) throw e; }
      for (const it of items.filter(i => /^(\d{4}-\d{2}|cai-dat|dong-cap)\.json$/.test(i.name))) {
        const name = it.name.replace('.json', '');
        repoSha[name] = it.sha;
        const meta = await gh(`/contents/${DIR}/${it.name}?ref=main`);
        const remote = JSON.parse(b64dec(meta.content || '') || '{}');
        if (name === 'cai-dat') { if ((remote.savedAt || '') >= (caiDat.savedAt || '')) caiDat = Object.assign(CAI_DAT_MD(), remote); }
        else if (name === 'dong-cap') { if ((remote.savedAt || '') >= (dongCap.savedAt || '')) dongCap = Object.assign(DONG_CAP_MD(), remote); }
        else if (!archive[name] || (remote.savedAt || '') >= (archive[name].savedAt || '')) archive[name] = remote;
      }
      Object.keys(archive).forEach(k => { if (!repoSha[k]) scheduleSave(k, 0); });
      if (!repoSha['cai-dat'] && caiDat.savedAt) scheduleSave('cai-dat', 0);
      if (!repoSha['dong-cap'] && dongCap.savedAt) scheduleSave('dong-cap', 0);
      syncMsg = 'Đã đồng bộ với hệ thống — mở trên máy khác cũng thấy.';
      persistLocal(); renderAll();
    } catch (e) {
      syncMsg = e.status === 401 ? 'Token hết hạn / không đúng — kết nối lại ở Báo cáo giao hàng → Cập nhật dữ liệu. Dữ liệu vẫn lưu trên máy này.'
        : 'Không đồng bộ được với hệ thống: ' + e.message + '. Dữ liệu vẫn lưu trên máy này.';
      renderTop();
    }
  }
  function scheduleSave(name, delay = 1500) {
    if (!token) return;
    clearTimeout(saveTimers[name]);
    saveTimers[name] = setTimeout(async () => {
      const data = name === 'cai-dat' ? caiDat : name === 'dong-cap' ? dongCap : archive[name];
      if (!data) return;
      try {
        const body = { message: `${DIR} ${name} (tu web)`, content: b64enc(JSON.stringify(data)), branch: 'main' };
        if (repoSha[name]) body.sha = repoSha[name];
        const r = await gh(`/contents/${DIR}/${name}.json`, { method: 'PUT', body: JSON.stringify(body) });
        repoSha[name] = r.content.sha;
        syncMsg = `Đã lưu ${name === 'cai-dat' ? 'tiêu chí / danh sách' : name === 'dong-cap' ? 'danh sách đóng cặp' : DG.kyLabel(name)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
      } catch (e) {
        syncMsg = `Chưa lưu được lên hệ thống (${e.message}) — vẫn còn trên máy này.`;
        if (e.status === 409 || e.status === 422) delete repoSha[name];
      }
      renderTop();
    }, delay);
  }
  async function deleteRemote(name) {
    if (!token || !repoSha[name]) return;
    try { await gh(`/contents/${DIR}/${name}.json`, { method: 'DELETE', body: JSON.stringify({ message: `${DIR} xoa ${name} (tu web)`, sha: repoSha[name], branch: 'main' }) }); delete repoSha[name]; } catch (e) {}
  }
  function touch(ky) { archive[ky].savedAt = new Date().toISOString(); persistLocal(); scheduleSave(ky); }
  function touchCfg() { caiDat.savedAt = new Date().toISOString(); persistLocal(); scheduleSave('cai-dat'); }
  function touchCap() { dongCap.savedAt = new Date().toISOString(); persistLocal(); scheduleSave('dong-cap'); }

  // ------------------------------------------------------------ dữ liệu của các trang khác (chỉ đọc)
  // Đóng cặp: trang Thưởng kho / Thưởng sàn (theo quý); ngày công: trang Chấm Công (theo tháng);
  // bảng mã nv dự phòng: Thưởng kho. Lấy bản mới hơn giữa máy này và hệ thống.
  const LS_OTHER = { tk: lsJSON('kvh-thuongkho-v1', {}), ts: lsJSON('kvh-thuongsan-v1', {}), cc: lsJSON('kvh-chamcong-v1', {}) };
  const EXT_DIR = { tk: 'thuong-kho', ts: 'thuong-san', cc: 'cham-cong' };
  const ext = { tk: {}, ts: {}, cc: {} };
  function fetchExt(kind, name) {
    if (!token || name in ext[kind]) return;
    ext[kind][name] = null;
    gh(`/contents/${EXT_DIR[kind]}/${name}.json?ref=main&t=${Date.now()}`)
      .then(m => { ext[kind][name] = JSON.parse(b64dec(m.content || '') || 'null'); renderAll(); })
      .catch(() => {});
  }
  function other(kind, name) {
    fetchExt(kind, name);
    const loc = LS_OTHER[kind][name] || null, rem = ext[kind][name] || null;
    return loc && rem ? ((rem.savedAt || '') > (loc.savedAt || '') ? rem : loc) : (loc || rem);
  }
  const capOf = (ky, kind) => { const q = other(kind, DG.quyCua(ky)); return (q && q.adjustments) || []; };
  const thangCuoi = ky => { const [y, m] = ky.split('-').map(Number); return `${ky}-${DG.pad2(new Date(y, m, 0).getDate())}`; };
  const giaoThang = (a, ky) => a.dateFrom <= thangCuoi(ky) && a.dateTo >= `${ky}-01`;
  const samePair = (a, x, y) => (a.maNV1 === x && a.maNV2 === y) || (a.maNV1 === y && a.maNV2 === x);
  const sameCap = (a, b) => samePair(a, b.maNV1, b.maNV2) && a.dateFrom === b.dateFrom && a.dateTo === b.dateTo && (a.buoi || '') === (b.buoi || '');
  const AP = { kho: 'Kho', san: 'Sàn', ca: 'Kho + sàn' };
  const apCo = (a, kind) => (a.ap || 'kho') === 'ca' || (a.ap || 'kho') === kind;
  // Các cặp áp cho 1 tháng: cặp khai ở trang này + cặp đã khai ở Thưởng kho (áp lượt kho) / Thưởng sàn (áp lượt sàn)
  // của quý chứa tháng đó; trùng với cặp của trang này thì không lấy lại. dung = false: đã bấm "Không dùng".
  function capList(ky) {
    const own = dongCap.list.filter(a => giaoThang(a, ky)).map(a => ({ ...a, key: 'own:' + a.id, nguon: 'own', ap: a.ap || 'kho', dung: true }));
    const q = DG.quyCua(ky), out = [...own];
    [['tk', 'kho'], ['ts', 'san']].forEach(([kind, ap]) => capOf(ky, kind).filter(a => giaoThang(a, ky)).forEach(a => {
      if (own.some(o => apCo(o, ap) && sameCap(o, a))) return;
      if (a.tu && a.tu.startsWith('dg:') && dongCap.list.some(x => 'dg:' + x.id === a.tu)) return; // dòng Thưởng kho lấy từ chính cặp này
      const key = `${kind}:${q}:${a.id}`;
      out.push({ ...a, key, nguon: kind, ap, dung: !dongCap.boQua.includes(key) });
    }));
    return out;
  }
  const ccOf = ky => other('cc', ky);

  // bảng mã nv dùng để khớp tên của 1 tháng: file kho tháng đó → tháng gần nhất có file kho → bản đã lưu → Thưởng kho
  function nearest(ky, has) {
    const ks = Object.keys(archive).filter(k => k !== ky && has(archive[k]));
    const d = k => { const [a, b] = k.split('-').map(Number), [c, e] = ky.split('-').map(Number); return Math.abs((a * 12 + b) - (c * 12 + e)) + (k > ky ? 0.5 : 0); };
    return ks.sort((a, b) => d(a) - d(b))[0] || '';
  }
  function mnvFor(ky) {
    const e = archive[ky];
    if (e && e.kho && e.kho.mnvRows) return { rows: e.kho.mnvRows, nguon: 'bảng mã nv của file kho tháng này' };
    const k = nearest(ky, x => x.kho && x.kho.mnvRows);
    if (k) return { rows: archive[k].kho.mnvRows, nguon: `bảng mã nv của file kho ${DG.kyLabel(k)}` };
    if (caiDat.mnvRows) return { rows: caiDat.mnvRows, nguon: 'bảng mã nv đã lưu' };
    const q = other('tk', DG.quyCua(ky));
    const qs = [DG.quyCua(ky), ...Object.keys(LS_OTHER.tk).filter(x => /^\d{4}-Q\d$/.test(x)).sort().reverse()];
    for (const name of qs) {
      const c = (name === DG.quyCua(ky) ? q : LS_OTHER.tk[name]) || {};
      const cached = c.cached;
      if (cached && (cached.mnvRows || cached.employees)) {
        const rows = cached.mnvRows || cached.employees.map(x => [x.maNV, '', x.hoTen]);
        return { rows, nguon: `bảng mã nv của Thưởng kho ${name.replace('-Q', ' quý ')}` };
      }
    }
    return null;
  }
  function rosterFor(ky) {
    const e = archive[ky];
    if (e && e.kho && e.kho.roster) return new Set(e.kho.roster.ds);
    const k = nearest(ky, x => x.kho && x.kho.roster);
    return k ? new Set(archive[k].kho.roster.ds) : null;
  }

  // Bảng mã dùng cho 1 tháng: bảng mã nv (file kho / dự phòng) + nhân viên gán tay (mục Danh sách) + những người có trong
  // bảng chấm công tháng đó mà bảng mã nv chưa có (nhân viên mới: file kho chưa cập nhật "bảng mã nv" vẫn khớp được theo họ tên).
  function rowsFor(ky) {
    const mnv = mnvFor(ky), rows = mnv ? [...mnv.rows] : [], have = new Set(rows.map(r => String(r[0]).trim())), moi = new Set();
    (caiDat.nvThem || []).forEach(x => { rows.push([x.maNV, x.maHT || '', x.hoTen]); have.add(x.maNV); moi.add(x.maNV); });
    const sh = ccOf(ky);
    if (sh && Array.isArray(sh.rows)) sh.rows.forEach(r => {
      const ma = String(r.ma || '').trim(), ten = String(r.ten || '').trim();
      if (r.t === 'nv' && ma && ten && !have.has(ma)) { rows.push([ma, '', ten]); have.add(ma); moi.add(ma); }
    });
    return rows.length ? { rows, moi, nguon: (mnv ? mnv.nguon : 'bảng chấm công') + (moi.size ? ` + ${moi.size} người lấy từ chấm công / gán tay` : '') } : null;
  }

  // Văn phòng của từng người: bảng chấm công tháng đó (phòng ban / dòng team), thiếu thì tháng chấm công khác; sửa tay ở mục Danh sách
  function vpMap(ky) {
    const out = {};
    const them = sh => { const m = DG.vpTuChamCong(sh); Object.keys(m).forEach(u => { if (!out[u]) out[u] = m[u]; }); };
    them(ccOf(ky));
    Object.keys(LS_OTHER.cc).filter(k => KY_RE.test(k) && k !== ky).sort().reverse().forEach(k => them(LS_OTHER.cc[k]));
    Object.keys(ext.cc).filter(k => ext.cc[k]).forEach(k => them(ext.cc[k]));
    Object.assign(out, caiDat.vp || {});
    return out;
  }

  // ------------------------------------------------------------ tính
  const memo = new Map();
  function tinh(ky) {
    if (!ky || !archive[ky]) return null;
    if (memo.has(ky)) return memo.get(ky);
    const e = archive[ky], mnv = rowsFor(ky);
    if (!mnv) { const r = { loi: 'Chưa có bảng mã nv để khớp tên — thả kèm file kho (có sheet "bảng mã nv") hoặc nạp bảng chấm công tháng này.' }; memo.set(ky, r); return r; }
    const K = e.kho ? DG.ganMa(e.kho.raw, mnv.rows) : null, S = e.san ? DG.ganMa(e.san.raw, mnv.rows) : null;
    const employees = DG.bangMa(mnv.rows).list, roster = rosterFor(ky);
    // mặc định: theo sheet THƯỞNG của file kho; người mới (chấm công / gán tay) và tháng không có sheet THƯỞNG thì được đánh giá
    const chon = new Set(employees.map(x => x.maNV).filter(u => caiDat.chon[u] !== undefined ? caiDat.chon[u] : (roster && !mnv.moi.has(u) ? roster.has(u) : true)));
    const sh = caiDat.dungCC !== false ? ccOf(ky) : null;
    const cl = caiDat.dungCap !== false ? capList(ky).filter(a => a.dung) : [];
    const cap = { kho: cl.filter(a => apCo(a, 'kho')), san: cl.filter(a => apCo(a, 'san')) };
    const tenKhac = {}; dongCap.ngoai.forEach(h => { tenKhac[h.maNV] = h.hoTen; });
    const res = DG.tinhThang(ky, { kho: K, san: S }, { nv: employees, chon, nhom: caiDat.nhom, vp: vpMap(ky), cap, tenKhac, cc: sh ? DG.chamCongMap(sh) : null, loi: e.loi || {}, cfg: caiDat.cfg });
    // tên quét trong file chưa khớp mã NV (gộp kho + sàn) — để gán tay ở mục Danh sách
    const kk = new Map();
    [[K, 'kho'], [S, 'sàn']].forEach(([x, nguon]) => (x ? x.khongKhop : []).forEach(([n, c]) => { const o = kk.get(n) || { ten: n, kho: 0, san: 0 }; o[nguon === 'kho' ? 'kho' : 'san'] += c; kk.set(n, o); }));
    Object.assign(res, { mnvNguon: mnv.nguon, doan: K ? K.doan : [], khongKhop: [...kk.values()].sort((a, b) => (b.kho + b.san) - (a.kho + a.san)), moi: mnv.moi, roster, ccTen: sh && res.coCC ? sh.ten : '' });
    memo.set(ky, res);
    return res;
  }
  const kys = () => Object.keys(archive).filter(k => KY_RE.test(k)).sort();
  const current = () => archive[sel] ? sel : (kys().slice(-1)[0] || '');
  const prevKy = ky => { const [y, m] = ky.split('-').map(Number), d = new Date(y, m - 2, 1); const k = `${d.getFullYear()}-${DG.pad2(d.getMonth() + 1)}`; return archive[k] ? k : ''; };
  const cfgNow = () => Object.assign({}, DG.CFG, caiDat.cfg || {});

  // ------------------------------------------------------------ giao diện
  const TABS = ['bang-danh-gia', 'nhan-xet', 'so-sanh-vp', 'dashboard', 'theo-ngay', 'dong-cap', 'xu-huong', 'chat-luong', 'danh-sach', 'nap-du-lieu', 'tieu-chi'];
  const tab = () => { const h = location.hash.slice(1); if (!kys().length && !['tieu-chi', 'dong-cap'].includes(h)) return 'nap-du-lieu'; return TABS.includes(h) ? h : 'bang-danh-gia'; };
  let search = '', tnMode = 'qd', pending = [], busy = false, vpLoc = '';
  try { vpLoc = localStorage.getItem('kvh-danhgia-vploc') || ''; } catch (e) {}
  const match = r => (!vpLoc || r.vp === vpLoc) && (!search || fold(r.hoTen).includes(search) || String(r.maNV).includes(search));
  // sắp theo văn phòng (HCM, Cần Thơ, Đắk Lắk, Khánh Hòa…) rồi hạng trong văn phòng
  const sortHang = list => [...list].sort((a, b) => DG.thuTuVP(a.vp) - DG.thuTuVP(b.vp) || String(a.vp).localeCompare(String(b.vp), 'vi')
    || (a.hangVP || 1e9) - (b.hangVP || 1e9) || b.tb - a.tb || a.hoTen.localeCompare(b.hoTen, 'vi'));
  const vpCua = res => Object.keys(res.vpStats || {}).sort((a, b) => DG.thuTuVP(a) - DG.thuTuVP(b) || a.localeCompare(b, 'vi'));
  function renderVPSel() {
    const res = tinh(current()), ds = res && !res.loi ? vpCua(res) : [];
    if (vpLoc && !ds.includes(vpLoc)) ds.push(vpLoc);
    $('dgVP').innerHTML = `<option value="">Tất cả văn phòng</option>` + ds.map(v => `<option value="${esc(v)}"${v === vpLoc ? ' selected' : ''}>${esc(v)}${res && res.vpStats && res.vpStats[v] ? ` (${res.vpStats[v].so})` : ''}</option>`).join('');
  }
  $('dgVP').addEventListener('change', e => { vpLoc = e.target.value; try { localStorage.setItem('kvh-danhgia-vploc', vpLoc); } catch (er) {} renderAll(); });

  function renderTop() {
    const ks = kys(), ky = current();
    $('dgTop').hidden = !ks.length;
    if (!ks.length) return;
    $('dgChips').innerHTML = [...ks].reverse().map(k => `<button class="b sm${k === ky ? ' pri' : ''}" type="button" data-ky="${k}">${DG.kyLabel(k).replace('Tháng ', 'T')}</button>`).join('');
    const e = archive[ky], res = tinh(ky);
    const src = (x, ten) => x ? `<b>${ten}</b>: ${esc(x.fileName)} (${num(x.raw.luot)} lượt, ${x.raw.soNgay} ngày)` : `<b>${ten}</b>: <span style="color:#b45309">chưa nạp</span>`;
    const parts = [`<b>${DG.kyLabel(ky)}</b>`, src(e.kho, 'Kho'), src(e.san, 'Sàn')];
    if (res && !res.loi) {
      parts.push(res.coCC ? `Ngày công: chấm công "${esc(res.ccTen)}"` : (caiDat.dungCC === false ? 'Ngày công: theo ngày có lượt quét (đã tắt chấm công)' : '<span style="color:#b45309">Chưa có chấm công tháng này</span> → ngày công = ngày có lượt quét'));
      parts.push(caiDat.dungCap === false ? 'Đóng cặp: đã tắt' : `<a href="#dong-cap">Đóng cặp: ${capList(ky).filter(a => a.dung).length} cặp</a>`);
    }
    $('dgBanner').innerHTML = parts.join(' &nbsp;·&nbsp; ');
    $('dgSync').textContent = syncMsg;
  }

  function renderStats() {
    const res = tinh(current()), box = $('dgStats');
    box.hidden = !res || !!res.loi;
    if (box.hidden) return;
    const R = res.rows, cnt = x => R.filter(r => r.xepLoai === x).length;
    const tong = k => R.reduce((a, r) => a + r[k], 0);
    box.innerHTML = `
      <div class="tk-stat blue"><div class="l">Nhân viên được đánh giá</div><div class="v">${R.length}</div><div class="s">${res.soXep} người đủ ${cfgNow().congToiThieu} ngày công để xếp loại</div></div>
      <div class="tk-stat"><div class="l">Bình quân tổ / ngày công</div><div class="v">${n1(res.tbTo)}</div><div class="s">lượt quy đổi${Object.keys(res.vpStats || {}).length > 1 ? ' · ' + vpCua(res).map(v => `${esc(v.replace('VP ', ''))} ${n1(res.vpStats[v].tb)}`).join(' · ') : ''}</div></div>
      <div class="tk-stat"><div class="l">Lượt kho</div><div class="v">${num(tong('kho'))}</div><div class="s">tạo kiện ${num(tong('tao'))} · bốc ${num(tong('bocK'))} · đóng ${num(tong('dongK'))}</div></div>
      <div class="tk-stat"><div class="l">Lượt sàn</div><div class="v">${num(tong('san'))}</div><div class="s">bốc ${num(tong('bocS'))} · đóng ${num(tong('dongS'))} (= ${num(tong('san') * res.heSoSan)} quy đổi)</div></div>
      <div class="tk-stat"><div class="l">Xếp loại</div><div class="xl">${['A', 'B', 'C', 'D'].map(x => `${xlBadge(x)} <b>${cnt(x)}</b>`).join(' &nbsp;')}</div><div class="s">${cnt('—') ? cnt('—') + ' người chưa đủ ngày công' : '&nbsp;'}</div></div>`;
  }

  function renderTabs() {
    const t = tab();
    root.querySelectorAll('#dgTabs [data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === t));
    root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('dgSearchBox').hidden = ['nap-du-lieu', 'tieu-chi', 'dashboard', 'dong-cap', 'so-sanh-vp'].includes(t);
    $('dgVP').hidden = ['nap-du-lieu', 'tieu-chi', 'dong-cap', 'so-sanh-vp'].includes(t);
    $('dgStats').hidden = $('dgStats').hidden || ['nap-du-lieu', 'tieu-chi'].includes(t);
  }

  const emptyRow = (n, text) => `<tr><td colspan="${n}" style="text-align:center;color:#9ca3af;padding:24px">${text}</td></tr>`;
  function noData(res) { return !res ? 'Chưa có dữ liệu — nạp file ở mục <a href="#nap-du-lieu">Nạp file tháng</a>.' : res.loi ? esc(res.loi) : ''; }

  // ---- Bảng đánh giá
  function renderBang() {
    const ky = current(), res = tinh(ky), cfg = cfgNow();
    $('bgHead').innerHTML = `<tr><th class="c" title="Hạng trong văn phòng">Hạng<small>trong VP</small></th><th>Mã NV</th><th>Họ và tên</th><th class="c">Xếp loại</th><th class="r">Tổng điểm</th><th class="r">So tháng trước</th>
      <th class="r">Năng suất<small>/${cfg.dNS}</small></th><th class="r">Ổn định<small>/${cfg.dOD}</small></th><th class="r">Chất lượng<small>/${cfg.dCL}</small></th>
      <th>Văn phòng / nhóm</th><th class="r">Ngày công</th><th class="r">Lượt kho</th><th class="r">Lượt sàn</th><th class="r">Quy đổi</th><th class="r">TB / ngày công</th>
      <th class="r">So TB VP</th><th class="r">Ngày đạt ĐM</th><th class="r">Có công<small>không lượt</small></th><th class="r">Lỗi CL</th></tr>`;
    if (!res || res.loi) { $('bgBody').innerHTML = emptyRow(19, noData(res)); $('bgFoot').innerHTML = ''; return; }
    const pk = prevKy(ky), prev = pk ? tinh(pk) : null, pm = new Map(prev && !prev.loi ? prev.rows.map(r => [r.maNV, r]) : []);
    const list = sortHang(res.rows).filter(match);
    let vpTruoc = null;
    $('bgBody').innerHTML = list.map(r => {
      let head = '';
      if (r.vp !== vpTruoc) {
        vpTruoc = r.vp; const v = res.vpStats[r.vp];
        head = `<tr class="grp"><td colspan="19">${esc(r.vp)} <span>· ${v.so} người · bình quân ${n1(v.tb)} lượt quy đổi / ngày công (kho ${n1(v.tbKho)} · sàn ${n1(v.tbSan)}) · điểm TB ${n1(v.diemTB)} · A ${v.xl.A} · B ${v.xl.B} · C ${v.xl.C} · D ${v.xl.D}</span></td></tr>`;
      }
      const p = pm.get(r.maNV), d = p && p.xepLoai !== '—' && r.xepLoai !== '—' ? r.diem - p.diem : null;
      const cmp = d === null ? '<span class="muted">–</span>' : `<span class="${d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'muted'}">${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '='} ${n1(Math.abs(d))}</span> <span class="muted">(${esc(p.xepLoai)})</span>`;
      const congTip = r.coCC ? 'Theo bảng chấm công' : 'Không có trong chấm công — tính theo ngày có lượt quét';
      return head + `<tr class="${r.xepLoai === '—' ? 'muted' : ''}">
        <td class="c bold" title="Hạng chung cả chi nhánh: ${r.hang || '–'}">${r.hangVP || '–'}</td><td>${esc(r.maNV)}</td>
        <td class="name">${esc(r.hoTen)}${r.soNgayCap ? `<span class="chip cap" title="Có ${r.soNgayCap} ngày đóng cặp — lượt đã chia đôi">cặp ${r.soNgayCap}n</span>` : ''}${r.ngayThem ? `<span class="chip" title="${r.ngayThem} ngày có quét vào ngày nghỉ / CN / chấm phép — đã tính thêm công">+${r.ngayThem} ngày</span>` : ''}</td>
        <td class="c">${xlBadge(r.xepLoai)}</td><td class="r bold" style="color:#1a56db">${n1(r.diem)}</td><td class="r">${cmp}</td>
        <td class="r">${n1(r.dNS)}</td><td class="r">${n1(r.dOD)}</td><td class="r">${n1(r.dCL)}</td>
        <td>${esc(r.nhom)}</td>
        <td class="r" title="${congTip}">${nSmart(r.cong)}${r.coCC ? '' : '<span class="muted">*</span>'}</td>
        <td class="r" title="Tạo kiện ${num(r.tao)} · Bốc ${num(r.bocK)} · Đóng ${num(r.dongK)}">${num(r.kho)}</td>
        <td class="r" title="Bốc ${num(r.bocS)} · Đóng ${num(r.dongS)}">${num(r.san)}</td>
        <td class="r">${num(r.qd)}</td><td class="r bold" title="Kho HCM (truyền thống): ${n1(r.tbKho)} lượt/ngày công · Sàn: ${n1(r.tbSan)} lượt/ngày công">${n1(r.tb)}</td>
        <td class="r" title="Trung bình nhóm ${esc(r.nhom)}: ${n1(r.tbNhom)}">${pct(r.soVoiNhom)}</td>
        <td class="r" title="${r.ngayDat}/${r.ngayTinh} ngày có công đạt ${cfg.dmNgay} lượt quy đổi">${pct(r.tyLeDat)}</td>
        <td class="r${r.ngayKhongLuot >= 3 ? ' bold' : ''}" style="${r.ngayKhongLuot >= 3 ? 'color:#991b1b' : ''}">${r.ngayKhongLuot || '–'}</td>
        <td class="r" title="${esc(r.noiDungLoi)}">${r.soLoi || '–'}</td></tr>`;
    }).join('') || emptyRow(19, 'Không có ai khớp tìm kiếm.');
    $('bgFoot').innerHTML = `Mỗi văn phòng xếp hạng riêng; năng suất so với trung bình văn phòng của người đó. Tổng điểm = <b>Năng suất</b> (đạt ${cfg.nsDinh}% trung bình VP = đủ ${cfg.dNS}đ) + <b>Ổn định</b> (tỷ lệ ngày có công đạt ${cfg.dmNgay} lượt quy đổi × ${cfg.dOD}) + <b>Chất lượng</b> (${cfg.dCL} − ${cfg.truLoi}/lỗi). `
      + `Xếp loại A ≥ ${cfg.A} · B ≥ ${cfg.B} · C ≥ ${cfg.C} · D dưới ${cfg.C}. Lượt quy đổi = lượt kho + lượt sàn × ${String(res.heSoSan).replace('.', ',')}. `
      + `<span class="muted">*</span> = không có trong chấm công, ngày công theo ngày có lượt quét. Rê chuột lên số để xem chi tiết. Xem cách tính / sửa ở mục <a href="#tieu-chi">Tiêu chí</a>.`
      + (pk ? '' : ' Chưa có tháng trước để so sánh.');
  }

  // ---- Nhận xét từng người theo từng tiêu chí (tự viết từ số liệu tháng, DG.nhanXet)
  const MK = { dat: 'Đạt', chua: 'Chưa đạt', thieu: 'Không đạt', tt: '–' };
  const MK_RIENG = { gio: { dat: 'Bình thường', chua: 'Lưu ý' }, xh: { dat: 'Ổn', chua: 'Giảm' } };
  const mkLabel = t => (MK_RIENG[t.ma] && MK_RIENG[t.ma][t.muc]) || MK[t.muc];
  let nxLoc = 'all';
  function nhanXetThang(ky) {
    const res = tinh(ky); if (!res || res.loi) return null;
    const pk = prevKy(ky), prev = pk ? tinh(pk) : null, pm = new Map(prev && !prev.loi ? prev.rows.map(r => [r.maNV, r]) : []);
    const gio = DG.gioNhom(res.rows), cfg = cfgNow();
    return new Map(res.rows.map(r => [r.maNV, DG.nhanXet(r, { cfg, ky, gio, prev: pm.get(r.maNV) || null })]));
  }
  function nxText(r, nx, ky) {
    return [`NHẬN XÉT ${DG.kyLabel(ky).toUpperCase()} — ${r.hoTen} (${r.maNV})`, nx.tomTat,
      ...nx.tieuChi.map(t => `• ${t.ten}: ${mkLabel(t)} — ${t.text}` + (t.chiTiet ? t.chiTiet.map(x => `\n   – ${x}`).join('') : '')),
      ...(nx.khacPhuc.length ? ['Cần khắc phục:', ...nx.khacPhuc.map((k, i) => `${i + 1}. ${k}`)] : ['Không có điểm cần khắc phục — tiếp tục duy trì.']),
      ...(r.ghiChu ? ['Ghi chú quản lý: ' + r.ghiChu] : [])].join('\n');
  }
  function renderNX() {
    const ky = current(), res = tinh(ky);
    $('nxLoc').innerHTML = [['all', 'Tất cả'], ['kp', 'Người cần khắc phục'], ['cd', 'Xếp loại C, D']].map(([v, l]) => `<button class="b xs${nxLoc === v ? ' pri' : ''}" type="button" data-nxloc="${v}">${l}</button>`).join('');
    if (!res || res.loi) { $('nxGrid').innerHTML = `<div class="muted" style="padding:20px">${noData(res)}</div>`; return; }
    const map = nhanXetThang(ky);
    let list = sortHang(res.rows).filter(match);
    if (nxLoc === 'kp') list = list.filter(r => map.get(r.maNV).khacPhuc.length);
    if (nxLoc === 'cd') list = list.filter(r => r.xepLoai === 'C' || r.xepLoai === 'D');
    $('nxGrid').innerHTML = list.map(r => {
      const nx = map.get(r.maNV);
      return `<div class="nx-card">
        <div class="nx-head"><div class="nm">${r.hangVP ? r.hangVP + '. ' : ''}${esc(r.hoTen)}<small>${esc(r.maNV)} · ${esc(r.nhom)}</small></div>
          <div class="tk-row">${xlBadge(r.xepLoai)} <b style="color:#1a56db">${n1(r.diem)}</b> <button class="b xs" type="button" data-nxcopy="${esc(r.maNV)}" title="Chép nhận xét dạng chữ để gửi Zalo / mail">Sao chép</button></div></div>
        <div class="nx-sum">${esc(nx.tomTat)}</div>
        <div class="nx-tc">${nx.tieuChi.map(t => `<div class="t">${esc(t.ten)}</div><div><span class="mk m-${t.muc}">${esc(mkLabel(t))}</span>${esc(t.text)}${t.chiTiet ? t.chiTiet.map(x => `<div class="ct">– ${esc(x)}</div>`).join('') : ''}</div>`).join('')}</div>
        ${nx.khacPhuc.length ? `<div class="nx-kp"><b>Cần khắc phục</b><ol>${nx.khacPhuc.map(k => `<li>${esc(k)}</li>`).join('')}</ol></div>` : '<div class="nx-ok">Không có điểm cần khắc phục — tiếp tục duy trì.</div>'}
        ${r.ghiChu ? `<div class="nx-gc"><b>Ghi chú quản lý:</b> ${esc(r.ghiChu)}</div>` : ''}
      </div>`;
    }).join('') || `<div class="muted" style="padding:20px">Không có ai trong bộ lọc này.</div>`;
  }
  $('nxLoc').addEventListener('click', e => { const b = e.target.closest('[data-nxloc]'); if (!b) return; nxLoc = b.dataset.nxloc; renderNX(); });
  $('nxGrid').addEventListener('click', async e => {
    const b = e.target.closest('[data-nxcopy]'); if (!b) return;
    const ky = current(), res = tinh(ky), r = res.rows.find(x => x.maNV === b.dataset.nxcopy); if (!r) return;
    const text = nxText(r, nhanXetThang(ky).get(r.maNV), ky);
    try { await navigator.clipboard.writeText(text); }
    catch (err) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e2) {} t.remove(); }
    b.textContent = 'Đã chép ✓'; setTimeout(() => { b.textContent = 'Sao chép'; }, 1500);
  });

  // ---- So sánh văn phòng
  function renderVP() {
    const res = tinh(current());
    $('vpHead').innerHTML = `<tr><th>Văn phòng</th><th class="r">Số NV<small>đánh giá</small></th><th class="r">Ngày công</th><th class="r">Lượt kho</th><th class="r">Lượt sàn</th>
      <th class="r">Kho / ngày công</th><th class="r">Sàn / ngày công</th><th class="r">Quy đổi / ngày công</th><th class="r">Điểm TB</th><th class="c">A</th><th class="c">B</th><th class="c">C</th><th class="c">D</th><th class="r">Lỗi CL</th><th class="r">Ngày có công<small>không lượt</small></th></tr>`;
    if (!res || res.loi) { $('vpBody').innerHTML = emptyRow(15, noData(res)); $('vpChart').innerHTML = ''; return; }
    const ds = vpCua(res), S = res.vpStats;
    const tong = ds.reduce((a, v) => { const x = S[v]; ['so', 'cong', 'kho', 'san', 'qd', 'loi', 'khongLuot', 'soXep', 'diem'].forEach(k => { a[k] = (a[k] || 0) + x[k]; }); ['A', 'B', 'C', 'D'].forEach(k => { a[k] = (a[k] || 0) + x.xl[k]; }); return a; }, {});
    const dong = (ten, x, xl, cls) => `<tr class="${cls || ''}"${ten && !cls ? ` style="cursor:pointer" data-vpchon="${esc(ten)}" title="Bấm để chỉ xem ${esc(ten)}"` : ''}><td class="name">${esc(ten)}</td><td class="r">${x.so}</td><td class="r">${nSmart(x.cong)}</td><td class="r">${num(x.kho)}</td><td class="r">${num(x.san)}</td>
      <td class="r">${x.cong ? n1(x.kho / x.cong) : '–'}</td><td class="r">${x.cong ? n1(x.san / x.cong) : '–'}</td><td class="r bold">${x.cong ? n1(x.qd / x.cong) : '–'}</td><td class="r bold" style="color:#1a56db">${x.soXep ? n1(x.diem / x.soXep) : '–'}</td>
      ${['A', 'B', 'C', 'D'].map(k => `<td class="c">${xl[k] ? xlBadge(k) + ' ' + xl[k] : '<span class="muted">–</span>'}</td>`).join('')}<td class="r">${x.loi || '–'}</td><td class="r">${x.khongLuot || '–'}</td></tr>`;
    $('vpBody').innerHTML = ds.map(v => dong(v, S[v], S[v].xl)).join('') + (ds.length > 1 ? dong('CẢ CHI NHÁNH', tong, tong, 'total') : '');
    // biểu đồ thanh ngang: kho + sàn quy đổi / ngày công từng VP
    const W = 620, L = 120, R = 70, BH = 22, GAP = 12, max = niceMax(Math.max(1, ...ds.map(v => S[v].tb)));
    const xs = val => L + (W - L - R) * val / max;
    let y = 6, out = '';
    ds.forEach(v => {
      const x = S[v], k = x.tbKho, s = x.tbSan * res.heSoSan, id = 'vp' + v;
      tips[id] = `<b>${esc(v)}</b>${x.so} người · ${nSmart(x.cong)} ngày công<br><i style="background:var(--kho)"></i>Kho ${n1(k)} lượt / ngày công<br><i style="background:var(--san)"></i>Sàn ${n1(x.tbSan)} lượt (= ${n1(s)} quy đổi) / ngày công<br>Tổng ${n1(x.tb)} lượt quy đổi · điểm TB ${n1(x.diemTB)}`;
      const wk = xs(k) - L, ws = xs(k + s) - xs(k);
      out += `<g data-tip="${esc(id)}"><rect x="0" y="${y - 3}" width="${W}" height="${BH + 6}" fill="transparent"/>`
        + `<text x="${L - 8}" y="${y + BH / 2 + 4}" font-size="12" text-anchor="end" fill="#374151">${esc(v)}</text>`
        + (wk > 0 ? `<path d="${ws > 2 ? `M${L},${y}H${L + wk}V${y + BH}H${L}Z` : barPath(L, y, wk, BH, 4)}" fill="var(--kho)"/>` : '')
        + (ws > 2 ? `<path d="${barPath(L + wk + 2, y, ws - 2, BH, 4)}" fill="var(--san)"/>` : '')
        + `<text x="${xs(k + s) + 6}" y="${y + BH / 2 + 4}" font-size="12" fill="#1f2937">${n1(x.tb)}</text></g>`;
      y += BH + GAP;
    });
    const grid = [0, max / 4, max / 2, max * 3 / 4, max].map(t => `<line x1="${xs(t)}" x2="${xs(t)}" y1="0" y2="${y}" stroke="#eef0f3"/><text x="${xs(t)}" y="${y + 14}" font-size="10" text-anchor="middle" fill="#9ca3af">${num(t)}</text>`).join('');
    $('vpChart').innerHTML = `<svg viewBox="0 0 ${W} ${y + 20}" width="100%" role="img" aria-label="Bình quân lượt mỗi ngày công theo văn phòng">${grid}${out}</svg>`;
    bindTips($('vpChart'));
  }
  $('vpBody').addEventListener('click', e => { const t = e.target.closest('[data-vpchon]'); if (!t) return; vpLoc = t.dataset.vpchon; try { localStorage.setItem('kvh-danhgia-vploc', vpLoc); } catch (er) {} location.hash = '#bang-danh-gia'; renderAll(); });

  // ---- Dashboard (biểu đồ SVG, rê chuột xem số)
  let tipEl = null;
  function tip(html, ev) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'vtip'; root.appendChild(tipEl); }
    if (!html) { tipEl.hidden = true; return; }
    tipEl.innerHTML = html; tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > innerHeight - 8) y = ev.clientY - h - 14;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  const tips = {};
  function bindTips(el) {
    el.onmousemove = ev => { const t = ev.target.closest('[data-tip]'); tip(t ? tips[t.dataset.tip] : '', ev); };
    el.onmouseleave = () => tip('');
  }
  const shortName = s => { const w = String(s).trim().split(/\s+/); return w.slice(-2).join(' '); };
  const barPath = (x0, y, w, h, r) => { r = Math.min(r, h / 2, w); return w <= 0 ? '' : `M${x0},${y}H${x0 + w - r}Q${x0 + w},${y} ${x0 + w},${y + r}V${y + h - r}Q${x0 + w},${y + h} ${x0 + w - r},${y + h}H${x0}Z`; };
  const colPath = (x, y0, w, h, r) => { r = Math.min(r, w / 2, h); return h <= 0 ? '' : `M${x},${y0}V${y0 - h + r}Q${x},${y0 - h} ${x + r},${y0 - h}H${x + w - r}Q${x + w},${y0 - h} ${x + w},${y0 - h + r}V${y0}Z`; };
  function niceMax(v) { if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }

  function renderDash() {
    const res = tinh(current());
    if (!res || res.loi) { $('vz1').innerHTML = $('vz2').innerHTML = `<div class="muted" style="padding:20px">${noData(res)}</div>`; $('vzTop').innerHTML = $('vzBot').innerHTML = ''; return; }
    const cfg = cfgNow();
    // 1) thanh ngang: TB / ngày công từng người, nhóm theo Nhóm, vạch đứt = TB nhóm
    const groups = Object.values(res.nhom).sort((a, b) => b.tb - a.tb);
    const W = 620, L = 150, R = 70, BH = 14, GAP = 6, HEAD = 20;
    const max = niceMax(Math.max(1, ...res.rows.map(r => r.tb)));
    const xs = v => L + (W - L - R) * v / max;
    let y = 4, out = '', lines = '', labels = '';
    const ticks = [0, max / 4, max / 2, max * 3 / 4, max];
    const bodyTop = y;
    groups.forEach(g => {
      const rows = res.rows.filter(r => r.nhom === g.ten).sort((a, b) => b.tb - a.tb);
      if (groups.length > 1) { out += `<text x="0" y="${y + 13}" font-size="12" font-weight="700" fill="#1f2937">${esc(g.ten)} <tspan fill="#6b7280" font-weight="400">· TB ${n1(g.tb)}</tspan></text>`; y += HEAD; }
      const y0 = y;
      rows.forEach(r => {
        const id = 'b' + r.maNV;
        tips[id] = `<b>${esc(r.hoTen)}</b>${esc(r.nhom)} · ${nSmart(r.cong)} ngày công<br>Bình quân <b style="display:inline">${n1(r.tb)}</b> lượt quy đổi / ngày (${pct(r.soVoiNhom)} TB nhóm)<br>Kho ${num(r.kho)} · Sàn ${num(r.san)} lượt<br>Tổng điểm ${n1(r.diem)} · xếp loại ${esc(r.xepLoai)}`;
        out += `<g data-tip="${id}" style="cursor:default"><rect x="0" y="${y - 2}" width="${W}" height="${BH + GAP}" fill="transparent"/>`
          + `<text x="${L - 8}" y="${y + BH - 3}" font-size="11" text-anchor="end" fill="#374151">${esc(shortName(r.hoTen))}</text>`
          + `<path d="${barPath(L, y, xs(r.tb) - L, BH, 4)}" fill="${r.xepLoai === '—' ? '#c7d2fe' : 'var(--kho)'}"/></g>`;
        labels += `<text x="${xs(r.tb) + 6}" y="${y + BH - 3}" font-size="11" fill="#1f2937" paint-order="stroke" stroke="#fff" stroke-width="3" pointer-events="none">${n1(r.tb)} <tspan fill="#6b7280">${esc(r.xepLoai)}</tspan></text>`;
        y += BH + GAP;
      });
      if (rows.length && g.tb) lines += `<line x1="${xs(g.tb)}" x2="${xs(g.tb)}" y1="${y0 - 3}" y2="${y - GAP + 3}" stroke="#1f2937" stroke-width="1.5" stroke-dasharray="4 3" pointer-events="none"/>`;
      y += 6;
    });
    const grid = ticks.map(t => `<line x1="${xs(t)}" x2="${xs(t)}" y1="${bodyTop}" y2="${y}" stroke="#eef0f3"/><text x="${xs(t)}" y="${y + 14}" font-size="10" text-anchor="middle" fill="#9ca3af">${num(t)}</text>`).join('');
    $('vz1').innerHTML = `<svg viewBox="0 0 ${W} ${y + 20}" width="100%" role="img" aria-label="Bình quân lượt quy đổi mỗi ngày công của từng nhân viên">${grid}${out}${lines}${labels}</svg>`;
    $('vz1Sub').textContent = `Lượt quy đổi ÷ ngày công · vạch đứt = trung bình ${groups.length > 1 ? 'từng nhóm' : 'nhóm'} · chữ sau số = xếp loại`;
    bindTips($('vz1'));

    // 2) cột chồng theo ngày: kho (dưới) + sàn quy đổi (trên)
    const days = res.theoNgay, W2 = 620, H2 = 230, PL = 44, PB = 34, PT = 8;
    const max2 = niceMax(Math.max(1, ...days.map(d => d.qd)));
    const cw = (W2 - PL - 6) / days.length, bw = Math.max(4, cw - 4);
    const ys = v => (H2 - PB - PT) * v / max2;
    let o2 = [0, .25, .5, .75, 1].map(f => { const yy = H2 - PB - ys(max2 * f); return `<line x1="${PL}" x2="${W2}" y1="${yy}" y2="${yy}" stroke="#eef0f3"/><text x="${PL - 6}" y="${yy + 3}" font-size="10" text-anchor="end" fill="#9ca3af">${num(max2 * f)}</text>`; }).join('');
    days.forEach((d, i) => {
      const x = PL + i * cw + (cw - bw) / 2, base = H2 - PB, hk = ys(d.k), hs = ys(d.s * res.heSoSan);
      const id = 'd' + d.d;
      tips[id] = `<b>Ngày ${d.d} (${THU[d.thu]})</b><i style="background:var(--kho)"></i>Kho ${num(d.k)} lượt<br><i style="background:var(--san)"></i>Sàn ${num(d.s)} lượt (= ${num(d.s * res.heSoSan)} quy đổi)<br>${d.nguoi} người có lượt`;
      o2 += `<g data-tip="${id}"><rect x="${PL + i * cw}" y="${PT}" width="${cw}" height="${H2 - PT - PB + 20}" fill="transparent"/>`
        + (hk > 0 ? `<path d="${hs > 0 ? `M${x},${base}V${base - hk}H${x + bw}V${base}Z` : colPath(x, base, bw, hk, 3)}" fill="var(--kho)"/>` : '')
        + (hs > 0 ? `<path d="${colPath(x, base - hk - (hk > 0 ? 2 : 0), bw, Math.max(0, hs - (hk > 0 ? 2 : 0)), 3)}" fill="var(--san)"/>` : '')
        + `<text x="${x + bw / 2}" y="${H2 - PB + 13}" font-size="9" text-anchor="middle" fill="${d.thu === 0 ? '#d1d5db' : '#6b7280'}">${d.d}</text>`
        + (i % 7 === 0 || days.length <= 16 ? '' : '') + `</g>`;
    });
    o2 += `<text x="${PL}" y="${H2 - 4}" font-size="10" fill="#9ca3af">Ngày trong tháng</text>`;
    $('vz2').innerHTML = `<svg viewBox="0 0 ${W2} ${H2}" width="100%" role="img" aria-label="Sản lượng cả tổ theo ngày">${o2}</svg>`;
    bindTips($('vz2'));

    // 3) dẫn đầu / cần quan tâm
    const xep = sortHang(res.rows.filter(r => r.xepLoai !== '—'));
    $('vzTop').innerHTML = xep.slice(0, 5).map(r => `<li><b>${esc(r.hoTen)}</b> — ${n1(r.diem)} điểm ${xlBadge(r.xepLoai)} <span class="muted">· ${n1(r.tb)} lượt/ngày (${pct(r.soVoiNhom)} TB nhóm)</span></li>`).join('') || '<li class="muted">Chưa có</li>';
    const lyDo = r => {
      const out = [];
      if (r.soVoiNhom < 0.8) out.push(`năng suất ${pct(r.soVoiNhom)} TB nhóm`);
      if (r.ngayKhongLuot >= 3) out.push(`${r.ngayKhongLuot} ngày có công không có lượt`);
      if (r.tyLeDat < 0.7) out.push(`chỉ ${pct(r.tyLeDat)} ngày đạt định mức`);
      if (r.soLoi) out.push(`${r.soLoi} lỗi chất lượng`);
      return out.join(' · ') || 'điểm thấp nhất tháng';
    };
    $('vzBot').innerHTML = xep.slice(-5).reverse().map(r => `<li><b>${esc(r.hoTen)}</b> — ${n1(r.diem)} điểm ${xlBadge(r.xepLoai)} <span class="muted">· ${esc(lyDo(r))}</span></li>`).join('') || '<li class="muted">Chưa có</li>';
  }

  // ---- Theo ngày
  function renderNgay() {
    const ky = current(), res = tinh(ky), cfg = cfgNow();
    $('tnMode').innerHTML = [['qd', 'Lượt quy đổi'], ['k', 'Lượt kho'], ['s', 'Lượt sàn']].map(([v, l]) => `<button class="b xs${tnMode === v ? ' pri' : ''}" type="button" data-tn="${v}">${l}</button>`).join('');
    if (!res || res.loi) { $('tnHead').innerHTML = ''; $('tnBody').innerHTML = emptyRow(5, noData(res)); return; }
    const [y, m] = ky.split('-').map(Number), n = new Date(y, m, 0).getDate();
    $('tnHead').innerHTML = `<tr><th>Họ và tên</th>${Array.from({ length: n }, (_, i) => { const t = new Date(y, m - 1, i + 1).getDay(); return `<th class="dd${t === 0 ? ' cn' : ''}">${i + 1}<br><small>${THU[t]}</small></th>`; }).join('')}<th class="r">Ngày công</th><th class="r">Tổng</th><th class="r">TB/ngày</th></tr>`;
    const list = sortHang(res.rows).filter(match);
    $('tnBody').innerHTML = list.map(r => {
      const cells = r.ngay.map(x => {
        const v = tnMode === 'qd' ? x.qd : tnMode === 'k' ? x.k : x.s;
        let cls = 'g-off', txt = '';
        if (x.w > 0 && x.qd === 0) { cls = 'g-zero'; txt = tnMode === 'qd' ? '0' : ''; }
        else if (x.qd > 0) { cls = tnMode !== 'qd' ? (v ? '' : 'g-off') : (x.dat ? 'g-ok' : 'g-low'); txt = v ? (tnMode === 'qd' ? num(v) : nSmart(v)) : ''; }
        else txt = x.ma && x.ma !== 'X' ? esc(x.ma) : '';
        if (x.cap) cls += ' g-cap';
        if (x.it) cls += ' g-it';
        const t = `Ngày ${x.d}/${m} (${THU[new Date(y, m - 1, x.d).getDay()]}) · công ${nSmart(x.w)}${x.ma ? ' (mã ' + x.ma + ')' : r.coCC ? '' : ' (theo ngày có lượt)'}${x.them ? ' — quét vào ngày nghỉ, tính thêm công' : ''}`
          + (x.kd ? `\nKho ${nSmart(x.k)}: tạo kiện ${nSmart(x.kd[0])} · bốc ${nSmart(x.kd[1])} · đóng ${nSmart(x.kd[2])}` : '')
          + (x.sd ? `\nSàn ${nSmart(x.s)}: bốc ${nSmart(x.sd[0])} · đóng ${nSmart(x.sd[1])} (= ${nSmart(x.s * res.heSoSan)} quy đổi)` : '')
          + (x.qd ? `\nQuy đổi ${nSmart(x.qd)} / định mức ${nSmart(cfg.dmNgay * x.w)} · quét ${hm(x.dau)}–${hm(x.cuoi)}` : '')
          + (x.cap ? '\nNgày đóng cặp: lượt đã chia đôi' : '')
          + (x.it ? '\nNgày ít đơn của cả tổ — không tính vào Ổn định / Chuyên cần' : '');
        return `<td class="dd ${cls}" title="${esc(t)}">${txt}</td>`;
      }).join('');
      const tong = tnMode === 'qd' ? r.qd : tnMode === 'k' ? r.kho : r.san;
      return `<tr><td class="name">${esc(r.hoTen)}</td>${cells}<td class="r">${nSmart(r.cong)}</td><td class="r bold">${num(tong)}</td><td class="r">${r.cong ? n1(tong / r.cong) : '–'}</td></tr>`;
    }).join('') || emptyRow(n + 4, 'Không có ai khớp tìm kiếm.');
  }

  // ---- Xu hướng các tháng
  function renderXu() {
    const ks = kys().slice(-6), ky = current();
    const res = ks.map(k => ({ k, r: tinh(k) })).filter(x => x.r && !x.r.loi);
    if (!res.length) { $('xhHead').innerHTML = ''; $('xhBody').innerHTML = emptyRow(3, noData(tinh(ky))); return; }
    $('xhHead').innerHTML = `<tr><th>Mã NV</th><th>Họ và tên</th>${res.map(x => `<th class="c">${DG.kyLabel(x.k).replace('Tháng ', 'T')}</th>`).join('')}<th class="r">Thay đổi gần nhất</th></tr>`;
    const people = new Map();
    res.forEach(x => x.r.rows.forEach(r => { if (!people.has(r.maNV)) people.set(r.maNV, r.hoTen); }));
    const last = res[res.length - 1].r, lastMap = new Map(last.rows.map(r => [r.maNV, r]));
    const xep = sortHang(last.tatCa.filter(r => people.has(r.maNV))).map(r => r.maNV);
    const ids = [...people.keys()].sort((a, b) => (xep.indexOf(a) + 1 || 1e9) - (xep.indexOf(b) + 1 || 1e9) || people.get(a).localeCompare(people.get(b), 'vi'));
    $('xhBody').innerHTML = ids.filter(u => match({ maNV: u, hoTen: people.get(u), vp: (last.tatCa.find(r => r.maNV === u) || {}).vp })).map(u => {
      const vals = res.map(x => x.r.rows.find(r => r.maNV === u));
      const sc = vals.filter(v => v && v.xepLoai !== '—');
      const d = sc.length >= 2 ? sc[sc.length - 1].diem - sc[sc.length - 2].diem : null;
      return `<tr><td>${esc(u)}</td><td class="name">${esc(people.get(u))}</td>${vals.map(v => v ? `<td class="c">${n1(v.diem)} ${xlBadge(v.xepLoai)}<br><span class="muted">${n1(v.tb)} lượt/ngày</span></td>` : '<td class="c muted">–</td>').join('')}
        <td class="r">${d === null ? '<span class="muted">–</span>' : `<span class="${d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'muted'}">${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '='} ${n1(Math.abs(d))}</span>`}</td></tr>`;
    }).join('') || emptyRow(res.length + 3, 'Không có ai khớp tìm kiếm.');
  }

  // ---- Chất lượng & ghi chú (ô nhập — không vẽ lại khi đang gõ)
  function renderCL() {
    const ky = current(), res = tinh(ky);
    if (!res || res.loi) { $('clBody').innerHTML = emptyRow(7, noData(res)); return; }
    const list = [...res.rows].sort((a, b) => a.hoTen.localeCompare(b.hoTen, 'vi')).filter(match);
    $('clBody').innerHTML = list.map(r => `<tr data-ma="${esc(r.maNV)}"><td>${esc(r.maNV)}</td><td class="name">${esc(r.hoTen)}</td>
      <td class="r"><input type="number" min="0" step="1" data-k="so" value="${r.soLoi || ''}" placeholder="0"></td>
      <td><input type="text" data-k="noiDung" value="${esc(r.noiDungLoi)}" placeholder="vd. 12/9 đóng thiếu 1 hộp đơn DH…" style="width:300px"></td>
      <td><input type="text" data-k="ghiChu" value="${esc(r.ghiChu)}" placeholder="Nhận xét của quản lý" style="width:260px"></td>
      <td class="r" data-out="dCL">${n1(r.dCL)}</td><td class="c" data-out="xl">${xlBadge(r.xepLoai)}</td></tr>`).join('') || emptyRow(7, 'Không có ai khớp tìm kiếm.');
  }
  let clTimer = null;
  $('clBody').addEventListener('input', ev => {
    const inp = ev.target.closest('[data-k]'), tr = ev.target.closest('[data-ma]'); if (!inp || !tr) return;
    const ky = current(); if (!ky) return;
    const e = archive[ky]; e.loi = e.loi || {};
    const ma = tr.dataset.ma, cur = e.loi[ma] || {};
    cur[inp.dataset.k] = inp.dataset.k === 'so' ? Math.max(0, Math.floor(Number(inp.value) || 0)) : inp.value;
    if (!cur.so && !cur.noiDung && !cur.ghiChu) delete e.loi[ma]; else e.loi[ma] = cur;
    memo.delete(ky);
    const r = tinh(ky).rows.find(x => x.maNV === ma);
    if (r) { tr.querySelector('[data-out=dCL]').textContent = n1(r.dCL); tr.querySelector('[data-out=xl]').innerHTML = xlBadge(r.xepLoai); }
    clearTimeout(clTimer); clTimer = setTimeout(() => { touch(ky); renderAll(true); }, 600);
  });

  // ---- Danh sách & nhóm
  function renderDS() {
    const ky = current(), res = tinh(ky);
    if (!res || res.loi) { $('dsBody').innerHTML = emptyRow(10, noData(res)); $('dsFoot').innerHTML = ''; return; }
    const chon = new Set(res.rows.map(r => r.maNV));
    const list = [...res.tatCa].sort((a, b) => (chon.has(b.maNV) - chon.has(a.maNV)) || a.nhom.localeCompare(b.nhom, 'vi') || a.hoTen.localeCompare(b.hoTen, 'vi')).filter(match);
    const nhoms = [...new Set([...Object.values(caiDat.nhom || {}), 'Đóng gói', 'Soạn hàng'])].filter(g => g && g !== DG.NHOM_MD);
    const vps = [...new Set([...DG.VP_THU_TU, ...vpCua(res)])].filter(v => v !== DG.VP_CHUA_RO);
    $('dsNhom').innerHTML = nhoms.map(g => `<option value="${esc(g)}">`).join('');
    $('dsBody').innerHTML = list.map(r => `<tr data-ma="${esc(r.maNV)}" class="${chon.has(r.maNV) ? '' : 'muted'}">
      <td class="c"><input type="checkbox" data-k="chon"${chon.has(r.maNV) ? ' checked' : ''}></td><td>${esc(r.maNV)}</td><td class="name">${esc(r.hoTen)}</td>
      <td><select data-k="vp" title="${caiDat.vp && caiDat.vp[r.maNV] ? 'Đã sửa tay' : 'Theo bảng chấm công'}"><option value="">${esc(vpTuDong(r.maNV) || DG.VP_CHUA_RO)} (tự động)</option>${vps.map(v => `<option value="${esc(v)}"${caiDat.vp && caiDat.vp[r.maNV] === v ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></td>
      <td><input type="text" data-k="nhom" list="dsNhom" value="${esc(caiDat.nhom[r.maNV] && caiDat.nhom[r.maNV] !== DG.NHOM_MD ? caiDat.nhom[r.maNV] : '')}" placeholder="(cả VP)" style="width:130px"></td>
      <td class="r">${nSmart(r.cong)}</td><td class="r">${num(r.kho)}</td><td class="r">${num(r.san)}</td><td class="r">${n1(r.tb)}</td>
      <td>${res.moi && res.moi.has(r.maNV) ? '<span class="chip warn" title="Chưa có trong bảng mã nv của file kho — lấy từ chấm công / gán tay">NV mới</span>' : res.roster ? (res.roster.has(r.maNV) ? 'Có' : '<span class="muted">Không</span>') : '<span class="muted">(file không có sheet THƯỞNG)</span>'}</td></tr>`).join('') || emptyRow(10, 'Không có ai khớp tìm kiếm.');
    const kk = (res.khongKhop || []).filter(x => !/^(adminit|online|system|admin)$/i.test(x.ten) && x.kho + x.san >= 20);
    const ganTay = caiDat.nvThem || [];
    const vpCo = [...new Set(res.tatCa.map(r => r.vp))].sort((a, b) => DG.thuTuVP(a) - DG.thuTuVP(b));
    $('dsFoot').innerHTML = `<div class="tk-row" style="margin-bottom:8px"><b style="font-size:12px">Đánh giá cả văn phòng:</b>${vpCo.map(v => { const all = res.tatCa.filter(r => r.vp === v), co = all.filter(r => chon.has(r.maNV)).length; return `<button class="b xs" type="button" data-tickvp="${esc(v)}" data-on="${co < all.length ? 1 : 0}" title="${co}/${all.length} người đang được đánh giá">${co < all.length ? '✓ Tick' : 'Bỏ tick'} ${esc(v)} (${co}/${all.length})</button>`; }).join('')}</div>`
      + `Khớp tên bằng ${esc(res.mnvNguon)}. Nhân viên mới chưa có trong "bảng mã nv" của file kho được lấy theo họ tên trong bảng chấm công tháng đó (ghi "NV mới").`
      + (kk.length ? `<details style="margin-top:8px"${kk.some(x => x.kho + x.san >= 200) ? '' : ''}><summary style="cursor:pointer;color:#1a56db">${kk.length} tên quét trong file chưa khớp mã NV nào (không được đánh giá) — bấm để xem / gán mã NV</summary>
          <div class="muted" style="margin:6px 0">Thường là kho Đà Nẵng hoặc người ngoài. Nếu là nhân viên của mình: gõ Mã NV rồi bấm Gán — áp dụng cho mọi tháng.</div>
          <table class="dt" style="max-width:720px"><thead><tr><th>Tên trong file</th><th class="r">Lượt kho</th><th class="r">Lượt sàn</th><th>Mã NV</th><th></th></tr></thead><tbody>
          ${kk.slice(0, 60).map((x, i) => `<tr data-kk="${i}"><td class="name">${esc(x.ten)}</td><td class="r">${num(x.kho)}</td><td class="r">${num(x.san)}</td><td><input type="text" data-gan="ma" placeholder="vd. 020401" style="width:90px"></td><td><button class="b xs" type="button" data-gan="ok">Gán</button></td></tr>`).join('')}
          </tbody></table></details>` : '')
      + (res.doan && res.doan.length ? `<div style="margin-top:8px">Tự khớp tên đăng nhập Tạo kiện theo họ tên (bảng mã nv chưa có): ${res.doan.map(([u, m]) => `${esc(u)} → ${esc((res.tatCa.find(r => r.maNV === m) || {}).hoTen || m)}`).join(' · ')}. Sai thì gán lại tay ở bảng trên.</div>` : '')
      + (ganTay.length ? `<div style="margin-top:8px">Đã gán tay: ${ganTay.map((x, i) => `<span class="chip">${esc(x.maNV)} – ${esc(x.hoTen)}${x.maHT && x.maHT !== x.hoTen ? ` (${esc(x.maHT)})` : ''} <button type="button" data-boGan="${i}" aria-label="Bỏ">×</button></span>`).join(' ')}</div>` : '');
    $('dsFoot')._kk = kk;
  }
  $('dsFoot').addEventListener('click', e => {
    const tv = e.target.closest('[data-tickvp]');
    if (tv) { const res = tinh(current()); res.tatCa.filter(r => r.vp === tv.dataset.tickvp).forEach(r => { caiDat.chon[r.maNV] = tv.dataset.on === '1'; }); touchCfg(); renderAll(); return; }
    const b = e.target.closest('[data-gan="ok"]'), bo = e.target.closest('[data-bogan]');
    if (bo) { caiDat.nvThem = (caiDat.nvThem || []).filter((_, i) => i !== Number(bo.dataset.bogan)); touchCfg(); renderAll(); return; }
    if (!b) return;
    const tr = b.closest('[data-kk]'), x = ($('dsFoot')._kk || [])[Number(tr.dataset.kk)], ma = tr.querySelector('[data-gan="ma"]').value.trim();
    if (!x || !ma) return;
    // tên của mã đó (nếu đã có trong bảng mã / chấm công) để hiện đúng họ tên; username (Tạo kiện) / tên quét lưu làm mã hệ thống
    const co = nguoiList().find(p => !p.ngoai && p.maNV === ma);
    caiDat.nvThem = [...(caiDat.nvThem || []), { maNV: ma, hoTen: co ? co.hoTen : x.ten, maHT: x.ten }];
    touchCfg(); renderAll();
  });
  function vpTuDong(ma) { const sv = caiDat.vp; caiDat.vp = {}; const v = vpMap(current())[ma]; caiDat.vp = sv; return v || ''; }
  $('dsBody').addEventListener('change', ev => {
    const inp = ev.target.closest('[data-k]'), tr = ev.target.closest('[data-ma]'); if (!inp || !tr) return;
    const ma = tr.dataset.ma;
    if (inp.dataset.k === 'chon') caiDat.chon[ma] = inp.checked;
    else if (inp.dataset.k === 'vp') { caiDat.vp = Object.assign({}, caiDat.vp); if (inp.value) caiDat.vp[ma] = inp.value; else delete caiDat.vp[ma]; }
    else { const v = inp.value.trim(); if (v && v !== DG.NHOM_MD) caiDat.nhom[ma] = v; else delete caiDat.nhom[ma]; }
    touchCfg(); renderAll();
  });

  // ---- Đóng cặp (giống trang Thưởng kho: nhập nhanh từ ghi chú chữ / ảnh, thêm từng cặp, sửa / xóa).
  // Danh sách cặp dùng chung cho mọi tháng (dongCap.list); cặp của Thưởng kho / sàn chỉ đọc, bấm "Không dùng" để bỏ.
  const BUOI = { '': 'Cả ngày', sang: 'Sáng', chieu: 'Chiều' };
  const vnDate = s => s ? `<span class="muted">${THU[new Date(s + 'T00:00:00').getDay()]}</span> ${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';
  const ddmm = s => s ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : '';
  const kyNay = () => current() || (() => { const d = new Date(); return `${d.getFullYear()}-${DG.pad2(d.getMonth() + 1)}`; })();
  function nguoiList() {
    const mnv = rowsFor(kyNay());
    const emps = mnv ? DG.bangMa(mnv.rows).list : [];
    return [...emps.map(e => ({ maNV: e.maNV, hoTen: e.hoTen, ngoai: false })), ...dongCap.ngoai.map(h => ({ maNV: h.maNV, hoTen: h.hoTen, ngoai: true }))];
  }
  const labelOf = e => !e ? '' : e.ngoai ? `${e.hoTen} (ngoài DS)` : `${e.maNV} - ${e.hoTen}`;
  const tenCap = u => labelOf(nguoiList().find(e => e.maNV === u)) || u;
  const optList = () => nguoiList().map(e => ({ value: e.maNV, label: labelOf(e) }));

  // ô chọn nhân viên có gõ tìm (không dấu cũng được) — y như trang Thưởng kho
  const foldKeep = s => String(s ?? '').normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  const lowerNFC = s => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const comboList = document.createElement('div');
  comboList.className = 'tkc-list'; comboList.hidden = true; comboList.setAttribute('role', 'listbox');
  document.body.appendChild(comboList);
  let comboOwner = null;
  comboList.addEventListener('mousedown', e => {
    e.preventDefault();
    const d = e.target.closest('[data-i]');
    if (d && comboOwner) comboOwner.pickIdx(Number(d.dataset.i));
  });
  window.addEventListener('scroll', () => { if (comboOwner) comboOwner.place(); }, true);
  window.addEventListener('resize', () => { if (comboOwner) comboOwner.place(); });
  function makeCombo(input, getOpts) {
    let value = '', items = [], act = -1;
    input.autocomplete = 'off'; input.spellcheck = false;
    const lab = v => { const o = getOpts().find(x => x.value === v); return o ? o.label : ''; };
    const api = {
      onChange: null,
      get value() { return value; },
      set(v) { value = v && getOpts().some(o => o.value === v) ? v : ''; input.value = lab(value); input.classList.remove('bad'); },
      setText(t) { value = ''; input.value = t || ''; input.classList.toggle('bad', !!t); },
      refresh() { if (value && !getOpts().some(o => o.value === value)) value = ''; if (value) input.value = lab(value); },
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
      const showAll = !q || (value && input.value === lab(value));
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
      if (!value && input.value.trim() && comboOwner === api && items.length === 1) pick(items[0]);
      close();
      input.classList.toggle('bad', !value && !!input.value.trim());
    });
    return api;
  }
  const cAdj1 = makeCombo($('adj1'), optList), cAdj2 = makeCombo($('adj2'), optList);

  // nhận cặp + khoảng ngày + buổi từ ghi chú (cùng cách đọc với trang Thưởng kho)
  const DATE_RE = /(?<![\d\/.])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?:\s*[\/.]\s*(\d{4}|\d{2}))?(?!\d)/g;
  const JOIN_RE = /\s*[+&＋†]\s*|\s+(?:và|với|cùng|va|voi)\s+/iu;
  const STOPW = new Set(['từ', 'ngày', 'đến', 'tới', 'đóng', 'bốc', 'hàng', 'cặp', 'gồm', 'là', 'tuần', 'tháng', 'đợt', 'buổi', 'ca', 'sáng', 'chiều']);
  const buoiOf = line => {
    const s = line.normalize('NFC').toLowerCase();
    const sa = /(^|[^\p{L}])sáng(?!\p{L})/u.test(s), ch = /(^|[^\p{L}])chiều(?!\p{L})/u.test(s);
    return sa && ch ? '' : sa ? 'sang' : ch ? 'chieu' : null;
  };
  const HONOR = /^(?:chị|chi|c|anh|a|em|e|cô|co|chú|chu|bạn|ban|bà|ông|bé|mr|ms|mrs)\s+(?=\S)/iu;
  const isoD = (y, m, d) => `${y}-${DG.pad2(m)}-${DG.pad2(d)}`;
  const okDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
  function takeRange(line, year, qNum) {
    const ms = [...line.matchAll(DATE_RE)];
    if (!ms.length) return null;
    const part = m => ({ d: +m[1], mo: +m[2], y: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : 0 });
    let a, b, start, end;
    if (ms.length >= 2) { a = part(ms[0]); b = part(ms[1]); start = ms[0].index; end = ms[1].index + ms[1][0].length; }
    else {
      b = part(ms[0]); start = ms[0].index; end = start + ms[0][0].length;
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
    const nm = mode === 'exact' ? lowerNFC : fold;
    const qw = nm(q).split(' ').filter(Boolean);
    if (!qw.length) return [];
    if (mode === 'fuzzy' && qw.length < 2) return [];
    const near = (x, y) => x === y || (mode === 'fuzzy' && Math.min(x.length, y.length) >= 3 && lev(x, y) <= 1);
    const fits = (w, s) => qw.every((x, i) => near(x, w[s + i])) && (mode !== 'fuzzy' || qw.some((x, i) => x === w[s + i]));
    const L = opts.map(o => ({ o, w: nm(o.name).split(' ') }));
    const tail = L.filter(({ w }) => w.length >= qw.length && fits(w, w.length - qw.length));
    if (tail.length) return tail.map(t => t.o);
    return L.filter(({ w }) => { for (let s = 0; s + qw.length <= w.length; s++) if (fits(w, s)) return true; return false; }).map(t => t.o);
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
  // nhiều người cùng tên ngắn ("Huyền") → ưu tiên người có lượt quét trong tháng đang xem
  function autoPick(m, active) {
    if (m.hits.length === 1) return m.hits[0].value;
    const a = m.hits.filter(h => active.has(h.value));
    return a.length === 1 ? a[0].value : '';
  }
  const thangGiua = (from, to) => { const out = []; let [y, m] = from.split('-').map(Number); const [y2, m2] = to.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${DG.pad2(m)}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 24) break; } return out; };
  const toAdj = r => ({ maNV1: r.v1, maNV2: r.v2, dateFrom: r.from, dateTo: r.to, buoi: r.buoi || '' });

  let qRows = [], qTimer = null;
  function qCheck(r) {
    if (!r.v1 || !r.v2) return { level: 'no', text: 'Chưa chọn đủ 2 người' };
    if (r.v1 === r.v2) return { level: 'no', text: 'Hai người trùng nhau' };
    if (!r.from || !r.to) return { level: 'no', text: 'Thiếu ngày' };
    if (r.from > r.to) return { level: 'no', text: '"Từ ngày" sau "Đến ngày"' };
    const ad = toAdj(r);
    if (dongCap.list.some(a => sameCap(a, ad) && (a.ap || 'kho') === r.ap)) return { level: 'no', text: 'Đã có trong danh sách bên dưới' };
    const kind = r.ap === 'san' ? 'ts' : 'tk';
    if (r.ap !== 'ca' && capOf(r.from.slice(0, 7), kind).some(a => sameCap(a, ad))) return { level: 'no', text: `Đã khai ở trang ${kind === 'tk' ? 'Thưởng kho' : 'Thưởng sàn'} (đã được tính)` };
    const notes = [];
    if ([1, 2].some(k => r['m' + k].mode === 'fuzzy' && r['m' + k].hits.some(h => h.value === r['v' + k]))) notes.push('kiểm tra lại tên đoán gần đúng');
    const thieu = thangGiua(r.from.slice(0, 7), r.to.slice(0, 7)).filter(k => !archive[k]);
    if (thieu.length) notes.push(`chưa nạp file ${thieu.map(k => DG.kyLabel(k).replace('Tháng ', 'T')).join(', ')} — vẫn lưu, nạp file sau tự áp dụng`);
    return { level: notes.length ? 'warn' : 'ok', text: '✓ Sẵn sàng' + (notes.length ? ' · ' + notes.join(' · ') : '') };
  }
  function qHint(r, k) {
    const m = r['m' + k], v = r['v' + k];
    if (v) return m.mode === 'fuzzy' && m.hits.length === 1 && m.hits[0].value === v ? `Đoán gần đúng từ “${esc(m.query)}” — kiểm tra lại` : m.hits.length > 1 ? `Chọn người có lượt trong tháng (${m.hits.length} người tên “${esc(m.query)}”) — kiểm tra lại` : '';
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
  const sel3 = (obj, cur, k) => `<select data-qk="${k}">${Object.entries(obj).map(([v, l]) => `<option value="${v}"${v === (cur || '') ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  function renderQuick() {
    $('qPrev').hidden = !qRows.length;
    $('qBody').innerHTML = qRows.map((r, i) => `<tr data-qi="${i}">
      <td><input type="checkbox" data-qk="inc" aria-label="Thêm dòng này"></td>
      <td><span class="tk-combo"><input type="text" data-qk="n1" placeholder="Gõ tên để tìm…"></span><div class="qhint" data-qh="1"></div></td>
      <td><span class="tk-combo"><input type="text" data-qk="n2" placeholder="Gõ tên để tìm…"></span><div class="qhint" data-qh="2"></div></td>
      <td><input type="date" data-qk="from" value="${r.from}"></td>
      <td><input type="date" data-qk="to" value="${r.to}"></td>
      <td>${sel3(BUOI, r.buoi, 'buoi')}</td><td>${sel3(AP, r.ap, 'ap')}</td>
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
    const [y, m] = kyNay().split('-').map(Number);
    const { rows, bad } = parseNote($('qText').value, y, Math.ceil(m / 3));
    const opts = nguoiList().map(e => ({ value: e.maNV, name: e.hoTen }));
    const res = tinh(current()), active = new Set(res && !res.loi ? res.tatCa.map(x => x.maNV) : []);
    qRows = rows.map((r, i) => {
      const m1 = matchName(r.n1, opts), m2 = matchName(r.n2, opts);
      return { ...r, key: i, m1, m2, v1: autoPick(m1, active), v2: autoPick(m2, active), ap: 'kho', include: true };
    });
    renderQuick();
    const txt = $('qText').value.trim();
    const badNote = bad.length ? ` Dòng có hơn 2 người chưa tách được: ${bad.map(b => `“${esc(b)}”`).join(', ')}.` : '';
    if (txt && !qRows.length) msg($('qMsg'), 'Chưa nhận ra cặp nào — mỗi cặp ghi dạng “Tên + Tên”, khoảng ngày ghi kiểu “từ 6/10 đến 11/10”.' + badNote);
    else if (txt && !qRows.some(r => r.from)) msg($('qMsg'), `Nhận ra ${qRows.length} cặp nhưng chưa thấy khoảng ngày (ví dụ “từ 6/10 đến 11/10”) — điền ngày trong bảng dưới.` + badNote);
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
    const im = await loadImg(url);
    const sc = Math.max(1, Math.min(4, 1600 / im.naturalWidth));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
    let sum = 0;
    for (let i = 0; i < p.length; i += 4) { const v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]; p[i] = v; sum += v; }
    const dark = sum / (p.length / 4) < 110;
    for (let i = 0; i < p.length; i += 4) { let v = dark ? 255 - p[i] : p[i]; if (v > 200) v = 255; p[i] = p[i + 1] = p[i + 2] = v; }
    g.putImageData(d, 0, 0);
    return c;
  }
  async function readImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { msg($('qMsg'), 'Chỉ nhận file ảnh (PNG, JPG…).'); return; }
    if (ocrBusy) return;
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
  const qBox = root.querySelector('.tk-quick'), qDrop = $('qDrop');
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
    if (tab() !== 'dong-cap' || !e.clipboardData) return;
    const cd = e.clipboardData, txt = cd.getData('text/plain') || '';
    const inField = e.target && e.target.closest && e.target.closest('input, textarea, [contenteditable]');
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
    else if (k === 'from' || k === 'to' || k === 'buoi' || k === 'ap') { r[k] = e.target.value; qStatus(i); }
  });
  function themNgoai(name) {
    const h = { maNV: `__extra_${Date.now()}__`, hoTen: name };
    dongCap.ngoai = [...dongCap.ngoai, h]; touchCap();
    return h;
  }
  $('qBody').addEventListener('click', e => {
    const b = e.target.closest('[data-qhelper]'); if (!b) return;
    const [key, k] = b.dataset.qhelper.split('|').map(Number), r = qRows.find(x => x.key === key); if (!r) return;
    const name = r['m' + k].query.replace(HONOR, '').trim().split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const h = themNgoai(name);
    r['v' + k] = h.maNV; r['m' + k] = { hits: [{ value: h.maNV, name }], mode: 'exact', query: name };
    renderAll(); renderQuick();
  });
  $('qAdd').addEventListener('click', () => {
    const ok = qRows.filter(r => r.include && qCheck(r).level !== 'no');
    if (!ok.length) { msg($('qMsg'), 'Chưa có dòng nào hợp lệ được đánh dấu.'); return; }
    const base = Date.now();
    dongCap.list = [...dongCap.list, ...ok.map((r, i) => ({ id: base + i, maNV1: r.v1, maNV2: r.v2, dateFrom: r.from, dateTo: r.to, ...(r.buoi ? { buoi: r.buoi } : {}), ap: r.ap || 'kho' }))];
    touchCap();
    qRows = qRows.filter(r => !ok.includes(r));
    if (!qRows.length) { $('qText').value = ''; resetThumb(); }
    renderQuick(); renderAll();
    msg($('qMsg'), `Đã thêm <b>${ok.length}</b> cặp (xem bảng bên dưới) — bảng đánh giá đã tính lại.` + (qRows.length ? ` Còn ${qRows.length} dòng chưa thêm — sửa rồi bấm Thêm lần nữa.` : ''), true);
  });
  $('qClear').addEventListener('click', () => { qRows = []; $('qText').value = ''; resetThumb(); msg($('qMsg'), ''); renderQuick(); });

  $('adjAdd').addEventListener('click', () => {
    const a1 = cAdj1.value, a2 = cAdj2.value, f = $('adjFrom').value, t = $('adjTo').value || f, b = $('adjBuoi').value, ap = $('adjAp').value;
    if (!a1 || !a2 || !f) { msg($('adjMsg'), 'Chọn đủ 2 người (gõ tên rồi bấm chọn trong danh sách) và ngày.'); return; }
    if (a1 === a2) { msg($('adjMsg'), 'Hai người phải khác nhau.'); return; }
    if (f > t) { msg($('adjMsg'), '"Từ ngày" phải trước "Đến ngày".'); return; }
    const ad = { maNV1: a1, maNV2: a2, dateFrom: f, dateTo: t, buoi: b };
    if (dongCap.list.some(a => sameCap(a, ad) && (a.ap || 'kho') === ap)) { msg($('adjMsg'), 'Cặp này đã có trong danh sách.'); return; }
    dongCap.list = [...dongCap.list, { id: Date.now(), maNV1: a1, maNV2: a2, dateFrom: f, dateTo: t, ...(b ? { buoi: b } : {}), ap }];
    touchCap(); msg($('adjMsg'), ''); cAdj1.set(''); cAdj2.set(''); ['adjFrom', 'adjTo', 'adjBuoi'].forEach(id => { $(id).value = ''; }); $('adjAp').value = 'kho';
    renderAll();
  });
  $('helperAdd').addEventListener('click', () => { const name = $('helperName').value.trim(); if (!name) return; themNgoai(name); $('helperName').value = ''; renderAll(); });
  $('capAll').addEventListener('change', () => renderCap());

  // gộp ngày liên tiếp: [6,7,8,10] → "6–8, 10"
  const gopNgay = ds => { const a = [...ds].sort((x, y) => x - y), out = []; for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`); i = j; } return out.join(', '); };
  let editId = null, eC1 = null, eC2 = null;
  function renderCap() {
    const ky = current(), all = $('capAll').checked;
    cAdj1.refresh(); cAdj2.refresh();
    qRows.forEach((r, i) => qStatus(i));
    const res = ky ? tinh(ky) : null, info = res && !res.loi ? (res.capInfo || {}) : {}, mo = ky ? Number(ky.slice(5)) : 0;
    const ownAll = dongCap.list.map(a => ({ ...a, key: 'own:' + a.id, nguon: 'own', ap: a.ap || 'kho', dung: true }));
    const cl = ky ? capList(ky) : [];
    const rows = (all ? [...ownAll, ...cl.filter(a => a.nguon !== 'own')] : (ky ? cl : ownAll))
      .sort((x, y) => x.dateFrom.localeCompare(y.dateFrom) || x.dateTo.localeCompare(y.dateTo) || tenCap(x.maNV1).localeCompare(tenCap(y.maNV1), 'vi') || (x.buoi || '').localeCompare(y.buoi || ''));
    if (editId !== null && !rows.some(a => a.key === editId)) editId = null;
    $('capTitle').textContent = all || !ky ? `Tất cả các cặp (${rows.length})` : `Các cặp có ngày trong ${DG.kyLabel(ky)} (${rows.length})`;
    const kq = a => {
      if (!a.dung) return '<span class="muted">Không dùng</span>';
      if (!ky || !giaoThang(a, ky)) return '<span class="muted">Ngoài tháng đang xem</span>';
      if (caiDat.dungCap === false) return '<span class="muted">Đang tắt chia đôi (mục Tiêu chí)</span>';
      if (!res || res.loi) return '<span class="muted">Chưa có dữ liệu tháng này</span>';
      const i = info[a.key]; if (!i) return '–';
      let t = i.chia.length ? `Chia đôi ${i.chia.length} ngày (${gopNgay(i.chia)}/${mo})` : '<span style="color:#b45309">Không chia ngày nào</span>';
      if (i.bo.length) t += ` · <span style="color:#b45309">không chia ${i.bo.map(([d, l]) => `${d}/${mo} (${esc(l)})`).join(', ')}</span>`;
      if (i.nua.length) t += ` · chỉ chia ${i.nua.map(([d, h, l]) => `buổi ${h === 's' ? 'sáng' : 'chiều'} ${d}/${mo}${l ? ` (${esc(l)})` : ''}`).join(', ')}`;
      return t;
    };
    const monthOf = s => s.slice(0, 7);
    const weekOf = s => { const t = new Date(s + 'T00:00:00'); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t.toDateString(); };
    const perMonth = {}; rows.forEach(a => { perMonth[monthOf(a.dateFrom)] = (perMonth[monthOf(a.dateFrom)] || 0) + 1; });
    let prevMonth = '', prevWeek = '';
    $('adjList').innerHTML = rows.length ? rows.map(a => {
      let head = '', wk = '';
      const mk = monthOf(a.dateFrom);
      if (mk !== prevMonth) { head = `<tr class="grp"><td colspan="8">${DG.kyLabel(mk)} <span>· ${perMonth[mk]} cặp bắt đầu trong tháng</span></td></tr>`; prevMonth = mk; prevWeek = weekOf(a.dateFrom); }
      else if (weekOf(a.dateFrom) !== prevWeek) { wk = 'wk'; prevWeek = weekOf(a.dateFrom); }
      if (a.key === editId) {
        const opt = (obj, cur) => Object.entries(obj).map(([v, l]) => `<option value="${v}"${v === (cur || '') ? ' selected' : ''}>${l}</option>`).join('');
        return head + `<tr class="${wk}"><td><span class="tk-combo"><input type="text" id="eAdj1" placeholder="Gõ tên để tìm…"></span></td><td><span class="tk-combo"><input type="text" id="eAdj2" placeholder="Gõ tên để tìm…"></span></td>`
          + `<td><input type="date" id="eFrom" value="${a.dateFrom}"></td><td><input type="date" id="eTo" value="${a.dateTo}"></td><td><select id="eBuoi">${opt(BUOI, a.buoi)}</select></td><td><select id="eAp">${opt(AP, a.ap)}</select></td><td></td>`
          + `<td style="white-space:nowrap"><button type="button" class="b ok xs" data-csave="${esc(a.key)}">Lưu</button> <button type="button" class="b xs" data-ccancel="1">Hủy</button></td></tr>`;
      }
      const src = a.nguon === 'own' ? '' : `<span class="chip src" title="Khai ở trang ${a.nguon === 'tk' ? 'Thưởng kho' : 'Thưởng sàn'} — sửa ở trang đó">${a.nguon === 'tk' ? 'Thưởng kho' : 'Thưởng sàn'}</span>`;
      const btn = a.nguon === 'own'
        ? `<button type="button" class="b xs" data-cedit="${esc(a.key)}">Sửa</button> <button type="button" class="b del xs" data-crm="${esc(a.key)}">Xóa</button>`
        : `<button type="button" class="b xs" data-cbo="${esc(a.key)}">${a.dung ? 'Không dùng' : 'Dùng lại'}</button>`;
      return head + `<tr class="${[wk, a.dung ? '' : 'off'].join(' ').trim()}"><td>${esc(tenCap(a.maNV1))}${src}</td><td>${esc(tenCap(a.maNV2))}</td><td>${vnDate(a.dateFrom)}</td><td>${vnDate(a.dateTo)}</td>`
        + `<td>${BUOI[a.buoi || '']}</td><td>${AP[a.ap]}</td><td class="kq">${kq(a)}</td><td style="white-space:nowrap">${btn}</td></tr>`;
    }).join('') : emptyRow(8, ky ? `Chưa có cặp nào trong ${DG.kyLabel(ky)}.` : 'Chưa có cặp nào.');
    if (editId !== null) {
      const a = rows.find(x => x.key === editId);
      eC1 = makeCombo($('eAdj1'), optList); eC1.set(a.maNV1);
      eC2 = makeCombo($('eAdj2'), optList); eC2.set(a.maNV2);
    }
    $('helperList').innerHTML = dongCap.ngoai.map(h => `<span class="chip">${esc(h.hoTen)} <button type="button" data-rmh="${esc(h.maNV)}" aria-label="Bỏ">×</button></span>`).join('') || '<span class="muted">Chưa có</span>';
  }
  $('adjList').addEventListener('click', e => {
    const t = e.target.closest('[data-cedit],[data-ccancel],[data-csave],[data-crm],[data-cbo]'); if (!t) return;
    const d = t.dataset;
    if (d.cedit) { editId = d.cedit; msg($('adjMsg'), ''); renderCap(); return; }
    if (d.ccancel) { editId = null; renderCap(); return; }
    if (d.cbo) { dongCap.boQua = dongCap.boQua.includes(d.cbo) ? dongCap.boQua.filter(k => k !== d.cbo) : [...dongCap.boQua, d.cbo]; touchCap(); renderAll(); return; }
    const id = (d.csave || d.crm).replace('own:', ''), a = dongCap.list.find(x => String(x.id) === id); if (!a) return;
    if (d.crm) { if (editId === d.crm) editId = null; dongCap.list = dongCap.list.filter(x => x !== a); touchCap(); renderAll(); return; }
    const m1 = eC1 && eC1.value, m2 = eC2 && eC2.value, f = $('eFrom').value, to = $('eTo').value || f, b = $('eBuoi').value, ap = $('eAp').value;
    if (!m1 || !m2 || !f) { msg($('adjMsg'), 'Chọn đủ 2 người (gõ tên rồi bấm chọn trong danh sách) và ngày.'); return; }
    if (m1 === m2) { msg($('adjMsg'), 'Hai người phải khác nhau.'); return; }
    if (f > to) { msg($('adjMsg'), '"Từ ngày" phải trước "Đến ngày".'); return; }
    Object.assign(a, { maNV1: m1, maNV2: m2, dateFrom: f, dateTo: to, ap });
    if (b) a.buoi = b; else delete a.buoi;
    editId = null; touchCap(); renderAll();
    msg($('adjMsg'), 'Đã lưu thay đổi — bảng đánh giá đã tính lại.', true);
    setTimeout(() => msg($('adjMsg'), ''), 5000);
  });
  $('helperList').addEventListener('click', e => {
    const b = e.target.closest('[data-rmh]'); if (!b) return;
    if (dongCap.list.some(a => a.maNV1 === b.dataset.rmh || a.maNV2 === b.dataset.rmh)) { msg($('adjMsg'), 'Người này đang có trong cặp — xóa các cặp đó trước.'); return; }
    dongCap.ngoai = dongCap.ngoai.filter(h => h.maNV !== b.dataset.rmh); touchCap(); renderAll();
  });

  // ---- Nạp file tháng
  function renderNap() {
    $('dgPending').innerHTML = pending.map((p, pi) => {
      const f = p.file, ks = Object.keys(f.thang).sort();
      const ten = f.loai === 'kho' ? 'FILE KHO' : 'FILE SÀN';
      const canMnv = f.loai === 'san' && !pending.some(x => x.file.mnvRows) && !caiDat.mnvRows && !kys().some(k => archive[k].kho && archive[k].kho.mnvRows);
      return `<div class="pend"><h4>${esc(f.fileName)} — <span style="color:${f.loai === 'kho' ? 'var(--kho)' : 'var(--san)'}">${ten}</span></h4>
        <div class="muted">${num(f.soDong)} dòng${f.soSheet > 1 ? ` từ ${f.soSheet} sheet${f.trungBoQua ? ` (bỏ ${num(f.trungBoQua)} kiện trùng)` : ''}` : ''}${f.mnvRows ? ` · bảng mã nv ${f.mnvRows.length} dòng` : ' · không có bảng mã nv (dùng của file kho)'}${f.roster ? ` · sheet ${esc(f.rosterSheet)}: ${f.roster.ds.length} NV` : ''}. Tick tháng cần lưu (tháng chỉ lẫn vài ngày đầu/cuối thì bỏ):</div>
        ${canMnv ? '<div class="tk-warnmsg" style="margin:0 0 8px">Chưa có bảng mã nv nào để khớp tên của file sàn — thả kèm file kho của tháng này (vẫn lưu được, khi có file kho trang tự khớp lại).</div>' : ''}
        <table class="dt" style="max-width:640px"><thead><tr><th style="width:30px"></th><th>Tháng</th><th class="r">Số lượt</th><th class="r">Số ngày có dữ liệu</th><th></th></tr></thead><tbody>
        ${ks.map(k => `<tr><td><input type="checkbox" data-p="${pi}" data-ky="${k}"${p.chon.has(k) ? ' checked' : ''}></td><td>${DG.kyLabel(k)}</td><td class="r">${num(f.thang[k].luot)}</td><td class="r">${f.thang[k].soNgay}</td>
          <td class="muted">${archive[k] && archive[k][f.loai] ? `đã có file ${f.loai === 'kho' ? 'kho' : 'sàn'} (${esc(archive[k][f.loai].fileName)}) — sẽ thay` : ''}</td></tr>`).join('')}
        </tbody></table></div>`;
    }).join('') + (pending.length ? `<div class="tk-row" style="margin-top:12px"><button class="b pri" type="button" id="pSave">Lưu các tháng đã tick</button><button class="b" type="button" id="pCancel">Huỷ</button></div>` : '');
    const ks = kys().reverse();
    $('dgSaved').innerHTML = ks.map(k => {
      const e = archive[k], sh = ccOf(k), cl = capList(k).filter(a => a.dung), ck = cl.filter(a => a.nguon === 'own').length, cs = cl.length - ck;
      const src = x => x ? `${esc(x.fileName)}<br><span class="muted">${num(x.raw.luot)} lượt · nạp ${x.napLuc ? new Date(x.napLuc).toLocaleDateString('vi-VN') : ''}</span>` : '<span style="color:#b45309">chưa nạp</span>';
      return `<tr><td class="name"><a href="#bang-danh-gia" data-ky="${k}">${DG.kyLabel(k)}</a></td><td>${src(e.kho)}</td><td>${src(e.san)}</td>
        <td>${sh ? esc(sh.ten || 'Có') : '<span class="muted">chưa có</span>'}</td><td>${ck} cặp khai ở đây${cs ? ` · ${cs} từ Thưởng kho / sàn` : ''}</td>
        <td><div class="tk-row">${e.kho ? `<button class="b xs" type="button" data-del="${k}|kho">Xóa file kho</button>` : ''}${e.san ? `<button class="b xs" type="button" data-del="${k}|san">Xóa file sàn</button>` : ''}<button class="b xs del" type="button" data-del="${k}|all">Xóa tháng</button></div></td></tr>`;
    }).join('') || emptyRow(6, 'Chưa nạp tháng nào.');
  }
  function readOne(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = ev => {
        const w = new Worker(`dg-worker.js?v=${VER}`);
        w.onmessage = m => {
          if (m.data.step) { $('dgZoneTitle').textContent = `${file.name}: ${m.data.step}`; return; }
          w.terminate(); resolve(m.data.ok ? { file: m.data.file } : { error: m.data.error });
        };
        w.onerror = err => { w.terminate(); resolve({ error: err.message || 'Lỗi đọc file' }); };
        w.postMessage({ buf: ev.target.result, fileName: file.name }, [ev.target.result]);
      };
      reader.onerror = () => resolve({ error: 'Không đọc được file' });
      reader.readAsArrayBuffer(file);
    });
  }
  const ZONE_TITLE = $('dgZoneTitle').textContent;
  async function handleFiles(files) {
    files = [...files].filter(f => /\.xls[xm]?$/i.test(f.name));
    if (!files.length || busy) return;
    busy = true; msg($('dgUpMsg'), '');
    const errs = [];
    for (const f of files) {
      $('dgZoneTitle').textContent = `Đang đọc ${f.name}… (file lớn có thể mất 10–40 giây)`;
      const r = await readOne(f);
      if (r.error) { errs.push(`<b>${esc(f.name)}</b>: ${esc(r.error)}`); continue; }
      pending = pending.filter(p => !(p.file.loai === r.file.loai && p.file.fileName === r.file.fileName));
      pending.push({ file: r.file, chon: new Set(DG.thangChinh(r.file)) });
    }
    busy = false; $('dgZoneTitle').textContent = ZONE_TITLE;
    if (errs.length) msg($('dgUpMsg'), errs.join('<br>'));
    if (location.hash !== '#nap-du-lieu') location.hash = '#nap-du-lieu';
    renderNap();
  }
  function savePending() {
    const saved = [], savedKy = [];
    pending.sort((a, b) => (a.file.loai === 'kho' ? 0 : 1) - (b.file.loai === 'kho' ? 0 : 1)).forEach(p => {
      const f = p.file;
      [...p.chon].sort().forEach(k => {
        if (!f.thang[k]) return;
        const e = archive[k] || (archive[k] = { ky: k, loi: {} });
        e[f.loai] = { fileName: f.fileName, napLuc: new Date().toISOString(), soDong: f.soDong, raw: f.thang[k],
          ...(f.loai === 'kho' ? { mnvRows: f.mnvRows, roster: f.roster, rosterSheet: f.rosterSheet } : {}) };
        if (f.loai === 'kho' && f.mnvRows && (!caiDat.mnvKy || k >= caiDat.mnvKy)) { caiDat.mnvRows = f.mnvRows; caiDat.mnvKy = k; caiDat.savedAt = new Date().toISOString(); scheduleSave('cai-dat'); }
        memo.delete(k); touch(k); savedKy.push(k); saved.push(`${DG.kyLabel(k)} (${f.loai === 'kho' ? 'kho' : 'sàn'})`);
      });
    });
    if (!saved.length) { msg($('dgUpMsg'), 'Chưa tick tháng nào để lưu.'); return; }
    sel = savedKy.sort().pop();
    pending = []; persistLocal();
    location.hash = '#bang-danh-gia';
    renderAll();
    msg($('dgMsg'), `Đã lưu: ${[...new Set(saved)].join(', ')}.` + (archive[sel] && !archive[sel].san ? ' Tháng này chưa có file sàn — thả thêm khi có.' : archive[sel] && !archive[sel].kho ? ' Tháng này chưa có file kho — thả thêm khi có.' : ''), true);
    setTimeout(() => msg($('dgMsg'), ''), 9000);
  }
  const zone = $('dgZone'), fi = $('dgFile');
  zone.addEventListener('click', () => fi.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { handleFiles(fi.files); fi.value = ''; });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag'); handleFiles(e.dataTransfer.files); });
  $('dgPending').addEventListener('change', e => {
    const c = e.target.closest('[data-p]'); if (!c) return;
    const p = pending[Number(c.dataset.p)]; if (!p) return;
    if (c.checked) p.chon.add(c.dataset.ky); else p.chon.delete(c.dataset.ky);
  });
  $('dgPending').addEventListener('click', e => {
    if (e.target.id === 'pSave') savePending();
    if (e.target.id === 'pCancel') { pending = []; msg($('dgUpMsg'), ''); renderNap(); }
  });
  $('dgSaved').addEventListener('click', e => {
    const a = e.target.closest('a[data-ky]'); if (a) { sel = a.dataset.ky; persistLocal(); return; }
    const b = e.target.closest('[data-del]'); if (!b) return;
    const [k, what] = b.dataset.del.split('|'), e2 = archive[k]; if (!e2) return;
    const label = what === 'all' ? `toàn bộ ${DG.kyLabel(k)} (cả lỗi chất lượng / ghi chú đã nhập)` : `file ${what === 'kho' ? 'kho' : 'sàn'} của ${DG.kyLabel(k)}`;
    if (!confirm(`Xóa ${label}? Không hoàn tác được.`)) return;
    if (what === 'all' || !e2[what === 'kho' ? 'san' : 'kho']) { delete archive[k]; deleteRemote(k); persistLocal(); }
    else { delete e2[what]; touch(k); }
    memo.clear(); renderAll();
  });

  // ---- Tiêu chí
  const FIELDS = [
    ['heSoSan', 'Hệ số quy đổi lượt sàn', '1 lượt sàn = ? lượt kho (mặc định 0,25 = 20 ÷ 80)', 0.05],
    ['dmNgay', 'Định mức 1 ngày công', 'lượt quy đổi / ngày (nửa ngày = một nửa)', 1],
    ['dNS', 'Điểm Năng suất (tối đa)', '', 1],
    ['nsDinh', 'Đủ điểm năng suất khi đạt (%)', '% so với trung bình nhóm', 5],
    ['dOD', 'Điểm Ổn định (tối đa)', 'nhân với tỷ lệ ngày đạt định mức', 1],
    ['dCL', 'Điểm Chất lượng (tối đa)', '', 1],
    ['truLoi', 'Mỗi lỗi chất lượng trừ', 'điểm', 1],
    ['A', 'Xếp loại A từ', 'tổng điểm', 1], ['B', 'Xếp loại B từ', 'tổng điểm', 1], ['C', 'Xếp loại C từ', 'tổng điểm (dưới = D)', 1],
    ['congToiThieu', 'Ngày công tối thiểu để xếp loại', 'ít hơn → "—" (mới vào / nghỉ dài)', 0.5],
  ];
  function renderCfg() {
    const cfg = cfgNow();
    if (!$('cfgForm').dataset.built) {
      $('cfgForm').innerHTML = FIELDS.map(([k, l, h, st]) => `<label>${esc(l)}<input type="number" step="${st}" min="0" data-cfgk="${k}"><span>${esc(h)}${DG.CFG[k] !== undefined ? ` · mặc định ${String(DG.CFG[k]).replace('.', ',')}` : ''}</span></label>`).join('');
      $('cfgForm').dataset.built = '1';
    }
    root.querySelectorAll('[data-cfgk]').forEach(inp => { if (document.activeElement !== inp) inp.value = cfg[inp.dataset.cfgk]; });
    $('cfgCC').checked = caiDat.dungCC !== false; $('cfgCap').checked = caiDat.dungCap !== false;
    root.querySelectorAll('[data-cfg]').forEach(s => { s.textContent = String(cfg[s.dataset.cfg]).replace('.', ','); });
    $('nsTb').textContent = n1(cfg.dNS * Math.min(1, 100 / cfg.nsDinh));
  }
  $('cfgForm').addEventListener('change', e => {
    const inp = e.target.closest('[data-cfgk]'); if (!inp) return;
    const v = Number(inp.value), k = inp.dataset.cfgk;
    if (!isFinite(v) || v < 0 || (k === 'nsDinh' && v <= 0)) { $('cfgMsg').textContent = 'Giá trị không hợp lệ.'; return; }
    caiDat.cfg = Object.assign({}, caiDat.cfg, { [k]: v });
    if (v === DG.CFG[k]) delete caiDat.cfg[k];
    $('cfgMsg').textContent = 'Đã lưu — bảng điểm tính lại theo tiêu chí mới.';
    touchCfg(); memo.clear(); renderAll();
  });
  $('cfgCC').addEventListener('change', e => { caiDat.dungCC = e.target.checked; touchCfg(); memo.clear(); renderAll(); });
  $('cfgCap').addEventListener('change', e => { caiDat.dungCap = e.target.checked; touchCfg(); memo.clear(); renderAll(); });
  $('cfgReset').addEventListener('click', () => { if (!confirm('Đưa tất cả tiêu chí về mặc định?')) return; caiDat.cfg = {}; caiDat.dungCC = true; caiDat.dungCap = true; touchCfg(); memo.clear(); renderAll(); $('cfgMsg').textContent = 'Đã về mặc định.'; });

  // ------------------------------------------------------------ vẽ tất cả
  function gopNgoai() {
    if (!dongCap.ngoai.length) return;
    const ds = nguoiList().filter(p => !p.ngoai), byTen = new Map(ds.map(p => [DG.key(p.hoTen), p.maNV]));
    let doi = false;
    dongCap.ngoai = dongCap.ngoai.filter(h => {
      const m = String(h.hoTen || '').match(/^\s*(\d{5,7})[\s\-–:.,]+(.+)$/);
      const ma = m ? m[1] : byTen.get(DG.key(h.hoTen));
      if (!ma) return true;
      dongCap.list.forEach(a => { if (a.maNV1 === h.maNV) { a.maNV1 = ma; doi = true; } if (a.maNV2 === h.maNV) { a.maNV2 = ma; doi = true; } });
      if (m && !ds.some(p => p.maNV === ma)) caiDat.nvThem = [...(caiDat.nvThem || []), { maNV: ma, hoTen: m[2].trim(), maHT: '' }];
      doi = true; return false;
    });
    if (doi) { touchCap(); touchCfg(); }
  }
  function renderAll(skipCL) {
    memo.clear();
    gopNgoai(); memo.clear();
    renderTop(); renderStats(); renderTabs();
    renderVPSel(); renderBang(); renderNX(); renderVP(); renderDash(); renderNgay(); renderCap(); renderXu();
    if (!skipCL) renderCL();
    renderDS(); renderNap(); renderCfg();
  }
  $('dgChips').addEventListener('click', e => { const b = e.target.closest('[data-ky]'); if (!b) return; sel = b.dataset.ky; persistLocal(); renderAll(); });
  $('dgSearch').addEventListener('input', e => { search = fold(e.target.value); renderBang(); renderNX(); renderVP(); renderNgay(); renderXu(); renderCL(); renderDS(); });
  $('tnMode').addEventListener('click', e => { const b = e.target.closest('[data-tn]'); if (!b) return; tnMode = b.dataset.tn; renderNgay(); });
  window.addEventListener('hashchange', () => { renderTabs(); renderStats(); renderTabs(); });

  // ------------------------------------------------------------ xuất Excel (cùng kiểu file Thưởng kho / Thưởng quý GH)
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
  const XFMT = { int: '#,##0;-#,##0;"–"', k1: '#,##0.0;-#,##0.0;"–"', d1: '#,##0.0;-#,##0.0;"–"', pct: '0%;-0%;"–"' };
  const soLe = (t, v) => (t === 'k1' && typeof v === 'number' && Number.isInteger(v)) ? 'int' : t;
  const XL_FILL = { A: ['D1FAE5', '065F46'], B: ['DBEAFE', '1E40AF'], C: ['FEF3C7', '92400E'], D: ['FEE2E2', '991B1B'] };
  function bangDep(wb, name, { title, sub, cols, groups, rows, total, muted, to, kyTen = true, rowH }) {
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
    rows.forEach((row, i) => { aoa.push(row); rowsH.push({ hpt: rowH ? rowH(i) : 21 }); });
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
        alignment: { vertical: 'center', horizontal: (t === 'name' || t === 'text') ? 'left' : (t === 'stt' || t === 'ma' || t === 'xl') ? 'center' : 'right', indent: (t === 'name' || t === 'text') ? 1 : 0, wrapText: t === 'text' } };
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
        const cellRef = XLSX.utils.encode_cell({ r: fr.row, c: fr.col });
        const pane = fr.col > 0 ? `<pane xSplit="${fr.col}" ySplit="${fr.row}" topLeftCell="${cellRef}" activePane="bottomRight" state="frozen"/>` : `<pane ySplit="${fr.row}" topLeftCell="${cellRef}" activePane="bottomLeft" state="frozen"/>`;
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
    const ky = current(), res = tinh(ky), cfg = cfgNow();
    const wb = XLSX.utils.book_new(), T = DG.kyLabel(ky).toUpperCase(), [y, m] = ky.split('-').map(Number);
    const list = sortHang(res.rows), r1 = x => Math.round(x * 10) / 10;
    const S = { stt: { h: 'HẠNG TRONG VP', t: 'stt', w: 7 }, ma: { h: 'MÃ NV', t: 'ma', w: 9 }, ten: { h: 'HỌ VÀ TÊN', t: 'name', w: 26 } };
    const nhieuNhom = true; // luôn có cột văn phòng / nhóm
    const xlTo = (i, v) => XL_FILL[v] ? { fill: XL_FILL[v][0], color: XL_FILL[v][1], bold: true } : null;
    // 1) Bảng đánh giá
    const cols = [S.stt, S.ma, S.ten, ...(nhieuNhom ? [{ h: 'VĂN PHÒNG / NHÓM', t: 'text', w: 16 }] : []),
      { h: 'Ngày công', t: 'k1', w: 8 }, { h: 'Lượt kho', t: 'int', w: 9 }, { h: 'Lượt sàn', t: 'int', w: 9 }, { h: 'Lượt quy đổi', t: 'k1', w: 10 }, { h: 'TB / ngày công', t: 'd1', w: 9 },
      { h: 'So với TB VP', t: 'pct', w: 9 }, { h: 'Ngày đạt định mức', t: 'pct', w: 9 }, { h: 'Có công không lượt', t: 'int', w: 8 }, { h: 'Số lỗi CL', t: 'int', w: 7 },
      { h: `Năng suất (${cfg.dNS})`, t: 'd1', w: 9 }, { h: `Ổn định (${cfg.dOD})`, t: 'd1', w: 9 }, { h: `Chất lượng (${cfg.dCL})`, t: 'd1', w: 9 },
      { h: 'TỔNG ĐIỂM', t: 'd1', w: 9, accent: true }, { h: 'XẾP LOẠI', t: 'xl', w: 8, accent: true }, { h: 'GHI CHÚ', t: 'text', w: 32 }];
    const iXL = cols.findIndex(c => c.h === 'XẾP LOẠI');
    bangDep(wb, 'Đánh giá', {
      title: `BẢNG ĐÁNH GIÁ CHẤT LƯỢNG – NĂNG SUẤT NHÂN VIÊN KHO VẬN ${T}`,
      sub: `Kho vận CN.HCM  ·  Lượt quy đổi = lượt kho + lượt sàn × ${String(res.heSoSan).replace('.', ',')}  ·  Tổng điểm = Năng suất ${cfg.dNS} + Ổn định ${cfg.dOD} + Chất lượng ${cfg.dCL}  ·  A ≥ ${cfg.A}, B ≥ ${cfg.B}, C ≥ ${cfg.C}, D < ${cfg.C}`,
      groups: [{ span: 1 }, { span: 1 }, { span: 1 }, ...(nhieuNhom ? [{ span: 1 }] : []), { label: 'SẢN LƯỢNG', span: 5 }, { label: 'CHỈ SỐ', span: 4 }, { label: 'ĐIỂM THÀNH PHẦN', span: 3 }, { label: 'KẾT QUẢ', span: 2, accent: true }, { span: 1 }],
      cols,
      rows: list.map(r => [r.hangVP || '', r.maNV, r.hoTen, ...(nhieuNhom ? [r.nhom] : []), r1(r.cong), Math.round(r.kho), Math.round(r.san), r1(r.qd), r1(r.tb),
        r.soVoiNhom, r.tyLeDat, r.ngayKhongLuot, r.soLoi, r.dNS, r.dOD, r.dCL, r.diem, r.xepLoai,
        [r.ghiChu, r.soLoi && r.noiDungLoi ? 'Lỗi: ' + r.noiDungLoi : '', r.xepLoai === '—' ? `Chưa đủ ${cfg.congToiThieu} ngày công` : ''].filter(Boolean).join('. ')]),
      muted: i => list[i].xepLoai === '—',
      to: (i, c) => c === iXL ? xlTo(i, list[i].xepLoai) : null,
      total: ['TỔNG / BÌNH QUÂN TỔ', null, null, ...(nhieuNhom ? [null] : []), r1(list.reduce((a, r) => a + r.cong, 0)), Math.round(list.reduce((a, r) => a + r.kho, 0)), Math.round(list.reduce((a, r) => a + r.san, 0)),
        r1(list.reduce((a, r) => a + r.qd, 0)), r1(res.tbTo), null, null, null, list.reduce((a, r) => a + r.soLoi, 0), null, null, null, null, null, ''],
    });
    // 1a) So sánh văn phòng
    const vds = vpCua(res), VS = res.vpStats;
    if (vds.length) bangDep(wb, 'So sánh VP', {
      title: `SO SÁNH NĂNG SUẤT – CHẤT LƯỢNG CÁC VĂN PHÒNG ${T}`,
      sub: `Mỗi văn phòng đánh giá riêng (năng suất so với trung bình văn phòng)  ·  Bình quân = tổng lượt ÷ tổng ngày công của nhân viên được đánh giá  ·  Lượt sàn quy đổi × ${String(res.heSoSan).replace('.', ',')}`,
      groups: [{ span: 1 }, { span: 1 }, { span: 1 }, { label: 'SẢN LƯỢNG THÁNG', span: 3 }, { label: 'BÌNH QUÂN / NGÀY CÔNG', span: 3 }, { label: 'KẾT QUẢ', span: 5, accent: true }, { span: 1 }],
      cols: [{ h: 'STT', t: 'stt', w: 5 }, { h: 'VĂN PHÒNG', t: 'name', w: 18 }, { h: 'SỐ NV', t: 'int', w: 7 }, { h: 'Ngày công', t: 'k1', w: 9 }, { h: 'Lượt kho', t: 'int', w: 10 }, { h: 'Lượt sàn', t: 'int', w: 10 },
        { h: 'Kho', t: 'd1', w: 8 }, { h: 'Sàn', t: 'd1', w: 8 }, { h: 'Quy đổi', t: 'd1', w: 9 }, { h: 'Điểm TB', t: 'd1', w: 8, accent: true }, { h: 'A', t: 'int', w: 5, accent: true }, { h: 'B', t: 'int', w: 5, accent: true }, { h: 'C', t: 'int', w: 5, accent: true }, { h: 'D', t: 'int', w: 5, accent: true }, { h: 'Lỗi CL', t: 'int', w: 7 }],
      rows: vds.map((v, i) => { const x = VS[v]; return [i + 1, v, x.so, r1(x.cong), Math.round(x.kho), Math.round(x.san), r1(x.tbKho), r1(x.tbSan), r1(x.tb), r1(x.diemTB), x.xl.A, x.xl.B, x.xl.C, x.xl.D, x.loi]; }),
    });
    // 1b) Nhận xét từng người theo tiêu chí
    const nxMap = nhanXetThang(ky), MK_FILL = { dat: ['E7F8EF', '065F46'], chua: ['FEF6DC', '92400E'], thieu: ['FDE8E8', '991B1B'] };
    const TC = ['ns', 'od', 'cc', 'cl'], nxCols = [S.stt, S.ma, { h: 'HỌ VÀ TÊN', t: 'name', w: 22 }, { h: 'XẾP LOẠI', t: 'xl', w: 8, accent: true }, { h: 'ĐIỂM', t: 'd1', w: 7, accent: true },
      { h: 'NĂNG SUẤT', t: 'text', w: 30 }, { h: 'ỔN ĐỊNH', t: 'text', w: 32 }, { h: 'CHUYÊN CẦN', t: 'text', w: 28 }, { h: 'CHẤT LƯỢNG', t: 'text', w: 24 },
      { h: 'CẦN KHẮC PHỤC', t: 'text', w: 50 }, { h: 'GHI CHÚ QUẢN LÝ', t: 'text', w: 22 }];
    const nxRows = list.map(r => { const nx = nxMap.get(r.maNV); return [r.hangVP || '', r.maNV, r.hoTen, r.xepLoai, r.diem,
      ...TC.map(m => { const t = nx.tieuChi.find(x => x.ma === m); return t ? `${mkLabel(t)}: ${t.text}` + (t.chiTiet ? t.chiTiet.map(x => `\n– ${x}`).join('') : '') : ''; }),
      nx.khacPhuc.length ? nx.khacPhuc.map((k, i) => `${i + 1}. ${k}`).join('\n') : 'Không có — tiếp tục duy trì.', r.ghiChu || '']; });
    bangDep(wb, 'Nhận xét', {
      title: `NHẬN XÉT ĐÁNH GIÁ NHÂN VIÊN KHO VẬN ${T}`,
      sub: `Năng suất: so với TB nhóm (đạt ≥ 90%)  ·  Ổn định: ngày có công đạt ${cfg.dmNgay} lượt quy đổi (đạt ≥ 90% số ngày)  ·  Chuyên cần: ngày có công phải có lượt quét  ·  Chất lượng: lỗi ghi nhận trong tháng`,
      groups: [{ span: 1 }, { span: 1 }, { span: 1 }, { label: 'KẾT QUẢ', span: 2, accent: true }, { label: 'NHẬN XÉT THEO TIÊU CHÍ', span: 4 }, { span: 1 }, { span: 1 }],
      cols: nxCols, rows: nxRows,
      muted: i => list[i].xepLoai === '—',
      to: (i, c) => {
        if (c === 3) return xlTo(i, list[i].xepLoai);
        if (c >= 5 && c <= 8) { const t = nxMap.get(list[i].maNV).tieuChi.find(x => x.ma === TC[c - 5]); const f = t && MK_FILL[t.muc]; return f ? { fill: f[0], color: f[1] } : null; }
        if (c === 9 && nxMap.get(list[i].maNV).khacPhuc.length) return { color: '92400E' };
        return null;
      },
      // chiều cao dòng theo ô chữ dài nhất (ước lượng số dòng xuống hàng theo độ rộng cột)
      rowH: i => { let n = 1; nxCols.forEach((col, c) => { if (col.t !== 'text') return; const lines = String(nxRows[i][c] || '').split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(l.length / (col.w * 1.1))), 0); n = Math.max(n, lines); }); return Math.max(21, n * 14.5 + 6); },
    });
    // 2) Theo ngày: lượt quy đổi
    const n = new Date(y, m, 0).getDate(), days = Array.from({ length: n }, (_, i) => i + 1);
    bangDep(wb, 'Theo ngày', {
      title: `LƯỢT QUY ĐỔI THEO NGÀY — ${T}`,
      sub: `Ô xanh = đạt định mức ${cfg.dmNgay} lượt / ngày công  ·  ô vàng = dưới định mức  ·  ô đỏ = có công nhưng 0 lượt  ·  ô tím = ngày đóng cặp (lượt chia đôi)`,
      cols: [S.stt, S.ma, { h: 'HỌ VÀ TÊN', t: 'name', w: 24 },
        ...days.map(d => { const w = new Date(y, m - 1, d).getDay(); return { h: `${d}\n${THU[w]}`, t: 'int', w: 5.2, sz: 10, hf: w === 0 ? '6B7F99' : null }; }),
        { h: 'NGÀY CÔNG', t: 'k1', w: 8, accent: true }, { h: 'TỔNG', t: 'int', w: 9, accent: true }, { h: 'TB / NGÀY', t: 'd1', w: 8, accent: true }],
      rows: list.map(r => [r.hangVP || '', r.maNV, r.hoTen, ...r.ngay.map(x => Math.round(x.qd)), r1(r.cong), Math.round(r.qd), r1(r.tb)]),
      muted: i => list[i].xepLoai === '—',
      to: (i, c) => {
        const d = c - 2; if (d < 1 || d > n) return null;
        const x = list[i].ngay[d - 1];
        if (x.cap) return { fill: 'EDE9FE', color: '5B21B6', bold: x.dat };
        if (x.w > 0 && !x.qd) return { fill: 'FEE2E2', color: '991B1B' };
        if (x.qd > 0) return x.dat ? { fill: 'D1FAE5', color: '065F46', bold: true } : { fill: 'FEF3C7', color: '92400E' };
        return null;
      },
      total: ['TỔNG CỘNG', null, null, ...days.map(d => Math.round(list.reduce((a, r) => a + r.ngay[d - 1].qd, 0))), r1(list.reduce((a, r) => a + r.cong, 0)), Math.round(list.reduce((a, r) => a + r.qd, 0)), r1(res.tbTo)],
      kyTen: false,
    });
    // 3) Xu hướng (khi đã có từ 2 tháng)
    const ks = kys().filter(k => k <= ky).slice(-6).map(k => ({ k, r: tinh(k) })).filter(x => x.r && !x.r.loi);
    if (ks.length >= 2) {
      const maps = ks.map(x => new Map(x.r.rows.map(r => [r.maNV, r])));
      const ds = list.filter(r => r.xepLoai !== '—' || maps.some(mm => mm.has(r.maNV)));
      bangDep(wb, 'Xu hướng', {
        title: `XU HƯỚNG TỔNG ĐIỂM ĐÁNH GIÁ ${ks.length} THÁNG GẦN NHẤT`, sub: 'Mỗi ô: tổng điểm tháng đó (màu theo xếp loại A / B / C / D)', kyTen: false,
        cols: [S.stt, S.ma, S.ten, ...ks.map(x => ({ h: DG.kyLabel(x.k), t: 'd1', w: 11 })), { h: 'THAY ĐỔI', t: 'd1', w: 10, accent: true }],
        rows: ds.map(r => { const v = maps.map(mm => mm.get(r.maNV)), sc = v.filter(x => x && x.xepLoai !== '—'); return [r.hang || '', r.maNV, r.hoTen, ...v.map(x => x ? x.diem : ''), sc.length >= 2 ? r1(sc[sc.length - 1].diem - sc[sc.length - 2].diem) : '']; }),
        to: (i, c) => { const j = c - 3; if (j < 0 || j >= ks.length) return null; const x = maps[j].get(ds[i].maNV); return x ? xlTo(i, x.xepLoai) : null; },
      });
    }
    return { wb, fname: `DanhGiaCLNS_${ky}.xlsx` };
  }
  $('dgExport').addEventListener('click', async () => {
    const res = tinh(current()); if (!res || res.loi) return;
    const { wb, fname } = taoExcel();
    try { luuFile(await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []), fname); }
    catch (e) { XLSX.writeFile(wb, fname); }
  });
  // để kiểm thử (không dùng trong giao diện)
  window.__dg = { tinh, archive: () => archive, caiDat: () => caiDat, excel: async () => { const { wb, fname } = taoExcel(); return { fname, bytes: await chinhTrangIn(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), await loadJSZip(), wb.__freeze || [], wb.__fitTall || []) }; } };

  renderAll();
  pullFromRepo();
})();
