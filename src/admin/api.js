// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// API của trang quản trị (/api/*): trang /admin gọi vào đây để đọc và lưu dữ liệu.
import { isAdmin, whoOf } from "./auth.js";
import { callOpenAI, generateReply, listModels, productLine } from "../ai.js";
import { handoffNote } from "../handoff.js";
import { AI_FALLBACK_REPLY, AI_KEY, GUIDANCE_CATS, INFO_FIELDS, MAX_TAGS, MODE_LABELS, QUEUE, SETTINGS_FIELDS, TRIGGERS, applySettings, cfg, currentMode, effortLevel, keyHint, normEscalation, normFollowup, withAiKey, withConfig } from "../config.js";
import { SYNC, SYNC_DAYS, autoSyncOf, helpOrigin, newSyncJob, normWebUrl, pageKey, rebuildKnowledge, rescheduleSync, stepSync, storePage } from "../knowledge.js";
import { logChange, normMonth, readLog } from "../stats.js";
import { cleanTag, normTags, tagSlug } from "../tags.js";
import { localNow } from "../time.js";
import { cleanGuidance, cleanSnippet, legacyTraining, parseFaq } from "../training.js";
import { UserError, bad, clip, getJSON, json, putJSON } from "../util.js";

export const monthParam = (env, url) => (/^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month") : localNow(env).month);

export async function api(env, request, url) {
  if (!(await isAdmin(env, request))) return json({ error: "Your session has expired. Reload the page and sign in again." }, 401);
  if (!env.KB) return json({ error: "The KV binding named KB is missing in Cloudflare." }, 500);
  let body = {};
  if (request.method === "POST") {
    if (!(request.headers.get("content-type") || "").includes("application/json")) return json({ error: "Unsupported request format" }, 415);
    body = (await request.json().catch(() => ({}))) || {};
  }
  const who = whoOf(request);
  env = await withConfig(env);
  try {
    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/state": return json(await apiState(env, url, who));
      case "POST /api/settings": return json(await apiSettings(env, body, who));
      case "POST /api/guidance": return json(await apiGuidance(env, body, who));
      case "POST /api/snippets": return json(await apiSnippets(env, body, who));
      case "POST /api/kb": return json(await apiKb(env, body, who));
      case "POST /api/tags": return json(await apiTags(env, body, who));
      case "POST /api/test": return json(await apiTest(env, body));
      case "POST /api/openai": return json(await apiOpenAI(env, body, who));
      case "GET /api/analytics": return json(await apiAnalytics(env, monthParam(env, url)));
      case "GET /api/log": return json({ month: monthParam(env, url), items: (await readLog(env, monthParam(env, url))).items });
      case "POST /api/log": return json(await apiLogUpdate(env, body));
      case "POST /api/suggest": return json(await apiSuggest(env, body));
      case "GET /api/export": return apiExport(env);
      case "POST /api/import": return json(await apiImport(env, body, who));
    }
    return json({ error: "Unknown API" }, 404);
  } catch (e) {
    if (e instanceof UserError) return json({ error: e.message }, 400);
    console.error("[api]", e?.stack || e);
    return json({ error: e?.message || "Unknown error" }, 500);
  }
}

export function settingsView(env) {
  const settings = {}, sources = {};
  for (const [k, f] of Object.entries(SETTINGS_FIELDS)) {
    settings[k] = k === "mode" ? currentMode(env) : k === "effort" ? effortLevel(env) : cfg(env, f.env);
    sources[k] = env.__saved?.[k] != null && env.__saved[k] !== "" ? "admin" : env.__orig?.[f.env] ? "cloudflare" : "default";
  }
  return { settings, sources, escalation: env.__esc, followup: env.__fu, ai: env.__aiKey };
}

const syncView = (st) => ({
  last: st?.last || null,
  next: st?.next || null,
  running: st?.job ? { done: st.job.i, total: st.job.urls.length, by: st.job.by, touched: st.job.touched } : null,
  error: st?.error || null,
});

export const kbView = (env, meta, kbCfg, st) => ({
  helpUrl: cfg(env, "HELP_CENTER_URL"),
  pages: meta.pages || 0,
  total: meta.total ?? meta.urls ?? 0,
  builtAt: meta.builtAt || null,
  articles: meta.articles || [],
  web: kbCfg.web || [],
  autoSync: autoSyncOf(kbCfg),
  sync: syncView(st),
});

