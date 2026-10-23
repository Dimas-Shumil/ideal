import { randomBytes, timingSafeEqual } from "node:crypto";
export const newCsrf = () => randomBytes(32).toString("hex");
export const forbidden = () =>
  Object.assign(new Error("FORBIDDEN"), { status: 403 });
export function csrf(config) {
  return (req, res, next) => {
    if (req.get("Origin") !== config.APP_ORIGIN) return next(forbidden());
    const token = req.get("x-csrf-token") || req.body?._csrf;
    const expected = req.session?.csrf;
    if (
      typeof token !== "string" ||
      !/^[a-f0-9]{64}$/.test(token) ||
      typeof expected !== "string" ||
      !/^[a-f0-9]{64}$/.test(expected) ||
      !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"))
    )
      return next(forbidden());
    next();
  };
}
