/**
 * Puts a checked accounting workbook into the books, through the ledger like any other entry
 * (numbers, approvals, audit trail). Every document gets an id derived from the workbook (supplier
 * and bill number, date…), so importing the same file again skips what is already in and finishes
 * anything a dropped connection left half done.
 *
 * Opening balances use 3900 "Opening balances (temporary)": supplier and customer openings and
 * opening stock post against it, the opening journal clears it, and whatever is left over — the
 * profits of the years before the books start — goes to 3100 Retained earnings.
 */
import {
  type AccountingSettings,
  type Customer,
  type DocStore,
  type InventoryItem,
  type StockCount,
  type StockMovement,
  type Vendor,
  COLLECTIONS as C,
  addDays,
  postStockCount,
} from "@pos/core";
import {
  type AccountBalance,
  type Asset,
  type JournalVoucher,
  type LedgerRequest,
  type LineInput,
  type PaymentVoucher,
  type PurchaseInvoice,
  type SalesInvoice,
  type Voucher,
  LEDGER as L,
  addMonths,
} from "@pos/ledger";
import { type AccountingImport, PAID_FROM_ACCOUNTS, openingStockValue } from "./accounting.js";

export const OPENING_CLEARING = "3900";
export const RETAINED_EARNINGS = "3100";
const SUNDRY = "SUNDRY";

export interface BooksImportContext {
  store: DocStore;
  /** The ledger service (Cloud Function, or the local engine in demo mode). */
  ledger: <T>(req: LedgerRequest) => Promise<T>;
  uid: string;
  asAt: string;
  costCenter: string;
  /** The outlet that owns the stores (stock postings). */
  propertyId: string;
  /** Store the opening stock is counted into. */
  locationId: string;
  accounting: AccountingSettings["accounts"];
  vatRegistered: boolean;
  ssclRegistered: boolean;
  onProgress?: (done: number, total: number, label: string) => void;
  now?: () => Date;
}

export interface BooksImportResult {
  posted: string[];
  awaitingApproval: string[];
  skipped: string[];
  failed: { what: string; message: string }[];
  created: { accounts: number; suppliers: number; customers: number; assets: number };
  /** Credit (+) or debit (−) put in retained earnings by the opening journal. */
  retainedEarnings: number;
}

/** Firestore-safe id part. */
const slug = (s: string) => s.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "X";

/** Ids for rows that have no natural key: the same row content on the same day gets -2, -3… */
function occurrenceIds<T>(rows: T[], key: (r: T) => string, prefix: string): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = key(r);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    return `${prefix}${n > 1 ? `-${n}` : ""}`;
  });
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36).toUpperCase();
}

/** The opening journal's lines, given what 3900 holds when it is posted. */
export function openingJournalLines(data: Pick<AccountingImport, "opening" | "assets">, clearingBalance: number): { lines: LineInput[]; retainedEarnings: number } {
  const lines: LineInput[] = [];
  for (const o of data.opening) lines.push({ account: o.account, debit: o.debit, credit: o.credit, memo: o.note || "Opening balance" });
  for (const a of data.assets) {
    lines.push({ account: a.assetAccount, debit: a.cost, credit: 0, memo: `${a.code} ${a.name} – cost` });
    if (a.accumulated) lines.push({ account: a.accumulatedDepAccount, debit: 0, credit: a.accumulated, memo: `${a.code} ${a.name} – depreciation to date` });
  }
  // Clear 3900: it holds suppliers' and customers' openings and opening stock.
  if (clearingBalance > 0) lines.push({ account: OPENING_CLEARING, debit: 0, credit: clearingBalance, memo: "Clear opening balances (suppliers, customers, stock)" });
  if (clearingBalance < 0) lines.push({ account: OPENING_CLEARING, debit: -clearingBalance, credit: 0, memo: "Clear opening balances (suppliers, customers, stock)" });
  const diff = lines.reduce((s, l) => s + l.debit - l.credit, 0);
  if (diff > 0) lines.push({ account: RETAINED_EARNINGS, debit: 0, credit: diff, memo: "Profits of earlier years (balancing figure)" });
  if (diff < 0) lines.push({ account: RETAINED_EARNINGS, debit: -diff, credit: 0, memo: "Losses of earlier years (balancing figure)" });
  return { lines, retainedEarnings: diff };
}

