/**
 * Manager functions on closed checks, as on Oracle Simphony: void a closed check, refund items,
 * reopen a closed check to correct it, and change its payment method.
 *
 * A closed check and its tax invoice never change. Every correction is a new record:
 *  - a **credit note** (void, refund, reopen): numbered per workstation and month like invoices
 *    (CN-26NOV_W01_1), hash-chained, with the day's figures reduced on the business date it is
 *    issued, the customer's spend reduced, and (when the goods come back) the stock returned at the
 *    next stock run;
 *  - a **tender adjustment** (payment method): moves the amount between tenders in the original
 *    day's figures.
 * The POS journal records who did it, who approved it and why. The ledger picks the changes up
 * from the day's figures (a day already posted is posted again for the difference).
 */
import { type Cents, formatInvoiceNumber, localPeriod, nextSequence } from "@pos/engine";
import { type PosContext, computeCheckTotals, newCheck, statsId } from "./pos.js";
import { COLLECTIONS as C, type DocStore, type Increments, type WriteOp } from "./store.js";
import type { Check, CheckLine, WorkstationSequence } from "./types.js";
import { canonicalJson, newId, sha256Hex } from "./util.js";

export interface CreditNoteLine {
  lineId: string;
  menuItemId: string;
  name: string;
  categoryId: string;
  qty: number;
  modifiers: CheckLine["modifiers"];
  /** Menu price × quantity (with modifiers). */
  gross: Cents;
  /** After discounts, before service charge and taxes. */
  net: Cents;
}

export interface CreditNote {
  id: string;
  kind: "void" | "refund" | "reopen";
  checkId: string;
  checkNo: number;
  invoiceNo: string;
  workstationId: string;
  propertyId: string;
  rvcId: string;
  /** The day the credit note is issued (its figures count here). */
  businessDate: string;
  originalBusinessDate: string;
  issuedAt: string;
  reasonId?: string;
  reason: string;
  by: string;
  authorizedBy?: string;
  lines: CreditNoteLine[];
  totals: {
    gross: Cents;
    discounts: Cents;
    net: Cents;
    charges: { ruleId: string; name: string; amount: Cents }[];
    vat: Cents;
    rounding: Cents;
    /** Amount given back (or cancelled, for a reopen). */
    total: Cents;
  };
  /** How the money went back (tender and amount). Empty for a reopen (the new check is paid again). */
  refunds: { tenderId: string; amount: Cents }[];
  /** Whether the whole check is cancelled (void, reopen, or refund of every remaining item). */
  full: boolean;
  /** The goods come back into stock (retail, unopened items); food is normally not restocked. */
  restock: boolean;
  depletion: "pending" | "done" | "skipped";
  /** Reopen: the new check that replaces the original. */
  reopenedCheckId?: string;
  vatRegistered: boolean;
  prevHash: string;
  hash: string;
}

export interface CheckAdjustment {
  id: string;
  kind: "tender";
  checkId: string;
  checkNo: number;
  invoiceNo: string;
  propertyId: string;
  workstationId: string;
  /** The check's own business date (the figures change there). */
  businessDate: string;
  at: string;
  by: string;
  authorizedBy?: string;
  reason: string;
  paymentId: string;
  fromTenderId: string;
  toTenderId: string;
  amount: Cents;
}

export class ClosedCheckError extends Error {}

export function creditNoteHash(note: Omit<CreditNote, "hash"> | CreditNote): Promise<string> {
  const { hash: _ignored, ...base } = note as CreditNote;
  return sha256Hex(base.prevHash + canonicalJson(base));
}

/** What is still refundable on a closed check, per line, after earlier credit notes. */
export function remainingQty(check: Check, notes: readonly CreditNote[]): Map<string, number> {
  const left = new Map(check.lines.filter((l) => !l.voided).map((l) => [l.id, l.qty]));
  for (const n of notes.filter((x) => x.checkId === check.id)) {
    if (n.full) for (const k of left.keys()) left.set(k, 0);
    else for (const l of n.lines) left.set(l.lineId, Math.max(0, (left.get(l.lineId) ?? 0) - l.qty));
  }
  return left;
}

/** Amount already given back on a check. */
export function refundedAmount(check: Check, notes: readonly CreditNote[]): Cents {
  return notes.filter((n) => n.checkId === check.id).reduce((a, n) => a + n.totals.total, 0);
}

const scale = (amount: number, num: number, den: number) => (den === 0 ? 0 : Math.round((amount * num) / den));

/**
 * The amounts of a credit note: each selected line's own gross and net (its share of discounts),
 * and service charge, levies, VAT and rounding in proportion to the net. A whole check gives back
 * exactly what was paid.
 */
