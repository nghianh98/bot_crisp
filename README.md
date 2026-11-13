# Support Bot (đang dùng cho Transtore)

Bot AI trả lời khách trên Crisp khi team offline, kiểu Intercom Fin. Chạy trên Cloudflare Workers, plugin Crisp riêng `urn:transtore.team:transtore-bot:0`.

| Worker | Dùng để | Admin | Dữ liệu (KV) |
|---|---|---|---|
| `transtore-bot-prod` | Bot thật, deploy từ repo này | https://transtore-bot-prod.transtore.workers.dev/admin | `transtore-bot-kb` |
| `transtore-bot` | Bot cũ, sửa trên dashboard. **Đã tắt** (không URL, không cron), giữ nguyên code, khoá và lịch sử. Không xoá. | | `transtore-bot-kb` |

Muốn thử code trước khi đưa lên: chạy ở máy (`npm run dev`) và dùng khung Test the bot.

Webhook Crisp gửi về `/crisp/hooks` của bot thật.

Sản phẩm bot hỗ trợ (tên, mô tả, link help center, section) điền trong admin → Settings → Product, không nằm trong code. Dùng cho app khác: tạo worker + KV mới, điền lại các ô đó.

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
- Khoá bí mật (Crisp, `ADMIN_KEY`) nằm ở Settings → Variables and Secrets trên Cloudflare. Deploy không đụng tới. Khoá OpenAI nhập trong admin → Settings → AI (hoặc đặt `OPENAI_API_KEY` trên Cloudflare).
- `vars`, KV `KB`, cron `* * * * *` khai trong [wrangler.jsonc](wrangler.jsonc). Đổi trên dashboard thì phải sửa cả ở đây, không thì lần deploy sau sẽ đè lại.
- Deploy nhầm: `npm run versions` để xem các bản, hoặc vào tab Deployments trên dashboard để quay lại bản trước.

## Khoá cho bot thật

Mỗi lệnh sẽ hỏi giá trị, gõ vào terminal. Khoá Crisp lấy ở Crisp Marketplace → plugin → Tokens (Production) và Settings → Events.

**Luôn đặt khoá dạng Secret, đừng đặt dạng Variable (Text).** Biến dạng Text đặt trên dashboard có thể bị `npm run deploy` xoá: `keep_vars` trong [wrangler.jsonc](wrangler.jsonc) chỉ giữ được biến của bản upload gần nhất. Secret thì deploy không bao giờ đụng tới. Khi deploy mà wrangler báo "local configuration … differs from the remote configuration", dừng lại xem trên dashboard vừa đổi gì trước khi chạy tiếp.

```bash
npx wrangler secret put ADMIN_KEY
```

```bash
npx wrangler secret put CRISP_IDENTIFIER
```

```bash
npx wrangler secret put CRISP_KEY
```

```bash
npx wrangler secret put CRISP_HOOK_SECRET
```

Rồi vào admin → Settings → AI nhập khoá OpenAI và chọn model, và đổi webhook production trong Crisp Marketplace sang `https://transtore-bot-prod.transtore.workers.dev/crisp/hooks`. Bot mode đang là Off: bật lại ở admin khi mọi thứ sẵn sàng.

## Xem log bot đang chạy

```bash
npm run logs
```
