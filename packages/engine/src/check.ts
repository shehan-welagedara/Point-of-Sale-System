import {
  type BasisPoints,
  type Cents,
  type RoundingMode,
  BP_SCALE,
  allocate,
  applyRate,
  assertCents,
  roundDiv,
  roundToUnit,
} from "./money.js";

/** `serviceCharge` and `levy` (SSCL, TDL) sit inside the VAT base; `vat` is reported as VAT. */
export type ChargeKind = "serviceCharge" | "levy" | "vat";

/** The net (after-discount, before-charges) value of the items. Used in `ChargeRule.base`. */
export const NET = "net";

/**
 * One service charge or tax. Rules are evaluated in array order, so a rule's `base`
 * may only reference rules that appear before it.
 */
export interface ChargeRule {
  id: string;
  name: string;
  kind: ChargeKind;
  rate: BasisPoints;
  /** What the rule is charged on: `NET` and/or ids of earlier rules, e.g. VAT = [NET, "sc", "sscl"]. */
  base: readonly string[];
  /** Only lines whose tax class is listed; omit for all lines. */
  taxClasses?: readonly string[];
  /** Only these order types (e.g. service charge for dine-in only); omit for all. */
  orderTypes?: readonly string[];
}

export interface Discount {
  id: string;
  name: string;
  type: "percent" | "amount";
  /** Basis points for `percent`, cents for `amount`. */
  value: number;
}

export interface Modifier {
  name: string;
  /** Price per unit of the parent item, in cents (0 for free condiments). */
  price: Cents;
}

export interface CheckLineInput {
  id: string;
  name: string;
  /** Up to 3 decimals for weighed items (e.g. 0.25 kg). Must be > 0. */
  quantity: number;
  unitPrice: Cents;
  modifiers?: readonly Modifier[];
  taxClass: string;
  /** Excluded from subtotal discounts when false. Defaults to true. */
  discountable?: boolean;
  discounts?: readonly Discount[];
}

export interface CheckInput {
  lines: readonly CheckLineInput[];
  orderType: string;
  /** `exclusive`: charges are added on top of prices. `inclusive`: prices already contain every applicable charge. */
  pricing: "exclusive" | "inclusive";
  rules: readonly ChargeRule[];
  subtotalDiscounts?: readonly Discount[];
  /** Rule ids waived for this check (e.g. a tax-exempt guest). */
  exemptRuleIds?: readonly string[];
  /** Round the amount due, e.g. `{ unit: 100, mode: "nearest" }` for whole rupees. */
  billRounding?: { unit: Cents; mode: RoundingMode };
}

export interface LineTotals {
  id: string;
  /** quantity × (unit price + modifiers), as entered (tax-inclusive when pricing is inclusive). */
  gross: Cents;
  discount: Cents;
  /** Value before service charge and taxes. */
  net: Cents;
  charges: Record<string, Cents>;
  total: Cents;
}

export interface ChargeTotal {
  ruleId: string;
  name: string;
  kind: ChargeKind;
  rate: BasisPoints;
  base: Cents;
  amount: Cents;
}

export interface DiscountTotal {
  id: string;
  name: string;
  lineId?: string;
  amount: Cents;
}

export interface CheckTotals {
  lines: LineTotals[];
  /** Σ gross. */
  itemsTotal: Cents;
  discounts: DiscountTotal[];
  discountTotal: Cents;
  /** Σ net: the value before service charge and taxes. */
  netSubtotal: Cents;
  charges: ChargeTotal[];
  /** Net + service charge + levies: the "Value excl. VAT" line on a tax invoice. */
  valueExclVat: Cents;
  vatTotal: Cents;
  total: Cents;
  roundingAdjustment: Cents;
  amountDue: Cents;
}

const QTY_SCALE = 1000n;

