// Read-only comparison of ALL pre-stage19 columns, including publicName/publicVersion.
// This is a digest snapshot, not a backup or a restore test.
import "dotenv/config";
import pg from "pg";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const args = process.argv.slice(2);
try {
  if (args[0] === "compare" && args.length === 3) {
    const [a, b] = await Promise.all(
      args
        .slice(1)
        .map(async (path) => JSON.parse(await readFile(path, "utf8"))),
    );
    if (
      a.format !== "ideal-stage19-v1" ||
      b.format !== a.format ||
      a.database !== b.database
    )
      throw Error();
    const names = [
      ...new Set([...Object.keys(a.tables), ...Object.keys(b.tables)]),
    ].sort();
    const changed = names.filter(
      (name) =>
        JSON.stringify(a.tables[name]) !== JSON.stringify(b.tables[name]),
    );
    console.log(
      changed.length
        ? "Изменились таблицы: " + changed.join(", ")
        : "Совпадают строки и digest прежних данных всех " +
            names.length +
            " таблиц.",
    );
    if (changed.length) process.exitCode = 1;
  } else if (args[0] === "snapshot" && args.length === 1) {
    const client = new pg.Client({
      connectionString: process.env.DATABASE_URL,
    });
    await client.connect();
    try {
      await client.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const database = (await client.query("SELECT current_database() AS name"))
        .rows[0].name;
      const list = (
        await client.query(
          "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name NOT IN ('_prisma_migrations','ContentEntry','ContentPhoto') ORDER BY table_name",
        )
      ).rows;
      const tables = {};
      for (const { table_name: name } of list) {
        const quoted = '"' + name.replaceAll('"', '""') + '"';
        const rows = (
          await client.query(
            `SELECT (to_jsonb(t) - $1::text[])::text AS value FROM public.${quoted} t ORDER BY value`,
            [[]],
          )
        ).rows;
        const digest = createHash("sha256");
        for (const row of rows) digest.update(row.value + "\n");
        tables[name] = { count: rows.length, digest: digest.digest("hex") };
      }
      await client.query("COMMIT");
      console.log(
        JSON.stringify(
          {
            format: "ideal-stage19-v1",
            database,
            excluded: ["_prisma_migrations", "ContentEntry", "ContentPhoto"],
            tables,
          },
          null,
          2,
        ),
      );
    } finally {
      await client.end();
    }
  } else {
    console.error(
      "Использование: node tools/stage19-db-check.mjs snapshot | compare BEFORE.json AFTER.json",
    );
    process.exitCode = 1;
  }
} catch {
  console.error(
    "Проверка не выполнена. Проверьте подключение БД и пути снимков.",
  );
  process.exitCode = 1;
}
