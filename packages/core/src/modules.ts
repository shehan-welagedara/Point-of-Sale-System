/**
 * Licensable modules. A tenant gets exactly the modules switched on in `Tenant.modules`;
 * the UI hides everything else and the security rules refuse writes to its collections.
 */
export type ModuleKey =
  | "pos"
  | "tables"
  | "kds"
  | "recipes"
  | "inventory"
  | "purchasing"
  | "accounting"
  | "crm"
  | "loyalty"
  | "revenue"
  | "payhere"
  | "lankaqr"
  | "whatsapp"
  | "qrOrdering"
  | "website";

export interface ModuleInfo {
  key: ModuleKey;
  name: string;
  group: "POS" | "ERP" | "Finance" | "Customers" | "Insights" | "Integrations" | "Channels";
  description: string;
  requires: ModuleKey[];
  /** Built and demo-ready, or planned for a later release. */
  status: "available" | "planned";
}

export const MODULES: readonly ModuleInfo[] = [
  { key: "pos", name: "Point of Sale", group: "POS", description: "Ordering, bills (IRD tax invoice format), tenders, cash drawer, KOT printing, End of Day.", requires: [], status: "available" },
  { key: "tables", name: "Table Service", group: "POS", description: "Floor plan, tables, covers and table status for dine-in.", requires: ["pos"], status: "available" },
  { key: "kds", name: "Kitchen Display", group: "POS", description: "Kitchen and bar screens with bump and timers, alongside or instead of KOT printers.", requires: ["pos"], status: "available" },
  { key: "recipes", name: "Recipes & Costing", group: "ERP", description: "Recipes, sub-recipes (prep items), portion cost, food cost % and gross profit per item.", requires: [], status: "available" },
  { key: "inventory", name: "Inventory", group: "ERP", description: "Stock by location with FIFO lots, recipe-based depletion from sales, waste, counts, transfers, valuation.", requires: ["recipes"], status: "available" },
  { key: "purchasing", name: "Purchasing", group: "ERP", description: "Vendors, purchase orders, goods receipts (GRN) with input VAT.", requires: ["inventory"], status: "available" },
  { key: "accounting", name: "Accounting", group: "Finance", description: "Chart of accounts, automatic daily journals, P&L and VAT/SSCL summary, Excel export.", requires: [], status: "available" },
  { key: "crm", name: "Customers (CRM)", group: "Customers", description: "Customer profiles, visit and spend history, tags, business buyers for VAT invoices.", requires: [], status: "available" },
  { key: "loyalty", name: "Loyalty", group: "Customers", description: "Points on spend and redemption.", requires: ["crm"], status: "available" },
  { key: "revenue", name: "Revenue Management", group: "Insights", description: "Dashboards, menu engineering, targets and trading analysis.", requires: [], status: "available" },
  { key: "payhere", name: "PayHere", group: "Integrations", description: "Online card payments, payment links and QR pay (mock until live keys are added).", requires: ["pos"], status: "available" },
  { key: "lankaqr", name: "LankaQR", group: "Integrations", description: "Bank LankaQR at the counter or on the bill (mock until the bank merchant ID is added).", requires: ["pos"], status: "available" },
  { key: "whatsapp", name: "WhatsApp Reports", group: "Integrations", description: "End-of-day reports and alerts to managers on WhatsApp (simulated until Meta approval).", requires: [], status: "available" },
  { key: "qrOrdering", name: "QR Table Ordering", group: "Channels", description: "Guests order (and pay) from a table QR code.", requires: ["pos"], status: "planned" },
  { key: "website", name: "Website & Online Ordering", group: "Channels", description: "Restaurant website with pickup and delivery orders straight into the POS.", requires: ["pos"], status: "planned" },
];

export function moduleInfo(key: ModuleKey): ModuleInfo {
  const m = MODULES.find((x) => x.key === key);
  if (!m) throw new Error(`unknown module ${key}`);
  return m;
}

/** Every available module on: used for the demo tenant. */
export function allModulesOn(): Record<ModuleKey, boolean> {
  return Object.fromEntries(MODULES.map((m) => [m.key, m.status === "available"])) as Record<ModuleKey, boolean>;
}

/** Turning a module on also turns on what it requires; turning one off turns off what depends on it. */
export function setModule(
  current: Partial<Record<ModuleKey, boolean>>,
  key: ModuleKey,
  on: boolean,
): Partial<Record<ModuleKey, boolean>> {
  const next = { ...current, [key]: on };
  if (on) {
    for (const r of moduleInfo(key).requires) Object.assign(next, setModule(next, r, true));
  } else {
    for (const m of MODULES) if (m.requires.includes(key) && next[m.key]) Object.assign(next, setModule(next, m.key, false));
  }
  return next;
}

export function isOn(modules: Partial<Record<ModuleKey, boolean>> | undefined, key: ModuleKey): boolean {
  return Boolean(modules?.[key]);
}
