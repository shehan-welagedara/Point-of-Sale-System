import { describe, expect, it } from "vitest";
import {
  type Check,
  type DailyStats,
  type InventoryItem,
  type JournalEntry,
  type MenuItem,
  type Recipe,
  type StockLevel,
  COLLECTIONS as C,
  costRecipe,
  costingContext,
} from "@pos/core";
import { INVENTORY_CODES, MENU, RECIPES, buildSampleStore } from "../src/index.js";

describe("sample dataset", () => {
  it("builds a consistent demo tenant through the real services", async () => {
    const { store, tenant } = await buildSampleStore({ today: "2026-11-03", historyDays: 7, checksPerDay: 12 });
    expect(tenant.modules.pos).toBe(true);

    const menu = await store.list<MenuItem>(C.menuItems);
    expect(menu).toHaveLength(MENU.length);
    expect(Object.keys(RECIPES).sort()).toEqual(MENU.map((m) => m[0]).sort());
    // Every recipe costs cleanly and food cost lands in a realistic band.
    const ctx = costingContext(await store.list<InventoryItem>(C.inventoryItems), await store.list<Recipe>(C.recipes));
    for (const m of menu) {
      const rc = costRecipe(ctx.recipes.get(m.id)!, ctx);
      expect(rc.warnings, m.name).toEqual([]);
      const pct = (m.cost ?? 0) / m.price;
      expect(pct, m.name).toBeGreaterThan(0.05);
      expect(pct, m.name).toBeLessThan(0.45);
    }

    const checks = await store.list<Check>(C.checks);
    expect(checks.length).toBeGreaterThan(80);
    expect(checks.every((c) => c.status === "closed" && c.depletion === "done" && c.invoiceNo)).toBe(true);
    const stats = await store.list<DailyStats>(C.dailyStats);
    expect(stats).toHaveLength(8);
    expect(stats.reduce((a, s) => a + s.checks, 0)).toBe(checks.length);

    const journals = await store.list<JournalEntry>(C.journals);
    expect(journals.length).toBeGreaterThanOrEqual(8);
    for (const j of journals) {
      expect(j.lines.reduce((a, l) => a + l.debit, 0)).toBe(j.lines.reduce((a, l) => a + l.credit, 0));
    }

    const rice = await store.get<StockLevel>(C.stockLevels, `MAIN__${INVENTORY_CODES.get("riceSamba")}`);
    expect(rice!.qty).toBeGreaterThan(0);
    expect(rice!.qty).toBeLessThan(75_000);
  });
});
