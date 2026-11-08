import { AttachmentPanel } from "../../components/Attachments";
import { type ReactNode, useMemo, useState } from "react";
import { type GoodsReceipt, type InventoryItem, COLLECTIONS as C, addDays, newId } from "@pos/core";
import {
  type PaymentVoucher,
  type PurchaseInvoice,
  type PurchaseInvoiceItem,
  type SalesInvoice,
  type SalesInvoiceItem,
  type Voucher,
  AGING_BUCKETS,
  LEDGER as L,
  aging,
} from "@pos/ledger";
import { tablesToWorkbook } from "../../lib/excel";
import { Field, Modal, ModuleOff, Seg, Stat } from "../../components/ui";
import { amount, downloadBuffer, money, toCents, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { type SubmitOutcome, AccountSelect, VoucherList, canBooks, newDraftBase, useLedgerAction, useLedgerSettings, useParties } from "./shared";

type Side = "supplier" | "customer";

// ───────────────────────────── Supplier invoices ─────────────────────────────

interface ItemDraft {
  description: string;
  inventoryItemId?: string;
  account: string;
  qty: string;
  rate: string;
}

/** Supplier invoice, normally created from goods receipts so it can be three-way matched. */
export function PurchaseInvoiceEditor({ voucher, onClose }: { voucher?: PurchaseInvoice; onClose: () => void }) {
  const [vid] = useState(() => voucher?.id ?? `PI-${newId()}`);
  const { actor, store, toast, settings } = useApp();
  const ls = useLedgerSettings();
  const parties = useParties();
  const grns = useCollection<GoodsReceipt>(C.goodsReceipts, { where: [["status", "==", "posted"]] }) ?? [];
  const items = useCollection<InventoryItem>(C.inventoryItems) ?? [];
  const invoices = useCollection<PurchaseInvoice>(L.vouchers, { where: [["type", "==", "purchaseInvoice"]] }) ?? [];
  const { run, busy } = useLedgerAction();
  const [supplierId, setSupplierId] = useState(voucher?.supplierId ?? "");
  const [invNo, setInvNo] = useState(voucher?.supplierInvoiceNo ?? "");
  const [invDate, setInvDate] = useState(voucher?.supplierInvoiceDate ?? todayColombo());
  const [date, setDate] = useState(voucher?.postingDate ?? todayColombo());
  const [due, setDue] = useState(voucher?.dueDate ?? addDays(todayColombo(), 30));
  const [grnIds, setGrnIds] = useState<string[]>(voucher?.grnIds ?? []);
  const [lines, setLines] = useState<ItemDraft[]>(voucher ? voucher.items.map((i) => ({ description: i.description, account: i.account ?? "", qty: String(i.qty), rate: String(i.rate / 100), ...(i.inventoryItemId ? { inventoryItemId: i.inventoryItemId } : {}) })) : []);
  const [vat, setVat] = useState(voucher ? String(voucher.vatAmount / 100) : "");
  const [wht, setWht] = useState(voucher ? String(voucher.whtAmount / 100) : "");
  const itemName = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);
  const billed = useMemo(() => new Set(invoices.filter((i) => i.status !== "cancelled" && i.id !== voucher?.id).flatMap((i) => i.grnIds)), [invoices, voucher?.id]);
  const openGrns = grns.filter((g) => g.vendorId === supplierId && !billed.has(g.id));
  const net = lines.reduce((a, l) => a + Math.round(Number(l.qty || 0) * toCents(l.rate || 0)), 0);
  const total = net + toCents(vat || 0);

  function pickSupplier(id: string) {
    setSupplierId(id);
    setGrnIds([]);
    setLines([]);
    const terms = parties.vendors.find((v) => v.id === id)?.paymentTermsDays ?? 30;
    setDue(addDays(invDate, terms));
  }

  function toggleGrn(g: GoodsReceipt) {
    const on = grnIds.includes(g.id);
    const ids = on ? grnIds.filter((x) => x !== g.id) : [...grnIds, g.id];
    setGrnIds(ids);
    const chosen = grns.filter((x) => ids.includes(x.id));
    const manual = lines.filter((l) => !l.inventoryItemId);
    setLines([...chosen.flatMap((x) => x.lines.map((l) => ({ description: itemName.get(l.inventoryItemId) ?? l.inventoryItemId, inventoryItemId: l.inventoryItemId, account: "", qty: String(l.qty), rate: String(l.unitCost / 100) }))), ...manual]);
    setVat(String(chosen.reduce((a, x) => a + x.inputVat, 0) / 100));
    if (!on && g.supplierInvoiceNo && !invNo) setInvNo(g.supplierInvoiceNo);
  }

  async function save(submit: boolean) {
    if (!store || !actor) return;
    if (!supplierId || !invNo.trim()) return toast("Choose the supplier and enter their invoice number", true);
    if (!lines.length) return toast("Add at least one line", true);
    if (lines.some((l) => !l.inventoryItemId && !l.account)) return toast("Lines without a stock item need an expense or asset account", true);
    const out: PurchaseInvoiceItem[] = lines.map((l) => ({ description: l.description || "Item", qty: Number(l.qty || 0), rate: toCents(l.rate || 0), ...(l.inventoryItemId ? { inventoryItemId: l.inventoryItemId } : { account: l.account }) }));
    const po = grns.find((g) => grnIds.includes(g.id) && g.purchaseOrderId)?.purchaseOrderId;
    const v: PurchaseInvoice = {
      ...newDraftBase(actor.uid, ls?.defaultCostCenter ?? "MAIN"),
      ...(voucher ? { createdAt: voucher.createdAt } : {}),
      id: vid,
      type: "purchaseInvoice",
      postingDate: date,
      remarks: `${parties.name("supplier", supplierId)} invoice ${invNo.trim()}`,
      supplierId,
      supplierInvoiceNo: invNo.trim(),
      supplierInvoiceDate: invDate,
      dueDate: due,
      grnIds,
      items: out,
      vatAmount: settings.business.vatRegistered ? toCents(vat || 0) : 0,
      whtAmount: toCents(wht || 0),
      ...(po ? { purchaseOrderId: po } : {}),
    };
    await store.set(L.vouchers, v);
    if (submit) {
      const r = await run<SubmitOutcome & { voucher?: { match?: { status: string } } }>({ action: "submit", voucherId: v.id }, (x) =>
        x.status === "posted" ? `Posted ${x.voucher?.number ?? ""} – three-way match ${x.voucher?.match?.status ?? ""}` : "Price or quantity differs from the goods receipt: sent for approval",
      );
      if (!r) return;
    } else toast("Draft saved");
    onClose();
  }

  const set = (i: number, patch: Partial<ItemDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <Modal
      wide
      title={voucher ? "Edit supplier invoice" : "New supplier invoice"}
      onClose={onClose}
      footer={
        <div className="row between" style={{ width: "100%" }}>
          <span className="small">Net {money(net)} · VAT {money(toCents(vat || 0))} · <strong>Total {money(total)}</strong></span>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn primary" disabled={busy} onClick={() => save(true)}>Submit</button>
          </div>
        </div>
      }
    >
      <div className="stack">
        <div className="grid cols-3">
          <Field label="Supplier">
            <select className="select" value={supplierId} onChange={(e) => pickSupplier(e.target.value)}>
              <option value="">Choose…</option>
              {parties.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Supplier's invoice number"><input className="input" value={invNo} onChange={(e) => setInvNo(e.target.value)} /></Field>
          <Field label="Invoice date"><input className="input" type="date" value={invDate} onChange={(e) => setInvDate(e.target.value)} /></Field>
          <Field label="Posting date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due date"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        {supplierId ? (
          <Field label="Goods receipts to match" help="Stock lines are checked against the goods receipt and purchase order (three-way match). Differences beyond the tolerance need approval.">
            <div className="chips">
              {openGrns.length || grnIds.length ? (
                grns.filter((g) => g.vendorId === supplierId && (!billed.has(g.id) || grnIds.includes(g.id))).map((g) => (
                  <button key={g.id} className={`chip${grnIds.includes(g.id) ? " on" : ""}`} onClick={() => toggleGrn(g)}>
                    {g.number} · {g.date}
                  </button>
                ))
              ) : (
                <span className="small muted">No goods receipts waiting for an invoice from this supplier.</span>
              )}
            </div>
          </Field>
        ) : null}
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Description</th><th>Account</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input className="input" value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td>{l.inventoryItemId ? <span className="badge info">Stock – via goods receipt</span> : <AccountSelect value={l.account} onChange={(v) => set(i, { account: v })} filter={(a) => a.type === "expense" || a.type === "asset"} />}</td>
                  <td><input className="input num" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} style={{ width: 80 }} /></td>
                  <td><input className="input num" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} style={{ width: 110 }} /></td>
                  <td className="num">{amount(Math.round(Number(l.qty || 0) * toCents(l.rate || 0)))}</td>
                  <td><button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row"><button className="btn sm" onClick={() => setLines([...lines, { description: "", account: "", qty: "1", rate: "" }])}>Add service or expense line</button></div>
        <div className="grid cols-3">
          <Field label="Input VAT on the invoice" help={settings.business.vatRegistered ? "Claimable input tax" : "Not VAT-registered: VAT is part of the cost"}><input className="input" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} disabled={!settings.business.vatRegistered} /></Field>
          <Field label="Withholding tax deducted" help="Withheld from the supplier and payable to the IRD"><input className="input" inputMode="decimal" value={wht} onChange={(e) => setWht(e.target.value)} /></Field>
        </div>
        <AttachmentPanel linkedTo={{ col: L.vouchers, id: vid, label: "Supplier invoice" }} title="The supplier's bill (photo or scan)" />
      </div>
    </Modal>
  );
}