export function creditAmounts(check: Check, select: "all" | { lineId: string; qty: number }[]): { lines: CreditNoteLine[]; totals: CreditNote["totals"]; whole: boolean } {
  const totals = check.totals;
  if (!totals) throw new ClosedCheckError("the check has no totals");
  const byId = new Map(check.lines.map((l) => [l.id, l]));
  const picked = select === "all" ? check.lines.filter((l) => !l.voided).map((l) => ({ lineId: l.id, qty: l.qty })) : select.filter((s) => s.qty > 0);
  if (!picked.length) throw new ClosedCheckError("choose at least one item");
  const lines: CreditNoteLine[] = [];
  for (const p of picked) {
    const line = byId.get(p.lineId);
    const lt = totals.lines.find((t) => t.id === p.lineId);
    if (!line || !lt || line.voided) throw new ClosedCheckError(`item ${p.lineId} is not on this check`);
    if (p.qty > line.qty) throw new ClosedCheckError(`${line.name}: only ${line.qty} on the check`);
    lines.push({ lineId: line.id, menuItemId: line.menuItemId, name: line.name, categoryId: line.categoryId, qty: p.qty, modifiers: line.modifiers, gross: scale(lt.gross, p.qty, line.qty), net: scale(lt.net, p.qty, line.qty) });
  }
  const whole = select === "all" || check.lines.filter((l) => !l.voided).every((l) => picked.find((p) => p.lineId === l.id)?.qty === l.qty);
  const net = lines.reduce((a, l) => a + l.net, 0);
  const gross = lines.reduce((a, l) => a + l.gross, 0);
  if (whole) {
    return {
      lines,
      whole,
      totals: { gross: totals.itemsTotal, discounts: totals.discountTotal, net: totals.netSubtotal, charges: totals.charges.map((c) => ({ ruleId: c.ruleId, name: c.name, amount: c.amount })), vat: totals.vatTotal, rounding: totals.roundingAdjustment, total: totals.amountDue },
    };
  }
  const charges = totals.charges.map((c) => ({ ruleId: c.ruleId, name: c.name, amount: scale(c.amount, net, totals.netSubtotal) }));
  const vat = scale(totals.vatTotal, net, totals.netSubtotal);
  const totalBeforeRounding = scale(totals.total, net, totals.netSubtotal);
  return { lines, whole, totals: { gross, discounts: gross - net, net, charges, vat, rounding: 0, total: totalBeforeRounding } };
}

/** The figures a credit note takes off the day it is issued (negative increments). */
export function creditStats(note: Pick<CreditNote, "lines" | "totals" | "refunds" | "full">, check: Check, majorGroupOf: (categoryId: string) => string, hour: string): Increments {
  const t = note.totals;
  const charge = (id: string) => t.charges.find((c) => c.ruleId === id)?.amount ?? 0;
  const neg = (bucket: Increments, key: string, qty: number, amount: number, gross?: number) => {
    const cur = (bucket[key] ?? { qty: 0, amount: 0 }) as { qty: number; amount: number; gross?: number };
    bucket[key] = { qty: cur.qty - qty, amount: cur.amount - amount, ...(gross !== undefined ? { gross: (cur.gross ?? 0) - gross } : {}) };
  };
  const items: Increments = {};
  const categories: Increments = {};
  const majorGroups: Increments = {};
  for (const l of note.lines) {
    neg(items, l.menuItemId, l.qty, l.net);
    neg(categories, l.categoryId, l.qty, l.net);
    neg(majorGroups, majorGroupOf(l.categoryId), l.qty, l.net, l.gross);
  }
  const tenders: Increments = {};
  for (const r of note.refunds) neg(tenders, r.tenderId, 0, r.amount);
  return {
    checks: note.full ? -1 : 0,
    covers: note.full ? -check.covers : 0,
    itemsTotal: -t.gross,
    discounts: -t.discounts,
    netSales: -t.net,
    serviceCharge: -charge("sc"),
    sscl: -charge("sscl"),
    tdl: -charge("tdl"),
    vat: -t.vat,
    total: -t.total,
    rounding: -t.rounding,
    items,
    categories,
    majorGroups,
    tenders,
    orderTypes: { [check.orderTypeId]: { qty: note.full ? -1 : 0, amount: -t.net, covers: note.full ? -check.covers : 0 } },
    hours: { [hour]: { qty: 0, amount: -t.net } },
    returns: { qty: 1, amount: t.total },
  };
}

export interface CreditArgs {
  kind: CreditNote["kind"];
  /** "all", or the items and quantities to refund. */
  select: "all" | { lineId: string; qty: number }[];
  /** How the money goes back (refunds and voids); reopen pays again on the new check. */
  refunds?: { tenderId: string; amount: Cents }[];
  reason: string;
  reasonId?: string;
  by: string;
  authorizedBy?: string;
  restock: boolean;
  /** Today's business date (the credit note's figures count here). */
  businessDate: string;
  workstationId: string;
  workstationCode: string;
  inventoryOn: boolean;
  now?: Date;
}