const SYNC_LABELS = { off: "off", daily: "every day", weekly: "every week" };

export async function ensureMigrated(env, who) {
  const [g, sn] = await Promise.all([getJSON(env, "cfg:guidance"), getJSON(env, "cfg:snippets")]);
  if (g && sn) return { guidance: g, snippets: sn };
  const legacy = await legacyTraining(env);
  const out = { guidance: g || legacy.guidance, snippets: sn || legacy.snippets };
  if (!g) await putJSON(env, "cfg:guidance", out.guidance);
  if (!sn) await putJSON(env, "cfg:snippets", out.snippets);
  if (legacy.guidance.length || legacy.snippets.length) {
    await logChange(env, who, `Moved data from the old settings page: ${legacy.guidance.length} guidance, ${legacy.snippets.length} snippets`);
  }
  return out;
}

export async function apiState(env, url, who) {
  const t = await ensureMigrated(env, who);
  const [kbCfg, st] = await Promise.all([getJSON(env, "cfg:kb").then((x) => x || {}), getJSON(env, SYNC)]);
  let meta = (await getJSON(env, "kb:meta")) || {};
  if (meta.pages && !meta.articles) meta = await rebuildKnowledge(env, { kbCfg });
  const month = localNow(env).month;
  const [log, changelog, queue] = await Promise.all([readLog(env, month), getJSON(env, "cfg:changelog", []), getJSON(env, QUEUE, {})]);
  return {
    who,
    month,
    ...settingsView(env),
    guidance: t.guidance,
    snippets: t.snippets,
    kb: kbView(env, meta, kbCfg, st),
    health: [
      { label: "Crisp keys", ok: !!(env.CRISP_IDENTIFIER && env.CRISP_KEY), fix: "Add CRISP_IDENTIFIER and CRISP_KEY in Cloudflare" },
      { label: "Crisp webhook signature", ok: !!env.CRISP_HOOK_SECRET || cfg(env, "VERIFY_HOOKS") === "false", fix: "Add CRISP_HOOK_SECRET in Cloudflare" },
      { label: "OpenAI key", ok: !!env.OPENAI_API_KEY, detail: env.__aiKey?.from === "admin" ? `Saved in Settings → AI (${env.__aiKey.hint})` : "Set in Cloudflare (OPENAI_API_KEY)", fix: "Add a key in Settings → AI" },
      { label: "Help center", ok: (meta.pages || 0) > 0, detail: meta.pages ? `${meta.pages}/${meta.total ?? meta.urls} articles in use` : "Not loaded yet", fix: "Click Sync now on the Knowledge page. Also check the Cron trigger * * * * * is on in Cloudflare." },
    ],
    pending: log.items.filter((x) => x.gap && !x.st).length,
    recent: log.items.slice(-6).reverse(),
    lastReply: log.items.at(-1)?.t || null,
    queued: Object.keys(queue || {}).length,
    changelog: changelog.slice(-80).reverse(),
    webhookUrl: `${url.origin}/crisp/hooks`,
    tags: env.__tags,
    meta: {
      guidanceCats: GUIDANCE_CATS,
      triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([k, v]) => [k, { label: v.label, hint: v.hint }])),
      infoFields: Object.fromEntries(Object.entries(INFO_FIELDS).map(([k, v]) => [k, v.label])),
      modes: MODE_LABELS,
      maxTags: MAX_TAGS,
      utcOffset: Number(cfg(env, "UTC_OFFSET_HOURS")),
    },
  };
}

