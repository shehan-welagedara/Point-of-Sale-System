/**
 * Money is always an integer number of cents (LKR × 100). Never use floats for money.
 * Rates are integer basis points: 10000 bp = 100%, 1800 bp = 18%, 250 bp = 2.5%.
 */
export type Cents = number;
export type BasisPoints = number;

export const BP_SCALE = 10_000;

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of cents, got ${value}`);
  }
}

/** Divide and round half away from zero, exactly (BigInt), e.g. roundDiv(5, 2) = 3, roundDiv(-5, 2) = -3. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("division by zero");
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const rounded = (abs * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

/** `amount × rate`, rounded half away from zero to the cent. */
export function applyRate(amount: Cents, rate: BasisPoints): Cents {
  return Number(roundDiv(BigInt(amount) * BigInt(rate), BigInt(BP_SCALE)));
}

/**
 * Split `total` into integer parts proportional to `weights` (largest-remainder method).
 * Parts always sum exactly to `total`. Weights must be non-negative.
 */
export function allocate(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total, "total");
  if (weights.length === 0) {
    if (total !== 0) throw new RangeError("cannot allocate a non-zero total over no weights");
    return [];
  }
  const w = weights.map((x) => {
    if (!Number.isSafeInteger(x) || x < 0) throw new RangeError(`invalid weight ${x}`);
    return BigInt(x);
  });
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    // Nothing to weight by: put everything on the first part.
    return weights.map((_, i) => (i === 0 ? total : 0));
  }
  const sign = total < 0 ? -1n : 1n;
  const absTotal = BigInt(Math.abs(total));
  const parts = w.map((x) => (absTotal * x) / sum);
  const remainders = w.map((x, i) => ({ i, r: (absTotal * x) % sum }));
  let left = absTotal - parts.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    parts[i] = (parts[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return parts.map((p) => Number(p * sign));
}

export type RoundingMode = "nearest" | "up" | "down";

/** Round an amount to a multiple of `unit` cents (e.g. 100 = Rs 1.00, 1000 = Rs 10.00). */
export function roundToUnit(amount: Cents, unit: Cents, mode: RoundingMode = "nearest"): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(unit) || unit <= 0) throw new RangeError(`invalid rounding unit ${unit}`);
  if (unit === 1) return amount;
  const a = BigInt(amount);
  const u = BigInt(unit);
  let q: bigint;
  if (mode === "nearest") q = roundDiv(a, u);
  else {
    const floor = a >= 0n ? a / u : -((-a + u - 1n) / u);
    q = mode === "down" ? floor : floor * u === a ? floor : floor + 1n;
  }
  return Number(q * u);
}

/** Format cents as "3,412.61" (no currency symbol; receipts add their own). */
export function formatAmount(amount: Cents): string {
  assertCents(amount);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const rupees = Math.floor(abs / 100).toLocaleString("en-US");
  const cents = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${rupees}.${cents}`;
}
