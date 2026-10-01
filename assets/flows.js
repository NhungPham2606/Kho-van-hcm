// ====================================================================
// MENU TRAI CUA TOAN BO TRANG KHO VAN HCM
// Them dong cong viec moi: them 1 nhom { ten, icon, moTa, trangThai, muc: [...] }
// vao mang ben duoi, va tao trang tuong ung (copy thu muc bao-cao-giao-hang/).
// Moi "muc" la 1 dau muc trong menu con; href tinh tu thu muc goc cua trang.
// ====================================================================
window.KVH_ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4"/><path d="M12 11v10"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
};

window.KVH_MENU = [
  { ten: 'Trang chủ', icon: 'home', href: '' },
  {
    ten: 'Báo cáo giao hàng', icon: 'truck', trangThai: 'Đang chạy',
    moTa: 'Tính điểm giao hàng, định mức và hệ số lương theo tháng; tự gửi dashboard cho từng nhân viên.',
    muc: [
      { ten: 'Tổng quan', href: 'bao-cao-giao-hang/#tong-quan' },
      { ten: 'Chuẩn bị dữ liệu', href: 'bao-cao-giao-hang/#chuan-bi' },
      { ten: 'Cập nhật dữ liệu', href: 'bao-cao-giao-hang/#cap-nhat' },
      { ten: 'Kết quả tính', href: 'bao-cao-giao-hang/#ket-qua' },
      { ten: 'Gửi báo cáo', href: 'bao-cao-giao-hang/#gui-bao-cao' },
      { ten: 'Nhân viên & mail', href: 'bao-cao-giao-hang/#nhan-vien' },
      { ten: 'Lưu trữ & tra cứu', href: 'bao-cao-giao-hang/#luu-tru' },
      { ten: 'Quy tắc tính', href: 'bao-cao-giao-hang/#quy-tac' },
    ],
  },
  {
    ten: 'Thưởng kho HCM', icon: 'box', trangThai: 'Theo quý',
    moTa: 'Thưởng đóng gói kiện hàng: cộng Tạo kiện + Bốc + Đóng hàng mỗi ngày, vượt 20 lượt được 2.000đ/lượt; thưởng quý = trung bình 3 tháng.',
    muc: [
      { ten: 'Thưởng quý', href: 'thuong-kho/#thuong-quy' },
      { ten: 'Theo tháng', href: 'thuong-kho/#theo-thang' },
      { ten: 'Đóng cặp', href: 'thuong-kho/#dong-cap' },
      { ten: 'Nạp file quý', href: 'thuong-kho/#nap-du-lieu' },
      { ten: 'Ghi chú & quy tắc', href: 'thuong-kho/#huong-dan' },
    ],
  },
  {
    ten: 'Báo Cáo Cận Date & Chậm Luân Chuyển', icon: 'clock', trangThai: 'Theo kỳ',
    moTa: 'Từ báo cáo nhập xuất tồn theo lô: lọc hàng chậm luân chuyển và cận date, tuổi thuốc tô màu, dashboard, xuất Excel theo mẫu.',
    muc: [
      { ten: 'Dashboard', href: 'ton-kho/#dashboard' },
      { ten: 'Chậm luân chuyển', href: 'ton-kho/#cham-luan-chuyen' },
      { ten: 'Cận date', href: 'ton-kho/#can-date' },
      { ten: 'Tồn theo lô', href: 'ton-kho/#ton-theo-lo' },
      { ten: 'Nạp file kỳ', href: 'ton-kho/#nap-du-lieu' },
      { ten: 'Cài đặt', href: 'ton-kho/#cai-dat' },
    ],
  },
  {
    ten: 'Tổng Hợp KPIs', icon: 'chart', trangThai: 'Hằng tháng',
    moTa: 'Tổng hợp điểm KPIs từng nhân viên (file Excel Kho, PDF Kế toán), điểm trừ, xếp loại, mức thưởng; xuất Excel theo mẫu VP.HCM.',
    muc: [
      { ten: 'Bảng tổng hợp', href: 'kpi/#tong-hop' },
      { ten: 'Dashboard', href: 'kpi/#dashboard' },
      { ten: 'File KPIs đã nạp', href: 'kpi/#file-kpi' },
      { ten: 'Danh sách NV', href: 'kpi/#danh-sach' },
      { ten: 'Nạp file', href: 'kpi/#nap-du-lieu' },
      { ten: 'Quy tắc', href: 'kpi/#cai-dat' },
    ],
  },
  // Vi du dong cong viec tiep theo (bo "//" khi co trang):
  // { ten: 'Nhập kho', icon: 'box', trangThai: 'Đang chạy', moTa: '...', muc: [
  //   { ten: 'Tổng quan', href: 'nhap-kho/#tong-quan' },
  // ] },
];
