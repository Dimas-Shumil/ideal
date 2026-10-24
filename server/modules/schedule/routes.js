import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { csrf } from "../../middleware/csrf.js";
import { today } from "../crm/dates.js";
import { clubParts } from "./dates.js";
import { operation, uuid } from "./schema.js";
import { scheduleService } from "./service.js";

export function scheduleRoutes({ config, prisma }) {
  const router = Router();
  const service = scheduleService(prisma);
  const guard = csrf(config);
  const limit = rateLimit({
    windowMs: 900000,
    limit: 160,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const render = (req, res, page, data = {}) => {
    const now = clubParts(new Date());
    return res.render("schedule/panel", {
      page,
      user: req.user,
      csrf: req.session.csrf,
      newKey: randomUUID,
      today: today(),
      nowTime: now.time,
      club: clubParts,
      ...data,
    });
  };
  const context = (req, meta) => ({
    actorId: req.user.id,
    authVersion: req.user.authVersion,
    sessionId: req.sessionID,
    requestId: req.id,
    ...meta,
  });
  const post = (paths, roles, callback, redirect) => {
    router.post(
      paths,
      requireAuth,
      requireRole(...roles),
      limit,
      guard,
      async (req, res, next) => {
        try {
          const { _csrf, key, version, ...input } = req.body || {};
          const meta = operation.parse({ _csrf, key, version });
          const result = await callback(req, context(req, meta), input);
          if (req.path.startsWith("/api/")) return res.json({ ok: true, ...result });
          return res.redirect(303, redirect(req, result));
        } catch (error) {
          if (req.path.startsWith("/api/")) return next(error);
          if (!(error.name === "ZodError" || [400, 404, 409].includes(error.status))) return next(error);
          const message = error.name === "ZodError" ? "Проверьте обязательные поля, даты, время и выбранные значения." : error.message;
          const trainer = req.user.role === "TRAINER";
          return render(req, res.status(error.status || 400), "error", {
            error: message,
            back: trainer ? "/trainer/lessons" : "/crm/schedule",
          });
        }
      },
    );
  };

  router.get(["/crm/schedule", "/api/crm/schedule"], requireAuth, requireRole("OWNER", "ADMIN"), async (req, res) => {
    const data = await service.list(req.user, req.query);
    if (req.path.startsWith("/api/")) return res.json(data);
    return render(req, res, "list", { ...data, trainers: await service.trainers() });
  });
  router.get("/crm/schedule/new", requireAuth, requireRole("OWNER", "ADMIN"), async (req, res) =>
    render(req, res, "new", { trainers: await service.trainers() }),
  );
  router.get(["/crm/schedule/:id", "/api/crm/schedule/:id"], requireAuth, requireRole("OWNER", "ADMIN"), async (req, res) => {
    const data = await service.get(req.user, req.params.id, req.query);
    if (req.path.startsWith("/api/")) return res.json(data);
    return render(req, res, "detail", data);
  });
  router.get(["/crm/visits", "/api/crm/visits"], requireAuth, requireRole("OWNER", "ADMIN"), async (req, res) => {
    const data = await service.recentVisits(req.user, req.query);
    if (req.path.startsWith("/api/")) return res.json(data);
    const clients = await prisma.client.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 200 });
    return render(req, res, "visits", { ...data, clients });
  });

  router.get(["/trainer/lessons", "/api/trainer/lessons"], requireAuth, requireRole("TRAINER"), async (req, res) => {
    const data = await service.list(req.user, req.query);
    if (req.path.startsWith("/api/")) return res.json(data);
    return render(req, res, "list", { ...data, trainers: [] });
  });
  router.get(["/trainer/lessons/:id", "/api/trainer/lessons/:id"], requireAuth, requireRole("TRAINER"), async (req, res) => {
    const data = await service.get(req.user, req.params.id, req.query);
    if (req.path.startsWith("/api/")) return res.json(data);
    return render(req, res, "detail", data);
  });

  post(["/crm/schedule", "/api/crm/schedule"], ["OWNER", "ADMIN"], (_req, ctx, input) => service.create(ctx, input), (_req, result) => `/crm/schedule/${result.id}`);
  post(["/crm/schedule/:id/move", "/api/crm/schedule/:id/move"], ["OWNER", "ADMIN"], (req, ctx, input) => service.move(ctx, req.params.id, input), (req) => `/crm/schedule/${uuid.parse(req.params.id)}`);
  post(["/crm/schedule/:id/cancel", "/api/crm/schedule/:id/cancel"], ["OWNER", "ADMIN"], (req, ctx, input) => service.cancelLesson(ctx, req.params.id, input), (req) => `/crm/schedule/${uuid.parse(req.params.id)}`);
  post(["/crm/schedule/:id/book", "/api/crm/schedule/:id/book"], ["OWNER", "ADMIN"], (req, ctx, input) => service.book(ctx, req.params.id, input), (req) => `/crm/schedule/${uuid.parse(req.params.id)}`);
  post(["/trainer/lessons/:id/book", "/api/trainer/lessons/:id/book"], ["TRAINER"], (req, ctx, input) => service.book(ctx, req.params.id, input), (req) => `/trainer/lessons/${uuid.parse(req.params.id)}`);
  post(["/crm/schedule/:id/bookings/:bookingId/cancel", "/api/crm/schedule/:id/bookings/:bookingId/cancel"], ["OWNER", "ADMIN"], (req, ctx, input) => service.cancelBooking(ctx, req.params.id, req.params.bookingId, input), (req) => `/crm/schedule/${uuid.parse(req.params.id)}`);
  post(["/trainer/lessons/:id/bookings/:bookingId/cancel", "/api/trainer/lessons/:id/bookings/:bookingId/cancel"], ["TRAINER"], (req, ctx, input) => service.cancelBooking(ctx, req.params.id, req.params.bookingId, input), (req) => `/trainer/lessons/${uuid.parse(req.params.id)}`);
  post(["/crm/schedule/:id/bookings/:bookingId/attendance", "/api/crm/schedule/:id/bookings/:bookingId/attendance"], ["OWNER", "ADMIN"], (req, ctx, input) => service.attendance(ctx, req.params.id, req.params.bookingId, input), (req) => `/crm/schedule/${uuid.parse(req.params.id)}`);
  post(["/trainer/lessons/:id/bookings/:bookingId/attendance", "/api/trainer/lessons/:id/bookings/:bookingId/attendance"], ["TRAINER"], (req, ctx, input) => service.attendance(ctx, req.params.id, req.params.bookingId, input), (req) => `/trainer/lessons/${uuid.parse(req.params.id)}`);
  post(["/crm/visits/gym", "/api/crm/visits/gym"], ["OWNER", "ADMIN"], (_req, ctx, input) => service.gymVisit(ctx, input), () => "/crm/visits");
  post(["/crm/visits/:visitId/reverse", "/api/crm/visits/:visitId/reverse"], ["OWNER", "ADMIN"], (req, ctx, input) => service.reverseVisit(ctx, req.params.visitId, input), (_req, result) => result.id === result.visitId ? "/crm/visits" : `/crm/schedule/${result.id}`);
  post(["/trainer/visits/:visitId/reverse", "/api/trainer/visits/:visitId/reverse"], ["TRAINER"], (req, ctx, input) => service.reverseVisit(ctx, req.params.visitId, input), (_req, result) => `/trainer/lessons/${result.id}`);

  return router;
}
