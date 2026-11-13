import { describe, expect, it } from "vitest";
import {
  type Check,
  type DailyStats,
  type GoodsReceipt,
  type StockLevel,
  COLLECTIONS as C,
  MemoryStore,
  addLot,
  allModulesOn,
  buildDailyJournal,
  closeCheck,
  computeCheckTotals,
  consumeFifo,
  costMenuItem,
  costRecipe,
  costingContext,
  crc16,
  emptyLevel,
  hashPin,
  itemUnitCost,
  lankaQrPayload,
  makePayment,
  md5,
  menuEngineering,
  mergeStats,
  newCheck,
  payhereHash,
  postGoodsReceipt,
  postStockCount,
  processDepletion,
  receiptValue,
  recordWaste,
  reorderSuggestions,
  sendRound,
  setModule,
  stockLevelId,
  suggestedPrice,
  verifyPayhereNotify,
  verifyPin,
} from "../src/index.js";
import { accounting, business, inventoryItems, menuItems, posContext, recipes, seededStore, tax, tenders } from "./fixtures.js";

describe("MemoryStore", () => {
  it("queries, merges, increments and notifies watchers", async () => {
    const s = new MemoryStore();
    const seen: number[] = [];
    s.watch<{ id: string }>("x", { where: [["n", ">=", 2]] }, (d) => seen.push(d.length));
    await s.set("x", { id: "a", n: 1 });
    await s.set("x", { id: "b", n: 3 });
    await s.merge("x", "b", { deep: { k: 1 } });
    await s.increment("x", "b", { n: 2, deep: { k: 5, j: 1 } });
    expect(await s.get("x", "b")).toEqual({ id: "b", n: 5, deep: { k: 6, j: 1 } });
    expect((await s.list<{ id: string }>("x", { orderBy: ["n", "desc"], limit: 1 }))[0]!.id).toBe("b");
    await s.increment("y", "new", { a: 1 }, { label: "base" });
    expect(await s.get("y", "new")).toEqual({ id: "new", label: "base", a: 1 });
    expect(seen.at(-1)).toBe(1);
  });
});

describe("modules", () => {
  it("switches dependencies on and dependants off", () => {
    let m = setModule({}, "purchasing", true);
    expect(m).toMatchObject({ purchasing: true, inventory: true });
    expect(m.recipes).toBeUndefined();
    m = setModule(m, "inventory", false);
    expect(m).toMatchObject({ purchasing: false, inventory: false });
    expect(setModule({}, "wholesale", true)).toMatchObject({ wholesale: true, inventory: true, crm: true });
    expect(allModulesOn().website).toBe(false);
  });
});

describe("costing", () => {
  const ctx = costingContext(inventoryItems, recipes);

  it("costs purchased and prep items (sub-recipes)", () => {
    expect(itemUnitCost("CHICKEN", ctx).cost).toBe(160);
    // curry: (1000 g × 160 + 200 g × 38) / 1000 g = 167.6 c/g
    expect(itemUnitCost("CURRY", ctx).cost).toBeCloseTo(167.6);
    const kottu = costRecipe(recipes.find((r) => r.id === "K001")!, ctx);
    // 2 roti × 6000 + 150 g × 167.6 + 1 egg × 4500 = 12000 + 25140 + 4500
    expect(kottu.unitCost).toBe(41_640);
    expect(kottu.warnings).toEqual([]);
  });

  it("reports food cost % against the net price and suggests prices", () => {
    const c = costMenuItem(menuItems[0]!, ctx, tax, business);
    expect(c.netPrice).toBe(120_000);
    expect(c.costPctBp).toBe(3470);
    expect(suggestedPrice(41_640, 3000)).toBe(139_000);
    const inclusive = costMenuItem(menuItems[0]!, ctx, { ...tax, pricing: "inclusive", serviceChargeOrderTypes: [] }, business);
    // 1,200 / (1.10 × 1.18) = 924.50
    expect(inclusive.netPrice).toBe(92_450);
  });

  it("flags missing costs and cycles", () => {
    const bad = costingContext(
      [...inventoryItems, { ...inventoryItems[0]!, id: "LOOP", isPrep: true, purchaseCost: 0 }],
      [...recipes, { id: "LOOP", kind: "prep", yieldQty: 1, lines: [{ inventoryItemId: "LOOP", qty: 1 }] }],
    );
    expect(costRecipe({ id: "T", kind: "menu", yieldQty: 1, lines: [{ inventoryItemId: "LOOP", qty: 1 }, { inventoryItemId: "NOPE", qty: 1 }] }, bad).warnings).toHaveLength(2);
  });
});

