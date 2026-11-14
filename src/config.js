// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giá trị mặc định và cài đặt của bot. Cài đặt lưu trên trang /admin đè lên biến đặt ở Cloudflare.
import { normTags } from "./tags.js";
import { parseBusinessHours } from "./time.js";
import { clip, getJSON, num } from "./util.js";

export const DEFAULTS = {
  BOT_NAME: "Support Bot",
  // Sản phẩm bot hỗ trợ: điền trên /admin → Settings → Product (mỗi app một bộ, không ghi cứng trong code)
  PRODUCT_NAME: "our product",
  PRODUCT_DESC: "",
  BOT_AVATAR: "",
  BOT_MODE: "offline",
  BOT_LANGUAGE: "English",
  BUSINESS_HOURS: "",
  UTC_OFFSET_HOURS: "7",
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
  SUPPORT_EMAIL: "",
  BOT_ORIGINS: "chat",
  PAUSED_SEGMENT: "bot-paused", // nhân viên đã vào → bot im hẳn
  HANDOFF_SEGMENT: "bot-handoff", // bot đã chuyển người → bot chỉ trấn an khách
  URGENT_SEGMENT: "urgent", // khách giận / doạ report / store lỗi nặng
  P1_SEGMENT: "p1-critical", // mức ưu tiên P1: store/checkout hỏng, mất dữ liệu, bảo mật
  P2_SEGMENT: "p2-high", // mức ưu tiên P2: tính năng chính hỏng, không có cách tạm
  TAG_PREFIX: "issue-",
  CLASSIFY_ON_RESOLVE: "true",
  DEBOUNCE_MS: "2500",
  HISTORY_LIMIT: "20",
  // Đã chuyển người mà khách im lâu hơn số giờ này rồi mới nhắn lại → coi là cuộc chat mới: bot trả lời bình thường,
  // không nhắc lại "team đang giữ case" (trừ khi khách hỏi về case cũ). Hội thoại trên Crisp không tự đóng nên cần mốc này.
  HANDOFF_RESET_HOURS: "2",
  PAGES_PER_RUN: "6",
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
  display: ["Display", "Display issues, theme or layout conflicts"],
  billing: ["Billing", "Plans, payments, refunds"],
  uninstall: ["Uninstall", "Uninstalling, cancelling the plan"],
  "feature-request": ["Feature request", "Feature requests"],
  account: ["Account & access", "Account, access, collaborator requests"],
  other: ["Other", "Doesn't fit any tag above"],
};

export const MAX_TAGS = 30;

export const MODE_LABELS = { off: "Off", offline: "When team is offline", always: "Always on" };

export const GUIDANCE_CATS = {
  tone: { label: "Tone and personality", hint: "How the bot talks: friendly or formal, short or detailed, with or without emoji.", prompt: "Tone and personality" },
  clarify: { label: "Clarifying questions", hint: "When the bot should ask the customer something before answering.", prompt: "Asking clarifying questions" },
  content: { label: "Content and sources", hint: "What the bot should prioritise, mention or avoid.", prompt: "Content and sources" },
  handoff: { label: "Handing off to the team", hint: "What the bot tells the customer when it passes the conversation to the team.", prompt: "Handing off to the team" },
  other: { label: "Other rules", hint: "Anything else. Write it as: if the customer asks X, do Y.", prompt: "Additional rules" },
};

export const TRIGGERS = {
  askHuman: { label: "Customer asks for a person", hint: "The customer says they want to talk to someone on the team.", prompt: "the customer asks for a human" },
  billing: { label: "Refunds and billing disputes", hint: "Refunds, unexpected charges, cancellations that involve money.", prompt: "refunds, unexpected charges or billing disputes" },
  angry: { label: "Angry customer", hint: "The customer is upset or threatens a 1-star review, a chargeback or uninstalling.", prompt: "the customer is angry or threatens a bad review, a chargeback or to uninstall" },
  bug: { label: "Problems the team must check", hint: "Something still doesn't work after following the docs, or the app shows an error.", prompt: "bugs: something still doesn't work on the customer's side after following the docs, or the app shows an error" },
  sensitive: { label: "Security, privacy and legal", hint: "Data access or deletion, GDPR, security problems, terms or contract questions. The bot hands these off right away instead of answering.", prompt: "security problems, data privacy or deletion requests (GDPR), someone else accessing the account, or legal, terms and contract questions" },
  promises: { label: "Promises the bot can't make", hint: "When a feature will ship, roadmap, discounts, exceptions or custom deals.", prompt: "anything that needs a promise: release dates or roadmap, discounts, exceptions to a policy or custom deals" },
  noAnswer: { label: "The bot has no answer", hint: "Snippets and the help center don't cover the question. When off, the bot says it doesn't have that information yet and suggests the support email.", prompt: "questions the snippets and help center do not answer" },
};

