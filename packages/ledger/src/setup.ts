import type { Account, AccountType } from "@pos/core";
import type { CostCenter, FiscalYear, LedgerSettings } from "./types.js";

type Root = Account["type"];

/** [code, name, parent, root, accountType?, isGroup?, statementLine?] */
type Row = [string, string, string | null, Root, AccountType | null, boolean, string?];

/**
 * Chart of accounts for a Sri Lankan restaurant, grouped for SLFRS/IFRS statements (statement
 * lines on the groups are inherited by their ledgers). Codes are the document ids.
 */
const CHART: Row[] = [
  ["1", "Assets", null, "asset", null, true],
  ["11", "Current assets", "1", "asset", null, true],
  ["110", "Cash and cash equivalents", "11", "asset", null, true, "cash"],
  ["1000", "Cash on hand", "110", "asset", "Cash", false],
  ["1001", "Petty cash", "110", "asset", "Cash", false],
  ["1010", "Bank – current account", "110", "asset", "Bank", false],
  ["1020", "Card settlements receivable", "110", "asset", "Bank", false],
  ["1030", "LankaQR settlements receivable", "110", "asset", "Bank", false],
  ["1040", "PayHere settlements receivable", "110", "asset", "Bank", false],
  ["1050", "Foreign currency cash", "110", "asset", "Cash", false],
  ["111", "Trade and other receivables", "11", "asset", null, true, "receivables"],
  ["1100", "Trade debtors (house accounts)", "111", "asset", "Receivable", false],
  ["1110", "Prepayments and deposits", "111", "asset", null, false],
  ["112", "Inventories", "11", "asset", null, true, "inventories"],
  ["1200", "Inventory – food and beverage", "112", "asset", "Stock", false],
  ["113", "Tax receivables", "11", "asset", null, true, "tax-receivables"],
  ["1300", "VAT input receivable", "113", "asset", "Tax", false],
  ["12", "Non-current assets", "1", "asset", null, true],
  ["120", "Property, plant and equipment", "12", "asset", null, true, "ppe"],
  ["1500", "Kitchen equipment", "120", "asset", "FixedAsset", false],
  ["1510", "Furniture and fittings", "120", "asset", "FixedAsset", false],
  ["1520", "IT and POS equipment", "120", "asset", "FixedAsset", false],
  ["1530", "Motor vehicles", "120", "asset", "FixedAsset", false],
  ["1591", "Accumulated depreciation – kitchen equipment", "120", "asset", "AccumulatedDepreciation", false],
  ["1592", "Accumulated depreciation – furniture and fittings", "120", "asset", "AccumulatedDepreciation", false],
  ["1593", "Accumulated depreciation – IT and POS equipment", "120", "asset", "AccumulatedDepreciation", false],
  ["1594", "Accumulated depreciation – motor vehicles", "120", "asset", "AccumulatedDepreciation", false],
  ["2", "Liabilities", null, "liability", null, true],
  ["21", "Current liabilities", "2", "liability", null, true],
  ["210", "Trade and other payables", "21", "liability", null, true, "payables"],
  ["2000", "Trade creditors", "210", "liability", "Payable", false],
  ["2010", "Stock received but not billed", "210", "liability", "StockReceivedNotBilled", false],
  ["2200", "Gift vouchers outstanding", "210", "liability", null, false],
  ["2300", "Accrued expenses", "210", "liability", null, false],
  ["2400", "Salaries payable", "210", "liability", null, false],
  ["2410", "EPF and ETF payable", "210", "liability", null, false],
  ["211", "Tax payables", "21", "liability", null, true, "tax-payables"],
  ["2100", "VAT output payable", "211", "liability", "Tax", false],
  ["2120", "SSCL payable", "211", "liability", "Tax", false],
  ["2130", "TDL payable", "211", "liability", "Tax", false],
  ["2140", "Withholding tax payable", "211", "liability", "Tax", false],
  ["22", "Non-current liabilities", "2", "liability", null, true],
  ["220", "Borrowings", "22", "liability", null, true, "borrowings"],
  ["2800", "Bank loans", "220", "liability", null, false],
  ["3", "Equity", null, "equity", null, true, "equity"],
  ["3000", "Stated capital", "3", "equity", "Equity", false],
  ["3100", "Retained earnings", "3", "equity", "RetainedEarnings", false],
  ["3900", "Opening balances (temporary)", "3", "equity", null, false],
  ["4", "Income", null, "income", null, true],
  ["40", "Revenue", "4", "income", null, true, "revenue"],
  ["4000", "Sales – food", "40", "income", "Income", false],
  ["4010", "Sales – beverage", "40", "income", "Income", false],
  ["4020", "Sales – other", "40", "income", "Income", false],
  ["4300", "Service charge", "40", "income", "Income", false],
  ["4900", "Discounts allowed", "40", "income", "Income", false],
  ["41", "Other income", "4", "income", null, true, "other-income"],
  ["4950", "Rounding", "41", "income", "RoundOff", false],
  ["4960", "Exchange gains and losses", "41", "income", "ExchangeGainLoss", false],
  ["4970", "Gain or loss on disposal of assets", "41", "income", null, false],
  ["5", "Cost of sales", null, "expense", null, true, "cost-of-sales"],
  ["5000", "Cost of sales – food", "5", "expense", "CostOfGoodsSold", false],
  ["5010", "Cost of sales – beverage", "5", "expense", "CostOfGoodsSold", false],
  ["5020", "Cost of sales – other", "5", "expense", "CostOfGoodsSold", false],
  ["5100", "Wastage", "5", "expense", null, false],
  ["5110", "Stock count differences", "5", "expense", null, false],
  ["5120", "Purchase price variance", "5", "expense", null, false],
  ["5200", "Complimentary and staff meals", "5", "expense", null, false],
  ["6", "Operating expenses", null, "expense", null, true, "operating-expenses"],
  ["6000", "Salaries and wages", "6", "expense", "Expense", false],
  ["6010", "EPF and ETF – employer", "6", "expense", "Expense", false],
  ["6100", "Rent", "6", "expense", "Expense", false],
  ["6200", "Electricity and water", "6", "expense", "Expense", false],
  ["6300", "Card and payment fees", "6", "expense", "Expense", false],
  ["6400", "Repairs and maintenance", "6", "expense", "Expense", false],
  ["6500", "Marketing", "6", "expense", "Expense", false],
  ["6600", "Depreciation", "6", "expense", "Depreciation", false],
  ["6700", "Bank charges", "6", "expense", "Expense", false],
  ["6800", "Professional fees", "6", "expense", "Expense", false],
  ["7", "Finance costs and tax", null, "expense", null, true],
  ["70", "Finance costs", "7", "expense", null, true, "finance-costs"],
  ["7000", "Interest expense", "70", "expense", "Expense", false],
  ["71", "Income tax", "7", "expense", null, true, "tax-expense"],
  ["7100", "Income tax expense", "71", "expense", "Expense", false],
];

