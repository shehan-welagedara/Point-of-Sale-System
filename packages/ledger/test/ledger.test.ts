import { describe, expect, it } from "vitest";
import { COLLECTIONS as C, type Invoice } from "@pos/core";
import {
  type AccountBalance,
  type Asset,
  type FiscalYear,
  type LedgerEntry,
  type PaymentVoucher,
  type PurchaseInvoice,
  type SalesInvoice,
  type Voucher,
  LEDGER as L,
  LedgerError,
  SoDError,
  aging,
  approveVoucher,
  balanceSheet,
  budgetVsActual,
  cashFlow,
  closeFiscalYear,
  depreciationFor,
  depreciationSchedule,
  disposeAsset,
  incomeStatement,
  parseStatementCsv,
  postPosDay,
  rejectVoucher,
  reverseVoucher,
  runDepreciation,
  setPeriodStatus,
  submitVoucher,
  suggestMatches,
  taxSummary,
  trialBalance,
  defaultChartOfAccounts,
} from "../src/index.js";
import { NOW, alice, bob, dayStats, journal, ledgerStore } from "./fixtures.js";

const range = { fromPeriod: "2026-04", toPeriod: "2027-03", fyStartPeriod: "2026-04" };

describe("journals: approval, segregation of duties, numbering", () => {
  it("needs a second person to approve and numbers vouchers without gaps", async () => {
    const { store, runner } = await ledgerStore();
    await store.set(L.vouchers, journal("j1", [{ account: "6100", debit: 150_000_00, credit: 0, memo: "November rent" }, { account: "1010", debit: 0, credit: 150_000_00 }]));
    const sub = await submitVoucher(runner, { voucherId: "j1", actor: alice, now: NOW });
    expect(sub.status).toBe("submitted");
    expect(await store.list(L.ledger)).toHaveLength(0);
    await expect(approveVoucher(runner, { voucherId: "j1", actor: alice, now: NOW })).rejects.toBeInstanceOf(SoDError);
    const ok = await approveVoucher(runner, { voucherId: "j1", actor: bob, now: NOW });
    expect(ok.voucher).toMatchObject({ status: "posted", number: "JV-202627-00001", approvedBy: "bob", period: "2026-11", totalBase: 150_000_00 });
    expect(await store.list<LedgerEntry>(L.ledger)).toHaveLength(2);
    const bal = await store.get<AccountBalance>(L.balances, "2026-11__6100__CMB");
    expect(bal).toMatchObject({ debit: 150_000_00, credit: 0 });

    // A rejected voucher goes back to draft and does not consume a number.
    await store.set(L.vouchers, journal("j2", [{ account: "6200", debit: 10_00, credit: 0 }, { account: "1000", debit: 0, credit: 10_00 }]));
    await submitVoucher(runner, { voucherId: "j2", actor: alice, now: NOW });
    const rej = await rejectVoucher(runner, { voucherId: "j2", actor: bob, now: NOW, reason: "Attach the bill" });
    expect(rej).toMatchObject({ status: "draft", lastRejection: { reason: "Attach the bill" } });
    await submitVoucher(runner, { voucherId: "j2", actor: alice, now: NOW });
    const j2 = await approveVoucher(runner, { voucherId: "j2", actor: bob, now: NOW });
    expect(j2.voucher.number).toBe("JV-202627-00002");
    expect(j2.voucher.prevHash).toBe(ok.voucher.hash);
  });

  it("posts directly below the approval threshold", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: 1_000_00 });
    await store.set(L.vouchers, journal("small", [{ account: "6200", debit: 500_00, credit: 0 }, { account: "1001", debit: 0, credit: 500_00 }]));
    expect((await submitVoucher(runner, { voucherId: "small", actor: alice, now: NOW })).status).toBe("posted");
  });

  it("rejects invalid postings", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: 1_000_000_00 });
    const cases: [string, Voucher, RegExp][] = [
      ["unbalanced", journal("u", [{ account: "6100", debit: 100, credit: 0 }, { account: "1010", debit: 0, credit: 99 }]), /do not balance/],
      ["group", journal("g", [{ account: "6", debit: 100, credit: 0 }, { account: "1010", debit: 0, credit: 100 }]), /group account/],
      ["party", journal("p", [{ account: "1100", debit: 100, credit: 0 }, { account: "4000", debit: 0, credit: 100 }]), /customer or supplier/],
      ["no fiscal year", journal("y", [{ account: "6100", debit: 100, credit: 0 }, { account: "1010", debit: 0, credit: 100 }], { postingDate: "2030-01-01" }), /no fiscal year/],
      ["cost centre", journal("c", [{ account: "6100", debit: 100, credit: 0, costCenter: "NOPE" }, { account: "1010", debit: 0, credit: 100 }]), /cost centre NOPE/],
    ];
    for (const [, v, err] of cases) {
      await store.set(L.vouchers, v);
      await expect(submitVoucher(runner, { voucherId: v.id, actor: alice, now: NOW })).rejects.toThrow(err);
    }
    expect(await store.list(L.ledger)).toHaveLength(0);
  });

  it("locks closed periods and requires a reason to reopen", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: 1_000_000_00 });
    await setPeriodStatus(runner, { periodId: "2026-11", status: "closed", actor: bob, now: NOW });
    await store.set(L.vouchers, journal("late", [{ account: "6100", debit: 100, credit: 0 }, { account: "1010", debit: 0, credit: 100 }]));
    await expect(submitVoucher(runner, { voucherId: "late", actor: alice, now: NOW })).rejects.toThrow(/period 2026-11 is closed/);
    await expect(setPeriodStatus(runner, { periodId: "2026-11", status: "open", actor: bob, now: NOW })).rejects.toThrow(/reason/);
    await setPeriodStatus(runner, { periodId: "2026-11", status: "open", actor: bob, now: NOW, reason: "Late supplier invoice" });
    expect((await submitVoucher(runner, { voucherId: "late", actor: alice, now: NOW })).status).toBe("posted");
  });

  it("cancels by reversal, never by deletion", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: 1_000_000_00 });
    await store.set(L.vouchers, journal("r", [{ account: "6400", debit: 20_000_00, credit: 0 }, { account: "1010", debit: 0, credit: 20_000_00 }]));
    await submitVoucher(runner, { voucherId: "r", actor: alice, now: NOW });
    await expect(reverseVoucher(runner, { voucherId: "r", actor: alice, now: NOW, date: "2026-11-04", reason: "" })).rejects.toThrow(/reason/);
    const rev = await reverseVoucher(runner, { voucherId: "r", actor: alice, now: NOW, date: "2026-11-04", reason: "Posted to the wrong account" });
    expect(rev).toMatchObject({ type: "reversal", number: "REV-202627-00001", reversalOf: "r" });
    expect(await store.get(L.vouchers, "r")).toMatchObject({ status: "cancelled", reversedBy: rev.id });
    expect(await store.list(L.ledger)).toHaveLength(4);
    const b = await store.get<AccountBalance>(L.balances, "2026-11__6400__CMB");
    expect(b!.debit - b!.credit).toBe(0);
    await expect(reverseVoucher(runner, { voucherId: "r", actor: alice, now: NOW, date: "2026-11-04", reason: "again" })).rejects.toThrow();
  });
});

