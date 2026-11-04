import type { Cents } from "@pos/engine";
import { type PosContext, statsIncrement } from "./pos.js";
import { COLLECTIONS as C, type DocStore, type Increments } from "./store.js";
import type { Check, DailyStats, Entity } from "./types.js";
import { canonicalJson, newId, sha256Hex } from "./util.js";

/**
 * POS transaction journal (Simphony "journal" / electronic journal): one append-only event for
 * every operator action that matters to an auditor — sign-ins (and failures), checks begun,
 * sent, paid, closed, reopened; every void, discount, price override, refund, no-sale, paid
 * in/out, reprint and manager authorisation, with who did it and who authorised it.
 *
 * Each workstation's events form a hash chain (like its invoices), so a deleted or edited event
 * is detectable. Security rules allow only creating events, never changing or deleting them.
 */
export type PosEventType =
  | "signIn"
  | "signInFailed"
  | "lockout"
  | "unlock"
  | "signOut"
  | "autoSignOut"
  | "clockIn"
  | "clockOut"
  | "rvcChange"
  | "checkBegin"
  | "itemVoid"
  | "itemRemove"
  | "discount"
  | "priceOverride"
  | "send"
  | "guestCheck"
  | "payment"
  | "checkClose"
  | "checkCancel"
  | "checkReopen"
  | "checkTransfer"
  | "checkSplit"
  | "noSale"
  | "paidIn"
  | "paidOut"
  | "reprint"
  | "eightySix"
  | "managerAuth"
  | "report"
  | "endOfDay";

export const POS_EVENT_LABEL: Record<PosEventType, string> = {
  signIn: "Signed in",
  signInFailed: "Wrong PIN",
  lockout: "Locked out",
  unlock: "Unlocked employee",
  signOut: "Signed out",
  autoSignOut: "Signed out (inactivity)",
  clockIn: "Clocked in",
  clockOut: "Clocked out",
  rvcChange: "Changed revenue centre",
  checkBegin: "Began check",
  itemVoid: "Voided item",
  itemRemove: "Removed unsent item",
  discount: "Discount",
  priceOverride: "Price override",
  send: "Sent to kitchen",
  guestCheck: "Printed guest check",
  payment: "Payment",
  checkClose: "Closed check",
  checkCancel: "Cancelled check",
  checkReopen: "Reopened closed check",
  checkTransfer: "Transferred check",
  checkSplit: "Split check",
  noSale: "No sale (drawer opened)",
  paidIn: "Paid in",
  paidOut: "Paid out",
  reprint: "Reprinted bill",
  eightySix: "86 / back in stock",
  managerAuth: "Manager authorisation",
  report: "Printed report",
  endOfDay: "End of Day",
};

/** Events auditors look at first (exception reporting). */
export const EXCEPTION_EVENTS: PosEventType[] = ["itemVoid", "discount", "priceOverride", "checkCancel", "checkReopen", "noSale", "paidOut", "reprint", "managerAuth", "signInFailed", "lockout"];

export interface PosEvent extends Entity {
  at: string;
  businessDate: string;
  propertyId: string;
  rvcId: string;
  workstationId: string;
  /** Employee who performed the action. */
  employeeId: string;
  /** Senior employee who authorised it (manager override). */
  authorizedBy?: string;
  type: PosEventType;
  checkId?: string;
  checkNo?: number;
  amount?: Cents;
  qty?: number;
  itemId?: string;
  itemName?: string;
  reasonId?: string;
  reason?: string;
  detail?: string;
  prevHash: string;
  hash: string;
}

export type PosEventInput = Omit<PosEvent, "id" | "at" | "prevHash" | "hash" | "propertyId" | "workstationId" | "businessDate" | "rvcId"> & Partial<Pick<PosEvent, "rvcId" | "businessDate">>;

export function posEventHash(e: Omit<PosEvent, "hash">): Promise<string> {
  return sha256Hex(e.prevHash + canonicalJson(e));
}

