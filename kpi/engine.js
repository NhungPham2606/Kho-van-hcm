/* ============================================================================
   Tổng hợp thưởng KPIs VP.HCM (Kế toán - Kho vận CN Hồ Chí Minh)
   Quy tắc (xác nhận với người dùng 2026-10-01):
   - Điểm ban đầu = TỔNG ĐIỂM trong file KPI con của từng nhân viên.
   - Tổng điểm trừ = ĐIỂM TRỪ trong file con + nghỉ phép (5 điểm/ngày, nửa ngày
     làm tròn lên: 2,5 ngày -> 15) + trừ khác nhập tay (kèm lý do).
   - Tổng còn lại = ban đầu - tổng trừ; % = còn lại / 1000.
   - Xếp loại: < 850 D; 850–900 C; 901–950 B; > 950 A (như công thức file tổng hợp).
   - Mức thưởng: KV bắt đầu bằng "KT" hoặc "ADETC" -> bảng Kế toán, còn lại -> bảng
     Kho - Giao hàng - Lái xe. Không nộp KPIs -> D, 0đ.
   - Thử việc tháng đầu (TV1): không thưởng; từ tháng thứ 2 (TV2) thưởng bình thường.
   - Nghỉ thai sản (ts trên danh sách NV, chép sang các kỳ sau): tháng nào nằm trong khoảng
     từ ngày – đến ngày (đến ngày bỏ trống = chưa đi làm lại) thì không thưởng, không tính "chưa nộp".
   ============================================================================ */
