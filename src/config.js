// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giá trị mặc định và cài đặt của bot. Cài đặt lưu trên trang /admin đè lên biến đặt ở Cloudflare.
import { SETTINGS_VERSION, upgradeSettings } from "./compat.js";
import { normTags } from "./tags.js";
import { parseBusinessHours } from "./time.js";
import { clip, getJSON, num, uid } from "./util.js";

export const DEFAULTS = {
  BOT_NAME: "Support Bot",
  // Sản phẩm bot hỗ trợ: điền trên /admin → Settings → Product (mỗi app một bộ, không ghi cứng trong code)
  PRODUCT_NAME: "our product",
  PRODUCT_DESC: "",
  BOT_AVATAR: "",
  BOT_MODE: "offline",
  BOT_LANGUAGE: "English",
  BUSINESS_HOURS: "",
  UTC_OFFSET_HOURS: "0", // múi giờ của team (giờ lệch so với GMT): chọn trên /admin → Settings
  OPENAI_MODEL: "gpt-6-luna",
  OPENAI_REASONING_EFFORT: "low",
  // Hạn mức đầu ra của OpenAI tính CẢ phần AI "nghĩ", không chỉ câu trả lời. Để rộng: chỉ trả tiền cho phần dùng thật.
  // Để chật thì AI nghĩ hết hạn mức trước khi viết được chữ nào, và khách nhận câu dự phòng.
  OPENAI_MAX_OUTPUT_TOKENS: "8000",
  // Thời gian cho AI khi trả lời khách (mili giây). Cloudflare chỉ cho bot chạy thêm 30 giây sau khi nhận tin của Crisp,
  // nên: lần gọi đầu tối đa AI_FIRST_MS; nếu hỏng thì thử lại 1 lần, nghĩ ít hơn, sao cho tổng không quá AI_TOTAL_MS.
  AI_FIRST_MS: "16000",
  AI_TOTAL_MS: "24000",
  HELP_CENTER_URL: "", // trống = chưa có help center (chỉ dùng snippet và trang website)
  HELP_CENTER_SECTIONS: "", // vd "docs,faq": chỉ lấy bài có đường dẫn /docs/… /faq/… ; trống = cả trang
  HELP_CENTER_PAGES: "", // link bài help center, mỗi dòng 1 link: dùng khi help center không có sitemap (hoặc để thêm bài sitemap thiếu)
  HELP_CENTER_SELECTOR: "", // CSS selector của phần nội dung bài (nâng cao): trống = tự tìm
  SUPPORT_EMAIL: "",
  BOT_ORIGINS: "chat",
  PAUSED_SEGMENT: "bot-paused", // nhân viên đã vào → bot im hẳn
  HANDOFF_SEGMENT: "bot-handoff", // bot đã chuyển người → bot chỉ trấn an khách
  URGENT_SEGMENT: "urgent", // khách giận hoặc việc gấp (định nghĩa: Escalation)
  P1_SEGMENT: "p1-critical", // mức ưu tiên P1 (định nghĩa: Escalation)
  P2_SEGMENT: "p2-high", // mức ưu tiên P2: tính năng chính hỏng, không có cách tạm
  TAG_PREFIX: "issue-",
  CLASSIFY_ON_RESOLVE: "true",
  DEBOUNCE_MS: "2500",
  HISTORY_LIMIT: "20",
  PAGES_PER_RUN: "6",
  // Ảnh trong help center: mỗi bước sync cho AI đọc tối đa ngần này ảnh MỚI (ảnh đã đọc thì lấy lại bản đã lưu).
  // Ảnh chưa kịp đọc thì để lần sync sau. Mỗi ảnh tối đa IMAGE_READ_MS mili giây.
  IMAGES_PER_RUN: "12",
  IMAGE_READ_MS: "20000",
  FOLLOWUPS_PER_RUN: "8",
  VERIFY_HOOKS: "true",
  CRISP_API_BASE: "https://api.crisp.chat",
  OPENAI_BASE_URL: "https://api.openai.com",
};

// Tag mặc định cho bot mới (issue-<key> trong Crisp). Team sửa danh sách cho từng sản phẩm trên /admin → Tag
export const CATEGORIES = {
  setup: ["Setup", "Installation, getting started, first configuration"],
  "how-to": ["How-to", "How to use a feature or change a setting"],
  bug: ["Bug", "Something doesn't work as expected, errors"],
  display: ["Display", "Display or layout issues"],
  billing: ["Billing", "Plans, payments, refunds"],
  cancel: ["Cancel", "Cancelling, uninstalling, closing the account"],
  "feature-request": ["Feature request", "Feature requests"],
  account: ["Account & access", "Account, sign-in, access and permissions"],
  other: ["Other", "Doesn't fit any tag above"],
};

