// Transaction fixtures exercise policy and route boundaries, not PostgreSQL behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import sharp from "sharp";
import { trainerProfileService } from "../server/modules/trainers/service.js";
import { trainerManagementRoutes } from "../server/modules/trainers/routes.js";
const fields = {
  publicName: "Имя",
  specialty: "",
  summary: "",
  biography: "",
  experience: "",
  qualification: "",
  approach: "",
  directions: "",
  achievements: "",
  publicOrder: 0,
};
function fixture() {
  const owner = {
    id: randomUUID(),
    role: "OWNER",
    active: true,
    authVersion: 2,
  };
  const profile = {
    id: randomUUID(),
    userId: randomUUID(),
    publicKey: "a".repeat(32),
    publicName: "",
    publicVisible: false,
    publicVersion: 1,
    user: { role: "TRAINER", active: true },
  };
  const state = { profile, operations: [], audits: [], photo: null };
  let auditDown = false,
    session = true;
  const prisma = {
    $transaction: async (callback) => {
      const backup = structuredClone(state);
      const tx = {
        $executeRaw: async () => 1,
        user: { findUnique: async () => ({ ...owner }) },
        authSession: {
          findFirst: async (q) => {
            assert.equal(q.where.userId, owner.id);
            assert.equal(q.where.authVersion, owner.authVersion);
            assert.ok(q.where.expire.gt instanceof Date);
            assert.ok(q.where.absoluteAt.gt instanceof Date);
            return session && q.where.sid === "valid" ? {} : null;
          },
        },
        crmOperation: {
          findUnique: async (q) =>
            state.operations.find(
              (x) =>
                x.actorId === q.where.actorId_key.actorId &&
                x.key === q.where.actorId_key.key,
            ),
          create: async ({ data }) => state.operations.push(data),
        },
        auditEvent: {
          create: async ({ data }) => {
            if (auditDown) throw Error("AUDIT_DOWN");
            state.audits.push(data);
          },
        },
        trainerProfile: {
          findUnique: async () => structuredClone(state.profile),
          update: async ({ data }) => {
            for (const [k, v] of Object.entries(data))
              state.profile[k] =
                k === "publicVersion" ? state.profile[k] + v.increment : v;
            return state.profile;
          },
        },
        trainerPhoto: {
          upsert: async ({ create }) => {
            state.photo = create.data;
          },
          deleteMany: async () => {
            state.photo = null;
          },
        },
      };
      try {
        return await callback(tx);
      } catch (e) {
        Object.assign(state, backup);
        throw e;
      }
    },
  };
  const ctx = () => ({
    actorId: owner.id,
    authVersion: 2,
    sessionId: "valid",
    key: randomUUID(),
    version: state.profile.publicVersion,
  });
  return {
    owner,
    profile,
    state,
    prisma,
    ctx,
    service: trainerProfileService(prisma),
    down: () => {
      auditDown = true;
    },
    expire: () => {
      session = false;
    },
  };
}
test("trainer mutations fixture: explicit publication, blank name and role checks, save does not publish", async () => {
  const f = fixture();
  await assert.rejects(
    () =>
      f.service.publish(f.ctx(), f.profile.id, {
        visible: "true",
        confirm: "PUBLIC",
      }),
    (e) => e.status === 409,
  );
  await f.service.save(f.ctx(), f.profile.id, fields);
  assert.equal(f.state.profile.publicVisible, false);
  await f.service.publish(f.ctx(), f.profile.id, {
    visible: "true",
    confirm: "PUBLIC",
  });
  assert.equal(f.state.profile.publicVisible, true);
  await f.service.save(f.ctx(), f.profile.id, { ...fields, publicName: "" });
  assert.equal(f.state.profile.publicName, "");
  f.state.profile.user.role = "ADMIN";
  await assert.rejects(
    () =>
      f.service.publish(f.ctx(), f.profile.id, {
        visible: "true",
        confirm: "PUBLIC",
      }),
    (e) => e.status === 409,
  );
  await f.service.publish(f.ctx(), f.profile.id, {
    visible: "false",
    confirm: "PUBLIC",
  });
  assert.equal(f.state.profile.publicVisible, false);
});
test("trainer mutations fixture: transaction rechecks owner, authVersion, session and stale forms", async () => {
  const f = fixture();
  for (const patch of [
    { authVersion: 1 },
    { sessionId: "" },
    { sessionId: "missing" },
  ])
    await assert.rejects(
      () => f.service.save({ ...f.ctx(), ...patch }, f.profile.id, fields),
      (e) => e.status === 403,
    );
  f.owner.role = "ADMIN";
  await assert.rejects(
    () => f.service.save(f.ctx(), f.profile.id, fields),
    (e) => e.status === 403,
  );
  f.owner.role = "OWNER";
  f.owner.active = false;
  await assert.rejects(
    () => f.service.save(f.ctx(), f.profile.id, fields),
    (e) => e.status === 403,
  );
  f.owner.active = true;
  await assert.rejects(
    () => f.service.save({ ...f.ctx(), version: 9 }, f.profile.id, fields),
    (e) => e.status === 409,
  );
  f.expire();
  await assert.rejects(
    () => f.service.save(f.ctx(), f.profile.id, fields),
    (e) => e.status === 403,
  );
  assert.equal(f.state.audits.length, 0);
});
test("trainer mutations fixture: identical replay has one audit, changed replay fails, audit failure rolls back", async () => {
  const f = fixture(),
    ctx = f.ctx();
  await f.service.save(ctx, f.profile.id, fields);
  await f.service.save(ctx, f.profile.id, fields);
  assert.equal(f.state.profile.publicVersion, 2);
  assert.equal(f.state.audits.length, 1);
  await assert.rejects(
    () =>
      f.service.save(ctx, f.profile.id, { ...fields, publicName: "Подмена" }),
    (e) => e.status === 409,
  );
  f.down();
  await assert.rejects(() =>
    f.service.photo(f.ctx(), f.profile.id, Buffer.from("webp")),
  );
  assert.equal(f.state.photo, null);
  assert.equal(f.state.profile.publicVersion, 2);
  assert.equal(f.state.operations.length, 1);
});
test("trainer management HTTP fixture: each route rejects ADMIN/TRAINER before data or upload parsing", async () => {
  for (const role of ["ADMIN", "TRAINER"]) {
    const app = express();
    app.use((req, res, next) => {
      req.user = { id: randomUUID(), role };
      next();
    });
    app.use(
      trainerManagementRoutes({
        config: { APP_ORIGIN: "http://localhost" },
        prisma: {},
      }),
    );
    app.use((e, req, res, next) => res.sendStatus(e.status || 500));
    await request(app).get("/admin/public-trainers").expect(403);
    for (const action of ["create", "save", "publish", "photo", "delete-photo"])
      await request(app)
        .post("/admin/public-trainers/" + randomUUID() + "/" + action)
        .expect(403);
  }
});
test("trainer management upload HTTP fixture: limits, content, CSRF, duplicate fields and no partial write", async () => {
  const f = fixture(),
    token = "a".repeat(64),
    origin = "http://localhost";
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", "server/views");
  app.use((req, res, next) => {
    req.user = f.owner;
    req.session = { csrf: token };
    req.sessionID = "valid";
    res.locals.currentPath = "/admin/public-trainers";
    next();
  });
  app.use(
    trainerManagementRoutes({
      config: { APP_ORIGIN: origin },
      prisma: f.prisma,
    }),
  );
  app.use((e, req, res, next) => res.sendStatus(e.status || 400));
  const path = "/admin/public-trainers/" + f.profile.id + "/photo";
  const photo = await sharp({
    create: { width: 20, height: 30, channels: 3, background: "#abcdef" },
  })
    .png()
    .toBuffer();
  const upload = () =>
    request(app)
      .post(path)
      .set("Origin", origin)
      .field("_csrf", token)
      .field("key", randomUUID())
      .field("version", "1");
  await upload()
    .attach("image", Buffer.from("<svg/>"), {
      filename: "f.png",
      contentType: "image/png",
    })
    .expect(400);
  await upload()
    .attach("image", Buffer.alloc(5 * 1024 * 1024 + 1), {
      filename: "f.png",
      contentType: "image/png",
    })
    .expect(400);
  await upload()
    .field("key", randomUUID())
    .attach("image", photo, { filename: "f.png", contentType: "image/png" })
    .expect(400);
  const huge = await sharp({
    create: { width: 5000, height: 4100, channels: 3, background: "#abcdef" },
  })
    .png()
    .toBuffer();
  await upload()
    .attach("image", huge, { filename: "f.png", contentType: "image/png" })
    .expect(400);
  await request(app)
    .post(path)
    .set("Origin", origin)
    .field("_csrf", "bad")
    .field("key", randomUUID())
    .field("version", "1")
    .attach("image", photo, { filename: "f.png", contentType: "image/png" })
    .expect(403);
  assert.equal(f.state.photo, null);
  assert.equal(f.state.profile.publicVersion, 1);
  await upload()
    .attach("image", photo, {
      filename: "../../unsafe.png",
      contentType: "image/png",
    })
    .expect(303);
  assert.equal((await sharp(f.state.photo).metadata()).format, "webp");
  assert.equal(f.state.profile.publicVersion, 2);
});