describe("procure to pay", () => {
  const pi = (over: Partial<PurchaseInvoice> = {}): PurchaseInvoice => ({
    id: "pi1",
    type: "purchaseInvoice",
    status: "draft",
    postingDate: "2026-11-03",
    remarks: "Rice and oil",
    currency: "LKR",
    exchangeRateMicros: 1_000_000,
    costCenter: "CMB",
    createdBy: "alice",
    createdAt: NOW,
    supplierId: "V1",
    supplierInvoiceNo: "INV-778",
    supplierInvoiceDate: "2026-11-02",
    dueDate: "2026-12-02",
    purchaseOrderId: "PO-1",
    grnIds: ["GRN-1"],
    items: [
      { description: "Rice", inventoryItemId: "RICE", qty: 50, rate: 28_400 },
      { description: "Oil", inventoryItemId: "OIL", qty: 10, rate: 75_000 },
      { description: "Delivery", account: "6400", qty: 1, rate: 1_500_00 },
    ],
    vatAmount: 0,
    whtAmount: 0,
    ...over,
  });

  it("clears goods received not billed, books price variance and matches three ways", async () => {
    const { store, runner } = await ledgerStore({ paymentApprovalThreshold: 1_000_000_00 });
    await store.set(L.vouchers, pi({ vatAmount: 2_900_00 }));
    const res = await submitVoucher(runner, { voucherId: "pi1", actor: alice, now: NOW });
    expect(res.status).toBe("posted"); // 1.4% price difference is within the 2% tolerance
    const v = res.voucher as PurchaseInvoice;
    expect(v.match?.status).toBe("withinTolerance");
    const lines = await store.list<LedgerEntry>(L.ledger, { where: [["voucherId", "==", "pi1"]] });
    const by = (acc: string) => lines.filter((l) => l.account === acc).reduce((a, l) => a + l.debit - l.credit, 0);
    expect(by("2010")).toBe(50 * 28_000 + 10 * 75_000); // received-not-billed cleared at GRN cost
    expect(by("5120")).toBe(50 * 400); // purchase price variance
    expect(by("1300")).toBe(2_900_00);
    const total = 50 * 28_400 + 10 * 75_000 + 1_500_00 + 2_900_00;
    expect(by("2000")).toBe(-total);
    expect(v.outstanding).toBe(total);
    expect(lines.find((l) => l.account === "2000")!.partyId).toBe("V1");

    // Invoicing the same goods again is an exception that needs a second person.
    await store.set(L.vouchers, pi({ id: "pi2", supplierInvoiceNo: "INV-779" }));
    const dup = await submitVoucher(runner, { voucherId: "pi2", actor: alice, now: NOW });
    expect(dup.status).toBe("submitted");
    expect((dup.voucher as PurchaseInvoice).match?.issues.join(" ")).toMatch(/received but not yet invoiced 0/);
  });

  it("pays invoices (partially, with an advance and bank charges) and reverses payments", async () => {
    const { store, runner } = await ledgerStore({ paymentApprovalThreshold: 1_000_000_00 });
    await store.set(L.vouchers, pi());
    await submitVoucher(runner, { voucherId: "pi1", actor: alice, now: NOW });
    const due = (await store.get<PurchaseInvoice>(L.vouchers, "pi1"))!.outstanding!;
    const pay: PaymentVoucher = {
      id: "pay1", type: "payment", status: "draft", postingDate: "2026-11-05", remarks: "Part payment", currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: "CMB", createdBy: "alice", createdAt: NOW,
      direction: "pay", partyType: "supplier", partyId: "V1", bankAccount: "1010", amount: 1_000_000_00, allocations: [{ voucherId: "pi1", amount: 1_000_000_00 - 5_000_00 }], bankCharges: 150_00, reference: "CHQ 100245",
    };
    await expect(submitVoucher(runner, { voucherId: "pay1", actor: alice, now: NOW }).catch((e) => e)).resolves.toBeInstanceOf(LedgerError); // not stored yet
    await store.set(L.vouchers, { ...pay, allocations: [{ voucherId: "pi1", amount: due + 1 }] });
    await expect(submitVoucher(runner, { voucherId: "pay1", actor: alice, now: NOW })).rejects.toThrow(/exceeds its outstanding/);
    // Rs 25,000 paid: Rs 20,000 settles the invoice, Rs 5,000 is an advance; Rs 150 bank charges.
    await store.set(L.vouchers, { ...pay, amount: 25_000_00, allocations: [{ voucherId: "pi1", amount: 20_000_00 }] });
    const res = await submitVoucher(runner, { voucherId: "pay1", actor: alice, now: NOW });
    expect(res.voucher.number).toBe("PAY-202627-00001");
    expect((await store.get<PurchaseInvoice>(L.vouchers, "pi1"))!.outstanding).toBe(due - 20_000_00);
    const lines = await store.list<LedgerEntry>(L.ledger, { where: [["voucherId", "==", "pay1"]] });
    expect(lines.filter((l) => l.account === "1010").reduce((a, l) => a + l.credit - l.debit, 0)).toBe(25_000_00 + 150_00);
    expect(lines.filter((l) => l.account === "2000" && !l.againstVoucherId)[0]!.debit).toBe(5_000_00); // advance
    await reverseVoucher(runner, { voucherId: "pay1", actor: alice, now: NOW, date: "2026-11-06", reason: "Cheque returned" });
    expect((await store.get<PurchaseInvoice>(L.vouchers, "pi1"))!.outstanding).toBe(due);
  });

  it("books realised exchange differences on foreign currency invoices", async () => {
    const { store, runner } = await ledgerStore({ paymentApprovalThreshold: 1_000_000_00 });
    const { purchaseOrderId: _po, ...noPo } = pi();
    await store.set(L.vouchers, { ...noPo, currency: "USD", exchangeRateMicros: 300_000_000, grnIds: [], items: [{ description: "Coffee machine service", account: "6400", qty: 1, rate: 1_000_00 }] });
    await submitVoucher(runner, { voucherId: "pi1", actor: alice, now: NOW }); // USD 1,000 at 300 = Rs 300,000
    await store.set(L.vouchers, { id: "fx", type: "payment", status: "draft", postingDate: "2026-11-20", remarks: "", currency: "USD", exchangeRateMicros: 305_000_000, costCenter: "CMB", createdBy: "alice", createdAt: NOW, direction: "pay", partyType: "supplier", partyId: "V1", bankAccount: "1010", amount: 1_000_00, allocations: [{ voucherId: "pi1", amount: 1_000_00 }], bankCharges: 0 } satisfies PaymentVoucher);
    await submitVoucher(runner, { voucherId: "fx", actor: alice, now: NOW });
    const lines = await store.list<LedgerEntry>(L.ledger, { where: [["voucherId", "==", "fx"]] });
    expect(lines.find((l) => l.account === "4960")!.debit).toBe(5_000_00); // Rs 5,000 exchange loss
    expect(lines.find((l) => l.account === "2000")!.debit).toBe(300_000_00);
    expect(lines.find((l) => l.account === "1010")!).toMatchObject({ credit: 305_000_00, creditFc: 1_000_00, currency: "USD" });
  });
});

