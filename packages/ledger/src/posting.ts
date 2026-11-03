import {
  type Account,
  type AccountingSettings,
  type DailyStats,
  type GoodsReceipt,
  type InventoryItem,
  type PurchaseOrder,
  type StockMovement,
  type TenderMedia,
  COLLECTIONS as C,
  buildDailyJournal,
  canonicalJson,
  receiptValue,
  sha256Hex,
} from "@pos/core";
import type { Cents } from "@pos/engine";
import { addMonths, depreciationFor } from "./assets.js";
import { buildFiscalYear, fiscalYearId } from "./setup.js";
import type { Tx, TxRunner } from "./tx.js";
import {
  type AccountBalance,
  type Actor,
  type Asset,
  type AssetDisposalVoucher,
  type CostCenter,
  type DepreciationVoucher,
  type FiscalYear,
  type JournalVoucher,
  type LedgerEntry,
  type LedgerHead,
  type LedgerSettings,
  type LineInput,
  type MatchResult,
  type PaymentVoucher,
  type PeriodCloseVoucher,
  type PosDayVoucher,
  type PurchaseInvoice,
  type ReversalVoucher,
  type SalesInvoice,
  type Voucher,
  type VoucherType,
  LEDGER as L,
} from "./types.js";

export class LedgerError extends Error {}
/** Raised when segregation of duties forbids an action (e.g. approving your own journal). */
export class SoDError extends LedgerError {}

const PREFIX: Record<VoucherType, string> = {
  journal: "JV",
  purchaseInvoice: "PINV",
  salesInvoice: "SINV",
  payment: "PAY",
  posDay: "POS",
  depreciation: "DEP",
  assetDisposal: "ADS",
  periodClose: "PCV",
  reversal: "REV",
};

const BASE_RATE = 1_000_000;

/** A posting line fully converted to base currency. */
export interface PreparedLine {
  account: string;
  debit: Cents;
  credit: Cents;
  debitFc: Cents;
  creditFc: Cents;
  currency: string;
  rateMicros: number;
  costCenter: string;
  partyType?: LineInput["partyType"];
  partyId?: string;
  againstVoucherId?: string;
  memo?: string;
}

interface Ctx {
  settings: LedgerSettings;
  accounts: Map<string, Account>;
  fiscalYears: FiscalYear[];
  costCenters: Map<string, CostCenter>;
  head: LedgerHead | null;
}

interface Built {
  lines: PreparedLine[];
  /** Extra writes that must happen with the posting (open items, assets…). */
  extra: (tx: Tx) => void;
  patch?: Partial<Voucher>;
  requiresApproval: boolean;
}

// ───────────────────────────── helpers ─────────────────────────────

function toBase(amount: Cents, rateMicros: number): Cents {
  return Math.round((amount * rateMicros) / BASE_RATE);
}

function prepare(v: Pick<Voucher, "currency" | "exchangeRateMicros" | "costCenter">, l: LineInput, ctx: Ctx, rate = v.exchangeRateMicros): PreparedLine {
  if (l.debit < 0 || l.credit < 0) throw new LedgerError(`negative amount on account ${l.account}`);
  if (l.debit && l.credit) throw new LedgerError(`line on ${l.account} has both a debit and a credit`);
  return {
    account: l.account,
    debit: toBase(l.debit, rate),
    credit: toBase(l.credit, rate),
    debitFc: l.debit,
    creditFc: l.credit,
    currency: v.currency,
    rateMicros: rate,
    costCenter: l.costCenter || v.costCenter || ctx.settings.defaultCostCenter,
    ...(l.partyType ? { partyType: l.partyType } : {}),
    ...(l.partyId ? { partyId: l.partyId } : {}),
    ...(l.againstVoucherId ? { againstVoucherId: l.againstVoucherId } : {}),
    ...(l.memo ? { memo: l.memo } : {}),
  };
}

/** Line in base currency only (exchange differences, rounding, valuations). */
function baseLine(account: string, amount: Cents, ctx: Ctx, costCenter: string | undefined, memo: string): PreparedLine | null {
  if (amount === 0) return null;
  return {
    account,
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? -amount : 0,
    debitFc: 0,
    creditFc: 0,
    currency: ctx.settings.baseCurrency,
    rateMicros: BASE_RATE,
    costCenter: costCenter || ctx.settings.defaultCostCenter,
    memo,
  };
}

function sumBase(lines: PreparedLine[]): { debit: Cents; credit: Cents } {
  return { debit: lines.reduce((a, l) => a + l.debit, 0), credit: lines.reduce((a, l) => a + l.credit, 0) };
}

/** Absorbs currency-conversion rounding (at most 1 cent per line) into the round-off account. */
function balanceRounding(lines: PreparedLine[], ctx: Ctx, costCenter?: string): PreparedLine[] {
  // Only conversions create rounding; a base-currency imbalance is an error, never absorbed.
  if (lines.every((l) => l.rateMicros === BASE_RATE)) return lines;
  const t = sumBase(lines);
  const diff = t.credit - t.debit;
  if (diff === 0) return lines;
  if (Math.abs(diff) > lines.length) return lines; // a real imbalance: validation will reject it
  const l = baseLine(ctx.settings.accounts.roundOff, diff, ctx, costCenter, "Currency rounding");
  return l ? [...lines, l] : lines;
}

export function periodOf(date: string): string {
  return date.slice(0, 7);
}

