// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// API của trang quản trị (/api/*): trang /admin gọi vào đây để đọc và lưu dữ liệu.
import { isAdmin, whoOf } from "./auth.js";
import { callOpenAI, generateReply, listModels, productLine } from "../ai.js";
import { unscheduleFollowups } from "../followup.js";
import { handoffNote } from "../handoff.js";
import { cleanCustomer } from "../crisp.js";
import { AI_KEY, FOLLOWUP_DEFAULT, GUIDANCE_CATS, MAX_CUSTOM_REASONS, MAX_DAYS_OFF, MAX_FIELDS, MAX_RULE_CHARS, MAX_TAGS, MAX_TEST_QUESTIONS, MODE_LABELS, PRIORITY_DEFAULT, PRIORITY_LEVELS, QUEUE, SETTINGS_FIELDS, SETTINGS_VERSION, TRIGGERS, UPSET_DEFAULT, URGENT_DEFAULT, UTC_OFFSETS, WAITING_DEFAULT, applySettings, cfg, currentMode, effortLevel, keyHint, normEscalation, normFollowup, normQuestions, upgradeSettings, withAiKey, withConfig } from "../config.js";
import { SYNC, SYNC_DAYS, autoSyncOf, helpOrigin, newSyncJob, normWebUrl, pageKey, rebuildKnowledge, rescheduleSync, selectorError, stepSync, storePage } from "../knowledge.js";
import { forgetReplies, logChange, normMonth, readLog } from "../stats.js";
import { cleanTag, normTags, tagSlug } from "../tags.js";
import { DEFAULT_RULES, MAX_EXAMPLES, MAX_RULES_CHARS, MAX_STYLE_CHARS, STYLE_KEY, cleanExample, cleanRules, getStyle, normStyle } from "../style.js";
import { localNow, teamStatus } from "../time.js";
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
  // Có Durable Object: bot thật trả lời không bị giới hạn 30 giây, nên khung Test the bot và Settings cũng chạy như vậy
  env = await withConfig(env.CONV ? { ...env, __long: true } : env);
  try {
    switch (`${request.method} ${url.pathname}`) {
      case "GET /api/state": return json(await apiState(env, url, who));
      case "POST /api/settings": return json(await apiSettings(env, body, who));
      case "POST /api/guidance": return json(await apiGuidance(env, body, who));
      case "POST /api/style": return json(await apiStyle(env, body, who));
      case "POST /api/snippets": return json(await apiSnippets(env, body, who));
      case "POST /api/kb": return json(await apiKb(env, body, who));
      case "POST /api/tags": return json(await apiTags(env, body, who));
      case "POST /api/test": return json(await apiTest(env, body));
      case "POST /api/openai": return json(await apiOpenAI(env, body, who));
      case "GET /api/analytics": return json(await apiAnalytics(env, monthParam(env, url)));
      case "POST /api/analytics": return json(await apiAnalyticsReset(env, body, who));
      case "GET /api/log": return json({ month: monthParam(env, url), items: (await readLog(env, monthParam(env, url))).items });
      case "POST /api/log": return json(await apiLogUpdate(env, body, who));
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
  // team: team đang làm hay nghỉ theo cài đặt ĐÃ LƯU, và bot đang báo khách team quay lại lúc nào (Settings hiện cho team kiểm tra)
  return { settings, sources, escalation: env.__esc, followup: env.__fu, testQuestions: env.__test, ai: env.__aiKey, team: teamStatus(env) };
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
  const [log, changelog, queue, style] = await Promise.all([readLog(env, month), getJSON(env, "cfg:changelog", []), getJSON(env, QUEUE, {}), getStyle(env)]);
  return {
    who,
    month,
    ...settingsView(env),
    guidance: t.guidance,
    snippets: t.snippets,
    style,
    kb: kbView(env, meta, kbCfg, st),
    health: [
      { label: "Crisp keys", ok: !!(env.CRISP_IDENTIFIER && env.CRISP_KEY), fix: "Add CRISP_IDENTIFIER and CRISP_KEY in Cloudflare" },
      { label: "Crisp webhook signature", ok: !!env.CRISP_HOOK_SECRET || cfg(env, "VERIFY_HOOKS") === "false", fix: "Add CRISP_HOOK_SECRET in Cloudflare" },
      { label: "OpenAI key", ok: !!env.OPENAI_API_KEY, detail: env.__aiKey?.from === "admin" ? `Saved in Settings → AI (${env.__aiKey.hint})` : "Set in Cloudflare (OPENAI_API_KEY)", fix: "Add a key in Settings → AI" },
      { label: "Long thinking time", ok: !!env.CONV, detail: "Replies run in a Durable Object, without the 30 second limit", fix: "Add the durable_objects binding CONV and its migration in wrangler.jsonc, then deploy" },
      { label: "Help center", ok: (meta.pages || 0) > 0, detail: meta.pages ? `${meta.pages}/${meta.total ?? meta.urls} articles in use` : "Not loaded yet", fix: cfg(env, "HELP_CENTER_URL") ? "Click Sync now on the Knowledge page. Also check the Cron trigger * * * * * is on in Cloudflare." : "Add your help center link in Settings → Product, then click Sync now on the Knowledge page." },
    ],
    pending: log.items.filter((x) => x.gap && !x.st).length,
    // Mục của báo cáo cũ (legacy) chỉ là câu hỏi, không phải câu trả lời của bot: chúng nằm ở trang Suggestions,
    // trang Conversations không hiện chúng, nên Overview cũng không liệt kê.
    recent: log.items.filter((x) => !x.legacy).slice(-6).reverse(),
    lastReply: log.items.findLast((x) => !x.legacy)?.t || null,
    queued: Object.keys(queue || {}).length,
    changelog: changelog.slice(-80).reverse(),
    webhookUrl: `${url.origin}/crisp/hooks`,
    tags: env.__tags,
    meta: {
      guidanceCats: GUIDANCE_CATS,
      defaultRules: DEFAULT_RULES,
      maxRulesChars: MAX_RULES_CHARS,
      maxExamples: MAX_EXAMPLES,
      triggers: Object.fromEntries(Object.entries(TRIGGERS).map(([k, v]) => [k, { label: v.label, hint: v.hint }])),
      priorityLevels: PRIORITY_LEVELS,
      // Chữ mặc định của các ô team sửa được (để nút "Restore default" điền lại)
      defaults: { upset: UPSET_DEFAULT, waiting: WAITING_DEFAULT, priority: PRIORITY_DEFAULT, urgent: URGENT_DEFAULT, fallbackText: FOLLOWUP_DEFAULT.fallbackText },
      utcOffsets: UTC_OFFSETS,
      maxFields: MAX_FIELDS,
      maxCustomReasons: MAX_CUSTOM_REASONS,
      maxRuleChars: MAX_RULE_CHARS,
      maxTestQuestions: MAX_TEST_QUESTIONS,
      restoreSections: Object.fromEntries(Object.entries(RESTORE_SECTIONS).map(([k, v]) => [k, v.label])),
      modes: MODE_LABELS,
      maxTags: MAX_TAGS,
      utcOffset: Number(cfg(env, "UTC_OFFSET_HOURS")),
      maxDaysOff: MAX_DAYS_OFF,
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
  // Bot chạy từ trước bản 2: nâng dữ liệu cũ lên (compat.js); lần lưu này ghi luôn dạng mới vào KV
  const cur = upgradeSettings(await getJSON(env, "cfg:settings"), env) || {};
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
    const patch = { ...body[part] };
    if (part === "escalation") {
      // Ô luật để y như mặc định → lưu null, để bot tiếp tục theo mặc định
      if (typeof patch.upset === "string" && patch.upset.trim() === UPSET_DEFAULT) patch.upset = null;
      if (typeof patch.waiting === "string" && patch.waiting.trim() === WAITING_DEFAULT) patch.waiting = null;
      for (const k of ["upset", "waiting"]) if (typeof patch[k] === "string" && patch[k].length > MAX_RULE_CHARS) bad(`That text can be up to ${MAX_RULE_CHARS} characters`);
    }
    const next = norm({ ...before, ...patch });
    if (JSON.stringify(next) !== JSON.stringify(before)) {
      cur[part] = next;
      changed.push(label);
    }
  }
  if (Array.isArray(body.testQuestions)) {
    const next = normQuestions(body.testQuestions);
    if (JSON.stringify(next) !== JSON.stringify(normQuestions(cur.testQuestions))) {
      cur.testQuestions = next;
      changed.push(`Test questions: ${next.length}`);
    }
  }
  if (cur.helpSelector && cur.helpSelector !== cfg(env, "HELP_CENTER_SELECTOR")) {
    const err = selectorError(cur.helpSelector);
    if (err) bad(`Article content area: this selector can't be used (${err}). Use a simple one like .article-body or #content.`);
  }
  // Đổi help center (link, section, danh sách bài, vùng nội dung): đọc danh sách bài ngay để báo lỗi trước khi lưu, rồi cho sync chạy lại từ đầu (cron đọc tiếp từng phần)
  let helpJob = null;
  const nextEnv = applySettings(env, { ...cur, mode: cur.mode ?? env.__saved?.mode });
  if (["HELP_CENTER_URL", "HELP_CENTER_SECTIONS", "HELP_CENTER_PAGES", "HELP_CENTER_SELECTOR"].some((k) => cfg(nextEnv, k) !== cfg(env, k))) {
    const kbCfg = (await getJSON(env, "cfg:kb")) || {};
    try {
      helpJob = await newSyncJob(nextEnv, kbCfg, who);
    } catch (e) {
      bad(`Couldn't read the help center: ${e.message}`);
    }
  }
  if (changed.length) {
    cur.v = SETTINGS_VERSION;
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

// Văn phong: độ dài, câu tự giới thiệu, câu trả lời mẫu của team (xem style.js)
export async function apiStyle(env, body, who) {
  const style = await getStyle(env);
  const exName = (e) => clip(e.situation || e.group || e.text, 50);
  if (body.op === "settings") {
    const changes = [];
    if (Object.hasOwn(body, "rules")) {
      // chuỗi = luật của team (trống = không có luật viết nào); null = quay về luật mặc định
      const rules = cleanRules(body.rules);
      if (typeof body.rules === "string" && body.rules.length > MAX_RULES_CHARS) bad(`Writing rules can be up to ${MAX_RULES_CHARS} characters`);
      if (rules !== style.rules) changes.push(rules == null ? "restored the default writing rules" : rules ? "edited the writing rules" : "removed all writing rules");
      style.rules = rules;
    }
    if (body.intro != null) {
      const intro = clip(body.intro, 80);
      if (intro !== style.intro) changes.push(intro ? `introduction "${intro}"` : "no introduction");
      style.intro = intro;
    }
    if (changes.length) await logChange(env, who, `Writing style: ${changes.join(", ")}`);
  } else if (body.op === "save") {
    const prev = style.examples.find((e) => e.id === body.item?.id);
    const item = cleanExample({ ...body.item, id: prev?.id }, who, prev);
    if (!item.text) bad("Paste the reply your team wrote");
    if (prev) style.examples = style.examples.map((e) => (e.id === prev.id ? item : e));
    else {
      if (style.examples.length >= MAX_EXAMPLES) bad(`Up to ${MAX_EXAMPLES} example replies. Delete some first.`);
      style.examples.push(item);
    }
    await logChange(env, who, prev ? (prev.enabled !== item.enabled ? `${item.enabled ? "Turned on" : "Turned off"} example reply "${exName(item)}"` : `Edited example reply "${exName(item)}"`) : `Added example reply "${exName(item)}"`);
  } else if (body.op === "delete") {
    const ids = new Set([].concat(body.ids || [], body.id || []).filter((x) => typeof x === "string"));
    const gone = style.examples.filter((e) => ids.has(e.id));
    if (!gone.length) bad("Example reply not found. Reload the page.");
    style.examples = style.examples.filter((e) => !ids.has(e.id));
    await logChange(env, who, gone.length === 1 ? `Deleted example reply "${exName(gone[0])}"` : `Deleted ${gone.length} example replies`);
  } else if (body.op === "import") {
    const seen = new Set(style.examples.map((e) => e.text.replace(/\s+/g, " ").trim().toLowerCase()));
    const add = [];
    for (const x of Array.isArray(body.items) ? body.items : []) {
      const item = cleanExample({ group: x?.group, situation: x?.situation, text: x?.text, enabled: true }, who);
      const k = item.text.replace(/\s+/g, " ").trim().toLowerCase();
      if (!item.text || seen.has(k)) continue;
      seen.add(k);
      add.push(item);
    }
    if (!add.length) bad("No new replies to import (empty, or already in the list)");
    if (style.examples.length + add.length > MAX_EXAMPLES) bad(`Up to ${MAX_EXAMPLES} example replies: you have ${style.examples.length}, this file adds ${add.length}. Untick some rows or delete old ones first.`);
    style.examples.push(...add);
    await logChange(env, who, `Imported ${add.length} example replies`);
  } else bad("Unknown action");
  const size = style.examples.reduce((n, e) => n + e.text.length, 0);
  if (size > MAX_STYLE_CHARS) bad("Example replies are too long in total. Shorten or delete some first.");
  await putJSON(env, STYLE_KEY, style);
  return { style };
}

export async function apiSnippets(env, body, who) {
  let items = (await getJSON(env, "cfg:snippets")) ?? (await legacyTraining(env)).snippets;
  let saved = null;
  let changed; // op "enable": id các snippet thật sự đổi trạng thái
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
  } else if (body.op === "enable") {
    // Bật / tắt nhiều snippet một lần: ghi KV một lần, một dòng trong Change log
    const ids = new Set((Array.isArray(body.ids) ? body.ids : []).filter((x) => typeof x === "string"));
    const on = body.enabled === true;
    if (!ids.size) bad("Select at least one snippet");
    if (!items.some((s) => ids.has(s.id))) bad("Snippet not found. Reload the page.");
    const hit = items.filter((s) => ids.has(s.id) && s.enabled !== on);
    const now = Date.now();
    for (const s of hit) Object.assign(s, { enabled: on, upd: now, by: clip(who, 40) || s.by });
    changed = hit.map((s) => s.id);
    if (hit.length) await logChange(env, who, hit.length === 1 ? `${on ? "Turned on" : "Turned off"} snippet "${hit[0].q}"` : `${on ? "Turned on" : "Turned off"} ${hit.length} snippets`);
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
  return { snippets: items, saved, changed };
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
  if (body.op === "rereadImages") {
    // Ảnh đổi nội dung mà giữ nguyên link: đổi mã để lần sync tới AI đọc lại mọi ảnh
    kbCfg.imgRev = (Number(kbCfg.imgRev) || 0) + 1;
    await putJSON(env, "cfg:kb", kbCfg);
    await logChange(env, who, "Asked the bot to read the help center images again");
    return { kb: kbView(env, meta, kbCfg, await getJSON(env, SYNC)) };
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

// Ảnh đính kèm trong khung Test the bot: ảnh đã thu nhỏ trên trình duyệt (data URL), hoặc một link https
const MAX_TEST_IMAGE_CHARS = 1400000; // khoảng 1 MB ảnh
const testImages = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((u) => typeof u === "string" && (/^data:image\/(png|jpeg|webp|gif);base64,/.test(u.slice(0, 40)) ? u.length <= MAX_TEST_IMAGE_CHARS : HTTPS_LINK.test(u) && u.length <= 2000))
    .slice(0, 3);
const HTTPS_LINK = /^https:\/\/[^\s"'<>]+$/;

export async function apiTest(env, body) {
  let msgs = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => {
      const images = m.role === "user" ? testImages(m.images) : [];
      return images.length ? { role: m.role, content: m.content.slice(0, 2000), images } : { role: m.role, content: m.content.slice(0, 2000) };
    });
  while (msgs.length && msgs[0].role !== "user") msgs = msgs.slice(1);
  if (!msgs.length || msgs.at(-1).role !== "user") bad("Type a customer question");
  // Thử một cách dùng snippet khác với cách đang lưu, chỉ cho lần hỏi thử này (bot thật không đổi)
  if (body.snippetMode === "knowledge" || body.snippetMode === "exact") env = { ...env, SNIPPET_MODE: body.snippetMode };
  const t0 = Date.now();
  let r;
  try {
    r = await generateReply(env, msgs, { handedOff: !!body.handedOff, customer: cleanCustomer(body.customer) });
  } catch (e) {
    // AI hỏng: cho người thử thấy đúng câu khách thật sẽ nhận, kèm lý do
    r = { reply: env.__fu.fallbackText, action: "handoff", category: "other", knowledge_gap: false, urgent: false, priority: null, sources: [], failed: e?.message || String(e) };
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

/* Trang Performance → Reset numbers: đưa mọi số liệu của một tháng về 0 (vd sau giai đoạn chạy thử).
   Chỉ xoá số liệu (stats:YYYY-MM): câu trả lời ở Conversations và Suggestions giữ nguyên. Không hoàn tác được. */
export async function apiAnalyticsReset(env, body, who) {
  if (body.op !== "reset") bad("Unknown action");
  if (!/^\d{4}-\d{2}$/.test(body.month || "")) bad("Choose a month");
  await env.KB.delete(`stats:${body.month}`);
  await logChange(env, who, `Reset the Performance numbers of ${body.month}`);
  return apiAnalytics(env, body.month);
}

export async function apiLogUpdate(env, body, who = "") {
  const month = /^\d{4}-\d{2}$/.test(body.month || "") ? body.month : localNow(env).month;
  const log = await readLog(env, month);
  const ids = new Set([].concat(body.ids || [], body.id || []));
  const hit = log.items.filter((x) => ids.has(x.id));
  if (!hit.length) bad("Conversation not found. Reload the page.");
  if (body.remove === true) {
    // Trang Conversations → Delete: xoá hẳn câu trả lời khỏi nhật ký (vd hội thoại team tự test). Nó biến mất ở
    // Conversations, Suggestions, Overview và được trừ khỏi số liệu tháng đó (stats.js → forgetReplies). Không hoàn tác được.
    log.items = log.items.filter((x) => !ids.has(x.id));
    await putJSON(env, `log:${month}`, log);
    const left = new Set(log.items.map((x) => x.sid).filter(Boolean));
    await forgetReplies(env, month, hit, left);
    // Hội thoại bị xoá hết: bỏ luôn lời nhắc đang chờ gửi cho nó, để bot không nhắn thêm vào chat đó và không đếm lại.
    // (Trạng thái "đã chuyển người / nhân viên đang xử lý" của hội thoại thì giữ: nó quyết định bot có được trả lời không.)
    const gone = [...new Set(hit.map((x) => x.sid).filter((sid) => sid && !left.has(sid)))];
    const nudges = await unscheduleFollowups(env, gone);
    const convs = gone.length;
    await logChange(env, who, `Deleted ${hit.length} bot ${hit.length === 1 ? "reply" : "replies"} from Conversations${convs ? ` (${convs} whole conversation${convs === 1 ? "" : "s"})` : ""}`);
    return { removed: hit.map((x) => x.id), nudges };
  }
  if (body.del === true) {
    // Xoá hẳn khỏi trang Suggestions (không còn ở Open lẫn Handled). Câu trả lời của bot vẫn nằm ở trang Conversations,
    // chỉ bỏ dấu "thiếu kiến thức". Mục kiểu cũ (legacy) chỉ hiện ở Suggestions nên bỏ luôn khỏi nhật ký.
    log.items = log.items.filter((x) => !(ids.has(x.id) && x.legacy));
    for (const it of hit) {
      it.gap = false;
      delete it.st;
    }
  } else {
    for (const it of hit) {
      if (body.st === "fixed" || body.st === "dismissed") it.st = body.st;
      else delete it.st;
    }
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

// File sao lưu: tên "app" cũ vẫn nhận được khi khôi phục
const BACKUP_APP = "support-bot";
const BACKUP_APPS = [BACKUP_APP, "transtore-bot"];

export async function apiExport(env) {
  const [settings, guidance, snippets, kb, tags, style] = await Promise.all(["cfg:settings", "cfg:guidance", "cfg:snippets", "cfg:kb", "cfg:tags", STYLE_KEY].map((k) => getJSON(env, k)));
  const data = { app: BACKUP_APP, version: 4, exportedAt: new Date().toISOString(), settings: upgradeSettings(settings, env) || {}, guidance: guidance || [], snippets: snippets || [], tags: tags || null, style: normStyle(style), kb: { excluded: kb?.excluded || [], web: kb?.web || [], autoSync: autoSyncOf(kb) } };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="bot-backup-${localNow(env).month}.json"` },
  });
}

/* Khôi phục theo từng phần, để đem cách làm việc của bot này sang bot của app khác mà không chép kiến thức của app cũ:
   product    = sản phẩm, help center, email hỗ trợ, danh sách trang web và bài đang tắt
   bot        = tên bot, ngôn ngữ, chế độ, giờ làm việc, múi giờ, model AI, câu hỏi thử
   escalation = Escalation + Feedback & follow-up
   guidance, style, snippets, tags = đúng tên trang */
export const RESTORE_SECTIONS = {
  product: { label: "Product and knowledge sources", fields: ["product", "productDesc", "helpUrl", "helpSections", "helpPages", "helpSelector", "supportEmail"] },
  bot: { label: "Bot settings", fields: ["botName", "language", "snippetMode", "mode", "businessHours", "daysOff", "utcOffset", "model", "effort"] },
  escalation: { label: "Escalation and follow-up", fields: [] },
  guidance: { label: "Guidance", fields: [] },
  style: { label: "Writing style", fields: [] },
  snippets: { label: "Snippets", fields: [] },
  tags: { label: "Tags", fields: [] },
};

export async function apiImport(env, body, who) {
  const d = body.data;
  if (!d || !BACKUP_APPS.includes(d.app)) bad("This file isn't a backup from this bot's admin");
  const all = Object.keys(RESTORE_SECTIONS);
  const want = Array.isArray(body.sections) ? all.filter((k) => body.sections.includes(k)) : all;
  if (!want.length) bad("Choose at least one part to restore");
  const has = (k) => want.includes(k);
  const src = upgradeSettings(d.settings && typeof d.settings === "object" ? d.settings : {}, {}); // file cũ → dạng mới
  const settings = { ...(upgradeSettings(await getJSON(env, "cfg:settings"), env) || {}), v: SETTINGS_VERSION };
  for (const part of ["product", "bot"]) {
    if (!has(part)) continue;
    for (const k of RESTORE_SECTIONS[part].fields) {
      const f = SETTINGS_FIELDS[k];
      delete settings[k];
      if (src[k] == null) continue;
      const v = clip(src[k], f.max || 40, !!f.multiline);
      if ((!f.values || f.values.includes(v)) && (!f.check || f.check(v)) && (!f.required || v)) settings[k] = v;
    }
  }
  if (has("bot")) settings.testQuestions = normQuestions(src.testQuestions);
  if (has("escalation")) {
    settings.escalation = normEscalation(src.escalation);
    settings.followup = normFollowup(src.followup);
  }
  const writes = [putJSON(env, "cfg:settings", settings)];
  const done = [];
  let kb = null;
  if (has("product")) {
    kb = {
      excluded: (Array.isArray(d.kb?.excluded) ? d.kb.excluded : []).filter((x) => typeof x === "string").slice(0, 1000),
      web: (Array.isArray(d.kb?.web) ? d.kb.web : []).map(normWebUrl).filter(Boolean).slice(0, 20),
      autoSync: autoSyncOf(d.kb),
      imgRev: ((await getJSON(env, "cfg:kb")) || {}).imgRev || 0,
    };
    writes.push(putJSON(env, "cfg:kb", kb));
  }
  if (has("guidance")) {
    const guidance = (Array.isArray(d.guidance) ? d.guidance : []).slice(0, 60).map((g) => cleanGuidance(g, g?.by || who)).filter((g) => g.text);
    writes.push(putJSON(env, "cfg:guidance", guidance));
    done.push(`${guidance.length} guidance`);
  }
  if (has("snippets")) {
    const snippets = (Array.isArray(d.snippets) ? d.snippets : []).slice(0, 300).map((s) => cleanSnippet(s, s?.by || who)).filter((s) => s.q && s.a);
    writes.push(putJSON(env, "cfg:snippets", snippets));
    done.push(`${snippets.length} snippets`);
  }
  if (has("tags") && d.tags && typeof d.tags === "object") writes.push(putJSON(env, "cfg:tags", normTags(d.tags, env.__orig)));
  // File sao lưu cũ (trước khi có Writing style) không có phần này: giữ nguyên văn phong hiện tại
  if (has("style") && d.style && typeof d.style === "object") writes.push(putJSON(env, STYLE_KEY, normStyle(d.style)));
  await Promise.all(writes);
  await logChange(env, who, `Restored from backup: ${want.map((k) => RESTORE_SECTIONS[k].label).join(", ")}${done.length ? ` (${done.join(", ")})` : ""}`);
  if (kb) {
    await rebuildKnowledge(env, { kbCfg: kb });
    await rescheduleSync(env, kb.autoSync);
  }
  return { ok: true, restored: want };
}
