// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Kiến thức của bot: sync help center và trang website vào KV (bấm Sync now trên /admin hoặc tự động theo lịch).
import { callOpenAI, productLine } from "./ai.js";
import { cfg, withConfig } from "./config.js";
import { INDEX_KEY, buildIndex, splitArticles } from "./retrieval.js";
import { clip, getJSON, hash, list, putJSON, sleep } from "./util.js";

const UA = { "User-Agent": "SupportBot-KB/2.0" };

export const MAX_HELP_PAGES = 300; // nhiều hơn thì prompt quá lớn: thu hẹp bằng Help center sections

const locsOf = (xml) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

/* Tìm sitemap của help center, thử lần lượt: <link help center>/sitemap.xml, các dòng "Sitemap:" trong robots.txt,
   /sitemap.xml ở gốc trang, sitemap_index.xml. Sitemap index (chứa sitemap con) được đọc tiếp, tối đa 2 tầng.
   Trả về danh sách link, hoặc null nếu không tìm thấy sitemap nào. */
export async function readSitemaps(origin, prefix) {
  let fetches = 0;
  const get = async (url) => {
    if (fetches++ >= 30) return null; // giữ trong hạn mức số request của Cloudflare
    try {
      const res = await fetch(url, { headers: UA });
      return res.ok ? await res.text() : null;
    } catch {
      return null;
    }
  };
  const read = async (url, depth = 0) => {
    const xml = await get(url);
    if (xml == null) return null;
    const locs = locsOf(xml);
    const subs = depth < 2 ? locs.filter((l) => /\.xml(\?|$)/i.test(l)).slice(0, 20) : [];
    if (!subs.length) return locs.filter((l) => !/\.xml(\.gz)?(\?|$)/i.test(l));
    const inner = await Promise.all(subs.map((x) => read(x, depth + 1)));
    return [...locs.filter((l) => !/\.xml(\.gz)?(\?|$)/i.test(l)), ...inner.flatMap((x) => x || [])];
  };
  const tried = new Set();
  const attempt = async (url) => {
    if (tried.has(url)) return null;
    tried.add(url);
    const locs = await read(url);
    return locs?.length ? locs : null;
  };
  let found = await attempt(`${origin}${prefix}/sitemap.xml`);
  if (!found) {
    const robots = await get(`${origin}/robots.txt`);
    const listed = robots ? [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]).slice(0, 5) : [];
    const all = (await Promise.all(listed.map(attempt))).filter(Boolean);
    if (all.length) found = all.flat();
  }
  for (const url of [`${origin}/sitemap.xml`, `${origin}${prefix}/sitemap_index.xml`, `${origin}/sitemap_index.xml`]) found ||= await attempt(url);
  return found;
}

// Link bài team tự dán (Settings → Help center pages), mỗi dòng 1 link
export const manualHelpPages = (env) => cfg(env, "HELP_CENTER_PAGES").split("\n").map((l) => l.trim()).filter(Boolean);

/* Bài help center = các link trong sitemap nằm dưới link help center (và trong các section đã chọn, nếu có)
   + các link team tự dán. Chưa điền link help center → không có bài nào. */
