import {
  type AccountingSettings,
  type ModuleKey,
  type BrandingSettings,
  type BusinessSettings,
  type Check,
  type CheckLine,
  type Customer,
  type GoodsReceipt,
  type IntegrationSettings,
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type PosContext,
  type PosSettings,
  type Recipe,
  type TaxSettings,
  type TenderMedia,
  type Tenant,
  type WriteOp,
  COLLECTIONS as C,
  DEFAULT_ROLES,
  builtInEntitlements,
  MemoryStore,
  addDays,
  allModulesOn,
  closeCheck,
  computeCheckTotals,
  costMenuItem,
  costingContext,
  hashPin,
  makePayment,
  postGoodsReceipt,
  processDepletion,
  sendRound,
  DEFAULT_POWERED_BY,
} from "@pos/core";
import { defaultChartOfAccounts, defaultLedgerSettings } from "@pos/ledger";
import { CATEGORIES, CUSTOMERS, INVENTORY, MENU, MODIFIER_GROUPS, PREP, RECIPES, STAFF, VENDORS } from "./catalog.js";
import { NOURA_FINANCE, seedFinance } from "./finance.js";

export * from "./catalog.js";
export * from "./finance.js";
export * from "./starter.js";
export * from "./wholesale.js";
import { buildWholesaleSample, teesSettings } from "./wholesale.js";

export const SAMPLE_PROPERTY_ID = "CMB";
export const SAMPLE_LOCATION_ID = "MAIN";

const lkr = (rupees: number) => Math.round(rupees * 100);

/** Inventory key → code (I001…, prep items P001…). */
export const INVENTORY_CODES: ReadonlyMap<string, string> = new Map([
  ...INVENTORY.map(([key], i): [string, string] => [key, `I${String(i + 1).padStart(3, "0")}`]),
  ...PREP.map(([key], i): [string, string] => [key, `P${String(i + 1).padStart(3, "0")}`]),
]);

function code(key: string): string {
  const c = INVENTORY_CODES.get(key);
  if (!c) throw new Error(`unknown inventory key ${key}`);
  return c;
}

export function sampleSettings(): {
  business: BusinessSettings;
  branding: BrandingSettings;
  tax: TaxSettings;
  pos: PosSettings;
  accounting: AccountingSettings;
  integrations: IntegrationSettings;
} {
  return {
    business: {
      id: "business",
      legalName: "Spice Lagoon Restaurants (Pvt) Ltd",
      tradingName: "Spice Lagoon",
      tin: "100000000",
      vatRegistered: true,
      ssclLiable: false,
      addressLines: ["No. 25, Galle Road", "Colombo 03"],
      phone: "011 200 0000",
      email: "hello@spicelagoon.example",
      website: "spicelagoon.example",
      isSample: true,
    },
    branding: {
      id: "branding",
      displayName: "Spice Lagoon",
      primaryColor: "#0F766E",
      accentColor: "#C2410C",
      receiptHeaderLines: ["Authentic Sri Lankan Kitchen"],
      receiptFooterLines: ["Thank you for dining with us!", "Rate us: scan the QR below"],
      poweredBy: DEFAULT_POWERED_BY,
    },
    tax: {
      id: "tax",
      pricing: "exclusive",
      serviceChargeRate: 1000,
      serviceChargeOrderTypes: ["dine-in"],
      vatRate: 1800,
      ssclRate: 250,
      tdlRate: 0,
      billRoundingUnit: 0,
      invoiceSequenceReset: "monthly",
    },
    pos: {
      id: "pos",
      businessDayRolloverHour: 4,
      requireCoversForDineIn: true,
      autoPrintBillOnClose: true,
      printKotOnSend: true,
      loyaltyPointsPer100: 1,
      defaultPropertyId: SAMPLE_PROPERTY_ID,
      signInMode: "idPin",
      maxFailedSignIns: 5,
      autoSignOutSeconds: 300,
      requireClockIn: false,
      pinMinLength: 4,
      theme: { template: "modern", colors: {}, fontScale: 1, buttonSize: "regular", radius: 14, checkSide: "right", categoryStyle: "tabs", columns: 0, showImages: true, colorByCategory: true },
      mobile: { style: "bright", useOn: "all", showSalesOnHome: true },
    },
    accounting: {
      id: "accounting",
      accounts: {
        salesByMajorGroup: { Food: "4000", Beverage: "4010", Liquor: "4010", Other: "4020" },
        serviceCharge: "4300",
        vatOutput: "2100",
        vatInput: "1300",
        ssclPayable: "2120",
        tdlPayable: "2130",
        discounts: "4900",
        rounding: "4950",
        inventory: "1200",
        cogsByMajorGroup: { Food: "5000", Beverage: "5010", Liquor: "5010", Other: "5020" },
        wastage: "5100",
        stockAdjustment: "5110",
        accountsPayable: "2000",
        complimentary: "5200",
        stockReceivedNotBilled: "2010",
      },
      ledger: defaultLedgerSettings(SAMPLE_PROPERTY_ID),
    } as AccountingSettings,
    integrations: {
      id: "integrations",
      payhere: { mode: "mock", merchantId: "1200000 (sample)", currency: "LKR" },
      lankaqr: { mode: "mock", merchantName: "SPICE LAGOON", merchantCity: "COLOMBO", merchantId: "SAMPLE-MID-0001", mcc: "5812" },
      whatsapp: { mode: "mock", phoneNumberId: "", eodRecipients: [{ name: "Owner (sample)", phone: "+94 77 000 0001" }, { name: "Manager (sample)", phone: "+94 77 000 0002" }], eodTime: "23:30" },
      accountingExport: { target: "excel" },
    },
  };
}

