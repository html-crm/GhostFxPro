import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runBacktest,
  runBacktestSeries,
  flexiPolicy,
  summarize,
} from "../src/backtest/index.ts";
import type { ExitPolicy } from "../src/backtest/index.ts";
import type { Candle } from "../src/market/klines.ts";
import { FLEXI_DEFAULT_CONFIG } from "../src/strategy/registry.ts";

/** Build candles from a close path; open/high/low mirror the close. */
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

/** Closes at/above `target` once the position is up. */
function takeProfit(target: number): ExitPolicy {
  return (state, candle) => {
    const peak = Math.max(state.peakPrice, candle.close);
    if (candle.close >= target) {
      return {
        action: "CLOSE",
        reason: "target",
        next: { ...state, peakPrice: peak },
      };
    }
    return { action: "HOLD", reason: "hold", next: { ...state, peakPrice: peak } };
  };
}

test("runBacktest closes on the policy's signal and reports net P&L", () => {
  const candles = candlesFromCloses([100, 101, 105, 104]);
  const trade = runBacktest(candles, { policy: takeProfit(105), entryIndex: 0 });
  assert.ok(trade);
  assert.equal(trade.entryIndex, 0);
  assert.equal(trade.exitIndex, 2);
  assert.equal(trade.exitPrice, 105);
  assert.equal(trade.barsHeld, 2);
  assert.ok(Math.abs(trade.grossPnlPct - 0.05) < 1e-9);
  assert.equal(trade.exitReason, "target");
});

test("runBacktest force-closes at the horizon when the policy never closes", () => {
  const candles = candlesFromCloses([100, 101, 102, 103]);
  const trade = runBacktest(candles, { policy: takeProfit(9999), entryIndex: 0 });
  assert.ok(trade);
  assert.equal(trade.exitReason, "horizon_end");
  assert.equal(trade.exitIndex, 3);
  assert.equal(trade.exitPrice, 103);
});

test("runBacktest honours maxBarsHeld", () => {
  const candles = candlesFromCloses([100, 101, 102, 103, 104, 105]);
  const trade = runBacktest(candles, {
    policy: takeProfit(9999),
    entryIndex: 0,
    maxBarsHeld: 2,
  });
  assert.ok(trade);
  assert.equal(trade.exitIndex, 2);
  assert.equal(trade.barsHeld, 2);
});

test("runBacktest subtracts round-trip fees and tracks drawdown", () => {
  const candles = candlesFromCloses([100, 120, 90]);
  const trade = runBacktest(candles, {
    policy: takeProfit(9999),
    entryIndex: 0,
    feePct: 0.001,
  });
  assert.ok(trade);
  assert.ok(Math.abs(trade.grossPnlPct - (90 / 100 - 1)) < 1e-9);
  assert.ok(Math.abs(trade.netPnlPct - (-0.1 - 0.002)) < 1e-9);
  assert.equal(trade.peakPrice, 120);
  assert.ok(Math.abs(trade.maxDrawdownPct - (120 - 90) / 120) < 1e-9);
});

test("runBacktest returns null without room for a trade", () => {
  assert.equal(runBacktest([], { policy: takeProfit(1) }), null);
  assert.equal(runBacktest(candlesFromCloses([100]), { policy: takeProfit(1) }), null);
  assert.equal(
    runBacktest(candlesFromCloses([100, 101]), { policy: takeProfit(1), entryIndex: 5 }),
    null,
  );
});

test("flexiPolicy arms at +7% then exits on a 2% trailing pullback", () => {
  const candles = candlesFromCloses([100, 107, 108, 105, 105]);
  const trade = runBacktest(candles, {
    policy: flexiPolicy(FLEXI_DEFAULT_CONFIG),
    entryIndex: 0,
  });
  assert.ok(trade);
  assert.equal(trade.exitReason, "trailing_exit");
  assert.equal(trade.exitIndex, 4);
  assert.equal(trade.exitPrice, 105);
});

test("flexiPolicy does nothing below the arm threshold", () => {
  const candles = candlesFromCloses([100, 103, 104, 105, 106]);
  const trade = runBacktest(candles, {
    policy: flexiPolicy(FLEXI_DEFAULT_CONFIG),
    entryIndex: 0,
  });
  assert.ok(trade);
  assert.equal(trade.exitReason, "horizon_end");
});

test("runBacktestSeries runs a trade every stride bars", () => {
  const candles = candlesFromCloses([100, 101, 102, 103, 104, 105]);
  const trades = runBacktestSeries(candles, {
    policy: takeProfit(9999),
    stride: 2,
  });
  assert.equal(trades.length, 3); // entries at 0, 2, 4
  assert.deepEqual(
    trades.map((t) => t.entryIndex),
    [0, 2, 4],
  );
});

test("summarize computes win rate, totals, equity and drawdown", () => {
  const mk = (net: number, bars: number) =>
    ({
      entryIndex: 0,
      exitIndex: bars,
      entryPrice: 1,
      exitPrice: 1 + net,
      barsHeld: bars,
      peakPrice: 1 + net,
      maxDrawdownPct: 0,
      grossPnlPct: net,
      netPnlPct: net,
      exitReason: "x",
    }) as const;
  const m = summarize([mk(0.05, 4), mk(-0.02, 2), mk(0.03, 6)]);
  assert.equal(m.trades, 3);
  assert.equal(m.wins, 2);
  assert.equal(m.losses, 1);
  assert.ok(Math.abs(m.winRate - 2 / 3) < 1e-9);
  assert.ok(Math.abs(m.totalReturnPct - 0.06) < 1e-9);
  assert.ok(Math.abs(m.finalEquity - 1.05 * 0.98 * 1.03) < 1e-9);
  assert.ok(Math.abs(m.maxDrawdownPct - 0.02) < 1e-9);
  assert.ok(Math.abs(m.avgBarsHeld - 4) < 1e-9);
});

test("summarize handles an empty set", () => {
  const m = summarize([]);
  assert.equal(m.trades, 0);
  assert.equal(m.finalEquity, 1);
  assert.equal(m.expectancyRatio, null);
});
