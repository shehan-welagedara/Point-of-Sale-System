import { type DocStore, type Invoice, type Member, type MemberRole, type PosEvent, COLLECTIONS as C, verifyPosJournal } from "@pos/core";
import { type AuditEvent, type AuditSeal, type IntegrityIssue, type Gap, type SodFinding, sealEvents, sequenceGaps, sodConflicts, sodViolations, verifyAuditTrail, verifyInvoices, verifyLedger } from "./audit.js";
import {
  approveVoucher,
  closeFiscalYear,
  disposeAsset,
  ensureFiscalYear,
  postPosDay,
  rejectVoucher,
  reverseVoucher,
  runDepreciation,
  setPeriodStatus,
  submitVoucher,
} from "./posting.js";
import type { TxRunner } from "./tx.js";
import { type AccountBalance, type Actor, type LedgerEntry, type Voucher, LEDGER as L } from "./types.js";

/** Every server-side ledger operation, dispatched the same way by Cloud Functions and local demo mode. */
export type LedgerRequest =
  | { action: "submit" | "approve"; voucherId: string }
  | { action: "reject"; voucherId: string; reason: string }
  | { action: "reverse"; voucherId: string; date: string; reason: string }
  | { action: "postPosDay"; propertyId: string; businessDate: string }
  | { action: "runDepreciation"; period: string }
  | { action: "disposeAsset"; assetId: string; date: string; proceeds: number; proceedsAccount: string }
  | { action: "ensureFiscalYear"; date: string }
  | { action: "setPeriodStatus"; periodId: string; status: "open" | "closed"; reason?: string }
  | { action: "closeFiscalYear"; fiscalYearId: string }
  | { action: "verify" }
  | { action: "seal" };

const BOOKS: MemberRole[] = ["owner", "admin", "accountant"];

/** Who may run each action (on top of segregation-of-duties checks inside the ledger). */
export const ACTION_ROLES: Record<LedgerRequest["action"], MemberRole[]> = {
  submit: BOOKS,
  approve: BOOKS,
  reject: BOOKS,
  reverse: BOOKS,
  postPosDay: [...BOOKS, "manager", "terminal"],
  runDepreciation: BOOKS,
  disposeAsset: BOOKS,
  ensureFiscalYear: [...BOOKS, "manager", "terminal"],
  setPeriodStatus: BOOKS,
  closeFiscalYear: ["owner", "admin"],
  verify: ["owner", "admin", "accountant", "auditor"],
  seal: ["owner", "admin", "auditor"],
};

export class PermissionError extends Error {}

export interface IntegrityReport {
  checkedAt: string;
  checkedBy: string;
  counts: { vouchers: number; ledgerLines: number; invoices: number; auditEvents: number; seals: number; unsealedEvents: number; posEvents: number };
  issues: IntegrityIssue[];
  gaps: Gap[];
  sod: SodFinding[];
  ok: boolean;
}

/** Events newer than this are left for the next seal so in-flight writes are never missed. */
export const SEAL_DELAY_MS = 2 * 60_000;

export async function sealPending(store: DocStore, now: Date, delayMs = SEAL_DELAY_MS): Promise<AuditSeal | null> {
  const [last] = await store.list<AuditSeal>(L.auditSeals, { orderBy: ["seq", "desc"], limit: 1 });
  const cutoff = new Date(now.getTime() - delayMs).toISOString();
  const events = await store.list<AuditEvent>(L.auditEvents, {
    where: [
      ["at", ">=", last?.to ?? ""],
      ["at", "<", cutoff],
    ],
    orderBy: ["at", "asc"],
    limit: 5000,
  });
  const already = new Set(last?.eventIds ?? []);
  const seal = await sealEvents(events.filter((e) => !already.has(e.id)), last ?? null, now.toISOString());
  if (seal) await store.set(L.auditSeals, seal);
  return seal;
}

