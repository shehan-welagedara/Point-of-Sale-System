import type { Cents } from "@pos/engine";
import type { Account, AccountingSettings, DailyStats, GoodsReceipt, JournalEntry, JournalLine, StockMovement, TenderMedia } from "./types.js";
import { newId, nowIso } from "./util.js";

export class JournalError extends Error {}

function line(accountCode: string, amount: Cents, memo: string): JournalLine | null {
  if (amount === 0) return null;
  return amount > 0 ? { accountCode, debit: amount, credit: 0, memo } : { accountCode, debit: 0, credit: -amount, memo };
}

/** Collapses lines by account and side, dropping zeroes. */
export function consolidate(lines: (JournalLine | null)[]): JournalLine[] {
  const map = new Map<string, JournalLine>();
  for (const l of lines) {
    if (!l) continue;
    const key = `${l.accountCode}|${l.memo ?? ""}`;
    const cur = map.get(key);
    if (cur) {
      cur.debit += l.debit;
      cur.credit += l.credit;
    } else map.set(key, { ...l });
  }
  return [...map.values()]
    .map((l) => {
      const net = l.debit - l.credit;
      return net >= 0 ? { ...l, debit: net, credit: 0 } : { ...l, debit: 0, credit: -net };
    })
    .filter((l) => l.debit !== 0 || l.credit !== 0);
}

export function journalTotals(lines: readonly JournalLine[]): { debit: Cents; credit: Cents } {
  return { debit: lines.reduce((a, l) => a + l.debit, 0), credit: lines.reduce((a, l) => a + l.credit, 0) };
}

/**
 * Daily journal for one business date: sales (by major group, gross), discounts, service charge,
 * SSCL/TDL, VAT output, rounding, tenders received, cost of sales and waste (FIFO, from stock
 * movements) and supplier receipts (with input VAT). Debits always equal credits.
 */
export function buildDailyJournal(args: {
  date: string;
  propertyId: string;
  stats: DailyStats | null;
  movements: readonly StockMovement[];
  receipts: readonly GoodsReceipt[];
  receiptValues: ReadonlyMap<string, Cents>;
  tenders: readonly TenderMedia[];
  settings: AccountingSettings;
}): JournalEntry {
  const a = args.settings.accounts;
  const tenderAccount = new Map(args.tenders.map((t) => [t.id, t.accountCode]));
  const lines: (JournalLine | null)[] = [];
  const s = args.stats;
  if (s && s.checks > 0) {
    // Exclusive pricing: post sales at menu price and discounts separately. Inclusive pricing: menu
    // prices contain the taxes, so sales are posted net of discounts and taxes.
    const groups = Object.entries(s.majorGroups);
    const grossTotal = groups.reduce((x, [, v]) => x + (v.gross ?? v.amount), 0);
    const useGross = grossTotal - s.discounts === s.netSales;
    for (const [group, v] of groups) {
      const account = a.salesByMajorGroup[group] ?? a.salesByMajorGroup.Other;
      if (!account) throw new JournalError(`no sales account for ${group}`);
      lines.push(line(account, -(useGross ? (v.gross ?? v.amount) : v.amount), `Sales – ${group}`));
    }
    if (useGross) lines.push(line(a.discounts, s.discounts, "Discounts allowed"));
    lines.push(line(a.serviceCharge, -s.serviceCharge, "Service charge"));
    lines.push(line(a.ssclPayable, -s.sscl, "SSCL"));
    lines.push(line(a.tdlPayable, -s.tdl, "TDL"));
    lines.push(line(a.vatOutput, -s.vat, "VAT output"));
    lines.push(line(a.rounding, -s.rounding, "Bill rounding"));
    for (const [tenderId, v] of Object.entries(s.tenders)) {
      const account = tenderAccount.get(tenderId);
      if (!account) throw new JournalError(`tender ${tenderId} has no account`);
      lines.push(line(account, v.amount, "Payments received"));
    }
  }
  for (const m of args.movements) {
    if (m.type === "sale") {
      for (const [group, cost] of Object.entries(m.costByMajorGroup ?? {})) {
        lines.push(line(a.cogsByMajorGroup[group] ?? a.cogsByMajorGroup.Other ?? a.wastage, cost, `Cost of sales – ${group}`));
        lines.push(line(a.inventory, -cost, "Inventory consumed"));
      }
    } else if (m.type === "waste" || m.type === "adjust") {
      const value = m.lines.reduce((x, l) => x + l.cost, 0);
      const expense = m.type === "waste" ? a.wastage : a.stockAdjustment;
      lines.push(line(expense, -value, m.type === "waste" ? "Wastage" : "Stock count adjustment"));
      lines.push(line(a.inventory, value, "Inventory"));
    }
  }
  for (const r of args.receipts) {
    const value = args.receiptValues.get(r.id) ?? 0;
    lines.push(line(a.inventory, value, `GRN ${r.number}`));
    lines.push(line(a.vatInput, r.inputVat, `Input VAT ${r.number}`));
    lines.push(line(a.accountsPayable, -(value + r.inputVat), `Supplier ${r.number}`));
  }
  const out = consolidate(lines);
  const t = journalTotals(out);
  if (t.debit !== t.credit) throw new JournalError(`journal for ${args.date} does not balance (Dr ${t.debit} / Cr ${t.credit})`);
  return {
    id: `EOD-${args.propertyId}-${args.date}`,
    date: args.date,
    source: "eod",
    propertyId: args.propertyId,
    memo: `Daily sales and stock journal ${args.date}`,
    lines: out,
    createdAt: nowIso(),
  };
}

