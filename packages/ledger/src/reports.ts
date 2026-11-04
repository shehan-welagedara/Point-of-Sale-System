import type { Account } from "@pos/core";
import type { Cents } from "@pos/engine";
import { statementLineOf } from "./setup.js";
import type { AccountBalance, GlBudget, LedgerEntry, PurchaseInvoice, SalesInvoice } from "./types.js";

export interface Range {
  fromPeriod: string;
  toPeriod: string;
  /** First period of the fiscal year containing `fromPeriod` (P&L accounts restart each year). */
  fyStartPeriod: string;
  costCenters?: ReadonlySet<string>;
}

type Sums = Map<string, { debit: Cents; credit: Cents }>;

function sums(balances: readonly AccountBalance[], pred: (b: AccountBalance) => boolean): Sums {
  const out: Sums = new Map();
  for (const b of balances) {
    if (!pred(b)) continue;
    const cur = out.get(b.account) ?? { debit: 0, credit: 0 };
    out.set(b.account, { debit: cur.debit + b.debit, credit: cur.credit + b.credit });
  }
  return out;
}

const ccOk = (r: Pick<Range, "costCenters">) => (b: AccountBalance) => !r.costCenters || r.costCenters.has(b.costCenter);
const isPL = (a: Account | undefined) => a?.type === "income" || a?.type === "expense";

export interface TbRow {
  id: string;
  code: string;
  name: string;
  depth: number;
  isGroup: boolean;
  opening: Cents;
  debit: Cents;
  credit: Cents;
  closing: Cents;
}

/**
 * Trial balance with opening, period movement and closing (debit-positive), rolled up the account
 * tree. Profit of earlier years that has not been closed to retained earnings is shown on its own
 * line so the trial balance always balances.
 */
