// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Luồng trả lời khách: nhận sự kiện từ Crisp, quyết định trả lời / hỏi thêm / chuyển cho team, nút hỏi ý kiến.
import { classify, generateReply } from "./ai.js";
import { AI_FALLBACK_REPLY, FEEDBACK_ID, cfg, currentMode } from "./config.js";
import { compose, crisp, getCustomer, getSegments, isBotMessage, operatorsOnline, sendFeedbackPicker, sendMessage, sendNote, updateSegments } from "./crisp.js";
import { scheduleAfterReply, scheduleFollowup, unscheduleFollowup } from "./followup.js";
import { handoffNote } from "./handoff.js";
import { clearState, getState, setState } from "./state.js";
import { appendLog, markLog, recordStats } from "./stats.js";
import { tagKeys, tagName, tagOfSegment } from "./tags.js";
import { clip, list, sleep, uid } from "./util.js";

export async function handleEvent(body, env) {
  const data = body?.data || {};
  const websiteId = data.website_id || body.website_id;
  const sessionId = data.session_id;
  if (!websiteId || !sessionId) return;

  switch (body.event) {
    case "message:send":
      return onVisitorMessage(env, websiteId, sessionId, data);
    case "message:received":
      return onOperatorMessage(env, websiteId, sessionId, data);
    case "session:set_state":
      if (data.state === "resolved") return onResolved(env, websiteId, sessionId);
  }
}

export async function onOperatorMessage(env, websiteId, sessionId, m) {
  if (m.from !== "operator" || m.type === "note" || m.automated) return;
  if (isBotMessage(env, m)) return;
  if ((await getState(env, sessionId)) === "human") return;
  await setState(env, sessionId, "human");
  await unscheduleFollowup(env, sessionId);
  await updateSegments(env, websiteId, sessionId, { add: [env.__tags.segments.paused] }); // chỉ để team nhìn
}

export async function onVisitorMessage(env, websiteId, sessionId, m) {
  if (m.from !== "user") return;

  // Đếm khách (mọi hội thoại, kể cả khi nhân viên tự xử lý)
  await recordStats(env, (s, day) => {
    if (s.conv[sessionId]) return false;
    s.conv[sessionId] = day;
    return true;
  });
  await unscheduleFollowup(env, sessionId); // khách đã nhắn lại → huỷ lời nhắc

  if (!list(cfg(env, "BOT_ORIGINS")).includes(m.origin)) return;
  if (!["text", "file", "picker"].includes(m.type)) return;

  const fb = feedbackChoice(m);
  if (fb) return onFeedback(env, websiteId, sessionId, fb);

  await sleep(Number(cfg(env, "DEBOUNCE_MS"))); // gộp các tin gửi liên tiếp
  return respond(env, websiteId, sessionId, { fingerprint: m.fingerprint });
}

export function feedbackChoice(m) {
  if (m.type !== "picker" || m.content?.id !== FEEDBACK_ID) return null;
  const v = (m.content.choices || []).find((c) => c.selected)?.value;
  return v === "yes" || v === "no" ? v : null;
}

// Khách bấm nút 👍 / 👎 dưới câu trả lời của bot
export async function onFeedback(env, websiteId, sessionId, fb) {
  if ((await getState(env, sessionId)) === "human") return;
  const up = fb === "yes";
  await recordStats(env, (s) => {
    s.fb[sessionId] = up ? "up" : "down";
    if (up) s.out[sessionId] = "confirmed";
    else if (s.out[sessionId] === "confirmed") delete s.out[sessionId];
    return true;
  });
  await markLog(env, sessionId, { fb: up ? "up" : "down" });
  if (!up) return respond(env, websiteId, sessionId, { feedbackNo: true });
  if (currentMode(env) === "off") return;
  await sendMessage(env, websiteId, sessionId, env.__fu.thanksText);
  if (env.__fu.close) {
    const now = Date.now();
    await scheduleFollowup(env, sessionId, { w: websiteId, step: "close", kind: "confirmed", from: now, due: now + 30 * 60000 });
  }
}