const hourOf = (at: Date) => String(new Date(at.getTime() + 330 * 60_000).getUTCHours()).padStart(2, "0");

/**
 * Issues a credit note against a closed check (void, refund or reopen) with everything it changes,
 * in one batch. Returns the credit note and, for a reopen, the new open check to correct and close.
 */
export async function issueCreditNote(store: DocStore, check: Check, ctx: Pick<PosContext, "categories" | "business" | "pos" | "crmOn">, args: CreditArgs): Promise<{ note: CreditNote; reopened?: Check }> {
  if (check.status !== "closed" || !check.invoiceNo || !check.totals) throw new ClosedCheckError("only closed checks can be corrected this way");
  if (!args.reason.trim()) throw new ClosedCheckError("give a reason");
  const earlier = await store.list<CreditNote>(C.creditNotes, { where: [["checkId", "==", check.id]] });
  const left = remainingQty(check, earlier);
  if ([...left.values()].every((q) => q <= 0)) throw new ClosedCheckError(`check ${check.checkNo} has already been fully credited`);
  if (args.kind !== "refund" && earlier.length) throw new ClosedCheckError("part of this check was already refunded: refund the rest item by item");
  if (args.select !== "all") for (const s of args.select) if (s.qty > (left.get(s.lineId) ?? 0)) throw new ClosedCheckError("more than is left to refund on an item");
  const { lines, totals, whole } = creditAmounts(check, args.kind === "refund" ? args.select : "all");
  const full = whole && earlier.length === 0;
  const refunds = args.kind === "reopen" ? [] : (args.refunds ?? []);
  if (args.kind !== "reopen") {
    const back = refunds.reduce((a, r) => a + r.amount, 0);
    if (back !== totals.total) throw new ClosedCheckError(`the refund must add up to ${totals.total} (it adds up to ${back})`);
  }

  const now = args.now ?? new Date();
  const at = now.toISOString();
  const period = localPeriod(now);
  const seq = await store.get<WorkstationSequence>(C.sequences, args.workstationId);
  const sequence = nextSequence(seq?.creditSeq ? { year: seq.creditYear ?? period.year, month: seq.creditMonth ?? period.month, sequence: seq.creditSeq } : null, period, "monthly");
  const id = `CN-${formatInvoiceNumber({ ...period, classificationCode: args.workstationCode, sequence })}`;
  const reopenedId = args.kind === "reopen" ? newId() : undefined;
  const base: Omit<CreditNote, "hash"> = {
    id,
    kind: args.kind,
    checkId: check.id,
    checkNo: check.checkNo,
    invoiceNo: check.invoiceNo,
    workstationId: args.workstationId,
    propertyId: check.propertyId,
    rvcId: check.rvcId,
    businessDate: args.businessDate,
    originalBusinessDate: check.businessDate,
    issuedAt: at,
    ...(args.reasonId ? { reasonId: args.reasonId } : {}),
    reason: args.reason.trim().slice(0, 200),
    by: args.by,
    ...(args.authorizedBy ? { authorizedBy: args.authorizedBy } : {}),
    lines,
    totals,
    refunds,
    full,
    restock: args.restock || args.kind === "reopen",
    depletion: args.inventoryOn && (args.restock || args.kind === "reopen") && check.depletion !== "skipped" ? "pending" : "skipped",
    ...(reopenedId ? { reopenedCheckId: reopenedId } : {}),
    vatRegistered: ctx.business.vatRegistered,
    prevHash: seq?.lastCreditHash ?? "",
  };
  const note: CreditNote = { ...base, hash: await creditNoteHash(base) };
  const majorGroupOf = (categoryId: string) => ctx.categories.get(categoryId)?.majorGroup ?? "Other";
  const ops: WriteOp[] = [
    { op: "set", col: C.creditNotes, data: note },
    { op: "merge", col: C.sequences, id: args.workstationId, data: { id: args.workstationId, creditYear: period.year, creditMonth: period.month, creditSeq: sequence, lastCreditHash: note.hash } },
    { op: "increment", col: C.dailyStats, id: statsId(check.propertyId, args.businessDate), inc: creditStats(note, check, majorGroupOf, hourOf(now)), base: { propertyId: check.propertyId, businessDate: args.businessDate } },
  ];
  if (ctx.crmOn && check.customerId) ops.push({ op: "increment", col: C.customers, id: check.customerId, inc: { totalSpend: -totals.total, visits: full ? -1 : 0 } });
  let reopened: Check | undefined;
  if (args.kind === "reopen") {
    reopened = {
      ...newCheck({ propertyId: check.propertyId, rvcId: check.rvcId, workstationId: args.workstationId, checkNo: check.checkNo, orderTypeId: check.orderTypeId, covers: check.covers, staffId: args.by, businessDate: args.businessDate, ...(check.tableId ? { tableId: check.tableId } : {}) }),
      id: reopenedId!,
      // The items were made already: they come back as sent, so nothing prints in the kitchen again.
      lines: check.lines.filter((l) => !l.voided).map((l) => ({ ...l, id: newId(), sentRound: l.sentRound ?? 1 })),
      sentRounds: Math.max(1, check.sentRounds),
      checkDiscountIds: check.checkDiscountIds,
      ...(check.customerId ? { customerId: check.customerId } : {}),
      ...(check.buyer ? { buyer: check.buyer } : {}),
      ...(check.name ? { name: check.name } : {}),
      reopenedFrom: { checkId: check.id, invoiceNo: check.invoiceNo, creditNoteId: id },
    };
    ops.push({ op: "set", col: C.checks, data: reopened });
  }
  await store.batch(ops);
  return { note, ...(reopened ? { reopened } : {}) };
}

