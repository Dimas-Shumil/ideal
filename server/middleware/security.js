import { createHash } from "node:crypto";
// HTML parsing normalizes CRLF/CR to LF before CSP hashes are checked.
// Normalize too, so Windows core.autocrlf cannot disable the hero initializer.
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (match) =>
      `'sha256-${createHash("sha256").update(match[1].replace(/\r\n?/g, "\n")).digest("base64")}'`,
  );
}