export function trialBalance(accounts: readonly Account[], balances: readonly AccountBalance[], r: Range): { rows: TbRow[]; totals: { opening: Cents; debit: Cents; credit: Cents; closing: Cents } } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const cc = ccOk(r);
  const before = sums(balances, (b) => cc(b) && b.period < r.fromPeriod);
  const plThisYearBefore = sums(balances, (b) => cc(b) && b.period >= r.fyStartPeriod && b.period < r.fromPeriod);
  const movement = sums(balances, (b) => cc(b) && b.period >= r.fromPeriod && b.period <= r.toPeriod);
  const leaf = new Map<string, Omit<TbRow, "id" | "code" | "name" | "depth" | "isGroup">>();
  let unclosed = 0;
  for (const a of accounts) {
    if (a.isGroup) continue;
    const ob = isPL(a) ? plThisYearBefore.get(a.id) : before.get(a.id);
    const opening = ob ? ob.debit - ob.credit : 0;
    if (isPL(a)) {
      const all = before.get(a.id);
      unclosed += (all ? all.debit - all.credit : 0) - opening;
    }
    const m = movement.get(a.id) ?? { debit: 0, credit: 0 };
    leaf.set(a.id, { opening, debit: m.debit, credit: m.credit, closing: opening + m.debit - m.credit });
  }
  const depth = (a: Account): number => (a.parentId && byId.get(a.parentId) ? depth(byId.get(a.parentId)!) + 1 : 0);
  const rollup = (id: string): Omit<TbRow, "id" | "code" | "name" | "depth" | "isGroup"> => {
    const a = byId.get(id);
    if (!a?.isGroup) return leaf.get(id) ?? { opening: 0, debit: 0, credit: 0, closing: 0 };
    return accounts
      .filter((c) => c.parentId === id)
      .map((c) => rollup(c.id))
      .reduce((x, y) => ({ opening: x.opening + y.opening, debit: x.debit + y.debit, credit: x.credit + y.credit, closing: x.closing + y.closing }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  };
  const ordered: Account[] = [];
  const walk = (parent: string | undefined) =>
    accounts
      .filter((a) => (a.parentId ?? undefined) === parent)
      .sort((x, y) => x.code.localeCompare(y.code))
      .forEach((a) => {
        ordered.push(a);
        if (a.isGroup) walk(a.id);
      });
  walk(undefined);
  const rows: TbRow[] = ordered
    .map((a) => ({ id: a.id, code: a.code, name: a.name, depth: depth(a), isGroup: Boolean(a.isGroup), ...rollup(a.id) }))
    .filter((row) => row.opening || row.debit || row.credit || row.closing);
  if (unclosed) rows.push({ id: "__unclosed__", code: "", name: "Profit or loss of earlier years not yet closed", depth: 0, isGroup: false, opening: unclosed, debit: 0, credit: 0, closing: unclosed });
  const leaves = rows.filter((x) => !x.isGroup);
  const totals = leaves.reduce((x, y) => ({ opening: x.opening + y.opening, debit: x.debit + y.debit, credit: x.credit + y.credit, closing: x.closing + y.closing }), { opening: 0, debit: 0, credit: 0, closing: 0 });
  return { rows, totals };
}

export interface StatementRow {
  account: Account;
  amount: Cents;
}

export interface StatementSection {
  key: string;
  label: string;
  rows: StatementRow[];
  total: Cents;
}

function section(key: string, label: string, accounts: readonly Account[], s: Sums, sign: 1 | -1, byId: Map<string, Account>, match: (line: string | undefined, a: Account) => boolean): StatementSection {
  const rows = accounts
    .filter((a) => !a.isGroup && match(statementLineOf(a.id, byId), a))
    .map((a) => {
      const v = s.get(a.id);
      return { account: a, amount: v ? sign * (v.debit - v.credit) : 0 };
    })
    .filter((r) => r.amount !== 0)
    .sort((x, y) => x.account.code.localeCompare(y.account.code));
  return { key, label, rows, total: rows.reduce((x, r) => x + r.amount, 0) };
}

export interface IncomeStatement {
  revenue: StatementSection;
  costOfSales: StatementSection;
  grossProfit: Cents;
  otherIncome: StatementSection;
  operatingExpenses: StatementSection;
  operatingProfit: Cents;
  financeCosts: StatementSection;
  profitBeforeTax: Cents;
  taxExpense: StatementSection;
  netProfit: Cents;
}

/** Statement of profit or loss (SLFRS/IFRS function-of-expense layout). */
export function incomeStatement(accounts: readonly Account[], balances: readonly AccountBalance[], r: Omit<Range, "fyStartPeriod">): IncomeStatement {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const s = sums(balances, (b) => ccOk(r)(b) && b.period >= r.fromPeriod && b.period <= r.toPeriod);
  const sec = (key: string, label: string, sign: 1 | -1, lines: string[]) => section(key, label, accounts, s, sign, byId, (l) => lines.includes(l ?? ""));
  const revenue = sec("revenue", "Revenue", -1, ["revenue"]);
  const costOfSales = sec("costOfSales", "Cost of sales", 1, ["cost-of-sales"]);
  const otherIncome = sec("otherIncome", "Other income", -1, ["other-income"]);
  const operatingExpenses = section("operatingExpenses", "Operating expenses", accounts, s, 1, byId, (l, a) => a.type === "expense" && (l === "operating-expenses" || l === undefined));
  const financeCosts = sec("financeCosts", "Finance costs", 1, ["finance-costs"]);
  const taxExpense = sec("taxExpense", "Income tax expense", 1, ["tax-expense"]);
  const grossProfit = revenue.total - costOfSales.total;
  const operatingProfit = grossProfit + otherIncome.total - operatingExpenses.total;
  const profitBeforeTax = operatingProfit - financeCosts.total;
  return { revenue, costOfSales, grossProfit, otherIncome, operatingExpenses, operatingProfit, financeCosts, profitBeforeTax, taxExpense, netProfit: profitBeforeTax - taxExpense.total };
}

export interface BalanceSheet {
  assets: StatementSection[];
  liabilities: StatementSection[];
  equity: StatementSection;
  currentYearProfit: Cents;
  priorYearsUnclosed: Cents;
  totalAssets: Cents;
  totalLiabilities: Cents;
  totalEquity: Cents;
  balanced: boolean;
}

/** Statement of financial position as at the end of `asOfPeriod`. */
export function balanceSheet(accounts: readonly Account[], balances: readonly AccountBalance[], r: { asOfPeriod: string; fyStartPeriod: string; costCenters?: ReadonlySet<string> }): BalanceSheet {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const s = sums(balances, (b) => ccOk(r)(b) && b.period <= r.asOfPeriod);
  const asset = (key: string, label: string, lines: string[]) => section(key, label, accounts, s, 1, byId, (l, a) => a.type === "asset" && lines.includes(l ?? ""));
  const liab = (key: string, label: string, lines: string[]) => section(key, label, accounts, s, -1, byId, (l, a) => a.type === "liability" && lines.includes(l ?? ""));
  const assets = [
    asset("ppe", "Property, plant and equipment", ["ppe"]),
    asset("inventories", "Inventories", ["inventories"]),
    asset("receivables", "Trade and other receivables", ["receivables"]),
    asset("taxReceivables", "Tax receivables", ["tax-receivables"]),
    asset("cash", "Cash and cash equivalents", ["cash"]),
    section("otherAssets", "Other assets", accounts, s, 1, byId, (l, a) => a.type === "asset" && !["ppe", "inventories", "receivables", "tax-receivables", "cash"].includes(l ?? "")),
  ].filter((x) => x.rows.length);
  const liabilities = [
    liab("payables", "Trade and other payables", ["payables"]),
    liab("taxPayables", "Tax payables", ["tax-payables"]),
    liab("borrowings", "Borrowings", ["borrowings"]),
    section("otherLiabilities", "Other liabilities", accounts, s, -1, byId, (l, a) => a.type === "liability" && !["payables", "tax-payables", "borrowings"].includes(l ?? "")),
  ].filter((x) => x.rows.length);
  const equity = section("equity", "Equity", accounts, s, -1, byId, (_l, a) => a.type === "equity");
  let currentYearProfit = 0;
  let priorYearsUnclosed = 0;
  for (const b of balances) {
    if (!ccOk(r)(b) || b.period > r.asOfPeriod || !isPL(byId.get(b.account))) continue;
    if (b.period >= r.fyStartPeriod) currentYearProfit += b.credit - b.debit;
    else priorYearsUnclosed += b.credit - b.debit;
  }
  const totalAssets = assets.reduce((x, y) => x + y.total, 0);
  const totalLiabilities = liabilities.reduce((x, y) => x + y.total, 0);
  const totalEquity = equity.total + currentYearProfit + priorYearsUnclosed;
  return { assets, liabilities, equity, currentYearProfit, priorYearsUnclosed, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

export interface CashFlowStatement {
  netProfit: Cents;
  depreciation: Cents;
  workingCapital: { label: string; amount: Cents }[];
  operating: Cents;
  investing: { label: string; amount: Cents }[];
  investingTotal: Cents;
  financing: { label: string; amount: Cents }[];
  financingTotal: Cents;
  netChange: Cents;
  openingCash: Cents;
  closingCash: Cents;
  reconciles: boolean;
}

/** Statement of cash flows, indirect method, derived from balance movements within one fiscal year. */
export function cashFlow(accounts: readonly Account[], balances: readonly AccountBalance[], r: Range): CashFlowStatement {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const mv = sums(balances, (b) => ccOk(r)(b) && b.period >= r.fromPeriod && b.period <= r.toPeriod);
  const before = sums(balances, (b) => ccOk(r)(b) && b.period < r.fromPeriod);
  const delta = (id: string) => {
    const v = mv.get(id);
    return v ? v.debit - v.credit : 0;
  };
  let netProfit = 0;
  let depreciation = 0;
  let openingCash = 0;
  let netChange = 0;
  const wc = new Map<string, Cents>();
  const inv = new Map<string, Cents>();
  const fin = new Map<string, Cents>();
  const label: Record<string, string> = {
    receivables: "(Increase) / decrease in receivables",
    inventories: "(Increase) / decrease in inventories",
    "tax-receivables": "(Increase) / decrease in tax receivables",
    payables: "Increase / (decrease) in payables",
    "tax-payables": "Increase / (decrease) in tax payables",
    other: "Other working capital movements",
  };
  for (const a of accounts) {
    if (a.isGroup) continue;
    const d = delta(a.id);
    const line = statementLineOf(a.id, byId);
    if (isPL(a)) {
      netProfit -= d;
      continue;
    }
    if (line === "cash") {
      const ob = before.get(a.id);
      openingCash += ob ? ob.debit - ob.credit : 0;
      netChange += d;
      continue;
    }
    if (!d) continue;
    if (a.accountType === "AccumulatedDepreciation") depreciation -= d;
    else if (a.accountType === "FixedAsset") inv.set(a.name, (inv.get(a.name) ?? 0) - d);
    else if (line === "borrowings" || a.type === "equity") fin.set(a.name, (fin.get(a.name) ?? 0) - d);
    else {
      const key = line && label[line] ? line : "other";
      wc.set(key, (wc.get(key) ?? 0) - d);
    }
  }
  const workingCapital = [...wc].map(([k, amount]) => ({ label: label[k]!, amount }));
  const operating = netProfit + depreciation + workingCapital.reduce((x, y) => x + y.amount, 0);
  const investing = [...inv].map(([l, amount]) => ({ label: `Purchase / (sale) of ${l.toLowerCase()}`, amount }));
  const financing = [...fin].map(([l, amount]) => ({ label: l, amount }));
  const investingTotal = investing.reduce((x, y) => x + y.amount, 0);
  const financingTotal = financing.reduce((x, y) => x + y.amount, 0);
  return {
    netProfit,
    depreciation,
    workingCapital,
    operating,
    investing,
    investingTotal,
    financing,
    financingTotal,
    netChange,
    openingCash,
    closingCash: openingCash + netChange,
    reconciles: operating + investingTotal + financingTotal === netChange,
  };
}

export interface GlRow {
  entry: LedgerEntry;
  balance: Cents;
}

export function generalLedger(entries: readonly LedgerEntry[], opening: Cents): GlRow[] {
  let bal = opening;
  return [...entries]
    .sort((a, b) => a.postingDate.localeCompare(b.postingDate) || a.voucherNo.localeCompare(b.voucherNo) || a.lineNo - b.lineNo)
    .map((entry) => {
      bal += entry.debit - entry.credit;
      return { entry, balance: bal };
    });
}

export const AGING_BUCKETS = ["Not due", "1–30", "31–60", "61–90", "Over 90"] as const;

export interface AgingRow {
  partyId: string;
  voucherId: string;
  number: string;
  postingDate: string;
  dueDate: string;
  outstanding: Cents;
  daysOverdue: number;
  bucket: (typeof AGING_BUCKETS)[number];
}

export function aging(invoices: readonly (PurchaseInvoice | SalesInvoice)[], asOf: string): AgingRow[] {
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  return invoices
    .filter((i) => i.status === "posted" && (i.outstanding ?? 0) > 0)
    .map((i) => {
      const daysOverdue = Math.max(0, Math.round(day(asOf) - day(i.dueDate)));
      const bucket = daysOverdue === 0 ? AGING_BUCKETS[0] : daysOverdue <= 30 ? AGING_BUCKETS[1] : daysOverdue <= 60 ? AGING_BUCKETS[2] : daysOverdue <= 90 ? AGING_BUCKETS[3] : AGING_BUCKETS[4];
      return {
        partyId: i.type === "purchaseInvoice" ? i.supplierId : i.customerId,
        voucherId: i.id,
        number: i.number ?? i.id,
        postingDate: i.postingDate,
        dueDate: i.dueDate,
        outstanding: i.outstanding ?? 0,
        daysOverdue,
        bucket,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** VAT and SSCL working for a return period, from the tax ledger accounts. */
export function taxSummary(balances: readonly AccountBalance[], r: { fromPeriod: string; toPeriod: string }, accounts: { vatOutput: string; vatInput: string; sscl?: string; wht?: string }) {
  const s = sums(balances, (b) => b.period >= r.fromPeriod && b.period <= r.toPeriod);
  const credit = (id?: string) => (id ? (s.get(id)?.credit ?? 0) - (s.get(id)?.debit ?? 0) : 0);
  const outputVat = credit(accounts.vatOutput);
  const inputVat = -credit(accounts.vatInput);
  return { outputVat, inputVat, netVatPayable: outputVat - inputVat, sscl: credit(accounts.sscl), withholdingTax: credit(accounts.wht) };
}

export interface BudgetRow {
  account: Account;
  budget: Cents;
  actual: Cents;
  variance: Cents;
  /** Actual as basis points of budget. */
  usedBp: number;
}

/** Budget against actual (income shown as credit, expenses as debit) up to `throughPeriod`. */
export function budgetVsActual(accounts: readonly Account[], balances: readonly AccountBalance[], budgets: readonly GlBudget[], r: { fiscalYear: string; throughPeriod: string; costCenter?: string }): BudgetRow[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const s = sums(balances, (b) => b.fiscalYear === r.fiscalYear && b.period <= r.throughPeriod && (!r.costCenter || b.costCenter === r.costCenter));
  const budget = new Map<string, Cents>();
  for (const b of budgets) {
    if (b.fiscalYear !== r.fiscalYear || (r.costCenter && b.costCenter !== r.costCenter)) continue;
    const total = Object.entries(b.months).filter(([p]) => p <= r.throughPeriod).reduce((x, [, v]) => x + v, 0);
    budget.set(b.account, (budget.get(b.account) ?? 0) + total);
  }
  return [...budget].map(([id, bud]) => {
    const account = byId.get(id) ?? ({ id, code: id, name: id, type: "expense" } as Account);
    const v = s.get(id) ?? { debit: 0, credit: 0 };
    const actual = account.type === "income" ? v.credit - v.debit : v.debit - v.credit;
    return { account, budget: bud, actual, variance: account.type === "income" ? actual - bud : bud - actual, usedBp: bud ? Math.round((actual / bud) * 10_000) : 0 };
  });
}
