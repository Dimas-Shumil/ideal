import { addDays, dateString, today } from "../crm/dates.js";

export const CLUB_OFFSET = "+07:00";
export function clubDateTime(date, time) {
  return new Date(`${date}T${time}:00${CLUB_OFFSET}`);
}
export function clubParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Krasnoyarsk",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}
export function isoWeekday(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}
export function localDayDistance(earlier, later = today()) {
  const a = Date.parse(`${dateString(earlier)}T00:00:00Z`);
  const b = Date.parse(`${dateString(later)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}
export function weeklyDates(start, end, weekdays) {
  const allowed = new Set(weekdays.split(",").filter(Boolean).map(Number));
  const result = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    if (allowed.has(isoWeekday(cursor))) result.push(cursor);
    if (result.length > 200) throw Object.assign(new Error("Слишком много занятий в серии."), { status: 400 });
  }
  return result;
}
