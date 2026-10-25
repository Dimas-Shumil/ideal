import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import express from "express";
import helmet from "helmet";
import { readFile } from "node:fs/promises";
import {
  publicTrainerRoutes,
  publicTrainers,
  publicTrainer,
  publicTrainerWhere,
  publicTrainerSelect,
  publicTrainerCardSelect,
  trainerDto,
} from "../server/modules/public/trainers.js";
import { profileBody } from "../server/modules/trainers/schema.js";
const key = "a".repeat(32);
const row = {
  publicKey: key,
  publicName: "Публичное <имя>",
  specialty: "Специализация",
  summary: "Описание",
  biography: "Биография",
  experience: "Стаж",
  qualification: "Квалификация",
  approach: "Подход",
  directions: "Направления",
  achievements: "Достижения",
  photo: { trainerId: "PRIVATE_ID" },
  user: {
    login: "PRIVATE_LOGIN",
    displayName: "PRIVATE_STAFF",
    passwordHash: "PRIVATE_HASH",
  },
  assignments: [{ client: { phone: "PRIVATE_PHONE" } }],
  publicVersion: 10,
};
function fixture(prisma) {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", "server/views");
  app.use(helmet());
  app.use(publicTrainerRoutes({ config: {}, prisma }));
  app.use((req, res) => res.sendStatus(404));
  app.use((err, req, res, next) =>
    res.status(err.name === "ZodError" ? 400 : 500).send("Ошибка"),
  );
  return app;
}
test("public trainers: card/detail allowlists, active TRAINER and publication predicate", async () => {
  const calls = [];
  const p = {
    trainerProfile: {
      findMany: async (q) => {
        calls.push(q);
        return [row];
      },
      findFirst: async (q) => {
        calls.push(q);
        return row;
      },
    },
  };
  const cards = await publicTrainers(p);
  await publicTrainer(p, key);
  assert.deepEqual(calls[0].where, publicTrainerWhere);
  assert.deepEqual(calls[0].select, publicTrainerCardSelect);
  assert.deepEqual(calls[1].select, publicTrainerSelect);
  assert.deepEqual(calls[0].orderBy, [
    { publicOrder: "asc" },
    { publicName: "asc" },
    { publicKey: "asc" },
  ]);
  assert.deepEqual(publicTrainerWhere, {
    publicVisible: true,
    publicName: { not: "" },
    user: { active: true, role: "TRAINER" },
  });
  assert.deepEqual(
    Object.keys(cards[0]).sort(),
    ["name", "url", "photoUrl", "hasPhoto", "specialty"].sort(),
  );
  for (const select of [publicTrainerSelect, publicTrainerCardSelect])
    for (const f of [
      "user",
      "userId",
      "id",
      "publicVersion",
      "assignments",
      "lessons",
      "publicVisible",
    ])
      assert.equal(select[f], undefined);
});
test("public trainers: DTO strips private extras and exposes only public URLs", () => {
  const dto = trainerDto(row);
  assert.equal(dto.url, "/trainers/" + key);
  assert.equal(dto.photoUrl, dto.url + "/photo");
  assert.deepEqual(
    Object.keys(dto).sort(),
    [
      "name",
      "url",
      "photoUrl",
      "hasPhoto",
      "specialty",
      "summary",
      "biography",
      "experience",
      "qualification",
      "approach",
      "directions",
      "achievements",
    ].sort(),
  );
  assert.doesNotMatch(JSON.stringify(dto), /PRIVATE/);
  assert.equal(
    trainerDto({ ...row, photo: null }).photoUrl,
    "/site/img/trainer-placeholder.svg",
  );
});
test("public trainers HTTP fixture: SSR escaping, headers, no sessions and no public mutations/API", async () => {
  const app = fixture({
    trainerProfile: { findMany: async () => [row], findFirst: async () => row },
  });
  for (const path of ["/trainers.html", "/trainers/" + key]) {
    const res = await request(app).get(path).expect(200);
    assert.match(res.text, /Публичное &lt;имя&gt;/);
    assert.doesNotMatch(res.text, /PRIVATE/);
    assert.equal(res.headers["set-cookie"], undefined);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["x-robots-tag"], "noindex,follow");
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    assert.doesNotMatch(res.text, /href="#booking"|trainer__booking/);
  }
  await request(app)
    .post("/trainers/" + key)
    .expect(404);
  await request(app).get("/api/public/trainers").expect(404);
  await request(app)
    .get("/trainer.html")
    .expect(301)
    .expect("Location", "/trainers.html");
});
test("public trainers HTTP fixture: honest empty, unknown/hidden 404 and database 503", async () => {
  const empty = fixture({
    trainerProfile: { findMany: async () => [], findFirst: async () => null },
  });
  assert.match(
    (await request(empty).get("/trainers.html").expect(200)).text,
    /Профили тренеров пока не опубликованы/,
  );
  await request(empty)
    .get("/trainers/" + key)
    .expect(404);
  await request(empty)
    .get("/trainers/" + key + "/photo")
    .expect(404);
  await request(empty).get("/trainers/not-a-key").expect(404);
  const down = fixture({
    trainerProfile: {
      findMany: async () => {
        throw Error("PRIVATE_DB");
      },
      findFirst: async () => {
        throw Error("PRIVATE_DB");
      },
    },
  });
  for (const path of [
    "/trainers.html",
    "/trainers/" + key,
    "/trainers/" + key + "/photo",
  ]) {
    const r = await request(down).get(path).expect(503);
    assert.doesNotMatch(
      r.text,
      /PRIVATE_DB|Профили тренеров пока не опубликованы/,
    );
  }
  await request(empty).get("/trainers.html?userId=private").expect(400);
});
test("public trainers: strict text schema and offline boundary", async () => {
  const values = Object.fromEntries(
    [
      "publicName",
      "specialty",
      "summary",
      "biography",
      "experience",
      "qualification",
      "approach",
      "directions",
      "achievements",
    ].map((k) => [k, ""]),
  );
  assert.equal(
    profileBody.parse({ ...values, publicOrder: "0" }).publicOrder,
    0,
  );
  assert.throws(() =>
    profileBody.parse({ ...values, publicOrder: "0", displayName: "private" }),
  );
  assert.throws(() => profileBody.parse({ ...values, publicOrder: "-1" }));
  const sw = await readFile("server/modules/push/sw.js", "utf8");
  assert.doesNotMatch(sw, /public-trainers|\/trainers|TrainerPhoto/);
});
