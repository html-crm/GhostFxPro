import { test } from "node:test";
import assert from "node:assert/strict";
import { randomToken, hashToken } from "../src/tokens.ts";

test("tokens are unique and sufficiently long", () => {
  const a = randomToken();
  const b = randomToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40, "256-bit base64url token should be >= 40 chars");
});

test("hashing is deterministic and irreversible-looking", () => {
  const token = randomToken();
  const h1 = hashToken(token);
  const h2 = hashToken(token);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(h1, token);
});

test("different tokens hash differently", () => {
  assert.notEqual(hashToken("a"), hashToken("b"));
});
