import test from "node:test";
import assert from "node:assert/strict";
import { trainerScope, scopedRead } from "../server/policies/trainer.js";
import { readConfig } from "../server/config/env.js";
const fixtures = {
  profiles: [
    { id: "ta", userId: "a" },
    { id: "tb", userId: "b" },
  ],
  assignments: [
    { trainerId: "ta", clientId: "ca", active: true },
    { trainerId: "tb", clientId: "cb", active: true },
  ],
  clients: [
    { id: "ca", name: "Анна", phone: "SECRET", notes: "SECRET", balance: 100 },
    { id: "cb", name: "Борис", phone: "SECRET" },
  ],
  lessons: [
    {
      id: "la",
      trainerId: "ta",
      participants: [
        { id: "cb", name: "Борис", status: "confirmed", phone: "SECRET" },
      ],
    },
    { id: "lb", trainerId: "tb", participants: [] },
  ],
  attachments: [
    { id: "aa", clientId: "ca", path: "PRIVATE" },
    { id: "ab", clientId: "cb", path: "PRIVATE" },
  ],
};
const context = { id: "a", role: "TRAINER", active: true };
test("trainer contract: projection, all query shapes, ID tampering and group roster", () => {
  assert.deepEqual(trainerScope(context, fixtures).clients, [
    { id: "ca", name: "Анна" },
  ]);
  for (const operation of ["list", "search", "export"])
    assert.deepEqual(
      scopedRead(context, fixtures, "clients", operation, {
        trainerId: "tb",
        userId: "b",
        query: "",
      }),
      [{ id: "ca", name: "Анна" }],
    );
  assert.equal(scopedRead(context, fixtures, "clients", "count"), 1);
  assert.equal(
    scopedRead(context, fixtures, "clients", "count", { query: "Борис" }),
    0,
  );
  for (const [resource, id] of [
    ["clients", "cb"],
    ["lessons", "lb"],
    ["attachments", "ab"],
  ])
    assert.equal(
      scopedRead(context, fixtures, resource, "get", { id, trainerId: "tb" }),
      null,
    );
  assert.deepEqual(trainerScope(context, fixtures).lessons[0].participants, [
    { id: "cb", name: "Борис", status: "confirmed" },
  ]);
  assert.equal(
    scopedRead(context, fixtures, "clients", "get", { id: "cb" }),
    null,
  );
  assert.ok(
    !JSON.stringify(trainerScope(context, fixtures)).includes("SECRET"),
  );
  assert.ok(
    !JSON.stringify(trainerScope(context, fixtures)).includes("PRIVATE"),
  );
});
test("trainer contract: revoked assignment and disabled user close access on next read", () => {
  const revoked = structuredClone(fixtures);
  revoked.assignments[0].active = false;
  assert.equal(scopedRead(context, revoked, "clients", "count"), 0);
  assert.equal(
    scopedRead(context, revoked, "attachments", "get", { id: "aa" }),
    null,
  );
  assert.deepEqual(trainerScope({ ...context, active: false }, fixtures), {
    clients: [],
    lessons: [],
    attachments: [],
  });
  assert.deepEqual(trainerScope({ ...context, role: "ADMIN" }, fixtures), {
    clients: [],
    lessons: [],
    attachments: [],
  });
});
test("configuration validation never prints secret values", () => {
  const value = {
    APP_ORIGIN: "http://127.0.0.1:3000",
    DATABASE_URL: "postgresql://u:secret@localhost/db",
    SESSION_SECRET: "x".repeat(96),
  };
  assert.equal(readConfig(value).idleMs, 28800000);
  assert.throws(
    () => readConfig({ ...value, SESSION_SECRET: "secret" }),
    (e) =>
      e.message.includes("SESSION_SECRET") && !e.message.includes("secret"),
  );
  assert.throws(() => readConfig({ ...value, NODE_ENV: "production" }));
  assert.throws(() =>
    readConfig({ ...value, APP_ORIGIN: "http://localhost:3000/" }),
  );
});
test("CSP hero hashes survive Windows CRLF checkout", async () => {
  const { inlineScriptHashes } =
    await import("../server/middleware/security.js");
  const html = '<script>\nconsole.log("hero");\n</script>';
  assert.deepEqual(
    inlineScriptHashes(html),
    inlineScriptHashes(html.replaceAll("\n", "\r\n")),
  );
  assert.deepEqual(
    inlineScriptHashes(html),
    inlineScriptHashes(html.replaceAll("\n", "\r")),
  );
});

test("trainer contract: no profile/no context/OWNER fail closed; all resources share safe projection", () => {
  for (const actor of [null, { ...context, id: "missing" }, { ...context, role: "OWNER" }])
    assert.deepEqual(trainerScope(actor, fixtures), { clients: [], lessons: [], attachments: [] });
  for (const resource of ["clients", "lessons", "attachments"]) {
    const safe = trainerScope(context, fixtures)[resource];
    for (const operation of ["list", "search", "export"])
      assert.deepEqual(scopedRead(context, fixtures, resource, operation, { userId: "b", trainerId: "tb" }), safe);
    assert.equal(scopedRead(context, fixtures, resource, "count"), safe.length);
  }
  const revoked = structuredClone(fixtures);
  revoked.assignments[0].active = false;
  assert.equal(scopedRead(context, revoked, "clients", "get", { id: "ca" }), null);
  assert.deepEqual(scopedRead(context, revoked, "attachments", "export"), []);
  assert.deepEqual(trainerScope(context, fixtures).attachments, [{ id: "aa", clientId: "ca" }]);
});