export function sampleTenders(): TenderMedia[] {
  const t = (id: string, name: string, type: TenderMedia["type"], accountCode: string, sortOrder: number, extra: Partial<TenderMedia> = {}): TenderMedia => ({
    id,
    name,
    type,
    allowChange: type === "cash" || type === "foreignCash",
    requiresReference: type === "card" || type === "lankaqr" || type === "payhere",
    opensDrawer: type === "cash" || type === "foreignCash",
    accountCode,
    sortOrder,
    active: true,
    ...extra,
  });
  return [
    t("CASH", "Cash", "cash", "1000", 1),
    t("CARD-VM", "Visa / Mastercard", "card", "1020", 2),
    t("CARD-AMEX", "Amex", "card", "1020", 3),
    t("LANKAQR", "LankaQR", "lankaqr", "1030", 4),
    t("PAYHERE", "PayHere", "payhere", "1040", 5),
    t("USD", "US Dollars", "foreignCash", "1050", 6, { currency: "USD", exchangeRateMicros: 300_000_000 }),
    t("GIFT", "Gift voucher", "voucher", "2200", 7, { requiresReference: true }),
    t("HOUSE", "House account", "house", "1100", 8, { requiresReference: true }),
    t("COMP", "Complimentary", "comp", "5200", 9),
  ];
}

/** Deterministic PRNG so the demo data is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The demo businesses: the full Spice Lagoon restaurant, or a small one set up like Noura Kitchen. */
export type SampleKind = "spice-lagoon" | "noura-kitchen" | "colombo-tees";

export interface SampleOptions {
  /** Business date treated as "today" (YYYY-MM-DD). */
  today: string;
  historyDays?: number;
  checksPerDay?: number;
  /** Which demo business (default Spice Lagoon). */
  kind?: SampleKind;
}

export const NOURA_PROPERTY_ID = "MAIN";

/**
 * Noura Kitchen's demo: the same Sri Lankan menu, recipes and stock as Spice Lagoon, set up the way
 * Noura Kitchen runs: not VAT or SSCL registered (standard bills), one outlet with a restaurant and a
 * takeaway counter, one counter phone printing kitchen tickets and bills to a Bluetooth printer
 * (Xprinter XP-T80Q), an office PC that shows bills on screen for exploring, and smaller books.
 */
