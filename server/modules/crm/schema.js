import { z } from "zod";
import { age, today, validDate } from "./dates.js";
export const uuid = z.string().uuid();
export const date = z.string().refine(validDate, "Укажите существующую дату.");
const optionalDate = z.union([date, z.literal("")]).default("");
const integer = (min, max) => z.coerce.number().int().min(min).max(max);
export const reason = z.string().trim().min(3).max(500);
export const money = z
  .string()
  .regex(/^\d{1,7}(?:[.,]\d{1,2})?$/)
  .transform((s) => Math.round(Number(s.replace(",", ".")) * 100));
export const clientBody = z
  .object({
    name: z.string().trim().min(2).max(150),
    phone: z
      .string()
      .trim()
      .transform((s) => s.replace(/[\s()+-]/g, ""))
      .refine((s) => /^\d{10,15}$/.test(s), "Телефон: 10–15 цифр.")
      .transform((s) =>
        s.length === 11 && s[0] === "8" ? "7" + s.slice(1) : s,
      ),
    birthDate: date.refine(
      (s) => s <= today() && age(s) >= 18 && age(s) <= 120,
      "В этом этапе учитываются совершеннолетние клиенты.",
    ),
    comment: z.string().trim().max(1000).default(""),
  })
  .strict();
export const planBody = z
  .object({
    name: z.string().trim().min(2).max(100),
    kind: z.enum(["GYM", "GROUP"]),
    price: money,
    months: integer(0, 36),
    days: integer(0, 1095),
    visits: integer(0, 10000),
    weekdays: z
      .string()
      .regex(/^[1-7](?:,[1-7])*$/)
      .transform((s) => [...new Set(s.split(","))].sort().join(",")),
    fromTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    toTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    giftGym: z.enum(["true", "false"]).transform((s) => s === "true"),
    duo: z.enum(["true", "false"]).transform((s) => s === "true"),
    active: z.enum(["true", "false"]).transform((s) => s === "true"),
    publicVisible: z.enum(["true", "false"]).transform((s) => s === "true").optional(),
    publicOrder: integer(0, 10000).optional(),
  })
  .strict()
  .refine(
    (p) => !(p.months && p.days) && (p.months || p.days || p.visits),
    "Выберите срок или пакет посещений.",
  )
  .refine((p) => p.fromTime < p.toTime, "Начало должно быть раньше окончания.")
  .refine(
    (p) => !p.giftGym || p.kind === "GROUP",
    "Подарок зала применяется к групповому тарифу.",
  );
export const planDeleteBody = z.object({ confirm: z.literal("delete") }).strict();
export const issueBody = z
  .object({
    planId: uuid,
    planVersion: integer(1, 2147483646),
    clientId: uuid,
    partnerId: z.union([uuid, z.literal("")]).default(""),
    activation: z.enum(["DATE", "FIRST_VISIT"]),
    startDate: optionalDate,
    price: money,
    method: z.enum(["CASH", "TRANSFER", "CARD"]),
    reason: z.string().trim().max(500).default(""),
  })
  .strict()
  .refine(
    (v) => v.activation !== "DATE" || !!v.startDate,
    "Укажите дату начала.",
  );
export const version = integer(1, 2147483646);
export const filters = z
  .object({
    q: z.string().trim().max(100).default(""),
    archived: z.enum(["false", "true", "all"]).default("false"),
    page: integer(1, 100000).default(1),
  })
  .strict();
export const operation = z.object({
  _csrf: z.string().optional(),
  key: uuid,
  version: version.optional(),
});
export const actions = {
  archive: z
    .object({
      archived: z.enum(["true", "false"]).transform((s) => s === "true"),
      reason,
    })
    .strict(),
  assign: z.object({ trainerId: uuid, reason }).strict(),
  revoke: z.object({ assignmentId: uuid, reason }).strict(),
  cancel: z.object({ reason }).strict(),
  extend: z.object({ days: integer(1, 1095), reason }).strict(),
  adjust: z.object({ remaining: integer(0, 10000), reason }).strict(),
  freeze: z.object({ endDate: date, reason }).strict(),
  thaw: z.object({ reason }).strict(),
  refund: z
    .object({
      amount: money,
      method: z.enum(["CASH", "TRANSFER", "CARD"]),
      reason,
    })
    .strict(),
};