(function (root) {
  'use strict';
  const RULES = {
    diemPhepMoiNgay: 5,
    phepKhongTru: 1.5,                    // nghỉ phép <= 1,5 ngày: không trừ; từ 2 ngày: trừ mọi ngày
    nguong: { C: 850, B: 901, A: 951 },  // điểm còn lại >= ngưỡng
    mucKho: { A: 1000000, B: 800000, C: 600000, D: 0 },
    mucKeToan: { A: 900000, B: 700000, C: 500000, D: 0 },
    keToanKV: ['KT', 'ADETC'],
  };
  const norm = s => String(s ?? '').trim();
  const normMa = s => String(s ?? '').replace(/\s+/g, '').replace(/^'/, '');
  const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.')) || 0);

  // ---- file tổng hợp tháng trước -> danh sách nhân viên theo nhóm
  function parseRoster(XLSX, wb) {
    const name = wb.SheetNames.find(n => /vp\.?hcm/i.test(n)) || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    let hr = aoa.findIndex(r => r && r.some(v => norm(v).toLowerCase() === 'mã nv'));
    if (hr < 0) throw new Error('Không tìm thấy dòng tiêu đề "Mã NV" trong file tổng hợp.');
    const H = aoa[hr].map(v => norm(v).toLowerCase().replace(/\s+/g, ' '));
    const c = k => H.findIndex(h => h.startsWith(k));
    const C = { ma: c('mã nv'), ten: c('họ và tên'), gc: c('ghi chú'), kv: c('kv') };
    const list = []; let group = '';
    for (let i = hr + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const a = norm(r[0]);
      if (/^tổng cộng/i.test(a)) break;
      const ma = normMa(r[C.ma]);
      if (!ma && a && !norm(r[C.ten])) { group = a; continue; }
      if (!ma) continue;
      const gc = norm(r[C.gc]).toUpperCase();
      list.push({ ma, ten: norm(r[C.ten]), group, kv: norm(r[C.kv]).toUpperCase(), loai: gc === 'TV' ? 'TV2' : 'CT' });
    }
    if (!list.length) throw new Error('Không đọc được nhân viên nào từ file tổng hợp.');
    const m = (aoa.slice(0, hr).map(r => (r || []).map(norm).join(' ')).join(' ').match(/tháng\s*(\d{1,2})\s*năm\s*(\d{4})/i));
    return { list, thang: m ? +m[1] : null, nam: m ? +m[2] : null };
  }

  // ---- file KPI con của 1 nhân viên. Nhiều mẫu khác nhau:
  //   mã: "MNV: 015257" | "Mã NV: 016302" | ô "Mã NV" + ô số bên cạnh; không có mã -> khớp theo tên
  //   tên: "TÊN NV:" | "TÊN NHÂN VIÊN :" | "Họ và tên:" | "HỌ TÊN:" | "NVKT:" | ô tên đứng trước ô "Mã NV"
  //   tổng: "TỔNG ĐIỂM" | "Tổng điểm KPIs" | "TỔNG CỘNG ĐIỂM:" (lấy số cuối) | dự phòng "TỔNG"/"Tổng cộng" (số cuối = KPI đạt)
  //   trừ: "ĐIỂM TRỪ" (+ lý do ở ô chữ phía sau nếu có)
  const LBL = s => norm(s).toUpperCase().replace(/[\s:]+/g, '');
  const RE_TONG = /^TỔNG(CỘNG)?ĐIỂM(KPIS?)?$/, RE_TONG2 = /^TỔNG(CỘNG)?$/, RE_TRU = /^(TỔNG)?ĐIỂMTRỪ$/;
  const isNum = v => v !== null && v !== '' && String(v).trim() !== '' && !isNaN(num(v));
  function sheetInfo(XLSX, ws) {
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const hi = aoa.findIndex(r => r && r.some(v => norm(v).toLowerCase() === 'nhóm việc'));
    const find = re => {
      for (let i = Math.max(hi, 0); i < aoa.length; i++) {
        const r = aoa[i] || [], j = r.findIndex(v => re.test(LBL(v)));
        if (j >= 0) return { r, j };
      }
      return null;
    };
    const hit = find(RE_TONG) || find(RE_TONG2);
    return { aoa, hi, hit };
  }
  function parseKpiFile(XLSX, wb, fileName) {
    // chọn sheet có bảng "Nhóm việc" + dòng tổng; ưu tiên tên sheet KPI / Kết quả
    const order = wb.SheetNames.slice().sort((a, b) => (/kpi|kết quả/i.test(b) && !/chi tiết/i.test(b)) - (/kpi|kết quả/i.test(a) && !/chi tiết/i.test(a)));
    let S = null;
    for (const n of order) { const s = sheetInfo(XLSX, wb.Sheets[n]); if (s.hi >= 0 && s.hit) { S = s; break; } if (!S && s.hit) S = s; }
    if (!S) throw new Error('không thấy dòng "TỔNG ĐIỂM"');
    const { aoa, hi, hit } = S;
    const head = aoa.slice(0, hi >= 0 ? hi : 8);
    const all = head.map(r => (r || []).map(norm).filter(Boolean).join(' | ')).join(' ~ ');
    let ma = '';
    const mMa = all.match(/(?:MNV|MÃ\s*NV)\s*:?\s*\|?\s*([0-9][0-9 ]{3,})/i);
    if (mMa) ma = normMa(mMa[1]);
    let ten = '';
    const mTen = all.match(/(?:TÊN\s*(?:NV|NHÂN\s*VIÊN)|HỌ\s*(?:VÀ\s*)?TÊN|NVKT)\s*:\s*(.+?)(?=\s*(?:-|\||~|MÃ\s*NV|MNV|NHÂN\s*VIÊN|$))/i);
    if (mTen) ten = norm(mTen[1]);
    if (!ten) { // mẫu "Tên | Mã NV | 0123 | Kho"
      const r = head.find(r => r && r.some(v => /^mã\s*nv:?$/i.test(norm(v))));
      if (r) ten = norm(r.find(v => norm(v) && !/^mã\s*nv:?$/i.test(norm(v))));
    }
    const mKy = all.match(/THÁNG\s*(\d{1,2})\s*(?:[\/.-]|NĂM)\s*(\d{4})/i);
    const ns = hit.r.slice(hit.j + 1).filter(isNum).map(num);
    const tong = ns.length ? ns[ns.length - 1] : 0;
    let tru = 0, truLyDo = '';
    for (let i = Math.max(hi, 0); i < aoa.length; i++) {
      const r = aoa[i] || [], j = r.findIndex(v => RE_TRU.test(LBL(v)));
      if (j < 0) continue;
      const k = r.findIndex((v, x) => x > j && isNum(v));
      if (k >= 0) { tru = num(r[k]); truLyDo = norm(r.slice(k + 1).find(v => norm(v) && !isNum(v))); }
      break;
    }
    const nhom = [];
    if (hi >= 0) {
      const H = aoa[hi].map(v => norm(v).toLowerCase());
      const ci = k => H.indexOf(k);
      for (let i = hi + 1; i < aoa.length; i++) {
        const r = aoa[i] || []; const nv = norm(r[ci('nhóm việc')]);
        if (!nv || /tổng|điểm trừ/i.test(nv + ' ' + norm(r[ci('stt')]))) break;
        nhom.push({ ten: nv, dich: num(r[ci('kpi đích')]), toiDa: num(r[ci('kpi tối đa')]), dat: num(r[ci('kpi đạt')]), chiTiet: norm(r[ci('chi tiết')] ?? r[ci('ghi chú')]) });
      }
    }
    return { fileName, ma, ten, thang: mKy ? +mKy[1] : null, nam: mKy ? +mKy[2] : null, tongDiem: tong, truFile: tru, truLyDo, nhom };
  }

  // so khớp tên: bỏ dấu, chữ thường (Thuỳ = Thùy)
  const nameKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  // file -> nhân viên: theo Mã NV; không có/sai mã thì theo họ tên trong file; cuối cùng theo họ tên nằm trong tên file
  function matchFile(roster, f) {
    const byMa = f.ma && roster.find(e => e.ma === f.ma);
    if (byMa) return byMa;
    const k = nameKey(f.ten);
    const byTen = k && roster.find(e => nameKey(e.ten) === k);
    if (byTen) return byTen;
    const fn = ' ' + nameKey(f.fileName) + ' ';
    const hits = roster.filter(e => nameKey(e.ten) && fn.includes(' ' + nameKey(e.ten) + ' '));
    return hits.length === 1 ? hits[0] : null;
  }

  // ---- file KPI dạng PDF (Kế toán, in từ hệ thống "Báo cáo công việc — OKR · KPI · AI")
  //   "Họ tên người lập: Trần Thị Mỹ Liễu (011193 - Chi nhánh HCM)", "Kỳ báo cáo: Tháng 8/2026",
  //   dòng "Tổng cộng 1000 1045 1037 103.7% 1037" -> số cuối = Điểm KPI (đã gồm điểm thưởng/phạt từng đầu việc)
  function parsePdfText(text, fileName) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const mMa = t.match(/người lập\s*:\s*(.+?)\s*\(\s*([0-9 ]{4,}?)\s*-/i);
    if (!mMa) throw new Error('không thấy "Họ tên người lập: … (Mã NV - …)"');
    const mKy = t.match(/Kỳ báo cáo\s*:\s*Tháng\s*(\d{1,2})\s*\/\s*(\d{4})/i);
    const mTong = t.match(/Tổng\s*cộng((?:\s+[-+—]?[\d.,]*%?)+)/i);
    if (!mTong) throw new Error('không thấy dòng "Tổng cộng"');
    const nums = mTong[1].trim().split(/\s+/).filter(x => /^[\d.,]+$/.test(x)).map(x => Number(x.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')));
    if (!nums.length) throw new Error('dòng "Tổng cộng" không có số');
    return { fileName, ma: normMa(mMa[2]), ten: norm(mMa[1]), thang: mKy ? +mKy[1] : null, nam: mKy ? +mKy[2] : null,
      tongDiem: nums[nums.length - 1], truFile: 0, nhom: [], loaiFile: 'pdf' };
  }

  const isKeToan = kv => RULES.keToanKV.some(p => String(kv || '').toUpperCase().startsWith(p));
  const truPhep = ngay => { const n = num(ngay); return n <= RULES.phepKhongTru + 1e-9 ? 0 : Math.ceil(n - 1e-9) * RULES.diemPhepMoiNgay; };
  function xepLoai(diem) {
    const n = RULES.nguong;
    return diem >= n.A ? 'A' : diem >= n.B ? 'B' : diem >= n.C ? 'C' : 'D';
  }

  // nghỉ thai sản có rơi vào kỳ "YYYY-MM" không (ngày dạng YYYY-MM-DD)
  function tsTrongKy(ts, ky) {
    if (!ts || !ts.on) return false;
    if (!/^\d{4}-\d{2}$/.test(ky || '')) return true;
    const dau = ky + '-01', cuoi = ky + '-31';
    if (ts.tu && ts.tu > cuoi) return false;   // chưa bắt đầu nghỉ
    if (ts.den && ts.den < dau) return false;  // đã đi làm lại trước kỳ này
    return true;
  }
  const ngayVN = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '';

  // roster + files + inputs -> bảng kết quả
  // phepCC: { maNV: { so, ngay } } lấy từ bảng chấm công cùng tháng; số nhập tay (inputs.phep) được ưu tiên
  function compute(roster, files, inputs, ky, phepCC) {
    const byMa = {};
    (files || []).forEach(f => { const e = matchFile(roster, f); if (e) byMa[e.ma] = f; });
    return roster.map(e => {
      const f = byMa[e.ma], inp0 = (inputs || {})[e.ma] || {}, cc = (phepCC || {})[e.ma];
      const tay = inp0.phep !== undefined && inp0.phep !== '';
      const inp = tay || !cc || !cc.so ? inp0 : Object.assign({}, inp0, { phep: cc.so });
      const phepNguon = tay ? 'tay' : cc && cc.so ? 'cc' : '', phepNgay = !tay && cc ? cc.ngay : '';
      const nop = !!f;
      const tPhep = truPhep(inp.phep || 0), tKhac = num(inp.truKhac || 0), tFile = nop ? f.truFile : 0;
      const ban = nop ? f.tongDiem : 0, tru = tFile + tPhep + tKhac, conLai = nop ? ban - tru : 0;
      const loai = nop ? xepLoai(conLai) : 'D';
      const bang = isKeToan(e.kv) ? RULES.mucKeToan : RULES.mucKho;
      const tv1 = e.loai === 'TV1';
      const ts = tsTrongKy(e.ts, ky);
      if (ts) {
        const tsLyDo = `Nghỉ thai sản${e.ts.tu ? ' từ ' + ngayVN(e.ts.tu) : ''}${e.ts.den ? ' đến ' + ngayVN(e.ts.den) : ''} – không tính thưởng`;
        return Object.assign({}, e, { nop, ts: true, file: f ? f.fileName : '', ban, tFile, tPhep, tKhac, tru, conLai, pct: conLai / 1000, loai: 'TS', muc: 0, thuong: 0,
          lyDo: tsLyDo, phep: inp.phep || '', truKhac: inp.truKhac || '', lyDoKhac: inp.lyDo || '' });
      }
      const muc = tv1 ? 0 : bang[loai];
      const lyDo = [!nop ? 'KHÔNG NỘP KPIS' : '', tFile ? `${f.truLyDo || 'Trừ trong file KPIs'} (-${tFile})` : '',
        num(inp.phep) ? `Nghỉ phép ${String(num(inp.phep)).replace('.', ',')} ngày${phepNgay ? ` (${phepNgay})` : ''} (${tPhep ? '-' + tPhep : 'không trừ'})` : '',
        tKhac ? `${norm(inp.lyDo) || 'Trừ khác'} (-${tKhac})` : norm(inp.lyDo), tv1 ? 'Thử việc tháng đầu – không tính thưởng' : '']
        .filter(Boolean).join('; ');
      return Object.assign({}, e, { nop, ts: false, file: f ? f.fileName : '', ban, tFile, tPhep, tKhac, tru, conLai, pct: conLai / 1000, loai, muc, thuong: muc, lyDo, phepNguon,
        phep: inp.phep || '', truKhac: inp.truKhac || '', lyDoKhac: inp.lyDo || '' });
    });
  }

  root.KPI = { RULES, parseRoster, parseKpiFile, parsePdfText, compute, tsTrongKy, matchFile, nameKey, isKeToan, truPhep, xepLoai, normMa };
})(typeof self !== 'undefined' ? self : window);