export async function apiTags(env, body, who) {
  const cur = normTags(await getJSON(env, "cfg:tags"), env.__orig);
  let msg;
  if (body.op === "save") {
    const key = String(body.item?.key || "").trim().toLowerCase();
    const prev = cur.items.find((t) => t.key === key);
    const item = cleanTag({ ...body.item, key });
    if (!item) bad("Tag keys can only use lowercase letters, numbers, - and _, for example shipping-app");
    if (prev) cur.items = cur.items.map((t) => (t.key === key ? item : t));
    else {
      if (cur.items.length >= MAX_TAGS) bad(`Up to ${MAX_TAGS} tags, so the AI can pick accurately`);
      const at = cur.items.findIndex((t) => t.key === "other");
      cur.items.splice(at < 0 ? cur.items.length : at, 0, item); // "other" luôn ở cuối
    }
    msg = prev ? (prev.enabled !== item.enabled ? `${item.enabled ? "Turned on" : "Turned off"} tag ${cur.prefix}${key}` : `Edited tag ${cur.prefix}${key}`) : `Added tag ${cur.prefix}${key}`;
  } else if (body.op === "delete") {
    if (body.key === "other") bad("The other tag is the default and can't be removed");
    if (!cur.items.some((t) => t.key === body.key)) bad("Tag not found");
    cur.items = cur.items.filter((t) => t.key !== body.key);
    msg = `Deleted tag ${cur.prefix}${body.key}`;
  } else if (body.op === "settings") {
    const prefix = String(body.prefix ?? cur.prefix).trim().toLowerCase();
    if (!/^[a-z0-9_-]{0,20}$/.test(prefix)) bad("The prefix can only use lowercase letters, numbers, - and _");
    const segments = {};
    for (const k of ["paused", "handoff", "urgent", "p1", "p2"]) {
      const v = String(body.segments?.[k] ?? cur.segments[k]).trim().toLowerCase();
      if (!tagSlug(v, 40)) bad("Segment names can only use lowercase letters, numbers, - and _");
      segments[k] = v;
    }
    if (new Set(Object.values(segments)).size < 5) bad("Each status segment needs a different name");
    cur.prefix = prefix;
    cur.timing = body.timing === "resolve" ? "resolve" : body.timing === "first" ? "first" : cur.timing;
    cur.segments = segments;
    msg = `Tag settings: prefix "${prefix}", tag ${cur.timing === "first" ? "on the bot's first reply" : "on Resolve"}`;
  } else bad("Unknown action");
  await putJSON(env, "cfg:tags", cur);
  await logChange(env, who, msg);
  return { tags: normTags(cur, env.__orig) };
}

export async function apiSettings(env, body, who) {
  const cur = (await getJSON(env, "cfg:settings")) || {};
  const changed = [];
  for (const [k, raw] of Object.entries(body.settings || {})) {
    const f = SETTINGS_FIELDS[k];
    if (!f) continue;
    const v = clip(raw, f.max || 40, !!f.multiline);
    if (f.values && !f.values.includes(v)) bad(`${f.label}: invalid value`);
    if (f.required && !v) bad(`${f.label} can't be empty`);
    if (f.check && !f.check(v)) bad(f.error);
    if ((cur[k] ?? (k === "mode" ? env.__saved?.mode : undefined) ?? null) !== v) {
      cur[k] = v;
      changed.push(`${f.label}: ${k === "mode" ? MODE_LABELS[v] : clip(v, 80) || "(empty)"}`);
    }
  }
  for (const [part, norm, label] of [["escalation", normEscalation, "Escalation"], ["followup", normFollowup, "Feedback & follow-up"]]) {
    if (!body[part] || typeof body[part] !== "object") continue;
    const before = norm(cur[part]);
    const next = norm({ ...before, ...body[part] });
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      cur[part] = next;
      changed.push(label);
    }
  }
  // Đổi help center (link hoặc section): đọc sitemap ngay để báo lỗi trước khi lưu, rồi cho sync chạy lại từ đầu (cron đọc tiếp từng phần)
  let helpJob = null;
  const nextEnv = applySettings(env, { ...cur, mode: cur.mode ?? env.__saved?.mode });
  if (cfg(nextEnv, "HELP_CENTER_URL") !== cfg(env, "HELP_CENTER_URL") || cfg(nextEnv, "HELP_CENTER_SECTIONS") !== cfg(env, "HELP_CENTER_SECTIONS")) {
    const kbCfg = (await getJSON(env, "cfg:kb")) || {};
    try {
      helpJob = await newSyncJob(nextEnv, kbCfg, who);
    } catch (e) {
      bad(`Couldn't read the help center: ${e.message}. Check the link (its sitemap.xml must be reachable) and the sections.`);
    }
  }
  if (changed.length) {
    await putJSON(env, "cfg:settings", cur);
    await logChange(env, who, `Settings: ${changed.join("; ")}`);
  }
  if (helpJob) {
    const st = (await getJSON(env, SYNC)) || {};
    st.job = { ...helpJob, touched: 0 }; // touched 0: cron bắt đầu đọc ngay phút tới
    delete st.error;
    await putJSON(env, SYNC, st);
  }
  return { ...settingsView(nextEnv), helpSync: !!helpJob };
}

