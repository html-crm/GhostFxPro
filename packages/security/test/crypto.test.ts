import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  parseEncryptionKey,
} from "../src/crypto.ts";

test("encrypts and decrypts a secret round-trip", () => {
  const key = randomBytes(32);
  const secret = "JBSWY3DPEHPK3PXP";
  const payload = encryptSecret(secret, key);
  assert.notEqual(payload, secret);
  assert.equal(decryptSecret(payload, key), secret);
});

test("ciphertext is non-deterministic (fresh IV each time)", () => {
  const key = randomBytes(32);
  assert.notEqual(encryptSecret("same", key), encryptSecret("same", key));
});

test("decryption fails under the wrong key or tampering", () => {
  const key = randomBytes(32);
  const payload = encryptSecret("secret-value", key);
  assert.throws(() => decryptSecret(payload, randomBytes(32)));
  const tampered = payload.slice(0, -4) + "AAAA";
  assert.throws(() => decryptSecret(tampered, key));
});

test("rejects keys that are not 32 bytes", () => {
  assert.throws(() => encryptSecret("x", randomBytes(16)));
  assert.throws(() => parseEncryptionKey("abcd"));
});

test("parses hex and base64 keys", () => {
  const hex = randomBytes(32).toString("hex");
  assert.equal(parseEncryptionKey(hex).length, 32);
  const b64 = randomBytes(32).toString("base64");
  assert.equal(parseEncryptionKey(b64).length, 32);
});
