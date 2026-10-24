import { accessLock } from "../../db/client.js";
import { audit } from "../audit/service.js";
import { subscriptionBody, endpointBody } from "./schema.js";
const denied = () => Object.assign(new Error("FORBIDDEN"), { status: 403 });
export function pushSubscriptions(prisma) {
  async function mutate(ctx, callback) {
    return prisma.$transaction(async tx => {
      await accessLock(tx);
      const actor = await tx.user.findUnique({ where: { id: ctx.user.id } });
      if (!actor?.active || actor.authVersion !== ctx.user.authVersion || actor.role !== ctx.user.role ||
        !await tx.authSession.findFirst({ where: { sid: ctx.sessionId, userId: actor.id, authVersion: actor.authVersion, expire: { gt: new Date() }, absoluteAt: { gt: new Date() } } })) throw denied();
      return callback(tx, actor);
    });
  }
  return {
    async removeAll(ctx) {
      return mutate(ctx, async (tx, actor) => {
        const removed = await tx.pushSubscription.deleteMany({ where: { userId: actor.id } });
        if (removed.count) await audit(tx, "PUSH_ALL_REVOKED", { actorId: actor.id, requestId: ctx.requestId });
        return { ok: true };
      });
    },
    async register(ctx, input) {
      const data = subscriptionBody.parse(input);
      return mutate(ctx, async (tx, actor) => {
        const existing = await tx.pushSubscription.findUnique({ where: { endpoint: data.endpoint } });
        // No silent endpoint transfer between accounts on shared browsers.
        if (existing && existing.userId !== actor.id) throw denied();
        if (!existing && await tx.pushSubscription.count({ where: { userId: actor.id } }) >= 20)
          throw Object.assign(new Error("DEVICE_LIMIT"), { status: 409 });
        const identity = { userId: actor.id, role: actor.role, authVersion: actor.authVersion, p256dh: data.keys.p256dh, auth: data.keys.auth };
        if (existing) {
          // Key rotation invalidates already queued payloads for the previous subscription.
          if (existing.p256dh !== identity.p256dh || existing.auth !== identity.auth)
            await tx.pushDelivery.deleteMany({ where: { subscriptionId: existing.id } });
          await tx.pushSubscription.update({ where: { id: existing.id }, data: identity });
        } else {
          await tx.pushSubscription.create({ data: { endpoint: data.endpoint, ...identity } });
          await audit(tx, "PUSH_SUBSCRIBED", { actorId: actor.id, requestId: ctx.requestId });
        }
        return { ok: true };
      });
    },
    async remove(ctx, input) {
      const data = endpointBody.parse(input);
      return mutate(ctx, async (tx, actor) => {
        const existing = await tx.pushSubscription.findUnique({ where: { endpoint: data.endpoint } });
        if (existing && existing.userId !== actor.id) throw denied();
        if (existing) {
          await tx.pushSubscription.delete({ where: { id: existing.id } });
          await audit(tx, "PUSH_UNSUBSCRIBED", { actorId: actor.id, requestId: ctx.requestId });
        }
        return { ok: true };
      });
    },
  };
}