function findPeriod(ctx: Ctx, date: string): { fy: FiscalYear; period: FiscalYear["periods"][number] } {
  const pid = periodOf(date);
  for (const fy of ctx.fiscalYears) {
    const period = fy.periods.find((p) => p.id === pid);
    if (period && date >= fy.start && date <= fy.end) return { fy, period };
  }
  throw new LedgerError(`no fiscal year covers ${date}; create it under Accounting → Periods`);
}

function validate(lines: PreparedLine[], ctx: Ctx): void {
  if (lines.length < 2) throw new LedgerError("a posting needs at least two lines");
  for (const l of lines) {
    const acc = ctx.accounts.get(l.account);
    if (!acc) throw new LedgerError(`account ${l.account} does not exist`);
    if (acc.isGroup) throw new LedgerError(`${acc.code} ${acc.name} is a group account; post to one of its ledgers`);
    if (acc.frozen) throw new LedgerError(`${acc.code} ${acc.name} is frozen`);
    if ((acc.accountType === "Receivable" || acc.accountType === "Payable") && !l.partyId) {
      throw new LedgerError(`${acc.code} ${acc.name} needs a customer or supplier on the line`);
    }
    if (!ctx.costCenters.has(l.costCenter)) throw new LedgerError(`cost centre ${l.costCenter} does not exist`);
    if (ctx.costCenters.get(l.costCenter)?.isGroup) throw new LedgerError(`cost centre ${l.costCenter} is a group`);
  }
  const t = sumBase(lines);
  if (t.debit !== t.credit) throw new LedgerError(`debits (${t.debit}) and credits (${t.credit}) do not balance`);
  if (t.debit === 0) throw new LedgerError("the posting has no value");
}

async function loadCtx(tx: Tx): Promise<Ctx> {
  const [accounting, accounts, fiscalYears, costCenters, head] = await Promise.all([
    tx.get<AccountingSettings & { ledger?: LedgerSettings }>(C.settings, "accounting"),
    tx.query<Account>(C.accounts),
    tx.query<FiscalYear>(L.fiscalYears),
    tx.query<CostCenter>(L.costCenters),
    tx.get<LedgerHead>(L.ledgerHead, "head"),
  ]);
  if (!accounting?.ledger) throw new LedgerError("accounting is not set up (Accounting → Settings)");
  return {
    settings: accounting.ledger,
    accounts: new Map(accounts.map((a) => [a.id, a])),
    fiscalYears,
    costCenters: new Map(costCenters.map((c) => [c.id, c])),
    head,
  };
}

// ───────────────────────────── builders (pure, from source data) ─────────────────────────────

export function journalLines(v: JournalVoucher, ctx: Ctx): Built {
  const lines = balanceRounding(v.lines.map((l) => prepare(v, l, ctx)), ctx, v.costCenter);
  const total = sumBase(lines).debit;
  return { lines, extra: () => {}, requiresApproval: total >= ctx.settings.journalApprovalThreshold };
}

export function threeWayMatch(pi: PurchaseInvoice, grns: GoodsReceipt[], po: PurchaseOrder | null, invoicedBefore: Map<string, number>, tolerance: LedgerSettings["matchTolerance"]): MatchResult {
  const stock = pi.items.filter((i) => i.inventoryItemId);
  if (!stock.length) return { status: "notApplicable", issues: [] };
  const issues: string[] = [];
  let exception = false;
  let within = false;
  for (const item of stock) {
    const id = item.inventoryItemId!;
    const received = grns.flatMap((g) => g.lines).filter((l) => l.inventoryItemId === id);
    const recvQty = received.reduce((a, l) => a + l.qty, 0);
    const already = invoicedBefore.get(id) ?? 0;
    const open = recvQty - already;
    if (recvQty === 0) {
      issues.push(`${item.description}: not on the linked goods receipts`);
      exception = true;
      continue;
    }
    if (item.qty > open) {
      const overBp = open > 0 ? Math.round(((item.qty - open) / open) * 10_000) : 10_000;
      issues.push(`${item.description}: invoiced ${item.qty}, received but not yet invoiced ${open}`);
      if (overBp > tolerance.qtyBp) exception = true;
      else within = true;
    }
    const ordered = po?.lines.find((l) => l.inventoryItemId === id);
    const refPrice = ordered?.unitCost ?? (received[0]?.unitCost ?? 0);
    const rateBase = toBase(item.rate, pi.exchangeRateMicros);
    if (refPrice > 0) {
      const diffBp = Math.round((Math.abs(rateBase - refPrice) / refPrice) * 10_000);
      if (diffBp > 0) {
        issues.push(`${item.description}: price ${(rateBase / 100).toFixed(2)} vs ${po ? "PO" : "GRN"} ${(refPrice / 100).toFixed(2)}`);
        if (diffBp > tolerance.priceBp) exception = true;
        else within = true;
      }
    }
  }
  return { status: exception ? "exception" : within || issues.length ? "withinTolerance" : "matched", issues };
}

