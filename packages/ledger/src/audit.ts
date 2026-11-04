/**
 * Audit trail and integrity verification.
 *
 * - Every change to business data becomes an AuditEvent (who, when, what changed, before/after),
 *   captured server-side by a Firestore trigger, so no client can skip or alter it.
 * - Events are sealed in batches: each seal hashes its events and the previous seal (a hash
 *   chain), so editing or deleting any past event is detectable.
 * - Posted vouchers carry their own hash chain; invoices carry a per-workstation chain.
 * - Verification recomputes all of it and reports any break, imbalance or numbering gap.
 */
import { type Invoice, type Member, type MemberRole, canonicalJson, invoiceHash, sha256Hex } from "@pos/core";
import { type Cents, parseInvoiceNumber } from "@pos/engine";
import type { PreparedLine } from "./posting.js";
import type { AccountBalance, LedgerEntry, Voucher } from "./types.js";

export interface AuditEvent {
  id: string;
  at: string;
  actorType: "user" | "service" | "system" | "unknown";
  actorId?: string;
  /** Where the identity came from: Firebase's verified auth context, or the write's audit stamp. */
  actorSource?: "auth" | "stamp";
  collection: string;
  docId: string;
  action: "create" | "update" | "delete";
  changedFields: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  hash: string;
}

export interface AuditSeal {
  id: string;
  seq: number;
  from: string;
  to: string;
  count: number;
  firstEventId: string;
  lastEventId: string;
  /** Exact events covered (ids are time-sortable but not unique in order within a millisecond). */
  eventIds: string[];
  /** SHA-256 over the ordered event hashes. */
  eventsDigest: string;
  prevSealHash: string;
  sealHash: string;
  at: string;
}

/** Collections whose changes are not audited one by one (append-only ledgers and counters). */
export const UNAUDITED = new Set(["ledger", "accountBalances", "ledgerHead", "numberSeries", "sequences", "dailyStats", "printJobs", "auditEvents", "auditSeals", "posJournal", "menuImages"]);

/** Fields that only describe bookkeeping noise and are left out of diffs. */
const NOISE = new Set(["updatedAt", "updatedBy"]);

export function diffDocs(before: Record<string, unknown> | null, after: Record<string, unknown> | null): Pick<AuditEvent, "action" | "changedFields" | "before" | "after"> {
  if (!before && after) return { action: "create", changedFields: Object.keys(after).filter((k) => !NOISE.has(k)).sort(), after };
  if (before && !after) return { action: "delete", changedFields: Object.keys(before).filter((k) => !NOISE.has(k)).sort(), before };
  const b = before ?? {};
  const a = after ?? {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => !NOISE.has(k) && canonicalJson(b[k]) !== canonicalJson(a[k])).sort();
  return {
    action: "update",
    changedFields: keys,
    before: Object.fromEntries(keys.filter((k) => k in b).map((k) => [k, b[k]])),
    after: Object.fromEntries(keys.filter((k) => k in a).map((k) => [k, a[k]])),
  };
}

export function auditEventHash(e: Omit<AuditEvent, "hash">): Promise<string> {
  return sha256Hex(canonicalJson(e));
}

/** Builds an event for a document change, or null when nothing meaningful changed. */
export async function makeAuditEvent(args: { id: string; at: string; actorType: AuditEvent["actorType"]; actorId?: string; actorSource?: AuditEvent["actorSource"]; collection: string; docId: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }): Promise<AuditEvent | null> {
  const d = diffDocs(args.before, args.after);
  if (d.action === "update" && d.changedFields.length === 0) return null;
  // Large blobs (logos) are recorded by size, not content.
  const trim = (o: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && v.length > 2000 ? `[${v.length} characters]` : v]));
  const base = {
    id: args.id,
    at: args.at,
    actorType: args.actorType,
    ...(args.actorId ? { actorId: args.actorId } : {}),
    ...(args.actorSource ? { actorSource: args.actorSource } : {}),
    collection: args.collection,
    docId: args.docId,
    action: d.action,
    changedFields: d.changedFields,
    ...(d.before ? { before: trim(d.before) } : {}),
    ...(d.after ? { after: trim(d.after) } : {}),
  };
  return { ...base, hash: await auditEventHash(base) };
}

/** Seals the next batch of events (ordered by id, which is time-sortable). */
export async function sealEvents(events: readonly AuditEvent[], prev: AuditSeal | null, now: string): Promise<AuditSeal | null> {
  if (!events.length) return null;
  const sorted = [...events].sort((a, b) => a.id.localeCompare(b.id));
  const eventsDigest = await sha256Hex(sorted.map((e) => e.hash).join(""));
  const seq = (prev?.seq ?? 0) + 1;
  const prevSealHash = prev?.sealHash ?? "";
  const body = { seq, from: sorted[0]!.at, to: sorted.at(-1)!.at, count: sorted.length, firstEventId: sorted[0]!.id, lastEventId: sorted.at(-1)!.id, eventIds: sorted.map((e) => e.id), eventsDigest, prevSealHash, at: now };
  return { id: `SEAL-${String(seq).padStart(8, "0")}`, ...body, sealHash: await sha256Hex(canonicalJson(body)) };
}

