import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { base32Decode, base32Encode } from "./base32.ts";

const DEFAULT_STEP = 30; // seconds
const DEFAULT_DIGITS = 6;

/** Generates a new random base32 TOTP secret (160 bits, RFC 4226 recommended). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/**
 * HOTP (RFC 4226) over a base32 secret. Exposed for test vectors.
 */
export function hotp(
  secretBase32: string,
  counter: number,
  digits = DEFAULT_DIGITS,
): string {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = (hmac[hmac.length - 1] as number) & 0x0f;
  const bin =
    (((hmac[offset] as number) & 0x7f) << 24) |
    (((hmac[offset + 1] as number) & 0xff) << 16) |
    (((hmac[offset + 2] as number) & 0xff) << 8) |
    ((hmac[offset + 3] as number) & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, "0");
}

/** TOTP (RFC 6238) code for a given time. */
export function totp(
  secretBase32: string,
  timeMs: number = Date.now(),
  step = DEFAULT_STEP,
  digits = DEFAULT_DIGITS,
): string {
  const counter = Math.floor(timeMs / 1000 / step);
  return hotp(secretBase32, counter, digits);
}

/**
 * Verifies a TOTP code allowing +/- `window` steps for clock drift.
 * Uses constant-time comparison.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  timeMs: number = Date.now(),
  window = 1,
  step = DEFAULT_STEP,
  digits = DEFAULT_DIGITS,
): boolean {
  if (!/^\d+$/.test(code)) return false;
  const counter = Math.floor(timeMs / 1000 / step);
  const candidate = Buffer.from(code);
  for (let d = -window; d <= window; d++) {
    const expected = Buffer.from(hotp(secretBase32, counter + d, digits));
    if (
      expected.length === candidate.length &&
      timingSafeEqual(expected, candidate)
    ) {
      return true;
    }
  }
  return false;
}

/** Builds an otpauth:// URI for provisioning authenticator apps. */
export function otpauthUri(
  secretBase32: string,
  account: string,
  issuer = "GhostFxPro",
  digits = DEFAULT_DIGITS,
  step = DEFAULT_STEP,
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(digits),
    period: String(step),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