describe("order to cash", () => {
  it("invoices a credit customer, receives payment and ages open items", async () => {
    const { store, runner } = await ledgerStore();
    const si: SalesInvoice = { id: "si1", type: "salesInvoice", status: "draft", postingDate: "2026-09-01", remarks: "Corporate lunch", currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: "CMB", createdBy: "alice", createdAt: NOW, customerId: "CUS1", dueDate: "2026-09-30", items: [{ description: "Lunch buffet × 40", account: "4000", qty: 40, rate: 2_500_00 }], vatRateBp: 1800 };
    await store.set(L.vouchers, si);
    const res = await submitVoucher(runner, { voucherId: "si1", actor: alice, now: NOW });
    expect((res.voucher as SalesInvoice).outstanding).toBe(118_000_00);
    const rows = aging([(await store.get<SalesInvoice>(L.vouchers, "si1"))!], "2026-11-03");
    expect(rows[0]).toMatchObject({ daysOverdue: 34, bucket: "31–60" });
    await store.set(L.vouchers, { id: "rec", type: "payment", status: "draft", postingDate: "2026-11-03", remarks: "", currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: "CMB", createdBy: "alice", createdAt: NOW, direction: "receive", partyType: "customer", partyId: "CUS1", bankAccount: "1010", amount: 118_000_00, allocations: [{ voucherId: "si1", amount: 118_000_00 }], bankCharges: 0 } satisfies PaymentVoucher);
    await submitVoucher(runner, { voucherId: "rec", actor: alice, now: NOW }); // under the default threshold? no: 118k ≥ 50k needs approval
    await approveVoucher(runner, { voucherId: "rec", actor: bob, now: NOW });
    expect(aging([(await store.get<SalesInvoice>(L.vouchers, "si1"))!], "2026-11-03")).toHaveLength(0);
  });
});