export interface IntegrityIssue {
  area: "audit trail" | "ledger" | "balances" | "numbering" | "invoices" | "POS journal" | "segregation of duties";
  severity: "critical" | "warning";
  message: string;
}

/** Re-hashes every event and seal and checks the seal chain is unbroken and complete. */
export async function verifyAuditTrail(events: readonly AuditEvent[], seals: readonly AuditSeal[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const sorted = [...events].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of sorted) {
    const { hash, ...rest } = e;
    if ((await auditEventHash(rest)) !== hash) issues.push({ area: "audit trail", severity: "critical", message: `Event ${e.id} (${e.collection}/${e.docId}) was altered after it was recorded` });
  }
  let prev: AuditSeal | null = null;
  for (const s of [...seals].sort((a, b) => a.seq - b.seq)) {
    const { id: _id, sealHash, ...body } = s;
    if ((await sha256Hex(canonicalJson(body))) !== sealHash) issues.push({ area: "audit trail", severity: "critical", message: `Seal ${s.id} was altered` });
    if (s.prevSealHash !== (prev?.sealHash ?? "")) issues.push({ area: "audit trail", severity: "critical", message: `Seal chain broken before ${s.id}` });
    if (prev && s.seq !== prev.seq + 1) issues.push({ area: "audit trail", severity: "critical", message: `Seal ${prev.seq + 1} is missing` });
    const byId = new Map(sorted.map((e) => [e.id, e]));
    const inSeal = s.eventIds.map((id) => byId.get(id));
    const missing = s.eventIds.filter((_, i) => !inSeal[i]);
    if (missing.length || s.eventIds.length !== s.count) issues.push({ area: "audit trail", severity: "critical", message: `Seal ${s.id}: ${missing.length} sealed event(s) no longer exist (events deleted)` });
    else if ((await sha256Hex(inSeal.map((e) => e!.hash).join(""))) !== s.eventsDigest) issues.push({ area: "audit trail", severity: "critical", message: `Events sealed in ${s.id} no longer match their seal` });
    prev = s;
  }
  // Events older than the latest seal must belong to a seal; anything else was inserted later.
  const sealedIds = new Set(seals.flatMap((s) => s.eventIds));
  const lastTo = [...seals].sort((a, b) => a.seq - b.seq).at(-1)?.to;
  const outside = lastTo ? sorted.filter((e) => !sealedIds.has(e.id) && e.at <= lastTo) : [];
  if (outside.length) issues.push({ area: "audit trail", severity: "warning", message: `${outside.length} event(s) dated inside sealed periods are not in any seal (recorded late, or inserted)` });
  return issues;
}

function linesForHash(entries: readonly LedgerEntry[]): PreparedLine[] {
  return [...entries]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((e) => ({
      account: e.account,
      debit: e.debit,
      credit: e.credit,
      debitFc: e.debitFc,
      creditFc: e.creditFc,
      currency: e.currency,
      rateMicros: e.exchangeRateMicros,
      costCenter: e.costCenter,
      ...(e.partyType ? { partyType: e.partyType } : {}),
      ...(e.partyId ? { partyId: e.partyId } : {}),
      ...(e.againstVoucherId ? { againstVoucherId: e.againstVoucherId } : {}),
      ...(e.memo ? { memo: e.memo } : {}),
    }));
}

/**
 * Ledger integrity: every posted voucher balanced and complete, the voucher hash chain intact,
 * pre-aggregated balances equal to the ledger, and debits equal to credits overall.
 */
