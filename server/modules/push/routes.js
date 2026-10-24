import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { csrf } from "../../middleware/csrf.js";
import { endpointBody } from "./schema.js";
import { pushSubscriptions } from "./service.js";
export function pushRoutes({ config, prisma }) {
  const router = Router(), service = pushSubscriptions(prisma);
  const roles = requireRole("OWNER", "ADMIN", "TRAINER");
  const limit = rateLimit({ windowMs: 900000, limit: 60, keyGenerator: req => req.user.id, standardHeaders: "draft-8", legacyHeaders: false });
  const enabled = Boolean(config.PUSH_PUBLIC_KEY && config.PUSH_PRIVATE_KEY);
  const context = req => ({ user: req.user, sessionId: req.sessionID, requestId: req.id });
  router.get("/notifications", requireAuth, roles, (req, res) => res.render("push/panel", { user: req.user, csrf: req.session.csrf, enabled }));
  router.get("/api/push/config", requireAuth, roles, (req, res) => res.json({ enabled, publicKey: enabled ? config.PUSH_PUBLIC_KEY : null, userId: req.user.id }));
  router.post("/api/push/status", requireAuth, roles, limit, csrf(config), async (req, res) => {
    const data = endpointBody.parse(req.body);
    const sub = await prisma.pushSubscription.findFirst({ where: { endpoint: data.endpoint, userId: req.user.id, role: req.user.role, authVersion: req.user.authVersion }, select: { id: true } });
    res.json({ registered: Boolean(sub) });
  });
  router.post("/api/push/subscribe", requireAuth, roles, limit, csrf(config), async (req, res) => {
    if (!enabled) throw Object.assign(new Error("PUSH_DISABLED"), { status: 503 });
    res.json(await service.register(context(req), req.body));
  });
  router.post("/api/push/unsubscribe", requireAuth, roles, limit, csrf(config), async (req, res) => res.json(await service.remove(context(req), req.body)));
  router.post("/notifications/revoke", requireAuth, roles, limit, csrf(config), async (req, res) => {
    // An emergency server-side revoke remains available with JavaScript disabled.
    z.object({ _csrf: z.string() }).strict().parse(req.body);
    await service.removeAll(context(req));
    res.redirect(303, "/notifications");
  });
  return router;
}
