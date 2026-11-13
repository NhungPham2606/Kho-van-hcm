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
  const LS_KEY = 'kvh-danhgia-v1', LS_CFG = 'kvh-danhgia-caidat', LS_SEL = 'kvh-danhgia-sel', TOKEN_KEY = 'kvh-gh-token';
  const VER = '20261113a';
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
  let sel = ''; try { sel = localStorage.getItem(LS_SEL) || ''; } catch (e) {}
  let token = ''; try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  const repoSha = {};
  let syncMsg = token ? 'Đang đồng bộ với hệ thống…' : 'Chưa kết nối hệ thống — dữ liệu chỉ lưu trên trình duyệt của máy này (kết nối ở Báo cáo giao hàng → Cập nhật dữ liệu).';
  const saveTimers = {};

  function persistLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(archive)); } catch (e) { syncMsg = 'Bộ nhớ trình duyệt đầy — chưa lưu được trên máy này.'; }
    try { localStorage.setItem(LS_CFG, JSON.stringify(caiDat)); } catch (e) {}
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
      for (const it of items.filter(i => /^(\d{4}-\d{2}|cai-dat)\.json$/.test(i.name))) {
        const name = it.name.replace('.json', '');
        repoSha[name] = it.sha;
        const meta = await gh(`/contents/${DIR}/${it.name}?ref=main`);
        const remote = JSON.parse(b64dec(meta.content || '') || '{}');
        if (name === 'cai-dat') { if ((remote.savedAt || '') >= (caiDat.savedAt || '')) caiDat = Object.assign(CAI_DAT_MD(), remote); }
        else if (!archive[name] || (remote.savedAt || '') >= (archive[name].savedAt || '')) archive[name] = remote;
      }
      Object.keys(archive).forEach(k => { if (!repoSha[k]) scheduleSave(k, 0); });
      if (!repoSha['cai-dat'] && caiDat.savedAt) scheduleSave('cai-dat', 0);
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
      const data = name === 'cai-dat' ? caiDat : archive[name];
      if (!data) return;
      try {
        const body = { message: `${DIR} ${name} (tu web)`, content: b64enc(JSON.stringify(data)), branch: 'main' };
        if (repoSha[name]) body.sha = repoSha[name];
        const r = await gh(`/contents/${DIR}/${name}.json`, { method: 'PUT', body: JSON.stringify(body) });
        repoSha[name] = r.content.sha;
        syncMsg = `Đã lưu ${name === 'cai-dat' ? 'tiêu chí / danh sách' : DG.kyLabel(name)} lên hệ thống lúc ${new Date().toLocaleTimeString('vi-VN')}.`;
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

  // ------------------------------------------------------------ tính
  const memo = new Map();
  function tinh(ky) {
    if (!ky || !archive[ky]) return null;
    if (memo.has(ky)) return memo.get(ky);
    const e = archive[ky], mnv = mnvFor(ky);
    if (!mnv) { const r = { loi: 'Chưa có bảng mã nv để khớp tên — thả kèm file kho (có sheet "bảng mã nv").' }; memo.set(ky, r); return r; }
    const K = e.kho ? DG.ganMa(e.kho.raw, mnv.rows) : null, S = e.san ? DG.ganMa(e.san.raw, mnv.rows) : null;
    const employees = DG.bangMa(mnv.rows).list, roster = rosterFor(ky);
    const chon = new Set(employees.map(x => x.maNV).filter(u => caiDat.chon[u] !== undefined ? caiDat.chon[u] : (roster ? roster.has(u) : true)));
    const sh = caiDat.dungCC !== false ? ccOf(ky) : null;
    const cap = caiDat.dungCap !== false ? { kho: capOf(ky, 'tk'), san: capOf(ky, 'ts') } : {};
    const res = DG.tinhThang(ky, { kho: K, san: S }, { nv: employees, chon, nhom: caiDat.nhom, cap, cc: sh ? DG.chamCongMap(sh) : null, loi: e.loi || {}, cfg: caiDat.cfg });
    Object.assign(res, { mnvNguon: mnv.nguon, khongKhopKho: K ? K.khongKhop : [], roster, ccTen: sh && res.coCC ? sh.ten : '' });
    memo.set(ky, res);
    return res;
  }
  const kys = () => Object.keys(archive).filter(k => KY_RE.test(k)).sort();
  const current = () => archive[sel] ? sel : (kys().slice(-1)[0] || '');
  const prevKy = ky => { const [y, m] = ky.split('-').map(Number), d = new Date(y, m - 2, 1); const k = `${d.getFullYear()}-${DG.pad2(d.getMonth() + 1)}`; return archive[k] ? k : ''; };
  const cfgNow = () => Object.assign({}, DG.CFG, caiDat.cfg || {});

  // ------------------------------------------------------------ giao diện
  const TABS = ['bang-danh-gia', 'dashboard', 'theo-ngay', 'xu-huong', 'chat-luong', 'danh-sach', 'nap-du-lieu', 'tieu-chi'];
  const tab = () => { const h = location.hash.slice(1); if (!kys().length && h !== 'tieu-chi') return 'nap-du-lieu'; return TABS.includes(h) ? h : 'bang-danh-gia'; };
  let search = '', tnMode = 'qd', pending = [], busy = false;
  const match = r => !search || fold(r.hoTen).includes(search) || String(r.maNV).includes(search);
  const sortHang = list => [...list].sort((a, b) => (a.hang || 1e9) - (b.hang || 1e9) || b.tb - a.tb || a.hoTen.localeCompare(b.hoTen, 'vi'));

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
      parts.push(caiDat.dungCap === false ? 'Đóng cặp: đã tắt' : `Đóng cặp: ${res.capKho} kho · ${res.capSan} sàn`);
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
      <div class="tk-stat"><div class="l">Bình quân tổ / ngày công</div><div class="v">${n1(res.tbTo)}</div><div class="s">lượt quy đổi${Object.keys(res.nhom).length > 1 ? ' · ' + Object.values(res.nhom).map(g => `${esc(g.ten)} ${n1(g.tb)}`).join(' · ') : ''}</div></div>
      <div class="tk-stat"><div class="l">Lượt kho</div><div class="v">${num(tong('kho'))}</div><div class="s">tạo kiện ${num(tong('tao'))} · bốc ${num(tong('bocK'))} · đóng ${num(tong('dongK'))}</div></div>
      <div class="tk-stat"><div class="l">Lượt sàn</div><div class="v">${num(tong('san'))}</div><div class="s">bốc ${num(tong('bocS'))} · đóng ${num(tong('dongS'))} (= ${num(tong('san') * res.heSoSan)} quy đổi)</div></div>
      <div class="tk-stat"><div class="l">Xếp loại</div><div class="xl">${['A', 'B', 'C', 'D'].map(x => `${xlBadge(x)} <b>${cnt(x)}</b>`).join(' &nbsp;')}</div><div class="s">${cnt('—') ? cnt('—') + ' người chưa đủ ngày công' : '&nbsp;'}</div></div>`;
  }

  function renderTabs() {
    const t = tab();
    root.querySelectorAll('#dgTabs [data-tab]').forEach(a => a.classList.toggle('on', a.dataset.tab === t));
    root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
    $('dgSearchBox').hidden = ['nap-du-lieu', 'tieu-chi', 'dashboard'].includes(t);
    $('dgStats').hidden = $('dgStats').hidden || ['nap-du-lieu', 'tieu-chi'].includes(t);
  }

  const emptyRow = (n, text) => `<tr><td colspan="${n}" style="text-align:center;color:#9ca3af;padding:24px">${text}</td></tr>`;
  function noData(res) { return !res ? 'Chưa có dữ liệu — nạp file ở mục <a href="#nap-du-lieu">Nạp file tháng</a>.' : res.loi ? esc(res.loi) : ''; }

  // ---- Bảng đánh giá
  function renderBang() {
    const ky = current(), res = tinh(ky), cfg = cfgNow();
    $('bgHead').innerHTML = `<tr><th class="c">Hạng</th><th>Mã NV</th><th>Họ và tên</th><th class="c">Xếp loại</th><th class="r">Tổng điểm</th><th class="r">So tháng trước</th>
      <th class="r">Năng suất<small>/${cfg.dNS}</small></th><th class="r">Ổn định<small>/${cfg.dOD}</small></th><th class="r">Chất lượng<small>/${cfg.dCL}</small></th>
      <th>Nhóm</th><th class="r">Ngày công</th><th class="r">Lượt kho</th><th class="r">Lượt sàn</th><th class="r">Quy đổi</th><th class="r">TB / ngày công</th>
      <th class="r">So TB nhóm</th><th class="r">Ngày đạt ĐM</th><th class="r">Có công<small>không lượt</small></th><th class="r">Lỗi CL</th></tr>`;
    if (!res || res.loi) { $('bgBody').innerHTML = emptyRow(19, noData(res)); $('bgFoot').innerHTML = ''; return; }
    const pk = prevKy(ky), prev = pk ? tinh(pk) : null, pm = new Map(prev && !prev.loi ? prev.rows.map(r => [r.maNV, r]) : []);
    const list = sortHang(res.rows).filter(match);
    $('bgBody').innerHTML = list.map(r => {
      const p = pm.get(r.maNV), d = p && p.xepLoai !== '—' && r.xepLoai !== '—' ? r.diem - p.diem : null;
      const cmp = d === null ? '<span class="muted">–</span>' : `<span class="${d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'muted'}">${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '='} ${n1(Math.abs(d))}</span> <span class="muted">(${esc(p.xepLoai)})</span>`;
      const congTip = r.coCC ? 'Theo bảng chấm công' : 'Không có trong chấm công — tính theo ngày có lượt quét';
      return `<tr class="${r.xepLoai === '—' ? 'muted' : ''}">
        <td class="c bold">${r.hang || '–'}</td><td>${esc(r.maNV)}</td>
        <td class="name">${esc(r.hoTen)}${r.soNgayCap ? `<span class="chip cap" title="Có ${r.soNgayCap} ngày đóng cặp — lượt đã chia đôi">cặp ${r.soNgayCap}n</span>` : ''}${r.ngayThem ? `<span class="chip" title="${r.ngayThem} ngày có quét vào ngày nghỉ / CN / chấm phép — đã tính thêm công">+${r.ngayThem} ngày</span>` : ''}</td>
        <td class="c">${xlBadge(r.xepLoai)}</td><td class="r bold" style="color:#1a56db">${n1(r.diem)}</td><td class="r">${cmp}</td>
        <td class="r">${n1(r.dNS)}</td><td class="r">${n1(r.dOD)}</td><td class="r">${n1(r.dCL)}</td>
        <td>${esc(r.nhom)}</td>
        <td class="r" title="${congTip}">${nSmart(r.cong)}${r.coCC ? '' : '<span class="muted">*</span>'}</td>
        <td class="r" title="Tạo kiện ${num(r.tao)} · Bốc ${num(r.bocK)} · Đóng ${num(r.dongK)}">${num(r.kho)}</td>
        <td class="r" title="Bốc ${num(r.bocS)} · Đóng ${num(r.dongS)}">${num(r.san)}</td>
        <td class="r">${num(r.qd)}</td><td class="r bold">${n1(r.tb)}</td>
        <td class="r" title="Trung bình nhóm ${esc(r.nhom)}: ${n1(r.tbNhom)}">${pct(r.soVoiNhom)}</td>
        <td class="r" title="${r.ngayDat}/${r.ngayTinh} ngày có công đạt ${cfg.dmNgay} lượt quy đổi">${pct(r.tyLeDat)}</td>
        <td class="r${r.ngayKhongLuot >= 3 ? ' bold' : ''}" style="${r.ngayKhongLuot >= 3 ? 'color:#991b1b' : ''}">${r.ngayKhongLuot || '–'}</td>
        <td class="r" title="${esc(r.noiDungLoi)}">${r.soLoi || '–'}</td></tr>`;
    }).join('') || emptyRow(19, 'Không có ai khớp tìm kiếm.');
    $('bgFoot').innerHTML = `Tổng điểm = <b>Năng suất</b> (đạt ${cfg.nsDinh}% trung bình nhóm = đủ ${cfg.dNS}đ) + <b>Ổn định</b> (tỷ lệ ngày có công đạt ${cfg.dmNgay} lượt quy đổi × ${cfg.dOD}) + <b>Chất lượng</b> (${cfg.dCL} − ${cfg.truLoi}/lỗi). `
      + `Xếp loại A ≥ ${cfg.A} · B ≥ ${cfg.B} · C ≥ ${cfg.C} · D dưới ${cfg.C}. Lượt quy đổi = lượt kho + lượt sàn × ${String(res.heSoSan).replace('.', ',')}. `
      + `<span class="muted">*</span> = không có trong chấm công, ngày công theo ngày có lượt quét. Rê chuột lên số để xem chi tiết. Xem cách tính / sửa ở mục <a href="#tieu-chi">Tiêu chí</a>.`
      + (pk ? '' : ' Chưa có tháng trước để so sánh.');
  }

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
        const t = `Ngày ${x.d}/${m} (${THU[new Date(y, m - 1, x.d).getDay()]}) · công ${nSmart(x.w)}${x.ma ? ' (mã ' + x.ma + ')' : r.coCC ? '' : ' (theo ngày có lượt)'}${x.them ? ' — quét vào ngày nghỉ, tính thêm công' : ''}`
          + (x.kd ? `\nKho ${nSmart(x.k)}: tạo kiện ${nSmart(x.kd[0])} · bốc ${nSmart(x.kd[1])} · đóng ${nSmart(x.kd[2])}` : '')
          + (x.sd ? `\nSàn ${nSmart(x.s)}: bốc ${nSmart(x.sd[0])} · đóng ${nSmart(x.sd[1])} (= ${nSmart(x.s * res.heSoSan)} quy đổi)` : '')
          + (x.qd ? `\nQuy đổi ${nSmart(x.qd)} / định mức ${nSmart(cfg.dmNgay * x.w)} · quét ${hm(x.dau)}–${hm(x.cuoi)}` : '')
          + (x.cap ? '\nNgày đóng cặp: lượt đã chia đôi' : '');
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
    const ids = [...people.keys()].sort((a, b) => ((lastMap.get(a) || {}).hang || 1e9) - ((lastMap.get(b) || {}).hang || 1e9) || people.get(a).localeCompare(people.get(b), 'vi'));
    $('xhBody').innerHTML = ids.filter(u => match({ maNV: u, hoTen: people.get(u) })).map(u => {
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
    if (!res || res.loi) { $('dsBody').innerHTML = emptyRow(9, noData(res)); $('dsFoot').innerHTML = ''; return; }
    const chon = new Set(res.rows.map(r => r.maNV));
    const list = [...res.tatCa].sort((a, b) => (chon.has(b.maNV) - chon.has(a.maNV)) || a.nhom.localeCompare(b.nhom, 'vi') || a.hoTen.localeCompare(b.hoTen, 'vi')).filter(match);
    const nhoms = [...new Set([DG.NHOM_MD, ...Object.values(caiDat.nhom || {}), 'Đóng gói', 'Soạn hàng'])];
    $('dsNhom').innerHTML = nhoms.map(g => `<option value="${esc(g)}">`).join('');
    $('dsBody').innerHTML = list.map(r => `<tr data-ma="${esc(r.maNV)}" class="${chon.has(r.maNV) ? '' : 'muted'}">
      <td class="c"><input type="checkbox" data-k="chon"${chon.has(r.maNV) ? ' checked' : ''}></td><td>${esc(r.maNV)}</td><td class="name">${esc(r.hoTen)}</td>
      <td><input type="text" data-k="nhom" list="dsNhom" value="${esc(caiDat.nhom[r.maNV] || '')}" placeholder="${esc(DG.NHOM_MD)}" style="width:170px"></td>
      <td class="r">${nSmart(r.cong)}</td><td class="r">${num(r.kho)}</td><td class="r">${num(r.san)}</td><td class="r">${n1(r.tb)}</td>
      <td>${res.roster ? (res.roster.has(r.maNV) ? 'Có' : '<span class="muted">Không</span>') : '<span class="muted">(file không có sheet THƯỞNG)</span>'}</td></tr>`).join('') || emptyRow(9, 'Không có ai khớp tìm kiếm.');
    const kk = (res.khongKhopKho || []).filter(([n]) => !/^(adminit|online|system|admin)$/i.test(n));
    $('dsFoot').innerHTML = `Khớp tên bằng ${esc(res.mnvNguon)}. Ai không có trong bảng mã nv thì không hiện ở đây.`
      + (kk.length ? ` <details style="margin-top:6px"><summary style="cursor:pointer;color:#1a56db">${kk.length} tên trong file kho không khớp bảng mã nv (thường là kho Đà Nẵng / người ngoài) — bấm để soát</summary><div style="column-width:260px;margin-top:6px">${kk.slice(0, 40).map(([n, c]) => `<div>${esc(n)} — ${num(c)} lượt</div>`).join('')}</div></details>` : '');
  }
  $('dsBody').addEventListener('change', ev => {
    const inp = ev.target.closest('[data-k]'), tr = ev.target.closest('[data-ma]'); if (!inp || !tr) return;
    const ma = tr.dataset.ma;
    if (inp.dataset.k === 'chon') caiDat.chon[ma] = inp.checked;
    else { const v = inp.value.trim(); if (v && v !== DG.NHOM_MD) caiDat.nhom[ma] = v; else delete caiDat.nhom[ma]; }
    touchCfg(); renderAll();
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
      const e = archive[k], sh = ccOf(k), ck = capOf(k, 'tk').filter(a => a.dateFrom <= k + '-31' && a.dateTo >= k + '-01').length, cs = capOf(k, 'ts').filter(a => a.dateFrom <= k + '-31' && a.dateTo >= k + '-01').length;
      const src = x => x ? `${esc(x.fileName)}<br><span class="muted">${num(x.raw.luot)} lượt · nạp ${x.napLuc ? new Date(x.napLuc).toLocaleDateString('vi-VN') : ''}</span>` : '<span style="color:#b45309">chưa nạp</span>';
      return `<tr><td class="name"><a href="#bang-danh-gia" data-ky="${k}">${DG.kyLabel(k)}</a></td><td>${src(e.kho)}</td><td>${src(e.san)}</td>
        <td>${sh ? esc(sh.ten || 'Có') : '<span class="muted">chưa có</span>'}</td><td>${ck} cặp kho · ${cs} cặp sàn</td>
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
  function renderAll(skipCL) {
    memo.clear();
    renderTop(); renderStats(); renderTabs();
    renderBang(); renderDash(); renderNgay(); renderXu();
    if (!skipCL) renderCL();
    renderDS(); renderNap(); renderCfg();
  }
  $('dgChips').addEventListener('click', e => { const b = e.target.closest('[data-ky]'); if (!b) return; sel = b.dataset.ky; persistLocal(); renderAll(); });
  $('dgSearch').addEventListener('input', e => { search = fold(e.target.value); renderBang(); renderNgay(); renderXu(); renderCL(); renderDS(); });
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
    const S = { stt: { h: 'HẠNG', t: 'stt', w: 6 }, ma: { h: 'MÃ NV', t: 'ma', w: 9 }, ten: { h: 'HỌ VÀ TÊN', t: 'name', w: 26 } };
    const nhieuNhom = Object.keys(res.nhom).length > 1;
    const xlTo = (i, v) => XL_FILL[v] ? { fill: XL_FILL[v][0], color: XL_FILL[v][1], bold: true } : null;
    // 1) Bảng đánh giá
    const cols = [S.stt, S.ma, S.ten, ...(nhieuNhom ? [{ h: 'NHÓM', t: 'text', w: 14 }] : []),
      { h: 'Ngày công', t: 'k1', w: 8 }, { h: 'Lượt kho', t: 'int', w: 9 }, { h: 'Lượt sàn', t: 'int', w: 9 }, { h: 'Lượt quy đổi', t: 'k1', w: 10 }, { h: 'TB / ngày công', t: 'd1', w: 9 },
      { h: 'So với TB nhóm', t: 'pct', w: 9 }, { h: 'Ngày đạt định mức', t: 'pct', w: 9 }, { h: 'Có công không lượt', t: 'int', w: 8 }, { h: 'Số lỗi CL', t: 'int', w: 7 },
      { h: `Năng suất (${cfg.dNS})`, t: 'd1', w: 9 }, { h: `Ổn định (${cfg.dOD})`, t: 'd1', w: 9 }, { h: `Chất lượng (${cfg.dCL})`, t: 'd1', w: 9 },
      { h: 'TỔNG ĐIỂM', t: 'd1', w: 9, accent: true }, { h: 'XẾP LOẠI', t: 'xl', w: 8, accent: true }, { h: 'GHI CHÚ', t: 'text', w: 32 }];
    const iXL = cols.findIndex(c => c.h === 'XẾP LOẠI');
    bangDep(wb, 'Đánh giá', {
      title: `BẢNG ĐÁNH GIÁ CHẤT LƯỢNG – NĂNG SUẤT NHÂN VIÊN KHO VẬN ${T}`,
      sub: `Kho vận CN.HCM  ·  Lượt quy đổi = lượt kho + lượt sàn × ${String(res.heSoSan).replace('.', ',')}  ·  Tổng điểm = Năng suất ${cfg.dNS} + Ổn định ${cfg.dOD} + Chất lượng ${cfg.dCL}  ·  A ≥ ${cfg.A}, B ≥ ${cfg.B}, C ≥ ${cfg.C}, D < ${cfg.C}`,
      groups: [{ span: 1 }, { span: 1 }, { span: 1 }, ...(nhieuNhom ? [{ span: 1 }] : []), { label: 'SẢN LƯỢNG', span: 5 }, { label: 'CHỈ SỐ', span: 4 }, { label: 'ĐIỂM THÀNH PHẦN', span: 3 }, { label: 'KẾT QUẢ', span: 2, accent: true }, { span: 1 }],
      cols,
      rows: list.map(r => [r.hang || '', r.maNV, r.hoTen, ...(nhieuNhom ? [r.nhom] : []), r1(r.cong), Math.round(r.kho), Math.round(r.san), r1(r.qd), r1(r.tb),
        r.soVoiNhom, r.tyLeDat, r.ngayKhongLuot, r.soLoi, r.dNS, r.dOD, r.dCL, r.diem, r.xepLoai,
        [r.ghiChu, r.soLoi && r.noiDungLoi ? 'Lỗi: ' + r.noiDungLoi : '', r.xepLoai === '—' ? `Chưa đủ ${cfg.congToiThieu} ngày công` : ''].filter(Boolean).join('. ')]),
      muted: i => list[i].xepLoai === '—',
      to: (i, c) => c === iXL ? xlTo(i, list[i].xepLoai) : null,
      total: ['TỔNG / BÌNH QUÂN TỔ', null, null, ...(nhieuNhom ? [null] : []), r1(list.reduce((a, r) => a + r.cong, 0)), Math.round(list.reduce((a, r) => a + r.kho, 0)), Math.round(list.reduce((a, r) => a + r.san, 0)),
        r1(list.reduce((a, r) => a + r.qd, 0)), r1(res.tbTo), null, null, null, list.reduce((a, r) => a + r.soLoi, 0), null, null, null, null, null, ''],
    });
    // 2) Theo ngày: lượt quy đổi
    const n = new Date(y, m, 0).getDate(), days = Array.from({ length: n }, (_, i) => i + 1);
    bangDep(wb, 'Theo ngày', {
      title: `LƯỢT QUY ĐỔI THEO NGÀY — ${T}`,
      sub: `Ô xanh = đạt định mức ${cfg.dmNgay} lượt / ngày công  ·  ô vàng = dưới định mức  ·  ô đỏ = có công nhưng 0 lượt  ·  ô tím = ngày đóng cặp (lượt chia đôi)`,
      cols: [S.stt, S.ma, { h: 'HỌ VÀ TÊN', t: 'name', w: 24 },
        ...days.map(d => { const w = new Date(y, m - 1, d).getDay(); return { h: `${d}\n${THU[w]}`, t: 'int', w: 5.2, sz: 10, hf: w === 0 ? '6B7F99' : null }; }),
        { h: 'NGÀY CÔNG', t: 'k1', w: 8, accent: true }, { h: 'TỔNG', t: 'int', w: 9, accent: true }, { h: 'TB / NGÀY', t: 'd1', w: 8, accent: true }],
      rows: list.map(r => [r.hang || '', r.maNV, r.hoTen, ...r.ngay.map(x => Math.round(x.qd)), r1(r.cong), Math.round(r.qd), r1(r.tb)]),
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
