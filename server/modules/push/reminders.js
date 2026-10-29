import { clubParts } from "../schedule/dates.js";

// Only personal lessons with an active client booking should remind their trainer.
// We intentionally do not notify for empty slots or cancelled appointments.
export const REMINDER_WINDOWS = Object.freeze([
  { code: "24H", milliseconds: 24 * 60 * 60 * 1000, label: "сутки" },
  { code: "3H", milliseconds: 3 * 60 * 60 * 1000, label: "3 часа" },
]);

// The worker checks every 15 seconds. A short grace period tolerates restarts,
// while preventing stale reminders after a prolonged outage.
export const REMINDER_GRACE_MS = 10 * 60 * 1000;
const keyPrefix = "TRAINER_REMINDER_";
const keyPattern = /^TRAINER_REMINDER_(24H|3H):([0-9a-f-]{36}):(\d{13})$/;

export function reminderKey(lessonId, startsAt, code) {
  return `${keyPrefix}${code}:${lessonId}:${startsAt.getTime()}`;
}

export function reminderDue(startsAt, offsetMs, now = new Date()) {
  const timeLeft = startsAt.getTime() - now.getTime();
  return timeLeft <= offsetMs && timeLeft >= offsetMs - REMINDER_GRACE_MS;
}

// Idempotent across overlapping worker ticks/processes: the existing
// PushDelivery(eventKey, subscriptionId) unique index is the deduplication key.
export async function enqueueTrainerReminders(prisma, now = new Date()) {
  let queued = 0;
  for (const window of REMINDER_WINDOWS) {
    const startMin = new Date(now.getTime() + window.milliseconds - REMINDER_GRACE_MS);
    const startMax = new Date(now.getTime() + window.milliseconds);
    let cursor;
    for (;;) {
      const lessons = await prisma.lesson.findMany({
        where: {
          kind: "PERSONAL", status: "SCHEDULED",
          startsAt: { gte: startMin, lte: startMax },
          bookings: { some: { status: "BOOKED" } },
          trainer: { user: { active: true, role: "TRAINER" } },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 200,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true, startsAt: true,
          trainer: { select: { user: { select: { id: true, role: true, authVersion: true } } } },
        },
      });
      if (!lessons.length) break;
      for (const lesson of lessons) {
        const user = lesson.trainer.user;
        const subscriptions = await prisma.pushSubscription.findMany({
          where: { userId: user.id, role: "TRAINER", authVersion: user.authVersion },
          select: { id: true },
        });
        if (!subscriptions.length) continue;
        const local = clubParts(lesson.startsAt);
        const eventKey = reminderKey(lesson.id, lesson.startsAt, window.code);
        const payload = {
          title: window.code === "24H" ? "Завтра персональная тренировка" : "Скоро персональная тренировка",
          body: `Через ${window.label}: ${local.date} в ${local.time}. Откройте расписание в кабинете.`,
          url: "/trainer/lessons",
        };
        const result = await prisma.pushDelivery.createMany({
          data: subscriptions.map(sub => ({
            eventKey, subscriptionId: sub.id, userId: user.id,
            role: "TRAINER", authVersion: user.authVersion, payload,
          })),
          skipDuplicates: true,
        });
        queued += result.count;
      }
      cursor = lessons.at(-1).id;
      if (lessons.length < 200) break;
    }
  }
  return queued;
}

// Revalidate at send time: cancelling, removing the booking, moving the lesson,
// deactivating/reassigning the trainer or missing the time window all suppress
// an already queued reminder. Ordinary event notifications are not affected.
export async function trainerReminderIsCurrent(prisma, delivery, now = new Date()) {
  if (!delivery.eventKey.startsWith(keyPrefix)) return true;
  const match = keyPattern.exec(delivery.eventKey);
  if (!match) return false;
  const [, code, lessonId, startsAtMs] = match;
  const window = REMINDER_WINDOWS.find(item => item.code === code);
  if (!window) return false;
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      kind: true, status: true, startsAt: true,
      trainer: { select: { user: { select: { id: true, role: true, active: true, authVersion: true } } } },
      bookings: { where: { status: "BOOKED" }, take: 1, select: { id: true } },
    },
  });
  return !!lesson && lesson.kind === "PERSONAL" && lesson.status === "SCHEDULED" &&
    lesson.startsAt.getTime() === Number(startsAtMs) &&
    lesson.trainer.user.id === delivery.userId && lesson.trainer.user.active &&
    lesson.trainer.user.role === "TRAINER" &&
    lesson.trainer.user.authVersion === delivery.authVersion &&
    lesson.bookings.length > 0 && reminderDue(lesson.startsAt, window.milliseconds, now);
}
