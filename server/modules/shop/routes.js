import ejs from "ejs";
import { publicPlans, planTerms } from "../public/plans.js";
import { applySeo, seoFor } from "../public/seo.js";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { csrf, newCsrf } from "../../middleware/csrf.js";
import { shopService, fail, guestHash } from "./service.js";
import { parseImage, parseProductImage, normalizeImage } from "./images.js";
import * as s from "./schema.js";
const money = (n) =>
  (n / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function shopRoutes({ prisma, config, indexHtml }) {
  const r = Router(),
    service = shopService(prisma, config.SESSION_SECRET),
    guard = csrf(config);
  const limit = rateLimit({
    windowMs: 900000,
    limit: 90,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const ordersLimit = rateLimit({
    windowMs: 900000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const adminLimit = rateLimit({
    windowMs: 900000,
    limit: 120,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const imageLimit = rateLimit({
    windowMs: 900000,
    limit: 16,
    keyGenerator: (req) => req.user.id,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const init = (req, res, next) => {
    if (!req.session.csrf) {
      req.session.preAuthAt = Date.now();
      req.session.csrf = newCsrf();
      if (!req.user) req.session.cookie.maxAge = 900000;
    }
    next();
  };
  const render = (req, res, page, data = {}) => {
    if (data.seo) res.set("X-Robots-Tag", data.seo.robots);
    return res.render("shop/" + page, {
      seo: null,
      csrf: req.session.csrf,
      key: randomUUID,
      money,
      methods: s.methods,
      statuses: s.statuses,
      ...data,
    });
  };
  const body = (req) => {
    const { _csrf, ...data } = req.body || {};
    return data;
  };
  const save = (req) =>
    new Promise((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
  r.get("/", async (req, res) => {
    const [{ items }, plans] = await Promise.all([service.catalog(), publicPlans(prisma)]);
    const memberships = await ejs.renderFile(
      fileURLToPath(new URL("../../views/public/memberships.ejs", import.meta.url)),
      { plans, money, planTerms },
    );
    const nutrition = await ejs.renderFile(
      fileURLToPath(new URL("../../views/shop/nutrition.ejs", import.meta.url)),
      { items: items.slice(0, 5), money },
    );
    res
      .type("html")
      .send(
        applySeo(res, config, "/", indexHtml, req.query)
          .replace(/<section\s+class="memberships"[\s\S]*?<\/section>/, () => memberships)
          .replace(
            /<section class="nutrition"[\s\S]*?<\/section>/,
            () => nutrition,
          )
          .replace(
            /<script src="site\/scripts\/demo-(?:products|cart)\.js" defer><\/script>/g,
            "",
          ),
      );
  });
  r.get(["/shop.html", "/api/shop/products"], init, async (req, res) => {
    const data = await service.catalog(req.query);
    return req.path.startsWith("/api/")
      ? res.json(data)
      : render(req, res, "catalog", { ...data, seo: seoFor(config, req.path, req.query) });
  });
  r.get("/product.html", init, async (req, res) => {
    const q = z.object({ id: s.uuid.optional() }).strict().parse(req.query);
    const product = q.id ? await service.product(q.id) : null;
    render(req, res, "product", {
      product, seo: seoFor(config, req.path, req.query, product),
    });
  });
  r.get("/api/shop/products/:id", async (req, res) =>
    res.json(await service.product(req.params.id)),
  );
  r.get("/cart.html", init, async (req, res) => {
    z.object({}).strict().parse(req.query);
    const b = await service.basket(req.session.shopCart || []);
    render(req, res, "cart", {
      ...b,
      quote: service.quote(req.sessionID, req.session.csrf, b),
    });
  });
  r.post("/shop/cart/add", limit, guard, async (req, res) => {
    const data = s.cartAdd.parse(body(req)),
      cart = structuredClone(req.session.shopCart || []),
      row = cart.find((v) => v.variantId === data.variantId);
    if (row) {
      if (row.quantity + data.quantity > 99)
        throw fail(409, "Не более 99 единиц на вариант.");
      row.quantity += data.quantity;
    } else {
      if (cart.length >= 30)
        throw fail(409, "Не более 30 вариантов в корзине.");
      cart.push(data);
    }
    const b = await service.basket(cart);
    if (!b.canOrder) throw fail(409, "Вариант недоступен для заказа.");
    req.session.shopCart = cart;
    await save(req);
    res.redirect(303, "/cart.html");
  });
  r.post("/shop/cart/update", limit, guard, async (req, res) => {
    const data = z
        .object({ variantId: s.uuid, quantity: s.int(0, 99) })
        .strict()
        .parse(body(req)),
      cart = structuredClone(req.session.shopCart || []),
      row = cart.find((v) => v.variantId === data.variantId);
    if (!row) throw fail(404, "Позиция не найдена.");
    row.quantity = data.quantity;
    req.session.shopCart = cart.filter((v) => v.quantity > 0);
    await save(req);
    res.redirect(303, "/cart.html");
  });
  r.post("/shop/orders", ordersLimit, guard, async (req, res) => {
    const result = await service.createOrder(
      {
        sid: req.sessionID,
        csrf: req.session.csrf,
        cart: req.session.shopCart || [],
        requestId: req.id,
      },
      body(req),
    );
    req.session.shopCart = [];
    await save(req);
    res.redirect(303, "/shop/order/" + result.id);
  });
  r.get("/shop/order/:id", async (req, res) =>
    render(req, res, "receipt", {
      order: await service.order(req.params.id, guestHash(req.sessionID)),
    }),
  );
  r.use(
    ["/shop-panel", "/api/shop-panel"],
    requireAuth,
    requireRole("OWNER", "ADMIN"),
  );
  const panel = (req, res, page, data = {}) =>
    render(req, res, "panel", { page, user: req.user, ...data });
  r.get("/shop-panel", (req, res) => res.redirect(303, "/shop-panel/orders"));
  r.get(["/shop-panel/orders", "/api/shop-panel/orders"], async (req, res) => {
    const query = s.orderQuery.parse(req.query),
      where = query.status ? { status: query.status } : {};
    const [orders, total] = await Promise.all([
      prisma.shopOrder.findMany({
        where,
        select: {
          id: true,
          number: true,
          name: true,
          phone: true,
          status: true,
          totalCents: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        skip: (query.page - 1) * 25,
      }),
      prisma.shopOrder.count({ where }),
    ]);
    const data = { orders, total, query };
    return req.path.startsWith("/api/")
      ? res.json(data)
      : panel(req, res, "orders", data);
  });
  r.get(
    ["/shop-panel/orders/:id", "/api/shop-panel/orders/:id"],
    async (req, res) => {
      const order = await service.order(req.params.id);
      return req.path.startsWith("/api/")
        ? res.json(order)
        : panel(req, res, "order", { order });
    },
  );
  r.get(
    ["/shop-panel/products", "/api/shop-panel/products"],
    requireRole("OWNER"),
    async (req, res) => {
      const query = z
        .object({ page: s.int(1, 100000).default(1) })
        .strict()
        .parse(req.query);
      const [products, total] = await Promise.all([
        prisma.shopProduct.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 25,
          skip: (query.page - 1) * 25,
          select: { id: true, name: true, category: true, active: true },
        }),
        prisma.shopProduct.count(),
      ]);
      return req.path.startsWith("/api/")
        ? res.json({ products, total, query })
        : panel(req, res, "products", { products, total, query });
    },
  );
  r.get("/shop-panel/products/new", requireRole("OWNER"), (req, res) =>
    panel(req, res, "product", { product: null }),
  );
  r.get(
    ["/shop-panel/products/:id", "/api/shop-panel/products/:id"],
    requireRole("OWNER"),
    async (req, res) => {
      const product = await service.product(req.params.id, true);
      return req.path.startsWith("/api/")
        ? res.json(product)
        : panel(req, res, "product", { product });
    },
  );
  const ctx = (req, m) => ({
    ...m,
    actorId: req.user.id,
    authVersion: req.user.authVersion,
    sessionId: req.sessionID,
    requestId: req.id,
  });
  const post = (path, fn, owner = false) =>
    r.post(
      [path, "/api" + path],
      ...(owner ? [requireRole("OWNER")] : []),
      adminLimit,
      guard,
      async (req, res) => {
        const { _csrf, key, version, ...data } = req.body || {},
          c = ctx(req, s.meta.parse({ _csrf, key, version })),
          result = await fn(req, c, data);
        return req.path.startsWith("/api/")
          ? res.json({ ok: true, ...result })
          : res.redirect(303, result.url);
      },
    );
  r.post("/shop-panel/products/new/with-photo", requireRole("OWNER"), imageLimit,
    (req, res, next) => req.get("Origin") === config.APP_ORIGIN ? next() : next(fail(403, "Доступ запрещён.")),
    parseProductImage, guard, async (req, res) => {
      const { _csrf, key, version, ...data } = req.body;
      const c = ctx(req, s.meta.parse({ _csrf, key, version }));
      const image = req.shopImage ? await normalizeImage(req.shopImage) : null;
      const result = await service.saveProduct(c, null, data, image);
      res.redirect(303, "/shop-panel/products/" + result.id + "#product-variants");
    });
  post("/shop-panel/products/:id/delete", async (req, c, data) => {
    const result = await service.deleteProduct(c, req.params.id, data);
    return { ...result, url: "/shop-panel/products" };
  }, true);
  post(
    "/shop-panel/products",
    async (req, c, d) => {
      const result = await service.saveProduct(c, null, d);
      return { ...result, url: "/shop-panel/products/" + result.id };
    },
    true,
  );
  post(
    "/shop-panel/products/:id",
    async (req, c, d) => {
      const result = await service.saveProduct(c, req.params.id, d);
      return { ...result, url: "/shop-panel/products/" + result.id };
    },
    true,
  );
  for (const suffix of ["", "/:variantId"])
    post(
      "/shop-panel/products/:id/variants" + suffix,
      async (req, c, d) => {
        const result = await service.saveVariant(
          c,
          req.params.id,
          req.params.variantId || null,
          d,
        );
        return { ...result, url: "/shop-panel/products/" + result.productId };
      },
      true,
    );
  post("/shop-panel/orders/:id/status", async (req, c, d) => {
    const result = await service.changeOrder(c, req.params.id, d);
    return { ...result, url: "/shop-panel/orders/" + result.id };
  });
  post(
    "/shop-panel/images/:id/remove",
    async (req, c, d) => {
      z.object({}).strict().parse(d);
      const result = await service.removeImage(c, req.params.id);
      return { ...result, url: "/shop-panel/products/" + result.id };
    },
    true,
  );
  r.post(
    "/shop-panel/products/:id/images",
    requireRole("OWNER"),
    imageLimit,
    (req, res, next) =>
      req.get("Origin") === config.APP_ORIGIN
        ? next()
        : next(fail(403, "Доступ запрещён.")),
    parseImage,
    guard,
    async (req, res) => {
      const c = ctx(req, s.meta.parse(req.body)),
        data = await normalizeImage(req.shopImage),
        result = await service.addImage(c, req.params.id, data);
      res.redirect(303, "/shop-panel/products/" + result.id);
    },
  );
  r.get("/shop/images/:id.webp", async (req, res) => {
    s.uuid.parse(req.params.id);
    const image = await prisma.shopImage.findFirst({
      where: {
        id: req.params.id,
        product: req.user?.role === "OWNER" ? {} : { active: true },
      },
      select: { data: true },
    });
    if (!image) throw fail(404, "Фото не найдено.");
    res
      .type("image/webp")
      .set("X-Content-Type-Options", "nosniff")
      .send(Buffer.from(image.data));
  });
  r.use((err, req, res, next) => {
    if (
      !req.path.startsWith("/api/") &&
      (err.name === "ZodError" || [400, 409].includes(err.status))
    ) {
      res.status(err.status || 400);
      return render(req, res, "error", {
        message:
          err.name === "ZodError"
            ? "Проверьте обязательные поля и числовые значения."
            : err.message,
      });
    }
    next(err);
  });
  return r;
}
