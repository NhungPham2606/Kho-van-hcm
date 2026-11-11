/* ============================================================================
   Thưởng quý Giao hàng (GH) — dựng lại đúng cách tính của file "GIAO HÀNG QUÝ 2.2026.xlsx"
   (đã đối chiếu từng ngày với sheet "Chi tiết thưởng quý 2": 766/766 ngày khớp).

   Đầu vào (3 loại file, đọc trong worker):
   1. Danh sách check kiện hàng (giao hàng): Mã kiện hàng, Mã các đơn hàng, Khách hàng, Người nhận hàng,
      Nguời giao hàng, Thời gian trả Check, Địa điểm trả Check, Phương tiện, Quãng đường
      (+ Đối tác vận chuyển nếu đã có sẵn).
   2. Bảng check kiện hàng (đóng kiện): Mã kiện hàng → Đối tác vận chuyển (thay cho VLOOKUP tay).
   3. Đơn ngoài giờ: bảng chấm giao hàng ngoài giờ (cột "Mã Hóa Đơn/Mã đơn hàng") hoặc danh sách tự ghép
      (cột "Mã các đơn hàng"); so theo mã đơn gốc (bỏ đuôi .1/.2 và -KM).

   Quy tắc:
   - Chỉ đơn có đối tác chứa "trực tiếp" (Giao hàng Trực Tiếp, … HCM/CT/TN, GIAO TRỰC TIẾP VP KHÁNH HÒA…),
     không đi Ô tô, không phải đơn ngoài giờ, ngày trả (Thời gian trả Check) thuộc quý.
   - Quãng đường > 200 km (GPS lỗi) = trung bình km (≤ 200) cùng Địa điểm trả Check → cùng Khách hàng →
     cùng người giao (như cột AD của file mẫu).
   - Trùng điểm giao: cùng người giao + cùng Khách hàng, trả cách lần trước ≤ 15 phút → không cộng km.
   - Trùng đơn: cùng người giao + cùng Người nhận hàng, trả cách lần trước ≤ 10 phút → không đếm đơn.
   - Mỗi người mỗi ngày: thưởng đơn = (số đơn − 8) × 10.000đ nếu > 8; thưởng KM = (km − 40) × 1.000đ nếu > 40.
   - Thưởng quý = CỘNG DỒN các ngày trong quý (không chia trung bình); tổng = thưởng đơn + thưởng KM.
   Dùng chung cho trang (window), worker (self) và kiểm tra bằng Node.
   ============================================================================ */
