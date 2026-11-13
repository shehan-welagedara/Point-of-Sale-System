import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  type Account,
  type Check,
  type Customer,
  type HealthIssue,
  type Invoice,
  type Member,
  type MemberRole,
  type PosEvent,
  type Staff,
  type Vendor,
  type Workstation,
  COLLECTIONS as C,
  EXCEPTION_EVENTS,
  HEALTH_COLLECTIONS,
  MEMBER_ROLE_INFO,
  POS_EVENT_LABEL,
  type PosEventType,
  dataHealth,
  employeeActivity,
  PRODUCT_FULL_NAME,
} from "@pos/core";
import {
  type AccountBalance,
  type AuditEvent,
  type AuditSeal,
  type IntegrityReport,
  type LedgerEntry,
  type Voucher,
  type VoucherType,
  LEDGER as L,
  SOD_RULES,
  generateSaft,
  sequenceGaps,
  sodConflicts,
  sodViolations,
  trialBalance,
} from "@pos/ledger";
import { DEMO_PEOPLE } from "@pos/sample-data";
import { APP_VERSION } from "../../lib/version";
import { tablesToWorkbook } from "../../lib/excel";
import { Drawer, Field, Loading, PageHead, Seg, Stat, Explain } from "../../components/ui";
import { amount, dateTimeColombo, downloadBuffer, money, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { TYPE_LABEL, useFiscal, useLedgerAction } from "../finance/shared";

type Tab = "integrity" | "trail" | "journal" | "exceptions" | "quality" | "numbering" | "sod" | "access" | "exports";

const AUDIT_ROLES: MemberRole[] = ["owner", "admin", "auditor"];

function show(v: unknown): string {
  if (v === undefined) return "—";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 1);
}

function useMembers(): Pick<Member, "uid" | "email" | "name" | "role">[] {
  const { mode } = useApp();
  const members = useCollection<Member>(C.members) ?? [];
  if (mode === "local" && !members.length) return Object.values(DEMO_PEOPLE).map((p) => ({ uid: p.uid, email: `${p.uid}@demo.local`, name: p.name, role: p.role as MemberRole }));
  return members;
}

// ───────────────────────────── Integrity ─────────────────────────────

