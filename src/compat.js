// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
/* Tương thích dữ liệu cũ: bot đã chạy trước "bản 2" của cài đặt, và file sao lưu cũ.

   Trước bản 2, các nội dung dưới đây nằm cứng trong code (viết cho app đầu tiên dùng bot này).
   Giờ chúng là cài đặt team tự sửa trên /admin, và code không còn nội dung riêng của app nào.
   - Bot ĐÃ CHẠY từ trước (cfg:settings chưa có v mới nhất): giữ nguyên cách trả lời. Các chữ cũ trong file này
     trở thành giá trị của bot đó, hiện trên /admin và sửa được. Lần lưu cài đặt kế tiếp ghi chúng vào KV (v: 2).
   - Bot CÀI MỚI không đi qua file này: bắt đầu bằng mặc định trung tính trong config.js.
   Khi mọi bot cũ đã lưu cài đặt ở bản 2 và không còn cần khôi phục file sao lưu cũ, có thể xoá file này. */

export const SETTINGS_VERSION = 3;

// "Thông tin cần hỏi khách" từng là 6 ô cố định, lưu bằng tên ô
const FIELDS_V1 = {
  storeUrl: "store URL (xxx.myshopify.com)",
  issue: "what exactly is wrong and on which page",
  theme: "theme name",
  tried: "steps already tried",
  screenshot: "a screenshot or screen recording",
  collabCode: "the store's 4-digit collaborator request code (Shopify admin > Settings > Users > Security), so the team can send a collaborator request",
};
const FIELDS_ON_V1 = ["storeUrl", "issue", "theme", "tried", "screenshot"];

const V1 = {
  priority: {
    p1: "their store, storefront or checkout is down or broken for shoppers, data is lost or exposed, or there is a security problem.",
    p2: "a main feature doesn't work, there is no workaround, or it blocks something time-sensitive (a launch, a sale).",
    p3: "something works only partly or a workaround exists; one page or a small part is affected.",
    p4: "how-to questions, general questions, cosmetic issues, feature requests.",
  },
  urgent: "the customer is angry or upset, swears, threatens a bad review, a report, a chargeback or to uninstall, or says their storefront or checkout is broken.",
  upset: `- Never ignore them, never argue, never be defensive. Do not quote policies at them.
- Start by acknowledging the frustration in your own words and apologise once, sincerely (not "I understand your frustration" every time).
- Then say concretely what happens next: their case is with the team and when the team will reply (use the team availability note below if present).
- If you still lack their store URL or a short description of the issue, ask for it in the same message so the team can act faster.
- Keep it to 2-3 short sentences. Stay calm and warm even if they swear.`,
  noteExtra: "impact: say whether a live storefront is affected. details: include the store URL and theme when the customer gave them. next_step can be, for example, to check the app embed on the store.",
  utcOffset: "7",
  testQuestions: ["How do I add a new language?", "Why does my store show the wrong currency on mobile?", "I was charged twice this month, I want a refund", "Your app broke my store!! Fix it now", "Can I talk to a real person?"],
};

/** Cài đặt đã lưu (hoặc phần settings của file sao lưu) → dạng bản 2. null (bot mới) và dữ liệu đã ở bản 2 thì trả lại nguyên. */
export function upgradeSettings(saved, env = {}) {
  if (!saved || typeof saved !== "object") return saved;
  const from = Number(saved.v) || 1;
  if (from >= SETTINGS_VERSION) return saved;
  const s = { ...saved, v: SETTINGS_VERSION };
  // Trước bản 3, snippet khớp câu hỏi luôn được gửi nguyên văn. Bot đã chạy giữ cách đó cho tới khi team đổi
  // trên /admin → Knowledge; bot mới mặc định dùng snippet làm kiến thức (config.js).
  s.snippetMode ??= "exact";
  if (from >= 2) return s;
  const e = saved.escalation && typeof saved.escalation === "object" ? { ...saved.escalation } : {};
  if (!Array.isArray(e.fields) || e.fields.every((x) => typeof x === "string")) {
    const on = Array.isArray(e.fields) ? e.fields : FIELDS_ON_V1;
    e.fields = Object.entries(FIELDS_V1).map(([id, text]) => ({ id, text, enabled: on.includes(id) }));
  }
  e.priority ??= { ...V1.priority };
  e.urgent ??= V1.urgent;
  e.upset ??= V1.upset;
  e.noteExtra ??= V1.noteExtra;
  s.escalation = e;
  // Múi giờ từng cố định GMT+7 (trừ khi đặt biến UTC_OFFSET_HOURS trên Cloudflare)
  if (s.utcOffset == null && !(env.__orig || env).UTC_OFFSET_HOURS) s.utcOffset = V1.utcOffset;
  s.testQuestions ??= [...V1.testQuestions];
  return s;
}
