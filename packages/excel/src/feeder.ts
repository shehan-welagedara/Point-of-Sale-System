/**
 * Excel "data feeder" workbook: the restaurant maintains its menu, modifiers, stock items, recipes,
 * vendors and customers in Excel and imports them into the system. Codes are the keys, so
 * re-importing updates existing records instead of duplicating them.
 */
import ExcelJS from "exceljs";
import {
  type Customer,
  type InventoryItem,
  type MajorGroup,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type Recipe,
  type StockUnit,
  type Vendor,
  type WriteOp,
  COLLECTIONS as C,
  codeToId,
} from "@pos/core";

export interface FeederData {
  categories: MenuCategory[];
  menuItems: MenuItem[];
  modifierGroups: ModifierGroup[];
  inventoryItems: InventoryItem[];
  recipes: Recipe[];
  vendors: Vendor[];
  customers: Customer[];
}

export const SHEETS = {
  categories: "Categories",
  menuItems: "Menu Items",
  modifierGroups: "Modifier Groups",
  modifierOptions: "Modifier Options",
  inventoryItems: "Stock Items",
  recipes: "Recipes",
  vendors: "Vendors",
  customers: "Customers",
} as const;

const MAJOR_GROUPS: MajorGroup[] = ["Food", "Beverage", "Liquor", "Other"];
const UNITS: StockUnit[] = ["g", "ml", "pcs"];

interface Column {
  header: string;
  key: string;
  width: number;
  /** Excel list validation. */
  list?: string[];
  note?: string;
}

const COLUMNS: Record<keyof typeof SHEETS, Column[]> = {
  categories: [
    { header: "Code", key: "code", width: 14, note: "Unique code, e.g. KOTTU" },
    { header: "Name", key: "name", width: 30 },
    { header: "Major Group", key: "majorGroup", width: 14, list: MAJOR_GROUPS },
    { header: "Colour", key: "color", width: 12, note: "Hex colour for POS buttons, e.g. #B45309" },
    { header: "Sort", key: "sort", width: 8 },
  ],
  menuItems: [
    { header: "Code", key: "code", width: 10, note: "PLU / item code, e.g. K001" },
    { header: "Name", key: "name", width: 34 },
    { header: "Sinhala Name", key: "nameSi", width: 26 },
    { header: "Tamil Name", key: "nameTa", width: 26 },
    { header: "Category Code", key: "category", width: 16 },
    { header: "Price (LKR)", key: "price", width: 12, note: "Menu price; exclusive or inclusive of taxes per Tax settings" },
    { header: "Tax Class", key: "taxClass", width: 12, list: ["standard", "exempt"] },
    { header: "KOT Route", key: "kotRoute", width: 11, list: ["kitchen", "bar", "none"] },
    { header: "Modifier Groups", key: "modifiers", width: 26, note: "Comma-separated group codes" },
    { header: "Allergens", key: "allergens", width: 26, note: "Comma-separated, e.g. gluten, egg, milk" },
    { header: "Description", key: "description", width: 40 },
    { header: "Active", key: "active", width: 8, list: ["Y", "N"] },
  ],
  modifierGroups: [
    { header: "Group Code", key: "code", width: 16 },
    { header: "Group Name", key: "name", width: 26 },
    { header: "Min", key: "min", width: 6, note: "1 = guest must choose" },
    { header: "Max", key: "max", width: 6 },
  ],
  modifierOptions: [
    { header: "Group Code", key: "group", width: 16 },
    { header: "Option", key: "name", width: 26 },
    { header: "Price (LKR)", key: "price", width: 12 },
    { header: "Stock Item Code", key: "stockItem", width: 16, note: "Optional: ingredient used by this option" },
    { header: "Stock Qty", key: "qty", width: 10, note: "In the stock item's unit" },
  ],
  inventoryItems: [
    { header: "Code", key: "code", width: 10 },
    { header: "Name", key: "name", width: 34 },
    { header: "Category", key: "category", width: 18 },
    { header: "Major Group", key: "majorGroup", width: 12, list: MAJOR_GROUPS },
    { header: "Stock Unit", key: "stockUnit", width: 10, list: UNITS, note: "Unit used in recipes and counts" },
    { header: "Purchase Unit", key: "purchaseUnit", width: 16, note: "e.g. kg, tray 30, bottle 750 ml" },
    { header: "Stock Units per Purchase Unit", key: "factor", width: 14, note: "e.g. kg → 1000 g" },
    { header: "Cost per Purchase Unit (LKR)", key: "cost", width: 14 },
    { header: "Vendor Code", key: "vendor", width: 12 },
    { header: "Par Level", key: "par", width: 10, note: "In purchase units" },
    { header: "Reorder Qty", key: "reorder", width: 10, note: "In purchase units" },
    { header: "Prep Item", key: "prep", width: 9, list: ["Y", "N"], note: "Y = made in-house from a prep recipe" },
    { header: "Track Stock", key: "track", width: 10, list: ["Y", "N"] },
  ],
  recipes: [
    { header: "Recipe For (Code)", key: "for", width: 16, note: "Menu item code or prep item code" },
    { header: "Type", key: "type", width: 8, list: ["menu", "prep"] },
    { header: "Yield", key: "yield", width: 8, note: "Portions (menu) or stock units produced (prep)" },
    { header: "Ingredient Code", key: "ingredient", width: 16 },
    { header: "Ingredient Name", key: "ingredientName", width: 32, note: "For reference only (not imported)" },
    { header: "Qty", key: "qty", width: 10, note: "In the ingredient's stock unit" },
    { header: "Unit", key: "unit", width: 8, note: "For reference only" },
  ],
  vendors: [
    { header: "Code", key: "code", width: 10 },
    { header: "Name", key: "name", width: 36 },
    { header: "Contact", key: "contact", width: 18 },
    { header: "Phone", key: "phone", width: 16 },
    { header: "Email", key: "email", width: 26 },
    { header: "Address", key: "address", width: 34 },
    { header: "VAT No", key: "vat", width: 14 },
    { header: "Payment Terms (days)", key: "terms", width: 12 },
  ],
  customers: [
    { header: "Phone", key: "phone", width: 16, note: "Used as the customer key" },
    { header: "Name", key: "name", width: 28 },
    { header: "Email", key: "email", width: 26 },
    { header: "Birthday", key: "birthday", width: 12, note: "YYYY-MM-DD" },
    { header: "Tags", key: "tags", width: 22 },
    { header: "Marketing Consent", key: "consent", width: 10, list: ["Y", "N"] },
    { header: "VAT TIN", key: "tin", width: 14 },
    { header: "Address", key: "address", width: 30 },
  ],
};