export async function respond(env, websiteId, sessionId, { fingerprint, feedbackNo = false } = {}) {
  const path = `/website/${websiteId}/conversation/${sessionId}/messages`;
  const messages = await crisp(env, "GET", path);
  if (!feedbackNo && !shouldAnswer(messages, fingerprint)) return;
  let state = await getState(env, sessionId);
  if (state === "human") return;
  const mode = currentMode(env);
  if (mode === "off") return;
  if (mode === "offline" && (await operatorsOnline(env, websiteId))) return;

  // Đã chuyển người nhưng khách im lâu rồi mới nhắn lại ("hi there" vài tiếng sau): coi là cuộc chat mới.
  // Case cũ vẫn nằm trong inbox của team (segment giữ nguyên); AI chỉ nhắc tới nó khi khách hỏi.
  let earlierCase = false;
  if (state === "handoff" && pauseHours(messages) >= Number(cfg(env, "HANDOFF_RESET_HOURS"))) {
    await clearState(env, sessionId);
    state = null;
    earlierCase = true;
  }

  // Đã chuyển người: vẫn trấn an khách, nhưng không quá 1 lần mỗi X phút.
  // (state "failed" = lần trước AI hỏng, bot đã gửi câu dự phòng: lần này thử trả lời lại bình thường.)
  const handedOff = state === "handoff";
  if (handedOff) {
    const lastBot = (messages || []).filter((x) => isBotMessage(env, x)).reduce((t, x) => Math.max(t, x.timestamp || 0), 0);
    if (Date.now() - lastBot < env.__esc.cooldownMin * 60000) return;
  }

  const limit = Number(cfg(env, "HISTORY_LIMIT"));
  let history = toHistory(messages, limit, feedbackNo);
  if (feedbackNo && history.at(-1)?.role !== "user") history = [...history, { role: "user", content: env.__fu.noLabel }];
  if (!history.length) return;

  // Bật "đang soạn" + đọc thông tin khách app đã gửi vào Crisp (store domain, plan…) để bot không hỏi lại
  const [customer] = await Promise.all([getCustomer(env, websiteId, sessionId), compose(env, websiteId, sessionId, true)]);
  let r;
  try {
    r = await generateReply(env, history, { handedOff, customer, earlierCase });
  } catch (e) {
    console.error("[ai] Lỗi OpenAI:", e?.message || e);
    if (handedOff || state === "failed") {
      // Đã báo khách "team sẽ trả lời" ở lần trước: không lặp lại câu đó. AI hỏng 2 lần liền → coi như đã chuyển người.
      if (state === "failed") await setState(env, sessionId, "handoff");
      return compose(env, websiteId, sessionId, false);
    }
    r = { reply: AI_FALLBACK_REPLY, action: "handoff", category: "other", knowledge_gap: false, urgent: false, priority: null, sources: [], failed: clip(e?.message || String(e), 200) };
  }
  await compose(env, websiteId, sessionId, false);
  if (handedOff && r.action === "ask_info") r.action = "answer";

  // Trong lúc AI nghĩ: khách nhắn thêm / nhân viên đã vào → bỏ câu trả lời này
  const latest = await crisp(env, "GET", path);
  if (!feedbackNo && !shouldAnswer(latest, fingerprint)) return;
  if ((await getState(env, sessionId)) === "human") return;
  const segNow = await getSegments(env, websiteId, sessionId);

  if (r.reply) await sendMessage(env, websiteId, sessionId, r.reply);
  if (r.action === "answer" && !handedOff && !r.urgent && !r.knowledge_gap && env.__fu.feedback) {
    await sendFeedbackPicker(env, websiteId, sessionId).catch((e) => console.warn("[feedback] Không gửi được nút:", e?.message || e));
  }

  const tg = env.__tags;
  const keys = tagKeys(env);
  const add = [];
  if (tg.timing === "first" && keys.includes(r.category) && !segNow.some((s) => tagOfSegment(env, s))) add.push(tagName(env, r.category));
  const newHandoff = r.action === "handoff" && !handedOff;
  if (newHandoff) {
    // AI hỏng (r.failed): vẫn báo team qua segment, nhưng để state "failed" để tin kế tiếp của khách được thử trả lời lại
    await setState(env, sessionId, r.failed ? "failed" : "handoff");
    add.push(tg.segments.handoff);
  } else if (state === "failed") {
    await clearState(env, sessionId); // lần này AI trả lời được → bot hoạt động bình thường trở lại
  }
  const countHandoff = newHandoff && state !== "failed"; // lần hỏng trước đã tính 1 lần chuyển người rồi
  if (r.urgent) add.push(tg.segments.urgent);
  if (r.priority === "P1") add.push(tg.segments.p1); // mức ưu tiên cao: gắn segment để team lọc trong Crisp
  if (r.priority === "P2" && !segNow.includes(tg.segments.p1)) add.push(tg.segments.p2);
  if (add.length) await updateSegments(env, websiteId, sessionId, { add, current: segNow });

  const question = history.filter((h) => h.role === "user").slice(-1)[0]?.content || "";
  // Vừa chuyển người → để lại ghi chú bàn giao cho team (private note, khách không thấy)
  if (newHandoff && env.__esc.note) {
    await sendNote(env, websiteId, sessionId, handoffNote(env, r, question)).catch((e) => console.warn("[handoff] Không gửi được note:", e?.message || e));
  }
  await recordStats(env, (s, day) => {
    const b = s.bot;
    b.answers++;
    if (r.action === "ask_info") b.askInfo++;
    if (countHandoff) b.handoffs++;
    if (r.knowledge_gap) b.gaps++;
    if (r.urgent) b.urgent++;
    const first = !s.botConv[sessionId];
    s.botConv[sessionId] ||= "bot";
    if (r.action === "handoff" || handedOff) s.botConv[sessionId] = "handoff";
    if (keys.includes(r.category)) s.cat[sessionId] ||= r.category;
    const d = (s.days[day] ||= { answers: 0, handoffs: 0, involved: 0 });
    d.answers = (d.answers || 0) + 1;
    if (countHandoff) d.handoffs = (d.handoffs || 0) + 1;
    if (first) d.involved = (d.involved || 0) + 1;
    return true;
  });
  await appendLog(env, {
    id: uid(), t: Date.now(), w: websiteId, sid: sessionId,
    q: clip(question, 300, true), a: clip(r.reply, 700, true),
    act: r.action, cat: r.category, urg: !!r.urgent, gap: !!r.knowledge_gap, pri: r.priority || undefined,
    src: (r.sources || []).slice(0, 5).map((x) => clip(x, 200)), ho: handedOff || undefined,
    err: r.failed || undefined, // AI hỏng, khách nhận câu dự phòng (trang Conversations hiện nhãn "AI error")
  });
  if (!handedOff && r.action !== "handoff") await scheduleAfterReply(env, websiteId, sessionId, r.action);
}

