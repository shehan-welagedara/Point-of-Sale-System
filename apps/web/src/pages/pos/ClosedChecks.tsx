import {
  type Check,
  type CheckAdjustment,
  type CreditNote,
  type Invoice,
  type PosContext,
  type PosJournal,
  type PrivilegeKey,
  type ReasonCode,
  type Staff,
  type TenderMedia,
  type Workstation,
  COLLECTIONS as C,
  adjustClosedTender,
  creditAmounts,
  issueCreditNote,
  remainingQty,
} from "@pos/core";
import { type ReceiptDoc, buildCreditNote } from "@pos/printing";
import { useMemo, useState } from "react";
import { Field, Modal } from "../../components/ui";
import { money, timeColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

type Action = "refund" | "void" | "reopen" | "tender" | null;

export interface ClosedChecksProps {
  ws: Workstation;
  user: Staff;
  staff: Staff[];
  tenders: TenderMedia[];
  reasons: ReasonCode[];
  ctx: PosContext;
  businessDate: string;
  journal: PosJournal;
  withPrivilege: (p: PrivilegeKey, run: (by: Staff) => void) => void;
  /** Prints a document on this device's bill printer (or shows it). */
  printDoc: (doc: ReceiptDoc, kind: "receipt" | "report") => Promise<void>;
  /** The customer's bill again (marked COPY). */
  invoiceDoc: (check: Check, invoice: Invoice) => ReceiptDoc;
  /** A reopened check opens in the order screen. */
  onReopened: (check: Check) => void;
  onClose: () => void;
}

/**
 * Closed checks (Simphony "Closed check functions"): find any check of a day by number, invoice,
 * table or amount; reprint it; refund items or void it with a credit note; reopen it to correct;
 * change its payment method. Each action follows the employee's privileges (or a manager's approval).
 */
export function ClosedChecks(p: ClosedChecksProps) {
  const { toast } = useApp();
  const [date, setDate] = useState(p.businessDate);
  const [q, setQ] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const checks = (useCollection<Check>(C.checks, { where: [["businessDate", "==", date]] }) ?? []).filter((c) => c.status === "closed" && c.propertyId === p.ws.propertyId);
  const invoices = useCollection<Invoice>(C.invoices, { where: [["businessDate", "==", date]] }) ?? [];
  const notes = useCollection<CreditNote>(C.creditNotes, { where: [["originalBusinessDate", "==", date]] }) ?? [];
  const adjustments = useCollection<CheckAdjustment>(C.checkAdjustments, { where: [["businessDate", "==", date]] }) ?? [];
  const tenderName = (id: string) => p.tenders.find((t) => t.id === id)?.name ?? id;
  const name = (id?: string) => p.staff.find((s) => s.id === id)?.name ?? id ?? "";
  const term = q.trim().toLowerCase();
  const list = useMemo(
    () =>
      checks
        .filter((c) => !term || String(c.checkNo) === term || c.invoiceNo?.toLowerCase().includes(term) || c.tableId?.toLowerCase() === term || money(c.totals?.amountDue).toLowerCase().includes(term) || c.name?.toLowerCase().includes(term))
        .sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? "")),
    [checks, term],
  );
  const sel = checks.find((c) => c.id === selId) ?? null;
  const selNotes = notes.filter((n) => n.checkId === selId);
  const selAdj = adjustments.filter((a) => a.checkId === selId);
  const status = (c: Check) => {
    const n = notes.filter((x) => x.checkId === c.id);
    if (n.some((x) => x.kind === "reopen")) return <span className="badge warn">Reopened</span>;
    if (n.some((x) => x.full)) return <span className="badge bad">Voided</span>;
    if (n.length) return <span className="badge warn">Refunded {money(n.reduce((a, x) => a + x.totals.total, 0))}</span>;
    if (adjustments.some((a) => a.checkId === c.id)) return <span className="badge info">Payment changed</span>;
    return null;
  };

  async function run(f: () => Promise<void>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  function reprint(c: Check) {
    const inv = invoices.find((i) => i.id === c.invoiceNo);
    if (!inv) return toast("The invoice for this check isn't on this device yet", true);
    p.withPrivilege("pos.reprint", (by) =>
      void run(async () => {
        const doc = p.invoiceDoc(c, inv);
        await p.printDoc({ ...doc, blocks: [{ t: "text", text: "*** COPY ***", align: "center", bold: true }, ...doc.blocks.filter((b) => b.t !== "drawer")] }, "receipt");
        await p.journal.log({ type: "closedReprint", employeeId: p.user.id, ...(by.id !== p.user.id ? { authorizedBy: by.id } : {}), checkId: c.id, checkNo: c.checkNo, detail: `invoice ${c.invoiceNo}` });
        toast("Copy sent");
      }),
    );
  }

  return (
    <Modal wide title="Closed checks" onClose={p.onClose}>
      <div className="stack">
        <div className="row wrap">
          <Field label="Business date"><input className="input" type="date" value={date} max={p.businessDate} onChange={(e) => { setDate(e.target.value); setSelId(null); }} /></Field>
          <Field label="Find"><input className="input" value={q} placeholder="Check no., invoice, table, amount, name" onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
        </div>
        <div className="closed-grid">
          <div className="closed-list" role="listbox" aria-label="Closed checks">
            {list.map((c) => (
              <button key={c.id} role="option" aria-selected={c.id === selId} className={`closed-row${c.id === selId ? " on" : ""}`} onClick={() => { setSelId(c.id); setAction(null); }}>
                <strong>#{c.checkNo}</strong>
                <span className="small muted">{c.closedAt ? timeColombo(c.closedAt) : ""}{c.tableId ? ` · ${c.tableId}` : ""} · {name(c.staffId)}</span>
                <span className="num">{money(c.totals?.amountDue)}</span>
                {status(c)}
              </button>
            ))}
            {!list.length ? <p className="muted small" style={{ padding: 12 }}>No closed checks{term ? " match" : " on this day"}.</p> : null}
          </div>
          {sel ? (
            <div className="stack closed-detail">
              <div className="row between wrap">
                <strong>Check #{sel.checkNo} · {sel.invoiceNo}</strong>
                <span className="small muted">{sel.closedAt ? timeColombo(sel.closedAt) : ""} · {name(sel.staffId)}</span>
              </div>
              <table className="table">
                <tbody>
                  {sel.lines.filter((l) => !l.voided).map((l) => (
                    <tr key={l.id}><td>{l.qty} × {l.name}</td><td className="num">{money(sel.totals?.lines.find((t) => t.id === l.id)?.gross)}</td></tr>
                  ))}
                  <tr><td><strong>Total</strong></td><td className="num"><strong>{money(sel.totals?.amountDue)}</strong></td></tr>
                  {sel.payments.map((pm) => <tr key={pm.id}><td className="small muted">{tenderName(pm.tenderId)}{pm.reference ? ` · ${pm.reference}` : ""}</td><td className="num small">{money(pm.applied)}</td></tr>)}
                </tbody>
              </table>
              {selNotes.map((n) => <div key={n.id} className="callout warn small">{n.id}: {n.kind === "refund" ? "refund" : n.kind === "reopen" ? "reopened" : "voided"} {money(n.totals.total)} · {n.reason} · {name(n.by)}{n.authorizedBy ? `, approved by ${name(n.authorizedBy)}` : ""}</div>)}
              {selAdj.map((a) => <div key={a.id} className="callout small">{tenderName(a.fromTenderId)} → {tenderName(a.toTenderId)} {money(a.amount)} · {a.reason} · {name(a.by)}</div>)}
              <div className="row wrap">
                <button className="btn" disabled={busy} onClick={() => reprint(sel)}>Reprint</button>
                <button className="btn" disabled={busy} onClick={() => setAction("tender")}>Change payment</button>
                <button className="btn" disabled={busy} onClick={() => setAction("refund")}>Refund items</button>
                <button className="btn danger" disabled={busy} onClick={() => setAction("void")}>Void check</button>
                <button className="btn" disabled={busy} onClick={() => setAction("reopen")}>Reopen</button>
              </div>
              {action === "refund" || action === "void" || action === "reopen" ? (
                <CreditForm key={`${sel.id}-${action}`} {...p} check={sel} kind={action} notes={selNotes} busy={busy} run={run} onDone={(reopened) => { setAction(null); if (reopened) p.onReopened(reopened); }} />
              ) : null}
              {action === "tender" ? <TenderForm key={sel.id} {...p} check={sel} busy={busy} run={run} onDone={() => setAction(null)} /> : null}
            </div>
          ) : (
            <div className="muted small closed-detail">Choose a check to reprint, refund, void, reopen or change its payment.</div>
          )}
        </div>
        <p className="tiny muted">A closed check and its bill never change: corrections issue a credit note (numbered CN-…) or a payment change, recorded in the journal. A day already posted to the books is posted again for the difference.</p>
      </div>
    </Modal>
  );
}

