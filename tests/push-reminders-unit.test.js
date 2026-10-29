import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueTrainerReminders, reminderDue, reminderKey,
  trainerReminderIsCurrent, REMINDER_GRACE_MS, REMINDER_WINDOWS,
} from "../server/modules/push/reminders.js";

const lessonId = "11111111-1111-4111-8111-111111111111";
const trainerId = "trainer-user-id";
const now = new Date("2026-10-29T09:00:00.000Z");
const makeLesson = (offset) => ({
  id: lessonId,
  startsAt: new Date(now.getTime() + offset - 60000),
  kind: "PERSONAL", status: "SCHEDULED", bookings: [{ id: "booking" }],
  trainer: { user: { id: trainerId, active: true, role: "TRAINER", authVersion: 1 } },
});

test("trainer reminder: exactly 24h and 3h with a bounded catch-up window", () => {
  assert.deepEqual(REMINDER_WINDOWS.map(item => item.code), ["24H", "3H"]);
  for (const item of REMINDER_WINDOWS) {
    assert.equal(reminderDue(new Date(now.getTime() + item.milliseconds), item.milliseconds, now), true);
    assert.equal(reminderDue(new Date(now.getTime() + item.milliseconds - REMINDER_GRACE_MS), item.milliseconds, now), true);
    assert.equal(reminderDue(new Date(now.getTime() + item.milliseconds - REMINDER_GRACE_MS - 1), item.milliseconds, now), false);
    assert.equal(reminderDue(new Date(now.getTime() + item.milliseconds + 1), item.milliseconds, now), false);
  }
});

test("trainer reminder: deterministic unique key and harmless notification payload", async () => {
  const lesson24 = makeLesson(REMINDER_WINDOWS[0].milliseconds);
  const lesson3 = { ...makeLesson(REMINDER_WINDOWS[1].milliseconds), id: "22222222-2222-4222-8222-222222222222" };
  const rows = new Map();
  const fake = {
    lesson: {
      async findMany({ where }) {
        return [lesson24, lesson3].filter(item => item.startsAt >= where.startsAt.gte && item.startsAt <= where.startsAt.lte);
      },
    },
    pushSubscription: { async findMany() { return [{ id: "device-a" }, { id: "device-b" }]; } },
    pushDelivery: {
      async createMany({ data, skipDuplicates }) {
        assert.equal(skipDuplicates, true);
        let count = 0;
        for (const item of data) {
          const key = `${item.eventKey}:${item.subscriptionId}`;
          if (!rows.has(key)) { rows.set(key, item); count++; }
        }
        return { count };
      },
    },
  };
  assert.equal(await enqueueTrainerReminders(fake, now), 4);
  assert.equal(await enqueueTrainerReminders(fake, now), 0);
  assert.equal(rows.size, 4);
  assert.equal(reminderKey(lesson24.id, lesson24.startsAt, "24H"), `TRAINER_REMINDER_24H:${lessonId}:${lesson24.startsAt.getTime()}`);
  const messages = JSON.stringify([...rows.values()].map(item => item.payload));
  assert.match(messages, /Через сутки/);
  assert.match(messages, /Через 3 часа/);
  for (const privateValue of [lessonId, lesson3.id, "client", "phone", "birthDate", "price"]) {
    assert.equal(messages.includes(privateValue), false);
  }
  assert.ok([...rows.values()].every(item => item.role === "TRAINER" && item.payload.url === "/trainer/lessons"));
});

test("trainer reminder: cancellation, moved lesson, removed booking and changed role suppress delivery", async () => {
  const lesson = makeLesson(REMINDER_WINDOWS[1].milliseconds);
  const delivery = { eventKey: reminderKey(lesson.id, lesson.startsAt, "3H"), userId: trainerId, authVersion: 1 };
  const fake = { lesson: { async findUnique() { return lesson; } } };
  assert.equal(await trainerReminderIsCurrent(fake, delivery, now), true);
  lesson.bookings = [];
  assert.equal(await trainerReminderIsCurrent(fake, delivery, now), false);
  lesson.bookings = [{ id: "booking" }];
  lesson.status = "CANCELLED";
  assert.equal(await trainerReminderIsCurrent(fake, delivery, now), false);
  lesson.status = "SCHEDULED";
  lesson.startsAt = new Date(lesson.startsAt.getTime() + 3600000);
  assert.equal(await trainerReminderIsCurrent(fake, delivery, now), false);
  lesson.startsAt = new Date(now.getTime() + REMINDER_WINDOWS[1].milliseconds - 60000);
  lesson.trainer.user.role = "ADMIN";
  assert.equal(await trainerReminderIsCurrent(fake, delivery, now), false);
  assert.equal(await trainerReminderIsCurrent(fake, { eventKey: "LESSON_BOOKED:safe" }, now), true);
});
