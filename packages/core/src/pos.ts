import {
  type ChargeRule,
  type CheckInput,
  type CheckTotals,
  type Discount as EngineDiscount,
  businessDate as toBusinessDate,
  calculateCheck,
  formatInvoiceNumber,
  localPeriod,
  nextSequence,
  sriLankaChargeRules,
  SRI_LANKA_UTC_OFFSET_MINUTES,
} from "@pos/engine";
import { COLLECTIONS as C, type DocStore, type Increments, type WriteOp } from "./store.js";
import type {
  BusinessSettings,
  Check,
  CheckLine,
  Customer,
  DailyStats,
  Discount,
  Invoice,
  MenuCategory,
  PosSettings,
  TaxSettings,
  TenderMedia,
  WorkstationSequence,
} from "./types.js";
import { newId, nowIso, sha256Hex } from "./util.js";

/** Settings and reference data a terminal keeps in memory while selling. */
export interface PosContext {
  tax: TaxSettings;
  business: BusinessSettings;
  pos: PosSettings;
  discounts: ReadonlyMap<string, Discount>;
  tenders: ReadonlyMap<string, TenderMedia>;
  categories: ReadonlyMap<string, MenuCategory>;
  /** Module switches that change what closing a check does. */
  inventoryOn: boolean;
  crmOn: boolean;
  loyaltyOn: boolean;
}

export function chargeRulesFor(tax: TaxSettings, business: BusinessSettings): ChargeRule[] {
  return sriLankaChargeRules({
    vatRegistered: business.vatRegistered,
    ssclLiable: business.ssclLiable,
    serviceChargeRate: tax.serviceChargeRate,
    ...(tax.serviceChargeOrderTypes.length ? { serviceChargeOrderTypes: tax.serviceChargeOrderTypes } : {}),
    tdlRate: tax.tdlRate,
    vatRate: tax.vatRate,
    ssclRate: tax.ssclRate,
    vatTaxClasses: ["standard"],
  });
}

function toEngineDiscount(d: Discount): EngineDiscount {
  return { id: d.id, name: d.name, type: d.type, value: d.value };
}

export function activeLines(check: Pick<Check, "lines">): CheckLine[] {
  return check.lines.filter((l) => !l.voided);
}

export function checkInput(check: Check, ctx: Pick<PosContext, "tax" | "business" | "discounts">): CheckInput {
  const lookup = (id: string) => {
    const d = ctx.discounts.get(id);
    if (!d) throw new Error(`unknown discount ${id}`);
    return toEngineDiscount(d);
  };
  return {
    orderType: check.orderTypeId,
    pricing: ctx.tax.pricing,
    rules: chargeRulesFor(ctx.tax, ctx.business),
    lines: activeLines(check).map((l) => ({
      id: l.id,
      name: l.name,
      quantity: l.qty,
      unitPrice: l.unitPrice,
      modifiers: l.modifiers.map((m) => ({ name: m.name, price: m.price })),
      taxClass: l.taxClass,
      discounts: l.discountIds.map(lookup),
    })),
    subtotalDiscounts: check.checkDiscountIds.map(lookup),
    ...(ctx.tax.billRoundingUnit > 1 ? { billRounding: { unit: ctx.tax.billRoundingUnit, mode: "nearest" as const } } : {}),
  };
}

export function computeCheckTotals(check: Check, ctx: Pick<PosContext, "tax" | "business" | "discounts">): CheckTotals {
  return calculateCheck(checkInput(check, ctx));
}

export function paidAmount(check: Pick<Check, "payments">): number {
  return check.payments.reduce((a, p) => a + p.applied, 0);
}

export function businessDateNow(pos: Pick<PosSettings, "businessDayRolloverHour">, at = new Date()): string {
  return toBusinessDate(at, { rolloverHour: pos.businessDayRolloverHour });
}

/** Next check number for the workstation's business date (resets daily). */
export async function allocateCheckNo(store: DocStore, workstationId: string, businessDate: string): Promise<number> {
  const seq = await store.get<WorkstationSequence>(C.sequences, workstationId);
  const checkSeq = seq && seq.checkDate === businessDate ? seq.checkSeq + 1 : 1;
  await store.merge(C.sequences, workstationId, { id: workstationId, checkDate: businessDate, checkSeq });
  return checkSeq;
}

