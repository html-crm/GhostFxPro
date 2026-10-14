/**
 * Exact fixed-point decimal helpers built on BigInt, used for the integer
 * base-unit math that feeds the `numeric` columns. Never uses floating point
 * for money: inputs are parsed digit-by-digit.
 *
 * Convention: a "scaled" value is an integer that equals `value * 10^18`.
 */

const SCALE = 18n;
const SCALE_DIGITS = 18;
const TEN = 10n;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/** Parses a decimal string/number into an integer scaled by 10^18. */
export function toScaled(value: string | number): bigint {
  const s = typeof value === "number" ? numberToString(value) : value.trim();
  if (!DECIMAL_RE.test(s)) throw new Error(`not a decimal: ${s}`);
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [whole = "0", frac = ""] = unsigned.split(".");
  const fracPadded = (frac + "0".repeat(SCALE_DIGITS)).slice(0, SCALE_DIGITS);
  const scaled = BigInt(whole) * TEN ** SCALE + BigInt(fracPadded || "0");
  return negative ? -scaled : scaled;
}

/** Formats an integer scaled by 10^18 as a plain decimal string. */
export function fromScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const whole = abs / TEN ** SCALE;
  const frac = (abs % TEN ** SCALE).toString().padStart(SCALE_DIGITS, "0");
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed ? `${whole}.${trimmed}` : `${whole}`;
  return negative ? `-${body}` : body;
}

/**
 * price per whole token -> price per base unit, scaled by 10^18, rounded to
 * the nearest representable value. For a token with `d` decimals this equals
 * `price * 10^18 / 10^d` rounded.
 */
export function pricePerBaseScaled(
  pricePerToken: string | number,
  decimals: number,
): bigint {
  const unitScale = TEN ** BigInt(decimals);
  return roundDiv(toScaled(pricePerToken), unitScale);
}

/** Rounds `a / b` (both non-negative) to nearest, half up. */
function roundDiv(a: bigint, b: bigint): bigint {
  return (a + b / 2n) / b;
}

/**
 * Converts a quote notional and a per-whole-token price into integer base
 * units and the price-per-base-unit.
 *
 *   baseUnits           = floor(notional * 10^decimals / price)
 *   pricePerBaseScaled  = round(price * 10^18 / 10^decimals)
 */
export function quoteToBaseUnits(
  notionalQuote: string,
  pricePerToken: string,
  decimals: number,
): { baseUnits: bigint; pricePerBaseScaled: bigint } {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`invalid decimals: ${decimals}`);
  }
  const notional = toScaled(notionalQuote);
  const price = toScaled(pricePerToken); // = pricePerToken * 1e18
  if (price <= 0n) throw new Error("price must be positive");
  if (notional <= 0n) throw new Error("notional must be positive");
  const unitScale = TEN ** BigInt(decimals);
  const baseUnits = (notional * unitScale) / price;
  const perBase = roundDiv(price, unitScale);
  if (baseUnits <= 0n) throw new Error("notional too small for price/decimals");
  return { baseUnits, pricePerBaseScaled: perBase };
}

/** Per-base price (scaled 1e18) -> per-whole-token price (scaled 1e18). */
export function perBaseToPerTokenScaled(
  perBaseScaled: bigint,
  decimals: number,
): bigint {
  return perBaseScaled * TEN ** BigInt(decimals);
}

/** cost (scaled 1e18) = baseUnits * pricePerBaseScaled. */
export function baseUnitsToCostScaled(
  baseUnits: bigint,
  pricePerBaseScaled: bigint,
): bigint {
  return baseUnits * pricePerBaseScaled;
}

function numberToString(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`not finite: ${n}`);
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(20).replace(/0+$/, "");
  return s.endsWith(".") ? s.slice(0, -1) : s;
}