// ───────────────────────────── Customer invoices ─────────────────────────────

export function SalesInvoiceEditor({ voucher, onClose }: { voucher?: SalesInvoice; onClose: () => void }) {
  const { actor, store, toast, settings } = useApp();
  const ls = useLedgerSettings();
  const parties = useParties();
  const { run, busy } = useLedgerAction();
  const vatBp = settings.business.vatRegistered ? settings.tax.vatRate : 0;
  const [customerId, setCustomerId] = useState(voucher?.customerId ?? "");
  const [date, setDate] = useState(voucher?.postingDate ?? todayColombo());
  const [due, setDue] = useState(voucher?.dueDate ?? addDays(todayColombo(), 14));
  const [remarks, setRemarks] = useState(voucher?.remarks ?? "");
  const [lines, setLines] = useState<ItemDraft[]>(voucher ? voucher.items.map((i) => ({ description: i.description, account: i.account, qty: String(i.qty), rate: String(i.rate / 100) })) : [{ description: "", account: "4020", qty: "1", rate: "" }]);
  const net = lines.reduce((a, l) => a + Math.round(Number(l.qty || 0) * toCents(l.rate || 0)), 0);
  const vat = Math.round((net * vatBp) / 10_000);
  const set = (i: number, patch: Partial<ItemDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function save(submit: boolean) {
    if (!store || !actor) return;
    if (!customerId) return toast("Choose the customer", true);
    if (lines.some((l) => !l.account || !l.description)) return toast("Every line needs a description and an income account", true);
    const items: SalesInvoiceItem[] = lines.map((l) => ({ description: l.description, account: l.account, qty: Number(l.qty || 0), rate: toCents(l.rate || 0) }));
    const v: SalesInvoice = {
      ...newDraftBase(actor.uid, ls?.defaultCostCenter ?? "MAIN"),
      ...(voucher ? { createdAt: voucher.createdAt } : {}),
      id: voucher?.id ?? `SI-${newId()}`,
      type: "salesInvoice",
      postingDate: date,
      remarks: remarks.trim() || `Invoice to ${parties.name("customer", customerId)}`,
      customerId,
      dueDate: due,
      items,
      vatRateBp: vatBp,
    };
    await store.set(L.vouchers, v);
    if (submit) {
      const r = await run<SubmitOutcome>({ action: "submit", voucherId: v.id }, (x) => (x.status === "posted" ? `Posted ${x.voucher?.number ?? ""}` : "Submitted for approval"));
      if (!r) return;
    } else toast("Draft saved");
    onClose();
  }

  return (
    <Modal
      wide
      title={voucher ? "Edit customer invoice" : "New customer invoice"}
      onClose={onClose}
      footer={
        <div className="row between" style={{ width: "100%" }}>
          <span className="small">Net {money(net)} · VAT {money(vat)} · <strong>Total {money(net + vat)}</strong></span>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn primary" disabled={busy} onClick={() => save(true)}>Submit</button>
          </div>
        </div>
      }
    >
      <div className="stack">
        <div className="grid cols-3">
          <Field label="Customer">
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Choose…</option>
              {parties.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Invoice date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Due date"><input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Description"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Corporate dinner, 12 November" /></Field>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Description</th><th>Income account</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><input className="input" value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></td>
                  <td><AccountSelect value={l.account} onChange={(v) => set(i, { account: v })} filter={(a) => a.type === "income"} /></td>
                  <td><input className="input num" inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} style={{ width: 80 }} /></td>
                  <td><input className="input num" inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} style={{ width: 110 }} /></td>
                  <td className="num">{amount(Math.round(Number(l.qty || 0) * toCents(l.rate || 0)))}</td>
                  <td>{lines.length > 1 ? <button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row"><button className="btn sm" onClick={() => setLines([...lines, { description: "", account: "4020", qty: "1", rate: "" }])}>Add line</button></div>
        <p className="small muted">{vatBp ? `VAT at ${(vatBp / 100).toFixed(0)}% is added and posted to output VAT.` : "Not VAT-registered: no VAT is charged."}</p>
      </div>
    </Modal>
  );
}

// ───────────────────────────── Payments and receipts ─────────────────────────────

export function PaymentEditor({ side, voucher, onClose }: { side: Side; voucher?: PaymentVoucher; onClose: () => void }) {
  const { actor, store, toast } = useApp();
  const ls = useLedgerSettings();
  const parties = useParties();
  const { run, busy } = useLedgerAction();
  const invoices = useCollection<PurchaseInvoice | SalesInvoice>(L.vouchers, { where: [["type", "==", side === "supplier" ? "purchaseInvoice" : "salesInvoice"]] }) ?? [];
  const [partyId, setPartyId] = useState(voucher?.partyId ?? "");
  const [date, setDate] = useState(voucher?.postingDate ?? todayColombo());
  const [bank, setBank] = useState(voucher?.bankAccount ?? "1010");
  const [amt, setAmt] = useState(voucher ? String(voucher.amount / 100) : "");
  const [charges, setCharges] = useState(voucher ? String(voucher.bankCharges / 100) : "");
  const [ref, setRef] = useState(voucher?.reference ?? "");
  const [alloc, setAlloc] = useState<Record<string, string>>(Object.fromEntries((voucher?.allocations ?? []).map((a) => [a.voucherId, String(a.amount / 100)])));
  const open = invoices
    .filter((i) => i.status === "posted" && (i.outstanding ?? 0) > 0 && (i.type === "purchaseInvoice" ? i.supplierId : i.customerId) === partyId)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const allocated = Object.values(alloc).reduce((a, v) => a + toCents(v || 0), 0);
  const list = side === "supplier" ? parties.vendors : parties.customers;

  function autoAllocate(total: number) {
    let left = total;
    const next: Record<string, string> = {};
    for (const i of open) {
      if (left <= 0) break;
      const take = Math.min(left, i.outstanding ?? 0);
      next[i.id] = String(take / 100);
      left -= take;
    }
    setAlloc(next);
  }

  async function save(submit: boolean) {
    if (!store || !actor) return;
    const total = toCents(amt || 0);
    if (!partyId || total <= 0) return toast(`Choose the ${side} and enter the amount`, true);
    if (allocated > total) return toast("Allocated more than the payment amount", true);
    const v: PaymentVoucher = {
      ...newDraftBase(actor.uid, ls?.defaultCostCenter ?? "MAIN"),
      ...(voucher ? { createdAt: voucher.createdAt } : {}),
      id: voucher?.id ?? `${side === "supplier" ? "PAY" : "REC"}-${newId()}`,
      type: "payment",
      postingDate: date,
      remarks: `${side === "supplier" ? "Payment to" : "Receipt from"} ${parties.name(side, partyId)}`,
      direction: side === "supplier" ? "pay" : "receive",
      partyType: side,
      partyId,
      bankAccount: bank,
      amount: total,
      allocations: Object.entries(alloc).filter(([, a]) => toCents(a || 0) > 0).map(([voucherId, a]) => ({ voucherId, amount: toCents(a) })),
      bankCharges: toCents(charges || 0),
      ...(ref ? { reference: ref } : {}),
    };
    await store.set(L.vouchers, v);
    if (submit) {
      const r = await run<SubmitOutcome>({ action: "submit", voucherId: v.id }, (x) => (x.status === "posted" ? `Posted ${x.voucher?.number ?? ""}` : "Submitted for approval"));
      if (!r) return;
    } else toast("Draft saved");
    onClose();
  }

  return (
    <Modal
      wide
      title={side === "supplier" ? "Pay a supplier" : "Receive from a customer"}
      onClose={onClose}
      footer={
        <div className="row between" style={{ width: "100%" }}>
          <span className="small">Allocated {money(allocated)} of {money(toCents(amt || 0))}{toCents(amt || 0) > allocated ? ` · ${money(toCents(amt || 0) - allocated)} on account (advance)` : ""}</span>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn primary" disabled={busy} onClick={() => save(true)}>Submit</button>
          </div>
        </div>
      }
    >
      <div className="stack">
        <div className="grid cols-3">
          <Field label={side === "supplier" ? "Supplier" : "Customer"}>
            <select className="select" value={partyId} onChange={(e) => { setPartyId(e.target.value); setAlloc({}); }}>
              <option value="">Choose…</option>
              {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Bank or cash account"><AccountSelect value={bank} onChange={setBank} filter={(a) => a.accountType === "Bank" || a.accountType === "Cash"} /></Field>
          <Field label="Amount"><input className="input" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} onBlur={() => !allocated && autoAllocate(toCents(amt || 0))} /></Field>
          <Field label="Bank charges"><input className="input" inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} /></Field>
          <Field label="Reference" help="Cheque number or transfer reference (used for bank matching)"><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        {partyId ? (
          <div className="card table-wrap">
            <div className="card-head"><h3>Open invoices</h3><button className="btn sm" onClick={() => autoAllocate(toCents(amt || 0))}>Allocate oldest first</button></div>
            <table className="table">
              <thead><tr><th>Invoice</th><th>Date</th><th>Due</th><th className="num">Outstanding</th><th className="num">Allocate</th></tr></thead>
              <tbody>
                {open.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.number}{i.type === "purchaseInvoice" ? <span className="muted"> · {i.supplierInvoiceNo}</span> : null}</td>
                    <td>{i.postingDate}</td>
                    <td>{i.dueDate}</td>
                    <td className="num">{money(i.outstanding)}</td>
                    <td className="num"><input className="input num" inputMode="decimal" value={alloc[i.id] ?? ""} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} style={{ width: 120 }} /></td>
                  </tr>
                ))}
                {!open.length ? <tr><td colSpan={5} className="muted">No open invoices – the amount will be held as an advance.</td></tr> : null}
              </tbody>
            </table>
          </div>
        ) : null}
        {side === "supplier" && ls ? <p className="small muted">Payments of {money(ls.paymentApprovalThreshold)} or more need approval by a second person.</p> : null}
      </div>
    </Modal>
  );
}