export function purchaseInvoiceLines(pi: PurchaseInvoice, ctx: Ctx, data: { grns: GoodsReceipt[]; po: PurchaseOrder | null; items: Map<string, InventoryItem>; invoicedBefore: Map<string, number> }): Built {
  const a = ctx.settings.accounts;
  const cc = pi.costCenter;
  const lines: PreparedLine[] = [];
  let total = 0;
  for (const item of pi.items) {
    if (!(item.qty > 0)) throw new LedgerError(`quantity for ${item.description} must be positive`);
    const amountFc = Math.round(item.qty * item.rate);
    total += amountFc;
    if (item.inventoryItemId) {
      const recv = data.grns.flatMap((g) => g.lines).filter((l) => l.inventoryItemId === item.inventoryItemId);
      if (!recv.length) throw new LedgerError(`${item.description} is a stock item: link the goods receipt it was received on`);
      const recvQty = recv.reduce((x, l) => x + l.qty, 0);
      const unitCost = recv.reduce((x, l) => x + l.qty * l.unitCost, 0) / recvQty;
      const srbnb = Math.round(item.qty * unitCost);
      const invoicedBase = toBase(amountFc, pi.exchangeRateMicros);
      const l1 = baseLine(a.stockReceivedNotBilled, srbnb, ctx, item.costCenter ?? cc, `Clear received not billed: ${item.description}`);
      const l2 = baseLine(a.priceVariance, invoicedBase - srbnb, ctx, item.costCenter ?? cc, `Price variance: ${item.description}`);
      if (l1) lines.push(l1);
      if (l2) lines.push(l2);
    } else {
      if (!item.account) throw new LedgerError(`choose an expense or asset account for ${item.description}`);
      lines.push(prepare(pi, { account: item.account, debit: amountFc, credit: 0, ...(item.costCenter ? { costCenter: item.costCenter } : {}), memo: item.description }, ctx));
    }
  }
  if (pi.vatAmount) lines.push(prepare(pi, { account: a.vatInput, debit: pi.vatAmount, credit: 0, memo: "Input VAT" }, ctx));
  if (pi.whtAmount) lines.push(prepare(pi, { account: a.whtPayable, debit: 0, credit: pi.whtAmount, memo: "Withholding tax" }, ctx));
  const payable = total + pi.vatAmount - pi.whtAmount;
  lines.push(prepare(pi, { account: a.payable, debit: 0, credit: payable, partyType: "supplier", partyId: pi.supplierId, memo: `Supplier invoice ${pi.supplierInvoiceNo}` }, ctx));
  const match = threeWayMatch(pi, data.grns, data.po, data.invoicedBefore, ctx.settings.matchTolerance);
  return {
    lines: balanceRounding(lines, ctx, cc),
    extra: () => {},
    patch: { outstanding: payable, match } as Partial<PurchaseInvoice>,
    requiresApproval: match.status === "exception",
  };
}

export function salesInvoiceLines(si: SalesInvoice, ctx: Ctx): Built {
  const lines: PreparedLine[] = [];
  let subtotal = 0;
  for (const item of si.items) {
    const amount = Math.round(item.qty * item.rate);
    subtotal += amount;
    lines.push(prepare(si, { account: item.account, debit: 0, credit: amount, ...(item.costCenter ? { costCenter: item.costCenter } : {}), memo: item.description }, ctx));
  }
  const vat = Math.round((subtotal * si.vatRateBp) / 10_000);
  if (vat) lines.push(prepare(si, { account: ctx.settings.accounts.vatOutput, debit: 0, credit: vat, memo: "Output VAT" }, ctx));
  lines.push(prepare(si, { account: ctx.settings.accounts.receivable, debit: subtotal + vat, credit: 0, partyType: "customer", partyId: si.customerId, memo: "Customer invoice" }, ctx));
  return { lines: balanceRounding(lines, ctx, si.costCenter), extra: () => {}, patch: { outstanding: subtotal + vat } as Partial<SalesInvoice>, requiresApproval: false };
}

export function paymentLines(p: PaymentVoucher, ctx: Ctx, invoices: Map<string, PurchaseInvoice | SalesInvoice>): Built {
  const a = ctx.settings.accounts;
  const pay = p.direction === "pay";
  const partyAccount = pay ? a.payable : a.receivable;
  if (!(p.amount > 0)) throw new LedgerError("payment amount must be positive");
  const bank = ctx.accounts.get(p.bankAccount);
  if (!bank || (bank.accountType !== "Bank" && bank.accountType !== "Cash")) throw new LedgerError("choose a bank or cash account");
  const allocated = p.allocations.reduce((x, al) => x + al.amount, 0);
  if (allocated > p.amount) throw new LedgerError("allocations exceed the payment amount");
  const lines: PreparedLine[] = [];
  const updates: { id: string; outstanding: number }[] = [];
  for (const al of p.allocations) {
    if (!(al.amount > 0)) throw new LedgerError("allocation amounts must be positive");
    const inv = invoices.get(al.voucherId);
    if (!inv || inv.status !== "posted") throw new LedgerError(`invoice ${al.voucherId} is not a posted invoice`);
    const invParty = inv.type === "purchaseInvoice" ? inv.supplierId : inv.customerId;
    if ((pay && inv.type !== "purchaseInvoice") || (!pay && inv.type !== "salesInvoice") || invParty !== p.partyId) {
      throw new LedgerError(`invoice ${inv.number ?? inv.id} does not belong to this ${pay ? "supplier" : "customer"}`);
    }
    if (inv.currency !== p.currency) throw new LedgerError(`invoice ${inv.number} is in ${inv.currency}; pay it in the same currency`);
    if (al.amount > (inv.outstanding ?? 0)) throw new LedgerError(`allocation to ${inv.number} exceeds its outstanding amount`);
    // Clear the open item at the invoice's rate; the bank side uses today's rate (difference = FX).
    lines.push(prepare(p, { account: partyAccount, debit: pay ? al.amount : 0, credit: pay ? 0 : al.amount, partyType: p.partyType, partyId: p.partyId, againstVoucherId: inv.id, memo: `Settle ${inv.number}` }, ctx, inv.exchangeRateMicros));
    updates.push({ id: inv.id, outstanding: (inv.outstanding ?? 0) - al.amount });
  }
  const advance = p.amount - allocated;
  if (advance) lines.push(prepare(p, { account: partyAccount, debit: pay ? advance : 0, credit: pay ? 0 : advance, partyType: p.partyType, partyId: p.partyId, memo: "Unallocated (advance)" }, ctx));
  lines.push(prepare(p, { account: p.bankAccount, debit: pay ? 0 : p.amount, credit: pay ? p.amount : 0, memo: p.reference ?? (pay ? "Payment" : "Receipt") }, ctx));
  if (p.bankCharges) {
    lines.push(baseLine(a.bankCharges, p.bankCharges, ctx, p.costCenter, "Bank charges")!);
    lines.push(baseLine(p.bankAccount, -p.bankCharges, ctx, p.costCenter, "Bank charges")!);
  }
  const t = sumBase(lines);
  const fx = baseLine(a.fxGainLoss, t.credit - t.debit, ctx, p.costCenter, "Realised exchange difference");
  const all = fx && Math.abs(t.credit - t.debit) > lines.length && p.currency !== ctx.settings.baseCurrency ? [...lines, fx] : balanceRounding(lines, ctx, p.costCenter);
  return {
    lines: all,
    extra: (tx) => updates.forEach((u) => tx.merge(L.vouchers, u.id, { outstanding: u.outstanding })),
    requiresApproval: toBase(p.amount, p.exchangeRateMicros) >= ctx.settings.paymentApprovalThreshold,
  };
}

