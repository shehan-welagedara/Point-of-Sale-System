import { useMemo, useState } from "react";
import {
  type AccountBalance,
  type LedgerEntry,
  type StatementSection,
  LEDGER as L,
  balanceSheet,
  cashFlow,
  generalLedger,
  incomeStatement,
  taxSummary,
  trialBalance,
} from "@pos/ledger";
import { type TableSheet, tablesToWorkbook } from "@pos/excel";
import { Field, Loading, ModuleOff, PageHead, Seg } from "../../components/ui";
import { amount, downloadBuffer, money } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { AccountSelect, TYPE_LABEL, useAccounts, useCostCenters, useFiscal, useLedgerSettings } from "./shared";

type Tab = "tb" | "pl" | "bs" | "cf" | "gl" | "tax";

function Section({ s, negate = false }: { s: StatementSection; negate?: boolean }) {
  return (
    <>
      <tr><td colSpan={2} className="section-title">{s.label}</td></tr>
      {s.rows.map((r) => (
        <tr key={r.account.id}>
          <td style={{ paddingLeft: 24 }}><span className="mono muted">{r.account.code}</span> {r.account.name}</td>
          <td className="num">{amount(negate ? -r.amount : r.amount)}</td>
        </tr>
      ))}
      <tr><td><strong>Total {s.label.toLowerCase()}</strong></td><td className="num"><strong>{amount(negate ? -s.total : s.total)}</strong></td></tr>
    </>
  );
}

const Line = ({ label, value, strong }: { label: string; value: number; strong?: boolean }) => (
  <tr>
    <td>{strong ? <strong>{label}</strong> : label}</td>
    <td className="num">{strong ? <strong>{amount(value)}</strong> : amount(value)}</td>
  </tr>
);

