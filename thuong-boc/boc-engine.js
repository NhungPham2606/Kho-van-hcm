// Engine "Thưởng bốc hàng quý": đọc file nhập hàng của các văn phòng (HCM, Cần Thơ, Tây Nguyên, Khánh Hòa…) rồi tính thưởng.
// Mỗi đợt: kiện/người = Số kiện ÷ số người có tên; thưởng/người = (kiện/người − 18) × 2.000đ, dưới 18 thì 0đ.
(function (root) {
  'use strict';
  const RULES = { nguong: 18, donGia: 2000 };
  const norm = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const toneFix = s => s.normalize('NFD').replace(/([ou])([̣̀́̃̉])([aey])/g, '$1$3$2').normalize('NFC');
  const key = s => toneFix(norm(s).toLowerCase());
  const fold = s => norm(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  const pad2 = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
  const quarterOf = s => `${s.slice(0, 4)}-Q${Math.ceil(Number(s.slice(5, 7)) / 3)}`;
  const quarterLabel = q => { const [y, n] = q.split('-Q'); return `Quý ${n}/${y}`; };
  const monthLabel = mk => `Tháng ${Number(mk.split('-')[1])}`;
  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4 };
  const fullYear = y => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null);

  // "QUÝ III/2026", "Quý 2-2026", "QUÝ 4.24", "THÁNG 7", "THÁNG 10/26" → { q, y }
  function hintFrom(text) {
    const t = fold(text);
    let m = t.match(/quy\s*(iv|iii|ii|i|[1-4])(?![a-z0-9])\s*(?:[\/.,\-_ ]+\s*(?:nam\s*)?(\d{4}|\d{2})(?!\d))?/);
    if (m) return { q: ROMAN[m[1]] || Number(m[1]), y: fullYear(m[2]) };
    m = t.match(/thang\s*(\d{1,2})(?!\d)\s*(?:[\/.\-]\s*(\d{4}|\d{2})(?!\d))?/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return { q: Math.ceil(+m[1] / 3), y: fullYear(m[2]) };
    return null;
  }
  function guessVP(text) {
    const t = fold(text);
    if (/can tho/.test(t)) return 'Cần Thơ';
    if (/tay nguyen|dak lak|dac lac|buon ma thuot/.test(t)) return 'Tây Nguyên';
    if (/khanh hoa|nha trang/.test(t)) return 'Khánh Hòa';
    if (/\bhcm\b|ho chi minh/.test(t)) return 'HCM';
    return '';
  }
  // Ngày: chuỗi d/m/y là chắc chắn; số serial có thể bị Excel đảo ngày/tháng → giữ thêm phương án đảo (alt).
  function parseDate(XLSX, v) {
    if (typeof v === 'number' && v > 20000) {
      const c = XLSX.SSF.parse_date_code(v);
      if (!c) return null;
      return { d: iso(c.y, c.m, c.d), alt: (c.d <= 12 && c.d !== c.m) ? iso(c.y, c.d, c.m) : null };
    }
    const m = norm(v).match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (!m || +m[2] > 12 || +m[1] > 31) return null;
    return { d: iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]), alt: null };
  }
  function parseKien(v) {
    if (typeof v === 'number') return v > 0 ? v : 0;
    // "496 kiện + 50 cái Palet" → 546 (như file quý 2 đã cộng); còn lại lấy số đầu tiên
    const nums = (norm(v).match(/\d{1,3}(?:[.,]\d{3})+|\d+/g) || []).map(x => Number(x.replace(/[.,]/g, '')));
    if (!nums.length) return 0;
    return /\+/.test(v) ? nums.reduce((a, x) => a + x, 0) : nums[0];
  }
  const maNV = v => (typeof v === 'number' ? String(v).padStart(6, '0') : norm(v));

  function findHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const f = rows[i].map(fold), col = {};
      f.forEach((x, c) => {
        if (col.ngay === undefined && /^ngay/.test(x)) col.ngay = c;
        else if (col.kien === undefined && /^so kien/.test(x) && !/nguoi|\//.test(x)) col.kien = c;
        else if (col.ma === undefined && /^(ma nv|mnv|ma nhan vien)/.test(x)) col.ma = c;
        else if (col.ten === undefined && /^(ten|ho va ten|ho ten)/.test(x)) col.ten = c;
      });
      if (['ngay', 'kien', 'ma', 'ten'].every(k => col[k] !== undefined)) return { row: i, col, head: f };
    }
    return null;
  }
  const inQ = (d, h) => d && Math.ceil(Number(d.slice(5, 7)) / 3) === h.q && (!h.y || Number(d.slice(0, 4)) === h.y);

  function parseSheet(XLSX, ws, sheet, file) {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const h = findHeader(rows);
    if (!h) return null;
    const title = rows.slice(0, h.row).map(r => r.map(norm).filter(Boolean).join(' ')).filter(Boolean).join(' ');
    const hint = hintFrom(sheet) || hintFrom(title);
    const { ngay, kien, ma, ten } = h.col, batches = [];
    const known = new Set(Object.values(h.col));
    let cur = null;
    rows.slice(h.row + 1).forEach((r, i) => {
      const line = r.slice(0, ma + 1).map(fold).join(' ').trim();
      if (/^(tong|cong)\b/.test(line)) { cur = null; return; }
      const kv = r[kien], date = parseDate(XLSX, r[ngay]), soKien = parseKien(kv);
      if (date || (norm(r[ngay]) === '' && soKien && cur && cur.kien && typeof kv === 'number')) {
        cur = { id: `${file}|${sheet}|${h.row + i + 2}`, file, sheet, date: date || cur.date, kien: soKien, kienText: typeof kv === 'string' ? norm(kv) : '', note: [], nguoi: [], trung: 0 };
        batches.push(cur);
      } else if (cur && typeof kv === 'string' && norm(kv)) cur.note.push(norm(kv));
      if (!cur) return;
      r.forEach((v, c) => {
        if (known.has(c) || typeof v !== 'string' || !norm(v) || /^[\d\s.+\-]+$/.test(norm(v)) || h.head[c] === 'stt' || /kien\/nguoi|trung binh/.test(h.head[c])) return;
        cur.note.push(h.head[c] ? `${norm(rows[h.row][c])}: ${norm(v)}` : norm(v));
      });
      const m = maNV(r[ma]), t = norm(r[ten]);
      if (!m && !t) return;
      if (cur.nguoi.some(p => (m && p.ma === m) || (!m && key(p.ten) === key(t)))) { cur.trung++; return; }
      cur.nguoi.push({ ma: m, ten: t });
    });
    // Excel có thể đảo ngày/tháng: chọn phương án thuộc đúng quý, nếu cả hai thuộc quý thì theo thứ tự các đợt trước/sau.
    const years = batches.filter(b => b.date).map(b => b.date.d.slice(0, 4)).sort();
    const eff = hint ? { q: hint.q, y: hint.y || Number(years[Math.floor(years.length / 2)]) } : null;
    batches.forEach(b => {
      b.ngay = b.date.d; b.chac = !b.date.alt;
      if (b.date.alt && eff) {
        const a = inQ(b.date.d, eff), c = inQ(b.date.alt, eff);
        if (a !== c) { b.chac = true; if (c) { b.ngay = b.date.alt; b.dao = true; } }
      }
    });
    batches.forEach((b, i) => {
      if (b.chac) return;
      const prev = batches.slice(0, i).reverse().find(x => x.chac), next = batches.slice(i + 1).find(x => x.chac);
      const ok = d => (!prev || d >= prev.ngay) && (!next || d <= next.ngay);
      if (!ok(b.date.d) && ok(b.date.alt)) { b.ngay = b.date.alt; b.dao = true; }
    });
    batches.forEach(b => { b.goc = b.date.d; delete b.date; delete b.chac; b.note = [...new Set(b.note)].join(' · '); b.ngoaiGio = /ngoai\s*gio/.test(fold(b.note)); });
    return { sheet, title, hint, batches };
  }
  function parseWorkbook(XLSX, wb, file) {
    const sheets = [];
    wb.SheetNames.forEach(n => { const s = wb.Sheets[n]; if (s && s['!ref']) { const x = parseSheet(XLSX, s, n, file); if (x && x.batches.length) sheets.push(x); } });
    return { file, sheets, vp: guessVP([file, ...sheets.map(s => `${s.sheet} ${s.title}`)].join(' ')) };
  }
  // thứ tự văn phòng như tiêu đề file quý 2: HCM + Cần Thơ + Khánh Hòa + Đắk Lắk (Tây Nguyên)
  const VP_THU_TU = ['HCM', 'Cần Thơ', 'Khánh Hòa', 'Tây Nguyên'];
  const vpThuTu = v => { const i = VP_THU_TU.indexOf(v); return i < 0 ? 99 : i; };
  const sheetMatch = (s, q) => { if (!s.hint) return true; const [y, n] = q.split('-Q').map(Number); return s.hint.q === n && (!s.hint.y || s.hint.y === y); };

  // books: [{ file, vp, sheets }]. Kết quả là dữ liệu từng đợt; cộng theo người bằng tong().
  function compute(books, q, rules) {
    const R = Object.assign({}, RULES, rules || {}), seen = new Set(), batches = [];
    const loc = { sheetKhacQuy: [], ngoaiQuy: [], thieu: [], trungDot: [], daoNgay: [] };
    const tenTheoMa = {}, maTheoTen = {};
    books.forEach(b => b.sheets.forEach(s => s.batches.forEach(x => x.nguoi.forEach(p => { if (p.ma && p.ten) { tenTheoMa[p.ma] = p.ten; maTheoTen[key(p.ten)] = p.ma; } }))));
    books.forEach(b => b.sheets.forEach(s => {
      if (!sheetMatch(s, q)) { loc.sheetKhacQuy.push(`${b.file} › ${s.sheet}`); return; }
      s.batches.forEach(x => {
        const ten = `${b.vp || b.file} · ${x.ngay} · ${x.kien} kiện`;
        if (quarterOf(x.ngay) !== q) { loc.ngoaiQuy.push(ten); return; }
        if (!x.kien || !x.nguoi.length) { loc.thieu.push(ten); return; }
        const nguoi = x.nguoi.map(p => ({ ma: p.ma || maTheoTen[key(p.ten)] || '', ten: p.ten || tenTheoMa[p.ma] || '' }));
        const sig = [b.vp, x.ngay, x.kien, nguoi.map(p => p.ma || key(p.ten)).sort().join(',')].join('|');
        if (seen.has(sig)) { loc.trungDot.push(ten); return; }
        seen.add(sig);
        if (x.dao) loc.daoNgay.push(`${b.vp || b.file}: ${x.goc} → ${x.ngay}`);
        batches.push(tinhDot(Object.assign({}, x, { vp: b.vp, nguoi }), R));
      });
    }));
    batches.sort((a, b) => vpThuTu(a.vp) - vpThuTu(b.vp) || a.vp.localeCompare(b.vp, 'vi') || a.ngay.localeCompare(b.ngay));
    return { quarterKey: q, rules: R, months: [...new Set(batches.map(b => b.ngay.slice(0, 7)))].sort(), batches, loc, files: books.map(b => ({ file: b.file, vp: b.vp, sheets: b.sheets.map(s => s.sheet) })) };
  }
  function tinhDot(b, R) {
    const n = b.nguoi.length, tb = n ? b.kien / n : 0;
    return Object.assign(b, { soNguoi: n, tb, thuong: tb > R.nguong ? (tb - R.nguong) * R.donGia : 0 });
  }
  // Sửa tay từng đợt (thêm / bớt người, sửa số kiện): sua[id] = { kien?, nguoi? } → tính lại kiện/người và thưởng.
  function apDung(result, sua) {
    const R = Object.assign({}, RULES, result.rules || {});
    return result.batches.map(b => {
      const s = sua && sua[b.id];
      if (!s) return b;
      return tinhDot(Object.assign({}, b, { kien: s.kien != null ? s.kien : b.kien, nguoi: s.nguoi || b.nguoi, daSua: true }), R);
    });
  }
  // boQua: id các đợt bị bỏ tick; đợt ghi "ngoài giờ" mặc định không tính trừ khi có trong chonThem.
  const dotTinh = (b, skip, add) => !skip.has(b.id) && (!b.ngoaiGio || add.has(b.id));
  function tong(batches, boQua, chonThem) {
    const skip = new Set(boQua || []), add = new Set(chonThem || []), map = new Map();
    batches.forEach(b => {
      if (!dotTinh(b, skip, add)) return;
      const m = b.ngay.slice(0, 7);
      b.nguoi.forEach(p => {
        const k = p.ma || key(p.ten);
        if (!map.has(k)) map.set(k, { ma: p.ma, ten: p.ten, vp: new Set(), dot: 0, kien: 0, thuong: 0, thang: {} });
        const x = map.get(k);
        x.vp.add(b.vp); x.dot++; x.kien += b.tb; x.thuong += b.thuong; x.thang[m] = (x.thang[m] || 0) + b.thuong;
      });
    });
    return [...map.values()].map(x => Object.assign(x, { vp: [...x.vp].join(', ') })).sort((a, b) => b.thuong - a.thuong || a.ten.localeCompare(b.ten, 'vi'));
  }
  function suggestQuarter(books) {
    const n = {};
    books.forEach(b => b.sheets.forEach(s => s.batches.forEach(x => { const q = quarterOf(x.ngay); n[q] = (n[q] || 0) + 1; })));
    return Object.entries(n).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).map(x => x[0]);
  }
  root.BocEngine = { RULES, key, fold, hintFrom, guessVP, parseWorkbook, compute, apDung, dotTinh, tong, vpThuTu, suggestQuarter, quarterOf, quarterLabel, monthLabel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