function ReasonPicker({ reasons, types, value, onChange }: { reasons: ReasonCode[]; types: ReasonCode["type"][]; value: string; onChange: (text: string, id?: string) => void }) {
  const list = reasons.filter((r) => types.includes(r.type));
  return (
    <Field label="Reason">
      <div className="stack tight">
        {list.length ? (
          <div className="chips">{list.map((r) => <button key={r.id} type="button" className={`chip${value === r.name ? " on" : ""}`} onClick={() => onChange(r.name, r.id)}>{r.name}</button>)}</div>
        ) : null}
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Why (shown on the credit note and in the journal)" />
      </div>
    </Field>
  );
}

function CreditForm(p: ClosedChecksProps & { check: Check; kind: "refund" | "void" | "reopen"; notes: CreditNote[]; busy: boolean; run: (f: () => Promise<void>) => Promise<void>; onDone: (reopened?: Check) => void }) {
  const { toast, settings, on, tenant } = useApp();
  const store = useStore();
  const left = remainingQty(p.check, p.notes);
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries([...left].map(([id, n]) => [id, p.kind === "refund" ? 0 : n])));
  const [reason, setReason] = useState<{ text: string; id?: string }>({ text: "" });
  const retail = ["retail", "wholesale", "fashion"].includes(tenant?.industry ?? "");
  const [restock, setRestock] = useState(retail);
  const firstTender = p.check.payments[0]?.tenderId ?? p.tenders[0]?.id ?? "";
  const [tender, setTender] = useState(firstTender);
  const select = p.kind === "refund" ? Object.entries(qty).filter(([, n]) => n > 0).map(([lineId, n]) => ({ lineId, qty: n })) : "all";
  let preview: number | null = null;
  try {
    preview = select === "all" || select.length ? creditAmounts(p.check, select).totals.total : null;
  } catch {
    preview = null;
  }
  const privilege: PrivilegeKey = p.kind === "reopen" ? "pos.reopenClosed" : "pos.refund";
  const title = p.kind === "refund" ? "Refund items" : p.kind === "void" ? "Void the whole check" : "Reopen to correct";
  const submit = () =>
    p.withPrivilege(privilege, (by) =>
      void p.run(async () => {
        if (!reason.text.trim()) throw new Error("Give a reason");
        const { note, reopened } = await issueCreditNote(store, p.check, p.ctx, {
          kind: p.kind,
          select,
          refunds: p.kind === "reopen" || preview === null ? [] : [{ tenderId: tender, amount: preview }],
          reason: reason.text,
          ...(reason.id ? { reasonId: reason.id } : {}),
          by: p.user.id,
          ...(by.id !== p.user.id ? { authorizedBy: by.id } : {}),
          restock,
          businessDate: p.businessDate,
          workstationId: p.ws.id,
          workstationCode: p.ws.code,
          inventoryOn: on("inventory"),
        });
        await p.journal.log({ type: p.kind === "reopen" ? "checkReopen" : p.kind === "void" ? "checkVoid" : "refund", employeeId: p.user.id, ...(by.id !== p.user.id ? { authorizedBy: by.id } : {}), checkId: p.check.id, checkNo: p.check.checkNo, amount: note.totals.total, reason: note.reason, detail: `${note.id} against ${note.invoiceNo}` });
        const cash = p.tenders.find((t) => t.id === tender)?.opensDrawer && p.kind !== "reopen";
        const slip = buildCreditNote({ note, business: settings.business, width: 48, staffName: p.staff.find((s) => s.id === p.user.id)?.name ?? "", ...(by.id !== p.user.id ? { approvedBy: by.name } : {}), tenders: new Map(p.tenders.map((t) => [t.id, t])) });
        await p.printDoc(cash ? { ...slip, blocks: [{ t: "drawer" }, ...slip.blocks] } : slip, "receipt");
        toast(p.kind === "reopen" ? `Check #${p.check.checkNo} reopened (${note.id})` : `${note.id}: ${money(note.totals.total)} ${p.kind === "void" ? "voided" : "refunded"}`);
        p.onDone(reopened);
      }),
    );
  return (
    <div className="card pad stack" data-testid={`credit-${p.kind}`}>
      <strong>{title}</strong>
      {p.kind === "refund" ? (
        <div className="stack tight">
          {p.check.lines.filter((l) => (left.get(l.id) ?? 0) > 0).map((l) => (
            <div key={l.id} className="row between">
              <span>{l.name} <span className="tiny muted">({left.get(l.id)} left)</span></span>
              <span className="row" style={{ gap: 6 }}>
                <button type="button" className="btn sm" aria-label={`Less ${l.name}`} onClick={() => setQty({ ...qty, [l.id]: Math.max(0, (qty[l.id] ?? 0) - 1) })}>−</button>
                <strong style={{ minWidth: 24, textAlign: "center" }}>{qty[l.id] ?? 0}</strong>
                <button type="button" className="btn sm" aria-label={`More ${l.name}`} onClick={() => setQty({ ...qty, [l.id]: Math.min(left.get(l.id) ?? 0, (qty[l.id] ?? 0) + 1) })}>+</button>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{p.kind === "void" ? "Every item is credited and the money given back." : "The bill is cancelled with a credit note and the check opens again with the same items (already sent to the kitchen) to correct and pay again."}</p>
      )}
      <ReasonPicker reasons={p.reasons} types={p.kind === "refund" ? ["refund", "void"] : ["void", "refund"]} value={reason.text} onChange={(text, id) => setReason({ text, ...(id ? { id } : {}) })} />
      {p.kind !== "reopen" ? (
        <div className="row wrap">
          <Field label="Give back as">
            <select className="select" value={tender} onChange={(e) => setTender(e.target.value)}>
              {p.tenders.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          <label className="check"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> Goods back into stock</label>
        </div>
      ) : null}
      <div className="row between">
        <span>{preview !== null ? <>Credit note: <strong>{money(preview)}</strong></> : <span className="muted">Choose items</span>}</span>
        <span className="row">
          <button type="button" className="btn ghost" onClick={() => p.onDone()}>Back</button>
          <button type="button" className={`btn ${p.kind === "void" ? "danger" : "primary"}`} disabled={p.busy || preview === null || !reason.text.trim()} onClick={submit}>{p.kind === "refund" ? "Refund" : p.kind === "void" ? "Void check" : "Reopen"}</button>
        </span>
      </div>
    </div>
  );
}

function TenderForm(p: ClosedChecksProps & { check: Check; busy: boolean; run: (f: () => Promise<void>) => Promise<void>; onDone: () => void }) {
  const { toast } = useApp();
  const store = useStore();
  const [paymentId, setPaymentId] = useState(p.check.payments[0]?.id ?? "");
  const pay = p.check.payments.find((x) => x.id === paymentId);
  const [to, setTo] = useState(p.tenders.find((t) => t.active && t.id !== pay?.tenderId)?.id ?? "");
  const [reason, setReason] = useState("");
  const submit = () =>
    p.withPrivilege("pos.adjustClosed", (by) =>
      void p.run(async () => {
        if (!pay) throw new Error("Choose a payment");
        const adj = await adjustClosedTender(store, p.check, { paymentId: pay.id, toTenderId: to, amount: pay.applied, reason, by: p.user.id, ...(by.id !== p.user.id ? { authorizedBy: by.id } : {}), workstationId: p.ws.id });
        await p.journal.log({ type: "tenderAdjust", employeeId: p.user.id, ...(by.id !== p.user.id ? { authorizedBy: by.id } : {}), checkId: p.check.id, checkNo: p.check.checkNo, amount: adj.amount, reason, detail: `${adj.fromTenderId} → ${adj.toTenderId}` });
        toast("Payment method changed");
        p.onDone();
      }),
    );
  return (
    <div className="card pad stack" data-testid="credit-tender">
      <strong>Change the payment method</strong>
      <div className="row wrap">
        <Field label="Payment">
          <select className="select" value={paymentId} onChange={(e) => setPaymentId(e.target.value)}>
            {p.check.payments.map((x) => <option key={x.id} value={x.id}>{p.tenders.find((t) => t.id === x.tenderId)?.name ?? x.tenderId} · {money(x.applied)}</option>)}
          </select>
        </Field>
        <Field label="Should have been">
          <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
            {p.tenders.filter((t) => t.active && t.id !== pay?.tenderId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Paid by card, rung up as cash" /></Field>
      <div className="row between">
        <span className="small muted">The day's payment totals change; the bill stays as printed.</span>
        <span className="row">
          <button type="button" className="btn ghost" onClick={p.onDone}>Back</button>
          <button type="button" className="btn primary" disabled={p.busy || !to || !reason.trim()} onClick={submit}>Change</button>
        </span>
      </div>
    </div>
  );
}
