import { describe, expect, it } from "vitest";
import {
  type InventoryItem,
  type PriceList,
  type StockLevel,
  type Style,
  COLLECTIONS as C,
  MemoryStore,
  addLot,
  availableToPromise,
  barcodeForSku,
  codSettlementFor,
  creditCheck,
  emptyLevel,
  isEan13,
  issueStock,
  nextDocNumber,
  orderTotals,
  paymentState,
  priceLines,
  printPrice,
  returnStock,
  saveStyle,
  stockLevelId,
  styleVariants,
  unitPrice,
  variantSku,
} from "../src/index.js";

const tee: Style = {
  id: "OVS01",
  code: "ZX-OVS01",
  name: "Oversized tee",
  category: "Oversized",
  sizes: ["S", "M", "L", "XL", "XXL"],
  colours: [{ name: "Black" }, { name: "Off-white" }],
  price: 1_450_00,
  cost: 780_00,
  tiers: [{ minQty: 12, price: 1_250_00 }, { minQty: 50, price: 1_150_00 }],
  sizeSurcharge: { XXL: 100_00 },
  colourSurcharge: { "Off-white": 50_00 },
  packSize: 12,
  active: true,
};

describe("wholesale catalogue", () => {
  it("makes a SKU and a valid in-store barcode for every size and colour", () => {
    expect(variantSku("ZX-OVS01", "Off-white", "XXL")).toBe("ZX-OVS01-OFFWHITE-XXL");
    const v = styleVariants(tee);
    expect(v).toHaveLength(10);
    const codes = v.map((x) => barcodeForSku(x.sku));
    expect(codes.every(isEan13)).toBe(true);
    expect(codes.every((c) => c.startsWith("2"))).toBe(true);
    expect(new Set(codes).size).toBe(10);
    expect(barcodeForSku("ZX-OVS01-BLACK-M")).toBe(barcodeForSku("ZX-OVS01-BLACK-M"));
  });

  it("saves a style with its variants as stock items (packs of 12)", async () => {
    const store = new MemoryStore();
    const saved = await saveStyle(store, tee);
    const items = await store.list<InventoryItem>(C.inventoryItems);
    expect(items).toHaveLength(10);
    const xl = items.find((i) => i.id === "ZX-OVS01-BLACK-XL")!;
    expect(xl).toMatchObject({ name: "Oversized tee · Black · XL", stockUnit: "pcs", purchaseFactor: 12, purchaseCost: 780_00 * 12, size: "XL", colour: "Black", styleId: "OVS01", majorGroup: "Other" });
    expect(isEan13(xl.barcode!)).toBe(true);
    expect(saved.barcodes!["ZX-OVS01-BLACK-XL"]).toBe(xl.barcode);
  });
});

describe("wholesale prices", () => {
  const listA: PriceList = { id: "A", name: "A-grade shops", kind: "percent", percentOff: 1000, active: true };
  const fixed: PriceList = { id: "R", name: "Resellers", kind: "fixed", prices: { OVS01: 1_100_00 }, active: true };
  it("uses the list price, a quantity tier for the whole style, a price list, then surcharges", () => {
    expect(unitPrice(tee, { size: "M", colour: "Black", styleQty: 5 }).unit).toBe(1_450_00);
    expect(unitPrice(tee, { size: "M", colour: "Black", styleQty: 24 }).unit).toBe(1_250_00);
    expect(unitPrice(tee, { size: "M", colour: "Black", styleQty: 60 }).unit).toBe(1_150_00);
    // 10% off the tier price; the XXL and off-white surcharges are added after, never discounted.
    const p = unitPrice(tee, { size: "XXL", colour: "Off-white", styleQty: 24, priceList: listA });
    expect(p).toMatchObject({ base: 1_125_00, listOff: 125_00, surcharge: 150_00, unit: 1_275_00 });
    expect(unitPrice(tee, { size: "M", colour: "Black", styleQty: 5, priceList: fixed }).unit).toBe(1_100_00);
    // A fixed price never makes a bigger order dearer than its tier.
    expect(unitPrice(tee, { size: "M", colour: "Black", styleQty: 100, priceList: { ...fixed, prices: { OVS01: 1_200_00 } } }).unit).toBe(1_150_00);
    expect(unitPrice(tee, { size: "M", colour: "Black", styleQty: 5, priceList: { ...listA, active: false } }).unit).toBe(1_450_00);
  });

  it("prices an order with tiers counted over the style, print jobs, discount, delivery and VAT", () => {
    const styles = new Map([[tee.id, tee]]);
    const lines = priceLines(
      [
        { id: "1", styleId: "OVS01", styleCode: tee.code, name: tee.name, colour: "Black", size: "M", sku: "ZX-OVS01-BLACK-M", qty: 8 },
        { id: "2", styleId: "OVS01", styleCode: tee.code, name: tee.name, colour: "Black", size: "XXL", sku: "ZX-OVS01-BLACK-XXL", qty: 4 },
      ],
      styles,
    );
    // 12 pieces of the style: the 12+ tier applies to both lines.
    expect(lines.map((l) => l.unit)).toEqual([1_250_00, 1_350_00]);
    const print = { description: "Logo front", method: "screen" as const, sides: ["front"], colours: 2, setupFee: 0, pricePerPiece: 0, status: "design" as const };
    const pp = printPrice(print);
    expect(pp).toEqual({ pricePerPiece: 150_00 + 40_00, setupFee: 2 * 1_500_00 });
    expect(printPrice({ sides: ["front", "back"], colours: 1, method: "dtf" })).toEqual({ pricePerPiece: 300_00, setupFee: 0 });
    const t = orderTotals({ lines, print: { ...print, ...pp }, discount: 500_00, deliveryCharge: 400_00 }, 1800);
    const goods = 8 * 1_250_00 + 4 * 1_350_00;
    const sub = goods + 12 * pp.pricePerPiece + pp.setupFee - 500_00 + 400_00;
    expect(t).toEqual({ subtotal: sub, vat: Math.round(sub * 0.18), total: sub + Math.round(sub * 0.18), pieces: 12 });
  });
});

