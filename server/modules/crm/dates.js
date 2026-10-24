export const CLUB_ZONE = "Asia/Krasnoyarsk";
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLUB_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export const dateString = (value) =>
  value instanceof Date ? value.toISOString().slice(0, 10) : value;
export function validDate(s) {
  return (
    typeof s === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(+new Date(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s &&
    s >= "1900-01-01" &&
    s <= "2199-12-31"
  );
}
export function addDays(value, days) {
  const d = new Date(dateString(value) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function addMonths(value, months) {
  const [y, m, d] = dateString(value).split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}
export const dayCount = (start, end) =>
  Math.round(
    (Date.parse(dateString(end)) - Date.parse(dateString(start))) / 86400000,
  ) + 1;
export const dbDate = (s) => new Date(s + "T00:00:00Z");
export function age(birth, at = today()) {
  const b = dateString(birth);
  return (
    Number(at.slice(0, 4)) -
    Number(b.slice(0, 4)) -
    (at.slice(5) < b.slice(5) ? 1 : 0)
  );
}
export function endDate(start, plan) {
  return plan.months
    ? addMonths(start, plan.months)
    : plan.days
      ? addDays(start, plan.days - 1)
      : null;
}
export function membershipStatus(m, at = today()) {
  if (m.cancelledAt) return "Отменён";
  if (!m.startDate) return "Ожидает первого посещения";
  if (dateString(m.startDate) > at) return "Запланирован";
  if (m.endDate && dateString(m.endDate) < at) return "Истёк";
  if (
    m.freezes?.some(
      (f) => dateString(f.startDate) <= at && dateString(f.endDate) >= at,
    )
  )
    return "Заморожен";
  if (m.remaining === 0) return "Исчерпан";
  return "Действует";
}
