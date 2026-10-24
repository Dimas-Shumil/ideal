import { enqueueSchedulePush } from "../push/events.js";
import { createHash, randomUUID } from "node:crypto";
import { accessLock } from "../../db/client.js";
import { audit } from "../audit/service.js";
import { addDays, dateString, dbDate, endDate, today } from "../crm/dates.js";
import { trainerClientWhere } from "../../policies/trainer.js";
import {
  attendanceBody,
  bookBody,
  cancelBody,
  deleteBody,
  gymVisitBody,
  lessonCreate,
  lessonMove,
  lessonQuery,
  listQuery,
  uuid,
  version,
} from "./schema.js";
import {
  clubDateTime,
  clubParts,
  isoWeekday,
  localDayDistance,
  weeklyDates,
} from "./dates.js";

export const fail = (status, message) => Object.assign(new Error(message), { status });
const check = (condition, message = "Операция недоступна. Обновите страницу.") => {
  if (!condition) throw fail(409, message);
};
const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
      : value;
const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const activeBookingStatuses = ["BOOKED"];
const participantStatuses = ["BOOKED", "ATTENDED", "NO_SHOW"];

function snapshotValue(snapshot, key, fallback = null) {
  return snapshot && typeof snapshot === "object" && key in snapshot ? snapshot[key] : fallback;
}
function membershipMode(membership) {
  const explicit = snapshotValue(membership.snapshot, "activation");
  if (explicit === "FIRST_VISIT" || explicit === "DATE") return explicit;
  return membership.startDate ? "DATE" : "FIRST_VISIT";
}
function membershipKind(membership) {
  return snapshotValue(membership.snapshot, "kind", "");
}
function membershipEnd(start, membership) {
  return endDate(start, {
    months: Number(snapshotValue(membership.snapshot, "months", 0)) || 0,
    days: Number(snapshotValue(membership.snapshot, "days", 0)) || 0,
  });
}
function beforePurchase(occurredAt, createdAt) {
  const occurred = clubParts(occurredAt);
  const created = clubParts(createdAt);
  return `${occurred.date}T${occurred.time}` < `${created.date}T${created.time}`;
}
function localRange(startsAt, endsAt = startsAt) {
  return { start: clubParts(startsAt), end: clubParts(endsAt) };
}
function withinSnapshot(membership, startsAt, endsAt = startsAt, { gift = false } = {}) {
  const range = localRange(startsAt, endsAt);
  if (range.start.date !== range.end.date) return false;
  const weekdays = String(snapshotValue(membership.snapshot, "weekdays", ""))
    .split(",")
    .filter(Boolean)
    .map(Number);
  if (!weekdays.includes(isoWeekday(range.start.date))) return false;
  const from = String(snapshotValue(membership.snapshot, "fromTime", "00:00"));
  const to = String(snapshotValue(membership.snapshot, "toTime", "23:59"));
  if (range.start.time < from || range.end.time > to) return false;
  if (membership.cancelledAt || membership.remaining === 0) return false;
  if (gift && membershipKind(membership) !== "GROUP") return false;
  if (membership.startDate && dateString(membership.startDate) > range.start.date) return false;
  if (membership.endDate && dateString(membership.endDate) < range.start.date) return false;
  if (
    membership.freezes?.some(
      (freeze) => dateString(freeze.startDate) <= range.start.date && dateString(freeze.endDate) >= range.start.date,
    )
  )
    return false;
  return true;
}

