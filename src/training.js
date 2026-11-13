// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Snippet và hướng dẫn do team viết trên trang /admin (kèm chuyển dữ liệu từ trang /settings cũ).
import { GUIDANCE_CATS } from "./config.js";
import { clip, getJSON, uid } from "./util.js";

// Hướng dẫn và snippet: bản lưu trên /admin; chưa có thì lấy từ trang /settings cũ
export async function getTraining(env) {
  const [g, sn] = await Promise.all([getJSON(env, "cfg:guidance"), getJSON(env, "cfg:snippets")]);
  if (g && sn) return { guidance: g, snippets: sn };
  const legacy = await legacyTraining(env);
  return { guidance: g || legacy.guidance, snippets: sn || legacy.snippets };
}

export async function legacyTraining(env) {
  if (!env.KB) return { guidance: [], snippets: [] };
  const [p, ins, faq] = await Promise.all(["custom:personality", "custom:instructions", "custom:faq"].map((k) => env.KB.get(k)));
  const guidance = [];
  if (p?.trim()) guidance.push(cleanGuidance({ id: "g_personality", cat: "tone", title: "Personality (from the old settings page)", text: p }, "System"));
  if (ins?.trim()) guidance.push(cleanGuidance({ id: "g_rules", cat: "other", title: "Rules (from the old settings page)", text: ins }, "System"));
  return { guidance, snippets: parseFaq(faq || "", "legacy", "System") };
}

// "H: câu hỏi\nĐ: trả lời" (hoặc Q:/A:), các cặp cách nhau 1 dòng trống
export function parseFaq(text, src = "import", who = "") {
  const out = [];
  for (const block of String(text).replace(/\r/g, "").split(/\n\s*\n/)) {
    let q = "", a = "", cur = null;
    for (const line of block.split("\n")) {
      const m = line.match(/^\s*(H|Q|Hỏi|Question|Đ|A|Trả lời|Answer)\s*[:：]\s*(.*)$/i);
      if (m) {
        cur = /^(h|q|hỏi|question)$/i.test(m[1]) ? "q" : "a";
        if (cur === "q") q += (q ? " " : "") + m[2];
        else a += (a ? "\n" : "") + m[2];
      } else if (cur === "q") q += " " + line.trim();
      else a += (a ? "\n" : "") + line;
    }
    q = q.trim();
    a = a.trim();
    if (!a) continue;
    if (!q) {
      const lines = a.split("\n");
      q = lines[0];
      a = lines.slice(1).join("\n").trim() || a;
    }
    out.push(cleanSnippet({ q, a, src }, who));
  }
  return out;
}

export function cleanSnippet(x = {}, who = "", prev = null) {
  const now = Date.now();
  return {
    id: typeof x.id === "string" && /^[\w-]{3,40}$/.test(x.id) ? x.id : "sn_" + uid(),
    q: clip(x.q, 300),
    a: clip(x.a, 2000, true),
    enabled: x.enabled !== false,
    src: ["manual", "gap", "import", "legacy"].includes(x.src) ? x.src : "manual",
    at: prev?.at || (Number.isFinite(x.at) ? x.at : now),
    upd: now,
    by: clip(who || x.by, 40),
  };
}

export function cleanGuidance(x = {}, who = "") {
  return {
    id: typeof x.id === "string" && /^[\w-]{3,40}$/.test(x.id) ? x.id : "g_" + uid(),
    cat: GUIDANCE_CATS[x.cat] ? x.cat : "other",
    title: clip(x.title, 80),
    text: clip(x.text, 3000, true),
    enabled: x.enabled !== false,
    upd: Date.now(),
    by: clip(who || x.by, 40),
  };
}
