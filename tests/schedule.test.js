import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes, randomUUID } from "node:crypto";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { createApp } from "../server/app.js";
import { clearCrm } from "./helpers/crm.js";
import { addDays, dateString, today } from "../server/modules/crm/dates.js";
import { clubDateTime, isoWeekday } from "../server/modules/schedule/dates.js";

const config = readConfig();
if (config.NODE_ENV !== "test" || !new URL(config.DATABASE_URL).pathname.endsWith("_test")) throw new Error("TEST_DB_REQUIRED");
const db = createDatabase(config.DATABASE_URL);
const secret = randomBytes(24).toString("hex");
const origin = config.APP_ORIGIN;
let app, store, users, owner, admin, ta, tb;

async function login(name) {
  const agent = request.agent(app);
  const page = await agent.get("/login").expect(200);
  const _csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await agent.post("/login").set("Origin", origin).type("form").send({ login: name, password: secret, _csrf }).expect(303);
  const me = await agent.get("/api/auth/me").expect(200);
  return { agent, token: me.body.csrf, user: me.body.user };
}
async function post(session, path, data = {}, expected = 200, key = randomUUID()) {
  return session.agent.post("/api" + path).set("Origin", origin).send({ _csrf: session.token, key, ...data }).expect(expected);
}
async function makeClient(session, name = "Клиент") {
  return (await post(session, "/crm/clients", { name: `${name} ${randomUUID().slice(0, 6)}`, phone: "7999" + Math.floor(1000000 + Math.random() * 8999999), birthDate: "1990-05-20", comment: "PRIVATE" })).body.id;
}
async function makePlan(session, { kind = "GROUP", visits = "8", duo = "false", giftGym = "false", weekdays = String(isoWeekday(today())) } = {}) {
  return (await post(session, "/crm/plans", { name: `Тариф ${randomUUID().slice(0, 6)}`, kind, price: "3200", months: "1", days: "0", visits, weekdays, fromTime: "00:00", toTime: "23:59", giftGym, duo, active: "true" })).body.id;
}
async function issue(session, clientId, planId, { activation = "DATE", startDate = today(), partnerId = "" } = {}) {
  return post(session, "/crm/memberships", { clientId, partnerId, planId, planVersion: 1, activation, startDate: activation === "DATE" ? startDate : "", price: "3200", method: "CASH", reason: "" });
}
async function profile(userId) {
  return db.prisma.trainerProfile.upsert({ where: { userId }, create: { userId }, update: {} });
}
async function directLesson({ trainerUserId = ta.id, kind = "GROUP", date = addDays(today(), -1), start = "12:00", end = "13:00", capacity = 10, title = "Тестовое занятие" } = {}) {
  const trainer = await profile(trainerUserId);
  return db.prisma.lesson.create({ data: { kind, title, startsAt: clubDateTime(date, start), endsAt: clubDateTime(date, end), trainerId: trainer.id, capacity: kind === "PERSONAL" ? 1 : capacity, createdById: owner.id } });
}
async function directBooking(lessonId, clientId) {
  return db.prisma.lessonBooking.create({ data: { lessonId, clientId, bookedById: admin.id } });
}

before(async () => {
  await clearCrm(db.prisma);
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.authSession.deleteMany();
  await db.prisma.user.deleteMany();
  ({ app, store, users } = await createApp({ config, db }));
  for (const [loginName, role] of [["schedowner", "OWNER"], ["schedadmin", "ADMIN"], ["schedta", "TRAINER"], ["schedtb", "TRAINER"]]) {
    const user = await users.create({ login: loginName, displayName: loginName, role, password: secret });
    if (role === "OWNER") owner = user;
    else if (role === "ADMIN") admin = user;
    else if (loginName === "schedta") ta = user;
    else tb = user;
  }
});
beforeEach(async () => {
  store.close();
  ({ app, store, users } = await createApp({ config, db }));
});
after(async () => {
  store?.close();
  await clearCrm(db.prisma);
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.authSession.deleteMany();
  await db.prisma.user.deleteMany();
  await db.close();
});

test("schedule: pages and APIs are independently role-guarded", async () => {
  for (const path of ["/crm/schedule", "/crm/visits", "/trainer/lessons"]) await request(app).get(path).expect(303);
  for (const path of ["/api/crm/schedule", "/api/crm/visits", "/api/trainer/lessons"]) await request(app).get(path).expect(401);
  const a = await login("schedadmin"), t = await login("schedta");
  await a.agent.get("/crm/schedule").expect(200);
  await a.agent.get("/crm/visits").expect(200);
  await a.agent.get("/trainer/lessons").expect(403);
  await t.agent.get("/trainer/lessons").expect(200);
  await t.agent.get("/crm/schedule").expect(403);
  await post(t, "/crm/schedule", {}, 403);
  await a.agent.post("/api/crm/schedule").send({ _csrf: a.token, key: randomUUID() }).expect(403);
});