// ───────────────────────────── Aging ─────────────────────────────

export function AgingView({ side }: { side: Side }) {
  const { settings } = useApp();
  const parties = useParties();
  const invoices = useCollection<PurchaseInvoice | SalesInvoice>(L.vouchers, { where: [["type", "==", side === "supplier" ? "purchaseInvoice" : "salesInvoice"]] }) ?? [];
  const [asOf, setAsOf] = useState(todayColombo());
  const rows = aging(invoices, asOf);
  const byParty = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const cur = byParty.get(r.partyId) ?? Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0]));
    cur[r.bucket] = (cur[r.bucket] ?? 0) + r.outstanding;
    byParty.set(r.partyId, cur);
  }
  const totals = Object.fromEntries(AGING_BUCKETS.map((b) => [b, rows.filter((r) => r.bucket === b).reduce((a, r) => a + r.outstanding, 0)]));
  const all = rows.reduce((a, r) => a + r.outstanding, 0);

  async function exportXlsx() {
    const buf = await tablesToWorkbook([
      {
        name: "Aging",
        title: `${side === "supplier" ? "Payables" : "Receivables"} aging as at ${asOf} – ${settings.business.legalName}`,
        totals: true,
        rows,
        columns: [
          { header: side === "supplier" ? "Supplier" : "Customer", value: (r) => parties.name(side, r.partyId), width: 28 },
          { header: "Document", value: (r) => r.number, width: 18 },
          { header: "Date", value: (r) => r.postingDate },
          { header: "Due", value: (r) => r.dueDate },
          { header: "Days overdue", value: (r) => r.daysOverdue, format: "number" },
          { header: "Bucket", value: (r) => r.bucket },
          { header: "Outstanding", value: (r) => r.outstanding, format: "money", width: 16 },
        ],
      },
    ]);
    downloadBuffer(buf, `${side === "supplier" ? "payables" : "receivables"}-aging-${asOf}.xlsx`);
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <Field label="As at"><input className="input" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <button className="btn" style={{ alignSelf: "flex-end" }} onClick={exportXlsx}>Export to Excel</button>
      </div>
      <div className="grid cols-3">
        <Stat label="Total open" value={money(all)} />
        {AGING_BUCKETS.slice(1).map((b) => <Stat key={b} label={b === "Over 90" ? "Over 90 days" : `${b} days`} value={money(totals[b])} {...(totals[b] && b !== "1–30" ? { tone: "bad" as const, sub: "overdue" } : {})} />)}
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>{side === "supplier" ? "Supplier" : "Customer"}</th>{AGING_BUCKETS.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr></thead>
          <tbody>
            {[...byParty].map(([pid, b]) => (
              <tr key={pid}>
                <td>{parties.name(side, pid)}</td>
                {AGING_BUCKETS.map((k) => <td key={k} className="num">{b[k] ? amount(b[k]) : ""}</td>)}
                <td className="num"><strong>{amount(Object.values(b).reduce((a, x) => a + x, 0))}</strong></td>
              </tr>
            ))}
            {!byParty.size ? <tr><td colSpan={7} className="muted">Nothing outstanding.</td></tr> : null}
          </tbody>
          <tfoot><tr><td>Total</td>{AGING_BUCKETS.map((k) => <td key={k} className="num">{amount(totals[k])}</td>)}<td className="num">{amount(all)}</td></tr></tfoot>
        </table>
      </div>
    </div>
  );
}

