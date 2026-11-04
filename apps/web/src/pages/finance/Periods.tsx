import { useState } from "react";
import { type DailyStats, type GoodsReceipt, COLLECTIONS as C, addDays } from "@pos/core";
import { type Asset, type BankRecon, type BankStatement, type FiscalPeriod, type FiscalYear, type Voucher, LEDGER as L } from "@pos/ledger";
import { ConfirmButton, Field, Loading, Modal, ModuleOff, PageHead } from "../../components/ui";
import { dateTimeColombo, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { canBooks, useFiscal, useLedgerAction } from "./shared";

interface Check {
  label: string;
  ok: boolean;
  detail: string;
  /** Warnings don't block closing (a judgement for the accountant). */
  warn?: boolean;
}

/** Month-end checklist computed from the books (S/4 "Financial Closing cockpit", simplified). */
function useChecklist(p: FiscalPeriod | undefined): Check[] | null {
  const vouchers = useCollection<Voucher>(p ? L.vouchers : null, { where: [["postingDate", ">=", p?.start ?? ""], ["postingDate", "<=", p?.end ?? ""]] });
  const stats = useCollection<DailyStats>(p ? C.dailyStats : null, { where: [["businessDate", ">=", p?.start ?? ""], ["businessDate", "<=", p?.end ?? ""]] });
  const assets = useCollection<Asset>(L.assets);
  const statements = useCollection<BankStatement>(L.bankStatements);
  const recons = useCollection<BankRecon>(L.bankRecons);
  const grns = useCollection<GoodsReceipt>(p ? C.goodsReceipts : null, { where: [["date", ">=", p?.start ?? ""], ["date", "<=", p?.end ?? ""]] });
  const allPi = useCollection<Voucher>(L.vouchers, { where: [["type", "==", "purchaseInvoice"]] });
  if (!p || !vouchers || !stats || !assets || !statements || !recons || !grns || !allPi) return null;
  const posted = new Set(vouchers.filter((v) => v.type === "posDay" && v.status === "posted").map((v) => `${v.propertyId}__${(v as { businessDate?: string }).businessDate}`));
  const unpostedDays = stats.filter((s) => s.checks > 0 && !posted.has(`${s.propertyId}__${s.businessDate}`));
  const pending = vouchers.filter((v) => v.status === "draft" || v.status === "submitted");
  const needsDep = assets.some((a) => a.status === "active" && a.availableDate.slice(0, 7) <= p.id);
  const depDone = vouchers.some((v) => v.type === "depreciation" && v.status === "posted" && (v as { depreciationPeriod?: string }).depreciationPeriod === p.id);
  const matched = new Set(recons.map((r) => `${r.statementId}:${r.statementLineId}`));
  const bankLines = statements.flatMap((s) => s.lines.filter((l) => l.date >= p.start && l.date <= p.end).map((l) => `${s.id}:${l.id}`));
  const unmatched = bankLines.filter((k) => !matched.has(k)).length;
  const billed = new Set(allPi.filter((v) => v.status !== "cancelled").flatMap((v) => (v as { grnIds?: string[] }).grnIds ?? []));
  const unbilled = grns.filter((g) => g.status === "posted" && !billed.has(g.id)).length;
  return [
    { label: "POS days posted to the ledger", ok: unpostedDays.length === 0, detail: unpostedDays.length ? `${unpostedDays.length} trading day(s) not posted: ${unpostedDays.map((s) => s.businessDate).slice(0, 5).join(", ")}` : `${posted.size} day(s) posted` },
    { label: "No documents waiting (drafts or approvals)", ok: pending.length === 0, detail: pending.length ? `${pending.length} document(s) dated in this period still draft or awaiting approval` : "All documents dated in the period are posted" },
    { label: "Depreciation run", ok: !needsDep || depDone, detail: !needsDep ? "No assets to depreciate" : depDone ? "Posted" : "Run depreciation for this period under Fixed assets" },
    { label: "Bank statement reconciled", ok: bankLines.length > 0 && unmatched === 0, warn: true, detail: bankLines.length === 0 ? "No statement imported for this period" : unmatched ? `${unmatched} statement line(s) not matched` : `${bankLines.length} line(s) matched` },
    { label: "Goods received are invoiced", ok: unbilled === 0, warn: true, detail: unbilled ? `${unbilled} goods receipt(s) without a supplier invoice – carried as "stock received but not billed" (an accrual), which is correct if the invoice hasn't arrived` : "All receipts invoiced" },
  ];
}

function PeriodRow({ fy, p, onPick, picked }: { fy: FiscalYear; p: FiscalPeriod; onPick: () => void; picked: boolean }) {
  const { role, personName } = useApp();
  const { run, busy } = useLedgerAction();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <tr className="clickable" onClick={onPick} style={picked ? { outline: "2px solid var(--brand)" } : undefined}>
      <td className="mono">{p.id}</td>
      <td>{p.start} – {p.end}</td>
      <td><span className={`badge ${p.status === "closed" ? "" : "good"}`}>{p.status === "closed" ? "Closed" : "Open"}</span></td>
      <td className="muted small">{p.closedBy ? `${personName(p.closedBy)} · ${dateTimeColombo(p.closedAt)}` : ""}</td>
      <td onClick={(e) => e.stopPropagation()}>
        {canBooks(role) && fy.status === "open" ? (
          p.status === "open" ? (
            <ConfirmButton className="btn sm" confirmText="Tap to close" onConfirm={() => run({ action: "setPeriodStatus", periodId: p.id, status: "closed" }, () => `${p.id} closed – no more postings dated in it`)}>Close</ConfirmButton>
          ) : (
            <button className="btn sm ghost" disabled={busy} onClick={() => setReopening(true)}>Reopen…</button>
          )
        ) : null}
        {reopening ? (
          <Modal
            title={`Reopen ${p.id}`}
            onClose={() => setReopening(false)}
            footer={<button className="btn danger" disabled={!reason.trim() || busy} onClick={() => run({ action: "setPeriodStatus", periodId: p.id, status: "open", reason }, () => `${p.id} reopened`).then((r) => r && setReopening(false))}>Reopen period</button>}
          >
            <p>Reopening a closed period lets entries be dated in it again. Only the owner or an administrator can do this, and the reason is kept in the audit trail.</p>
            <Field label="Reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Late supplier invoice for October" /></Field>
          </Modal>
        ) : null}
      </td>
    </tr>
  );
}

