import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;

/**
 * Encrypts a secret (e.g. a TOTP seed) with AES-256-GCM.
 * Output format: base64(iv).base64(authTag).base64(ciphertext)
 */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_LEN) {
    throw new Error(`encryption key must be ${KEY_LEN} bytes`);
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString("base64")).join(".");
}

/** Decrypts a value produced by {@link encryptSecret}. Throws on tampering. */
export function decryptSecret(payload: string, key: Buffer): string {
  if (key.length !== KEY_LEN) {
    throw new Error(`encryption key must be ${KEY_LEN} bytes`);
  }
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("malformed encrypted payload");
  const iv = Buffer.from(parts[0] as string, "base64");
  const tag = Buffer.from(parts[1] as string, "base64");
  const data = Buffer.from(parts[2] as string, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** Parses a hex or base64 encoded 32-byte key from configuration. */
export function parseEncryptionKey(raw: string): Buffer {
  const hex = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    key = Buffer.from(hex, "hex");
  } else {
    key = Buffer.from(hex, "base64");
  }
  if (key.length !== KEY_LEN) {
    throw new Error("MFA encryption key must decode to 32 bytes");
  }
  return key;
}