export function depreciationLines(v: DepreciationVoucher, ctx: Ctx, assets: Map<string, Asset>): Built {
  const lines: PreparedLine[] = [];
  for (const it of v.items) {
    const asset = assets.get(it.assetId);
    if (!asset) throw new LedgerError(`asset ${it.assetId} not found`);
    const cc = asset.costCenter ?? asset.propertyId;
    lines.push(baseLine(asset.depExpenseAccount, it.amount, ctx, cc, `Depreciation ${asset.code} ${v.depreciationPeriod}`)!);
    lines.push(baseLine(asset.accumulatedDepAccount, -it.amount, ctx, cc, `Depreciation ${asset.code} ${v.depreciationPeriod}`)!);
  }
  return {
    lines,
    extra: (tx) => {
      for (const it of v.items) {
        const asset = assets.get(it.assetId)!;
        const acc = asset.accumulatedDep + it.amount;
        tx.merge(L.assets, asset.id, { accumulatedDep: acc, lastDepPeriod: v.depreciationPeriod, status: acc >= asset.cost - asset.salvageValue ? "fullyDepreciated" : "active" });
      }
    },
    requiresApproval: false,
  };
}

export function disposalLines(v: AssetDisposalVoucher, ctx: Ctx, asset: Asset): Built {
  if (asset.status === "disposed") throw new LedgerError(`${asset.code} is already disposed`);
  const cc = asset.costCenter ?? asset.propertyId;
  const nbv = asset.cost - asset.accumulatedDep;
  const gain = v.proceeds - nbv;
  const lines = [
    baseLine(asset.accumulatedDepAccount, asset.accumulatedDep, ctx, cc, `Disposal ${asset.code}: accumulated depreciation`),
    baseLine(v.proceedsAccount, v.proceeds, ctx, cc, `Disposal ${asset.code}: proceeds`),
    baseLine(asset.assetAccount, -asset.cost, ctx, cc, `Disposal ${asset.code}: cost`),
    baseLine(ctx.settings.accounts.disposalGainLoss, -gain, ctx, cc, gain >= 0 ? "Gain on disposal" : "Loss on disposal"),
  ].filter((l): l is PreparedLine => Boolean(l));
  return { lines, extra: (tx) => tx.merge(L.assets, asset.id, { status: "disposed", disposalDate: v.postingDate }), requiresApproval: false };
}

export function periodCloseLines(v: PeriodCloseVoucher, ctx: Ctx, balances: AccountBalance[]): Built {
  const net = new Map<string, Cents>();
  for (const b of balances) {
    const acc = ctx.accounts.get(b.account);
    if (!acc || (acc.type !== "income" && acc.type !== "expense")) continue;
    const key = `${b.account}__${b.costCenter}`;
    net.set(key, (net.get(key) ?? 0) + b.debit - b.credit);
  }
  const lines: PreparedLine[] = [];
  let profit = 0;
  for (const [key, amount] of net) {
    if (!amount) continue;
    const [account, cc] = key.split("__") as [string, string];
    lines.push(baseLine(account, -amount, ctx, cc, `Close ${v.closingFiscalYear}`)!);
    profit -= amount;
  }
  const re = baseLine(ctx.settings.accounts.retainedEarnings, -profit, ctx, ctx.settings.defaultCostCenter, `Profit for ${v.closingFiscalYear}`);
  if (re) lines.push(re);
  return { lines, extra: () => {}, requiresApproval: false };
}

/** First unused id of the form base, base-2, base-3… (cancelled vouchers are never overwritten). */
async function uniqueVoucherId(tx: Tx, base: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!(await tx.get(L.vouchers, id))) return id;
  }
  throw new LedgerError(`too many vouchers named ${base}`);
}

// ───────────────────────────── commit ─────────────────────────────

