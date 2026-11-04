import { describe, expect, it } from "vitest";
import { allocate, applyRate, formatAmount, roundDiv, roundToUnit } from "../src/index.js";

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(roundDiv(5n, 2n)).toBe(3n);
    expect(roundDiv(-5n, 2n)).toBe(-3n);
    expect(roundDiv(4n, 3n)).toBe(1n);
    expect(applyRate(282_150, 250)).toBe(7_054); // 7,053.75 → 7,054
  });

  it("allocates exactly with the largest-remainder method", () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
    expect(allocate(0, [])).toEqual([]);
    const parts = allocate(1_234_567, [3, 5, 7, 11, 13]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1_234_567);
  });

  it("rounds to a cash unit", () => {
    expect(roundToUnit(379_068, 100)).toBe(379_100);
    expect(roundToUnit(379_049, 100)).toBe(379_000);
    expect(roundToUnit(379_001, 100, "up")).toBe(379_100);
    expect(roundToUnit(379_099, 100, "down")).toBe(379_000);
    expect(roundToUnit(379_000, 100, "up")).toBe(379_000);
  });

  it("formats amounts for receipts", () => {
    expect(formatAmount(341_261)).toBe("3,412.61");
    expect(formatAmount(5)).toBe("0.05");
    expect(formatAmount(-28_500)).toBe("-285.00");
  });
});
