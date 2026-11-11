/**
 * Data validation for every module.
 *
 * 1. **Schemas** (zod) for each collection: field types, ranges and formats. The app validates
 *    every full-document write against them (`validateDoc`), so bad data is refused before it
 *    reaches the database, whichever screen or import it comes from.
 * 2. **Data health** (`dataHealth`): cross-record checks no single write can see — references
 *    that point nowhere (an item in a deleted category, a workstation in a revenue centre of
 *    another property, a recipe using a missing stock item), duplicates (codes, PIN cards,
 *    employee numbers), circular prep recipes and unmapped ledger accounts. Run from the Audit
 *    Center at any time, and in the test suite against the demo data.
 */
import { z } from "zod";

// No runtime code generation: the app runs under a strict Content-Security-Policy (no eval).
z.config({ jitless: true });
import { PRIVILEGES } from "./privileges.js";
import { COLLECTIONS as C, type DocStore } from "./store.js";

const id = z.string().min(1).max(120);
const cents = z.number().int();
const money = cents.nonnegative();
const bp = z.number().int().min(0).max(10_000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const iso = z.string().min(10);
const color = z.string().regex(/^(#[0-9a-fA-F]{3,8}|[a-z]+|rgba?\(.+\)|hsla?\(.+\))$/, "colour must be like #0f766e").or(z.literal(""));
const majorGroup = z.enum(["Food", "Beverage", "Liquor", "Other"]);
const name = z.string().trim().min(1, "name is required").max(120);
const code = z.string().trim().min(1, "code is required").max(40);

const entity = { id };

export const SCHEMAS = {
  [C.properties]: z.object({ ...entity, code, name, addressLines: z.array(z.string()), phone: z.string().optional(), active: z.boolean() }).passthrough(),
  [C.revenueCenters]: z.object({ ...entity, propertyId: id, code, name, serviceMode: z.enum(["table", "quick"]), defaultOrderTypeId: id, active: z.boolean() }).passthrough(),
  [C.workstations]: z
    .object({
      ...entity,
      propertyId: id,
      rvcId: id,
      allowedRvcIds: z.array(id).optional(),
      code: z.string().regex(/^[A-Z0-9]{1,15}$/, "workstation code must be 1–15 capital letters or digits (it appears in IRD invoice numbers)"),
      name,
      deviceProfile: z.enum(["dedicated", "mobile"]),
      receiptPrinterId: z.string(),
      printMode: z.enum(["agent", "direct", "bluetooth", "preview"]),
      bluetoothVia: z.enum(["browser", "rawbt"]).optional(),
      paperWidthMm: z.union([z.literal(80), z.literal(58)]).optional(),
      kitchenOnBluetooth: z.boolean().optional(),
      autoSignOutSeconds: z.number().int().min(0).max(3600).optional(),
      active: z.boolean(),
    })
    .passthrough(),
  [C.printers]: z.object({ ...entity, propertyId: id, name, role: z.enum(["receipt", "kitchen", "bar", "report"]), model: z.string(), connection: z.enum(["network", "usb", "bluetooth"]), address: z.string(), port: z.number().int().min(0).max(65535), paperWidthMm: z.union([z.literal(80), z.literal(58)]), agentId: z.string(), backupPrinterId: z.string().optional(), active: z.boolean() }).passthrough(),
  [C.tables]: z.object({ ...entity, propertyId: id, name, area: z.string(), seats: z.number().int().min(1).max(100), sortOrder: z.number().int() }).passthrough(),
  [C.orderTypes]: z.object({ ...entity, name, requiresTable: z.boolean(), sortOrder: z.number().int(), active: z.boolean() }).passthrough(),
  [C.menuCategories]: z.object({ ...entity, name, majorGroup, color, sortOrder: z.number().int(), active: z.boolean() }).passthrough(),
  [C.menuItems]: z
    .object({
      ...entity,
      code,
      name,
      nameSi: z.string().optional(),
      nameTa: z.string().optional(),
      categoryId: id,
      price: money,
      taxClass: z.string().min(1),
      kotRoute: z.enum(["kitchen", "bar", "none"]),
      modifierGroupIds: z.array(id),
      allergens: z.array(z.string()),
      available: z.boolean(),
      active: z.boolean(),
      sortOrder: z.number().int(),
      cost: money.optional(),
      hasImage: z.boolean().optional(),
      buttonColor: color.optional(),
      openPrice: z.boolean().optional(),
    })
    .passthrough()
    .refine((m) => m.id === m.code, { message: "item code must equal the document id", path: ["code"] }),
  [C.modifierGroups]: z
    .object({ ...entity, name, min: z.number().int().min(0), max: z.number().int().min(1), options: z.array(z.object({ id, name, price: cents, inventoryItemId: z.string().optional(), qty: z.number().positive().optional() }).passthrough()).min(1, "a modifier group needs at least one option") })
    .passthrough()
    .refine((g) => g.min <= g.max, { message: "minimum choices is more than maximum", path: ["min"] }),
  [C.discounts]: z
    .object({ ...entity, name, type: z.enum(["percent", "amount"]), value: z.number().nonnegative(), scope: z.enum(["item", "check"]), requiresManager: z.boolean(), active: z.boolean() })
    .passthrough()
    .refine((d) => d.type !== "percent" || d.value <= 10_000, { message: "a percentage discount can't exceed 100%", path: ["value"] }),
  [C.reasonCodes]: z.object({ ...entity, type: z.enum(["void", "refund", "discount", "comp", "waste", "paidOut"]), name }).passthrough(),
  [C.tenderMedia]: z
    .object({ ...entity, name, type: z.enum(["cash", "card", "lankaqr", "payhere", "foreignCash", "voucher", "house", "comp"]), allowChange: z.boolean(), currency: z.string().length(3).optional(), exchangeRateMicros: z.number().int().positive().optional(), requiresReference: z.boolean(), opensDrawer: z.boolean(), accountCode: z.string(), sortOrder: z.number().int(), active: z.boolean() })
    .passthrough()
    .refine((t) => t.type !== "foreignCash" || (t.currency && t.exchangeRateMicros), { message: "foreign cash needs a currency and exchange rate", path: ["currency"] }),
  [C.roles]: z
    .object({
      ...entity,
      name,
      level: z.number().int().min(1).max(99),
      privileges: z.array(z.string()),
      limits: z.object({ maxDiscountBp: bp.optional(), maxVoidAmount: money.optional(), maxPriceOverrideBp: bp.optional(), maxRefundAmount: money.optional(), maxPaidOut: money.optional() }).passthrough().optional(),
      requireAuth: z.array(z.string()).optional(),
    })
    .passthrough()
    .refine((r) => r.privileges.every((p) => p in PRIVILEGES), { message: "unknown privilege", path: ["privileges"] }),
  [C.staff]: z
    .object({
      ...entity,
      employeeNo: z.string().regex(/^\d{1,10}$/, "employee number must be digits (it is the POS sign-in ID)"),
      name,
      roleId: id,
      propertyRoles: z.record(z.string(), z.string()).optional(),
      propertyIds: z.array(id),
      rvcIds: z.array(id).optional(),
      pinSet: z.boolean().optional(),
      pinHash: z.string().min(16).optional(),
      pinSalt: z.string().min(8).optional(),
      cardId: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().email().optional().or(z.literal("")),
      status: z.enum(["active", "suspended", "terminated"]),
      hireDate: date.optional(),
      terminationDate: date.optional(),
      failedSignIns: z.number().int().min(0).optional(),
      lockedAt: iso.optional(),
    })
    .passthrough()
    .refine((s) => !s.hireDate || !s.terminationDate || s.hireDate <= s.terminationDate, { message: "termination date is before the hire date", path: ["terminationDate"] })
    .refine((s) => Boolean(s.pinSet || s.pinHash), { message: "PIN is not set", path: ["pinSet"] }),
  [C.inventoryItems]: z.object({ ...entity, code, name, category: z.string(), majorGroup, stockUnit: z.enum(["g", "ml", "pcs"]), purchaseUnit: z.string().min(1), purchaseFactor: z.number().positive(), purchaseCost: money, vendorId: z.string().optional(), parLevel: z.number().nonnegative(), reorderQty: z.number().nonnegative(), isPrep: z.boolean(), trackStock: z.boolean(), active: z.boolean() }).passthrough(),
  [C.locations]: z.object({ ...entity, name, isDefault: z.boolean() }).passthrough(),
  [C.recipes]: z.object({ ...entity, kind: z.enum(["menu", "prep"]), yieldQty: z.number().positive(), lines: z.array(z.object({ inventoryItemId: id, qty: z.number().positive("ingredient quantity must be more than 0") }).passthrough()).min(1, "a recipe needs at least one ingredient"), method: z.string().optional() }).passthrough(),
  [C.vendors]: z.object({ ...entity, code, name, phone: z.string(), email: z.string().email().optional().or(z.literal("")), vatNumber: z.string().optional(), paymentTermsDays: z.number().int().min(0).max(365), active: z.boolean() }).passthrough(),
  [C.purchaseOrders]: z.object({ ...entity, number: z.string().min(1), vendorId: id, locationId: id, status: z.enum(["draft", "approved", "sent", "received", "cancelled"]), orderDate: date, expectedDate: date.optional(), lines: z.array(z.object({ inventoryItemId: id, qty: z.number().positive(), unitCost: money }).passthrough()).min(1) }).passthrough(),
  [C.goodsReceipts]: z.object({ ...entity, number: z.string().min(1), vendorId: id, locationId: id, date, lines: z.array(z.object({ inventoryItemId: id, qty: z.number().positive(), unitCost: money }).passthrough()).min(1), inputVat: money, status: z.enum(["draft", "posted"]) }).passthrough(),
  [C.customers]: z.object({ ...entity, name, phone: z.string(), email: z.string().email().optional().or(z.literal("")), tags: z.array(z.string()), marketingConsent: z.boolean(), visits: z.number().int().min(0), totalSpend: money, points: z.number().int() }).passthrough(),
  [C.accounts]: z.object({ ...entity, code, name, type: z.enum(["asset", "liability", "equity", "income", "expense"]), parentId: z.string().optional(), isGroup: z.boolean().optional(), frozen: z.boolean().optional() }).passthrough().refine((a) => a.id === a.code, { message: "account code must equal the document id", path: ["code"] }),
} as const;

export type ValidatedCollection = keyof typeof SCHEMAS;

export interface ValidationIssue {
  path: string;
  message: string;
}

/** Validates a full document for a known collection (unknown collections pass). */
export function validateDoc(col: string, doc: unknown): ValidationIssue[] {
  const schema = (SCHEMAS as Record<string, z.ZodTypeAny>)[col];
  if (!schema) return [];
  const r = schema.safeParse(doc);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

export class ValidationError extends Error {
  constructor(
    readonly col: string,
    readonly docId: string,
    readonly issues: ValidationIssue[],
  ) {
    super(`${col}/${docId}: ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}`);
  }
}

// ───────────────────────────── Data health ─────────────────────────────

export interface HealthIssue {
  severity: "error" | "warning";
  module: string;
  collection: string;
  id: string;
  message: string;
}

type Docs = Record<string, Record<string, unknown>[]>;
type Rec = Record<string, unknown> & { id: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

/**
 * Validates every document and every cross-reference across modules. `data` is a snapshot of
 * the tenant (collection → documents); `modules` are the switched-on modules.
 */
export function dataHealth(data: Docs, modules: Partial<Record<string, boolean>> = {}): HealthIssue[] {
  const out: HealthIssue[] = [];
  const list = (col: string) => (data[col] ?? []) as Rec[];
  const ids = (col: string) => new Set(list(col).map((d) => d.id));
  const push = (severity: HealthIssue["severity"], module: string, collection: string, id: string, message: string) => out.push({ severity, module, collection, id, message });
  const moduleOf: Record<string, string> = {
    [C.properties]: "Setup", [C.revenueCenters]: "Setup", [C.workstations]: "Setup", [C.printers]: "Setup", [C.tables]: "POS", [C.orderTypes]: "POS",
    [C.menuCategories]: "Menu", [C.menuItems]: "Menu", [C.modifierGroups]: "Menu", [C.discounts]: "POS", [C.reasonCodes]: "POS", [C.tenderMedia]: "POS",
    [C.roles]: "People", [C.staff]: "People", [C.inventoryItems]: "Inventory", [C.locations]: "Inventory", [C.recipes]: "Recipes", [C.vendors]: "Purchasing",
    [C.purchaseOrders]: "Purchasing", [C.goodsReceipts]: "Purchasing", [C.customers]: "Customers", [C.accounts]: "Accounting",
  };

  // 1. Every document against its schema.
  for (const col of Object.keys(SCHEMAS)) {
    for (const d of list(col)) for (const i of validateDoc(col, d)) push("error", moduleOf[col] ?? col, col, d.id, i.path ? `${i.path}: ${i.message}` : i.message);
  }

  // 2. References.
  const props = ids(C.properties);
  const rvcs = new Map(list(C.revenueCenters).map((r) => [r.id, r]));
  const printers = new Map(list(C.printers).map((p) => [p.id, p]));
  const cats = ids(C.menuCategories);
  const mods = ids(C.modifierGroups);
  const roles = ids(C.roles);
  const stock = ids(C.inventoryItems);
  const vendors = ids(C.vendors);
  const locations = ids(C.locations);
  const orderTypes = ids(C.orderTypes);
  const items = ids(C.menuItems);
  const accounts = new Map(list(C.accounts).map((a) => [a.id, a]));
  const ref = (module: string, col: string, d: Rec, field: string, set: Set<string> | Map<string, unknown>, what: string) => {
    const v = str(d[field]);
    if (v && !set.has(v)) push("error", module, col, d.id, `${field} "${v}" is not an existing ${what}`);
  };

  for (const r of list(C.revenueCenters)) {
    ref("Setup", C.revenueCenters, r, "propertyId", props, "property");
    ref("Setup", C.revenueCenters, r, "defaultOrderTypeId", orderTypes, "order type");
  }
  const wsCodes = new Map<string, string>();
  for (const w of list(C.workstations)) {
    ref("Setup", C.workstations, w, "propertyId", props, "property");
    const rvc = rvcs.get(str(w.rvcId));
    if (!rvc) push("error", "Setup", C.workstations, w.id, `revenue centre "${str(w.rvcId)}" does not exist`);
    else if (rvc.propertyId !== w.propertyId) push("error", "Setup", C.workstations, w.id, "its revenue centre belongs to another property");
    for (const a of arr(w.allowedRvcIds)) if (rvcs.get(a)?.propertyId !== w.propertyId) push("error", "Setup", C.workstations, w.id, `allowed revenue centre "${a}" is missing or in another property`);
    const p = printers.get(str(w.receiptPrinterId));
    if (str(w.receiptPrinterId) && !p) push("error", "Setup", C.workstations, w.id, `receipt printer "${str(w.receiptPrinterId)}" does not exist`);
    if (p && p.propertyId !== w.propertyId) push("warning", "Setup", C.workstations, w.id, "its receipt printer is in another property");
    const code = str(w.code);
    if (wsCodes.has(code)) push("error", "Setup", C.workstations, w.id, `workstation code ${code} is also used by ${wsCodes.get(code)}: invoice numbers would collide`);
    wsCodes.set(code, w.id);
  }
  for (const p of list(C.printers)) {
    ref("Setup", C.printers, p, "propertyId", props, "property");
    if (str(p.backupPrinterId) && (!printers.has(str(p.backupPrinterId)) || p.backupPrinterId === p.id)) push("error", "Setup", C.printers, p.id, "backup printer is missing or is itself");
  }
  for (const t of list(C.tables)) ref("POS", C.tables, t, "propertyId", props, "property");

  for (const m of list(C.menuItems)) {
    ref("Menu", C.menuItems, m, "categoryId", cats, "category");
    for (const g of arr(m.modifierGroupIds)) if (!mods.has(g)) push("error", "Menu", C.menuItems, m.id, `modifier group "${g}" does not exist`);
    if (m.active && !m.openPrice && (m.price as number) === 0) push("warning", "Menu", C.menuItems, m.id, "active item with a zero price");
    if (modules.recipes && m.active && !list(C.recipes).some((r) => r.id === m.id)) push("warning", "Recipes", C.menuItems, m.id, "no recipe: cost and stock depletion can't be calculated");
  }
  for (const g of list(C.modifierGroups)) {
    for (const o of (g.options as Rec[] | undefined) ?? []) if (str(o.inventoryItemId) && !stock.has(str(o.inventoryItemId))) push("error", "Menu", C.modifierGroups, g.id, `option "${str(o.name)}" uses missing stock item ${str(o.inventoryItemId)}`);
  }

  const knownRvc = new Set(rvcs.keys());
  const empNos = new Map<string, string>();
  const cards = new Map<string, string>();
  for (const s of list(C.staff)) {
    ref("People", C.staff, s, "roleId", roles, "role");
    for (const p of arr(s.propertyIds)) if (!props.has(p)) push("error", "People", C.staff, s.id, `property "${p}" does not exist`);
    for (const r of arr(s.rvcIds)) if (!knownRvc.has(r)) push("error", "People", C.staff, s.id, `revenue centre "${r}" does not exist`);
    for (const [p, r] of Object.entries((s.propertyRoles as Record<string, string> | undefined) ?? {})) {
      if (!props.has(p)) push("error", "People", C.staff, s.id, `property role for missing property "${p}"`);
      if (!roles.has(r)) push("error", "People", C.staff, s.id, `role "${r}" for property ${p} does not exist`);
    }
    const no = str(s.employeeNo);
    if (empNos.has(no)) push("error", "People", C.staff, s.id, `employee number ${no} is also used by ${empNos.get(no)}`);
    empNos.set(no, s.id);
    const card = str(s.cardId);
    if (card) {
      if (cards.has(card)) push("error", "People", C.staff, s.id, `card ${card} is also assigned to ${cards.get(card)}`);
      cards.set(card, s.id);
    }
    if (s.status === "active" && s.terminationDate && str(s.terminationDate) < new Date().toISOString().slice(0, 10)) push("warning", "People", C.staff, s.id, "active employee past their termination date");
  }

  for (const i of list(C.inventoryItems)) if (str(i.vendorId)) ref("Inventory", C.inventoryItems, i, "vendorId", vendors, "vendor");
  const recipeIds = new Map(list(C.recipes).map((r) => [r.id, r]));
  for (const r of list(C.recipes)) {
    if (r.kind === "menu" && !items.has(r.id)) push("error", "Recipes", C.recipes, r.id, "recipe for a menu item that does not exist");
    if (r.kind === "prep" && !stock.has(r.id)) push("error", "Recipes", C.recipes, r.id, "prep recipe for a stock item that does not exist");
    for (const l of (r.lines as Rec[] | undefined) ?? []) if (!stock.has(str(l.inventoryItemId))) push("error", "Recipes", C.recipes, r.id, `ingredient "${str(l.inventoryItemId)}" is not a stock item`);
  }
  // Circular prep recipes (A uses B uses A) would never finish costing.
  const visiting = new Set<string>();
  const done = new Set<string>();
  const cycle = (rid: string): boolean => {
    if (done.has(rid)) return false;
    if (visiting.has(rid)) return true;
    visiting.add(rid);
    const hit = ((recipeIds.get(rid)?.lines as Rec[] | undefined) ?? []).some((l) => recipeIds.get(str(l.inventoryItemId))?.kind === "prep" && cycle(str(l.inventoryItemId)));
    visiting.delete(rid);
    done.add(rid);
    return hit;
  };
  for (const r of list(C.recipes)) if (r.kind === "prep" && cycle(r.id)) push("error", "Recipes", C.recipes, r.id, "prep recipes refer to each other in a circle");

  for (const col of [C.purchaseOrders, C.goodsReceipts]) {
    for (const d of list(col)) {
      ref("Purchasing", col, d, "vendorId", vendors, "vendor");
      ref("Purchasing", col, d, "locationId", locations, "location");
      for (const l of (d.lines as Rec[] | undefined) ?? []) if (!stock.has(str(l.inventoryItemId))) push("error", "Purchasing", col, d.id, `line item "${str(l.inventoryItemId)}" is not a stock item`);
    }
  }

  if (modules.accounting) {
    for (const t of list(C.tenderMedia)) if (t.active && !accounts.has(str(t.accountCode))) push("error", "Accounting", C.tenderMedia, t.id, `ledger account "${str(t.accountCode)}" does not exist`);
    for (const a of accounts.values()) {
      const parent = str(a.parentId);
      if (parent && !accounts.has(parent)) push("error", "Accounting", C.accounts, a.id, `parent account "${parent}" does not exist`);
      if (parent && accounts.get(parent) && !accounts.get(parent)!.isGroup) push("error", "Accounting", C.accounts, a.id, `parent "${parent}" is a ledger, not a group`);
    }
    const setting = list(C.settings).find((s) => s.id === "accounting");
    const mapping = (setting?.accounts ?? {}) as Record<string, unknown>;
    const walk = (v: unknown, path: string) => {
      if (typeof v === "string") {
        if (v && !accounts.has(v)) push("error", "Accounting", C.settings, "accounting", `mapping ${path} → "${v}" is not an account`);
      } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    };
    walk(mapping, "");
  }

  const pos = list(C.settings).find((s) => s.id === "pos");
  if (pos && str(pos.defaultPropertyId) && !props.has(str(pos.defaultPropertyId))) push("error", "Setup", C.settings, "pos", "default property does not exist");
  return out;
}

/** Collections `dataHealth` needs, for loading a snapshot. */
export const HEALTH_COLLECTIONS: string[] = [...Object.keys(SCHEMAS), C.settings];


/**
 * Wraps a store so every full-document write (set, and set inside a batch) to a validated
 * collection is checked first. Partial merges and counters are left to the services that make
 * them (they change status flags and totals, not user-entered data).
 */
export function withValidation<S extends DocStore>(store: S): DocStore {
  const check = (col: string, data: { id?: unknown }) => {
    const issues = validateDoc(col, data);
    if (issues.length) throw new ValidationError(col, String(data.id ?? ""), issues);
  };
  return {
    get: (col, id) => store.get(col, id),
    list: (col, q) => store.list(col, q),
    set: (col, data) => {
      check(col, data);
      return store.set(col, data);
    },
    merge: (col, id, data) => store.merge(col, id, data),
    increment: (col, id, inc, base) => store.increment(col, id, inc, base),
    remove: (col, id) => store.remove(col, id),
    batch: (ops) => {
      for (const o of ops) if (o.op === "set") check(o.col, o.data);
      return store.batch(ops);
    },
    watch: (col, q, cb) => store.watch(col, q, cb),
  };
}
