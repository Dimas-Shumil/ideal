import { createHash } from 'node:crypto';
import { z } from 'zod';
import { accessLock } from '../../db/client.js';
const uuid = z.string().uuid();
const fail = (status, message) => Object.assign(new Error(message), { status });
export const gallerySelect = { id: true, caption: true, createdAt: true };
export function galleryService(prisma) {
  const scope = ctx => ({ userId: ctx.actorId, user: { active: true, role: 'TRAINER', authVersion: ctx.authVersion } });
  async function profile(db, ctx) {
    const p = await db.trainerProfile.findFirst({ where: scope(ctx), select: { id: true, publicKey: true, publicName: true, publicVisible: true } });
    if (!p) throw fail(404, 'Публичный профиль ещё не подготовлен. Обратитесь к администратору клуба.');
    return p;
  }
  async function mutate(ctx, action, photoId, input, callback) {
    uuid.parse(ctx.key);
    if (photoId) uuid.parse(photoId);
    const fingerprint = createHash('sha256').update(JSON.stringify({ action, photoId, input })).digest('hex');
    return prisma.$transaction(async tx => {
      await accessLock(tx);
      const p = await profile(tx, ctx);
      const session = ctx.sessionId && await tx.authSession.findFirst({ where: { sid: ctx.sessionId, userId: ctx.actorId, authVersion: ctx.authVersion, expire: { gt: new Date() }, absoluteAt: { gt: new Date() } } });
      if (!session) throw fail(403, 'Доступ запрещён.');
      const old = await tx.crmOperation.findUnique({ where: { actorId_key: { actorId: ctx.actorId, key: ctx.key } } });
      if (old) {
        if (old.fingerprint !== fingerprint) throw fail(409, 'Эта форма уже использована. Обновите страницу.');
        return old.result;
      }
      const result = await callback(tx, p);
      await tx.crmOperation.create({ data: { actorId: ctx.actorId, key: ctx.key, fingerprint, result } });
      await tx.auditEvent.create({ data: { actorId: ctx.actorId, action, targetId: result.id, requestId: ctx.requestId } });
      return result;
    }, { maxWait: 10000, timeout: 15000 });
  }
  return {
    async list(ctx) {
      const p = await profile(prisma, ctx);
      return { profile: p, photos: await prisma.trainerGalleryPhoto.findMany({ where: { trainerId: p.id }, select: gallerySelect, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }) };
    },
    async image(ctx, id) {
      uuid.parse(id);
      const p = await profile(prisma, ctx);
      const photo = await prisma.trainerGalleryPhoto.findFirst({ where: { id, trainerId: p.id }, select: { data: true } });
      if (!photo) throw fail(404, 'Фотография не найдена.');
      return photo.data;
    },
    add(ctx, data) {
      const digest = createHash('sha256').update(data).digest('hex');
      return mutate(ctx, 'TRAINER_GALLERY_ADD', null, { digest }, async (tx, p) => {
        if (await tx.trainerGalleryPhoto.count({ where: { trainerId: p.id } }) >= 20) throw fail(409, 'Можно добавить до 20 фотографий. Удалите ненужный снимок.');
        const row = await tx.trainerGalleryPhoto.create({ data: { trainerId: p.id, data } });
        return { id: row.id };
      });
    },
    change(ctx, id, action, input) {
      const data = action === 'caption' ? z.object({ caption: z.string().trim().max(300) }).strict().parse(input) : z.object({ confirm: z.literal('DELETE') }).strict().parse(input);
      return mutate(ctx, action === 'caption' ? 'TRAINER_GALLERY_CAPTION' : 'TRAINER_GALLERY_DELETE', id, data, async (tx, p) => {
        const where = { id, trainerId: p.id };
        const result = action === 'caption' ? await tx.trainerGalleryPhoto.updateMany({ where, data }) : await tx.trainerGalleryPhoto.deleteMany({ where });
        if (!result.count) throw fail(404, 'Фотография не найдена.');
        return { id };
      });
    },
  };
}
