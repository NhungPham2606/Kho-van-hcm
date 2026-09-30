/* ============================================================================
   Báo cáo Cận date & Chậm luân chuyển — đọc file "Báo cáo nhập xuất tồn theo
   kho số lượng và giá trị" (xuất từ phần mềm, sheet "Main", tồn theo lô).

   - Tuổi thuốc (tháng) = số tháng tròn từ NGÀY THAM CHIẾU đến hạn dùng, kiểu
     DATEDIF(..., "m") của Excel. Ngày tham chiếu mặc định = NGÀY LẬP BÁO CÁO
     (ngày xuất file, đọc từ đuôi tên file "...-YYYYMMDDhhmmss.xlsx"; không có thì
     lấy hôm nay) — như TODAY() trong Excel. Mẫu T3/2026 chỉ khớp đủ 12/12 dòng khi
     tham chiếu nằm trong 05–07/04/2026 (ngày lập báo cáo), KHÔNG phải 01/04.
   - Chậm luân chuyển: lô còn tồn cuối > 0 và SL xuất trong kỳ ≤ X% của
     (tồn đầu + nhập). Mặc định X = 20%.
   - Cận date: lô còn tồn cuối > 0 và tuổi thuốc ≤ N tháng (mặc định 12),
     kể cả đã hết hạn (tuổi < 0).
   ============================================================================ */
