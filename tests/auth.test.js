import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { createApp } from "../server/app.js";
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
test("schema: only auth entities and explicit FK; bootstrap cannot repeat", async () => {
  const rows = await db.pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`,
  );
  assert.deepEqual(
    rows.rows.map((x) => x.tablename).sort(),
    ["AuditEvent", "AuthSession", "User", "_prisma_migrations"].sort(),
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
    const r = await agent.get(`/${path}`).expect(200);
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