describe("POS day posting", () => {
  it("posts the day once and only the difference for late sales", async () => {
    const { store, runner } = await ledgerStore();
    await store.set(C.dailyStats, dayStats(10_000_00, 4_000_00));
    const v1 = await postPosDay(runner, { propertyId: "CMB", businessDate: "2026-11-03", actor: alice, now: NOW });
    expect(v1).toMatchObject({ number: "POS-202627-00001", costCenter: "CMB" });
    expect((await store.list<LedgerEntry>(L.ledger)).every((l) => l.costCenter === "CMB")).toBe(true);
    expect(await postPosDay(runner, { propertyId: "CMB", businessDate: "2026-11-03", actor: alice, now: NOW })).toBeNull();
    await store.set(C.dailyStats, dayStats(12_000_00, 6_000_00));
    const v2 = await postPosDay(runner, { propertyId: "CMB", businessDate: "2026-11-03", actor: alice, now: NOW });
    const delta = (v2!.lines ?? []).find((l) => l.account === "4000")!;
    expect(delta.credit).toBe(2_000_00);
    const tb = trialBalance(defaultChartOfAccounts(), await store.list<AccountBalance>(L.balances), range);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    // the GRN of 2026-11-02 is not on this date; nothing about stock here
    expect((await store.list<LedgerEntry>(L.ledger)).some((l) => l.account === "2010")).toBe(false);
  });
});

