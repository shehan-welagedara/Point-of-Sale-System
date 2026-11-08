/**
 * Accounting workbook: brings a business's books into the system from Excel — chart of accounts
 * additions, opening balances, opening stock, suppliers and customers with what they owe, supplier
 * bills (paid or not), expenses, daily sales from manual bills and fixed assets.
 *
 * The guide version is filled with a worked example (a small restaurant that started in April) so
 * clients can see exactly what goes where, then replace the sample rows with their own.
 */
import ExcelJS from "exceljs";
import type { Account, Customer, InventoryItem, Vendor } from "@pos/core";

type Col = { header: string; key: string; width: number; note?: string; list?: string[]; accountList?: boolean };

export const ACCOUNTING_SHEETS = {
  accounts: "New accounts",
  opening: "Opening balances",
  openingStock: "Opening stock",
  suppliers: "Suppliers",
  customers: "Customers",
  bills: "Supplier bills",
  expenses: "Expenses",
  sales: "Daily sales",
  assets: "Fixed assets",
} as const;
type SheetKey = keyof typeof ACCOUNTING_SHEETS;

/** First line of the Read me sheet in the example copy; the import refuses the example as it stands. */
export const SAMPLE_MARK = "This copy is filled with an EXAMPLE (a small restaurant that starts its books on 1 April). Read it, then delete the sample rows and type your own.";

export const PAID_FROM_ACCOUNTS: Record<string, string> = { Cash: "1000", "Petty cash": "1001", Bank: "1010" };
const ASSET_CATEGORIES: Record<string, { asset: string; accumulated: string }> = {
  "Kitchen equipment": { asset: "1500", accumulated: "1591" },
  "Furniture and fittings": { asset: "1510", accumulated: "1592" },
  "IT and POS equipment": { asset: "1520", accumulated: "1593" },
  "Motor vehicles": { asset: "1530", accumulated: "1594" },
};

