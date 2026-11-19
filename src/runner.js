// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giao việc trả lời khách cho Durable Object của hội thoại (conversation.js). File này không import gì của Cloudflare,
// để bot.js và followup.js dùng được mà không kéo theo conversation.js.

/** job = { w: websiteId, sid: sessionId, fp?: fingerprint tin của khách, no?: khách bấm 👎 }.
    → true nếu đã giao được; false khi không có binding CONV (hoặc giao hỏng): nơi gọi tự trả lời theo cách cũ. */
export async function runSoon(env, job, delayMs = 0) {
  if (!env.CONV) return false;
  try {
    await env.CONV.get(env.CONV.idFromName(job.sid)).schedule(job, delayMs);
    return true;
  } catch (e) {
    console.warn("[conv] Không giao được việc, trả lời theo cách cũ:", e?.message || e);
    return false;
  }
}
