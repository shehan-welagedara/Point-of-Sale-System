import {
  type AccountingSettings,
  type BusinessSettings,
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type PosContext,
  type PosSettings,
  type Recipe,
  type TaxSettings,
  type TenderMedia,
  COLLECTIONS as C,
  MemoryStore,
} from "../src/index.js";

export const business: BusinessSettings = {
  id: "business",
  legalName: "Sample Restaurant (Pvt) Ltd",
  tradingName: "Sample",
  tin: "100000000",
  vatRegistered: true,
  ssclLiable: false,
  addressLines: ["1 Galle Road", "Colombo 03"],
  phone: "0110000000",
  email: "demo@example.lk",
};

export const tax: TaxSettings = {
  id: "tax",
  pricing: "exclusive",
  serviceChargeRate: 1000,
  serviceChargeOrderTypes: ["dine-in"],
  vatRate: 1800,
  ssclRate: 250,
  tdlRate: 0,
  billRoundingUnit: 0,
  invoiceSequenceReset: "monthly",
};

export const pos: PosSettings = {
  id: "pos",
  businessDayRolloverHour: 4,
  requireCoversForDineIn: true,
  autoPrintBillOnClose: true,
  printKotOnSend: true,
  loyaltyPointsPer100: 1,
  defaultPropertyId: "P1",
};

export const tenders: TenderMedia[] = [
  { id: "CASH", name: "Cash", type: "cash", allowChange: true, requiresReference: false, opensDrawer: true, accountCode: "1000", sortOrder: 1, active: true },
  { id: "CARD", name: "Card", type: "card", allowChange: false, requiresReference: true, opensDrawer: false, accountCode: "1020", sortOrder: 2, active: true },
];

export const categories: MenuCategory[] = [
  { id: "KOTTU", name: "Kottu", majorGroup: "Food", color: "#c55", sortOrder: 1, active: true },
  { id: "DRINKS", name: "Drinks", majorGroup: "Beverage", color: "#5c5", sortOrder: 2, active: true },
];

export const menuItems: MenuItem[] = [
  { id: "K001", code: "K001", name: "Chicken Kottu", categoryId: "KOTTU", price: 120_000, taxClass: "standard", kotRoute: "kitchen", modifierGroupIds: [], allergens: ["gluten", "egg"], available: true, active: true, sortOrder: 1 },
  { id: "J001", code: "J001", name: "Lime Juice", categoryId: "DRINKS", price: 45_000, taxClass: "standard", kotRoute: "bar", modifierGroupIds: [], allergens: [], available: true, active: true, sortOrder: 2 },
];

const item = (id: string, name: string, stockUnit: InventoryItem["stockUnit"], purchaseUnit: string, purchaseFactor: number, purchaseCost: number, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  id,
  code: id,
  name,
  category: "General",
  majorGroup: "Food",
  stockUnit,
  purchaseUnit,
  purchaseFactor,
  purchaseCost,
  parLevel: 0,
  reorderQty: 0,
  isPrep: false,
  trackStock: true,
  active: true,
  ...extra,
});

export const inventoryItems: InventoryItem[] = [
  item("CHICKEN", "Chicken", "g", "kg", 1000, 160_000, { parLevel: 5, reorderQty: 10 }),
  item("ROTI", "Godamba roti", "pcs", "pcs", 1, 6_000),
  item("EGG", "Egg", "pcs", "tray 30", 30, 135_000),
  item("ONION", "Onion", "g", "kg", 1000, 38_000),
  item("LIME", "Lime", "g", "kg", 1000, 90_000, { majorGroup: "Beverage" }),
  item("SUGAR", "Sugar", "g", "kg", 1000, 30_000, { majorGroup: "Beverage" }),
  item("CURRY", "Chicken curry (prep)", "g", "g", 1, 0, { isPrep: true, trackStock: false }),
];

export const recipes: Recipe[] = [
  // Prep: 1,000 g chicken + 200 g onion → 1,000 g curry
  { id: "CURRY", kind: "prep", yieldQty: 1000, lines: [{ inventoryItemId: "CHICKEN", qty: 1000 }, { inventoryItemId: "ONION", qty: 200 }] },
  { id: "K001", kind: "menu", yieldQty: 1, lines: [{ inventoryItemId: "ROTI", qty: 2 }, { inventoryItemId: "CURRY", qty: 150 }, { inventoryItemId: "EGG", qty: 1 }] },
  { id: "J001", kind: "menu", yieldQty: 1, lines: [{ inventoryItemId: "LIME", qty: 40 }, { inventoryItemId: "SUGAR", qty: 30 }] },
];

export const accounting: AccountingSettings = {
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
  },
};

export function posContext(over: Partial<PosContext> = {}): PosContext {
  return {
    tax,
    business,
    pos,
    discounts: new Map([["STAFF10", { id: "STAFF10", name: "Staff 10%", type: "percent", value: 1000, scope: "check", requiresManager: false, active: true }]]),
    tenders: new Map(tenders.map((t) => [t.id, t])),
    categories: new Map(categories.map((c) => [c.id, c])),
    inventoryOn: true,
    crmOn: true,
    loyaltyOn: true,
    ...over,
  };
}

export async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.batch([
    ...inventoryItems.map((data) => ({ op: "set" as const, col: C.inventoryItems, data })),
    ...recipes.map((data) => ({ op: "set" as const, col: C.recipes, data })),
    ...menuItems.map((data) => ({ op: "set" as const, col: C.menuItems, data })),
    ...categories.map((data) => ({ op: "set" as const, col: C.menuCategories, data })),
  ]);
  return store;
}