function lineGross(line: CheckLineInput): Cents {
  assertCents(line.unitPrice, `unitPrice of ${line.id}`);
  const qtyMilli = Math.round(line.quantity * 1000);
  if (!(qtyMilli > 0) || Math.abs(line.quantity * 1000 - qtyMilli) > 1e-6) {
    throw new RangeError(`quantity of ${line.id} must be > 0 with at most 3 decimals (returns are separate credit documents)`);
  }
  const unit = (line.modifiers ?? []).reduce((sum, m) => {
    assertCents(m.price, `modifier price on ${line.id}`);
    return sum + m.price;
  }, line.unitPrice);
  if (unit < 0) throw new RangeError(`unit price of ${line.id} cannot be negative`);
  return Number(roundDiv(BigInt(unit) * BigInt(qtyMilli), QTY_SCALE));
}

function discountAmount(discount: Discount, eligible: Cents): Cents {
  if (discount.type === "percent") {
    if (!Number.isSafeInteger(discount.value) || discount.value < 0 || discount.value > BP_SCALE) {
      throw new RangeError(`discount ${discount.id}: percent must be 0–10000 bp`);
    }
    return applyRate(eligible, discount.value);
  }
  assertCents(discount.value, `discount ${discount.id}`);
  if (discount.value < 0) throw new RangeError(`discount ${discount.id} cannot be negative`);
  return Math.min(discount.value, eligible);
}

function validateRules(rules: readonly ChargeRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id) || rule.id === NET) throw new Error(`duplicate or reserved rule id "${rule.id}"`);
    if (!Number.isSafeInteger(rule.rate) || rule.rate < 0) throw new RangeError(`rule ${rule.id}: invalid rate`);
    for (const b of rule.base) {
      if (b !== NET && !seen.has(b)) throw new Error(`rule ${rule.id}: base "${b}" must be NET or an earlier rule`);
    }
    seen.add(rule.id);
  }
}

function ruleApplies(rule: ChargeRule, line: CheckLineInput, input: CheckInput): boolean {
  if (input.exemptRuleIds?.includes(rule.id)) return false;
  if (rule.orderTypes && !rule.orderTypes.includes(input.orderType)) return false;
  if (rule.taxClasses && !rule.taxClasses.includes(line.taxClass)) return false;
  return true;
}

/** Bill-level charge calculation on given line nets. Each charge is rounded once, then allocated to lines. */
function computeCharges(
  input: CheckInput,
  nets: readonly Cents[],
): { totals: ChargeTotal[]; perLine: Record<string, Cents>[] } {
  const perLine: Record<string, Cents>[] = nets.map(() => ({}));
  const totals: ChargeTotal[] = [];
  for (const rule of input.rules) {
    const bases = input.lines.map((line, i) => {
      if (!ruleApplies(rule, line, input)) return 0;
      return rule.base.reduce((sum, b) => sum + (b === NET ? (nets[i] ?? 0) : (perLine[i]?.[b] ?? 0)), 0);
    });
    const base = bases.reduce((a, b) => a + b, 0);
    const amount = applyRate(base, rule.rate);
    allocate(amount, bases).forEach((part, i) => {
      if (part !== 0) (perLine[i] as Record<string, Cents>)[rule.id] = part;
    });
    totals.push({ ruleId: rule.id, name: rule.name, kind: rule.kind, rate: rule.rate, base, amount });
  }
  return { totals, perLine };
}

/**
 * For inclusive pricing: the factor F such that gross = net × F / D for a line, given which rules apply.
 * Returns [F, D] as exact BigInt fractions.
 */
function inclusiveFactor(input: CheckInput, line: CheckLineInput): [bigint, bigint] {
  const D = BigInt(BP_SCALE) ** BigInt(Math.max(1, input.rules.length));
  const k = new Map<string, bigint>(); // charge per unit of net, scaled by D
  let total = D;
  for (const rule of input.rules) {
    if (!ruleApplies(rule, line, input)) continue;
    const base = rule.base.reduce((sum, b) => sum + (b === NET ? D : (k.get(b) ?? 0n)), 0n);
    const kr = (base * BigInt(rule.rate)) / BigInt(BP_SCALE);
    k.set(rule.id, kr);
    total += kr;
  }
  return [total, D];
}

