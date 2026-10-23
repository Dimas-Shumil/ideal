import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
export function createDatabase(url) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });
  pool.on("error", () => console.error("DB_POOL_ERROR"));
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: [] });
  return {
    pool,
    prisma,
    async close() {
      await prisma.$disconnect();
      await pool.end();
    },
  };
}
// One shared transaction lock for EVERY account/access mutation and authenticated session creation.
export async function accessLock(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(681908, 8)`;
}
