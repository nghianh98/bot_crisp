// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Hàm nhỏ dùng chung.
export const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const uid = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

export const clip = (v, n, multiline = false) => {
  let s = String(v ?? "").replace(/\r/g, "");
  s = multiline ? s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : s.replace(/\s+/g, " ");
  return s.trim().slice(0, n);
};

export const num = (v, min, max, def) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

export async function getJSON(env, key, fallback = null) {
  if (!env.KB) return fallback;
  const v = await env.KB.get(key);
  if (v == null) return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

export const putJSON = (env, key, value) => env.KB.put(key, JSON.stringify(value));

export async function hash(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class UserError extends Error {}

export const bad = (message) => {
  throw new UserError(message);
};