export function StatementsPage() {
  const { on, settings } = useApp();
  const ls = useLedgerSettings();
  const fiscal = useFiscal();
  const { list: accounts } = useAccounts();
  const ccs = useCostCenters();
  const [tab, setTab] = useState<Tab>("pl");
  const [fyId, setFyId] = useState<string>("");
  const fy = fiscal.list.find((f) => f.id === fyId) ?? fiscal.current;
  const periods = fy?.periods.map((p) => p.id) ?? [];
  const [fromP, setFromP] = useState("");
  const [toP, setToP] = useState("");
  const [cc, setCc] = useState("");
  const [glAccount, setGlAccount] = useState("1010");
  const fromPeriod = periods.includes(fromP) ? fromP : (periods[0] ?? "");
  const thisMonth = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const toPeriod = periods.includes(toP) ? toP : periods.includes(thisMonth) ? thisMonth : (periods[periods.length - 1] ?? "");
  const balances = useCollection<AccountBalance>(toPeriod ? L.balances : null, { where: [["period", "<=", toPeriod]] });
  const range = { fromPeriod, toPeriod, fyStartPeriod: periods[0] ?? "", ...(cc ? { costCenters: new Set([cc]) } : {}) };
  const glFrom = fy?.periods.find((p) => p.id === fromPeriod)?.start ?? "";
  const glTo = fy?.periods.find((p) => p.id === toPeriod)?.end ?? "";
  const glEntries = useCollection<LedgerEntry>(tab === "gl" && glAccount && glFrom ? L.ledger : null, { where: [["account", "==", glAccount], ["postingDate", ">=", glFrom], ["postingDate", "<=", glTo]] });

  const reports = useMemo(() => {
    if (!balances || !accounts.length || !fromPeriod) return null;
    const tb = trialBalance(accounts, balances, range);
    const pl = incomeStatement(accounts, balances, range);
    const bs = balanceSheet(accounts, balances, { asOfPeriod: toPeriod, fyStartPeriod: range.fyStartPeriod, ...(cc ? { costCenters: new Set([cc]) } : {}) });
    const cf = cashFlow(accounts, balances, range);
    const tax = ls ? taxSummary(balances, range, { vatOutput: ls.accounts.vatOutput, vatInput: ls.accounts.vatInput, sscl: settings.accounting.accounts.ssclPayable, wht: ls.accounts.whtPayable }) : null;
    return { tb, pl, bs, cf, tax };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balances, accounts, fromPeriod, toPeriod, cc, ls]);

  const glRows = useMemo(() => {
    if (!glEntries || !balances) return null;
    const opening = balances.filter((b) => b.account === glAccount && b.period < fromPeriod && (!cc || b.costCenter === cc)).reduce((a, b) => a + b.debit - b.credit, 0);
    return { opening, rows: generalLedger(glEntries.filter((e) => !cc || e.costCenter === cc), opening) };
  }, [glEntries, balances, glAccount, fromPeriod, cc]);

  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const title = `${settings.business.legalName} – ${fromPeriod} to ${toPeriod}${cc ? ` – cost centre ${cc}` : ""}`;

  async function exportXlsx() {
    if (!reports) return;
    const { tb, pl, bs, cf } = reports;
    const stmt = (sections: { label: string; s?: StatementSection; value?: number; negate?: boolean }[]) =>
      sections.flatMap((x) => (x.s ? [{ k: x.s.label, v: undefined as number | undefined }, ...x.s.rows.map((r) => ({ k: `   ${r.account.code} ${r.account.name}`, v: x.negate ? -r.amount : r.amount })), { k: `Total ${x.s.label.toLowerCase()}`, v: x.negate ? -x.s.total : x.s.total }] : [{ k: x.label, v: x.value }]));
    const cols = [{ header: "", value: (r: { k: string }) => r.k, width: 56 }, { header: "LKR", value: (r: { v?: number }) => r.v, format: "money" as const, width: 18 }];
    const sheets: TableSheet<any>[] = [
      { name: "Trial balance", title: `Trial balance – ${title}`, rows: tb.rows, columns: [{ header: "Code", value: (r) => r.code }, { header: "Account", value: (r) => `${"  ".repeat(r.depth)}${r.name}`, width: 44 }, { header: "Opening", value: (r) => r.opening, format: "money", width: 16 }, { header: "Debit", value: (r) => r.debit, format: "money", width: 16 }, { header: "Credit", value: (r) => r.credit, format: "money", width: 16 }, { header: "Closing", value: (r) => r.closing, format: "money", width: 16 }] },
      { name: "Profit or loss", title: `Statement of profit or loss – ${title}`, columns: cols, rows: stmt([{ label: "", s: pl.revenue }, { label: "", s: pl.costOfSales, negate: true }, { label: "Gross profit", value: pl.grossProfit }, { label: "", s: pl.otherIncome }, { label: "", s: pl.operatingExpenses, negate: true }, { label: "Operating profit", value: pl.operatingProfit }, { label: "", s: pl.financeCosts, negate: true }, { label: "Profit before tax", value: pl.profitBeforeTax }, { label: "", s: pl.taxExpense, negate: true }, { label: "Profit for the period", value: pl.netProfit }]) },
      { name: "Financial position", title: `Statement of financial position as at ${toPeriod} – ${settings.business.legalName}`, columns: cols, rows: [...stmt(bs.assets.map((s) => ({ label: "", s }))), { k: "Total assets", v: bs.totalAssets }, ...stmt(bs.liabilities.map((s) => ({ label: "", s }))), { k: "Total liabilities", v: bs.totalLiabilities }, ...stmt([{ label: "", s: bs.equity }]), { k: "Profit for the year to date", v: bs.currentYearProfit }, ...(bs.priorYearsUnclosed ? [{ k: "Prior years' profit not yet closed", v: bs.priorYearsUnclosed }] : []), { k: "Total equity", v: bs.totalEquity }, { k: "Total equity and liabilities", v: bs.totalEquity + bs.totalLiabilities }] },
      { name: "Cash flows", title: `Statement of cash flows – ${title}`, columns: cols, rows: [{ k: "Profit for the period", v: cf.netProfit }, { k: "Depreciation", v: cf.depreciation }, ...cf.workingCapital.map((w) => ({ k: w.label, v: w.amount })), { k: "Net cash from operating activities", v: cf.operating }, ...cf.investing.map((w) => ({ k: w.label, v: w.amount })), { k: "Net cash from investing activities", v: cf.investingTotal }, ...cf.financing.map((w) => ({ k: w.label, v: w.amount })), { k: "Net cash from financing activities", v: cf.financingTotal }, { k: "Net change in cash", v: cf.netChange }, { k: "Cash at the beginning", v: cf.openingCash }, { k: "Cash at the end", v: cf.closingCash }] },
    ];
    downloadBuffer(await tablesToWorkbook(sheets), `financial-statements-${fromPeriod}-${toPeriod}.xlsx`);
  }

  async function exportGl() {
    if (!glRows) return;
    const buf = await tablesToWorkbook([
      { name: "General ledger", title: `General ledger ${glAccount} – ${title} (opening ${amount(glRows.opening)})`, rows: glRows.rows, columns: [{ header: "Date", value: (r) => r.entry.postingDate }, { header: "Document", value: (r) => r.entry.voucherNo, width: 18 }, { header: "Type", value: (r) => TYPE_LABEL[r.entry.voucherType as keyof typeof TYPE_LABEL] }, { header: "Memo", value: (r) => r.entry.memo ?? "", width: 36 }, { header: "Cost centre", value: (r) => r.entry.costCenter }, { header: "Debit", value: (r) => r.entry.debit, format: "money", width: 16 }, { header: "Credit", value: (r) => r.entry.credit, format: "money", width: 16 }, { header: "Balance", value: (r) => r.balance, format: "money", width: 16 }] },
    ]);
    downloadBuffer(buf, `general-ledger-${glAccount}-${fromPeriod}-${toPeriod}.xlsx`);
  }

  return (
    <div className="page">
      <PageHead
        title="Financial statements"
        subtitle="Live from the universal journal: every figure drills down to the documents behind it. Layouts follow SLFRS (Sri Lanka's IFRS)."
        actions={<button className="btn primary" onClick={tab === "gl" ? exportGl : exportXlsx} disabled={!reports}>Export to Excel</button>}
      />
      <div className="card card-body row wrap">
        <Field label="Fiscal year">
          <select className="select" value={fy?.id ?? ""} onChange={(e) => { setFyId(e.target.value); setFromP(""); setToP(""); }}>
            {fiscal.list.map((f) => <option key={f.id} value={f.id}>{f.id}{f.status === "closed" ? " (closed)" : ""}</option>)}
          </select>
        </Field>
        <Field label="From period">
          <select className="select" value={fromPeriod} onChange={(e) => setFromP(e.target.value)}>{periods.map((p) => <option key={p}>{p}</option>)}</select>
        </Field>
        <Field label="To period">
          <select className="select" value={toPeriod} onChange={(e) => setToP(e.target.value)}>{periods.filter((p) => p >= fromPeriod).map((p) => <option key={p}>{p}</option>)}</select>
        </Field>
        <Field label="Cost centre">
          <select className="select" value={cc} onChange={(e) => setCc(e.target.value)}>
            <option value="">All (company)</option>
            {ccs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {tab === "gl" ? <Field label="Account"><AccountSelect value={glAccount} onChange={setGlAccount} /></Field> : null}
      </div>
      <Seg value={tab} onChange={setTab} options={[{ value: "pl", label: "Profit or loss" }, { value: "bs", label: "Financial position" }, { value: "cf", label: "Cash flows" }, { value: "tb", label: "Trial balance" }, { value: "gl", label: "General ledger" }, { value: "tax", label: "VAT & taxes" }]} />
      {!reports ? (
        <Loading />
      ) : tab === "tb" ? (
        <div className="card table-wrap">
          <div className="card-head"><h3>Trial balance</h3><span className={`badge ${reports.tb.totals.debit === reports.tb.totals.credit ? "good" : "bad"}`}>{reports.tb.totals.debit === reports.tb.totals.credit ? "Balanced" : "Out of balance"}</span></div>
          <table className="table">
            <thead><tr><th>Account</th><th className="num">Opening</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Closing</th></tr></thead>
            <tbody>
              {reports.tb.rows.map((r) => (
                <tr key={r.id} style={r.isGroup ? { fontWeight: 650, background: "var(--surface-2)" } : undefined}>
                  <td style={{ paddingLeft: 12 + r.depth * 16 }}><span className="mono muted">{r.code}</span> {r.name}</td>
                  <td className="num">{r.opening ? amount(r.opening) : ""}</td>
                  <td className="num">{r.debit ? amount(r.debit) : ""}</td>
                  <td className="num">{r.credit ? amount(r.credit) : ""}</td>
                  <td className="num">{r.closing ? amount(r.closing) : ""}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{amount(reports.tb.totals.opening)}</td><td className="num">{amount(reports.tb.totals.debit)}</td><td className="num">{amount(reports.tb.totals.credit)}</td><td className="num">{amount(reports.tb.totals.closing)}</td></tr></tfoot>
          </table>
        </div>
      ) : tab === "pl" ? (
        <div className="card table-wrap">
          <div className="card-head"><h3>Statement of profit or loss</h3><span className={`badge ${reports.pl.netProfit >= 0 ? "good" : "bad"}`}>{money(reports.pl.netProfit)}</span></div>
          <table className="table">
            <tbody>
              <Section s={reports.pl.revenue} />
              <Section s={reports.pl.costOfSales} negate />
              <Line label="Gross profit" value={reports.pl.grossProfit} strong />
              {reports.pl.otherIncome.rows.length ? <Section s={reports.pl.otherIncome} /> : null}
              <Section s={reports.pl.operatingExpenses} negate />
              <Line label="Operating profit" value={reports.pl.operatingProfit} strong />
              {reports.pl.financeCosts.rows.length ? <Section s={reports.pl.financeCosts} negate /> : null}
              <Line label="Profit before tax" value={reports.pl.profitBeforeTax} strong />
              {reports.pl.taxExpense.rows.length ? <Section s={reports.pl.taxExpense} negate /> : null}
            </tbody>
            <tfoot><tr><td>Profit for the period</td><td className="num">{amount(reports.pl.netProfit)}</td></tr></tfoot>
          </table>
          <p className="small muted" style={{ padding: "0 16px 16px" }}>Costs are shown as negatives. Gross margin {reports.pl.revenue.total ? `${((reports.pl.grossProfit / reports.pl.revenue.total) * 100).toFixed(1)}%` : "—"}.</p>
        </div>
      ) : tab === "bs" ? (
        <div className="card table-wrap">
          <div className="card-head"><h3>Statement of financial position as at {toPeriod}</h3><span className={`badge ${reports.bs.balanced ? "good" : "bad"}`}>{reports.bs.balanced ? "Balanced" : "Does not balance"}</span></div>
          <table className="table">
            <tbody>
              {reports.bs.assets.map((s) => <Section key={s.key} s={s} />)}
              <Line label="Total assets" value={reports.bs.totalAssets} strong />
              {reports.bs.liabilities.map((s) => <Section key={s.key} s={s} />)}
              <Line label="Total liabilities" value={reports.bs.totalLiabilities} strong />
              <Section s={reports.bs.equity} />
              <Line label="Profit for the year to date" value={reports.bs.currentYearProfit} />
              {reports.bs.priorYearsUnclosed ? <Line label="Prior years' profit not yet closed to retained earnings" value={reports.bs.priorYearsUnclosed} /> : null}
              <Line label="Total equity" value={reports.bs.totalEquity} strong />
            </tbody>
            <tfoot><tr><td>Total equity and liabilities</td><td className="num">{amount(reports.bs.totalEquity + reports.bs.totalLiabilities)}</td></tr></tfoot>
          </table>
        </div>
      ) : tab === "cf" ? (
        <div className="card table-wrap">
          <div className="card-head"><h3>Statement of cash flows (indirect method)</h3><span className={`badge ${reports.cf.reconciles ? "good" : "bad"}`}>{reports.cf.reconciles ? "Reconciles to cash" : "Does not reconcile"}</span></div>
          <table className="table">
            <tbody>
              <tr><td colSpan={2} className="section-title">Operating activities</td></tr>
              <Line label="Profit for the period" value={reports.cf.netProfit} />
              <Line label="Add back depreciation" value={reports.cf.depreciation} />
              {reports.cf.workingCapital.map((w) => <Line key={w.label} label={w.label} value={w.amount} />)}
              <Line label="Net cash from operating activities" value={reports.cf.operating} strong />
              <tr><td colSpan={2} className="section-title">Investing activities</td></tr>
              {reports.cf.investing.map((w) => <Line key={w.label} label={w.label} value={w.amount} />)}
              <Line label="Net cash from investing activities" value={reports.cf.investingTotal} strong />
              <tr><td colSpan={2} className="section-title">Financing activities</td></tr>
              {reports.cf.financing.map((w) => <Line key={w.label} label={w.label} value={w.amount} />)}
              <Line label="Net cash from financing activities" value={reports.cf.financingTotal} strong />
              <Line label="Net change in cash" value={reports.cf.netChange} strong />
              <Line label="Cash at the beginning of the period" value={reports.cf.openingCash} />
            </tbody>
            <tfoot><tr><td>Cash at the end of the period</td><td className="num">{amount(reports.cf.closingCash)}</td></tr></tfoot>
          </table>
        </div>
      ) : tab === "gl" ? (
        <div className="card table-wrap">
          <div className="card-head"><h3>General ledger {glAccount}</h3><span className="small muted">Opening {money(glRows?.opening)}</span></div>
          {!glRows ? (
            <Loading />
          ) : (
            <table className="table">
              <thead><tr><th>Date</th><th>Document</th><th>Memo</th><th>Cost centre</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {glRows.rows.map((r) => (
                  <tr key={r.entry.id}>
                    <td>{r.entry.postingDate}</td>
                    <td><span className="mono">{r.entry.voucherNo}</span> <span className="tiny muted">{TYPE_LABEL[r.entry.voucherType]}</span></td>
                    <td className="muted">{r.entry.memo}</td>
                    <td className="muted">{r.entry.costCenter}</td>
                    <td className="num">{r.entry.debit ? amount(r.entry.debit) : ""}</td>
                    <td className="num">{r.entry.credit ? amount(r.entry.credit) : ""}</td>
                    <td className="num">{amount(r.balance)}</td>
                  </tr>
                ))}
                {!glRows.rows.length ? <tr><td colSpan={7} className="muted">No postings in this range.</td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
      ) : reports.tax ? (
        <div className="grid cols-2">
          <div className="card table-wrap">
            <div className="card-head"><h3>VAT return working</h3></div>
            <table className="table">
              <tbody>
                <Line label="Output VAT (sales)" value={reports.tax.outputVat} />
                <Line label="Input VAT (purchases)" value={reports.tax.inputVat} />
              </tbody>
              <tfoot><tr><td>Net VAT payable</td><td className="num">{amount(reports.tax.netVatPayable)}</td></tr></tfoot>
            </table>
          </div>
          <div className="card table-wrap">
            <div className="card-head"><h3>Other taxes</h3></div>
            <table className="table">
              <tbody>
                <Line label="SSCL payable" value={reports.tax.sscl} />
                <Line label="Withholding tax deducted from suppliers" value={reports.tax.withholdingTax} />
              </tbody>
            </table>
          </div>
          <p className="small muted">Working figures from the tax ledger accounts for the selected periods. Returns are filed on the IRD's RAMIS portal; keep this export with the return as support.</p>
        </div>
      ) : null}
    </div>
  );
}

