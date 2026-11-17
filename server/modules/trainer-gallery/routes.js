import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { csrf } from '../../middleware/csrf.js';
import { parseImage, normalizeImage } from '../shop/images.js';
import { galleryService } from './service.js';
export function trainerGalleryRoutes({ config, prisma }) {
  const r = Router(), service = galleryService(prisma), base = '/trainer/gallery';
  r.use(base, requireAuth, requireRole('TRAINER'));
  const ctx = req => ({ actorId: req.user.id, authVersion: req.user.authVersion, sessionId: req.sessionID, requestId: req.id, key: req.body?.key });
  const render = (req, res, data) => res.render('trainers/gallery', { user: req.user, csrf: req.session.csrf, newKey: randomUUID, error: null, profile: null, photos: [], ...data });
  const limit = rateLimit({ windowMs: 900000, limit: 100, keyGenerator: req => req.user.id, standardHeaders: 'draft-8', legacyHeaders: false });
  r.get(base, async (req, res) => render(req, res, await service.list(ctx(req))));
  r.get(base + '/:id/image', async (req, res) => res.type('image/webp').send(Buffer.from(await service.image(ctx(req), req.params.id))));
  const origin = (req, res, next) => req.get('Origin') === config.APP_ORIGIN ? next() : next(Object.assign(new Error('Доступ запрещён.'), { status: 403 }));
  r.post(base + '/upload', limit, origin, parseImage, csrf(config), async (req, res) => {
    z.object({ _csrf: z.string(), key: z.string().uuid() }).strict().parse(req.body);
    await service.add(ctx(req), await normalizeImage(req.shopImage));
    res.redirect(303, base);
  });
  for (const action of ['caption', 'delete']) r.post(base + '/:id/' + action, limit, csrf(config), async (req, res) => {
    const { _csrf, key, ...input } = req.body || {};
    await service.change(ctx(req), req.params.id, action, input);
    res.redirect(303, base);
  });
  r.use(base, (error, req, res, next) => {
    const status = error.name === 'ZodError' ? 400 : error.status;
    if (![400, 403, 404, 409, 413, 429].includes(status)) return next(error);
    render(req, res.status(status), { error: error.name === 'ZodError' ? 'Проверьте подпись и форму. Обновите страницу и повторите попытку.' : error.message });
  });
  return r;
}