const COLS: Record<SheetKey, Col[]> = {
  accounts: [
    { header: "Code", key: "code", width: 10, note: "4 digits, not already in the chart (see the Chart of accounts sheet). Keep it in the right range: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx–7xxx expenses." },
    { header: "Name", key: "name", width: 38 },
    { header: "Type", key: "type", width: 12, list: ["asset", "liability", "equity", "income", "expense"] },
    { header: "Under group", key: "parent", width: 12, note: "Code of the group it belongs to, e.g. 6 for operating expenses, 110 for cash and bank." },
    { header: "Kind", key: "accountType", width: 16, list: ["Bank", "Cash", "Expense", "Income", "FixedAsset", "Payable", "Receivable", "Tax", "Equity"], note: "Bank or Cash for money accounts (so payments can use them); Expense for running costs." },
  ],
  opening: [
    { header: "Account code", key: "account", width: 14, accountList: true },
    { header: "Account name (for you)", key: "accountName", width: 34 },
    { header: "Debit (Rs)", key: "debit", width: 14, note: "What you have: cash, bank, deposits, prepayments." },
    { header: "Credit (Rs)", key: "credit", width: 14, note: "What you owe or put in: loans, capital." },
    { header: "Note", key: "note", width: 36 },
  ],
  openingStock: [
    { header: "Stock item code", key: "item", width: 16, note: "Code of a stock item already in the system (Inventory → Stock items or the data feeder workbook)." },
    { header: "Item name (for you)", key: "itemName", width: 30 },
    { header: "Quantity on hand", key: "qty", width: 16, note: "In the item's stock unit (g, ml or pcs): 25 kg of rice = 25000." },
  ],
  suppliers: [
    { header: "Code", key: "code", width: 10 },
    { header: "Name", key: "name", width: 32 },
    { header: "Contact person", key: "contact", width: 20 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Email", key: "email", width: 24 },
    { header: "Address", key: "address", width: 30 },
    { header: "VAT number", key: "vat", width: 14 },
    { header: "Pays after (days)", key: "terms", width: 14, note: "Credit period: 0 = cash on delivery." },
    { header: "We owe them at the start (Rs)", key: "opening", width: 18, note: "Unpaid bills on the day the books start. Each unpaid bill can also be entered on the Supplier bills sheet instead." },
  ],
  customers: [
    { header: "Code", key: "code", width: 10 },
    { header: "Name", key: "name", width: 32 },
    { header: "Phone", key: "phone", width: 14 },
    { header: "Email", key: "email", width: 24 },
    { header: "Address", key: "address", width: 30 },
    { header: "VAT TIN", key: "tin", width: 14 },
    { header: "They owe us at the start (Rs)", key: "opening", width: 18, note: "Credit customers only (companies, events)." },
  ],
  bills: [
    { header: "Bill date", key: "date", width: 12, note: "YYYY-MM-DD, e.g. 2026-04-03" },
    { header: "Supplier code", key: "supplier", width: 14, note: "From the Suppliers sheet or already in the system." },
    { header: "Bill number", key: "billNo", width: 14 },
    { header: "What for", key: "description", width: 30 },
    { header: "Account code", key: "account", width: 14, accountList: true, note: "Expense account, e.g. 5000 food bought for the kitchen, 6150 gas, 6400 repairs." },
    { header: "Amount before VAT (Rs)", key: "net", width: 16 },
    { header: "VAT (Rs)", key: "vat", width: 10, note: "Only for VAT invoices, and only if your business is VAT registered." },
    { header: "Paid on", key: "paidOn", width: 12, note: "Leave empty if not paid yet." },
    { header: "Paid from", key: "paidFrom", width: 12, list: Object.keys(PAID_FROM_ACCOUNTS) },
    { header: "Payment reference", key: "ref", width: 16 },
  ],
  expenses: [
    { header: "Date", key: "date", width: 12 },
    { header: "What for", key: "description", width: 34 },
    { header: "Account code", key: "account", width: 14, accountList: true },
    { header: "Amount (Rs)", key: "amount", width: 14 },
    { header: "Paid from", key: "paidFrom", width: 12, list: Object.keys(PAID_FROM_ACCOUNTS) },
  ],
  sales: [
    { header: "Date", key: "date", width: 12 },
    { header: "Bill numbers", key: "bills", width: 14 },
    { header: "Food (Rs)", key: "food", width: 12, note: "Before service charge and taxes." },
    { header: "Beverages (Rs)", key: "beverage", width: 12 },
    { header: "Other (Rs)", key: "other", width: 10 },
    { header: "Service charge (Rs)", key: "sc", width: 12 },
    { header: "VAT (Rs)", key: "vat", width: 10 },
    { header: "SSCL (Rs)", key: "sscl", width: 10 },
    { header: "Discounts (Rs)", key: "discount", width: 12 },
    { header: "Cash received (Rs)", key: "cash", width: 14, note: "Sales minus discounts must equal the money received (cash + card + bank)." },
    { header: "Card (Rs)", key: "card", width: 12 },
    { header: "Bank / LankaQR (Rs)", key: "bank", width: 14 },
  ],
  assets: [
    { header: "Asset code", key: "code", width: 12 },
    { header: "Name", key: "name", width: 30 },
    { header: "Category", key: "category", width: 22, list: Object.keys(ASSET_CATEGORIES) },
    { header: "Bought on", key: "purchaseDate", width: 12 },
    { header: "Cost (Rs)", key: "cost", width: 14 },
    { header: "Depreciation to date (Rs)", key: "accumulated", width: 16, note: "Total depreciation already charged before the books start (from your last accounts). 0 if new." },
    { header: "Useful life (years)", key: "lifeYears", width: 12 },
    { header: "Scrap value (Rs)", key: "salvage", width: 12 },
  ],
};

/** The worked example: a small Colombo restaurant whose books start on 1 April. */
function sample(asAt: string, items: InventoryItem[] = []): Record<SheetKey, Record<string, unknown>[]> {
  const y = asAt.slice(0, 4);
  const d = (md: string) => `${y}-${md}`;
  return {
    accounts: [
      { code: "6150", name: "Gas (LP gas cylinders)", type: "expense", parent: "6", accountType: "Expense" },
      { code: "6160", name: "Cleaning supplies", type: "expense", parent: "6", accountType: "Expense" },
      { code: "1015", name: "Bank – savings account", type: "asset", parent: "110", accountType: "Bank" },
    ],
    opening: [
      { account: "1000", accountName: "Cash on hand", debit: 25000, credit: "", note: "Cash in the till and safe on the first day" },
      { account: "1010", accountName: "Bank – current account", debit: 640000, credit: "", note: "Bank statement balance" },
      { account: "1110", accountName: "Prepayments and deposits", debit: 300000, credit: "", note: "Rent deposit paid to the landlord" },
      { account: "2800", accountName: "Bank loans", debit: "", credit: 400000, note: "Equipment loan still owed" },
      { account: "3000", accountName: "Stated capital", debit: "", credit: 1400000, note: "Money the owners put in" },
    ],
    // The business's own stock items when it has some, so the example imports as it stands.
    openingStock: items.length
      ? items.filter((i) => i.trackStock && !i.isPrep && i.active).slice(0, 3).map((i) => ({ item: i.code, itemName: i.name, qty: 5 * (i.purchaseFactor || 1) }))
      : [
          { item: "RICE-SAMBA", itemName: "Samba rice", qty: 50000 },
          { item: "OIL-COCONUT", itemName: "Coconut oil", qty: 12000 },
        ],
    suppliers: [
      { code: "VEG01", name: "Perera Vegetable Stores", contact: "Mr. Perera", phone: "0771234567", email: "", address: "Manning Market, Colombo 11", vat: "", terms: 7, opening: 18500 },
      { code: "MEAT01", name: "Island Poultry Farm", contact: "Ms. Fernando", phone: "0712345678", email: "orders@islandpoultry.lk", address: "Kadawatha", vat: "114567890", terms: 14, opening: 42000 },
      { code: "GAS01", name: "City Gas Dealer", contact: "", phone: "0112345678", email: "", address: "Colombo 05", vat: "", terms: 0, opening: "" },
      { code: "LAND01", name: "Mr. Silva (landlord)", contact: "", phone: "0779876543", email: "", address: "", vat: "", terms: 0, opening: "" },
    ],
    customers: [{ code: "ABC01", name: "ABC Holdings (Pvt) Ltd – staff lunches", phone: "0112223344", email: "accounts@abc.lk", address: "Colombo 03", tin: "134567890", opening: 42000 }],
    bills: [
      { date: d("04-02"), supplier: "VEG01", billNo: "V-2201", description: "Vegetables", account: "5000", net: 14250, vat: "", paidOn: d("04-02"), paidFrom: "Cash", ref: "" },
      { date: d("04-03"), supplier: "MEAT01", billNo: "IP-5531", description: "Chicken 40 kg", account: "5000", net: 52000, vat: "", paidOn: "", paidFrom: "", ref: "" },
      { date: d("04-05"), supplier: "GAS01", billNo: "G-118", description: "LP gas 3 cylinders", account: "6150", net: 14400, vat: "", paidOn: d("04-05"), paidFrom: "Bank", ref: "TRF 88231" },
      { date: d("04-05"), supplier: "LAND01", billNo: "RENT-APR", description: "Rent for April", account: "6100", net: 150000, vat: "", paidOn: d("04-05"), paidFrom: "Bank", ref: "CHQ 000412" },
    ],
    expenses: [
      { date: d("04-04"), description: "Electricity (CEB) March", account: "6200", amount: 38600, paidFrom: "Bank" },
      { date: d("04-06"), description: "Cleaning supplies", account: "6160", amount: 3450, paidFrom: "Petty cash" },
    ],
    sales: [
      { date: d("04-01"), bills: "1001–1046", food: 98500, beverage: 21300, other: "", sc: 9800, vat: "", sscl: "", discount: 2500, cash: 74100, card: 41000, bank: 12000 },
      { date: d("04-02"), bills: "1047–1101", food: 112400, beverage: 26750, other: 1500, sc: 11200, vat: "", sscl: "", discount: "", cash: 90850, card: 49000, bank: 12000 },
    ],
    assets: [
      { code: "FA-001", name: "Combi oven", category: "Kitchen equipment", purchaseDate: `${Number(y) - 1}-06-15`, cost: 600000, accumulated: 62500, lifeYears: 8, salvage: 0 },
      { code: "FA-002", name: "Dining tables and chairs", category: "Furniture and fittings", purchaseDate: `${Number(y) - 1}-07-01`, cost: 350000, accumulated: 37500, lifeYears: 7, salvage: 0 },
    ],
  };
}

function header(ws: ExcelJS.Worksheet, cols: Col[], refRows: number) {
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const h = ws.getRow(1);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15803D" } };
  h.alignment = { vertical: "middle", wrapText: true };
  h.height = 32;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  cols.forEach((c, i) => {
    if (c.note) h.getCell(i + 1).note = c.note;
    const validation: ExcelJS.DataValidation | null = c.list
      ? { type: "list", allowBlank: true, formulae: [`"${c.list.join(",")}"`] }
      : c.accountList
        ? { type: "list", allowBlank: true, formulae: [`'Chart of accounts'!$A$2:$A$${refRows + 1}`] }
        : null;
    if (validation) for (let r = 2; r <= 400; r++) ws.getCell(r, i + 1).dataValidation = validation;
  });
}

/**
 * The accounting workbook. `sample` fills every sheet with the worked example; without it the
 * sheets are empty but keep their instructions, drop-downs and the chart of accounts.
 */
export async function buildAccountingWorkbook(opts: { chart: Account[]; items?: InventoryItem[]; asAt: string; sample: boolean; businessName?: string }): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS Suite";
  wb.created = new Date();
  const readme = wb.addWorksheet("Read me");
  readme.columns = [{ width: 120 }];
  const lines: [string, "title" | "head" | ""][] = [
    [`Bringing your books into the system${opts.businessName ? ` – ${opts.businessName}` : ""}`, "title"],
    [opts.sample ? SAMPLE_MARK : "Fill each sheet you need; leave the others empty.", ""],
    ["", ""],
    ["The date your books start (\"as at\")", "head"],
    [`Opening balances, opening stock and what suppliers and customers owe are all on the start date you choose when importing (this file was made for ${opts.asAt}). Bills, expenses and sales after that date go on their own sheets with their own dates.`, ""],
    ["", ""],
    ["The sheets, in the order the system reads them", "head"],
    ["New accounts – only if you need accounts the standard chart doesn't have (see the Chart of accounts sheet). Most businesses need none or a few.", ""],
    ["Opening balances – on the start date: cash, bank, deposits (debit); loans and capital (credit). Don't list suppliers, customers, stock or equipment here: they have their own sheets.", ""],
    ["  If you don't know the exact capital or past profits, leave them out: the import puts the difference in Retained earnings (3100) and shows you the amount first.", ""],
    ["Opening stock – what is in the store on the start date, for stock items already in the system (Inventory → Stock items, or the data feeder workbook). Valued at each item's cost.", ""],
    ["Suppliers – everyone you buy from, with how much you owed them on the start date.", ""],
    ["Customers – only companies that buy on credit, with how much they owed you.", ""],
    ["Supplier bills – each bill after the start date. If it was paid, add the date and how (Cash, Petty cash or Bank). Unpaid bills stay open under Payables.", ""],
    ["  If you keep stock in the system, ingredients you put into the store are received as goods receipts (Inventory → Receiving), not entered here: that is what keeps stock and cost of sales right. Use 5000 only for food used at once and not kept in stock.", ""],
    ["Expenses – costs without a supplier bill to keep (electricity, small cash purchases), already paid.", ""],
    ["Daily sales – totals of each day's handwritten bills: sales, service charge and taxes, and the money received. They must match.", ""],
    ["Fixed assets – equipment, furniture and vehicles owned on the start date, with depreciation already charged. Depreciation continues monthly from there.", ""],
    ["", ""],
    ["Rules", "head"],
    ["Dates as YYYY-MM-DD (2026-04-03). Amounts in rupees without the Rs sign (14250 or 14250.50). Codes are the keys: keep them unique.", ""],
    ["Account columns have a drop-down of the chart of accounts. Hover over a column heading for help.", ""],
    ["Importing twice is safe: rows already imported are recognised and skipped.", ""],
    ["", ""],
    ["Importing", "head"],
    ["Back office → Finance → Excel import → choose this file. The system checks every row and shows totals and any problems BEFORE anything is saved. Fix the file and choose it again until it is clean, then press Import.", ""],
    ["Journals (opening balances, daily sales, expenses) may need approval by a second person if your business requires it (Finance settings). They then wait under Finance → Approvals.", ""],
  ];
  lines.forEach(([t, kind]) => {
    const row = readme.addRow([t]);
    row.alignment = { wrapText: true, vertical: "top" };
    if (kind === "title") row.font = { bold: true, size: 16 };
    if (kind === "head") row.font = { bold: true, color: { argb: "FF15803D" } };
  });

  const chart = opts.chart.filter((a) => !a.isGroup).sort((a, b) => a.code.localeCompare(b.code));
  const data = opts.sample ? sample(opts.asAt, opts.items) : null;
  for (const key of Object.keys(ACCOUNTING_SHEETS) as SheetKey[]) {
    const ws = wb.addWorksheet(ACCOUNTING_SHEETS[key]);
    header(ws, COLS[key], chart.length);
    for (const r of data?.[key] ?? []) ws.addRow(r);
  }
  const ref = wb.addWorksheet("Chart of accounts");
  ref.columns = [{ header: "Code", key: "code", width: 10 }, { header: "Name", key: "name", width: 44 }, { header: "Type", key: "type", width: 12 }, { header: "Kind", key: "kind", width: 18 }];
  ref.getRow(1).font = { bold: true };
  chart.forEach((a) => ref.addRow({ code: a.code, name: a.name, type: a.type, kind: a.accountType ?? "" }));
  if (opts.items?.length) {
    const items = wb.addWorksheet("Stock items (reference)");
    items.columns = [{ header: "Code", key: "code", width: 16 }, { header: "Name", key: "name", width: 34 }, { header: "Stock unit", key: "unit", width: 10 }, { header: "Cost per purchase unit (Rs)", key: "cost", width: 18 }, { header: "Purchase unit", key: "pu", width: 12 }];
    items.getRow(1).font = { bold: true };
    opts.items.forEach((i) => items.addRow({ code: i.code, name: i.name, unit: i.stockUnit, cost: i.purchaseCost / 100, pu: i.purchaseUnit }));
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ───────────────────────────── Reading ─────────────────────────────

export interface AccountingRowIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface AccountingImport {
  accounts: Account[];
  opening: { account: string; debit: number; credit: number; note: string }[];
  openingStock: { itemId: string; qty: number }[];
  suppliers: (Vendor & { opening: number })[];
  customers: (Customer & { opening: number })[];
  bills: { row: number; date: string; supplierId: string; billNo: string; description: string; account: string; net: number; vat: number; paidOn?: string; paidFrom?: string; ref?: string }[];
  expenses: { row: number; date: string; description: string; account: string; amount: number; paidFrom: string }[];
  sales: { row: number; date: string; bills: string; food: number; beverage: number; other: number; sc: number; vat: number; sscl: number; discount: number; cash: number; card: number; bank: number }[];
  assets: { code: string; name: string; category: string; assetAccount: string; accumulatedDepAccount: string; purchaseDate: string; cost: number; accumulated: number; lifeMonths: number; salvage: number }[];
  errors: AccountingRowIssue[];
  warnings: AccountingRowIssue[];
  /** The unchanged example copy. */
  isSample: boolean;
}

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in v) return text(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

function rows(wb: ExcelJS.Workbook, key: SheetKey) {
  const ws = wb.getWorksheet(ACCOUNTING_SHEETS[key]);
  if (!ws) return [];
  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => headers.set(text(cell.value).toLowerCase(), col));
  const colFor = new Map(COLS[key].map((c) => [c.key, headers.get(c.header.toLowerCase())]));
  const out: { row: number; get: (k: string) => string }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const get = (k: string) => {
      const col = colFor.get(k);
      return col ? text(r.getCell(col).value) : "";
    };
    if (COLS[key].every((c) => get(c.key) === "")) return;
    out.push({ row: n, get });
  });
  return out;
}

