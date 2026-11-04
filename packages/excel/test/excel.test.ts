import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  type Customer,
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type Recipe,
  type Vendor,
  COLLECTIONS as C,
  MemoryStore,
} from "@pos/core";
import { buildSampleStore } from "@pos/sample-data";
import { SHEETS, buildFeederWorkbook, importOps, parseFeederWorkbook, tablesToWorkbook } from "../src/index.js";

async function sampleData() {
  const { store } = await buildSampleStore({ today: "2026-11-03", historyDays: 0, checksPerDay: 1 });
  return {
    categories: await store.list<MenuCategory>(C.menuCategories),
    menuItems: await store.list<MenuItem>(C.menuItems),
    modifierGroups: await store.list<ModifierGroup>(C.modifierGroups),
    inventoryItems: await store.list<InventoryItem>(C.inventoryItems),
    recipes: await store.list<Recipe>(C.recipes),
    vendors: await store.list<Vendor>(C.vendors),
    customers: await store.list<Customer>(C.customers),
  };
}

describe("data feeder workbook", () => {
  it("round-trips the sample data through Excel and imports it", async () => {
    const data = await sampleData();
    const buf = await buildFeederWorkbook(data);
    const res = await parseFeederWorkbook(buf);
    expect(res.errors).toEqual([]);
    expect(res.data.menuItems).toHaveLength(data.menuItems.length);
    expect(res.data.recipes).toHaveLength(data.recipes.length);
    expect(res.data.modifierGroups.find((g) => g.id === "KOTTU-EXTRA")!.options[0]).toMatchObject({ name: "Extra cheese", price: 30_000, qty: 40 });
    const kottu = res.data.menuItems.find((m) => m.id === "K001")!;
    expect(kottu).toMatchObject({ price: 120_000, modifierGroupIds: ["SPICE", "KOTTU-EXTRA"], allergens: ["gluten", "egg"], nameSi: "කුකුල් මස් කොත්තු" });
    expect(res.data.recipes.find((r) => r.id === "K001")!.lines).toEqual(data.recipes.find((r) => r.id === "K001")!.lines);

    const store = new MemoryStore();
    await store.set(C.menuItems, { id: "K001", available: false, cost: 1 });
    await store.batch(importOps(res.data));
    const stored = await store.get<MenuItem>(C.menuItems, "K001");
    expect(stored).toMatchObject({ price: 120_000, available: false });
  });

  it("reports row-level errors without importing bad rows", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildFeederWorkbook({ categories: [], menuItems: [], modifierGroups: [], inventoryItems: [], recipes: [], vendors: [], customers: [] }));
    // Template sheets carry drop-down validation on empty rows, so write rows explicitly.
    const put = (sheet: string, row: number, values: (string | number)[]) => {
      wb.getWorksheet(sheet)!.getRow(row).values = values;
    };
    put(SHEETS.categories, 2, ["MAINS", "Mains", "Food"]);
    put(SHEETS.menuItems, 2, ["M1", "Good item", "", "", "MAINS", 1000]);
    put(SHEETS.menuItems, 3, ["M2", "Bad price", "", "", "MAINS", "abc"]);
    put(SHEETS.menuItems, 4, ["M3", "Bad category", "", "", "NOPE", 500]);
    put(SHEETS.inventoryItems, 2, ["I1", "Rice", "Grains", "Food", "kg", "kg", 1, 280]);
    put(SHEETS.recipes, 2, ["M1", "menu", 1, "I404", "", 100]);
    const res = await parseFeederWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    expect(res.data.menuItems.map((m) => m.id)).toEqual(["M1"]);
    expect(res.errors.map((e) => `${e.sheet}:${e.row}`)).toEqual(["Stock Items:2", "Menu Items:3", "Menu Items:4", "Recipes:2"]);
    expect(res.errors[0]!.message).toMatch(/g, ml or pcs/);
  });

  it("exports report tables with money as numbers", async () => {
    const buf = await tablesToWorkbook([{ name: "Sales", columns: [{ header: "Item", value: (r: { n: string }) => r.n }, { header: "Net", format: "money", value: (r: { c: number }) => r.c }], rows: [{ n: "Kottu", c: 120_050 }], totals: true }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.getWorksheet("Sales")!.getCell("B2").value).toBe(1200.5);
  });
});
