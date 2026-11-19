// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
/* Chọn bài help center cho từng câu hỏi.
   Help center nhỏ (≤ KB_FULL_CHARS ký tự): đưa cả vào prompt như trước.
   Help center lớn: mỗi câu trả lời chỉ đưa các bài sát câu hỏi nhất (tối đa KB_MAX_ARTICLES bài, KB_BUDGET_CHARS ký tự),
   kèm tên + link của vài bài kế tiếp. Prompt ngắn hơn → AI ít bỏ sót đoạn cần dùng, và help center lớn không làm hỏng mọi câu trả lời.
   Bảng tra (kb:index) được tạo lúc sync (knowledge.js → rebuildKnowledge), nên lúc trả lời chỉ tốn rất ít CPU.
   Snippet không đi qua đây: luôn được đưa vào prompt đầy đủ. */
import { cfg } from "./config.js";
import { terms as rawTerms } from "./style.js";
import { getJSON } from "./util.js";

export const INDEX_KEY = "kb:index";
export const INDEX_V = 1;
const MAX_TERMS = 500; // số từ khác nhau giữ lại cho mỗi bài
const TITLE_WEIGHT = 3; // từ trong tên bài nặng gấp 3 từ trong nội dung
const NEXT_TITLES = 40; // số bài "chỉ có tên" liệt kê thêm

// Gọt đuôi từ tiếng Anh cho "refund" khớp "refunds", "showing" khớp "show", "translated" khớp "translate"
export const stem = (w) => {
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w.length > 4 && w.endsWith("e") ? w.slice(0, -1) : w;
};
const terms = (s) => rawTerms(s).map(stem);

const ARTICLE_RE = /<article url="([^"]*)" title="([^"]*)">\n([\s\S]*?)\n<\/article>/g;

/** kb:text → [{ url, title, body, text }] (text = nguyên khối <article>…</article>) */
export function splitArticles(kbText) {
  return [...String(kbText || "").matchAll(ARTICLE_RE)].map((m) => ({ url: m[1], title: m[2], body: m[3], text: m[0] }));
}

/** 1 bài → dòng trong bảng tra: { id, u, t, c (số ký tự), len, tf: { từ: số lần } } */
export function indexDoc({ id = null, url, title, body, text }) {
  const tf = new Map();
  const add = (w, n) => tf.set(w, (tf.get(w) || 0) + n);
  for (const w of terms(title)) add(w, TITLE_WEIGHT);
  for (const w of terms(body)) add(w, 1);
  let entries = [...tf.entries()];
  if (entries.length > MAX_TERMS) entries = entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TERMS);
  return { id, u: url, t: title, c: (text || body || "").length, len: entries.reduce((n, e) => n + e[1], 0), tf: Object.fromEntries(entries) };
}

export function buildIndex(articles) {
  const docs = articles.map(indexDoc);
  return { v: INDEX_V, chars: docs.reduce((n, d) => n + d.c, 0), docs };
}

/** Điểm BM25 của từng bài với câu hỏi (mảng cùng thứ tự với index.docs) */
export function rank(index, query) {
  const docs = index.docs;
  const scores = docs.map(() => 0);
  const q = [...new Set(terms(query))];
  if (!q.length || !docs.length) return scores;
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length || 1;
  const k1 = 1.4, b = 0.6;
  for (const w of q) {
    const has = docs.map((d) => (Object.hasOwn(d.tf, w) ? d.tf[w] : 0));
    const df = has.filter(Boolean).length;
    if (!df) continue;
    const idf = Math.log(1 + (docs.length - df + 0.5) / (df + 0.5));
    has.forEach((f, i) => {
      if (f) scores[i] += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * docs[i].len) / avg));
    });
  }
  return scores;
}