async function commit(tx: Tx, voucher: Voucher, built: Built, ctx: Ctx, actor: Actor, now: string, extraFields: Partial<Voucher> = {}): Promise<Voucher> {
  validate(built.lines, ctx);
  const { fy, period } = findPeriod(ctx, voucher.postingDate);
  if (voucher.type === "periodClose") {
    if (fy.status === "closed") throw new LedgerError(`fiscal year ${fy.id} is already closed`);
  } else if (period.status !== "open" || fy.status !== "open") {
    throw new LedgerError(`period ${period.id} is closed; post in an open period or ask an administrator to reopen it`);
  }
  const seriesId = `${PREFIX[voucher.type]}-${fy.id}`;
  const series = await tx.get<{ id: string; next: number }>(L.numberSeries, seriesId);
  const seq = series?.next ?? 1;
  const number = `${PREFIX[voucher.type]}-${fy.id.replace("-", "")}-${String(seq).padStart(5, "0")}`;
  const totalBase = sumBase(built.lines).debit;
  const prevHash = ctx.head?.lastHash ?? "";
  const hash = await sha256Hex(prevHash + canonicalJson({ number, type: voucher.type, postingDate: voucher.postingDate, lines: built.lines, totalBase }));

  built.lines.forEach((l, i) => {
    const entry: LedgerEntry = {
      id: `${voucher.id}-${String(i + 1).padStart(3, "0")}`,
      voucherId: voucher.id,
      voucherType: voucher.type,
      voucherNo: number,
      postingDate: voucher.postingDate,
      fiscalYear: fy.id,
      period: period.id,
      account: l.account,
      debit: l.debit,
      credit: l.credit,
      currency: l.currency,
      debitFc: l.debitFc,
      creditFc: l.creditFc,
      exchangeRateMicros: l.rateMicros,
      costCenter: l.costCenter,
      ...(voucher.propertyId ? { propertyId: voucher.propertyId } : {}),
      ...(l.partyType ? { partyType: l.partyType } : {}),
      ...(l.partyId ? { partyId: l.partyId } : {}),
      ...(l.againstVoucherId ? { againstVoucherId: l.againstVoucherId } : {}),
      ...(l.memo ? { memo: l.memo } : {}),
      isReversal: voucher.type === "reversal",
      createdAt: now,
      createdBy: actor.uid,
      lineNo: i + 1,
    };
    tx.set(L.ledger, entry);
    tx.increment(L.balances, `${period.id}__${l.account}__${l.costCenter}`, { debit: l.debit, credit: l.credit }, { period: period.id, fiscalYear: fy.id, account: l.account, costCenter: l.costCenter });
  });
  tx.merge(L.numberSeries, seriesId, { id: seriesId, next: seq + 1 });
  tx.set(L.ledgerHead, { id: "head", lastHash: hash, count: (ctx.head?.count ?? 0) + 1, lastVoucherId: voucher.id } satisfies LedgerHead);
  built.extra(tx);
  const posted = {
    ...voucher,
    ...(built.patch ?? {}),
    ...extraFields,
    status: "posted",
    number,
    fiscalYear: fy.id,
    period: period.id,
    totalBase,
    lines: built.lines.map((l) => ({
      account: l.account,
      debit: l.debitFc || (l.rateMicros === BASE_RATE ? l.debit : 0),
      credit: l.creditFc || (l.rateMicros === BASE_RATE ? l.credit : 0),
      costCenter: l.costCenter,
      ...(l.partyType ? { partyType: l.partyType } : {}),
      ...(l.partyId ? { partyId: l.partyId } : {}),
      ...(l.againstVoucherId ? { againstVoucherId: l.againstVoucherId } : {}),
      ...(l.memo ? { memo: l.memo } : {}),
    })),
    postedBy: actor.uid,
    postedAt: now,
    prevHash,
    hash,
  } as Voucher;
  tx.set(L.vouchers, posted);
  return posted;
}

async function build(tx: Tx, v: Voucher, ctx: Ctx): Promise<Built> {
  switch (v.type) {
    case "journal":
      return journalLines(v, ctx);
    case "salesInvoice":
      return salesInvoiceLines(v, ctx);
    case "purchaseInvoice": {
      const [grns, po, items, others] = await Promise.all([
        Promise.all(v.grnIds.map((id) => tx.get<GoodsReceipt>(C.goodsReceipts, id))),
        v.purchaseOrderId ? tx.get<PurchaseOrder>(C.purchaseOrders, v.purchaseOrderId) : Promise.resolve(null),
        tx.query<InventoryItem>(C.inventoryItems),
        Promise.all(v.grnIds.map((id) => tx.query<PurchaseInvoice>(L.vouchers, { where: [["grnIds", "array-contains", id]] }))),
      ]);
      const missing = v.grnIds.filter((_, i) => !grns[i] || grns[i]!.status !== "posted");
      if (missing.length) throw new LedgerError(`goods receipt ${missing.join(", ")} is not posted`);
      const invoicedBefore = new Map<string, number>();
      const seen = new Set<string>();
      for (const inv of others.flat()) {
        if (inv.id === v.id || inv.status !== "posted" || seen.has(inv.id)) continue;
        seen.add(inv.id);
        for (const it of inv.items) if (it.inventoryItemId) invoicedBefore.set(it.inventoryItemId, (invoicedBefore.get(it.inventoryItemId) ?? 0) + it.qty);
      }
      return purchaseInvoiceLines(v, ctx, { grns: grns as GoodsReceipt[], po, items: new Map(items.map((i) => [i.id, i])), invoicedBefore });
    }
    case "payment": {
      const invs = await Promise.all(v.allocations.map((a) => tx.get<PurchaseInvoice | SalesInvoice>(L.vouchers, a.voucherId)));
      return paymentLines(v, ctx, new Map(invs.filter((i): i is PurchaseInvoice | SalesInvoice => Boolean(i)).map((i) => [i.id, i])));
    }
    default:
      throw new LedgerError(`${v.type} vouchers are created by the system`);
  }
}

