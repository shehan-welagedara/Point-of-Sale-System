import { describe, expect, it } from "vitest";
import {
  type Check,
  type CheckAdjustment,
  type CreditNote,
  type DailyStats,
  type StockLevel,
  COLLECTIONS as C,
  MemoryStore,
  addLot,
  adjustClosedTender,
  closeCheck,
  computeCheckTotals,
  creditAmounts,
  emptyLevel,
  expectedCash,
  issueCreditNote,
  makePayment,
  mergeChecks,
  newCheck,
  processDepletion,
  remainingQty,
  sendRound,
  stockLevelId,
} from "../src/index.js";
import { posContext, seededStore, tenders } from "./fixtures.js";

const ws = { workstationId: "W01", workstationCode: "W01" };

async function closed(store: MemoryStore, id: string, opts: { businessDate?: string; tenderIndex?: number } = {}): Promise<Check> {
  let check: Check = {
    ...newCheck({ propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 7, orderTypeId: "dine-in", staffId: "S1", businessDate: opts.businessDate ?? "2026-11-03", covers: 2 }),
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
  const { payment } = makePayment({ tender: tenders[opts.tenderIndex ?? 0]!, amount: totals.amountDue, balance: totals.amountDue, by: "S1" });
  return (await closeCheck(store, { ...check, payments: [payment] }, posContext(), { workstationCode: "W01", now: new Date("2026-11-03T10:00:00Z") })).check;
}

const base = (over: Partial<Parameters<typeof issueCreditNote>[3]> = {}) => ({ kind: "void" as const, select: "all" as const, reason: "Wrong table billed", by: "S1", authorizedBy: "M1", restock: false, businessDate: "2026-11-04", inventoryOn: true, ...ws, ...over });

describe("closed-check functions (credit notes)", () => {
  it("voids a closed check with a numbered, chained credit note that undoes the day's figures", async () => {
    const store = await seededStore();
    await store.set(C.customers, { id: "CUST1", name: "T", phone: "", tags: [], marketingConsent: false, visits: 0, totalSpend: 0, points: 0, createdAt: "" });
    const check = await closed(store, "c1");
    const total = check.totals!.amountDue;
    const { note } = await issueCreditNote(store, check, posContext(), { ...base(), refunds: [{ tenderId: "CASH", amount: total }], now: new Date("2026-11-04T05:00:00Z") });
    expect(note.id).toBe("CN-26NOV_W01_1");
    expect(note.full).toBe(true);
    expect(note.totals.total).toBe(total);
    expect(note.prevHash).toBe("");
    const stats = (await store.get<DailyStats>(C.dailyStats, "P1__2026-11-04"))!;
    expect(stats.netSales).toBe(-check.totals!.netSubtotal);
    expect(stats.total).toBe(-total);
    expect(stats.checks).toBe(-1);
    expect(stats.tenders.CASH!.amount).toBe(-total);
    expect(stats.returns).toEqual({ qty: 1, amount: total });
    expect(stats.items.K001).toMatchObject({ qty: -2 });
    // The original day and the closed check are untouched; the customer's spend goes back.
    expect((await store.get<DailyStats>(C.dailyStats, "P1__2026-11-03"))!.total).toBe(total);
    expect((await store.get<Check>(C.checks, "c1"))!.status).toBe("closed");
    expect((await store.get<{ totalSpend: number; visits: number }>(C.customers, "CUST1"))).toMatchObject({ totalSpend: 0, visits: 0 });
    // Nothing more can be credited, and the next credit note continues the chain.
    await expect(issueCreditNote(store, check, posContext(), { ...base(), refunds: [{ tenderId: "CASH", amount: total }] })).rejects.toThrow(/already been fully credited/);
    const other = await closed(store, "c2");
    const second = await issueCreditNote(store, other, posContext(), { ...base(), refunds: [{ tenderId: "CASH", amount: other.totals!.amountDue }], now: new Date("2026-11-04T06:00:00Z") });
    expect(second.note.id).toBe("CN-26NOV_W01_2");
    expect(second.note.prevHash).toBe(note.hash);
  });

  it("refunds some items, in proportion to discounts and charges, and never more than is left", async () => {
    const store = await seededStore();
    const check = await closed(store, "c1");
    const { totals } = creditAmounts(check, [{ lineId: "a", qty: 1 }]);
    // One kottu: Rs 1,200 less the 10% discount, with its share of service charge and VAT.
    expect(totals.gross).toBe(120_000);
    expect(totals.net).toBe(108_000);
    expect(totals.total).toBe(Math.round((check.totals!.total * 108_000) / check.totals!.netSubtotal));
    await expect(issueCreditNote(store, check, posContext(), { ...base({ kind: "refund", select: [{ lineId: "a", qty: 1 }] }), refunds: [{ tenderId: "CASH", amount: 1 }] })).rejects.toThrow(/must add up to/);
    const { note } = await issueCreditNote(store, check, posContext(), { ...base({ kind: "refund", select: [{ lineId: "a", qty: 1 }] }), refunds: [{ tenderId: "CASH", amount: totals.total }] });
    expect(note.full).toBe(false);
    const stats = (await store.get<DailyStats>(C.dailyStats, "P1__2026-11-04"))!;
    expect(stats.checks).toBe(0);
    const notes = await store.list<CreditNote>(C.creditNotes);
    expect(remainingQty(check, notes).get("a")).toBe(1);
    await expect(issueCreditNote(store, check, posContext(), { ...base({ kind: "refund", select: [{ lineId: "a", qty: 2 }] }), refunds: [{ tenderId: "CASH", amount: totals.total * 2 }] })).rejects.toThrow(/more than is left/);
    // After a partial refund a whole void is refused: refund the rest item by item.
    await expect(issueCreditNote(store, check, posContext(), { ...base(), refunds: [] })).rejects.toThrow(/item by item/);
  });

  it("reopens a closed check as a new open check whose items are already sent", async () => {
    const store = await seededStore();
    const check = await closed(store, "c1");
    const { note, reopened } = await issueCreditNote(store, check, posContext(), base({ kind: "reopen", reason: "Customer wants to add items" }));
    expect(note.kind).toBe("reopen");
    expect(note.refunds).toEqual([]);
    expect(reopened!.status).toBe("open");
    expect(reopened!.reopenedFrom).toEqual({ checkId: "c1", invoiceNo: check.invoiceNo, creditNoteId: note.id });
    expect(reopened!.lines.every((l) => (l.sentRound ?? 0) >= 1)).toBe(true);
    expect(reopened!.payments).toEqual([]);
    expect(await store.get<Check>(C.checks, reopened!.id)).toBeTruthy();
    // A reopen gives the goods back to stock (the new check deducts them again when it closes).
    expect(note.depletion).toBe("pending");
  });

  it("puts restocked goods back at the next stock run and takes them off cost of sales", async () => {
    const store = await seededStore();
    const check = await closed(store, "c1");
    const loc = "MAIN";
    for (const item of ["CHICKEN", "ROTI"]) await store.set(C.stockLevels, addLot(emptyLevel(loc, item), { lotId: `L-${item}`, receivedAt: "2026-11-01", qty: 10_000, unitCost: 10, source: "grn" }));
    await processDepletion(store, { locationId: loc, by: "t" });
    const before = (await store.get<StockLevel>(C.stockLevels, stockLevelId(loc, "CHICKEN")))!.qty;
    await issueCreditNote(store, check, posContext(), { ...base({ restock: true }), refunds: [{ tenderId: "CASH", amount: check.totals!.amountDue }] });
    const r = await processDepletion(store, { locationId: loc, by: "t" });
    expect(r.returns).toBe(1);
    const after = (await store.get<StockLevel>(C.stockLevels, stockLevelId(loc, "CHICKEN")))!.qty;
    expect(after).toBeGreaterThan(before);
    const ret = r.movements.find((m) => m.ref.startsWith("returns"))!;
    expect(Object.values(ret.costByMajorGroup!).every((v) => v < 0)).toBe(true);
    expect((await store.list<CreditNote>(C.creditNotes))[0]!.depletion).toBe("done");
  });

  it("changes the payment method of a closed check in that day's figures, within what was paid", async () => {
    const store = await seededStore();
    const check = await closed(store, "c1");
    const p = check.payments[0]!;
    await expect(adjustClosedTender(store, check, { paymentId: p.id, toTenderId: p.tenderId, amount: 100, reason: "x", by: "S1", workstationId: "W01" })).rejects.toThrow(/different/);
    await expect(adjustClosedTender(store, check, { paymentId: p.id, toTenderId: "CARD", amount: p.applied + 1, reason: "x", by: "S1", workstationId: "W01" })).rejects.toThrow(/at most/);
    const adj = await adjustClosedTender(store, check, { paymentId: p.id, toTenderId: "CARD", amount: p.applied, reason: "Paid by card, rung as cash", by: "S1", authorizedBy: "M1", workstationId: "W01" });
    expect(adj).toMatchObject<Partial<CheckAdjustment>>({ fromTenderId: p.tenderId, toTenderId: "CARD", amount: p.applied, businessDate: "2026-11-03" });
    const stats = (await store.get<DailyStats>(C.dailyStats, "P1__2026-11-03"))!;
    expect(stats.tenders[p.tenderId]!.amount).toBe(0);
    expect(stats.tenders.CARD!.amount).toBe(p.applied);
    await expect(adjustClosedTender(store, check, { paymentId: p.id, toTenderId: "CARD", amount: 1, reason: "x", by: "S1", workstationId: "W01" })).rejects.toThrow(/at most 0/);
  });

  it("merges open checks and counts pickups and cash refunds in the expected drawer cash", () => {
    const a = { ...newCheck({ propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 1, orderTypeId: "t", staffId: "S1", businessDate: "d", covers: 2 }), id: "A", lines: [{ id: "1" }] } as unknown as Check;
    const b = { ...newCheck({ propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 2, orderTypeId: "t", staffId: "S1", businessDate: "d", covers: 3 }), id: "B", lines: [{ id: "2" }] } as unknown as Check;
    const m = mergeChecks(a, b);
    expect(m.into.lines.length).toBe(2);
    expect(m.into.covers).toBe(5);
    expect(m.from.status).toBe("voided");
    expect(() => mergeChecks(a, a)).toThrow();
    const cash = expectedCash(
      [{ status: "closed", payments: [{ tenderId: "CASH", applied: 10_000, by: "S1" }] } as unknown as Check],
      [{ type: "paidIn", amount: 5_000, employeeId: "S1" }, { type: "cashPickup", amount: 3_000, employeeId: "S1" }] as never,
      new Set(["CASH"]),
      undefined,
      [{ by: "S1", refunds: [{ tenderId: "CASH", amount: 1_000 }] }],
    );
    expect(cash).toBe(10_000 + 5_000 - 3_000 - 1_000);
  });
});