const rupees = (cents: number) => Math.round(cents) / 100;
const yn = (b: boolean) => (b ? "Y" : "N");

function styleSheet(ws: ExcelJS.Worksheet, cols: Column[], rows: number): void {
  ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    if (c.note) cell.note = c.note;
    if (c.list) {
      for (let r = 2; r <= Math.max(rows + 1, 2) + 200; r++) {
        ws.getCell(r, i + 1).dataValidation = { type: "list", allowBlank: true, formulae: [`"${c.list.join(",")}"`] };
      }
    }
  });
}

/** Builds the data feeder workbook (sample data for the template, or the live data for export). */
export async function buildFeederWorkbook(data: FeederData, opts: { title?: string } = {}): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "POS Suite";
  wb.created = new Date();
  const info = wb.addWorksheet("Instructions");
  info.columns = [{ width: 110 }];
  [
    opts.title ?? "Restaurant data feeder",
    "",
    "How to use:",
    "1. Fill each sheet. Codes are the keys: keep them unique and do not change a code once used (it links sales history, recipes and stock).",
    "2. Prices and costs are in rupees (LKR), e.g. 1250 or 1250.50.",
    "3. Stock units: g, ml or pcs. 'Stock Units per Purchase Unit' converts what you buy into what recipes use (1 kg = 1000 g).",
    "4. Recipes: one row per ingredient. Repeat the 'Recipe For' code on each row; Yield is read from the first row of each recipe.",
    "5. Prep items (curries, sambols, sauces) are stock items with Prep Item = Y and their own 'prep' recipe.",
    "6. In the back office go to Data → Import from Excel, choose this file, review the check results, then confirm.",
    "",
    "Re-importing updates matching codes and adds new ones; nothing is deleted. Rows with errors are skipped and listed.",
  ].forEach((t, i) => {
    const row = info.addRow([t]);
    if (i === 0) row.font = { bold: true, size: 16 };
    if (t === "How to use:") row.font = { bold: true };
  });

  const items = new Map(data.inventoryItems.map((i) => [i.id, i]));
  const add = (key: keyof typeof SHEETS, rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(SHEETS[key]);
    styleSheet(ws, COLUMNS[key], rows.length);
    rows.forEach((r) => ws.addRow(r));
  };
  add("categories", data.categories.map((c) => ({ code: c.id, name: c.name, majorGroup: c.majorGroup, color: c.color, sort: c.sortOrder })));
  add(
    "menuItems",
    data.menuItems.map((m) => ({
      code: m.code,
      name: m.name,
      nameSi: m.nameSi ?? "",
      nameTa: m.nameTa ?? "",
      category: m.categoryId,
      price: rupees(m.price),
      taxClass: m.taxClass,
      kotRoute: m.kotRoute,
      modifiers: m.modifierGroupIds.join(", "),
      allergens: m.allergens.join(", "),
      description: m.description ?? "",
      active: yn(m.active),
    })),
  );
  add("modifierGroups", data.modifierGroups.map((g) => ({ code: g.id, name: g.name, min: g.min, max: g.max })));
  add(
    "modifierOptions",
    data.modifierGroups.flatMap((g) => g.options.map((o) => ({ group: g.id, name: o.name, price: rupees(o.price), stockItem: o.inventoryItemId ?? "", qty: o.qty ?? "" }))),
  );
  add(
    "inventoryItems",
    data.inventoryItems.map((i) => ({
      code: i.code,
      name: i.name,
      category: i.category,
      majorGroup: i.majorGroup,
      stockUnit: i.stockUnit,
      purchaseUnit: i.purchaseUnit,
      factor: i.purchaseFactor,
      cost: rupees(i.purchaseCost),
      vendor: i.vendorId ?? "",
      par: i.parLevel,
      reorder: i.reorderQty,
      prep: yn(i.isPrep),
      track: yn(i.trackStock),
    })),
  );
  add(
    "recipes",
    data.recipes.flatMap((r) =>
      r.lines.map((l, idx) => ({
        for: r.id,
        type: r.kind,
        yield: idx === 0 ? r.yieldQty : "",
        ingredient: l.inventoryItemId,
        ingredientName: items.get(l.inventoryItemId)?.name ?? "",
        qty: l.qty,
        unit: items.get(l.inventoryItemId)?.stockUnit ?? "",
      })),
    ),
  );
  add(
    "vendors",
    data.vendors.map((v) => ({ code: v.code, name: v.name, contact: v.contactName ?? "", phone: v.phone, email: v.email ?? "", address: v.address ?? "", vat: v.vatNumber ?? "", terms: v.paymentTermsDays })),
  );
  add(
    "customers",
    data.customers.map((c) => ({ phone: c.phone, name: c.name, email: c.email ?? "", birthday: c.birthday ?? "", tags: c.tags.join(", "), consent: yn(c.marketingConsent), tin: c.vatTin ?? "", address: c.address ?? "" })),
  );
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

