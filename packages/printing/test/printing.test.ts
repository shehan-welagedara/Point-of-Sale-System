import { describe, expect, it } from "vitest";
import { calculateCheck, sriLankaChargeRules } from "@pos/engine";
import type { BrandingSettings, BusinessSettings, Check, TenderMedia } from "@pos/core";
import { DEFAULT_BILL_LAYOUT, buildBill, buildKot, feedbackLink, pairLines, resolveBillLayout, toEscPos, toText, wrap } from "../src/index.js";

const business: BusinessSettings = {
  id: "business",
  legalName: "Sample Restaurant (Pvt) Ltd",
  tradingName: "Spice Lagoon",
  tin: "100000000",
  vatRegistered: true,
  ssclLiable: false,
  addressLines: ["No. 25, Galle Road", "Colombo 03"],
  phone: "011 200 0000",
  email: "",
};
const branding: BrandingSettings = { id: "branding", displayName: "Spice Lagoon", primaryColor: "#000", accentColor: "#000", receiptHeaderLines: [], receiptFooterLines: ["Thank you!"], poweredBy: "Demo POS" };
const tenders = new Map<string, TenderMedia>([["CASH", { id: "CASH", name: "Cash", type: "cash", allowChange: true, requiresReference: false, opensDrawer: true, accountCode: "1000", sortOrder: 1, active: true }]]);

const check: Check = {
  id: "c1", propertyId: "P1", rvcId: "R1", workstationId: "W01", checkNo: 12, orderTypeId: "dine-in", tableId: "T4", covers: 2, staffId: "S1",
  status: "closed", sentRounds: 1, businessDate: "2026-11-03", openedAt: "2026-11-03T14:00:00Z", closedAt: "2026-11-03T15:11:00Z", channel: "pos",
  checkDiscountIds: [], change: 0,
  lines: [
    { id: "a", menuItemId: "K001", name: "Chicken Kottu", qty: 2, unitPrice: 120_000, modifiers: [{ groupId: "g", optionId: "o", name: "Extra spicy", price: 0 }], taxClass: "standard", kotRoute: "kitchen", categoryId: "K", discountIds: [], sentRound: 1 },
    { id: "b", menuItemId: "J001", name: "Lime Juice", qty: 1, unitPrice: 45_000, modifiers: [], taxClass: "standard", kotRoute: "bar", categoryId: "D", discountIds: [], sentRound: 1 },
  ],
  payments: [],
};

const totals = calculateCheck({
  orderType: "dine-in", pricing: "exclusive",
  rules: sriLankaChargeRules({ vatRegistered: true, ssclLiable: false }),
  lines: check.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.qty, unitPrice: l.unitPrice, taxClass: "standard" })),
});
const paid: Check = { ...check, payments: [{ id: "p", tenderId: "CASH", amount: 400_000, applied: totals.amountDue, tendered: 400_000, at: "", by: "S1" }], change: 400_000 - totals.amountDue };