export async function verifyLedger(vouchers: readonly Voucher[], entries: readonly LedgerEntry[], balances: readonly AccountBalance[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const byVoucher = new Map<string, LedgerEntry[]>();
  for (const e of entries) byVoucher.set(e.voucherId, [...(byVoucher.get(e.voucherId) ?? []), e]);
  const booked = vouchers.filter((v) => v.hash);
  for (const v of booked) {
    const lines = byVoucher.get(v.id) ?? [];
    const dr = lines.reduce((a, l) => a + l.debit, 0);
    const cr = lines.reduce((a, l) => a + l.credit, 0);
    if (!lines.length) issues.push({ area: "ledger", severity: "critical", message: `${v.number}: posted but has no ledger lines` });
    if (dr !== cr) issues.push({ area: "ledger", severity: "critical", message: `${v.number}: debits ${dr} ≠ credits ${cr}` });
    if (dr !== v.totalBase) issues.push({ area: "ledger", severity: "critical", message: `${v.number}: ledger total differs from the voucher total` });
    const expected = await sha256Hex((v.prevHash ?? "") + canonicalJson({ number: v.number, type: v.type, postingDate: v.postingDate, lines: linesForHash(lines), totalBase: v.totalBase }));
    if (expected !== v.hash) issues.push({ area: "ledger", severity: "critical", message: `${v.number}: posted content changed after posting (hash mismatch)` });
  }
  for (const id of byVoucher.keys()) if (!booked.some((v) => v.id === id)) issues.push({ area: "ledger", severity: "critical", message: `Ledger lines exist for unknown voucher ${id}` });
  // Hash chain: exactly one start, every hash referenced at most once.
  const next = new Map<string, Voucher[]>();
  for (const v of booked) next.set(v.prevHash ?? "", [...(next.get(v.prevHash ?? "") ?? []), v]);
  for (const [prev, list] of next) if (list.length > 1) issues.push({ area: "ledger", severity: "critical", message: `Voucher chain forks after ${prev ? prev.slice(0, 12) : "the start"}: ${list.map((v) => v.number).join(", ")}` });
  let cur = "";
  let walked = 0;
  while (next.get(cur)?.length === 1 && walked <= booked.length) {
    cur = next.get(cur)![0]!.hash!;
    walked++;
  }
  if (walked !== booked.length) issues.push({ area: "ledger", severity: "critical", message: `Voucher chain is broken: ${booked.length - walked} posted voucher(s) are not linked into it` });
  // Balances = ledger.
  const agg = new Map<string, { d: Cents; c: Cents }>();
  for (const e of entries) {
    const k = `${e.period}__${e.account}__${e.costCenter}`;
    const cur2 = agg.get(k) ?? { d: 0, c: 0 };
    agg.set(k, { d: cur2.d + e.debit, c: cur2.c + e.credit });
  }
  for (const b of balances) {
    const a = agg.get(b.id) ?? { d: 0, c: 0 };
    if (a.d !== b.debit || a.c !== b.credit) issues.push({ area: "balances", severity: "critical", message: `Balance ${b.id} (${b.debit}/${b.credit}) differs from the ledger (${a.d}/${a.c})` });
    agg.delete(b.id);
  }
  for (const k of agg.keys()) issues.push({ area: "balances", severity: "critical", message: `No balance record for ${k}` });
  const td = entries.reduce((a, e) => a + e.debit, 0);
  const tc = entries.reduce((a, e) => a + e.credit, 0);
  if (td !== tc) issues.push({ area: "ledger", severity: "critical", message: `Trial balance does not balance: debits ${td}, credits ${tc}` });
  return issues;
}

/**
 * Re-hashes issued invoices and walks each workstation's chain from its first invoice by following
 * the `prevHash` links (the order invoices were issued, which client clocks can't disturb). An
 * altered invoice fails its own hash and breaks the link to the next one; a deleted or inserted
 * one leaves invoices that can't be reached from the start of the chain, or a fork.
 */
export async function verifyInvoices(invoices: readonly Invoice[]): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const byWs = new Map<string, Invoice[]>();
  for (const i of invoices) byWs.set(i.workstationId, [...(byWs.get(i.workstationId) ?? []), i]);
  for (const [ws, list] of byWs) {
    for (const inv of list) if ((await invoiceHash(inv)) !== inv.hash) issues.push({ area: "invoices", severity: "critical", message: `Invoice ${inv.id} was altered after it was issued` });
    const byPrev = new Map<string, Invoice[]>();
    for (const inv of list) byPrev.set(inv.prevHash, [...(byPrev.get(inv.prevHash) ?? []), inv]);
    const reached = new Set<string>();
    let cur = "";
    for (;;) {
      const next = (byPrev.get(cur) ?? []).filter((n) => !reached.has(n.id));
      if (!next.length) break;
      if (next.length > 1) issues.push({ area: "invoices", severity: "critical", message: `Invoice chain of ${ws} forks after ${cur ? (list.find((i) => i.hash === cur)?.id ?? "?") : "the start"}: ${next.map((n) => n.id).join(", ")}` });
      const n = next.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))[0]!;
      reached.add(n.id);
      cur = n.hash;
    }
    const orphans = list.filter((i) => !reached.has(i.id)).sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
    if (orphans.length) {
      // Report where the break is: an invoice whose predecessor is missing.
      const hashes = new Set(list.map((i) => i.hash));
      const at = orphans.find((i) => !hashes.has(i.prevHash)) ?? orphans[0]!;
      issues.push({ area: "invoices", severity: "critical", message: `Invoice chain of ${ws} broken at ${at.id} (${orphans.length} invoice(s) not linked to the chain)` });
    }
  }
  return issues;
}