// Settings → AI: khoá OpenAI và danh sách model khoá đó dùng được. Khoá không bao giờ được gửi lại trình duyệt.
export async function apiOpenAI(env, body, who) {
  switch (body.op) {
    case "models": {
      if (!env.OPENAI_API_KEY) bad("Add an OpenAI API key first");
      return { models: await listModels(env, env.OPENAI_API_KEY) };
    }
    case "saveKey": {
      const key = String(body.key || "").trim();
      if (!/^sk-[\w-]{20,300}$/.test(key)) bad("That doesn't look like an OpenAI API key. Keys start with sk- (copy it from platform.openai.com/api-keys).");
      let models = null;
      let warning = null;
      try {
        models = await listModels(env, key);
      } catch (e) {
        if (e.status !== 403) throw e; // 403: khoá giới hạn quyền, không được xem danh sách model, nhưng vẫn gọi AI được
        warning = "Key saved. It isn't allowed to list models (restricted key), so type the model name yourself.";
      }
      const rec = { key, by: who, at: Date.now() };
      await putJSON(env, AI_KEY, rec);
      await logChange(env, who, `Saved a new OpenAI API key (${keyHint(key)})`);
      return { ai: withAiKey(env.__orig || env, rec).__aiKey, models, warning };
    }
    case "removeKey": {
      await env.KB.delete(AI_KEY);
      await logChange(env, who, "Removed the OpenAI API key saved in admin");
      return { ai: withAiKey(env.__orig || env, null).__aiKey, models: null };
    }
  }
  bad("Unknown action");
}

export async function apiGuidance(env, body, who) {
  let items = (await getJSON(env, "cfg:guidance")) ?? (await legacyTraining(env)).guidance;
  if (body.op === "save") {
    const prev = items.find((g) => g.id === body.item?.id);
    const item = cleanGuidance({ ...body.item, id: prev?.id }, who);
    if (!item.text) bad("Write what the bot should do");
    if (prev) items = items.map((g) => (g.id === prev.id ? item : g));
    else {
      if (items.length >= 60) bad("Up to 60 guidance items. Merge or delete some first.");
      items.push(item);
    }
    const name = item.title || item.text.slice(0, 50);
    await logChange(env, who, prev ? (prev.enabled !== item.enabled ? `${item.enabled ? "Turned on" : "Turned off"} guidance "${name}"` : `Edited guidance "${name}"`) : `Added guidance "${name}"`);
  } else if (body.op === "delete") {
    const prev = items.find((g) => g.id === body.id);
    if (!prev) bad("Guidance not found");
    items = items.filter((g) => g.id !== body.id);
    await logChange(env, who, `Deleted guidance "${prev.title || prev.text.slice(0, 50)}"`);
  } else bad("Unknown action");
  await putJSON(env, "cfg:guidance", items);
  return { guidance: items };
}

export async function apiSnippets(env, body, who) {
  let items = (await getJSON(env, "cfg:snippets")) ?? (await legacyTraining(env)).snippets;
  let saved = null;
  if (body.op === "save") {
    const prev = items.find((s) => s.id === body.item?.id);
    const item = cleanSnippet({ ...body.item, id: prev?.id, src: prev?.src || body.item?.src }, who, prev);
    if (!item.q) bad("Enter the question");
    if (!item.a) bad("Enter the answer");
    if (prev) items = items.map((s) => (s.id === prev.id ? item : s));
    else {
      if (items.length >= 300) bad("Up to 300 snippets. Merge or delete some first.");
      items.push(item);
    }
    saved = item;
    await logChange(env, who, prev ? (prev.enabled !== item.enabled ? `${item.enabled ? "Turned on" : "Turned off"} snippet "${item.q}"` : `Edited snippet "${item.q}"`) : `Added snippet "${item.q}"`);
  } else if (body.op === "delete") {
    const prev = items.find((s) => s.id === body.id);
    if (!prev) bad("Snippet not found");
    items = items.filter((s) => s.id !== body.id);
    await logChange(env, who, `Deleted snippet "${prev.q}"`);
  } else if (body.op === "import") {
    const added = parseFaq(body.text || "", "import", who);
    if (!added.length) bad("No question and answer pairs found. Write each pair as Q: … then A: …, with a blank line between pairs.");
    if (items.length + added.length > 300) bad(`Up to 300 snippets (you have ${items.length}).`);
    items.push(...added);
    await logChange(env, who, `Imported ${added.length} snippets`);
  } else bad("Unknown action");
  const size = items.reduce((n, s) => n + s.q.length + s.a.length, 0);
  if (size > 150000) bad("Snippets are too long in total. Shorten or delete some first.");
  await putJSON(env, "cfg:snippets", items);
  const fixIds = [].concat(body.fixLog?.ids || [], body.fixLog?.id || []).filter((x) => typeof x === "string");
  if (saved && fixIds.length) await apiLogUpdate(env, { month: body.fixLog.month, ids: fixIds, st: "fixed" }).catch(() => {});
  return { snippets: items, saved };
}

