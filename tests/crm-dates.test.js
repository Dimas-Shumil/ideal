import test from "node:test";
import assert from "node:assert/strict";
import {
  today,
  validDate,
  addMonths,
  addDays,
  dayCount,
  endDate,
  age,
  membershipStatus,
} from "../server/modules/crm/dates.js";
test("CRM dates: Abakan midnight is independent of host timezone", () => {
  assert.equal(today(new Date("2026-10-23T16:59:59Z")), "2026-10-23");
  assert.equal(today(new Date("2026-10-23T17:00:00Z")), "2026-10-24");
});
test("CRM dates: exact inclusive club month, leap year and final day clamp", () => {
  assert.equal(endDate("2026-10-24", { months: 1 }), "2026-11-24");
  assert.equal(endDate("2026-01-31", { months: 1 }), "2026-02-28");
  assert.equal(endDate("2024-01-31", { months: 1 }), "2024-02-29");
  assert.equal(endDate("2026-10-24", { days: 14 }), "2026-11-06");
  assert.equal(endDate("2026-10-24", { months: 0, days: 0 }), null);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(dayCount("2026-10-24", "2026-10-24"), 1);
  assert.equal(dayCount("2026-10-24", "2026-10-23"), 0);
});
test("CRM dates: invalid dates never normalize to another day; exact age boundary", () => {
  for (const d of [
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-1-01",
    "1899-01-01",
    "2200-01-01",
  ])
    assert.equal(validDate(d), false);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(age("2008-10-24", "2026-10-24"), 18);
  assert.equal(age("2008-10-25", "2026-10-24"), 17);
});
test("CRM dates: pending, future, last inclusive day, expiry, freeze and zero balance", () => {
  const m = {
    startDate: "2026-10-24",
    endDate: "2026-11-24",
    remaining: 8,
    freezes: [],
  };
  assert.equal(
    membershipStatus({ ...m, startDate: null, endDate: null }, "2026-10-24"),
    "Ожидает первого посещения",
  );
  assert.equal(membershipStatus(m, "2026-10-23"), "Запланирован");
  assert.equal(membershipStatus(m, "2026-11-24"), "Действует");
  assert.equal(membershipStatus(m, "2026-11-25"), "Истёк");
  assert.equal(
    membershipStatus({ ...m, remaining: 0 }, "2026-10-24"),
    "Исчерпан",
  );
  assert.equal(
    membershipStatus(
      { ...m, freezes: [{ startDate: "2026-10-24", endDate: "2026-10-25" }] },
      "2026-10-24",
    ),
    "Заморожен",
  );
  assert.equal(
    membershipStatus({ ...m, cancelledAt: new Date() }, "2026-10-24"),
    "Отменён",
  );
  assert.equal(addMonths("2026-11-30", 3), "2027-02-28");
});
