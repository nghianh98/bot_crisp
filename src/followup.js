// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Nhắc khách khi im lặng, kết thúc ca, tự Resolve. Cron gọi mỗi phút, chỉ làm việc khi có ca tới hạn.
import { QUEUE, cfg, currentMode, withConfig } from "./config.js";
import { crisp, isBotMessage, sendMessage } from "./crisp.js";
import { getState } from "./state.js";
import { recordStats } from "./stats.js";
import { getJSON, putJSON } from "./util.js";

// Hàng đợi nhắc khách: 1 key KV {sessionId: {w, step, kind, from, due}}, cron mỗi phút xử lý mục đến hạn
export async function scheduleFollowup(env, sessionId, entry) {
  if (!env.KB) return;
  const q = (await getJSON(env, QUEUE)) || {};
  q[sessionId] = entry;
  await putJSON(env, QUEUE, q);
}

export async function unscheduleFollowup(env, sessionId) {
  if (!env.KB) return;
  const q = await getJSON(env, QUEUE);
  if (!q || !q[sessionId]) return;
  delete q[sessionId];
  await putJSON(env, QUEUE, q);
}

export async function scheduleAfterReply(env, websiteId, sessionId, action) {
  const fu = env.__fu;
  const now = Date.now();
  const kind = action === "ask_info" ? "info" : "answer";
  const nudgeOn = kind === "info" ? fu.infoNudge : fu.nudge;
  const nudgeMin = kind === "info" ? fu.infoNudgeMin : fu.nudgeMin;
  if (nudgeOn) return scheduleFollowup(env, sessionId, { w: websiteId, step: "nudge", kind, from: now, due: now + nudgeMin * 60000 });
  if (fu.close) return scheduleFollowup(env, sessionId, { w: websiteId, step: "close", kind, from: now, due: now + fu.closeHours * 3600000 });
}

// Tin cuối cùng (không tính ghi chú) là của bot → khách chưa trả lời, nhân viên chưa vào
export function lastIsBot(env, messages) {
  const sorted = [...(messages || [])].filter((x) => x.type !== "note").sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const last = sorted.at(-1);
  return !!last && isBotMessage(env, last) && !(last.type === "picker" && last.content?.choices?.some((c) => c.selected));
}

export async function processFollowups(env) {
  if (!env.KB) return;
  const q = await getJSON(env, QUEUE);
  if (!q || !Object.keys(q).length) return;
  const now = Date.now();
  const due = Object.entries(q)
    .filter(([, e]) => e.due <= now)
    .sort((a, b) => a[1].due - b[1].due)
    .slice(0, Number(cfg(env, "FOLLOWUPS_PER_RUN")));
  let changed = false;
  for (const [sid, e] of Object.entries(q)) if (now - (e.from || 0) > 8 * 86400000) { delete q[sid]; changed = true; }
  if (!due.length && !changed) return;

  env = await withConfig(env); // chỉ đọc cài đặt khi thật sự có việc
  const fu = env.__fu;
  const ops = [];
  for (const [sid, e] of due) {
    delete q[sid];
    changed = true;
    try {
      const st = await getState(env, sid);
      if (st === "human" || st === "handoff" || st === "failed") continue;
      const messages = await crisp(env, "GET", `/website/${e.w}/conversation/${sid}/messages`);
      if (!lastIsBot(env, messages)) continue; // khách đã nhắn lại hoặc nhân viên đã vào
      if (e.step === "nudge") {
        if (currentMode(env) === "off") continue;
        await sendMessage(env, e.w, sid, e.kind === "info" ? fu.infoNudgeText : fu.nudgeText);
        ops.push(["nudge", sid]);
        if (fu.close) q[sid] = { ...e, step: "close", due: Math.max(e.from + fu.closeHours * 3600000, now + 30 * 60000) };
      } else if (e.step === "close") {
        ops.push(["close", sid, e.kind === "confirmed" ? "confirmed" : e.kind === "info" ? "abandoned" : "assumed"]);
        if (fu.autoResolve) {
          await crisp(env, "PATCH", `/website/${e.w}/conversation/${sid}/state`, { state: "resolved" }).catch((err) =>
            console.warn("[followup] Không tự Resolve được (token cần quyền website:conversation:states write):", err.message)
          );
        }
      }
    } catch (err) {
      console.warn("[followup]", sid, err?.message || err);
    }
  }
  await putJSON(env, QUEUE, q);
  if (ops.length) {
    await recordStats(env, (s) => {
      for (const [op, sid, outcome] of ops) {
        if (op === "nudge") s.bot.nudges++;
        else if (s.out[sid] !== "confirmed") s.out[sid] = outcome;
      }
      return true;
    });
  }
}