export function manualJournal(date: string, memo: string, lines: JournalLine[]): JournalEntry {
  const t = journalTotals(lines);
  if (t.debit !== t.credit) throw new JournalError("debits and credits must be equal");
  return { id: newId(), date, source: "manual", memo, lines: consolidate(lines), createdAt: nowIso() };
}

export interface TrialBalanceRow {
  account: Account;
  debit: Cents;
  credit: Cents;
  balance: Cents;
}

export function trialBalance(journals: readonly JournalEntry[], accounts: readonly Account[]): TrialBalanceRow[] {
  const map = new Map(accounts.map((acc) => [acc.code, { account: acc, debit: 0, credit: 0, balance: 0 }]));
  for (const j of journals) {
    for (const l of j.lines) {
      const row = map.get(l.accountCode) ?? { account: { id: l.accountCode, code: l.accountCode, name: "(unknown account)", type: "expense" as const }, debit: 0, credit: 0, balance: 0 };
      row.debit += l.debit;
      row.credit += l.credit;
      row.balance = row.debit - row.credit;
      map.set(l.accountCode, row);
    }
  }
  return [...map.values()].filter((r) => r.debit || r.credit).sort((x, y) => x.account.code.localeCompare(y.account.code));
}

export interface ProfitAndLoss {
  income: { account: Account; amount: Cents }[];
  expenses: { account: Account; amount: Cents }[];
  totalIncome: Cents;
  totalExpenses: Cents;
  netProfit: Cents;
}

export function profitAndLoss(tb: readonly TrialBalanceRow[]): ProfitAndLoss {
  const income = tb.filter((r) => r.account.type === "income").map((r) => ({ account: r.account, amount: r.credit - r.debit }));
  const expenses = tb.filter((r) => r.account.type === "expense").map((r) => ({ account: r.account, amount: r.debit - r.credit }));
  const totalIncome = income.reduce((x, r) => x + r.amount, 0);
  const totalExpenses = expenses.reduce((x, r) => x + r.amount, 0);
  return { income, expenses, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses };
}

/** Value of a goods receipt excluding input VAT (cents). */
export function receiptValue(grn: GoodsReceipt): Cents {
  return Math.round(grn.lines.reduce((x, l) => x + l.qty * l.unitCost, 0));
}
