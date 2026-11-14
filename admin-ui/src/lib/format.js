// Numbers, dates and text helpers used across the admin.

const nf = new Intl.NumberFormat("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const n = (v) => nf.format(v || 0);
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "–");
export const pad = (x) => String(x).padStart(2, "0");
export const fmtDay = (t) => {
  const d = new Date(t);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const fmtClock = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fmtTime = (t) => (t ? `${fmtDay(t)} ${fmtClock(t)}` : "");
export function ago(t) {
  if (!t) return "never";
  const ms = typeof t === "string" ? Date.parse(t) : t;
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return fmtDay(ms);
}
/** "GMT+7", "GMT-5", "GMT+5:30", "GMT" */
export function tzLabel(offset) {
  const h = Number(offset) || 0;
  if (!h) return "GMT";
  const abs = Math.abs(h);
  const min = Math.round((abs % 1) * 60);
  return `GMT${h < 0 ? "-" : "+"}${Math.floor(abs)}${min ? `:${String(min).padStart(2, "0")}` : ""}`;
}
export const monthLabel = (m) => {
  const [y, mo] = m.split("-");
  return `${MONTHS_LONG[+mo - 1]} ${y}`;
};
export function shiftMonth(m, d) {
  let [y, mo] = m.split("-").map(Number);
  mo += d;
  if (mo < 1) { mo = 12; y--; }
  if (mo > 12) { mo = 1; y++; }
  return `${y}-${pad(mo)}`;
}
export const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
/** Lowercase, without accents: search matches "tinh huong" with "tình huống" */
export const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d");
export const matches = (q, ...fields) => !q.trim() || fields.some((f) => words(f).includes(words(q.trim())));
export const plural = (k, one, many = `${one}s`) => `${n(k)} ${k === 1 ? one : many}`;
/** First option of a <select> when the saved value isn't one of its options (what the browser would show) */
export const pick = (list, v) => (list.includes(v) ? v : list[0]);
