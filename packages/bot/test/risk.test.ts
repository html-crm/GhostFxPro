import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkQuoteFreshness,
  checkSlippage,
  checkMinNotional,
  isReplay,
} from "../src/risk/risk.ts";
import type { Quote } from "../src/strategy/types.ts";

function quote(price: number, ts: number): Quote {
  return { price, ts, source: "test" };
}

test("quote at exactly the max age is still fresh", () => {
  assert.deepEqual(checkQuoteFreshness(quote(1, 1000), 1500, 500), {
    fresh: true,
    ageMs: 500,
  });
});

test("quote one ms past the max age is stale", () => {
  const r = checkQuoteFreshness(quote(1, 1000), 1501, 500);
  assert.equal(r.fresh, false);
  assert.equal(r.ageMs, 501);
});

test("future-dated quotes do not produce negative age", () => {
  assert.deepEqual(checkQuoteFreshness(quote(1, 2000), 1000, 500), {
    fresh: true,
    ageMs: 0,
  });
});

test("buy slippage: paying more than allowed is rejected", () => {
  const ok = checkSlippage({
    side: "BUY",
    expectedPrice: 100,
    actualPrice: 101,
    maxSlippagePct: 0.02,
  });
  assert.equal(ok.ok, true);
  assert.ok(Math.abs(ok.slippagePct - 0.01) < 1e-12);

  const bad = checkSlippage({
    side: "BUY",
    expectedPrice: 100,
    actualPrice: 103,
    maxSlippagePct: 0.02,
  });
  assert.equal(bad.ok, false);
});

test("buy slippage: receiving a better price is never blocked", () => {
  const r = checkSlippage({
    side: "BUY",
    expectedPrice: 100,
    actualPrice: 99,
    maxSlippagePct: 0.01,
  });
  assert.equal(r.ok, true);
  assert.ok(r.slippagePct < 0);
});

test("sell slippage: receiving less than allowed is rejected", () => {
  const ok = checkSlippage({
    side: "SELL",
    expectedPrice: 100,
    actualPrice: 98,
    maxSlippagePct: 0.02,
  });
  assert.equal(ok.ok, true);

  const bad = checkSlippage({
    side: "SELL",
    expectedPrice: 100,
    actualPrice: 97.9,
    maxSlippagePct: 0.02,
  });
  assert.equal(bad.ok, false);
});

test("min-notional rejects dust", () => {
  assert.equal(checkMinNotional({ qty: 1, price: 100, minNotional: 10 }), true);
  assert.equal(checkMinNotional({ qty: 0.05, price: 100, minNotional: 10 }), false);
});

test("replay detection is exact", () => {
  const seen = ["a", "b"];
  assert.equal(isReplay(seen, "a"), true);
  assert.equal(isReplay(seen, "c"), false);
});
