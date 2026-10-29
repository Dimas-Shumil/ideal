import { createECDH } from "node:crypto";
import "dotenv/config";
import { z } from "zod";
const shape = z.object({
  PUSH_PUBLIC_KEY: z.string().default(""),
  PUSH_PRIVATE_KEY: z.string().default(""),
  PUSH_SUBJECT: z.string().default(""),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  APP_ORIGIN: z.string().url(),
  SEO_ORIGIN: z.string().default(""),
  SEO_INDEXABLE: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
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
  const push = [c.PUSH_PUBLIC_KEY, c.PUSH_PRIVATE_KEY, c.PUSH_SUBJECT];
  if (push.some(Boolean) && (!push.every(Boolean) ||
      !/^[A-Za-z0-9_-]{87}$/.test(c.PUSH_PUBLIC_KEY) || Buffer.from(c.PUSH_PUBLIC_KEY,"base64url")[0] !== 4 ||
      !/^[A-Za-z0-9_-]{43}$/.test(c.PUSH_PRIVATE_KEY) ||
      !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/[^\s]+)$/.test(c.PUSH_SUBJECT)))
    throw new Error("Проверьте переменные: PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY, PUSH_SUBJECT");
  if (c.PUSH_PRIVATE_KEY) {
    try {
      const pair = createECDH("prime256v1");
      pair.setPrivateKey(Buffer.from(c.PUSH_PRIVATE_KEY, "base64url"));
      if (pair.getPublicKey().toString("base64url") !== c.PUSH_PUBLIC_KEY) throw new Error();
    } catch { throw new Error("Проверьте переменные: PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY"); }
  }
  if (c.SEO_ORIGIN) {
    let seo;
    try { seo = new URL(c.SEO_ORIGIN); } catch { throw new Error("Проверьте переменные: SEO_ORIGIN"); }
    if (seo.protocol !== "https:" || seo.origin !== c.SEO_ORIGIN || seo.username || seo.password ||
        seo.hostname === "localhost" || seo.hostname.endsWith(".localhost") ||
        seo.hostname === "[::1]" || /^[0-9.]+$/.test(seo.hostname) || !seo.hostname.includes("."))
      throw new Error("SEO_ORIGIN: укажите HTTPS origin публичного домена без пути и завершающего /");
    if (c.NODE_ENV === "production" && c.SEO_ORIGIN !== c.APP_ORIGIN)
      throw new Error("SEO_ORIGIN должен совпадать с production APP_ORIGIN");
  }
  if (c.SEO_INDEXABLE && !c.SEO_ORIGIN) throw new Error("Для SEO_INDEXABLE требуется SEO_ORIGIN");
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
