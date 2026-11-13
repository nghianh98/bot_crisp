// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Kiến thức của bot: sync help center và trang website vào KV (bấm Sync now trên /admin hoặc tự động theo lịch).
import { cfg } from "./config.js";
import { getJSON, hash, list, putJSON, sleep } from "./util.js";

export async function listHelpCenterUrls(env) {
  const base = cfg(env, "HELP_CENTER_URL").replace(/\/$/, "");
  const sections = list(cfg(env, "HELP_CENTER_SECTIONS"));
  const res = await fetch(`${base}/sitemap.xml`, { headers: { "User-Agent": "TranstoreBot-KB/2.0" } });
  if (!res.ok) throw new Error(`sitemap ${res.status}`);
  const xml = await res.text();
  const origin = new URL(base).origin;
  const urls = new Set();
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    try {
      const u = new URL(m[1]);
      if (u.origin !== origin) continue;
      if (!sections.some((s) => u.pathname.startsWith(`/${s}/`))) continue;
      urls.add(origin + u.pathname);
    } catch {}
  }
  return [...urls].sort();
}

export const helpOrigin = (env) => new URL(cfg(env, "HELP_CENTER_URL")).origin;

// Bài help center: page:/docs/… ; trang website: page:https://…
export function pageKey(env, url) {
  const u = new URL(url);
  return u.origin === helpOrigin(env) ? `page:${u.pathname}` : `page:${u.origin}${u.pathname}${u.search}`;
}

