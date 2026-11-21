// Test các hàm lõi (chạy: npm test). `npm run build` chạy test trước, nên test lỗi thì không deploy được.
import assert from "node:assert/strict";
import { test } from "node:test";
import { capHistory, pauseHours, resolvedSinceLastReply, respond, shouldAnswer, teamNotes, toHistory } from "../src/bot.js";
import { apiAnalytics, apiAnalyticsReset, apiLogUpdate, apiSettings, apiSnippets, apiState } from "../src/admin/api.js";
import { localNow, parseBusinessHours, parseDaysOff, teamAvailabilityNote, teamStatus, tzLabel } from "../src/time.js";
import { withConfig } from "../src/config.js";
import { effortLevel } from "../src/config.js";
import { freshTimestamp, getMessages, verifySignature } from "../src/crisp.js";
import { alreadyNudged, claimDue, processFollowups } from "../src/followup.js";
import { buildIndex, loadKnowledge, rank, select, splitArticles } from "../src/retrieval.js";
import { notesBlock } from "../src/ai.js";

const env = { BOT_NAME: "Bot" };
const msg = (from, content, t, extra = {}) => ({ from, type: "text", content, timestamp: t, fingerprint: t, ...extra });
const bot = (content, t, extra = {}) => msg("operator", content, t, { user: { nickname: "Bot" }, ...extra });

function fakeKV(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
}

test("shouldAnswer: only when the customer's message is the last one and is the one we were woken for", () => {
  const ms = [msg("user", "hi", 1), bot("hello", 2), msg("user", "help", 3)];
  assert.equal(shouldAnswer(ms, 3), true);
  assert.equal(shouldAnswer(ms, 1), false); // a newer customer message exists
  assert.equal(shouldAnswer([...ms, msg("operator", "on it", 4)], 3), false);
  assert.equal(shouldAnswer([...ms, { from: "operator", type: "note", content: "x", timestamp: 4 }], 3), true); // notes don't count
});

test("toHistory merges turns, keeps images, drops notes", () => {
  const ms = [
    msg("user", "it is broken", 1),
    { from: "user", type: "file", content: { name: "a.png", url: "https://x/a.png", type: "image/png" }, timestamp: 2 },
    { from: "operator", type: "note", content: "secret", timestamp: 3 },
    bot("which page?", 4),
    msg("user", "checkout", 5),
  ];
  const h = toHistory(ms, 20);
  assert.equal(h.length, 3);
  assert.deepEqual(h[0].images, ["https://x/a.png"]);
  assert.ok(!JSON.stringify(h).includes("secret"));
  assert.deepEqual(toHistory([msg("user", "q", 1), bot("a", 2)], 20), []); // nothing to answer
});

test("capHistory drops the oldest turns and starts with the customer", () => {
  const h = [{ role: "user", content: "a".repeat(50) }, { role: "assistant", content: "b".repeat(50) }, { role: "user", content: "c".repeat(50) }];
  assert.deepEqual(capHistory(h, 1000), h);
  assert.deepEqual(capHistory(h, 120).map((x) => x.role), ["user"]);
  assert.equal(capHistory(h, 1).length, 1); // always keeps the last turn
});

test("teamNotes keeps the team's notes, not the bot's", () => {
  const ms = [
    { from: "operator", type: "note", content: "Refunded on Monday", timestamp: 2, user: { nickname: "Linh" } },
    { from: "operator", type: "note", content: "handoff note", timestamp: 3, user: { nickname: "Bot" } },
    msg("user", "hi", 1),
  ];
  const notes = teamNotes(env, ms);
  assert.deepEqual(notes.map((n) => n.text), ["Refunded on Monday"]);
  assert.match(notesBlock("Acme", notes), /Linh, 1970-01-01: Refunded on Monday/);
  assert.equal(notesBlock("Acme", []), "");
});

test("pauseHours measures the gap before the customer's latest messages", () => {
  const H = 3600000;
  assert.equal(pauseHours([msg("user", "a", 0), bot("b", H), msg("user", "c", 4 * H), msg("user", "d", 4 * H + 5)]), 3);
});