/** What the import will do, for the check screen (stock value is estimated at each item's cost). */
export function summarizeImport(data: AccountingImport, items: InventoryItem[]) {
  const stock = openingStockValue(data.openingStock, items);
  const suppliersOwed = data.suppliers.reduce((s, v) => s + v.opening, 0);
  const customersOwe = data.customers.reduce((s, c) => s + c.opening, 0);
  const { retainedEarnings } = openingJournalLines(data, suppliersOwed - customersOwe - stock);
  return {
    stock,
    suppliersOwed,
    customersOwe,
    retainedEarnings,
    openingDebit: data.opening.reduce((s, o) => s + o.debit, 0),
    openingCredit: data.opening.reduce((s, o) => s + o.credit, 0),
    assetsCost: data.assets.reduce((s, a) => s + a.cost, 0),
    assetsDepreciation: data.assets.reduce((s, a) => s + a.accumulated, 0),
    bills: data.bills.reduce((s, b) => s + b.net + b.vat, 0),
    billsPaid: data.bills.filter((b) => b.paidOn).length,
    expenses: data.expenses.reduce((s, e) => s + e.amount, 0),
    sales: data.sales.reduce((s, x) => s + x.cash + x.card + x.bank, 0),
    documents: countSteps(data),
  };
}

function countSteps(d: AccountingImport): number {
  const hasOpening = d.opening.length || d.assets.length || d.suppliers.some((s) => s.opening) || d.customers.some((c) => c.opening) || d.openingStock.length;
  return (
    d.suppliers.filter((s) => s.opening).length +
    d.customers.filter((c) => c.opening).length +
    (d.openingStock.length ? 1 : 0) +
    (hasOpening ? 1 : 0) +
    d.bills.length +
    d.bills.filter((b) => b.paidOn).length +
    d.expenses.length * 2 +
    d.sales.length
  );
}

/** Fiscal-year key (April–March by default) of a date. */
function fyKey(date: string, startMonth: number): string {
  const y = Number(date.slice(0, 4));
  return String(Number(date.slice(5, 7)) >= startMonth ? y : y - 1);
}

