import { useState } from "react";
import { type MobileStyle, type TenderMedia, lankaQrPayload, makePayment, payhereCheckout } from "@pos/core";
import { QrCode } from "../../../components/Receipt";
import { money, toCents } from "../../../lib/format";
import { useApp } from "../../../state/app";
import { Icon, tenderIcon } from "./icons";
import type { PaidResult, PosApi } from "./MobilePos";

const TENDER_SUB: Record<string, string> = {
  cash: "Notes and coins, change given",
  foreignCash: "Foreign currency at today's rate",
  card: "Pay on the card machine",
  lankaqr: "Any LankaQR banking app",
  payhere: "Card or wallet online via PayHere",
  voucher: "Gift voucher",
  house: "Charge to an account",
  comp: "Complimentary (manager)",
};

/** Full-screen payment (mockup style): choose how the guest pays, take it, close the check. */
export function MobilePay({ api, style, onBack, onPaid }: { api: PosApi; style: MobileStyle; onBack: () => void; onPaid: (r: PaidResult) => void }) {
  const { settings, on, toast } = useApp();
  const check = api.check;
  const [tender, setTender] = useState<TenderMedia | null>(null);
  const [entry, setEntry] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  if (!check || !api.totals) return null;
  const due = api.totals.amountDue;
  const paid = check.payments.reduce((a, p) => a + p.applied, 0);
  const balance = Math.max(0, due - paid);
  const visible = api.tenders.filter((t) => t.active && (t.type !== "lankaqr" || on("lankaqr")) && (t.type !== "payhere" || on("payhere"))).sort((a, b) => a.sortOrder - b.sortOrder);
  const chosen = tender ?? visible.find((t) => t.type === "cash") ?? visible[0] ?? null;
  const entered = toCents(entry || "0");
  const isCash = chosen?.type === "cash" || chosen?.type === "foreignCash";
  const isQr = chosen?.type === "lankaqr" || chosen?.type === "payhere";
  const amountLkr = chosen?.type === "foreignCash" ? Math.round((entered * (chosen.exchangeRateMicros ?? 0)) / 1_000_000) : entered;
  const take = isCash ? entered || balance : Math.min(entered || balance, balance);
  const changePreview = chosen?.type === "cash" && entered > balance ? entered - balance : chosen?.type === "foreignCash" && amountLkr > balance ? amountLkr - balance : 0;
  const reference = `CHK${check.checkNo}-${api.ws.code}`;
  const qrPayload = chosen?.type === "lankaqr" ? lankaQrPayload({ ...settings.integrations.lankaqr, amount: balance, reference }) : chosen?.type === "payhere" ? payhereCheckout({ mode: settings.integrations.payhere.mode, merchantId: settings.integrations.payhere.merchantId, orderId: reference, amount: balance, items: `Check #${check.checkNo}`, returnUrl: location.origin, notifyUrl: `${location.origin}/payhere/notify` }).url : "";
  const mockQr = chosen?.type === "lankaqr" ? settings.integrations.lankaqr.mode === "mock" : settings.integrations.payhere.mode === "mock";
  const quick = [balance, Math.ceil(balance / 100_000) * 100_000, Math.ceil(balance / 500_000) * 500_000, Math.ceil(balance / 500_000) * 500_000 + 500_000].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);

  async function pay(reference?: string) {
    if (!chosen || !check) return;
    setBusy(true);
    try {
      const { payment } = makePayment({ tender: chosen, amount: chosen.type === "foreignCash" ? entered : take, balance, by: api.user.id, ...(reference ? { reference } : {}) });
      const next = { ...check, payments: [...check.payments, payment] };
      const left = due - next.payments.reduce((a, p) => a + p.applied, 0);
      setEntry("");
      setRef("");
      if (left > 0) {
        api.setCheck(next);
        toast(`${money(payment.applied)} taken by ${chosen.name}. Balance ${money(left)}.`);
        return;
      }
      const result = await api.finish(next);
      if (result) onPaid(result);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const needsRef = Boolean(chosen?.requiresReference) && !isQr;
  const label = style === "indigo" ? "Complete Payment" : "Pay Now";
  return (
    <div className="m-page">
      <header className="m-head">
        <button className="m-icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <div className="m-head-title"><strong>Payment</strong><span>Check #{check.checkNo}{check.tableId ? ` · Table ${api.tableName(check.tableId)}` : ""}</span></div>
        <span className="m-icon-btn" />
      </header>
      <div className="m-screen">
        <div className="m-card m-hero center">
          <span className="m-muted">{paid ? "Balance to pay" : "Total amount"}</span>
          <strong className="m-big">{money(balance)}</strong>
          {paid ? <span className="m-muted small">Bill {money(due)} · paid {money(paid)}</span> : null}
        </div>
        {check.payments.length ? (
          <div className="m-card">
            {check.payments.map((p) => (
              <div key={p.id} className="row between m-pay-line">
                <span>{api.tenders.find((t) => t.id === p.tenderId)?.name}{p.reference ? <span className="m-muted small"> · {p.reference}</span> : null}</span>
                <span className="row"><span className="num">{money(p.tendered)}</span><button className="m-icon-btn sm" aria-label="Remove payment" onClick={() => api.setCheck({ ...check, payments: check.payments.filter((x) => x.id !== p.id) })}><Icon name="x" size={16} /></button></span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="m-section-title">Payment method</div>
        <div className="m-card m-list" role="radiogroup" aria-label="Payment method">
          {visible.map((t) => (
            <button key={t.id} role="radio" aria-checked={chosen?.id === t.id} className={`m-tender${chosen?.id === t.id ? " on" : ""}`} onClick={() => { setTender(t); setEntry(""); setRef(""); }}>
              <span className="m-tender-ico"><Icon name={tenderIcon(t.type)} /></span>
              <span className="m-tender-text"><strong>{t.name}</strong><span>{t.type === "foreignCash" ? `${t.currency} @ ${((t.exchangeRateMicros ?? 0) / 1_000_000).toFixed(2)}` : TENDER_SUB[t.type] ?? t.type}</span></span>
              <span className="m-radio" />
            </button>
          ))}
        </div>
        {chosen && isCash ? (
          <div className="m-card stack">
            <label className="m-field">
              <span>{chosen.type === "foreignCash" ? `${chosen.currency} received` : "Cash received"}</span>
              <input className="m-input num" inputMode="decimal" placeholder={chosen.type === "foreignCash" ? "0.00" : (balance / 100).toFixed(2)} value={entry} onChange={(e) => setEntry(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount received" />
            </label>
            {chosen.type === "cash" ? (
              <div className="m-chips wrap">
                {quick.map((v) => <button key={v} className="m-chip" onClick={() => setEntry((v / 100).toFixed(2))}>{v === balance ? "Exact" : money(v)}</button>)}
              </div>
            ) : entered ? <span className="m-muted small">= {money(amountLkr)}</span> : null}
            {changePreview ? <div className="m-change">Change to give <strong>{money(changePreview)}</strong></div> : null}
          </div>
        ) : null}
        {chosen && isQr ? (
          <div className="m-card stack center">
            <QrCode data={qrPayload} size={190} />
            <span className="m-muted small">{chosen.type === "lankaqr" ? "Guest scans with any LankaQR banking app." : "Guest scans to pay online via PayHere."}{mockQr ? " Demo mode: no real money moves." : ""}</span>
            <input className="m-input" placeholder="Transaction reference" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Transaction reference" />
            {mockQr ? <button className="m-btn outline block" disabled={busy} onClick={() => pay(`SIM-${Date.now().toString().slice(-6)}`)}>Simulate payment received</button> : null}
          </div>
        ) : null}
        {chosen && !isCash && !isQr ? (
          <div className="m-card stack">
            <label className="m-field">
              <span>Amount (leave empty for the full balance)</span>
              <input className="m-input num" inputMode="decimal" placeholder={(balance / 100).toFixed(2)} value={entry} onChange={(e) => setEntry(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Amount" />
            </label>
            {needsRef ? (
              <label className="m-field">
                <span>{chosen.type === "card" ? "Approval code from the card machine" : "Reference"}</span>
                <input className="m-input" value={ref} onChange={(e) => setRef(e.target.value)} aria-label="Reference" />
              </label>
            ) : null}
            {chosen.type === "card" ? <span className="m-muted small">Run the card on the bank's machine first, then key in its approval code.</span> : null}
          </div>
        ) : null}
      </div>
      <footer className="m-foot">
        <button className="m-btn cta block lg" disabled={busy || !chosen || (needsRef && !ref.trim()) || (isQr && !ref.trim()) || (chosen?.type === "foreignCash" && !entered)} onClick={() => pay(ref.trim() || undefined)}>
          {busy ? "Processing…" : take < balance && !isCash ? `Take ${money(take)}` : `${label} · ${money(chosen?.type === "foreignCash" ? amountLkr : Math.max(take, balance))}`}
        </button>
      </footer>
    </div>
  );
}

/** "Payment successful" with the invoice number, change due and receipt printing. */
export function PaySuccess({ api, result, onDone }: { api: PosApi; result: PaidResult; onDone: () => void }) {
  const { toast } = useApp();
  const printer = api.printers.find((p) => p.id === api.ws.receiptPrinterId);
  const [printed, setPrinted] = useState(result.printed);
  function printReceipt() {
    if (!printed) {
      void api.print("receipt", { ...result.doc, blocks: result.doc.blocks.filter((b) => b.t !== "drawer") }, printer).then(() => {
        setPrinted(true);
        if ((printer || api.ws.printMode === "bluetooth") && api.ws.printMode !== "preview") toast("Receipt sent to the printer");
      });
      return;
    }
    api.withPrivilege("pos.reprint", (by) => {
      void api.print("receipt", { ...result.doc, blocks: [{ t: "text", text: "*** COPY ***", align: "center", bold: true }, ...result.doc.blocks.filter((b) => b.t !== "drawer")] }, printer).then(() => {
        void api.journal.log({ type: "reprint", employeeId: api.user.id, ...(by.id !== api.user.id ? { authorizedBy: by.id } : {}), detail: result.invoiceNo });
        toast("Copy sent");
      });
    });
  }
  return (
    <div className="m-page m-success">
      <div className="m-screen center">
        <div className="m-confetti" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}</div>
        <div className="m-tick"><Icon name="check" size={54} strokeWidth={3} /></div>
        <h1>Payment Successful</h1>
        <p className="m-muted">Thank you! The bill is closed.</p>
        <div className="m-card m-receipt-card">
          <div className="row between"><span className="m-muted">Invoice</span><strong>{result.invoiceNo}</strong></div>
          <div className="row between"><span className="m-muted">Order</span><span>#{result.checkNo}{result.tableName ? ` · Table ${result.tableName}` : ""}</span></div>
          <div className="row between"><span className="m-muted">Paid by</span><span>{result.tenders.join(", ")}</span></div>
          <div className="row between m-total"><span>Total</span><strong>{money(result.total)}</strong></div>
        </div>
        {result.change ? <div className="m-change big">Change due <strong>{money(result.change)}</strong></div> : null}
      </div>
      <footer className="m-foot stack">
        <button className="m-btn cta block lg" onClick={onDone}>Done</button>
        <button className="m-btn outline block" onClick={printReceipt}><Icon name="printer" size={18} /> {printed ? "Print a copy" : "Print Receipt"}</button>
        <button className="m-link" onClick={() => api.previewReceipt(result.doc, `Invoice ${result.invoiceNo}`)}>View receipt</button>
      </footer>
    </div>
  );
}
