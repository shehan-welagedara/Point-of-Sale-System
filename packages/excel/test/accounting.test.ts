import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { type Account, type AccountingSettings, type InventoryItem, type StockLevel, type Vendor, COLLECTIONS as C, MemoryStore } from "@pos/core";
import {
  type AccountBalance,
  type Actor,
  type Asset,
  type LedgerRequest,
  type LedgerSettings,
  type Voucher,
  LEDGER as L,
  defaultChartOfAccounts,
  defaultCostCenters,
  defaultLedgerSettings,
  depreciationFor,
  runLedgerRequest,
  storeRunner,
} from "@pos/ledger";
import { ACCOUNTING_SHEETS, buildAccountingWorkbook, importBooks, parseAccountingWorkbook, summarizeImport } from "../src/index.js";

const ASAT = "2026-04-01";
const owner: Actor = { uid: "owner", name: "Owner", role: "owner" };
const accounts: AccountingSettings["accounts"] = {
  salesByMajorGroup: { Food: "4000", Beverage: "4010", Other: "4020" },
  serviceCharge: "4300",
  vatOutput: "2100",
  vatInput: "1300",
  ssclPayable: "2120",
  tdlPayable: "2130",
  discounts: "4900",
  rounding: "4950",
  inventory: "1200",
  cogsByMajorGroup: { Food: "5000", Beverage: "5010", Other: "5020" },
  wastage: "5100",
  stockAdjustment: "5110",
  accountsPayable: "2000",
  complimentary: "5200",
};
const items: InventoryItem[] = [
  { id: "RICE", code: "RICE", name: "Samba rice", category: "Grains", majorGroup: "Food", stockUnit: "g", purchaseUnit: "kg", purchaseFactor: 1000, purchaseCost: 28_000, parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, active: true },
  { id: "OIL", code: "OIL", name: "Coconut oil", category: "Oils", majorGroup: "Food", stockUnit: "ml", purchaseUnit: "litre", purchaseFactor: 1000, purchaseCost: 75_000, parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, active: true },
];

async function books(ledger: Partial<LedgerSettings> = {}) {
  const store = new MemoryStore();
  await store.batch([
    { op: "set", col: C.settings, data: { id: "accounting", accounts, ledger: { ...defaultLedgerSettings("MAIN"), ...ledger } } as { id: string } },
    { op: "set", col: C.settings, data: { id: "pos", defaultPropertyId: "MAIN" } as { id: string } },
    ...defaultChartOfAccounts().map((data) => ({ op: "set" as const, col: C.accounts, data })),
    ...defaultCostCenters([{ id: "MAIN", name: "Main" }]).map((data) => ({ op: "set" as const, col: L.costCenters, data })),
    ...items.map((data) => ({ op: "set" as const, col: C.inventoryItems, data })),
    { op: "set", col: C.locations, data: { id: "MAIN", name: "Main store", isDefault: true } as { id: string } },
  ]);
  const ledgerCall = async <T,>(req: LedgerRequest) => (await runLedgerRequest({ runner: storeRunner(store), store, now: () => new Date("2026-11-08T10:00:00Z"), sealDelayMs: 0 }, owner, req)) as T;
  return { store, ledgerCall };
}

async function parse(store: MemoryStore, buf: ArrayBuffer, extra: { allowSample?: boolean } = {}) {
  return parseAccountingWorkbook(buf, {
    chart: await store.list<Account>(C.accounts),
    vendors: await store.list<Vendor>(C.vendors),
    customers: [],
    items,
    vatRegistered: false,
    ssclRegistered: false,
    asAt: ASAT,
    ...extra,
  });
}

const balance = async (store: MemoryStore, account: string) => (await store.list<AccountBalance>(L.balances, { where: [["account", "==", account]] })).reduce((s, b) => s + b.debit - b.credit, 0);

