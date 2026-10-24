import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { csrf } from "../../middleware/csrf.js";
import { crmService } from "./service.js";
import { uuid, operation } from "./schema.js";
import { today, dateString, membershipStatus } from "./dates.js";
export function crmRoutes({ prisma, config }) {
  const router = Router(),
    service = crmService(prisma);
  router.use(["/crm", "/api/crm"], requireAuth, requireRole("OWNER", "ADMIN"));
  const limit = rateLimit({
    windowMs: 900000,
    limit: 120,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const guard = csrf(config);
  const render = (req, res, page, data = {}) =>
    res.render("crm/panel", {
      page,
      user: {
        id: req.user.id,
        role: req.user.role,
        displayName: req.user.displayName,
      },
      csrf: req.session.csrf,
      key: randomUUID,
      today: today(),
      ds: dateString,
      status: membershipStatus,
      money: (n) =>
        (n / 100).toLocaleString("ru-RU", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ...data,
    });
  router.get("/crm", (req, res) => res.redirect(303, "/crm/clients"));
  router.get("/staff", requireAuth, requireRole("ADMIN"), (req, res) =>
    res.redirect(303, "/crm/clients"),
  );
  router.get(["/crm/clients", "/api/crm/clients"], async (req, res) => {
    const { duplicate, ...query } = req.query;
    if (duplicate !== undefined && duplicate !== "1")
      throw Object.assign(new Error("INVALID"), { status: 400 });
    const data = await service.list(req.user, query);
    return req.path.startsWith("/api/")
      ? res.json(data)
      : render(req, res, "clients", { ...data, duplicate: duplicate === "1" });
  });
  router.get("/crm/clients/new", (req, res) =>
    render(req, res, "client-form", { client: null }),
  );
  router.get("/crm/clients/:id/edit", async (req, res) =>
    render(req, res, "client-form", {
      client: await service.get(req.user, req.params.id),
    }),
  );
  router.get(["/crm/clients/:id", "/api/crm/clients/:id"], async (req, res) => {
    const { duplicate, ...query } = req.query;
    if (duplicate !== undefined && duplicate !== "1")
      throw Object.assign(new Error("INVALID"), { status: 400 });
    const data = await service.get(req.user, req.params.id, query);
    return req.path.startsWith("/api/")
      ? res.json(data)
      : render(req, res, "client", {
          client: data,
          trainers: await service.trainers(),
          duplicate: duplicate === "1",
        });
  });
  router.get("/crm/clients/:id/issue", async (req, res) => {
    const query = z
      .object({
        plan: z.union([uuid, z.literal("")]).default(""),
        partnerQ: z.string().trim().max(100).default(""),
      })
      .strict()
      .parse(req.query);
    const client = await service.get(req.user, req.params.id),
      plans = (await service.plans()).filter((p) => p.active);
    const plan = plans.find((p) => p.id === query.plan) || null;
    const partners = query.partnerQ
      ? (await service.list(req.user, { q: query.partnerQ })).items.filter(
          (c) => c.id !== client.id,
        )
      : [];
    render(req, res, "issue", {
      client,
      plans,
      plan,
      partners,
      partnerQ: query.partnerQ,
    });
  });
  router.get(["/crm/plans", "/api/crm/plans"], async (req, res) => {
    const plans = await service.plans();
    return req.path.startsWith("/api/")
      ? res.json({ plans })
      : render(req, res, "plans", { plans });
  });
  router.get("/crm/plans/new", requireRole("OWNER"), (req, res) =>
    render(req, res, "plan-form", { plan: null }),
  );
  router.get("/crm/plans/:id", requireRole("OWNER"), async (req, res) => {
    uuid.parse(req.params.id);
    const plan = await prisma.membershipPlan.findUnique({
      where: { id: req.params.id },
    });
    if (!plan) throw Object.assign(new Error("NOT_FOUND"), { status: 404 });
    render(req, res, "plan-form", { plan });
  });
  const post = (path, callback, ownerOnly = false) => {
    const apiPath = "/api" + path;
    router.post(
      [path, apiPath],
      ...(ownerOnly ? [requireRole("OWNER")] : []),
      limit,
      guard,
      async (req, res, next) => {
        try {
          const { _csrf, key, version, ...input } = req.body || {};
          const meta = operation.parse({ _csrf, key, version });
          const ctx = {
            actorId: req.user.id,
            authVersion: req.user.authVersion,
            sessionId: req.sessionID,
            requestId: req.id,
            ...meta,
          };
          const result = await callback(req, ctx, input);
          if (req.path.startsWith("/api/"))
            return res.json({ ok: true, ...result });
          const target = result.clientId || result.id;
          const destination = path.includes("/plans")
            ? "/crm/plans"
            : `/crm/clients/${target}${result.duplicatePhone ? "?duplicate=1" : ""}`;
          res.redirect(303, destination);
        } catch (e) {
          if (
            req.path.startsWith("/api/") ||
            !(e.name === "ZodError" || [400, 404, 409].includes(e.status))
          )
            return next(e);
          // Only known validation/business errors, never raw database/driver messages.
          const message =
            e.name === "ZodError"
              ? "Проверьте обязательные поля, даты и числовые значения."
              : e.message;
          let back = "/crm/clients";
          if (path.includes("/plans")) back = "/crm/plans";
          else if (
            path.includes("/memberships/:id") &&
            uuid.safeParse(req.params.id).success
          ) {
            const m = await prisma.membership.findUnique({
              where: { id: req.params.id },
              select: { clientId: true },
            });
            if (m) back = `/crm/clients/${m.clientId}`;
          } else if (uuid.safeParse(req.params.id).success)
            back = `/crm/clients/${req.params.id}`;
          else if (uuid.safeParse(req.body?.clientId).success)
            back = `/crm/clients/${req.body.clientId}`;
          render(req, res.status(e.status || 400), "error", {
            error: message,
            back,
          });
        }
      },
    );
  };
  post("/crm/clients", (_r, c, d) => service.saveClient(c, null, d));
  post("/crm/clients/:id/edit", (r, c, d) =>
    service.saveClient(c, r.params.id, d),
  );
  for (const action of ["archive", "assign", "revoke"])
    post(`/crm/clients/:id/${action}`, (r, c, d) =>
      service.clientAction(c, r.params.id, action, d),
    );
  post("/crm/plans", (_r, c, d) => service.savePlan(c, null, d), true);
  post(
    "/crm/plans/:id",
    (r, c, d) => service.savePlan(c, r.params.id, d),
    true,
  );
  post("/crm/memberships", (_r, c, d) => service.issue(c, d));
  for (const action of [
    "cancel",
    "extend",
    "adjust",
    "freeze",
    "thaw",
    "refund",
  ])
    post(
      `/crm/memberships/:id/${action}`,
      (r, c, d) => service.membershipAction(c, r.params.id, action, d),
      action === "refund",
    );
  // Each TRAINER page/API is independently guarded, never accepts a trainer ID.
  router.get(
    ["/trainer/clients", "/api/trainer/clients"],
    requireAuth,
    requireRole("TRAINER"),
    async (req, res) => {
      const data = await service.list(req.user, req.query);
      return req.path.startsWith("/api/")
        ? res.json(data)
        : render(req, res, "clients", { ...data, duplicate: false });
    },
  );
  router.get(
    ["/trainer/clients/:id", "/api/trainer/clients/:id"],
    requireAuth,
    requireRole("TRAINER"),
    async (req, res) => {
      const data = await service.get(req.user, req.params.id, req.query);
      return req.path.startsWith("/api/")
        ? res.json(data)
        : render(req, res, "client", {
            client: data,
            trainers: [],
            duplicate: false,
          });
    },
  );
  return router;
}
