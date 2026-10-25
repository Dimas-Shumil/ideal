import "dotenv/config";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
// Test process never loads a user's real DATABASE_URL. No fallback to dev DB.
let test, dev;
try {
  test = new URL(process.env.TEST_DATABASE_URL);
  dev = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const same =
    dev &&
    test.hostname === dev.hostname &&
    (test.port || "5432") === (dev.port || "5432") &&
    test.pathname === dev.pathname;
  if (
    !["postgresql:", "postgres:"].includes(test.protocol) ||
    !/^\/[a-z0-9_]+_test$/.test(test.pathname) ||
    same ||
    (dev && test.username === dev.username)
  )
    throw new Error();
} catch {
  console.error(
    "Нужна отдельная TEST_DATABASE_URL: БД с окончанием _test и отдельный пользователь БД. Совпадение с dev запрещено.",
  );
  process.exit(1);
}
const env = {
  ...process.env,
  NODE_ENV: "test",
  PUSH_PUBLIC_KEY: "",
  PUSH_PRIVATE_KEY: "",
  PUSH_SUBJECT: "",
  DATABASE_URL: test.href,
  APP_ORIGIN: "http://127.0.0.1:3000",
  PORT: "3000",
  SESSION_SECRET: randomBytes(48).toString("hex"),
  TRUST_PROXY: "none",
};
function run(file, args) {
  const r = spawnSync(process.execPath, [file, ...args], {
    env,
    stdio: "inherit",
  });
  if (r.status !== 0) process.exit(r.status || 1);
}
run("node_modules/prisma/build/index.js", ["migrate", "deploy"]);
run("node_modules/prisma/build/index.js", ["migrate", "deploy"]); // Idempotency on same test DB.
run("node_modules/prisma/build/index.js", ["generate"]);
run("--test", [
  "--test-concurrency=1",
  "tests/auth.test.js",
  "tests/policy.test.js",
  "tests/seo.test.js",
  "tests/crm-dates.test.js",
  "tests/schedule-dates.test.js",
  "tests/crm.test.js",
  "tests/schedule.test.js",
  "tests/push.test.js",
  "tests/push-sw.test.js",
  "tests/pwa.test.js",
  "tests/pwa-install.test.js",
  "tests/shop-unit.test.js",
  "tests/shop.test.js",
]);