export async function importBooks(data: AccountingImport, ctx: BooksImportContext): Promise<BooksImportResult> {
  if (data.errors.length) throw new Error("Fix the problems in the workbook first");
  const { store } = ctx;
  const now = () => (ctx.now ? ctx.now() : new Date()).toISOString();
  const res: BooksImportResult = { posted: [], awaitingApproval: [], skipped: [], failed: [], created: { accounts: 0, suppliers: 0, customers: 0, assets: 0 }, retainedEarnings: 0 };
  const total = countSteps(data);
  let done = 0;
  const tick = (label: string) => ctx.onProgress?.(++done, total, label);
  const base = (id: string, type: Voucher["type"], date: string, remarks: string) => ({
    id,
    type,
    status: "draft" as const,
    postingDate: date,
    currency: "LKR",
    exchangeRateMicros: 1_000_000,
    costCenter: ctx.costCenter,
    propertyId: ctx.propertyId,
    createdBy: ctx.uid,
    createdAt: now(),
    remarks,
  });

  /** Saves a draft (unless it exists) and submits it; returns its status. */
  async function submit<V extends Voucher>(v: V, what: string): Promise<"posted" | "submitted" | "failed"> {
    try {
      const existing = await store.get<Voucher>(L.vouchers, v.id);
      if (existing && existing.status !== "draft") {
        res.skipped.push(`${what} (already in: ${existing.number ?? existing.id})`);
        return existing.status === "posted" ? "posted" : existing.status === "submitted" ? "submitted" : "failed";
      }
      if (!existing) await store.set(L.vouchers, v);
      const r = await ctx.ledger<{ status: "posted" | "submitted"; voucher?: { number?: string } }>({ action: "submit", voucherId: v.id });
      (r.status === "posted" ? res.posted : res.awaitingApproval).push(`${what}${r.voucher?.number ? ` (${r.voucher.number})` : ""}`);
      return r.status;
    } catch (e) {
      res.failed.push({ what, message: (e as Error).message });
      return "failed";
    } finally {
      tick(what);
    }
  }

  // 1. Accounts, suppliers and customers (new ones only: existing records are never overwritten).
  const [vendors, customers, accounts, settings] = await Promise.all([
    store.list<Vendor>(C.vendors),
    store.list<Customer>(C.customers),
    store.list<{ id: string }>(C.accounts),
    store.get<{ id: string; ledger?: { fiscalYearStartMonth?: number } }>(C.settings, "accounting"),
  ]);
  const haveV = new Set(vendors.map((v) => v.id));
  const haveC = new Set(customers.map((c) => c.id));
  const haveA = new Set(accounts.map((a) => a.id));
  const newAccounts = data.accounts.filter((a) => !haveA.has(a.id));
  const newVendors = data.suppliers.filter((v) => !haveV.has(v.id)).map(({ opening: _o, ...v }) => v as Vendor);
  const newCustomers = data.customers.filter((c) => !haveC.has(c.id)).map(({ opening: _o, ...c }) => c as Customer);
  const needSundry = data.expenses.length > 0 && !haveV.has(SUNDRY);
  await store.batch([
    ...newAccounts.map((d) => ({ op: "set" as const, col: C.accounts, data: d })),
    ...newVendors.map((d) => ({ op: "set" as const, col: C.vendors, data: d })),
    ...(needSundry ? [{ op: "set" as const, col: C.vendors, data: { id: SUNDRY, code: SUNDRY, name: "Sundry suppliers (cash purchases)", phone: "", paymentTermsDays: 0, active: true } satisfies Vendor }] : []),
    ...newCustomers.map((d) => ({ op: "set" as const, col: C.customers, data: d })),
  ]);
  res.created = { accounts: newAccounts.length, suppliers: newVendors.length, customers: newCustomers.length, assets: 0 };
  const terms = new Map([...vendors, ...newVendors].map((v) => [v.id, v.paymentTermsDays]));

  // 2. Fiscal years for every date in the file.
  const startMonth = settings?.ledger?.fiscalYearStartMonth ?? 4;
  const dates = [ctx.asAt, ...data.bills.flatMap((b) => [b.date, b.paidOn ?? b.date]), ...data.expenses.map((e) => e.date), ...data.sales.map((s) => s.date)].filter(Boolean);
  const years = new Map<string, string>();
  for (const d of dates) if (!years.has(fyKey(d, startMonth))) years.set(fyKey(d, startMonth), d);
  for (const d of years.values()) await ctx.ledger({ action: "ensureFiscalYear", date: d });

  // 3. Opening stock: an opening count, then the day's stock posting (Dr inventory, Cr 3900).
  if (data.openingStock.length) {
    const id = `OPEN-STOCK-${ctx.asAt}`;
    try {
      const existing = await store.get<StockCount>(C.stockCounts, id);
      if (existing?.status === "posted") res.skipped.push(`Opening stock ${ctx.asAt} (already counted)`);
      else {
        await store.set(C.stockCounts, { id, locationId: ctx.locationId, date: ctx.asAt, status: "draft", kind: "opening", lines: data.openingStock.map((l) => ({ itemId: l.itemId, counted: l.qty })) } satisfies StockCount);
        await postStockCount(store, id);
      }
      const v = await ctx.ledger<{ number?: string } | null>({ action: "postPosDay", propertyId: ctx.propertyId, businessDate: ctx.asAt });
      res.posted.push(`Opening stock ${ctx.asAt}${v?.number ? ` (${v.number})` : ""}`);
    } catch (e) {
      const msg = (e as Error).message;
      res.failed.push({ what: `Opening stock ${ctx.asAt}`, message: /permission/i.test(msg) ? "your login can't change stock: an owner, administrator or storekeeper counts the opening stock (Inventory → Stock counts, type Opening stock)" : msg });
    }
    tick("Opening stock");
  }

  // 4. What suppliers were owed and customers owed on the start date, as open invoices.
  for (const s of data.suppliers.filter((x) => x.opening > 0)) {
    const pi: PurchaseInvoice = {
      ...base(`OPEN-PI-${slug(s.id)}`, "purchaseInvoice", ctx.asAt, `Opening balance – ${s.name}`),
      type: "purchaseInvoice",
      supplierId: s.id,
      supplierInvoiceNo: `OPENING-${ctx.asAt}`,
      supplierInvoiceDate: ctx.asAt,
      dueDate: addDays(ctx.asAt, terms.get(s.id) ?? s.paymentTermsDays),
      grnIds: [],
      items: [{ description: "Owed on the start date (opening balance)", account: OPENING_CLEARING, qty: 1, rate: s.opening }],
      vatAmount: 0,
      whtAmount: 0,
    };
    await submit(pi, `Opening balance – ${s.name}`);
  }
  for (const c of data.customers.filter((x) => x.opening > 0)) {
    const si: SalesInvoice = {
      ...base(`OPEN-SI-${slug(c.id)}`, "salesInvoice", ctx.asAt, `Opening balance – ${c.name}`),
      type: "salesInvoice",
      customerId: c.id,
      dueDate: addDays(ctx.asAt, 30),
      items: [{ description: "Owed on the start date (opening balance)", account: OPENING_CLEARING, qty: 1, rate: c.opening }],
      vatRateBp: 0,
    };
    await submit(si, `Opening balance – ${c.name}`);
  }

  // 5. Fixed assets register: depreciation continues from the start date.
  const lastDepPeriod = addMonths(ctx.asAt.slice(0, 7), -1);
  const assetIds = new Set((await store.list<Asset>(L.assets)).map((a) => a.id));
  const newAssets = data.assets.filter((a) => !assetIds.has(slug(a.code)));
  if (newAssets.length) {
    await store.batch(
      newAssets.map((a) => ({
        op: "set" as const,
        col: L.assets,
        data: {
          id: slug(a.code),
          code: a.code,
          name: a.name,
          category: a.category,
          assetAccount: a.assetAccount,
          accumulatedDepAccount: a.accumulatedDepAccount,
          depExpenseAccount: "6600",
          costCenter: ctx.costCenter,
          propertyId: ctx.propertyId,
          purchaseDate: a.purchaseDate,
          availableDate: a.purchaseDate,
          cost: a.cost,
          salvageValue: a.salvage,
          method: "SL",
          usefulLifeMonths: a.lifeMonths,
          status: "active",
          accumulatedDep: a.accumulated,
          ...(a.purchaseDate < ctx.asAt ? { lastDepPeriod } : {}),
        } satisfies Asset,
      })),
    );
  }
  res.created.assets = newAssets.length;

  // 6. The opening journal: balances on the start date, assets, and 3900 cleared.
  const hasOpening = data.opening.length || data.assets.length || data.suppliers.some((s) => s.opening) || data.customers.some((c) => c.opening) || data.openingStock.length;
  if (hasOpening) {
    const id = `OPEN-${ctx.asAt}`;
    const existing = await store.get<Voucher>(L.vouchers, id);
    if (existing && existing.status !== "draft") {
      res.skipped.push(`Opening balances ${ctx.asAt} (already in: ${existing.number ?? id}; reverse it to change them)`);
      tick("Opening balances");
    } else {
      const balances = await store.list<AccountBalance>(L.balances, { where: [["account", "==", OPENING_CLEARING]] });
      const clearing = balances.reduce((s, b) => s + b.debit - b.credit, 0);
      const { lines, retainedEarnings } = openingJournalLines(data, clearing);
      res.retainedEarnings = retainedEarnings;
      if (lines.length >= 2) {
        const jv: JournalVoucher & { opening: true } = { ...base(id, "journal", ctx.asAt, `Opening balances on ${ctx.asAt}`), type: "journal", opening: true, lines };
        // A draft left by an interrupted import is replaced with today's figures.
        await store.set(L.vouchers, jv);
        await submit(jv, `Opening balances ${ctx.asAt}`);
      } else tick("Opening balances");
    }
  }

  // 7. Supplier bills, and their payments.
  for (const b of data.bills) {
    const id = `IMP-PI-${slug(b.supplierId)}-${slug(b.billNo)}`;
    const remarks = `${b.description || "Supplier bill"} – bill ${b.billNo}`;
    const status = await submit(
      {
        ...base(id, "purchaseInvoice", b.date, remarks),
        type: "purchaseInvoice",
        supplierId: b.supplierId,
        supplierInvoiceNo: b.billNo,
        supplierInvoiceDate: b.date,
        dueDate: b.paidOn ?? addDays(b.date, terms.get(b.supplierId) ?? 30),
        grnIds: [],
        items: [{ description: b.description || "Supplier bill", account: b.account, qty: 1, rate: b.net }],
        vatAmount: b.vat,
        whtAmount: 0,
      } satisfies PurchaseInvoice,
      `Bill ${b.billNo}`,
    );
    if (!b.paidOn) continue;
    if (status !== "posted") {
      res.failed.push({ what: `Payment of bill ${b.billNo}`, message: "the bill is not posted yet; pay it from Finance → Payments once it is" });
      tick(`Payment of bill ${b.billNo}`);
      continue;
    }
    await submit(
      {
        ...base(`${id}-PAY`, "payment", b.paidOn, `Paid: ${remarks}`),
        type: "payment",
        direction: "pay",
        partyType: "supplier",
        partyId: b.supplierId,
        bankAccount: PAID_FROM_ACCOUNTS[b.paidFrom ?? "Cash"] ?? "1000",
        amount: b.net + b.vat,
        allocations: [{ voucherId: id, amount: b.net + b.vat }],
        bankCharges: 0,
        ...(b.ref ? { reference: b.ref } : {}),
      } satisfies PaymentVoucher,
      `Payment of bill ${b.billNo}`,
    );
  }

  // 8. Expenses already paid: a bill from "Sundry suppliers" and its payment.
  const expenseIds = occurrenceIds(data.expenses, (e) => `${e.date}|${e.description}|${e.account}|${e.amount}`, "");
  data.expenses.forEach((e, i) => (expenseIds[i] = `IMP-EXP-${e.date}-${hash(`${e.description}|${e.account}|${e.amount}`)}${expenseIds[i]}`));
  for (const [i, e] of data.expenses.entries()) {
    const id = expenseIds[i]!;
    const status = await submit(
      {
        ...base(id, "purchaseInvoice", e.date, e.description),
        type: "purchaseInvoice",
        supplierId: SUNDRY,
        supplierInvoiceNo: `NO-BILL-${id.slice(8)}`,
        supplierInvoiceDate: e.date,
        dueDate: e.date,
        grnIds: [],
        items: [{ description: e.description, account: e.account, qty: 1, rate: e.amount }],
        vatAmount: 0,
        whtAmount: 0,
      } satisfies PurchaseInvoice,
      `Expense ${e.date} ${e.description}`,
    );
    if (status !== "posted") {
      tick(`Payment of ${e.description}`);
      continue;
    }
    await submit(
      {
        ...base(`${id}-PAY`, "payment", e.date, `Paid: ${e.description}`),
        type: "payment",
        direction: "pay",
        partyType: "supplier",
        partyId: SUNDRY,
        bankAccount: PAID_FROM_ACCOUNTS[e.paidFrom] ?? "1000",
        amount: e.amount,
        allocations: [{ voucherId: id, amount: e.amount }],
        bankCharges: 0,
      } satisfies PaymentVoucher,
      `Payment of ${e.description}`,
    );
  }

  // 9. Daily sales from manual bills (the same entry as Finance → Daily sales).
  const acc = ctx.accounting;
  const salesIds = occurrenceIds(data.sales, (s) => s.date, "");
  for (const [i, s] of data.sales.entries()) {
    const line = (account: string, debit: number, credit: number, memo: string): LineInput[] => (debit || credit ? [{ account, debit, credit, memo }] : []);
    const jv: JournalVoucher & { source: string } = {
      ...base(`IMP-SALES-${s.date}${salesIds[i]}`, "journal", s.date, `Sales from manual bills ${s.date}${s.bills ? ` (bills ${s.bills})` : ""}`),
      type: "journal",
      source: "manualSales",
      lines: [
        ...line("1000", s.cash, 0, "Cash received"),
        ...line("1020", s.card, 0, "Card payments"),
        ...line("1010", s.bank, 0, "Bank transfers / LankaQR"),
        ...line(acc.discounts, s.discount, 0, "Discounts given"),
        ...line(acc.salesByMajorGroup.Food ?? "4000", 0, s.food, "Food sales"),
        ...line(acc.salesByMajorGroup.Beverage ?? "4010", 0, s.beverage, "Beverage sales"),
        ...line(acc.salesByMajorGroup.Other ?? "4020", 0, s.other, "Other sales"),
        ...line(acc.serviceCharge, 0, s.sc, "Service charge"),
        ...(ctx.vatRegistered ? line(acc.vatOutput, 0, s.vat, "VAT output") : []),
        ...(ctx.ssclRegistered ? line(acc.ssclPayable, 0, s.sscl, "SSCL") : []),
      ],
    };
    await submit(jv, `Sales ${s.date}`);
  }
  return res;
}

/** Stock value the opening count actually posted (from its movements). */
export async function postedOpeningStockValue(store: DocStore, date: string): Promise<number> {
  const moves = await store.list<StockMovement>(C.stockMovements, { where: [["businessDate", "==", date]] });
  return moves.filter((m) => m.type === "opening").reduce((s, m) => s + m.lines.reduce((a, l) => a + l.cost, 0), 0);
}
