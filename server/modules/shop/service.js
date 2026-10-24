import { createHash, createHmac } from "node:crypto";
import { accessLock } from "../../db/client.js";
import { audit } from "../audit/service.js";
import * as s from "./schema.js";
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
const check = (ok, message = "Данные изменились. Обновите страницу.") => {
  if (!ok) throw fail(409, message);
};
const stable = (v) =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, stable(v[k])]),
        )
      : v;
const hash = (v) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
export const guestHash = (sid) => hash({ sid });
const imageSelect = { id: true };
const publicProduct = {
  id: true,
  name: true,
  category: true,
  description: true,
  characteristics: true,
  version: true,
  variants: {
    where: { active: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      priceCents: true,
      available: true,
      version: true,
    },
  },
  images: {
    select: imageSelect,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  },
};
export function shopService(prisma, quoteSecret) {
  async function catalog(raw = {}) {
    const query = s.catalogQuery.parse(raw),
      where = {
        active: true,
        ...(query.category ? { category: query.category } : {}),
      };
    const [items, total, cats] = await Promise.all([
      prisma.shopProduct.findMany({
        where,
        select: publicProduct,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * 24,
        take: 24,
      }),
      prisma.shopProduct.count({ where }),
      prisma.shopProduct.findMany({
        where: { active: true },
        distinct: ["category"],
        select: { category: true },
        orderBy: { category: "asc" },
      }),
    ]);
    return { items, total, categories: cats.map((v) => v.category), query };
  }
  async function product(id, admin = false) {
    s.uuid.parse(id);
    const p = await prisma.shopProduct.findFirst({
      where: { id, ...(!admin ? { active: true } : {}) },
      ...(admin
        ? {
            include: {
              variants: { orderBy: [{ name: "asc" }, { id: "asc" }] },
              images: {
                select: imageSelect,
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              },
            },
          }
        : { select: publicProduct }),
    });
    if (!p) throw fail(404, "Товар не найден.");
    return p;
  }
  async function basket(cart = [], tx = prisma) {
    if (!Array.isArray(cart) || cart.length > 30)
      throw fail(400, "Некорректная корзина.");
    const input = cart.map((v) => s.cartAdd.parse(v));
    check(new Set(input.map((v) => v.variantId)).size === input.length);
    const records = await tx.shopVariant.findMany({
      where: { id: { in: input.map((v) => v.variantId) } },
      include: {
        product: {
          include: {
            images: {
              select: imageSelect,
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              take: 1,
            },
          },
        },
      },
    });
    let totalCents = 0;
    const items = input.map((row) => {
      const v = records.find((v) => v.id === row.variantId);
      const available = !!(v?.active && v.available && v.product.active);
      const line = v
        ? {
            variantId: v.id,
            quantity: row.quantity,
            name: v.product.name,
            variant: v.name,
            priceCents: v.priceCents,
            version: v.version,
            productVersion: v.product.version,
            productId: v.productId,
            imageId: v.product.images[0]?.id || null,
            available,
          }
        : {
            ...row,
            name: "Товар недоступен",
            variant: "",
            priceCents: 0,
            version: 0,
            productVersion: 0,
            available: false,
          };
      totalCents += line.priceCents * line.quantity;
      return line;
    });
    check(
      Number.isSafeInteger(totalCents) && totalCents <= 2000000000,
      "Сумма превышает технический предел.",
    );
    return {
      items,
      totalCents,
      canOrder: items.length > 0 && items.every((v) => v.available),
    };
  }
  const quote = (sid, csrf, b) =>
    createHmac("sha256", quoteSecret)
      .update(
        JSON.stringify({ sid, csrf, items: b.items, totalCents: b.totalCents }),
      )
      .digest("hex");
  async function session(tx, sid) {
    const row =
      sid &&
      (await tx.authSession.findFirst({
        where: {
          sid,
          expire: { gt: new Date() },
          absoluteAt: { gt: new Date() },
        },
      }));
    if (!row) throw fail(403, "Сессия завершена. Обновите страницу.");
  }
  async function mutate(ctx, action, target, raw, fn, ownerOnly = false) {
    s.uuid.parse(ctx.key);
    if (target) s.uuid.parse(target);
    const fingerprint = hash({
      action,
      target,
      raw,
      version: ctx.version ?? null,
    });
    return prisma.$transaction(
      async (tx) => {
        await accessLock(tx);
        const actor = await tx.user.findUnique({ where: { id: ctx.actorId } });
        if (
          !actor?.active ||
          actor.authVersion !== ctx.authVersion ||
          !(ownerOnly ? ["OWNER"] : ["OWNER", "ADMIN"]).includes(actor.role)
        )
          throw fail(403, "Доступ запрещён.");
        await session(tx, ctx.sessionId);
        if (
          !(await tx.authSession.findFirst({
            where: {
              sid: ctx.sessionId,
              userId: actor.id,
              authVersion: actor.authVersion,
            },
          }))
        )
          throw fail(403, "Доступ запрещён.");
        const prior = await tx.crmOperation.findUnique({
          where: { actorId_key: { actorId: actor.id, key: ctx.key } },
        });
        if (prior) {
          check(
            prior.fingerprint === fingerprint,
            "Эта форма уже использована для другой операции.",
          );
          return prior.result;
        }
        const result = await fn(tx, actor);
        await tx.crmOperation.create({
          data: { actorId: actor.id, key: ctx.key, fingerprint, result },
        });
        await audit(tx, action, {
          actorId: actor.id,
          targetId: target || result.id,
          requestId: ctx.requestId,
        });
        return result;
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async function version(tx, model, id, expected) {
    const v = await tx[model].findUnique({ where: { id } });
    if (!v) throw fail(404, "Запись не найдена.");
    check(v.version === s.int(1, 2147483646).parse(expected));
    return v;
  }
  async function saveProduct(ctx, id, raw) {
    const data = s.productBody.parse(raw);
    return mutate(
      ctx,
      "SHOP_PRODUCT_SAVE",
      id,
      data,
      async (tx) => {
        if (id) await version(tx, "shopProduct", id, ctx.version);
        const p = id
          ? await tx.shopProduct.update({
              where: { id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.shopProduct.create({ data });
        return { id: p.id };
      },
      true,
    );
  }
  async function saveVariant(ctx, productId, id, raw) {
    s.uuid.parse(productId);
    const { price, ...rest } = s.variantBody.parse(raw),
      data = { ...rest, priceCents: price };
    return mutate(
      ctx,
      "SHOP_VARIANT_SAVE",
      id || productId,
      { productId, ...data },
      async (tx) => {
        if (!(await tx.shopProduct.findUnique({ where: { id: productId } })))
          throw fail(404, "Товар не найден.");
        if (id) {
          const v = await version(tx, "shopVariant", id, ctx.version);
          check(v.productId === productId);
        } else
          check(
            (await tx.shopVariant.count({ where: { productId } })) < 50,
            "Не более 50 вариантов на товар.",
          );
        check(
          !(await tx.shopVariant.findFirst({
            where: {
              productId,
              name: data.name,
              ...(id ? { id: { not: id } } : {}),
            },
          })),
          "Такой вариант уже существует.",
        );
        const v = id
          ? await tx.shopVariant.update({
              where: { id },
              data: { ...data, version: { increment: 1 } },
            })
          : await tx.shopVariant.create({ data: { productId, ...data } });
        return { id: v.id, productId };
      },
      true,
    );
  }
  async function addImage(ctx, id, data) {
    return mutate(
      ctx,
      "SHOP_IMAGE_ADD",
      id,
      { digest: createHash("sha256").update(data).digest("hex") },
      async (tx) => {
        await version(tx, "shopProduct", id, ctx.version);
        check(
          (await tx.shopImage.count({ where: { productId: id } })) < 8,
          "Не более 8 фото.",
        );
        await tx.shopImage.create({ data: { productId: id, data } });
        await tx.shopProduct.update({
          where: { id },
          data: { version: { increment: 1 } },
        });
        return { id };
      },
      true,
    );
  }
  async function removeImage(ctx, id) {
    return mutate(
      ctx,
      "SHOP_IMAGE_REMOVE",
      id,
      {},
      async (tx) => {
        const image = await tx.shopImage.findUnique({ where: { id } });
        if (!image) throw fail(404, "Фото не найдено.");
        await version(tx, "shopProduct", image.productId, ctx.version);
        await tx.shopImage.delete({ where: { id } });
        await tx.shopProduct.update({
          where: { id: image.productId },
          data: { version: { increment: 1 } },
        });
        return { id: image.productId };
      },
      true,
    );
  }
  async function createOrder({ sid, csrf, cart, requestId }, raw) {
    const data = s.orderBody.parse(raw),
      fingerprint = hash(data),
      identity = guestHash(sid);
    return prisma.$transaction(
      async (tx) => {
        await accessLock(tx);
        await session(tx, sid);
        const prior = await tx.shopOrder.findUnique({
          where: { key: data.key },
        });
        if (prior) {
          check(
            prior.guestHash === identity && prior.fingerprint === fingerprint,
            "Эта форма уже использована.",
          );
          return { id: prior.id };
        }
        const b = await basket(cart, tx);
        check(b.canOrder, "Некоторые позиции недоступны. Обновите корзину.");
        check(
          quote(sid, csrf, b) === data.quote,
          "Цена, наличие или корзина изменились. Обновите корзину и проверьте итог.",
        );
        const { key, name, phone, comment, method } = data;
        const order = await tx.shopOrder.create({
          data: {
            key,
            name,
            phone,
            comment,
            method,
            guestHash: identity,
            fingerprint,
            totalCents: b.totalCents,
            items: b.items.map(
              ({ imageId, version, productVersion, available, ...v }) => v,
            ),
          },
        });
        await tx.shopOrderEvent.create({
          data: { orderId: order.id, action: "NEW", reason: "" },
        });
        await audit(tx, "SHOP_ORDER_NEW", { targetId: order.id, requestId });
        const recipients = await tx.user.findMany({
          where: { active: true, role: { in: ["OWNER", "ADMIN"] } },
        });
        for (const user of recipients) {
          const subs = await tx.pushSubscription.findMany({
            where: {
              userId: user.id,
              role: user.role,
              authVersion: user.authVersion,
            },
          });
          for (const sub of subs)
            await tx.pushDelivery.create({
              data: {
                eventKey: "shop:" + order.id,
                subscriptionId: sub.id,
                userId: user.id,
                role: user.role,
                authVersion: user.authVersion,
                payload: {
                  title: "Новый заказ в магазине",
                  body: "Откройте заказы для проверки наличия и связи с покупателем.",
                  url: "/shop-panel/orders",
                  tag: "shop:" + order.id,
                },
              },
            });
        }
        return { id: order.id };
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async function order(id, identity) {
    s.uuid.parse(id);
    const o = await prisma.shopOrder.findFirst({
      where: { id, ...(identity ? { guestHash: identity } : {}) },
      ...(!identity
        ? {
            include: {
              events: {
                orderBy: [{ createdAt: "asc" }, { id: "asc" }],
                take: 20,
                include: { actor: { select: { displayName: true } } },
              },
            },
          }
        : {}),
    });
    if (!o) throw fail(404, "Заказ не найден.");
    const {
      guestHash: privateGuest,
      fingerprint: privateFingerprint,
      key: privateKey,
      ...safe
    } = o;
    return safe;
  }
  async function changeOrder(ctx, id, raw) {
    const data = s.transition.parse(raw);
    return mutate(ctx, "SHOP_ORDER_STATUS", id, data, async (tx) => {
      const current = await version(tx, "shopOrder", id, ctx.version),
        next = { NEW: "CONFIRMED", CONFIRMED: "READY", READY: "ISSUED" };
      check(
        data.status === next[current.status] ||
          (data.status === "CANCELLED" &&
            ["NEW", "CONFIRMED", "READY"].includes(current.status)),
        "Недопустимый переход статуса.",
      );
      await tx.shopOrder.update({
        where: { id },
        data: {
          status: data.status,
          ...(data.status === "ISSUED"
            ? { paidAt: new Date(), method: data.method }
            : {}),
          version: { increment: 1 },
        },
      });
      await tx.shopOrderEvent.create({
        data: {
          orderId: id,
          actorId: ctx.actorId,
          action: data.status,
          reason: data.reason,
        },
      });
      return { id };
    });
  }
  return {
    catalog,
    product,
    basket,
    quote,
    saveProduct,
    saveVariant,
    addImage,
    removeImage,
    createOrder,
    order,
    changeOrder,
  };
}
