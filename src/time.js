// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giờ Việt Nam và giờ làm việc của team.
import { MAX_DAYS_OFF, cfg } from "./config.js";

// Giờ Việt Nam (không có giờ mùa hè nên dùng offset cố định, rẻ CPU)
export function localNow(env, ms = Date.now()) {
  const d = new Date(ms + Number(cfg(env, "UTC_OFFSET_HOURS")) * 3600000);
  return {
    date: d.toISOString().slice(0, 10), // YYYY-MM-DD theo giờ của team
    month: d.toISOString().slice(0, 7),
    day: d.toISOString().slice(8, 10),
    weekday: d.getUTCDay() === 0 ? 7 : d.getUTCDay(), // 1=Thứ 2 … 7=Chủ nhật
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

export const DAY_NAMES = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

// "Mon-Sat 08:00-22:00" hoặc "Mon-Fri,Sun 08:00-24:00" → {days:Set, open, close}
export function parseBusinessHours(s) {
  const m = String(s || "").trim().toLowerCase().match(/^([a-z,\- ]+)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const days = new Set();
  for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
    const [a, b] = part.split("-").map((x) => DAY_NAMES[x.trim().slice(0, 3)]);
    if (!a) return null;
    if (!b) days.add(a);
    else for (let d = a; ; d = (d % 7) + 1) { days.add(d); if (d === b) break; }
  }
  const open = +m[2] * 60 + +m[3];
  const close = +m[4] * 60 + +m[5];
  if (!days.size || open >= close || close > 1440) return null;
  return { days, open, close };
}

// Ngày nghỉ của team (lễ, nghỉ đột xuất): "2026-12-24,2026-12-25" → ["2026-12-24", …] đã sắp xếp, bỏ trùng.
// → null khi có ngày sai dạng hoặc nhiều hơn MAX_DAYS_OFF ngày.
export function parseDaysOff(s) {
  const out = new Set();
  for (const p of String(s || "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p)) return null;
    const d = new Date(p + "T00:00:00Z");
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== p) return null; // vd 2026-02-30
    out.add(p);
  }
  return out.size > MAX_DAYS_OFF ? null : [...out].sort();
}

// "GMT+7", "GMT-5", "GMT+5:30", "GMT"
export function tzLabel(offset) {
  const h = Number(offset) || 0;
  if (!h) return "GMT";
  const abs = Math.abs(h);
  const min = Math.round((abs % 1) * 60);
  return `GMT${h < 0 ? "-" : "+"}${Math.floor(abs)}${min ? `:${String(min).padStart(2, "0")}` : ""}`;
}

/* Team đang làm việc hay nghỉ, và khi nào quay lại. → null khi chưa đặt giờ làm việc.
   { open: true } hoặc { open: false, dayOff, wait, at }:
     dayOff = hôm nay là ngày nghỉ (Settings → Days off) dù rơi vào ngày làm việc; wait = số phút tới lúc team quay lại;
     at = "tomorrow (Monday) at 08:00 GMT+7". Ngày nghỉ được bỏ qua khi tìm ngày quay lại. */
export function teamStatus(env, ms = Date.now()) {
  const bh = parseBusinessHours(cfg(env, "BUSINESS_HOURS"));
  if (!bh) return null;
  const now = localNow(env, ms);
  const off = new Set(parseDaysOff(cfg(env, "DAYS_OFF")) || []);
  const dateAt = (i) => new Date(Date.parse(now.date + "T00:00:00Z") + i * 86400000);
  const offToday = off.has(now.date);
  if (!offToday && bh.days.has(now.weekday) && now.minutes >= bh.open && now.minutes < bh.close) return { open: true };
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  let wait = 0;
  let when = "";
  let skipped = false; // đã bỏ qua ít nhất một ngày làm việc vì nó là ngày nghỉ
  // Không có ngày nghỉ: tìm trong 8 ngày như trước. Có ngày nghỉ: tìm xa hơn để vượt qua cả một kỳ nghỉ dài.
  for (let i = 0; i < (off.size ? 8 + MAX_DAYS_OFF : 8); i++) {
    const wd = ((now.weekday - 1 + i) % 7) + 1;
    if (!bh.days.has(wd)) continue;
    const date = dateAt(i);
    if (off.has(date.toISOString().slice(0, 10))) {
      skipped = true;
      continue;
    }
    const start = i * 1440 + bh.open - now.minutes;
    if (start > 0) {
      wait = start;
      // Nghỉ từ 1 tuần trở lên thì "on Monday" không còn rõ là thứ Hai nào: kèm ngày tháng
      when = i === 0 ? "today" : i === 1 ? `tomorrow (${WEEKDAYS[wd]})` : i >= 7 && skipped ? `on ${WEEKDAYS[wd]}, ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` : `on ${WEEKDAYS[wd]}`;
      break;
    }
  }
  return { open: false, dayOff: offToday && bh.days.has(now.weekday), wait, at: `${when} at ${hhmm(bh.open)} ${tzLabel(cfg(env, "UTC_OFFSET_HOURS"))}` };
}

// Câu mô tả cho AI: team đang trong giờ làm hay bao lâu nữa quay lại
export function teamAvailabilityNote(env, ms = Date.now()) {
  const st = teamStatus(env, ms);
  if (!st) return "";
  const tz = tzLabel(cfg(env, "UTC_OFFSET_HOURS"));
  if (st.open) return `Team support works ${cfg(env, "BUSINESS_HOURS")} (${tz}); it is within working hours now, so a teammate usually replies within a few hours.`;
  const hours = Math.max(1, Math.round(st.wait / 60));
  const at = st.at;
  // Nói "thứ Hai lúc 08:00" thay vì "khoảng 46 tiếng nữa" (nghe như máy); còn ít giờ thì nói số giờ cũng được
  const say = hours <= 3 ? `"${at}" or "in about ${hours} hour${hours > 1 ? "s" : ""}"` : `"${at}", not a number of hours`;
  const why = st.dayOff ? "The team has a day off today, so it is outside working hours now" : "It is outside working hours now";
  return `Team support works ${cfg(env, "BUSINESS_HOURS")} (${tz}). ${why}; the team is back ${at} (about ${hours} hour${hours > 1 ? "s" : ""} from now). Tell the customer this when you hand off: say ${say}.`;
}

const WEEKDAYS = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
