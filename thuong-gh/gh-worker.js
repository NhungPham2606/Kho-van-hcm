// Đọc 3 nhóm file Thưởng quý GH ở luồng riêng (file chấm ngoài giờ/kiện hàng có thể 10–30MB).
importScripts('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js', 'gh-engine.js?v=20261111b');

self.onmessage = e => {
  try {
    const files = e.data.files || []; // [{ slot: 'giao'|'kien'|'ngoai', name, buf }]
    const acc = GhEngine.newAcc();
    files.forEach((f, i) => {
      self.postMessage({ step: `Đang đọc file ${i + 1}/${files.length}: ${f.name}…` });
      const wb = XLSX.read(f.buf, { type: 'array', cellDates: false });
      f.buf = null;
      GhEngine.parseOne(XLSX, f.slot, f.name, wb, acc);
    });
    self.postMessage({ step: 'Đang ghép dữ liệu…' });
    self.postMessage({ ok: true, parsed: GhEngine.finish(acc) });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