(function (root) {
  'use strict';
  const DEFAULTS = {
    canDateThang: 12,
    tyLeXuatToiDa: 20,
    huongCham: 'Hàng chậm luân chuyển trên 90 ngày. Thông báo bộ phận Kinh doanh, điều chuyển giữa các chi nhánh/VP',
    huongCanDate: 'Hàng cận date. Ưu tiên xuất trước (FEFO), thông báo bộ phận Kinh doanh đẩy bán / điều chuyển; hàng hết hạn lập biên bản chờ huỷ.',
  };
  const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
  const norm = s => String(s ?? '').trim();
  const pad2 = n => (n < 10 ? '0' : '') + n;

  function toDate(v) {
    if (typeof v === 'number' && isFinite(v)) { const d = new Date(EXCEL_EPOCH_MS + Math.round(v) * 864e5); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }; }
    if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? { y: +m[3], m: +m[2], d: +m[1] } : null;
  }
  const iso = o => o ? `${o.y}-${pad2(o.m)}-${pad2(o.d)}` : '';
  const vn = o => o ? `${pad2(o.d)}/${pad2(o.m)}/${o.y}` : '';
  // DATEDIF(from, to, "m"): số tháng tròn; âm nếu đã qua hạn
  function monthsBetween(from, to) {
    if (!from || !to) return null;
    const sign = iso(to) >= iso(from) ? 1 : -1;
    const [a, b] = sign > 0 ? [from, to] : [to, from];
    let m = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d < a.d) m -= 1;
    return sign * m;
  }

  // Đọc sheet: tự dò dòng tiêu đề ("Mã vật tư") và các nhóm Tồn đầu/Nhập/Xuất/Tồn cuối
  function parse(XLSX, wb, fileName) {
    const wsName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'main') || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { header: 1, raw: true, defval: null });
    let hr = -1;
    for (let i = 0; i < Math.min(aoa.length, 40); i++) if ((aoa[i] || []).some(v => norm(v).toLowerCase() === 'mã vật tư')) { hr = i; break; }
    if (hr < 0) throw new Error('Không tìm thấy dòng tiêu đề có cột "Mã vật tư". File có đúng là "Báo cáo nhập xuất tồn theo lô" không?');
    const H = aoa[hr].map(v => norm(v).toLowerCase()), S = (aoa[hr + 1] || []).map(v => norm(v).toLowerCase());
    const col = name => H.indexOf(name);
    const grp = name => {
      const g = H.indexOf(name); if (g < 0) return null;
      let sl = -1, gt = -1;
      for (let c = g; c < Math.min(g + 6, S.length); c++) { if (sl < 0 && S[c] === 'số lượng') sl = c; else if (gt < 0 && S[c] === 'giá trị') gt = c; }
      return { sl, gt };
    };
    const C = { ma: col('mã vật tư'), ten: col('tên hàng hóa') >= 0 ? col('tên hàng hóa') : col('tên vật tư'), kho: col('kho'), dvt: col('đvt'),
      lo: col('lô'), hd: col('hạn dùng'), nsx: col('nhà sx'), td: grp('tồn đầu'), nh: grp('nhập'), xu: grp('xuất'), tc: grp('tồn cuối') };
    const miss = Object.entries({ 'Mã vật tư': C.ma, 'Tên hàng hóa': C.ten, 'Kho': C.kho, 'Lô': C.lo, 'Hạn dùng': C.hd }).filter(([, v]) => v < 0).map(([k]) => k);
    if (!C.td || !C.nh || !C.xu || !C.tc) miss.push('nhóm Tồn đầu / Nhập / Xuất / Tồn cuối');
    if (miss.length) throw new Error('Thiếu cột: ' + miss.join(', '));

    // Kỳ báo cáo: dòng "Từ ngày dd/mm/yyyy đến ngày dd/mm/yyyy"
    let tu = null, den = null;
    for (let i = 0; i < hr; i++) {
      const t = (aoa[i] || []).map(norm).join(' ');
      const m = t.match(/từ ngày\s*(\d{1,2}\/\d{1,2}\/\d{4}).*?đến ngày\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (m) { tu = toDate(m[1]); den = toDate(m[2]); break; }
    }
    const n = v => (typeof v === 'number' ? v : Number(v) || 0);
    const rows = [];
    for (let i = hr + 2; i < aoa.length; i++) {
      const r = aoa[i]; if (!r) continue;
      const ma = norm(r[C.ma]); if (!ma) continue;
      const tc = n(r[C.tc.sl]);
      rows.push({
        ma, ten: norm(r[C.ten]), kho: norm(r[C.kho]), dvt: norm(r[C.dvt]), lo: norm(r[C.lo]), nsx: C.nsx >= 0 ? norm(r[C.nsx]) : '',
        hd: iso(toDate(r[C.hd])),
        tdSL: n(r[C.td.sl]), nhSL: n(r[C.nh.sl]), xuSL: n(r[C.xu.sl]), tcSL: tc,
        tcGT: C.tc.gt >= 0 ? n(r[C.tc.gt]) : 0, xuGT: C.xu.gt >= 0 ? n(r[C.xu.gt]) : 0,
      });
    }
    if (!rows.length) throw new Error('Không có dòng dữ liệu nào (cột "Mã vật tư" trống).');
    const fm = String(fileName || '').match(/(20\d{2})(\d{2})(\d{2})\d{0,6}\.xlsx?$/i);
    const ngayXuat = fm ? `${fm[1]}-${fm[2]}-${fm[3]}` : '';
    return { fileName, tu: iso(tu), den: iso(den), ngayXuat, soDong: rows.length, rows: rows.filter(r => r.tcSL > 0) };
  }

  // Ngày tham chiếu mặc định = ngày lập báo cáo (ngày xuất file), không có thì hôm nay
  function refDefault(data) {
    if (data && data.ngayXuat) return data.ngayXuat;
    const t = new Date();
    return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  }

  function analyse(data, opt) {
    const o = Object.assign({}, DEFAULTS, opt || {});
    const ref = toDate((o.ngayThamChieu || refDefault(data)).split('-').reverse().join('/'));
    const list = data.rows.map(r => {
      const hd = r.hd ? toDate(r.hd.split('-').reverse().join('/')) : null;
      const tuoi = monthsBetween(ref, hd);
      const coSo = r.tdSL + r.nhSL;
      const tyLe = coSo > 0 ? (r.xuSL / coSo) * 100 : (r.xuSL > 0 ? 100 : 0);
      return Object.assign({}, r, { tuoi, tyLeXuat: tyLe,
        cham: tyLe <= o.tyLeXuatToiDa,
        canDate: tuoi !== null && tuoi <= o.canDateThang });
    });
    const byTuoi = (a, b) => (a.tuoi ?? 9999) - (b.tuoi ?? 9999) || a.ma.localeCompare(b.ma) || a.lo.localeCompare(b.lo);
    list.sort(byTuoi);
    return { opt: o, ref: iso(ref), list, cham: list.filter(r => r.cham), canDate: list.filter(r => r.canDate) };
  }

  // Màu ô tuổi thuốc — giống thang màu của mẫu (đỏ → cam → vàng → xanh)
  function tuoiColor(t) {
    if (t === null || t === undefined) return { bg: '#E5E7EB', fg: '#374151' };
    if (t < 0) return { bg: '#C00000', fg: '#FFFFFF' };
    if (t <= 8) return { bg: '#F8696B', fg: '#1F2937' };
    if (t <= 10) return { bg: '#FAA875', fg: '#1F2937' };
    if (t <= 12) return { bg: '#F6E27E', fg: '#1F2937' };
    if (t <= 23) return { bg: '#B7DD85', fg: '#1F2937' };
    if (t <= 26) return { bg: '#8CC97C', fg: '#1F2937' };
    return { bg: '#63BE7B', fg: '#1F2937' };
  }

  root.TonKho = { DEFAULTS, parse, analyse, refDefault, tuoiColor, vnDate: s => s ? s.split('-').reverse().join('/') : '' };
})(typeof self !== 'undefined' ? self : window);
