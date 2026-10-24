import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, randomBytes } from "node:crypto";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { createApp } from "../server/app.js";
import { crmService } from "../server/modules/crm/service.js";
import { clearCrm } from "./helpers/crm.js";
import {
  today,
  addDays,
  addMonths,
  dbDate,
} from "../server/modules/crm/dates.js";
const config = readConfig();
if (
  config.NODE_ENV !== "test" ||
  !new URL(config.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("TEST_DB_REQUIRED");
const db = createDatabase(config.DATABASE_URL);
const secret = randomBytes(24).toString("hex");
let app, store, users, owner, admin, ta, tb;
const origin = config.APP_ORIGIN;
async function login(name) {
  const agent = request.agent(app);
  const page = await agent.get("/login").expect(200);
  const _csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const result = await agent
    .post("/login")
    .set("Origin", origin)
    .type("form")
    .send({ login: name, password: secret, _csrf })
    .expect(303);
  const me = await agent.get("/api/auth/me").expect(200);
  return {
    agent,
    token: me.body.csrf,
    user: me.body.user,
    sid: decodeURIComponent(
      result.headers["set-cookie"][0]
        .split(";")[0]
        .split("=")
        .slice(1)
        .join("="),
    ),
  };
}
async function post(s, path, data = {}, expected = 200) {
  return s.agent
    .post("/api" + path)
    .set("Origin", origin)
    .send({ _csrf: s.token, key: randomUUID(), ...data })
    .expect(expected);
}
async function makeClient(s, fields = {}) {
  const r = await post(s, "/crm/clients", {
    name: "Тестовый клиент " + randomUUID().slice(0, 8),
    phone: "79991234567",
    birthDate: "1990-05-20",
    comment: "PRIVATE_COMMENT",
    ...fields,
  });
  return r.body.id;
}
const planInput = (changes = {}) => ({
  name: "Тестовый тариф " + randomUUID().slice(0, 8),
  kind: "GROUP",
  price: "3200",
  months: "1",
  days: "0",
  visits: "8",
  weekdays: "2,4,6,7",
  fromTime: "08:00",
  toTime: "22:00",
  giftGym: "true",
  duo: "false",
  active: "true",
  ...changes,
});
async function makePlan(s, changes = {}) {
  return (await post(s, "/crm/plans", planInput(changes))).body.id;
}
async function issue(s, clientId, planId, changes = {}, expected = 200) {
  return post(
    s,
    "/crm/memberships",
    {
      clientId,
      planId,
      planVersion: 1,
      activation: "DATE",
      startDate: today(),
      price: "3200",
      method: "CASH",
      reason: "",
      ...changes,
    },
    expected,
  );
}
const getClient = async (s, id) =>
  (await s.agent.get("/api/crm/clients/" + id).expect(200)).body;
const getMember = async (s, id) => (await getClient(s, id)).memberships[0];
before(async () => {
  await clearCrm(db.prisma);
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.authSession.deleteMany();
  await db.prisma.user.deleteMany();
  ({ app, store, users } = await createApp({ config, db }));
  for (const [name, role] of [
    ["crmowner", "OWNER"],
    ["crmadmin", "ADMIN"],
    ["crmta", "TRAINER"],
    ["crmtb", "TRAINER"],
  ]) {
    const u = await users.create({
      login: name,
      displayName: name,
      role,
      password: secret,
    });
    if (role === "OWNER") owner = u;
    else if (role === "ADMIN") admin = u;
    else if (name === "crmta") ta = u;
    else tb = u;
  }
});
beforeEach(async () => {
  store.close();
  ({ app, store, users } = await createApp({ config, db }));
});
after(async () => {
  store?.close();
  await clearCrm(db.prisma);
  await db.close();
});

test("CRM: pages and APIs independently guard guest, ADMIN, OWNER and TRAINER", async () => {
  for (const path of [
    "/crm/clients",
    "/crm/clients/new",
    "/crm/plans",
    "/crm/plans/new",
  ])
    await request(app).get(path).expect(303);
  for (const path of [
    "/api/crm/clients",
    "/api/crm/plans",
    "/api/trainer/clients",
  ])
    await request(app).get(path).expect(401);
  const o = await login("crmowner"),
    a = await login("crmadmin"),
    t = await login("crmta");
  for (const s of [o, a]) {
    for (const path of ["/crm/clients", "/crm/plans", "/crm/clients/new"])
      await s.agent.get(path).expect(200);
    await s.agent.get("/trainer/clients").expect(403);
  }
  await a.agent.get("/crm/plans/new").expect(403);
  await a.agent.get("/admin/employees").expect(403);
  for (const path of ["/crm/clients", "/api/crm/clients", "/crm/plans"])
    await t.agent.get(path).expect(403);
  await post(a, "/crm/plans", planInput(), 403);
  await post(t, "/crm/clients", {}, 403);
  await a.agent.get("/staff").expect(303).expect("Location", "/crm/clients");
});
test("CRM: real client validation, duplicate normalization, safe forms, search and archive filters", async () => {
  const s = await login("crmadmin");
  const id = await makeClient(s, {
    name: "<script>Имя</script>",
    phone: "8 (999) 123-45-67",
  });
  const duplicate = await post(s, "/crm/clients", {
    name: "Родственник",
    phone: "+7 999 1234567",
    birthDate: "1990-02-01",
    comment: "",
  });
  assert.equal(duplicate.body.duplicatePhone, true);
  const c = await getClient(s, id);
  assert.equal(c.phone, "79991234567");
  const html = await s.agent.get("/crm/clients/" + id).expect(200);
  assert.match(html.text, /&lt;script&gt;/);
  assert.ok(!html.text.includes("<script>Имя"));
  for (const changes of [
    { birthDate: "2025-01-01" },
    { birthDate: "2000-02-30" },
    { phone: "abc" },
    { role: "OWNER" },
  ])
    await post(
      s,
      "/crm/clients",
      {
        name: "Проверка",
        phone: "79995555555",
        birthDate: "1990-01-01",
        comment: "",
        ...changes,
      },
      400,
    );
  const result = await s.agent
    .get("/api/crm/clients?q=" + encodeURIComponent("<script>Имя"))
    .expect(200);
  assert.equal(result.body.total, 1);
  assert.equal(result.body.items[0].id, id);
  assert.ok(!JSON.stringify(result.body).includes("PRIVATE_COMMENT"));
  await post(s, "/crm/clients/" + id + "/archive", {
    version: c.version,
    archived: "true",
    reason: "Ушёл из клуба",
  });
  assert.equal(
    (
      await s.agent.get(
        "/api/crm/clients?archived=true&q=" + encodeURIComponent("<script>Имя"),
      )
    ).body.total,
    1,
  );
});
test("CRM: transactional replay keys, conflicting key reuse and stale client versions", async () => {
  const s = await login("crmadmin");
  const key = randomUUID();
  const body = {
    _csrf: s.token,
    key,
    name: "Повторная форма",
    phone: "79001111111",
    birthDate: "1990-01-01",
    comment: "",
  };
  const send = () =>
    s.agent.post("/api/crm/clients").set("Origin", origin).send(body);
  const [a, b] = await Promise.all([send(), send()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.id, b.body.id);
  assert.equal(await db.prisma.client.count({ where: { name: body.name } }), 1);
  await s.agent
    .post("/api/crm/clients")
    .set("Origin", origin)
    .send({ ...body, name: "Другая форма" })
    .expect(409);
  const id = a.body.id,
    c = await getClient(s, id);
  const update = {
    name: "Новое ФИО",
    phone: c.phone,
    birthDate: "1990-01-01",
    comment: "",
    version: c.version,
  };
  const sendUpdate = () =>
    s.agent
      .post("/api/crm/clients/" + id + "/edit")
      .set("Origin", origin)
      .send({ _csrf: s.token, key: randomUUID(), ...update });
  const results = await Promise.all([sendUpdate(), sendUpdate()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  // Re-read the server state; exactly one update was committed.
  assert.equal((await getClient(s, id)).version, c.version + 1);
  await post(
    s,
    "/crm/clients/" + id + "/edit",
    {
      name: "Без версии",
      phone: c.phone,
      birthDate: "1990-01-01",
      comment: "",
    },
    400,
  );
});
test("TRAINER: database scopes list/search/count/get, trusted profiles, revocation and DTO allowlist", async () => {
  const a = await login("crmadmin"),
    o = await login("crmowner"),
    t = await login("crmta"),
    b = await login("crmtb");
  const ca = await makeClient(a, { name: "Назначенная Анна" }),
    cb = await makeClient(a, { name: "Чужой Борис" }),
    plan = await makePlan(o);
  await issue(a, ca, plan);
  await post(a, "/crm/clients/" + ca + "/assign", {
    version: 1,
    trainerId: ta.id,
    reason: "Индивидуальная работа",
  });
  await post(a, "/crm/clients/" + cb + "/assign", {
    version: 1,
    trainerId: tb.id,
    reason: "Индивидуальная работа",
  });
  const list = await t.agent.get("/api/trainer/clients").expect(200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, ca);
  assert.equal(
    (await t.agent.get("/api/trainer/clients?q=" + encodeURIComponent("Борис")))
      .body.total,
    0,
  );
  await t.agent.get("/api/trainer/clients?trainerId=" + tb.id).expect(400);
  await t.agent.get("/api/trainer/clients/" + cb).expect(404);
  await b.agent.get("/api/trainer/clients/" + ca).expect(404);
  const dto = (await t.agent.get("/api/trainer/clients/" + ca).expect(200))
    .body;
  assert.deepEqual(Object.keys(dto).sort(), [
    "age",
    "id",
    "memberships",
    "name",
    "pagination",
    "phone",
  ]);
  for (const key of [
    "priceCents",
    "purchaseId",
    "reason",
    "comment",
    "birthDate",
    "pairId",
    "refunds",
    "passwordHash",
    "authVersion",
    "SECRET",
  ])
    assert.ok(!JSON.stringify(dto).includes(key));
  assert.equal(dto.memberships[0].giftGym, true);
  const c = await getClient(a, ca);
  await post(a, "/crm/clients/" + ca + "/revoke", {
    version: c.version,
    assignmentId: c.assignments[0].id,
    reason: "Перевод к другому тренеру",
  });
  await t.agent.get("/api/trainer/clients/" + ca).expect(404);
  assert.equal((await t.agent.get("/api/trainer/clients")).body.total, 0);
});
test("CRM: multiple trainers and archive revoke all; restore never restores assignments or changes subscription dates", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin"),
    t = await login("crmta");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p);
  await post(a, "/crm/clients/" + id + "/assign", {
    version: 1,
    trainerId: ta.id,
    reason: "Первый тренер",
  });
  await post(a, "/crm/clients/" + id + "/assign", {
    version: 2,
    trainerId: tb.id,
    reason: "Второй тренер",
  });
  await post(
    a,
    "/crm/clients/" + id + "/assign",
    { version: 3, trainerId: ta.id, reason: "Повторное назначение" },
    409,
  );
  const before = await getMember(a, id);
  await post(a, "/crm/clients/" + id + "/archive", {
    version: 3,
    archived: "true",
    reason: "Временный уход",
  });
  await t.agent.get("/trainer/clients/" + id).expect(404);
  await post(a, "/crm/clients/" + id + "/archive", {
    version: 4,
    archived: "false",
    reason: "Возвращение в клуб",
  });
  const c = await getClient(a, id);
  assert.equal(c.assignments.length, 0);
  assert.equal(c.memberships[0].endDate, before.endDate);
});
test("CRM: issuance snapshots exact tariff restrictions, full payment and individual price reason", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p, { price: "3000" }, 409);
  const r = await issue(a, id, p, {
    price: "3000",
    reason: "Согласованная скидка",
  });
  assert.ok(r.body.id);
  const m = await getMember(a, id);
  assert.equal(m.priceCents, 300000);
  assert.equal(m.purchase.totalCents, 300000);
  assert.equal(m.remaining, 8);
  assert.equal(m.snapshot.weekdays, "2,4,6,7");
  assert.equal(m.snapshot.giftGym, true);
  assert.equal(m.endDate.slice(0, 10), addMonths(today(), 1));
  const plan = await db.prisma.membershipPlan.findUnique({ where: { id: p } });
  await post(o, "/crm/plans/" + p, {
    ...planInput({ name: "Изменённый тариф", price: "4000", visits: "12" }),
    version: plan.version,
  });
  const saved = await getMember(a, id);
  assert.equal(saved.snapshot.name, m.snapshot.name);
  assert.equal(saved.snapshot.visits, 8);
  assert.equal(saved.priceCents, 300000);
  const next = await makeClient(a);
  await issue(a, next, p, {}, 409);
  await post(
    a,
    "/crm/memberships",
    {
      clientId: next,
      planId: p,
      planVersion: 2,
      activation: "DATE",
      startDate: today(),
      price: "4000",
      method: "CARD",
      paidAmount: "1",
    },
    400,
  );
});
test("CRM: concurrent issuance, date overlap, future renewal, inactive plans and archives", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  const data = {
    clientId: id,
    planId: p,
    planVersion: 1,
    activation: "DATE",
    startDate: today(),
    price: "3200",
    method: "CASH",
  };
  const send = () =>
    a.agent
      .post("/api/crm/memberships")
      .set("Origin", origin)
      .send({ _csrf: a.token, key: randomUUID(), ...data });
  const results = await Promise.all([send(), send()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    await db.prisma.membership.count({ where: { clientId: id } }),
    1,
  );
  await issue(a, id, p, { startDate: addMonths(today(), 1) }, 409);
  await issue(a, id, p, { startDate: addDays(addMonths(today(), 1), 1) });
  const m = (await getClient(a, id)).memberships.find(
    (x) => x.startDate.slice(0, 10) === today(),
  );
  await post(
    a,
    "/crm/memberships/" + m.id + "/extend",
    { version: m.version, days: 1, reason: "Конфликт с будущим" },
    409,
  );
  const archived = await makeClient(a);
  await post(a, "/crm/clients/" + archived + "/archive", {
    version: 1,
    archived: "true",
    reason: "Уход клиента",
  });
  await issue(a, archived, p, {}, 409);
  const off = await makePlan(o, { active: "false" });
  const other = await makeClient(a);
  await issue(a, other, off, {}, 409);
});
test("CRM: first-visit activation is pending, no fake lesson or activation endpoint", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p, { activation: "FIRST_VISIT", startDate: "" });
  const m = await getMember(a, id);
  assert.equal(m.startDate, null);
  assert.equal(m.endDate, null);
  assert.equal(m.status, "Ожидает первого посещения");
  await issue(a, id, p, { startDate: addMonths(today(), 2) }, 409);
  await post(
    a,
    "/crm/memberships/" + m.id + "/freeze",
    { version: 1, endDate: addDays(today(), 5), reason: "Попытка заморозки" },
    409,
  );
  await a.agent.post("/api/crm/memberships/" + m.id + "/activate").expect(404);
});
test("CRM: freeze/early thaw, quarter limit, manual balance and optimistic conflicts", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p);
  let m = await getMember(a, id);
  const end = m.endDate;
  await post(a, "/crm/memberships/" + m.id + "/freeze", {
    version: 1,
    endDate: addDays(today(), 9),
    reason: "Поездка клиента",
  });
  m = await getMember(a, id);
  assert.equal(m.endDate.slice(0, 10), addDays(end.slice(0, 10), 10));
  assert.equal(m.status, "Заморожен");
  await post(a, "/crm/memberships/" + m.id + "/thaw", {
    version: m.version,
    reason: "Досрочное возвращение",
  });
  m = await getMember(a, id);
  assert.equal(m.endDate, end);
  assert.equal(m.status, "Действует");
  await post(
    a,
    "/crm/memberships/" + m.id + "/freeze",
    { version: m.version, endDate: today(), reason: "Повторная попытка" },
    409,
  );
  await post(
    a,
    "/crm/memberships/" + m.id + "/adjust",
    { version: m.version, remaining: -1, reason: "Отрицательный остаток" },
    400,
  );
  await post(a, "/crm/memberships/" + m.id + "/adjust", {
    version: m.version,
    remaining: 5,
    reason: "Исправление ошибочного учёта",
  });
  await post(
    a,
    "/crm/memberships/" + m.id + "/adjust",
    { version: m.version, remaining: 4, reason: "Устаревшая форма" },
    409,
  );
  m = await getMember(a, id);
  assert.equal(m.remaining, 5);
  const events = (await getClient(a, id)).events;
  assert.ok(
    events.some(
      (e) =>
        e.action === "MEMBERSHIP_ADJUST" &&
        e.details.before === 8 &&
        e.details.after === 5,
    ),
  );
});
test("CRM: DUO atomic pair payment, linked freeze/extension, independent cancellation and refund", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const ca = await makeClient(a),
    cb = await makeClient(a),
    p = await makePlan(o, { duo: "true" });
  await issue(a, ca, p, {}, 409);
  await issue(a, ca, p, { partnerId: ca }, 409);
  await issue(a, ca, p, { partnerId: cb });
  let ma = await getMember(a, ca),
    mb = await getMember(a, cb);
  assert.equal(ma.pairId, mb.pairId);
  assert.equal(ma.purchase.totalCents, 640000);
  assert.equal(ma.purchase.id, mb.purchase.id);
  assert.equal(ma.endDate, mb.endDate);
  await post(a, "/crm/memberships/" + ma.id + "/freeze", {
    version: 1,
    endDate: addDays(today(), 2),
    reason: "Совместный отпуск",
  });
  ma = await getMember(a, ca);
  mb = await getMember(a, cb);
  assert.equal(ma.endDate, mb.endDate);
  assert.equal(mb.status, "Заморожен");
  await post(a, "/crm/memberships/" + mb.id + "/thaw", {
    version: mb.version,
    reason: "Совместное возвращение",
  });
  ma = await getMember(a, ca);
  mb = await getMember(a, cb);
  assert.equal(ma.endDate, mb.endDate);
  await post(a, "/crm/memberships/" + ma.id + "/extend", {
    version: ma.version,
    days: 3,
    reason: "Продление пары",
  });
  ma = await getMember(a, ca);
  mb = await getMember(a, cb);
  assert.equal(ma.endDate, mb.endDate);
  await post(o, "/crm/memberships/" + ma.id + "/refund", {
    version: ma.version,
    amount: "1000",
    method: "CASH",
    reason: "Возврат одному участнику",
  });
  assert.ok((await getMember(a, ca)).cancelledAt);
  assert.equal((await getMember(a, cb)).cancelledAt, null);
  assert.equal((await getMember(a, cb)).priceCents, 320000);
});
test("CRM: OWNER refunds only, total cap, concurrent retries and closed subscription", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p);
  const m = await getMember(a, id);
  const body = {
    version: m.version,
    amount: "1000",
    method: "TRANSFER",
    reason: "Согласованный возврат",
  };
  await post(a, "/crm/memberships/" + m.id + "/refund", body, 403);
  const key = randomUUID(),
    send = () =>
      o.agent
        .post("/api/crm/memberships/" + m.id + "/refund")
        .set("Origin", origin)
        .send({ _csrf: o.token, key, ...body });
  const rs = await Promise.all([send(), send()]);
  assert.deepEqual(
    rs.map((r) => r.status),
    [200, 200],
  );
  let changed = await getMember(a, id);
  assert.equal(changed.refunds.length, 1);
  assert.ok(changed.cancelledAt);
  await post(
    o,
    "/crm/memberships/" + m.id + "/refund",
    { ...body, version: changed.version, amount: "2200.01" },
    409,
  );
  await post(o, "/crm/memberships/" + m.id + "/refund", {
    ...body,
    version: changed.version,
    amount: "2200",
  });
  changed = await getMember(a, id);
  assert.equal(
    changed.refunds.reduce((s, r) => s + r.amountCents, 0),
    320000,
  );
  await post(
    a,
    "/crm/memberships/" + m.id + "/adjust",
    { version: changed.version, remaining: 10, reason: "Закрытый абонемент" },
    409,
  );
});
test("CRM: audit and history failure roll back client/operation/membership/payment atomically", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  const before = await db.prisma.membershipPurchase.count();
  await db.pool.query(
    `CREATE FUNCTION crm_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='MEMBERSHIP_ISSUED' THEN RAISE EXCEPTION 'private test failure'; END IF; RETURN NEW; END $$`,
  );
  await db.pool.query(
    'CREATE TRIGGER crm_reject_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION crm_reject_audit()',
  );
  try {
    await issue(a, id, p, {}, 500);
    assert.equal(
      await db.prisma.membership.count({ where: { clientId: id } }),
      0,
    );
    assert.equal(await db.prisma.membershipPurchase.count(), before);
    assert.equal(
      await db.prisma.crmEvent.count({
        where: { clientId: id, action: "MEMBERSHIP_ISSUED" },
      }),
      0,
    );
  } finally {
    await db.pool.query('DROP TRIGGER crm_reject_audit ON "AuditEvent"');
    await db.pool.query("DROP FUNCTION crm_reject_audit()");
  }
  await db.pool.query(
    `CREATE FUNCTION crm_reject_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private history failure'; END $$`,
  );
  await db.pool.query(
    'CREATE TRIGGER crm_reject_history BEFORE INSERT ON "CrmEvent" FOR EACH ROW EXECUTE FUNCTION crm_reject_history()',
  );
  try {
    await post(
      a,
      "/crm/clients/" + id + "/archive",
      { version: 1, archived: "true", reason: "Проверка атомарности" },
      500,
    );
    assert.equal((await getClient(a, id)).archived, false);
  } finally {
    await db.pool.query('DROP TRIGGER crm_reject_history ON "CrmEvent"');
    await db.pool.query("DROP FUNCTION crm_reject_history()");
  }
});
test("CRM: CSRF, strict Origin, mass assignment and required versions on every mutation family", async () => {
  const s = await login("crmowner"),
    id = await makeClient(s),
    p = await makePlan(s);
  await issue(s, id, p);
  const m = await getMember(s, id);
  for (const path of [
    "/crm/clients",
    "/crm/clients/" + id + "/edit",
    "/crm/clients/" + id + "/archive",
    "/crm/clients/" + id + "/assign",
    "/crm/clients/" + id + "/revoke",
    "/crm/plans",
    "/crm/plans/" + p,
    "/crm/memberships",
    ...["cancel", "extend", "adjust", "freeze", "thaw", "refund"].map(
      (a) => "/crm/memberships/" + m.id + "/" + a,
    ),
  ]) {
    await s.agent
      .post("/api" + path)
      .send({ _csrf: s.token, key: randomUUID() })
      .expect(403);
    await s.agent
      .post("/api" + path)
      .set("Origin", "https://evil.example")
      .send({ _csrf: s.token, key: randomUUID() })
      .expect(403);
    await s.agent
      .post("/api" + path)
      .set("Origin", origin)
      .send({ _csrf: "wrong", key: randomUUID() })
      .expect(403);
  }
  await post(
    s,
    "/crm/clients/" + id + "/assign",
    { version: 1, trainerId: ta.id, reason: "Попытка подмены", userId: tb.id },
    400,
  );
});
test("CRM: actor authVersion and destroyed SID checked inside transaction; trainer disabling revokes assignments", async () => {
  const s = await login("crmadmin"),
    o = await login("crmowner"),
    t = await login("crmta");
  const id = await makeClient(s);
  await post(s, "/crm/clients/" + id + "/assign", {
    version: 1,
    trainerId: ta.id,
    reason: "Назначение тренера",
  });
  const before = await db.prisma.user.findUnique({ where: { id: admin.id } });
  const session = await db.prisma.authSession.findFirst({
    where: { userId: admin.id },
  });
  await users.change(admin.id, { password: secret });
  const service = crmService(db.prisma);
  await assert.rejects(
    () =>
      service.saveClient(
        {
          actorId: admin.id,
          authVersion: before.authVersion,
          sessionId: session.sid,
          key: randomUUID(),
        },
        null,
        {
          name: "Запоздалый запрос",
          phone: "79002222222",
          birthDate: "1990-01-01",
          comment: "",
        },
      ),
    (e) => e.status === 403,
  );
  const current = await db.prisma.user.findUnique({ where: { id: owner.id } });
  await assert.rejects(
    () =>
      service.saveClient(
        {
          actorId: owner.id,
          authVersion: current.authVersion,
          sessionId: "revoked",
          key: randomUUID(),
        },
        null,
        {
          name: "Нет сессии",
          phone: "79002222222",
          birthDate: "1990-01-01",
          comment: "",
        },
      ),
    (e) => e.status === 403,
  );
  await users.change(ta.id, { active: false });
  await t.agent.get("/api/trainer/clients/" + id).expect(401);
  await users.change(ta.id, { active: true });
  const renewed = await login("crmta");
  await renewed.agent.get("/api/trainer/clients/" + id).expect(404);
});
test("CRM: database constraints independently reject negative remaining, overlaps and excessive refunds", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p);
  const m = await getMember(a, id);
  await assert.rejects(() =>
    db.prisma.membership.update({
      where: { id: m.id },
      data: { remaining: -1 },
    }),
  );
  await assert.rejects(() =>
    db.prisma.membership.create({
      data: {
        clientId: id,
        purchaseId: m.purchaseId,
        snapshot: m.snapshot,
        priceCents: 100,
        startDate: dbDate(today()),
        endDate: dbDate(addMonths(today(), 1)),
        remaining: 1,
      },
    }),
  );
  await assert.rejects(() =>
    db.prisma.membershipRefund.create({
      data: { membershipId: m.id, amountCents: 320001, method: "CASH" },
    }),
  );
  assert.equal((await getMember(a, id)).remaining, 8);
});
test("CRM: server rendered no-JS POST uses replay key and redirects to saved client", async () => {
  const s = await login("crmadmin");
  const page = await s.agent.get("/crm/clients/new").expect(200);
  const key = page.text.match(/name="key" value="([a-f0-9-]+)"/)[1];
  const r = await s.agent
    .post("/crm/clients")
    .set("Origin", origin)
    .type("form")
    .send({
      _csrf: s.token,
      key,
      name: "Клиент без JavaScript",
      phone: "79991112233",
      birthDate: "1990-01-01",
      comment: "",
    })
    .expect(303);
  const saved = await s.agent.get(r.headers.location).expect(200);
  assert.match(saved.text, /Клиент без JavaScript/);
  assert.match(saved.text, /Оформить абонемент/);
  const plan = await makePlan(await login("crmowner"));
  await s.agent.get(r.headers.location + "/issue?plan=" + plan).expect(200);
});

