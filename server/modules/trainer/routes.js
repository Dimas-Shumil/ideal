import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";

// CRM client routes are mounted independently before this account/schedule shell.
export function renderTrainer(req, res, page, error = null) {
  const { login, displayName, role } = req.user;
  return res.render("trainer/panel", {
    page, user: { login, displayName, role }, csrf: req.session.csrf, error,
  });
}
export function trainerRoutes() {
  const router = Router();
  router.use(["/trainer", "/api/trainer"], requireAuth, requireRole("TRAINER"));
  for (const [path, page] of [
    ["/trainer", "overview"],
    ["/trainer/lessons", "lessons"], ["/trainer/account", "account"],
  ]) router.get(path, (req, res) => renderTrainer(req, res, page));
  return router;
}
