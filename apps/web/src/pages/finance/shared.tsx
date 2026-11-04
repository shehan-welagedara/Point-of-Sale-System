import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { type Account, type Customer, type MemberRole, type Vendor, COLLECTIONS as C } from "@pos/core";
import { type CostCenter, type FiscalYear, type LedgerEntry, type LedgerSettings, type Voucher, type VoucherType, LEDGER as L } from "@pos/ledger";
import { ConfirmButton, Drawer, Field, Loading } from "../../components/ui";
import { money, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";

export const BOOKS_ROLES: MemberRole[] = ["owner", "admin", "accountant"];
export const canBooks = (role: MemberRole | null) => Boolean(role && BOOKS_ROLES.includes(role));

export const TYPE_LABEL: Record<VoucherType, string> = {
  journal: "Journal",
  purchaseInvoice: "Supplier invoice",
  salesInvoice: "Customer invoice",
  payment: "Payment",
  posDay: "POS day",
  depreciation: "Depreciation",
  assetDisposal: "Asset disposal",
  periodClose: "Year-end close",
  reversal: "Reversal",
};

export function StatusBadge({ v }: { v: Pick<Voucher, "status"> & { lastRejection?: unknown } }) {
  const tone = v.status === "posted" ? "good" : v.status === "submitted" ? "warn" : v.status === "cancelled" ? "bad" : "";
  const label = v.status === "submitted" ? "Awaiting approval" : v.status === "draft" && v.lastRejection ? "Returned" : v.status[0]!.toUpperCase() + v.status.slice(1);
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** Document amount: the posted base total, or an estimate from the lines while still a draft. */
export function voucherAmount(v: Voucher): number {
  if (v.totalBase !== undefined) return v.totalBase;
  switch (v.type) {
    case "purchaseInvoice":
      return Math.round(v.items.reduce((a, i) => a + i.qty * i.rate, 0) + v.vatAmount);
    case "salesInvoice": {
      const net = Math.round(v.items.reduce((a, i) => a + i.qty * i.rate, 0));
      return net + Math.round((net * v.vatRateBp) / 10_000);
    }
    case "payment":
      return v.amount;
    default:
      return (v.lines ?? []).reduce((a, l) => a + l.debit, 0);
  }
}

export function useLedgerSettings(): LedgerSettings | undefined {
  const { settings } = useApp();
  return (settings.accounting as unknown as { ledger?: LedgerSettings }).ledger;
}

export function useAccounts() {
  const accounts = useCollection<Account>(C.accounts);
  return useMemo(() => {
    const list = (accounts ?? []).slice().sort((a, b) => a.code.localeCompare(b.code));
    return { list, byId: new Map(list.map((a) => [a.id, a])), loaded: accounts !== undefined };
  }, [accounts]);
}

export function useCostCenters(): CostCenter[] {
  return (useCollection<CostCenter>(L.costCenters) ?? []).filter((c) => !c.isGroup && !c.disabled);
}

export function useFiscal() {
  const fys = useCollection<FiscalYear>(L.fiscalYears);
  const today = todayColombo();
  return useMemo(() => {
    const list = (fys ?? []).slice().sort((a, b) => b.start.localeCompare(a.start));
    const current = list.find((f) => today >= f.start && today <= f.end) ?? list[0];
    return { list, current, loaded: fys !== undefined };
  }, [fys, today]);
}

export function useParties() {
  const customers = useCollection<Customer>(C.customers) ?? [];
  const vendors = useCollection<Vendor>(C.vendors) ?? [];
  return useMemo(
    () => ({ customers, vendors, name: (type: string | undefined, id: string | undefined) => (type === "supplier" ? vendors.find((v) => v.id === id)?.name : customers.find((c) => c.id === id)?.name) ?? id ?? "" }),
    [customers, vendors],
  );
}

export function AccountSelect({ value, onChange, filter, placeholder = "Account…" }: { value: string; onChange: (v: string) => void; filter?: (a: Account) => boolean; placeholder?: string }) {
  const { list } = useAccounts();
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list
        .filter((a) => !a.isGroup && !a.frozen && (filter ? filter(a) : true))
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.code} {a.name}
          </option>
        ))}
    </select>
  );
}