/** Moves (part of) a payment on a closed check to another tender, in the check's own day figures. */
export async function adjustClosedTender(
  store: DocStore,
  check: Check,
  args: { paymentId: string; toTenderId: string; amount: Cents; reason: string; by: string; authorizedBy?: string; workstationId: string; now?: Date },
): Promise<CheckAdjustment> {
  if (check.status !== "closed" || !check.invoiceNo) throw new ClosedCheckError("only closed checks can be adjusted");
  if (!args.reason.trim()) throw new ClosedCheckError("give a reason");
  const p = check.payments.find((x) => x.id === args.paymentId);
  if (!p) throw new ClosedCheckError("payment not found on this check");
  if (p.tenderId === args.toTenderId) throw new ClosedCheckError("choose a different payment method");
  const earlier = await store.list<CheckAdjustment>(C.checkAdjustments, { where: [["checkId", "==", check.id]] });
  const moved = earlier.filter((a) => a.paymentId === p.id).reduce((n, a) => n + a.amount, 0);
  if (!(args.amount > 0) || args.amount > p.applied - moved) throw new ClosedCheckError(`at most ${p.applied - moved} can be moved from this payment`);
  const notes = await store.list<CreditNote>(C.creditNotes, { where: [["checkId", "==", check.id]] });
  if (notes.some((n) => n.full)) throw new ClosedCheckError("this check was voided or reopened");
  const adj: CheckAdjustment = {
    id: newId(),
    kind: "tender",
    checkId: check.id,
    checkNo: check.checkNo,
    invoiceNo: check.invoiceNo,
    propertyId: check.propertyId,
    workstationId: args.workstationId,
    businessDate: check.businessDate,
    at: (args.now ?? new Date()).toISOString(),
    by: args.by,
    ...(args.authorizedBy ? { authorizedBy: args.authorizedBy } : {}),
    reason: args.reason.trim().slice(0, 200),
    paymentId: p.id,
    fromTenderId: p.tenderId,
    toTenderId: args.toTenderId,
    amount: args.amount,
  };
  const tenders: Increments = { [p.tenderId]: { qty: 0, amount: -args.amount }, [args.toTenderId]: { qty: 0, amount: args.amount } };
  await store.batch([
    { op: "set", col: C.checkAdjustments, data: adj },
    { op: "increment", col: C.dailyStats, id: statsId(check.propertyId, check.businessDate), inc: { tenders }, base: { propertyId: check.propertyId, businessDate: check.businessDate } },
  ]);
  return adj;
}

/** Merges the open check `from` into `into`: items and payments move, `from` is closed as merged. */
export function mergeChecks(into: Check, from: Check): { into: Check; from: Check } {
  if (into.status !== "open" || from.status !== "open") throw new ClosedCheckError("only open checks can be merged");
  if (into.id === from.id) throw new ClosedCheckError("choose another check");
  return {
    into: { ...into, lines: [...into.lines, ...from.lines], payments: [...into.payments, ...from.payments], covers: into.covers + from.covers, sentRounds: Math.max(into.sentRounds, from.sentRounds), checkDiscountIds: [...new Set([...into.checkDiscountIds, ...from.checkDiscountIds])] },
    from: { ...from, status: "voided", lines: [], payments: [], name: `Merged into #${into.checkNo}` },
  };
}

/** A check's totals recomputed (after a merge or on a reopened check). */
export function retotal(check: Check, ctx: Pick<PosContext, "tax" | "business" | "discounts">) {
  return computeCheckTotals(check, ctx);
}
