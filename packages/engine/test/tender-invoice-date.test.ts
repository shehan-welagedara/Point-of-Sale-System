import { describe, expect, it } from "vitest";
import {
  type TenderMedia,
  TenderError,
  businessDate,
  formatInvoiceNumber,
  localPeriod,
  nextSequence,
  parseInvoiceNumber,
  settle,
} from "../src/index.js";

const tenders: TenderMedia[] = [
  { id: "cash", name: "Cash", allowChange: true },
  { id: "card", name: "Card", allowChange: false },
  { id: "lankaqr", name: "LankaQR", allowChange: false },
  { id: "usd", name: "USD Cash", allowChange: true, currency: "USD" },
];

describe("settle", () => {
  it("gives change on cash", () => {
    expect(settle(341_261, [{ tenderId: "cash", amount: 400_000 }], tenders)).toMatchObject({
      paid: 341_261,
      change: 58_739,
      settled: true,
    });
  });

  it("supports split tenders", () => {
    const s = settle(341_261, [
      { tenderId: "card", amount: 200_000 },
      { tenderId: "lankaqr", amount: 100_000 },
    ], tenders);
    expect(s).toMatchObject({ paid: 300_000, balanceDue: 41_261, settled: false });
  });

  it("rejects over-tender on non-change tenders and payments on a paid check", () => {
    expect(() => settle(1_000, [{ tenderId: "card", amount: 1_001 }], tenders)).toThrow(TenderError);
    expect(() =>
      settle(1_000, [{ tenderId: "card", amount: 1_000 }, { tenderId: "cash", amount: 1 }], tenders),
    ).toThrow(/fully paid/);
  });

  it("converts foreign currency and gives change in LKR", () => {
    // USD 20.00 at Rs 300.25 = Rs 6,005.00
    const s = settle(500_000, [{ tenderId: "usd", amount: 2_000, exchangeRateMicros: 300_250_000 }], tenders);
    expect(s.lines[0]?.tendered).toBe(600_500);
    expect(s.change).toBe(100_500);
    expect(() => settle(500_000, [{ tenderId: "usd", amount: 2_000 }], tenders)).toThrow(/exchange rate/);
  });
});

describe("IRD invoice numbers", () => {
  it("formats and parses YYMMM_QQQQ_XXXXX", () => {
    const n = formatInvoiceNumber({ year: 2026, month: 10, classificationCode: "W01", sequence: 1234 });
    expect(n).toBe("26OCT_W01_1234");
    expect(parseInvoiceNumber(n)).toEqual({ year: 2026, month: 10, classificationCode: "W01", sequence: 1234 });
  });

  it("validates the classification code and length", () => {
    expect(() => formatInvoiceNumber({ year: 2026, month: 1, classificationCode: "W 01", sequence: 1 })).toThrow();
    expect(() => formatInvoiceNumber({ year: 2026, month: 1, classificationCode: "A".repeat(16), sequence: 1 })).toThrow();
    expect(() => formatInvoiceNumber({ year: 2026, month: 13, classificationCode: "W01", sequence: 1 })).toThrow();
    expect(() => formatInvoiceNumber({ year: 2026, month: 1, classificationCode: "W01", sequence: 0 })).toThrow();
    expect(parseInvoiceNumber("26OCT_W01_12A")).toBeNull();
    expect(parseInvoiceNumber("26XYZ_W01_1")).toBeNull();
  });

  it("continues or restarts the sequence per policy", () => {
    const last = { year: 2026, month: 10, sequence: 99 };
    expect(nextSequence(null, { year: 2026, month: 10 }, "monthly")).toBe(1);
    expect(nextSequence(last, { year: 2026, month: 10 }, "monthly")).toBe(100);
    expect(nextSequence(last, { year: 2026, month: 11 }, "monthly")).toBe(1);
    expect(nextSequence(last, { year: 2026, month: 11 }, "yearly")).toBe(100);
    expect(nextSequence(last, { year: 2027, month: 1 }, "yearly")).toBe(1);
    expect(nextSequence(last, { year: 2027, month: 1 }, "never")).toBe(100);
  });
});

describe("business date (Asia/Colombo, UTC+05:30)", () => {
  it("rolls over at the configured hour", () => {
    // 2026-10-30 21:30 UTC = 2026-10-31 03:00 in Colombo → still the 30th with a 04:00 rollover
    const late = new Date("2026-10-30T21:30:00Z");
    expect(businessDate(late, { rolloverHour: 4 })).toBe("2026-10-30");
    expect(businessDate(late, { rolloverHour: 0 })).toBe("2026-10-31");
    expect(localPeriod(new Date("2026-10-31T18:45:00Z"))).toEqual({ year: 2026, month: 11 });
  });
});