export function CostCenterSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ccs = useCostCenters();
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Default</option>
      {ccs.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** Runs a server-side ledger action with busy state and a toast for the outcome. */
export function useLedgerAction() {
  const { ledger, toast } = useApp();
  const [busy, setBusy] = useState(false);
  async function run<T>(req: Parameters<typeof ledger>[0], done?: (r: T) => string | void): Promise<T | null> {
    setBusy(true);
    try {
      const r = await ledger<T>(req);
      const msg = done?.(r);
      if (msg) toast(msg);
      return r;
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy };
}

export function newDraftBase(actorUid: string, ccDefault: string) {
  return {
    status: "draft" as const,
    postingDate: todayColombo(),
    currency: "LKR",
    exchangeRateMicros: 1_000_000,
    costCenter: ccDefault,
    propertyId: ccDefault,
    createdBy: actorUid,
    createdAt: new Date().toISOString(),
  };
}

/** Header, posting lines, people and actions for any voucher. */
export function VoucherDetail({ voucher, onClose, onEdit }: { voucher: Voucher; onClose: () => void; onEdit?: () => void }) {
  const { actor, personName, store } = useApp();
  const { byId } = useAccounts();
  const parties = useParties();
  const entries = useCollection<LedgerEntry>(L.ledger, { where: [["voucherId", "==", voucher.id]] });
  const { run, busy } = useLedgerAction();
  const [reason, setReason] = useState("");
  const [revDate, setRevDate] = useState(todayColombo());
  const mine = actor?.uid === voucher.createdBy;
  const books = canBooks(actor?.role as MemberRole);
  const lines = entries && entries.length ? entries.slice().sort((a, b) => a.lineNo - b.lineNo) : null;
  const dr = (lines ?? []).reduce((a, l) => a + l.debit, 0);
  const cr = (lines ?? []).reduce((a, l) => a + l.credit, 0);

  return (
    <Drawer
      title={`${TYPE_LABEL[voucher.type]} ${voucher.number ?? "(draft)"}`}
      onClose={onClose}
      footer={
        <div className="stack" style={{ width: "100%" }}>
          {(voucher.status === "submitted" && books && !mine) || (voucher.status === "posted" && books && voucher.type !== "reversal" && voucher.type !== "periodClose") ? (
            <input className="input" placeholder={voucher.status === "posted" ? "Reason for reversal (required)" : "Reason if returning to the preparer"} value={reason} onChange={(e) => setReason(e.target.value)} />
          ) : null}
          <div className="row wrap" style={{ justifyContent: "flex-end" }}>
            {voucher.status === "draft" && mine ? (
              <>
                <ConfirmButton onConfirm={async () => { await store?.remove(L.vouchers, voucher.id); onClose(); }}>Delete draft</ConfirmButton>
                {onEdit ? <button className="btn" onClick={onEdit}>Edit</button> : null}
                <button className="btn primary" disabled={busy} onClick={() => run<{ status: string }>({ action: "submit", voucherId: voucher.id }, (r) => (r.status === "posted" ? "Posted" : "Submitted for approval")).then((r) => r && onClose())}>
                  Submit
                </button>
              </>
            ) : null}
            {voucher.status === "submitted" && books ? (
              mine || voucher.submittedBy === actor?.uid ? (
                <span className="small muted">Waiting for someone else to approve (segregation of duties).</span>
              ) : (
                <>
                  <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => run({ action: "reject", voucherId: voucher.id, reason }, () => "Returned to the preparer").then((r) => r && onClose())}>
                    Return
                  </button>
                  <button className="btn primary" disabled={busy} onClick={() => run({ action: "approve", voucherId: voucher.id }, () => "Approved and posted").then((r) => r && onClose())}>
                    Approve &amp; post
                  </button>
                </>
              )
            ) : null}
            {voucher.status === "posted" && books && voucher.type !== "reversal" && voucher.type !== "periodClose" ? (
              <>
                <input className="input" type="date" value={revDate} onChange={(e) => setRevDate(e.target.value)} style={{ width: 160 }} />
                <ConfirmButton className="btn danger" onConfirm={() => run({ action: "reverse", voucherId: voucher.id, date: revDate, reason }, () => "Reversal posted").then((r) => r && onClose())}>
                  Reverse
                </ConfirmButton>
              </>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="stack">
        <div className="row wrap">
          <StatusBadge v={voucher} />
          {"match" in voucher && voucher.match ? <span className={`badge ${voucher.match.status === "exception" ? "bad" : voucher.match.status === "withinTolerance" ? "warn" : "good"}`}>3-way match: {voucher.match.status}</span> : null}
          {voucher.reversedBy ? <span className="badge bad">Reversed{voucher.cancelReason ? `: ${voucher.cancelReason}` : ""}</span> : null}
          {voucher.reversalOf ? <span className="badge info">Reverses {voucher.reversalOf}</span> : null}
        </div>
        <p>{voucher.remarks}</p>
        {voucher.lastRejection && voucher.status === "draft" ? <div className="callout warn">Returned by {personName(voucher.lastRejection.by)}: {voucher.lastRejection.reason}</div> : null}
        {"match" in voucher && voucher.match?.issues.length ? <div className="callout warn">{voucher.match.issues.map((i) => <div key={i}>{i}</div>)}</div> : null}
        <div className="grid cols-2 small">
          <div>Posting date: <strong>{voucher.postingDate}</strong></div>
          <div>Period: <strong>{voucher.period ?? "—"}</strong></div>
          <div>Prepared by: <strong>{personName(voucher.createdBy)}</strong></div>
          <div>Approved by: <strong>{personName(voucher.approvedBy ?? (voucher.status === "posted" && !voucher.approvedBy ? voucher.postedBy : undefined))}</strong></div>
          <div>Currency: <strong>{voucher.currency}{voucher.currency !== "LKR" ? ` @ ${(voucher.exchangeRateMicros / 1e6).toFixed(4)}` : ""}</strong></div>
          <div>Total: <strong>{money(voucherAmount(voucher))}</strong></div>
        </div>
        <div className="card table-wrap">
          {voucher.status === "posted" || voucher.status === "cancelled" ? (
            !entries ? (
              <Loading />
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Account</th><th>Cost centre</th><th>Party</th><th className="num">Debit</th><th className="num">Credit</th></tr>
                </thead>
                <tbody>
                  {(lines ?? []).map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="mono">{l.account}</span> {byId.get(l.account)?.name}
                        {l.memo ? <div className="tiny muted">{l.memo}</div> : null}
                      </td>
                      <td className="muted">{l.costCenter}</td>
                      <td className="muted">{l.partyId ? parties.name(l.partyType, l.partyId) : ""}</td>
                      <td className="num">{l.debit ? money(l.debit) : ""}</td>
                      <td className="num">{l.credit ? money(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(dr)}</td><td className="num">{money(cr)}</td></tr></tfoot>
              </table>
            )
          ) : (
            <table className="table">
              <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>
                {(voucher.lines ?? []).map((l, i) => (
                  <tr key={i}><td><span className="mono">{l.account}</span> {byId.get(l.account)?.name}{l.memo ? <div className="tiny muted">{l.memo}</div> : null}</td><td className="num">{l.debit ? money(l.debit) : ""}</td><td className="num">{l.credit ? money(l.credit) : ""}</td></tr>
                ))}
                {!voucher.lines?.length ? <tr><td colSpan={3} className="muted">Posting lines are calculated by the server when submitted.</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
        {voucher.hash ? <Field label="Integrity hash (chained to the previous posted voucher)"><span className="mono tiny" style={{ wordBreak: "break-all" }}>{voucher.hash}</span></Field> : null}
        <Link className="small" to={`/emc/audit/trail?doc=${encodeURIComponent(voucher.id)}`}>View change history →</Link>
      </div>
    </Drawer>
  );
}

/** Voucher list with filters and the detail drawer. */
export function VoucherList({ types, title, subtitle, actions, editor, initialStatus = "all", head = true, filter }: { filter?: (v: Voucher) => boolean; types: VoucherType[]; title: string; subtitle?: ReactNode; actions?: ReactNode; editor?: (v: Voucher, close: () => void) => ReactNode; initialStatus?: string; head?: boolean }) {
  const vouchers = useCollection<Voucher>(L.vouchers);
  const { personName } = useApp();
  const parties = useParties();
  const [status, setStatus] = useState<string>(initialStatus);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Voucher | null>(null);
  const [editing, setEditing] = useState<Voucher | null>(null);
  const rows = (vouchers ?? [])
    .filter((v) => types.includes(v.type) && (!filter || filter(v)) && (status === "all" || v.status === status) && (!q || `${v.number ?? ""} ${v.remarks} ${v.id}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.postingDate.localeCompare(a.postingDate) || (b.number ?? "").localeCompare(a.number ?? ""));
  return (
    <div className={head ? "page fill" : "stack"}>
      {head ? (
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="row wrap">{actions}</div>
        </div>
      ) : null}
      <div className="row wrap">
        <input className="input" placeholder="Search number or description" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
        {["all", "draft", "submitted", "posted", "cancelled"].map((s) => (
          <button key={s} className={`chip${status === s ? " on" : ""}`} onClick={() => setStatus(s)}>
            {s === "all" ? "All" : s === "submitted" ? "Awaiting approval" : s[0]!.toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="card table-wrap fill-card">
        {!vouchers ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Number</th><th>Date</th><th>Type</th><th>Description</th><th>Party</th><th>Prepared by</th><th className="num">Amount</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} className="clickable" onClick={() => setOpen(v)}>
                  <td className="mono">{v.number ?? "—"}</td>
                  <td>{v.postingDate}</td>
                  <td className="muted">{TYPE_LABEL[v.type]}</td>
                  <td>{v.remarks}</td>
                  <td className="muted">{"supplierId" in v ? parties.name("supplier", v.supplierId) : "customerId" in v ? parties.name("customer", v.customerId) : "partyId" in v ? parties.name(v.partyType, v.partyId) : ""}</td>
                  <td className="muted">{personName(v.createdBy)}</td>
                  <td className="num">{money(voucherAmount(v))}</td>
                  <td><StatusBadge v={v} /></td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={8} className="muted">Nothing here yet.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
      {open && !editing ? <VoucherDetail voucher={open} onClose={() => setOpen(null)} {...(editor ? { onEdit: () => setEditing(open) } : {})} /> : null}
      {editing && editor ? editor(editing, () => { setEditing(null); setOpen(null); }) : null}
    </div>
  );
}
