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

test("fetchKlinesSeries pages forward using the last close time", async () => {
  const urls: string[] = [];
  const pages: Record<string, unknown> = {
    "": [[1000, "1", "2", "1", "2", "1", 1999], [2000, "1", "2", "1", "2", "1", 2999]],
  };
  const pager: FetchLike = async (input) => {
    urls.push(input);
    const m = /startTime=(\d+)/.exec(input);
    const key = m ? m[1]! : "";
    // First request (no startTime) returns 2; the next (startTime=3000) returns 1 then dries up.
    const body = key === "3000"
      ? [[3000, "1", "2", "1", "3", "1", 3999]]
      : pages[""]!;
    return { ok: true, status: 200, json: async () => body };
  };

  const series = await fetchKlinesSeries("BTCUSDT", {
    total: 3,
    pageSize: 2,
    fetchImpl: pager,
  });
  assert.equal(series.length, 3);
  assert.equal(series[2]!.close, 3);
  // Second call must start one ms after the first page's last close time.
  assert.ok(urls[1]!.includes("startTime=3000"));
});

test("fetchKlinesSeries returns [] for a non-positive total", async () => {
  const series = await fetchKlinesSeries("BTCUSDT", {
    total: 0,
    fetchImpl: fixedFetch([]),
  });
  assert.deepEqual(series, []);
});
