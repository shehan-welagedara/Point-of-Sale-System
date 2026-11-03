import { useState } from "react";
import { type Check, type CheckPayment, type TenderMedia, lankaQrPayload, makePayment, payhereCheckout } from "@pos/core";
import { Modal } from "../../components/ui";
import { QrCode } from "../../components/Receipt";
import { money, toCents } from "../../lib/format";
import { useApp } from "../../state/app";
import { Keypad } from "./dialogs";

/**
 * Settles a check with one or more tenders. Cash gives change; card, LankaQR and PayHere take the
 * balance and a reference. LankaQR and PayHere show a QR for the guest (mock mode simulates the
 * bank/gateway confirmation).
 */
export function PayDialog({ check, amountDue, tenders, staffId, reference, onPayments, onClose, onFinish }: {
  check: Check;
  amountDue: number;
  tenders: TenderMedia[];
  staffId: string;
  reference: string;
  onPayments: (p: CheckPayment[]) => void;
  onClose: () => void;
  onFinish: () => void;
}) {
  const { settings, on, toast } = useApp();
  const [tender, setTender] = useState<TenderMedia | null>(null);
  const [entry, setEntry] = useState("");
  const [ref, setRef] = useState("");
  const paid = check.payments.reduce((a, p) => a + p.applied, 0);
  const balance = Math.max(0, amountDue - paid);
  const change = check.payments.reduce((a, p) => a + (p.tendered - p.applied), 0);
  const visible = tenders.filter((t) => t.active && (t.type !== "lankaqr" || on("lankaqr")) && (t.type !== "payhere" || on("payhere"))).sort((a, b) => a.sortOrder - b.sortOrder);

  function add(t: TenderMedia, amount: number, reference?: string) {
    try {
      const { payment } = makePayment({ tender: t, amount, balance, by: staffId, ...(reference ? { reference } : {}) });
      onPayments([...check.payments, payment]);
      setTender(null);
      setEntry("");
      setRef("");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  const keypad = (k: string) => {
    if (k === "C") return setEntry("");
    if (k === "⌫") return setEntry((e) => e.slice(0, -1));
    setEntry((e) => (e + k).replace(/^0+/, "").slice(0, 9));
  };

  const enteredCents = toCents(entry || "0");
  const quick = [balance, Math.ceil(balance / 100_000) * 100_000, Math.ceil(balance / 500_000) * 500_000, 500_000 * Math.ceil(balance / 500_000) + 500_000].filter((v, i, arr) => v > 0 && arr.indexOf(v) === i);
  const qrPayload = tender?.type === "lankaqr" ? lankaQrPayload({ ...settings.integrations.lankaqr, amount: balance, reference }) : tender?.type === "payhere" ? payhereCheckout({ mode: settings.integrations.payhere.mode, merchantId: settings.integrations.payhere.merchantId, orderId: reference, amount: balance, items: `Check #${check.checkNo}`, returnUrl: location.origin, notifyUrl: `${location.origin}/payhere/notify` }).url : "";
  const mockMode = tender?.type === "lankaqr" ? settings.integrations.lankaqr.mode === "mock" : settings.integrations.payhere.mode === "mock";

  return (
    <Modal
      wide
      title={`Payment · Check #${check.checkNo}`}
      onClose={onClose}
      footer={
        <>
          <div className="grow stack tight">
            {check.payments.map((p) => (
              <div key={p.id} className="row small">
                <span>{tenders.find((t) => t.id === p.tenderId)?.name}{p.reference ? ` (${p.reference})` : ""}</span>
                <span className="num">{money(p.tendered)}</span>
                <button className="btn ghost sm" onClick={() => onPayments(check.payments.filter((x) => x.id !== p.id))} aria-label="Remove payment">✕</button>
              </div>
            ))}
          </div>
          <button className="btn primary lg" disabled={balance > 0} onClick={onFinish}>
            {balance > 0 ? `Balance ${money(balance)}` : change > 0 ? `Close · change ${money(change)}` : "Close check"}
          </button>
        </>
      }
    >
      <div className="grid cols-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <div className="card card-body stack tight">
            <div className="row between"><span className="muted">Amount due</span><strong className="num" style={{ fontSize: 22 }}>{money(amountDue)}</strong></div>
            <div className="row between"><span className="muted">Paid</span><span className="num">{money(paid)}</span></div>
            <div className="row between"><span className="muted">Balance</span><strong className="num" style={{ fontSize: 26, color: balance ? "var(--accent)" : "var(--good)" }}>{money(balance)}</strong></div>
            {change > 0 ? <div className="row between"><span>Change due</span><strong className="num" style={{ fontSize: 26 }}>{money(change)}</strong></div> : null}
          </div>
          <div className="tender-grid">
            {visible.map((t) => (
              <button key={t.id} className={`tender-btn${tender?.id === t.id ? " on" : ""}`} disabled={balance === 0} onClick={() => { setTender(t); setEntry(""); setRef(""); }}>
                <span>{t.name}</span>
                <span className="tiny muted">{t.type === "foreignCash" ? `${t.currency} @ ${((t.exchangeRateMicros ?? 0) / 1_000_000).toFixed(2)}` : t.type}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="stack">
          {!tender ? (
            <div className="empty">Choose how the guest is paying.</div>
          ) : tender.type === "cash" || tender.type === "foreignCash" ? (
            <>
              <div className="card card-body row between">
                <span className="muted">{tender.type === "foreignCash" ? `${tender.currency} tendered` : "Cash tendered"}</span>
                <strong className="num" style={{ fontSize: 28 }}>{tender.type === "foreignCash" ? `${tender.currency} ${(enteredCents / 100).toFixed(2)}` : money(enteredCents)}</strong>
              </div>
              {tender.type === "foreignCash" && enteredCents ? <div className="small muted right">= {money(Math.round((enteredCents * (tender.exchangeRateMicros ?? 0)) / 1_000_000))}</div> : null}
              {tender.type === "cash" ? (
                <div className="row wrap">
                  {quick.map((v) => <button key={v} className="chip" onClick={() => add(tender, v)}>{v === balance ? "Exact" : money(v)}</button>)}
                </div>
              ) : null}
              <Keypad onKey={keypad} />
              <button className="btn primary lg" disabled={!enteredCents} onClick={() => add(tender, enteredCents)}>Take {tender.type === "foreignCash" ? `${tender.currency} ${(enteredCents / 100).toFixed(2)}` : money(enteredCents)}</button>
            </>
          ) : tender.type === "lankaqr" || tender.type === "payhere" ? (
            <div className="stack" style={{ alignItems: "center" }}>
              <QrCode data={qrPayload} size={220} />
              <strong className="num" style={{ fontSize: 22 }}>{money(balance)}</strong>
              <p className="small muted" style={{ textAlign: "center" }}>
                {tender.type === "lankaqr" ? "Guest scans with any LankaQR banking app." : "Guest scans to pay by card online via PayHere."}
                {mockMode ? " Demo mode: no real payment is taken." : ""}
              </p>
              <input className="input" placeholder="Reference / transaction ID" value={ref} onChange={(e) => setRef(e.target.value)} />
              <div className="row">
                {mockMode ? <button className="btn" onClick={() => add(tender, balance, `SIM-${Date.now().toString().slice(-6)}`)}>Simulate payment received</button> : null}
                <button className="btn primary" disabled={!ref.trim()} onClick={() => add(tender, balance, ref.trim())}>Confirm received</button>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="card card-body row between"><span className="muted">Amount</span><strong className="num" style={{ fontSize: 26 }}>{money(enteredCents || balance)}</strong></div>
              <Keypad onKey={keypad} />
              {tender.requiresReference ? <input className="input" placeholder={tender.type === "card" ? "Approval code from the card terminal" : "Reference"} value={ref} onChange={(e) => setRef(e.target.value)} /> : null}
              <button className="btn primary lg" disabled={tender.requiresReference && !ref.trim()} onClick={() => add(tender, enteredCents || balance, ref.trim() || undefined)}>
                Take {money(enteredCents || balance)}
              </button>
              {tender.type === "card" ? <p className="tiny muted">Run the card on the bank terminal first, then key in its approval code.</p> : null}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
