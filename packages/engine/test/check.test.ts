import { describe, expect, it } from "vitest";
import { type CheckInput, type CheckLineInput, calculateCheck, sriLankaChargeRules } from "../src/index.js";

const kottu: CheckLineInput = { id: "l1", name: "Chicken Kottu", quantity: 2, unitPrice: 120_000, taxClass: "food" };
const lime: CheckLineInput = {
  id: "l2",
  name: "Lime Juice",
  quantity: 1,
  unitPrice: 45_000,
  modifiers: [{ name: "No sugar", price: 0 }],
  taxClass: "beverage",
};

const slFull = sriLankaChargeRules({ vatRegistered: true, ssclLiable: true });

function check(overrides: Partial<CheckInput>): CheckInput {
  return { lines: [kottu, lime], orderType: "dine-in", pricing: "exclusive", rules: slFull, ...overrides };
}

const amounts = (t: ReturnType<typeof calculateCheck>) =>
  Object.fromEntries(t.charges.map((c) => [c.ruleId, c.amount]));

describe("calculateCheck – Sri Lanka exclusive pricing", () => {
  it("computes SC → SSCL → VAT in order (Rs 1,000 example from docs/06)", () => {
    const t = calculateCheck(check({ lines: [{ id: "a", name: "Item", quantity: 1, unitPrice: 100_000, taxClass: "food" }] }));
    expect(amounts(t)).toEqual({ sc: 10_000, sscl: 2_750, vat: 20_295 });
    expect(t.total).toBe(133_045);
    expect(t.valueExclVat).toBe(112_750);
    expect(t.vatTotal).toBe(20_295);
  });

  it("matches the sample tax invoice in docs/06 (10% subtotal discount)", () => {
    const t = calculateCheck(
      check({ subtotalDiscounts: [{ id: "staff", name: "Staff 10%", type: "percent", value: 1000 }] }),
    );
    expect(t.itemsTotal).toBe(285_000);
    expect(t.discountTotal).toBe(28_500);
    expect(t.netSubtotal).toBe(256_500);
    expect(amounts(t)).toEqual({ sc: 25_650, sscl: 7_054, vat: 52_057 });
    expect(t.valueExclVat).toBe(289_204);
    expect(t.total).toBe(341_261);
  });

  it("keeps line allocations consistent with bill totals", () => {
    const t = calculateCheck(check({ subtotalDiscounts: [{ id: "d", name: "d", type: "amount", value: 333 }] }));
    for (const c of t.charges) {
      expect(t.lines.reduce((s, l) => s + (l.charges[c.ruleId] ?? 0), 0)).toBe(c.amount);
    }
    expect(t.lines.reduce((s, l) => s + l.total, 0)).toBe(t.total);
    expect(t.lines.reduce((s, l) => s + l.discount, 0)).toBe(t.discountTotal);
  });

  it("charges no service charge on takeaway when SC is limited to dine-in", () => {
    const rules = sriLankaChargeRules({ vatRegistered: true, ssclLiable: true, serviceChargeOrderTypes: ["dine-in"] });
    const t = calculateCheck(check({ rules, orderType: "takeaway", lines: [{ ...kottu, quantity: 1 }] }));
    expect(amounts(t)).toEqual({ sc: 0, sscl: 3_000, vat: 22_140 });
    expect(t.total).toBe(145_140);
  });

  it("prints a plain bill for a business that is not VAT/SSCL registered", () => {
    const rules = sriLankaChargeRules({ vatRegistered: false, ssclLiable: false });
    const t = calculateCheck(check({ rules }));
    expect(t.charges.map((c) => c.ruleId)).toEqual(["sc"]);
    expect(t.vatTotal).toBe(0);
    expect(t.total).toBe(285_000 + 28_500);
  });

  it("applies VAT only to VAT-able tax classes", () => {
    const rules = sriLankaChargeRules({ vatRegistered: true, ssclLiable: false, serviceChargeRate: 0, vatTaxClasses: ["food"] });
    const t = calculateCheck(check({ rules }));
    expect(amounts(t)).toEqual({ vat: 43_200 });
  });

  it("honours per-check exemptions", () => {
    const t = calculateCheck(check({ exemptRuleIds: ["sc"] }));
    expect(amounts(t).sc).toBe(0);
  });

  it("handles item discounts, priced modifiers and weighed quantities", () => {
    const t = calculateCheck({
      orderType: "dine-in",
      pricing: "exclusive",
      rules: [],
      lines: [
        {
          id: "x",
          name: "Burger",
          quantity: 2,
          unitPrice: 150_000,
          modifiers: [{ name: "Extra cheese", price: 20_000 }],
          taxClass: "food",
          discounts: [
            { id: "p", name: "20% off", type: "percent", value: 2000 },
            { id: "a", name: "Rs 100 off", type: "amount", value: 10_000 },
          ],
        },
        { id: "y", name: "Prawns (kg)", quantity: 0.25, unitPrice: 600_000, taxClass: "food" },
      ],
    });
    expect(t.lines[0]).toMatchObject({ gross: 340_000, discount: 78_000, net: 262_000 });
    expect(t.lines[1]).toMatchObject({ gross: 150_000, net: 150_000 });
    expect(t.total).toBe(412_000);
  });

  it("excludes non-discountable lines from subtotal discounts and caps amount discounts", () => {
    const t = calculateCheck({
      orderType: "dine-in",
      pricing: "exclusive",
      rules: [],
      lines: [
        { id: "a", name: "Food", quantity: 1, unitPrice: 10_000, taxClass: "food" },
        { id: "b", name: "Gift voucher", quantity: 1, unitPrice: 50_000, taxClass: "none", discountable: false },
      ],
      subtotalDiscounts: [{ id: "big", name: "Big", type: "amount", value: 999_999 }],
    });
    expect(t.discountTotal).toBe(10_000);
    expect(t.lines.map((l) => l.net)).toEqual([0, 50_000]);
  });

  it("rounds the amount due when bill rounding is configured", () => {
    const t = calculateCheck(check({ billRounding: { unit: 100, mode: "nearest" } }));
    // 2,850.00 → SC 285.00 → SSCL 78.38 → VAT 578.41 = 3,791.79 → 3,792.00
    expect(t.total).toBe(379_179);
    expect(t.amountDue).toBe(379_200);
    expect(t.roundingAdjustment).toBe(21);
  });
});