export function PeriodsPage() {
  const { on, role, personName } = useApp();
  const fiscal = useFiscal();
  const { run, busy } = useLedgerAction();
  const [picked, setPicked] = useState<string>("");
  const [fyId, setFyId] = useState("");
  const fy = fiscal.list.find((f) => f.id === fyId) ?? fiscal.current;
  const today = todayColombo();
  const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const period = fy?.periods.find((p) => p.id === (picked || lastMonth)) ?? fy?.periods.find((p) => p.status === "open");
  const checks = useChecklist(period);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  if (!fiscal.loaded) return <Loading />;
  const allClosed = fy?.periods.every((p) => p.status === "closed");
  const nextStart = fy ? addDays(fy.end, 1) : today;
  const hasNext = fiscal.list.some((f) => f.start === nextStart);
  return (
    <div className="page">
      <PageHead
        title="Period close"
        subtitle={`Fiscal years run April to March (Sri Lanka's year of assessment). Closing a month stops anything being dated in it; reopening needs the owner and a reason. Year-end closing moves the year's profit to retained earnings.`}
        actions={
          canBooks(role) && fy ? (
            <>
              {!hasNext ? <button className="btn" disabled={busy} onClick={() => run({ action: "ensureFiscalYear", date: nextStart }, () => "Next fiscal year opened")}>Open next fiscal year</button> : null}
              {fy.status === "open" ? (
                <ConfirmButton className="btn primary" confirmText="Tap to post year-end closing" onConfirm={() => run({ action: "closeFiscalYear", fiscalYearId: fy.id }, () => `Fiscal year ${fy.id} closed`)}>
                  Close fiscal year {fy.id}
                </ConfirmButton>
              ) : null}
            </>
          ) : null
        }
      />
      <div className="row wrap">
        <Field label="Fiscal year">
          <select className="select" value={fy?.id ?? ""} onChange={(e) => { setFyId(e.target.value); setPicked(""); }}>
            {fiscal.list.map((f) => <option key={f.id} value={f.id}>{f.id} ({f.status})</option>)}
          </select>
        </Field>
      </div>
      {fy && fy.status === "open" && !allClosed ? <div className="callout">Year-end closing needs every month of {fy.id} closed first. The closing voucher is posted on {fy.end} and takes income and expenses to retained earnings.</div> : null}
      {fy?.status === "closed" ? <div className="callout good">Fiscal year {fy.id} was closed by {personName(fy.closedBy)} on {dateTimeColombo(fy.closedAt)}.</div> : null}
      <div className="grid cols-2">
        <div className="card table-wrap">
          <div className="card-head"><h3>Periods</h3></div>
          <table className="table">
            <thead><tr><th>Period</th><th>Dates</th><th>Status</th><th>Closed by</th><th /></tr></thead>
            <tbody>{fy?.periods.map((p) => <PeriodRow key={p.id} fy={fy} p={p} picked={p.id === period?.id} onPick={() => setPicked(p.id)} />)}</tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><h3>Closing checklist {period?.id}</h3></div>
          <div className="card-body stack">
            {!checks ? (
              <Loading />
            ) : (
              checks.map((c) => (
                <div key={c.label} className="row" style={{ alignItems: "flex-start" }}>
                  <span className={`badge ${c.ok ? "good" : c.warn ? "warn" : "bad"}`} style={{ minWidth: 28, justifyContent: "center" }}>{c.ok ? "✓" : c.warn ? "!" : "✕"}</span>
                  <div>
                    <div><strong>{c.label}</strong></div>
                    <div className="small muted">{c.detail}</div>
                  </div>
                </div>
              ))
            )}
            <p className="small muted">Run the integrity check in the Audit Center after closing, and export the trial balance for the month file.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