export function nouraSettings(): ReturnType<typeof sampleSettings> {
  const s = sampleSettings();
  return {
    ...s,
    business: { ...s.business, legalName: "Noura Kitchen", tradingName: "Noura Kitchen", tin: "", vatRegistered: false, ssclLiable: false, addressLines: ["Demo address (replace under Business & tax)", "Sri Lanka"], phone: "", email: "", website: "", isSample: true },
    branding: { ...s.branding, displayName: "Noura Kitchen", receiptHeaderLines: [], receiptFooterLines: ["Thank you! Please come again."], poweredBy: DEFAULT_POWERED_BY },
    pos: { ...s.pos, defaultPropertyId: NOURA_PROPERTY_ID, mobile: { style: "bright", useOn: "all", showSalesOnHome: true } },
    accounting: { ...s.accounting, ledger: defaultLedgerSettings(NOURA_PROPERTY_ID) } as AccountingSettings,
    integrations: {
      ...s.integrations,
      lankaqr: { ...s.integrations.lankaqr, merchantName: "NOURA KITCHEN", merchantId: "SAMPLE-MID-NK01" },
      whatsapp: { ...s.integrations.whatsapp, eodRecipients: [{ name: "Owner (sample)", phone: "+94 77 000 0001" }] },
    },
  };
}

/** Modules Noura Kitchen uses (Starter with the Inventory, Purchasing, Recipes and Accounting add-ons). */
const NOURA_MODULES = new Set<ModuleKey>(["pos", "tables", "recipes", "inventory", "purchasing", "accounting", "crm", "revenue", "lankaqr"]);

/**
 * Builds the complete demo tenant in a MemoryStore by running the real services: goods receipts,
 * checks closed through the POS flow (invoices, aggregates, loyalty), FIFO depletion and daily
 * journals. The web app copies the result into Firestore or local storage.
 */