function IntegrityTab() {
  const { role, personName } = useApp();
  const { run, busy } = useLedgerAction();
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const seals = useCollection<AuditSeal>(L.auditSeals, { orderBy: ["seq", "desc"], limit: 20 }) ?? [];
  return (
    <div className="stack">
      <div className="row wrap">
        <button className="btn primary" disabled={busy} onClick={() => run<IntegrityReport>({ action: "verify" }, (r) => (r.ok ? "Integrity check passed" : "Integrity check found problems")).then((r) => r && setReport(r))}>
          {busy ? "Checking…" : "Run integrity check"}
        </button>
        {AUDIT_ROLES.includes(role as MemberRole) ? (
          <button className="btn" disabled={busy} onClick={() => run<AuditSeal | null>({ action: "seal" }, (s) => (s ? `Sealed ${s.count} event(s) as seal #${s.seq}` : "Nothing new to seal"))}>Seal audit trail now</button>
        ) : null}
      </div>
      <Explain>
        The check recomputes, on the server, every hash in the voucher chain, every invoice chain and every sealed batch of the audit trail; checks that each document's ledger lines balance and match the stored account balances; looks for gaps in every number series; and confirms no one approved their own document. Any edit made outside the application – even directly in the Firebase console – breaks a hash and is reported here.
      </Explain>
      {report ? (
        <>
          <div className={`callout ${report.ok ? "good" : "bad"}`}>
            <strong>{report.ok ? "No critical findings." : `${report.issues.filter((i) => i.severity === "critical").length} critical finding(s).`}</strong> Checked {dateTimeColombo(report.checkedAt)} by {personName(report.checkedBy)}.
          </div>
          <div className="grid cols-4">
            <Stat label="Posted documents" value={report.counts.vouchers} />
            <Stat label="Ledger lines" value={report.counts.ledgerLines} />
            <Stat label="POS invoices" value={report.counts.invoices} />
            <Stat label="Audit events" value={report.counts.auditEvents} sub={`${report.counts.seals} seals · ${report.counts.unsealedEvents} not yet sealed · ${report.counts.posEvents ?? 0} POS journal events`} />
          </div>
          <div className="card table-wrap">
            <div className="card-head"><h3>Findings</h3></div>
            <table className="table">
              <thead><tr><th>Area</th><th>Severity</th><th>Finding</th></tr></thead>
              <tbody>
                {report.issues.map((i, n) => <tr key={n}><td>{i.area}</td><td><span className={`badge ${i.severity === "critical" ? "bad" : "warn"}`}>{i.severity}</span></td><td>{i.message}</td></tr>)}
                {report.gaps.map((g) => <tr key={g.series}><td>numbering</td><td><span className="badge warn">gap</span></td><td>{g.series}: missing {g.missing.slice(0, 10).join(", ")}{g.missing.length > 10 ? ` and ${g.missing.length - 10} more` : ""}</td></tr>)}
                {!report.issues.length && !report.gaps.length ? <tr><td colSpan={3} className="muted">None.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      <div className="card table-wrap">
        <div className="card-head"><h3>Audit trail seals</h3><span className="small muted">Sealed hourly by the server; each seal hashes its events and the previous seal</span></div>
        <table className="table">
          <thead><tr><th>#</th><th>Covers</th><th className="num">Events</th><th>Seal hash</th></tr></thead>
          <tbody>
            {seals.map((s) => (
              <tr key={s.id}>
                <td>{s.seq}</td>
                <td className="small">{dateTimeColombo(s.from)} – {dateTimeColombo(s.to)}</td>
                <td className="num">{s.count}</td>
                <td className="mono tiny">{s.sealHash.slice(0, 24)}…</td>
              </tr>
            ))}
            {!seals.length ? <tr><td colSpan={4} className="muted">No seals yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────────── Audit trail ─────────────────────────────

function EventDetail({ e, onClose }: { e: AuditEvent; onClose: () => void }) {
  const { personName } = useApp();
  const fields = e.action === "update" ? e.changedFields : Object.keys((e.after ?? e.before) ?? {}).filter((k) => k !== "updatedAt" && k !== "updatedBy").sort();
  return (
    <Drawer title={`${e.action} ${e.collection}/${e.docId}`} onClose={onClose}>
      <div className="stack">
        <div className="grid cols-2 small">
          <div>When: <strong>{dateTimeColombo(e.at)}</strong></div>
          <div>Who: <strong>{e.actorType === "user" ? personName(e.actorId) : e.actorType}</strong>{e.actorSource ? <span className="muted"> ({e.actorSource === "auth" ? "verified sign-in" : "write stamp"})</span> : null}</div>
          <div>Document: <strong className="mono">{e.collection}/{e.docId}</strong></div>
          <div>Event id: <span className="mono tiny">{e.id}</span></div>
        </div>
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f}>
                  <td className="mono small">{f}</td>
                  <td className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--bad)" }}>{show(e.before?.[f])}</td>
                  <td className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--good)" }}>{show(e.after?.[f])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Field label="Event hash"><span className="mono tiny" style={{ wordBreak: "break-all" }}>{e.hash}</span></Field>
      </div>
    </Drawer>
  );
}

function TrailTab() {
  const { personName } = useApp();
  const [params, setParams] = useSearchParams();
  const doc = params.get("doc") ?? "";
  const events = useCollection<AuditEvent>(L.auditEvents, doc ? { where: [["docId", "==", doc]] } : { orderBy: ["at", "desc"], limit: 500 });
  const [col, setCol] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<AuditEvent | null>(null);
  const list = (events ?? []).slice().sort((a, b) => b.at.localeCompare(a.at));
  const cols = [...new Set(list.map((e) => e.collection))].sort();
  const actors = [...new Set(list.map((e) => e.actorId ?? e.actorType))];
  const shown = list.filter((e) => (!col || e.collection === col) && (!actor || (e.actorId ?? e.actorType) === actor) && (!action || e.action === action) && (!q || `${e.docId} ${e.changedFields.join(" ")}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="stack">
      <div className="row wrap">
        {doc ? <span className="badge info">Document {doc} <button className="btn ghost sm" onClick={() => setParams({ tab: "trail" })}>✕</button></span> : <span className="small muted">Latest 500 changes</span>}
        <select className="select" value={col} onChange={(e) => setCol(e.target.value)} style={{ maxWidth: 180 }}><option value="">All data</option>{cols.map((c) => <option key={c}>{c}</option>)}</select>
        <select className="select" value={actor} onChange={(e) => setActor(e.target.value)} style={{ maxWidth: 200 }}><option value="">Everyone</option>{actors.map((a) => <option key={a} value={a}>{personName(a)}</option>)}</select>
        <select className="select" value={action} onChange={(e) => setAction(e.target.value)} style={{ maxWidth: 140 }}><option value="">Any action</option><option>create</option><option>update</option><option>delete</option></select>
        <input className="input" placeholder="Document id or field" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 220 }} />
      </div>
      <div className="card table-wrap">
        {!events ? (
          <Loading />
        ) : (
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Data</th><th>Document</th><th>Fields changed</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setOpen(e)}>
                  <td className="small">{dateTimeColombo(e.at)}</td>
                  <td>{e.actorType === "user" ? personName(e.actorId) : <span className="muted">{e.actorType}</span>}</td>
                  <td><span className={`badge ${e.action === "delete" ? "bad" : e.action === "create" ? "good" : ""}`}>{e.action}</span></td>
                  <td className="muted">{e.collection}</td>
                  <td className="mono small">{e.docId}</td>
                  <td className="small muted">{e.changedFields.slice(0, 5).join(", ")}{e.changedFields.length > 5 ? "…" : ""}</td>
                </tr>
              ))}
              {!shown.length ? <tr><td colSpan={6} className="muted">No changes recorded.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
      {open ? <EventDetail e={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

// ───────────────────────────── POS transaction journal ─────────────────────────────

function useRange() {
  const [from, setFrom] = useState(todayColombo());
  const [to, setTo] = useState(todayColombo());
  const ui = (
    <>
      <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
      <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
    </>
  );
  return { from, to, ui };
}

function JournalTab() {
  const { from, to, ui } = useRange();
  const events = useCollection<PosEvent>(C.posJournal, { where: [["businessDate", ">=", from], ["businessDate", "<=", to]] });
  const staff = useCollection<Staff>(C.staff) ?? [];
  const workstations = useCollection<Workstation>(C.workstations) ?? [];
  const [ws, setWs] = useState("");
  const [emp, setEmp] = useState("");
  const [type, setType] = useState("");
  const [onlyExceptions, setOnlyExceptions] = useState(false);
  const name = (id?: string) => staff.find((x) => x.id === id)?.name ?? id ?? "";
  const rows = (events ?? [])
    .filter((e) => (!ws || e.workstationId === ws) && (!emp || e.employeeId === emp || e.authorizedBy === emp) && (!type || e.type === type) && (!onlyExceptions || EXCEPTION_EVENTS.includes(e.type)))
    .sort((a, b) => b.at.localeCompare(a.at));
  async function exportXlsx() {
    const buf = await tablesToWorkbook([{ name: "POS journal", title: `POS transaction journal ${from} to ${to}`, rows, columns: [
      { header: "Time", value: (e) => e.at, width: 22 }, { header: "Business date", value: (e) => e.businessDate }, { header: "Workstation", value: (e) => e.workstationId }, { header: "Revenue centre", value: (e) => e.rvcId },
      { header: "Event", value: (e) => POS_EVENT_LABEL[e.type as PosEventType], width: 22 }, { header: "Employee", value: (e) => name(e.employeeId), width: 20 }, { header: "Approved by", value: (e) => name(e.authorizedBy), width: 20 },
      { header: "Check", value: (e) => e.checkNo ?? "" }, { header: "Item", value: (e) => e.itemName ?? "", width: 24 }, { header: "Qty", value: (e) => e.qty ?? "", format: "number" }, { header: "Amount", value: (e) => e.amount, format: "money", width: 14 },
      { header: "Reason", value: (e) => e.reason ?? "", width: 20 }, { header: "Detail", value: (e) => e.detail ?? "", width: 30 }, { header: "Hash", value: (e) => e.hash, width: 30 },
    ] }]);
    downloadBuffer(buf, `pos-journal-${from}-${to}.xlsx`);
  }
  return (
    <div className="stack">
      <Explain>Every operator action on every workstation: sign-ins and failed PINs, checks begun, sent and closed, voids, discounts, price overrides, refunds, no-sales, paid in/out, reprints and manager approvals. Each workstation's events are hash-chained; the integrity check proves none were changed or removed.</Explain>
      <div className="row wrap">
        {ui}
        <Field label="Workstation"><select className="select" value={ws} onChange={(e) => setWs(e.target.value)}><option value="">All</option>{workstations.map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
        <Field label="Employee"><select className="select" value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">Everyone</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Event"><select className="select" value={type} onChange={(e) => setType(e.target.value)}><option value="">All events</option>{(Object.keys(POS_EVENT_LABEL) as PosEventType[]).map((t) => <option key={t} value={t}>{POS_EVENT_LABEL[t]}</option>)}</select></Field>
        <label className="row small" style={{ alignSelf: "flex-end", gap: 6 }}><input type="checkbox" checked={onlyExceptions} onChange={(e) => setOnlyExceptions(e.target.checked)} /> Exceptions only</label>
        <button className="btn" style={{ alignSelf: "flex-end" }} onClick={exportXlsx}>Export</button>
      </div>
      <div className="card table-wrap">
        {!events ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Time</th><th>WS</th><th>Event</th><th>Employee</th><th>Approved by</th><th>Check</th><th>Detail</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {rows.slice(0, 1000).map((e) => (
                <tr key={e.id}>
                  <td className="small">{dateTimeColombo(e.at)}</td>
                  <td className="mono small">{e.workstationId}</td>
                  <td><span className={`badge ${EXCEPTION_EVENTS.includes(e.type) ? "warn" : ""}`}>{POS_EVENT_LABEL[e.type]}</span></td>
                  <td>{name(e.employeeId)}</td>
                  <td>{name(e.authorizedBy)}</td>
                  <td>{e.checkNo ? `#${e.checkNo}` : ""}</td>
                  <td className="small">{[e.itemName, e.qty ? `× ${e.qty}` : "", e.reason, e.detail].filter(Boolean).join(" · ")}</td>
                  <td className="num">{e.amount !== undefined ? money(e.amount) : ""}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={8} className="muted">No events in this range.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ExceptionsTab() {
  const { from, to, ui } = useRange();
  const events = useCollection<PosEvent>(C.posJournal, { where: [["businessDate", ">=", from], ["businessDate", "<=", to]] }) ?? [];
  const checks = useCollection<Check>(C.checks, { where: [["businessDate", ">=", from], ["businessDate", "<=", to]] }) ?? [];
  const staff = useCollection<Staff>(C.staff) ?? [];
  const name = (id?: string) => staff.find((x) => x.id === id)?.name ?? id ?? "";
  const rows = employeeActivity(checks.filter((c) => c.status === "closed"), events);
  const pct = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(1)}%` : "");
  async function exportXlsx() {
    const buf = await tablesToWorkbook([{ name: "Exceptions", title: `Exceptions by employee ${from} to ${to}`, totals: true, rows, columns: [
      { header: "Employee", value: (r) => name(r.employeeId), width: 24 }, { header: "Checks", value: (r) => r.checksClosed, format: "number" }, { header: "Net sales", value: (r) => r.netSales, format: "money", width: 14 },
      { header: "Voids", value: (r) => r.voids.count, format: "number" }, { header: "Void value", value: (r) => r.voids.amount, format: "money", width: 14 }, { header: "Discounts", value: (r) => r.discounts.count, format: "number" }, { header: "Discount value", value: (r) => r.discounts.amount, format: "money", width: 14 },
      { header: "Price overrides", value: (r) => r.priceOverrides, format: "number" }, { header: "No sales", value: (r) => r.noSales, format: "number" }, { header: "Reprints", value: (r) => r.reprints, format: "number" }, { header: "Paid out", value: (r) => r.paidOut, format: "money" }, { header: "Wrong PINs", value: (r) => r.failedSignIns, format: "number" }, { header: "Approvals given", value: (r) => r.authorisationsGiven, format: "number" },
    ] }]);
    downloadBuffer(buf, `exceptions-${from}-${to}.xlsx`);
  }
  return (
    <div className="stack">
      <Explain>Loss-prevention view: voids, discounts and drawer openings by employee against their sales. High void or discount rates, frequent no-sales and approvals concentrated on one manager are the classic red flags.</Explain>
      <div className="row wrap">{ui}<button className="btn" style={{ alignSelf: "flex-end" }} onClick={exportXlsx}>Export</button></div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Employee</th><th className="num">Checks</th><th className="num">Net sales</th><th className="num">Voids</th><th className="num">Void %</th><th className="num">Discounts</th><th className="num">Disc. %</th><th className="num">Overrides</th><th className="num">No sales</th><th className="num">Reprints</th><th className="num">Paid out</th><th className="num">Wrong PINs</th><th className="num">Approvals given</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.employeeId}>
                <td>{name(r.employeeId)}</td>
                <td className="num">{r.checksClosed}</td>
                <td className="num">{amount(r.netSales)}</td>
                <td className="num">{r.voids.count ? `${r.voids.count} · ${amount(r.voids.amount)}` : ""}</td>
                <td className="num">{pct(r.voids.amount, r.netSales + r.voids.amount)}</td>
                <td className="num">{r.discounts.count ? `${r.discounts.count} · ${amount(r.discounts.amount)}` : ""}</td>
                <td className="num">{pct(r.discounts.amount, r.netSales + r.discounts.amount)}</td>
                <td className="num">{r.priceOverrides || ""}</td>
                <td className="num">{r.noSales || ""}</td>
                <td className="num">{r.reprints || ""}</td>
                <td className="num">{r.paidOut ? amount(r.paidOut) : ""}</td>
                <td className="num">{r.failedSignIns || ""}</td>
                <td className="num">{r.authorisationsGiven || ""}</td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={13} className="muted">No activity in this range.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────────── Data quality ─────────────────────────────

const FIX_LINK: Record<string, string> = {
  menuItems: "/emc/menu/items", menuCategories: "/emc/menu/categories", modifierGroups: "/emc/menu/modifiers", recipes: "/emc/recipes", staff: "/emc/people/staff", roles: "/emc/people/roles",
  workstations: "/emc/setup/devices", printers: "/emc/setup/devices", revenueCenters: "/emc/setup/organisation", properties: "/emc/setup/organisation", tables: "/emc/pos/tables", tenderMedia: "/emc/pos/tenders",
  discounts: "/emc/pos/discounts", inventoryItems: "/emc/inventory/items", vendors: "/emc/inventory/vendors", purchaseOrders: "/emc/inventory/po", goodsReceipts: "/emc/inventory/grn", accounts: "/emc/finance/accounts", settings: "/emc/finance/settings", customers: "/emc/crm/customers",
};

function QualityTab() {
  const { store, tenant, toast } = useApp();
  const [issues, setIssues] = useState<HealthIssue[] | null>(null);
  const [checked, setChecked] = useState<{ at: string; docs: number } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!store) return;
    setBusy(true);
    try {
      const snapshot = Object.fromEntries(await Promise.all(HEALTH_COLLECTIONS.map(async (col) => [col, await store.list<Record<string, unknown>>(col)] as const)));
      setIssues(dataHealth(snapshot, tenant?.modules ?? {}));
      setChecked({ at: new Date().toISOString(), docs: Object.values(snapshot).reduce((a, l) => a + l.length, 0) });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const byModule = new Map<string, { errors: number; warnings: number }>();
  for (const i of issues ?? []) {
    const m = byModule.get(i.module) ?? { errors: 0, warnings: 0 };
    if (i.severity === "error") m.errors++;
    else m.warnings++;
    byModule.set(i.module, m);
  }
  return (
    <div className="stack">
      <Explain>Validates every master record in every module against its rules (types, ranges, formats) and checks every link between modules: items to categories and modifiers, recipes to stock items (including circular prep recipes), staff to roles, properties and revenue centres, workstations to revenue centres and printers, purchase documents to vendors and stock, tenders and mappings to ledger accounts, duplicate codes, cards and employee numbers. New and edited records are also validated as they are saved.</Explain>
      <div className="row wrap">
        <button className="btn primary" disabled={busy} onClick={run}>{busy ? "Checking…" : "Run data quality check"}</button>
        {checked ? <span className="small muted">{checked.docs} records checked {dateTimeColombo(checked.at)}</span> : null}
      </div>
      {issues ? (
        <>
          <div className={`callout ${issues.some((i) => i.severity === "error") ? "bad" : issues.length ? "warn" : "good"}`}>
            {issues.length ? `${issues.filter((i) => i.severity === "error").length} error(s) and ${issues.filter((i) => i.severity === "warning").length} warning(s).` : "No issues: every record is valid and every reference resolves."}
          </div>
          {byModule.size ? <div className="grid cols-4">{[...byModule].map(([m, c]) => <Stat key={m} label={m} value={c.errors + c.warnings} sub={`${c.errors} errors · ${c.warnings} warnings`} {...(c.errors ? { tone: "bad" as const } : { tone: "warn" as const })} />)}</div> : null}
          {issues.length ? (
            <div className="card table-wrap">
              <table className="table">
                <thead><tr><th>Severity</th><th>Module</th><th>Record</th><th>Issue</th><th /></tr></thead>
                <tbody>
                  {issues.map((i, n) => (
                    <tr key={n}>
                      <td><span className={`badge ${i.severity === "error" ? "bad" : "warn"}`}>{i.severity}</span></td>
                      <td>{i.module}</td>
                      <td className="mono small">{i.collection}/{i.id}</td>
                      <td>{i.message}</td>
                      <td>{FIX_LINK[i.collection] ? <a href={FIX_LINK[i.collection]}>Fix →</a> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Numbering ─────────────────────────────

function NumberingTab() {
  const vouchers = useCollection<Voucher>(L.vouchers) ?? [];
  const invoices = useCollection<Invoice>(C.invoices) ?? [];
  const series = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of vouchers) if (v.number) m.set(v.number.replace(/-\d+$/, ""), [...(m.get(v.number.replace(/-\d+$/, "")) ?? []), v.number]);
    for (const i of invoices) {
      const key = i.id.replace(/_\d+$/, "");
      m.set(key, [...(m.get(key) ?? []), i.id]);
    }
    return [...m].map(([k, nums]) => ({ k, count: nums.length, first: nums.sort()[0], last: nums[nums.length - 1], gaps: sequenceGaps(nums).flatMap((g) => g.missing) })).sort((a, b) => a.k.localeCompare(b.k));
  }, [vouchers, invoices]);
  return (
    <div className="stack">
      <Explain>Accounting documents get their number only when they post, from a counter updated in the same transaction, so drafts and rejected documents never leave holes. POS tax invoices are numbered per workstation and month as the IRD requires. Any missing number is listed here and in the integrity check.</Explain>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Series</th><th className="num">Issued</th><th>First</th><th>Last</th><th>Missing</th></tr></thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.k}>
                <td className="mono">{s.k}</td>
                <td className="num">{s.count}</td>
                <td className="mono small">{s.first}</td>
                <td className="mono small">{s.last}</td>
                <td>{s.gaps.length ? <span className="badge bad">{s.gaps.slice(0, 5).join(", ")}{s.gaps.length > 5 ? "…" : ""}</span> : <span className="badge good">none</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────────── Segregation of duties ─────────────────────────────

function SodTab() {
  const members = useMembers();
  const vouchers = useCollection<Voucher>(L.vouchers) ?? [];
  const conflicts = sodConflicts(members);
  const violations = sodViolations(vouchers);
  const selfPosted = vouchers.filter((v) => v.status === "posted" && !v.approvedBy && (v.type === "journal" || v.type === "payment"));
  return (
    <div className="stack">
      <div className="card table-wrap">
        <div className="card-head"><h3>Rules</h3></div>
        <table className="table">
          <thead><tr><th>Rule</th><th>Incompatible duties</th><th>Risk</th></tr></thead>
          <tbody>{SOD_RULES.map((r) => <tr key={r.id}><td className="mono">{r.id}</td><td>{r.duties[0]} ↔ {r.duties[1]}</td><td className="muted">{r.risk}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="card table-wrap">
        <div className="card-head"><h3>People holding conflicting duties</h3></div>
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Rule</th><th>Mitigation</th></tr></thead>
          <tbody>
            {conflicts.map((c, i) => <tr key={i}><td>{c.member.name || c.member.email}</td><td>{MEMBER_ROLE_INFO[c.member.role]?.label ?? c.member.role}</td><td className="mono">{c.rule.id}</td><td className="small muted">{c.mitigation}</td></tr>)}
            {!conflicts.length ? <tr><td colSpan={4} className="muted">No conflicts.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className={`callout ${violations.length ? "bad" : "good"}`}>{violations.length ? violations.map((v) => <div key={v.message}>{v.message}</div>) : "No document was approved by its own preparer (enforced by the server)."}</div>
      <div className="callout small">{selfPosted.length} manual journal(s) or payment(s) posted without a second approver because they were below the approval limits set in Finance settings. Review the limits as part of the controls assessment.</div>
    </div>
  );
}

// ───────────────────────────── Access review ─────────────────────────────

function AccessTab() {
  const members = useMembers();
  const events = useCollection<AuditEvent>(L.auditEvents, { orderBy: ["at", "desc"], limit: 2000 }) ?? [];
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const rows = members.map((m) => {
    const mine = events.filter((e) => e.actorId === m.uid);
    return { m, last: mine[0]?.at, changes30: mine.filter((e) => e.at >= since).length };
  });
  async function exportXlsx() {
    const buf = await tablesToWorkbook([{ name: "Access review", title: `User access review ${todayColombo()}`, rows, columns: [{ header: "Name", value: (r) => r.m.name, width: 26 }, { header: "Email", value: (r) => r.m.email, width: 30 }, { header: "Role", value: (r) => MEMBER_ROLE_INFO[r.m.role as MemberRole]?.label ?? r.m.role }, { header: "Access", value: (r) => MEMBER_ROLE_INFO[r.m.role as MemberRole]?.description ?? "", width: 60 }, { header: "Last change", value: (r) => r.last ?? "" , width: 22 }, { header: "Changes (30 days)", value: (r) => r.changes30, format: "number" }, { header: "Reviewer decision", value: () => "" , width: 20 }] }]);
    downloadBuffer(buf, `access-review-${todayColombo()}.xlsx`);
  }
  return (
    <div className="stack">
      <div className="row between"><span className="small muted">Back-office logins and what they can do. Export, have the owner sign off each line, and keep it with the audit file.</span><button className="btn" onClick={exportXlsx}>Export for review</button></div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Access</th><th>Last change</th><th className="num">Changes (30 days)</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.m.uid}>
                <td>{r.m.name}<div className="tiny muted">{r.m.email}</div></td>
                <td>{MEMBER_ROLE_INFO[r.m.role as MemberRole]?.label ?? r.m.role}</td>
                <td className="small muted">{MEMBER_ROLE_INFO[r.m.role as MemberRole]?.description}</td>
                <td className="small">{r.last ? dateTimeColombo(r.last) : "—"}</td>
                <td className="num">{r.changes30}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">POS staff (cashiers, waiters) sign in with PINs and are reviewed under People → POS staff; their actions are in the audit trail of checks and invoices.</p>
    </div>
  );
}

// ───────────────────────────── Exports ─────────────────────────────

function ExportsTab() {
  const { store, settings, toast, personName } = useApp();
  const fiscal = useFiscal();
  const members = useMembers();
  const [from, setFrom] = useState(fiscal.current?.start ?? `${todayColombo().slice(0, 4)}-04-01`);
  const [to, setTo] = useState(todayColombo());
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!store) throw new Error("no store");
    const [accounts, balances, entries, vouchers, customers, suppliers, events] = await Promise.all([
      store.list<Account>(C.accounts),
      store.list<AccountBalance>(L.balances),
      store.list<LedgerEntry>(L.ledger, { where: [["postingDate", ">=", from], ["postingDate", "<=", to]] }),
      store.list<Voucher>(L.vouchers, { where: [["postingDate", ">=", from], ["postingDate", "<=", to]] }),
      store.list<Customer>(C.customers),
      store.list<Vendor>(C.vendors),
      store.list<AuditEvent>(L.auditEvents, { where: [["at", ">=", `${from}T00:00:00`], ["at", "<=", `${to}T23:59:59.999Z`]] }),
    ]);
    return { accounts, balances, entries, vouchers, customers, suppliers, events };
  }

  async function saft() {
    setBusy(true);
    try {
      const d = await load();
      const xml = generateSaft({
        business: settings.business,
        software: { name: PRODUCT_FULL_NAME, version: APP_VERSION },
        currency: "LKR",
        fromDate: from,
        toDate: to,
        accounts: d.accounts,
        balances: d.balances,
        entries: d.entries,
        vouchers: d.vouchers.filter((v) => v.status === "posted" || v.status === "cancelled"),
        customers: d.customers,
        suppliers: d.suppliers,
        taxes: [
          { code: "VAT", description: "Value Added Tax", rateBp: settings.tax.vatRate },
          { code: "SSCL", description: "Social Security Contribution Levy", rateBp: settings.tax.ssclRate },
        ],
        createdAt: new Date().toISOString(),
      });
      downloadBuffer(new TextEncoder().encode(xml), `SAF-T-${settings.business.tin || "company"}-${from}-${to}.xml`, "application/xml");
      toast("SAF-T file downloaded");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function workbook() {
    setBusy(true);
    try {
      const d = await load();
      const byId = new Map(d.accounts.map((a) => [a.id, a]));
      const fyStart = fiscal.list.find((f) => from >= f.start && from <= f.end)?.periods[0]?.id ?? from.slice(0, 7);
      const tb = trialBalance(d.accounts, d.balances, { fromPeriod: from.slice(0, 7), toPeriod: to.slice(0, 7), fyStartPeriod: fyStart });
      const numbers = d.vouchers.filter((v) => v.number).map((v) => v.number!);
      const buf = await tablesToWorkbook([
        { name: "Read me", title: `Audit package – ${settings.business.legalName} (TIN ${settings.business.tin || "—"}) – ${from} to ${to}`, rows: [
          { k: "Prepared", v: new Date().toISOString() },
          { k: "Source", v: `${PRODUCT_FULL_NAME}: ledger (universal journal), audit trail and document register` },
          { k: "Journal entries", v: `${d.entries.length} lines, debits ${d.entries.reduce((a, e) => a + e.debit, 0) / 100}, credits ${d.entries.reduce((a, e) => a + e.credit, 0) / 100}` },
          { k: "Documents", v: `${d.vouchers.length}` },
          { k: "Audit events", v: `${d.events.length}` },
          { k: "Integrity", v: "Run Audit Center → Integrity check; hashes in the Documents sheet can be re-computed independently" },
        ], columns: [{ header: "", value: (r) => r.k, width: 22 }, { header: "", value: (r) => r.v, width: 90 }] },
        { name: "Journal entries", totals: true, rows: d.entries.sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.voucherNo.localeCompare(b.voucherNo) || a.lineNo - b.lineNo), columns: [
          { header: "Date", value: (e) => e.postingDate }, { header: "Document", value: (e) => e.voucherNo, width: 18 }, { header: "Type", value: (e) => TYPE_LABEL[e.voucherType as VoucherType] }, { header: "Line", value: (e) => e.lineNo, format: "number" },
          { header: "Account", value: (e) => e.account }, { header: "Account name", value: (e) => byId.get(e.account)?.name ?? "", width: 30 }, { header: "Cost centre", value: (e) => e.costCenter },
          { header: "Party", value: (e) => (e.partyId ? `${e.partyType}:${e.partyId}` : "") }, { header: "Memo", value: (e) => e.memo ?? "", width: 30 },
          { header: "Debit", value: (e) => e.debit, format: "money", width: 14 }, { header: "Credit", value: (e) => e.credit, format: "money", width: 14 },
          { header: "Currency", value: (e) => e.currency }, { header: "Entered by", value: (e) => personName(e.createdBy), width: 18 }, { header: "Entered at", value: (e) => e.createdAt, width: 22 },
        ] },
        { name: "Documents", rows: d.vouchers.sort((a, b) => (a.number ?? "~").localeCompare(b.number ?? "~")), columns: [
          { header: "Number", value: (v) => v.number ?? "", width: 18 }, { header: "Date", value: (v) => v.postingDate }, { header: "Type", value: (v) => TYPE_LABEL[v.type as VoucherType] }, { header: "Status", value: (v) => v.status },
          { header: "Description", value: (v) => v.remarks, width: 36 }, { header: "Amount", value: (v) => v.totalBase, format: "money", width: 14 },
          { header: "Prepared by", value: (v) => personName(v.createdBy), width: 18 }, { header: "Approved by", value: (v) => personName(v.approvedBy), width: 18 }, { header: "Posted at", value: (v) => v.postedAt ?? "", width: 22 },
          { header: "Reversed by", value: (v) => v.reversedBy ?? "" }, { header: "Reason", value: (v) => v.cancelReason ?? "", width: 24 },
          { header: "Previous hash", value: (v) => v.prevHash ?? "", width: 30 }, { header: "Hash", value: (v) => v.hash ?? "", width: 30 },
        ] },
        { name: "Trial balance", rows: tb.rows, columns: [{ header: "Code", value: (r) => r.code }, { header: "Account", value: (r) => `${"  ".repeat(r.depth)}${r.name}`, width: 40 }, { header: "Opening", value: (r) => r.opening, format: "money", width: 16 }, { header: "Debit", value: (r) => r.debit, format: "money", width: 16 }, { header: "Credit", value: (r) => r.credit, format: "money", width: 16 }, { header: "Closing", value: (r) => r.closing, format: "money", width: 16 }] },
        { name: "Audit trail", rows: d.events.sort((a, b) => a.at.localeCompare(b.at)), columns: [
          { header: "When", value: (e) => e.at, width: 24 }, { header: "Who", value: (e) => (e.actorType === "user" ? personName(e.actorId) : e.actorType), width: 18 }, { header: "Identity source", value: (e) => e.actorSource ?? "" },
          { header: "Action", value: (e) => e.action }, { header: "Data", value: (e) => e.collection }, { header: "Document", value: (e) => e.docId, width: 24 }, { header: "Fields", value: (e) => e.changedFields.join(", "), width: 40 },
          { header: "Before", value: (e) => (e.before ? JSON.stringify(Object.fromEntries(e.changedFields.map((f: string) => [f, e.before?.[f]]))).slice(0, 32000) : ""), width: 40 },
          { header: "After", value: (e) => (e.after ? JSON.stringify(Object.fromEntries(e.changedFields.map((f: string) => [f, e.after?.[f]]))).slice(0, 32000) : ""), width: 40 },
          { header: "Hash", value: (e) => e.hash, width: 30 },
        ] },
        { name: "Users and roles", rows: members, columns: [{ header: "Name", value: (m) => m.name, width: 24 }, { header: "Email", value: (m) => m.email, width: 30 }, { header: "Role", value: (m) => MEMBER_ROLE_INFO[m.role as MemberRole]?.label ?? m.role }, { header: "Access", value: (m) => MEMBER_ROLE_INFO[m.role as MemberRole]?.description ?? "", width: 60 }] },
        { name: "Numbering gaps", rows: sequenceGaps(numbers), columns: [{ header: "Series", value: (g) => g.series, width: 20 }, { header: "Missing", value: (g) => g.missing.join(", "), width: 80 }] },
      ]);
      downloadBuffer(buf, `audit-package-${from}-${to}.xlsx`);
      toast("Audit package downloaded");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card card-body row wrap">
        <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="grid cols-2">
        <div className="card card-body stack">
          <h3>Auditor's Excel package</h3>
          <Explain as="p" className="small muted">Journal entries (every line with document, account, cost centre, party, preparer and time), document register with approvers and hashes, trial balance, the audit trail with before and after values, users and roles, and numbering gaps. Ready for audit data analytics (sampling, Benford, journal-entry testing under ISA 240).</Explain>
          <button className="btn primary" disabled={busy} onClick={workbook}>Download audit package</button>
        </div>
        <div className="card card-body stack">
          <h3>SAF-T (OECD Standard Audit File for Tax 2.0)</h3>
          <Explain as="p" className="small muted">The international XML standard for handing accounting data to tax authorities and auditors: header, chart of accounts with opening and closing balances, customers, suppliers, tax table and every journal transaction.</Explain>
          <button className="btn" disabled={busy} onClick={saft}>Download SAF-T XML</button>
        </div>
      </div>
    </div>
  );
}

export function AuditCenter() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? (params.get("doc") ? "trail" : "integrity");
  return (
    <div className="page">
      <PageHead title="Audit Center" subtitle="Evidence that the books are complete, accurate and unaltered: integrity checks, the full change history of every record, numbering, segregation of duties, access review and auditor exports." />
      <Seg
        value={tab}
        onChange={(t) => setParams({ tab: t })}
        options={[
          { value: "integrity", label: "Integrity" },
          { value: "trail", label: "Audit trail" },
          { value: "journal", label: "POS journal" },
          { value: "exceptions", label: "Exceptions" },
          { value: "quality", label: "Data quality" },
          { value: "numbering", label: "Numbering" },
          { value: "sod", label: "Segregation of duties" },
          { value: "access", label: "Access review" },
          { value: "exports", label: "Auditor exports" },
        ]}
      />
      {tab === "integrity" ? <IntegrityTab /> : tab === "trail" ? <TrailTab /> : tab === "journal" ? <JournalTab /> : tab === "exceptions" ? <ExceptionsTab /> : tab === "quality" ? <QualityTab /> : tab === "numbering" ? <NumberingTab /> : tab === "sod" ? <SodTab /> : tab === "access" ? <AccessTab /> : <ExportsTab />}
    </div>
  );
}
