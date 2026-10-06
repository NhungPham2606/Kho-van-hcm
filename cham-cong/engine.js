// Lõi trang "Chấm công": đọc file bảng chấm công tổng (nhiều sheet "Chấm công Tm.yy"), đọc file BCC
// xuất từ hệ thống, dựng sheet tháng mới theo đúng mẫu tháng trước, tính tổng để xem, xuất Excel nhiều sheet.
// Dùng được cả trên trình duyệt (window.CC) lẫn node (module.exports) để kiểm thử.
(function (root) {
  'use strict';
  const CC = {};

  // ------------------------------------------------------------ tiện ích cột / chuỗi
  const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const colN = s => s.toUpperCase().split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  const pad2 = n => (n < 10 ? '0' : '') + n;
  const norm = s => String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const fold = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  CC.colL = colL; CC.colN = colN; CC.fold = fold;

  const DAY0 = 6;              // cột F = ngày 1
  const FIRST_ROW = 8;         // dòng đầu tiên sau tiêu đề (dòng Team đầu tiên)
  // 18 cột sau các cột ngày, đúng thứ tự trong mẫu
  CC.TAIL = ['Tổng', 'TG', 'P', 'ON/CT', 'Ro', 'R', 'L&\nCT', 'T', 'B', 'TS', 'Ô', 'HT', 'Cộng phép nv 5 năm', 'Phép tồn', 'Phép tháng', 'Tổng phép tháng', 'Phép tồn sau tháng', 'Ghi Chú'];
  const T = { TONG: 0, TG: 1, P: 2, ON: 3, RO: 4, R: 5, L: 6, T: 7, B: 8, TS: 9, O: 10, HT: 11, AW: 12, AX: 13, AY: 14, AZ: 15, BA: 16, BB: 17 };
  CC.T = T;
  const tailCol = (n, i) => DAY0 + n + i;          // số cột Excel của cột tổng thứ i, tháng có n ngày
  CC.tailCol = tailCol;
  CC.daysIn = (nam, thang) => new Date(nam, thang, 0).getDate();
  CC.lastRow = sh => FIRST_ROW + sh.rows.length - 1;

  // Công thức chuẩn (lấy nguyên từ sheet "Chấm công T8.26", tháng 31 ngày, {r} = số dòng)
  const STD31 = [
    'AL{r}+AM{r}+AN{r}+AQ{r}+AR{r}+AP{r}',
    'COUNTIF(F{r}:AJ{r},"x")+(COUNTIF(F{r}:AJ{r},"S/P.c")*0.5)+(COUNTIF(F{r}:AJ{r},"C")*0.5)+COUNTIF(F{r}:AJ{r},"S")*0.5+COUNTIF(F{r}:AJ{r},"C/P.s")*0.5+COUNTIF(F{r}:AJ{r},"S/Ro.c")*0.5+COUNTIF(F{r}:AJ{r},"Ro.s/C")*0.5+COUNTIF(F{r}:AJ{r},"CT.s/C")*0.5+COUNTIF(F{r}:AJ{r},"C/Ro.s")*0.5',
    'COUNTIF(F{r}:AJ{r},"P")+(COUNTIF(F{r}:AJ{r},"S/P.c")*0.5)+COUNTIF(F{r}:AJ{r},"P.s")*0.5+COUNTIF(F{r}:AJ{r},"C/P.s")*0.5+COUNTIF(F{r}:AJ{r},"CT.s/P.C")*0.5',
    'COUNTIF(E{r}:AJ{r},"On")+COUNTIF(E{r}:AJ{r},"On/2")*0.5+COUNTIF(E{r}:AJ{r},"On/Ro.c")*0.5+COUNTIF(E{r}:AJ{r},"Ro.s/On")*0.5',
    'COUNTIFS(F{r}:AJ{r},"Ro")+(COUNTIFS(F{r}:AJ{r},"Ro.s")/2)+(COUNTIFS(F{r}:AJ{r},"S/Ro.C")/2)+(COUNTIFS(F{r}:AJ{r},"Ro.s/C")/2)+(COUNTIFS(F{r}:AJ{r},"P.s/Ro.c")/2)+(COUNTIFS(F{r}:AJ{r},"Ro.s/P.c")/2)+(COUNTIFS(F{r}:AJ{r},"C/Ro.s")/2)',
    'COUNTIFS(F{r}:AJ{r},"R")+(COUNTIFS(F{r}:AJ{r},"R.s")/2)',
    'COUNTIFS(F{r}:AJ{r},"L")+(COUNTIFS(F{r}:AJ{r},"L/2")/2)+COUNTIFS(F{r}:AJ{r},"CT")+COUNTIFS(F{r}:AJ{r},"CT/2")/2+(COUNTIFS(F{r}:AJ{r},"CT.S/P.C")/2)+COUNTIFS(F{r}:AJ{r},"CT.S/C")/2+COUNTIFS(F{r}:AJ{r},"CT.s")/2',
    'COUNTIFS(F{r}:AJ{r},"T")+(COUNTIFS(F{r}:AJ{r},"T/2")/2)',
    'COUNTIF(F{r}:AJ{r},"B")+COUNTIF(F{r}:AJ{r},"P/B")*0.5+COUNTIF(I{r}:AJ{r},"B/Ro")*0.5+COUNTIF(I{r}:AJ{r},"x/B")*0.5',
    'COUNTIFS(F{r}:AJ{r},"TS")+(COUNTIFS(F{r}:AJ{r},"TS/2")/2)',
    'COUNTIFS(F{r}:AJ{r},"Ô")+(COUNTIFS(F{r}:AJ{r},"Ô/2")/2)',
    'COUNTIFS(F{r}:AJ{r},"HT")+COUNTIFS(F{r}:AJ{r},"HT/2")*0.5',
    null, null, null,
    'AX{r}+AY{r}',
    'AZ{r}-AM{r}',
    null,
  ];

  // ------------------------------------------------------------ xử lý công thức dạng chữ
  // Tách phần nằm trong '...' hoặc "..." để không đụng tới tên sheet / tiêu chí COUNTIF
  function mapOutsideQuotes(f, fn) {
    let out = '', i = 0;
    while (i < f.length) {
      const q = f[i];
      if (q === '"' || q === "'") {
        let j = i + 1;
        while (j < f.length) { if (f[j] === q) { if (f[j + 1] === q) { j += 2; continue; } break; } j++; }
        out += f.slice(i, j + 1); i = j + 1;
      } else {
        let j = i; while (j < f.length && f[j] !== '"' && f[j] !== "'") j++;
        out += fn(f.slice(i, j)); i = j;
      }
    }
    return out;
  }
  const REF = /(?<![A-Za-z0-9_.!])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g;
  // công thức của dòng r -> mẫu với {r}
  function toTpl(f, r) {
    return mapOutsideQuotes(f, s => s.replace(REF, (m, d1, c, d2, rr) => (!d2 && +rr === r) ? `${d1}${c}{r}` : m));
  }
  // dịch các cột >= cột ngày cuối khi số ngày trong tháng thay đổi (31 -> 30 ...)
  function shiftCols(tpl, fromN, toN) {
    if (fromN === toN || tpl.includes('!')) return tpl;
    const lastDay = DAY0 + fromN - 1, d = toN - fromN;
    return mapOutsideQuotes(tpl, s => s.replace(/(?<![A-Za-z0-9_.!])(\$?)([A-Z]{1,3})(\$?)(\d+|\{r\})(?![\d(A-Za-z_])/g, (m, d1, c, d2, rr) => {
      const n = colN(c); return n >= lastDay ? `${d1}${colL(n + d)}${d2}${rr}` : m;
    }));
  }
  CC.toTpl = toTpl; CC.shiftCols = shiftCols;
  const stdTpl = (i, n) => STD31[i] ? shiftCols(STD31[i], 31, n) : null;

  // ------------------------------------------------------------ đọc giá trị ô ExcelJS
  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map(t => t.text).join('');
      if ('result' in v) return cellText(v.result);
      if (v.text !== undefined) return String(v.text);
      if (v instanceof Date) return v.toISOString();
      if (v.error) return '';
      return '';
    }
    return String(v);
  }
  const resultOf = v => (v && typeof v === 'object' && 'result' in v) ? v.result : v;
  function noteText(n) {
    if (!n) return '';
    if (typeof n === 'string') return n;
    if (n.texts) return n.texts.map(t => t.text).join('');
    return '';
  }
  function fillRgb(c) {
    const f = c.fill; if (!f || f.type !== 'pattern' || f.pattern !== 'solid' || !f.fgColor || !f.fgColor.argb) return '';
    const a = f.fgColor.argb.toUpperCase(); return (a === 'FFFFFFFF' || a === '00000000') ? '' : a;
  }

  // ------------------------------------------------------------ 1) đọc file tổng (nhiều tháng)
  // Tên sheet: "Chấm công T8.26", "Chấm công T8.26_ LỢI", "Chấm công T3.26XL NHI"
  CC.parseSheetName = name => {
    const m = norm(name).match(/^Chấm công\s*T\s*(\d{1,2})\s*[.\/-]\s*(\d{2,4})(.*)$/i);
    if (!m) return null;
    const thang = +m[1], nam = m[2].length === 2 ? 2000 + +m[2] : +m[2], suffix = m[3].replace(/^[\s_\-]+/, '').trim();
    if (thang < 1 || thang > 12) return null;
    const ky = `${nam}-${pad2(thang)}`, slug = fold(suffix).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return { ky, thang, nam, phu: suffix, id: slug ? `${ky}~${slug}` : ky };
  };
  CC.sheetName = (thang, nam) => `Chấm công T${thang}.${String(nam).slice(2)}`;

  function parseMasterSheet(ws, info, ord) {
    // dòng 7: "Mã NV" ở cột B, các cột ngày từ F
    let n = 0;
    for (let c = DAY0; c < DAY0 + 31; c++) {
      const f = ws.getCell(7, c).formula || '';
      const v = ws.getCell(7, c).value;
      if (/DATE\(|\+1\s*$/.test(f) || v instanceof Date) n++; else break;
    }
    if (n < 28) n = CC.daysIn(info.nam, info.thang);
    let last = 0;
    for (let r = FIRST_ROW; r <= Math.min(ws.rowCount, 400); r++) if (/^\d{3,}$/.test(norm(cellText(ws.getCell(r, 2).value)))) last = r;
    const fx = [], fxIdx = {};
    const fxOf = t => { if (!(t in fxIdx)) { fxIdx[t] = fx.length; fx.push(t); } return fxIdx[t]; };
    const rows = [];
    for (let r = FIRST_ROW; r <= last; r++) {
      const a = norm(cellText(ws.getCell(r, 1).value)), ma = norm(cellText(ws.getCell(r, 2).value));
      if (/^\d{3,}$/.test(ma)) {
        const nv = { t: 'nv', ma, ten: norm(cellText(ws.getCell(r, 3).value)), pb: cellText(ws.getCell(r, 4).value).trim(), cv: cellText(ws.getCell(r, 5).value).trim(), d: [], tail: [] };
        for (let i = 0; i < n; i++) {
          const c = ws.getCell(r, DAY0 + i);
          nv.d.push(norm(cellText(c.value)));
          const hl = fillRgb(c), cm = noteText(c.note);
          if (hl) (nv.hl = nv.hl || {})[i] = hl;
          if (cm) (nv.cm = nv.cm || {})[i] = cm;
        }
        for (let i = 0; i < CC.TAIL.length; i++) {
          const c = ws.getCell(r, tailCol(n, i)), f = c.formula, v = resultOf(c.value);
          const e = {};
          if (f && !f.includes('[')) e.x = fxOf(toTpl(f, r));
          if (v !== null && v !== undefined && v !== '' && !(typeof v === 'object')) e.v = v;
          const hl = fillRgb(c); if (hl && i !== T.AY && i !== T.TONG) e.hl = hl;
          const cm = noteText(c.note); if (cm) e.cm = cm;
          nv.tail.push(Object.keys(e).length ? e : null);
        }
        rows.push(nv);
      } else if (fold(a) === 'team' || (a && !ma && norm(cellText(ws.getCell(r, 3).value)) && fillRgb(ws.getCell(r, 1)) === 'FF92D050')) {
        rows.push({ t: 'team', text: norm(cellText(ws.getCell(r, 3).value)) });
      } else rows.push({ t: 'blank' });
    }
    const ax6 = norm(cellText(ws.getCell(6, tailCol(n, T.AX)).value));
    const sh = { id: info.id, ten: norm(ws.name), ky: info.ky, thang: info.thang, nam: info.nam, phu: info.phu, n, ord, phepTon: ax6, rows, fx, nguon: 'file tổng' };
    // sheet chép từ tháng 31 ngày sang tháng 30 ngày còn thừa cột ngày trống -> bỏ cột thừa, dịch công thức
    const dim = CC.daysIn(info.nam, info.thang);
    if (n > dim && rows.every(r => r.t !== 'nv' || r.d.slice(dim).every(v => !v))) {
      rows.forEach(r => { if (r.t !== 'nv') return; r.d = r.d.slice(0, dim); ['hl', 'cm'].forEach(k => { if (r[k]) Object.keys(r[k]).forEach(i => { if (+i >= dim) delete r[k][i]; }); }); });
      sh.fx = fx.map(t => shiftCols(t, n, dim)); sh.n = dim;
    }
    return sh;
  }
  // ExcelJS workbook -> danh sách sheet
  CC.parseMaster = wb => {
    const out = [];
    wb.worksheets.forEach((ws, i) => {
      const info = CC.parseSheetName(ws.name); if (!info) return;
      const sh = parseMasterSheet(ws, info, i);
      CC.autoFill(sh); // sếp chưa chấm (vd sheet mới chép) -> đủ công
      out.push(sh);
    });
    return out;
  };

  // ------------------------------------------------------------ 2) đọc file BCC (xuất từ hệ thống chấm công)
  const WD = { CN: 0, T2: 1, T3: 2, T4: 3, T5: 4, T6: 5, T7: 6 };
  CC.parseBCC = (XLSX, wb, fileName) => {
    const sn = wb.SheetNames[0], ws = wb.Sheets[sn];
    const a = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    const hr = a.findIndex(r => r.some(v => /^m[aã] nh[aâ]n vi[eê]n$/i.test(norm(v))));
    if (hr < 0) throw new Error('Không thấy dòng tiêu đề "Mã nhân viên" — có phải file BCC xuất từ hệ thống chấm công không?');
    const H = a[hr].map(v => fold(v));
    const ci = re => H.findIndex(h => re.test(h));
    const cMa = ci(/^ma nhan vien$/), cTen = ci(/^ten nhan vien$|^ho( va)? ten$/), cVt = ci(/^vi tri$|^chuc vu$/), cPb = ci(/^phong ban$/);
    const days = []; a[hr].forEach((v, c) => { const s = norm(v); if (/^\d{1,2}$/.test(s) && +s >= 1 && +s <= 31) days[+s - 1] = c; });
    if (!days.length) throw new Error('Không thấy các cột ngày 1, 2, 3… trong file BCC.');
    const n = days.length;
    // tháng / năm: tên sheet, các ô tiêu đề, tên file
    const txt = [sn, ...a.slice(0, hr).flat(), fileName || ''].map(norm).join(' | ');
    let thang = 0, nam = 0, m;
    if ((m = txt.match(/TH[AÁ]NG\s*(\d{1,2})(?:\s*(?:N[AĂ]M|\/|-|\.)\s*(\d{4}))?/i))) { thang = +m[1]; if (m[2]) nam = +m[2]; }
    if (!thang && (m = norm(fileName || '').match(/(?:^|[^A-Za-z])T\s*(\d{1,2})(?!\d)/i))) thang = +m[1];
    if (!nam && (m = txt.match(/\b(20\d{2})\b/))) nam = +m[1];
    // năm theo thứ của ngày 1 (dòng phía trên dòng tiêu đề: T2…CN)
    const wd = hr > 0 ? WD[norm(a[hr - 1][days[0]]).toUpperCase()] : undefined;
    if (thang && !nam && wd !== undefined) {
      const y0 = new Date().getFullYear();
      nam = [y0, y0 - 1, y0 + 1, y0 - 2].find(y => new Date(y, thang - 1, 1).getDay() === wd && CC.daysIn(y, thang) >= n) || 0;
    }
    const nv = []; let dept = '';
    for (let r = hr + 1; r < a.length; r++) {
      const row = a[r], first = norm(row[0]);
      const mDept = first.match(/^ph[oò]ng ban\s*:\s*(.*)$/i);
      if (mDept) { dept = mDept[1].trim(); continue; }
      let ma = norm(row[cMa]);
      if (!/^\d{3,}$/.test(ma)) continue;
      if (ma.length < 6) ma = ma.padStart(6, '0');
      nv.push({ ma, ten: norm(row[cTen]), cv: norm(row[cVt]), pb: norm(row[cPb]) || dept, d: days.map(c => norm(row[c])) });
    }
    return { thang, nam, n, nv, fileName: fileName || '', sheet: sn };
  };

  // ------------------------------------------------------------ 2b) file phiếu đăng ký lịch làm việc (nghỉ phép, không lương, công tác…)
  // "Danh sách đăng kí lịch làm việc dd_mm_yyyy đến dd_mm_yyyy.xlsx": mỗi dòng = 1 ngày của 1 phiếu
  const LOAI = [
    [/^nghi phep/, 'P'], [/khong luong/, 'Ro'], [/hoc|dao tao|cong tac/, 'CT'], [/om/, 'Ô'],
    [/viec rieng/, 'R'], [/online/, 'On'], [/ban giao nghi viec|^nghi viec/, 'NV'], [/lam bu/, 'BU'],
  ];
  CC.leaveCode = loai => { const f = fold(loai); const m = LOAI.find(([re]) => re.test(f)); return m ? m[1] : ''; };
  const toDate = v => {
    if (v instanceof Date) return v;
    const s = norm(v); let m;
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) return new Date(+m[3], +m[2] - 1, +m[1]);
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if (/^\d{5}(\.\d+)?$/.test(s)) { const d = new Date(Math.round((+s - 25569) * 864e5)); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
    return null;
  };
  CC.parseLeave = (XLSX, wb, fileName) => {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const a = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    const hr = a.findIndex(r => r.some(v => fold(v) === 'ma nhan vien') && r.some(v => fold(v) === 'ngay nghi'));
    if (hr < 0) throw new Error('Không thấy cột "Mã nhân viên" và "Ngày nghỉ" — có phải file danh sách đăng ký lịch làm việc không?');
    const H = a[hr].map(fold), ci = n => H.indexOf(n);
    const c = { mp: ci('ma phieu'), ma: ci('ma nhan vien'), ten: ci('nhan vien'), loai: ci('loai'), ngay: ci('ngay nghi'), so: ci('so buoi nghi'), buoi: ci('loai nghi'), ly: ci('ly do'), gc: ci('ghi chu'), tt: ci('trang thai'), kt: ci('ket thuc') };
    const out = [];
    for (let r = hr + 1; r < a.length; r++) {
      const row = a[r]; let ma = norm(row[c.ma]); if (!/^\d{3,}$/.test(ma)) continue;
      if (ma.length < 6) ma = ma.padStart(6, '0');
      const d = toDate(row[c.ngay]); if (!d) continue;
      const bf = fold(row[c.buoi]);
      const kt = c.kt >= 0 ? toDate(row[c.kt]) : null;
      out.push({ ma, ten: norm(row[c.ten]), loai: norm(row[c.loai]), code: CC.leaveCode(row[c.loai]), nam: d.getFullYear(), thang: d.getMonth() + 1, ngay: d.getDate(),
        buoi: /sang/.test(bf) ? 's' : /chieu/.test(bf) ? 'c' : /ca ngay/.test(bf) ? 'ca' : '', so: Number(row[c.so]) || 0,
        ly: norm(row[c.ly]), gc: c.gc >= 0 ? norm(row[c.gc]) : '', tt: norm(row[c.tt]), mp: norm(row[c.mp]), kt: kt ? `${pad2(kt.getDate())}/${pad2(kt.getMonth() + 1)}/${kt.getFullYear()}` : '' });
    }
    // khoảng ngày file bao phủ: lấy theo tên file "dd_mm_yyyy đến dd_mm_yyyy", không có thì theo ngày nhỏ/lớn nhất
    let tu = null, den = null, m;
    if ((m = norm(fileName).match(/(\d{1,2})[_\-.](\d{1,2})[_\-.](\d{4}).*?(\d{1,2})[_\-.](\d{1,2})[_\-.](\d{4})/))) { tu = new Date(+m[3], +m[2] - 1, +m[1]); den = new Date(+m[6], +m[5] - 1, +m[4]); }
    else if (out.length) { const ds = out.map(p => new Date(p.nam, p.thang - 1, p.ngay)).sort((x, y) => x - y); tu = ds[0]; den = ds[ds.length - 1]; }
    return { rows: out, fileName: fileName || '', tu, den };
  };
  const huy = p => /huy|tu choi/.test(fold(p.tt));
  CC.leaveText = p => `Phiếu ${p.mp}: ${p.loai}${p.buoi === 's' ? ' (sáng)' : p.buoi === 'c' ? ' (chiều)' : p.buoi === 'ca' ? ' (cả ngày)' : ''} · ${p.tt}${p.ly ? ' · ' + p.ly : ''}${p.gc ? ' · ' + p.gc : ''}`;
  // mã gợi ý theo phiếu + mã đang có (dùng đúng các mã mà công thức mẫu có đếm)
  CC.suggestCode = (p, cur) => {
    const L = p.code, cu = fold(cur), work = ['x', 's', 'c'].includes(cu) || /(^|\/)(x|s|c)$|^(x|s|c)\//.test(cu);
    if (!['P', 'Ro', 'CT', 'Ô', 'R', 'On'].includes(L)) return '';
    if (p.buoi !== 's' && p.buoi !== 'c') return L;
    if (L === 'P') return p.buoi === 's' ? (work ? 'C/P.s' : 'P.s') : 'S/P.c';
    if (L === 'Ro') return p.buoi === 's' ? (work ? 'Ro.s/C' : 'Ro.s') : 'S/Ro.c';
    if (L === 'CT') return p.buoi === 's' ? (work ? 'CT.s/C' : 'CT.s') : 'CT/2';
    if (L === 'R') return 'R.s';
    return L + '/2';
  };
  // mã công đã thể hiện loại nghỉ của phiếu chưa
  const parts = code => fold(code).split('/').map(x => x.replace(/\.(s|c)$/, '').replace(/2$/, ''));
  const covers = (code, p) => {
    const L = fold(p.code);
    if (p.buoi === 's' || p.buoi === 'c') return parts(code).includes(L) && fold(code) !== L;
    return fold(code) === L;
  };
  const NEEDS = ['p', 'ro', 'r', 'o', 'ct', 'on'];
  // đối chiếu phiếu của sheet với mã công: trả về danh sách việc cần xem
  CC.leaveCheck = sh => {
    const list = sh.phieu || [], byMa = {};
    sh.rows.forEach((r, i) => { if (r.t === 'nv') byMa[r.ma] = i; });
    const cell = {}, issues = [], nghiViec = {};
    list.forEach(p => {
      if (p.code === 'NV' && !huy(p)) { const o = nghiViec[p.ma] = nghiViec[p.ma] || { ma: p.ma, ten: p.ten, tt: p.tt, ly: p.ly, kt: p.kt }; if (p.so > 0) o.ngay = `${pad2(p.ngay)}/${pad2(p.thang)}/${p.nam}`; return; }
      const i = byMa[p.ma]; if (i === undefined || p.ngay > sh.n) return;
      (cell[i + '|' + (p.ngay - 1)] = cell[i + '|' + (p.ngay - 1)] || []).push(p);
    });
    Object.entries(cell).forEach(([key, ps]) => {
      const [i, k] = key.split('|').map(Number), r = sh.rows[i], code = r.d[k] || '';
      if (CC.isAuto(r)) return; // sếp: tự động đủ công, phiếu chỉ để xem
      const act = ps.filter(p => !huy(p) && ['P', 'Ro', 'CT', 'Ô', 'R', 'On'].includes(p.code));
      act.forEach(p => {
        if (covers(code, p)) return;
        issues.push({ i, k, ma: r.ma, ten: r.ten, code, p, goiY: CC.suggestCode(p, code), kieu: 'phieu' });
      });
    });
    // mã nghỉ trên bảng nhưng không có phiếu (còn hiệu lực) trên hệ thống — chỉ trong khoảng ngày file phiếu bao phủ
    const [pTu, pDen] = sh.phieuNgay || [1, sh.n];
    sh.rows.forEach((r, i) => {
      if (r.t !== 'nv' || CC.isAuto(r)) return;
      r.d.forEach((code, k) => {
        if (k + 1 < pTu || k + 1 > pDen) return;
        if (!code || !parts(code).some(x => NEEDS.includes(x))) return;
        const ps = (cell[i + '|' + k] || []).filter(p => !huy(p));
        if (ps.length) return;
        const all = cell[i + '|' + k] || [];
        issues.push({ i, k, ma: r.ma, ten: r.ten, code, p: all[0] || null, goiY: '', kieu: 'khongPhieu' });
      });
    });
    issues.sort((a, b) => a.i - b.i || a.k - b.k);
    return { cell, issues, nghiViec: Object.values(nghiViec) };
  };
  // gắn phiếu vào các sheet tháng tương ứng (ghi đè phiếu cũ của tháng đó)
  CC.attachLeave = (archive, lv) => {
    const byKy = {};
    lv.rows.forEach(p => { (byKy[`${p.nam}-${pad2(p.thang)}`] = byKy[`${p.nam}-${pad2(p.thang)}`] || []).push(p); });
    const res = { gan: [], thieuThang: [] };
    Object.entries(byKy).forEach(([ky, ps]) => {
      const shs = Object.values(archive).filter(s => s.ky === ky);
      if (!shs.length) { res.thieuThang.push({ ky, n: ps.length }); return; }
      shs.forEach(sh => {
        const mas = new Set(sh.rows.filter(r => r.t === 'nv').map(r => r.ma));
        sh.phieu = ps.filter(p => mas.has(p.ma));
        const first = new Date(sh.nam, sh.thang - 1, 1), last = new Date(sh.nam, sh.thang - 1, sh.n);
        const a = lv.tu && lv.tu > first ? lv.tu.getDate() : 1, b = lv.den && lv.den < last ? lv.den.getDate() : sh.n;
        sh.phieuNgay = [a, b];
        // phiếu nghỉ việc của tháng sau vẫn giữ để báo
        sh.phieuFile = lv.fileName; sh.savedAt = new Date().toISOString();
        res.gan.push({ id: sh.id, ten: sh.ten, n: sh.phieu.length });
      });
    });
    // nghỉ việc ở tháng chưa có sheet -> gắn vào sheet chính mới nhất để báo trước
    const latest = CC.mainSheets(archive).pop();
    if (latest) {
      const mas = new Set(latest.rows.filter(r => r.t === 'nv').map(r => r.ma));
      const extra = lv.rows.filter(p => p.code === 'NV' && `${p.nam}-${pad2(p.thang)}` > latest.ky && mas.has(p.ma));
      if (extra.length) latest.phieu = (latest.phieu || []).concat(extra);
    }
    return res;
  };

  // ------------------------------------------------------------ 2b') tự động đủ công (2 sếp: Phương Thu, Đinh Minh Tuấn)
  // như các tháng trước: T2–T6 = X, T7 = S, CN trống, ngày lễ = L. Chỉ điền ô đang trống.
  CC.AUTO_DEFAULT = ['010205', '013862'];
  CC.isAuto = r => r.t === 'nv' && (r.tuDong ?? CC.AUTO_DEFAULT.includes(r.ma));
  CC.holidays = sh => {
    if (sh.le) return sh.le;
    const nv = sh.rows.filter(r => r.t === 'nv' && !CC.isAuto(r)), out = [];
    for (let k = 0; k < sh.n; k++) { const c = nv.filter(r => fold(r.d[k]) === 'l').length; if (nv.length && c >= nv.length * 0.3) out.push(k + 1); }
    return out;
  };
  CC.autoFill = sh => {
    const le = CC.holidays(sh); let n = 0;
    sh.rows.forEach(r => {
      if (!CC.isAuto(r)) return;
      if (r.d.length < sh.n) r.d = r.d.concat(Array(sh.n - r.d.length).fill(''));
      for (let k = 0; k < sh.n; k++) {
        if (r.d[k]) continue;
        const wd = new Date(sh.nam, sh.thang - 1, k + 1).getDay();
        const v = le.includes(k + 1) ? 'L' : wd === 0 ? '' : wd === 6 ? 'S' : 'X';
        if (v) { r.d[k] = v; n++; }
      }
    });
    return n;
  };

  // ------------------------------------------------------------ 2c) ngày lễ: L cho nhân viên chính thức, Ro cho thử việc
  // (như các tháng trước: thử việc = nhận việc chưa đủ tvThang tháng tính tới ngày lễ; chưa nhận việc -> để trống)
  CC.startDate = (row, sh) => {
    const bb = row.tail && row.tail[T.BB] && row.tail[T.BB].v;
    const m = fold(bb).match(/nhan viec\s*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (m) { let y = +m[3]; if (y < 100) y += 2000; return new Date(y, +m[2] - 1, +m[1]); }
    return null;
  };
  CC.applyHoliday = (sh, days, tvThang = 2) => {
    const res = { L: [], Ro: [], giu: [], boQua: [] };
    sh.le = [...new Set((sh.le || []).concat(days))].sort((a, b) => a - b);
    sh.rows.forEach(r => {
      if (r.t !== 'nv') return;
      if (CC.isAuto(r)) { days.forEach(d => { if (!r.d[d - 1] || /^(x|s)$/.test(fold(r.d[d - 1]))) { r.d[d - 1] = 'L'; res.L.push({ ma: r.ma, ten: r.ten, ngay: d }); } }); return; }
      const others = r.d.some((v, k) => v && !days.includes(k + 1));
      if (!others) { res.boQua.push({ ma: r.ma, ten: r.ten, ly: 'trống cả tháng' }); return; }
      const st = CC.startDate(r, sh);
      days.forEach(d => {
        const k = d - 1, hol = new Date(sh.nam, sh.thang - 1, d);
        if (r.d[k]) { if (fold(r.d[k]) !== 'l') res.giu.push({ ma: r.ma, ten: r.ten, ngay: d, code: r.d[k] }); return; }
        if (st && st > hol) { res.boQua.push({ ma: r.ma, ten: r.ten, ly: `chưa nhận việc (${pad2(st.getDate())}/${pad2(st.getMonth() + 1)})`, ngay: d }); return; }
        const lim = new Date(hol); lim.setMonth(lim.getMonth() - tvThang);
        const code = st && st > lim ? 'Ro' : 'L';
        r.d[k] = code; res[code].push({ ma: r.ma, ten: r.ten, ngay: d });
      });
    });
    return res;
  };

  // ------------------------------------------------------------ 3) dựng / cập nhật sheet tháng từ BCC
  // archive: { id: sheet }; trả về { sheet, bao }
  CC.mainSheets = archive => Object.values(archive).filter(s => !s.phu).sort((a, b) => a.ky < b.ky ? -1 : 1);
  CC.prevMain = (archive, ky) => CC.mainSheets(archive).filter(s => s.ky < ky).pop() || null;

  const cleanCv = s => { s = norm(s); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; };
  function firstDay(d, thang, nam) { const i = d.findIndex(v => v); return i < 0 ? '' : `${pad2(i + 1)}.${pad2(thang)}.${nam}`; }

  CC.buildFromBCC = (archive, bcc, thang, nam) => {
    const ky = `${nam}-${pad2(thang)}`, n = CC.daysIn(nam, thang);
    const existing = archive[ky];
    const prev = CC.prevMain(archive, ky);
    const base = existing || prev;
    if (!base) throw new Error('Chưa có tháng nào trước đó để làm mẫu — hãy nạp file bảng chấm công tổng (các tháng cũ) trước.');
    const byMa = {}; bcc.nv.forEach(e => { byMa[e.ma] = e; });
    const bao = { ky, capNhat: !!existing, khop: [], moi: [], thieu: [], boQua: [], lech: [] };
    let sh;
    if (existing) {
      sh = JSON.parse(JSON.stringify(existing));
      if (sh.n !== n) throw new Error(`Sheet ${sh.ten} có ${sh.n} cột ngày, tháng ${thang}/${nam} có ${n} ngày.`);
    } else {
      // tháng mới: chép danh sách + công thức tháng trước, công thức dịch theo số ngày
      const fx = [], fxIdx = {};
      const fxOf = t => { if (!(t in fxIdx)) { fxIdx[t] = fx.length; fx.push(t); } return fxIdx[t]; };
      const baRow = tailCol(prev.n, T.BA);
      const axTpl = `VLOOKUP(B{r},'${prev.ten}'!$B$9:$${colL(baRow)}$${CC.lastRow(prev) + 20},${baRow - 1},0)`;
      const rows = prev.rows.map(r => {
        if (r.t !== 'nv') return Object.assign({}, r);
        const tail = CC.TAIL.map((_, i) => {
          const o = r.tail && r.tail[i] || null;
          if (i === T.AX) return { x: fxOf(axTpl) };
          if (i === T.AW || i === T.AY) return o && o.v !== undefined && o.x === undefined ? { v: o.v } : (o && o.v !== undefined ? { v: o.v } : null);
          if (i === T.BB) return o && o.v !== undefined ? { v: o.v } : null;
          const t = o && o.x !== undefined ? shiftCols(prev.fx[o.x], prev.n, n) : stdTpl(i, n);
          return t ? { x: fxOf(t) } : null;
        });
        return { t: 'nv', ma: r.ma, ten: r.ten, pb: r.pb, cv: r.cv, d: Array(n).fill(''), tail };
      });
      const pm = thang === 1 ? 12 : thang - 1, py = thang === 1 ? nam - 1 : nam;
      sh = { id: ky, ten: CC.sheetName(thang, nam), ky, thang, nam, phu: '', n, ord: -1, phepTon: `Phép tồn ${pm}/${String(py).slice(2)}`, rows, fx, nguon: 'BCC' };
    }
    const fxOf2 = t => { let i = sh.fx.indexOf(t); if (i < 0) { i = sh.fx.length; sh.fx.push(t); } return i; };
    // điền công
    const team = []; let curTeam = -1;
    sh.rows.forEach((r, i) => {
      if (r.t === 'team') curTeam = i;
      team[i] = curTeam;
      if (r.t !== 'nv') return;
      const e = byMa[r.ma];
      if (!e) { if (!CC.isAuto(r)) bao.thieu.push({ ma: r.ma, ten: r.ten }); return; }
      r.d = Array.from({ length: n }, (_, k) => e.d[k] || '');
      if (fold(e.ten) !== fold(r.ten)) bao.lech.push({ ma: r.ma, ten: r.ten, tenBCC: e.ten });
      bao.khop.push(r.ma);
      e._dung = true; e._team = curTeam;
    });
    // nhân viên mới: xếp vào nhóm của những người cùng phòng ban (theo BCC)
    const pbTeam = {};
    bcc.nv.filter(e => e._dung).forEach(e => { const k = fold(e.pb); (pbTeam[k] = pbTeam[k] || {})[e._team] = (pbTeam[k][e._team] || 0) + 1; });
    const lastTeam = sh.rows.map((r, i) => r.t === 'team' ? i : -1).filter(i => i >= 0).pop();
    const moi = bcc.nv.filter(e => !e._dung && !sh.rows.some(r => r.t === 'nv' && r.ma === e.ma));
    moi.forEach(e => {
      if (!e.d.some(v => v)) { bao.boQua.push({ ma: e.ma, ten: e.ten, pb: e.pb }); return; }
      const cand = pbTeam[fold(e.pb)] || {};
      let tIdx = +Object.keys(cand).sort((a, b) => cand[b] - cand[a])[0];
      if (isNaN(tIdx) || tIdx < 0) tIdx = lastTeam ?? -1;
      // vị trí chèn: sau dòng nhân viên cuối của nhóm
      let pos = tIdx + 1;
      for (let i = tIdx + 1; i < sh.rows.length && sh.rows[i].t !== 'team'; i++) if (sh.rows[i].t === 'nv') pos = i + 1;
      const mate = sh.rows.slice(tIdx + 1, pos).filter(r => r.t === 'nv').pop();
      const tail = CC.TAIL.map((_, i) => {
        if (i === T.AX) return { v: 0 };
        if (i === T.AY) return { v: 0 };
        if (i === T.AW) return null;
        if (i === T.BB) return { v: `Nhận việc ${firstDay(e.d, thang, nam)}` };
        const mt = mate && mate.tail && mate.tail[i];
        const t = mt && mt.x !== undefined ? sh.fx[mt.x] : stdTpl(i, n);
        return t ? { x: fxOf2(t) } : null;
      });
      sh.rows.splice(pos, 0, { t: 'nv', ma: e.ma, ten: e.ten, pb: mate ? mate.pb : e.pb, cv: cleanCv(e.cv), d: Array.from({ length: n }, (_, k) => e.d[k] || ''), tail, moi: true });
      bao.moi.push({ ma: e.ma, ten: e.ten, nhom: tIdx >= 0 ? sh.rows[tIdx].text : '' });
    });
    bcc.nv.forEach(e => { delete e._dung; delete e._team; });
    bao.tuDong = CC.autoFill(sh);
    sh.savedAt = new Date().toISOString();
    sh.bcc = { file: bcc.fileName, luc: sh.savedAt };
    return { sheet: sh, bao };
  };

  // ------------------------------------------------------------ 4) tính toán (để xem trên web, và làm kết quả cache khi xuất)
  // Bộ tính công thức nhỏ: COUNTIF/COUNTIFS 1 điều kiện, VLOOKUP sang sheet khác, + - * / và tham chiếu ô cùng dòng.
  CC.evaluator = archive => {
    const byName = {}; Object.values(archive).forEach(s => { byName[fold(s.ten)] = s; });
    const cache = new Map();
    const rowOf = (sh, r) => sh.rows[r - FIRST_ROW];
    function cellVal(sh, r, c, depth) {
      const row = rowOf(sh, r);
      if (!row || row.t !== 'nv') return '';
      if (c === 2) return row.ma; if (c === 3) return row.ten; if (c === 4) return row.pb; if (c === 5) return row.cv;
      if (c >= DAY0 && c < DAY0 + sh.n) return row.d[c - DAY0] || '';
      const i = c - DAY0 - sh.n;
      if (i >= 0 && i < CC.TAIL.length) return tailVal(sh, r, i, depth + 1);
      return '';
    }
    function tailVal(sh, r, i, depth = 0) {
      const key = sh.id + '|' + r + '|' + i;
      if (cache.has(key)) return cache.get(key);
      const row = rowOf(sh, r), e = row && row.tail && row.tail[i];
      let v = '';
      if (e) {
        if (e.x !== undefined && depth < 40) {
          const ok = evalF(sh, r, sh.fx[e.x].replace(/\{r\}/g, r), depth);
          v = ok === null ? (e.v ?? '') : ok;
        } else if (e.v !== undefined) v = e.v;
      }
      cache.set(key, v);
      return v;
    }
    function evalF(sh, r, f, depth) {
      try {
        let s = f.replace(/^\+/, '');
        s = s.replace(/COUNTIFS?\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*,\s*"([^"]*)"\s*\)/g, (m, c1, r1, c2, r2, crit) => {
          const want = fold(crit); let k = 0;
          for (let rr = +r1; rr <= +r2; rr++) for (let c = colN(c1); c <= colN(c2); c++) { const v = cellVal(sh, rr, c, depth); if (v !== '' && fold(v) === want) k++; }
          return String(k);
        });
        s = s.replace(/VLOOKUP\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*,\s*'([^']+)'!\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+\s*,\s*(\d+)\s*,\s*(?:0|FALSE)\s*\)/gi, (m, c, rr, name, idx) => {
          const key = cellVal(sh, +rr, colN(c), depth), other = byName[fold(name)];
          if (!other) throw new Error('nosheet');
          const pos = other.rows.findIndex(x => x.t === 'nv' && x.ma === key);
          if (pos < 0) throw new Error('#N/A');
          const v = cellVal(other, FIRST_ROW + pos, 1 + +idx, depth);
          return '(' + (Number(v) || 0) + ')';
        });
        s = s.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (m, c, rr) => { const v = cellVal(sh, +rr, colN(c), depth); const x = Number(v); return '(' + (v === '' || isNaN(x) ? 0 : x) + ')'; });
        if (!/^[\d+\-*/().\s]*$/.test(s)) return null;
        const v = Function('return (' + (s || 0) + ')')();
        return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
      } catch (e) { return null; }
    }
    return { tailVal, cellVal };
  };

  // các mã không được công thức nào của dòng đếm tới (để cảnh báo)
  CC.codesCounted = (sh, row) => {
    const set = new Set();
    (row.tail || []).forEach(e => { if (e && e.x !== undefined) { const f = sh.fx[e.x]; f.replace(/COUNTIFS?\([^,]+,\s*"([^"]*)"\)/g, (m, c) => { set.add(fold(c)); return m; }); } });
    return set;
  };

  // ------------------------------------------------------------ 5) xuất Excel (ExcelJS) — đúng bố cục mẫu
  const TNR = 'Times New Roman';
  const thin = { style: 'thin' }, BOX = { top: thin, left: thin, bottom: thin, right: thin };
  const solid = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const NF1 = '_(* #,##0.0_);_(* \\(#,##0.0\\);_(* "-"_);_(@_)';
  const GREEN = 'FF92D050', YELLOW = 'FFFFFF00', TONG = 'FFA9D08E', SUMF = 'FFDDEBF7';

  function writeSheet(wb, sh, ev, names) {
    const n = sh.n, lastDay = DAY0 + n - 1, tc = i => tailCol(n, i), L = colL;
    const ws = wb.addWorksheet(sh.ten.slice(0, 31), {
      views: [{ state: 'frozen', xSplit: 5, ySplit: 7, zoomScale: 85 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '5:7', margins: { left: 0.2, right: 0.2, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } },
    });
    const lastCol = tc(T.BB);
    // độ rộng cột
    const W = { 1: 5.4, 2: 9.9, 3: 27, 4: 11.3, 5: 11 };
    for (let c = 1; c <= lastCol; c++) {
      const col = ws.getColumn(c);
      col.width = W[c] || (c <= lastDay ? 5.2 : 8);
    }
    [[T.TONG, 8.5], [T.TG, 8.5], [T.P, 6.5], [T.AW, 9.4], [T.AX, 9], [T.AY, 7], [T.AZ, 9], [T.BA, 9.5], [T.BB, 25.4]].forEach(([i, w]) => { ws.getColumn(tc(i)).width = w; });
    ws.getColumn(tc(T.B)).hidden = true; ws.getColumn(tc(T.HT)).hidden = true;

    const put = (r, c, v, st) => { const cell = ws.getCell(r, c); if (v !== undefined) cell.value = v; if (st) Object.assign(cell, st); return cell; };
    const f = (formula, result) => ({ formula, result });
    // --- dòng 1-2: tên công ty, mã biểu mẫu
    ws.mergeCells(1, 2, 1, 20); put(1, 2, 'CÔNG TY CỔ PHẦN DƯỢC PHẨM CPC1 HÀ NỘI', { font: { name: TNR, size: 12 }, alignment: { horizontal: 'center' } });
    ws.mergeCells(2, 2, 2, 20); put(2, 2, 'PHÒNG KINH DOANH CN HỒ CHÍ MINH', { font: { name: TNR, size: 12, bold: true }, alignment: { horizontal: 'center' } });
    put(1, tc(T.TG), 'BM - 09/HC-CPC1HN', { font: { name: TNR, size: 12, bold: true } });
    put(2, tc(T.TG), 'AD: 01/04/2015', { font: { name: TNR, size: 12, bold: true } });
    ws.getRow(1).height = 27.75; ws.getRow(2).height = 21;
    // --- dòng 4: tiêu đề
    ws.mergeCells(4, 1, 4, tc(T.BA));
    put(4, 1, f('+"BẢNG CHẤM CÔNG THÁNG "&C5&" NĂM "&C6', `BẢNG CHẤM CÔNG THÁNG ${sh.thang} NĂM ${sh.nam}`), { font: { name: TNR, size: 20, bold: true }, alignment: { horizontal: 'center', vertical: 'middle' } });
    ws.getRow(4).height = 42;
    // --- dòng 5-7: tiêu đề bảng
    const H = { font: { name: TNR, size: 12, bold: true }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: BOX };
    const H11 = { font: { name: TNR, size: 11 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true }, border: BOX };
    for (let r = 5; r <= 7; r++) for (let c = 1; c <= lastCol; c++) ws.getCell(r, c).border = BOX;
    ws.mergeCells(5, 1, 5, 2); put(5, 1, 'Tháng', H11);
    ws.mergeCells(5, 3, 5, 5); put(5, 3, sh.thang, H11);
    ws.mergeCells(6, 1, 6, 2); put(6, 1, 'Năm', H11);
    ws.mergeCells(6, 3, 6, 5); put(6, 3, sh.nam, H11);
    ws.mergeCells(5, DAY0, 5, lastDay); put(5, DAY0, 'Ngày trong tháng', H);
    ws.mergeCells(5, tc(T.TG), 5, tc(T.HT)); put(5, tc(T.TG), 'Tổng cộng', H);
    ws.mergeCells(5, tc(T.AX), 5, tc(T.BA)); put(5, tc(T.AX), '', H);
    put(5, tc(T.TONG), '', H); put(5, tc(T.AW), '', H);
    ws.mergeCells(5, tc(T.BB), 7, tc(T.BB)); put(5, tc(T.BB), 'Ghi Chú', H);
    ['TT', 'Mã NV', 'Họ và tên', 'Phòng ban', 'Chức \nvụ'].forEach((t, i) => put(7, i + 1, t, Object.assign({}, H11, i >= 3 ? { font: { name: TNR, size: 9 } } : {})));
    for (let k = 0; k < n; k++) {
      const c = DAY0 + k, L1 = L(c), dt = new Date(Date.UTC(sh.nam, sh.thang - 1, k + 1)), wd = dt.getUTCDay();
      put(6, c, f(`+IF(WEEKDAY(${L1}7)=1,"CN",WEEKDAY(${L1}7))`, wd === 0 ? 'CN' : wd + 1), Object.assign({}, H11, wd === 0 ? { font: { name: TNR, size: 11, bold: true, color: { argb: 'FFFF0000' } } } : {}));
      put(7, c, k === 0 ? f('+DATE($C$6,C5,1)', dt) : f(`+${L(c - 1)}7+1`, dt), Object.assign({}, H11, { font: { name: TNR, size: 11, bold: true }, numFmt: 'dd' }));
    }
    CC.TAIL.forEach((t, i) => {
      if (i === T.BB) return;
      const c = tc(i);
      ws.mergeCells(6, c, 7, c);
      let v = t;
      if (i === T.AX) v = sh.phepTon || 'Phép tồn';
      if (i === T.AY) v = f('+"Phép tháng "&C5&""', `Phép tháng ${sh.thang}`);
      if (i === T.AZ) v = f('+"Tổng phép tháng "&C5&""', `Tổng phép tháng ${sh.thang}`);
      if (i === T.BA) v = f('+"Phép tồn sau tháng "&C5&""', `Phép tồn sau tháng ${sh.thang}`);
      const st = Object.assign({}, H, i >= T.AX ? { font: { name: TNR, size: 9, bold: true } } : {});
      if (i === T.TONG) st.fill = solid(TONG);
      if (i === T.AY) st.fill = solid(YELLOW);
      put(6, c, v, st);
    });
    ws.getRow(5).height = 22.5; ws.getRow(6).height = 27; ws.getRow(7).height = 45;

    // --- dữ liệu
    const D11 = { font: { name: TNR, size: 11 }, alignment: { horizontal: 'center', vertical: 'middle' }, border: BOX };
    let firstNv = 0;
    sh.rows.forEach((row, k) => {
      const r = FIRST_ROW + k, xr = ws.getRow(r);
      if (row.t === 'team') {
        for (let c = 1; c <= lastCol; c++) put(r, c, undefined, { fill: solid(GREEN), border: BOX, font: { name: TNR, size: 9, bold: true, color: { argb: 'FF002060' } }, alignment: { vertical: 'middle', horizontal: 'center', wrapText: true } });
        put(r, 1, 'Team', { font: { name: TNR, size: 11, bold: true, color: { argb: 'FFFF0000' } }, alignment: { vertical: 'middle' } });
        put(r, 3, row.text, { font: { name: TNR, size: 11, bold: true, color: { argb: 'FFFF0000' } } });
        xr.height = 30; return;
      }
      if (row.t !== 'nv') { for (let c = 1; c <= lastCol; c++) put(r, c, undefined, D11); return; }
      if (!firstNv) firstNv = r;
      put(r, 1, f(`IF(B${r}="","",SUBTOTAL(3,$B$${FIRST_ROW}:B${r}))`), D11);
      put(r, 2, row.ma, Object.assign({}, D11, { numFmt: '@', font: { name: TNR, size: 10 } }));
      put(r, 3, row.ten, Object.assign({}, D11, { alignment: { horizontal: 'left', vertical: 'middle' } }));
      put(r, 4, row.pb, Object.assign({}, D11, { font: { name: TNR, size: 8 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } }));
      put(r, 5, row.cv, Object.assign({}, D11, { font: { name: TNR, size: 8 }, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } }));
      for (let i = 0; i < n; i++) {
        const cell = put(r, DAY0 + i, row.d[i] || null, D11);
        if (row.hl && row.hl[i]) cell.fill = solid(row.hl[i]);
        if (row.cm && row.cm[i]) cell.note = row.cm[i];
      }
      CC.TAIL.forEach((_, i) => {
        const e = row.tail && row.tail[i], c = tc(i);
        let v = null;
        if (e && e.x !== undefined) {
          const res = ev ? ev.tailVal(sh, r, i) : e.v, fx = sh.fx[e.x];
          const ref = fx.match(/'([^']+)'!/);
          // công thức trỏ sang sheet không có trong file xuất -> ghi số
          if (ref && !names.has(fold(ref[1]))) v = res === '' ? null : res;
          else v = f(fx.replace(/\{r\}/g, r), res === '' ? undefined : res);
        }
        else if (e && e.v !== undefined) v = e.v;
        const st = Object.assign({}, D11);
        if (i === T.TONG) { st.fill = solid(TONG); st.font = { name: TNR, size: 11, bold: true }; st.numFmt = NF1; }
        else if (i >= T.TG && i <= T.HT) { st.font = { name: TNR, size: 9, bold: true }; st.numFmt = '0.0;-0.0;""'; }
        else if (i === T.AY) st.fill = solid(YELLOW);
        else if (i === T.BB) st.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        else if (i !== T.AW) st.numFmt = '0.0;-0.0;0';
        if (e && e.hl) st.fill = solid(e.hl);
        const cell = put(r, c, v, st);
        if (e && e.cm) cell.note = e.cm;
      });
      xr.height = 30;
    });
    const last = CC.lastRow(sh);
    // --- dòng tổng
    const rs = last + 1;
    ws.mergeCells(rs, 1, rs, lastDay); put(rs, 1, 'Tổng cộng', { font: { name: TNR, size: 12, bold: true }, alignment: { horizontal: 'center', vertical: 'middle' }, border: BOX });
    for (let i = 0; i <= T.AW; i++) {
      const c = tc(i), Lc = L(c);
      let s = 0; sh.rows.forEach((row, k) => { if (row.t === 'nv' && ev) s += Number(ev.tailVal(sh, FIRST_ROW + k, i)) || 0; });
      put(rs, c, f(`SUM(${Lc}${FIRST_ROW}:${Lc}${last})`, Math.round(s * 100) / 100), { font: { name: TNR, size: 11, bold: true }, fill: solid(SUMF), alignment: { horizontal: 'center', vertical: 'middle' }, border: BOX, numFmt: NF1 });
    }
    for (let i = T.AX; i <= T.BB; i++) put(rs, tc(i), null, { fill: solid(SUMF), border: BOX });
    ws.getRow(rs).height = 24;
    // --- ghi chú + chữ ký
    const it = { font: { name: TNR, size: 12, italic: true } };
    put(rs + 1, 2, 'Ghi chú:', { font: { name: TNR, size: 12, bold: true } });
    [['- TG: Ngày công thời gian bao gồm ngày làm việc (x), ', '- P/B: Phép/Bù, ', 'L/T: Lễ/Tết, '],
     ['- TS: Nghỉ thai sản', '- Ro: Nghỉ không lương', 'R: nghỉ việc riêng có hưởng lương'],
     ['- Ô, Cô: Nghỉ ốm, con ốm', '- H: Đi học', '']].forEach((t, k) => {
      put(rs + 3 + k, 2, t[0], it); put(rs + 3 + k, 10, t[1], it); if (t[2]) put(rs + 3 + k, 17, t[2], it);
    });
    const sg = rs + 7, B = { font: { name: TNR, size: 12, bold: true }, alignment: { horizontal: 'center' } };
    ws.mergeCells(sg, 2, sg, 3); put(sg, 2, 'NGƯỜI CHẤM CÔNG', B);
    put(sg, 18, 'PHÒNG TÔ CHỨC HÀNH CHÍNH', B);
    ws.mergeCells(sg, tc(T.P), sg, tc(T.AY)); put(sg, tc(T.P), 'GIÁM ĐỐC CHI NHÁNH', B);
    // tô cột Chủ nhật như file gốc: định dạng có điều kiện WEEKDAY(ngày)=1 (dòng Team: xanh đậm, còn lại: xám)
    const sunRule = argb => ({ type: 'expression', formulae: [`WEEKDAY(${L(DAY0)}$7)=1`], style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb } } } });
    sh.rows.forEach((row, k) => { if (row.t === 'team') ws.addConditionalFormatting({ ref: `${L(DAY0)}${FIRST_ROW + k}:${L(lastDay)}${FIRST_ROW + k}`, rules: [Object.assign(sunRule('FF6AA84F'), { priority: 1, stopIfTrue: true })] }); });
    ws.addConditionalFormatting({ ref: `${L(DAY0)}6:${L(lastDay)}${last}`, rules: [Object.assign(sunRule('FFBFBFBF'), { priority: 2 })] });
    ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: last, column: lastCol } };
    ws.pageSetup.printArea = `A1:${L(lastCol)}${sg + 6}`;
    return ws;
  }

  // sắp xếp sheet như file gốc: tháng mới nhất trước; cùng tháng giữ thứ tự cũ (sheet chính trước)
  CC.sortSheets = list => list.slice().sort((a, b) => a.ky !== b.ky ? (a.ky < b.ky ? 1 : -1) : ((a.ord ?? -1) - (b.ord ?? -1)) || (a.phu ? 1 : 0) - (b.phu ? 1 : 0));

  CC.exportWorkbook = (ExcelJS, archive, ids) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Kho Vận HCM'; wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    const ev = CC.evaluator(archive);
    const list = CC.sortSheets(Object.values(archive).filter(s => !ids || ids.includes(s.id)));
    const names = new Set(list.map(s => fold(s.ten.slice(0, 31))));
    list.forEach(sh => writeSheet(wb, sh, ev, names));
    return wb;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CC;
  else root.CC = CC;
})(typeof window !== 'undefined' ? window : globalThis);