export function defaultChartOfAccounts(): Account[] {
  return CHART.map(([code, name, parent, type, accountType, isGroup, statementLine]) => ({
    id: code,
    code,
    name,
    type,
    isGroup,
    ...(parent ? { parentId: parent } : {}),
    ...(accountType ? { accountType } : {}),
    ...(statementLine ? { statementLine } : {}),
  }));
}

export function defaultLedgerSettings(defaultCostCenter = "MAIN"): LedgerSettings {
  return {
    baseCurrency: "LKR",
    fiscalYearStartMonth: 4,
    accounts: {
      receivable: "1100",
      payable: "2000",
      stockReceivedNotBilled: "2010",
      inventory: "1200",
      vatInput: "1300",
      vatOutput: "2100",
      whtPayable: "2140",
      roundOff: "4950",
      fxGainLoss: "4960",
      retainedEarnings: "3100",
      bankCharges: "6700",
      priceVariance: "5120",
      disposalGainLoss: "4970",
    },
    defaultCostCenter,
    journalApprovalThreshold: 0,
    paymentApprovalThreshold: 50_000_00,
    matchTolerance: { qtyBp: 0, priceBp: 200 },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Fiscal year id containing a date, e.g. 2026-11-03 with an April start → `2026-27`. */
export function fiscalYearId(date: string, startMonth: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const startYear = m >= startMonth ? y : y - 1;
  if (startMonth === 1) return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function buildFiscalYear(startYear: number, startMonth: number): FiscalYear {
  const periods = Array.from({ length: 12 }, (_, i) => {
    const m = ((startMonth - 1 + i) % 12) + 1;
    const y = startYear + Math.floor((startMonth - 1 + i) / 12);
    return { id: `${y}-${pad(m)}`, start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(lastDay(y, m))}`, status: "open" as const };
  });
  const id = startMonth === 1 ? String(startYear) : `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { id, start: periods[0]!.start, end: periods[11]!.end, status: "open", periods };
}

export function fiscalYearFor(date: string, startMonth: number): FiscalYear {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return buildFiscalYear(m >= startMonth ? y : y - 1, startMonth);
}

export function defaultCostCenters(properties: { id: string; name: string }[]): CostCenter[] {
  return [
    { id: "ALL", name: "All outlets", isGroup: true },
    ...properties.map((p) => ({ id: p.id, name: p.name, parentId: "ALL", isGroup: false, propertyId: p.id })),
    { id: "HO", name: "Head office", parentId: "ALL", isGroup: false },
  ];
}

/** Statement line of an account: its own or the nearest ancestor's. */
export function statementLineOf(accountId: string, accounts: ReadonlyMap<string, Account>): string | undefined {
  let cur = accounts.get(accountId);
  for (let i = 0; cur && i < 10; i++) {
    if (cur.statementLine) return cur.statementLine;
    cur = cur.parentId ? accounts.get(cur.parentId) : undefined;
  }
  return undefined;
}

export function ancestorsOf(accountId: string, accounts: ReadonlyMap<string, Account>): string[] {
  const out: string[] = [];
  let cur = accounts.get(accountId);
  for (let i = 0; cur?.parentId && i < 10; i++) {
    out.push(cur.parentId);
    cur = accounts.get(cur.parentId);
  }
  return out;
}