describe("fixed assets", () => {
  const asset: Asset = { id: "A1", code: "FA-001", name: "Combi oven", category: "Kitchen", assetAccount: "1500", accumulatedDepAccount: "1591", depExpenseAccount: "6600", costCenter: "CMB", purchaseDate: "2026-04-10", availableDate: "2026-04-10", cost: 600_000_00, salvageValue: 0, method: "SL", usefulLifeMonths: 60, status: "active", accumulatedDep: 0 };

  it("computes straight-line and written-down value depreciation", () => {
    expect(depreciationFor(asset, "2026-04")).toBe(10_000_00);
    expect(depreciationFor(asset, "2026-11")).toBe(80_000_00); // catches up 8 months
    expect(depreciationFor({ ...asset, accumulatedDep: 80_000_00 }, "2026-11")).toBe(0);
    expect(depreciationSchedule(asset)).toHaveLength(60);
    expect(depreciationSchedule({ ...asset, cost: 100_00, usefulLifeMonths: 3 }).map((r) => r.amount)).toEqual([33_33, 33_34, 33_33]);
    const wdv = { ...asset, method: "WDV" as const, wdvRateBp: 2000 };
    expect(depreciationFor(wdv, "2026-04")).toBe(10_000_00);
    expect(depreciationFor({ ...wdv, accumulatedDep: 10_000_00 }, "2026-05")).toBe(9_833_33);
  });

  it("posts depreciation runs and disposals", async () => {
    const { store, runner } = await ledgerStore();
    await store.set(L.assets, asset);
    const dep = await runDepreciation(runner, { period: "2026-10", actor: alice, now: NOW });
    expect(dep).toMatchObject({ postingDate: "2026-10-31", totalBase: 70_000_00 });
    await expect(runDepreciation(runner, { period: "2026-10", actor: alice, now: NOW })).rejects.toThrow(/already posted/);
    expect(await store.get(L.assets, "A1")).toMatchObject({ accumulatedDep: 70_000_00, lastDepPeriod: "2026-10" });
    await reverseVoucher(runner, { voucherId: dep!.id, actor: alice, now: NOW, date: "2026-10-31", reason: "Wrong useful life" });
    expect(await store.get(L.assets, "A1")).toMatchObject({ accumulatedDep: 0, lastDepPeriod: "2026-09" });
    const again = await runDepreciation(runner, { period: "2026-10", actor: alice, now: NOW });
    expect(again!.id).toBe("DEP-2026-10-2"); // the cancelled voucher is never overwritten
    const disp = await disposeAsset(runner, { assetId: "A1", date: "2026-11-03", proceeds: 550_000_00, proceedsAccount: "1010", actor: alice, now: NOW });
    const lines = disp.lines!;
    expect(lines.find((l) => l.account === "4970")!.credit).toBe(20_000_00); // gain: 550k − (600k − 70k)
    expect(await store.get(L.assets, "A1")).toMatchObject({ status: "disposed" });
  });
});