export const INFO_FIELDS = {
  storeUrl: { label: "Store URL (xxx.myshopify.com)", prompt: "store URL (xxx.myshopify.com)" },
  issue: { label: "What's wrong, and on which page", prompt: "what exactly is wrong and on which page" },
  theme: { label: "Theme name", prompt: "theme name" },
  tried: { label: "Steps already tried", prompt: "steps already tried" },
  screenshot: { label: "Screenshot or screen recording", prompt: "a screenshot or screen recording" },
};

export const ESCALATION_DEFAULT = {
  triggers: { askHuman: true, billing: true, angry: true, bug: true, noAnswer: true, sensitive: true, promises: true },
  askInfo: true,
  fields: ["storeUrl", "issue", "theme", "tried", "screenshot"],
  cooldownMin: 2,
  note: true, // để lại ghi chú bàn giao (private note) cho team khi chuyển người, xem handoff.js
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
};

export const FEEDBACK_ID = "tb-feedback";

// Câu gửi khách khi AI không trả lời được (OpenAI lỗi hoặc quá chậm, kể cả sau khi thử lại)
export const AI_FALLBACK_REPLY = "Sorry, I couldn't answer that right now. Our team will get back to you as soon as possible.";

const HTTPS_URL = /^https:\/\/[^\s/]+\.[^\s/]+(\/\S*)?$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/; // http chỉ cho máy local khi test

export const SETTINGS_FIELDS = {
  mode: { env: "BOT_MODE", label: "Bot mode", values: ["off", "offline", "always"] },
  botName: { env: "BOT_NAME", label: "Bot name", max: 40, required: true },
  product: { env: "PRODUCT_NAME", label: "Product name", max: 60 },
  productDesc: { env: "PRODUCT_DESC", label: "About the product", max: 1000, multiline: true },
  helpUrl: { env: "HELP_CENTER_URL", label: "Help center", max: 200, check: (v) => !v || HTTPS_URL.test(v), error: "The help center link must start with https://" },
  helpSections: { env: "HELP_CENTER_SECTIONS", label: "Help center sections", max: 200, check: (v) => /^[\w\-/, ]*$/.test(v), error: "Sections: path names separated by commas, like docs,faq" },
  language: { env: "BOT_LANGUAGE", label: "Reply language", max: 30, required: true },
  businessHours: { env: "BUSINESS_HOURS", label: "Working hours", max: 80, check: (v) => !v || !!parseBusinessHours(v), error: "Working hours format is invalid (example: Mon-Sun 08:00-24:00)" },
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
  e.__tags = normTags(tagsRaw, orig);
  return e;
}

export async function withConfig(env) {
  if (env.__ready) return env;
  const [saved, tagsRaw, aiKey] = await Promise.all([getJSON(env, "cfg:settings"), getJSON(env, "cfg:tags"), getJSON(env, AI_KEY)]);
  const s = saved || {};
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

export function normEscalation(x) {
  x = x && typeof x === "object" ? x : {};
  const d = ESCALATION_DEFAULT;
  const triggers = {};
  for (const k of Object.keys(TRIGGERS)) triggers[k] = typeof x.triggers?.[k] === "boolean" ? x.triggers[k] : d.triggers[k];
  return {
    triggers,
    askInfo: typeof x.askInfo === "boolean" ? x.askInfo : d.askInfo,
    fields: Array.isArray(x.fields) ? Object.keys(INFO_FIELDS).filter((f) => x.fields.includes(f)) : [...d.fields],
    cooldownMin: num(x.cooldownMin, 0, 120, d.cooldownMin),
    note: typeof x.note === "boolean" ? x.note : d.note,
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
  };
}
