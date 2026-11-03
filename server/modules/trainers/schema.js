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
  phone: 30,
  vkUrl: 500,
  maxUrl: 500,
};
// Only HTTPS links to the named services can be published.
const socialUrl = hosts => z.string().trim().max(500).default("").refine(value => {
  if (!value) return true;
  if (/[\\\r\n]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && hosts.includes(url.hostname.toLowerCase()) &&
      !url.username && !url.password && !url.port && url.pathname !== "/";
  } catch { return false; }
}, "Укажите полную HTTPS-ссылку на профиль ВК или MAX.");
export const profileBody = z
  .object(
    Object.fromEntries(
      Object.entries(trainerFields).map(([key, max]) => [
        key,
        z.string().trim().max(max),
      ]),
    ),
  )
  .extend({
    publicOrder: z.coerce.number().int().min(0).max(99999),
    phone: z.string().trim().max(30).default("").refine(value => !value ||
      (/^\+?[\d ()-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 && value.replace(/\D/g, "").length <= 15), "Проверьте номер телефона."),
    vkUrl: socialUrl(["vk.com", "www.vk.com", "vk.ru", "www.vk.ru"]),
    maxUrl: socialUrl(["max.ru", "www.max.ru"]),
  })
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