describe("layout helpers", () => {
  it("wraps and pairs text", () => {
    expect(wrap("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(pairLines("Chicken Kottu", "2,400.00", 24)).toEqual(["Chicken Kottu   2,400.00"]);
  });
});

describe("bill", () => {
  it("prints the IRD tax invoice particulars for a VAT-registered seller", () => {
    const text = toText(buildBill({ kind: "invoice", check: paid, totals, business, branding, width: 48, staffName: "Nimali", orderTypeName: "Dine-in", tableName: "4", tenders, invoiceNo: "26NOV_W01_1", openDrawer: true }));
    for (const s of ["TAX INVOICE", "TIN: 100000000", "26NOV_W01_1", "Invoice Dt : ", "03-11-2026 20:41", "Supply Dt  :", "Value excl. VAT", "VAT 18%", "Service Charge 10%", "Change"]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("   - Extra spicy");
    expect(text.split("\n").every((l) => l.length <= 48)).toBe(true);
  });

  it("prints a plain invoice without VAT lines for non-registered sellers, and guest checks before payment", () => {
    const plain = toText(buildBill({ kind: "invoice", check: paid, totals, business: { ...business, vatRegistered: false }, branding, width: 32, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "26NOV_W01_2" }));
    expect(plain).not.toContain("TAX INVOICE");
    expect(plain).not.toContain("TIN:");
    const guest = toText(buildBill({ kind: "guestCheck", check, totals, business, branding, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, qr: { data: "000201", caption: "Scan to pay with LankaQR" } }));
    expect(guest).toContain("GUEST CHECK");
    expect(guest).toContain("not a tax invoice");
  });

  it("prints a Sri Lanka standard bill when the business isn't VAT registered, or the tax invoice is switched off", () => {
    // Not registered for VAT or SSCL: no VAT is charged, and the bill is a standard bill.
    const plainTotals = calculateCheck({ orderType: "dine-in", pricing: "exclusive", rules: sriLankaChargeRules({ vatRegistered: false, ssclLiable: false }), lines: check.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.qty, unitPrice: l.unitPrice, taxClass: "standard" })) });
    const plainPaid: Check = { ...paid, payments: [{ ...paid.payments[0]!, applied: plainTotals.amountDue }], change: 400_000 - plainTotals.amountDue };
    const notRegistered = { ...business, vatRegistered: false };
    const std = toText(buildBill({ kind: "invoice", check: plainPaid, totals: plainTotals, business: notRegistered, branding, width: 48, staffName: "Nimali", orderTypeName: "Dine-in", tableName: "4", tenders, invoiceNo: "26NOV_P01_7", openDrawer: true }));
    for (const s of ["INVOICE", "Bill No :", "26NOV_P01_7", "Date    :", "03-11-2026 20:41", "Service Charge 10%", "TOTAL (LKR)", "Cash", "Change", "Thank you!"]) expect(std).toContain(s);
    for (const s of ["TAX INVOICE", "TIN:", "Invoice Dt", "Supply Dt", "VAT", "Purchaser"]) expect(std).not.toContain(s);
    // Even with the switch on, a business that isn't registered can't print a tax invoice.
    expect(toText(buildBill({ kind: "invoice", check: plainPaid, totals: plainTotals, business: notRegistered, branding: { ...branding, bill: { taxInvoice: true, invoiceTitle: "BILL" } }, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "X1" }))).toMatch(/^\s*BILL/m);

    // VAT registered, tax invoice switched off: a standard bill showing the VAT charged…
    const off = { ...branding, bill: { taxInvoice: false } };
    const regStd = toText(buildBill({ kind: "invoice", check: paid, totals, business, branding: off, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "26NOV_W01_3" }));
    expect(regStd).not.toContain("TAX INVOICE");
    expect(regStd).toContain("Bill No :");
    expect(regStd).toContain("VAT 18%");
    expect(regStd).not.toContain("Supply Dt");
    // …but a VAT-registered buyer always gets a tax invoice, with their particulars.
    const b2b = toText(buildBill({ kind: "invoice", check: { ...paid, buyer: { name: "ABC Holdings", tin: "134567890", address: "Colombo 03" } }, totals, business, branding: off, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "26NOV_W01_4" }));
    for (const s of ["TAX INVOICE", "Invoice No :", "Supply Dt", "TIN: 100000000", "Purchaser:", "TIN: 134567890"]) expect(b2b).toContain(s);
  });

  it("follows the administrator's bill layout", () => {
    const layout = { titleSize: 1 as const, invoiceTitle: "BILL", guestCheckTitle: "PRE-BILL", showPhone: false, showServer: true, serverLabel: "Steward", showCovers: false, showModifiers: false, qtyStyle: "after" as const, showUnitPrice: true, showItemCount: true, guestCheckNote: "", showPoweredBy: false, totalLabel: "AMOUNT DUE", extraFeed: 3 };
    const plainBiz = { ...business, vatRegistered: false };
    const inv = toText(buildBill({ kind: "invoice", check: paid, totals, business: plainBiz, branding, width: 48, staffName: "Nimali", orderTypeName: "Dine-in", tenders, invoiceNo: "X1", layout }));
    expect(inv).toContain("BILL");
    expect(inv).not.toContain("Tel:");
    expect(inv).toContain("Steward: Nimali");
    expect(inv).not.toContain("Covers");
    expect(inv).not.toContain("Extra spicy");
    expect(inv).toContain("Chicken Kottu x2");
    expect(inv).toContain("2 @ 1,200.00");
    expect(inv).toMatch(/Items\s+3/);
    expect(inv).toContain("AMOUNT DUE");
    expect(inv).not.toContain("Powered by");
    const doc = buildBill({ kind: "invoice", check: paid, totals, business: plainBiz, branding, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "X1", layout });
    expect(doc.blocks).toContainEqual({ t: "feed", lines: 3 });
    const guest = toText(buildBill({ kind: "guestCheck", check, totals, business, branding: { ...branding, bill: layout }, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders }));
    expect(guest).toContain("PRE-BILL");
    expect(guest).not.toContain("not a tax invoice");
  });

  it("keeps the IRD particulars on a tax invoice whatever the layout says", () => {
    const layout = { showAddress: false, showSubtotal: false, invoiceTitle: "RECEIPT", showPhone: false };
    const text = toText(buildBill({ kind: "invoice", check: { ...paid, buyer: { name: "ABC Ltd", tin: "123456789", address: "Kandy" } }, totals, business, branding, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "26NOV_W01_9", layout }));
    for (const s of ["TAX INVOICE", "No. 25, Galle Road", "TIN: 100000000", "26NOV_W01_9", "Invoice Dt", "Supply Dt", "Subtotal", "Value excl. VAT", "VAT 18%", "Purchaser:", "123456789"]) expect(text).toContain(s);
    expect(text).not.toContain("RECEIPT");
    // A guest check is not a tax document, so the address may be dropped there.
    expect(toText(buildBill({ kind: "guestCheck", check, totals, business, branding, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, layout }))).not.toContain("Galle Road");
  });

  it("combines identical items and builds feedback links", () => {
    const dup: Check = { ...paid, lines: [...paid.lines, { ...paid.lines[1]!, id: "c" }] };
    const t2 = calculateCheck({ orderType: "dine-in", pricing: "exclusive", rules: sriLankaChargeRules({ vatRegistered: true, ssclLiable: false }), lines: dup.lines.map((l) => ({ id: l.id, name: l.name, quantity: l.qty, unitPrice: l.unitPrice, taxClass: "standard" })) });
    const text = toText(buildBill({ kind: "invoice", check: dup, totals: t2, business, branding, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "I", layout: { combineSameItems: true } }));
    expect(text).toMatch(/2 Lime Juice\s+900\.00/);
    expect(feedbackLink(DEFAULT_BILL_LAYOUT, "26NOV W01", "lagoon.lk")).toBe("https://lagoon.lk/feedback?inv=26NOV%20W01");
    expect(feedbackLink(DEFAULT_BILL_LAYOUT, "I1")).toBeUndefined();
    expect(feedbackLink(resolveBillLayout({ showFeedbackQr: false }), "I1", "x.lk")).toBeUndefined();
    expect(resolveBillLayout({ extraFeed: 40 }).extraFeed).toBe(6);
  });

  it("encodes ESC/POS with init, cut and drawer kick", () => {
    const bytes = toEscPos(buildBill({ kind: "invoice", check: paid, totals, business, branding, width: 48, staffName: "N", orderTypeName: "Dine-in", tenders, invoiceNo: "26NOV_W01_1", openDrawer: true }));
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40]);
    const hex = Buffer.from(bytes).toString("hex");
    expect(hex).toContain("1d564200");
    expect(hex).toContain("1b700019fa");
    expect(Buffer.from(bytes).toString("latin1")).toContain("TAX INVOICE");
  });
});

describe("KOT", () => {
  it("shows round, table and allergens", () => {
    const text = toText(buildKot({ check, lines: [check.lines[0]!], station: "Kitchen", width: 48, staffName: "Tharindu", orderTypeName: "Dine-in", tableName: "4", at: "2026-11-03T14:05:00Z", menuItems: new Map([["K001", { allergens: ["gluten", "egg"] } as never]]) }));
    expect(text).toContain("KOT - KITCHEN");
    expect(text).toContain("TABLE 4");
    expect(text).toContain("2 x Chicken Kottu");
    expect(text).toContain("CONTAINS: GLUTEN, EGG");
  });
});
