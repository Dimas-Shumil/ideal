import { z } from "zod";
export const trainerFields = {
  publicName: 100,
  specialty: 300,
  summary: 1000,
  biography: 5000,
  experience: 500,
  qualification: 3000,
  approach: 3000,
  directions: 2000,
  achievements: 3000,
};
export const profileBody = z
  .object(
    Object.fromEntries(
      Object.entries(trainerFields).map(([key, max]) => [
        key,
        z.string().trim().max(max),
      ]),
    ),
  )
  .extend({ publicOrder: z.coerce.number().int().min(0).max(99999) })
  .strict();
export const publishBody = z
  .object({ visible: z.enum(["true", "false"]), confirm: z.literal("PUBLIC") })
  .strict();
export const photoDeleteBody = z
  .object({ confirm: z.literal("DELETE") })
  .strict();
export const profileOperation = z
  .object({
    _csrf: z.string().optional(),
    key: z.string().uuid(),
    version: z.coerce.number().int().min(1).optional(),
  })
  .strict();
