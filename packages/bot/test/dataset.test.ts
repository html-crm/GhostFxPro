import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDecisionDataset } from "../src/backtest/index.ts";
import type { Candle } from "../src/market/klines.ts";

function candlesFromCloses(closes: number[]): Candle[] {
  return closes.map((c, i) => ({
    openTime: i * 1000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
    closeTime: i * 1000 + 999,
  }));
}

test("buildDecisionDataset labels a local maximum as CLOSE and a rise-through as HOLD", () => {
  const candles = candlesFromCloses([10, 11, 12, 11, 10]);
  const rows = buildDecisionDataset(candles, {
    horizon: 3,
    lookahead: 1,
    entryStride: 1,
  });
  // i=0:3, i=1:3, i=2:2, i=3:1  => 9 rows
  assert.equal(rows.length, 9);

  const first = rows[0]!;
  assert.deepEqual(
    [first.entryIndex, first.index],
    [0, 1],
  );
  assert.equal(first.entryPrice, 10);
  assert.equal(first.price, 11);
  assert.ok(Math.abs(first.features.returnPct - 0.1) < 1e-9);
  assert.equal(first.label, "HOLD"); // 11 < the 12 that follows

  const peak = rows[1]!; // index 2, price 12
  assert.equal(peak.index, 2);
  assert.equal(peak.price, 12);
  assert.equal(peak.label, "CLOSE"); // 12 is the local max
  assert.ok(Math.abs(peak.features.peakReturnPct - 0.2) < 1e-9);
});

test("buildDecisionDataset tracks drawdown from the running peak", () => {
  const candles = candlesFromCloses([10, 12, 9]);
  const rows = buildDecisionDataset(candles, { horizon: 2, lookahead: 1 });
  const last = rows.find((r) => r.index === 2)!;
  assert.ok(Math.abs(last.features.drawdownFromPeak - (12 - 9) / 12) < 1e-9);
  assert.ok(Math.abs(last.features.peakReturnPct - 0.2) < 1e-9);
});

test("buildDecisionDataset labels the final bar CLOSE (must exit)", () => {
  const candles = candlesFromCloses([10, 9, 8]);
  const rows = buildDecisionDataset(candles, { horizon: 5, lookahead: 5 });
  const finalRow = rows.find((r) => r.index === candles.length - 1)!;
  assert.equal(finalRow.label, "CLOSE");
});

test("buildDecisionDataset entryStride and horizon bound the episodes", () => {
  const candles = candlesFromCloses([10, 11, 12, 11, 10]);
  const strided = buildDecisionDataset(candles, {
    horizon: 3,
    lookahead: 1,
    entryStride: 2,
  });
  assert.deepEqual(
    strided.map((r) => r.entryIndex),
    [0, 0, 0, 2, 2],
  );
  const short = buildDecisionDataset(candles, { horizon: 1, lookahead: 1 });
  assert.equal(short.length, 4); // entries 0..3, one decision each
});

test("buildDecisionDataset returns [] when there is nothing to sample", () => {
  assert.deepEqual(buildDecisionDataset([]), []);
  assert.deepEqual(buildDecisionDataset(candlesFromCloses([42])), []);
});
