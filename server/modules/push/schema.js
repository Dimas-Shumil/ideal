import { ECDH } from "node:crypto";
import { z } from "zod";
// Push providers only: never turn endpoint registration into an arbitrary HTTP client.
const hosts = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "wns2-db5p.notify.windows.com"]);
export function allowedEndpoint(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && !u.port && !u.hash &&
      (hosts.has(u.hostname) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}
export const endpoint = z.string().max(2048).refine(allowedEndpoint);
function validPoint(v) {
  try { ECDH.convertKey(Buffer.from(v, "base64url"), "prime256v1"); return true; }
  catch { return false; }
}
const key = (bytes) => z.string().regex(/^[A-Za-z0-9_-]+$/).refine(v => Buffer.from(v, "base64url").length === bytes && Buffer.from(v,"base64url").toString("base64url") === v);
export const subscriptionBody = z.object({ endpoint, keys: z.object({ p256dh: key(65).refine(v => Buffer.from(v,"base64url")[0] === 4 && validPoint(v)), auth: key(16) }).strict() }).strict();
export const endpointBody = z.object({ endpoint }).strict();