describe("FIFO stock", () => {
  it("consumes the oldest lots first and goes negative on shortages", () => {
    let level = emptyLevel("MAIN", "CHICKEN");
    level = addLot(level, { lotId: "a", receivedAt: "2026-11-01T00:00:00Z", qty: 1000, unitCost: 150, source: "GRN1" });
    level = addLot(level, { lotId: "b", receivedAt: "2026-11-02T00:00:00Z", qty: 1000, unitCost: 170, source: "GRN2" });
    expect(level.value).toBe(320_000);
    const r = consumeFifo(level, 1500, 160);
    expect(r.cost).toBe(1000 * 150 + 500 * 170);
    expect(r.level.qty).toBe(500);
    expect(r.level.lots).toHaveLength(1);
    const short = consumeFifo(r.level, 800, 160);
    expect(short.shortage).toBe(300);
    expect(short.level.qty).toBe(-300);
    const refill = addLot(short.level, { lotId: "c", receivedAt: "2026-11-03T00:00:00Z", qty: 1000, unitCost: 180, source: "GRN3" });
    expect(refill.qty).toBe(700);
    expect(refill.value).toBe(700 * 180);
  });

  it("posts GRNs, depletes sales by recipe, records waste and counts", async () => {
    const store = await seededStore();
    const grn: GoodsReceipt = {
      id: "G1",
      number: "GRN-0001",
      vendorId: "V1",
      locationId: "MAIN",
      date: "2026-11-01",
      lines: [
        { inventoryItemId: "CHICKEN", qty: 5, unitCost: 150_000 },
        { inventoryItemId: "ROTI", qty: 100, unitCost: 6_000 },
        { inventoryItemId: "EGG", qty: 1, unitCost: 135_000 },
        { inventoryItemId: "ONION", qty: 2, unitCost: 38_000 },
      ],
      inputVat: 0,
      status: "draft",
    };
    await store.set(C.goodsReceipts, grn);
    await postGoodsReceipt(store, "G1", "tester");
    const chicken = await store.get<StockLevel>(C.stockLevels, stockLevelId("MAIN", "CHICKEN"));
    expect(chicken).toMatchObject({ qty: 5000, value: 750_000 });
    expect((await store.get<{ purchaseCost: number }>(C.inventoryItems, "CHICKEN"))!.purchaseCost).toBe(150_000);
    await expect(postGoodsReceipt(store, "G1", "tester")).rejects.toThrow(/already posted/);

    // Two closed checks with 3 kottu in total, waiting for depletion.
    const base = { ...newCheck({ propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 1, orderTypeId: "dine-in", staffId: "S1", businessDate: "2026-11-01" }), status: "closed" as const, depletion: "pending" as const };
    const line = (qty: number) => ({ id: `l${qty}`, menuItemId: "K001", name: "Chicken Kottu", qty, unitPrice: 120_000, modifiers: [], taxClass: "standard", kotRoute: "kitchen" as const, categoryId: "KOTTU", discountIds: [], sentRound: 1 });
    await store.set(C.checks, { ...base, id: "c1", lines: [line(2)] });
    await store.set(C.checks, { ...base, id: "c2", lines: [line(1)] });
    const res = await processDepletion(store, { locationId: "MAIN", by: "tester" });
    expect(res.checks).toBe(2);
    const sale = res.movements[0]!;
    // Curry is an un-stocked prep item: exploded to 450 g × (1000/1000) chicken and 90 g onion.
    expect(sale.lines.find((l) => l.itemId === "CHICKEN")).toMatchObject({ qty: -450, cost: -(450 * 150) });
    expect(sale.lines.find((l) => l.itemId === "ROTI")).toMatchObject({ qty: -6 });
    expect(sale.costByMajorGroup!.Food).toBeGreaterThan(0);
    expect((await store.get<Check>(C.checks, "c1"))!.depletion).toBe("done");
    expect((await processDepletion(store, { locationId: "MAIN", by: "t" })).checks).toBe(0);

    const waste = await recordWaste(store, { locationId: "MAIN", lines: [{ itemId: "ROTI", qty: 4 }], reason: "Burnt", businessDate: "2026-11-01" });
    expect(waste.lines[0]).toMatchObject({ qty: -4, cost: -24_000 });

    await store.set(C.stockCounts, { id: "SC1", locationId: "MAIN", date: "2026-11-01", status: "draft", lines: [{ itemId: "ROTI", counted: 88 }] });
    const adj = await postStockCount(store, "SC1");
    expect(adj!.lines[0]).toMatchObject({ itemId: "ROTI", qty: -2 });
    expect((await store.get<StockLevel>(C.stockLevels, stockLevelId("MAIN", "ROTI")))!.qty).toBe(88);

    const suggestions = reorderSuggestions(inventoryItems, [{ ...emptyLevel("MAIN", "CHICKEN"), qty: 2000 }]);
    expect(suggestions[0]).toMatchObject({ suggestQty: 10 });
  });
});

