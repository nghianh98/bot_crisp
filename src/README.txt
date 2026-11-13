TRANSTORE BOT: ĐỌC TRƯỚC KHI SỬA CODE

!! Code gốc giờ nằm ở project local (bot_scrisp). Đừng sửa thẳng trên dashboard Cloudflare nữa:
!! lần deploy sau từ local sẽ ghi đè mọi chỗ sửa trên dashboard. Sửa ở local rồi deploy lên.

Đây là toàn bộ code của bot. Không có bước build: file nào ở đây cũng là file đang chạy thật.
Sửa xong deploy là áp dụng ngay cho khách.
Phần lớn việc hằng ngày (chế độ bot, snippet, hướng dẫn, tag, giờ làm việc...) chỉnh trên trang /admin, không cần sửa code.

CÂY THƯ MỤC

worker.js           Cổng vào: nhận webhook của Crisp, mở trang /admin, chạy cron mỗi phút
bot.js              Luồng trả lời khách: trả lời / hỏi thêm / chuyển cho team, nút hỏi ý kiến
ai.js               Soạn prompt, gọi OpenAI, chọn tag
followup.js         Nhắc khách khi im lặng, kết thúc ca, tự Resolve
knowledge.js        Sync help center và trang website (nút Sync now, tự động theo lịch)
training.js         Snippet và hướng dẫn do team viết
tags.js             Tag vấn đề, tiền tố, segment trạng thái
stats.js            Thống kê tháng, nhật ký trả lời, nhật ký thay đổi
config.js           Giá trị mặc định và cài đặt
crisp.js            Gọi API Crisp
state.js            Trạng thái từng hội thoại
time.js, util.js    Giờ làm việc, hàm dùng chung

admin/              Phần máy chủ của trang quản trị
  api.js            API /api/* (trang /admin đọc và lưu dữ liệu qua đây)
  auth.js           Đăng nhập bằng ADMIN_KEY
  pages.js          Trang đăng nhập, trang trạng thái
  ui.js             Gửi các file trong admin-ui/ cho trình duyệt

admin-ui/           Giao diện trang quản trị (chạy trên trình duyệt)
  index.html        Khung trang: menu bên trái, khung Test the bot
  styles.css.txt    Toàn bộ CSS
  main.js.txt       Điểm vào: tải dữ liệu, chuyển trang
  core.js.txt       Hàm dùng chung: gọi API, ngày giờ, hộp thoại, thông báo
  components.js.txt Thành phần dùng lại: form snippet, biểu đồ
  preview.js.txt    Khung Test the bot
  pages/            Mỗi trang 1 file: overview, content (Knowledge), guidance, tags,
                    escalation, followup, performance, conversations, suggestions, settings

VÌ SAO CÓ FILE ĐUÔI .txt

Cloudflare chỉ nhận 3 loại file: .js (code chạy trên máy chủ), .txt và .html (văn bản).
File CSS và JS của giao diện chạy trên trình duyệt chứ không chạy trên máy chủ, nên phải thêm đuôi .txt.
Nội dung bên trong vẫn là CSS và JavaScript bình thường. Đừng bỏ đuôi .txt, Cloudflare sẽ không lưu được.
Muốn tô màu code khi xem: bấm chữ "Plain Text" ở góc phải dưới, chọn JavaScript hoặc CSS.

LƯU Ý

- Thêm 1 file giao diện mới: làm theo ghi chú đầu file admin/ui.js.
- Khoá bí mật (Crisp, OpenAI, ADMIN_KEY) không nằm trong code. Chúng ở Settings → Variables and Secrets.
- Deploy nhầm: ra trang transtore-bot, mở tab Deployments, bấm dấu ... ở bản trước đó để quay lại bản đó.
