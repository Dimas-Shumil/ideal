import test from "node:test";
import assert from "node:assert/strict";
import { clubDateTime, clubParts, isoWeekday, localDayDistance, weeklyDates } from "../server/modules/schedule/dates.js";

test("schedule dates: club local time is stored as UTC+7 instant", () => {
  const value = clubDateTime("2026-10-24", "12:30");
  assert.equal(value.toISOString(), "2026-10-24T05:30:00.000Z");
  assert.deepEqual(clubParts(value), { date: "2026-10-24", time: "12:30" });
});

test("schedule dates: ISO weekdays use Monday=1 and Sunday=7", () => {
  assert.equal(isoWeekday("2026-10-19"), 1);
  assert.equal(isoWeekday("2026-10-25"), 7);
});

test("schedule dates: weekly series includes only selected days", () => {
  assert.deepEqual(weeklyDates("2026-10-19", "2026-10-25", "1,3,5"), ["2026-10-19", "2026-10-21", "2026-10-23"]);
});

test("schedule dates: correction distance is calendar-day based", () => {
  assert.equal(localDayDistance("2026-10-23", "2026-10-24"), 1);
  assert.equal(localDayDistance("2026-10-24", "2026-10-24"), 0);
  assert.equal(localDayDistance("2026-10-25", "2026-10-24"), -1);
});
