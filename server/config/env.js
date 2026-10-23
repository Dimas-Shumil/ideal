import "dotenv/config";
import { z } from "zod";
const shape = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(64).max(256),
  TRUST_PROXY: z.enum(["none", "loopback"]).default("none"),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
});
export function readConfig(input = process.env) {
  const result = shape.safeParse(input);
  if (!result.success)
    throw new Error(
      `Проверьте переменные: ${[...new Set(result.error.issues.map((i) => i.path[0]))].join(", ")}`,
    );
  const c = result.data;
  const origin = new URL(c.APP_ORIGIN),
    db = new URL(c.DATABASE_URL);
  if (
    !["postgresql:", "postgres:"].includes(db.protocol) ||
    !db.pathname.slice(1)
  )
    throw new Error("Некорректный DATABASE_URL");
  if (origin.origin !== c.APP_ORIGIN || origin.username || origin.password)
    throw new Error(
      "APP_ORIGIN должен содержать только origin без завершающего /",
    );
  if (c.NODE_ENV === "production" && origin.protocol !== "https:")
    throw new Error("Production требует HTTPS APP_ORIGIN");
  if (!["http:", "https:"].includes(origin.protocol))
    throw new Error("Некорректный APP_ORIGIN");
  return Object.freeze({
    ...c,
    production: c.NODE_ENV === "production",
    idleMs: c.SESSION_IDLE_HOURS * 3600000,
    absoluteMs: c.SESSION_ABSOLUTE_DAYS * 86400000,
    cookieName:
      c.NODE_ENV === "production"
        ? "__Host-ideal.sid"
        : `ideal.dev.${c.PORT}.sid`,
  });
}