// ───────────────────────────── Import ─────────────────────────────

export interface ImportIssue {
  sheet: string;
  row: number;
  message: string;
}

export interface ImportResult {
  data: FeederData;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    return "";
  }
  return String(v).trim();
}

function readSheet(wb: ExcelJS.Workbook, key: keyof typeof SHEETS): { row: number; get: (k: string) => string }[] {
  const ws = wb.getWorksheet(SHEETS[key]);
  if (!ws) return [];
  const headers = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => headers.set(cellText(cell.value).toLowerCase(), col));
  const colFor = new Map(COLUMNS[key].map((c) => [c.key, headers.get(c.header.toLowerCase())]));
  const out: { row: number; get: (k: string) => string }[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const get = (k: string) => {
      const col = colFor.get(k);
      return col ? cellText(row.getCell(col).value) : "";
    };
    if (COLUMNS[key].every((c) => get(c.key) === "")) return;
    out.push({ row: n, get });
  });
  return out;
}

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Parses and validates a data feeder workbook. `existing` lets references point at records that
 * are already in the system (e.g. a menu sheet that uses existing categories).
 */
export async function parseFeederWorkbook(buffer: ArrayBuffer, existing: Partial<{ categoryIds: string[]; inventoryIds: string[]; modifierGroupIds: string[]; vendorIds: string[]; menuItemIds: string[] }> = {}): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const data: FeederData = { categories: [], menuItems: [], modifierGroups: [], inventoryItems: [], recipes: [], vendors: [], customers: [] };
  const err = (sheet: string, row: number, message: string) => errors.push({ sheet, row, message });
  const num = (sheet: string, row: number, label: string, v: string, opts: { required?: boolean; min?: number } = {}): number | null => {
    if (v === "") {
      if (opts.required) err(sheet, row, `${label} is required`);
      return opts.required ? null : 0;
    }
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n)) {
      err(sheet, row, `${label} must be a number (got "${v}")`);
      return null;
    }
    if (opts.min !== undefined && n < opts.min) {
      err(sheet, row, `${label} must be at least ${opts.min}`);
      return null;
    }
    return n;
  };
  const id = (sheet: string, row: number, label: string, v: string): string | null => {
    if (!v) {
      err(sheet, row, `${label} is required`);
      return null;
    }
    try {
      return codeToId(v);
    } catch {
      err(sheet, row, `${label} "${v}" is not a valid code`);
      return null;
    }
  };
  const flag = (v: string, dflt: boolean) => (v === "" ? dflt : /^(y|yes|true|1)$/i.test(v));
  const seen = (sheet: string, row: number, set: Set<string>, key: string) => {
    if (set.has(key)) {
      err(sheet, row, `Duplicate code ${key}`);
      return true;
    }
    set.add(key);
    return false;
  };

  // Categories
  const catIds = new Set<string>();
  for (const { row, get } of readSheet(wb, "categories")) {
    const S = SHEETS.categories;
    const code = id(S, row, "Code", get("code"));
    const name = get("name");
    const mg = (get("majorGroup") || "Food") as MajorGroup;
    if (!name) err(S, row, "Name is required");
    if (!MAJOR_GROUPS.includes(mg)) err(S, row, `Major Group must be one of ${MAJOR_GROUPS.join(", ")}`);
    if (!code || !name || !MAJOR_GROUPS.includes(mg) || seen(S, row, catIds, code)) continue;
    data.categories.push({ id: code, name, majorGroup: mg, color: get("color") || "#64748B", sortOrder: Number(get("sort")) || data.categories.length + 1, active: true });
  }
  const knownCats = new Set([...catIds, ...(existing.categoryIds ?? [])]);

  // Vendors
  const vendorIds = new Set<string>();
  for (const { row, get } of readSheet(wb, "vendors")) {
    const S = SHEETS.vendors;
    const code = id(S, row, "Code", get("code"));
    const name = get("name");
    if (!name) err(S, row, "Name is required");
    const terms = num(S, row, "Payment Terms", get("terms"), { min: 0 });
    if (!code || !name || terms === null || seen(S, row, vendorIds, code)) continue;
    data.vendors.push({
      id: code, code, name, phone: get("phone"), paymentTermsDays: terms, active: true,
      ...(get("contact") ? { contactName: get("contact") } : {}),
      ...(get("email") ? { email: get("email") } : {}),
      ...(get("address") ? { address: get("address") } : {}),
      ...(get("vat") ? { vatNumber: get("vat") } : {}),
    });
  }
  const knownVendors = new Set([...vendorIds, ...(existing.vendorIds ?? [])]);

  // Stock items
  const invIds = new Set<string>();
  for (const { row, get } of readSheet(wb, "inventoryItems")) {
    const S = SHEETS.inventoryItems;
    const code = id(S, row, "Code", get("code"));
    const name = get("name");
    const unit = get("stockUnit") as StockUnit;
    const mg = (get("majorGroup") || "Food") as MajorGroup;
    if (!name) err(S, row, "Name is required");
    if (!UNITS.includes(unit)) err(S, row, `Stock Unit must be g, ml or pcs (got "${get("stockUnit")}")`);
    if (!MAJOR_GROUPS.includes(mg)) err(S, row, `Major Group must be one of ${MAJOR_GROUPS.join(", ")}`);
    const isPrep = flag(get("prep"), false);
    const factor = num(S, row, "Stock Units per Purchase Unit", get("factor") || "1", { min: 0.000001 });
    const cost = num(S, row, "Cost per Purchase Unit", get("cost"), { required: !isPrep, min: 0 });
    const par = num(S, row, "Par Level", get("par"), { min: 0 });
    const reorder = num(S, row, "Reorder Qty", get("reorder"), { min: 0 });
    const vendor = get("vendor") ? codeToId(get("vendor")) : "";
    if (vendor && !knownVendors.has(vendor)) warnings.push({ sheet: S, row, message: `Vendor ${vendor} not found; item imported without a vendor` });
    if (!code || !name || !UNITS.includes(unit) || !MAJOR_GROUPS.includes(mg) || factor === null || cost === null || par === null || reorder === null || seen(S, row, invIds, code)) continue;
    data.inventoryItems.push({
      id: code, code, name, category: get("category") || "General", majorGroup: mg, stockUnit: unit,
      purchaseUnit: get("purchaseUnit") || unit, purchaseFactor: factor, purchaseCost: Math.round(cost * 100),
      ...(vendor && knownVendors.has(vendor) ? { vendorId: vendor } : {}),
      parLevel: par, reorderQty: reorder, isPrep, trackStock: flag(get("track"), !isPrep), active: true,
    });
  }
  const knownInv = new Set([...invIds, ...(existing.inventoryIds ?? [])]);

  // Modifier groups and options
  const groupIds = new Set<string>();
  const groups = new Map<string, ModifierGroup>();
  for (const { row, get } of readSheet(wb, "modifierGroups")) {
    const S = SHEETS.modifierGroups;
    const code = id(S, row, "Group Code", get("code"));
    const min = num(S, row, "Min", get("min"), { min: 0 });
    const max = num(S, row, "Max", get("max") || "1", { min: 1 });
    if (!get("name")) err(S, row, "Group Name is required");
    if (min !== null && max !== null && min > max) err(S, row, "Min cannot exceed Max");
    if (!code || !get("name") || min === null || max === null || min > max || seen(S, row, groupIds, code)) continue;
    const g: ModifierGroup = { id: code, name: get("name"), min, max, options: [] };
    groups.set(code, g);
    data.modifierGroups.push(g);
  }
  for (const { row, get } of readSheet(wb, "modifierOptions")) {
    const S = SHEETS.modifierOptions;
    const gid = get("group") ? codeToId(get("group")) : "";
    const g = groups.get(gid);
    if (!g) {
      err(S, row, `Group ${gid || "(blank)"} is not on the Modifier Groups sheet`);
      continue;
    }
    if (!get("name")) {
      err(S, row, "Option is required");
      continue;
    }
    const price = num(S, row, "Price", get("price"), { min: 0 });
    const stock = get("stockItem") ? codeToId(get("stockItem")) : "";
    const qty = num(S, row, "Stock Qty", get("qty"), { min: 0 });
    if (stock && !knownInv.has(stock)) err(S, row, `Stock item ${stock} not found`);
    if (price === null || qty === null || (stock && !knownInv.has(stock))) continue;
    g.options.push({ id: `${g.id}-${g.options.length + 1}`, name: get("name"), price: Math.round(price * 100), ...(stock ? { inventoryItemId: stock, qty } : {}) });
  }
  for (const g of data.modifierGroups) if (g.options.length === 0) warnings.push({ sheet: SHEETS.modifierGroups, row: 0, message: `Group ${g.id} has no options` });
  const knownGroups = new Set([...groupIds, ...(existing.modifierGroupIds ?? [])]);

  // Menu items
  const menuIds = new Set<string>();
  for (const { row, get } of readSheet(wb, "menuItems")) {
    const S = SHEETS.menuItems;
    const code = id(S, row, "Code", get("code"));
    const name = get("name");
    if (!name) err(S, row, "Name is required");
    const cat = get("category") ? codeToId(get("category")) : "";
    if (!knownCats.has(cat)) err(S, row, `Category ${cat || "(blank)"} not found`);
    const price = num(S, row, "Price", get("price"), { required: true, min: 0 });
    const route = (get("kotRoute") || "kitchen") as MenuItem["kotRoute"];
    if (!["kitchen", "bar", "none"].includes(route)) err(S, row, "KOT Route must be kitchen, bar or none");
    const mods = list(get("modifiers")).map((m) => codeToId(m));
    const missingMods = mods.filter((m) => !knownGroups.has(m));
    if (missingMods.length) err(S, row, `Modifier group(s) not found: ${missingMods.join(", ")}`);
    if (!code || !name || !knownCats.has(cat) || price === null || missingMods.length || !["kitchen", "bar", "none"].includes(route) || seen(S, row, menuIds, code)) continue;
    data.menuItems.push({
      id: code, code, name, categoryId: cat, price: Math.round(price * 100), taxClass: get("taxClass") || "standard", kotRoute: route,
      modifierGroupIds: mods, allergens: list(get("allergens")).map((a) => a.toLowerCase()), available: true,
      active: flag(get("active"), true), sortOrder: data.menuItems.length + 1,
      ...(get("nameSi") ? { nameSi: get("nameSi") } : {}),
      ...(get("nameTa") ? { nameTa: get("nameTa") } : {}),
      ...(get("description") ? { description: get("description") } : {}),
    });
  }
  const knownMenu = new Set([...menuIds, ...(existing.menuItemIds ?? [])]);

  // Recipes
  const recipes = new Map<string, Recipe>();
  for (const { row, get } of readSheet(wb, "recipes")) {
    const S = SHEETS.recipes;
    const target = id(S, row, "Recipe For", get("for"));
    const kind = (get("type") || "menu") as Recipe["kind"];
    const ing = id(S, row, "Ingredient Code", get("ingredient"));
    const qty = num(S, row, "Qty", get("qty"), { required: true, min: 0 });
    if (!target || !ing || qty === null) continue;
    if (kind !== "menu" && kind !== "prep") {
      err(S, row, "Type must be menu or prep");
      continue;
    }
    if (kind === "menu" && !knownMenu.has(target)) {
      err(S, row, `Menu item ${target} not found`);
      continue;
    }
    if (kind === "prep" && !knownInv.has(target)) {
      err(S, row, `Prep item ${target} not found on Stock Items`);
      continue;
    }
    if (!knownInv.has(ing)) {
      err(S, row, `Ingredient ${ing} not found on Stock Items`);
      continue;
    }
    let r = recipes.get(target);
    if (!r) {
      const y = num(S, row, "Yield", get("yield") || "1", { min: 0.000001 });
      if (y === null) continue;
      r = { id: target, kind, yieldQty: y, lines: [] };
      recipes.set(target, r);
    }
    r.lines.push({ inventoryItemId: ing, qty });
  }
  data.recipes = [...recipes.values()];
  for (const m of data.menuItems) if (!recipes.has(m.id)) warnings.push({ sheet: SHEETS.menuItems, row: 0, message: `${m.code} ${m.name} has no recipe (cost will show as zero)` });

  // Customers
  const phones = new Set<string>();
  for (const { row, get } of readSheet(wb, "customers")) {
    const S = SHEETS.customers;
    const phone = get("phone").replace(/[^\d+]/g, "");
    if (!phone || !get("name")) {
      err(S, row, "Phone and Name are required");
      continue;
    }
    if (seen(S, row, phones, phone)) continue;
    data.customers.push({
      id: `TEL${phone.replace(/\D/g, "")}`, name: get("name"), phone: get("phone"), tags: list(get("tags")),
      marketingConsent: flag(get("consent"), false), visits: 0, totalSpend: 0, points: 0, createdAt: new Date().toISOString(),
      ...(get("email") ? { email: get("email") } : {}),
      ...(get("birthday") ? { birthday: get("birthday") } : {}),
      ...(get("tin") ? { vatTin: get("tin") } : {}),
      ...(get("address") ? { address: get("address") } : {}),
    });
  }
  return { data, errors, warnings };
}

/**
 * Write operations for an import. Master records are merged (keeping fields the sheet does not
 * carry, such as availability or a customer's visit history); recipes are replaced as a whole.
 */
export function importOps(data: FeederData): WriteOp[] {
  const merge = (col: string, doc: { id: string }): WriteOp => ({ op: "merge", col, id: doc.id, data: { ...doc } });
  const customerMerge = (c: Customer): WriteOp => {
    const { visits: _v, totalSpend: _t, points: _p, createdAt: _c, ...rest } = c;
    return { op: "merge", col: C.customers, id: c.id, data: rest };
  };
  return [
    ...data.categories.map((d) => merge(C.menuCategories, d)),
    ...data.vendors.map((d) => merge(C.vendors, d)),
    ...data.inventoryItems.map((d) => merge(C.inventoryItems, d)),
    ...data.modifierGroups.map((d): WriteOp => ({ op: "set", col: C.modifierGroups, data: d })),
    ...data.menuItems.map((d) => {
      const { available: _a, ...rest } = d;
      return merge(C.menuItems, rest);
    }),
    ...data.recipes.map((d): WriteOp => ({ op: "set", col: C.recipes, data: d })),
    ...data.customers.map(customerMerge),
  ];
}
