// Read-only fingerprint of pre-shop business data. No row content is printed.
import "dotenv/config";
import pg from "pg";
const tables = [
  "User",
  "AuditEvent",
  "Client",
  "TrainerProfile",
  "TrainerAssignment",
  "MembershipPlan",
  "MembershipPurchase",
  "Membership",
  "MembershipFreeze",
  "MembershipRefund",
  "CrmEvent",
  "CrmOperation",
  "Lesson",
  "LessonBooking",
  "Visit",
  "ScheduleEvent",
  "PushSubscription",
];
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = {};
    for (const table of tables) {
      const r = await client.query(
        `SELECT count(*)::text AS count,md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM "${table}" t`,
      );
      result[table] = r.rows[0];
    }
    await client.query("COMMIT");
    console.log(JSON.stringify(result, null, 2));
  } finally {
    client.release();
  }
} catch {
  console.error("SNAPSHOT_FAILED: проверьте конфигурацию и доступность БД.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
