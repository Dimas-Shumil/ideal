import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { createApp } from "../server/app.js";
import { clearCrm } from "./helpers/crm.js";
const config = readConfig();
if (
  config.NODE_ENV !== "test" ||
  !new URL(config.DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error("TEST_DB_REQUIRED");
const db = createDatabase(config.DATABASE_URL);
let app,
  store,
  users,
  owner,
  admin,
  trainer,
  secret,
  logs = [];
const login = async (name, pw = secret) => {
  const agent = request.agent(app);
  const page = await agent.get("/login").expect(200);
  const token = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const result = await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ login: name, password: pw, _csrf: token })
    .expect(303);
  const me = await agent.get("/api/auth/me").expect(200);
  return {
    agent,
    token: me.body.csrf,
    cookie: result.headers["set-cookie"][0].split(";")[0],
    beforeCookie: page.headers["set-cookie"][0].split(";")[0],
  };
};
before(async () => {
  secret = randomBytes(24).toString("hex");
  await clearCrm(db.prisma);
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.authSession.deleteMany();
  await db.prisma.user.deleteMany();
  ({ app, store, users } = await createApp({
    config,
    db,
    log: (line) => logs.push(line),
  }));
  owner = await users.create(
    {
      login: "owner",
      displayName: "Владелец",
      role: "OWNER",
      password: secret,
    },
    { bootstrap: true },
  );
  admin = await users.create({
    login: "admin",
    displayName: "Администратор",
    role: "ADMIN",
    password: secret,
  });
  trainer = await users.create({
    login: "trainer",
    displayName: "Тренер",
    role: "TRAINER",
    password: secret,
  });
});
after(async () => {
  store?.close();
  await db.close();
});
test("schema: auth and approved CRM entities; bootstrap cannot repeat", async () => {
  const rows = await db.pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
  );
  assert.deepEqual(
    rows.rows.map((x) => x.tablename).sort(),
    ["AuditEvent", "AuthSession", "User", "_prisma_migrations", "Client", "TrainerProfile", "TrainerAssignment", "MembershipPlan", "MembershipPurchase", "Membership", "MembershipFreeze", "MembershipRefund", "CrmEvent", "CrmOperation"].sort(),
  );
  await assert.rejects(() =>
    users.create(
      {
        login: "other",
        displayName: "Другой",
        role: "OWNER",
        password: secret,
      },
      { bootstrap: true },
    ),
  );
});
test("public pages, static boundaries, CSP hash, errors and no root static", async () => {
  for (const p of [
    "/",
    "/index.html",
    "/about.html",
    "/trainers.html",
    "/trainer.html",
    "/shop.html",
    "/product.html",
    "/cart.html",
  ]) {
    const r = await request(app).get(p).expect(200);
    assert.match(r.headers["content-security-policy"], /script-src 'self'/);
    assert.ok(!r.headers["set-cookie"]);
  }
  const home = await request(app).get("/");
  assert.match(home.headers["content-security-policy"], /sha256-/);
  assert.ok(!home.headers["content-security-policy"].includes("unsafe-inline"));
  for (const p of [
    "/.env",
    "/package.json",
    "/AUTH_PLAN.txt",
    "/server/app.js",
    "/prisma/schema.prisma",
    "/tools/cli.mjs",
    "/components/header.html",
    "/site/sass/main.scss",
    "/private/a",
    "/site/css/%2e%2e/%2e%2e/.env",
    "/%2eenv",
  ])
    await request(app).get(p).expect(404);
  for (const p of [
    "/api/admin/check",
    "/api/staff/check",
    "/api/trainer/check",
    "/api/auth/me",
  ])
    await request(app).get(p).expect(401);
  await request(app).get("/admin").expect(303).expect("Location", "/login");
  await request(app)
    .get("/api/no-route")
    .expect(404)
    .expect("Cache-Control", "no-store");
});
test("no-JS form, CSRF/Origin prelogin, strict input, uniform credentials failure", async () => {
  const agent = request.agent(app);
  const page = await agent.get("/login").expect(200);
  const token = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  assert.match(page.text, /method="post"/);
  assert.ok(!page.text.includes("<script"));
  const body = { login: "owner", password: secret, _csrf: token };
  await agent.post("/login").type("form").send(body).expect(403);
  await agent
    .post("/login")
    .set("Origin", "https://evil.example")
    .type("form")
    .send(body)
    .expect(403);
  for (const value of ["", "f".repeat(64), "я".repeat(64)])
    await agent
      .post("/login")
      .set("Origin", config.APP_ORIGIN)
      .type("form")
      .send({ ...body, _csrf: value })
      .expect(403);
  await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ ...body, role: "OWNER" })
    .expect(400);
  await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ ...body, password: "x".repeat(129) })
    .expect(400);
  const unknown = await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ ...body, login: "unknown", password: "wrong" })
    .expect(401);
  const wrong = await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ ...body, password: "wrong" })
    .expect(401);
  assert.match(unknown.text, /Неверный логин или пароль/);
  assert.match(wrong.text, /Неверный логин или пароль/);
  assert.ok(!wrong.text.includes(secret));
});
test("roles are enforced independently for pages/API; cookie and fixation", async () => {
  for (const [name, path] of [
    ["owner", "admin"],
    ["admin", "staff"],
    ["trainer", "trainer"],
  ]) {
    const { agent, cookie, beforeCookie } = await login(name);
    assert.notEqual(cookie, beforeCookie);
    const r = await agent.get(`/${path}`).expect(path === "staff" ? 303 : 200);
    if(path === "staff") { assert.equal(r.headers.location,"/crm/clients"); await agent.get(r.headers.location).expect(200); }
    assert.equal(r.headers["cache-control"], "no-store");
    await agent.get(`/api/${path}/check`).expect(200);
    for (const other of ["admin", "staff", "trainer"].filter(
      (x) => x !== path,
    )) {
      await agent.get(`/${other}`).expect(403);
      await agent.get(`/api/${other}/check`).expect(403);
    }
    const me = await agent.get("/api/auth/me").expect(200);
    assert.deepEqual(Object.keys(me.body.user).sort(), [
      "displayName",
      "id",
      "login",
      "role",
    ]);
  }
  const r = await request(app).get("/login");
  assert.match(r.headers["set-cookie"][0], /HttpOnly/);
  assert.match(r.headers["set-cookie"][0], /SameSite=Lax/);
  assert.ok(!r.headers["set-cookie"][0].includes("Secure"));
});
test("logout requires POST, valid Origin/token; destroyed SID cannot be resurrected", async () => {
  const { agent, token, cookie } = await login("trainer");
  await agent.get("/logout").expect(404);
  await agent
    .post("/api/auth/logout")
    .set("Origin", config.APP_ORIGIN)
    .send({})
    .expect(403);
  await agent.post("/api/auth/logout").send({ _csrf: token }).expect(403);
  const row = await db.prisma.authSession.findFirst({
    where: { userId: trainer.id },
  });
  await agent
    .post("/api/auth/logout")
    .set("Origin", config.APP_ORIGIN)
    .send({ _csrf: token })
    .expect(200);
  await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
  // All authenticated update paths are UPDATE-only, including an in-flight save.
  const current = await db.prisma.authSession.findMany({
    where: { userId: trainer.id },
  });
  const destroyed = current.find((x) => x.sid === row?.sid) ? null : row;
  if (destroyed)
    await assert.rejects(
      () =>
        new Promise((ok, no) =>
          store.set(destroyed.sid, destroyed.sess, (e) => (e ? no(e) : ok())),
        ),
    );
});
test("server idle and absolute expiry; pre-auth expiration", async () => {
  for (const kind of ["idle", "absolute"]) {
    const { cookie } = await login("trainer");
    if (kind === "idle")
      await db.pool.query(
        'UPDATE "AuthSession" SET expire=now()-interval \'1 second\' WHERE "userId"=$1',
        [trainer.id],
      );
    else
      await db.pool.query(
        'UPDATE "AuthSession" SET expire=now()-interval \'1 second\',"absoluteAt"=now()-interval \'1 second\' WHERE "userId"=$1',
        [trainer.id],
      );
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
  }
  const agent = request.agent(app);
  const r = await agent.get("/login");
  const token = r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await db.pool.query(
    'UPDATE "AuthSession" SET expire=now()-interval \'1 second\',"absoluteAt"=now()-interval \'1 second\' WHERE "userId" IS NULL',
  );
  await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ login: "trainer", password: secret, _csrf: token })
    .expect(403);
});
test("password reset, role change and deactivation revoke ALL exact user sessions", async () => {
  const first = await login("trainer"),
    second = await login("trainer"),
    other = await login("admin");
  await users.change(trainer.id, { password: secret });
  for (const x of [first, second])
    await request(app).get("/api/auth/me").set("Cookie", x.cookie).expect(401);
  await other.agent.get("/api/auth/me").expect(200);
  const current = await login("trainer");
  await users.change(trainer.id, { role: "ADMIN" });
  await request(app)
    .get("/api/auth/me")
    .set("Cookie", current.cookie)
    .expect(401);
  await users.change(trainer.id, { role: "TRAINER" });
  const active = await login("trainer");
  await users.change(trainer.id, { active: false });
  await request(app)
    .get("/api/auth/me")
    .set("Cookie", active.cookie)
    .expect(401);
  await users.change(trainer.id, { active: true });
});
test("self password change for TRAINER; privilege escalation/mass assignment rejected", async () => {
  const { agent, token, cookie } = await login("trainer");
  await agent
    .post("/api/auth/password")
    .set("Origin", config.APP_ORIGIN)
    .send({
      currentPassword: secret,
      newPassword: secret,
      _csrf: token,
      role: "OWNER",
    })
    .expect(400);
  await agent
    .post("/api/auth/password")
    .set("Origin", config.APP_ORIGIN)
    .send({ currentPassword: secret, newPassword: secret, _csrf: token })
    .expect(200);
  await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
  await assert.rejects(() =>
    users.change(
      trainer.id,
      { role: "OWNER" },
      { actorId: trainer.id, operatorHash: "invalid" },
    ),
  );
});
test("last active owner cannot be disabled/demoted even under concurrent mutation", async () => {
  await assert.rejects(
    () => users.change(owner.id, { active: false }),
    /LAST_OWNER/,
  );
  await assert.rejects(
    () => users.change(owner.id, { role: "TRAINER" }),
    /LAST_OWNER/,
  );
  const extra = await users.create({
    login: "owner-two",
    displayName: "Второй",
    role: "OWNER",
    password: secret,
  });
  const results = await Promise.allSettled([
    users.change(owner.id, { active: false }),
    users.change(extra.id, { role: "ADMIN" }),
  ]);
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    await db.prisma.user.count({ where: { role: "OWNER", active: true } }),
    1,
  );
  await users.change(owner.id, { active: true });
  await users.change(extra.id, { active: false });
});
test("DB constraints, transactional audit, store touch and prune", async () => {
  await assert.rejects(() =>
    db.pool.query(
      'INSERT INTO "AuthSession" (sid,sess,expire,"absoluteAt","userId","authVersion") VALUES ($1,\'{}\',now(),now(),$2,1)',
      ["invalid", randomUUID()],
    ),
  );
  await login("admin");
  const row = await db.prisma.authSession.findFirst({
    where: { userId: admin.id },
  });
  await new Promise((ok, no) =>
    store.touch(row.sid, row.sess, (e) => (e ? no(e) : ok())),
  );
  const touched = await db.prisma.authSession.findUnique({
    where: { sid: row.sid },
  });
  assert.ok(touched.expire <= touched.absoluteAt);
  await db.pool.query(
    "UPDATE \"AuthSession\" SET expire=now()-interval '1 second' WHERE sid=$1",
    [row.sid],
  );
  await new Promise((ok, no) => store.pruneSessions((e) => (e ? no(e) : ok())));
  assert.equal(
    await db.prisma.authSession.findUnique({ where: { sid: row.sid } }),
    null,
  );
  const audit = await db.prisma.auditEvent.findMany();
  assert.ok(audit.some((x) => x.action === "LOGIN_SUCCESS"));
  assert.ok(audit.some((x) => x.action === "USER_PASSWORD_CHANGED"));
  assert.ok(!JSON.stringify(audit).includes(secret));
  assert.ok(!JSON.stringify(logs).includes(secret));
});
test("login per-account rate limit ignores forged forwarding headers", async () => {
  const agent = request.agent(app);
  const r = await agent.get("/login");
  const token = r.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  let limited = false;
  for (let i = 0; i < 12; i++) {
    const result = await agent
      .post("/login")
      .set("Origin", config.APP_ORIGIN)
      .set("X-Forwarded-For", `192.0.2.${i + 1}`)
      .type("form")
      .send({ login: "limit-user", password: "wrong", _csrf: token });
    if (result.status === 429) {
      limited = true;
      break;
    }
    assert.equal(result.status, 401);
  }
  assert.ok(limited);
});
test("access mutation and audit are atomic when audit fails", async () => {
  const original = await db.prisma.user.findUnique({ where: { id: admin.id } });
  await db.pool.query(
    `CREATE FUNCTION ideal_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit unavailable'; END $$`,
  );
  await db.pool.query(
    `CREATE TRIGGER ideal_reject_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION ideal_reject_audit()`,
  );
  try {
    await assert.rejects(() => users.change(admin.id, { active: false }));
    const after = await db.prisma.user.findUnique({ where: { id: admin.id } });
    assert.equal(after.active, original.active);
    assert.equal(after.authVersion, original.authVersion);
  } finally {
    await db.pool.query('DROP TRIGGER ideal_reject_audit ON "AuditEvent"');
    await db.pool.query("DROP FUNCTION ideal_reject_audit()");
  }
});
test("stale password/version cannot establish a new session after revocation", async () => {
  const old = await db.prisma.user.findUnique({ where: { id: admin.id } });
  await users.change(admin.id, { password: secret });
  await assert.rejects(
    () =>
      store.establish(
        "stale-session",
        { userId: admin.id, authVersion: old.authVersion },
        old,
        randomUUID(),
      ),
    /ACCESS_CHANGED/,
  );
  assert.equal(
    await db.prisma.authSession.findUnique({ where: { sid: "stale-session" } }),
    null,
  );
});
test("logout revocation survives concurrent session save and touch", async () => {
  const session = await login("admin");
  const live = await db.prisma.authSession.findMany({
    where: { userId: admin.id },
  });
  assert.equal(live.length, 1);
  const row = live[0];
  await session.agent
    .post("/api/auth/logout")
    .set("Origin", config.APP_ORIGIN)
    .send({ _csrf: session.token })
    .expect(200);
  const results = await Promise.allSettled([
    new Promise((ok, no) =>
      store.set(row.sid, row.sess, (e) => (e ? no(e) : ok())),
    ),
    new Promise((ok, no) =>
      store.touch(row.sid, row.sess, (e) => (e ? no(e) : ok())),
    ),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.equal(
    await db.prisma.authSession.count({ where: { sid: row.sid } }),
    0,
  );
});
test("store/database errors fail closed, safe 500 and no secret logging", async () => {
  const current = await login("owner");
  const savedGet = store.get;
  store.get = (_sid, callback) =>
    callback(new Error("DATABASE_PASSWORD_SECRET"));
  try {
    const r = await current.agent.get("/api/auth/me").expect(500);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.ok(!r.text.includes("DATABASE_PASSWORD_SECRET"));
    assert.ok(!r.text.includes("stack"));
    assert.ok(!JSON.stringify(logs).includes("DATABASE_PASSWORD_SECRET"));
  } finally {
    store.get = savedGet;
  }
});
test("production cookie flags with a simulated trusted loopback HTTPS proxy", async () => {
  const production = readConfig({
    ...process.env,
    NODE_ENV: "production",
    APP_ORIGIN: "https://ideal.example",
    TRUST_PROXY: "loopback",
  });
  const result = await createApp({ config: production, db });
  try {
    const response = await request(result.app)
      .get("/login")
      .set("X-Forwarded-Proto", "https")
      .expect(200);
    const cookie = response.headers["set-cookie"][0];
    assert.match(cookie, /^__Host-ideal.sid=/);
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(!cookie.includes("Domain="));
    assert.match(
      response.headers["strict-transport-security"],
      /max-age=31536000/,
    );
  } finally {
    result.store.close();
  }
});

test("OWNER panel: independent authorization for every new page and operation", async () => {
  const paths = [
    "/admin/employees",
    "/admin/employees/new",
    "/admin/account",
    `/admin/employees/${admin.id}`,
    "/api/admin/employees",
  ];
  for (const path of paths)
    await request(app)
      .get(path)
      .expect(path.startsWith("/api/") ? 401 : 303);
  for (const role of ["admin", "trainer"]) {
    const session = await login(role);
    for (const path of paths) await session.agent.get(path).expect(403);
    for (const path of [
      "/api/admin/employees",
      `/api/admin/employees/${admin.id}/name`,
      `/api/admin/employees/${admin.id}/role`,
      `/api/admin/employees/${admin.id}/active`,
    ])
      await session.agent
        .post(path)
        .set("Origin", config.APP_ORIGIN)
        .send({ _csrf: session.token })
        .expect(403);
  }
});
test("OWNER panel: forms, validation, duplicates, search and safe projections", async () => {
  const s = await login("owner");
  for (const path of [
    "/admin",
    "/admin/employees",
    "/admin/employees/new",
    "/admin/account",
    `/admin/employees/${admin.id}`,
  ]) {
    const r = await s.agent.get(path).expect(200);
    assert.ok(!r.text.includes(secret));
    assert.ok(!r.text.includes("passwordHash"));
  }
  const body = {
    _csrf: s.token,
    ownerPassword: secret,
    confirm: "yes",
    login: "panel-user",
    displayName: "<script>Имя</script>",
    role: "TRAINER",
    password: secret,
  };
  const post = (data) =>
    s.agent
      .post("/api/admin/employees")
      .set("Origin", config.APP_ORIGIN)
      .send(data);
  await s.agent.post("/api/admin/employees").send(body).expect(403);
  await post({ ...body, _csrf: "f".repeat(64) }).expect(403);
  await post({ ...body, authVersion: 1 }).expect(400);
  await post({ ...body, ownerPassword: "wrong" }).expect(403);
  await post({ ...body, confirm: "no" }).expect(400);
  const created = await post(body).expect(201);
  assert.deepEqual(Object.keys(created.body.user).sort(), [
    "id",
    "login",
    "role",
  ]);
  await post(body).expect(409);
  const listed = await s.agent
    .get("/api/admin/employees?q=panel-user&role=TRAINER&active=true")
    .expect(200);
  assert.equal(listed.body.total, 1);
  assert.deepEqual(Object.keys(listed.body.items[0]).sort(), [
    "active",
    "displayName",
    "id",
    "login",
    "role",
  ]);
  await s.agent.get("/api/admin/employees?active=wat").expect(400);
  const page = await s.agent.get("/admin/employees?q=panel-user").expect(200);
  assert.ok(page.text.includes("&lt;script&gt;Имя&lt;/script&gt;"));
  const employee = created.body.user;
  const target = await login("panel-user");
  const mutate = (action, data) =>
    s.agent
      .post(`/api/admin/employees/${employee.id}/${action}`)
      .set("Origin", config.APP_ORIGIN)
      .send({ _csrf: s.token, ownerPassword: secret, confirm: "yes", ...data });
  await mutate("name", { displayName: "Новое имя" }).expect(200);
  await target.agent.get("/api/auth/me").expect(200);
  await mutate("name", { displayName: "Новое имя", role: "OWNER" }).expect(400);
  await mutate("role", { role: "ADMIN" }).expect(200);
  await target.agent.get("/api/auth/me").expect(401);
  const target2 = await login("panel-user");
  await mutate("active", { active: "false" }).expect(200);
  await target2.agent.get("/api/auth/me").expect(401);
  await s.agent.get("/api/auth/me").expect(200);
  await mutate("active", { active: "true" }).expect(200);
  await mutate("role", { role: "OWNER", ownerPassword: "wrong" }).expect(403);
  await mutate("role", { role: "OWNER" }).expect(200);
  await mutate("active", { active: "false" }).expect(200);
  const audit = await db.prisma.auditEvent.findMany({
    where: { targetId: employee.id },
  });
  assert.ok(audit.some((x) => x.action === "USER_DISPLAYNAME_CHANGED"));
  assert.ok(!JSON.stringify(audit).includes(secret));
});
test("OWNER HTTP: concurrent last-owner protection and audit rollback", async () => {
  const a = await login("owner");
  const extra = await users.create({
    login: "race-owner",
    displayName: "Второй",
    role: "OWNER",
    password: secret,
  });
  const b = await login("race-owner");
  const disable = (session, target) =>
    session.agent
      .post(`/api/admin/employees/${target}/active`)
      .set("Origin", config.APP_ORIGIN)
      .send({
        _csrf: session.token,
        ownerPassword: secret,
        confirm: "yes",
        active: "false",
      });
  const results = await Promise.all([
    disable(a, owner.id),
    disable(b, extra.id),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  await users.change(owner.id, { active: true });
  await users.change(extra.id, { active: false });
  const s = await login("owner");
  const before = await db.prisma.user.findUnique({ where: { id: admin.id } });
  await db.pool.query(
    `CREATE FUNCTION panel_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private db failure'; END $$`,
  );
  await db.pool.query(
    `CREATE TRIGGER panel_reject_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION panel_reject_audit()`,
  );
  try {
    const r = await s.agent
      .post(`/api/admin/employees/${admin.id}/name`)
      .set("Origin", config.APP_ORIGIN)
      .send({
        _csrf: s.token,
        ownerPassword: secret,
        confirm: "yes",
        displayName: "Не сохранить",
      })
      .expect(500);
    assert.ok(!r.text.includes("private db failure"));
    assert.equal(
      (await db.prisma.user.findUnique({ where: { id: admin.id } }))
        .displayName,
      before.displayName,
    );
  } finally {
    await db.pool.query('DROP TRIGGER panel_reject_audit ON "AuditEvent"');
    await db.pool.query("DROP FUNCTION panel_reject_audit()");
  }
});
test("OWNER no-JS password form revokes all own sessions and redirects to login", async () => {
  const a = await login("owner"),
    b = await login("owner");
  await a.agent
    .post("/admin/account/password")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ _csrf: a.token, currentPassword: secret, newPassword: secret })
    .expect(303)
    .expect("Location", "/login");
  for (const s of [a, b]) await s.agent.get("/api/auth/me").expect(401);
});
test("OWNER mutation rejects an actor whose access version changed after authorization", async () => {
  const actor = await db.prisma.user.findUnique({ where: { id: owner.id } });
  await users.change(owner.id, { password: secret });
  await assert.rejects(
    () =>
      users.change(
        admin.id,
        { displayName: "Недопустимо" },
        {
          actorId: owner.id,
          operatorHash: actor.passwordHash,
          expectedVersion: actor.authVersion,
        },
      ),
    /FORBIDDEN/,
  );
});
test("OWNER critical endpoints all require CSRF and exact Origin", async () => {
  const s = await login("owner");
  for (const path of [
    "/api/admin/employees",
    ...["name", "role", "active"].map(
      (action) => `/api/admin/employees/${admin.id}/${action}`,
    ),
    "/admin/account/password",
  ]) {
    await request(app)
      .post(path)
      .send({})
      .expect(path.startsWith("/api/") ? 401 : 303);
    await s.agent.post(path).send({ _csrf: s.token }).expect(403);
    await s.agent
      .post(path)
      .set("Origin", "https://evil.example")
      .send({ _csrf: s.token })
      .expect(403);
    await s.agent
      .post(path)
      .set("Origin", config.APP_ORIGIN)
      .send({})
      .expect(403);
  }
});

test("TRAINER shell: every page is private, roles exclusive, identity server-owned", async () => {
  // Isolate the new suite from earlier tests' accumulated process-local rate counters.
  store.close();
  ({ app, store, users } = await createApp({ config, db, log: (line) => logs.push(line) }));
  const paths = ["/trainer", "/trainer/clients", "/trainer/lessons", "/trainer/account"];
  for (const path of paths) await request(app).get(path).expect(303).expect("Location", "/login");
  for (const role of ["owner", "admin"]) {
    const s = await login(role);
    for (const path of paths) await s.agent.get(path).expect(403);
    await s.agent.post("/trainer/account/password").expect(403);
  }
  const s = await login("trainer");
  for (const path of paths) {
    if(path === "/trainer/clients") await s.agent.get(`${path}?userId=${owner.id}&trainerId=foreign&id=${admin.id}`).expect(400);
    const r = await s.agent.get(path === "/trainer/clients" ? path : `${path}?userId=${owner.id}&trainerId=foreign&id=${admin.id}`).expect(200);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.match(r.text, /Кабинет тренера/);
    assert.ok(!r.text.includes(secret));
    for (const field of ["passwordHash", "authVersion", owner.id, admin.id, "AuthSession"])
      assert.ok(!r.text.includes(field));
    assert.match(r.text, /method="post" action="\/logout"/);
  }
  const account = await s.agent.get("/trainer/account");
  assert.match(account.text, /Логин: trainer/);
  assert.match(account.text, /Роль: тренер/);
  assert.ok(!account.text.includes('name="userId"'));
  for (const [path, message] of [["clients", /Клиентов не найдено/], ["lessons", /Расписание ещё не подключено/]]) {
    const r = await s.agent.get(`/trainer/${path}`);
    assert.match(r.text, message);
    assert.equal(r.text.includes('type="search"'),path==='clients');
  }
  // Real scoped clients API; unknown namespace routes remain protected.
  await request(app).get("/api/trainer/clients").expect(401);
  await s.agent.get("/api/trainer/clients").expect(200);
  await s.agent.get(`/trainer/account/${owner.id}`).expect(404);
  await s.agent.post("/trainer/clients").send({ userId: owner.id }).expect(404);
});
test("TRAINER password form: Origin/CSRF, strict fields, errors and all-session revocation", async () => {
  const path = "/trainer/account/password";
  // Negative security requests consume the real shared password limiter.
  // Keep them in a separate app instance from the password-change scenario.
  const security = await login("trainer");
  const securityBody = { _csrf: security.token, currentPassword: secret, newPassword: secret };
  await request(app).post(path).send(securityBody).expect(303);
  await security.agent.post(path).send(securityBody).expect(403);
  await security.agent.post(path).set("Origin", "https://evil.example").send(securityBody).expect(403);
  await security.agent.post(path).set("Origin", config.APP_ORIGIN).send({ ...securityBody, _csrf: "" }).expect(403);
  store.close();
  ({ app, store, users } = await createApp({ config, db, log: (line) => logs.push(line) }));
  // New agents must target the new app; persistent sessions remain in the test DB.
  const a = await login("trainer"), b = await login("trainer");
  const body = { _csrf: a.token, currentPassword: secret, newPassword: secret };
  for (const changes of [{ userId: owner.id }, { currentPassword: "incorrect" }]) {
    const r = await a.agent.post(path).set("Origin", config.APP_ORIGIN).type("form").send({ ...body, ...changes }).expect(400);
    assert.match(r.text, /Проверьте текущий пароль/);
    assert.match(r.text, /action="\/trainer\/account\/password"/);
    assert.ok(!r.text.includes(secret));
  }
  await a.agent.post(path).set("Origin", config.APP_ORIGIN).type("form").send(body).expect(303).expect("Location", "/login");
  for (const s of [a, b]) {
    await s.agent.get("/trainer/account").expect(303);
    await s.agent.get("/api/trainer/check").expect(401);
  }
  await (await login("trainer")).agent.get("/trainer").expect(200);
});
test("TRAINER shell: disabled, changed-role and revoked sessions lose every private page", async () => {
  for (const change of [{ active: false }, { role: "ADMIN" }, { password: secret }]) {
    const s = await login("trainer");
    await users.change(trainer.id, change);
    for (const path of ["/trainer", "/trainer/clients", "/trainer/lessons", "/trainer/account"])
      await s.agent.get(path).expect(303);
    await s.agent.get("/api/trainer/check").expect(401);
    await users.change(trainer.id, { active: true, role: "TRAINER" });
  }
});
test("self password mutation rejects stale access version even with unchanged password hash", async () => {
  const before = await db.prisma.user.findUnique({ where: { id: trainer.id } });
  await users.change(trainer.id, { role: "ADMIN" });
  try {
    await assert.rejects(() => users.change(trainer.id, { password: secret }, {
      self: true, actorId: trainer.id, operatorHash: before.passwordHash,
      expectedVersion: before.authVersion,
    }), /FORBIDDEN/);
  } finally { await users.change(trainer.id, { role: "TRAINER" }); }
});
