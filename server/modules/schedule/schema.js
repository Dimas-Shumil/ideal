import { z } from "zod";
import { validDate } from "../crm/dates.js";

export const uuid = z.string().uuid();
export const version = z.coerce.number().int().min(1).max(2147483646);
export const date = z.string().refine(validDate, "Укажите существующую дату.");
export const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const reason = z.string().trim().min(3).max(500);
const optionalReason = z.string().trim().max(500).default("");
const optionalUuid = z.union([uuid, z.literal("")]).default("");
const optionalDate = z.union([date, z.literal("")]).default("");
const weekdays = z
  .string()
  .regex(/^(?:[1-7](?:,[1-7])*)?$/)
  .transform((s) =>
    s
      ? [...new Set(s.split(","))].sort().join(",")
      : "",
  );

export const lessonCreate = z
  .object({
    kind: z.enum(["GROUP", "PERSONAL"]),
    title: z.string().trim().min(2).max(100),
    date,
    startTime: time,
    endTime: time,
    trainerId: uuid,
    room: z.string().trim().max(100).default(""),
    capacity: z.coerce.number().int().min(1).max(500),
    repeat: z.enum(["NONE", "WEEKLY"]),
    repeatUntil: optionalDate,
    weekdays,
  })
  .strict()
  .refine((v) => v.startTime < v.endTime, "Начало должно быть раньше окончания.")
  .refine(
    (v) => v.repeat !== "WEEKLY" || (!!v.repeatUntil && !!v.weekdays),
    "Для еженедельного расписания укажите дни недели и дату окончания.",
  );

export const lessonMove = z
  .object({ date, startTime: time, endTime: time, room: z.string().trim().max(100).default(""), reason })
  .strict()
  .refine((v) => v.startTime < v.endTime, "Начало должно быть раньше окончания.");

export const bookBody = z.object({ clientId: uuid, reason: optionalReason }).strict();
export const cancelBody = z.object({ reason }).strict();
export const attendanceBody = z.object({ status: z.enum(["ATTENDED", "NO_SHOW"]), reason: optionalReason }).strict();
export const gymVisitBody = z.object({ clientId: uuid, date, time, reason: optionalReason }).strict();
export const listQuery = z
  .object({
    from: optionalDate,
    to: optionalDate,
    trainer: optionalUuid,
    kind: z.enum(["", "GROUP", "PERSONAL"]).default(""),
    status: z.enum(["", "SCHEDULED", "CANCELLED"]).default(""),
  })
  .strict();
export const lessonQuery = z.object({ q: z.string().trim().max(100).default("") }).strict();
export const operation = z.object({
  _csrf: z.string().optional(),
  key: uuid,
  version: version.optional(),
});

export const deleteBody = z.object({ reason, confirm: z.literal("DELETE") }).strict();
