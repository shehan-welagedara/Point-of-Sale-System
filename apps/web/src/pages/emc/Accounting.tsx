import { useMemo, useState } from "react";
import {
  type Account,
  type AccountingSettings,
  type DailyStats,
  type GoodsReceipt,
  type JournalEntry,
  type StockMovement,
  type TenderMedia,
  COLLECTIONS as C,
  addDays,
  buildDailyJournal,
  dateRange,
  loadStats,
  profitAndLoss,
  receiptValue,
  trialBalance,
} from "@pos/core";
import { tablesToWorkbook } from "@pos/excel";
import { Empty, Field, Loading, Modal, ModuleOff, PageHead } from "../../components/ui";
import { downloadBuffer, money, todayColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";
import { useProperty } from "./Reports";

export function JournalsPage() {
  const { on, settings, toast } = useApp();
  const store = useStore();
  const { propertyId } = useProperty();
  const journals = useCollection<JournalEntry>(C.journals, { orderBy: ["date", "desc"], limit: 120 });
  const accounts = useCollection<Account>(C.accounts) ?? [];
  const tenders = useCollection<TenderMedia>(C.tenderMedia) ?? [];
  const [date, setDate] = useState(addDays(todayColombo(), -1));
  const [open, setOpen] = useState<JournalEntry | null>(null);
  const names = useMemo(() => new Map(accounts.map((a) => [a.code, a.name])), [accounts]);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;

  async function generate(days: string[]) {
    let made = 0;
    for (const d of days) {
      const [stats, movements, receipts] = await Promise.all([
        store.get<DailyStats>(C.dailyStats, `${propertyId}__${d}`),
        store.list<StockMovement>(C.stockMovements, { where: [["businessDate", "==", d]] }),
        store.list<GoodsReceipt>(C.goodsReceipts, { where: [["date", "==", d]] }),
      ]);
      const posted = receipts.filter((r) => r.status === "posted");
      try {
        const j = buildDailyJournal({ date: d, propertyId, stats, movements, receipts: posted, receiptValues: new Map(posted.map((r) => [r.id, receiptValue(r)])), tenders, settings: settings.accounting });
        if (j.lines.length) {
          await store.set(C.journals, j);
          made++;
        }
      } catch (e) {
        toast(`${d}: ${(e as Error).message}`, true);
        return;
      }
    }
    toast(made ? `Generated ${made} journal(s)` : "No activity on that date");
  }

  async function exportJournals() {
    const list = journals ?? [];
    const rows = list.flatMap((j) => j.lines.map((l) => ({ j, l })));
    const buf = await tablesToWorkbook([
      {
        name: "Journal",
        title: `General journal export – ${settings.business.legalName}`,
        totals: true,
        rows,
        columns: [
          { header: "Date", value: (r) => r.j.date, width: 12 },
          { header: "Journal", value: (r) => r.j.id, width: 26 },
          { header: "Account", value: (r) => r.l.accountCode },
          { header: "Account name", value: (r) => names.get(r.l.accountCode) ?? "", width: 30 },
          { header: "Memo", value: (r) => r.l.memo ?? "", width: 28 },
          { header: "Debit", value: (r) => r.l.debit, format: "money", width: 14 },
          { header: "Credit", value: (r) => r.l.credit, format: "money", width: 14 },
        ],
      },
    ]);
    downloadBuffer(buf, `journals-${todayColombo()}.xlsx`);
  }

  return (
    <div className="page">
      <PageHead
        title="Journals"
        subtitle="Balanced daily journals built from the day's sales, payments, FIFO cost of sales, waste and supplier receipts. Export to Excel or push to the accounting system."
        actions={<button className="btn" onClick={exportJournals}>Export to Excel</button>}
      />
      <div className="card card-body row wrap">
        <Field label="Business date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <button className="btn primary" style={{ alignSelf: "flex-end" }} onClick={() => generate([date])}>Generate journal</button>
        <button className="btn" style={{ alignSelf: "flex-end" }} onClick={() => generate(dateRange(addDays(date, -6), date))}>Generate last 7 days</button>
      </div>
      <div className="card table-wrap">
        {!journals ? <Loading /> : journals.length === 0 ? <Empty title="No journals yet" /> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Journal</th><th>Memo</th><th className="num">Lines</th><th className="num">Total</th></tr></thead>
            <tbody>
              {journals.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => setOpen(j)}>
                  <td>{j.date}</td>
                  <td className="mono">{j.id}</td>
                  <td>{j.memo}</td>
                  <td className="num">{j.lines.length}</td>
                  <td className="num">{money(j.lines.reduce((a, l) => a + l.debit, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? (
        <Modal wide title={`${open.id}`} onClose={() => setOpen(null)}>
          <table className="table">
            <thead><tr><th>Account</th><th>Memo</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
            <tbody>
              {open.lines.map((l, i) => (
                <tr key={i}><td><span className="mono">{l.accountCode}</span> {names.get(l.accountCode)}</td><td className="muted">{l.memo}</td><td className="num">{l.debit ? money(l.debit) : ""}</td><td className="num">{l.credit ? money(l.credit) : ""}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={2}>Total</td><td className="num">{money(open.lines.reduce((a, l) => a + l.debit, 0))}</td><td className="num">{money(open.lines.reduce((a, l) => a + l.credit, 0))}</td></tr></tfoot>
          </table>
        </Modal>
      ) : null}
    </div>
  );
}

export function StatementsPage() {
  const { on, settings } = useApp();
  const store = useStore();
  const { propertyId } = useProperty();
  const today = todayColombo();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const journals = useCollection<JournalEntry>(C.journals, { where: [["date", ">=", from], ["date", "<=", to]] });
  const accounts = useCollection<Account>(C.accounts) ?? [];
  const [tax, setTax] = useState<{ vat: number; sscl: number; sc: number; net: number; inputVat: number } | null>(null);
  const tb = useMemo(() => trialBalance(journals ?? [], accounts), [journals, accounts]);
  const pl = profitAndLoss(tb);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;

  async function taxSummary() {
    const stats = await loadStats(store, propertyId, from, to);
    const grns = (await store.list<GoodsReceipt>(C.goodsReceipts, { where: [["date", ">=", from], ["date", "<=", to]] })).filter((g) => g.status === "posted");
    setTax({ vat: stats.reduce((a, s) => a + s.vat, 0), sscl: stats.reduce((a, s) => a + s.sscl, 0), sc: stats.reduce((a, s) => a + s.serviceCharge, 0), net: stats.reduce((a, s) => a + s.netSales, 0), inputVat: grns.reduce((a, g) => a + g.inputVat, 0) });
  }

  async function exportAll() {
    const buf = await tablesToWorkbook([
      { name: "Profit & Loss", title: `Profit & loss ${from} to ${to}`, rows: [...pl.income.map((r) => ({ ...r, side: "Income" })), ...pl.expenses.map((r) => ({ ...r, side: "Expense" }))], columns: [{ header: "Section", value: (r) => r.side }, { header: "Account", value: (r) => r.account.code }, { header: "Name", value: (r) => r.account.name, width: 32 }, { header: "Amount", value: (r) => r.amount, format: "money", width: 14 }] },
      { name: "Trial balance", totals: true, rows: tb, columns: [{ header: "Account", value: (r) => r.account.code }, { header: "Name", value: (r) => r.account.name, width: 32 }, { header: "Debit", value: (r) => r.debit, format: "money", width: 14 }, { header: "Credit", value: (r) => r.credit, format: "money", width: 14 }] },
    ]);
    downloadBuffer(buf, `financials-${from}-to-${to}.xlsx`);
  }

  return (
    <div className="page">
      <PageHead title="P&L and trial balance" subtitle={`From the posted journals of ${settings.business.legalName}. Generate journals first for the days you need.`} actions={<><button className="btn" onClick={taxSummary}>VAT / SSCL summary</button><button className="btn primary" onClick={exportAll}>Export to Excel</button></>} />
      <div className="card card-body row wrap">
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 170 }} />
        <span className="muted">to</span>
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 170 }} />
      </div>
      {!journals ? <Loading /> : (
        <div className="grid cols-2">
          <div className="card">
            <div className="card-head"><h3>Profit & loss</h3><span className={`badge ${pl.netProfit >= 0 ? "good" : "bad"}`}>{money(pl.netProfit)}</span></div>
            <table className="table">
              <tbody>
                <tr><td colSpan={2} className="section-title">Income</td></tr>
                {pl.income.map((r) => <tr key={r.account.code}><td>{r.account.code} {r.account.name}</td><td className="num">{money(r.amount)}</td></tr>)}
                <tr><td><strong>Total income</strong></td><td className="num"><strong>{money(pl.totalIncome)}</strong></td></tr>
                <tr><td colSpan={2} className="section-title">Expenses</td></tr>
                {pl.expenses.map((r) => <tr key={r.account.code}><td>{r.account.code} {r.account.name}</td><td className="num">{money(r.amount)}</td></tr>)}
                <tr><td><strong>Total expenses</strong></td><td className="num"><strong>{money(pl.totalExpenses)}</strong></td></tr>
              </tbody>
              <tfoot><tr><td>Net profit</td><td className="num">{money(pl.netProfit)}</td></tr></tfoot>
            </table>
          </div>
          <div className="card table-wrap">
            <div className="card-head"><h3>Trial balance</h3></div>
            <table className="table">
              <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
              <tbody>{tb.map((r) => <tr key={r.account.code}><td>{r.account.code} {r.account.name}</td><td className="num">{r.debit ? money(r.debit) : ""}</td><td className="num">{r.credit ? money(r.credit) : ""}</td></tr>)}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{money(tb.reduce((a, r) => a + r.debit, 0))}</td><td className="num">{money(tb.reduce((a, r) => a + r.credit, 0))}</td></tr></tfoot>
            </table>
          </div>
        </div>
      )}
      {tax ? (
        <Modal title={`VAT / SSCL summary ${from} to ${to}`} onClose={() => setTax(null)}>
          <table className="table">
            <tbody>
              <tr><td>Net sales</td><td className="num">{money(tax.net)}</td></tr>
              <tr><td>Service charge</td><td className="num">{money(tax.sc)}</td></tr>
              <tr><td>SSCL collected</td><td className="num">{money(tax.sscl)}</td></tr>
              <tr><td>VAT output</td><td className="num">{money(tax.vat)}</td></tr>
              <tr><td>VAT input (posted GRNs)</td><td className="num">{money(tax.inputVat)}</td></tr>
            </tbody>
            <tfoot><tr><td>Net VAT payable</td><td className="num">{money(tax.vat - tax.inputVat)}</td></tr></tfoot>
          </table>
          <p className="small muted" style={{ marginTop: 10 }}>A working figure for the accountant; the return itself is filed on the IRD portal.</p>
        </Modal>
      ) : null}
    </div>
  );
}

export function MappingPage() {
  const { on, settings, saveSetting, toast } = useApp();
  const accounts = useCollection<Account>(C.accounts) ?? [];
  const [a, setA] = useState<AccountingSettings["accounts"]>(settings.accounting.accounts);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const pick = (value: string, onChange: (v: string) => void) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {accounts.sort((x, y) => x.code.localeCompare(y.code)).map((acc) => <option key={acc.code} value={acc.code}>{acc.code} {acc.name}</option>)}
    </select>
  );
  const single: [keyof AccountingSettings["accounts"], string][] = [
    ["serviceCharge", "Service charge"], ["vatOutput", "VAT output"], ["vatInput", "VAT input"], ["ssclPayable", "SSCL payable"], ["tdlPayable", "TDL payable"], ["discounts", "Discounts allowed"], ["rounding", "Bill rounding"], ["inventory", "Inventory"], ["wastage", "Wastage"], ["stockAdjustment", "Stock count differences"], ["accountsPayable", "Trade creditors"], ["complimentary", "Complimentary"],
  ];
  return (
    <div className="page">
      <PageHead title="Account mapping" subtitle="Which ledger account each part of the daily journal posts to. Tender accounts are set on each tender." actions={<button className="btn primary" onClick={async () => { await saveSetting("accounting", { ...settings.accounting, accounts: a }); toast("Mapping saved"); }}>Save</button>} />
      <div className="grid cols-2">
        <div className="card card-body stack">
          <h3>Sales by major group</h3>
          {["Food", "Beverage", "Liquor", "Other"].map((g) => <Field key={g} label={g}>{pick(a.salesByMajorGroup[g] ?? "", (v) => setA({ ...a, salesByMajorGroup: { ...a.salesByMajorGroup, [g]: v } }))}</Field>)}
          <h3>Cost of sales by major group</h3>
          {["Food", "Beverage", "Liquor", "Other"].map((g) => <Field key={g} label={g}>{pick(a.cogsByMajorGroup[g] ?? "", (v) => setA({ ...a, cogsByMajorGroup: { ...a.cogsByMajorGroup, [g]: v } }))}</Field>)}
        </div>
        <div className="card card-body stack">
          {single.map(([k, label]) => <Field key={k} label={label}>{pick(a[k] as string, (v) => setA({ ...a, [k]: v }))}</Field>)}
        </div>
      </div>
    </div>
  );
}
