// Đọc file Excel thưởng kho (~60.000 dòng) ở luồng riêng để trang không bị treo.
importScripts('https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js', 'engine.js?v=20260930d');

self.onmessage = e => {
  try {
    const { buf, fileName } = e.data;
    self.postMessage({ step: 'Đang đọc file Excel…' });
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    self.postMessage({ step: 'Đang cộng số lượt theo nhân viên / ngày…' });
    const cached = KhoEngine.processWorkbookData(XLSX, wb, fileName);
    self.postMessage({ ok: true, cached });
  } catch (err) {
    self.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
};
