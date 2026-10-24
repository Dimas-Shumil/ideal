import webpush from "web-push";
import { pushWorker } from "./modules/push/worker.js";
import { readConfig } from "./config/env.js";
import { createDatabase } from "./db/client.js";
import { createApp } from "./app.js";
let db, server, store, push;
try {
  const config = readConfig();
  db = createDatabase(config.DATABASE_URL);
  await db.pool.query("SELECT 1");
  const result = await createApp({ config, db });
  store = result.store;
  push = pushWorker({ prisma: db.prisma, config, send: webpush.sendNotification.bind(webpush) });
  push.start();
  server = result.app.listen(config.PORT, "127.0.0.1", () =>
    console.log(`IDEAL: http://127.0.0.1:${config.PORT}`),
  );
  server.on("error", () => {
    console.error("SERVER_START_FAILED");
    process.exitCode = 1;
    shutdown();
  });
} catch (e) {
  console.error(
    e.message?.startsWith("Проверьте переменные:")
      ? e.message
      : "START_FAILED: проверьте конфигурацию, миграции и доступность БД.",
  );
  await push?.stop();
  store?.close();
  if (db) await db.close();
  process.exitCode = 1;
}
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  if (server) await new Promise((ok) => server.close(ok));
  await push?.stop();
  store?.close();
  if (db) await db.close();
  clearTimeout(deadline);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    shutdown().catch(() => {
      console.error("SHUTDOWN_FAILED");
      process.exitCode = 1;
    }),
  );
