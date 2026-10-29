import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { csrf } from "../../middleware/csrf.js";
import { parseImage, normalizeImage } from "../shop/images.js";
import { trainerProfileService, fail } from "./service.js";
import { profileOperation, trainerFields } from "./schema.js";
export function trainerManagementRoutes({ config, prisma }) {
  const router = Router(),
    service = trainerProfileService(prisma),
    guard = csrf(config);
  router.use("/admin/public-trainers", requireAuth, requireRole("OWNER"));
  const limit = rateLimit({
    windowMs: 900000,
    limit: 100,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const render = (req, res, data) =>
    res.render("trainers/panel", {
      user: req.user,
      csrf: req.session.csrf,
      newKey: randomUUID,
      fields: trainerFields,
      ...data,
    });
  router.get("/admin/public-trainers", async (req, res) =>
    render(req, res, { page: "list", items: await service.list() }),
  );
  router.get("/admin/public-trainers/:id", async (req, res) =>
    render(req, res, {
      page: "edit",
      profile: await service.get(req.params.id),
    }),
  );
  router.get("/admin/public-trainers/:id/photo", async (req, res) => {
    const p = await service.get(req.params.id);
    const photo = await prisma.trainerPhoto.findUnique({
      where: { trainerId: p.id },
      select: { data: true },
    });
    if (!photo) throw fail(404, "Фотография не найдена.");
    res.type("image/webp").send(Buffer.from(photo.data));
  });
  const context = (req, meta) => ({
    ...meta,
    actorId: req.user.id,
    authVersion: req.user.authVersion,
    sessionId: req.sessionID,
    requestId: req.id,
  });
  for (const action of ["create", "save", "publish", "photo", "delete-photo"]) {
    const upload = action === "photo";
    router.post(
      "/admin/public-trainers/:id/" + action,
      limit,
      ...(upload
        ? [
            (req, res, next) =>
              req.get("Origin") === config.APP_ORIGIN
                ? next()
                : next(fail(403, "Доступ запрещён.")),
            parseImage,
          ]
        : []),
      guard,
      async (req, res, next) => {
        try {
          const { _csrf, key, version, ...input } = req.body || {};
          const meta = profileOperation.parse({ _csrf, key, version });
          const ctx = context(req, meta);
          let result;
          if (upload) {
            if (Object.keys(input).length) throw fail(400, "Неизвестные поля.");
            result = await service.photo(
              ctx,
              req.params.id,
              await normalizeImage(req.shopImage),
            );
          } else
            result = await service[
              action === "delete-photo" ? "deletePhoto" : action
            ](ctx, req.params.id, input);
          res.redirect(303, "/admin/public-trainers/" + result.id);
        } catch (error) {
          if (error.name === "ZodError" || [400, 409].includes(error.status))
            return render(req, res.status(error.status || 400), {
              page: "error",
              message:
                error.name === "ZodError"
                  ? "Проверьте поля и подтверждение. Данные не сохранены."
                  : error.message,
            });
          next(error);
        }
      },
    );
  }
  return router;
}