test("CRM: pagination retains exact count and history pages without exposing trainer history", async () => {
  const o = await login("crmowner"),
    t = await login("crmta");
  const prefix = "Страница " + randomUUID().slice(0, 8);
  await db.prisma.client.createMany({
    data: Array.from({ length: 27 }, (_, i) => ({
      name: prefix + " " + String(i).padStart(2, "0"),
      phone: "79993334455",
      birthDate: dbDate("1990-01-01"),
    })),
  });
  const first = (
    await o.agent
      .get("/api/crm/clients?q=" + encodeURIComponent(prefix))
      .expect(200)
  ).body;
  const second = (
    await o.agent
      .get("/api/crm/clients?page=2&q=" + encodeURIComponent(prefix))
      .expect(200)
  ).body;
  assert.equal(first.total, 27);
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 2);
  assert.equal(
    new Set([...first.items, ...second.items].map((c) => c.id)).size,
    27,
  );
  const id = first.items[0].id;
  await post(o, "/crm/clients/" + id + "/assign", {
    version: 1,
    trainerId: ta.id,
    reason: "Назначение для проверки",
  });
  await db.prisma.crmEvent.createMany({
    data: Array.from({ length: 28 }, () => ({
      clientId: id,
      actorId: owner.id,
      action: "CLIENT_UPDATED",
      reason: "Тестовое событие",
      details: {},
    })),
  });
  const page1 = await getClient(o, id);
  const page2 = (
    await o.agent.get("/api/crm/clients/" + id + "?historyPage=2").expect(200)
  ).body;
  assert.equal(page1.events.length, 25);
  assert.equal(page2.events.length, 4);
  assert.equal(page2.pagination.totalEvents, 29);
  await t.agent
    .get("/api/trainer/clients/" + id + "?historyPage=1")
    .expect(400);
  await t.agent
    .get("/api/trainer/clients/" + id + "?membershipsPage=1")
    .expect(200);
});
test("CRM: exhausted package allows renewal; restoring its balance cannot create overlapping entitlement", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const id = await makeClient(a),
    p = await makePlan(o);
  await issue(a, id, p);
  let old = await getMember(a, id);
  await post(a, "/crm/memberships/" + old.id + "/adjust", {
    version: old.version,
    remaining: 0,
    reason: "Все занятия использованы",
  });
  await issue(a, id, p);
  old = (await getClient(a, id)).memberships.find((m) => m.id === old.id);
  await post(
    a,
    "/crm/memberships/" + old.id + "/adjust",
    {
      version: old.version,
      remaining: 1,
      reason: "Конфликтующая корректировка",
    },
    409,
  );
  assert.equal(
    (await db.prisma.membership.findUnique({ where: { id: old.id } }))
      .remaining,
    0,
  );
});
test("CRM: DUO freeze rolls back both partners if second extension conflicts with a future subscription", async () => {
  const o = await login("crmowner"),
    a = await login("crmadmin");
  const ca = await makeClient(a),
    cb = await makeClient(a),
    duo = await makePlan(o, { duo: "true" }),
    single = await makePlan(o);
  await issue(a, ca, duo, { partnerId: cb });
  const ma = await getMember(a, ca),
    mb = await getMember(a, cb);
  await issue(a, cb, single, {
    startDate: addDays(mb.endDate.slice(0, 10), 1),
  });
  await post(
    a,
    "/crm/memberships/" + ma.id + "/freeze",
    {
      version: ma.version,
      endDate: addDays(today(), 5),
      reason: "Не должно сохраниться частично",
    },
    409,
  );
  const stored = await db.prisma.membership.findUnique({
    where: { id: ma.id },
    include: { freezes: true },
  });
  assert.equal(stored.version, 1);
  assert.equal(stored.freezes.length, 0);
  assert.equal(stored.endDate.toISOString(), ma.endDate);
});

test("CRM: phone search normalizes Russian prefix and punctuation never matches all clients", async () => {
  const s = await login("crmadmin");
  const id = await makeClient(s, {
    name: "Уникальное совпадение телефона",
    phone: "79112223344",
  });
  const result = await s.agent
    .get("/api/crm/clients")
    .query({ q: "8 (911) 222-33-44" })
    .expect(200);
  assert.deepEqual(
    result.body.items.map((c) => c.id),
    [id],
  );
  const punctuation = await s.agent
    .get("/api/crm/clients")
    .query({ q: "()+-" })
    .expect(200);
  assert.equal(punctuation.body.total, 0);
});