// Hội thoại Resolve: bật lại bot + phân loại (tag issue-…) cho báo cáo
export async function onResolved(env, websiteId, sessionId) {
  await clearState(env, sessionId); // bot hoạt động lại cho lần chat sau
  await unscheduleFollowup(env, sessionId);
  const segments = await getSegments(env, websiteId, sessionId);
  const keys = tagKeys(env);
  let category = segments.map((s) => tagOfSegment(env, s)).find(Boolean);

  if (!category && cfg(env, "CLASSIFY_ON_RESOLVE") !== "false" && env.OPENAI_API_KEY) {
    try {
      const messages = await crisp(env, "GET", `/website/${websiteId}/conversation/${sessionId}/messages`);
      const transcript = toHistory(messages, 30, true)
        .map((h) => `${h.role === "user" ? "Customer" : "Support"}: ${h.content}`)
        .join("\n")
        .slice(-6000);
      if (transcript) category = await classify(env, transcript);
    } catch (e) {
      console.warn("[classify] Lỗi:", e?.message || e);
    }
  }

  const ok = keys.includes(category);
  const add = ok && !segments.includes(tagName(env, category)) ? [tagName(env, category)] : [];
  const sg = env.__tags.segments;
  await updateSegments(env, websiteId, sessionId, { add, remove: [sg.paused, sg.handoff, sg.urgent, sg.p1, sg.p2], current: segments });

  if (ok) {
    await recordStats(env, (s) => {
      if (s.cls[sessionId] === category) return false;
      s.cls[sessionId] = category;
      return true;
    });
  }
}

export function shouldAnswer(messages, fingerprint) {
  const sorted = [...(messages || [])].filter((x) => x.type !== "note").sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  const lastUserIdx = sorted.map((x) => x.from).lastIndexOf("user");
  if (lastUserIdx < 0) return false;
  if (fingerprint != null && sorted[lastUserIdx].fingerprint != null && sorted[lastUserIdx].fingerprint !== fingerprint) return false;
  return !sorted.slice(lastUserIdx + 1).some((x) => x.from === "operator");
}

// Khách đã im bao lâu (giờ) trước loạt tin mới nhất: từ tin trước đó (của ai cũng được) tới tin đầu của loạt tin cuối của khách
export function pauseHours(messages) {
  const sorted = [...(messages || [])].filter((x) => x.type !== "note" && x.timestamp).sort((a, b) => a.timestamp - b.timestamp);
  let i = sorted.length - 1;
  if (i < 0 || sorted[i].from !== "user") return 0;
  while (i > 0 && sorted[i - 1].from === "user") i--;
  return i > 0 ? (sorted[i].timestamp - sorted[i - 1].timestamp) / 3600000 : 0;
}

export function toHistory(messages, limit, keepTrailingAssistant = false) {
  const out = [];
  const sorted = [...(messages || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const msg of sorted) {
    if (msg.type === "note") continue;
    let role = msg.from === "user" ? "user" : msg.from === "operator" ? "assistant" : null;
    if (!role) continue;
    let text;
    if (msg.type === "text" && typeof msg.content === "string") text = msg.content;
    else if (msg.type === "file") text = `[sent a file: ${msg.content?.name || "file"}]`;
    else if (msg.type === "picker") {
      const sel = msg.content?.choices?.find((c) => c.selected);
      if (sel) { role = "user"; text = sel.label; } // khách đã bấm chọn
      else if (role === "assistant") text = msg.content?.text; // câu hỏi kèm nút của bot
    }
    if (!text || !text.trim()) continue;
    const prev = out.at(-1);
    if (prev && prev.role === role) { if (!prev.content.endsWith(text)) prev.content += "\n" + text; }
    else out.push({ role, content: text });
  }
  let h = out.slice(-limit);
  while (h.length && h[0].role !== "user") h = h.slice(1);
  if (keepTrailingAssistant) return h;
  return h.length && h.at(-1).role === "user" ? h : [];
}