export const MAX_TAGS = 30;

export const MODE_LABELS = { off: "Off", offline: "When team is offline", always: "Always on" };

export const GUIDANCE_CATS = {
  tone: { label: "Tone and personality", hint: "How the bot talks: friendly or formal, with or without emoji. Writing rules (length, format) and your team's real replies are on the Writing style page.", prompt: "Tone and personality" },
  clarify: { label: "Clarifying questions", hint: "When the bot should ask the customer something before answering.", prompt: "Asking clarifying questions" },
  content: { label: "Content and sources", hint: "What the bot should prioritise, mention or avoid.", prompt: "Content and sources" },
  handoff: { label: "Handing off to the team", hint: "What the bot tells the customer when it passes the conversation to the team.", prompt: "Handing off to the team" },
  other: { label: "Other rules", hint: "Anything else. Write it as: if the customer asks X, do Y.", prompt: "Additional rules" },
};

export const TRIGGERS = {
  askHuman: { label: "Customer asks for a person", hint: "The customer says they want to talk to someone on the team.", prompt: "the customer asks for a human" },
  billing: { label: "Refunds and billing disputes", hint: "Refunds, unexpected charges, cancellations that involve money.", prompt: "refunds, unexpected charges or billing disputes" },
  angry: { label: "Angry customer", hint: "The customer is upset or threatens a bad review, a chargeback or leaving.", prompt: "the customer is angry or threatens a bad review, a chargeback or to leave" },
  bug: { label: "Problems the team must check", hint: "Something still doesn't work after following the docs, or the product shows an error.", prompt: "bugs: something still doesn't work on the customer's side after following the docs, or the product shows an error" },
  sensitive: { label: "Security, privacy and legal", hint: "Data access or deletion, GDPR, security problems, terms or contract questions. The bot hands these off right away instead of answering.", prompt: "security problems, data privacy or deletion requests (GDPR), someone else accessing the account, or legal, terms and contract questions" },
  promises: { label: "Promises the bot can't make", hint: "When a feature will ship, roadmap, discounts, exceptions or custom deals.", prompt: "anything that needs a promise: release dates or roadmap, discounts, exceptions to a policy or custom deals" },
  noAnswer: { label: "The bot has no answer", hint: "Snippets and the help center don't cover the question. When off, the bot says it doesn't have that information yet and suggests the support email.", prompt: "questions the snippets and help center do not answer" },
};

/* Mặc định cho bot MỚI: trung tính, không nhắc tới sản phẩm nào. Team sửa hết trên /admin → Escalation.
   (Bot đã chạy trước bản 2 của cài đặt giữ nội dung cũ của nó: xem compat.js.) */

// Thông tin bot hỏi khách (gộp 1 tin) trước khi chuyển cho team. Mỗi mục: chữ đưa cho AI, bật/tắt.
export const FIELDS_DEFAULT = [
  { id: "issue", text: "what exactly is wrong and where (which page, screen or step)", enabled: true },
  { id: "tried", text: "steps already tried", enabled: true },
  { id: "screenshot", text: "a screenshot or screen recording", enabled: true },
];
export const MAX_FIELDS = 12;
export const MAX_CUSTOM_REASONS = 10;

