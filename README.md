# Transtore Bot

Bot AI trả lời khách trên Crisp khi team offline, kiểu Intercom Fin. Chạy trên Cloudflare Workers (worker `transtore-bot`), plugin Crisp riêng `urn:transtore.team:transtore-bot:0`.

- Trang chạy thật: https://transtore-bot.transtore.workers.dev
- Trang quản trị: https://transtore-bot.transtore.workers.dev/admin
- Webhook Crisp gửi về: `/crisp/hooks`

Sơ đồ từng file trong code: xem [src/README.txt](src/README.txt).

## Cài lần đầu

```bash
npm install
```

```bash
cp .dev.vars.example .dev.vars
```

Điền khoá vào `.dev.vars` (file này không lên git). Chỉ cần khi chạy bot ở máy.

## Chạy ở máy

```bash
npm run dev
```

Mở http://localhost:8787. KV ở máy là KV giả, trống, không đụng dữ liệu thật.
Cron mỗi phút không tự chạy ở máy.

## Kiểm tra trước khi đưa lên

```bash
npm run check
```

Gói code giống lúc deploy nhưng không gửi lên đâu cả. Lỗi import hay thiếu file sẽ hiện ở đây.

## Đưa code lên Cloudflare

Có 2 cách, kết quả như nhau: bản mới chạy ngay cho khách.

**Cách 1 (nên dùng):** một lệnh đẩy hết file và config.

```bash
npm run deploy
```

**Cách 2:** mở editor trên dashboard Cloudflare, sửa hoặc dán lại đúng những file đã đổi, rồi bấm Deploy.

Lưu ý:

- Chọn local làm bản gốc. Sửa trên dashboard rồi deploy từ local thì phần sửa trên dashboard bị ghi đè.
- Khoá bí mật (Crisp, OpenAI, `ADMIN_KEY`) nằm ở Settings → Variables and Secrets trên Cloudflare. Deploy không đụng tới.
- `vars`, KV `KB`, cron `* * * * *` khai trong [wrangler.jsonc](wrangler.jsonc). Đổi trên dashboard thì phải sửa cả ở đây, không thì lần deploy sau sẽ đè lại.
- Deploy nhầm: `npm run versions` để xem các bản, hoặc vào tab Deployments trên dashboard để quay lại bản trước.

## Xem log bot đang chạy

```bash
npm run logs
```
