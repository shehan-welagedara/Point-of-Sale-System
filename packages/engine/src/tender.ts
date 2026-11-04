import { type Cents, assertCents, roundDiv } from "./money.js";

export interface TenderMedia {
  id: string;
  name: string;
  /** Only tenders that allow change (cash) may exceed the balance. */
  allowChange: boolean;
  /** Foreign currency tenders carry an exchange rate. */
  currency?: string;
}

export interface Payment {
  tenderId: string;
  /** Amount in the tender's own currency, in cents. */
  amount: Cents;
  /** LKR per 1 unit of foreign currency × 1,000,000 (e.g. 300.25 → 300_250_000). Required for foreign tenders. */
  exchangeRateMicros?: number;
  reference?: string;
}

export interface SettlementLine {
  tenderId: string;
  /** Value applied to the bill in LKR cents. */
  applied: Cents;
  /** As tendered, converted to LKR cents. */
  tendered: Cents;
}

export interface Settlement {
  lines: SettlementLine[];
  paid: Cents;
  balanceDue: Cents;
  change: Cents;
  settled: boolean;
}

export class TenderError extends Error {}

/** Convert a foreign-currency amount to LKR cents. */
export function toLkr(amount: Cents, exchangeRateMicros: number): Cents {
  assertCents(amount);
  if (!Number.isSafeInteger(exchangeRateMicros) || exchangeRateMicros <= 0) {
    throw new TenderError("invalid exchange rate");
  }
  return Number(roundDiv(BigInt(amount) * BigInt(exchangeRateMicros), 1_000_000n));
}

/**
 * Apply payments in order to the amount due. Change is given (in LKR) only when the last
 * payment that over-tenders is on a tender that allows change.
 */
export function settle(amountDue: Cents, payments: readonly Payment[], tenders: readonly TenderMedia[]): Settlement {
  assertCents(amountDue, "amountDue");
  if (amountDue < 0) throw new TenderError("amount due cannot be negative; refunds are separate documents");
  let balance = amountDue;
  let change = 0;
  const lines: SettlementLine[] = [];
  for (const p of payments) {
    const tender = tenders.find((t) => t.id === p.tenderId);
    if (!tender) throw new TenderError(`unknown tender ${p.tenderId}`);
    assertCents(p.amount, `payment on ${tender.name}`);
    if (p.amount <= 0) throw new TenderError(`payment on ${tender.name} must be positive`);
    if (balance === 0) throw new TenderError("check is already fully paid");
    let tendered: Cents;
    if (tender.currency) {
      if (p.exchangeRateMicros === undefined) throw new TenderError(`${tender.name} needs an exchange rate`);
      tendered = toLkr(p.amount, p.exchangeRateMicros);
    } else {
      tendered = p.amount;
    }
    if (tendered > balance) {
      if (!tender.allowChange) {
        throw new TenderError(`${tender.name} cannot exceed the balance of ${balance} cents`);
      }
      change += tendered - balance;
    }
    const applied = Math.min(tendered, balance);
    balance -= applied;
    lines.push({ tenderId: tender.id, applied, tendered });
  }
  return { lines, paid: amountDue - balance, balanceDue: balance, change, settled: balance === 0 };
}
