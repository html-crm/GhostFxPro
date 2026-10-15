import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAlert,
  isPriceAlert,
  type AlertRule,
} from "../src/alerts/alerts.ts";

function priceRule(kind: AlertRule["kind"], value: number): AlertRule {
  return {
    kind,
    threshold:
      kind === "PRICE_ABOVE" || kind === "PRICE_BELOW" ? value : null,
    pct: kind === "PCT_MOVE_UP" || kind === "PCT_MOVE_DOWN" ? value : null,
  };
}

test("price-kind rules are recognised", () => {
  assert.equal(isPriceAlert("PRICE_ABOVE"), true);
  assert.equal(isPriceAlert("PRICE_BELOW"), true);
  assert.equal(isPriceAlert("PCT_MOVE_UP"), true);
  assert.equal(isPriceAlert("PCT_MOVE_DOWN"), true);
  assert.equal(isPriceAlert("POSITION_OPENED"), false);
  assert.equal(isPriceAlert("POSITION_CLOSED"), false);
});

test("PRICE_ABOVE fires at or above the threshold", () => {
  const rule = priceRule("PRICE_ABOVE", 100);
  assert.equal(evaluateAlert(rule, { price: 101, baselinePrice: null }).triggered, true);
  assert.equal(evaluateAlert(rule, { price: 100, baselinePrice: null }).triggered, true);
  assert.equal(evaluateAlert(rule, { price: 99.99, baselinePrice: null }).triggered, false);
});

test("PRICE_BELOW fires at or below the threshold", () => {
  const rule = priceRule("PRICE_BELOW", 50);
  assert.equal(evaluateAlert(rule, { price: 49, baselinePrice: null }).triggered, true);
  assert.equal(evaluateAlert(rule, { price: 50, baselinePrice: null }).triggered, true);
  assert.equal(evaluateAlert(rule, { price: 50.01, baselinePrice: null }).triggered, false);
});

test("PCT_MOVE_UP fires when the rise from baseline meets the threshold", () => {
  const rule = priceRule("PCT_MOVE_UP", 0.05); // 5%
  assert.equal(evaluateAlert(rule, { price: 105, baselinePrice: 100 }).triggered, true);
  assert.equal(evaluateAlert(rule, { price: 104.9, baselinePrice: 100 }).triggered, false);
});

test("PCT_MOVE_DOWN fires when the drop from baseline meets the threshold", () => {
  const rule = priceRule("PCT_MOVE_DOWN", 0.1); // 10%
  assert.equal(evaluateAlert(rule, { price: 90, baselinePrice: 100 }).triggered, true);
  assert.equal(evaluateAlert(rule, { price: 91, baselinePrice: 100 }).triggered, false);
});

test("PCT_MOVE rules never fire without a usable baseline", () => {
  const up = priceRule("PCT_MOVE_UP", 0.05);
  assert.equal(evaluateAlert(up, { price: 1e9, baselinePrice: null }).triggered, false);
  assert.equal(evaluateAlert(up, { price: 1e9, baselinePrice: 0 }).triggered, false);
});

test("a missing threshold keeps a price rule inert", () => {
  const rule: AlertRule = { kind: "PRICE_ABOVE", threshold: null, pct: null };
  assert.equal(evaluateAlert(rule, { price: 1e9, baselinePrice: null }).triggered, false);
});

test("position-event rules never trigger from a price observation", () => {
  const rule: AlertRule = { kind: "POSITION_OPENED", threshold: null, pct: null };
  assert.equal(evaluateAlert(rule, { price: 1e9, baselinePrice: null }).triggered, false);
});

test("a missing observation never triggers anything", () => {
  assert.equal(evaluateAlert(priceRule("PRICE_ABOVE", 1), null).triggered, false);
});

test("a triggered outcome reports the observed price and a reason", () => {
  const out = evaluateAlert(priceRule("PRICE_ABOVE", 100), { price: 120, baselinePrice: null });
  assert.equal(out.triggered, true);
  assert.equal(out.observed, 120);
  assert.match(out.reason ?? "", /at or above/);
});