// ───────────────────────────── public operations ─────────────────────────────

export interface PostOutcome {
  status: "posted" | "submitted";
  voucher: Voucher;
}

/**
 * Submits a draft. If the voucher needs approval (journal over the threshold, large payment,
 * purchase invoice failing the three-way match) it waits for a second person; otherwise it posts.
 */
export function submitVoucher(runner: TxRunner, args: { voucherId: string; actor: Actor; now: string }): Promise<PostOutcome> {
  return runner.run(async (tx) => {
    const v = await tx.get<Voucher>(L.vouchers, args.voucherId);
    if (!v) throw new LedgerError("voucher not found");
    if (v.status !== "draft") throw new LedgerError(`voucher is ${v.status}`);
    const ctx = await loadCtx(tx);
    const built = await build(tx, v, ctx);
    validate(built.lines, ctx);
    findPeriod(ctx, v.postingDate);
    if (built.requiresApproval) {
      const submitted = { ...v, ...(built.patch ?? {}), status: "submitted", submittedBy: args.actor.uid, submittedAt: args.now } as Voucher;
      tx.set(L.vouchers, submitted);
      return { status: "submitted", voucher: submitted };
    }
    const posted = await commit(tx, v, built, ctx, args.actor, args.now, { submittedBy: args.actor.uid, submittedAt: args.now });
    return { status: "posted", voucher: posted };
  });
}

/** Approves and posts a submitted voucher. The approver must not be its creator or submitter. */
export function approveVoucher(runner: TxRunner, args: { voucherId: string; actor: Actor; now: string }): Promise<PostOutcome> {
  return runner.run(async (tx) => {
    const v = await tx.get<Voucher>(L.vouchers, args.voucherId);
    if (!v) throw new LedgerError("voucher not found");
    if (v.status !== "submitted") throw new LedgerError(`voucher is ${v.status}, not waiting for approval`);
    if (v.createdBy === args.actor.uid || v.submittedBy === args.actor.uid) {
      throw new SoDError("segregation of duties: a voucher must be approved by someone other than its preparer");
    }
    const ctx = await loadCtx(tx);
    const built = await build(tx, v, ctx);
    const posted = await commit(tx, v, built, ctx, args.actor, args.now, { approvedBy: args.actor.uid, approvedAt: args.now });
    return { status: "posted", voucher: posted };
  });
}

export function rejectVoucher(runner: TxRunner, args: { voucherId: string; actor: Actor; now: string; reason: string }): Promise<Voucher> {
  return runner.run(async (tx) => {
    const v = await tx.get<Voucher>(L.vouchers, args.voucherId);
    if (!v || v.status !== "submitted") throw new LedgerError("only submitted vouchers can be rejected");
    if (!args.reason.trim()) throw new LedgerError("give a reason");
    const next = { ...v, status: "draft", lastRejection: { by: args.actor.uid, at: args.now, reason: args.reason } } as Voucher;
    tx.set(L.vouchers, next);
    return next;
  });
}

/**
 * Cancels a posted voucher the auditable way: a reversal voucher with the opposite entries.
 * Nothing is ever deleted from the ledger.
 */
export function reverseVoucher(runner: TxRunner, args: { voucherId: string; actor: Actor; now: string; date: string; reason: string }): Promise<Voucher> {
  return runner.run(async (tx) => {
    const v = await tx.get<Voucher>(L.vouchers, args.voucherId);
    if (!v || v.status !== "posted") throw new LedgerError("only posted vouchers can be reversed");
    if (v.reversedBy) throw new LedgerError("already reversed");
    if (v.type === "periodClose" || v.type === "reversal") throw new LedgerError(`${v.type} vouchers cannot be reversed`);
    if (!args.reason.trim()) throw new LedgerError("give a reason for the reversal");
    if ((v.type === "purchaseInvoice" || v.type === "salesInvoice") && (v.outstanding ?? 0) < v.lines!.reduce((a, l) => a + (l.partyId ? l.debit + l.credit : 0), 0)) {
      throw new LedgerError("payments are allocated to this invoice; reverse those payments first");
    }
    const ctx = await loadCtx(tx);
    const [entries, invoices, assets] = await Promise.all([
      tx.query<LedgerEntry>(L.ledger, { where: [["voucherId", "==", v.id]] }),
      v.type === "payment" ? Promise.all(v.allocations.map((a) => tx.get<PurchaseInvoice | SalesInvoice>(L.vouchers, a.voucherId))) : Promise.resolve([]),
      v.type === "depreciation" ? Promise.all(v.items.map((i) => tx.get<Asset>(L.assets, i.assetId))) : v.type === "assetDisposal" ? Promise.all([tx.get<Asset>(L.assets, v.assetId)]) : Promise.resolve([]),
    ]);
    const lines: PreparedLine[] = entries
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((e) => ({
        account: e.account,
        debit: e.credit,
        credit: e.debit,
        debitFc: e.creditFc,
        creditFc: e.debitFc,
        currency: e.currency,
        rateMicros: e.exchangeRateMicros,
        costCenter: e.costCenter,
        ...(e.partyType ? { partyType: e.partyType } : {}),
        ...(e.partyId ? { partyId: e.partyId } : {}),
        ...(e.againstVoucherId ? { againstVoucherId: e.againstVoucherId } : {}),
        memo: `Reversal of ${v.number}`,
      }));
    const id = `${v.id}-REV`;
    const rev: ReversalVoucher = {
      id,
      type: "reversal",
      status: "draft",
      postingDate: args.date,
      remarks: `Reversal of ${v.number}: ${args.reason}`,
      currency: v.currency,
      exchangeRateMicros: v.exchangeRateMicros,
      ...(v.propertyId ? { propertyId: v.propertyId } : {}),
      ...(v.costCenter ? { costCenter: v.costCenter } : {}),
      createdBy: args.actor.uid,
      createdAt: args.now,
      reversalOf: v.id,
    };
    const built: Built = {
      lines,
      requiresApproval: false,
      extra: (t) => {
        t.merge(L.vouchers, v.id, { status: "cancelled", reversedBy: id, cancelReason: args.reason });
        if (v.type === "payment") {
          for (const al of v.allocations) {
            const inv = invoices.find((i) => i?.id === al.voucherId);
            if (inv) t.merge(L.vouchers, inv.id, { outstanding: (inv.outstanding ?? 0) + al.amount });
          }
        }
        if (v.type === "depreciation") {
          for (const it of v.items) {
            const a = (assets as (Asset | null)[]).find((x) => x?.id === it.assetId);
            if (a) t.merge(L.assets, a.id, { accumulatedDep: a.accumulatedDep - it.amount, lastDepPeriod: addMonths(v.depreciationPeriod, -1), status: "active" });
          }
        }
        if (v.type === "assetDisposal") t.merge(L.assets, v.assetId, { status: "active" });
      },
    };
    return commit(tx, rev, built, ctx, args.actor, args.now);
  });
}

