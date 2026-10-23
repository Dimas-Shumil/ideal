import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { csrf } from "../../middleware/csrf.js";
import { accountBody } from "../auth/schema.js";
const select = {
  id: true,
  login: true,
  displayName: true,
  role: true,
  active: true,
};
const roles = z.enum(["OWNER", "ADMIN", "TRAINER"]);
const id = z.string().uuid();
const filters = z
  .object({
    q: z.string().trim().max(100).default(""),
    role: z.union([roles, z.literal("")]).default(""),
    active: z.enum(["", "true", "false"]).default(""),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();
const fail = (status, message) => Object.assign(new Error(message), { status });
export function ownerRoutes({ config, prisma, users }) {
  const router = Router();
  router.use(["/admin", "/api/admin"], requireAuth, requireRole("OWNER"));
  const guard = csrf(config);
  const limit = rateLimit({
    windowMs: 900000,
    limit: 30,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const render = (req, res, page, data = {}) =>
    res.render("owner/panel", {
      page,
      user: req.user,
      csrf: req.session.csrf,
      error: null,
      values: {},
      ...data,
    });
  async function list(query) {
    const f = filters.parse(query);
    const where = {
      ...(f.role ? { role: f.role } : {}),
      ...(f.active ? { active: f.active === "true" } : {}),
      ...(f.q
        ? {
            OR: ["login", "displayName"].map((key) => ({
              [key]: { contains: f.q, mode: "insensitive" },
            })),
          }
        : {}),
    };
    const [items, total] = await prisma.$transaction([
      prisma.user.findMany({
        where,
        select,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 25,
        skip: (f.page - 1) * 25,
      }),
      prisma.user.count({ where }),
    ]);
    return { items, total, filters: f };
  }
  router.get("/admin", async (req, res) => {
    const [total, active, owners] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { active: true } }),
      prisma.user.count({ where: { active: true, role: "OWNER" } }),
    ]);
    render(req, res, "overview", { total, active, owners });
  });
  router.get("/admin/employees", async (req, res) =>
    render(req, res, "employees", await list(req.query)),
  );
  router.get("/api/admin/employees", async (req, res) =>
    res.json(await list(req.query)),
  );
  router.get("/admin/employees/new", (req, res) => render(req, res, "create"));
  router.get("/admin/account", (req, res) => render(req, res, "account"));
  router.get("/admin/employees/:id", async (req, res) => {
    const employee = await prisma.user.findUnique({
      where: { id: id.parse(req.params.id) },
      select,
    });
    if (!employee) throw fail(404, "NOT_FOUND");
    render(req, res, "edit", { employee });
  });
  // Reauthentication for every staff mutation is intentionally stricter than role-only confirmation.
  const base = {
    _csrf: z.string().optional(),
    ownerPassword: z
      .string()
      .min(1)
      .max(128)
      .refine((s) => Buffer.byteLength(s) <= 256),
    confirm: z.literal("yes"),
  };
  const schemas = {
    create: accountBody.extend(base).strict(),
    name: z
      .object({ ...base, displayName: z.string().trim().min(1).max(100) })
      .strict(),
    role: z.object({ ...base, role: roles }).strict(),
    active: z.object({ ...base, active: z.enum(["true", "false"]) }).strict(),
  };
  const messages = {
    LAST_OWNER: "Нельзя отключить или понизить последнего активного владельца.",
    DUPLICATE_LOGIN: "Этот логин уже занят.",
    FORBIDDEN:
      "Не удалось подтвердить права. Проверьте свой пароль и повторите вход при необходимости.",
  };
  for (const action of Object.keys(schemas)) {
    const paths =
      action === "create"
        ? ["/admin/employees", "/api/admin/employees"]
        : [
            `/admin/employees/:id/${action}`,
            `/api/admin/employees/:id/${action}`,
          ];
    router.post(paths, limit, guard, async (req, res, next) => {
      try {
        const data = schemas[action].parse(req.body);
        const targetId = action === "create" ? null : id.parse(req.params.id);
        const actor = await users.confirmOwner(
          req.user.login,
          data.ownerPassword,
        );
        if (actor.actorId !== req.user.id) throw fail(403, "FORBIDDEN");
        const options = {
          ...actor,
          expectedVersion: req.user.authVersion,
          requestId: req.id,
        };
        let result;
        if (action === "create")
          result = await users.create(
            {
              login: data.login,
              displayName: data.displayName,
              role: data.role,
              password: data.password,
            },
            options,
          );
        else
          await users.change(
            targetId,
            action === "name"
              ? { displayName: data.displayName }
              : action === "role"
                ? { role: data.role }
                : { active: data.active === "true" },
            options,
          );
        if (req.path.startsWith("/api/"))
          return res
            .status(action === "create" ? 201 : 200)
            .json({ ok: true, ...(result ? { user: result } : {}) });
        res.redirect(
          303,
          targetId === req.user.id && action !== "name"
            ? "/login"
            : "/admin/employees",
        );
      } catch (error) {
        if (req.path.startsWith("/api/")) return next(error);
        if (error.name !== "ZodError" && !messages[error.message])
          return next(error);
        const status = error.name === "ZodError" ? 400 : error.status;
        const message =
          error.name === "ZodError"
            ? "Проверьте поля, пароль и отметку подтверждения. Логин: 3–64 латинских символа, цифры, точка, дефис или подчёркивание. Новый пароль: 12–128 символов, до 256 байт."
            : messages[error.message];
        if (action === "create")
          return render(req, res.status(status), "create", {
            error: message,
            values: {
              login:
                typeof req.body.login === "string"
                  ? req.body.login.slice(0, 64)
                  : "",
              displayName:
                typeof req.body.displayName === "string"
                  ? req.body.displayName.slice(0, 100)
                  : "",
            },
          });
        const employee = await prisma.user.findUnique({
          where: { id: id.parse(req.params.id) },
          select,
        });
        if (!employee) return next(fail(404, "NOT_FOUND"));
        render(req, res.status(status), "edit", { employee, error: message });
      }
    });
  }
  return router;
}
