// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
/* Mỗi hội thoại Crisp có 1 Durable Object lo việc trả lời khách.

   Vì sao: sau khi nhận webhook, Worker chỉ được chạy thêm 30 giây. Trả lời trong 30 giây đó thì AI phải nghĩ ít,
   và hễ OpenAI chậm là khách nhận câu dự phòng. Alarm của Durable Object được chạy tới 15 phút, nên ở đây
   AI được nghĩ kỹ hơn, đọc nhiều ảnh hơn, và có thêm bước làm rõ câu hỏi + chọn bài help center.

   Cách chạy: webhook gọi schedule(job, thời gian gộp tin). Khách nhắn thêm trong lúc chờ → job mới đè job cũ và hẹn lại,
   nên các tin gửi liên tiếp được gộp thành một lần trả lời. Tới giờ, alarm() gọi respond() (bot.js).
   Mỗi hội thoại một object riêng: khách này chờ AI không làm chậm khách khác.

   Khai trong wrangler.jsonc: durable_objects (binding CONV) + migrations. Thiếu binding thì bot trả lời theo cách cũ (runner.js). */
import { DurableObject } from "cloudflare:workers";
import { respond } from "./bot.js";
import { withConfig } from "./config.js";

export class Conversation extends DurableObject {
  async schedule(job, delayMs = 0) {
    await this.ctx.storage.put("job", job);
    await this.ctx.storage.setAlarm(Date.now() + Math.max(0, Number(delayMs) || 0));
  }

  async alarm() {
    const job = await this.ctx.storage.get("job");
    await this.ctx.storage.delete("job"); // xoá trước khi làm: tin mới tới trong lúc AI nghĩ sẽ đặt job + alarm mới
    if (!job) return;
    try {
      const env = await withConfig({ ...this.env, __long: true }); // __long: được chạy lâu (xem config.js)
      await respond(env, job.w, job.sid, { fingerprint: job.fp, feedbackNo: !!job.no });
    } catch (e) {
      // Không ném lỗi ra ngoài: alarm ném lỗi sẽ bị Cloudflare chạy lại, khách có thể nhận 2 câu trả lời
      console.error("[conv] Lỗi:", e?.stack || e);
    }
  }
}