/**
 * Reads and checks an accounting workbook against the business's chart of accounts, suppliers,
 * customers and stock items. Nothing is saved here; the caller shows the result first.
 */
export async function parseAccountingWorkbook(buffer: ArrayBuffer, ctx: { chart: Account[]; vendors: Vendor[]; customers: Customer[]; items: InventoryItem[]; vatRegistered: boolean; ssclRegistered: boolean; asAt: string; allowSample?: boolean }): Promise<AccountingImport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out: AccountingImport = { accounts: [], opening: [], openingStock: [], suppliers: [], customers: [], bills: [], expenses: [], sales: [], assets: [], errors: [], warnings: [], isSample: false };
  if (!wb.getWorksheet(ACCOUNTING_SHEETS.opening) && !wb.getWorksheet(ACCOUNTING_SHEETS.bills)) {
    out.errors.push({ sheet: "", row: 0, message: "This isn't the accounting workbook. Download it from this page and fill it in." });
    return out;
  }
  // The example copy, unchanged, must not end up in a business's real books.
  out.isSample = text(wb.getWorksheet("Read me")?.getCell("A2").value ?? null) === SAMPLE_MARK && rows(wb, "suppliers").some((r) => r.get("code") === "VEG01" && r.get("name") === "Perera Vegetable Stores");
  if (out.isSample && !ctx.allowSample) out.errors.push({ sheet: "Read me", row: 2, message: "This is still the example data. Replace the sample rows with your own (or download the blank workbook) before importing." });
  const err = (key: SheetKey, row: number, message: string) => out.errors.push({ sheet: ACCOUNTING_SHEETS[key], row, message });
  const warn = (key: SheetKey, row: number, message: string) => out.warnings.push({ sheet: ACCOUNTING_SHEETS[key], row, message });
  const money = (key: SheetKey, row: number, s: string, label: string): number => {
    if (!s) return 0;
    const n = Number(s.replace(/,/g, "").replace(/^Rs\.?\s*/i, ""));
    if (!Number.isFinite(n) || n < 0) {
      err(key, row, `${label}: "${s}" is not an amount`);
      return 0;
    }
    return Math.round(n * 100);
  };
  const date = (key: SheetKey, row: number, s: string, label: string, required = true): string => {
    if (!s) {
      if (required) err(key, row, `${label} is missing`);
      return "";
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
      err(key, row, `${label}: "${s}" is not a date (use YYYY-MM-DD)`);
      return "";
    }
    return s;
  };

  // New accounts, then the chart they extend.
  const chart = new Map(ctx.chart.map((a) => [a.code, a]));
  for (const r of rows(wb, "accounts")) {
    const code = r.get("code");
    const type = r.get("type") as Account["type"];
    if (!/^\d{3,6}$/.test(code)) {
      err("accounts", r.row, `code "${code}" must be 3–6 digits`);
      continue;
    }
    if (!["asset", "liability", "equity", "income", "expense"].includes(type)) err("accounts", r.row, "type must be asset, liability, equity, income or expense");
    const parent = r.get("parent");
    if (parent && !chart.get(parent)?.isGroup) warn("accounts", r.row, `group ${parent} is not a group account in the chart; the account is added at the top of its type`);
    if (chart.has(code)) {
      warn("accounts", r.row, `${code} already exists (${chart.get(code)!.name}); kept as it is`);
      continue;
    }
    const kind = r.get("accountType");
    const a: Account = { id: code, code, name: r.get("name") || code, type, isGroup: false, ...(parent && chart.get(parent)?.isGroup ? { parentId: parent } : {}), ...(kind ? { accountType: kind as Account["accountType"] } : {}) } as Account;
    out.accounts.push(a);
    chart.set(code, a);
  }
  const account = (key: SheetKey, row: number, code: string, label = "account"): string => {
    const a = chart.get(code);
    if (!a) err(key, row, `${label} ${code || "(empty)"} is not in the chart of accounts`);
    else if (a.isGroup) err(key, row, `${code} ${a.name} is a group; use one of its accounts`);
    return code;
  };

  for (const r of rows(wb, "opening")) {
    const code = account("opening", r.row, r.get("account"));
    const debit = money("opening", r.row, r.get("debit"), "Debit");
    const credit = money("opening", r.row, r.get("credit"), "Credit");
    if (debit && credit) err("opening", r.row, "put the amount in Debit or Credit, not both");
    const kind = chart.get(code)?.accountType;
    if (kind === "Payable" || kind === "Receivable") err("opening", r.row, "list what suppliers and customers owe on their own sheets, not here");
    if (kind === "Stock") warn("opening", r.row, "stock is better entered on the Opening stock sheet (item by item)");
    if (code === "3900") err("opening", r.row, "3900 is the import's own clearing account; leave it out (the difference goes to retained earnings)");
    if (debit || credit) out.opening.push({ account: code, debit, credit, note: r.get("note") });
  }

  const items = new Map(ctx.items.map((i) => [i.code, i]));
  for (const r of rows(wb, "openingStock")) {
    const it = items.get(r.get("item"));
    const qty = Number(r.get("qty").replace(/,/g, ""));
    if (!it) err("openingStock", r.row, `stock item ${r.get("item")} is not in the system: add it under Inventory → Stock items first`);
    else if (!(qty > 0)) err("openingStock", r.row, "quantity must be more than 0");
    else out.openingStock.push({ itemId: it.id, qty });
  }

  // Suppliers by code or by id (bills may use either).
  const vendors = new Map<string, Vendor>([...ctx.vendors.map((v) => [v.id, v] as const), ...ctx.vendors.map((v) => [v.code, v] as const)]);
  for (const r of rows(wb, "suppliers")) {
    const code = r.get("code");
    if (!code || !r.get("name")) {
      err("suppliers", r.row, "code and name are required");
      continue;
    }
    const terms = Number(r.get("terms") || 0);
    const v = { id: code, code, name: r.get("name"), phone: r.get("phone"), ...(r.get("contact") ? { contactName: r.get("contact") } : {}), ...(r.get("email") ? { email: r.get("email") } : {}), ...(r.get("address") ? { address: r.get("address") } : {}), ...(r.get("vat") ? { vatNumber: r.get("vat") } : {}), paymentTermsDays: Number.isFinite(terms) ? terms : 0, active: true, opening: money("suppliers", r.row, r.get("opening"), "Opening amount") };
    if (vendors.has(code)) warn("suppliers", r.row, `${code} is already in the system (${vendors.get(code)!.name}): kept as it is${v.opening ? "; the opening amount is still added" : ""}`);
    out.suppliers.push(v);
    if (!vendors.has(code)) vendors.set(code, v);
  }
  const customers = new Map(ctx.customers.map((c) => [c.id, c]));
  for (const r of rows(wb, "customers")) {
    const code = r.get("code");
    if (!code || !r.get("name")) {
      err("customers", r.row, "code and name are required");
      continue;
    }
    const c = { id: code, name: r.get("name"), phone: r.get("phone"), ...(r.get("email") ? { email: r.get("email") } : {}), ...(r.get("address") ? { address: r.get("address") } : {}), ...(r.get("tin") ? { vatTin: r.get("tin") } : {}), tags: ["credit"], marketingConsent: false, visits: 0, totalSpend: 0, points: 0, createdAt: new Date().toISOString(), opening: money("customers", r.row, r.get("opening"), "Opening amount") } as Customer & { opening: number };
    if (customers.has(code)) warn("customers", r.row, `${code} is already in the system (${customers.get(code)!.name}): kept as it is${c.opening ? "; the opening amount is still added" : ""}`);
    out.customers.push(c);
    if (!customers.has(code)) customers.set(code, c);
  }

  for (const r of rows(wb, "bills")) {
    const dt = date("bills", r.row, r.get("date"), "Bill date");
    const sup = r.get("supplier");
    if (!vendors.has(sup)) err("bills", r.row, `supplier ${sup || "(empty)"} is not on the Suppliers sheet or in the system`);
    const net = money("bills", r.row, r.get("net"), "Amount");
    if (!r.get("net")) err("bills", r.row, "amount before VAT is missing");
    const vat = money("bills", r.row, r.get("vat"), "VAT");
    if (vat && !ctx.vatRegistered) warn("bills", r.row, "your business isn't VAT registered, so VAT is added to the cost");
    const paidOn = date("bills", r.row, r.get("paidOn"), "Paid on", false);
    const paidFrom = r.get("paidFrom");
    if (paidOn && !PAID_FROM_ACCOUNTS[paidFrom]) err("bills", r.row, "Paid from must be Cash, Petty cash or Bank");
    if (dt && dt < ctx.asAt) err("bills", r.row, `the bill is before the start date ${ctx.asAt}: include it in the supplier's opening amount instead`);
    out.bills.push({ row: r.row, date: dt, supplierId: vendors.get(sup)?.id ?? sup, billNo: r.get("billNo") || `ROW${r.row}`, description: r.get("description"), account: account("bills", r.row, r.get("account")), net: ctx.vatRegistered ? net : net + vat, vat: ctx.vatRegistered ? vat : 0, ...(paidOn ? { paidOn, paidFrom } : {}), ...(r.get("ref") ? { ref: r.get("ref") } : {}) });
  }
  for (const r of rows(wb, "expenses")) {
    const dt = date("expenses", r.row, r.get("date"), "Date");
    const amount = money("expenses", r.row, r.get("amount"), "Amount");
    if (!r.get("amount")) err("expenses", r.row, "amount is missing");
    const paidFrom = r.get("paidFrom");
    if (!PAID_FROM_ACCOUNTS[paidFrom]) err("expenses", r.row, "Paid from must be Cash, Petty cash or Bank");
    if (dt && dt < ctx.asAt) err("expenses", r.row, `the date is before the start date ${ctx.asAt}`);
    out.expenses.push({ row: r.row, date: dt, description: r.get("description") || "Expense", account: account("expenses", r.row, r.get("account")), amount, paidFrom });
  }
  for (const r of rows(wb, "sales")) {
    const dt = date("sales", r.row, r.get("date"), "Date");
    const m = (k: string, label: string) => money("sales", r.row, r.get(k), label);
    const s = { row: r.row, date: dt, bills: r.get("bills"), food: m("food", "Food"), beverage: m("beverage", "Beverages"), other: m("other", "Other"), sc: m("sc", "Service charge"), vat: m("vat", "VAT"), sscl: m("sscl", "SSCL"), discount: m("discount", "Discounts"), cash: m("cash", "Cash"), card: m("card", "Card"), bank: m("bank", "Bank") };
    const total = s.food + s.beverage + s.other + s.sc + s.vat + s.sscl - s.discount;
    const received = s.cash + s.card + s.bank;
    if (!total) err("sales", r.row, "no sales on this row");
    else if (total !== received) err("sales", r.row, `sales (${(total / 100).toFixed(2)}) and money received (${(received / 100).toFixed(2)}) differ by ${((total - received) / 100).toFixed(2)}`);
    if (s.vat && !ctx.vatRegistered) err("sales", r.row, "VAT entered but the business isn't VAT registered (Administration → Business & tax)");
    if (s.sscl && !ctx.ssclRegistered) err("sales", r.row, "SSCL entered but the business isn't set up for SSCL (Administration → Business & tax)");
    if (dt && dt < ctx.asAt) err("sales", r.row, `the date is before the start date ${ctx.asAt}`);
    out.sales.push(s);
  }
  for (const r of rows(wb, "assets")) {
    const cat = ASSET_CATEGORIES[r.get("category")];
    if (!cat) err("assets", r.row, `category must be one of: ${Object.keys(ASSET_CATEGORIES).join(", ")}`);
    const purchaseDate = date("assets", r.row, r.get("purchaseDate"), "Bought on");
    const cost = money("assets", r.row, r.get("cost"), "Cost");
    const accumulated = money("assets", r.row, r.get("accumulated"), "Depreciation to date");
    const years = Number(r.get("lifeYears"));
    if (!r.get("cost")) err("assets", r.row, "cost is missing");
    if (accumulated > cost) err("assets", r.row, "depreciation to date is more than the cost");
    if (!(years > 0)) err("assets", r.row, "useful life (years) is missing");
    if (purchaseDate && purchaseDate > ctx.asAt) warn("assets", r.row, "bought after the start date: better entered as a supplier bill to account 15xx");
    if (cat) out.assets.push({ code: r.get("code") || `FA-R${r.row}`, name: r.get("name") || "Asset", category: r.get("category"), assetAccount: cat.asset, accumulatedDepAccount: cat.accumulated, purchaseDate, cost, accumulated, lifeMonths: Math.round(years * 12), salvage: money("assets", r.row, r.get("salvage"), "Scrap value") });
  }
  return out;
}

/** Value of opening stock at each item's cost (cost per purchase unit ÷ stock units per purchase unit). */
export function openingStockValue(lines: AccountingImport["openingStock"], items: InventoryItem[]): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  return lines.reduce((s, l) => {
    const it = byId.get(l.itemId);
    return s + (it ? Math.round((l.qty * it.purchaseCost) / (it.purchaseFactor || 1)) : 0);
  }, 0);
}