/**
 * Posts the day's POS results (sales by major group, discounts, service charge, SSCL, VAT,
 * tenders, FIFO cost of sales, waste, goods received) from the pre-aggregated day totals. If the
 * day was already posted and later sales arrived, only the difference is posted.
 */
export function postPosDay(runner: TxRunner, args: { propertyId: string; businessDate: string; actor: Actor; now: string }): Promise<Voucher | null> {
  return runner.run(async (tx) => {
    const ctx = await loadCtx(tx);
    const [accounting, pos, stats, movements, receipts, tenders, previous] = await Promise.all([
      tx.get<AccountingSettings>(C.settings, "accounting"),
      tx.get<{ defaultPropertyId?: string }>(C.settings, "pos"),
      tx.get<DailyStats>(C.dailyStats, `${args.propertyId}__${args.businessDate}`),
      tx.query<StockMovement>(C.stockMovements, { where: [["businessDate", "==", args.businessDate]] }),
      tx.query<GoodsReceipt>(C.goodsReceipts, { where: [["date", "==", args.businessDate]] }),
      tx.query<TenderMedia>(C.tenderMedia),
      tx.query<PosDayVoucher>(L.vouchers, { where: [["businessDate", "==", args.businessDate]] }),
    ]);
    const sameDay = previous.filter((p) => p.type === "posDay" && p.propertyId === args.propertyId);
    const posted = sameDay.filter((p) => p.status === "posted");
    // Stock is held centrally: receipts and cost of sales post with the outlet that owns the stores.
    const ownsStock = !pos?.defaultPropertyId || pos.defaultPropertyId === args.propertyId;
    const posts = ownsStock ? receipts.filter((r) => r.status === "posted") : [];
    const journal = buildDailyJournal({
      date: args.businessDate,
      propertyId: args.propertyId,
      stats,
      movements: ownsStock ? movements : [],
      receipts: posts,
      receiptValues: new Map(posts.map((r) => [r.id, receiptValue(r)])),
      tenders,
      settings: { ...accounting!, accounts: { ...accounting!.accounts, stockReceivedNotBilled: ctx.settings.accounts.stockReceivedNotBilled } },
    });
    const cc = [...ctx.costCenters.values()].find((c) => c.propertyId === args.propertyId && !c.isGroup)?.id ?? ctx.settings.defaultCostCenter;
    const net = new Map<string, Cents>();
    for (const l of journal.lines) net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + l.debit - l.credit);
    for (const p of posted) for (const l of p.lines ?? []) net.set(l.account, (net.get(l.account) ?? 0) - (l.debit - l.credit));
    const memo = new Map(journal.lines.map((l) => [l.accountCode, l.memo ?? ""]));
    const lines = [...net].filter(([, amt]) => amt !== 0).map(([account, amt]) => baseLine(account, amt, ctx, cc, memo.get(account) || "POS adjustment")!);
    if (!lines.length) return null;
    const seq = sameDay.length + 1;
    const v: PosDayVoucher = {
      id: `POSDAY-${args.propertyId}-${args.businessDate}-${seq}`,
      type: "posDay",
      status: "draft",
      postingDate: args.businessDate,
      businessDate: args.businessDate,
      sequence: seq,
      remarks: posted.length === 0 ? `POS day ${args.businessDate}` : `POS day ${args.businessDate} – adjustment for late sales`,
      currency: ctx.settings.baseCurrency,
      exchangeRateMicros: BASE_RATE,
      propertyId: args.propertyId,
      costCenter: cc,
      createdBy: args.actor.uid,
      createdAt: args.now,
    };
    return commit(tx, v, { lines, extra: () => {}, requiresApproval: false }, ctx, args.actor, args.now);
  });
}