(function (root) {
  'use strict';
  // Địa điểm trả Check là kho / văn phòng công ty → dòng đó không tính thưởng (yêu cầu 11/11/2026). Sửa được trên trang.
  const DIEM_LOAI_TRU = [
    '30, Hàn Mặc Tử, Thành phố Hồ Chí Minh, Hồ Chí Minh',
    '21/2, Hàn Mặc Tử, Thành phố Hồ Chí Minh, Hồ Chí Minh',
    '15, Hàn Mặc Tử, Thành phố Hồ Chí Minh, Hồ Chí Minh',
    '26, Hàn Mặc Tử, Thành phố Hồ Chí Minh, Hồ Chí Minh',
    'Đường Cộng Hòa 3, P. Phú Thọ Hòa, P. Phú Thọ Hòa, Thành Phố Hồ Chí Minh',
    'Đường Số 8, P. Hưng Phú, P. Hưng Phú, Thành Phố Cần Thơ',
    'Đường Số 94, P. Nam Nha Trang, P. Nam Nha Trang, Khánh Hòa',
    'Đường Số 10, P. Hưng Phú, P. Hưng Phú, Thành Phố Cần Thơ',
    '75, Phạm Văn Nhờ, Cái Răng, Cần Thơ',
    'P. Tân An, P. Tân An, Đắk Lắk',
    'P. Buôn Ma Thuột, P. Buôn Ma Thuột, Đắk Lắk',
  ];
  const RULES = { donNguong: 8, donGia: 10000, kmNguong: 40, kmGia: 1000, trungDonPhut: 10, trungDiemPhut: 15, kmMax: 200, diemLoaiTru: DIEM_LOAI_TRU };
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const norm = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  // so khớp không phân biệt hoa/thường + 2 kiểu đặt dấu (Thuỳ = Thùy) — giống so sánh của Excel
  const toneFix = s => s.normalize('NFD').replace(/([ou])([̣̀́̃̉])([aey])/g, '$1$3$2').normalize('NFC');
  const key = s => toneFix(norm(s).toLowerCase());
  const fold = s => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  // so địa chỉ: không dấu, không phân biệt hoa thường, bỏ khác biệt khoảng trắng quanh dấu phẩy / dấu chấm cuối
  const diaChiKey = s => fold(s).replace(/\s*,\s*/g, ', ').replace(/[\s,.]+$/, '');
  // Mã đơn gốc: "DH010426/55088.1-KM" → "DH010426/55088"
  const baseCode = c => String(c).trim().toUpperCase().replace(/\.\d+(-KM)?$/, '').replace(/-KM$/, '').trim();
  const splitCodes = s => norm(s).split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).map(baseCode);
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
  const toMs = v => (typeof v === 'number' && isFinite(v)) ? EXCEL_EPOCH + Math.round(v * 86400000) : null;
  const dayKey = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
  const monthKey = ms => dayKey(ms).slice(0, 7);

  // Tìm dòng tiêu đề trong 100 dòng đầu: trả về chỉ số dòng + vị trí cột theo tên đã fold.
  function findHeader(aoa, need) {
    for (let r = 0; r < Math.min(aoa.length, 100); r++) {
      const row = aoa[r] || [], idx = {};
      row.forEach((v, c) => { const f = fold(v); if (f && !(f in idx)) idx[f] = c; });
      if (need.every(n => (Array.isArray(n) ? n.some(x => x in idx) : n in idx))) return { r, idx };
    }
    return null;
  }
  const col = (idx, ...names) => { for (const n of names) if (n in idx) return idx[n]; return -1; };
  const sheetAoa = (XLSX, ws) => XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });

  // Mã NV ↔ Họ tên: sheet "mã nv" (A mã, B tên, không tiêu đề) hoặc bảng có cột Mã Nhân Viên/Mã NV + Họ và tên.
  function collectNames(XLSX, wb, out) {
    wb.SheetNames.forEach(n => {
      const aoa = sheetAoa(XLSX, wb.Sheets[n]);
      if (fold(n) === 'ma nv') aoa.forEach(r => { if (r && /^\d{4,}$/.test(norm(r[0])) && norm(r[1])) out[key(r[1])] = { maNV: norm(r[0]), hoTen: norm(r[1]) }; });
      const h = findHeader(aoa, [['ma nhan vien', 'ma nv'], ['ho va ten', 'ho ten']]);
      if (!h) return;
      const cm = col(h.idx, 'ma nhan vien', 'ma nv'), ct = col(h.idx, 'ho va ten', 'ho ten');
      for (let r = h.r + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        if (/^\d{4,}$/.test(norm(row[cm])) && norm(row[ct]) && !out[key(row[ct])]) out[key(row[ct])] = { maNV: norm(row[cm]), hoTen: norm(row[ct]) };
      }
    });
  }

  // Danh sách nhân viên được tính thưởng quý (file người dùng thả vào ô 4 hoặc tab Danh sách):
  // bảng có cột Họ và tên / Họ tên / Tên nhân viên / Nhân viên / Người giao hàng (+ Mã NV nếu có),
  // hoặc kiểu sheet "mã nv" của file quý 2 (cột A mã, cột B tên, không có tiêu đề).
  function collectRoster(XLSX, wb, list) {
    const seen = new Set(list.map(p => key(p.hoTen)));
    let n = 0;
    const push = (ma, ten) => {
      ten = norm(ten);
      if (!ten || /^(tong|total|stt)\b/.test(fold(ten)) || seen.has(key(ten))) return;
      seen.add(key(ten)); list.push({ maNV: /^\d{3,}$/.test(norm(ma)) ? norm(ma) : '', hoTen: ten }); n++;
    };
    wb.SheetNames.forEach(s => {
      const aoa = sheetAoa(XLSX, wb.Sheets[s]);
      const h = findHeader(aoa, [['ho va ten', 'ho ten', 'ten nhan vien', 'nhan vien', 'nguoi giao hang', 'nguoi giao hang']]);
      if (h) {
        const ct = col(h.idx, 'ho va ten', 'ho ten', 'ten nhan vien', 'nhan vien', 'nguoi giao hang'), cm = col(h.idx, 'ma nhan vien', 'ma nv');
        for (let r = h.r + 1; r < aoa.length; r++) { const row = aoa[r] || []; if (row[ct] != null && isNaN(Number(row[ct]))) push(cm >= 0 ? row[cm] : '', row[ct]); }
      } else {
        aoa.forEach(r => { if (r && /^\d{3,}$/.test(norm(r[0])) && r[1] != null && isNaN(Number(r[1]))) push(r[0], r[1]); });
      }
    });
    return n;
  }

  const GIAO_NEED = [['nguoi giao hang'], 'thoi gian tra check', 'quang duong', 'ma kien hang'];
  // 1) File giao hàng: sheet có đủ cột, lấy sheet nhiều dòng nhất.
  function parseGiaoHang(XLSX, wb) {
    let best = null;
    wb.SheetNames.forEach(n => {
      const aoa = sheetAoa(XLSX, wb.Sheets[n]), h = findHeader(aoa, GIAO_NEED);
      if (h && (!best || aoa.length - h.r > best.aoa.length - best.h.r)) best = { n, aoa, h };
    });
    if (!best) return null;
    const { aoa, h } = best, ix = h.idx;
    const c = {
      kien: col(ix, 'ma kien hang'), don: col(ix, 'ma cac don hang'), kh: col(ix, 'khach hang'), nhan: col(ix, 'nguoi nhan hang'),
      nv: col(ix, 'nguoi giao hang'), tra: col(ix, 'thoi gian tra check'), diem: col(ix, 'dia diem tra check'),
      pt: col(ix, 'phuong tien'), km: col(ix, 'quang duong'), dt: col(ix, 'doi tac van chuyen'),
    };
    const rows = [];
    for (let r = h.r + 1; r < aoa.length; r++) {
      const x = aoa[r];
      if (!x || x[c.kien] == null || x[c.kien] === '') continue;
      rows.push({
        kien: norm(x[c.kien]), codes: c.don >= 0 ? splitCodes(x[c.don]) : [], kh: norm(x[c.kh]), nhan: c.nhan >= 0 ? norm(x[c.nhan]) : '',
        nv: norm(x[c.nv]), t: toMs(x[c.tra]), diem: c.diem >= 0 ? norm(x[c.diem]) : '', pt: c.pt >= 0 ? norm(x[c.pt]) : '',
        km: typeof x[c.km] === 'number' ? x[c.km] : (parseFloat(x[c.km]) || 0), dt: c.dt >= 0 ? norm(x[c.dt]) : null,
      });
    }
    return { sheet: best.n, rows };
  }

  // 2) File kiện hàng: Mã kiện hàng → Đối tác vận chuyển (bỏ qua sheet là danh sách giao hàng).
  function parseKien(XLSX, wb, map) {
    let n = 0;
    wb.SheetNames.forEach(s => {
      const aoa = sheetAoa(XLSX, wb.Sheets[s]), h = findHeader(aoa, ['ma kien hang', 'doi tac van chuyen']);
      if (!h || 'thoi gian tra check' in h.idx) return;
      const ck = h.idx['ma kien hang'], cd = h.idx['doi tac van chuyen'];
      for (let r = h.r + 1; r < aoa.length; r++) {
        const x = aoa[r]; if (!x || x[ck] == null) continue;
        const k = norm(x[ck]); if (!(k in map)) { map[k] = norm(x[cd]); n++; }
      }
    });
    return n;
  }

  // 3) Đơn ngoài giờ: cột "Mã Hóa Đơn/Mã đơn hàng" (bảng chấm ngoài giờ) hoặc "Mã các đơn hàng" của sheet
  //    KHÔNG phải danh sách giao hàng (không có cột Quãng đường).
  //    Bảng chấm có cột "ĐẠT/KO ĐẠT": dòng "Không"/"KO ĐẠT" = KHÔNG được trả ngoài giờ → đơn đó vẫn tính thưởng
  //    giao hàng (yêu cầu 11/11/2026). Chỉ dòng Đạt (hoặc để trống) mới bị trừ. Danh sách tự ghép không có cột
  //    này thì trừ hết.
  const isKhongDat = v => /^(khong|ko)\b/.test(fold(v));
  function parseNgoaiGio(XLSX, wb, set, khong) {
    let n = 0;
    wb.SheetNames.forEach(s => {
      const aoa = sheetAoa(XLSX, wb.Sheets[s]);
      let h = findHeader(aoa, ['ma hoa don/ma don hang']), c = h ? h.idx['ma hoa don/ma don hang'] : -1, cs = -1;
      if (h) cs = Object.keys(h.idx).filter(k => /(ko|khong) dat/.test(k)).map(k => h.idx[k])[0] ?? -1;
      else {
        h = findHeader(aoa, ['ma cac don hang']);
        if (!h || 'quang duong' in h.idx) return;
        c = h.idx['ma cac don hang'];
      }
      for (let r = h.r + 1; r < aoa.length; r++) {
        const x = aoa[r]; if (!x || !x[c]) continue;
        if (cs >= 0 && isKhongDat(x[cs])) { if (khong) splitCodes(x[c]).forEach(k => khong.add(k)); continue; }
        splitCodes(x[c]).forEach(k => { if (!set.has(k)) { set.add(k); n++; } });
      }
    });
    return n;
  }

  // Đọc từng file một (worker đọc xong file nào bỏ workbook đó ngay cho nhẹ máy), rồi finish().
  function newAcc() {
    return { giao: [], giaoSheets: [], kienMap: {}, kienCount: 0, ng: new Set(), khong: new Set(), names: {}, roster: [], files: { giao: [], kien: [], ngoai: [], ds: [] }, warnings: [], giaoFiles: 0 };
  }
  function parseOne(XLSX, slot, name, wb, acc) {
    if (slot === 'giao') {
      acc.files.giao.push(name);
      const g = parseGiaoHang(XLSX, wb);
      if (!g) { acc.warnings.push(`"${name}": không thấy bảng giao hàng (cần cột Người giao hàng, Thời gian trả Check, Quãng đường, Mã kiện hàng)`); return; }
      acc.giaoFiles++;
      acc.giaoSheets.push(`${name} › ${g.sheet}`);
      g.rows.forEach(r => { r.f = acc.giaoFiles; acc.giao.push(r); });
      // file tổng hợp kiểu quý 2: có sẵn sheet đơn ngoài giờ / mã nv thì dùng luôn
      parseNgoaiGio(XLSX, wb, acc.ng, acc.khong); collectNames(XLSX, wb, acc.names);
    } else if (slot === 'kien') {
      acc.files.kien.push(name);
      const n = parseKien(XLSX, wb, acc.kienMap);
      if (!n) acc.warnings.push(`"${name}": không thấy cột Mã kiện hàng + Đối tác vận chuyển`);
      acc.kienCount += n;
    } else if (slot === 'ds') {
      acc.files.ds.push(name);
      if (!collectRoster(XLSX, wb, acc.roster)) acc.warnings.push(`"${name}": không thấy danh sách nhân viên (cần cột Họ và tên, hoặc kiểu sheet "mã nv")`);
      collectNames(XLSX, wb, acc.names);
    } else {
      acc.files.ngoai.push(name);
      const n = parseNgoaiGio(XLSX, wb, acc.ng, acc.khong);
      if (!n) acc.warnings.push(`"${name}": không thấy cột Mã Hóa Đơn/Mã đơn hàng hoặc Mã các đơn hàng`);
      collectNames(XLSX, wb, acc.names);
    }
  }
  function finish(acc) {
    // Ghép nhiều file giao hàng: kiện + thời điểm trả đã có ở file trước thì bỏ (trong cùng 1 file giữ nguyên)
    if (acc.giaoFiles > 1) {
      const seen = new Map();
      acc.giao = acc.giao.filter(r => { const k = r.kien + '|' + r.t; if (seen.has(k) && seen.get(k) !== r.f) return false; seen.set(k, r.f); return true; });
    }
    acc.giao.forEach(r => { delete r.f; });
    // mã vừa có dòng Đạt vừa có dòng Không đạt → coi là đã trả ngoài giờ (vẫn trừ)
    const khongDat = [...acc.khong].filter(k => !acc.ng.has(k));
    const out = Object.assign({}, acc, { ngoaiGio: [...acc.ng], khongDat });
    delete out.ng; delete out.khong; delete out.giaoFiles;
    return out;
  }
  // Đọc cả 3 nhóm file (mỗi phần tử: { name, wb }) — dùng khi kiểm tra bằng Node.
  function parseFiles(XLSX, groups) {
    const acc = newAcc();
    ['giao', 'kien', 'ngoai', 'ds'].forEach(s => (groups[s] || []).forEach(f => parseOne(XLSX, s, f.name, f.wb, acc)));
    return finish(acc);
  }

  // Đánh dấu người có trong danh sách tính thưởng (theo tên hoặc Mã NV); người trong danh sách mà không có
  // dòng giao hàng nào trong quý vẫn được thêm (thưởng 0). Không có danh sách = tất cả đều tính.
  function markRoster(nhanVien, roster) {
    if (!roster.length) { nhanVien.forEach(p => { p.trongDS = true; }); return; }
    const byKey = {}, byMa = {};
    roster.forEach(r => { byKey[key(r.hoTen)] = r; if (r.maNV) byMa[r.maNV] = r; });
    const used = new Set();
    nhanVien.forEach(p => {
      const r = byKey[key(p.nv)] || (p.maNV && byMa[p.maNV]);
      p.trongDS = !!r;
      if (r) { used.add(r); if (!p.maNV && r.maNV) p.maNV = r.maNV; }
    });
    roster.forEach(r => { if (!used.has(r)) nhanVien.push({ nv: r.hoTen, maNV: r.maNV, ngayLam: 0, don: 0, km: 0, thuongDon: 0, thuongKm: 0, tong: 0, thang: {}, trongDS: true }); });
  }
  function quarterMonths(q) { const [y, n] = q.split('-Q').map(Number); const s = (n - 1) * 3 + 1; return [s, s + 1, s + 2].map(m => `${y}-${pad2(m)}`); }
  const quarterLabel = q => { const [y, n] = q.split('-Q'); return `Quý ${n}/${y}`; };
  const monthLabel = mk => `Tháng ${Number(mk.split('-')[1])}`;
  function monthCounts(parsed) {
    const c = {}; parsed.giao.forEach(r => { if (r.t != null) { const m = monthKey(r.t); c[m] = (c[m] || 0) + 1; } });
    return Object.keys(c).sort().map(m => ({ monthKey: m, n: c[m] }));
  }
  function suggestQuarter(parsed) {
    const qs = {}; monthCounts(parsed).forEach(({ monthKey: m, n }) => { const [y, mo] = m.split('-').map(Number); const q = `${y}-Q${Math.ceil(mo / 3)}`; qs[q] = (qs[q] || 0) + n; });
    return Object.keys(qs).sort((a, b) => qs[b] - qs[a])[0] || null;
  }

  // Tính cho 1 quý. Trả về kết quả gọn để lưu (theo ngày + theo người), không lưu dòng thô.
  function compute(parsed, q, rules) {
    rules = Object.assign({}, RULES, rules || {});
    const months = new Set(quarterMonths(q)), ng = new Set(parsed.ngoaiGio), kien = parsed.kienMap || {};
    const kd = new Set(parsed.khongDat || []);
    const loaiDiem = new Set((rules.diemLoaiTru || []).map(diaChiKey).filter(Boolean)), diemDem = {};
    const st = { tong: 0, ngoaiQuy: 0, khongGio: 0, chanh: 0, khongRoDoiTac: 0, oto: 0, ngoaiGio: 0, diemLoai: 0, khongDatTinh: 0, tinh: 0, kmSua: 0 };
    const rows = [];
    parsed.giao.forEach(r => {
      if (r.t == null) { st.khongGio++; return; }
      if (!months.has(monthKey(r.t))) { st.ngoaiQuy++; return; }
      st.tong++;
      const dt = kien[r.kien] != null && kien[r.kien] !== '' ? kien[r.kien] : r.dt;
      if (dt == null || dt === '') { st.khongRoDoiTac++; return; }
      if (!fold(dt).includes('truc tiep')) { st.chanh++; return; }
      if (fold(r.pt) === 'o to') { st.oto++; return; }
      if (r.codes.some(c => ng.has(c))) { st.ngoaiGio++; return; }
      if (loaiDiem.size && loaiDiem.has(diaChiKey(r.diem))) { st.diemLoai++; diemDem[r.diem] = (diemDem[r.diem] || 0) + 1; return; }
      if (r.codes.some(c => kd.has(c))) st.khongDatTinh++; // ngoài giờ "Không đạt" → vẫn tính
      rows.push(r);
    });
    st.tinh = rows.length;
    // km > 200: trung bình (≤ 200) cùng điểm trả → cùng khách hàng → cùng người giao
    const avg = f => { const s = {}; rows.forEach(r => { if (r.km <= rules.kmMax) { const k = key(f(r)); (s[k] = s[k] || [0, 0]); s[k][0] += r.km; s[k][1]++; } }); const o = {}; Object.keys(s).forEach(k => { o[k] = s[k][0] / s[k][1]; }); return o; };
    const aD = avg(r => r.diem), aK = avg(r => r.kh), aN = avg(r => r.nv);
    rows.forEach(r => {
      r.kmTinh = r.km;
      if (r.km > rules.kmMax) {
        const v = [[aD, r.diem], [aK, r.kh], [aN, r.nv]].map(([a, k]) => a[key(k)]).find(v => v != null);
        if (v != null) { r.kmTinh = v; st.kmSua++; }
      }
    });
    // trùng: so với lần trả trước cùng khoá (cùng người giao)
    rows.sort((a, b) => key(a.nv).localeCompare(key(b.nv)) || a.t - b.t);
    const lastDiem = {}, lastDon = {};
    rows.forEach(r => {
      const kd = key(r.nv) + '|' + key(r.kh), kn = key(r.nv) + '|' + key(r.nhan);
      r.trungDiem = kd in lastDiem && (r.t - lastDiem[kd]) <= rules.trungDiemPhut * 60000;
      r.trungDon = kn in lastDon && (r.t - lastDon[kn]) <= rules.trungDonPhut * 60000;
      lastDiem[kd] = r.t; lastDon[kn] = r.t;
    });
    // theo người + ngày
    const days = {};
    rows.forEach(r => {
      const k = key(r.nv) + '|' + dayKey(r.t);
      const d = days[k] || (days[k] = { nv: r.nv, ngay: dayKey(r.t), don: 0, km: 0, dong: 0, trungDon: 0, trungDiem: 0 });
      d.dong++;
      if (r.trungDon) d.trungDon++; else d.don++;
      if (r.trungDiem) d.trungDiem++; else d.km += r.kmTinh;
    });
    const list = Object.values(days).map(d => Object.assign(d, {
      thuongDon: Math.max(0, d.don - rules.donNguong) * rules.donGia,
      thuongKm: Math.max(0, d.km - rules.kmNguong) * rules.kmGia,
    })).sort((a, b) => a.ngay.localeCompare(b.ngay) || key(a.nv).localeCompare(key(b.nv)));
    const per = {};
    const qm = quarterMonths(q);
    list.forEach(d => {
      const k = key(d.nv), p = per[k] || (per[k] = { nv: d.nv, maNV: (parsed.names[k] || {}).maNV || '', ngayLam: 0, don: 0, km: 0, thuongDon: 0, thuongKm: 0, thang: {} });
      p.ngayLam++; p.don += d.don; p.km += d.km; p.thuongDon += d.thuongDon; p.thuongKm += d.thuongKm;
      const m = d.ngay.slice(0, 7), t = p.thang[m] || (p.thang[m] = { don: 0, km: 0, thuongDon: 0, thuongKm: 0 });
      t.don += d.don; t.km += d.km; t.thuongDon += d.thuongDon; t.thuongKm += d.thuongKm;
    });
    const nhanVien = Object.values(per).map(p => Object.assign(p, { tong: p.thuongDon + p.thuongKm }))
      .sort((a, b) => b.tong - a.tong || key(a.nv).localeCompare(key(b.nv)));
    markRoster(nhanVien, parsed.roster || []);
    st.diemLoaiChiTiet = Object.entries(diemDem).sort((a, b) => b[1] - a[1]);
    if (rules.debug) return { rows, days: list, nhanVien, stats: st };
    return { quarterKey: q, months: qm, rules, stats: st, days: list, nhanVien,
      files: parsed.files, giaoSheets: parsed.giaoSheets, ngoaiGioCount: parsed.ngoaiGio.length, khongDatCount: (parsed.khongDat || []).length, kienCount: parsed.kienCount,
      coDS: (parsed.roster || []).length > 0 };
  }

  root.GhEngine = { RULES, DIEM_LOAI_TRU, diaChiKey, key, collectRoster, markRoster, newAcc, parseOne, finish, parseFiles, compute, monthCounts, suggestQuarter, quarterMonths, quarterLabel, monthLabel, splitCodes, baseCode, pad2 };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
