/* ============================================================================
   Tính thưởng đóng gói kiện hàng kho HCM (chuyển từ app cũ giao-hang-app,
   src/utils/khoEngine.js — giữ nguyên cách tính đã xác nhận với người dùng).

   - Mỗi ngày cộng dồn Tạo kiện + Bốc hàng + Đóng hàng của 1 NV thành 1 tổng.
   - Ngày có tổng > NGUONG (20) lượt: (tổng − 20) × DON_GIA (2.000đ). Cộng dồn tháng.
   - Thưởng quý = trung bình cộng 3 tháng của quý.
   - "Tạo kiện" khớp theo username (cột "Người tạo kiện") với cột username của
     "bảng mã nv"; "Bốc hàng"/"Đóng hàng" lưu dạng "Họ tên (SĐT)" nên khớp theo
     Họ và tên (bỏ phần SĐT).
   - Đóng cặp: trong khoảng ngày khai báo, số lượt của 2 người được chia đôi.
   Dùng chung cho trang (window) và worker (self).
   ============================================================================ */
(function (root) {
  'use strict';
  const SHEET_RAW = 'Bảng check kiện hàng';
  const SHEET_MNV = 'bảng mã nv';
  const SHEET_THUONG = 'THƯỞNG';
  const RULES = { nguong: 20, donGia: 2000 };

  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const norm = s => String(s ?? '').trim();
  // Khoá so khớp: chuẩn hoá Unicode (NFC), bỏ khoảng trắng thừa, không phân biệt hoa/thường
  // — giống VLOOKUP của Excel ("0201THAONTT.KHO" = "0201thaontt.kho").
  const key = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

  function serialToDate(serial) {
    if (typeof serial !== 'number' || !isFinite(serial)) return null;
    const d = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86400000);
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
  }
  const NAME_PHONE_RE = /^(.*?)\s*\([\d\s]+\)\s*$/;
  function parseCreditName(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;
    const m = NAME_PHONE_RE.exec(s);
    return norm(m ? m[1] : s);
  }
  function findSheet(wb, name) {
    const found = wb.SheetNames.find(n => norm(n).toLowerCase() === norm(name).toLowerCase());
    return found ? wb.Sheets[found] : null;
  }

  // "bảng mã nv": cột A = Mã NV, B = mã chấm công trên hệ thống, D = Họ và tên.
  // Một người thường có NHIỀU dòng: 1 dòng cột B là username (khớp "Người tạo
  // kiện"), 1 dòng cột B là "Họ tên (SĐT)" (khớp "Bốc hàng"/"Đóng hàng"). Dùng TẤT
  // CẢ các dòng để lập bảng khớp (app cũ chỉ lấy dòng đầu nên sót lượt).
  function parseMNV(XLSX, ws) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const list = [], byMa = new Map(), creditKeys = new Map(), nameKeys = new Map();
    for (const r of aoa) {
      if (!r) continue;
      const maNV = norm(r[0]), maHT = norm(r[1]), hoTen = norm(r[3]);
      if (!maNV || !hoTen) continue;
      if (!byMa.has(maNV)) { const e = { maNV, hoTen, ghiChu: '' }; byMa.set(maNV, e); list.push(e); }
      if (maHT) creditKeys.set(key(maHT), maNV);
      if (!nameKeys.has(key(hoTen))) nameKeys.set(key(hoTen), maNV);
    }
    return { list, creditKeys, nameKeys };
  }
  function parseThuongRoster(XLSX, ws) {
    if (!ws) return null;
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const out = [], notes = {};
    for (let i = 1; i < aoa.length; i++) {
      const r = aoa[i] || [], m = norm(r[0]);
      if (!m || !r[1]) continue; // bỏ dòng "Tổng cộng"
      if (!out.includes(m)) out.push(m);
      if (norm(r[3])) notes[m] = norm(r[3]);
    }
    return out.length ? { out, notes } : null;
  }

  // Đọc workbook -> dữ liệu gộp theo (tháng, NV, ngày). Chạy trong worker.
  function processWorkbookData(XLSX, wb, fileName) {
    const missing = [SHEET_RAW, SHEET_MNV].filter(n => !findSheet(wb, n));
    if (missing.length) throw new Error('File thiếu sheet bắt buộc: ' + missing.join(', '));
    const mnv = parseMNV(XLSX, findSheet(wb, SHEET_MNV));
    const employees = mnv.list;
    if (!employees.length) throw new Error('Không đọc được danh sách nhân viên từ sheet "bảng mã nv"');
    const roster = parseThuongRoster(XLSX, findSheet(wb, SHEET_THUONG));
    const payrollMaNV = roster ? roster.out : null;
    if (roster) employees.forEach(e => { if (roster.notes[e.maNV]) e.ghiChu = roster.notes[e.maNV]; });
    // Tạo kiện: username; Bốc/Đóng hàng: "Họ tên (SĐT)" nguyên chuỗi, nếu không có thì theo Họ tên.
    const unmatched = new Map();
    const byUser = v => { if (!norm(v)) return null; const m = mnv.creditKeys.get(key(v)); if (!m) unmatched.set(norm(v), (unmatched.get(norm(v)) || 0) + 1); return m; };
    const byCredit = v => {
      if (!norm(v)) return null;
      const m = mnv.creditKeys.get(key(v)) || mnv.nameKeys.get(key(parseCreditName(v)));
      if (!m) { const n = parseCreditName(v); unmatched.set(n, (unmatched.get(n) || 0) + 1); }
      return m;
    };

    const rows = XLSX.utils.sheet_to_json(findSheet(wb, SHEET_RAW), { defval: null, raw: true });
    const monthly = {};
    function credit(maNV, serial) {
      if (!maNV || typeof serial !== 'number') return;
      const d = serialToDate(serial);
      if (!d) return;
      const mk = `${d.year}-${pad2(d.month)}`;
      if (!monthly[mk]) monthly[mk] = {};
      if (!monthly[mk][maNV]) monthly[mk][maNV] = new Array(32).fill(0);
      monthly[mk][maNV][d.day]++;
    }
    rows.forEach(r => {
      credit(byUser(r['Người tạo kiện']), r['Ngày tạo kiện']);
      credit(byCredit(r['Bốc hàng']), r['TG Bốc hàng']);
      credit(byCredit(r['Đóng hàng']), r['TG Đóng hàng']);
    });
    const allMonths = Object.keys(monthly).sort();
    if (!allMonths.length) throw new Error('Không có dòng dữ liệu nào khớp với danh sách NV trong sheet "bảng mã nv"');
    // Tên/username không khớp ai trong "bảng mã nv" (người ngoài DS thưởng, adminIT…) — để người dùng soát
    const khongKhop = [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    return { fileName, payrollMaNV, soDongTho: rows.length, employees, allMonths, rawMonthly: monthly, khongKhop };
  }

  function monthVolumes(cached) {
    return cached.allMonths.map(mk => {
      const byUser = cached.rawMonthly[mk] || {};
      const total = Object.values(byUser).reduce((s, arr) => s + arr.reduce((a, b) => a + (b || 0), 0), 0);
      return { monthKey: mk, total };
    });
  }
  function suggestQuarter(cached) {
    const vols = monthVolumes(cached);
    if (!vols.length) return null;
    const best = vols.reduce((a, b) => (b.total > a.total ? b : a));
    const [y, m] = best.monthKey.split('-').map(Number);
    return `${y}-Q${Math.ceil(m / 3)}`;
  }
  function quartersOf(cached) {
    const set = new Set();
    cached.allMonths.forEach(mk => { const [y, m] = mk.split('-').map(Number); set.add(`${y}-Q${Math.ceil(m / 3)}`); });
    return [...set].sort();
  }
  function quarterMonths(q) {
    const [y, n] = q.split('-Q').map(Number);
    const s = (n - 1) * 3 + 1;
    return [s, s + 1, s + 2].map(m => `${y}-${pad2(m)}`);
  }
  const quarterLabel = q => { const [y, n] = q.split('-Q'); return `Quý ${n}/${y}`; };
  const monthLabel = mk => `Tháng ${Number(mk.split('-')[1])}`;

  function computeBonus(counts32, rules) {
    let t = 0;
    for (let d = 1; d <= 31; d++) { const c = counts32[d] || 0; if (c > rules.nguong) t += (c - rules.nguong) * rules.donGia; }
    return t;
  }

  // adjustments: [{ id, maNV1, maNV2, dateFrom, dateTo }] (ngày dạng YYYY-MM-DD)
  function computeResult(cached, quarterKey, adjustments, rules) {
    rules = rules || RULES;
    const months = quarterMonths(quarterKey);
    const monthly = {};
    months.forEach(mk => {
      monthly[mk] = {};
      const src = cached.rawMonthly[mk] || {};
      Object.keys(src).forEach(u => { monthly[mk][u] = [...src[u]]; });
    });
    (adjustments || []).forEach(adj => {
      months.forEach(mk => {
        const [y, m] = mk.split('-').map(Number);
        const by = monthly[mk];
        if (!by[adj.maNV1]) by[adj.maNV1] = new Array(32).fill(0);
        if (!by[adj.maNV2]) by[adj.maNV2] = new Array(32).fill(0);
        for (let d = 1; d <= 31; d++) {
          const k = `${y}-${pad2(m)}-${pad2(d)}`;
          if (k >= adj.dateFrom && k <= adj.dateTo) {
            const half = ((by[adj.maNV1][d] || 0) + (by[adj.maNV2][d] || 0)) / 2;
            by[adj.maNV1][d] = half; by[adj.maNV2][d] = half;
          }
        }
      });
    });
    const roster = cached.payrollMaNV ? new Set(cached.payrollMaNV) : null;
    const payroll = roster ? cached.employees.filter(e => roster.has(e.maNV)) : cached.employees;
    const perEmployee = payroll.map(emp => {
      const monthlyDetail = months.map(mk => {
        const counts32 = (monthly[mk] && monthly[mk][emp.maNV]) || new Array(32).fill(0);
        return { monthKey: mk, counts32, soKien: counts32.reduce((s, c) => s + (c || 0), 0), tongTien: computeBonus(counts32, rules) };
      });
      const tongQuy = monthlyDetail.reduce((s, m) => s + m.tongTien, 0);
      return { ...emp, monthlyDetail, thuong: tongQuy / months.length };
    });
    return { fileName: cached.fileName, soDongTho: cached.soDongTho, employees: cached.employees,
      payrollFiltered: !!roster, months, quarterKey, adjustments: adjustments || [], perEmployee, rules };
  }

  root.KhoEngine = { RULES, processWorkbookData, monthVolumes, suggestQuarter, quartersOf, quarterMonths,
    quarterLabel, monthLabel, computeResult, pad2 };
})(typeof self !== 'undefined' ? self : window);
