import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/**
 * Hashes a password with scrypt. Format:
 *   scrypt$N$r$p$<salt-b64>$<hash-b64>
 * Never stores the plaintext password.
 */
export function hashPassword(password: string): string {
  if (typeof password !== "string" || password.length < 8) {
    throw new Error("password must be a string of at least 8 characters");
  }
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

/** Constant-time verification of a password against a stored scrypt hash. */
export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4] as string, "base64");
    expected = Buffer.from(parts[5] as string, "base64");
  } catch {
    return false;
  }
  const actual = scryptSync(password, salt, expected.length, { N, r, p });
  return (
    actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}
