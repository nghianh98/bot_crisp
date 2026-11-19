// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Nhắc khách khi im lặng, kết thúc ca, tự Resolve. Cron gọi mỗi phút, chỉ làm việc khi có ca tới hạn.
import { QUEUE, cfg, currentMode, withConfig } from "./config.js";
import { crisp, isBotMessage, sendMessage } from "./crisp.js";
import { runSoon } from "./runner.js";
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

// Tin nhắc cuối cùng của bot đã là đúng câu nhắc này chưa (chống gửi 2 lần khi 2 vòng cron chạy chồng nhau)
export function alreadyNudged(env, messages, text) {
  const sorted = [...(messages || [])].filter((x) => x.type !== "note").sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const last = sorted.at(-1);
  return !!last && isBotMessage(env, last) && last.type === "text" && String(last.content || "").trim() === String(text || "").trim();
}

// Lấy các mục tới hạn (và mục quá cũ) ra khỏi hàng đợi. Trả về [mục tới hạn, hàng đợi còn lại, có thay đổi không].
export function claimDue(q, now, max) {
  const rest = { ...q };
  const due = Object.entries(rest)
    .filter(([, e]) => e.due <= now)
    .sort((a, b) => a[1].due - b[1].due)
    .slice(0, max);
  let changed = due.length > 0;
  for (const [sid] of due) delete rest[sid];
  for (const [sid, e] of Object.entries(rest)) if (now - (e.from || 0) > 8 * 86400000) { delete rest[sid]; changed = true; }
  return [due, rest, changed];
}

// reply: hàm trả lời khách (bot.js → respond), truyền từ worker.js để không import vòng bot.js ↔ followup.js.
// Dùng cho mục "reply": khách nhắn trong lúc bot đang chờ (đã chuyển người), tới hạn thì bot trả lời.
//
// Các mục tới hạn được lấy ra khỏi hàng đợi và LƯU NGAY trước khi xử lý: một vòng có thể chạy lâu hơn 1 phút
// (mục "reply" gọi AI), nếu để cuối mới lưu thì vòng cron kế tiếp đọc lại hàng đợi cũ và gửi lời nhắc lần 2,
// đồng thời ghi đè các lịch nhắc webhook vừa thêm/huỷ trong lúc đó.
export async function processFollowups(env, { reply } = {}) {
  if (!env.KB) return;
  const q = await getJSON(env, QUEUE);
  if (!q || !Object.keys(q).length) return;
  const now = Date.now();
  const [due, rest, changed] = claimDue(q, now, Number(cfg(env, "FOLLOWUPS_PER_RUN")));
  if (!changed) return;
  await putJSON(env, QUEUE, rest);
  if (!due.length) return;

  env = await withConfig(env); // chỉ đọc cài đặt khi thật sự có việc
  const fu = env.__fu;
  const ops = [];
  const later = {}; // lịch mới tạo trong vòng này (bước "close" sau khi nhắc)
  for (const [sid, e] of due) {
    try {
      const st = await getState(env, sid);
      if (e.step === "reply") {
        // respond() tự kiểm lại: khách vẫn chờ, nhân viên chưa vào, bot chưa trả lời, chế độ bot
        // Có Durable Object thì giao cho nó (AI được nghĩ lâu, và vòng cron này không bị giữ lại)
        if (st !== "human" && !(await runSoon(env, { w: e.w, sid })) && reply) await reply(env, e.w, sid);
        continue;
      }
      if (st === "human" || st === "handoff" || st === "failed") continue;
      const messages = await crisp(env, "GET", `/website/${e.w}/conversation/${sid}/messages`);
      if (!lastIsBot(env, messages)) continue; // khách đã nhắn lại hoặc nhân viên đã vào
      if (e.step === "nudge") {
        if (currentMode(env) === "off") continue;
        const text = e.kind === "info" ? fu.infoNudgeText : fu.nudgeText;
        if (!alreadyNudged(env, messages, text)) {
          await sendMessage(env, e.w, sid, text);
          ops.push(["nudge", sid]);
        }
        if (fu.close) later[sid] = { ...e, step: "close", due: Math.max(e.from + fu.closeHours * 3600000, now + 30 * 60000) };
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
  if (Object.keys(later).length) {
    // Đọc lại hàng đợi (webhook có thể đã đổi trong lúc xử lý) rồi chỉ thêm lịch mới, không đè lịch có sẵn của hội thoại đó
    const q2 = (await getJSON(env, QUEUE)) || {};
    for (const [sid, e] of Object.entries(later)) if (!q2[sid]) q2[sid] = e;
    await putJSON(env, QUEUE, q2);
  }
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