/** Posts depreciation for every active asset for one period (catching up missed months). */
export function runDepreciation(runner: TxRunner, args: { period: string; actor: Actor; now: string }): Promise<Voucher | null> {
  return runner.run(async (tx) => {
    const ctx = await loadCtx(tx);
    const assets = await tx.query<Asset>(L.assets, { where: [["status", "==", "active"]] });
    const already = await tx.query<DepreciationVoucher>(L.vouchers, { where: [["depreciationPeriod", "==", args.period]] });
    if (already.some((p) => p.status === "posted")) throw new LedgerError(`depreciation for ${args.period} is already posted`);
    const items = assets
      .filter((a) => !a.lastDepPeriod || a.lastDepPeriod < args.period)
      .map((a) => ({ assetId: a.id, amount: depreciationFor(a, args.period) }))
      .filter((i) => i.amount > 0);
    if (!items.length) return null;
    const lastDay = buildFiscalYear(Number(args.period.slice(0, 4)), Number(args.period.slice(5, 7))).periods[0]!.end;
    const v: DepreciationVoucher = {
      id: await uniqueVoucherId(tx, `DEP-${args.period}`),
      type: "depreciation",
      status: "draft",
      postingDate: lastDay,
      depreciationPeriod: args.period,
      items,
      remarks: `Depreciation for ${args.period}`,
      currency: ctx.settings.baseCurrency,
      exchangeRateMicros: BASE_RATE,
      createdBy: args.actor.uid,
      createdAt: args.now,
    };
    return commit(tx, v, depreciationLines(v, ctx, new Map(assets.map((a) => [a.id, a]))), ctx, args.actor, args.now);
  });
}

export function disposeAsset(runner: TxRunner, args: { assetId: string; date: string; proceeds: Cents; proceedsAccount: string; actor: Actor; now: string }): Promise<Voucher> {
  return runner.run(async (tx) => {
    const ctx = await loadCtx(tx);
    const asset = await tx.get<Asset>(L.assets, args.assetId);
    if (!asset) throw new LedgerError("asset not found");
    const v: AssetDisposalVoucher = {
      id: await uniqueVoucherId(tx, `ADS-${asset.id}`),
      type: "assetDisposal",
      status: "draft",
      postingDate: args.date,
      assetId: asset.id,
      proceeds: args.proceeds,
      proceedsAccount: args.proceedsAccount,
      remarks: `Disposal of ${asset.code} ${asset.name}`,
      currency: ctx.settings.baseCurrency,
      exchangeRateMicros: BASE_RATE,
      createdBy: args.actor.uid,
      createdAt: args.now,
    };
    return commit(tx, v, disposalLines(v, ctx, asset), ctx, args.actor, args.now);
  });
}

/** Creates the fiscal year (12 monthly periods) containing `date` if it does not exist. */
export function ensureFiscalYear(runner: TxRunner, args: { date: string }): Promise<FiscalYear> {
  return runner.run(async (tx) => {
    const accounting = await tx.get<{ ledger?: LedgerSettings }>(C.settings, "accounting");
    const start = accounting?.ledger?.fiscalYearStartMonth ?? 4;
    const id = fiscalYearId(args.date, start);
    const existing = await tx.get<FiscalYear>(L.fiscalYears, id);
    if (existing) return existing;
    const y = Number(args.date.slice(0, 4));
    const m = Number(args.date.slice(5, 7));
    const fy = buildFiscalYear(m >= start ? y : y - 1, start);
    tx.set(L.fiscalYears, fy);
    return fy;
  });
}

/** Closes (locks) a period: no further postings. */
export function setPeriodStatus(runner: TxRunner, args: { periodId: string; status: "open" | "closed"; actor: Actor; now: string; reason?: string }): Promise<FiscalYear> {
  return runner.run(async (tx) => {
    const fys = await tx.query<FiscalYear>(L.fiscalYears);
    const fy = fys.find((f) => f.periods.some((p) => p.id === args.periodId));
    if (!fy) throw new LedgerError(`period ${args.periodId} not found`);
    if (fy.status === "closed") throw new LedgerError(`fiscal year ${fy.id} is closed`);
    if (args.status === "open" && !args.reason?.trim()) throw new LedgerError("give a reason for reopening a period");
    const next: FiscalYear = {
      ...fy,
      periods: fy.periods.map((p) => (p.id === args.periodId ? { ...p, status: args.status, ...(args.status === "closed" ? { closedBy: args.actor.uid, closedAt: args.now } : {}) } : p)),
    };
    tx.set(L.fiscalYears, next);
    return next;
  });
}

/** Year-end close: posts the period-closing voucher (P&L to retained earnings) and locks the year. */
export function closeFiscalYear(runner: TxRunner, args: { fiscalYearId: string; actor: Actor; now: string }): Promise<Voucher> {
  return runner.run(async (tx) => {
    const ctx = await loadCtx(tx);
    const fy = ctx.fiscalYears.find((f) => f.id === args.fiscalYearId);
    if (!fy) throw new LedgerError("fiscal year not found");
    const open = fy.periods.filter((p) => p.status === "open");
    if (open.length) throw new LedgerError(`close all periods first (still open: ${open.map((p) => p.id).join(", ")})`);
    const balances = await tx.query<AccountBalance>(L.balances, { where: [["fiscalYear", "==", fy.id]] });
    const v: PeriodCloseVoucher = {
      id: `PCV-${fy.id}`,
      type: "periodClose",
      status: "draft",
      postingDate: fy.end,
      closingFiscalYear: fy.id,
      remarks: `Year-end closing ${fy.id}`,
      currency: ctx.settings.baseCurrency,
      exchangeRateMicros: BASE_RATE,
      createdBy: args.actor.uid,
      createdAt: args.now,
    };
    const posted = await commit(tx, v, periodCloseLines(v, ctx, balances), ctx, args.actor, args.now);
    tx.set(L.fiscalYears, { ...fy, status: "closed", closedBy: args.actor.uid, closedAt: args.now });
    return posted;
  });
}
