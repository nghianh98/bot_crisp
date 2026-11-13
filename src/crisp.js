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
    headers: { Authorization: `Basic ${auth}`, "X-Crisp-Tier": "plugin", "Content-Type": "application/json", "User-Agent": "TranstoreBot/2.0" },
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