export async function listHelpCenterUrls(env) {
  const raw = cfg(env, "HELP_CENTER_URL");
  const manual = manualHelpPages(env);
  if (!raw) {
    if (manual.length) throw new Error("enter the help center link first, then the help center pages");
    return [];
  }
  const base = new URL(raw.replace(/\/+$/, ""));
  const origin = base.origin;
  const prefix = base.pathname.replace(/\/+$/, ""); // "" hoặc "/hc/en-us": chỉ lấy bài dưới đường dẫn này
  const sections = list(cfg(env, "HELP_CENTER_SECTIONS")).map((x) => x.replace(/^\/|\/$/g, "")).filter(Boolean);
  const urls = new Set();
  const outside = [];
  for (const m of manual) {
    try {
      const u = new URL(m);
      if (u.origin === origin) urls.add(origin + u.pathname);
      else outside.push(m);
    } catch {}
  }
  if (outside.length) throw new Error(`these help center pages are on another site than the help center link: ${outside.slice(0, 3).join(", ")}. Add pages from other sites on the Knowledge page (Website pages)`);
  const locs = await readSitemaps(origin, prefix);
  if (!locs && !urls.size) throw new Error(`no sitemap found for ${origin}${prefix} (tried sitemap.xml and robots.txt). Paste the article links under Help center pages instead`);
  for (const loc of locs || []) {
    try {
      const u = new URL(loc);
      if (u.origin !== origin) continue;
      if (prefix && u.pathname !== prefix && !u.pathname.startsWith(`${prefix}/`)) continue;
      if (sections.length && !sections.some((x) => u.pathname.startsWith(`${prefix}/${x}/`))) continue;
      urls.add(origin + u.pathname);
    } catch {}
  }
  if (!urls.size) throw new Error(`the sitemap lists no pages under ${origin}${prefix}${sections.length ? ` in the sections ${sections.join(", ")}` : ""}. Check the link and the sections`);
  if (urls.size > MAX_HELP_PAGES) throw new Error(`the help center has ${urls.size} pages, more than the bot can load (${MAX_HELP_PAGES}). Narrow it down with Help center sections, for example only the articles path`);
  return [...urls].sort();
}

export const helpOrigin = (env) => {
  try {
    return new URL(cfg(env, "HELP_CENTER_URL")).origin;
  } catch {
    return null; // chưa có help center
  }
};

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

// Chỗ đặt ảnh trong chữ của bài: ⟦img:N⟧, lúc lưu thay bằng chú thích + chữ AI đọc được trong ảnh (xem withImages)
const IMG_MARK = (n) => `\n⟦img:${n}⟧\n`;

const BLOCKS = { h1: "\n# ", h2: "\n## ", h3: "\n### ", h4: "\n### ", li: "\n- ", p: "\n", td: " | ", th: " | ", tr: "\n", pre: "\n", blockquote: "\n" };
const MAX_IMAGES_PER_PAGE = 15;

/* Vùng nội dung của bài help center, thử theo thứ tự (lấy vùng đầu tiên có chữ):
   selector team điền (Settings → Article content area), .theme-doc-markdown (Docusaurus), <article>, <main>, [role=main].
   Không vùng nào có chữ thì lấy cả trang như trang website. clean = bỏ menu, footer, form… nằm trong vùng đó. */
const AREAS = [
  [".theme-doc-markdown", false],
  ["article", true],
  ["main", true],
  ['[role="main"]', true],
];

/** Selector team điền có dùng được không (HTMLRewriter chỉ hỗ trợ một phần CSS selector) */
export function selectorError(sel) {
  try {
    new HTMLRewriter().on(sel, {});
    return null;
  } catch (e) {
    return e?.message || "unsupported selector";
  }
}