describe("closing checks", () => {
  async function paidCheck(store: MemoryStore, id: string, at: Date) {
    let check: Check = {
      ...newCheck({ propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 1, orderTypeId: "dine-in", staffId: "S1", businessDate: "2026-11-03", covers: 2 }),
      id,
      customerId: "CUST1",
      lines: [
        { id: "a", menuItemId: "K001", name: "Chicken Kottu", qty: 2, unitPrice: 120_000, modifiers: [], taxClass: "standard", kotRoute: "kitchen", categoryId: "KOTTU", discountIds: [] },
        { id: "b", menuItemId: "J001", name: "Lime Juice", qty: 1, unitPrice: 45_000, modifiers: [], taxClass: "standard", kotRoute: "bar", categoryId: "DRINKS", discountIds: [] },
      ],
      checkDiscountIds: ["STAFF10"],
    };
    check = sendRound(check).check;
    const totals = computeCheckTotals(check, posContext());
    const { payment, change } = makePayment({ tender: tenders[0]!, amount: 400_000, balance: totals.amountDue, by: "S1" });
    check = { ...check, payments: [payment] };
    expect(change).toBe(400_000 - totals.amountDue);
    return closeCheck(store, check, posContext(), { workstationCode: "W01", now: at });
  }

  it("issues IRD invoice numbers with a hash chain and updates aggregates", async () => {
    const store = await seededStore();
    await store.set(C.customers, { id: "CUST1", name: "Test", phone: "0770000000", tags: [], marketingConsent: true, visits: 0, totalSpend: 0, points: 0, createdAt: "" });
    const first = await paidCheck(store, "c1", new Date("2026-11-03T10:00:00Z"));
    // Matches the sample tax invoice: Rs 3,412.61 after 10% discount, SC, VAT (no SSCL here).
    expect(first.invoice.id).toBe("26NOV_W01_1");
    expect(first.check.totals!.amountDue).toBe(256_500 + 25_650 + Math.round((256_500 + 25_650) * 0.18));
    expect(first.check.change).toBe(400_000 - first.check.totals!.amountDue);
    const second = await paidCheck(store, "c2", new Date("2026-11-03T11:00:00Z"));
    expect(second.invoice.id).toBe("26NOV_W01_2");
    expect(second.invoice.prevHash).toBe(first.invoice.hash);
    const third = await paidCheck(store, "c3", new Date("2026-11-30T19:00:00Z")); // 1 Dec in Colombo
    expect(third.invoice.id).toBe("26DEC_W01_1");

    const stats = (await store.get<DailyStats>(C.dailyStats, "P1__2026-11-03"))!;
    expect(stats.checks).toBe(3);
    expect(stats.covers).toBe(6);
    expect(stats.items.K001).toMatchObject({ qty: 6 });
    expect(stats.majorGroups.Food!.gross).toBe(3 * 240_000);
    expect(stats.tenders.CASH!.amount).toBe(stats.total);
    expect(stats.hours["15"]).toMatchObject({ qty: 1 }); // 10:00Z = 15:30 Colombo
    const cust = await store.get<{ visits: number; points: number }>(C.customers, "CUST1");
    // 1 point per Rs 100: Rs 3,327.97 → 33 points per bill.
    expect(cust).toMatchObject({ visits: 3, points: 3 * 33 });

    const journal = buildDailyJournal({ date: "2026-11-03", propertyId: "P1", stats, movements: [], receipts: [], receiptValues: new Map(), tenders, settings: accounting });
    const dr = journal.lines.reduce((a, l) => a + l.debit, 0);
    expect(dr).toBe(journal.lines.reduce((a, l) => a + l.credit, 0));
    expect(journal.lines.find((l) => l.accountCode === "2100")!.credit).toBe(stats.vat);

    const eng = menuEngineering(mergeStats([stats]), menuItems.map((m) => ({ ...m, cost: m.id === "K001" ? 41_640 : 5_000 })));
    // Lime juice: 33% mix (< 70% of an even 50% share) and below-average margin.
    expect(eng.map((r) => r.class)).toEqual(["Star", "Dog"]);
  });

  it("refuses to close unpaid or empty checks", async () => {
    const store = await seededStore();
    const empty = newCheck({ propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 1, orderTypeId: "dine-in", staffId: "S1", businessDate: "2026-11-03" });
    await expect(closeCheck(store, empty, posContext(), { workstationCode: "W01" })).rejects.toThrow(/no items/);
  });

  it("balances the journal including stock and supplier receipts", () => {
    const grn: GoodsReceipt = { id: "G", number: "GRN-1", vendorId: "V", locationId: "MAIN", date: "2026-11-03", lines: [{ inventoryItemId: "CHICKEN", qty: 2, unitCost: 150_000 }], inputVat: 54_000, status: "posted" };
    const journal = buildDailyJournal({
      date: "2026-11-03",
      propertyId: "P1",
      stats: null,
      movements: [
        { id: "m", type: "sale", locationId: "MAIN", businessDate: "2026-11-03", at: "", ref: "", lines: [], costByMajorGroup: { Food: 12_345 } },
        { id: "w", type: "waste", locationId: "MAIN", businessDate: "2026-11-03", at: "", ref: "", lines: [{ itemId: "ROTI", qty: -1, cost: -6_000 }] },
      ],
      receipts: [grn],
      receiptValues: new Map([["G", receiptValue(grn)]]),
      tenders,
      settings: accounting,
    });
    expect(journal.lines.find((l) => l.accountCode === "2000")!.credit).toBe(354_000);
    expect(journal.lines.find((l) => l.accountCode === "5100")!.debit).toBe(6_000);
  });
});