describe("statements and year-end", () => {
  it("produces balanced statements and closes the year to retained earnings", async () => {
    const { store, runner } = await ledgerStore({ journalApprovalThreshold: Number.MAX_SAFE_INTEGER, paymentApprovalThreshold: Number.MAX_SAFE_INTEGER });
    const accounts = defaultChartOfAccounts();
    const post = async (id: string, date: string, lines: [string, number, number][]) => {
      await store.set(L.vouchers, journal(id, lines.map(([account, debit, credit]) => ({ account, debit, credit })), { postingDate: date }));
      await submitVoucher(runner, { voucherId: id, actor: alice, now: NOW });
    };
    await post("cap", "2026-04-01", [["1010", 5_000_000_00, 0], ["3000", 0, 5_000_000_00]]);
    await post("eq", "2026-04-05", [["1500", 1_200_000_00, 0], ["1010", 0, 1_200_000_00]]);
    await post("sales", "2026-05-31", [["1000", 2_000_000_00, 0], ["4000", 0, 1_694_915_25], ["2100", 0, 305_084_75]]);
    await post("rent", "2026-05-31", [["6100", 300_000_00, 0], ["1010", 0, 300_000_00]]);
    await post("dep", "2026-05-31", [["6600", 20_000_00, 0], ["1591", 0, 20_000_00]]);
    await post("loan", "2026-06-01", [["1010", 1_000_000_00, 0], ["2800", 0, 1_000_000_00]]);
    const balances = await store.list<AccountBalance>(L.balances);
    const tb = trialBalance(accounts, balances, range);
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(tb.totals.closing).toBe(0);
    const pl = incomeStatement(accounts, balances, range);
    expect(pl.revenue.total).toBe(1_694_915_25);
    expect(pl.netProfit).toBe(1_694_915_25 - 300_000_00 - 20_000_00);
    const bs = balanceSheet(accounts, balances, { asOfPeriod: "2026-06", fyStartPeriod: "2026-04" });
    expect(bs.balanced).toBe(true);
    expect(bs.currentYearProfit).toBe(pl.netProfit);
    const cf = cashFlow(accounts, balances, range);
    expect(cf.reconciles).toBe(true);
    expect(cf.depreciation).toBe(20_000_00);
    expect(cf.investingTotal).toBe(-1_200_000_00);
    expect(cf.financingTotal).toBe(6_000_000_00);
    expect(taxSummary(balances, range, { vatOutput: "2100", vatInput: "1300" }).outputVat).toBe(305_084_75);
    const bva = budgetVsActual(accounts, balances, [{ id: "b", fiscalYear: "2026-27", account: "6100", costCenter: "CMB", months: { "2026-04": 150_000_00, "2026-05": 150_000_00 } }], { fiscalYear: "2026-27", throughPeriod: "2026-05" });
    expect(bva[0]).toMatchObject({ budget: 300_000_00, actual: 300_000_00, variance: 0 });

    await expect(closeFiscalYear(runner, { fiscalYearId: "2026-27", actor: bob, now: NOW })).rejects.toThrow(/close all periods/);
    for (const p of (await store.get<FiscalYear>(L.fiscalYears, "2026-27"))!.periods) await setPeriodStatus(runner, { periodId: p.id, status: "closed", actor: bob, now: NOW });
    const pcv = await closeFiscalYear(runner, { fiscalYearId: "2026-27", actor: bob, now: NOW });
    expect(pcv.number).toBe("PCV-202627-00001");
    const after = await store.list<AccountBalance>(L.balances);
    const pl2 = incomeStatement(accounts, after, range);
    expect(pl2.netProfit).toBe(0);
    const re = after.filter((b) => b.account === "3100").reduce((a, b) => a + b.credit - b.debit, 0);
    expect(re).toBe(pl.netProfit);
    expect(balanceSheet(accounts, after, { asOfPeriod: "2027-03", fyStartPeriod: "2026-04" }).balanced).toBe(true);
    expect((await store.get<FiscalYear>(L.fiscalYears, "2026-27"))!.status).toBe("closed");
  });
});

describe("bank reconciliation", () => {
  it("parses statements and proposes matches", () => {
    const csv = 'Date,Narration,Reference,Withdrawal,Deposit\n05/11/2026,"CHQ 100245, Lanka Fresh",100245,"1,000,150.00",\n06/11/2026,Card settlement,BATCH77,,"84,250.50"\nbad,row,,,';
    const { lines, errors } = parseStatementCsv(csv);
    expect(lines).toEqual([
      { id: "L0001", date: "2026-11-05", description: "CHQ 100245, Lanka Fresh", reference: "100245", amount: -1_000_150_00 },
      { id: "L0002", date: "2026-11-06", description: "Card settlement", reference: "BATCH77", amount: 84_250_50 },
    ]);
    expect(errors).toHaveLength(1);
    const entry = (id: string, date: string, debit: number, credit: number, memo = ""): LedgerEntry => ({ id, voucherId: id, voucherType: "payment", voucherNo: id, postingDate: date, fiscalYear: "2026-27", period: "2026-11", account: "1010", debit, credit, currency: "LKR", debitFc: debit, creditFc: credit, exchangeRateMicros: 1_000_000, costCenter: "CMB", isReversal: false, createdAt: NOW, createdBy: "a", lineNo: 1, memo });
    const m = suggestMatches(lines, [entry("e1", "2026-11-04", 0, 1_000_150_00, "CHQ 100245"), entry("e2", "2026-11-05", 0, 1_000_150_00), entry("e3", "2026-11-01", 84_250_50, 0)]);
    expect(m.get("L0001")).toBe("e1");
    expect(m.get("L0002")).toBeUndefined(); // 5 days apart
  });
});

