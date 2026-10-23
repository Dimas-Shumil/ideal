import { z } from "zod";
export const loginName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
export const password = z
  .string()
  .min(12)
  .max(128)
  .refine((s) => Buffer.byteLength(s, "utf8") <= 256 && !s.includes("\0"));
export const loginBody = z
  .object({
    login: loginName,
    password: z
      .string()
      .min(1)
      .max(128)
      .refine((s) => Buffer.byteLength(s) <= 256),
    _csrf: z.string().length(64).optional(),
  })
  .strict();
export const accountBody = z
  .object({
    login: loginName,
    displayName: z.string().trim().min(1).max(100),
    role: z.enum(["OWNER", "ADMIN", "TRAINER"]),
    password,
  })
  .strict();
