// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Thống kê theo tháng, nhật ký câu trả lời của bot, nhật ký thay đổi trên trang /admin.
import { LOG_MAX } from "./config.js";
import { localNow } from "./time.js";
import { clip, getJSON, putJSON } from "./util.js";

export const emptyMonth = () => ({
  conv: {}, // khách (hội thoại) → ngày
  cls: {}, // phân loại khi Resolve
  cat: {}, // chủ đề bot gắn
  botConv: {}, // hội thoại bot tham gia → "bot" | "handoff"
  fb: {}, // khách bấm 👍 "up" / 👎 "down"
  out: {}, // kết thúc: "confirmed" (khách bấm 👍) | "assumed" (khách im lặng sau câu trả lời) | "abandoned" (khách bỏ đi khi bot hỏi thông tin)
  bot: { answers: 0, askInfo: 0, handoffs: 0, gaps: 0, urgent: 0, nudges: 0 },
  days: {},
});

export function normMonth(x) {
  const s = Object.assign(emptyMonth(), x && typeof x === "object" ? x : {});
  s.bot = { ...emptyMonth().bot, ...(x?.bot || {}) };
  for (const k of ["conv", "cls", "cat", "botConv", "fb", "out", "days"]) if (!s[k] || typeof s[k] !== "object") s[k] = {};
  return s;
}

// Mỗi tháng 1 key KV; chỉ ghi khi có thay đổi (tiết kiệm hạn mức ghi của gói free)
export async function recordStats(env, mutate) {
  if (!env.KB) return;
  try {
    const { month, day } = localNow(env);
    const key = `stats:${month}`;
    const s = normMonth(await getJSON(env, key, {}));
    if (mutate(s, day) === false) return;
    await putJSON(env, key, s);
  } catch (e) {
    console.warn("[stats] Lỗi:", e?.message || e);
  }
}

// Nhật ký câu trả lời của bot theo tháng: {items:[...], legacy:true khi đã gộp gaps:YYYY-MM cũ}
export async function readLog(env, month, migrate = true) {
  const raw = await getJSON(env, `log:${month}`, null);
  const log = Array.isArray(raw) ? { items: raw } : raw && Array.isArray(raw.items) ? raw : { items: [] };
  if (migrate && !log.legacy && env.KB) {
    const gaps = await getJSON(env, `gaps:${month}`, []);
    if (Array.isArray(gaps) && gaps.length) {
      const old = gaps.map((g, i) => ({ id: `g${i}${(Date.parse(g.at) || 0).toString(36)}`, t: Date.parse(g.at) || 0, q: clip(g.q, 300, true), gap: true, legacy: true }));
      log.items = [...old, ...log.items].sort((a, b) => a.t - b.t).slice(-LOG_MAX);
      log.legacy = true;
      await putJSON(env, `log:${month}`, log);
    }
  }
  return log;
}

export async function appendLog(env, entry) {
  if (!env.KB) return;
  try {
    const month = localNow(env).month;
    const log = await readLog(env, month, false);
    log.items.push(entry);
    log.items = log.items.slice(-LOG_MAX);
    await putJSON(env, `log:${month}`, log);
  } catch (e) {
    console.warn("[log] Lỗi:", e?.message || e);
  }
}

export async function markLog(env, sessionId, patch) {
  if (!env.KB) return;
  try {
    const month = localNow(env).month;
    const log = await readLog(env, month, false);
    const it = [...log.items].reverse().find((x) => x.sid === sessionId);
    if (!it) return;
    Object.assign(it, patch);
    await putJSON(env, `log:${month}`, log);
  } catch (e) {
    console.warn("[log] Lỗi:", e?.message || e);
  }
}

/* Trừ các câu trả lời vừa xoá (trang Conversations → Delete, vd hội thoại team tự test) khỏi số liệu của tháng.
   gone = các mục nhật ký vừa xoá; left = Set các hội thoại vẫn còn câu trả lời trong nhật ký tháng đó.
   Từng câu: trừ số câu trả lời, số lần hỏi thêm thông tin, thiếu kiến thức, khách bực, chuyển người (theo ngày và cả tháng).
   Hội thoại không còn câu nào: bỏ hẳn khỏi thống kê (khách, bot tham gia, kết quả, đánh giá, chủ đề). Số không xuống dưới 0. */
export async function forgetReplies(env, month, gone, left) {
  const key = `stats:${month}`;
  const s = normMonth(await getJSON(env, key, {}));
  const dec = (o, k) => {
    if (o && o[k] > 0) o[k]--;
  };
  const first = {}; // hội thoại → câu trả lời sớm nhất trong số vừa xoá
  for (const x of gone) {
    if (x.legacy) continue; // mục của báo cáo cũ: không nằm trong số liệu này
    const d = s.days[localNow(env, x.t).day];
    dec(s.bot, "answers");
    dec(d, "answers");
    if (x.act === "ask_info") dec(s.bot, "askInfo");
    if (x.gap) dec(s.bot, "gaps");
    if (x.urg) dec(s.bot, "urgent");
    // Lần chuyển người được đếm ở câu trả lời đầu tiên chuyển (ho = hội thoại đã chuyển từ trước)
    if (x.act === "handoff" && !x.ho) {
      dec(s.bot, "handoffs");
      dec(d, "handoffs");
    }
    if (x.sid && (!first[x.sid] || x.t < first[x.sid].t)) first[x.sid] = x;
  }
  for (const [sid, x] of Object.entries(first)) {
    if (left.has(sid)) continue;
    if (s.botConv[sid]) dec(s.days[localNow(env, x.t).day], "involved");
    for (const k of ["conv", "cls", "cat", "botConv", "fb", "out"]) delete s[k][sid];
  }
  await putJSON(env, key, s);
}

export async function logChange(env, who, what) {
  const arr = await getJSON(env, "cfg:changelog", []);
  arr.push({ t: Date.now(), who: who || "Admin", what: clip(what, 300) });
  await putJSON(env, "cfg:changelog", arr.slice(-200));
}
