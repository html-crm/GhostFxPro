import { test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/password.ts";

test("hashes are salted (two hashes of the same password differ)", () => {
  const a = hashPassword("correct horse battery");
  const b = hashPassword("correct horse battery");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt\$/);
});

test("verifies a correct password and rejects a wrong one", () => {
  const stored = hashPassword("s3cret-passw0rd");
  assert.equal(verifyPassword("s3cret-passw0rd", stored), true);
  assert.equal(verifyPassword("s3cret-passw0r", stored), false);
  assert.equal(verifyPassword("", stored), false);
});

test("rejects malformed stored hashes without throwing", () => {
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", "scrypt$bad"), false);
});

test("enforces a minimum password length", () => {
  assert.throws(() => hashPassword("short"), /at least 8/);
});