describe("calculateCheck – inclusive pricing", () => {
  it("back-calculates charges so the guest pays exactly the menu prices", () => {
    const t = calculateCheck(check({ pricing: "inclusive" }));
    expect(t.total).toBe(285_000);
    expect(t.netSubtotal + t.charges.reduce((s, c) => s + c.amount, 0)).toBe(285_000);
    // 285,000 / (1.10 × 1.025 × 1.18) = 285,000 / 1.33045 ≈ 214,213
    expect(Math.abs(t.netSubtotal - 214_213)).toBeLessThanOrEqual(2);
    expect(t.vatTotal).toBe(Math.round(t.valueExclVat * 0.18));
  });

  it("is exact across many awkward prices", () => {
    for (let price = 1; price < 20_000; price += 137) {
      const t = calculateCheck(
        check({
          pricing: "inclusive",
          lines: [
            { id: "a", name: "a", quantity: 3, unitPrice: price, taxClass: "food" },
            { id: "b", name: "b", quantity: 1, unitPrice: price + 7, taxClass: "food" },
          ],
        }),
      );
      expect(t.total).toBe(price * 4 + 7);
      expect(t.lines.reduce((s, l) => s + l.total, 0)).toBe(t.total);
    }
  });
});

describe("calculateCheck – validation", () => {
  it("rejects rules that reference later rules", () => {
    expect(() =>
      calculateCheck(
        check({ rules: [{ id: "vat", name: "VAT", kind: "vat", rate: 1800, base: ["net", "sc"] }] }),
      ),
    ).toThrow(/earlier rule/);
  });

  it("rejects zero/negative quantities and fractional cents", () => {
    expect(() => calculateCheck(check({ lines: [{ ...kottu, quantity: 0 }] }))).toThrow(/quantity/);
    expect(() => calculateCheck(check({ lines: [{ ...kottu, quantity: 1.0005 }] }))).toThrow(/quantity/);
    expect(() => calculateCheck(check({ lines: [{ ...kottu, unitPrice: 10.5 }] }))).toThrow(/cents/);
  });
});