export async function extractPage(env, url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  let title = "", body = "", skip = 0, aside = 0;
  const rw = new HTMLRewriter().on("title", { text: (t) => void (title += t.text) });
  const areas = [];
  if (new URL(url).origin === helpOrigin(env)) {
    const custom = cfg(env, "HELP_CENTER_SELECTOR").trim();
    for (const [sel, clean] of [...(custom && !selectorError(custom) ? [[custom, true]] : []), ...AREAS]) {
      const a = { text: "", imgs: [] };
      areas.push(a);
      const hidden = () => clean && (skip > 0 || aside > 0);
      for (const [tag, prefix] of Object.entries(BLOCKS)) rw.on(`${sel} ${tag}`, { element: () => void (a.text += prefix) });
      rw.on(sel, { text: (t) => void (hidden() ? 0 : (a.text += t.text)) });
      // Ảnh trong bài (ảnh chụp màn hình, bảng, danh sách…): nhớ chỗ đặt + link + chú thích
      rw.on(`${sel} img`, {
        element(el) {
          if (hidden() || a.imgs.length >= MAX_IMAGES_PER_PAGE) return;
          const src = imageUrl(el, url);
          if (!src) return;
          const n = a.imgs.push({ src, alt: cleanText(el.getAttribute("alt") || "") }) - 1;
          a.text += IMG_MARK(n);
        },
      });
    }
  }
  // Trang website bất kỳ: lấy chữ trong body, bỏ menu, footer, script
  rw.on("script,style,noscript,svg,nav,footer,form,iframe,template", {
    element(el) {
      try { el.onEndTag(() => void skip--); skip++; } catch {}
    },
  });
  rw.on("aside", {
    element(el) {
      try { el.onEndTag(() => void aside--); aside++; } catch {}
    },
  });
  for (const [tag, prefix] of Object.entries({ ...BLOCKS, div: "\n", section: "\n", br: "\n" })) rw.on(`body ${tag}`, { element: () => void (body += prefix) });
  rw.on("body", { text: (t) => void (skip ? 0 : (body += t.text)) });
  await rw.transform(res).arrayBuffer();
  const noImg = (x) => x.replace(/⟦img:\d+⟧/g, "").trim();
  const area = areas.find((a) => noImg(cleanText(a.text)));
  const [text, images] = area ? [cleanText(area.text), area.imgs] : [cleanText(body), []];
  const h1 = text.match(/^# (.+)$/m)?.[1];
  return { url, title: (h1 || cleanText(title).split("|")[0] || url).trim(), body: text, images };
}

// Link ảnh đầy đủ (kể cả ảnh tải chậm: data-src, srcset); bỏ ảnh nhúng (data:), hình vẽ .svg và ảnh nhỏ (icon, emoji, avatar)
function imageUrl(el, base) {
  const small = (v) => /^\d+$/.test(v || "") && +v < 50;
  if (small(el.getAttribute("width")) || small(el.getAttribute("height")) || /(^|[\s_-])(emoji|avatar|icon)s?($|[\s_-])/i.test(el.getAttribute("class") || "")) return null;
  const srcset = (el.getAttribute("srcset") || el.getAttribute("data-srcset") || "").split(",")[0].trim().split(/\s+/)[0];
  const cands = [el.getAttribute("src"), el.getAttribute("data-src"), el.getAttribute("data-lazy-src"), el.getAttribute("data-original"), srcset];
  for (const c of cands) {
    if (!c || !String(c).trim()) continue; // không có thuộc tính này (chuỗi rỗng sẽ thành link của chính trang)
    try {
      const u = new URL(String(c).trim(), base);
      if (/^https?:$/.test(u.protocol) && !/\.svg$/i.test(u.pathname)) return u.toString();
    } catch {}
  }
  return null;
}

/* Chữ trong ảnh của help center: nhiều thông tin chỉ nằm trong ảnh (vd danh sách app tương thích là 3 ảnh chụp).
   Mỗi ảnh cho AI đọc 1 lần, lưu ở img:<hash link ảnh>; sync lần sau dùng lại, không tốn thêm.
   Ảnh đổi link (nhiều help center đổi tên file khi ảnh đổi) = ảnh mới = tự đọc lại.
   Ảnh đổi nội dung mà giữ nguyên link: team bấm "Read images again" trên trang Knowledge (tăng cfg:kb.imgRev). */
const IMG_V = 1; // tăng khi đổi cách đọc ảnh → đọc lại hết
const IMAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["useful", "text"],
  properties: {
    useful: { type: "boolean", description: "false when the image has no information a customer could ask about" },
    text: { type: "string", description: "The information in the image, plain text, one item per line" },
  },
};

