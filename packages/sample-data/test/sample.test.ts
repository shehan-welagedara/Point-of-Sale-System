import { describe, expect, it } from "vitest";
import {
  type Check,
  type Invoice,
  type DailyStats,
  type InventoryItem,
  type MenuItem,
  type Recipe,
  type StockLevel,
  COLLECTIONS as C,
  costRecipe,
  costingContext,
} from "@pos/core";
import { type AccountBalance, type LedgerEntry, type Voucher, LEDGER as L, balanceSheet, defaultChartOfAccounts, trialBalance, verifyInvoices, verifyLedger } from "@pos/ledger";
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

    // Books built through the ledger verify cleanly and balance.
    const vouchers = await store.list<Voucher>(L.vouchers);
    expect(vouchers.filter((v) => v.type === "posDay" && v.status === "posted").length).toBeGreaterThanOrEqual(8);
    expect(vouchers.filter((v) => v.status === "submitted").map((v) => v.id).sort()).toEqual(["PI-V002", "UTIL-NOV"]);
    expect(await verifyLedger(vouchers, await store.list<LedgerEntry>(L.ledger), await store.list<AccountBalance>(L.balances))).toEqual([]);
    expect(await verifyInvoices(await store.list<Invoice>(C.invoices))).toEqual([]);
    const tb = trialBalance(defaultChartOfAccounts(), await store.list<AccountBalance>(L.balances), { fromPeriod: "2026-04", toPeriod: "2027-03", fyStartPeriod: "2026-04" });
    expect(tb.totals.debit).toBe(tb.totals.credit);
    const bs = balanceSheet(defaultChartOfAccounts(), await store.list<AccountBalance>(L.balances), { asOfPeriod: "2026-11", fyStartPeriod: "2026-04" });
    expect(bs.balanced).toBe(true);
    // Uninvoiced receipts remain in goods received not billed.
    expect((await store.list<AccountBalance>(L.balances)).filter((b) => b.account === "2010").reduce((a, b) => a + b.credit - b.debit, 0)).toBeGreaterThan(0);

    const rice = await store.get<StockLevel>(C.stockLevels, `MAIN__${INVENTORY_CODES.get("riceSamba")}`);
    expect(rice!.qty).toBeGreaterThan(0);
    expect(rice!.qty).toBeLessThan(75_000);
  });
});