export function normWebUrl(v) {
  try {
    const u = new URL(String(v || "").trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1"; // chỉ để test trên máy
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export const cleanText = (s) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\u00a0/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/\u200b/g, "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export async function extractPage(env, url) {
  const res = await fetch(url, { headers: { "User-Agent": "TranstoreBot-KB/2.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  let title = "", main = "", article = "", body = "", skip = 0;
  const blocks = { h1: "\n# ", h2: "\n## ", h3: "\n### ", h4: "\n### ", li: "\n- ", p: "\n", td: " | ", th: " | ", tr: "\n", pre: "\n", blockquote: "\n" };
  const rw = new HTMLRewriter().on("title", { text: (t) => void (title += t.text) });
  if (new URL(url).origin === helpOrigin(env)) {
    // Help center Docusaurus: chỉ lấy phần nội dung bài
    for (const [tag, prefix] of Object.entries(blocks)) {
      rw.on(`.theme-doc-markdown ${tag}`, { element: () => void (main += prefix) });
      rw.on(`article ${tag}`, { element: () => void (article += prefix) });
    }
    rw.on(".theme-doc-markdown", { text: (t) => void (main += t.text) });
    rw.on("article", { text: (t) => void (article += t.text) });
  } else {
    // Trang website bất kỳ: lấy chữ trong body, bỏ menu, footer, script
    rw.on("script,style,noscript,svg,nav,footer,form,iframe,template", {
      element(el) {
        try { el.onEndTag(() => void skip--); skip++; } catch {}
      },
    });
    for (const [tag, prefix] of Object.entries({ ...blocks, div: "\n", section: "\n", br: "\n" })) rw.on(`body ${tag}`, { element: () => void (body += prefix) });
    rw.on("body", { text: (t) => void (skip ? 0 : (body += t.text)) });
  }
  await rw.transform(res).arrayBuffer();
  const text = (cleanText(main) || cleanText(article) || cleanText(body)).slice(0, 30000);
  const h1 = text.match(/^# (.+)$/m)?.[1];
  return { url, title: (h1 || cleanText(title).split("|")[0] || url).trim(), body: text };
}

export const articleValue = (page) => `<article url="${page.url}" title="${page.title.replace(/"/g, "'")}">\n${page.body}\n</article>`;

export async function storePage(env, url) {
  const page = await extractPage(env, url);
  if (!page.body) return page;
  const key = pageKey(env, url);
  const value = articleValue(page);
  const changed = (await env.KB.get(key)) !== value;
  if (changed) await env.KB.put(key, value);
  return { ...page, changed };
}

/* Sync: re-read every help center article and website page.
   Runs only when someone clicks Sync now in the admin, or when the automatic sync is due (weekly by default).
   kb:sync = { next: ms|null, last: {at, by, pages, updated, failed[], failedCount}, job: {urls, i, updated, failed[], by, started, touched}, error } */
export const SYNC = "kb:sync";
export const SYNC_DAYS = { off: 0, daily: 1, weekly: 7 };
export const autoSyncOf = (kbCfg) => (Object.hasOwn(SYNC_DAYS, kbCfg?.autoSync) ? kbCfg.autoSync : "weekly");
export const nextSyncAt = (from, every) => (SYNC_DAYS[every] ? from + SYNC_DAYS[every] * 86400000 : null);
const DRIVEN_MS = 45000; // a step in the last 45 s means the admin page is driving the sync, so the cron waits

// Cloudflare KV allows 1 write per second to the same key: space progress saves out, retry once on 429
async function saveSync(env, st, prevWrite) {
  const wait = 1050 - (Date.now() - (prevWrite || 0));
  if (wait > 0) await sleep(wait);
  try {
    await putJSON(env, SYNC, st);
  } catch (e) {
    if (!/429/.test(String(e?.message))) throw e;
    await sleep(1100);
    await putJSON(env, SYNC, st);
  }
}

export async function newSyncJob(env, kbCfg, by) {
  if (!env.KB) throw new Error("The KV binding KB is missing");
  const help = await listHelpCenterUrls(env);
  if (!help.length) throw new Error("the help center sitemap lists no articles");
  const urls = [...help, ...(kbCfg?.web || [])];
  const now = Date.now();
  return { urls, i: 0, updated: 0, failed: [], by: by || null, started: now, touched: now };
}

/** Read the next few pages of the running job. Returns true when the job just finished. */
export async function stepSync(env, st, kbCfg) {
  const job = st.job;
  const prevWrite = job.touched;
  const per = Math.max(1, Number(cfg(env, "PAGES_PER_RUN")) || 6);
  const batch = job.urls.slice(job.i, job.i + per);
  const results = await Promise.all(
    batch.map((url) =>
      storePage(env, url).catch((e) => {
        console.warn("[kb] Skipped", url, e.message);
        return null;
      })
    )
  );
  results.forEach((page, k) => {
    if (!page?.body) job.failed.push(batch[k]);
    else if (page.changed) job.updated++;
  });
  job.i += batch.length;
  job.touched = Date.now();
  let finished = false;
  if (job.i >= job.urls.length) {
    kbCfg ||= (await getJSON(env, "cfg:kb")) || {};
    const meta = (await getJSON(env, "kb:meta")) || {};
    const listHash = await hash(job.urls.join("\n"));
    if (job.updated || meta.listHash !== listHash || !meta.articles) await rebuildKnowledge(env, { urls: job.urls, listHash, kbCfg });
    const at = Date.now();
    st.last = { at, by: job.by, pages: job.urls.length, updated: job.updated, failed: job.failed.slice(0, 20), failedCount: job.failed.length };
    st.next = nextSyncAt(at, autoSyncOf(kbCfg));
    delete st.job;
    delete st.error;
    finished = true;
  }
  await saveSync(env, st, prevWrite);
  return finished;
}

/** Cron (every minute): continue a running sync, or start one when the automatic sync is due. Idle cost: 1 KV read. */
export async function cronSync(env) {
  if (!env.KB) return;
  const now = Date.now();
  let st = await getJSON(env, SYNC);
  let kbCfg = null;
  if (!st) {
    // First run after this update (knowledge already loaded) or a brand-new install (load it now)
    const meta = await getJSON(env, "kb:meta");
    kbCfg = (await getJSON(env, "cfg:kb")) || {};
    st = {};
    if (meta?.articles?.length && meta.builtAt) {
      const at = Date.parse(meta.builtAt) || now;
      st.last = { at, by: null, pages: meta.urls ?? meta.total ?? meta.articles.length, updated: null, failed: [], failedCount: 0 };
      st.next = nextSyncAt(at, autoSyncOf(kbCfg));
      return putJSON(env, SYNC, st);
    }
  } else if (st.job) {
    if (now - st.job.touched < DRIVEN_MS) return;
    return stepSync(env, st);
  } else if (!st.next || now < st.next) {
    return;
  }
  kbCfg ||= (await getJSON(env, "cfg:kb")) || {};
  try {
    st.job = await newSyncJob(env, kbCfg, null);
  } catch (e) {
    console.warn("[kb] Sync not started:", e.message);
    st.error = { at: now, msg: e.message };
    st.next = now + 3600000; // try again in an hour
    return putJSON(env, SYNC, st);
  }
  return stepSync(env, st, kbCfg);
}

/** After the automatic sync setting changes: move the next sync date */
export async function rescheduleSync(env, every) {
  const st = (await getJSON(env, SYNC)) || {};
  st.next = nextSyncAt(st.last?.at || Date.now(), every);
  await putJSON(env, SYNC, st);
  return st;
}

// Gộp các bài đang bật thành kb:text (đưa vào prompt) + danh sách bài cho trang quản trị
export async function rebuildKnowledge(env, { urls = null, listHash = null, kbCfg = null } = {}) {
  const meta = (await getJSON(env, "kb:meta")) || {};
  kbCfg ||= (await getJSON(env, "cfg:kb")) || {};
  const excluded = new Set(kbCfg.excluded || []);
  const wanted = urls ? new Set(urls.map((u) => pageKey(env, u))) : null;
  const keys = [];
  let cursor;
  do {
    const r = await env.KB.list({ prefix: "page:", cursor });
    keys.push(...r.keys.map((k) => k.name));
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  keys.sort();
  const drop = wanted ? keys.filter((k) => !wanted.has(k)) : [];
  await Promise.all(drop.map((k) => env.KB.delete(k)));
  const keep = keys.filter((k) => !drop.includes(k));
  const values = await Promise.all(keep.map((k) => env.KB.get(k)));
  const parts = [];
  const articles = [];
  keep.forEach((k, i) => {
    const v = values[i];
    if (!v) return;
    const id = k.slice(5);
    const m = v.match(/^<article url="([^"]*)" title="([^"]*)">/);
    const off = excluded.has(id);
    articles.push({ id, url: m?.[1] || id, title: m?.[2] || id, chars: v.length, off, src: id.startsWith("/") ? "help" : "web" });
    if (!off) parts.push(v);
  });
  const next = {
    pages: parts.length,
    total: articles.length,
    urls: urls ? urls.length : meta.urls ?? articles.length,
    listHash: listHash ?? meta.listHash,
    builtAt: new Date().toISOString(),
    articles,
  };
  await env.KB.put("kb:text", parts.join("\n\n"));
  await putJSON(env, "kb:meta", next);
  return next;
}
