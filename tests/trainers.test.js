import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import sharp from "sharp";
import { randomBytes, randomUUID } from "node:crypto";
import { readConfig } from "../server/config/env.js";
import { createDatabase } from "../server/db/client.js";
import { createApp } from "../server/app.js";
import { clearCrm } from "./helpers/crm.js";
import { trainerProfileService } from "../server/modules/trainers/service.js";
import { publicSchedule } from "../server/modules/public/schedule.js";
import { clubDateTime } from "../server/modules/schedule/dates.js";
import { today } from "../server/modules/crm/dates.js";
const config = readConfig();
if (
  config.NODE_ENV !== "test" ||
  !new URL(config.DATABASE_URL).pathname.endsWith("_test")
)
  throw Error("TEST_DB_REQUIRED");
const db = createDatabase(config.DATABASE_URL),
  password = randomBytes(24).toString("hex");
let app, store, users, owner, trainer, admin;
const values = {
  publicName: "Согласованное имя",
  specialty: "Силовые тренировки",
  summary: "Кратко",
  biography: "Биография",
  experience: "",
  qualification: "",
  approach: "",
  directions: "",
  achievements: "",
  publicOrder: "0",
};
async function login(name) {
  const agent = request.agent(app);
  const p = await agent.get("/login");
  const token = p.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  await agent
    .post("/login")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ _csrf: token, login: name, password })
    .expect(303);
  return { agent, token: (await agent.get("/api/auth/me")).body.csrf };
}
async function post(
  s,
  id,
  action,
  data = {},
  status = 303,
  key = randomUUID(),
) {
  return s.agent
    .post("/admin/public-trainers/" + id + "/" + action)
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ _csrf: s.token, key, ...data })
    .expect(status);
}
async function profile() {
  return db.prisma.trainerProfile.upsert({
    where: { userId: trainer.id },
    create: { userId: trainer.id },
    update: {},
  });
}
async function publish() {
  const s = await login("pubowner"),
    p = await profile();
  await post(s, p.id, "save", { ...values, version: p.publicVersion });
  await post(s, p.id, "publish", {
    version: p.publicVersion + 1,
    visible: "true",
    confirm: "PUBLIC",
  });
  return { s, p: await profile() };
}
before(async () => {
  await clearCrm(db.prisma);
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.authSession.deleteMany();
  await db.prisma.user.deleteMany();
  ({ app, store, users } = await createApp({ config, db }));
  for (const [loginName, role] of [
    ["pubowner", "OWNER"],
    ["pubtrainer", "TRAINER"],
    ["pubadmin", "ADMIN"],
  ]) {
    const u = await users.create({
      login: loginName,
      displayName: "PRIVATE_" + loginName,
      role,
      password,
    });
    if (role === "OWNER") owner = u;
    else if (role === "TRAINER") trainer = u;
    else admin = u;
  }
});
beforeEach(async () => {
  await clearCrm(db.prisma);
  store.close();
  ({ app, store, users } = await createApp({ config, db }));
  await db.prisma.user.update({
    where: { id: trainer.id },
    data: { role: "TRAINER", active: true },
  });
});
after(async () => {
  store?.close();
  await clearCrm(db.prisma);
  await db.prisma.auditEvent.deleteMany();
  await db.prisma.authSession.deleteMany();
  await db.prisma.user.deleteMany();
  await db.close();
});
test("trainers: OWNER-only pages/mutations and CSRF/Origin guards", async () => {
  await request(app).get("/admin/public-trainers").expect(303);
  for (const name of ["pubtrainer", "pubadmin"]) {
    const s = await login(name);
    await s.agent.get("/admin/public-trainers").expect(403);
    await post(s, trainer.id, "create", {}, 403);
  }
  const s = await login("pubowner");
  await s.agent.get("/admin/public-trainers").expect(200);
  await s.agent
    .post("/admin/public-trainers/" + trainer.id + "/create")
    .type("form")
    .send({ _csrf: s.token, key: randomUUID() })
    .expect(403);
  await s.agent
    .post("/admin/public-trainers/" + trainer.id + "/create")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({ key: randomUUID() })
    .expect(403);
  assert.equal(await db.prisma.trainerProfile.count(), 0);
});
test("trainers: explicit hidden creation, no staff name fallback and stable distinct public key", async () => {
  const s = await login("pubowner");
  await post(s, trainer.id, "create");
  const p = await profile();
  assert.equal(p.publicName, "");
  assert.equal(p.publicVisible, false);
  assert.match(p.publicKey, /^[a-f0-9]{32}$/);
  assert.notEqual(p.publicKey, p.id.replaceAll("-", ""));
  assert.notEqual(p.publicKey, trainer.id.replaceAll("-", ""));
  await post(
    s,
    p.id,
    "publish",
    { version: p.publicVersion, visible: "true", confirm: "PUBLIC" },
    409,
  );
  const list = await request(app).get("/trainers.html").expect(200);
  assert.doesNotMatch(list.text, /PRIVATE_pubtrainer/);
  await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(404);
  for (const id of [owner.id, admin.id]) await post(s, id, "create", {}, 409);
});
test("trainers: saving never publishes, explicit publish/sort/hide and shared name", async () => {
  const { s, p } = await publish();
  const res = await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(200);
  assert.match(res.text, /Согласованное имя/);
  assert.doesNotMatch(
    res.text,
    /PRIVATE_pubtrainer|pubtrainer|authVersion|passwordHash/,
  );
  await post(s, p.id, "save", {
    ...values,
    publicName: "Другое имя",
    version: p.publicVersion,
  });
  const q = await profile();
  assert.equal(q.publicKey, p.publicKey);
  assert.equal(q.publicName, "Другое имя");
  await post(s, q.id, "save", {
    ...values,
    publicName: "",
    version: q.publicVersion,
  });
  await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(404);
  const r = await profile();
  await post(s, r.id, "publish", {
    version: r.publicVersion,
    visible: "false",
    confirm: "PUBLIC",
  });
  assert.equal((await profile()).publicVisible, false);
  await post(s, r.id, "save", { ...values, version: r.publicVersion + 1 });
  assert.equal((await profile()).publicVisible, false);
});
test("trainers: stale versions, replay/fingerprint and audit rollback", async () => {
  const s = await login("pubowner"),
    p = await profile(),
    key = randomUUID();
  const body = { ...values, version: p.publicVersion };
  await post(s, p.id, "save", body, 303, key);
  await post(s, p.id, "save", body, 303, key);
  assert.equal((await profile()).publicVersion, p.publicVersion + 1);
  await post(s, p.id, "save", { ...body, publicName: "Подмена" }, 409, key);
  await post(s, p.id, "save", body, 409);
  assert.equal(
    (await db.prisma.auditEvent.count({
      where: { action: "TRAINER_PROFILE_SAVE", targetId: p.id },
    })) >= 1,
    true,
  );
  const proxy = new Proxy(db.prisma, {
    get(target, prop) {
      if (prop === "$transaction")
        return (cb, options) =>
          target.$transaction(
            (tx) =>
              cb(
                new Proxy(tx, {
                  get(t, k) {
                    if (k === "auditEvent")
                      return {
                        create: async () => {
                          throw Error("AUDIT_DOWN");
                        },
                      };
                    return t[k];
                  },
                }),
              ),
            options,
          );
      return target[prop];
    },
  });
  const me = await s.agent.get("/api/auth/me");
  const session = await db.prisma.authSession.findFirst({
    where: { userId: owner.id },
    orderBy: { expire: "desc" },
  });
  const service = trainerProfileService(proxy);
  const current = await profile();
  await assert.rejects(() =>
    service.save(
      {
        actorId: owner.id,
        authVersion: session.authVersion,
        sessionId: session.sid,
        key: randomUUID(),
        version: current.publicVersion,
      },
      p.id,
      { ...values, publicName: "Не сохранять" },
    ),
  );
  assert.equal((await profile()).publicName, values.publicName);
});
test("trainers: current session/role enforced inside transaction", async () => {
  const p = await profile();
  const service = trainerProfileService(db.prisma);
  for (const ctx of [
    { actorId: owner.id, authVersion: 1, sessionId: "absent" },
    { actorId: admin.id, authVersion: 1, sessionId: "absent" },
  ])
    await assert.rejects(
      () =>
        service.save(
          { ...ctx, key: randomUUID(), version: p.publicVersion },
          p.id,
          values,
        ),
      (e) => e.status === 403,
    );
});
test("trainers: deactivation and role changes hide profiles/photo, preserve materials and lesson flags", async () => {
  const { p } = await publish();
  const lesson = await db.prisma.lesson.create({
    data: {
      trainerId: p.id,
      createdById: owner.id,
      kind: "GROUP",
      title: "Публичное занятие",
      startsAt: clubDateTime(today(), "10:00"),
      endsAt: clubDateTime(today(), "11:00"),
      capacity: 10,
      publicVisible: true,
    },
  });
  assert.equal(
    (await publicSchedule(db.prisma)).items.find(
      (x) => x.title === lesson.title,
    ).trainerName,
    values.publicName,
  );
  await users.change(trainer.id, { active: false });
  let q = await profile();
  assert.equal(q.publicVisible, false);
  assert.equal(q.publicName, p.publicName);
  assert.equal(
    (await db.prisma.lesson.findUnique({ where: { id: lesson.id } }))
      .publicVisible,
    true,
  );
  await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(404);
  await users.change(trainer.id, { active: true });
  await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(404);
  assert.equal(
    (await publicSchedule(db.prisma)).items.find(
      (x) => x.title === lesson.title,
    ).trainerName,
    values.publicName,
  );
  const s = await login("pubowner");
  q = await profile();
  await post(s, q.id, "publish", {
    version: q.publicVersion,
    visible: "true",
    confirm: "PUBLIC",
  });
  await users.change(trainer.id, { role: "ADMIN" });
  q = await profile();
  assert.equal(q.publicVisible, false);
  assert.equal(q.biography, values.biography);
  await users.change(trainer.id, { role: "TRAINER" });
  await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(404);
});
test("trainers: schedule name edits share version and invalidate stale profile form", async () => {
  const { s, p } = await publish();
  const lesson = await db.prisma.lesson.create({
    data: {
      trainerId: p.id,
      createdById: owner.id,
      kind: "GROUP",
      title: "Занятие",
      startsAt: clubDateTime(today(), "10:00"),
      endsAt: clubDateTime(today(), "11:00"),
      capacity: 10,
      publicVisible: true,
    },
  });
  await s.agent
    .post("/crm/schedule/" + lesson.id + "/public-trainer")
    .set("Origin", config.APP_ORIGIN)
    .type("form")
    .send({
      _csrf: s.token,
      key: randomUUID(),
      publicVersion: p.publicVersion,
      publicName: "Имя из расписания",
    })
    .expect(303);
  await post(s, p.id, "save", { ...values, version: p.publicVersion }, 409);
  assert.match(
    (await request(app).get("/trainers/" + p.publicKey)).text,
    /Имя из расписания/,
  );
});
test("trainers: photo normalization, metadata removal, hidden access, stale upload, replacement and removal", async () => {
  const { s, p } = await publish();
  const image = await sharp({
    create: { width: 80, height: 100, channels: 3, background: "#abcdef" },
  })
    .jpeg()
    .withMetadata()
    .toBuffer();
  async function upload(
    bytes,
    version = p.publicVersion,
    expected = 303,
    name = "photo.jpg",
    mime = "image/jpeg",
    csrf = s.token,
    origin = config.APP_ORIGIN,
  ) {
    return s.agent
      .post("/admin/public-trainers/" + p.id + "/photo")
      .set("Origin", origin)
      .field("_csrf", csrf)
      .field("key", randomUUID())
      .field("version", String(version))
      .attach("image", bytes, { filename: name, contentType: mime })
      .expect(expected);
  }
  await upload(image);
  const photo = await db.prisma.trainerPhoto.findUnique({
    where: { trainerId: p.id },
  });
  const metadata = await sharp(photo.data).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  const r = await request(app)
    .get("/trainers/" + p.publicKey + "/photo")
    .expect(200);
  assert.match(r.headers["content-type"], /image\/webp/);
  assert.equal(r.headers["cache-control"], "no-store");
  assert.equal(r.headers["set-cookie"], undefined);
  await upload(image, p.publicVersion, 409);
  await upload(Buffer.from("fake"), p.publicVersion + 1, 400);
  await upload(image, p.publicVersion + 1, 400, "photo.svg", "image/svg+xml");
  await upload(
    image,
    p.publicVersion + 1,
    403,
    "photo.jpg",
    "image/jpeg",
    "bad",
  );
  await upload(
    image,
    p.publicVersion + 1,
    403,
    "photo.jpg",
    "image/jpeg",
    s.token,
    "https://other.invalid",
  );
  await upload(image, p.publicVersion + 1);
  let q = await profile();
  await post(s, p.id, "publish", {
    version: q.publicVersion,
    visible: "false",
    confirm: "PUBLIC",
  });
  await request(app)
    .get("/trainers/" + p.publicKey + "/photo")
    .expect(404);
  q = await profile();
  await post(s, p.id, "delete-photo", {
    version: q.publicVersion,
    confirm: "DELETE",
  });
  assert.equal(await db.prisma.trainerPhoto.count(), 0);
});
test("trainers: deterministic ordering, escaped malicious text, minimal optional sections", async () => {
  const { s, p } = await publish();
  const u = await users.create({
    login: "pubextra",
    displayName: "PRIVATE_EXTRA",
    role: "TRAINER",
    password,
  });
  const q = await db.prisma.trainerProfile.create({
    data: {
      userId: u.id,
      publicName: "Первый",
      publicVisible: true,
      publicOrder: 0,
    },
  });
  await post(s, p.id, "save", {
    ...values,
    publicOrder: 5,
    publicName: "<script>alert(1)</script>",
    summary: "",
    biography: "",
    version: p.publicVersion,
  });
  const list = await request(app).get("/trainers.html").expect(200);
  assert.ok(list.text.indexOf(q.publicKey) < list.text.indexOf(p.publicKey));
  const r = await request(app)
    .get("/trainers/" + p.publicKey)
    .expect(200);
  assert.match(r.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(r.text, /id="detail-|<script>alert/);
  await db.prisma.user.delete({ where: { id: u.id } });
});
