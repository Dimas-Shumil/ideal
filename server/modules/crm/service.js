import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { accessLock } from "../../db/client.js";
import { audit } from "../audit/service.js";
import {
  dateString,
  dbDate,
  today,
  addDays,
  addMonths,
  dayCount,
  endDate,
  age,
  membershipStatus,
} from "./dates.js";
import {
  clientBody,
  planBody,
  planDeleteBody,
  issueBody,
  actions,
  uuid,
  version as versionSchema,
  filters,
} from "./schema.js";
import { trainerClientWhere } from "../../policies/trainer.js";
export const fail = (status, message) =>
  Object.assign(new Error(message), { status });
const check = (
  condition,
  message = "Операция недоступна. Обновите страницу.",
) => {
  if (!condition) throw fail(409, message);
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
const safeMember = {
  id: true,
  snapshot: true,
  startDate: true,
  endDate: true,
  remaining: true,
  cancelledAt: true,
  freezes: { select: { startDate: true, endDate: true } },
};
const safeClient = { id: true, name: true, phone: true, birthDate: true };
export function crmService(prisma) {
  async function mutate(
    ctx,
    action,
    targetId,
    raw,
    callback,
    ownerOnly = false,
  ) {
    uuid.parse(ctx.key);
    if (targetId) uuid.parse(targetId);
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(stable({ action, targetId, raw, version: ctx.version })),
      )
      .digest("hex");
    return prisma.$transaction(
      async (tx) => {
        // Same lock/order as account revocation. Actor/session check cannot race a role change.
        await accessLock(tx);
        const actor = await tx.user.findUnique({ where: { id: ctx.actorId } });
        if (
          !actor?.active ||
          actor.authVersion !== ctx.authVersion ||
          !(ownerOnly ? ["OWNER"] : ["OWNER", "ADMIN"]).includes(actor.role)
        )
          throw fail(403, "Доступ запрещён.");
        if (
          !ctx.sessionId ||
          !(await tx.authSession.findFirst({
            where: {
              sid: ctx.sessionId,
              userId: actor.id,
              authVersion: actor.authVersion,
              expire: { gt: new Date() },
              absoluteAt: { gt: new Date() },
            },
          }))
        )
          throw fail(403, "Сессия завершена. Войдите заново.");
        const previous = await tx.crmOperation.findUnique({
          where: { actorId_key: { actorId: actor.id, key: ctx.key } },
        });
        if (previous) {
          check(
            previous.fingerprint === fingerprint,
            "Эта форма уже использована для другой операции.",
          );
          return previous.result;
        }
        const result = await callback(tx, actor);
        await tx.crmOperation.create({
          data: { actorId: actor.id, key: ctx.key, fingerprint, result },
        });
        await audit(tx, action, {
          actorId: actor.id,
          targetId: targetId || result.id,
          requestId: ctx.requestId,
        });
        return result;
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }
  async function history(
    tx,
    ctx,
    action,
    clientId,
    membershipId,
    reason = "",
    details = {},
  ) {
    await tx.crmEvent.create({
      data: {
        actorId: ctx.actorId,
        action,
        clientId,
        membershipId,
        reason,
        details,
      },
    });
  }
  async function client(tx, id, expected) {
    const c = await tx.client.findUnique({ where: { id } });
    if (!c) throw fail(404, "Клиент не найден.");
    if (expected !== undefined)
      check(c.version === versionSchema.parse(expected));
    return c;
  }
  async function overlap(tx, clientId, start, end, ignoreId = null) {
    const others = await tx.membership.findMany({
      where: {
        clientId,
        cancelledAt: null,
        OR: [{ remaining: null }, { remaining: { gt: 0 } }],
        ...(ignoreId ? { id: { not: ignoreId } } : {}),
      },
    });
    check(
      !others.some(
        (m) =>
          !m.startDate ||
          !start ||
          (dateString(m.startDate) <= (end || "2199-12-31") &&
            (!m.endDate || dateString(m.endDate) >= start)),
      ),
      "У клиента уже есть абонемент с пересекающимся сроком или ожидающий активации.",
    );
  }
  async function member(tx, id, expected) {
    const m = await tx.membership.findUnique({
      where: { id },
      include: { freezes: true, refunds: true, client: true },
    });
    if (!m) throw fail(404, "Абонемент не найден.");
    check(m.version === versionSchema.parse(expected));
    return m;
  }
  async function companions(tx, m) {
    if (!m.pairId) return [m];
    return tx.membership.findMany({
      where: { pairId: m.pairId, cancelledAt: null },
      include: { freezes: true, client: true },
    });
  }
  const api = {
    async saveClient(ctx, id, input) {
      const data = clientBody.parse(input);
      return mutate(
        ctx,
        id ? "CLIENT_UPDATED" : "CLIENT_CREATED",
        id,
        input,
        async (tx) => {
          if (id) await client(tx, id, versionSchema.parse(ctx.version));
          const duplicate = await tx.client.count({
            where: { phone: data.phone, ...(id ? { id: { not: id } } : {}) },
          });
          const c = id
            ? await tx.client.update({
                where: { id },
                data: {
                  ...data,
                  birthDate: dbDate(data.birthDate),
                  version: { increment: 1 },
                },
              })
            : await tx.client.create({
                data: { ...data, birthDate: dbDate(data.birthDate) },
              });
          await history(
            tx,
            ctx,
            id ? "CLIENT_UPDATED" : "CLIENT_CREATED",
            c.id,
            null,
            "",
            { fields: Object.keys(data), duplicatePhone: duplicate > 0 },
          );
          return { id: c.id, duplicatePhone: duplicate > 0 };
        },
      );
    },
    async clientAction(ctx, id, action, input) {
      if (!["archive", "assign", "revoke"].includes(action))
        throw fail(404, "Операция не найдена.");
      const data = actions[action].parse(input);
      return mutate(
        ctx,
        `CLIENT_${action.toUpperCase()}`,
        id,
        input,
        async (tx) => {
          const c = await client(tx, id, versionSchema.parse(ctx.version));
          if (action === "archive") {
            check(
              c.archived !== data.archived,
              "Клиент уже находится в выбранном состоянии.",
            );
            await tx.client.update({
              where: { id },
              data: { archived: data.archived, version: { increment: 1 } },
            });
            if (data.archived)
              await tx.trainerAssignment.updateMany({
                where: { clientId: id, active: true },
                data: { active: false, revokedAt: new Date() },
              });
          } else {
            check(!c.archived, "Сначала восстановите клиента из архива.");
            if (action === "assign") {
              const u = await tx.user.findFirst({
                where: { id: data.trainerId, role: "TRAINER", active: true },
              });
              check(u, "Выберите действующего тренера.");
              const p = await tx.trainerProfile.upsert({
                where: { userId: u.id },
                create: { userId: u.id },
                update: {},
              });
              check(
                !(await tx.trainerAssignment.findFirst({
                  where: { clientId: id, trainerId: p.id, active: true },
                })),
                "Этот тренер уже назначен.",
              );
              await tx.trainerAssignment.create({
                data: { clientId: id, trainerId: p.id },
              });
            } else {
              check(
                (
                  await tx.trainerAssignment.updateMany({
                    where: {
                      id: data.assignmentId,
                      clientId: id,
                      active: true,
                    },
                    data: { active: false, revokedAt: new Date() },
                  })
                ).count === 1,
                "Назначение уже отозвано.",
              );
            }
            await tx.client.update({
              where: { id },
              data: { version: { increment: 1 } },
            });
          }
          await history(
            tx,
            ctx,
            `CLIENT_${action.toUpperCase()}`,
            id,
            null,
            data.reason,
            action === "archive"
              ? { archived: data.archived }
              : action === "assign"
                ? { trainerUserId: data.trainerId }
                : { assignmentId: data.assignmentId },
          );
          return { id };
        },
      );
    },
    async savePlan(ctx, id, input) {
      const p = planBody.parse(input);
      const { price, visits, ...rest } = p;
      return mutate(
        ctx,
        id ? "PLAN_UPDATED" : "PLAN_CREATED",
        id,
        input,
        async (tx) => {
          if (id) {
            const old = await tx.membershipPlan.findUnique({ where: { id } });
            check(old && old.version === versionSchema.parse(ctx.version));
          }
          const data = { ...rest, priceCents: price, visits: visits || null };
          const plan = id
            ? await tx.membershipPlan.update({
                where: { id },
                data: { ...data, version: { increment: 1 } },
              })
            : await tx.membershipPlan.create({ data });
          await history(
            tx,
            ctx,
            id ? "PLAN_UPDATED" : "PLAN_CREATED",
            null,
            null,
            "",
            { planId: plan.id },
          );
          return { id: plan.id };
        },
        true,
      );
    },
    async deletePlan(ctx, id, input) {
      const data = planDeleteBody.parse(input);
      return mutate(ctx, "PLAN_DELETED", id, data, async (tx) => {
        const plan = await tx.membershipPlan.findUnique({ where: { id } });
        if (!plan) throw fail(404, "Тариф не найден.");
        check(plan.version === versionSchema.parse(ctx.version), "Тариф изменился. Обновите страницу перед удалением.");
        await history(tx, ctx, "PLAN_DELETED", null, null, "", {
          planId: id,
          plan: JSON.parse(JSON.stringify(plan)),
        });
        await tx.membershipPlan.delete({ where: { id } });
        return { id };
      }, true);
    },
    async issue(ctx, input) {
      const data = issueBody.parse(input);
      return mutate(ctx, "MEMBERSHIP_ISSUED", null, input, async (tx) => {
        const p = await tx.membershipPlan.findFirst({
          where: { id: data.planId, active: true },
        });
        check(p, "Тариф недоступен.");
        check(
          p.version === data.planVersion,
          "Тариф изменился. Обновите форму оформления.",
        );
        check(
          data.price === p.priceCents || data.reason.length >= 3,
          "Укажите причину индивидуальной цены.",
        );
        check(
          p.duo
            ? !!data.partnerId && data.partnerId !== data.clientId
            : !data.partnerId,
          "Для Дуэта выберите двух разных клиентов. Для обычного тарифа второй клиент не нужен.",
        );
        const ids = p.duo ? [data.clientId, data.partnerId] : [data.clientId];
        const start = data.activation === "DATE" ? data.startDate : null;
        check(
          !start || start >= today(),
          "Новый абонемент нельзя оформить задним числом.",
        );
        const end = start ? endDate(start, p) : null;
        check(!end || end <= "2199-12-31", "Дата окончания слишком далека.");
        for (const id of ids) {
          const c = await client(tx, id);
          check(!c.archived, "Архивному клиенту нельзя оформить абонемент.");
          await overlap(tx, id, start, end);
        }
        const sale = await tx.membershipPurchase.create({
          data: { totalCents: data.price * ids.length, method: data.method },
        });
        const {
          id: planId,
          version,
          createdAt,
          updatedAt,
          active,
          publicVisible,
          publicOrder,
          ...snapshot
        } = p;
        const pairId = p.duo ? randomUUID() : null;
        let result;
        for (const id of ids) {
          const m = await tx.membership.create({
            data: {
              clientId: id,
              purchaseId: sale.id,
              pairId,
              snapshot: { ...snapshot, planId, activation: data.activation },
              priceCents: data.price,
              startDate: start ? dbDate(start) : null,
              endDate: end ? dbDate(end) : null,
              remaining: p.visits,
            },
          });
          await history(tx, ctx, "MEMBERSHIP_ISSUED", id, m.id, data.reason, {
            priceCents: data.price,
            purchaseId: sale.id,
            method: data.method,
            startDate: start,
            endDate: end,
            pairId,
          });
          if (id === data.clientId) result = { id: m.id, clientId: id };
        }
        return result;
      });
    },
    async membershipAction(ctx, id, action, input) {
      if (
        !["cancel", "extend", "adjust", "freeze", "thaw", "refund"].includes(
          action,
        )
      )
        throw fail(404, "Операция не найдена.");
      const data = actions[action].parse(input);
      return mutate(
        ctx,
        `MEMBERSHIP_${action.toUpperCase()}`,
        id,
        input,
        async (tx) => {
          const m = await member(tx, id, ctx.version);
          const at = today();
          if (action === "refund") {
            const refunded = m.refunds.reduce((s, r) => s + r.amountCents, 0);
            check(
              data.amount > 0 && data.amount <= m.priceCents - refunded,
              "Сумма превышает доступный возврат или равна нулю.",
            );
            await tx.membershipRefund.create({
              data: {
                membershipId: id,
                amountCents: data.amount,
                method: data.method,
              },
            });
            await tx.membership.update({
              where: { id },
              data: {
                cancelledAt: m.cancelledAt || new Date(),
                version: { increment: 1 },
              },
            });
            await history(
              tx,
              ctx,
              "MEMBERSHIP_REFUND",
              m.clientId,
              id,
              data.reason,
              { amountCents: data.amount, method: data.method },
            );
            return { id, clientId: m.clientId };
          }
          check(!m.cancelledAt, "Абонемент отменён.");
          if (action === "cancel") {
            await tx.membership.update({
              where: { id },
              data: { cancelledAt: new Date(), version: { increment: 1 } },
            });
            await history(
              tx,
              ctx,
              "MEMBERSHIP_CANCEL",
              m.clientId,
              id,
              data.reason,
            );
            return { id, clientId: m.clientId };
          }
          check(!m.client.archived, "Клиент в архиве.");
          if (action === "adjust") {
            check(
              m.remaining !== null,
              "У безлимитного абонемента нет остатка посещений.",
            );
            check(
              !m.endDate || dateString(m.endDate) >= at,
              "Срок абонемента истёк.",
            );
            check(m.remaining !== data.remaining, "Остаток не изменился.");
            if (data.remaining > 0 && m.remaining === 0)
              await overlap(
                tx,
                m.clientId,
                m.startDate ? dateString(m.startDate) : null,
                m.endDate ? dateString(m.endDate) : null,
                m.id,
              );
            await tx.membership.update({
              where: { id },
              data: { remaining: data.remaining, version: { increment: 1 } },
            });
            await history(
              tx,
              ctx,
              "MEMBERSHIP_ADJUST",
              m.clientId,
              id,
              data.reason,
              { before: m.remaining, after: data.remaining },
            );
            return { id, clientId: m.clientId };
          }
          const group = await companions(tx, m);
          for (const part of group) {
            check(
              !part.client.archived,
              "Один из клиентов Дуэта находится в архиве.",
            );
            if (action === "extend") {
              check(part.endDate, "У абонемента нет даты окончания.");
              const end = addDays(part.endDate, data.days);
              check(
                end > at && end <= "2199-12-31",
                "Укажите допустимый срок продления.",
              );
              await overlap(
                tx,
                part.clientId,
                dateString(part.startDate),
                end,
                part.id,
              );
              await tx.membership.update({
                where: { id: part.id },
                data: { endDate: dbDate(end), version: { increment: 1 } },
              });
              await history(
                tx,
                ctx,
                "MEMBERSHIP_EXTEND",
                part.clientId,
                part.id,
                data.reason,
                { before: dateString(part.endDate), after: end },
              );
            } else if (action === "freeze") {
              check(
                part.startDate &&
                  dateString(part.startDate) <= at &&
                  (!part.endDate || dateString(part.endDate) >= at) &&
                  part.remaining !== 0,
                "Заморозка доступна только действующему абонементу.",
              );
              check(
                data.endDate >= at,
                "Конец заморозки не может быть в прошлом.",
              );
              const freezes = await tx.membershipFreeze.findMany({
                where: {
                  membership: { clientId: part.clientId },
                  startDate: { gte: dbDate(addMonths(at, -4)) },
                },
              });
              const recent = freezes.some(
                (f) => addMonths(f.startDate, 3) > at,
              );
              check(
                !recent &&
                  !part.freezes.some((f) => dateString(f.endDate) >= at),
                "Заморозка доступна один раз в три календарных месяца.",
              );
              const days = dayCount(at, data.endDate);
              const end = part.endDate ? addDays(part.endDate, days) : null;
              check(
                !end || end <= "2199-12-31",
                "Дата окончания слишком далека.",
              );
              await overlap(
                tx,
                part.clientId,
                dateString(part.startDate),
                end,
                part.id,
              );
              await tx.membershipFreeze.create({
                data: {
                  membershipId: part.id,
                  startDate: dbDate(at),
                  endDate: dbDate(data.endDate),
                },
              });
              await tx.membership.update({
                where: { id: part.id },
                data: {
                  endDate: end ? dbDate(end) : null,
                  version: { increment: 1 },
                },
              });
              await history(
                tx,
                ctx,
                "MEMBERSHIP_FREEZE",
                part.clientId,
                part.id,
                data.reason,
                { startDate: at, endDate: data.endDate, days },
              );
            } else {
              const f = part.freezes.find(
                (f) =>
                  dateString(f.startDate) <= at && dateString(f.endDate) >= at,
              );
              check(f, "Нет текущей заморозки.");
              // End before today: access resumes today, including same-day undo (zero days).
              const newEnd = addDays(at, -1);
              const unused = dayCount(at, f.endDate);
              await tx.membershipFreeze.update({
                where: { id: f.id },
                data: { endDate: dbDate(newEnd) },
              });
              await tx.membership.update({
                where: { id: part.id },
                data: {
                  endDate: part.endDate
                    ? dbDate(addDays(part.endDate, -unused))
                    : null,
                  version: { increment: 1 },
                },
              });
              await history(
                tx,
                ctx,
                "MEMBERSHIP_THAW",
                part.clientId,
                part.id,
                data.reason,
                { endDate: newEnd, removedDays: unused },
              );
            }
          }
          return { id, clientId: m.clientId };
        },
        action === "refund",
      );
    },
    async list(context, query = {}) {
      if (
        !context?.active ||
        !["OWNER", "ADMIN", "TRAINER"].includes(context.role)
      )
        throw fail(403, "Доступ запрещён.");
      const f = filters.parse(query);
      const trainer = context.role === "TRAINER";
      let phoneQuery = f.q.replace(/[\s()+-]/g, "");
      if (phoneQuery.length === 11 && phoneQuery[0] === "8")
        phoneQuery = "7" + phoneQuery.slice(1);
      const where = {
        AND: [
          trainer ? trainerClientWhere(context) : {},
          f.archived === "all" ? {} : { archived: f.archived === "true" },
          f.q
            ? {
                OR: [
                  { name: { contains: f.q, mode: "insensitive" } },
                  ...(/^\d+$/.test(phoneQuery)
                    ? [{ phone: { contains: phoneQuery } }]
                    : []),
                ],
              }
            : {},
        ],
      };
      const select = trainer
        ? safeClient
        : { ...safeClient, archived: true, version: true };
      const [items, total] = await prisma.$transaction([
        prisma.client.findMany({
          where,
          select,
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 25,
          skip: (f.page - 1) * 25,
        }),
        prisma.client.count({ where }),
      ]);
      return {
        items: items.map((c) => ({
          ...c,
          birthDate: undefined,
          age: age(c.birthDate),
        })),
        total,
        filters: f,
      };
    },
    async get(context, id, query = {}) {
      if (
        !context?.active ||
        !["OWNER", "ADMIN", "TRAINER"].includes(context.role)
      )
        throw fail(403, "Доступ запрещён.");
      uuid.parse(id);
      const trainer = context.role === "TRAINER";
      const page = z.coerce.number().int().min(1).max(100000).default(1);
      const paging = (
        trainer
          ? z.object({ membershipsPage: page })
          : z.object({ membershipsPage: page, historyPage: page })
      )
        .strict()
        .parse(query);
      const memberSkip = (paging.membershipsPage - 1) * 25;
      const c = await prisma.client.findFirst({
        where: { id, ...(trainer ? trainerClientWhere(context) : {}) },
        select: trainer
          ? {
              ...safeClient,
              _count: { select: { memberships: true } },
              memberships: {
                select: safeMember,
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 25,
                skip: memberSkip,
              },
            }
          : {
              id: true,
              _count: { select: { memberships: true, events: true } },
              name: true,
              phone: true,
              birthDate: true,
              comment: true,
              archived: true,
              version: true,
              assignments: {
                where: { active: true },
                select: {
                  id: true,
                  trainer: {
                    select: {
                      user: {
                        select: {
                          id: true,
                          displayName: true,
                          active: true,
                          role: true,
                        },
                      },
                    },
                  },
                },
              },
              memberships: {
                include: { freezes: true, refunds: true, purchase: true },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                take: 25,
                skip: memberSkip,
              },
            },
      });
      if (!c) throw fail(404, "Клиент не найден.");
      const pagination = {
        membershipsPage: paging.membershipsPage,
        totalMemberships: c._count.memberships,
        ...(!trainer
          ? { historyPage: paging.historyPage, totalEvents: c._count.events }
          : {}),
      };
      if (trainer)
        return {
          pagination,
          id: c.id,
          name: c.name,
          phone: c.phone,
          age: age(c.birthDate),
          memberships: c.memberships.map((m) => ({
            id: m.id,
            name: m.snapshot.name,
            kind: m.snapshot.kind,
            weekdays: m.snapshot.weekdays,
            fromTime: m.snapshot.fromTime,
            toTime: m.snapshot.toTime,
            giftGym: m.snapshot.giftGym,
            startDate: m.startDate,
            endDate: m.endDate,
            remaining: m.remaining,
            status: membershipStatus(m),
          })),
        };
      const events = await prisma.crmEvent.findMany({
        where: { clientId: id },
        select: {
          id: true,
          action: true,
          reason: true,
          details: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
        skip: (paging.historyPage - 1) * 25,
      });
      const { _count, ...clientData } = c;
      return {
        ...clientData,
        pagination,
        age: age(c.birthDate),
        events,
        memberships: c.memberships.map((m) => ({
          ...m,
          status: membershipStatus(m),
        })),
      };
    },
    async plans() {
      return prisma.membershipPlan.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
      });
    },
    async trainers() {
      return prisma.user.findMany({
        where: { role: "TRAINER", active: true },
        select: { id: true, displayName: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      });
    },
  };
  return api;
}