/** Chọn bài: bài AI chọn theo tên (picked) trước, rồi theo điểm. → { chosen: [vị trí, theo thứ tự gốc], next: [vị trí các bài kế tiếp] } */
export function select(index, { query = "", picked = [], budget = 80000, max = 14 } = {}) {
  const docs = index.docs;
  const scores = rank(index, query);
  const byScore = docs.map((_, i) => i).filter((i) => scores[i] > 0).sort((a, b) => scores[b] - scores[a] || a - b);
  const order = [...new Set([...picked.filter((i) => Number.isInteger(i) && i >= 0 && i < docs.length), ...byScore])];
  // Không bài nào khớp (vd khách viết bằng chữ không phải Latin và không có bước làm rõ câu hỏi): lấy theo thứ tự gốc
  const fallback = order.length ? [] : docs.map((_, i) => i);
  const chosen = [];
  let used = 0;
  for (const i of [...order, ...fallback]) {
    if (chosen.length >= max) break;
    if (chosen.length && used + docs[i].c > budget) continue;
    chosen.push(i);
    used += docs[i].c;
  }
  const taken = new Set(chosen);
  const next = [...order, ...docs.map((_, i) => i)].filter((i, k, a) => !taken.has(i) && a.indexOf(i) === k).slice(0, NEXT_TITLES);
  return { chosen: chosen.sort((a, b) => a - b), next };
}

export function otherArticlesNote(docs) {
  if (!docs.length) return "";
  return `<other_articles>
The help center has more articles than the ones loaded above. The articles below were NOT loaded for this reply (title and url only): never state what they say. If none of the loaded articles answers the question and one of these titles clearly matches it, you may give the customer that link.
${docs.map((d) => `- ${d.t}: ${d.u}`).join("\n")}
</other_articles>`;
}

/* Kiến thức help center cho câu trả lời này → { text, extra?, info? }
   refine(titles) (tuỳ chọn): hỏi AI một lượt ngắn để viết lại câu hỏi và chọn bài theo tên (ai.js → refineQuery).
   Hỏng ở bước nào thì lùi về cách an toàn hơn (chọn theo từ khoá, hoặc đưa cả help center như trước). */
export async function loadKnowledge(env, history, refine = null) {
  if (!env.KB) return { text: "" };
  const all = async () => ({ text: (await env.KB.get("kb:text")) || "" });
  const full = Number(cfg(env, "KB_FULL_CHARS"));
  let index = await getJSON(env, INDEX_KEY);
  let local = null; // help center sync trước khi có bảng tra: tách tại chỗ từ kb:text (lần sync kế tiếp sẽ tạo bảng tra)
  if (!index || index.v !== INDEX_V || !Array.isArray(index.docs)) {
    const kb = (await env.KB.get("kb:text")) || "";
    if (kb.length <= full) return { text: kb };
    local = splitArticles(kb);
    if (!local.length) return { text: kb };
    index = buildIndex(local);
  } else if (index.chars <= full) return all();

  const recent = (history || []).filter((h) => h.role === "user").slice(-3).map((h) => h.content).join(" ");
  let query = recent;
  let picked = [];
  let question = null;
  if (refine) {
    try {
      const u = await refine(index.docs.map((d) => d.t));
      question = u.question || null;
      picked = u.articles || [];
      query = [u.question, ...(u.keywords || []), recent].filter(Boolean).join(" ");
    } catch (e) {
      console.warn("[kb] Không làm rõ được câu hỏi, chọn bài theo từ khoá:", e?.message || e);
    }
  }
  const sel = select(index, { query, picked, budget: Number(cfg(env, "KB_BUDGET_CHARS")), max: Number(cfg(env, "KB_MAX_ARTICLES")) });
  const texts = local ? sel.chosen.map((i) => local[i].text) : await Promise.all(sel.chosen.map((i) => env.KB.get("page:" + index.docs[i].id)));
  const got = sel.chosen.filter((_, k) => texts[k]);
  if (!got.length) return all();
  return {
    text: texts.filter(Boolean).join("\n\n"),
    extra: otherArticlesNote(sel.next.map((i) => index.docs[i])),
    info: { used: got.length, total: index.docs.length, question, titles: got.map((i) => index.docs[i].t) },
  };
}
