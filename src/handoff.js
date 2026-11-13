// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Ghi chú bàn giao: khi bot chuyển khách cho team, để lại 1 private note trong Crisp (khách không thấy)
// tóm tắt vì sao cần người, khách cần gì, thông tin đã có, còn thiếu gì, team nên làm gì trước.
// AI viết phần tóm tắt ngay trong lần trả lời khách (thêm field handoff_brief), không tốn thêm lượt gọi AI.
import { clip } from "./util.js";

// Bật khi: công tắc "Note for the team" (Escalation) đang bật VÀ bot có ít nhất 1 lý do được chuyển người
export const briefOn = (env) => !!env.__esc.note && Object.values(env.__esc.triggers).some(Boolean);

export const BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: 'Private note for the support team. Fill it only when action is "handoff"; for any other action use "" and [] everywhere.',
  required: ["reason", "summary", "impact", "details", "repro", "tried", "missing", "next_step"],
  properties: {
    reason: { type: "string", description: "Why a human is needed, in a few words" },
    summary: { type: "string", description: "One sentence: what the customer needs" },
    impact: { type: "string", description: "Who or what is affected and how badly: blocked or inconvenienced, live storefront or not, since when" },
    details: { type: "array", items: { type: "string" }, description: "Facts the customer gave, one per item" },
    repro: { type: "array", items: { type: "string" }, description: "For bugs only: numbered steps to see the problem, with exact pages, buttons and error text" },
    tried: { type: "array", items: { type: "string" }, description: "What the customer already tried and what the bot already told them" },
    missing: { type: "array", items: { type: "string" }, description: "What the team still needs to ask the customer" },
    next_step: { type: "string", description: "The first thing the team should do" },
  },
};

export const BRIEF_RULE = `- "handoff_brief": when action is "handoff", a private note for the support team. The customer never sees it; the team reads it before replying, so they should not need to scroll up. Always write it in English, short and factual: only what is in the conversation, never guess or invent.
  reason: why a human is needed (a few words). summary: one sentence on what the customer needs.
  impact: who or what is affected and how badly (blocked or just inconvenienced, live storefront or not, since when), from what the customer said.
  details: facts the customer gave (store URL, theme, page, error text, plan, amounts, dates), one per item.
  repro: only for bugs, the steps to see the problem (exact page, button, error text as the customer wrote it); empty list otherwise or if unknown.
  tried: what the customer already tried and what you already told them. missing: what the team still needs to ask (empty list if nothing).
  next_step: the first thing the team should do (for example: check the app embed on the store, refund the duplicate charge, reply to an angry customer first).
  For any other action, leave every field empty ("" and []).`;

const line = (v, n = 300) => clip(v, n);
const items = (v, n = 8) => (Array.isArray(v) ? v.map((x) => line(x, 240)).filter(Boolean).slice(0, n) : []);

export function cleanBrief(b) {
  b = b && typeof b === "object" ? b : {};
  const out = { reason: line(b.reason, 160), summary: line(b.summary), impact: line(b.impact), details: items(b.details), repro: items(b.repro), tried: items(b.tried), missing: items(b.missing), next_step: line(b.next_step) };
  return out.summary || out.reason || out.next_step || out.details.length ? out : null;
}

const tagLabel = (env, key) => env.__tags.items.find((t) => t.key === key)?.label || key;

// Nội dung note (chữ thường + xuống dòng: note trong Crisp không hiện markdown).
// r = kết quả generateReply. question = tin nhắn cuối của khách (dùng khi AI hỏng, không có tóm tắt).
export function handoffNote(env, r, question = "") {
  const head = ["🤖 Handoff note", r.priority || "", r.category && r.category !== "other" ? tagLabel(env, r.category) : "", r.urgent ? "angry customer" : ""].filter(Boolean).join(" · ");
  const out = [head];
  const b = r.failed ? null : cleanBrief(r.handoff_brief);
  if (!b) {
    out.push(r.failed ? `The bot could not answer (AI error), so it told the customer the team will reply.` : "The bot handed this conversation to the team.");
    if (question) out.push(`Customer's last message: ${line(question, 400)}`);
    return out.join("\n");
  }
  if (b.reason) out.push(`Why: ${b.reason}`);
  if (b.summary) out.push(`Needs: ${b.summary}`);
  if (b.impact) out.push(`Impact: ${b.impact}`);
  const block = (title, list) => list.length && out.push("", `${title}:`, ...list.map((x) => `• ${x}`));
  block("Details", b.details);
  if (b.repro.length) out.push("", "Steps to reproduce:", ...b.repro.map((x, i) => `${i + 1}. ${x.replace(/^\d+[.)]\s*/, "")}`));
  block("Already tried", b.tried);
  block("Still missing", b.missing);
  if (b.next_step) out.push("", `Next step: ${b.next_step}`);
  return out.join("\n");
}
