import { createHash } from "node:crypto";
import { z } from "zod";
import { accessLock } from "../../db/client.js";
import { audit } from "../audit/service.js";
import { profileBody, publishBody, photoDeleteBody } from "./schema.js";
const uuid = z.string().uuid();
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
export const ownerProfileSelect = {
  id: true,
  userId: true,
  publicKey: true,
  publicName: true,
  publicVersion: true,
  publicVisible: true,
  publicOrder: true,
  specialty: true,
  summary: true,
  biography: true,
  experience: true,
  qualification: true,
  approach: true,
  directions: true,
  achievements: true,
  photo: { select: { trainerId: true } },
  user: { select: { displayName: true, role: true, active: true } },
};
export function trainerProfileService(prisma) {
  async function mutate(ctx, id, action, input, callback) {
    uuid.parse(ctx.key);
    uuid.parse(id);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ id, action, input, version: ctx.version }))
      .digest("hex");
    return prisma.$transaction(
      async (tx) => {
        await accessLock(tx);
        const actor = await tx.user.findUnique({ where: { id: ctx.actorId } });
        if (
          !actor?.active ||
          actor.role !== "OWNER" ||
          actor.authVersion !== ctx.authVersion ||
          !ctx.sessionId ||
          !(await tx.authSession.findFirst({
            where: {
              sid: ctx.sessionId,
              userId: actor.id,
              authVersion: actor.authVersion,
              expire: { gt: new Date() },
              absoluteAt: { gt: new Date() },
            },
          }))
        )
          throw fail(403, "Доступ запрещён.");
        const previous = await tx.crmOperation.findUnique({
          where: { actorId_key: { actorId: actor.id, key: ctx.key } },
        });
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw fail(409, "Эта форма уже использована.");
          return previous.result;
        }
        const result = await callback(tx);
        await tx.crmOperation.create({
          data: { actorId: actor.id, key: ctx.key, fingerprint, result },
        });
        await audit(tx, action, {
          actorId: actor.id,
          targetId: result.id,
          requestId: ctx.requestId,
        });
        return result;
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async function current(tx, id, version) {
    const p = await tx.trainerProfile.findUnique({
      where: { id },
      select: ownerProfileSelect,
    });
    if (!p) throw fail(404, "Профиль не найден.");
    if (p.publicVersion !== version)
      throw fail(409, "Профиль изменён. Обновите страницу.");
    return p;
  }
  return {
    async list() {
      return prisma.user.findMany({
        where: {
          OR: [{ role: "TRAINER" }, { trainerProfile: { isNot: null } }],
        },
        select: {
          id: true,
          displayName: true,
          active: true,
          role: true,
          trainerProfile: { select: ownerProfileSelect },
        },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      });
    },
    async get(id) {
      uuid.parse(id);
      const p = await prisma.trainerProfile.findUnique({
        where: { id },
        select: ownerProfileSelect,
      });
      if (!p) throw fail(404, "Профиль не найден.");
      return p;
    },
    async create(ctx, userId, input) {
      z.object({}).strict().parse(input);
      return mutate(ctx, userId, "TRAINER_PROFILE_CREATE", {}, async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { active: true, role: true },
        });
        if (!user?.active || user.role !== "TRAINER")
          throw fail(409, "Нужен активный сотрудник TRAINER.");
        const p = await tx.trainerProfile.upsert({
          where: { userId },
          create: { userId },
          update: {},
        });
        return { id: p.id };
      });
    },
    async save(ctx, id, input) {
      const data = profileBody.parse(input);
      return mutate(ctx, id, "TRAINER_PROFILE_SAVE", data, async (tx) => {
        await current(tx, id, ctx.version);
        await tx.trainerProfile.update({
          where: { id },
          data: { ...data, publicVersion: { increment: 1 } },
        });
        return { id };
      });
    },
    async publish(ctx, id, input) {
      const data = publishBody.parse(input);
      return mutate(ctx, id, "TRAINER_PROFILE_PUBLISH", data, async (tx) => {
        const p = await current(tx, id, ctx.version);
        if (
          data.visible === "true" &&
          (!p.publicName.trim() || !p.user.active || p.user.role !== "TRAINER")
        )
          throw fail(
            409,
            "Для публикации нужны публичное имя и активный TRAINER.",
          );
        await tx.trainerProfile.update({
          where: { id },
          data: {
            publicVisible: data.visible === "true",
            publicVersion: { increment: 1 },
          },
        });
        return { id };
      });
    },
    async photo(ctx, id, bytes) {
      const digest = createHash("sha256").update(bytes).digest("hex");
      return mutate(ctx, id, "TRAINER_PHOTO_SAVE", { digest }, async (tx) => {
        await current(tx, id, ctx.version);
        await tx.trainerPhoto.upsert({
          where: { trainerId: id },
          create: { trainerId: id, data: bytes },
          update: { data: bytes },
        });
        await tx.trainerProfile.update({
          where: { id },
          data: { publicVersion: { increment: 1 } },
        });
        return { id };
      });
    },
    async deletePhoto(ctx, id, input) {
      const data = photoDeleteBody.parse(input);
      return mutate(ctx, id, "TRAINER_PHOTO_DELETE", data, async (tx) => {
        await current(tx, id, ctx.version);
        await tx.trainerPhoto.deleteMany({ where: { trainerId: id } });
        await tx.trainerProfile.update({
          where: { id },
          data: { publicVersion: { increment: 1 } },
        });
        return { id };
      });
    },
  };
}
