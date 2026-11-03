import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";

// CRM client routes are mounted independently before this schedule shell.
export function renderTrainer(req, res, page, error = null) {
  const { login, displayName, role } = req.user;
  return res.render("trainer/panel", {
    page, user: { login, displayName, role }, csrf: req.session.csrf, error,
  });
}
export function trainerRoutes() {
  const router = Router();
  router.use(["/trainer", "/api/trainer"], requireAuth, requireRole("TRAINER"));
  router.all(["/trainer/account", "/trainer/account/password"], (_req, _res, next) =>
    next(Object.assign(new Error("FORBIDDEN"), { status: 403 })));
  for (const [path, page] of [
    ["/trainer", "overview"],
  ]) router.get(path, (req, res) => renderTrainer(req, res, page));
  return router;
}
