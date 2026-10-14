import { createHash, randomBytes } from "node:crypto";

/** Generates an opaque, URL-safe random token (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Hashes a token for storage. Only hashes are ever persisted. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
