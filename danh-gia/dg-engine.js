/* ============================================================================
   Đánh giá chất lượng – năng suất (CL NS) nhân viên kho vận HCM theo THÁNG.
   Nguồn: file kho (giống file Thưởng kho: sheet "Bảng check kiện hàng" + "bảng mã nv")
          và file sàn (giống file Thưởng sàn: các sheet có cột Bốc hàng / Đóng hàng).
   Đếm lượt giống hệt 2 trang thưởng:
     - Kho: Tạo kiện (username) + Bốc hàng + Đóng hàng ("Họ tên (SĐT)"), mỗi dòng 1 lượt.
     - Sàn: Bốc hàng + Đóng hàng.
   Quy đổi để cộng chung: 1 lượt sàn = định mức kho ÷ định mức sàn lượt kho (20/80 = 0,25).
   Đóng cặp (khai ở trang Thưởng kho / Thưởng sàn) được chia đôi y như khi tính thưởng.
   Ngày công lấy từ bảng chấm công (nếu có), không có thì lấy ngày có lượt quét.
   Dùng chung cho trang (window), worker (self) và node (module.exports) để kiểm thử.
   ============================================================================ */
(function (root) {
  'use strict';
  const SHEET_KHO = 'Bảng check kiện hàng';
  const SHEET_MNV = 'bảng mã nv';
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const norm = s => String(s ?? '').trim();
  // giống thuong-kho/engine.js: NFC, bỏ khoảng trắng thừa, không phân biệt hoa/thường, "Thuỳ" = "Thùy"
  const toneFix = s => s.normalize('NFD').replace(/([ou])([̣̀́̃̉])([aey])/g, '$1$3$2').normalize('NFC');
  const key = s => toneFix(String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase());
  const fold = s => String(s ?? '').normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
  const NAME_PHONE_RE = /^(.*?)\s*\([\d\s]+\)\s*$/;
  const parseCreditName = v => { const s = norm(v); if (!s) return null; const m = NAME_PHONE_RE.exec(s); return norm(m ? m[1] : s); };

  // serial Excel -> năm / tháng / ngày / phút trong ngày
  function parts(serial) {
    if (typeof serial !== 'number' || !isFinite(serial) || serial < 1) return null;
    const day = Math.floor(serial), frac = serial - day;
    const d = new Date(EXCEL_EPOCH_MS + day * 86400000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), min: Math.min(1439, Math.round(frac * 1440)), am: frac < 0.5 };
  }
  function findSheet(wb, name) {
    const f = wb.SheetNames.find(n => key(n) === key(name));
    return f ? wb.Sheets[f] : null;
  }
  function header(XLSX, ws) {
    if (!ws || !ws['!ref']) return [];
    const r = XLSX.utils.decode_range(ws['!ref']), out = [];
    for (let c = r.s.c; c <= r.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r: r.s.r, c })]; out.push(norm(cell && cell.v)); }
    return out;
  }
  // Loại file: kho (có sheet "Bảng check kiện hàng" hoặc cột "Người tạo kiện") / sàn (chỉ có Bốc / Đóng hàng)
  function nhanLoai(XLSX, wb) {
    const k = findSheet(wb, SHEET_KHO);
    if (k) return { loai: 'kho', sheets: [k] };
    const raw = wb.SheetNames.map(n => wb.Sheets[n]).filter(s => { const h = header(XLSX, s); return h.includes('Đóng hàng') && h.includes('TG Đóng hàng'); });
    if (!raw.length) return { loai: null, sheets: [] };
    return { loai: raw.some(s => header(XLSX, s).includes('Người tạo kiện')) ? 'kho' : 'san', sheets: raw };
  }

  // "bảng mã nv": A = Mã NV, B = mã trên hệ thống (username hoặc "Họ tên (SĐT)"), D = Họ tên. Mỗi người nhiều dòng.
  function parseMNV(aoa) {
    const list = [], byMa = new Map(), creditKeys = new Map(), nameKeys = new Map(), rows = [];
    for (const r of aoa || []) {
      if (!r) continue;
      const maNV = norm(r[0]), maHT = norm(r[1]), hoTen = norm(r[3]);
      if (!maNV || !hoTen) continue;
      if (/^mã\s*(nv|nhân viên)$/.test(key(maNV)) || /^họ\s*(và\s*)?tên$/.test(key(hoTen))) continue;
      if (!byMa.has(maNV)) { const e = { maNV, hoTen }; byMa.set(maNV, e); list.push(e); }
      if (maHT) creditKeys.set(key(maHT), maNV);
      if (!nameKeys.has(key(hoTen))) nameKeys.set(key(hoTen), maNV);
      rows.push([maNV, maHT, hoTen]);
    }
    return { list, creditKeys, nameKeys, rows };
  }
  // sheet THƯỞNG / THƯỞNG SÀN: A = Mã NV, B = Họ tên, D = Ghi chú
  function parseRoster(XLSX, ws) {
    if (!ws) return null;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const ds = [], notes = {};
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] || [], m = norm(r[0]);
      if (!m || !r[1] || !/\d/.test(m)) continue;
      if (!ds.includes(m)) ds.push(m);
      if (norm(r[3])) notes[m] = norm(r[3]);
    }
    return ds.length ? { ds, notes } : null;
  }

  // Ô ngày của 1 NV: [tạo, bốc, đóng, tạo sáng, bốc sáng, đóng sáng, phút quét đầu, phút quét cuối]
  const TASK = { tao: 0, boc: 1, dong: 2 };

  // Đọc 1 workbook -> lượt theo (tháng, người, ngày). opts.ep = 'kho' | 'san' nếu muốn ép loại file.
  // File sàn không có "bảng mã nv" cũng được — khớp Mã NV lúc tính (ganMa) bằng bảng mã của file kho.
  function docFile(XLSX, wb, fileName, opts) {
    opts = opts || {};
    const nl = nhanLoai(XLSX, wb);
    if (!nl.sheets.length) throw new Error('Không thấy sheet dữ liệu: cần sheet "Bảng check kiện hàng" (file kho) hoặc sheet có cột "Bốc hàng, TG Bốc hàng, Đóng hàng, TG Đóng hàng" (file sàn).');
    const loai = opts.ep || nl.loai;
    const mnvWs = findSheet(wb, SHEET_MNV);
    const mnv = mnvWs ? parseMNV(XLSX.utils.sheet_to_json(mnvWs, { header: 1, raw: true, defval: null })) : null;
    if (mnv && !mnv.list.length) throw new Error('Không đọc được danh sách nhân viên từ sheet "bảng mã nv".');
    const rosterName = ['THƯỞNG SÀN', 'THƯỞNG'].find(n => findSheet(wb, n));
    const roster = rosterName ? parseRoster(XLSX, findSheet(wb, rosterName)) : null;

    // Gộp theo "khóa người" thô ('u:' + username của Tạo kiện, 'c:' + chuỗi "Họ tên (SĐT)" của Bốc/Đóng hàng);
    // khớp ra Mã NV sau (ganMa) — để file sàn dùng được bảng mã nv của file kho thả cùng lúc / nạp sau.
    let rows = [], trungBoQua = 0;
    if (nl.sheets.length === 1) rows = XLSX.utils.sheet_to_json(nl.sheets[0], { defval: null, raw: true });
    else {
      const seen = new Set();
      nl.sheets.forEach(ws => {
        const inSheet = new Set();
        XLSX.utils.sheet_to_json(ws, { defval: null, raw: true }).forEach(r => {
          const k = r['Mã kiện hàng'];
          if (k !== null && k !== undefined && k !== '') { if (seen.has(k)) { trungBoQua++; return; } inSheet.add(k); }
          rows.push(r);
        });
        inSheet.forEach(k => seen.add(k));
      });
    }
    const thang = {};
    function credit(pre, v, serial, t) {
      const s = norm(v); if (!s) return;
      const p = parts(serial); if (!p) return;
      const mk = `${p.y}-${pad2(p.m)}`, k = pre + key(s);
      const T = thang[mk] || (thang[mk] = { raw: {}, goc: {}, luot: 0, ngay: {} });
      if (!T.goc[k]) T.goc[k] = pre === 'c:' ? parseCreditName(s) : s;
      const nv = T.raw[k] || (T.raw[k] = {});
      const a = nv[p.d] || (nv[p.d] = [0, 0, 0, 0, 0, 0, null, null]);
      a[t]++; if (p.am) a[3 + t]++;
      if (a[6] === null || p.min < a[6]) a[6] = p.min;
      if (a[7] === null || p.min > a[7]) a[7] = p.min;
      T.luot++; T.ngay[p.d] = 1;
    }
    rows.forEach(r => {
      if (loai === 'kho') credit('u:', r['Người tạo kiện'], r['Ngày tạo kiện'], TASK.tao);
      credit('c:', r['Bốc hàng'], r['TG Bốc hàng'], TASK.boc);
      credit('c:', r['Đóng hàng'], r['TG Đóng hàng'], TASK.dong);
    });
    Object.values(thang).forEach(T => { T.soNgay = Object.keys(T.ngay).length; delete T.ngay; });
    if (!Object.keys(thang).length) throw new Error('Không có dòng dữ liệu nào có người quét và giờ quét.');
    return {
      loai, loaiNhan: nl.loai, fileName, soDong: rows.length, soSheet: nl.sheets.length, trungBoQua,
      mnvRows: mnv ? mnv.rows : null, roster, rosterSheet: roster ? rosterName : null, thang,
    };
  }

  // Khớp dữ liệu thô 1 tháng ra Mã NV theo bảng mã nv (mảng dòng [Mã NV, mã HT, Họ tên]):
  // Tạo kiện theo username (cột B), Bốc/Đóng theo nguyên chuỗi "Họ tên (SĐT)" (cột B) hoặc Họ tên (cột D).
  function bangMa(rows) {
    const list = [], seen = new Set(), creditKeys = new Map(), nameKeys = new Map();
    (rows || []).forEach(([maNV, maHT, hoTen]) => {
      if (!maNV || !hoTen) return;
      if (!seen.has(maNV)) { seen.add(maNV); list.push({ maNV, hoTen }); }
      if (maHT) creditKeys.set(key(maHT), maNV);
      if (!nameKeys.has(key(hoTen))) nameKeys.set(key(hoTen), maNV);
    });
    return { list, creditKeys, nameKeys };
  }
  function ganMa(T, mnvRows) {
    const bm = bangMa(mnvRows), nv = {}, khongKhop = [];
    if (!T) return { nv, khongKhop, employees: bm.list };
    Object.keys(T.raw).forEach(k => {
      const s = k.slice(2);
      const ma = k.startsWith('u:') ? bm.creditKeys.get(s) : (bm.creditKeys.get(s) || bm.nameKeys.get(key(parseCreditName(s))));
      const days = T.raw[k];
      if (!ma) { let c = 0; Object.values(days).forEach(a => { c += a[0] + a[1] + a[2]; }); khongKhop.push([T.goc[k] || s, c]); return; }
      const o = nv[ma] || (nv[ma] = {});
      Object.keys(days).forEach(d => {
        const a = days[d], b = o[d];
        if (!b) { o[d] = a.slice(); return; }
        for (let i = 0; i < 6; i++) b[i] += a[i];
        if (a[6] !== null && (b[6] === null || a[6] < b[6])) b[6] = a[6];
        if (a[7] !== null && (b[7] === null || a[7] > b[7])) b[7] = a[7];
      });
    });
    khongKhop.sort((a, b) => b[1] - a[1]);
    return { nv, khongKhop, employees: bm.list };
  }
  // tháng nên lưu: từ 8 ngày dữ liệu và ≥ 25% số lượt của tháng nhiều nhất (file tháng hay lẫn vài ngày của tháng kề bên)
  const thangChinh = file => {
    const ks = Object.keys(file.thang), max = Math.max(0, ...ks.map(k => file.thang[k].luot));
    return ks.filter(k => file.thang[k].soNgay >= 8 && file.thang[k].luot >= max * 0.25).sort();
  };

  // ------------------------------------------------------------ chấm công
  // Công 1 ngày theo mã chấm công (giống công thức cột "TG" của trang Chấm công):
  // X = 1; S, C (nửa ngày) và các mã ghép "S/P.c", "C/P.s", "S/Ro.c", "Ro.s/C", "CT.s/C", "C/Ro.s"… = 0,5; còn lại (P, L, Ro, CT, TS, trống) = 0.
  function congNgay(code) {
    const c = fold(code);
    if (!c) return 0;
    if (c === 'x') return 1;
    if (c === 's' || c === 'c') return 0.5;
    if (c === 'x/p.s' || c === 'x/p.c') return 0.5; // mã BCC cũ, trang Chấm công đổi thành C/P.s, S/P.c
    if (c.includes('/')) return c.split('/').some(p => p === 's' || p === 'c' || p === 'x') ? 0.5 : 0;
    return 0;
  }
  // { maNV: [mã ngày 1, ngày 2, ...] } từ JSON 1 tháng của trang Chấm công
  function chamCongMap(sh) {
    if (!sh || !Array.isArray(sh.rows)) return null;
    const out = {};
    sh.rows.forEach(r => { if (r && r.t === 'nv' && r.ma) out[norm(r.ma)] = r.d || []; });
    return Object.keys(out).length ? out : null;
  }

  // ------------------------------------------------------------ tiêu chí (sửa được trên trang)
  const CFG = {
    heSoSan: 0.25,    // 1 lượt sàn = 0,25 lượt kho (định mức thưởng kho 20 ÷ định mức thưởng sàn 80)
    dmNgay: 20,       // định mức 1 ngày công (lượt quy đổi) — thứ Bảy / nửa ngày = một nửa
    dNS: 60,          // điểm tối đa — Năng suất (so với trung bình nhóm)
    nsDinh: 120,      // đạt từ % này của trung bình nhóm trở lên thì đủ điểm năng suất
    dOD: 20,          // điểm tối đa — Ổn định (tỷ lệ ngày công đạt định mức)
    dCL: 20,          // điểm tối đa — Chất lượng (trừ theo lỗi ghi nhận)
    truLoi: 5,        // mỗi lỗi chất lượng trừ
    A: 85, B: 70, C: 55, // ngưỡng xếp loại (tổng điểm ≥)
    congToiThieu: 5,  // dưới số ngày công này: không xếp loại (mới vào / nghỉ dài)
  };
  const merge = c => Object.assign({}, CFG, c || {});
  const r1 = x => Math.round(x * 10) / 10;

  // Chia đôi lượt các ngày đóng cặp (giống thuong-kho/engine.js computeResult) trên bản sao dữ liệu 1 nguồn.
  // adj: { key, maNV1, maNV2, dateFrom, dateTo, buoi?: 'sang'|'chieu' }; ghi "maNV|ngày" đã chia vào daChia.
  // Có chấm công (cc): chỉ chia những buổi CẢ HAI người cùng đi làm (quy tắc đã chốt 10/11/2026 — "để thưởng về
  // đúng người thực hiện"); 1 người nghỉ cả ngày thì ngày đó không chia, nghỉ nửa ngày thì chỉ chia buổi còn lại.
  // info[key] = { chia: [ngày], bo: [[ngày, lý do]], nua: [[ngày, 's'|'c']] }.
  function buoiLam(code) {
    const c = fold(code);
    if (!c) return '';
    if (c === 'x/p.s') return 'c';
    if (c === 'x/p.c') return 's';
    let s = false, ch = false;
    c.split('/').forEach(p => { if (p === 'x') s = ch = true; else if (p === 's') s = true; else if (p === 'c') ch = true; });
    return (s ? 's' : '') + (ch ? 'c' : '');
  }
  function chiaCap(nv, ky, adjs, daChia, cc, info, tenOf) {
    const [y, m] = ky.split('-').map(Number), soNgay = new Date(y, m, 0).getDate();
    (adjs || []).forEach(adj => {
      const inf = adj.key ? (info[adj.key] = info[adj.key] || { chia: [], bo: [], nua: [] }) : null;
      for (let d = 1; d <= soNgay; d++) {
        const k = `${ky}-${pad2(d)}`;
        if (k < adj.dateFrom || k > adj.dateTo) continue;
        let want = adj.buoi === 'sang' ? 's' : adj.buoi === 'chieu' ? 'c' : 'sc';
        if (want === 'sc' && new Date(y, m - 1, d).getDay() === 6) want = 's'; // thứ Bảy chỉ làm buổi sáng
        let both = want, lyDo = '';
        if (cc) {
          [adj.maNV1, adj.maNV2].forEach(u => {
            if (!cc[u]) return; // người ngoài danh sách / không có trong chấm công: coi như có đi làm
            const w = buoiLam(cc[u][d - 1]);
            both = both.split('').filter(h => w.includes(h)).join('');
            if (!w.includes('s') || !w.includes('c')) { if (want.split('').some(h => !w.includes(h))) lyDo += (lyDo ? ', ' : '') + `${tenOf(u)}: ${norm(cc[u][d - 1]) || 'nghỉ'}`; }
          });
        }
        if (!both) { if (inf && !inf.chia.includes(d)) inf.bo.push([d, lyDo || 'nghỉ']); continue; }
        const buoi = both === 'sc' ? '' : both === 's' ? 'sang' : 'chieu';
        if (inf && both !== want && new Date(y, m - 1, d).getDay() !== 6 && !inf.nua.some(x => x[0] === d)) inf.nua.push([d, both, lyDo]);
        const A = [adj.maNV1, adj.maNV2].map(u => {
          nv[u] = nv[u] || {};
          return nv[u][d] = nv[u][d] || [0, 0, 0, 0, 0, 0, null, null];
        });
        const [a, b] = A;
        for (let t = 0; t < 3; t++) {
          const ta = a[t], tb = b[t], sa = a[3 + t], sb = b[3 + t];
          if (buoi === 'sang') { const h = (sa + sb) / 2; a[t] = ta - sa + h; b[t] = tb - sb + h; a[3 + t] = b[3 + t] = h; }
          else if (buoi === 'chieu') { const h = ((ta - sa) + (tb - sb)) / 2; a[t] = sa + h; b[t] = sb + h; }
          else { a[t] = b[t] = (ta + tb) / 2; a[3 + t] = b[3 + t] = (sa + sb) / 2; }
        }
        if (inf && !inf.chia.includes(d)) inf.chia.push(d);
        daChia.add(`${adj.maNV1}|${d}`); daChia.add(`${adj.maNV2}|${d}`);
      }
    });
  }
  const saoChep = nv => { const o = {}; Object.keys(nv || {}).forEach(u => { o[u] = {}; Object.keys(nv[u]).forEach(d => { o[u][d] = nv[u][d].slice(); }); }); return o; };

  // Tính bảng đánh giá 1 tháng.
  // src: { kho: {nv: {maNV: {ngày: ô}}} | null, san: ... } (đã khớp Mã NV bằng ganMa)
  // o: { nv: [{maNV, hoTen}], chon: Set|null (chỉ đánh giá những mã này), nhom: {maNV: tên nhóm},
  //      cap: {kho: [adj], san: [adj]}, cc: {maNV: [mã ngày]} | null, loi: {maNV: {so, ghiChu}}, cfg }
  const NHOM_MD = 'Kho vận HCM';
  function tinhThang(ky, src, o) {
    o = o || {};
    const cfg = merge(o.cfg), heSoSan = Number(cfg.heSoSan) || 0;
    const [y, m] = ky.split('-').map(Number), soNgay = new Date(y, m, 0).getDate();
    const kho = saoChep(src.kho && src.kho.nv), san = saoChep(src.san && src.san.nv);
    const trongThang = list => (list || []).filter(a => a.dateFrom <= `${ky}-31` && a.dateTo >= `${ky}-01`);
    const capK = trongThang(o.cap && o.cap.kho), capS = trongThang(o.cap && o.cap.san);
    const capKho = new Set(), capSan = new Set(), capInfo = {};
    const cc = o.cc || null, loi = o.loi || {}, nhomOf = u => (o.nhom && o.nhom[u]) || NHOM_MD;
    const ten = new Map((o.nv || []).map(e => [e.maNV, e.hoTen]));
    const tenNgan = u => { const t = ten.get(u) || (o.tenKhac && o.tenKhac[u]) || u; return String(t).trim().split(/\s+/).slice(-2).join(' '); };
    chiaCap(kho, ky, capK, capKho, cc, capInfo, tenNgan);
    chiaCap(san, ky, capS, capSan, cc, capInfo, tenNgan);
    const coLuot = u => [kho[u], san[u]].some(x => x && Object.values(x).some(a => a[0] + a[1] + a[2] > 0));
    const ids = [...new Set([...Object.keys(kho), ...Object.keys(san)])].filter(u => ten.has(u) && coLuot(u));
    const thu = d => new Date(y, m - 1, d).getDay();
    const rows = ids.map(u => {
      const ccRow = cc && cc[u] ? cc[u] : null;
      const ngay = [];
      let cong = 0, ngayLuot = 0, ngayKhongLuot = 0, ngayDat = 0, ngayTinh = 0, ngayThem = 0, maxQd = 0, gioDau = 0, gioCuoi = 0, soGio = 0;
      const tong = { tao: 0, bocK: 0, dongK: 0, bocS: 0, dongS: 0, kho: 0, san: 0, qd: 0 };
      for (let d = 1; d <= soNgay; d++) {
        const a = (kho[u] && kho[u][d]) || null, b = (san[u] && san[u][d]) || null;
        const k = a ? a[0] + a[1] + a[2] : 0, s = b ? b[1] + b[2] : 0, qd = k + s * heSoSan;
        let w = ccRow ? congNgay(ccRow[d - 1]) : (qd > 0 ? (thu(d) === 6 ? 0.5 : 1) : 0);
        let them = false;
        if (qd > 0 && w === 0) { w = thu(d) === 6 ? 0.5 : 1; them = true; ngayThem++; } // có quét vào ngày nghỉ / CN / chấm phép
        const t0 = [a && a[6], b && b[6]].filter(x => x !== null && x !== undefined), t1 = [a && a[7], b && b[7]].filter(x => x !== null && x !== undefined);
        const dau = t0.length ? Math.min(...t0) : null, cuoi = t1.length ? Math.max(...t1) : null;
        if (a) { tong.tao += a[0]; tong.bocK += a[1]; tong.dongK += a[2]; }
        if (b) { tong.bocS += b[1]; tong.dongS += b[2]; }
        tong.kho += k; tong.san += s; tong.qd += qd;
        cong += w;
        const dat = w > 0 && qd >= cfg.dmNgay * w - 1e-9;
        if (w > 0) { ngayTinh++; if (dat) ngayDat++; if (qd === 0) ngayKhongLuot++; }
        if (qd > 0) {
          ngayLuot++; maxQd = Math.max(maxQd, qd);
          if (dau !== null) { gioDau += dau; gioCuoi += cuoi; soGio++; }
        }
        ngay.push({ d, w, k, s, qd, dat, them, dau, cuoi, kd: a ? [a[0], a[1], a[2]] : null, sd: b ? [b[1], b[2]] : null, cap: capKho.has(`${u}|${d}`) || capSan.has(`${u}|${d}`), ma: ccRow ? norm(ccRow[d - 1]) : '' });
      }
      const tb = cong > 0 ? tong.qd / cong : 0, tbKho = cong > 0 ? tong.kho / cong : 0, tbSan = cong > 0 ? tong.san / cong : 0;
      const l = loi[u] || {};
      return {
        maNV: u, hoTen: ten.get(u), nhom: nhomOf(u), ngay, cong, coCC: !!ccRow, ngayLuot, ngayKhongLuot, ngayDat, ngayTinh, ngayThem, maxQd,
        ...tong, tb, tbKho, tbSan, tyLeDat: ngayTinh ? ngayDat / ngayTinh : 0,
        gioDau: soGio ? gioDau / soGio : null, gioCuoi: soGio ? gioCuoi / soGio : null,
        soNgayCap: ngay.filter(x => x.cap).length, soLoi: Math.max(0, Number(l.so) || 0), noiDungLoi: l.noiDung || '', ghiChu: l.ghiChu || '',
      };
    });
    const chon = o.chon ? rows.filter(r => o.chon.has(r.maNV)) : rows;
    // Ngày ít đơn của cả tổ (kiểm kê, ít hàng…): bình quân lượt / công của những người có công hôm đó < 50% ngày
    // bình thường (trung vị các ngày) → không tính ngày đó vào Ổn định / Chuyên cần của ai (không phải lỗi cá nhân).
    const binhQuan = [];
    for (let i = 0; i < soNgay; i++) {
      let q = 0, w = 0, n = 0;
      chon.forEach(r => { const x = r.ngay[i]; if (x.w > 0) { q += x.qd; w += x.w; n++; } });
      binhQuan.push(n >= 3 && w ? q / w : null);
    }
    const bqs = binhQuan.filter(v => v !== null).sort((a, b) => a - b);
    const trungVi = bqs.length ? bqs[Math.floor((bqs.length - 1) / 2)] : 0;
    const ngayIt = [];
    binhQuan.forEach((v, i) => { if (v !== null && trungVi > 0 && v < trungVi * 0.5) ngayIt.push(i + 1); });
    rows.forEach(r => {
      r.ngayTinh = r.ngayDat = r.ngayKhongLuot = 0;
      r.ngay.forEach(x => {
        x.it = ngayIt.includes(x.d);
        if (x.w > 0 && !x.it) { r.ngayTinh++; if (x.dat) r.ngayDat++; if (x.qd === 0) r.ngayKhongLuot++; }
      });
      r.tyLeDat = r.ngayTinh ? r.ngayDat / r.ngayTinh : 0;
      r.ngayIt = ngayIt;
    });
    // trung bình nhóm = tổng lượt quy đổi ÷ tổng ngày công của những người trong nhóm đủ ngày công tối thiểu
    const nhom = {};
    chon.forEach(r => {
      const g = nhom[r.nhom] || (nhom[r.nhom] = { ten: r.nhom, so: 0, qd: 0, kho: 0, san: 0, cong: 0, tb: 0 });
      g.so++;
      if (r.cong >= cfg.congToiThieu) { g.qd += r.qd; g.kho += r.kho; g.san += r.san; g.cong += r.cong; }
    });
    // riêng từng mảng: kho HCM (truyền thống) và sàn — lượt / ngày công của nhóm
    Object.values(nhom).forEach(g => { g.tb = g.cong ? g.qd / g.cong : 0; g.tbKho = g.cong ? g.kho / g.cong : 0; g.tbSan = g.cong ? g.san / g.cong : 0; });
    const tatCaDu = chon.filter(r => r.cong >= cfg.congToiThieu);
    const congTo = tatCaDu.reduce((a, r) => a + r.cong, 0);
    const tbTo = congTo ? tatCaDu.reduce((a, r) => a + r.qd, 0) / congTo : 0;
    chon.forEach(r => {
      r.tbNhom = nhom[r.nhom].tb; r.tbKhoNhom = nhom[r.nhom].tbKho; r.tbSanNhom = nhom[r.nhom].tbSan;
      r.soVoiNhom = r.tbNhom ? r.tb / r.tbNhom : 0;
      r.dNS = r1(cfg.dNS * Math.min(1, r.soVoiNhom / (cfg.nsDinh / 100)));
      r.dOD = r1(cfg.dOD * r.tyLeDat);
      r.dCL = r1(Math.max(0, cfg.dCL - r.soLoi * cfg.truLoi));
      r.diem = r1(r.dNS + r.dOD + r.dCL);
      r.xepLoai = r.cong < cfg.congToiThieu ? '—' : r.diem >= cfg.A ? 'A' : r.diem >= cfg.B ? 'B' : r.diem >= cfg.C ? 'C' : 'D';
    });
    const xep = [...chon].filter(r => r.xepLoai !== '—').sort((a, b) => b.diem - a.diem || b.tb - a.tb);
    xep.forEach((r, i) => { r.hang = i + 1; });
    // tổng theo ngày (những người được đánh giá)
    const theoNgay = Array.from({ length: soNgay }, (_, i) => {
      const d = i + 1; let k = 0, s = 0, nguoi = 0;
      chon.forEach(r => { const x = r.ngay[i]; k += x.k; s += x.s; if (x.qd > 0) nguoi++; });
      return { d, thu: thu(d), k, s, qd: k + s * heSoSan, nguoi };
    });
    return { ky, cfg, heSoSan, rows: chon, tatCa: rows, nhom, tbTo, soXep: xep.length, theoNgay, capInfo, ngayIt,
      coKho: !!src.kho, coSan: !!src.san, coCC: !!cc, capKho: capK.length, capSan: capS.length };
  }

  // ------------------------------------------------------------ nhận xét tự động từng tiêu chí
  // Trả về { tieuChi: [{ ma, ten, muc: 'dat'|'chua'|'thieu'|'tt', text, khacPhuc? }], dat: [...], khacPhuc: [...], tomTat }
  // muc: dat = đạt, chua = chưa đạt (nhẹ), thieu = không đạt / thiếu nhiều, tt = chỉ để tham khảo.
  // ctx: { cfg, ky, gio: { nhóm: { dau, cuoi } } (giờ quét đầu / cuối trung vị của nhóm), prev: dòng tháng trước | null }
  const vn1 = x => (Math.round((x || 0) * 10) / 10).toLocaleString('vi-VN', { maximumFractionDigits: 1 });
  const hhmm = m => m === null || m === undefined ? '–' : `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const pc = x => Math.round((x || 0) * 100) + '%';
  function dsNgay(list, mo) {
    const a = [...list].sort((x, y) => x - y), out = [];
    for (let i = 0; i < a.length; i++) { let j = i; while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++; out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`); i = j; }
    return out.join(', ') + '/' + mo;
  }
  function nhanXet(r, ctx) {
    const cfg = merge(ctx && ctx.cfg), mo = ctx && ctx.ky ? Number(ctx.ky.slice(5)) : '';
    const tc = [];
    // 1) Năng suất — so với trung bình nhóm; ghi riêng từng mảng: Kho HCM (truyền thống) và Sàn (lượt / ngày công)
    const s = r.soVoiNhom, can = r.tbNhom * 0.9, hs = Number(cfg.heSoSan) || 0;
    const mang = (ten, tb, tbN, tong) => !tong ? `${ten}: không có lượt trong tháng` : `${ten}: ${vn1(tb)} lượt/ngày công (TB nhóm ${vn1(tbN)}${tbN ? ', bằng ' + pc(tb / tbN) : ''})`;
    const chiTiet = [mang('Kho HCM (truyền thống)', r.tbKho, r.tbKhoNhom, r.kho),
      mang('Sàn', r.tbSan, r.tbSanNhom, r.san) + (r.san && hs ? ` = ${vn1(r.tbSan * hs)} lượt quy đổi` : '')];
    const tong = `${vn1(r.tb)} lượt quy đổi/ngày công (kho + sàn × ${String(hs).replace('.', ',')})`;
    if (!r.tbNhom) tc.push({ ma: 'ns', ten: 'Năng suất', muc: 'tt', text: 'Chưa đủ dữ liệu nhóm để so sánh.', chiTiet });
    else if (s >= 1.1) tc.push({ ma: 'ns', ten: 'Năng suất', muc: 'dat', text: `Cao: tổng ${tong}, hơn TB nhóm ${Math.round((s - 1) * 100)}% (nhóm ${vn1(r.tbNhom)}).`, chiTiet });
    else if (s >= 0.9) tc.push({ ma: 'ns', ten: 'Năng suất', muc: 'dat', text: `Đạt: tổng ${tong}, ngang TB nhóm (${vn1(r.tbNhom)}, ${pc(s)}).`, chiTiet });
    else {
      const thieu = Math.ceil(can - r.tb);
      // mảng nào đang thấp hơn so với nhóm
      const ty = [['kho', r.tbKhoNhom ? r.tbKho / r.tbKhoNhom : null], ['sàn', r.tbSanNhom ? r.tbSan / r.tbSanNhom : null]].filter(x => x[1] !== null).sort((a, b) => a[1] - b[1]);
      tc.push({ ma: 'ns', ten: 'Năng suất', muc: s >= 0.7 ? 'chua' : 'thieu', chiTiet,
        text: `${s >= 0.7 ? 'Chưa đạt' : 'Thấp'}: tổng ${tong}, chỉ bằng ${pc(s)} TB nhóm (${vn1(r.tbNhom)}).`,
        khacPhuc: `Tăng sản lượng thêm khoảng ${thieu} lượt quy đổi/ngày công (≈ ${thieu} lượt kho${hs ? ` hoặc ${Math.ceil(thieu / hs)} lượt sàn` : ''}) để đạt tối thiểu 90% TB nhóm (${vn1(can)})`
          + (ty.length ? `; mảng ${ty[0][0]} đang thấp nhất (${pc(ty[0][1])} TB nhóm).` : '.') });
    }
    // 2) Ổn định — ngày có công đạt định mức
    const duoi = r.ngay.filter(x => x.w > 0 && x.qd > 0 && !x.dat && !x.it).map(x => x.d);
    const it = (r.ngayIt || []).length ? ` (không tính ngày ít đơn của cả tổ: ${dsNgay(r.ngayIt, mo)})` : '';
    if (!r.ngayTinh) tc.push({ ma: 'od', ten: 'Ổn định', muc: 'tt', text: 'Không có ngày công.' });
    else if (r.tyLeDat >= 0.9) tc.push({ ma: 'od', ten: 'Ổn định', muc: 'dat', text: `Đều: ${r.ngayDat}/${r.ngayTinh} ngày đạt định mức ${cfg.dmNgay} lượt${duoi.length ? ` (dưới định mức: ${dsNgay(duoi, mo)})` : ''}${it}.` });
    else tc.push({ ma: 'od', ten: 'Ổn định', muc: r.tyLeDat >= 0.7 ? 'chua' : 'thieu',
      text: `${r.tyLeDat >= 0.7 ? 'Chưa đều' : 'Không đều'}: chỉ ${r.ngayDat}/${r.ngayTinh} ngày (${pc(r.tyLeDat)}) đạt ${cfg.dmNgay} lượt${duoi.length ? `; ngày có quét nhưng dưới định mức: ${dsNgay(duoi, mo)}` : ''}${it}.`,
      khacPhuc: `Giữ sản lượng đều mỗi ngày, tối thiểu ${cfg.dmNgay} lượt quy đổi / ngày công (nửa ngày ${cfg.dmNgay / 2}).` });
    // 3) Chuyên cần — có công mà không có lượt quét
    const khong = r.ngay.filter(x => x.w > 0 && x.qd === 0 && !x.it).map(x => x.d);
    if (!khong.length) tc.push({ ma: 'cc', ten: 'Chuyên cần', muc: 'dat', text: `Ngày nào có công cũng có lượt quét${r.ngayThem ? `; làm thêm ${r.ngayThem} ngày nghỉ / CN` : ''}.` });
    else tc.push({ ma: 'cc', ten: 'Chuyên cần', muc: khong.length >= 3 ? 'thieu' : 'chua',
      text: `${khong.length} ngày có công nhưng 0 lượt quét (${dsNgay(khong, mo)}).`,
      khacPhuc: `Giải trình ${khong.length} ngày có công không có lượt quét (${dsNgay(khong, mo)}) — nếu làm việc khác (kiểm kê, nhập hàng…) thì ghi vào Ghi chú đánh giá.` });
    // 4) Chất lượng — lỗi ghi nhận tay
    if (!r.soLoi) tc.push({ ma: 'cl', ten: 'Chất lượng', muc: 'dat', text: 'Không ghi nhận lỗi trong tháng.' });
    else tc.push({ ma: 'cl', ten: 'Chất lượng', muc: r.soLoi >= 2 ? 'thieu' : 'chua',
      text: `${r.soLoi} lỗi${r.noiDungLoi ? ': ' + r.noiDungLoi : ''} (trừ ${r.soLoi * cfg.truLoi} điểm).`,
      khacPhuc: `Khắc phục lỗi${r.noiDungLoi ? ' “' + r.noiDungLoi + '”' : ''}: kiểm tra kỹ mã hàng, số lượng, lô / hạn dùng trước khi đóng kiện.` });
    // 5) Giờ làm (tham khảo) — giờ quét đầu / cuối so với trung vị của nhóm
    const g = ctx && ctx.gio && ctx.gio[r.nhom];
    if (r.gioDau === null || !g) tc.push({ ma: 'gio', ten: 'Giờ làm', muc: 'tt', text: 'Không có giờ quét.' });
    else {
      const muon = r.gioDau - g.dau >= 60, som = g.cuoi - r.gioCuoi >= 60;
      const t = `Quét TB từ ${hhmm(r.gioDau)} đến ${hhmm(r.gioCuoi)} (nhóm ${hhmm(g.dau)}–${hhmm(g.cuoi)})`;
      if (!muon && !som) tc.push({ ma: 'gio', ten: 'Giờ làm', muc: 'dat', text: t + '.' });
      else tc.push({ ma: 'gio', ten: 'Giờ làm', muc: 'chua', text: t + (muon ? ' — bắt đầu muộn' : '') + (som ? (muon ? ', ' : ' — ') + 'kết thúc sớm' : '') + '.',
        khacPhuc: `Xem lại ${muon ? 'việc buổi sáng (lượt quét đầu tiên muộn hơn nhóm khoảng ' + vn1((r.gioDau - g.dau) / 60) + ' giờ)' : ''}${muon && som ? ' và ' : ''}${som ? 'việc cuối ngày (ngừng quét sớm hơn nhóm)' : ''} — nếu làm việc khác thì ghi chú lại.` });
    }
    // 6) So với tháng trước (tham khảo)
    const p = ctx && ctx.prev;
    if (p && p.tb && r.cong >= cfg.congToiThieu && p.cong >= cfg.congToiThieu) {
      const dt = (r.tb - p.tb) / p.tb, dd = r.diem - p.diem;
      const t = `Sản lượng/ngày ${dt >= 0 ? 'tăng' : 'giảm'} ${Math.abs(Math.round(dt * 100))}% (${vn1(p.tb)} → ${vn1(r.tb)}), điểm ${dd >= 0 ? '+' : '−'}${vn1(Math.abs(dd))} (${p.xepLoai} → ${r.xepLoai}).`;
      tc.push({ ma: 'xh', ten: 'So tháng trước', muc: dd <= -5 || dt <= -0.15 ? 'chua' : 'dat', text: t,
        ...(dd <= -5 || dt <= -0.15 ? { khacPhuc: `Tìm nguyên nhân sản lượng / điểm giảm so với tháng trước.` } : {}) });
    } else tc.push({ ma: 'xh', ten: 'So tháng trước', muc: 'tt', text: p ? 'Tháng trước chưa đủ ngày công để so.' : 'Chưa có tháng trước để so.' });
    const TEN = { ns: 'năng suất', od: 'ổn định', cc: 'chuyên cần', cl: 'chất lượng', gio: 'giờ làm', xh: 'tiến bộ' };
    const dat = tc.filter(x => x.muc === 'dat' && x.ma !== 'xh' && x.ma !== 'gio').map(x => TEN[x.ma]);
    const kp = tc.filter(x => x.khacPhuc).map(x => x.khacPhuc);
    const xl = r.xepLoai === '—' ? `Chưa xếp loại (dưới ${cfg.congToiThieu} ngày công)` : `Xếp loại ${r.xepLoai} (${vn1(r.diem)} điểm, hạng ${r.hang || '–'})`;
    const tomTat = `${xl}. ${dat.length ? 'Đạt: ' + dat.join(', ') + '.' : 'Chưa đạt tiêu chí nào.'}${kp.length ? ` Cần khắc phục ${kp.length} điểm.` : ' Không có điểm cần khắc phục.'}`
      + (r.soNgayCap ? ` Có ${r.soNgayCap} ngày đóng cặp (lượt đã chia đôi).` : '');
    return { tieuChi: tc, dat, khacPhuc: kp, tomTat };
  }
  // giờ quét đầu / cuối trung vị của từng nhóm (để so "bắt đầu muộn / kết thúc sớm")
  function gioNhom(rows) {
    const med = a => { const b = a.filter(x => x !== null && x !== undefined).sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : null; };
    const out = {};
    [...new Set(rows.map(r => r.nhom))].forEach(n => { const rs = rows.filter(r => r.nhom === n); out[n] = { dau: med(rs.map(r => r.gioDau)), cuoi: med(rs.map(r => r.gioCuoi)) }; });
    return out;
  }

  const kyLabel = ky => { const [y, m] = ky.split('-'); return `Tháng ${Number(m)}/${y}`; };
  const quyCua = ky => { const [y, m] = ky.split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}`; };
  const DG = { CFG, NHOM_MD, buoiLam, nhanXet, gioNhom, docFile, ganMa, bangMa, thangChinh, tinhThang, congNgay, chamCongMap, kyLabel, quyCua, pad2, fold, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = DG;
  root.DG = DG;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
