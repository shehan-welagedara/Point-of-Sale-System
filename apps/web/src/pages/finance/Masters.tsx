import { useMemo, useState } from "react";
import { type Account, type AccountType, type AccountingSettings, type TenderMedia, COLLECTIONS as C } from "@pos/core";
import { type AccountBalance, type CostCenter, type ExchangeRate, type GlBudget, type LedgerSettings, LEDGER as L, budgetVsActual, defaultLedgerSettings } from "@pos/ledger";
import { tablesToWorkbook } from "@pos/excel";
import { Bar, Field, Modal, ModuleOff, PageHead, Toggle } from "../../components/ui";
import { amount, downloadBuffer, toCents, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { AccountSelect, canBooks, useAccounts, useCostCenters, useFiscal, useLedgerSettings } from "./shared";

const ACCOUNT_TYPES: AccountType[] = ["Bank", "Cash", "Receivable", "Payable", "Stock", "StockReceivedNotBilled", "Tax", "FixedAsset", "AccumulatedDepreciation", "Depreciation", "CostOfGoodsSold", "Equity", "RetainedEarnings", "Income", "Expense", "RoundOff", "ExchangeGainLoss"];
const STATEMENT_LINES = ["", "cash", "receivables", "inventories", "tax-receivables", "ppe", "payables", "tax-payables", "borrowings", "equity", "revenue", "cost-of-sales", "other-income", "operating-expenses", "finance-costs", "tax-expense"];

// ───────────────────────────── Chart of accounts ─────────────────────────────

function AccountEditor({ account, onClose }: { account?: Account; onClose: () => void }) {
  const { store, toast } = useApp();
  const { list, byId } = useAccounts();
  const [a, setA] = useState<Account>(account ?? { id: "", code: "", name: "", type: "expense", parentId: "6", isGroup: false });
  const groups = list.filter((x) => x.isGroup);

  async function save() {
    if (!store) return;
    const code = a.code.trim();
    if (!code || !a.name.trim()) return toast("Code and name are required", true);
    if (!account && byId.has(code)) return toast("That code is already used", true);
    const parent = a.parentId ? byId.get(a.parentId) : undefined;
    const doc: Account = { ...a, id: account?.id ?? code, code, name: a.name.trim(), type: parent?.type ?? a.type };
    if (!doc.accountType) delete doc.accountType;
    if (!doc.statementLine) delete doc.statementLine;
    await store.set(C.accounts, doc);
    toast("Account saved");
    onClose();
  }

  return (
    <Modal title={account ? `Account ${account.code}` : "New account"} onClose={onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      <div className="stack">
        <div className="grid cols-2">
          <Field label="Code"><input className="input" value={a.code} disabled={Boolean(account)} onChange={(e) => setA({ ...a, code: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></Field>
          <Field label="Parent group">
            <select className="select" value={a.parentId ?? ""} onChange={(e) => setA({ ...a, parentId: e.target.value, type: byId.get(e.target.value)?.type ?? a.type })}>
              <option value="">— top level —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.code} {g.name}</option>)}
            </select>
          </Field>
          <Field label="Account type" help="Drives special behaviour: bank matching, party ledgers, depreciation, closing">
            <select className="select" value={a.accountType ?? ""} onChange={(e) => setA({ ...a, accountType: (e.target.value || undefined) as AccountType })}>
              <option value="">General</option>
              {ACCOUNT_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </Field>
          {a.isGroup ? (
            <Field label="Statement line" help="Where the group appears on the statements">
              <select className="select" value={a.statementLine ?? ""} onChange={(e) => setA({ ...a, statementLine: e.target.value })}>
                {STATEMENT_LINES.map((s) => <option key={s} value={s}>{s || "inherit"}</option>)}
              </select>
            </Field>
          ) : null}
        </div>
        <div className="row"><Toggle on={Boolean(a.isGroup)} onChange={(v) => setA({ ...a, isGroup: v })} disabled={Boolean(account)} label="Group" /> <span>Group (holds other accounts, no postings)</span></div>
        <div className="row"><Toggle on={Boolean(a.frozen)} onChange={(v) => setA({ ...a, frozen: v })} label="Frozen" /> <span>Frozen (no new postings)</span></div>
        <p className="small muted">Accounts are never deleted (the ledger refers to them); freeze an account you no longer use.</p>
      </div>
    </Modal>
  );
}

export function ChartOfAccountsPage() {
  const { on, role } = useApp();
  const { list, byId } = useAccounts();
  const fiscal = useFiscal();
  const balances = useCollection<AccountBalance>(L.balances) ?? [];
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const kids = new Map<string, Account[]>();
    for (const a of list) kids.set(a.parentId ?? "", [...(kids.get(a.parentId ?? "") ?? []), a]);
    const out: { a: Account; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      for (const a of (kids.get(id) ?? []).sort((x, y) => x.code.localeCompare(y.code))) {
        out.push({ a, depth });
        walk(a.id, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [list]);
  const bal = useMemo(() => {
    const own = new Map<string, number>();
    for (const b of balances) own.set(b.account, (own.get(b.account) ?? 0) + b.debit - b.credit);
    const total = new Map<string, number>();
    for (const [id, v] of own) {
      let cur: string | undefined = id;
      while (cur) {
        total.set(cur, (total.get(cur) ?? 0) + v);
        cur = byId.get(cur)?.parentId;
      }
    }
    return total;
  }, [balances, byId]);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const shown = rows.filter(({ a }) => !q || `${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <PageHead
        title="Chart of accounts"
        subtitle={`Grouped for SLFRS statements. Balances are since inception (debit positive)${fiscal.current ? `, fiscal year ${fiscal.current.id}` : ""}.`}
        actions={canBooks(role) ? <button className="btn primary" onClick={() => setEditing("new")}>New account</button> : null}
      />
      <input className="input" placeholder="Search accounts" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Account</th><th>Root</th><th>Type</th><th className="num">Balance</th><th /></tr></thead>
          <tbody>
            {shown.map(({ a, depth }) => (
              <tr key={a.id} className={canBooks(role) ? "clickable" : ""} onClick={() => canBooks(role) && setEditing(a)} style={a.isGroup ? { fontWeight: 650, background: "var(--surface-2)" } : undefined}>
                <td style={{ paddingLeft: 12 + depth * 18 }}><span className="mono muted">{a.code}</span> {a.name}</td>
                <td className="muted">{a.type}</td>
                <td className="muted small">{a.accountType ?? ""}{a.statementLine ? ` · ${a.statementLine}` : ""}</td>
                <td className="num">{bal.get(a.id) ? amount(bal.get(a.id)) : ""}</td>
                <td>{a.frozen ? <span className="badge">Frozen</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing ? <AccountEditor {...(editing === "new" ? {} : { account: editing })} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

// ───────────────────────────── Budgets ─────────────────────────────

export function BudgetsPage() {
  const { on, role, store, toast, settings } = useApp();
  const fiscal = useFiscal();
  const { list: accounts } = useAccounts();
  const ccs = useCostCenters();
  const ls = useLedgerSettings();
  const [fyId, setFyId] = useState("");
  const fy = fiscal.list.find((f) => f.id === fyId) ?? fiscal.current;
  const [cc, setCc] = useState("");
  const thisMonth = todayColombo().slice(0, 7);
  const through = fy?.periods.some((p) => p.id === thisMonth) ? thisMonth : (fy?.periods[fy.periods.length - 1]?.id ?? "");
  const balances = useCollection<AccountBalance>(fy ? L.balances : null, { where: [["fiscalYear", "==", fy?.id ?? ""]] }) ?? [];
  const budgets = useCollection<GlBudget>(L.glBudgets) ?? [];
  const [adding, setAdding] = useState(false);
  const [acc, setAcc] = useState("");
  const [annual, setAnnual] = useState("");
  const costCenter = cc || ls?.defaultCostCenter || ccs[0]?.id || "MAIN";
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const rows = fy ? budgetVsActual(accounts, balances, budgets, { fiscalYear: fy.id, throughPeriod: through, ...(cc ? { costCenter: cc } : {}) }) : [];

  async function saveBudget() {
    if (!store || !fy || !acc) return;
    const total = toCents(annual || 0);
    const n = fy.periods.length;
    const each = Math.floor(total / n);
    const months = Object.fromEntries(fy.periods.map((p, i) => [p.id, i === n - 1 ? total - each * (n - 1) : each]));
    await store.set(L.glBudgets, { id: `${fy.id}__${acc}__${costCenter}`, fiscalYear: fy.id, account: acc, costCenter, months } satisfies GlBudget);
    toast("Budget saved");
    setAdding(false);
    setAcc("");
    setAnnual("");
  }

  async function exportXlsx() {
    const buf = await tablesToWorkbook([
      { name: "Budget vs actual", title: `Budget vs actual ${fy?.id} to ${through} – ${settings.business.legalName}`, totals: true, rows, columns: [{ header: "Account", value: (r) => `${r.account.code} ${r.account.name}`, width: 36 }, { header: "Budget to date", value: (r) => r.budget, format: "money", width: 16 }, { header: "Actual", value: (r) => r.actual, format: "money", width: 16 }, { header: "Variance (favourable +)", value: (r) => r.variance, format: "money", width: 18 }, { header: "Used", value: (r) => r.usedBp, format: "percentBp" }] },
    ]);
    downloadBuffer(buf, `budget-vs-actual-${fy?.id}-${through}.xlsx`);
  }

  return (
    <div className="page">
      <PageHead
        title="Budgets"
        subtitle={`Monthly budgets by account and cost centre, compared with actuals to ${through}. Favourable variances are positive.`}
        actions={
          <>
            <button className="btn" onClick={exportXlsx}>Export to Excel</button>
            {canBooks(role) ? <button className="btn primary" onClick={() => setAdding(true)}>Set budget</button> : null}
          </>
        }
      />
      <div className="row wrap">
        <Field label="Fiscal year">
          <select className="select" value={fy?.id ?? ""} onChange={(e) => setFyId(e.target.value)}>{fiscal.list.map((f) => <option key={f.id}>{f.id}</option>)}</select>
        </Field>
        <Field label="Cost centre">
          <select className="select" value={cc} onChange={(e) => setCc(e.target.value)}>
            <option value="">All</option>
            {ccs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Account</th><th className="num">Budget to date</th><th className="num">Actual</th><th className="num">Variance</th><th style={{ width: 180 }}>Used</th></tr></thead>
          <tbody>
            {rows.sort((a, b) => a.account.code.localeCompare(b.account.code)).map((r) => (
              <tr key={r.account.id}>
                <td><span className="mono muted">{r.account.code}</span> {r.account.name}</td>
                <td className="num">{amount(r.budget)}</td>
                <td className="num">{amount(r.actual)}</td>
                <td className="num" style={{ color: r.variance < 0 ? "var(--bad)" : "var(--good)" }}>{amount(r.variance)}</td>
                <td><div className="row"><Bar value={r.usedBp} max={10_000} {...(r.account.type === "expense" && r.usedBp > 10_000 ? { color: "var(--bad)" } : {})} /><span className="tiny muted">{(r.usedBp / 100).toFixed(0)}%</span></div></td>
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={5} className="muted">No budgets for this fiscal year.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {adding && fy ? (
        <Modal title={`Budget ${fy.id}`} onClose={() => setAdding(false)} footer={<button className="btn primary" disabled={!acc} onClick={saveBudget}>Save</button>}>
          <div className="stack">
            <Field label="Account"><AccountSelect value={acc} onChange={setAcc} filter={(a) => a.type === "income" || a.type === "expense"} /></Field>
            <Field label="Cost centre"><select className="select" value={costCenter} onChange={(e) => setCc(e.target.value)}>{ccs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Annual amount (spread evenly over the months)"><input className="input" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} /></Field>
            <p className="small muted">Replaces any budget already set for this account and cost centre in {fy.id}.</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Settings ─────────────────────────────

const LEDGER_ROLES: [keyof LedgerSettings["accounts"], string][] = [
  ["receivable", "Trade debtors"],
  ["payable", "Trade creditors"],
  ["stockReceivedNotBilled", "Stock received but not billed"],
  ["inventory", "Inventory"],
  ["vatInput", "VAT input"],
  ["vatOutput", "VAT output"],
  ["whtPayable", "Withholding tax payable"],
  ["bankCharges", "Bank charges"],
  ["priceVariance", "Purchase price variance"],
  ["fxGainLoss", "Exchange gains and losses"],
  ["roundOff", "Rounding"],
  ["disposalGainLoss", "Gain or loss on disposal"],
  ["retainedEarnings", "Retained earnings"],
];

const POS_SINGLE: [keyof AccountingSettings["accounts"], string][] = [
  ["serviceCharge", "Service charge"], ["vatOutput", "VAT output"], ["ssclPayable", "SSCL payable"], ["tdlPayable", "TDL payable"], ["discounts", "Discounts allowed"], ["rounding", "Bill rounding"], ["inventory", "Inventory"], ["wastage", "Wastage"], ["stockAdjustment", "Stock count differences"], ["complimentary", "Complimentary"],
];

export function FinanceSettingsPage() {
  const { on, settings, saveSetting, toast, role, store, mode } = useApp();
  const tenders = useCollection<TenderMedia>(C.tenderMedia) ?? [];
  const costCenters = useCollection<CostCenter>(L.costCenters) ?? [];
  const rates = useCollection<ExchangeRate>(L.exchangeRates) ?? [];
  const current = (settings.accounting as AccountingSettings & { ledger?: LedgerSettings }).ledger ?? defaultLedgerSettings(settings.pos.defaultPropertyId);
  const [ls, setLs] = useState<LedgerSettings>(current);
  const [pos, setPos] = useState<AccountingSettings["accounts"]>(settings.accounting.accounts);
  const [rate, setRate] = useState({ currency: "USD", date: todayColombo(), value: "" });
  const [cc, setCc] = useState({ id: "", name: "" });
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const owner = role === "owner" || role === "admin";

  async function save() {
    await saveSetting("accounting", { ...settings.accounting, accounts: { ...pos, stockReceivedNotBilled: ls.accounts.stockReceivedNotBilled, inventory: pos.inventory, vatInput: ls.accounts.vatInput }, ledger: ls } as AccountingSettings);
    toast("Finance settings saved");
  }

  return (
    <div className="page">
      <PageHead title="Finance settings" subtitle="Ledger accounts for each automatic posting, approval limits and tolerances, cost centres and exchange rates." actions={canBooks(role) ? <button className="btn primary" onClick={save}>Save</button> : null} />
      <div className="grid cols-2">
        <div className="card card-body stack">
          <h3>Controls</h3>
          {!owner ? <div className="callout warn">Only the owner or an administrator can change approval limits{mode === "firebase" ? " (enforced by the security rules)" : ""}.</div> : null}
          <Field label="Journals needing a second approver (Rs, 0 = all journals)"><input className="input" inputMode="decimal" disabled={!owner} value={ls.journalApprovalThreshold / 100} onChange={(e) => setLs({ ...ls, journalApprovalThreshold: toCents(e.target.value) })} /></Field>
          <Field label="Supplier payments needing a second approver (Rs)"><input className="input" inputMode="decimal" disabled={!owner} value={ls.paymentApprovalThreshold / 100} onChange={(e) => setLs({ ...ls, paymentApprovalThreshold: toCents(e.target.value) })} /></Field>
          <Field label="Three-way match: price tolerance %"><input className="input" inputMode="decimal" disabled={!owner} value={ls.matchTolerance.priceBp / 100} onChange={(e) => setLs({ ...ls, matchTolerance: { ...ls.matchTolerance, priceBp: Math.round(Number(e.target.value) * 100) } })} /></Field>
          <Field label="Three-way match: quantity tolerance %"><input className="input" inputMode="decimal" disabled={!owner} value={ls.matchTolerance.qtyBp / 100} onChange={(e) => setLs({ ...ls, matchTolerance: { ...ls.matchTolerance, qtyBp: Math.round(Number(e.target.value) * 100) } })} /></Field>
          <h3>Ledger accounts</h3>
          {LEDGER_ROLES.map(([k, label]) => <Field key={k} label={label}><AccountSelect value={ls.accounts[k]} onChange={(v) => setLs({ ...ls, accounts: { ...ls.accounts, [k]: v } })} /></Field>)}
        </div>
        <div className="stack">
          <div className="card card-body stack">
            <h3>POS day posting</h3>
            <p className="small muted">Accounts used when a POS day is posted. Each tender's account is set on the tender ({tenders.filter((t) => !t.accountCode).length ? `${tenders.filter((t) => !t.accountCode).length} tender(s) have no account` : "all tenders mapped"}).</p>
            {["Food", "Beverage", "Liquor", "Other"].map((g) => <Field key={`s${g}`} label={`Sales – ${g}`}><AccountSelect value={pos.salesByMajorGroup[g] ?? ""} onChange={(v) => setPos({ ...pos, salesByMajorGroup: { ...pos.salesByMajorGroup, [g]: v } })} /></Field>)}
            {["Food", "Beverage", "Liquor", "Other"].map((g) => <Field key={`c${g}`} label={`Cost of sales – ${g}`}><AccountSelect value={pos.cogsByMajorGroup[g] ?? ""} onChange={(v) => setPos({ ...pos, cogsByMajorGroup: { ...pos.cogsByMajorGroup, [g]: v } })} /></Field>)}
            {POS_SINGLE.map(([k, label]) => <Field key={k} label={label}><AccountSelect value={pos[k] as string} onChange={(v) => setPos({ ...pos, [k]: v })} /></Field>)}
          </div>
          <div className="card card-body stack">
            <h3>Cost centres</h3>
            <table className="table"><tbody>{costCenters.sort((a, b) => a.id.localeCompare(b.id)).map((c) => <tr key={c.id}><td className="mono">{c.id}</td><td>{c.name}</td><td className="muted">{c.isGroup ? "group" : (c.parentId ?? "")}</td></tr>)}</tbody></table>
            {canBooks(role) ? (
              <div className="row wrap">
                <input className="input" placeholder="Code" value={cc.id} onChange={(e) => setCc({ ...cc, id: e.target.value.toUpperCase() })} style={{ width: 100 }} />
                <input className="input" placeholder="Name" value={cc.name} onChange={(e) => setCc({ ...cc, name: e.target.value })} style={{ maxWidth: 220 }} />
                <button className="btn sm" disabled={!cc.id || !cc.name} onClick={async () => { await store?.set(L.costCenters, { id: cc.id, name: cc.name, parentId: "ALL", isGroup: false } satisfies CostCenter); setCc({ id: "", name: "" }); }}>Add</button>
              </div>
            ) : null}
          </div>
          <div className="card card-body stack">
            <h3>Exchange rates (LKR per unit)</h3>
            <table className="table"><tbody>{rates.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map((r) => <tr key={r.id}><td>{r.date}</td><td>{r.currency}</td><td className="num">{(r.rateMicros / 1e6).toFixed(4)}</td></tr>)}</tbody></table>
            {canBooks(role) ? (
              <div className="row wrap">
                <input className="input" value={rate.currency} onChange={(e) => setRate({ ...rate, currency: e.target.value.toUpperCase() })} style={{ width: 80 }} />
                <input className="input" type="date" value={rate.date} onChange={(e) => setRate({ ...rate, date: e.target.value })} style={{ width: 160 }} />
                <input className="input" inputMode="decimal" placeholder="Rate" value={rate.value} onChange={(e) => setRate({ ...rate, value: e.target.value })} style={{ width: 110 }} />
                <button className="btn sm" disabled={!Number(rate.value)} onClick={async () => { await store?.set(L.exchangeRates, { id: `${rate.date}__${rate.currency}`, date: rate.date, currency: rate.currency, rateMicros: Math.round(Number(rate.value) * 1e6) } satisfies ExchangeRate); setRate({ ...rate, value: "" }); }}>Add</button>
              </div>
            ) : null}
            <p className="small muted">Use the Central Bank of Sri Lanka's indicative rate. Realised exchange differences are posted automatically when foreign-currency invoices are paid.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