export async function apiKb(env, body, who) {
  const kbCfg = (await getJSON(env, "cfg:kb")) || {};
  kbCfg.excluded = Array.isArray(kbCfg.excluded) ? kbCfg.excluded : [];
  kbCfg.web = Array.isArray(kbCfg.web) ? kbCfg.web : [];
  const meta = (await getJSON(env, "kb:meta")) || {};
  const find = (id) => (meta.articles || []).find((a) => a.id === id) || bad("Article not found. Reload the page.");

  // Sync all sources: the admin page calls syncStart once, then syncStep until it's done.
  // If the page is closed halfway, the cron finishes the job within a few minutes.
  if (body.op === "syncStart" || body.op === "syncStep") {
    const st = (await getJSON(env, SYNC)) || {};
    if (!st.job) {
      if (body.op === "syncStep") return { kb: kbView(env, meta, kbCfg, st) };
      try {
        st.job = await newSyncJob(env, kbCfg, who);
      } catch (e) {
        bad(`Couldn't start the sync: ${e.message}`);
      }
    }
    const finished = await stepSync(env, st, kbCfg);
    if (finished && st.last.by) {
      const l = st.last;
      await logChange(env, who, `Synced all sources: ${l.pages} pages, ${l.updated} updated${l.failedCount ? `, ${l.failedCount} couldn't be read` : ""}`);
    }
    const fresh = finished ? (await getJSON(env, "kb:meta")) || meta : meta;
    return { kb: kbView(env, fresh, kbCfg, st) };
  }
  if (body.op === "autoSync") {
    if (!Object.hasOwn(SYNC_DAYS, body.value)) bad("Choose off, every day or every week");
    kbCfg.autoSync = body.value;
    await putJSON(env, "cfg:kb", kbCfg);
    const st = await rescheduleSync(env, body.value);
    await logChange(env, who, `Set automatic sync to ${SYNC_LABELS[body.value]}`);
    return { kb: kbView(env, meta, kbCfg, st) };
  }

  switch (body.op) {
    case "view": {
      const a = find(body.id);
      const v = (await env.KB.get(`page:${a.id}`)) || "";
      return { text: v.replace(/^<article[^>]*>\n?/, "").replace(/\n?<\/article>$/, "") };
    }
    case "exclude": {
      const a = find(body.id);
      const set = new Set(kbCfg.excluded);
      if (body.excluded) set.add(a.id);
      else set.delete(a.id);
      kbCfg.excluded = [...set];
      await putJSON(env, "cfg:kb", kbCfg);
      await logChange(env, who, `${body.excluded ? "Turned off" : "Turned on"} article "${a.title}"`);
      break;
    }
    case "sync": {
      const a = find(body.id);
      const page = await storePage(env, a.url).catch((e) => bad(`Couldn't load the page: ${e.message}`));
      if (!page.body) bad("The page has no readable text");
      await logChange(env, who, `Synced article "${page.title}"`);
      break;
    }
    case "addWeb": {
      const u = normWebUrl(body.url);
      if (!u) bad("Invalid link. It must start with https://");
      if (new URL(u).origin === helpOrigin(env)) bad("Help center articles are already loaded (see the Help center tab). Add pages from other sites here, like your pricing page.");
      if (kbCfg.web.includes(u)) bad("This page is already in the list");
      if (kbCfg.web.length >= 20) bad("Up to 20 website pages");
      const page = await storePage(env, u).catch((e) => bad(`Couldn't load the page: ${e.message}`));
      if (!page.body) bad("Couldn't read any text on this page");
      kbCfg.web.push(u);
      await putJSON(env, "cfg:kb", kbCfg);
      await logChange(env, who, `Added website page ${u}`);
      break;
    }
    case "removeWeb": {
      const a = find(body.id);
      if (a.src !== "web") bad("Only website pages can be removed");
      kbCfg.web = kbCfg.web.filter((u) => pageKey(env, u) !== `page:${a.id}`);
      kbCfg.excluded = kbCfg.excluded.filter((x) => x !== a.id);
      await env.KB.delete(`page:${a.id}`);
      await putJSON(env, "cfg:kb", kbCfg);
      await logChange(env, who, `Removed website page ${a.url}`);
      break;
    }
    default:
      bad("Unknown action");
  }
  const next = await rebuildKnowledge(env, { kbCfg });
  return { kb: kbView(env, next, kbCfg, await getJSON(env, SYNC)) };
}

export async function apiTest(env, body) {
  let msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  while (msgs.length && msgs[0].role !== "user") msgs = msgs.slice(1);
  if (!msgs.length || msgs.at(-1).role !== "user") bad("Type a customer question");
  const t0 = Date.now();
  let r;
  try {
    r = await generateReply(env, msgs, { handedOff: !!body.handedOff });
  } catch (e) {
    // AI hỏng: cho người thử thấy đúng câu khách thật sẽ nhận, kèm lý do
    r = { reply: AI_FALLBACK_REPLY, action: "handoff", category: "other", knowledge_gap: false, urgent: false, priority: null, sources: [], failed: e?.message || String(e) };
  }
  const fu = env.__fu;
  const feedback = r.action === "answer" && !body.handedOff && !r.urgent && !r.knowledge_gap && fu.feedback ? { text: fu.feedbackText, yes: fu.yesLabel, no: fu.noLabel, thanks: fu.thanksText } : null;
  // Đúng note team sẽ thấy trong Crisp khi bot vừa chuyển người (bot.js → handoffNote)
  const teamNote = r.action === "handoff" && !body.handedOff && env.__esc.note ? handoffNote(env, r, msgs.at(-1).content) : null;
  return { ...r, feedback, teamNote, ms: Date.now() - t0 };
}

export async function apiAnalytics(env, month) {
  const s = normMonth(await getJSON(env, `stats:${month}`, {}));
  const customers = Object.keys(s.conv).length;
  const ids = Object.keys(s.botConv);
  const solvedBy = (id) => s.botConv[id] === "bot" && s.out[id] !== "abandoned";
  const handoff = ids.filter((id) => s.botConv[id] === "handoff").length;
  const confirmed = ids.filter((id) => solvedBy(id) && s.out[id] === "confirmed").length;
  const resolved = ids.filter(solvedBy).length;
  const abandoned = ids.filter((id) => s.botConv[id] === "bot" && s.out[id] === "abandoned").length;
  const fbVals = Object.values(s.fb);
  const [y, m] = month.split("-").map(Number);
  const nDays = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: nDays }, (_, i) => ({ d: i + 1, customers: 0, involved: 0, answers: 0, handoffs: 0 }));
  for (const d of Object.values(s.conv)) if (days[+d - 1]) days[+d - 1].customers++;
  for (const [d, v] of Object.entries(s.days)) {
    const x = days[+d - 1];
    if (x) Object.assign(x, { answers: v.answers || 0, handoffs: v.handoffs || 0, involved: v.involved || 0 });
  }
  const topics = {};
  for (const [sid, c] of Object.entries({ ...s.cat, ...s.cls })) {
    const t = (topics[c] ||= { key: c, conv: 0, bot: 0, resolved: 0 });
    t.conv++;
    if (s.botConv[sid]) {
      t.bot++;
      if (solvedBy(sid)) t.resolved++;
    }
  }
  return {
    month, customers, involved: ids.length, resolved, confirmed, assumed: resolved - confirmed, handoff, abandoned,
    feedback: { up: fbVals.filter((x) => x === "up").length, down: fbVals.filter((x) => x === "down").length },
    bot: s.bot, days, classified: Object.keys(s.cls).length,
    topics: Object.values(topics).sort((a, b) => b.conv - a.conv),
  };
}