describe("integrations and security helpers", () => {
  it("computes MD5 and PayHere signatures", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
    expect(md5("a".repeat(1000))).toBe("cabe45dcc9ae5b66ba86600cca6b8ba8");
    const hash = payhereHash("1211149", "ORDER1", 100_000, "LKR", "secret");
    expect(hash).toBe(md5(`1211149ORDER11000.00LKR${md5("secret").toUpperCase()}`).toUpperCase());
    const sig = md5(`1211149ORDER11000.00LKR2${md5("secret").toUpperCase()}`).toUpperCase();
    expect(verifyPayhereNotify({ merchant_id: "1211149", order_id: "ORDER1", payhere_amount: "1000.00", payhere_currency: "LKR", status_code: "2", md5sig: sig }, "secret")).toBe(true);
  });

  it("builds EMVCo LankaQR payloads with a valid CRC", () => {
    expect(crc16("123456789")).toBe("29B1");
    const p = lankaQrPayload({ merchantId: "SAMPLE001", merchantName: "Spice Lagoon", merchantCity: "Colombo", mcc: "5812", amount: 341_261, reference: "26NOV_W01_1" });
    expect(p.startsWith("000201010212")).toBe(true);
    expect(p).toContain("54073412.61");
    expect(crc16(p.slice(0, -4))).toBe(p.slice(-4));
  });

  it("hashes and verifies PINs", async () => {
    const { hash, salt } = await hashPin("1234");
    expect(await verifyPin("1234", hash, salt)).toBe(true);
    expect(await verifyPin("4321", hash, salt)).toBe(false);
    await expect(hashPin("12")).rejects.toThrow();
  });
});
