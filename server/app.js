import { contentManagementRoutes } from './modules/content/routes.js';
import { contentPublicRoutes, publicContacts } from './modules/content/public.js';
import { publicTrainerRoutes } from './modules/public/trainers.js';
import { trainerManagementRoutes } from './modules/trainers/routes.js';
import { publicScheduleRoutes } from "./modules/public/schedule.js";
import { applySeo, robotsText, sitemapXml } from "./modules/public/seo.js";
import { shopRoutes } from "./modules/shop/routes.js";
import { pushRoutes } from "./modules/push/routes.js";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AuthStore } from "./modules/auth/session-store.js";
import { authRoutes } from "./modules/auth/routes.js";
import { loadUser, requireAuth, requireRole } from "./middleware/auth.js";
import { inlineScriptHashes } from "./middleware/security.js";
import { userService } from "./modules/users/service.js";
import { ownerRoutes } from "./modules/owner/routes.js";
import { trainerRoutes } from "./modules/trainer/routes.js";
import { crmRoutes } from "./modules/crm/routes.js";
import { scheduleRoutes } from "./modules/schedule/routes.js";
const root = fileURLToPath(new URL("../", import.meta.url));
export async function createApp({
  config,
  db,
  log = (entry) => console.error(JSON.stringify(entry)),
}) {
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set(
    "trust proxy",
    config.TRUST_PROXY === "loopback" ? "loopback" : false,
  );
  app.set("view engine", "ejs");
  app.set("views", path.join(root, "server/views"));
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set("X-Request-ID", req.id);
    res.set("X-Robots-Tag", "noindex,nofollow");
    next();
  });
  const index = await readFile(path.join(root, "index.html"), "utf8");
  const inline = inlineScriptHashes(index);
  app.use(
    helmet({
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", ...inline],
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'none'"],
          imgSrc: ["'self'"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      strictTransportSecurity: config.production
        ? { maxAge: 31536000, includeSubDomains: false }
        : false,
    }),
  );
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (req, res) => res.status(429).send("Слишком много запросов."),
    }),
  );
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (req, res) => {
    try {
      await db.pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  // No repository-root static mount. Source SCSS is not public either.
  for (const dir of ["css", "scripts", "img"])
    app.use(
      `/site/${dir}`,
      express.static(path.join(root, "site", dir), {
        dotfiles: "deny",
        index: false,
        fallthrough: false,
      }),
    );
  app.get("/push-sw.js", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.join(root, "server/modules/push/sw.js"), { lastModified: false, etag: false });
  });
  app.get('/manifest.webmanifest', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').sendFile(path.join(root, 'server/modules/pwa/manifest.json'));
  });
  app.get('/offline.html', (req, res) => {
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    res.sendFile(path.join(root, 'server/modules/pwa/offline.html'));
  });
  app.get('/robots.txt', (req, res) => res.type('text/plain').send(robotsText(config)));
  app.get('/sitemap.xml', async (req, res) => res.type('application/xml').send(await sitemapXml(config, db.prisma)));
  app.get('/index.html', (req, res) => {
    const query = req.originalUrl.indexOf('?');
    res.redirect(301, '/' + (query < 0 ? '' : req.originalUrl.slice(query)));
  });
  app.use(publicContacts(db.prisma));
  app.use(contentPublicRoutes({config,prisma:db.prisma}));
  app.use(publicTrainerRoutes({ config, prisma: db.prisma }));
  app.use(publicScheduleRoutes({ config, prisma: db.prisma }));
  // Private/auth responses always no-store, even errors and unknown API routes.
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(["/crm/schedule/:id/publication", "/api/crm/schedule/:id/publication"],
    express.urlencoded({ extended: false, limit: "32kb", parameterLimit: 210 }),
    express.json({ limit: "32kb", strict: true }));
  // Product descriptions need bounded room for UTF-8 URL-encoded form fields.
  app.use(["/shop-panel/products", "/api/shop-panel/products"],
    express.urlencoded({ extended: false, limit: "128kb", parameterLimit: 12 }),
    express.json({ limit: "48kb", strict: true }));
  app.use("/admin/content", express.urlencoded({ extended: false, limit: "256kb", parameterLimit: 24 }));
  app.use("/admin/public-trainers", express.urlencoded({ extended: false, limit: "256kb", parameterLimit: 20 }));
  app.use(
    express.urlencoded({ extended: false, limit: "8kb", parameterLimit: 24 }),
  );
  app.use(express.json({ limit: "8kb", strict: true }));
  const store = new AuthStore(db.pool, config);
  app.use(
    session({
      name: config.cookieName,
      secret: config.SESSION_SECRET,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        path: "/",
        httpOnly: true,
        secure: config.production,
        sameSite: "lax",
        maxAge: config.idleMs,
      },
    }),
  );
  app.use(loadUser(db.prisma));
  app.use((req, res, next) => { res.locals.currentPath = req.path; next(); });
  const users = userService(db.prisma);
  app.use(await authRoutes({ config, prisma: db.prisma, store, users }));
  app.use(shopRoutes({config,prisma:db.prisma,indexHtml:index}));
  app.get('/application', requireAuth, requireRole('OWNER', 'ADMIN', 'TRAINER'), (req, res) => res.render('pwa/panel', {user: req.user}));
  app.use(pushRoutes({ config, prisma: db.prisma }));
  app.use(crmRoutes({config,prisma:db.prisma}));
  app.use(scheduleRoutes({ config, prisma: db.prisma }));
  app.use(contentManagementRoutes({config,prisma:db.prisma}));
  app.use(trainerManagementRoutes({ config, prisma: db.prisma }));
  app.use(ownerRoutes({ config, prisma: db.prisma, users }));
  app.use(trainerRoutes());
  for (const [route, role, label] of [
    ["/admin", "OWNER", "Владелец"],
    ["/staff", "ADMIN", "Администратор"],
    ["/trainer", "TRAINER", "Тренер"],
  ]) {
    if (route === "/staff")
      app.get(route, requireAuth, requireRole(role), (req, res) =>
        res.render("auth/check", {
          label,
          user: req.user,
          csrf: req.session.csrf,
        }),
      );
    app.get(`/api${route}/check`, requireAuth, requireRole(role), (req, res) =>
      res.json({ ok: true, role: req.user.role }),
    );
  }
  app.use((req, res) => res.status(404).send("Страница не найдена."));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.set("Cache-Control", "no-store");
    if (req.path.startsWith("/site/") && err.status === 403) err.status = 404;
    const status =
      err.type === "entity.too.large"
        ? 413
        : err.name === "ZodError"
          ? 400
          : [400, 401, 403, 404, 409, 429, 503].includes(err.status)
            ? err.status
            : 500;
    if (status >= 500)
      log({ event: "REQUEST_FAILED", requestId: req.id, status });
    const message = {
      400: "Некорректный запрос.",
      401: "Требуется вход.",
      403: "Доступ запрещён.",
      404: "Страница не найдена.",
      409: "Операция недоступна.",
      413: "Запрос слишком большой.",
      429: "Повторите позже.",
      503: "Сервис временно недоступен.",
      500: "Не удалось выполнить запрос.",
    }[status];
    if (req.path.startsWith("/api/"))
      return res.status(status).json({ error: message, requestId: req.id });
    res.status(status).render("auth/error", { message, requestId: req.id });
  });
  return { app, store, users };
}