export async function apiLogUpdate(env, body) {
  const month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : localNow(env).month;
  const log = await readLog(env, month);
  const ids = new Set([].concat(body.ids || [], body.id || []));
  const hit = log.items.filter((x) => ids.has(x.id));
  if (!hit.length) bad("Conversation not found. Reload the page.");
  for (const it of hit) {
    if (body.st === "fixed" || body.st === "dismissed") it.st = body.st;
    else delete it.st;
  }
  await putJSON(env, `log:${month}`, log);
  return { items: hit };
}

export async function apiSuggest(env, body) {
  const month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : localNow(env).month;
  const items = (await readLog(env, month)).items.filter((x) => x.gap && !x.st && x.q).slice(-80);
  if (items.length < 2) bad("Grouping needs at least 2 open questions.");
  const r = await callOpenAI(env, {
    instructions: `You help the support team of ${productLine(env)} improve their support chatbot. Below is a numbered list of customer questions the bot could not answer with its knowledge. Group questions about the same missing knowledge (at most 8 groups, biggest first; a question may stay alone in its group). For each group give: "title": a short English description of the missing knowledge (max 12 words); "question": one clear English question that covers the group, to be used as a snippet title; "items": the numbers of the questions in the group.`,
    input: [{ role: "user", content: items.map((x, i) => `${i + 1}. ${x.q.replace(/\s+/g, " ")}`).join("\n") }],
    schemaName: "gap_groups",
    schema: {
      type: "object", additionalProperties: false, required: ["groups"],
      properties: { groups: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "question", "items"], properties: { title: { type: "string" }, question: { type: "string" }, items: { type: "array", items: { type: "integer" } } } } } },
    },
    maxTokens: 8000,
    timeoutMs: 60000, // người dùng admin chờ được lâu hơn khách trong chat
  });
  const groups = (r.groups || [])
    .slice(0, 8)
    .map((g) => ({ title: clip(g.title, 120), question: clip(g.question, 300), ids: [...new Set((g.items || []).map((n) => items[n - 1]?.id).filter(Boolean))] }))
    .filter((g) => g.ids.length)
    .sort((a, b) => b.ids.length - a.ids.length);
  return { groups };
}

