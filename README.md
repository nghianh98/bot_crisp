# Support Bot (đang dùng cho Transtore)

Bot AI trả lời khách trên Crisp khi team offline, kiểu Intercom Fin. Chạy trên Cloudflare Workers, plugin Crisp riêng `urn:transtore.team:transtore-bot:0`.

| Worker | Dùng để | Admin | Dữ liệu (KV) |
|---|---|---|---|
| `transtore-bot-prod` | Bot thật, deploy từ repo này | https://transtore-bot-prod.transtore.workers.dev/admin | `transtore-bot-kb` |
| `transtore-bot` | Bot cũ, sửa trên dashboard. **Đã tắt** (không URL, không cron), giữ nguyên code, khoá và lịch sử. Không xoá. | | `transtore-bot-kb` |

Muốn thử code trước khi đưa lên: chạy ở máy (`npm run dev`) và dùng khung Test the bot.

Webhook Crisp gửi về `/crisp/hooks` của bot thật.

Code không chứa nội dung riêng của app nào: sản phẩm, help center, múi giờ, cách trả lời, khi nào chuyển người… đều điền trên admin. Muốn chạy bot cho app khác: xem [Dùng bot cho app khác](#dùng-bot-cho-app-khác).

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

## Dùng bot cho app khác

Mỗi app là 1 worker riêng + 1 kho dữ liệu (KV) riêng + 1 plugin Crisp riêng. Code dùng chung, không phải sửa dòng nào.
Trong các lệnh dưới, thay `myapp` bằng tên app.

**1. Tạo kho dữ liệu.** Lệnh in ra một `id`, chép lại.

```bash
npx wrangler kv namespace create myapp-bot-kb
```

**2. Tạo file config.** Chép [wrangler.app.example.jsonc](wrangler.app.example.jsonc) thành `wrangler.myapp.jsonc`, sửa `name` (tên worker) và dán `id` vừa có vào `kv_namespaces`.

**3. Đưa code lên.**

```bash
npx wrangler deploy -c wrangler.myapp.jsonc
```

**4. Đặt khoá (dạng Secret).** Chạy lần lượt cho `ADMIN_KEY` (mật khẩu admin tự đặt), `CRISP_IDENTIFIER`, `CRISP_KEY`, `CRISP_HOOK_SECRET`:

```bash
npx wrangler secret put ADMIN_KEY -c wrangler.myapp.jsonc
```

**5. Plugin Crisp.** Trong Crisp Marketplace tạo plugin mới cho app này, cài vào website của app.
- Tokens (Production) → `CRISP_IDENTIFIER`, `CRISP_KEY`.
- Settings → Events → Production Web Hook: link `https://<worker>/crisp/hooks` (có sẵn để copy trong admin → Settings → Crisp connection), chọn 3 sự kiện `message:send`, `message:received`, `session:set_state`. Signing secret của hook này → `CRISP_HOOK_SECRET`.

**6. Điền admin** tại `https://<worker>/admin`:
- Settings: tên sản phẩm và mô tả, link help center, múi giờ và giờ làm việc, email hỗ trợ, khoá OpenAI và model.
- Knowledge → Sync now. Help center không có sitemap thì dán link bài vào Settings → Help center pages.
- Escalation: thông tin cần hỏi khách, định nghĩa P1–P4, lý do chuyển người riêng của app.

**7. Đem cách làm việc từ bot cũ sang (tuỳ chọn).** Ở bot cũ: Settings → Download backup. Ở bot mới: Settings → Restore from file, bỏ tick **Product and knowledge sources** và **Snippets** để chỉ lấy guidance, văn phong, escalation.

**8. Thử rồi bật.** Hỏi vài câu trong Test the bot, sau đó chọn Bot mode.

Cập nhật code cho app đó về sau: chạy lại lệnh ở bước 3. `npm run deploy` (không có `-c`) chỉ đưa lên bot trong [wrangler.jsonc](wrangler.jsonc).