test("schedule: creates weekly concrete lessons and rejects trainer/room overlaps", async () => {
  const a = await login("schedadmin");
  const startDate = addDays(today(), 2);
  const selected = isoWeekday(startDate);
  const created = await post(a, "/crm/schedule", { kind: "GROUP", title: "Серия", date: startDate, startTime: "10:00", endTime: "11:00", trainerId: ta.id, room: "Зал 1", capacity: "12", repeat: "WEEKLY", repeatUntil: addDays(startDate, 14), weekdays: String(selected) });
  assert.equal(created.body.count, 3);
  const rows = await db.prisma.lesson.findMany({ where: { seriesId: { not: null }, title: "Серия" } });
  assert.equal(rows.length, 3);
  await post(a, "/crm/schedule", { kind: "GROUP", title: "Конфликт", date: startDate, startTime: "10:30", endTime: "11:30", trainerId: ta.id, room: "Зал 2", capacity: "10", repeat: "NONE", repeatUntil: "", weekdays: "" }, 409);
  await post(a, "/crm/schedule", { kind: "GROUP", title: "Конфликт комнаты", date: startDate, startTime: "10:30", endTime: "11:30", trainerId: tb.id, room: "Зал 1", capacity: "10", repeat: "NONE", repeatUntil: "", weekdays: "" }, 409);
});

test("schedule: trainer sees only own lessons and may book only assigned clients", async () => {
  const a = await login("schedadmin"), trainer = await login("schedta");
  const clientAssigned = await makeClient(a, "Назначенный");
  const clientOther = await makeClient(a, "Чужой");
  const p = await profile(ta.id);
  await db.prisma.trainerAssignment.create({ data: { trainerId: p.id, clientId: clientAssigned } });
  const date = addDays(today(), 3);
  const mine = (await post(a, "/crm/schedule", { kind: "PERSONAL", title: "Моё", date, startTime: "12:00", endTime: "13:00", trainerId: ta.id, room: "", capacity: "5", repeat: "NONE", repeatUntil: "", weekdays: "" })).body.id;
  const foreign = (await post(a, "/crm/schedule", { kind: "PERSONAL", title: "Чужое", date, startTime: "14:00", endTime: "15:00", trainerId: tb.id, room: "", capacity: "5", repeat: "NONE", repeatUntil: "", weekdays: "" })).body.id;
  const list = await trainer.agent.get("/api/trainer/lessons").expect(200);
  assert.ok(list.body.items.some((row) => row.id === mine));
  assert.ok(!list.body.items.some((row) => row.id === foreign));
  await trainer.agent.get("/api/trainer/lessons/" + foreign).expect(404);
  await post(trainer, `/trainer/lessons/${mine}/book`, { clientId: clientOther, reason: "" }, 409);
  await post(trainer, `/trainer/lessons/${mine}/book`, { clientId: clientAssigned, reason: "" });
  const detail = await trainer.agent.get("/api/trainer/lessons/" + mine).expect(200);
  assert.equal(detail.body.lesson.bookings[0].client.name.startsWith("Назначенный"), true);
  assert.ok(!JSON.stringify(detail.body).includes("PRIVATE"));
});

test("schedule: repeated POST replays once and conflicting key reuse is rejected", async () => {
  const a = await login("schedadmin");
  const c1 = await makeClient(a, "Replay A"), c2 = await makeClient(a, "Replay B");
  const date = addDays(today(), 5);
  const lessonId = (await post(a, "/crm/schedule", { kind: "PERSONAL", title: "Replay", date, startTime: "18:00", endTime: "19:00", trainerId: tb.id, room: "", capacity: "1", repeat: "NONE", repeatUntil: "", weekdays: "" })).body.id;
  const key = randomUUID();
  const send = (clientId) => a.agent.post(`/api/crm/schedule/${lessonId}/book`).set("Origin", origin).send({ _csrf: a.token, key, clientId, reason: "" });
  const [first, second] = await Promise.all([send(c1), send(c1)]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.bookingId, second.body.bookingId);
  assert.equal(await db.prisma.lessonBooking.count({ where: { lessonId } }), 1);
  assert.equal((await send(c2)).status, 409);
});