export async function integrityReport(store: DocStore, actor: Actor, now: string): Promise<IntegrityReport> {
  const [vouchers, entries, balances, invoices, events, seals, members, posEvents] = await Promise.all([
    store.list<Voucher>(L.vouchers),
    store.list<LedgerEntry>(L.ledger),
    store.list<AccountBalance>(L.balances),
    store.list<Invoice>(C.invoices),
    store.list<AuditEvent>(L.auditEvents),
    store.list<AuditSeal>(L.auditSeals),
    store.list<Member>(C.members).catch(() => [] as Member[]),
    store.list<PosEvent>(C.posJournal),
  ]);
  const issues = [
    ...(await verifyLedger(vouchers, entries, balances)),
    ...(await verifyInvoices(invoices)),
    ...(await verifyAuditTrail(events, seals)),
    ...(await verifyPosJournal(posEvents)).map((i) => ({ area: "POS journal" as const, ...i })),
    ...sodViolations(vouchers),
  ];
  const numbers = [...vouchers.filter((v) => v.number).map((v) => v.number!), ...invoices.map((i) => i.id)];
  const gaps = sequenceGaps(numbers);
  const sealed = new Set(seals.flatMap((s) => s.eventIds));
  return {
    checkedAt: now,
    checkedBy: actor.uid,
    counts: { vouchers: vouchers.filter((v) => v.number).length, ledgerLines: entries.length, invoices: invoices.length, auditEvents: events.length, seals: seals.length, unsealedEvents: events.filter((e) => !sealed.has(e.id)).length, posEvents: posEvents.length },
    issues,
    gaps,
    sod: sodConflicts(members),
    ok: issues.filter((i) => i.severity === "critical").length === 0,
  };
}

export async function runLedgerRequest(deps: { runner: TxRunner; store: DocStore; now: () => Date; sealDelayMs?: number }, actor: Actor, req: LedgerRequest): Promise<unknown> {
  if (!ACTION_ROLES[req.action]?.includes(actor.role as MemberRole)) {
    throw new PermissionError(`your access (${actor.role}) cannot ${req.action.replace(/([A-Z])/g, " $1").toLowerCase()}`);
  }
  const now = deps.now().toISOString();
  const { runner } = deps;
  switch (req.action) {
    case "submit":
      return submitVoucher(runner, { voucherId: req.voucherId, actor, now });
    case "approve":
      return approveVoucher(runner, { voucherId: req.voucherId, actor, now });
    case "reject":
      return rejectVoucher(runner, { voucherId: req.voucherId, actor, now, reason: req.reason });
    case "reverse":
      return reverseVoucher(runner, { voucherId: req.voucherId, actor, now, date: req.date, reason: req.reason });
    case "postPosDay":
      await ensureFiscalYear(runner, { date: req.businessDate });
      return postPosDay(runner, { propertyId: req.propertyId, businessDate: req.businessDate, actor, now });
    case "runDepreciation":
      return runDepreciation(runner, { period: req.period, actor, now });
    case "disposeAsset":
      return disposeAsset(runner, { assetId: req.assetId, date: req.date, proceeds: req.proceeds, proceedsAccount: req.proceedsAccount, actor, now });
    case "ensureFiscalYear":
      return ensureFiscalYear(runner, { date: req.date });
    case "setPeriodStatus":
      if (req.status === "open" && !["owner", "admin"].includes(actor.role)) throw new PermissionError("only an owner or administrator can reopen a period");
      return setPeriodStatus(runner, { periodId: req.periodId, status: req.status, actor, now, ...(req.reason ? { reason: req.reason } : {}) });
    case "closeFiscalYear":
      return closeFiscalYear(runner, { fiscalYearId: req.fiscalYearId, actor, now });
    case "verify":
      return integrityReport(deps.store, actor, now);
    case "seal":
      return sealPending(deps.store, deps.now(), deps.sealDelayMs);
  }
}
