import { type AccountingSettings, type DailyStats, type GoodsReceipt, type InventoryItem, type PurchaseOrder, type TenderMedia, COLLECTIONS as C, MemoryStore, emptyDailyStats } from "@pos/core";
import {
  type Actor,
  type JournalVoucher,
  type LedgerSettings,
  LEDGER as L,
  buildFiscalYear,
  defaultChartOfAccounts,
  defaultCostCenters,
  defaultLedgerSettings,
  storeRunner,
} from "../src/index.js";

export const alice: Actor = { uid: "alice", name: "Alice (accountant)", role: "accountant" };
export const bob: Actor = { uid: "bob", name: "Bob (finance manager)", role: "owner" };
export const NOW = "2026-11-03T10:00:00.000Z";

export const coreAccounting: AccountingSettings = {
  id: "accounting",
  accounts: {
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
    stockReceivedNotBilled: "2010",
  },
};

export async function ledgerStore(settings: Partial<LedgerSettings> = {}) {
  const store = new MemoryStore();
  const ledger = { ...defaultLedgerSettings("CMB"), ...settings };
  const items: InventoryItem[] = [
    { id: "RICE", code: "RICE", name: "Rice", category: "Grains", majorGroup: "Food", stockUnit: "g", purchaseUnit: "kg", purchaseFactor: 1000, purchaseCost: 28_000, parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, active: true },
    { id: "OIL", code: "OIL", name: "Oil", category: "Oils", majorGroup: "Food", stockUnit: "ml", purchaseUnit: "litre", purchaseFactor: 1000, purchaseCost: 75_000, parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, active: true },
  ];
  const po: PurchaseOrder = { id: "PO-1", number: "PO-1", vendorId: "V1", locationId: "MAIN", status: "received", orderDate: "2026-11-01", lines: [{ inventoryItemId: "RICE", qty: 50, unitCost: 28_000 }, { inventoryItemId: "OIL", qty: 10, unitCost: 75_000 }] };
  const grn: GoodsReceipt = { id: "GRN-1", number: "GRN-1", vendorId: "V1", locationId: "MAIN", purchaseOrderId: "PO-1", date: "2026-11-02", lines: [{ inventoryItemId: "RICE", qty: 50, unitCost: 28_000 }, { inventoryItemId: "OIL", qty: 10, unitCost: 75_000 }], inputVat: 0, status: "posted" };
  const tenders: TenderMedia[] = [
    { id: "CASH", name: "Cash", type: "cash", allowChange: true, requiresReference: false, opensDrawer: true, accountCode: "1000", sortOrder: 1, active: true },
    { id: "CARD", name: "Card", type: "card", allowChange: false, requiresReference: true, opensDrawer: false, accountCode: "1020", sortOrder: 2, active: true },
  ];
  await store.batch([
    { op: "set", col: C.settings, data: { ...coreAccounting, ledger } as { id: string } },
    { op: "set", col: C.settings, data: { id: "pos", defaultPropertyId: "CMB" } as { id: string } },
    ...defaultChartOfAccounts().map((data) => ({ op: "set" as const, col: C.accounts, data })),
    ...defaultCostCenters([{ id: "CMB", name: "Colombo" }]).map((data) => ({ op: "set" as const, col: L.costCenters, data })),
    { op: "set", col: L.fiscalYears, data: buildFiscalYear(2026, 4) },
    ...items.map((data) => ({ op: "set" as const, col: C.inventoryItems, data })),
    { op: "set", col: C.purchaseOrders, data: po },
    { op: "set", col: C.goodsReceipts, data: grn },
    ...tenders.map((data) => ({ op: "set" as const, col: C.tenderMedia, data })),
  ]);
  return { store, runner: storeRunner(store), ledger };
}

export function journal(id: string, lines: JournalVoucher["lines"], extra: Partial<JournalVoucher> = {}): JournalVoucher {
  return { id, type: "journal", status: "draft", postingDate: "2026-11-03", remarks: "test", currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: "CMB", createdBy: "alice", createdAt: NOW, lines, ...extra };
}

export function dayStats(netFood: number, cash: number): DailyStats {
  const s = emptyDailyStats("CMB", "2026-11-03");
  const sc = Math.round(netFood * 0.1);
  const vat = Math.round((netFood + sc) * 0.18);
  return {
    ...s,
    checks: 2,
    covers: 4,
    itemsTotal: netFood,
    netSales: netFood,
    serviceCharge: sc,
    vat,
    total: netFood + sc + vat,
    majorGroups: { Food: { qty: 3, amount: netFood, gross: netFood } },
    tenders: { CASH: { qty: 1, amount: cash }, CARD: { qty: 1, amount: netFood + sc + vat - cash } },
  };
}
