// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
/* Trạng thái bot theo từng hội thoại, lưu trong KV (Crisp không cho gỡ segment nên không dựa vào segment):
   "human"   = nhân viên đã nhắn vào → bot im hẳn
   "handoff" = bot đã chuyển người → bot chỉ trấn an khách
   "failed"  = AI hỏng, bot đã gửi câu dự phòng → tin kế tiếp của khách bot thử trả lời lại bình thường
   Resolve → xoá trạng thái, bot hoạt động lại. Tự hết hạn sau 14 ngày. */
export const stateKey = (sessionId) => `state:${sessionId}`;

export async function getState(env, sessionId) {
  return env.KB ? await env.KB.get(stateKey(sessionId)) : null;
}

export async function setState(env, sessionId, value) {
  if (!env.KB || (await getState(env, sessionId)) === value) return;
  await env.KB.put(stateKey(sessionId), value, { expirationTtl: 14 * 86400 });
}

export async function clearState(env, sessionId) {
  if (env.KB && (await getState(env, sessionId))) await env.KB.delete(stateKey(sessionId));
}
