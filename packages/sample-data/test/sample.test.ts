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
  dataHealth,
  HEALTH_COLLECTIONS,
} from "@pos/core";
import { type AccountBalance, type LedgerEntry, type Voucher, LEDGER as L, balanceSheet, defaultChartOfAccounts, trialBalance, verifyInvoices, verifyLedger } from "@pos/ledger";
import { INVENTORY_CODES, MENU, RECIPES, buildSampleStore } from "../src/index.js";
import type { Staff, Workstation, TenderMedia, BusinessSettings } from "@pos/core";

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
    // Every master record is valid and every cross-module reference resolves.
    const snapshot = Object.fromEntries(await Promise.all(HEALTH_COLLECTIONS.map(async (col) => [col, await store.list<Record<string, unknown>>(col)] as const)));
    const health = dataHealth(snapshot, tenant.modules);
    expect(health.filter((h) => h.severity === "error").map((h) => `${h.collection}/${h.id}: ${h.message}`)).toEqual([]);
    expect(health.map((h) => `${h.collection}/${h.id}: ${h.message}`)).toEqual([]);
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

  it("builds a Noura Kitchen-style demo: not VAT registered, one counter phone, clean books", async () => {
    const { store, tenant } = await buildSampleStore({ today: "2026-11-11", historyDays: 14, checksPerDay: 12, kind: "noura-kitchen" });
    expect(tenant.name).toBe("Noura Kitchen (demo)");
    expect(tenant.modules.accounting && tenant.modules.inventory && tenant.modules.purchasing && tenant.modules.pos).toBe(true);
    expect(tenant.modules.loyalty).toBe(false);

    const business = await store.get<BusinessSettings>(C.settings, "business");
    expect(business!.vatRegistered).toBe(false);
    expect(business!.ssclLiable).toBe(false);
    const ws = await store.list<Workstation>(C.workstations);
    expect(ws.map((w) => `${w.id}:${w.printMode}`).sort()).toEqual(["P01:bluetooth", "W01:preview"]);
    expect(await store.list(C.printers)).toEqual([]);
    const staff = await store.list<Staff>(C.staff);
    expect(staff.map((p) => p.id)).toContain("1001");
    expect(staff.every((p) => (p.rvcIds ?? []).every((r) => r === "RESTAURANT" || r === "TAKEAWAY"))).toBe(true);
    expect((await store.list<TenderMedia>(C.tenderMedia)).filter((t) => t.active).map((t) => t.id).sort()).toEqual(["CARD-VM", "CASH", "LANKAQR"]);

    // Every sale was taken on the counter phone and billed without VAT or SSCL.
    const checks = await store.list<Check>(C.checks);
    expect(checks.length).toBeGreaterThan(120);
    expect(checks.every((c) => c.workstationId === "P01" && c.status === "closed" && c.invoiceNo)).toBe(true);
    const invoices = await store.list<Invoice>(C.invoices);
    expect(invoices.every((i) => i.totals.vatTotal === 0 && !i.totals.charges.some((ch) => ch.kind === "levy"))).toBe(true);
    expect(invoices.some((i) => i.totals.charges.some((ch) => ch.kind === "serviceCharge"))).toBe(true); // service charge on dine-in
    expect(await verifyInvoices(invoices)).toEqual([]);

    const vouchers = await store.list<Voucher>(L.vouchers);
    expect(vouchers.filter((v) => v.status === "submitted").map((v) => v.id).sort()).toEqual(["PI-V002", "UTIL-NOV"]);
    const balances = await store.list<AccountBalance>(L.balances);
    expect(await verifyLedger(vouchers, await store.list<LedgerEntry>(L.ledger), balances)).toEqual([]);
    expect(balances.every((b) => b.costCenter === "MAIN" || b.costCenter === undefined)).toBe(true);
    const net = (account: string) => balances.filter((b) => b.account === account).reduce((a, b) => a + b.debit - b.credit, 0);
    expect(net("2100")).toBe(0); // no VAT output
    expect(net("1300")).toBe(0); // no VAT input claimed
    expect(net("2120")).toBe(0); // no SSCL
    expect(net("1000")).toBeGreaterThan(2_500_000); // the till's opening Rs 25,000 plus cash sales
    const tb = trialBalance(defaultChartOfAccounts(), balances, { fromPeriod: "2026-04", toPeriod: "2027-03", fyStartPeriod: "2026-04" });
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(balanceSheet(defaultChartOfAccounts(), balances, { asOfPeriod: "2026-11", fyStartPeriod: "2026-04" }).balanced).toBe(true);

    const snapshot = Object.fromEntries(await Promise.all(HEALTH_COLLECTIONS.map(async (col) => [col, await store.list<Record<string, unknown>>(col)] as const)));
    expect(dataHealth(snapshot, tenant.modules).map((h) => `${h.collection}/${h.id}: ${h.message}`)).toEqual([]);
  });
});
