// @ts-nocheck  (JavaScript thuần: tắt phần kiểm tra kiểu TypeScript của trình sửa code Cloudflare)
// Giờ Việt Nam và giờ làm việc của team.
import { cfg } from "./config.js";

// Giờ Việt Nam (không có giờ mùa hè nên dùng offset cố định, rẻ CPU)
export function localNow(env, ms = Date.now()) {
  const d = new Date(ms + Number(cfg(env, "UTC_OFFSET_HOURS")) * 3600000);
  return {
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

// Câu mô tả cho AI: team đang trong giờ làm hay bao lâu nữa quay lại
export function teamAvailabilityNote(env) {
  const bh = parseBusinessHours(cfg(env, "BUSINESS_HOURS"));
  if (!bh) return "";
  const now = localNow(env);
  const inHours = bh.days.has(now.weekday) && now.minutes >= bh.open && now.minutes < bh.close;
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const tz = `GMT+${cfg(env, "UTC_OFFSET_HOURS")}`;
  if (inHours) return `Team support works ${cfg(env, "BUSINESS_HOURS")} (${tz}); it is within working hours now, so a teammate usually replies within a few hours.`;
  let wait = 0;
  let when = "";
  for (let i = 0; i < 8; i++) {
    const wd = ((now.weekday - 1 + i) % 7) + 1;
    if (!bh.days.has(wd)) continue;
    const startToday = i * 1440 + bh.open - now.minutes;
    if (startToday > 0) {
      wait = startToday;
      when = i === 0 ? "today" : i === 1 ? `tomorrow (${WEEKDAYS[wd]})` : `on ${WEEKDAYS[wd]}`;
      break;
    }
  }
  const hours = Math.max(1, Math.round(wait / 60));
  const at = `${when} at ${hhmm(bh.open)} ${tz}`;
  // Nói "thứ Hai lúc 08:00" thay vì "khoảng 46 tiếng nữa" (nghe như máy); còn ít giờ thì nói số giờ cũng được
  const say = hours <= 3 ? `"${at}" or "in about ${hours} hour${hours > 1 ? "s" : ""}"` : `"${at}", not a number of hours`;
  return `Team support works ${cfg(env, "BUSINESS_HOURS")} (${tz}). It is outside working hours now; the team is back ${at} (about ${hours} hour${hours > 1 ? "s" : ""} from now). Tell the customer this when you hand off: say ${say}.`;
}

const WEEKDAYS = { 1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday", 5: "Friday", 6: "Saturday", 7: "Sunday" };