test("schedule: concurrent booking cannot overflow capacity", async () => {
  const a = await login("schedadmin");
  const c1 = await makeClient(a, "Первый"), c2 = await makeClient(a, "Второй");
  const date = addDays(today(), 4);
  const lessonId = (await post(a, "/crm/schedule", { kind: "PERSONAL", title: "Одно место", date, startTime: "16:00", endTime: "17:00", trainerId: ta.id, room: "", capacity: "100", repeat: "NONE", repeatUntil: "", weekdays: "" })).body.id;
  const send = (clientId) => a.agent.post(`/api/crm/schedule/${lessonId}/book`).set("Origin", origin).send({ _csrf: a.token, key: randomUUID(), clientId, reason: "" });
  const results = await Promise.all([send(c1), send(c2)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await db.prisma.lessonBooking.count({ where: { lessonId, status: "BOOKED" } }), 1);
});

test("attendance: no-show does not consume; first confirmed visit activates and reversal restores", async () => {
  const a = await login("schedadmin"), o = await login("schedowner");
  const visitDate = addDays(today(), -1);
  const clientId = await makeClient(a, "Активация");
  const planId = await makePlan(o, { weekdays: String(isoWeekday(visitDate)) });
  const issued = await issue(a, clientId, planId, { activation: "FIRST_VISIT" });
  const membershipId = issued.body.id;
  await db.prisma.membership.update({ where: { id: membershipId }, data: { createdAt: clubDateTime(visitDate, "08:00") } });
  const noShowLesson = await directLesson({ date: visitDate, start: "09:00", end: "10:00", title: "Неявка" });
  const noShowBooking = await directBooking(noShowLesson.id, clientId);
  await post(a, `/crm/schedule/${noShowLesson.id}/bookings/${noShowBooking.id}/attendance`, { status: "NO_SHOW", reason: "" });
  let membership = await db.prisma.membership.findUnique({ where: { id: membershipId } });
  assert.equal(membership.startDate, null);
  assert.equal(membership.remaining, 8);
  const lesson = await directLesson({ date: visitDate, start: "12:00", end: "13:00", title: "Первое посещение" });
  const booking = await directBooking(lesson.id, clientId);
  const attended = await post(a, `/crm/schedule/${lesson.id}/bookings/${booking.id}/attendance`, { status: "ATTENDED", reason: "" });
  membership = await db.prisma.membership.findUnique({ where: { id: membershipId } });
  assert.equal(dateString(membership.startDate), visitDate);
  assert.equal(membership.remaining, 7);
  assert.equal(membership.snapshot.activation, "FIRST_VISIT");
  await post(a, `/crm/visits/${attended.body.visitId}/reverse`, { reason: "Ошибочная отметка" });
  membership = await db.prisma.membership.findUnique({ where: { id: membershipId } });
  assert.equal(membership.startDate, null);
  assert.equal(membership.endDate, null);
  assert.equal(membership.remaining, 8);
});

test("attendance: Duo activates both memberships together but consumes only visitor remainder", async () => {
  const a = await login("schedadmin"), o = await login("schedowner");
  const visitDate = addDays(today(), -1);
  const first = await makeClient(a, "Дуэт A"), second = await makeClient(a, "Дуэт B");
  const planId = await makePlan(o, { duo: "true", weekdays: String(isoWeekday(visitDate)) });
  const issued = await issue(a, first, planId, { activation: "FIRST_VISIT", partnerId: second });
  const pair = await db.prisma.membership.findMany({ where: { pairId: { not: null }, purchaseId: (await db.prisma.membership.findUnique({ where: { id: issued.body.id } })).purchaseId }, orderBy: { clientId: "asc" } });
  for (const membership of pair) await db.prisma.membership.update({ where: { id: membership.id }, data: { createdAt: clubDateTime(visitDate, "08:00") } });
  const lesson = await directLesson({ date: visitDate, start: "12:00", end: "13:00", title: "Дуэт старт" });
  const booking = await directBooking(lesson.id, first);
  await post(a, `/crm/schedule/${lesson.id}/bookings/${booking.id}/attendance`, { status: "ATTENDED", reason: "" });
  const updated = await db.prisma.membership.findMany({ where: { purchaseId: pair[0].purchaseId } });
  assert.equal(new Set(updated.map((m) => dateString(m.startDate))).size, 1);
  assert.equal(updated.every((m) => dateString(m.startDate) === visitDate), true);
  const byClient = Object.fromEntries(updated.map((m) => [m.clientId, m.remaining]));
  assert.equal(byClient[first], 7);
  assert.equal(byClient[second], 8);
});

test("attendance: trainer correction window is one calendar day while ADMIN has seven", async () => {
  const a = await login("schedadmin"), trainer = await login("schedta");
  const clientId = await makeClient(a, "Старое занятие");
  const lesson = await directLesson({ kind: "PERSONAL", date: addDays(today(), -2), start: "12:00", end: "13:00", title: "Два дня назад" });
  const booking = await directBooking(lesson.id, clientId);
  await post(trainer, `/trainer/lessons/${lesson.id}/bookings/${booking.id}/attendance`, { status: "ATTENDED", reason: "" }, 409);
  await post(a, `/crm/schedule/${lesson.id}/bookings/${booking.id}/attendance`, { status: "ATTENDED", reason: "" });
  assert.equal((await db.prisma.lessonBooking.findUnique({ where: { id: booking.id } })).status, "ATTENDED");

  const sixDays = await directLesson({ kind: "PERSONAL", date: addDays(today(), -6), start: "14:00", end: "15:00", title: "Шесть дней назад" });
  const sixBooking = await directBooking(sixDays.id, clientId);
  await post(a, `/crm/schedule/${sixDays.id}/bookings/${sixBooking.id}/attendance`, { status: "ATTENDED", reason: "" });

  const sevenDays = await directLesson({ kind: "PERSONAL", date: addDays(today(), -7), start: "16:00", end: "17:00", title: "Семь дней назад" });
  const sevenBooking = await directBooking(sevenDays.id, clientId);
  await post(a, `/crm/schedule/${sevenDays.id}/bookings/${sevenBooking.id}/attendance`, { status: "ATTENDED", reason: "" }, 409);
});

test("attendance: group gift grants exactly one gym visit without consuming group remainder", async () => {
  const a = await login("schedadmin"), o = await login("schedowner");
  const clientId = await makeClient(a, "Подарок");
  const planId = await makePlan(o, { giftGym: "true", weekdays: String(isoWeekday(today())) });
  const issued = await issue(a, clientId, planId, { activation: "DATE" });
  const before = await db.prisma.membership.findUnique({ where: { id: issued.body.id } });
  const now = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Krasnoyarsk", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const first = await post(a, "/crm/visits/gym", { clientId, date: today(), time: now, reason: "" });
  const visit = await db.prisma.visit.findUnique({ where: { id: first.body.id } });
  assert.equal(visit.entitlement, "GIFT_GYM");
  const after = await db.prisma.membership.findUnique({ where: { id: issued.body.id } });
  assert.equal(after.remaining, before.remaining);
  await post(a, "/crm/visits/gym", { clientId, date: today(), time: now, reason: "" }, 409);
});

test("attendance: cancelling a lesson compensates confirmed visits and cancels roster", async () => {
  const a = await login("schedadmin"), o = await login("schedowner");
  const visitDate = addDays(today(), -1);
  const clientId = await makeClient(a, "Компенсация");
  const planId = await makePlan(o, { weekdays: String(isoWeekday(visitDate)) });
  const issued = await issue(a, clientId, planId, { activation: "FIRST_VISIT" });
  await db.prisma.membership.update({ where: { id: issued.body.id }, data: { createdAt: clubDateTime(visitDate, "08:00") } });
  const lesson = await directLesson({ date: visitDate, start: "12:00", end: "13:00", title: "Отмена клубом" });
  const booking = await directBooking(lesson.id, clientId);
  await post(a, `/crm/schedule/${lesson.id}/bookings/${booking.id}/attendance`, { status: "ATTENDED", reason: "" });
  const fresh = await db.prisma.lesson.findUnique({ where: { id: lesson.id } });
  await post(a, `/crm/schedule/${lesson.id}/cancel`, { version: fresh.version, reason: "Занятие отменено клубом" });
  const [membership, finalBooking, visit] = await Promise.all([
    db.prisma.membership.findUnique({ where: { id: issued.body.id } }),
    db.prisma.lessonBooking.findUnique({ where: { id: booking.id } }),
    db.prisma.visit.findFirst({ where: { bookingId: booking.id }, orderBy: { createdAt: "desc" } }),
  ]);
  assert.equal(membership.remaining, 8);
  assert.equal(membership.startDate, null);
  assert.equal(finalBooking.status, "CANCELLED");
  assert.equal(visit.status, "REVERSED");
});
