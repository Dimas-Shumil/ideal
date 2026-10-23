import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { createHmac } from "node:crypto";
import { loginBody, password } from "./schema.js";
import { hashPassword, verifyPassword } from "./password.js";
import { newCsrf, csrf } from "../../middleware/csrf.js";
import { renderTrainer } from "../trainer/routes.js";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { audit } from "../audit/service.js";
const save = (req) =>
  new Promise((ok, no) => req.session.save((e) => (e ? no(e) : ok())));
const regenerate = (req) =>
  new Promise((ok, no) => req.session.regenerate((e) => (e ? no(e) : ok())));
export async function authRoutes({ prisma, store, config, users }) {
  const router = Router();
  // Equal Argon work for nonexistent/inactive accounts; random hash is never a password seed.
  const dummy = await hashPassword(newCsrf());
  const guard = csrf(config);
  const limit = (max, keyGenerator) =>
    rateLimit({
      windowMs: 900000,
      limit: max,
      keyGenerator,
      skipSuccessfulRequests: true,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res) =>
        res.status(429).send("Слишком много попыток. Повторите позже."),
    });
  router.get(
    "/login",
    limit(60, (req) => ipKeyGenerator(req.ip)),
    async (req, res) => {
      if (req.user) return res.redirect(303, home(req.user.role));
      if (!req.session.csrf) {
        req.session.preAuthAt = Date.now();
        req.session.csrf = newCsrf();
        req.session.cookie.maxAge = 900000;
      }
      res.render("auth/login", { csrf: req.session.csrf, error: null });
    },
  );
  const attemptIp = limit(30, (req) => ipKeyGenerator(req.ip));
  const attemptLogin = limit(10, (req) =>
    createHmac("sha256", config.SESSION_SECRET)
      .update(
        typeof req.body?.login === "string"
          ? req.body.login.trim().toLowerCase().slice(0, 256)
          : "",
      )
      .digest("hex"),
  );
  router.post(
    ["/login", "/api/auth/login"],
    attemptIp,
    attemptLogin,
    guard,
    async (req, res) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).render("auth/login", {
          csrf: req.session.csrf,
          error: "Проверьте логин и пароль.",
        });
      const user = await prisma.user.findUnique({
        where: { login: parsed.data.login },
      });
      const valid = await verifyPassword(
        user?.passwordHash || dummy,
        parsed.data.password,
      );
      if (!valid || !user?.active) {
        await audit(prisma, "LOGIN_FAILED", { requestId: req.id });
        return res.status(401).render("auth/login", {
          csrf: req.session.csrf,
          error: "Неверный логин или пароль.",
        });
      }
      await regenerate(req);
      req.session.userId = user.id;
      req.session.authVersion = user.authVersion;
      req.session.csrf = newCsrf();
      req.session.cookie.maxAge = config.idleMs;
      await store.establish(req.sessionID, req.session, user, req.id);
      await save(req);
      if (req.path.startsWith("/api/"))
        return res.json({ ok: true, redirect: home(user.role) });
      res.redirect(303, home(user.role));
    },
  );
  router.get("/api/auth/me", requireAuth, (req, res) =>
    res.json({
      user: {
        id: req.user.id,
        login: req.user.login,
        displayName: req.user.displayName,
        role: req.user.role,
      },
      csrf: req.session.csrf,
    }),
  );
  router.post(
    ["/logout", "/api/auth/logout"],
    requireAuth,
    guard,
    async (req, res) => {
      // Atomic audit + deletion; no successful logout when the store is unavailable.
      await prisma.$transaction(async (tx) => {
        await tx.authSession.deleteMany({
          where: { sid: req.sessionID, userId: req.user.id },
        });
        await audit(tx, "LOGOUT", { actorId: req.user.id, requestId: req.id });
      });
      await new Promise((ok, no) =>
        req.session.destroy((e) => (e ? no(e) : ok())),
      );
      res.clearCookie(config.cookieName, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.production,
      });
      if (req.path.startsWith("/api/")) return res.json({ ok: true });
      res.redirect(303, "/login");
    },
  );
  router.post("/trainer/account/password", requireAuth, requireRole("TRAINER"));
  router.post("/admin/account/password", requireAuth, requireRole("OWNER"));
  router.post(
    ["/api/auth/password", "/admin/account/password", "/trainer/account/password"],
    requireAuth,
    limit(5, (req) => req.user.id),
    guard,
    async (req, res) => {
      const invalid = () => {
        const error = "Проверьте текущий пароль и новый пароль: 12–128 символов, до 256 байт.";
        if (req.path === "/trainer/account/password")
          return renderTrainer(req, res.status(400), "account", error);
        if (req.path === "/admin/account/password")
          return res.status(400).render("owner/panel", {
            page: "account", user: req.user, csrf: req.session.csrf,
            error, values: {},
          });
        return res.status(400).json({ error: "INVALID_INPUT" });
      };
      const body = req.body;
      if (
        !body ||
        Object.keys(body).some(
          (k) => !["currentPassword", "newPassword", "_csrf"].includes(k),
        ) ||
        typeof body.currentPassword !== "string" ||
        Buffer.byteLength(body.currentPassword) > 256 ||
        !password.safeParse(body.newPassword).success
      )
        return invalid();
      const current = await prisma.user.findUnique({
        where: { id: req.user.id },
      });
      if (
        !current ||
        !(await verifyPassword(current.passwordHash, body.currentPassword))
      )
        return invalid();
      // Optimistic password guard prevents concurrent stale self-reset.
      await users.change(
        req.user.id,
        { password: body.newPassword },
        {
          actorId: req.user.id,
          operatorHash: current.passwordHash,
          requestId: req.id,
          self: true,
          expectedVersion: req.user.authVersion,
        },
      );
      await new Promise((ok, no) =>
        req.session.destroy((e) => (e ? no(e) : ok())),
      );
      res.clearCookie(config.cookieName, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.production,
      });
      if (
        req.path === "/admin/account/password" ||
        req.path === "/trainer/account/password"
      )
        return res.redirect(303, "/login");
      res.json({ ok: true, reauthenticate: true });
    },
  );
  return router;
}
export function home(role) {
  return role === "OWNER" ? "/admin" : role === "ADMIN" ? "/staff" : "/trainer";
}
