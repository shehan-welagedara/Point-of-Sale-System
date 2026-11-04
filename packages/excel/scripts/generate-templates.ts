/** Writes the Excel data feeder templates to /templates (sample-filled and blank). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Customer,
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type Recipe,
  type Vendor,
  COLLECTIONS as C,
} from "@pos/core";
import { buildSampleStore } from "@pos/sample-data";
import { buildFeederWorkbook } from "../src/index.js";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../../templates");
mkdirSync(out, { recursive: true });
const { store } = await buildSampleStore({ today: "2026-11-03", historyDays: 0, checksPerDay: 1 });
const data = {
  categories: await store.list<MenuCategory>(C.menuCategories),
  menuItems: await store.list<MenuItem>(C.menuItems),
  modifierGroups: await store.list<ModifierGroup>(C.modifierGroups),
  inventoryItems: await store.list<InventoryItem>(C.inventoryItems),
  recipes: await store.list<Recipe>(C.recipes),
  vendors: await store.list<Vendor>(C.vendors),
  customers: await store.list<Customer>(C.customers),
};
writeFileSync(resolve(out, "data-feeder-sample.xlsx"), Buffer.from(await buildFeederWorkbook(data, { title: "Restaurant data feeder – SAMPLE DATA (Spice Lagoon demo)" })));
writeFileSync(
  resolve(out, "data-feeder-blank.xlsx"),
  Buffer.from(await buildFeederWorkbook({ categories: [], menuItems: [], modifierGroups: [], inventoryItems: [], recipes: [], vendors: [], customers: [] }, { title: "Restaurant data feeder" })),
);
console.log(`Templates written to ${out}`);