describe("accounting workbook", () => {
  it("the example copy is complete, refused as it stands, and imports cleanly into a test business", async () => {
    const { store, ledgerCall } = await books({ journalApprovalThreshold: 100_000_000_00 });
    const buf = await buildAccountingWorkbook({ chart: await store.list<Account>(C.accounts), items, asAt: ASAT, sample: true, businessName: "Test Kitchen" });

    // Every sheet has rows, and the example is refused unless allowed (training copies).
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    for (const name of Object.values(ACCOUNTING_SHEETS)) expect(wb.getWorksheet(name)!.rowCount, name).toBeGreaterThan(1);
    const refused = await parse(store, buf);
    expect(refused.isSample).toBe(true);
    expect(refused.errors.map((e) => e.message).join()).toMatch(/still the example data/);

    const data = await parse(store, buf, { allowSample: true });
    expect(data.errors).toEqual([]);
    expect(data.suppliers).toHaveLength(4);
    expect(data.openingStock.map((l) => l.itemId)).toEqual(["RICE", "OIL"]);
    const summary = summarizeImport(data, items);
    expect(summary.suppliersOwed).toBe(60_500_00);
    expect(summary.stock).toBe(5 * 28_000 + 5 * 75_000);

    const res = await importBooks(data, { store, ledger: ledgerCall, uid: "owner", asAt: ASAT, costCenter: "MAIN", propertyId: "MAIN", locationId: "MAIN", accounting: accounts, vatRegistered: false, ssclRegistered: false });
    expect(res.failed).toEqual([]);
    // The rent payment is over the payment approval limit: it waits for a second person.
    expect(res.awaitingApproval).toEqual([expect.stringContaining("Payment of bill RENT-APR")]);
    expect(res.created).toMatchObject({ accounts: 3, suppliers: 4, customers: 1, assets: 2 });

    // 3900 is cleared; the leftover went to retained earnings; the books balance.
    expect(await balance(store, "3900")).toBe(0);
    expect(res.retainedEarnings).toBe(-(await balance(store, "3100")));
    const all = await store.list<AccountBalance>(L.balances);
    expect(all.reduce((s, b) => s + b.debit - b.credit, 0)).toBe(0);
    expect(await balance(store, "1000")).toBe(25_000_00 - 14_250_00 + 74_100_00 + 90_850_00); // opening cash − veg bill + two days' cash sales
    expect(await balance(store, "1001")).toBe(-3_450_00); // cleaning supplies from petty cash (no opening float in the example)
    expect(await balance(store, "2000")).toBe(-(60_500_00 + 52_000_00 + 150_000_00)); // openings + unpaid chicken + rent until its payment is approved
    expect(await balance(store, "1100")).toBe(42_000_00);
    expect(await balance(store, "1200")).toBe(5 * 28_000 + 5 * 75_000);
    expect(await balance(store, "1500")).toBe(600_000_00);
    expect(await balance(store, "1591")).toBe(-62_500_00);
    expect((await store.get<StockLevel>(C.stockLevels, "MAIN__RICE"))?.qty).toBe(5000);

    // Depreciation continues from the start date at the normal monthly rate.
    const oven = (await store.get<Asset>(L.assets, "FA-001"))!;
    expect(oven.lastDepPeriod).toBe("2026-03");
    expect(depreciationFor(oven, "2026-04")).toBe(6_250_00);

    // Importing the same file again adds nothing.
    const vouchers = (await store.list<Voucher>(L.vouchers)).length;
    const again = await importBooks(await parse(store, buf, { allowSample: true }), { store, ledger: ledgerCall, uid: "owner", asAt: ASAT, costCenter: "MAIN", propertyId: "MAIN", locationId: "MAIN", accounting: accounts, vatRegistered: false, ssclRegistered: false });
    expect(again.posted.filter((p) => !p.startsWith("Opening stock"))).toEqual([]);
    expect(again.failed).toEqual([]);
    expect((await store.list<Voucher>(L.vouchers)).length).toBe(vouchers);
    expect(await balance(store, "3900")).toBe(0);
  });

  it("explains each problem with its sheet and row, before anything is saved", async () => {
    const { store } = await books();
    const blank = await buildAccountingWorkbook({ chart: await store.list<Account>(C.accounts), asAt: ASAT, sample: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(blank);
    // Typed into the first empty rows, as a person would.
    const put = (sheet: string, row: number, values: unknown[]) => values.forEach((v, i) => (wb.getWorksheet(sheet)!.getCell(row, i + 1).value = v as ExcelJS.CellValue));
    put(ACCOUNTING_SHEETS.opening, 2, ["1100", "Debtors", 5000, "", ""]);
    put(ACCOUNTING_SHEETS.opening, 3, ["9999", "Nowhere", 100, "", ""]);
    put(ACCOUNTING_SHEETS.bills, 2, ["2026-04-02", "NOBODY", "B1", "Veg", "5000", 1000, "", "2026-04-02", "Wallet"]);
    put(ACCOUNTING_SHEETS.sales, 2, ["2026-04-02", "", 1000, 0, 0, 0, 0, 0, 0, 900]);
    put(ACCOUNTING_SHEETS.expenses, 2, ["03/04/2026", "Gas", "6100", "abc", "Cash"]);
    const res = await parse(store, (await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const msgs = res.errors.map((e) => `${e.sheet}:${e.row} ${e.message}`);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Opening balances:2 .*own sheets/),
        expect.stringMatching(/^Opening balances:3 account 9999 is not in the chart/),
        expect.stringMatching(/^Supplier bills:2 supplier NOBODY/),
        expect.stringMatching(/^Supplier bills:2 Paid from must be/),
        expect.stringMatching(/^Daily sales:2 sales \(1000.00\) and money received \(900.00\) differ by 100.00/),
        expect.stringMatching(/^Expenses:2 Date: "03\/04\/2026" is not a date/),
        expect.stringMatching(/^Expenses:2 Amount: "abc" is not an amount/),
      ]),
    );
    expect(msgs.filter((m) => m.startsWith("Expenses:2"))).toHaveLength(2);
    expect(res.isSample).toBe(false);
  });
});
