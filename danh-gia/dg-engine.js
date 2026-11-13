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
  // adj: { maNV1, maNV2, dateFrom, dateTo, buoi?: 'sang'|'chieu' }; trả về Set "maNV|ngày" đã chia.
  function chiaCap(nv, ky, adjs, daChia) {
    const [y, m] = ky.split('-').map(Number), soNgay = new Date(y, m, 0).getDate();
    (adjs || []).forEach(adj => {
      for (let d = 1; d <= soNgay; d++) {
        const k = `${ky}-${pad2(d)}`;
        if (k < adj.dateFrom || k > adj.dateTo) continue;
        const A = [adj.maNV1, adj.maNV2].map(u => {
          nv[u] = nv[u] || {};
          return nv[u][d] = nv[u][d] || [0, 0, 0, 0, 0, 0, null, null];
        });
        const [a, b] = A;
        for (let t = 0; t < 3; t++) {
          const ta = a[t], tb = b[t], sa = a[3 + t], sb = b[3 + t];
          if (adj.buoi === 'sang') { const h = (sa + sb) / 2; a[t] = ta - sa + h; b[t] = tb - sb + h; a[3 + t] = b[3 + t] = h; }
          else if (adj.buoi === 'chieu') { const h = ((ta - sa) + (tb - sb)) / 2; a[t] = sa + h; b[t] = sb + h; }
          else { a[t] = b[t] = (ta + tb) / 2; a[3 + t] = b[3 + t] = (sa + sb) / 2; }
        }
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
    const capKho = new Set(), capSan = new Set();
    chiaCap(kho, ky, capK, capKho);
    chiaCap(san, ky, capS, capSan);
    const cc = o.cc || null, loi = o.loi || {}, nhomOf = u => (o.nhom && o.nhom[u]) || NHOM_MD;
    const ten = new Map((o.nv || []).map(e => [e.maNV, e.hoTen]));
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
      const tb = cong > 0 ? tong.qd / cong : 0;
      const l = loi[u] || {};
      return {
        maNV: u, hoTen: ten.get(u), nhom: nhomOf(u), ngay, cong, coCC: !!ccRow, ngayLuot, ngayKhongLuot, ngayDat, ngayTinh, ngayThem, maxQd,
        ...tong, tb, tyLeDat: ngayTinh ? ngayDat / ngayTinh : 0,
        gioDau: soGio ? gioDau / soGio : null, gioCuoi: soGio ? gioCuoi / soGio : null,
        soNgayCap: ngay.filter(x => x.cap).length, soLoi: Math.max(0, Number(l.so) || 0), noiDungLoi: l.noiDung || '', ghiChu: l.ghiChu || '',
      };
    });
    const chon = o.chon ? rows.filter(r => o.chon.has(r.maNV)) : rows;
    // trung bình nhóm = tổng lượt quy đổi ÷ tổng ngày công của những người trong nhóm đủ ngày công tối thiểu
    const nhom = {};
    chon.forEach(r => {
      const g = nhom[r.nhom] || (nhom[r.nhom] = { ten: r.nhom, so: 0, qd: 0, cong: 0, tb: 0 });
      g.so++;
      if (r.cong >= cfg.congToiThieu) { g.qd += r.qd; g.cong += r.cong; }
    });
    Object.values(nhom).forEach(g => { g.tb = g.cong ? g.qd / g.cong : 0; });
    const tatCaDu = chon.filter(r => r.cong >= cfg.congToiThieu);
    const congTo = tatCaDu.reduce((a, r) => a + r.cong, 0);
    const tbTo = congTo ? tatCaDu.reduce((a, r) => a + r.qd, 0) / congTo : 0;
    chon.forEach(r => {
      r.tbNhom = nhom[r.nhom].tb;
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
    return { ky, cfg, heSoSan, rows: chon, tatCa: rows, nhom, tbTo, soXep: xep.length, theoNgay,
      coKho: !!src.kho, coSan: !!src.san, coCC: !!cc, capKho: capK.length, capSan: capS.length };
  }

  const kyLabel = ky => { const [y, m] = ky.split('-'); return `Tháng ${Number(m)}/${y}`; };
  const quyCua = ky => { const [y, m] = ky.split('-').map(Number); return `${y}-Q${Math.ceil(m / 3)}`; };
  const DG = { CFG, NHOM_MD, docFile, ganMa, bangMa, thangChinh, tinhThang, congNgay, chamCongMap, kyLabel, quyCua, pad2, fold, key };
  if (typeof module !== 'undefined' && module.exports) module.exports = DG;
  root.DG = DG;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