export async function imageText(env, img, title, budget) {
  const key = `img:${await hash(budget?.rev ? `${img.src}#${budget.rev}` : img.src)}`; // rev tăng khi team bấm "Read images again"
  const cached = await getJSON(env, key);
  if (cached?.v === IMG_V) return cached.text;
  if (!env.OPENAI_API_KEY || !budget || budget.left <= 0) return null; // chưa đọc: lần sync sau đọc tiếp
  budget.left--;
  try {
    const r = await callOpenAI(env, {
      instructions: `You read images from the help center of ${productLine(env)}, so that a support bot can answer customers' questions from them.
Write down the information in the image that a customer could ask about: names in lists (apps, plans, languages, countries…), table rows, settings and their values, menu paths, page titles, button and field labels.
- Plain text, one item per line. For cards or list entries write "Name: short description".
- Skip the browser frame and the navigation around the screen (side bar icons, top bar), decorative pictures and anything you cannot read.
- Do not describe colors or layout, and never guess text you cannot read.
Set useful to false when the image has no such information (a photo, a logo, a decorative picture).`,
      input: [{ role: "user", content: [
        { type: "input_text", text: `Article: ${title}\nImage caption: ${img.alt || "(none)"}` },
        { type: "input_image", image_url: img.src, detail: "high" },
      ] }],
      schemaName: "image_text",
      schema: IMAGE_SCHEMA,
      effort: "off",
      timeoutMs: Number(cfg(env, "IMAGE_READ_MS")),
    });
    const text = r.useful ? clip(r.text, 4000, true) : "";
    await putJSON(env, key, { v: IMG_V, src: img.src, text, at: new Date().toISOString() });
    return text;
  } catch (e) {
    console.warn("[kb] Không đọc được ảnh", img.src, e?.message || e);
    return null;
  }
}

// Thay chỗ đặt ảnh bằng "[Image: chú thích]" + chữ trong ảnh. budget: số ảnh MỚI được đọc trong lần chạy này.
export async function withImages(env, page, budget) {
  const texts = await Promise.all((page.images || []).map((img) => imageText(env, img, page.title, budget)));
  const body = page.body.replace(/⟦img:(\d+)⟧/g, (_, n) => {
    const img = page.images?.[+n];
    if (!img) return "";
    const t = texts[+n];
    const head = img.alt ? `[Image: ${img.alt}]` : t ? "[Image]" : "";
    return t ? `${head}\n${t}\n[/Image]` : head;
  });
  return body.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 30000);
}

export const articleValue = (page) => `<article url="${page.url}" title="${page.title.replace(/"/g, "'")}">\n${page.body}\n</article>`;

export async function storePage(env, url, budget = null) {
  budget ||= { left: Number(cfg(env, "IMAGES_PER_RUN")), rev: ((await getJSON(env, "cfg:kb")) || {}).imgRev || 0 };
  const page = await extractPage(env, url);
  page.body = await withImages(env, page, budget);
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
  kbCfg ||= (await getJSON(env, "cfg:kb")) || {};
  const budget = { left: Number(cfg(env, "IMAGES_PER_RUN")), rev: kbCfg.imgRev || 0 }; // số ảnh mới AI đọc trong bước này (cả 6 trang dùng chung)
  const results = await Promise.all(
    batch.map((url) =>
      storePage(env, url, budget).catch((e) => {
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
    return stepSync(await withConfig(env), st); // cần cài đặt trên /admin (link help center) để đặt đúng tên bài
  } else if (!st.next || now < st.next) {
    return;
  }
  env = await withConfig(env); // link help center + section điền trên /admin: thiếu bước này cron tưởng chưa có help center và xoá hết bài
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
  // Bảng tra để chọn bài theo câu hỏi khi help center lớn (retrieval.js). Chỉ gồm các bài đang bật.
  const docs = articles.filter((a) => !a.off).map((a) => ({ id: a.id, ...(splitArticles(values[keep.indexOf("page:" + a.id)])[0] || { url: a.url, title: a.title, body: "" }) }));
  await putJSON(env, INDEX_KEY, buildIndex(docs));
  await putJSON(env, "kb:meta", next);
  return next;
}
