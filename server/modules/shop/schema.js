import { z } from "zod";
export const uuid = z.string().uuid();
export const int = (min, max) =>
  z
    .union([z.number(), z.string().regex(/^\d+$/)])
    .pipe(z.coerce.number().int().min(min).max(max));
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
export const productBody = z
  .object({
    name: z.string().trim().min(2).max(150),
    category: z.string().trim().min(1).max(100),
    description: z.string().trim().max(4000),
    characteristics: z.string().trim().max(4000),
    active: bool,
  })
  .strict();
// Decimal string -> integer kopecks, no floating point rounding.
export const price = z
  .string()
  .regex(/^\d{1,7}(?:[.,]\d{1,2})?$/)
  .transform((v) => {
    const [r, k = ""] = v.replace(",", ".").split(".");
    return Number(r) * 100 + Number(k.padEnd(2, "0"));
  })
  .pipe(z.number().int().min(1).max(100000000));
export const variantBody = z
  .object({
    name: z.string().trim().min(1).max(150),
    price,
    available: bool,
    active: bool,
  })
  .strict();
export const cartAdd = z
  .object({ variantId: uuid, quantity: int(1, 99) })
  .strict();
export const method = z.enum(["CASH", "CARD", "TRANSFER"]);
export const methods = {
  CASH: "Наличные",
  CARD: "Карта при получении",
  TRANSFER: "Перевод при получении",
};
export const statuses = {
  NEW: "Новый",
  CONFIRMED: "Подтверждён",
  READY: "Готов к выдаче",
  ISSUED: "Выдан",
  CANCELLED: "Отменён",
};
export const orderBody = z
  .object({
    key: uuid,
    quote: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().trim().min(2).max(100),
    phone: z
      .string()
      .trim()
      .max(40)
      .transform((v) => v.replace(/[\s()+-]/g, ""))
      .refine((v) => /^\d{10,15}$/.test(v))
      .transform((v) =>
        v.length === 11 && v[0] === "8" ? "7" + v.slice(1) : v,
      ),
    comment: z.string().trim().max(1000),
    method,
  })
  .strict();
export const transition = z
  .object({
    status: z.enum(["CONFIRMED", "READY", "ISSUED", "CANCELLED"]),
    reason: z.string().trim().max(500),
    method,
  })
  .strict()
  .refine((v) => v.status !== "CANCELLED" || v.reason.length >= 3);
export const meta = z
  .object({
    _csrf: z.string().optional(),
    key: uuid,
    version: int(1, 2147483646).optional(),
  })
  .strict();
export const catalogQuery = z
  .object({
    category: z.string().max(100).default(""),
    page: int(1, 100000).default(1),
  })
  .strict();
export const orderQuery = z
  .object({
    status: z
      .enum(["", "NEW", "CONFIRMED", "READY", "ISSUED", "CANCELLED"])
      .default(""),
    page: int(1, 100000).default(1),
  })
  .strict();
