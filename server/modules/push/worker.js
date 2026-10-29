import { createHash } from "node:crypto";
import { allowedEndpoint } from "./schema.js";
import { enqueueTrainerReminders, trainerReminderIsCurrent } from "./reminders.js";
export const retryDelay = attempts => Math.min(3600000, 30000 * 2 ** (attempts - 1));
// DB lease supports restarts and multiple processes. Network calls run outside transactions.
export function pushWorker({ prisma, config, send, log = entry => console.error(JSON.stringify(entry)) }) {
  let pending = null, timer, stopped = false;
  async function processBatch() {
    if (!config.PUSH_PUBLIC_KEY || !config.PUSH_PRIVATE_KEY) return;
    await enqueueTrainerReminders(prisma);
    await prisma.pushDelivery.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) } } });
    for (let i = 0; i < 25 && !stopped; i++) {
      const lease = new Date(Date.now() + 120000);
      const rows = await prisma.$queryRaw`
        UPDATE "PushDelivery" SET "status"='SENDING', "attempts"="attempts"+1, "availableAt"=${lease}
        WHERE "id"=(SELECT "id" FROM "PushDelivery" WHERE
          (("status"='PENDING' AND "availableAt"<=now()) OR ("status"='SENDING' AND "availableAt"<=now()))
          AND "attempts"<5 ORDER BY "availableAt","id" FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING "id"`;
      if (!rows.length) break;
      const delivery = await prisma.pushDelivery.findUnique({ where: { id: rows[0].id }, include: { subscription: { include: { user: true } } } });
      if (!delivery) continue;
      const sub = delivery.subscription, user = sub.user;
      const where = { id: delivery.id, status: "SENDING", attempts: delivery.attempts };
      const finish = data => prisma.pushDelivery.updateMany({ where, data });
      if (!user.active || user.authVersion !== delivery.authVersion || user.role !== delivery.role ||
          sub.authVersion !== user.authVersion || sub.role !== user.role || !allowedEndpoint(sub.endpoint) ||
          delivery.createdAt < new Date(Date.now() - 86400000) ||
          !await trainerReminderIsCurrent(prisma, delivery)) {
        await finish({ status: "SKIPPED" }); continue;
      }
      try {
        await send({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(delivery.payload), {
          TTL: 300, timeout: 10000, urgency: "normal",
          topic: createHash("sha256").update(delivery.eventKey).digest("base64url").slice(0,32),
          vapidDetails: { subject: config.PUSH_SUBJECT, publicKey: config.PUSH_PUBLIC_KEY, privateKey: config.PUSH_PRIVATE_KEY },
        });
        await finish({ status: "SENT", lastStatus: 201 });
        await prisma.pushSubscription.updateMany({ where: { id: sub.id }, data: { lastSuccessAt: new Date() } });
      } catch (error) {
        const status = Number.isInteger(error.statusCode) ? error.statusCode : 0;
        // Never log provider error objects, endpoints, keys, payloads, or response bodies.
        log({ event: "PUSH_DELIVERY_FAILED", status });
        if ([404, 410].includes(status)) {
          await prisma.pushSubscription.deleteMany({ where: { id: sub.id, updatedAt: sub.updatedAt } });
          await finish({ status: "FAILED", lastStatus: status });
        } else {
          await prisma.pushSubscription.updateMany({ where: { id: sub.id }, data: { lastFailureAt: new Date() } });
          const retry = delivery.attempts < 5 && (!status || status === 429 || status >= 500);
          await finish({ status: retry ? "PENDING" : "FAILED", lastStatus: status, availableAt: new Date(Date.now() + retryDelay(delivery.attempts)) });
        }
      }
    }
    // A process killed on its fifth attempt must not leave a permanent SENDING row.
    await prisma.pushDelivery.updateMany({ where: { status: "SENDING", attempts: { gte: 5 }, availableAt: { lte: new Date() } }, data: { status: "FAILED" } });
  }
  function tick() {
    if (pending) return pending;
    pending = processBatch().catch(() => log({ event: "PUSH_WORKER_FAILED" })).finally(() => { pending = null; });
    return pending;
  }
  return { tick, start() { timer = setInterval(tick, 15000); timer.unref(); void tick(); }, async stop() { stopped = true; clearInterval(timer); await pending; } };
}
