// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Tag vấn đề gắn cho hội thoại trong Crisp: danh sách tag, tiền tố, segment trạng thái.
import { CATEGORIES, MAX_TAGS, cfg } from "./config.js";
import { clip } from "./util.js";

export const tagSlug = (v, max = 30) => (typeof v === "string" && new RegExp(`^[a-z0-9][a-z0-9_-]{0,${max - 1}}$`).test(v) ? v : null);

export function cleanTag(x) {
  const key = tagSlug(String(x?.key || "").trim().toLowerCase());
  if (!key) return null;
  return { key, label: clip(x.label, 60) || key, desc: clip(x.desc, 400) || clip(x.label, 60) || key, enabled: key === "other" ? true : x.enabled !== false };
}

export function normTags(x, env) {
  x = x && typeof x === "object" ? x : {};
  const seen = new Set();
  let items = (Array.isArray(x.items) && x.items.length ? x.items : Object.entries(CATEGORIES).map(([key, [label, desc]]) => ({ key, label, desc })))
    .map(cleanTag)
    .filter((t) => t && !seen.has(t.key) && seen.add(t.key))
    .slice(0, MAX_TAGS);
  if (!seen.has("other")) items.push({ key: "other", label: "Other", desc: "Doesn't fit any tag above", enabled: true });
  const seg = (v, def) => tagSlug(v, 40) || def;
  return {
    prefix: typeof x.prefix === "string" && /^[a-z0-9_-]{0,20}$/.test(x.prefix) ? x.prefix : cfg(env, "TAG_PREFIX"),
    timing: x.timing === "resolve" ? "resolve" : "first",
    items,
    segments: {
      paused: seg(x.segments?.paused, cfg(env, "PAUSED_SEGMENT")),
      handoff: seg(x.segments?.handoff, cfg(env, "HANDOFF_SEGMENT")),
      urgent: seg(x.segments?.urgent, cfg(env, "URGENT_SEGMENT")),
    },
  };
}

export const tagKeys = (env) => env.__tags.items.filter((t) => t.enabled).map((t) => t.key);

export const tagName = (env, key) => env.__tags.prefix + key;

// Segment trong Crisp có phải tag issue không → trả về key
export function tagOfSegment(env, s) {
  const p = env.__tags.prefix;
  if (p && !s.startsWith(p)) return null;
  const k = s.slice(p.length);
  return tagKeys(env).includes(k) ? k : null;
}