export async function buildSampleStore(opts: SampleOptions): Promise<{ store: MemoryStore; tenant: Omit<Tenant, "ownerUid" | "createdAt"> }> {
  if (opts.kind === "colombo-tees") return buildWholesaleSample({ today: opts.today, settings: teesSettings(sampleSettings()), tenders: sampleTenders() });
  const store = new MemoryStore();
  const noura = opts.kind === "noura-kitchen";
  const s = noura ? nouraSettings() : sampleSettings();
  const propertyId = noura ? NOURA_PROPERTY_ID : SAMPLE_PROPERTY_ID;
  // Noura Kitchen takes cash, cards and LankaQR; the other payment methods are there but switched off.
  const tenders = sampleTenders().map((td) => (noura && !["CASH", "CARD-VM", "LANKAQR"].includes(td.id) ? { ...td, active: false } : td));
  const now = new Date().toISOString();
  const ops: WriteOp[] = [];
  const put = <T extends { id: string }>(col: string, data: T) => ops.push({ op: "set", col, data });

  for (const doc of Object.values(s)) put(C.settings, doc);

  // Organisation & devices
  if (noura) {
    put(C.properties, { id: propertyId, code: propertyId, name: "Noura Kitchen", addressLines: s.business.addressLines, phone: s.business.phone, active: true });
    put(C.revenueCenters, { id: "RESTAURANT", propertyId, code: "RESTAURANT", name: "Restaurant", serviceMode: "table", defaultOrderTypeId: "dine-in", active: true });
    put(C.revenueCenters, { id: "TAKEAWAY", propertyId, code: "TAKEAWAY", name: "Takeaway", serviceMode: "quick", defaultOrderTypeId: "takeaway", active: true });
    // One phone at the counter prints kitchen tickets and bills on the Bluetooth printer beside it (no
    // printer records, no Print Agent). The office PC shows bills on screen, for exploring and training.
    put(C.workstations, { id: "P01", propertyId, rvcId: "RESTAURANT", allowedRvcIds: ["RESTAURANT", "TAKEAWAY"], code: "P01", name: "Counter phone (Bluetooth printer XP-T80Q)", deviceProfile: "mobile", receiptPrinterId: "", printMode: "bluetooth", bluetoothVia: "browser", paperWidthMm: 80, kitchenOnBluetooth: true, active: true });
    put(C.workstations, { id: "W01", propertyId, rvcId: "RESTAURANT", allowedRvcIds: ["RESTAURANT", "TAKEAWAY"], code: "W01", name: "Office PC (training: bills on screen)", deviceProfile: "dedicated", receiptPrinterId: "", printMode: "preview", active: true });
    const nAreas: [string, number, number][] = [["Indoor", 8, 4], ["Outdoor", 2, 2]];
    let nt = 1;
    for (const [area, count, seats] of nAreas) for (let i = 0; i < count; i++, nt++) put(C.tables, { id: `T${nt}`, propertyId, name: String(nt), area, seats, sortOrder: nt });
  } else {
  put(C.properties, { id: SAMPLE_PROPERTY_ID, code: SAMPLE_PROPERTY_ID, name: "Colombo 03 (Galle Road)", addressLines: s.business.addressLines, phone: s.business.phone, active: true });
  put(C.revenueCenters, { id: "DINING", propertyId: SAMPLE_PROPERTY_ID, code: "DINING", name: "Restaurant", serviceMode: "table", defaultOrderTypeId: "dine-in", active: true });
  put(C.revenueCenters, { id: "TAKEAWAY", propertyId: SAMPLE_PROPERTY_ID, code: "TAKEAWAY", name: "Takeaway counter", serviceMode: "quick", defaultOrderTypeId: "takeaway", active: true });
  put(C.revenueCenters, { id: "BAR", propertyId: SAMPLE_PROPERTY_ID, code: "BAR", name: "Bar & lounge", serviceMode: "quick", defaultOrderTypeId: "dine-in", active: true });
  put(C.printers, { id: "PRN-RECEIPT", propertyId: SAMPLE_PROPERTY_ID, name: "Counter bill printer", role: "receipt", model: "Epson TM-T82III", connection: "network", address: "192.168.1.100", port: 9100, paperWidthMm: 80, agentId: "AGENT-1", active: true });
  put(C.printers, { id: "PRN-KITCHEN", propertyId: SAMPLE_PROPERTY_ID, name: "Kitchen KOT printer", role: "kitchen", model: "Xprinter XP-Q80", connection: "network", address: "192.168.1.101", port: 9100, paperWidthMm: 80, agentId: "AGENT-1", backupPrinterId: "PRN-RECEIPT", active: true });
  put(C.printers, { id: "PRN-BAR", propertyId: SAMPLE_PROPERTY_ID, name: "Bar KOT printer", role: "bar", model: "Rongta RP326", connection: "network", address: "192.168.1.102", port: 9100, paperWidthMm: 80, agentId: "AGENT-1", backupPrinterId: "PRN-KITCHEN", active: true });
  put(C.workstations, { id: "W01", propertyId: SAMPLE_PROPERTY_ID, rvcId: "DINING", allowedRvcIds: ["DINING", "TAKEAWAY", "BAR"], code: "W01", name: "Counter POS (Windows touch terminal)", deviceProfile: "dedicated", receiptPrinterId: "PRN-RECEIPT", printMode: "agent", uiStyle: "terminal", active: true });
  put(C.workstations, { id: "T01", propertyId: SAMPLE_PROPERTY_ID, rvcId: "DINING", allowedRvcIds: ["DINING", "BAR"], code: "T01", name: "Floor tablet 1 (Android / iPad)", deviceProfile: "mobile", receiptPrinterId: "PRN-RECEIPT", printMode: "agent", active: true });
  put(C.workstations, { id: "W02", propertyId: SAMPLE_PROPERTY_ID, rvcId: "TAKEAWAY", code: "W02", name: "Takeaway counter (Windows PC)", deviceProfile: "dedicated", receiptPrinterId: "PRN-RECEIPT", printMode: "agent", active: true });
  const areas: [string, number, number][] = [["Indoor", 8, 4], ["Garden", 3, 6], ["Bar", 1, 2]];
  let t = 1;
  for (const [area, count, seats] of areas) for (let i = 0; i < count; i++, t++) put(C.tables, { id: `T${t}`, propertyId: SAMPLE_PROPERTY_ID, name: String(t), area, seats, sortOrder: t });
  }
  [["dine-in", "Dine-in", true], ["takeaway", "Takeaway", false], ["delivery", "Delivery", false]].forEach(([id, name, requiresTable], i) =>
    put(C.orderTypes, { id: id as string, name: name as string, requiresTable: requiresTable as boolean, sortOrder: i + 1, active: true }),
  );
  put(C.locations, { id: SAMPLE_LOCATION_ID, name: "Main store", isDefault: true });
  if (!noura) put(C.locations, { id: "BAR", name: "Bar store", isDefault: false });

  // Menu
  CATEGORIES.forEach(([id, name, majorGroup, color], i) => put(C.menuCategories, { id, name, majorGroup, color, sortOrder: i + 1, active: true } satisfies MenuCategory));
  const modifierGroups: ModifierGroup[] = MODIFIER_GROUPS.map(([id, name, min, max, options]) => ({
    id,
    name,
    min,
    max,
    options: options.map(([oname, price, invKey, qty], i) => ({ id: `${id}-${i + 1}`, name: oname, price: lkr(price), ...(invKey ? { inventoryItemId: code(invKey), qty: qty ?? 0 } : {}) })),
  }));
  modifierGroups.forEach((g) => put(C.modifierGroups, g));
  const menuItems: MenuItem[] = MENU.map(([c, name, categoryId, price, kotRoute, modifierGroupIds, allergens, nameSi], i) => ({
    id: c,
    code: c,
    name,
    ...(nameSi ? { nameSi } : {}),
    categoryId,
    price: lkr(price),
    taxClass: "standard",
    kotRoute,
    modifierGroupIds,
    allergens,
    available: true,
    active: true,
    sortOrder: i + 1,
  }));
  const discounts = [
    { id: "STAFF20", name: "Staff meal 20%", type: "percent", value: 2000, scope: "check", requiresManager: false, active: true },
    { id: "MGR10", name: "Manager 10%", type: "percent", value: 1000, scope: "check", requiresManager: true, active: true },
    { id: "PROMO500", name: "Promo Rs 500 off", type: "amount", value: lkr(500), scope: "check", requiresManager: false, active: true },
    { id: "ITEM15", name: "Item 15% (happy hour)", type: "percent", value: 1500, scope: "item", requiresManager: false, active: true },
  ] as const;
  discounts.forEach((d) => put(C.discounts, { ...d }));
  const reasons: [string, string][] = [["void", "Customer changed mind"], ["void", "Wrong entry"], ["void", "Kitchen error"], ["refund", "Quality complaint"], ["comp", "Guest recovery"], ["waste", "Spoiled"], ["waste", "Expired"], ["waste", "Burnt / dropped"], ["waste", "Spillage"], ["paidOut", "Petty cash purchase"]];
  reasons.forEach(([type, name], i) => put(C.reasonCodes, { id: `RC${String(i + 1).padStart(2, "0")}`, type, name }));
  tenders.forEach((td) => put(C.tenderMedia, td));

  // Inventory & recipes
  const items: InventoryItem[] = [
    ...INVENTORY.map(([key, name, category, majorGroup, stockUnit, purchaseUnit, purchaseFactor, cost, vendorId, parLevel, reorderQty]): InventoryItem => ({
      id: code(key), code: code(key), name, category, majorGroup, stockUnit, purchaseUnit, purchaseFactor, purchaseCost: lkr(cost), vendorId, parLevel, reorderQty, isPrep: false, trackStock: true, active: true,
    })),
    ...PREP.map(([key, name, stockUnit]): InventoryItem => ({
      id: code(key), code: code(key), name, category: "Prep (sub-recipes)", majorGroup: "Food", stockUnit, purchaseUnit: stockUnit, purchaseFactor: 1, purchaseCost: 0, parLevel: 0, reorderQty: 0, isPrep: true, trackStock: false, active: true,
    })),
  ];
  items.forEach((i) => put(C.inventoryItems, i));
  const recipes: Recipe[] = [
    ...PREP.map(([key, , , yieldQty, lines]): Recipe => ({ id: code(key), kind: "prep", yieldQty, lines: lines.map(([k, qty]) => ({ inventoryItemId: code(k), qty })) })),
    ...Object.entries(RECIPES).map(([menuCode, lines]): Recipe => ({ id: menuCode, kind: "menu", yieldQty: 1, lines: lines.map(([k, qty]) => ({ inventoryItemId: code(k), qty })) })),
  ];
  recipes.forEach((r) => put(C.recipes, r));
  const costing = costingContext(items, recipes);
  for (const m of menuItems) put(C.menuItems, { ...m, cost: costMenuItem(m, costing, s.tax, s.business).cost });
  VENDORS.forEach(([c, name, contactName, phone, paymentTermsDays]) => put(C.vendors, { id: c, code: c, name, contactName, phone, paymentTermsDays, active: true }));

  // People
  DEFAULT_ROLES.forEach((r) => put(C.roles, r));
  // Noura Kitchen: the same people and PINs (so the manuals' examples work), without the bar.
  const people = noura
    ? STAFF.filter(([, , roleId]) => roleId !== "bartender").map(([no, name, roleId, pin, jobTitle, rvcIds, cardId]) => [no, name, roleId, pin, jobTitle, rvcIds.filter((r) => r !== "BAR").map((r) => (r === "DINING" ? "RESTAURANT" : r)), cardId] as (typeof STAFF)[number])
    : STAFF;
  for (const [employeeNo, name, roleId, pin, jobTitle, rvcIds, cardId] of people) {
    const { hash, salt } = await hashPin(pin);
    put(C.staff, { id: employeeNo, employeeNo, name, roleId, jobTitle, propertyIds: [propertyId], ...(rvcIds.length ? { rvcIds } : {}), ...(cardId ? { hasCard: true } : {}), pinSet: true, status: "active", hireDate: "2026-09-01", pinChangedAt: now });
    // PIN hashes and card numbers live where clients can't read them (see @pos/core staff-auth).
    put(C.staffSecrets, { id: employeeNo, pinHash: hash, pinSalt: salt, pinChangedAt: now, ...(cardId ? { cardId } : {}) });
  }

  // CRM & finance masters
  CUSTOMERS.forEach(([name, phone, tags, birthday], i) =>
    put(C.customers, { id: `CUS${String(i + 1).padStart(4, "0")}`, name, phone, tags, ...(birthday ? { birthday } : {}), marketingConsent: true, visits: 0, totalSpend: 0, points: 0, createdAt: now } satisfies Customer),
  );
  defaultChartOfAccounts().forEach((a) => put(C.accounts, a));
  put(C.budgets, { id: `${opts.today.slice(0, 7)}__${propertyId}`, month: opts.today.slice(0, 7), propertyId, salesTarget: lkr(noura ? 1_100_000 : 2_500_000), foodCostTargetBp: 3200 });
  await store.batch(ops);

  // Opening purchases: one goods receipt per vendor, the day before the history starts.
  const historyDays = opts.historyDays ?? 7;
  const startDate = addDays(opts.today, -historyDays);
  const openDate = addDays(startDate, -1);
  let grnNo = 1;
  for (const [vendorId] of VENDORS) {
    const lines = INVENTORY.filter((row) => row[8] === vendorId).map(([key, , , , , , , cost, , par]) => ({ inventoryItemId: code(key), qty: Math.max(par, 1) * 3, unitCost: lkr(cost) }));
    const value = lines.reduce((a, l) => a + l.qty * l.unitCost, 0);
    const grn: GoodsReceipt = {
      id: `GRN-${String(grnNo).padStart(4, "0")}`,
      number: `GRN-${String(grnNo).padStart(4, "0")}`,
      vendorId,
      locationId: SAMPLE_LOCATION_ID,
      supplierInvoiceNo: `INV-${vendorId}-001`,
      date: openDate,
      lines,
      // A business that isn't VAT registered can't claim input VAT: it is part of the cost.
      inputVat: !noura && (vendorId === "V004" || vendorId === "V005") ? Math.round(value * 0.18) : 0,
      status: "draft",
    };
    grnNo++;
    await store.set(C.goodsReceipts, grn);
    await postGoodsReceipt(store, grn.id, "sample-data");
  }
  // A draft purchase order for the purchasing demo.
  await store.set(C.purchaseOrders, {
    id: "PO-0001",
    number: "PO-0001",
    vendorId: "V002",
    locationId: SAMPLE_LOCATION_ID,
    status: "draft",
    orderDate: opts.today,
    lines: [
      { inventoryItemId: code("seerFish"), qty: 5, unitCost: lkr(3200) },
      { inventoryItemId: code("prawns"), qty: 4, unitCost: lkr(3800) },
    ],
    notes: "Sample PO",
  });

  // Sales history through the real POS flow.
  const rnd = mulberry32(20261103);
  const pick = <T>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const ctx: PosContext = {
    tax: s.tax,
    business: s.business,
    pos: s.pos,
    discounts: new Map(discounts.map((d) => [d.id, { ...d }])),
    tenders: new Map(tenders.map((td) => [td.id, td])),
    categories: new Map(CATEGORIES.map(([id, name, majorGroup, color], i) => [id, { id, name, majorGroup, color, sortOrder: i, active: true }])),
    inventoryOn: true,
    crmOn: true,
    loyaltyOn: !noura,
  };
  const food = menuItems.filter((m) => m.kotRoute === "kitchen");
  const drinks = menuItems.filter((m) => m.kotRoute === "bar");
  const servers = ["1002", "1003", "1004"];
  const tenderMix: [string, number][] = noura ? [["CASH", 0.6], ["CARD-VM", 0.2], ["LANKAQR", 0.2]] : [["CASH", 0.45], ["CARD-VM", 0.3], ["LANKAQR", 0.18], ["PAYHERE", 0.04], ["CARD-AMEX", 0.03]];
  const chooseTender = () => {
    let r = rnd();
    for (const [id, p] of tenderMix) if ((r -= p) <= 0) return id;
    return "CASH";
  };
  const perDay = opts.checksPerDay ?? 18;
  for (let d = 0; d <= historyDays; d++) {
    const date = addDays(startDate, d);
    const isToday = date === opts.today;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const count = isToday ? Math.ceil(perDay / 3) : perDay + (weekday === 0 || weekday === 6 ? 6 : 0) + Math.floor(rnd() * 5);
    for (let n = 1; n <= count; n++) {
      const r = rnd();
      const orderTypeId = noura ? (r < 0.55 ? "dine-in" : r < 0.95 ? "takeaway" : "delivery") : r < 0.68 ? "dine-in" : r < 0.9 ? "takeaway" : "delivery";
      const covers = orderTypeId === "dine-in" ? 1 + Math.floor(rnd() * 4) : 1;
      const lines: CheckLine[] = [];
      const addLine = (m: MenuItem, qty: number) => {
        const mods = m.modifierGroupIds
          .map((gid) => modifierGroups.find((g) => g.id === gid)!)
          .filter((g) => g.min > 0 || rnd() < 0.3)
          .map((g) => {
            const o = pick(g.options);
            return { groupId: g.id, optionId: o.id, name: o.name, price: o.price };
          });
        lines.push({ id: `L${lines.length + 1}`, menuItemId: m.id, name: m.name, qty, unitPrice: m.price, modifiers: mods, taxClass: m.taxClass, kotRoute: m.kotRoute, categoryId: m.categoryId, discountIds: [] });
      };
      const mains = Math.max(1, Math.round(covers * (0.6 + rnd() * 0.5)));
      for (let i = 0; i < mains; i++) addLine(pick(food), rnd() < 0.15 ? 2 : 1);
      for (let i = 0; i < covers; i++) if (rnd() < 0.7) addLine(pick(drinks), 1);
      const hour = 11 + Math.floor(rnd() * 11);
      const closedAt = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(Math.floor(rnd() * 60)).padStart(2, "0")}:00+05:30`);
      let check: Check = {
        id: `H${date.replace(/-/g, "")}${String(n).padStart(3, "0")}`,
        propertyId,
        rvcId: orderTypeId === "dine-in" ? (noura ? "RESTAURANT" : "DINING") : "TAKEAWAY",
        // Noura Kitchen takes every order on its one counter phone.
        workstationId: noura ? "P01" : orderTypeId === "dine-in" ? "W01" : "W02",
        checkNo: n,
        orderTypeId,
        ...(orderTypeId === "dine-in" ? { tableId: `T${1 + Math.floor(rnd() * (noura ? 10 : 12))}` } : {}),
        covers,
        staffId: pick(servers),
        ...(rnd() < 0.3 ? { customerId: `CUS${String(1 + Math.floor(rnd() * CUSTOMERS.length)).padStart(4, "0")}` } : {}),
        status: "open",
        lines,
        checkDiscountIds: rnd() < 0.08 && lines.reduce((a, l) => a + l.qty * l.unitPrice, 0) > lkr(2000) ? ["PROMO500"] : [],
        payments: [],
        sentRounds: 0,
        businessDate: date,
        openedAt: new Date(closedAt.getTime() - 45 * 60_000).toISOString(),
        channel: "pos",
      };
      check = sendRound(check).check;
      const due = computeCheckTotals(check, ctx).amountDue;
      const tender = ctx.tenders.get(chooseTender())!;
      const amount = tender.type === "cash" ? Math.ceil(due / 100_000) * 100_000 : due;
      const { payment } = makePayment({ tender, amount, balance: due, by: check.staffId, ...(tender.requiresReference ? { reference: `REF${n}${weekday}` } : {}) });
      await closeCheck(store, { ...check, payments: [payment] }, ctx, { workstationCode: check.workstationId, now: closedAt });
    }
  }

  // Today's check numbers continue after the sample checks.
  const todays = (await store.list<Check>(C.checks, { where: [["businessDate", "==", opts.today]] }));
  for (const wsId of new Set(todays.map((c) => c.workstationId))) {
    await store.merge(C.sequences, wsId, { checkDate: opts.today, checkSeq: Math.max(...todays.filter((c) => c.workstationId === wsId).map((c) => c.checkNo)) });
  }

  await processDepletion(store, { locationId: SAMPLE_LOCATION_ID, by: "sample-data", limit: 2000 });

  // Books: opening balances, assets, POS days, supplier and customer invoices, payments, budgets.
  await seedFinance(store, { today: opts.today, historyStart: startDate, openDate, propertyId, ...(noura ? { profile: NOURA_FINANCE } : {}) });

  if (noura) {
    const modules = Object.fromEntries(Object.keys(allModulesOn()).map((k) => [k, NOURA_MODULES.has(k as ModuleKey)])) as Record<ModuleKey, boolean>;
    return { store, tenant: { id: "demo-noura-kitchen", name: "Noura Kitchen (demo)", modules, plan: "demo", entitlements: builtInEntitlements("demo"), status: "active" } };
  }
  return {
    store,
    tenant: { id: "demo-spice-lagoon", name: "Spice Lagoon (demo)", modules: allModulesOn(), plan: "demo", entitlements: builtInEntitlements("demo"), status: "active" },
  };
}