// ───────────────────────────── Pages ─────────────────────────────

function PartyPage({ side }: { side: Side }) {
  const { on, role } = useApp();
  const [tab, setTab] = useState<"invoices" | "payments" | "aging">("invoices");
  const [creating, setCreating] = useState<"invoice" | "payment" | null>(null);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const books = canBooks(role);
  const supplier = side === "supplier";
  const editor = (v: Voucher, close: () => void) =>
    v.type === "purchaseInvoice" ? <PurchaseInvoiceEditor voucher={v} onClose={close} /> : v.type === "salesInvoice" ? <SalesInvoiceEditor voucher={v} onClose={close} /> : v.type === "payment" ? <PaymentEditor side={side} voucher={v} onClose={close} /> : null;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{supplier ? "Payables" : "Receivables"}</h1>
          <p>
            {supplier
              ? "Supplier invoices matched to goods receipts and purchase orders, payments with allocation to open invoices, and aging."
              : "Credit sales to corporate and house-account customers, receipts and aging. POS bills settled on the day are posted by the POS day journal."}
          </p>
        </div>
        {books ? (
          <div className="row wrap">
            <button className="btn" onClick={() => setCreating("payment")}>{supplier ? "Pay supplier" : "Record receipt"}</button>
            <button className="btn primary" onClick={() => setCreating("invoice")}>{supplier ? "New supplier invoice" : "New customer invoice"}</button>
          </div>
        ) : null}
      </div>
      <Seg value={tab} onChange={setTab} options={[{ value: "invoices", label: "Invoices" }, { value: "payments", label: supplier ? "Payments" : "Receipts" }, { value: "aging", label: "Aging" }]} />
      {tab === "invoices" ? <VoucherList head={false} title="" types={[supplier ? "purchaseInvoice" : "salesInvoice"]} editor={editor} /> : null}
      {tab === "payments" ? <PaymentsList side={side} editor={editor} /> : null}
      {tab === "aging" ? <AgingView side={side} /> : null}
      {creating === "invoice" ? (supplier ? <PurchaseInvoiceEditor onClose={() => setCreating(null)} /> : <SalesInvoiceEditor onClose={() => setCreating(null)} />) : null}
      {creating === "payment" ? <PaymentEditor side={side} onClose={() => setCreating(null)} /> : null}
    </div>
  );
}

function PaymentsList({ side, editor }: { side: Side; editor: (v: Voucher, close: () => void) => ReactNode }) {
  // Payments and receipts share one voucher type; show this side's only.
  return <VoucherList head={false} title="" types={["payment"]} editor={editor} filter={(v) => v.type === "payment" && v.partyType === side} />;
}

export const PayablesPage = () => <PartyPage side="supplier" />;
export const ReceivablesPage = () => <PartyPage side="customer" />;
