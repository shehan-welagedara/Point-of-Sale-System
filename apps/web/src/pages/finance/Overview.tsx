import { useState } from "react";
import { Link } from "react-router-dom";
import { type DailyStats, COLLECTIONS as C, addDays } from "@pos/core";
import { type AccountBalance, type PosDayVoucher, type PurchaseInvoice, type SalesInvoice, type Voucher, LEDGER as L } from "@pos/ledger";
import { Loading, ModuleOff, PageHead, Stat } from "../../components/ui";
import { money, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { TYPE_LABEL, canBooks, voucherAmount, useAccounts, useFiscal, useLedgerAction, useLedgerSettings } from "./shared";

/** Finance cockpit: position, results, work waiting and POS days to post. */
export function FinanceOverview() {
  const { on, role, personName, settings } = useApp();
  const { byId } = useAccounts();
  const ls = useLedgerSettings();
  const fiscal = useFiscal();
  const today = todayColombo();
  const month = today.slice(0, 7);
  const since = addDays(today, -14);
  const balances = useCollection<AccountBalance>(L.balances, { where: [["period", "<=", month]] });
  const waiting = useCollection<Voucher>(L.vouchers, { where: [["status", "==", "submitted"]] }) ?? [];
  const stats = useCollection<DailyStats>(C.dailyStats, { where: [["businessDate", ">=", since]] }) ?? [];
  const posDays = useCollection<PosDayVoucher>(L.vouchers, { where: [["businessDate", ">=", since]] }) ?? [];
  const invoices = useCollection<PurchaseInvoice | SalesInvoice>(L.vouchers, { where: [["outstanding", ">", 0]] }) ?? [];
  // Stock received, wasted, counted or used without POS sales also needs its day posted.
  const grnDays = useCollection<{ date: string; status: string }>(on("purchasing") ? C.goodsReceipts : null, { where: [["date", ">=", since]] }) ?? [];
  const moveDays = useCollection<{ businessDate: string; type: string }>(on("inventory") ? C.stockMovements : null, { where: [["businessDate", ">=", since]] }) ?? [];
  const [postDate, setPostDate] = useState(addDays(today, -1));
  const { run, busy } = useLedgerAction();
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  if (!balances) return <Loading />;

  const fyStart = fiscal.current?.periods[0]?.id ?? month;
  const sum = (pred: (account: string) => boolean, from = "", to = month) => balances.filter((b) => pred(b.account) && b.period >= from && b.period <= to).reduce((a, b) => a + b.debit - b.credit, 0);
  const isType = (...t: string[]) => (id: string) => t.includes(byId.get(id)?.accountType ?? "");
  const isRoot = (...t: string[]) => (id: string) => t.includes(byId.get(id)?.type ?? "");
  const cash = sum(isType("Bank", "Cash"));
  const receivable = sum(isType("Receivable"));
  const payable = -sum(isType("Payable"));
  const grni = -sum(isType("StockReceivedNotBilled"));
  const revenueMonth = -sum((id) => byId.get(id)?.type === "income" && byId.get(id)?.accountType === "Income", month, month);
  const profitMonth = -sum(isRoot("income", "expense"), month, month);
  const profitYtd = -sum(isRoot("income", "expense"), fyStart, month);
  const vat = ls ? -sum((id) => id === ls.accounts.vatOutput || id === ls.accounts.vatInput) : 0;
  const posted = new Set(posDays.filter((v) => v.type === "posDay" && v.status === "posted").map((v) => `${v.propertyId}__${v.businessDate}`));
  const home = settings.pos.defaultPropertyId;
  const unposted = [
    ...stats.filter((s) => s.checks > 0 && s.businessDate < today && !posted.has(`${s.propertyId}__${s.businessDate}`)).map((s) => ({ id: s.id, propertyId: s.propertyId, businessDate: s.businessDate, label: `${s.checks} checks · ${money(s.netSales)}` })),
    ...[...new Set([...grnDays.filter((g) => g.status === "posted").map((g) => g.date), ...moveDays.filter((m) => m.type !== "sale" && m.type !== "transferIn" && m.type !== "transferOut").map((m) => m.businessDate)])]
      .filter((d) => d < today && !posted.has(`${home}__${d}`) && !stats.some((s) => s.businessDate === d && s.checks > 0))
      .map((d) => ({ id: `stock-${d}`, propertyId: home, businessDate: d, label: "stock and purchases" })),
  ].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
  const overdue = invoices.filter((i) => i.status === "posted" && i.dueDate < today);
  const overdueAr = overdue.filter((i) => i.type === "salesInvoice").reduce((a, i) => a + (i.outstanding ?? 0), 0);
  const overdueAp = overdue.filter((i) => i.type === "purchaseInvoice").reduce((a, i) => a + (i.outstanding ?? 0), 0);
  const openPeriods = fiscal.current?.periods.filter((p) => p.status === "open" && p.id < month) ?? [];

  return (
    <div className="page">
      <PageHead title="Finance" subtitle={`Fiscal year ${fiscal.current?.id ?? "—"} · figures update as documents post`} actions={<Link className="btn" to="/emc/finance/statements">Financial statements</Link>} />
      <div className="stats">
        <Stat label="Cash and bank" value={money(cash)} />
        <Stat label="Receivables" value={money(receivable)} {...(overdueAr ? { sub: `${money(overdueAr)} overdue`, tone: "bad" as const } : {})} />
        <Stat label="Payables" value={money(payable)} {...(overdueAp ? { sub: `${money(overdueAp)} overdue`, tone: "warn" as const } : {})} />
        <Stat label="Received, not yet billed" value={money(grni)} sub="goods receipts awaiting supplier invoices" />
        <Stat label={`Revenue ${month}`} value={money(revenueMonth)} />
        <Stat label={`Profit ${month}`} value={money(profitMonth)} tone={profitMonth >= 0 ? "good" : "bad"} sub={profitMonth >= 0 ? "profit" : "loss"} />
        <Stat label="Profit year to date" value={money(profitYtd)} tone={profitYtd >= 0 ? "good" : "bad"} sub={fiscal.current?.id ?? ""} />
        <Stat label="VAT payable (net)" value={money(vat)} />
      </div>
      <div className="cards4">
        <div className="card">
          <div className="card-head"><h3>Waiting for approval</h3><Link className="small" to="/emc/finance/approvals">Open inbox →</Link></div>
          <div className="card-body stack tight">
            {waiting.slice(0, 6).map((v) => (
              <div key={v.id} className="row between small">
                <span>{TYPE_LABEL[v.type]} · {v.remarks}<span className="muted"> · by {personName(v.submittedBy ?? v.createdBy)}</span></span>
                <span className="num" style={{ whiteSpace: "nowrap" }}>{money(voucherAmount(v))}</span>
              </div>
            ))}
            {!waiting.length ? <span className="small muted">Nothing waiting.</span> : null}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Days to post</h3></div>
          <div className="card-body stack tight">
            {unposted.map((s) => (
              <div key={s.id} className="row between small">
                <span>{s.businessDate} · {s.propertyId} · {s.label}</span>
                {canBooks(role) || role === "manager" ? <button className="btn sm" disabled={busy} onClick={() => run<{ number?: string } | null>({ action: "postPosDay", propertyId: s.propertyId, businessDate: s.businessDate }, (r) => (r ? `Posted ${r.number ?? ""}` : "Nothing new to post"))}>Post</button> : null}
              </div>
            ))}
            {!unposted.length ? <span className="small muted" title="The POS posts each day at End of Day; stock is posted when it is received, counted or wasted.">Every day of the last two weeks is posted.</span> : null}
            {canBooks(role) || role === "manager" ? (
              <div className="row tight small" title="Post sales and stock for any day (only what is not yet in the books is posted)">
                <input className="input sm" type="date" style={{ width: "auto", minWidth: 0 }} value={postDate} onChange={(e) => setPostDate(e.target.value)} aria-label="Day to post" />
                <button className="btn sm" disabled={busy} onClick={() => run<{ number?: string } | null>({ action: "postPosDay", propertyId: home, businessDate: postDate }, (r) => (r ? `Posted ${r.number ?? ""}` : "Nothing new to post for that day"))}>Post day</button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Period close</h3><Link className="small" to="/emc/finance/periods">Closing cockpit →</Link></div>
          <div className="card-body small">
            {openPeriods.length ? <span>{openPeriods.length} past month(s) still open: {openPeriods.map((p) => p.id).join(", ")}. Close them once the checklist is clear.</span> : <span className="muted">All past months of the year are closed.</span>}
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h3>Assurance</h3><Link className="small" to="/emc/audit">Audit Center →</Link></div>
          <div className="card-body small stack tight">
            <span>Every posting is numbered without gaps, hash-chained and approved by a second person where required.</span>
            <span className="muted">Run the integrity check at each month end and before the auditors arrive.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