// Mức ưu tiên: AI chấm P1–P4 theo các định nghĩa này
export const PRIORITY_LEVELS = { p1: "P1 critical", p2: "P2 high", p3: "P3 medium", p4: "P4 low" };
export const PRIORITY_DEFAULT = {
  p1: "the product is down or unusable for them or for their own customers, data is lost or exposed, or there is a security problem.",
  p2: "a main feature doesn't work, there is no workaround, or it blocks something time-sensitive (a launch, a sale).",
  p3: "something works only partly or a workaround exists; one page or a small part is affected.",
  p4: "how-to questions, general questions, cosmetic issues, feature requests.",
};
// Khi nào đánh dấu hội thoại là "urgent" (gắn segment urgent, ghi "angry customer" trong ghi chú bàn giao)
export const URGENT_DEFAULT = "the customer is angry or upset, swears, threatens a bad review, a report, a chargeback or to leave, or says the product is down or broken for their own customers.";
// Cách bot nói với khách đang bực
export const UPSET_DEFAULT = `- Never ignore them, never argue, never be defensive. Do not quote policies at them.
- Start by acknowledging the frustration in your own words and apologise once, sincerely (not "I understand your frustration" every time).
- Then say concretely what happens next: their case is with the team and when the team will reply (use the team availability note below if present).
- If you still lack a short description of the issue or a detail the team needs, ask for it in the same message so the team can act faster.
- Keep it to 2-3 short sentences. Stay calm and warm even if they swear.`;
// Cách bot trả lời trong lúc khách chờ team (đã chuyển người, chưa ai trong team trả lời)
export const WAITING_DEFAULT = `Reply to what the customer's latest message actually says:
- A greeting, thanks, "ok", an emoji or small talk: reply in a few natural words, the way a person would (greet back and ask how you can help, "You're welcome!", a short kind line for a sad or angry emoji). Do not mention their case or the team's reply time.
- A NEW question that the snippets or help center answer: answer it normally (with steps and link).
- About their case (an update, when or whether someone will reply, upset about waiting): in 1-2 short sentences, say the team has their case and when the team is expected to reply.
- More details for their issue (a screenshot, a link, what they tried): thank them in one short sentence and say the team will see it.
Never repeat what you already told them in this conversation (for example that the team has their case, or when the team will reply) unless they ask about it again.`;
export const MAX_RULE_CHARS = 3000;

export const ESCALATION_DEFAULT = {
  triggers: { askHuman: true, billing: true, angry: true, bug: true, noAnswer: true, sensitive: true, promises: true },
  custom: [], // lý do chuyển người team tự thêm: [{ id, text, enabled }]
  askInfo: true,
  fields: FIELDS_DEFAULT,
  cooldownMin: 2,
  // Đã chuyển người mà khách im lâu hơn số giờ này rồi mới nhắn lại → coi là cuộc chat mới (0 = không bao giờ).
  // Hội thoại trên Crisp không tự đóng nên cần mốc này.
  resetHours: 2,
  note: true, // để lại ghi chú bàn giao (private note) cho team khi chuyển người, xem handoff.js
  noteLang: "English", // ngôn ngữ AI viết ghi chú bàn giao
  noteExtra: "", // team dặn thêm AI nên ghi gì trong ghi chú
  priority: PRIORITY_DEFAULT,
  urgent: URGENT_DEFAULT,
  upset: null, // null = UPSET_DEFAULT; chuỗi = luật của team ("" = không có luật riêng cho khách bực)
  waiting: null, // null = WAITING_DEFAULT
};

export const FOLLOWUP_DEFAULT = {
  feedback: true,
  feedbackText: "Did that answer your question?",
  yesLabel: "👍 Yes, that helped",
  noLabel: "👎 I still need help",
  thanksText: "Great, glad I could help! If anything else comes up, just message us here.",
  nudge: true,
  nudgeMin: 15,
  nudgeText: "Just checking in: did that work for you? If you still need help, just reply here.",
  infoNudge: true,
  infoNudgeMin: 30,
  infoNudgeText: "Whenever you're ready, just send the details above so our team can check it for you.",
  close: true,
  closeHours: 24,
  autoResolve: false,
  // Câu gửi khách khi AI không trả lời được (OpenAI lỗi hoặc quá chậm, kể cả sau khi thử lại)
  fallbackText: "Sorry, I couldn't answer that right now. Our team will get back to you as soon as possible.",
};

export const FEEDBACK_ID = "tb-feedback";

// Múi giờ chọn được trên /admin (giờ lệch so với GMT)
export const UTC_OFFSETS = ["-12", "-11", "-10", "-9.5", "-9", "-8", "-7", "-6", "-5", "-4", "-3.5", "-3", "-2", "-1", "0", "1", "2", "3", "3.5", "4", "4.5", "5", "5.5", "5.75", "6", "6.5", "7", "8", "8.75", "9", "9.5", "10", "10.5", "11", "12", "12.75", "13", "14"];

// Câu hỏi mẫu trong khung Test the bot: team tự lưu
export const MAX_TEST_QUESTIONS = 12;
export const normQuestions = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, 200)).filter(Boolean))].slice(0, MAX_TEST_QUESTIONS);

const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/; // http chỉ cho máy local khi test