export interface Gap {
  series: string;
  missing: string[];
}

/**
 * Missing numbers in each series. Understands voucher numbers (JV-2627-00012) and IRD invoice
 * numbers (26NOV_W01_42, a series per month and workstation).
 */
export function sequenceGaps(numbers: readonly string[]): Gap[] {
  const series = new Map<string, { prefix: string; nums: number[]; width: number; ird: boolean }>();
  for (const n of numbers) {
    const ird = parseInvoiceNumber(n);
    if (ird) {
      const key = `${String(ird.year % 100).padStart(2, "0")}${["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][ird.month - 1]}_${ird.classificationCode}`;
      const s = series.get(key) ?? { prefix: `${key}_`, nums: [], width: 0, ird: true };
      s.nums.push(ird.sequence);
      series.set(key, s);
      continue;
    }
    const m = /^(.*?)(\d+)$/.exec(n);
    if (!m) continue;
    const key = m[1]!;
    const s = series.get(key) ?? { prefix: key, nums: [], width: m[2]!.length, ird: false };
    s.nums.push(Number(m[2]));
    series.set(key, s);
  }
  const out: Gap[] = [];
  for (const [key, s] of series) {
    const sorted = [...new Set(s.nums)].sort((a, b) => a - b);
    const missing: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      for (let k = sorted[i - 1]! + 1; k < sorted[i]! && missing.length < 200; k++) missing.push(`${s.prefix}${s.ird ? k : String(k).padStart(s.width, "0")}`);
    }
    if (missing.length) out.push({ series: key, missing });
  }
  return out;
}

/** Incompatible duties (preparer vs approver vs custodian), the basis of the SoD review. */
export const SOD_RULES: { id: string; duties: [string, string]; risk: string }[] = [
  { id: "SOD-01", duties: ["Maintain suppliers", "Post supplier payments"], risk: "Payments to a fictitious or altered supplier" },
  { id: "SOD-02", duties: ["Receive goods", "Approve supplier invoices"], risk: "Paying for goods never received" },
  { id: "SOD-03", duties: ["Manage logins and roles", "Post journals"], risk: "Granting oneself rights to post and hide entries" },
  { id: "SOD-04", duties: ["Handle cash at the POS", "Post journals"], risk: "Concealing cash shortages through journals" },
];

const DUTIES: Record<MemberRole, string[]> = {
  owner: ["Maintain suppliers", "Post supplier payments", "Receive goods", "Approve supplier invoices", "Manage logins and roles", "Post journals"],
  admin: ["Maintain suppliers", "Post supplier payments", "Receive goods", "Approve supplier invoices", "Manage logins and roles", "Post journals"],
  manager: ["Maintain suppliers", "Receive goods", "Handle cash at the POS"],
  accountant: ["Post supplier payments", "Approve supplier invoices", "Post journals"],
  storekeeper: ["Maintain suppliers", "Receive goods"],
  auditor: [],
  viewer: [],
  terminal: ["Handle cash at the POS"],
};

export interface SodFinding {
  rule: (typeof SOD_RULES)[number];
  member: Pick<Member, "uid" | "email" | "name" | "role">;
  mitigation: string;
}

export function sodConflicts(members: readonly Pick<Member, "uid" | "email" | "name" | "role">[]): SodFinding[] {
  const out: SodFinding[] = [];
  for (const m of members) {
    const duties = new Set(DUTIES[m.role] ?? []);
    for (const rule of SOD_RULES) {
      if (duties.has(rule.duties[0]) && duties.has(rule.duties[1])) {
        out.push({ rule, member: m, mitigation: m.role === "owner" || m.role === "admin" ? "Owner/administrator access: mitigated by second-person approval of journals and payments and by periodic review of the audit trail." : "Split the duties between two people or add a reviewing control." });
      }
    }
  }
  return out;
}

/** Vouchers approved by their own preparer (should be impossible; reported if data was altered). */
export function sodViolations(vouchers: readonly Voucher[]): IntegrityIssue[] {
  return vouchers
    .filter((v) => v.approvedBy && (v.approvedBy === v.createdBy || v.approvedBy === v.submittedBy))
    .map((v) => ({ area: "segregation of duties" as const, severity: "critical" as const, message: `${v.number} was approved by its own preparer` }));
}

export function totalsCheck(entries: readonly LedgerEntry[]): { debit: Cents; credit: Cents } {
  return { debit: entries.reduce((a, e) => a + e.debit, 0), credit: entries.reduce((a, e) => a + e.credit, 0) };
}