/**
 * Writes one workstation's journal. Calls are queued so the chain stays in order even when the
 * cashier is quick; the last hash is read once when the POS starts.
 */
export class PosJournal {
  private queue: Promise<unknown> = Promise.resolve();
  private last: string | null = null;

  constructor(
    private readonly store: DocStore,
    private readonly base: { propertyId: string; workstationId: string; rvcId: string; businessDate: () => string },
  ) {}

  setRvc(rvcId: string): void {
    this.base.rvcId = rvcId;
  }

  private async lastHash(): Promise<string> {
    if (this.last !== null) return this.last;
    // The tip is the newest event no other event points back to (timestamps can tie).
    const recent = await this.store.list<PosEvent>(C.posJournal, { where: [["workstationId", "==", this.base.workstationId]], orderBy: ["at", "desc"], limit: 25 });
    const referenced = new Set(recent.map((e) => e.prevHash));
    const tip = recent.find((e) => !referenced.has(e.hash)) ?? recent[0];
    this.last = tip?.hash ?? "";
    return this.last;
  }

  log(input: PosEventInput): Promise<PosEvent> {
    const run = async () => {
      const prevHash = await this.lastHash();
      const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as PosEventInput;
      const e: Omit<PosEvent, "hash"> = {
        id: newId(),
        at: new Date().toISOString(),
        propertyId: this.base.propertyId,
        workstationId: this.base.workstationId,
        rvcId: this.base.rvcId,
        businessDate: this.base.businessDate(),
        ...clean,
        prevHash,
      };
      const full: PosEvent = { ...e, hash: await posEventHash(e) };
      await this.store.set(C.posJournal, full);
      this.last = full.hash;
      return full;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

/** Re-hashes events and walks each workstation's chain (same method as invoice chains). */
export async function verifyPosJournal(events: readonly PosEvent[]): Promise<{ severity: "critical"; message: string }[]> {
  const issues: { severity: "critical"; message: string }[] = [];
  const byWs = new Map<string, PosEvent[]>();
  for (const e of events) byWs.set(e.workstationId, [...(byWs.get(e.workstationId) ?? []), e]);
  for (const [ws, list] of byWs) {
    for (const e of list) {
      const { hash, ...rest } = e;
      if ((await posEventHash(rest)) !== hash) issues.push({ severity: "critical", message: `POS journal event ${e.id} (${e.type}) was altered` });
    }
    const byPrev = new Map<string, PosEvent[]>();
    for (const e of list) byPrev.set(e.prevHash, [...(byPrev.get(e.prevHash) ?? []), e]);
    const reached = new Set<string>();
    let cur = "";
    for (;;) {
      const next = (byPrev.get(cur) ?? []).filter((n) => !reached.has(n.id));
      if (!next.length) break;
      if (next.length > 1) issues.push({ severity: "critical", message: `POS journal of ${ws} forks (two devices using one workstation?)` });
      const n = next.sort((a, b) => a.at.localeCompare(b.at))[0]!;
      reached.add(n.id);
      cur = n.hash;
    }
    const orphans = list.filter((e) => !reached.has(e.id));
    if (orphans.length) issues.push({ severity: "critical", message: `POS journal of ${ws} is broken: ${orphans.length} event(s) not linked (an event was deleted)` });
  }
  return issues;
}

// ───────────────────────────── Reports from checks and the journal ─────────────────────────────

function addInto(target: Record<string, unknown>, inc: Increments): void {
  for (const [k, v] of Object.entries(inc)) {
    if (typeof v === "number") target[k] = ((target[k] as number | undefined) ?? 0) + v;
    else {
      const child = (target[k] as Record<string, unknown> | undefined) ?? {};
      addInto(child, v);
      target[k] = child;
    }
  }
}

/** Day totals for any set of closed checks (a revenue centre, an employee, a shift). */
export function aggregateChecks(checks: readonly Check[], ctx: Pick<PosContext, "categories">, label = "selection"): DailyStats {
  const out: Record<string, unknown> = {
    id: label, propertyId: "", businessDate: "", checks: 0, covers: 0, itemsTotal: 0, discounts: 0, netSales: 0, serviceCharge: 0, sscl: 0, tdl: 0, vat: 0, total: 0, rounding: 0,
    items: {}, categories: {}, majorGroups: {}, orderTypes: {}, hours: {}, tenders: {}, voids: { qty: 0, amount: 0 },
  };
  for (const c of checks) {
    if (c.status !== "closed" || !c.totals) continue;
    const op = statsIncrement(c, ctx, new Date(c.closedAt ?? c.openedAt));
    if (op.op === "increment") addInto(out, op.inc);
  }
  return out as unknown as DailyStats;
}

export interface EmployeeActivity {
  employeeId: string;
  checksClosed: number;
  netSales: Cents;
  collected: Record<string, Cents>;
  voids: { count: number; amount: Cents };
  discounts: { count: number; amount: Cents };
  priceOverrides: number;
  noSales: number;
  reprints: number;
  paidOut: Cents;
  paidIn: Cents;
  authorisationsGiven: number;
  failedSignIns: number;
}

/** Employee financial / exception summary from closed checks and journal events. */
export function employeeActivity(checks: readonly Check[], events: readonly PosEvent[]): EmployeeActivity[] {
  const by = new Map<string, EmployeeActivity>();
  const get = (id: string) => {
    let a = by.get(id);
    if (!a) {
      a = { employeeId: id, checksClosed: 0, netSales: 0, collected: {}, voids: { count: 0, amount: 0 }, discounts: { count: 0, amount: 0 }, priceOverrides: 0, noSales: 0, reprints: 0, paidOut: 0, paidIn: 0, authorisationsGiven: 0, failedSignIns: 0 };
      by.set(id, a);
    }
    return a;
  };
  for (const c of checks) {
    if (c.status !== "closed" || !c.totals) continue;
    const a = get(c.staffId);
    a.checksClosed += 1;
    a.netSales += c.totals.netSubtotal;
    for (const p of c.payments) {
      const who = get(p.by);
      who.collected[p.tenderId] = (who.collected[p.tenderId] ?? 0) + p.applied;
    }
  }
  for (const e of events) {
    const a = get(e.employeeId);
    if (e.type === "itemVoid") {
      a.voids.count += 1;
      a.voids.amount += e.amount ?? 0;
    } else if (e.type === "discount") {
      a.discounts.count += 1;
      a.discounts.amount += e.amount ?? 0;
    } else if (e.type === "priceOverride") a.priceOverrides += 1;
    else if (e.type === "noSale") a.noSales += 1;
    else if (e.type === "reprint") a.reprints += 1;
    else if (e.type === "paidOut") a.paidOut += e.amount ?? 0;
    else if (e.type === "paidIn") a.paidIn += e.amount ?? 0;
    else if (e.type === "signInFailed") a.failedSignIns += 1;
    if (e.authorizedBy && e.authorizedBy !== e.employeeId) get(e.authorizedBy).authorisationsGiven += 1;
  }
  return [...by.values()].sort((x, y) => y.netSales - x.netSales);
}

/** Cash expected in a drawer: cash tenders taken − change is already netted in `applied`, plus paid in − paid out. */
export function expectedCash(checks: readonly Check[], events: readonly PosEvent[], cashTenderIds: ReadonlySet<string>, employeeId?: string): Cents {
  let cash = 0;
  for (const c of checks) for (const p of c.status === "closed" ? c.payments : []) if (cashTenderIds.has(p.tenderId) && (!employeeId || p.by === employeeId)) cash += p.applied;
  for (const e of events) {
    if (employeeId && e.employeeId !== employeeId) continue;
    if (e.type === "paidIn") cash += e.amount ?? 0;
    if (e.type === "paidOut") cash -= e.amount ?? 0;
  }
  return cash;
}
