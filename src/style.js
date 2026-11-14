// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
/* Văn phong (admin → Writing style). Chỉ là CÔNG CỤ: mọi nội dung văn phong do team tự viết trên admin.
   - rules: luật viết (độ dài, mở đầu, kết, cách ghi bước, link…). null = dùng DEFAULT_RULES (đúng luật cũ trước khi có trang này).
   - intro: bot tự giới thiệu ở tin đầu (vd "Lio from the Transtore Support Team"). Trống = không giới thiệu.
   - examples: câu trả lời thật của team; bot học GIỌNG từ đó, không lấy thông tin. Thông tin chỉ từ snippet và help center.
   Lưu ở KV cfg:style. */
import { clip, getJSON, uid } from "./util.js";

export const STYLE_KEY = "cfg:style";
export const MAX_RULES_CHARS = 4000;
export const MAX_EXAMPLES = 100;
export const MAX_EXAMPLE_CHARS = 3000;
export const MAX_STYLE_CHARS = 120000; // tổng chữ của mọi câu mẫu
export const EXAMPLES_PER_REPLY = 6; // số câu mẫu gửi cho AI mỗi lần trả lời (chọn câu gần với tin của khách nhất)

// Luật viết mặc định = đúng luật bot dùng trước khi có trang Writing style (để prod không đổi cho tới khi team sửa).
// Team sửa / xoá trên admin; nút "Restore default" quay về đúng chữ này.
export const DEFAULT_RULES = `- Warm, human, to the point, like a helpful support agent in a chat window.
- Answer only what was asked. Do not add extra facts, limits or tips the customer did not ask about.
- First line: the direct answer in one short sentence.
- Steps: a numbered list, one step per line ("1. ...", "2. ..."), max 5 steps, each step one short line. Write menu paths as: Language > Add target language.
- When asking the customer for several details, list each one on its own numbered line too.
- Leave one empty line between the first line, the steps and the link.
- Link: when an article helps, put its url (the url attribute) alone on the LAST line, prefixed with "Full guide: ". Never put a url inside a sentence. At most one link.
- No closing questions like "Anything else?" unless the conversation needs one.
- Keep the whole reply under about 80 words, unless the steps really need more.

Example of a good reply (the format only; the product and steps here are made up):
You can turn on email alerts from the Notifications page.

1. Open the app and go to Settings > Notifications.
2. Turn on Email alerts.
3. Enter the address that should receive them.
4. Click Save.

Full guide: https://help.example.com/docs/email-alerts`;

export const STYLE_DEFAULT = { rules: null, intro: "", examples: [] };

export function cleanExample(x = {}, who = "", prev = null) {
  return {
    id: typeof x.id === "string" && /^[\w-]{3,40}$/.test(x.id) ? x.id : "ex_" + uid(),
    group: clip(x.group, 60),
    situation: clip(x.situation, 160),
    text: clip(x.text, MAX_EXAMPLE_CHARS, true),
    enabled: x.enabled !== false,
    at: prev?.at || (Number.isFinite(x.at) ? x.at : Date.now()),
    upd: Date.now(),
    by: clip(who || x.by, 40),
  };
}

export const cleanRules = (v) => (typeof v === "string" ? clip(v, MAX_RULES_CHARS, true) : null);

export function normStyle(x) {
  x = x && typeof x === "object" ? x : {};
  const examples = (Array.isArray(x.examples) ? x.examples : [])
    .filter((e) => e && typeof e === "object" && typeof e.text === "string" && e.text.trim())
    .slice(0, MAX_EXAMPLES)
    .map((e) => ({ ...cleanExample(e, e.by), upd: Number.isFinite(e.upd) ? e.upd : Date.now() }));
  return { rules: cleanRules(x.rules), intro: clip(x.intro, 80), examples };
}

export const getStyle = async (env) => normStyle(env.KB ? await getJSON(env, STYLE_KEY) : null);

/** Luật viết đang dùng: của team, hoặc mặc định khi team chưa sửa */
export const rulesOf = (style) => (style?.rules == null ? DEFAULT_RULES : style.rules);

// Bỏ dấu tiếng Việt, chữ thường, tách từ (≥ 3 ký tự) để so độ gần giữa tin của khách và câu mẫu
const STOP = new Set("the and for you your are can with this that have has not but our from was were will would could should please there here what when where which who how why its it's i'm i've don't doesn't into about just also they them their then than more some any all one out get got let may like need want".split(" "));
export const terms = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));

/** Chọn tối đa n câu mẫu gần nhất với mấy tin gần đây của khách; không có câu nào gần thì lấy theo thứ tự trong danh sách */
export function pickExamples(examples, history, n = EXAMPLES_PER_REPLY) {
  const on = (examples || []).filter((e) => e.enabled && e.text);
  if (on.length <= n) return on;
  const q = new Set(terms((history || []).filter((h) => h.role === "user").slice(-3).map((h) => h.content).join(" ")));
  const scored = on.map((e, i) => {
    const head = new Set(terms(`${e.group} ${e.situation}`));
    const body = new Set(terms(e.text));
    let s = 0;
    for (const w of q) s += (head.has(w) ? 2 : 0) + (body.has(w) ? 1 : 0);
    return { e, i, s };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, n).sort((a, b) => a.i - b.i).map((x) => x.e);
}

const attr = (s) => String(s || "").replace(/["<>\n]/g, " ").trim();

/** Phần prompt chứa câu mẫu (đặt sau phần cố định để giữ prompt cache). Chỉ dặn cách dùng, không thêm văn phong nào. */
export function examplesBlock(product, examples) {
  if (!examples?.length) return "";
  return `<reply_examples>
Replies written by the ${product} support team, picked for this conversation. Write in the same voice as these replies, while following the team's writing rules above.
They show the voice, not knowledge: never take facts, numbers, prices, time promises, links, people's names, other apps' names or store names from them unless the snippets or help center say the same.
${examples.map((e) => `<example${e.group || e.situation ? ` situation="${attr([e.group, e.situation].filter(Boolean).join(": "))}"` : ""}>\n${e.text}\n</example>`).join("\n")}
</reply_examples>`;
}