describe("wholesale credit, payments, couriers and stock", () => {
  it("allows credit within the limit only", () => {
    expect(creditCheck({ creditLimit: 100_000_00 }, 60_000_00, 30_000_00)).toEqual({ allowed: true, available: 40_000_00, over: 0 });
    expect(creditCheck({ creditLimit: 100_000_00 }, 60_000_00, 50_000_00)).toMatchObject({ allowed: false, over: 10_000_00 });
    expect(creditCheck({}, 0, 1).allowed).toBe(false);
  });

  it("counts only confirmed payments, and settles a courier's COD less fees", () => {
    expect(paymentState(10_000, [{ id: "a", method: "bank", amount: 4_000, at: "", by: "", status: "confirmed" }, { id: "b", method: "bank", amount: 6_000, at: "", by: "", status: "pending" }])).toEqual({ paid: 4_000, paymentStatus: "partial" });
    const s = codSettlementFor({ codFeeBp: 150, parcelFee: 350_00 }, [{ delivery: { method: "courier", cod: true, codAmount: 20_000_00 } }, { delivery: { method: "courier", cod: true, codAmount: 10_000_00 } }, { delivery: { method: "courier", cod: false } }]);
    expect(s).toEqual({ collected: 30_000_00, fees: 3 * 350_00 + 300_00 + 150_00, net: 30_000_00 - (3 * 350_00 + 450_00) });
  });

  it("numbers documents per kind and promises only stock not held by orders", async () => {
    const store = new MemoryStore();
    expect(await nextDocNumber(store, "QT")).toBe("QT-000001");
    expect(await nextDocNumber(store, "QT")).toBe("QT-000002");
    expect(await nextDocNumber(store, "SO")).toBe("SO-000001");
    const atp = availableToPromise(new Map([["X", 10]]), [{ status: "confirmed", lines: [{ sku: "X", qty: 4 }] as never }, { status: "dispatched", lines: [{ sku: "X", qty: 3 }] as never }]);
    expect(atp.get("X")).toBe(6);
  });

  it("issues a delivery from stock at FIFO cost and takes a return back", async () => {
    const store = new MemoryStore();
    await saveStyle(store, tee);
    const sku = "ZX-OVS01-BLACK-M";
    await store.set(C.stockLevels, addLot(emptyLevel("MAIN", sku), { lotId: "L1", receivedAt: "2026-11-01", qty: 24, unitCost: 760_00, source: "grn" }));
    const out = await issueStock(store, { locationId: "MAIN", lines: [{ itemId: sku, qty: 10 }], businessDate: "2026-11-13", ref: "SO-000001" });
    expect(out.lines[0]).toMatchObject({ itemId: sku, qty: -10, cost: -7_600_00 });
    expect(out.costByMajorGroup).toEqual({ Other: 7_600_00 });
    expect((await store.get<StockLevel>(C.stockLevels, stockLevelId("MAIN", sku)))!.qty).toBe(14);
    const back = await returnStock(store, { locationId: "MAIN", lines: [{ itemId: sku, qty: 2 }], businessDate: "2026-11-14", ref: "return SO-000001" });
    expect(back.costByMajorGroup!.Other).toBeLessThan(0);
    expect((await store.get<StockLevel>(C.stockLevels, stockLevelId("MAIN", sku)))!.qty).toBe(16);
  });
});
