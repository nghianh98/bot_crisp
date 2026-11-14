SUPPORT BOT: ĐỌC TRƯỚC KHI SỬA CODE

!! Code gốc nằm ở project local (bot_crisp). Đừng sửa thẳng trên dashboard Cloudflare:
!! lần deploy sau từ local sẽ ghi đè mọi chỗ sửa trên dashboard. Sửa ở local rồi deploy lên.

Thư mục src/ này là code của Worker (phần bot và máy chủ của trang quản trị). Không có bước build:
file nào ở đây cũng là file đang chạy thật. Sửa xong deploy là áp dụng ngay cho khách.
Giao diện trang quản trị (React) nằm ngoài thư mục này, ở admin-ui/: xem mục GIAO DIỆN bên dưới.
Phần lớn việc hằng ngày (chế độ bot, snippet, hướng dẫn, tag, giờ làm việc...) chỉnh trên trang /admin, không cần sửa code.

CÂY THƯ MỤC

worker.js           Cổng vào: nhận webhook của Crisp, mở trang /admin, chạy cron mỗi phút
bot.js              Luồng trả lời khách: trả lời / hỏi thêm / chuyển cho team, nút hỏi ý kiến
ai.js               Soạn prompt, gọi OpenAI, chọn tag
handoff.js          Ghi chú bàn giao: private note cho team khi bot chuyển khách (bật/tắt ở Escalation)
followup.js         Nhắc khách khi im lặng, kết thúc ca, tự Resolve
knowledge.js        Sync help center và trang website (nút Sync now, tự động theo lịch)
training.js         Snippet và hướng dẫn do team viết
style.js            Văn phong: độ dài câu trả lời, câu tự giới thiệu, câu trả lời mẫu của team (trang Writing style)
tags.js             Tag vấn đề, tiền tố, segment trạng thái
stats.js            Thống kê tháng, nhật ký trả lời, nhật ký thay đổi
config.js           Giá trị mặc định (trung tính, không riêng app nào) và cài đặt
compat.js           Tương thích dữ liệu cũ: bot chạy trước bản 2 của cài đặt giữ nguyên nội dung cũ; file sao lưu cũ
crisp.js            Gọi API Crisp
state.js            Trạng thái từng hội thoại
time.js, util.js    Giờ làm việc, hàm dùng chung

admin/              Phần máy chủ của trang quản trị
  api.js            API /api/* (trang /admin đọc và lưu dữ liệu qua đây)
  auth.js           Đăng nhập bằng ADMIN_KEY
  pages.js          Trang đăng nhập, trang trạng thái
  ui.js             Gửi giao diện đã build (thư mục build/) cho người đã đăng nhập

GIAO DIỆN TRANG QUẢN TRỊ (thư mục admin-ui/ ở gốc project, viết bằng React, build bằng Vite)

admin-ui/
  index.html        Trang gốc, Vite gắn code vào đây
  src/main.jsx      Điểm vào
  src/App.jsx       Khung trang: tải dữ liệu, menu bên trái, chuyển trang theo #tên-trang, khung Test the bot
  src/styles.css    Toàn bộ CSS
  src/pages/        Mỗi trang 1 file: Overview, Content (Knowledge), Guidance, Style (Writing style), Tags,
                    Escalation, Followup, Performance, Conversations, Suggestions, Settings (kèm Change log)
  src/components/   Thành phần dùng lại: ui.jsx (nút, công tắc, hộp thoại, thông báo), common.jsx (nhãn, biểu đồ),
                    Snippet.jsx (form snippet, Improve this answer), Preview.jsx (khung Test the bot)
  src/lib/          api.js (gọi /api), store.js (dữ liệu dùng chung), format.js (số, ngày giờ),
                    preview.js, toast.js, hooks.js, sheet.js (đọc Excel .xlsx / CSV trên trình duyệt)

`npm run build` gói admin-ui/ thành file tĩnh trong build/admin/ (thư mục build/ không lên git).
wrangler tự chạy lệnh này trước mỗi lần `npm run dev`, `npm run check` và `npm run deploy`, rồi đưa build/ lên cùng Worker.
Sửa giao diện cho nhanh: chạy `npm run dev` ở một cửa sổ, `npm run dev:ui` ở cửa sổ khác, mở http://localhost:5173/admin/
(đăng nhập trước ở http://localhost:8787/admin). Trang tự cập nhật mỗi lần lưu file.

LƯU Ý

- Thêm 1 trang mới: tạo admin-ui/src/pages/Ten.jsx, rồi thêm vào PAGES và NAV trong admin-ui/src/App.jsx.
- Giao diện không sửa được trên dashboard Cloudflare (file trên đó là bản đã build). Sửa ở local rồi deploy.
- Khoá bí mật (Crisp, OpenAI, ADMIN_KEY) không nằm trong code. Chúng ở Settings → Variables and Secrets.
- Deploy nhầm: ra trang của worker trên Cloudflare, mở tab Deployments, bấm dấu ... ở bản trước đó để quay lại bản đó.