export function newCheck(args: {
  propertyId: string;
  rvcId: string;
  workstationId: string;
  checkNo: number;
  orderTypeId: string;
  staffId: string;
  businessDate: string;
  covers?: number;
  tableId?: string;
}): Check {
  return {
    id: newId(),
    propertyId: args.propertyId,
    rvcId: args.rvcId,
    workstationId: args.workstationId,
    checkNo: args.checkNo,
    orderTypeId: args.orderTypeId,
    ...(args.tableId ? { tableId: args.tableId } : {}),
    covers: args.covers ?? 1,
    staffId: args.staffId,
    status: "open",
    lines: [],
    checkDiscountIds: [],
    payments: [],
    sentRounds: 0,
    businessDate: args.businessDate,
    openedAt: nowIso(),
    channel: "pos",
  };
}

/** Marks unsent lines as sent in a new kitchen round; returns the lines to print on the KOT. */
export function sendRound(check: Check): { check: Check; sent: CheckLine[] } {
  const unsent = activeLines(check).filter((l) => l.sentRound === undefined);
  if (unsent.length === 0) return { check, sent: [] };
  const round = check.sentRounds + 1;
  const ids = new Set(unsent.map((l) => l.id));
  return {
    check: { ...check, sentRounds: round, lines: check.lines.map((l) => (ids.has(l.id) ? { ...l, sentRound: round } : l)) },
    sent: unsent.map((l) => ({ ...l, sentRound: round })),
  };
}

export class CheckCloseError extends Error {}

export interface CloseResult {
  check: Check;
  invoice: Invoice;
}

/**
 * Closes a fully paid check: issues the IRD invoice number (per-workstation sequence, so a terminal
 * never needs the server to number a bill), writes the immutable hash-chained invoice record, updates
 * the day's aggregates and customer history, and queues inventory depletion.
 */
export async function closeCheck(store: DocStore, check: Check, ctx: PosContext, opts: { workstationCode: string; now?: Date }): Promise<CloseResult> {
  if (check.status !== "open") throw new CheckCloseError("check is not open");
  if (activeLines(check).length === 0) throw new CheckCloseError("check has no items");
  const totals = computeCheckTotals(check, ctx);
  const paid = paidAmount(check);
  if (paid < totals.amountDue) throw new CheckCloseError(`balance due ${totals.amountDue - paid}`);

  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const period = localPeriod(now);
  const seq = await store.get<WorkstationSequence>(C.sequences, check.workstationId);
  const sequence = nextSequence(seq && seq.invoiceSeq ? { year: seq.year, month: seq.month, sequence: seq.invoiceSeq } : null, period, ctx.tax.invoiceSequenceReset);
  const invoiceNo = formatInvoiceNumber({ ...period, classificationCode: opts.workstationCode, sequence });

  const prevHash = seq?.lastInvoiceHash ?? "";
  const base: Omit<Invoice, "hash"> = {
    id: invoiceNo,
    checkId: check.id,
    workstationId: check.workstationId,
    issuedAt: at,
    supplyDate: check.businessDate,
    businessDate: check.businessDate,
    vatRegistered: ctx.business.vatRegistered,
    seller: { legalName: ctx.business.legalName, tin: ctx.business.tin, addressLines: ctx.business.addressLines },
    ...(check.buyer ? { buyer: check.buyer } : {}),
    totals,
    prevHash,
  };
  const hash = await sha256Hex(prevHash + JSON.stringify(base));
  const invoice: Invoice = { ...base, hash };

  const closed: Check = {
    ...check,
    status: "closed",
    totals,
    change: check.payments.reduce((a, p) => a + (p.tendered - p.applied), 0),
    closedAt: at,
    invoiceNo,
    depletion: ctx.inventoryOn ? "pending" : "skipped",
  };

  const ops: WriteOp[] = [
    { op: "set", col: C.checks, data: closed },
    { op: "set", col: C.invoices, data: invoice },
    {
      op: "merge",
      col: C.sequences,
      id: check.workstationId,
      data: { id: check.workstationId, year: period.year, month: period.month, invoiceSeq: sequence, lastInvoiceHash: hash },
    },
    statsIncrement(closed, ctx, now),
  ];
  if (ctx.crmOn && check.customerId) {
    const points = ctx.loyaltyOn ? Math.floor(totals.amountDue / 10_000) * ctx.pos.loyaltyPointsPer100 : 0;
    ops.push({
      op: "increment",
      col: C.customers,
      id: check.customerId,
      inc: { visits: 1, totalSpend: totals.amountDue, points },
    });
    ops.push({ op: "merge", col: C.customers, id: check.customerId, data: { lastVisit: at } });
  }
  await store.batch(ops);
  return { check: closed, invoice };
}

export function statsId(propertyId: string, businessDate: string): string {
  return `${propertyId}__${businessDate}`;
}

function localHour(at: Date): string {
  const h = new Date(at.getTime() + SRI_LANKA_UTC_OFFSET_MINUTES * 60_000).getUTCHours();
  return String(h).padStart(2, "0");
}

