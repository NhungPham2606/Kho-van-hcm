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
   ============================================================================ */
(function (root) {
  'use strict';
  const RULES = {
    diemPhepMoiNgay: 5,
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

  // ---- file KPI con của 1 nhân viên
  function parseKpiFile(XLSX, wb, fileName) {
    const name = wb.SheetNames.find(n => n.trim().toUpperCase() === 'KPI') || wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const text = aoa.map(r => (r || []).map(norm).filter(Boolean).join(' '));
    const all = text.join(' \n ');
    const mMa = all.match(/MNV\s*:?\s*([0-9 ]{4,})/i);
    const mTen = all.match(/TÊN\s*NV\s*:\s*([^\n-]+?)\s*-/i);
    const mKy = all.match(/THÁNG\s*(\d{1,2})\s*[\/.-]\s*(\d{4})/i);
    const rowVal = label => {
      const i = aoa.findIndex(r => r && r.some(v => norm(v).toUpperCase().replace(/\s+/g, '') === label));
      if (i < 0) return null;
      const r = aoa[i]; const j = r.findIndex(v => norm(v).toUpperCase().replace(/\s+/g, '') === label);
      for (let k = j + 1; k < r.length; k++) if (r[k] !== null && r[k] !== '' && !isNaN(num(r[k])) && String(r[k]).trim() !== '') return num(r[k]);
      return 0;
    };
    const tong = rowVal('TỔNGĐIỂM'), tru = rowVal('ĐIỂMTRỪ');
    if (!mMa) throw new Error('không thấy "MNV:" trong tiêu đề');
    if (tong === null) throw new Error('không thấy dòng "TỔNG ĐIỂM"');
    // bảng nhóm việc (STT | Nhóm việc | KPI đích | KPI tối đa | KPI đạt | % đạt | Chi tiết)
    const hi = aoa.findIndex(r => r && r.some(v => norm(v).toLowerCase() === 'nhóm việc'));
    const nhom = [];
    if (hi >= 0) {
      const H = aoa[hi].map(v => norm(v).toLowerCase());
      const ci = k => H.indexOf(k);
      for (let i = hi + 1; i < aoa.length; i++) {
        const r = aoa[i] || []; const nv = norm(r[ci('nhóm việc')]);
        if (!nv || /tổng điểm/i.test(norm(r[ci('stt')]))) break;
        nhom.push({ ten: nv, dich: num(r[ci('kpi đích')]), toiDa: num(r[ci('kpi tối đa')]), dat: num(r[ci('kpi đạt')]), chiTiet: norm(r[ci('chi tiết')]) });
      }
    }
    return { fileName, ma: normMa(mMa[1]), ten: mTen ? norm(mTen[1]) : '', thang: mKy ? +mKy[1] : null, nam: mKy ? +mKy[2] : null,
      tongDiem: tong, truFile: tru || 0, nhom };
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
  const truPhep = ngay => Math.ceil(num(ngay) - 1e-9) * RULES.diemPhepMoiNgay;
  function xepLoai(diem) {
    const n = RULES.nguong;
    return diem >= n.A ? 'A' : diem >= n.B ? 'B' : diem >= n.C ? 'C' : 'D';
  }

  // roster + files + inputs -> bảng kết quả
  function compute(roster, files, inputs) {
    const byMa = {}; (files || []).forEach(f => { byMa[f.ma] = f; });
    return roster.map(e => {
      const f = byMa[e.ma], inp = (inputs || {})[e.ma] || {};
      const nop = !!f;
      const tPhep = truPhep(inp.phep || 0), tKhac = num(inp.truKhac || 0), tFile = nop ? f.truFile : 0;
      const ban = nop ? f.tongDiem : 0, tru = tFile + tPhep + tKhac, conLai = nop ? ban - tru : 0;
      const loai = nop ? xepLoai(conLai) : 'D';
      const bang = isKeToan(e.kv) ? RULES.mucKeToan : RULES.mucKho;
      const tv1 = e.loai === 'TV1';
      const muc = tv1 ? 0 : bang[loai];
      const lyDo = [!nop ? 'KHÔNG NỘP KPIS' : '', tFile ? `Trừ trong file KPIs: ${tFile}` : '',
        num(inp.phep) ? `Nghỉ phép ${String(num(inp.phep)).replace('.', ',')} ngày (-${tPhep})` : '',
        tKhac ? `${norm(inp.lyDo) || 'Trừ khác'} (-${tKhac})` : norm(inp.lyDo), tv1 ? 'Thử việc tháng đầu – không tính thưởng' : '']
        .filter(Boolean).join('; ');
      return Object.assign({}, e, { nop, file: f ? f.fileName : '', ban, tFile, tPhep, tKhac, tru, conLai, pct: conLai / 1000, loai, muc, thuong: muc, lyDo,
        phep: inp.phep || '', truKhac: inp.truKhac || '', lyDoKhac: inp.lyDo || '' });
    });
  }

  root.KPI = { RULES, parseRoster, parseKpiFile, parsePdfText, compute, isKeToan, truPhep, xepLoai, normMa };
})(typeof self !== 'undefined' ? self : window);
