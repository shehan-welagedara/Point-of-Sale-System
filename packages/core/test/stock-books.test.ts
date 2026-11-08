import { describe, expect, it } from "vitest";
import { type AccountingSettings, type InventoryItem, COLLECTIONS as C, MemoryStore, buildDailyJournal, postStockCount, runStaffAuth, hashPin, withStaffSecrets } from "../src/index.js";

const accounts: AccountingSettings["accounts"] = {
  salesByMajorGroup: { Food: "4000", Beverage: "4010", Other: "4020" },
  serviceCharge: "4300", vatOutput: "2100", vatInput: "1300", ssclPayable: "2120", tdlPayable: "2130", discounts: "4900", rounding: "4950",
  inventory: "1200", cogsByMajorGroup: { Food: "5000", Beverage: "5010", Other: "5020" }, wastage: "5100", stockAdjustment: "5110", accountsPayable: "2000", complimentary: "5200",
};
const settings = { id: "accounting", accounts } as AccountingSettings;
const rice: InventoryItem = { id: "RICE", code: "RICE", name: "Rice", category: "Dry", majorGroup: "Food", stockUnit: "g", purchaseUnit: "kg", purchaseFactor: 1000, purchaseCost: 30_000, parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, active: true };

describe("stock without POS sales", () => {
  it("posts opening stock against opening balances and counted usage to cost of sales", async () => {
    const store = new MemoryStore();
    await store.set(C.inventoryItems, rice);
    await store.set(C.locations, { id: "MAIN", name: "Main store", isDefault: true });
    // Opening count: 50 kg on the shelf on the first day (Rs 300 per kg).
    await store.set(C.stockCounts, { id: "C1", locationId: "MAIN", date: "2026-04-01", status: "draft", kind: "opening", lines: [{ itemId: "RICE", counted: 50_000 }] });
    const opening = await postStockCount(store, "C1");
    expect(opening?.type).toBe("opening");
    expect(opening?.lines[0]?.cost).toBe(1_500_000);
    // A week later 30 kg is left: the kitchen used 20 kg.
    await store.set(C.stockCounts, { id: "C2", locationId: "MAIN", date: "2026-04-08", status: "draft", kind: "usage", lines: [{ itemId: "RICE", counted: 30_000 }] });
    const usage = await postStockCount(store, "C2");
    expect(usage?.type).toBe("usage");
    expect(usage?.costByMajorGroup?.Food).toBe(600_000);

    const j1 = buildDailyJournal({ date: "2026-04-01", propertyId: "MAIN", stats: null, movements: [opening!], receipts: [], receiptValues: new Map(), tenders: [], settings });
    const byAcc = (j: typeof j1) => Object.fromEntries(j.lines.map((l) => [l.accountCode, l.debit - l.credit]));
    expect(byAcc(j1)).toEqual({ "1200": 1_500_000, "3900": -1_500_000 });
    const j2 = buildDailyJournal({ date: "2026-04-08", propertyId: "MAIN", stats: null, movements: [usage!], receipts: [], receiptValues: new Map(), tenders: [], settings });
    expect(byAcc(j2)).toEqual({ "5000": 600_000, "1200": -600_000 });
  });

  it("keeps PIN hashes off staff records and checks PINs with lockout", async () => {
    const store = withStaffSecrets(new MemoryStore());
    const { hash, salt } = await hashPin("5823");
    await store.set(C.staff, { id: "7", employeeNo: "7", name: "Asha", roleId: "cashier", propertyIds: [], status: "active", pinHash: hash, pinSalt: salt, cardId: "CARD-7" } as never);
    const staff = await store.get<Record<string, unknown>>(C.staff, "7");
    expect(staff?.pinHash).toBeUndefined();
    expect(staff?.cardId).toBeUndefined();
    expect(staff?.pinSet).toBe(true);
    expect((await store.get<Record<string, unknown>>(C.staffSecrets, "7"))?.pinHash).toBe(hash);
    expect(await runStaffAuth(store, { action: "identifyCard", card: "CARD-7" })).toMatchObject({ ok: true, staffId: "7" });
    expect(await runStaffAuth(store, { action: "verify", staffId: "7", pin: "1111", purpose: "approve" })).toMatchObject({ ok: false, triesLeft: 4 });
    expect(await runStaffAuth(store, { action: "verify", staffId: "7", pin: "5823", purpose: "signIn" })).toMatchObject({ ok: true });
  });
});
