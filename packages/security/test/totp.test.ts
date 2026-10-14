import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode } from "../src/base32.ts";
import {
  generateTotpSecret,
  hotp,
  totp,
  verifyTotp,
} from "../src/totp.ts";

test("base32 round-trips arbitrary bytes", () => {
  const buf = Buffer.from([0, 1, 2, 250, 255, 128, 64, 32]);
  const round = base32Decode(base32Encode(buf));
  assert.deepEqual(round, buf);
});

// RFC 6238 Appendix B test vectors (SHA-1, ASCII secret "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("RFC 6238 test vectors (8-digit, SHA-1)", () => {
  const cases: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, expected] of cases) {
    assert.equal(
      hotp(RFC_SECRET, Math.floor(seconds / 30), 8),
      expected,
      `counter for t=${seconds}`,
    );
  }
});

test("generates a usable secret and verifies within the drift window", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000; // fixed clock
  const code = totp(secret, now);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotp(secret, code, now), true);
  // One step earlier still accepted (window = 1), matching authenticator drift.
  assert.equal(verifyTotp(secret, totp(secret, now - 30_000), now), true);
  // Two steps away is rejected.
  assert.equal(verifyTotp(secret, totp(secret, now - 90_000), now), false);
});

test("rejects malformed codes and wrong secrets", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, "abcdef", now), false);
  assert.equal(verifyTotp(secret, "000000", now), false);
});