export const SETTINGS_FIELDS = {
  mode: { env: "BOT_MODE", label: "Bot mode", values: ["off", "offline", "always"] },
  botName: { env: "BOT_NAME", label: "Bot name", max: 40, required: true },
  product: { env: "PRODUCT_NAME", label: "Product name", max: 60 },
  productDesc: { env: "PRODUCT_DESC", label: "About the product", max: 1000, multiline: true },
  helpUrl: { env: "HELP_CENTER_URL", label: "Help center", max: 200, check: (v) => !v || HTTPS_URL.test(v), error: "The help center link must start with https://" },
  helpSections: { env: "HELP_CENTER_SECTIONS", label: "Help center sections", max: 200, check: (v) => /^[\w\-/, ]*$/.test(v), error: "Sections: path names separated by commas, like docs,faq" },
  helpPages: { env: "HELP_CENTER_PAGES", label: "Help center pages", max: 40000, multiline: true, check: (v) => v.split("\n").filter((l) => l.trim()).every((l) => HTTPS_URL.test(l.trim())), error: "Help center pages: one link per line, each starting with https://" },
  helpSelector: { env: "HELP_CENTER_SELECTOR", label: "Help center content area", max: 120, check: (v) => /^[\w\-.#\[\]="' >:()]*$/.test(v), error: "Content area: a CSS selector like .article-body or #main-content" },
  language: { env: "BOT_LANGUAGE", label: "Reply language", max: 30, required: true },
  businessHours: { env: "BUSINESS_HOURS", label: "Working hours", max: 80, check: (v) => !v || !!parseBusinessHours(v), error: "Working hours format is invalid (example: Mon-Sun 08:00-24:00)" },
  utcOffset: { env: "UTC_OFFSET_HOURS", label: "Time zone", values: UTC_OFFSETS },
  supportEmail: { env: "SUPPORT_EMAIL", label: "Support email", max: 120, check: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), error: "That email address isn't valid" },
  model: { env: "OPENAI_MODEL", label: "AI model", max: 60, required: true },
  effort: { env: "OPENAI_REASONING_EFFORT", label: "Reasoning effort", values: ["off", "low", "medium"] },
};

export const LOG_MAX = 300;

export const QUEUE = "fu:queue";

export const cfg = (env, k) => (env[k] !== undefined && env[k] !== "" ? String(env[k]) : DEFAULTS[k]);

// Cài đặt lưu trên /admin (KV cfg:settings, cfg:tags) đè lên biến môi trường Cloudflare
export function applySettings(env, saved = {}, tagsRaw = env.__tagsRaw) {
  const orig = env.__orig || env;
  const e = { ...orig, __ready: true, __orig: orig, __saved: saved, __tagsRaw: tagsRaw };
  for (const [k, f] of Object.entries(SETTINGS_FIELDS)) if (saved[k] != null && saved[k] !== "") e[f.env] = String(saved[k]);
  e.__esc = normEscalation(saved.escalation);
  e.__fu = normFollowup(saved.followup);
  e.__test = normQuestions(saved.testQuestions);
  e.__tags = normTags(tagsRaw, orig);
  return e;
}

export async function withConfig(env) {
  if (env.__ready) return env;
  const [saved, tagsRaw, aiKey] = await Promise.all([getJSON(env, "cfg:settings"), getJSON(env, "cfg:tags"), getJSON(env, AI_KEY)]);
  const s = upgradeSettings(saved, env) || {}; // bot chạy từ trước bản 2: giữ nội dung cũ (compat.js); bot mới: mặc định trung tính
  if (s.mode == null && env.KB) {
    const legacy = await env.KB.get("settings:mode"); // nút bật/tắt của trang /report cũ
    if (legacy) s.mode = legacy;
  }
  return applySettings(withAiKey(env, aiKey), s, tagsRaw);
}

// Khoá OpenAI nhập trên /admin → Settings → AI. Lưu ở KV riêng, KHÔNG nằm trong file sao lưu, không bao giờ gửi lại trình duyệt.
export const AI_KEY = "secret:openai";

export const keyHint = (k) => (k ? `${k.slice(0, 3)}…${k.slice(-4)}` : "");

// Khoá lưu trên /admin thắng biến OPENAI_API_KEY đặt ở Cloudflare. env.__aiKey = thông tin để hiện trên admin (không có khoá).
export function withAiKey(env, saved) {
  const cf = env.__cfOpenAI !== undefined ? env.__cfOpenAI : env.OPENAI_API_KEY || "";
  const key = saved?.key || cf;
  const from = saved?.key ? "admin" : cf ? "cloudflare" : null;
  return { ...env, __cfOpenAI: cf, OPENAI_API_KEY: key, __aiKey: { from, hint: keyHint(key), by: saved?.key ? saved.by || null : null, at: saved?.key ? saved.at || null : null, cloudflare: !!cf } };
}

// Mức "nghĩ" của AI: off (không nghĩ, nhanh nhất) | low | medium.
// "high" từng có trong Settings nhưng AI nghĩ lâu hơn thời gian khách chờ được, nên coi như "medium".
export function effortLevel(env) {
  const e = cfg(env, "OPENAI_REASONING_EFFORT");
  return e === "high" ? "medium" : ["off", "low", "medium"].includes(e) ? e : "low";
}

export function currentMode(env) {
  const mode = cfg(env, "BOT_MODE");
  return ["off", "offline", "always"].includes(mode) ? mode : "offline";
}

// Danh sách [{ id, text, enabled }] team tự sửa (thông tin cần hỏi, lý do chuyển người thêm)
export function normItems(v, fallback, max, prefix) {
  if (!Array.isArray(v)) return fallback.map((x) => ({ ...x }));
  const seen = new Set();
  const out = [];
  for (const raw of v) {
    const x = typeof raw === "string" ? { text: raw } : raw && typeof raw === "object" ? raw : {};
    const text = clip(x.text, 300);
    if (!text || out.length >= max) continue;
    let id = typeof x.id === "string" && /^[\w-]{1,40}$/.test(x.id) && !seen.has(x.id) ? x.id : `${prefix}_${uid()}`;
    seen.add(id);
    out.push({ id, text, enabled: x.enabled !== false });
  }
  return out;
}

// Ô luật nhiều dòng: null = dùng mặc định; chuỗi = của team (kể cả chuỗi rỗng)
const ruleText = (v) => (typeof v === "string" ? clip(v, MAX_RULE_CHARS, true) : null);
export const upsetRules = (e) => (e.upset == null ? UPSET_DEFAULT : e.upset);
export const waitingRules = (e) => (e.waiting == null ? WAITING_DEFAULT : e.waiting);

export function normEscalation(x) {
  x = x && typeof x === "object" ? x : {};
  const d = ESCALATION_DEFAULT;
  const triggers = {};
  for (const k of Object.keys(TRIGGERS)) triggers[k] = typeof x.triggers?.[k] === "boolean" ? x.triggers[k] : d.triggers[k];
  const priority = {};
  for (const k of Object.keys(PRIORITY_LEVELS)) priority[k] = clip(x.priority?.[k], 400) || d.priority[k];
  return {
    triggers,
    custom: normItems(x.custom, d.custom, MAX_CUSTOM_REASONS, "r"),
    askInfo: typeof x.askInfo === "boolean" ? x.askInfo : d.askInfo,
    fields: normItems(x.fields, d.fields, MAX_FIELDS, "f"),
    cooldownMin: num(x.cooldownMin, 0, 120, d.cooldownMin),
    resetHours: num(x.resetHours, 0, 168, d.resetHours),
    note: typeof x.note === "boolean" ? x.note : d.note,
    noteLang: clip(x.noteLang, 30) || d.noteLang,
    noteExtra: clip(x.noteExtra ?? d.noteExtra, 600, true),
    priority,
    urgent: clip(x.urgent, 400) || d.urgent,
    upset: ruleText(x.upset),
    waiting: ruleText(x.waiting),
  };
}

export function normFollowup(x) {
  x = x && typeof x === "object" ? x : {};
  const d = FOLLOWUP_DEFAULT;
  const b = (k) => (typeof x[k] === "boolean" ? x[k] : d[k]);
  const t = (k, n) => clip(x[k] ?? d[k], n) || d[k];
  return {
    feedback: b("feedback"),
    feedbackText: t("feedbackText", 120),
    yesLabel: t("yesLabel", 40),
    noLabel: t("noLabel", 40),
    thanksText: t("thanksText", 300),
    nudge: b("nudge"),
    nudgeMin: num(x.nudgeMin, 2, 1440, d.nudgeMin),
    nudgeText: t("nudgeText", 300),
    infoNudge: b("infoNudge"),
    infoNudgeMin: num(x.infoNudgeMin, 2, 1440, d.infoNudgeMin),
    infoNudgeText: t("infoNudgeText", 300),
    close: b("close"),
    closeHours: num(x.closeHours, 1, 168, d.closeHours),
    autoResolve: b("autoResolve"),
    fallbackText: t("fallbackText", 300),
  };
}

export { SETTINGS_VERSION, upgradeSettings };
