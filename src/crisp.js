// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Gọi API Crisp: gửi tin, đọc hội thoại, gắn segment, kiểm tra chữ ký webhook.
import { FEEDBACK_ID, cfg } from "./config.js";

export async function verifySignature(secret, body, timestamp, signature) {
  if (!secret || !timestamp || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`[${timestamp};${JSON.stringify(body)}]`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export const isBotMessage = (env, x) => x.from === "operator" && (x.user?.nickname === cfg(env, "BOT_NAME") || String(x.content?.id || "").startsWith("tb-"));

export async function crisp(env, method, path, body) {
  const auth = btoa(`${env.CRISP_IDENTIFIER}:${env.CRISP_KEY}`);
  const res = await fetch(`${cfg(env, "CRISP_API_BASE")}/v1${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, "X-Crisp-Tier": "plugin", "Content-Type": "application/json", "User-Agent": "SupportBot/2.0" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Crisp ${method} ${path} → ${res.status} ${data.reason || ""}`);
  return data.data;
}

export function botUser(env) {
  const user = { type: "participant", nickname: cfg(env, "BOT_NAME") };
  if (cfg(env, "BOT_AVATAR")) user.avatar = cfg(env, "BOT_AVATAR");
  return user;
}

export function sendMessage(env, websiteId, sessionId, content) {
  return crisp(env, "POST", `/website/${websiteId}/conversation/${sessionId}/message`, {
    type: "text", from: "operator", origin: "chat", content, automated: true, user: botUser(env),
  });
}

// Private note: chỉ team thấy trong inbox Crisp, khách không thấy
export function sendNote(env, websiteId, sessionId, content) {
  return crisp(env, "POST", `/website/${websiteId}/conversation/${sessionId}/message`, {
    type: "note", from: "operator", origin: "chat", content, automated: true, user: botUser(env),
  });
}

export function sendFeedbackPicker(env, websiteId, sessionId) {
  const fu = env.__fu;
  return crisp(env, "POST", `/website/${websiteId}/conversation/${sessionId}/message`, {
    type: "picker", from: "operator", origin: "chat", automated: true, user: botUser(env),
    content: {
      id: FEEDBACK_ID,
      text: fu.feedbackText,
      choices: [
        { value: "yes", label: fu.yesLabel, selected: false },
        { value: "no", label: fu.noLabel, selected: false },
      ],
    },
  });
}

export async function compose(env, websiteId, sessionId, on) {
  try {
    await crisp(env, "PATCH", `/website/${websiteId}/conversation/${sessionId}/compose`, { type: on ? "start" : "stop", from: "operator", automated: true });
  } catch {}
}

// Thông tin app đã gửi vào Crisp cho hội thoại này (session data: store_domain, app_plan, shopify_plan…) + tên khách.
// Không gửi email và mấy thứ giống khoá bí mật cho AI: bot không cần, đỡ lộ dữ liệu khách (team vẫn thấy trong Crisp).
const SKIP_KEY = /token|secret|password|api.?key|signature|hmac/i;
const IS_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function cleanCustomer(data, extra = {}) {
  const out = {};
  const seen = new Set();
  for (const [k, v] of Object.entries({ ...extra, ...(data && typeof data === "object" ? data : {}) })) {
    if (Object.keys(out).length >= 15) break;
    if (SKIP_KEY.test(k) || v == null || typeof v === "object") continue;
    const s = String(v).replace(/\s+/g, " ").trim().slice(0, 120);
    if (!s || IS_EMAIL.test(s) || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out[String(k).trim().slice(0, 40)] = s;
  }
  return out;
}

export async function getCustomer(env, websiteId, sessionId) {
  try {
    const meta = await crisp(env, "GET", `/website/${websiteId}/conversation/${sessionId}/meta`);
    const nick = String(meta?.nickname || "").trim();
    return cleanCustomer(meta?.data, nick && !/^visitor\d*$/i.test(nick) ? { name: nick } : {});
  } catch (e) {
    console.warn("[crisp] Không đọc được thông tin khách:", e?.message || e);
    return {};
  }
}

export async function getSegments(env, websiteId, sessionId) {
  const meta = await crisp(env, "GET", `/website/${websiteId}/conversation/${sessionId}/meta`);
  return meta?.segments || [];
}

export async function updateSegments(env, websiteId, sessionId, { add = [], remove = [], current }) {
  const segments = current || (await getSegments(env, websiteId, sessionId));
  const next = [...new Set([...segments.filter((s) => !remove.includes(s)), ...add])];
  if (next.length === segments.length && next.every((s) => segments.includes(s))) return;
  await crisp(env, "PATCH", `/website/${websiteId}/conversation/${sessionId}/meta`, { segments: next });
}

export async function operatorsOnline(env, websiteId) {
  try {
    const a = await crisp(env, "GET", `/website/${websiteId}/availability/status`);
    return a?.status === "online";
  } catch (e) {
    console.warn("[crisp] Không đọc được availability:", e.message);
    return false;
  }
}
