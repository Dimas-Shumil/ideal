import { clubParts } from "../schedule/dates.js";
const titles = {
  LESSON_BOOKED: "Новая запись на тренировку",
  BOOKING_CANCELLED: "Запись на тренировку отменена",
  LESSON_CANCELLED: "Занятие отменено",
  LESSON_MOVED: "Время занятия изменено",
};
// Called inside the existing business transaction, only on its first execution.
export async function enqueueSchedulePush(tx, ctx, action, lessonId, attention = false) {
  if (!titles[action]) return;
  const lesson = await tx.lesson.findUnique({ where: { id: lessonId }, include: { trainer: { include: { user: true } } } });
  const trainer = lesson.trainer.user;
  const recipients = [];
  if (trainer.active && trainer.role === "TRAINER") recipients.push(trainer);
  if (attention && ["LESSON_CANCELLED", "LESSON_MOVED"].includes(action))
    recipients.push(...await tx.user.findMany({ where: { active: true, role: { in: ["OWNER", "ADMIN"] }, id: { not: ctx.actorId } } }));
  const local = clubParts(lesson.startsAt);
  for (const user of recipients) {
    const payload = {
      title: titles[action],
      body: `Занятие ${local.date} в ${local.time}. Подробности в кабинете.`,
      url: user.role === "TRAINER" ? "/trainer/lessons" : "/crm/schedule",
      tag: `${action}:${ctx.key}`,
    };
    const subscriptions = await tx.pushSubscription.findMany({ where: { userId: user.id, authVersion: user.authVersion, role: user.role } });
    for (const sub of subscriptions)
      await tx.pushDelivery.create({ data: {
        eventKey: `${ctx.actorId}:${ctx.key}:${action}`, subscriptionId: sub.id,
        userId: user.id, authVersion: user.authVersion, role: user.role, payload,
      } });
  }
}
