import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type Account, type Attachment, type Vendor, COLLECTIONS as C, addDays, newId } from "@pos/core";
import { type JournalVoucher, type LineInput, type PaymentVoucher, type PurchaseInvoice, LEDGER as L } from "@pos/ledger";
import { AttachmentPanel, AttachmentThumb, AttachmentViewer, useAttachmentUpload } from "../../components/Attachments";
import { Field, ModuleOff, PageHead, Seg } from "../../components/ui";
import { linkAttachment } from "../../lib/attachments";
import { dateTimeColombo, money, toCents, todayColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";
import { type SubmitOutcome, useAccounts, useLedgerSettings, useParties } from "./shared";

/** Where money for an expense came from. */
const PAID_FROM: { value: string; label: string; account?: string }[] = [
  { value: "unpaid", label: "Not paid yet (on credit)" },
  { value: "cash", label: "Cash", account: "1000" },
  { value: "petty", label: "Petty cash", account: "1001" },
  { value: "bank", label: "Bank (transfer, cheque, card)", account: "1010" },
];

/** Expense categories offered first: the accounts people use most. */
function categoryGroups(list: Account[]) {
  const leaf = list.filter((a) => !a.isGroup && !a.frozen);
  return [
    { label: "Food and drink bought for the kitchen (not kept in stock)", accounts: leaf.filter((a) => a.accountType === "CostOfGoodsSold") },
    { label: "Running costs", accounts: leaf.filter((a) => a.type === "expense" && a.accountType !== "CostOfGoodsSold" && a.accountType !== "Depreciation") },
    { label: "Equipment and furniture (fixed assets)", accounts: leaf.filter((a) => a.accountType === "FixedAsset") },
    { label: "Other", accounts: leaf.filter((a) => a.accountType === "Stock" || (a.type === "asset" && a.accountType === undefined && !["1100", "1300"].includes(a.code))) },
  ].filter((g) => g.accounts.length);
}

// ───────────────────────────── Record an expense ─────────────────────────────

/**
 * Finance → Record an expense: one simple form for a supplier bill or a cash purchase (vegetables,
 * gas, repairs, rent…), with a photo of the bill. Behind it: a supplier invoice, and when it was
 * paid at once, a payment against it, both posted through the ledger with full audit trail.
 */
export function RecordExpensePage() {
  const { actor, settings, ledger, toast, on } = useApp();
  const store = useStore();
  const ls = useLedgerSettings();
  const { list } = useAccounts();
  const parties = useParties();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromInbox = params.get("attachment");
  const inboxAtt = (useCollection<Attachment>(fromInbox ? C.attachments : null, fromInbox ? { where: [["id", "==", fromInbox]] } : undefined) ?? [])[0];
  const [id, setId] = useState(() => `PI-${newId()}`);
  const [date, setDate] = useState(todayColombo());
  const [supplierId, setSupplierId] = useState("");
  const [newSupplier, setNewSupplier] = useState("");
  const [billNo, setBillNo] = useState("");
  const [account, setAccount] = useState("");
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [vat, setVat] = useState("");
  const [paidFrom, setPaidFrom] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const prefilled = useRef(false);
  useEffect(() => {
    if (!inboxAtt || prefilled.current) return;
    prefilled.current = true;
    if (inboxAtt.documentDate) setDate(inboxAtt.documentDate);
    if (inboxAtt.amount) setTotal(String(inboxAtt.amount / 100));
    const v = inboxAtt.supplierName ? parties.vendors.find((x) => x.name.toLowerCase() === inboxAtt.supplierName!.toLowerCase()) : undefined;
    if (v) setSupplierId(v.id);
    else if (inboxAtt.supplierName) {
      setSupplierId("__new");
      setNewSupplier(inboxAtt.supplierName);
    }
  }, [inboxAtt, parties.vendors]);

  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const vatOn = settings.business.vatRegistered;
  const totalC = toCents(total || 0);
  const vatC = vatOn ? toCents(vat || 0) : 0;
  const net = totalC - vatC;

  async function supplier(): Promise<string> {
    if (supplierId && supplierId !== "__new" && supplierId !== "SUNDRY") return supplierId;
    if (supplierId === "__new") {
      const name = newSupplier.trim();
      if (!name) throw new Error("Type the new supplier's name");
      const code = `V${Date.now().toString(36).toUpperCase().slice(-6)}`;
      const v: Vendor = { id: code, code, name, phone: "", paymentTermsDays: 30, active: true };
      await store.set(C.vendors, v);
      return code;
    }
    // Cash purchases without a named supplier go to one "Sundry suppliers" account.
    if (!parties.vendors.some((v) => v.id === "SUNDRY")) await store.set(C.vendors, { id: "SUNDRY", code: "SUNDRY", name: "Sundry suppliers (cash purchases)", phone: "", paymentTermsDays: 0, active: true } satisfies Vendor);
    return "SUNDRY";
  }

  async function save() {
    if (!actor || !ls) return;
    if (!account) return toast("Choose what the expense was for", true);
    if (!(net > 0)) return toast("Enter the amount (the VAT can't be more than the total)", true);
    if (!supplierId) return toast("Choose the supplier, or “No named supplier”", true);
    if (supplierId === "SUNDRY" && paidFrom === "unpaid") return toast("A purchase without a named supplier must be paid now", true);
    setBusy(true);
    try {
      const sup = await supplier();
      const terms = parties.vendors.find((v) => v.id === sup)?.paymentTermsDays ?? 30;
      const acc = list.find((a) => a.id === account);
      const pi: PurchaseInvoice = {
        id,
        type: "purchaseInvoice",
        status: "draft",
        postingDate: date,
        currency: "LKR",
        exchangeRateMicros: 1_000_000,
        costCenter: ls.defaultCostCenter,
        propertyId: ls.defaultCostCenter,
        createdBy: actor.uid,
        createdAt: new Date().toISOString(),
        remarks: `${description.trim() || acc?.name || "Expense"}${billNo.trim() ? ` – bill ${billNo.trim()}` : ""}`,
        supplierId: sup,
        supplierInvoiceNo: billNo.trim() || `NO-BILL-${date}-${id.slice(-4)}`,
        supplierInvoiceDate: date,
        dueDate: paidFrom === "unpaid" ? addDays(date, terms) : date,
        grnIds: [],
        items: [{ description: description.trim() || acc?.name || "Expense", account, qty: 1, rate: net }],
        vatAmount: vatC,
        whtAmount: 0,
      };
      await store.set(L.vouchers, pi);
      if (inboxAtt) await linkAttachment(store, inboxAtt.id, { col: L.vouchers, id, label: pi.remarks });
      const r = await ledger<SubmitOutcome>({ action: "submit", voucherId: id });
      let paid = "";
      const bank = PAID_FROM.find((p) => p.value === paidFrom)?.account;
      if (bank && r.status === "posted") {
        const pay: PaymentVoucher = {
          id: `PAY-${newId()}`,
          type: "payment",
          status: "draft",
          postingDate: date,
          currency: "LKR",
          exchangeRateMicros: 1_000_000,
          costCenter: ls.defaultCostCenter,
          propertyId: ls.defaultCostCenter,
          createdBy: actor.uid,
          createdAt: new Date().toISOString(),
          remarks: `Paid: ${pi.remarks}`,
          direction: "pay",
          partyType: "supplier",
          partyId: sup,
          bankAccount: bank,
          amount: totalC,
          allocations: [{ voucherId: id, amount: totalC }],
          bankCharges: 0,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        };
        await store.set(L.vouchers, pay);
        const p = await ledger<SubmitOutcome>({ action: "submit", voucherId: pay.id });
        paid = p.status === "posted" ? ` and paid (${p.voucher?.number ?? ""})` : " — the payment is waiting for approval (Finance → Approvals)";
      }
      toast(`Expense recorded: ${r.voucher?.number ?? id}${paid}`);
      setId(`PI-${newId()}`);
      setBillNo("");
      setDescription("");
      setTotal("");
      setVat("");
      setReference("");
      if (fromInbox) navigate("/emc/finance/bills");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead title="Record an expense" subtitle="A supplier bill or a cash purchase, with a photo of the bill. Posted to the books at once." />
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card card-body stack">
          <div className="grid cols-2">
            <Field label="Date on the bill"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Bill / invoice number" help="Leave empty if there is none."><input className="input" value={billNo} onChange={(e) => setBillNo(e.target.value)} /></Field>
          </div>
          <Field label="Supplier">
            <select className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Supplier">
              <option value="">Choose…</option>
              <option value="SUNDRY">No named supplier (cash purchase)</option>
              <option value="__new">+ New supplier…</option>
              {parties.vendors.filter((v) => v.id !== "SUNDRY").map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>
          {supplierId === "__new" ? <Field label="New supplier's name"><input className="input" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="e.g. Perera Vegetable Stores" /></Field> : null}
          <Field label="What was it for?" help="Food bought for the kitchen that isn't kept in stock goes to cost of sales; equipment to fixed assets.">
            <select className="select" value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Expense category">
              <option value="">Choose a category…</option>
              {categoryGroups(list).map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.accounts.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Vegetables for the week" /></Field>
          <div className="grid cols-2">
            <Field label="Total on the bill (Rs)"><input className="input num" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} aria-label="Total" /></Field>
            {vatOn ? <Field label="VAT included (Rs)" help="Only if the bill is a VAT invoice with the supplier's VAT number."><input className="input num" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} /></Field> : null}
          </div>
          <Field label="Paid from"><Seg<string> value={paidFrom} onChange={setPaidFrom} options={PAID_FROM.map((p) => ({ value: p.value, label: p.label }))} /></Field>
          {paidFrom === "bank" ? <Field label="Payment reference" help="Cheque number or transfer reference."><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field> : null}
          <div className="row between">
            <span className="small muted">{vatOn && vatC ? `Expense ${money(net)} + VAT ${money(vatC)} = ` : ""}<strong>{money(totalC)}</strong></span>
            <button className="btn primary lg" disabled={busy} onClick={save}>{busy ? "Saving…" : "Record expense"}</button>
          </div>
        </div>
        <div className="stack">
          {inboxAtt ? <div className="callout small">Recording the bill from Bills &amp; receipts. It will be attached to this expense.</div> : null}
          <AttachmentPanel linkedTo={{ col: L.vouchers, id, label: "Expense" }} />
          <div className="card card-body small muted">
            <p style={{ margin: 0 }}>Tips</p>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              <li>Stock items (rice, chicken, oil) you count in the store are better received under Inventory → Goods receipts, so stock and food cost stay right.</li>
              <li>Bills you pay later stay open under Payables until you pay them there.</li>
              <li>Several paper bills to enter? Photograph them all first under Bills &amp; receipts, then record each one from there.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Daily sales from manual bills ─────────────────────────────

/**
 * Finance → Daily sales (manual bills): a day's handwritten bills as one entry, for businesses
 * not (yet) using the POS. Sales, service charge and taxes against the money received.
 */
export function DailySalesPage() {
  const { actor, settings, ledger, toast, on } = useApp();
  const store = useStore();
  const ls = useLedgerSettings();
  const [id, setId] = useState(() => `JV-SALES-${newId()}`);
  const [date, setDate] = useState(addDays(todayColombo(), -1));
  const [bills, setBills] = useState("");
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const acc = settings.accounting.accounts;
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const c = (k: string) => toCents(v[k] || 0);
  const vatOn = settings.business.vatRegistered;
  const ssclOn = settings.business.ssclLiable;
  const sales = c("food") + c("beverage") + c("other") + c("sc") + (vatOn ? c("vat") : 0) + (ssclOn ? c("sscl") : 0) - c("discount");
  const received = c("cash") + c("card") + c("bank");
  const diff = sales - received;
  const input = (k: string, label: string, help?: string) => (
    <Field label={label} {...(help ? { help } : {})}><input className="input num" inputMode="decimal" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value })} aria-label={label} /></Field>
  );

  async function save() {
    if (!actor || !ls) return;
    if (!(sales > 0)) return toast("Enter the day's sales", true);
    if (diff !== 0) return toast(`Sales and money received differ by ${money(diff)}: they must be equal`, true);
    const line = (account: string, debit: number, credit: number, memo: string): LineInput[] => (debit || credit ? [{ account, debit, credit, memo }] : []);
    const lines: LineInput[] = [
      ...line("1000", c("cash"), 0, "Cash received"),
      ...line("1020", c("card"), 0, "Card payments"),
      ...line("1010", c("bank"), 0, "Bank transfers / LankaQR"),
      ...line(acc.discounts, c("discount"), 0, "Discounts given"),
      ...line(acc.salesByMajorGroup.Food ?? "4000", 0, c("food"), "Food sales"),
      ...line(acc.salesByMajorGroup.Beverage ?? "4010", 0, c("beverage"), "Beverage sales"),
      ...line(acc.salesByMajorGroup.Other ?? "4020", 0, c("other"), "Other sales"),
      ...line(acc.serviceCharge, 0, c("sc"), "Service charge"),
      ...(vatOn ? line(acc.vatOutput, 0, c("vat"), "VAT output") : []),
      ...(ssclOn ? line(acc.ssclPayable, 0, c("sscl"), "SSCL") : []),
    ];
    const jv: JournalVoucher & { source: string } = {
      id,
      type: "journal",
      status: "draft",
      source: "manualSales",
      postingDate: date,
      currency: "LKR",
      exchangeRateMicros: 1_000_000,
      costCenter: ls.defaultCostCenter,
      propertyId: ls.defaultCostCenter,
      createdBy: actor.uid,
      createdAt: new Date().toISOString(),
      remarks: `Sales from manual bills ${date}${bills.trim() ? ` (bills ${bills.trim()})` : ""}`,
      lines,
    };
    setBusy(true);
    try {
      await store.set(L.vouchers, jv);
      const r = await ledger<SubmitOutcome>({ action: "submit", voucherId: id });
      toast(r.status === "posted" ? `Sales for ${date} posted (${r.voucher?.number ?? ""})` : `Sales for ${date} saved; waiting for approval by a second person (Finance → Approvals)`);
      setId(`JV-SALES-${newId()}`);
      setV({});
      setBills("");
      setDate(addDays(date, 1));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHead title="Daily sales (manual bills)" subtitle="Add up a day's handwritten bills and enter the totals here, with a photo of the bills. For days before the POS was used, or days it wasn't." />
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="card card-body stack">
          <div className="grid cols-2">
            <Field label="Business date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Bill numbers" help="e.g. 1201–1258"><input className="input" value={bills} onChange={(e) => setBills(e.target.value)} /></Field>
          </div>
          <h3>Sales (before service charge and taxes)</h3>
          <div className="grid cols-3">{input("food", "Food")}{input("beverage", "Beverages")}{input("other", "Other")}</div>
          <div className="grid cols-3">
            {input("sc", "Service charge")}
            {vatOn ? input("vat", "VAT") : null}
            {ssclOn ? input("sscl", "SSCL") : null}
            {input("discount", "Discounts given")}
          </div>
          <h3>Money received</h3>
          <div className="grid cols-3">{input("cash", "Cash")}{input("card", "Card")}{input("bank", "Bank / LankaQR")}</div>
          <div className="row between">
            <span className="small">
              Bills total <strong>{money(sales)}</strong> · received <strong>{money(received)}</strong>{" "}
              {diff ? <span className="badge bad">difference {money(diff)}</span> : sales ? <span className="badge good">balanced</span> : null}
            </span>
            <button className="btn primary lg" disabled={busy || !sales || diff !== 0} onClick={save}>{busy ? "Saving…" : "Post the day"}</button>
          </div>
        </div>
        <div className="stack">
          <AttachmentPanel linkedTo={{ col: L.vouchers, id, label: "Manual sales" }} title="Photos of the day's bills" />
          <p className="small muted">Credit sales to companies are entered as customer invoices under Receivables instead.</p>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Bills & receipts inbox ─────────────────────────────

/**
 * Finance → Bills & receipts: photograph a pile of paper bills first, then record each one. Every
 * file keeps its fingerprint; linked files show the document they belong to.
 */
export function BillsInboxPage() {
  const store = useStore();
  const navigate = useNavigate();
  const { role } = useApp();
  const [show, setShow] = useState<"inbox" | "all">("inbox");
  const all = useCollection<Attachment>(C.attachments) ?? [];
  const list = useMemo(() => all.filter((a) => show === "all" || a.status === "inbox").sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)), [all, show]);
  const { upload, busy } = useAttachmentUpload();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Attachment | null>(null);
  const edit = (a: Attachment, patch: Partial<Attachment>) => void store.merge(C.attachments, a.id, patch);
  return (
    <div className="page">
      <PageHead
        title="Bills & receipts"
        subtitle="Photograph or scan paper bills here first, then record each one. Every file is kept with a fingerprint, so it can't be changed afterwards."
        actions={
          <>
            <button className="btn primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Saving…" : "📷 Add photos or scans"}</button>
            <input ref={input} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} />
          </>
        }
      />
      <Seg<"inbox" | "all"> value={show} onChange={setShow} options={[{ value: "inbox", label: `To record (${all.filter((a) => a.status === "inbox").length})` }, { value: "all", label: `All files (${all.length})` }]} />
      {!list.length ? <div className="empty">{show === "inbox" ? "Nothing waiting. Add photos of paper bills to record them one by one." : "No files yet."}</div> : null}
      <div className="bills-grid">
        {list.map((a) => (
          <div key={a.id} className="card card-body stack tight">
            <AttachmentThumb att={a} onOpen={() => setOpen(a)} />
            <span className="tiny muted">Filed {dateTimeColombo(a.uploadedAt)}</span>
            {a.status === "linked" ? (
              <span className="badge good">{a.linkedTo?.label ?? "Recorded"}</span>
            ) : (
              <>
                <input className="input" type="date" aria-label="Date on the bill" defaultValue={a.documentDate ?? ""} onBlur={(e) => e.target.value !== (a.documentDate ?? "") && edit(a, { documentDate: e.target.value })} />
                <input className="input" placeholder="Supplier" aria-label="Supplier" defaultValue={a.supplierName ?? ""} onBlur={(e) => e.target.value !== (a.supplierName ?? "") && edit(a, { supplierName: e.target.value })} />
                <input className="input num" placeholder="Amount" inputMode="decimal" aria-label="Amount" defaultValue={a.amount ? String(a.amount / 100) : ""} onBlur={(e) => edit(a, { amount: toCents(e.target.value || 0) })} />
                <button className="btn sm primary" onClick={() => navigate(`/emc/finance/expense?attachment=${a.id}`)}>Record as expense</button>
                {role === "owner" || role === "admin" ? <button className="btn sm ghost" onClick={() => void store.remove(C.attachments, a.id)}>Remove</button> : null}
              </>
            )}
          </div>
        ))}
      </div>
      {open ? <AttachmentViewer att={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