export function calculateCheck(input: CheckInput): CheckTotals {
  validateRules(input.rules);
  const lines = input.lines;
  const gross = lines.map(lineGross);
  const discounts: DiscountTotal[] = [];

  // 1. Item discounts, applied in order on what is left of the line.
  const afterItem = lines.map((line, i) => {
    let remaining = gross[i] ?? 0;
    for (const d of line.discounts ?? []) {
      const amount = discountAmount(d, remaining);
      remaining -= amount;
      discounts.push({ id: d.id, name: d.name, lineId: line.id, amount });
    }
    return remaining;
  });

  // 2. Subtotal discounts, spread over discountable lines in proportion to their value.
  const afterAll = [...afterItem];
  for (const d of input.subtotalDiscounts ?? []) {
    const weights = lines.map((line, i) => (line.discountable === false ? 0 : (afterAll[i] ?? 0)));
    const eligible = weights.reduce((a, b) => a + b, 0);
    const amount = discountAmount(d, eligible);
    allocate(amount, weights).forEach((part, i) => {
      afterAll[i] = (afterAll[i] ?? 0) - part;
    });
    discounts.push({ id: d.id, name: d.name, amount });
  }

  // 3. Nets: equal to the discounted price, or back-calculated out of it for inclusive pricing.
  let nets: Cents[];
  if (input.pricing === "exclusive") {
    nets = afterAll;
  } else {
    nets = lines.map((line, i) => {
      const [f, d] = inclusiveFactor(input, line);
      return Number(roundDiv(BigInt(afterAll[i] ?? 0) * d, f));
    });
  }

  const { totals: charges, perLine } = computeCharges(input, nets);

  if (input.pricing === "inclusive") {
    // Bill-level rounding can leave a few cents between Σ(prices) and net + charges; absorb them in net
    // so the guest pays exactly the menu prices.
    const target = afterAll.reduce((a, b) => a + b, 0);
    const computed = nets.reduce((a, b) => a + b, 0) + charges.reduce((a, c) => a + c.amount, 0);
    const residual = target - computed;
    if (residual !== 0) {
      let largest = 0;
      nets.forEach((n, i) => {
        if (n > (nets[largest] ?? 0)) largest = i;
      });
      nets = nets.map((n, i) => (i === largest ? n + residual : n));
    }
  }

  const lineTotals: LineTotals[] = lines.map((line, i) => {
    const lineCharges = perLine[i] ?? {};
    const net = nets[i] ?? 0;
    const g = gross[i] ?? 0;
    return {
      id: line.id,
      gross: g,
      discount: g - (afterAll[i] ?? 0),
      net,
      charges: lineCharges,
      total: net + Object.values(lineCharges).reduce((a, b) => a + b, 0),
    };
  });

  const itemsTotal = gross.reduce((a, b) => a + b, 0);
  const discountTotal = discounts.reduce((a, d) => a + d.amount, 0);
  const netSubtotal = nets.reduce((a, b) => a + b, 0);
  const vatTotal = charges.filter((c) => c.kind === "vat").reduce((a, c) => a + c.amount, 0);
  const total = netSubtotal + charges.reduce((a, c) => a + c.amount, 0);
  const amountDue = input.billRounding
    ? roundToUnit(total, input.billRounding.unit, input.billRounding.mode)
    : total;

  return {
    lines: lineTotals,
    itemsTotal,
    discounts,
    discountTotal,
    netSubtotal,
    charges,
    valueExclVat: total - vatTotal,
    vatTotal,
    total,
    roundingAdjustment: amountDue - total,
    amountDue,
  };
}
