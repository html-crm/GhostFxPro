import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchKlines,
  fetchKlinesSeries,
  parseKlines,
} from "../src/market/klines.ts";
import type { FetchLike } from "../src/market/types.ts";

function fixedFetch(payload: unknown, capture?: { url?: string }): FetchLike {
  return async (input) => {
    if (capture) capture.url = input;
    return { ok: true, status: 200, json: async () => payload };
  };
}

test("parseKlines maps valid rows and preserves order", () => {
  const raw = [
    [1000, "1", "2", "0.5", "1.5", "10", 1999],
    [2000, "1.5", "3", "1", "2.5", "20", 2999],
  ];
  const candles = parseKlines(raw);
  assert.equal(candles.length, 2);
  assert.deepEqual(candles[0], {
    openTime: 1000,
    open: 1,
    high: 2,
    low: 0.5,
    close: 1.5,
    volume: 10,
    closeTime: 1999,
  });
  assert.equal(candles[1]!.close, 2.5);
});

test("parseKlines drops malformed and non-positive rows", () => {
  const raw = [
    [1000, "1", "2", "0.5", "1.5", "10", 1999],
    [2000, "1.5", "3", "1", "0", "20", 2999], // zero close
    [3000, "x", "3", "1", "2", "20", 3999], // non-numeric
    "nope",
    [4000, "1", "2", "1", "2", "5"], // too short
  ];
  const candles = parseKlines(raw);
  assert.equal(candles.length, 1);
});

test("parseKlines returns [] for a non-array payload", () => {
  assert.deepEqual(parseKlines({ error: "bad symbol" }), []);
  assert.deepEqual(parseKlines(null), []);
});

test("fetchKlines builds the expected URL and parses the response", async () => {
  const capture: { url?: string } = {};
  const candles = await fetchKlines("btcusdt", {
    interval: "1h",
    limit: 2,
    startTime: 1_600_000_000_000,
    fetchImpl: fixedFetch(
      [
        [1000, "1", "2", "0.5", "1.5", "10", 1999],
        [2000, "1.5", "3", "1", "2.5", "20", 2999],
      ],
      capture,
    ),
  });
  assert.equal(candles.length, 2);
  assert.ok(capture.url!.includes("/api/v3/klines?"));
  assert.ok(capture.url!.includes("symbol=BTCUSDT")); // uppercased
  assert.ok(capture.url!.includes("interval=1h"));
  assert.ok(capture.url!.includes("limit=2"));
  assert.ok(capture.url!.includes("startTime=1600000000000"));
});

test("fetchKlines returns [] when the source is not ok or throws", async () => {
  const bad: FetchLike = async () => ({ ok: false, status: 451, json: async () => ({}) });
  assert.deepEqual(await fetchKlines("BTCUSDT", { fetchImpl: bad }), []);
  const boom: FetchLike = async () => {
    throw new Error("network");
  };
  assert.deepEqual(await fetchKlines("BTCUSDT", { fetchImpl: boom }), []);
  assert.deepEqual(await fetchKlines("  ", { fetchImpl: bad }), []);
});

test("fetchKlinesSeries pages backward and returns ascending order", async () => {
  const urls: string[] = [];
  const candle = (openTime: number, close: number) => [
    openTime,
    "1",
    "2",
    "1",
    String(close),
    "1",
    openTime + 1000,
  ];
  const pager: FetchLike = async (input) => {
    urls.push(input);
    const m = /endTime=(\d+)/.exec(input);
    const end = m ? Number(m[1]) : Infinity;
    // Page 1 (no endTime): the two newest candles, ascending like Binance.
    // Page 2 (endTime=2999): the two before that. Then it dries up.
    let body: unknown = [];
    if (end === Infinity) body = [candle(3000, 3), candle(4000, 4)];
    else if (end === 2999) body = [candle(1000, 1), candle(2000, 2)];
    return { ok: true, status: 200, json: async () => body };
  };

  const series = await fetchKlinesSeries("BTCUSDT", {
    total: 3,
    pageSize: 2,
    fetchImpl: pager,
  });
  // Pages collected newest-first then reversed: [1000,2000,3000,4000] -> last 3.
  assert.deepEqual(
    series.map((c) => c.openTime),
    [2000, 3000, 4000],
  );
  assert.ok(urls[1]!.includes("endTime=2999")); // second page ends before the oldest of page 1
});

test("fetchKlinesSeries returns [] for a non-positive total", async () => {
  const series = await fetchKlinesSeries("BTCUSDT", {
    total: 0,
    fetchImpl: fixedFetch([]),
  });
  assert.deepEqual(series, []);
});