export async function apiExport(env) {
  const [settings, guidance, snippets, kb, tags] = await Promise.all(["cfg:settings", "cfg:guidance", "cfg:snippets", "cfg:kb", "cfg:tags"].map((k) => getJSON(env, k)));
  const data = { app: "transtore-bot", version: 2, exportedAt: new Date().toISOString(), settings: settings || {}, guidance: guidance || [], snippets: snippets || [], tags: tags || null, kb: { excluded: kb?.excluded || [], web: kb?.web || [], autoSync: autoSyncOf(kb) } };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="bot-backup-${localNow(env).month}.json"` },
  });
}

export async function apiImport(env, body, who) {
  const d = body.data;
  if (!d || d.app !== "transtore-bot") bad("This file isn't a backup from this bot's admin");
  const settings = {};
  for (const [k, f] of Object.entries(SETTINGS_FIELDS)) {
    if (d.settings?.[k] == null) continue;
    const v = clip(d.settings[k], f.max || 40, !!f.multiline);
    if ((!f.values || f.values.includes(v)) && (!f.check || f.check(v)) && (!f.required || v)) settings[k] = v;
  }
  settings.escalation = normEscalation(d.settings?.escalation);
  settings.followup = normFollowup(d.settings?.followup);
  const guidance = (Array.isArray(d.guidance) ? d.guidance : []).slice(0, 60).map((g) => cleanGuidance(g, g?.by || who)).filter((g) => g.text);
  const snippets = (Array.isArray(d.snippets) ? d.snippets : []).slice(0, 300).map((s) => cleanSnippet(s, s?.by || who)).filter((s) => s.q && s.a);
  const kb = {
    excluded: (Array.isArray(d.kb?.excluded) ? d.kb.excluded : []).filter((x) => typeof x === "string").slice(0, 1000),
    web: (Array.isArray(d.kb?.web) ? d.kb.web : []).map(normWebUrl).filter(Boolean).slice(0, 20),
    autoSync: autoSyncOf(d.kb),
  };
  const writes = [putJSON(env, "cfg:settings", settings), putJSON(env, "cfg:guidance", guidance), putJSON(env, "cfg:snippets", snippets), putJSON(env, "cfg:kb", kb)];
  if (d.tags && typeof d.tags === "object") writes.push(putJSON(env, "cfg:tags", normTags(d.tags, env.__orig)));
  await Promise.all(writes);
  await logChange(env, who, `Restored from backup: ${guidance.length} guidance, ${snippets.length} snippets`);
  await rebuildKnowledge(env, { kbCfg: kb });
  await rescheduleSync(env, kb.autoSync);
  return { ok: true };
}