export function scheduleService(prisma) {
  async function mutate(ctx, action, targetId, raw, roles, callback) {
    uuid.parse(ctx.key);
    if (targetId) uuid.parse(targetId);
    const fp = fingerprint({ action, targetId, raw, version: ctx.version });
    return prisma.$transaction(
      async (tx) => {
        await accessLock(tx);
        const actor = await tx.user.findUnique({ where: { id: ctx.actorId } });
        if (!actor?.active || actor.authVersion !== ctx.authVersion || !roles.includes(actor.role))
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
          check(previous.fingerprint === fp, "Эта форма уже использована для другой операции.");
          return previous.result;
        }
        const result = await callback(tx, actor);
        await tx.crmOperation.create({ data: { actorId: actor.id, key: ctx.key, fingerprint: fp, result } });
        await audit(tx, action, { actorId: actor.id, targetId: targetId || result.id || null, requestId: ctx.requestId });
        return result;
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }

  async function scheduleHistory(tx, ctx, action, lessonId, reason = "", details = {}) {
    const jsonDetails = JSON.parse(JSON.stringify(details));
    return tx.scheduleEvent.create({
      data: { lessonId, actorId: ctx.actorId, action, reason, details: jsonDetails },
    });
  }
  async function clientHistory(tx, ctx, action, clientId, membershipId, reason = "", details = {}) {
    return tx.crmEvent.create({
      data: { clientId, membershipId, actorId: ctx.actorId, action, reason, details },
    });
  }
  async function trainerProfileForActor(tx, actor) {
    if (actor.role !== "TRAINER") return null;
    return tx.trainerProfile.findFirst({
      where: {
        userId: actor.id,
        user: { active: true, role: "TRAINER", authVersion: actor.authVersion },
      },
    });
  }
  async function lessonForActor(tx, actor, id, expected = undefined) {
    uuid.parse(id);
    const where = { id };
    if (actor.role === "TRAINER") {
      const profile = await trainerProfileForActor(tx, actor);
      if (!profile) throw fail(404, "Занятие не найдено.");
      where.trainerId = profile.id;
    }
    const lesson = await tx.lesson.findFirst({
      where,
      include: {
        trainer: { include: { user: { select: { id: true, displayName: true, active: true, role: true } } } },
        bookings: { include: { client: true, visits: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        events: { include: { actor: { select: { displayName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30 },
      },
    });
    if (!lesson) throw fail(404, "Занятие не найдено.");
    if (expected !== undefined) check(lesson.version === version.parse(expected));
    return lesson;
  }
  async function ensureLessonSlot(tx, { trainerId, startsAt, endsAt, room, ignoreId = null }) {
    const overlap = { startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, status: "SCHEDULED", ...(ignoreId ? { id: { not: ignoreId } } : {}) };
    check(
      !(await tx.lesson.findFirst({ where: { ...overlap, trainerId }, select: { id: true } })),
      "У тренера уже есть пересекающееся занятие.",
    );
    if (room)
      check(
        !(await tx.lesson.findFirst({ where: { ...overlap, room: { equals: room, mode: "insensitive" } }, select: { id: true } })),
        "Помещение уже занято в это время.",
      );
  }
  async function ensureClientSlot(tx, clientId, lesson) {
    const conflict = await tx.lessonBooking.findFirst({
      where: {
        clientId,
        status: { in: activeBookingStatuses },
        lessonId: { not: lesson.id },
        lesson: {
          status: "SCHEDULED",
          startsAt: { lt: lesson.endsAt },
          endsAt: { gt: lesson.startsAt },
        },
      },
      select: { id: true },
    });
    check(!conflict, "Клиент уже записан на другое занятие в это время.");
  }
  async function findMembership(tx, clientId, kind, startsAt, endsAt = startsAt) {
    const memberships = await tx.membership.findMany({
      where: { clientId, cancelledAt: null },
      include: { freezes: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    for (const membership of memberships) {
      if (membershipKind(membership) !== kind || !withinSnapshot(membership, startsAt, endsAt)) continue;
      if (beforePurchase(startsAt, membership.createdAt))
        continue;
      if (!membership.startDate && membershipMode(membership) !== "FIRST_VISIT") continue;
      const localDate = clubParts(startsAt).date;
      if (!membership.startDate) {
        const hypotheticalEnd = membershipEnd(localDate, membership);
        if (hypotheticalEnd && hypotheticalEnd < localDate) continue;
      }
      return { membership, entitlement: "MEMBER" };
    }
    if (kind === "GYM") {
      for (const membership of memberships) {
        if (
          membershipKind(membership) !== "GROUP" ||
          !snapshotValue(membership.snapshot, "giftGym", false) ||
          !membership.startDate ||
          !withinSnapshot(membership, startsAt, endsAt, { gift: true }) ||
          beforePurchase(startsAt, membership.createdAt)
        )
          continue;
        const used = await tx.visit.count({
          where: { membershipId: membership.id, entitlement: "GIFT_GYM", status: "CONFIRMED" },
        });
        if (!used) return { membership, entitlement: "GIFT_GYM" };
      }
    }
    return null;
  }
  async function activateMembership(tx, membership, occurredAt) {
    if (membership.startDate) return false;
    const start = clubParts(occurredAt).date;
    const group = membership.pairId
      ? await tx.membership.findMany({ where: { pairId: membership.pairId }, include: { freezes: true } })
      : [membership];
    for (const part of group) {
      if (part.startDate) continue;
      const snapshot = { ...(part.snapshot || {}), activation: "FIRST_VISIT" };
      const end = membershipEnd(start, { ...part, snapshot });
      await tx.membership.update({
        where: { id: part.id },
        data: { snapshot, startDate: dbDate(start), endDate: end ? dbDate(end) : null, version: { increment: 1 } },
      });
    }
    return true;
  }
  async function restoreFirstVisitActivation(tx, membership) {
    if (membershipMode(membership) !== "FIRST_VISIT") return;
    const group = membership.pairId
      ? await tx.membership.findMany({ where: { pairId: membership.pairId } })
      : [membership];
    const ids = group.map((part) => part.id);
    const earliest = await tx.visit.findFirst({
      where: { membershipId: { in: ids }, entitlement: "MEMBER", status: "CONFIRMED" },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    const start = earliest ? clubParts(earliest.occurredAt).date : null;
    for (const part of group) {
      const snapshot = { ...(part.snapshot || {}), activation: "FIRST_VISIT" };
      const end = start ? membershipEnd(start, { ...part, snapshot }) : null;
      if (start) {
        const conflicts = await tx.membership.findMany({
          where: {
            clientId: part.clientId,
            id: { not: part.id },
            cancelledAt: null,
            OR: [{ remaining: null }, { remaining: { gt: 0 } }],
          },
        });
        check(
          !conflicts.some(
            (other) =>
              !other.startDate ||
              (dateString(other.startDate) <= (end || "2199-12-31") && (!other.endDate || dateString(other.endDate) >= start)),
          ),
          "Исправление посещения изменит срок абонемента и пересечёт другой абонемент.",
        );
      }
      await tx.membership.update({
        where: { id: part.id },
        data: { snapshot, startDate: start ? dbDate(start) : null, endDate: end ? dbDate(end) : null, version: { increment: 1 } },
      });
    }
  }
  async function consume(tx, membership, entitlement) {
    if (entitlement !== "MEMBER" || membership.remaining === null) return;
    check(membership.remaining > 0, "Посещения по абонементу закончились.");
    const changed = await tx.membership.updateMany({
      where: { id: membership.id, remaining: { gt: 0 } },
      data: { remaining: { decrement: 1 }, version: { increment: 1 } },
    });
    check(changed.count === 1, "Посещение уже было списано конкурентным запросом.");
  }
  async function restoreConsumption(tx, visit) {
    if (visit.entitlement !== "MEMBER" || !visit.membershipId) return;
    const membership = await tx.membership.findUnique({ where: { id: visit.membershipId } });
    if (!membership) return;
    if (membership.remaining !== null)
      await tx.membership.update({ where: { id: membership.id }, data: { remaining: { increment: 1 }, version: { increment: 1 } } });
    await restoreFirstVisitActivation(tx, membership);
  }
  function correctionAllowed(actor, occurredAt) {
    const eventDate = clubParts(occurredAt).date;
    const distance = localDayDistance(eventDate, today());
    if (distance < 0) return false;
    return distance <= (actor.role === "TRAINER" ? 1 : 6);
  }
  async function recordVisit(tx, ctx, actor, { clientId, kind, occurredAt, endsAt = occurredAt, lessonId = null, bookingId = null, reason = "" }) {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    check(client && !client.archived, "Клиент не найден или находится в архиве.");
    check(occurredAt <= new Date(), "Нельзя отметить будущее посещение.");
    check(correctionAllowed(actor, occurredAt), actor.role === "TRAINER" ? "Тренер может исправлять посещения только до конца следующего календарного дня." : "Посещение можно исправить только за последние 7 календарных дней.");
    let membership = null;
    let entitlement = "NONE";
    let activated = false;
    if (kind !== "PERSONAL") {
      const access = await findMembership(tx, clientId, kind, occurredAt, endsAt);
      check(access, kind === "GYM" ? "Нет допустимого абонемента или доступного подарочного посещения зала." : "Абонемент не допускает клиента к этому занятию.");
      membership = access.membership;
      entitlement = access.entitlement;
      if (entitlement === "MEMBER") activated = await activateMembership(tx, membership, occurredAt);
      const fresh = await tx.membership.findUnique({ where: { id: membership.id }, include: { freezes: true } });
      check(fresh && withinSnapshot(fresh, occurredAt, endsAt), "Абонемент не допускает это посещение после активации.");
      await consume(tx, fresh, entitlement);
      membership = fresh;
    }
    const visit = await tx.visit.create({
      data: {
        clientId,
        membershipId: membership?.id || null,
        lessonId,
        bookingId,
        kind,
        entitlement,
        occurredAt,
        recordedById: actor.id,
        reason,
      },
    });
    await clientHistory(tx, ctx, "VISIT_RECORDED", clientId, membership?.id || null, reason, {
      visitId: visit.id,
      lessonId,
      kind,
      entitlement,
      activated,
    });
    return visit;
  }
  async function reverseVisitInTx(tx, ctx, actor, visit, reason, { lessonCancellation = false } = {}) {
    check(visit.status === "CONFIRMED", "Посещение уже отменено.");
    check(
      lessonCancellation || correctionAllowed(actor, visit.occurredAt),
      actor.role === "TRAINER" ? "Срок исправления посещения тренером истёк." : "Срок исправления посещения истёк.",
    );
    await tx.visit.update({
      where: { id: visit.id },
      data: { status: "REVERSED", reversedAt: new Date(), reversedById: actor.id, reversedReason: reason, version: { increment: 1 } },
    });
    await restoreConsumption(tx, visit);
    if (visit.bookingId)
      await tx.lessonBooking.updateMany({
        where: { id: visit.bookingId, status: "ATTENDED" },
        data: { status: "BOOKED", version: { increment: 1 } },
      });
    await clientHistory(tx, ctx, "VISIT_REVERSED", visit.clientId, visit.membershipId, reason, {
      visitId: visit.id,
      lessonId: visit.lessonId,
      kind: visit.kind,
    });
  }

  const api = {
    async list(context, query = {}) {
      if (!context?.active || !["OWNER", "ADMIN", "TRAINER"].includes(context.role)) throw fail(403, "Доступ запрещён.");
      const f = listQuery.parse(query);
      const from = f.from || today();
      const to = f.to || addDays(from, 30);
      check(to >= from && localDayDistance(from, to) <= 366, "Диапазон расписания: не более 366 дней.");
      const where = {
        startsAt: { gte: clubDateTime(from, "00:00"), lte: clubDateTime(to, "23:59") },
        ...(f.kind ? { kind: f.kind } : {}),
        ...(f.status ? { status: f.status } : {}),
      };
      if (context.role === "TRAINER") {
        where.trainer = { user: { id: context.id, active: true, role: "TRAINER", authVersion: context.authVersion } };
      } else if (f.trainer) {
        where.trainer = { userId: f.trainer };
      }
      const items = await prisma.lesson.findMany({
        where,
        include: {
          trainer: { include: { user: { select: { id: true, displayName: true } } } },
          _count: { select: { bookings: { where: { status: { in: participantStatuses } } } } },
        },
        orderBy: [{ startsAt: "asc" }, { id: "asc" }],
        take: 500,
      });
      return { items, filters: { ...f, from, to } };
    },
    async get(context, id, query = {}) {
      if (!context?.active || !["OWNER", "ADMIN", "TRAINER"].includes(context.role)) throw fail(403, "Доступ запрещён.");
      const q = lessonQuery.parse(query);
      const actor = context;
      const lesson = await (async () => {
        const where = { id: uuid.parse(id) };
        if (actor.role === "TRAINER")
          where.trainer = { user: { id: actor.id, active: true, role: "TRAINER", authVersion: actor.authVersion } };
        return prisma.lesson.findFirst({
          where,
          include: {
            trainer: { include: { user: { select: { id: true, displayName: true } } } },
            bookings: {
              include: { client: { select: { id: true, name: true } }, visits: { select: { id: true, status: true, occurredAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
            events: { include: { actor: { select: { displayName: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 30 },
          },
        });
      })();
      if (!lesson) throw fail(404, "Занятие не найдено.");
      const candidateWhere = {
        archived: false,
        ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}),
        ...(context.role === "TRAINER" ? trainerClientWhere(context) : {}),
      };
      const candidates = await prisma.client.findMany({
        where: candidateWhere,
        select: { id: true, name: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 100,
      });
      const canDeleteLesson = context.role === "OWNER" && lesson.status === "CANCELLED" &&
        lesson.bookings.every(b => b.status === "CANCELLED") &&
        !(await prisma.visit.count({ where: { lessonId: lesson.id } }));
      return { lesson, candidates, query: q, canDeleteLesson };
    },
    async trainers() {
      return prisma.user.findMany({
        where: { role: "TRAINER", active: true },
        select: { id: true, displayName: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }],
      });
    },
    async create(ctx, input) {
      const data = lessonCreate.parse(input);
      check(data.date >= today(), "Новое занятие нельзя создать в прошлом.");
      const dates = data.repeat === "WEEKLY" ? weeklyDates(data.date, data.repeatUntil, data.weekdays) : [data.date];
      check(dates.length > 0, "В выбранном диапазоне нет подходящих дней недели.");
      check(data.repeat !== "WEEKLY" || data.repeatUntil >= data.date, "Дата окончания серии раньше первого занятия.");
      check(data.repeat !== "WEEKLY" || localDayDistance(data.date, data.repeatUntil) <= 366, "Серия не может быть длиннее 366 дней.");
      return mutate(ctx, "LESSON_CREATED", null, input, ["OWNER", "ADMIN"], async (tx, actor) => {
        const trainer = await tx.user.findFirst({ where: { id: data.trainerId, active: true, role: "TRAINER" } });
        check(trainer, "Выберите действующего тренера.");
        const profile = await tx.trainerProfile.upsert({ where: { userId: trainer.id }, create: { userId: trainer.id }, update: {} });
        const capacity = data.kind === "PERSONAL" ? 1 : data.capacity;
        const seriesId = dates.length > 1 ? randomUUID() : null;
        const created = [];
        for (const date of dates) {
          const startsAt = clubDateTime(date, data.startTime);
          const endsAt = clubDateTime(date, data.endTime);
          check(startsAt > new Date(), "Новое занятие должно начинаться в будущем.");
          await ensureLessonSlot(tx, { trainerId: profile.id, startsAt, endsAt, room: data.room });
          const lesson = await tx.lesson.create({
            data: {
              seriesId,
              kind: data.kind,
              title: data.title,
              startsAt,
              endsAt,
              trainerId: profile.id,
              room: data.room,
              capacity,
              createdById: actor.id,
            },
          });
          await scheduleHistory(tx, ctx, "LESSON_CREATED", lesson.id, "", { seriesId, kind: data.kind, startsAt, endsAt, capacity, room: data.room });
          created.push(lesson.id);
        }
        return { id: created[0], ids: created, count: created.length };
      });
    },
    async move(ctx, id, input) {
      const data = lessonMove.parse(input);
      const expectedVersion = version.parse(ctx.version);
      return mutate(ctx, "LESSON_MOVED", id, input, ["OWNER", "ADMIN"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id, expectedVersion);
        check(lesson.status === "SCHEDULED", "Отменённое занятие нельзя переносить.");
        check(lesson.startsAt > new Date(), "Начавшееся занятие нельзя переносить.");
        const startsAt = clubDateTime(data.date, data.startTime);
        const endsAt = clubDateTime(data.date, data.endTime);
        check(endsAt > startsAt, "Начало должно быть раньше окончания.");
        check(startsAt > new Date(), "Перенести занятие можно только на будущее время.");
        await ensureLessonSlot(tx, { trainerId: lesson.trainerId, startsAt, endsAt, room: data.room, ignoreId: lesson.id });
        const participants = lesson.bookings.filter((booking) => activeBookingStatuses.includes(booking.status));
        for (const booking of participants) {
          const probe = { ...lesson, startsAt, endsAt };
          await ensureClientSlot(tx, booking.clientId, probe);
          if (lesson.kind === "GROUP")
            check(await findMembership(tx, booking.clientId, "GROUP", startsAt, endsAt), `Абонемент клиента «${booking.client.name}» не допускает перенесённое занятие.`);
        }
        await tx.lesson.update({ where: { id }, data: { startsAt, endsAt, room: data.room, version: { increment: 1 } } });
        await enqueueSchedulePush(tx, ctx, "LESSON_MOVED", id, participants.length > 0);
        await scheduleHistory(tx, ctx, "LESSON_MOVED", id, data.reason, { before: { startsAt: lesson.startsAt, endsAt: lesson.endsAt, room: lesson.room }, after: { startsAt, endsAt, room: data.room } });
        return { id };
      });
    },
    async cancelLesson(ctx, id, input) {
      const data = cancelBody.parse(input);
      const expectedVersion = version.parse(ctx.version);
      return mutate(ctx, "LESSON_CANCELLED", id, input, ["OWNER", "ADMIN"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id, expectedVersion);
        check(lesson.status === "SCHEDULED", "Занятие уже отменено.");
        const visits = await tx.visit.findMany({ where: { lessonId: id, status: "CONFIRMED" }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }] });
        for (const visit of visits) await reverseVisitInTx(tx, ctx, actor, visit, data.reason, { lessonCancellation: true });
        await tx.lessonBooking.updateMany({
          where: { lessonId: id, status: { in: ["BOOKED", "NO_SHOW"] } },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: data.reason, version: { increment: 1 } },
        });
        await tx.lesson.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: data.reason, version: { increment: 1 } } });
        await enqueueSchedulePush(tx, ctx, "LESSON_CANCELLED", id, lesson.bookings.some(b => ["BOOKED", "ATTENDED"].includes(b.status)));
        await scheduleHistory(tx, ctx, "LESSON_CANCELLED", id, data.reason, { compensatedVisits: visits.length });
        return { id };
      });
    },
    async deleteBooking(ctx, id, bookingId, input) {
      const data = deleteBody.parse(input);
      uuid.parse(id);
      uuid.parse(bookingId);
      const expected = version.parse(ctx.version);
      return mutate(ctx, "BOOKING_DELETED", bookingId, { ...input, lessonId: id }, ["OWNER"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id);
        const booking = await tx.lessonBooking.findFirst({ where: { id: bookingId, lessonId: id } });
        if (!booking) throw fail(404, "Запись не найдена.");
        check(booking.version === expected);
        check(booking.status === "CANCELLED", "Сначала отмените запись клиента.");
        check(!(await tx.visit.count({ where: { bookingId } })), "Запись связана с посещением. Удаление запрещено, даже если посещение исправлено.");
        await clientHistory(tx, ctx, "BOOKING_DELETED", booking.clientId, null, data.reason, { lessonId: id, bookingId });
        await scheduleHistory(tx, ctx, "BOOKING_DELETED", id, data.reason, { bookingId, clientId: booking.clientId });
        await tx.lessonBooking.delete({ where: { id: bookingId } });
        return { id: lesson.id, bookingId };
      });
    },
    async deleteLesson(ctx, id, input) {
      const data = deleteBody.parse(input);
      const expected = version.parse(ctx.version);
      return mutate(ctx, "LESSON_DELETED", id, input, ["OWNER"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id, expected);
        check(lesson.status === "CANCELLED", "Сначала отмените занятие и уведомите участников.");
        check(lesson.bookings.every(b => b.status === "CANCELLED"), "У занятия есть записи, которые нельзя удалить.");
        const bookingIds = lesson.bookings.map(b => b.id);
        check(!(await tx.visit.count({ where: { OR: [{ lessonId: id }, { bookingId: { in: bookingIds } }] } })),
          "Занятие связано с посещениями. Удаление запрещено, даже если посещения исправлены.");
        for (const booking of lesson.bookings)
          await clientHistory(tx, ctx, "BOOKING_DELETED", booking.clientId, null, data.reason, { lessonId: id, bookingId: booking.id });
        await scheduleHistory(tx, ctx, "LESSON_DELETED", id, data.reason, {
          deletedLessonId: id, title: lesson.title, startsAt: lesson.startsAt, endsAt: lesson.endsAt,
          trainerId: lesson.trainerId, bookingIds,
        });
        // Keep the historical journal while removing the operational entity. No schema change.
        await tx.$executeRaw`UPDATE "ScheduleEvent" SET "lessonId"=NULL,
          "details"="details" || jsonb_build_object('deletedLessonId', ${id}::text)
          WHERE "lessonId"=${id}::uuid`;
        await tx.lessonBooking.deleteMany({ where: { lessonId: id } });
        await tx.lesson.delete({ where: { id } });
        return { id, deleted: true };
      });
    },
    async book(ctx, id, input) {
      const data = bookBody.parse(input);
      return mutate(ctx, "LESSON_BOOKED", id, input, ["OWNER", "ADMIN", "TRAINER"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id);
        check(lesson.status === "SCHEDULED", "Нельзя записать на отменённое занятие.");
        check(lesson.startsAt > new Date(), "Запись доступна только до начала занятия.");
        const client = await tx.client.findUnique({ where: { id: data.clientId } });
        check(client && !client.archived, "Клиент не найден или находится в архиве.");
        if (actor.role === "TRAINER") {
          const allowed = await tx.client.findFirst({ where: { id: client.id, ...trainerClientWhere(actor) }, select: { id: true } });
          check(allowed, "Тренер может записывать только назначенных ему клиентов.");
        }
        await ensureClientSlot(tx, client.id, lesson);
        if (lesson.kind === "GROUP") check(await findMembership(tx, client.id, "GROUP", lesson.startsAt, lesson.endsAt), "Абонемент клиента не допускает это занятие.");
        const occupied = await tx.lessonBooking.count({ where: { lessonId: lesson.id, status: "BOOKED" } });
        const existing = await tx.lessonBooking.findUnique({ where: { lessonId_clientId: { lessonId: lesson.id, clientId: client.id } } });
        if (!existing || existing.status === "CANCELLED") check(occupied < lesson.capacity, "Свободных мест больше нет.");
        let booking;
        if (!existing)
          booking = await tx.lessonBooking.create({ data: { lessonId: lesson.id, clientId: client.id, bookedById: actor.id } });
        else {
          check(existing.status === "CANCELLED", "Клиент уже находится в составе занятия.");
          booking = await tx.lessonBooking.update({ where: { id: existing.id }, data: { status: "BOOKED", bookedById: actor.id, cancelledAt: null, cancelReason: "", version: { increment: 1 } } });
        }
        await enqueueSchedulePush(tx, ctx, "LESSON_BOOKED", lesson.id);
        await scheduleHistory(tx, ctx, "LESSON_BOOKED", lesson.id, data.reason, { bookingId: booking.id, clientId: client.id });
        await clientHistory(tx, ctx, "LESSON_BOOKED", client.id, null, data.reason, { lessonId: lesson.id, bookingId: booking.id });
        return { id: lesson.id, bookingId: booking.id };
      });
    },
    async cancelBooking(ctx, id, bookingId, input) {
      const data = cancelBody.parse(input);
      uuid.parse(bookingId);
      return mutate(ctx, "BOOKING_CANCELLED", bookingId, input, ["OWNER", "ADMIN", "TRAINER"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id);
        const booking = await tx.lessonBooking.findFirst({ where: { id: bookingId, lessonId: lesson.id }, include: { client: true } });
        if (!booking) throw fail(404, "Запись не найдена.");
        check(booking.status === "BOOKED", "Можно отменить только действующую запись.");
        check(lesson.startsAt > new Date(), "После начала занятия запись исправляется через посещение/неявку.");
        if (actor.role === "TRAINER") {
          const allowed = await tx.client.findFirst({ where: { id: booking.clientId, ...trainerClientWhere(actor) }, select: { id: true } });
          check(allowed, "Тренер может отменять запись только назначенного ему клиента.");
        }
        await tx.lessonBooking.update({ where: { id: booking.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: data.reason, version: { increment: 1 } } });
        await enqueueSchedulePush(tx, ctx, "BOOKING_CANCELLED", lesson.id);
        await scheduleHistory(tx, ctx, "BOOKING_CANCELLED", lesson.id, data.reason, { bookingId: booking.id, clientId: booking.clientId });
        await clientHistory(tx, ctx, "BOOKING_CANCELLED", booking.clientId, null, data.reason, { lessonId: lesson.id, bookingId: booking.id });
        return { id: lesson.id, bookingId: booking.id };
      });
    },
    async attendance(ctx, id, bookingId, input) {
      const data = attendanceBody.parse(input);
      uuid.parse(bookingId);
      return mutate(ctx, data.status === "ATTENDED" ? "VISIT_RECORDED" : "NO_SHOW_RECORDED", bookingId, input, ["OWNER", "ADMIN", "TRAINER"], async (tx, actor) => {
        const lesson = await lessonForActor(tx, actor, id);
        check(lesson.status === "SCHEDULED", "У отменённого занятия нельзя отмечать посещение.");
        check(lesson.startsAt <= new Date(), "Занятие ещё не началось.");
        check(correctionAllowed(actor, lesson.startsAt), actor.role === "TRAINER" ? "Срок отметки тренером истёк." : "Срок отметки посещения истёк.");
        const booking = await tx.lessonBooking.findFirst({ where: { id: bookingId, lessonId: lesson.id }, include: { visits: true, client: true } });
        if (!booking) throw fail(404, "Запись не найдена.");
        if (data.status === "NO_SHOW") {
          check(booking.status === "BOOKED", "Неявка уже отмечена или посещение требует отдельной отмены.");
          await tx.lessonBooking.update({ where: { id: booking.id }, data: { status: "NO_SHOW", version: { increment: 1 } } });
          await scheduleHistory(tx, ctx, "NO_SHOW_RECORDED", lesson.id, data.reason, { bookingId: booking.id, clientId: booking.clientId });
          await clientHistory(tx, ctx, "NO_SHOW_RECORDED", booking.clientId, null, data.reason, { lessonId: lesson.id, bookingId: booking.id });
          return { id: lesson.id, bookingId: booking.id };
        }
        check(["BOOKED", "NO_SHOW"].includes(booking.status), "Посещение уже отмечено.");
        check(!booking.visits.some((visit) => visit.status === "CONFIRMED"), "Для записи уже существует подтверждённое посещение.");
        const visit = await recordVisit(tx, ctx, actor, {
          clientId: booking.clientId,
          kind: lesson.kind,
          occurredAt: lesson.startsAt,
          endsAt: lesson.endsAt,
          lessonId: lesson.id,
          bookingId: booking.id,
          reason: data.reason,
        });
        await tx.lessonBooking.update({ where: { id: booking.id }, data: { status: "ATTENDED", version: { increment: 1 } } });
        await scheduleHistory(tx, ctx, "VISIT_RECORDED", lesson.id, data.reason, { bookingId: booking.id, clientId: booking.clientId, visitId: visit.id });
        return { id: lesson.id, bookingId: booking.id, visitId: visit.id };
      });
    },
    async gymVisit(ctx, input) {
      const data = gymVisitBody.parse(input);
      const occurredAt = clubDateTime(data.date, data.time);
      return mutate(ctx, "VISIT_RECORDED", null, input, ["OWNER", "ADMIN"], async (tx, actor) => {
        const visit = await recordVisit(tx, ctx, actor, { clientId: data.clientId, kind: "GYM", occurredAt, reason: data.reason });
        return { id: visit.id, clientId: visit.clientId };
      });
    },
    async reverseVisit(ctx, visitId, input) {
      const data = cancelBody.parse(input);
      uuid.parse(visitId);
      return mutate(ctx, "VISIT_REVERSED", visitId, input, ["OWNER", "ADMIN", "TRAINER"], async (tx, actor) => {
        const visit = await tx.visit.findUnique({
          where: { id: visitId },
          include: { lesson: { include: { trainer: { include: { user: true } } } } },
        });
        if (!visit) throw fail(404, "Посещение не найдено.");
        if (actor.role === "TRAINER") {
          check(visit.lesson && visit.lesson.trainer.userId === actor.id && visit.lesson.trainer.user.active && visit.lesson.trainer.user.authVersion === actor.authVersion, "Тренер может исправлять только посещения своих занятий.");
        }
        await reverseVisitInTx(tx, ctx, actor, visit, data.reason);
        if (visit.lessonId) await scheduleHistory(tx, ctx, "VISIT_REVERSED", visit.lessonId, data.reason, { visitId: visit.id, clientId: visit.clientId });
        return { id: visit.lessonId || visit.id, visitId: visit.id };
      });
    },
    async recentVisits(context, query = {}) {
      if (!context?.active || !["OWNER", "ADMIN"].includes(context.role)) throw fail(403, "Доступ запрещён.");
      const q = lessonQuery.parse(query);
      const items = await prisma.visit.findMany({
        where: q.q ? { client: { name: { contains: q.q, mode: "insensitive" } } } : {},
        include: { client: { select: { id: true, name: true } }, lesson: { select: { id: true, title: true } }, membership: { select: { snapshot: true } }, recordedBy: { select: { displayName: true } } },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      return { items, query: q };
    },
  };
  return api;
}