export type { Invoice };

describe("wholesale orders in the books", () => {
  it("invoices a dispatched order once and receipts confirmed payments against it", async () => {
    const { store, runner } = await ledgerStore({ paymentApprovalThreshold: 100_000_00 });
    const { WHOLESALE } = await import("@pos/core");
    const sales = { uid: "seller", name: "Sam (sales)", role: "sales" as const };
    const order = {
      id: "o1", number: "SO-000001", status: "dispatched", customerId: "SHOP1", customerName: "Lanka Fashion", channel: "whatsapp", date: "2026-11-03",
      lines: [{ id: "1", styleId: "OVS01", styleCode: "ZX-OVS01", name: "Oversized tee", colour: "Black", size: "M", sku: "ZX-OVS01-BLACK-M", qty: 24, unit: 1_250_00, amount: 30_000_00 }],
      print: { description: "Logo front", method: "screen", sides: ["front"], colours: 1, setupFee: 1_500_00, pricePerPiece: 150_00, status: "done" },
      discount: 1_000_00, deliveryCharge: 400_00, subtotal: 30_000_00 - 1_000_00 + 24 * 150_00 + 1_500_00 + 400_00, vat: 0, total: 34_500_00,
      payments: [{ id: "pay1", method: "bank", amount: 20_000_00, at: NOW, by: "whatsapp", status: "pending" }, { id: "pay2", method: "cod", amount: 14_500_00, at: NOW, by: "courier", status: "pending" }],
      paid: 0, paymentStatus: "unpaid", onCredit: false, createdBy: "seller", createdAt: NOW, updatedAt: NOW, history: [],
    };
    await store.set(WHOLESALE.salesOrders, order);
    const { postSalesOrder } = await import("../src/index.js");
    const inv = await postSalesOrder(runner, { orderId: "o1", event: "invoice", date: "2026-11-03", actor: sales, now: NOW });
    expect(inv.voucher).toMatchObject({ status: "posted", outstanding: 34_500_00, customerId: "SHOP1" });
    expect(inv.order.invoiceNo).toMatch(/^SINV-/);
    const again = await postSalesOrder(runner, { orderId: "o1", event: "invoice", date: "2026-11-03", actor: sales, now: NOW });
    expect(again.voucher!.id).toBe(inv.voucher!.id);
    const sinvLines = (await store.list<LedgerEntry>(L.ledger)).filter((l) => l.voucherId === inv.voucher!.id);
    expect(sinvLines.filter((l) => l.account === "4020").reduce((a, l) => a + l.credit, 0)).toBe(34_500_00);
    expect(sinvLines.find((l) => l.account === "1100")).toMatchObject({ debit: 34_500_00, partyId: "SHOP1" });

    const r1 = await postSalesOrder(runner, { orderId: "o1", event: "payment", paymentId: "pay1", date: "2026-11-04", actor: sales, now: NOW });
    expect(r1.order).toMatchObject({ paid: 20_000_00, paymentStatus: "partial" });
    // The courier's cash on delivery, less its fee, reaches the bank.
    const r2 = await postSalesOrder(runner, { orderId: "o1", event: "payment", paymentId: "pay2", date: "2026-11-06", fees: 568_00, actor: sales, now: NOW });
    expect(r2.order).toMatchObject({ paid: 34_500_00, paymentStatus: "paid" });
    expect((await store.get<SalesInvoice>(L.vouchers, inv.voucher!.id))!.outstanding).toBe(0);
    const bank = (await store.list<LedgerEntry>(L.ledger)).filter((l) => l.account === "1010").reduce((a, l) => a + l.debit - l.credit, 0);
    expect(bank).toBe(34_500_00 - 568_00);
    // Draft orders and quotations never reach the books.
    await store.set(WHOLESALE.salesOrders, { ...order, id: "o2", number: "SO-000002", status: "draft" });
    await expect(postSalesOrder(runner, { orderId: "o2", event: "invoice", date: "2026-11-03", actor: sales, now: NOW })).rejects.toThrow(/confirm it first/);
  });
});