/** The increments a closed check adds to `dailyStats` (one write per check, never a hot shared counter per line). */
export function statsIncrement(check: Check, ctx: Pick<PosContext, "categories">, at: Date): WriteOp {
  const totals = check.totals;
  if (!totals) throw new Error("check has no totals");
  const charge = (id: string) => totals.charges.find((c) => c.ruleId === id)?.amount ?? 0;
  const inc: Increments = {
    checks: 1,
    covers: check.covers,
    itemsTotal: totals.itemsTotal,
    discounts: totals.discountTotal,
    netSales: totals.netSubtotal,
    serviceCharge: charge("sc"),
    sscl: charge("sscl"),
    tdl: charge("tdl"),
    vat: totals.vatTotal,
    total: totals.amountDue,
    rounding: totals.roundingAdjustment,
  };
  const items: Increments = {};
  const categories: Increments = {};
  const majorGroups: Increments = {};
  const lines = new Map(check.lines.map((l) => [l.id, l]));
  for (const lt of totals.lines) {
    const line = lines.get(lt.id);
    if (!line) continue;
    const add = (bucket: Increments, key: string, withGross = false) => {
      const cur = (bucket[key] ?? { qty: 0, amount: 0 }) as { qty: number; amount: number; gross?: number };
      bucket[key] = { qty: cur.qty + line.qty, amount: cur.amount + lt.net, ...(withGross ? { gross: (cur.gross ?? 0) + lt.gross } : {}) };
    };
    add(items, line.menuItemId);
    add(categories, line.categoryId);
    add(majorGroups, ctx.categories.get(line.categoryId)?.majorGroup ?? "Other", true);
  }
  const tenders: Increments = {};
  for (const p of check.payments) {
    const cur = (tenders[p.tenderId] ?? { qty: 0, amount: 0 }) as { qty: number; amount: number };
    tenders[p.tenderId] = { qty: cur.qty + 1, amount: cur.amount + p.applied };
  }
  const voided = check.lines.filter((l) => l.voided);
  Object.assign(inc, {
    items,
    categories,
    majorGroups,
    tenders,
    orderTypes: { [check.orderTypeId]: { qty: 1, amount: totals.netSubtotal, covers: check.covers } },
    hours: { [localHour(at)]: { qty: 1, amount: totals.netSubtotal } },
    voids: { qty: voided.reduce((a, l) => a + l.qty, 0), amount: voided.reduce((a, l) => a + l.qty * l.unitPrice, 0) },
  });
  return {
    op: "increment",
    col: C.dailyStats,
    id: statsId(check.propertyId, check.businessDate),
    inc,
    base: { propertyId: check.propertyId, businessDate: check.businessDate },
  };
}

/** Builds the payment record for a tender; `applied` is capped at the balance (change is given on cash). */
export function makePayment(args: { tender: TenderMedia; amount: number; balance: number; reference?: string; by: string; exchangeRateMicros?: number }): { payment: Check["payments"][number]; change: number } {
  const { tender, amount, balance } = args;
  if (!(amount > 0)) throw new Error("amount must be positive");
  const rate = args.exchangeRateMicros ?? tender.exchangeRateMicros;
  const lkr = tender.type === "foreignCash" ? Math.round((amount * (rate ?? 0)) / 1_000_000) : amount;
  if (tender.type === "foreignCash" && !rate) throw new Error(`${tender.name} has no exchange rate`);
  if (lkr > balance && !tender.allowChange) throw new Error(`${tender.name} cannot exceed the balance`);
  if (tender.requiresReference && !args.reference) throw new Error(`${tender.name} needs a reference`);
  const applied = Math.min(lkr, balance);
  return {
    payment: {
      id: newId(),
      tenderId: tender.id,
      amount,
      applied,
      tendered: lkr,
      ...(args.reference ? { reference: args.reference } : {}),
      at: nowIso(),
      by: args.by,
    },
    change: lkr - applied,
  };
}

export function emptyDailyStats(propertyId: string, businessDate: string): DailyStats {
  return {
    id: statsId(propertyId, businessDate),
    propertyId,
    businessDate,
    checks: 0,
    covers: 0,
    itemsTotal: 0,
    discounts: 0,
    netSales: 0,
    serviceCharge: 0,
    sscl: 0,
    tdl: 0,
    vat: 0,
    total: 0,
    rounding: 0,
    items: {},
    categories: {},
    majorGroups: {},
    orderTypes: {},
    hours: {},
    tenders: {},
    voids: { qty: 0, amount: 0 },
  };
}

export type { Customer };