test("getMessages pages back through the whole conversation", async () => {
  const pages = { "": [msg("user", "c", 30), msg("user", "d", 40)], 30: [msg("user", "a", 10), msg("user", "b", 20)], 10: [] };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const before = new URL(url).searchParams.get("timestamp_before") || "";
    calls.push(before);
    return new Response(JSON.stringify({ error: false, data: pages[before] }), { status: 200 });
  };
  try {
    const all = await getMessages({ CRISP_IDENTIFIER: "i", CRISP_KEY: "k" }, "w", "s");
    assert.deepEqual(all.map((x) => x.content), ["a", "b", "c", "d"]);
    assert.deepEqual(calls, ["", "30", "10"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("verifySignature accepts Crisp's signature on the raw body and rejects others", async () => {
  const raw = '{"event":"message:send","data":{"content":"xin chào"}}';
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("s3cret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`[123;${raw}]`));
  const sig = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifySignature("s3cret", raw, JSON.parse(raw), "123", sig), true);
  assert.equal(await verifySignature("other", raw, JSON.parse(raw), "123", sig), false);
  assert.equal(await verifySignature("s3cret", raw, JSON.parse(raw), "124", sig), false);
  assert.equal(await verifySignature("", raw, JSON.parse(raw), "123", sig), false);
});

test("freshTimestamp rejects old requests, in seconds or milliseconds", () => {
  const now = 1_800_000_000_000;
  assert.equal(freshTimestamp(String(now - 60000), now), true);
  assert.equal(freshTimestamp(String(now - 11 * 60000), now), false);
  assert.equal(freshTimestamp(String((now - 60000) / 1000), now), true);
  assert.equal(freshTimestamp("garbage", now), true);
});

test("claimDue takes due items out of the queue", () => {
  const now = 1_000_000_000_000;
  const q = { a: { due: now - 1, from: now - 10 }, b: { due: now + 1000, from: now }, old: { due: now + 1, from: now - 9 * 86400000 } };
  const [due, rest, changed] = claimDue(q, now, 8);
  assert.deepEqual(due.map((x) => x[0]), ["a"]);
  assert.deepEqual(Object.keys(rest), ["b"]);
  assert.equal(changed, true);
  assert.equal(claimDue({ b: q.b }, now, 8)[2], false);
});

test("processFollowups saves the queue before working, and never nudges twice", async () => {
  const now = Date.now();
  const KB = fakeKV({ "fu:queue": JSON.stringify({ s1: { w: "w", step: "nudge", kind: "answer", from: now - 60000, due: now - 1 } }) });
  const sent = [];
  let queueDuringSend = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opt) => {
    if (opt.method === "POST") {
      queueDuringSend = KB.m.get("fu:queue");
      sent.push(JSON.parse(opt.body).content);
      return new Response(JSON.stringify({ error: false, data: {} }));
    }
    const history = [msg("user", "q", 1), bot("answer", 2), ...sent.map((c, i) => bot(c, 3 + i))];
    return new Response(JSON.stringify({ error: false, data: history }));
  };
  try {
    const e = { KB, CRISP_IDENTIFIER: "i", CRISP_KEY: "k", BOT_MODE: "always", BOT_NAME: "Bot" };
    await processFollowups(e);
    assert.equal(sent.length, 1);
    assert.equal(queueDuringSend, "{}"); // the due item was already out of the saved queue while the nudge was being sent
    // A second, overlapping run that still holds the old item must not nudge again
    KB.m.set("fu:queue", JSON.stringify({ s1: { w: "w", step: "nudge", kind: "answer", from: now - 60000, due: now - 1 } }));
    await processFollowups(e);
    assert.equal(sent.length, 1);
    assert.equal(alreadyNudged(e, [bot(sent[0], 5)], sent[0]), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

const article = (url, title, body) => `<article url="${url}" title="${title}">\n${body}\n</article>`;
const KB_TEXT = [
  article("https://h/install", "Install the app", "Open the Shopify App Store and click Add app. Approve the permissions."),
  article("https://h/billing", "Plans and billing", "Upgrade or downgrade your plan. Refunds are handled by the team. Invoices are in Shopify."),
  article("https://h/switcher", "Language switcher not showing", "If the switcher does not appear on the storefront, enable the app embed in the theme editor."),
  article("https://h/glossary", "Glossary", "Keep brand names untranslated with glossary rules."),
].join("\n\n");

test("retrieval ranks the matching article first and respects the budget", () => {
  const arts = splitArticles(KB_TEXT);
  assert.equal(arts.length, 4);
  const index = buildIndex(arts);
  const scores = rank(index, "the language switcher is not showing on my store");
  assert.equal(scores.indexOf(Math.max(...scores)), 2);
  assert.deepEqual(select(index, { query: "refund invoice", max: 1 }).chosen, [1]);
  assert.deepEqual(select(index, { query: "zzz", picked: [3], max: 1 }).chosen, [3]); // the AI's pick by title wins
  assert.equal(select(index, { query: "", max: 2 }).chosen.length, 2); // nothing matches → still returns articles
  const tight = select(index, { query: "switcher theme embed install app", budget: 10, max: 5 });
  assert.equal(tight.chosen.length, 1); // always at least one article, never over budget after that
});

test("loadKnowledge: small help center goes in whole, large one is narrowed down", async () => {
  const history = [{ role: "user", content: "language switcher not showing" }];
  const index = buildIndex(splitArticles(KB_TEXT).map((a, i) => ({ ...a, id: "/p" + i })));
  const pages = Object.fromEntries(splitArticles(KB_TEXT).map((a, i) => ["page:/p" + i, a.text]));
  const KB = fakeKV({ "kb:text": KB_TEXT, "kb:index": JSON.stringify(index), ...pages });
  const small = await loadKnowledge({ KB }, history);
  assert.equal(small.text, KB_TEXT);
  assert.equal(small.info, undefined);
  const big = await loadKnowledge({ KB, KB_FULL_CHARS: "100", KB_MAX_ARTICLES: "1" }, history);
  assert.match(big.text, /Language switcher not showing/);
  assert.doesNotMatch(big.text, /Plans and billing/);
  assert.match(big.extra, /Plans and billing: https:\/\/h\/billing/);
  assert.deepEqual([big.info.used, big.info.total], [1, 4]);
  // The AI's rewritten question and picks are used, and a failing refine step falls back to keywords
  const refined = await loadKnowledge({ KB, KB_FULL_CHARS: "100", KB_MAX_ARTICLES: "1" }, [{ role: "user", content: "vẫn không được" }], async () => ({ question: "How do I get a refund?", keywords: ["refund"], articles: [1] }));
  assert.match(refined.text, /Plans and billing/);
  const failed = await loadKnowledge({ KB, KB_FULL_CHARS: "100", KB_MAX_ARTICLES: "1" }, history, async () => { throw new Error("slow"); });
  assert.match(failed.text, /Language switcher not showing/);
  // Help center synced before the index existed: works from kb:text
  const legacy = await loadKnowledge({ KB: fakeKV({ "kb:text": KB_TEXT }), KB_FULL_CHARS: "100", KB_MAX_ARTICLES: "1" }, history);
  assert.match(legacy.text, /Language switcher not showing/);
});

test("effort 'high' only when replies can run long", () => {
  assert.equal(effortLevel({ OPENAI_REASONING_EFFORT: "high" }), "medium");
  assert.equal(effortLevel({ OPENAI_REASONING_EFFORT: "high", __long: true }), "high");
});

const resolved = (t, from = "operator") => ({ from, type: "event", content: { namespace: "state:resolved" }, timestamp: t });

test("resolvedSinceLastReply: a customer who writes again after Resolve starts a new chat", () => {
  const human = (c, t) => msg("operator", c, t, { user: { nickname: "Linh" } });
  assert.equal(resolvedSinceLastReply([msg("user", "a", 1), human("done", 2), resolved(3), msg("user", "hi again", 4)]), true);
  assert.equal(resolvedSinceLastReply([msg("user", "a", 1), human("done", 2), msg("user", "thanks", 3)]), false); // never resolved
  assert.equal(resolvedSinceLastReply([msg("user", "a", 1), resolved(2), human("one more thing", 3), msg("user", "ok", 4)]), false); // team wrote after the resolve
  assert.equal(resolvedSinceLastReply([msg("user", "a", 1), human("done", 2), resolved(3)]), false); // no new customer message
  // The resolve event itself must not count as "someone already replied"
  assert.equal(shouldAnswer([msg("user", "a", 1), human("done", 2), resolved(3, "user"), msg("user", "hi again", 4), resolved(5)], 4), true);
});

test("respond: bot answers again in a resolved chat even when the resolve webhook never arrived", async () => {
  const now = Date.now();
  const history = [msg("user", "old question", now - 5000), msg("operator", "fixed it", now - 4000, { user: { nickname: "Linh" } }), resolved(now - 3000), msg("user", "new question", now - 1000)];
  const run = async (messages) => {
    const KB = fakeKV({ "state:s": "human" });
    const sent = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opt = {}) => {
      url = String(url);
      if (url.includes("/v1/responses")) return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify({ reply: "Here you go.", action: "answer", category: "how-to", knowledge_gap: false, urgent: false, priority: "P4", sources: [] }) }));
      const u = new URL(url);
      if ((opt.method || "GET") === "GET") {
        if (u.pathname.endsWith("/messages")) return new Response(JSON.stringify({ error: false, data: u.searchParams.has("timestamp_before") ? [] : messages }));
        return new Response(JSON.stringify({ error: false, data: { segments: ["bot-paused"], data: {} } }));
      }
      const body = JSON.parse(opt.body || "{}");
      if (opt.method === "POST" && body.type === "text") sent.push(body.content);
      return new Response(JSON.stringify({ error: false, data: {} }));
    };
    try {
      const e = await withConfig({ KB, CRISP_IDENTIFIER: "i", CRISP_KEY: "k", OPENAI_API_KEY: "sk", BOT_MODE: "always", BOT_NAME: "Bot" });
      await respond(e, "w", "s", { fingerprint: messages.at(-1).fingerprint });
    } finally {
      globalThis.fetch = realFetch;
    }
    return { sent, state: KB.m.get("state:s") ?? null };
  };
  assert.deepEqual(await run(history), { sent: ["Here you go."], state: null });
  // Not resolved: a teammate is still handling it, the bot stays quiet
  assert.deepEqual(await run(history.filter((x) => x.type !== "event")), { sent: [], state: "human" });
});

test("apiLogUpdate: delete removes a question from Suggestions for good, the reply stays in the log", async () => {
  const items = [
    { id: "old", t: 1, q: "old report question", gap: true, legacy: true },
    { id: "a", t: 2, sid: "s1", q: "junk", a: "reply", gap: true, st: "dismissed" },
    { id: "b", t: 3, sid: "s2", q: "real gap", a: "reply", gap: true },
  ];
  const KB = fakeKV({ "log:2026-11": JSON.stringify({ items, legacy: true }) });
  const r = await apiLogUpdate({ KB }, { month: "2026-11", ids: ["old", "a"], del: true });
  assert.equal(r.items.length, 2);
  const saved = JSON.parse(KB.m.get("log:2026-11"));
  assert.equal(saved.legacy, true); // old gaps:YYYY-MM entries aren't merged in again
  assert.deepEqual(saved.items, [
    { id: "a", t: 2, sid: "s1", q: "junk", a: "reply", gap: false },
    { id: "b", t: 3, sid: "s2", q: "real gap", a: "reply", gap: true },
  ]);
  // Dismiss still only marks the question
  await apiLogUpdate({ KB }, { month: "2026-11", ids: ["b"], st: "dismissed" });
  assert.equal(JSON.parse(KB.m.get("log:2026-11")).items[1].st, "dismissed");
  await assert.rejects(apiLogUpdate({ KB }, { month: "2026-11", ids: ["old"], del: true }), /not found/);
});

// The note the AI gets about working hours, as it was before days off existed: with no days off it must not change by a single character
function oldAvailabilityNote(env, ms) {
  const WD = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
  const bh = parseBusinessHours(env.BUSINESS_HOURS);
  if (!bh) return "";
  const now = localNow(env, ms);
  const inHours = bh.days.has(now.weekday) && now.minutes >= bh.open && now.minutes < bh.close;
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const tz = tzLabel(env.UTC_OFFSET_HOURS);
  if (inHours) return `Team support works ${env.BUSINESS_HOURS} (${tz}); it is within working hours now, so a teammate usually replies within a few hours.`;
  let wait = 0;
  let when = "";
  for (let i = 0; i < 8; i++) {
    const wd = ((now.weekday - 1 + i) % 7) + 1;
    if (!bh.days.has(wd)) continue;
    const startToday = i * 1440 + bh.open - now.minutes;
    if (startToday > 0) {
      wait = startToday;
      when = i === 0 ? "today" : i === 1 ? `tomorrow (${WD[wd]})` : `on ${WD[wd]}`;
      break;
    }
  }
  const hours = Math.max(1, Math.round(wait / 60));
  const at = `${when} at ${hhmm(bh.open)} ${tz}`;
  const say = hours <= 3 ? `"${at}" or "in about ${hours} hour${hours > 1 ? "s" : ""}"` : `"${at}", not a number of hours`;
  return `Team support works ${env.BUSINESS_HOURS} (${tz}). It is outside working hours now; the team is back ${at} (about ${hours} hour${hours > 1 ? "s" : ""} from now). Tell the customer this when you hand off: say ${say}.`;
}

test("working hours note: unchanged when there are no days off", () => {
  const start = Date.UTC(2026, 10, 16); // a Monday
  for (const BUSINESS_HOURS of ["Mon-Fri 08:00-24:00", "Mon-Sun 08:00-24:00", "Mon-Sat 09:00-18:30", "Wed 10:00-12:00", "Tue,Thu,Sun 00:00-24:00", ""]) {
    for (const UTC_OFFSET_HOURS of ["7", "0", "-5", "5.5"]) {
      const e = { BUSINESS_HOURS, UTC_OFFSET_HOURS };
      for (let h = 0; h < 9 * 24; h += 1.5) {
        const ms = start + h * 3600000;
        assert.equal(teamAvailabilityNote(e, ms), oldAvailabilityNote(e, ms), `${BUSINESS_HOURS} ${UTC_OFFSET_HOURS} +${h}h`);
        // Days off that are already over don't change anything either
        assert.equal(teamAvailabilityNote({ ...e, DAYS_OFF: "2026-11-01,2026-11-10" }, ms), oldAvailabilityNote(e, ms));
      }
    }
  }
});

test("days off: the team is off all day and the bot skips them when saying when the team is back", () => {
  assert.deepEqual(parseDaysOff(" 2026-12-25, 2026-12-24,2026-12-25 "), ["2026-12-24", "2026-12-25"]);
  assert.deepEqual(parseDaysOff(""), []);
  for (const bad of ["tomorrow", "2026-02-30", "2026-1-5", "24/12/2026", Array.from({ length: 61 }, (_, i) => `2027-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}`).join(",")]) assert.equal(parseDaysOff(bad), null, bad);

  const e = { BUSINESS_HOURS: "Mon-Fri 08:00-24:00", UTC_OFFSET_HOURS: "7" };
  const at = (date, hhmm) => Date.parse(`${date}T${hhmm}:00+07:00`);
  // A normal Tuesday morning: open
  assert.deepEqual(teamStatus(e, at("2026-11-24", "10:00")), { open: true });
  // The same moment with that Tuesday marked as a day off
  const off = { ...e, DAYS_OFF: "2026-11-24" };
  assert.deepEqual(teamStatus(off, at("2026-11-24", "10:00")), { open: false, dayOff: true, wait: 22 * 60, at: "tomorrow (Wednesday) at 08:00 GMT+7" });
  const note = teamAvailabilityNote(off, at("2026-11-24", "10:00"));
  assert.match(note, /The team has a day off today, so it is outside working hours now; the team is back tomorrow \(Wednesday\) at 08:00 GMT\+7 \(about 22 hours from now\)/);
  // The evening before a day off: back the day after it, not "tomorrow"
  assert.equal(teamStatus({ ...e, BUSINESS_HOURS: "Mon-Fri 08:00-18:00", DAYS_OFF: "2026-11-24" }, at("2026-11-23", "19:00")).at, "on Wednesday at 08:00 GMT+7");
  // Thursday and Friday off, then the weekend: back on Monday
  const long = { ...e, DAYS_OFF: "2026-11-26,2026-11-27" };
  assert.equal(teamStatus(long, at("2026-11-26", "09:00")).at, "on Monday at 08:00 GMT+7");
  assert.equal(teamStatus(long, at("2026-11-28", "09:00")).dayOff, false); // Saturday is a normal day off, not a "day off"
  // A break of a week or more: the date is included, because "on Monday" alone would be unclear
  const days = Array.from({ length: 9 }, (_, i) => `2026-12-${String(21 + i).padStart(2, "0")}`).join(","); // 21 to 29 December
  assert.equal(teamStatus({ ...e, DAYS_OFF: days }, at("2026-12-21", "09:00")).at, "on Wednesday, 30 December at 08:00 GMT+7");
  // The day off is over at midnight in the team's time zone
  assert.deepEqual(teamStatus(off, at("2026-11-25", "08:00")), { open: true });
});

test("snippets: turn many on or off in one go", async () => {
  const sn = (id, enabled) => ({ id, q: `Q ${id}`, a: `A ${id}`, enabled, src: "manual", at: 1, upd: 1, by: "Chloe" });
  const KB = fakeKV({ "cfg:snippets": JSON.stringify([sn("sn_aaa", true), sn("sn_bbb", true), sn("sn_ccc", false)]) });
  const env = { KB };
  const r = await apiSnippets(env, { op: "enable", ids: ["sn_aaa", "sn_bbb", "sn_ccc"], enabled: false }, "Linh");
  assert.deepEqual(r.changed, ["sn_aaa", "sn_bbb"]); // the third one was already off
  assert.deepEqual(r.snippets.map((s) => [s.id, s.enabled, s.by]), [["sn_aaa", false, "Linh"], ["sn_bbb", false, "Linh"], ["sn_ccc", false, "Chloe"]]);
  assert.equal(JSON.parse(KB.m.get("cfg:changelog")).at(-1).what, "Turned off 2 snippets");
  const back = await apiSnippets(env, { op: "enable", ids: r.changed, enabled: true }, "Linh"); // what Undo sends
  assert.deepEqual(back.snippets.map((s) => s.enabled), [true, true, false]);
  await assert.rejects(apiSnippets(env, { op: "enable", ids: [], enabled: true }, "Linh"), /Select at least one/);
  await assert.rejects(apiSnippets(env, { op: "enable", ids: ["sn_zzz"], enabled: true }, "Linh"), /not found/);
});

test("settings: days off are saved and checked", async () => {
  const KB = fakeKV({ "cfg:settings": JSON.stringify({ v: 4, botName: "Bot" }) });
  const env = await withConfig({ KB });
  await apiSettings(env, { settings: { daysOff: "2026-12-24,2026-12-25" } }, "Linh");
  assert.equal(JSON.parse(KB.m.get("cfg:settings")).daysOff, "2026-12-24,2026-12-25");
  assert.equal((await withConfig({ KB })).DAYS_OFF, "2026-12-24,2026-12-25");
  await assert.rejects(apiSettings(env, { settings: { daysOff: "next friday" } }, "Linh"), /Days off/);
  await apiSettings(env, { settings: { daysOff: "" } }, "Linh");
  assert.equal(JSON.parse(KB.m.get("cfg:settings")).daysOff, "");
});

test("apiLogUpdate remove: deleted replies leave the log and the month's numbers", async () => {
  const at = (d, h) => Date.UTC(2026, 10, d, h);
  const items = [
    { id: "a1", t: at(20, 3), sid: "test", q: "hi", a: "…", act: "answer", gap: false, urg: false },
    { id: "a2", t: at(20, 4), sid: "test", q: "it is broken!!", a: "…", act: "handoff", gap: true, urg: true },
    { id: "a3", t: at(21, 4), sid: "test", q: "hello?", a: "…", act: "handoff", ho: true },
    { id: "b1", t: at(21, 5), sid: "real", q: "how do I…", a: "…", act: "ask_info" },
    { id: "b2", t: at(21, 6), sid: "real", q: "ok", a: "…", act: "answer" },
  ];
  const stats = {
    conv: { test: "20", real: "21", other: "21" }, botConv: { test: "handoff", real: "bot" }, cat: { test: "other", real: "how-to" }, cls: { test: "bug" }, fb: { test: "down" }, out: { real: "assumed" },
    bot: { answers: 5, askInfo: 1, handoffs: 1, gaps: 1, urgent: 1, nudges: 2 },
    days: { 20: { answers: 2, handoffs: 1, involved: 1 }, 21: { answers: 3, handoffs: 0, involved: 1 } },
  };
  const KB = fakeKV({ "log:2026-11": JSON.stringify({ items }), "stats:2026-11": JSON.stringify(stats) });
  const read = (k) => JSON.parse(KB.m.get(k));

  // One reply of a conversation that has more: only the per-reply numbers go down
  await apiLogUpdate({ KB }, { month: "2026-11", ids: ["b1"], remove: true }, "Linh");
  assert.deepEqual(read("log:2026-11").items.map((x) => x.id), ["a1", "a2", "a3", "b2"]);
  let s = read("stats:2026-11");
  assert.deepEqual(s.bot, { answers: 4, askInfo: 0, handoffs: 1, gaps: 1, urgent: 1, nudges: 2 });
  assert.deepEqual(s.days[21], { answers: 2, handoffs: 0, involved: 1 });
  assert.equal(s.botConv.real, "bot");
  assert.equal(read("cfg:changelog").at(-1).what, "Deleted 1 bot reply from Conversations");

  // Every reply of the test chat: the conversation leaves the numbers completely
  const r = await apiLogUpdate({ KB }, { month: "2026-11", ids: ["a1", "a2", "a3"], remove: true }, "Linh");
  assert.deepEqual(r.removed, ["a1", "a2", "a3"]);
  assert.deepEqual(read("log:2026-11").items.map((x) => x.id), ["b2"]);
  s = read("stats:2026-11");
  assert.deepEqual(s.bot, { answers: 1, askInfo: 0, handoffs: 0, gaps: 0, urgent: 0, nudges: 2 });
  assert.deepEqual(s.days, { 20: { answers: 0, handoffs: 0, involved: 0 }, 21: { answers: 1, handoffs: 0, involved: 1 } });
  assert.deepEqual([s.conv, s.botConv, s.cat, s.cls, s.fb, s.out], [{ real: "21", other: "21" }, { real: "bot" }, { real: "how-to" }, {}, {}, { real: "assumed" }]);
  assert.equal(read("cfg:changelog").at(-1).what, "Deleted 3 bot replies from Conversations (1 whole conversation)");
  const a = await apiAnalytics({ KB }, "2026-11");
  assert.deepEqual([a.customers, a.involved, a.resolved, a.handoff, a.feedback.down], [2, 1, 1, 0, 0]);

  // Numbers never go below zero, and an unknown id is refused
  KB.m.set("stats:2026-11", JSON.stringify({ bot: { answers: 0 }, days: {} }));
  await apiLogUpdate({ KB }, { month: "2026-11", ids: ["b2"], remove: true }, "Linh");
  assert.equal(read("stats:2026-11").bot.answers, 0);
  await assert.rejects(apiLogUpdate({ KB }, { month: "2026-11", ids: ["b2"], remove: true }, "Linh"), /not found/);
});

test("apiState: questions from the old report are not listed as bot replies on Overview", async () => {
  const month = localNow({}).month;
  const old = (id, t) => ({ id, t, q: `old ${id}`, gap: true, legacy: true, st: "dismissed" });
  const run = async (items) => {
    const KB = fakeKV({ [`log:${month}`]: JSON.stringify({ items, legacy: true }), "cfg:guidance": "[]", "cfg:snippets": "[]" });
    return apiState(await withConfig({ KB }), new URL("https://bot.example/api/state"), "Linh");
  };
  // Only old-report questions left (every real reply was deleted): Overview shows no replies, Suggestions still counts open ones
  let s = await run([old("g1", 1), old("g2", 2), { ...old("g3", 3), st: undefined }]);
  assert.deepEqual([s.recent, s.lastReply, s.pending], [[], null, 1]);
  s = await run([old("g1", 1), { id: "r1", t: 5, sid: "s", q: "hi", a: "hello", act: "answer", gap: false }, old("g2", 9)]);
  assert.deepEqual([s.recent.map((x) => x.id), s.lastReply], [["r1"], 5]);
});

test("apiAnalyticsReset: a month's numbers go back to zero, replies stay", async () => {
  const stats = { conv: { a: "20", b: "21" }, botConv: { a: "bot" }, fb: { a: "up" }, out: { a: "confirmed" }, cat: { a: "how-to" }, bot: { answers: 62, askInfo: 4, handoffs: 5, gaps: 22, urgent: 0, nudges: 3 }, days: { 20: { answers: 60, handoffs: 5, involved: 1 } } };
  const log = JSON.stringify({ items: [{ id: "r1", t: 1, sid: "a", q: "hi", a: "hello", act: "answer" }] });
  const KB = fakeKV({ "stats:2026-11": JSON.stringify(stats), "stats:2026-10": JSON.stringify(stats), "log:2026-11": log });
  assert.equal((await apiAnalytics({ KB }, "2026-11")).customers, 2);
  const a = await apiAnalyticsReset({ KB }, { op: "reset", month: "2026-11" }, "Linh");
  assert.deepEqual([a.month, a.customers, a.involved, a.resolved, a.feedback, a.bot, a.topics, a.days.some((d) => d.answers || d.customers)], ["2026-11", 0, 0, 0, { up: 0, down: 0 }, { answers: 0, askInfo: 0, handoffs: 0, gaps: 0, urgent: 0, nudges: 0 }, [], false]);
  assert.equal(KB.m.has("stats:2026-11"), false);
  assert.equal(KB.m.get("log:2026-11"), log); // Conversations keeps its replies
  assert.equal((await apiAnalytics({ KB }, "2026-10")).customers, 2); // other months are untouched
  assert.equal(JSON.parse(KB.m.get("cfg:changelog")).at(-1).what, "Reset the Performance numbers of 2026-11");
  await assert.rejects(apiAnalyticsReset({ KB }, { op: "reset", month: "November" }, "Linh"), /Choose a month/);
  await assert.rejects(apiAnalyticsReset({ KB }, { month: "2026-11" }, "Linh"), /Unknown action/);
});

test("apiLogUpdate remove: a deleted conversation's waiting nudge is cancelled, other chats keep theirs", async () => {
  const items = [
    { id: "t1", t: 1, sid: "test", q: "hi", a: "…", act: "answer" },
    { id: "t2", t: 2, sid: "test", q: "more", a: "…", act: "answer" },
    { id: "r1", t: 3, sid: "real", q: "how", a: "…", act: "answer" },
    { id: "r2", t: 4, sid: "real", q: "ok", a: "…", act: "answer" },
  ];
  const nudge = (sid) => ({ w: "w", step: "nudge", kind: "answer", from: 1, due: Date.now() + 60000, sid });
  const KB = fakeKV({ "log:2026-11": JSON.stringify({ items }), "fu:queue": JSON.stringify({ test: nudge("test"), real: nudge("real"), other: nudge("other") }), "state:test": "handoff" });
  const queue = () => Object.keys(JSON.parse(KB.m.get("fu:queue")));
  // One reply of a chat that has more left: its nudge stays
  let r = await apiLogUpdate({ KB }, { month: "2026-11", ids: ["r1", "t1"], remove: true }, "Linh");
  assert.deepEqual([r.nudges, queue()], [0, ["test", "real", "other"]]);
  // The last reply of the test chat: its nudge goes, the others stay; the chat's handed-off state is kept
  r = await apiLogUpdate({ KB }, { month: "2026-11", ids: ["t2"], remove: true }, "Linh");
  assert.deepEqual([r.nudges, queue()], [1, ["real", "other"]]);
  assert.equal(KB.m.get("state:test"), "handoff");
  // No queue at all is fine
  KB.m.delete("fu:queue");
  r = await apiLogUpdate({ KB }, { month: "2026-11", ids: ["r2"], remove: true }, "Linh");
  assert.equal(r.nudges, 0);
});
