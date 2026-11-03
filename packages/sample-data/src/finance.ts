import { type GoodsReceipt, type MemoryStore, addDays } from "@pos/core";
import {
  type Actor,
  type Asset,
  type GlBudget,
  type JournalVoucher,
  type PaymentVoucher,
  type PurchaseInvoice,
  type SalesInvoice,
  LEDGER as L,
  approveVoucher,
  buildFiscalYear,
  defaultCostCenters,
  ensureFiscalYear,
  postPosDay,
  runDepreciation,
  storeRunner,
  submitVoucher,
} from "@pos/ledger";

/** Demo identities used to show maker-checker: the accountant prepares, the owner approves. */
export const DEMO_PEOPLE = {
  owner: { uid: "local-owner", name: "Owner (demo)", role: "owner" },
  accountant: { uid: "local-accountant", name: "Accountant (demo)", role: "accountant" },
  auditor: { uid: "local-auditor", name: "External auditor (demo)", role: "auditor" },
} as const satisfies Record<string, Actor>;

const lkr = (rupees: number) => Math.round(rupees * 100);
const BASE = { currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: "CMB", propertyId: "CMB" } as const;

/**
 * Books for the demo restaurant, created through the ledger exactly as users would: opening
 * balances, fixed assets and depreciation, posted POS days, supplier invoices matched to goods
 * receipts, payments, a corporate customer invoice and budgets. Some items are left waiting for
 * approval so the approval inbox has work in it.
 */
export async function seedFinance(store: MemoryStore, opts: { today: string; historyStart: string; openDate: string; propertyId: string }): Promise<void> {
  const runner = storeRunner(store);
  const acc: Actor = DEMO_PEOPLE.accountant;
  const own: Actor = DEMO_PEOPLE.owner;
  const now = new Date().toISOString();
  await store.batch(defaultCostCenters([{ id: opts.propertyId, name: "Colombo 03 (Galle Road)" }]).map((data) => ({ op: "set" as const, col: L.costCenters, data })));
  const fyStart = Number(opts.today.slice(5, 7)) >= 4 ? Number(opts.today.slice(0, 4)) : Number(opts.today.slice(0, 4)) - 1;
  await store.set(L.fiscalYears, buildFiscalYear(fyStart, 4));
  await ensureFiscalYear(runner, { date: opts.openDate });
  const fyFirstDay = `${fyStart}-04-01`;

  const journal = async (id: string, date: string, remarks: string, lines: [string, number, number, string?][], approve = true) => {
    const v: JournalVoucher = { id, type: "journal", status: "draft", postingDate: date, remarks, ...BASE, createdBy: acc.uid, createdAt: now, lines: lines.map(([account, dr, cr, memo]) => ({ account, debit: lkr(dr), credit: lkr(cr), ...(memo ? { memo } : {}) })) };
    await store.set(L.vouchers, v);
    const r = await submitVoucher(runner, { voucherId: id, actor: acc, now });
    if (approve && r.status === "submitted") await approveVoucher(runner, { voucherId: id, actor: own, now });
  };

  await journal("OPEN-2026", fyFirstDay, "Opening balances: capital introduced, equipment purchased", [
    ["1010", 3_050_000, 0, "Bank balance"],
    ["1500", 600_000, 0, "Combi oven"],
    ["1510", 900_000, 0, "Dining furniture"],
    ["1520", 450_000, 0, "POS terminal, tablets and printers"],
    ["3000", 0, 5_000_000, "Stated capital"],
  ]);

  const asset = (id: string, code: string, name: string, category: string, account: string, accDep: string, cost: number, life: number): Asset => ({
    id, code, name, category, assetAccount: account, accumulatedDepAccount: accDep, depExpenseAccount: "6600", costCenter: opts.propertyId, propertyId: opts.propertyId,
    purchaseDate: fyFirstDay, availableDate: `${fyStart}-04-15`, cost: lkr(cost), salvageValue: 0, method: "SL", usefulLifeMonths: life, status: "active", accumulatedDep: 0,
  });
  await store.batch([
    asset("FA-001", "FA-001", "Combi oven (Rational, sample)", "Kitchen equipment", "1500", "1591", 600_000, 60),
    asset("FA-002", "FA-002", "Dining furniture set", "Furniture and fittings", "1510", "1592", 900_000, 96),
    asset("FA-003", "FA-003", "POS terminal, 2 tablets, 3 printers", "IT and POS equipment", "1520", "1593", 450_000, 36),
  ].map((data) => ({ op: "set" as const, col: L.assets, data })));
  const lastMonth = addDays(`${opts.today.slice(0, 7)}-01`, -1).slice(0, 7);
  await runDepreciation(runner, { period: lastMonth, actor: acc, now });

  const monthEnd = addDays(`${opts.today.slice(0, 7)}-01`, -1);
  await journal("RENT-OCT", monthEnd, `Rent ${lastMonth}`, [["6100", 250_000, 0], ["1010", 0, 250_000]]);
  await journal("PAYROLL-OCT", monthEnd, `Salaries ${lastMonth}`, [["6000", 900_000, 0], ["6010", 108_000, 0], ["1010", 0, 900_000], ["2410", 0, 108_000]]);

  // POS days: the opening goods receipts day, then every trading day.
  for (let d = opts.openDate; d <= opts.today; d = addDays(d, 1)) await postPosDay(runner, { propertyId: opts.propertyId, businessDate: d, actor: acc, now });

  // Supplier invoices for the opening receipts.
  const grns = await store.list<GoodsReceipt>("goodsReceipts");
  const piFor = (g: GoodsReceipt, priceUp = 0): PurchaseInvoice => ({
    id: `PI-${g.vendorId}`, type: "purchaseInvoice", status: "draft", postingDate: addDays(g.date, 1), remarks: `Supplier invoice for ${g.number}`, ...BASE, createdBy: acc.uid, createdAt: now,
    supplierId: g.vendorId, supplierInvoiceNo: g.supplierInvoiceNo ?? `INV-${g.vendorId}`, supplierInvoiceDate: g.date, dueDate: addDays(g.date, 30), grnIds: [g.id],
    items: g.lines.map((l) => ({ description: l.inventoryItemId, inventoryItemId: l.inventoryItemId, qty: l.qty, rate: Math.round(l.unitCost * (1 + priceUp)) })),
    vatAmount: g.inputVat, whtAmount: 0,
  });
  for (const g of grns) {
    if (g.vendorId === "V005") continue; // left uninvoiced: shows as goods received not billed
    const v = piFor(g, g.vendorId === "V002" ? 0.05 : 0); // seafood billed 5% above the PO: needs approval
    await store.set(L.vouchers, v);
    await submitVoucher(runner, { voucherId: v.id, actor: acc, now });
  }
  const pay = async (id: string, vendor: string, amount: number, alloc: number, date: string, ref: string) => {
    const v: PaymentVoucher = { id, type: "payment", status: "draft", postingDate: date, remarks: `Payment to ${vendor}`, ...BASE, createdBy: acc.uid, createdAt: now, direction: "pay", partyType: "supplier", partyId: vendor, bankAccount: "1010", amount: lkr(amount), allocations: [{ voucherId: `PI-${vendor}`, amount: lkr(alloc) }], bankCharges: lkr(25), reference: ref };
    await store.set(L.vouchers, v);
    const r = await submitVoucher(runner, { voucherId: id, actor: acc, now });
    if (r.status === "submitted") await approveVoucher(runner, { voucherId: id, actor: own, now });
  };
  const pi = async (vendor: string) => (await store.get<PurchaseInvoice>(L.vouchers, `PI-${vendor}`))!;
  const v1 = await pi("V001");
  await pay("PAY-V001", "V001", v1.outstanding! / 100, v1.outstanding! / 100, addDays(opts.historyStart, 2), "CHQ 100245");
  const v3 = await pi("V003");
  await pay("PAY-V003", "V003", 60_000, 60_000, addDays(opts.historyStart, 4), "Online transfer");

  // Corporate catering on credit, half received.
  const si: SalesInvoice = { id: "SI-CATER-1", type: "salesInvoice", status: "draft", postingDate: addDays(opts.today, -12), remarks: "Corporate lunch – 40 guests", ...BASE, createdBy: acc.uid, createdAt: now, customerId: "CUS0003", dueDate: addDays(opts.today, -5), items: [{ description: "Lunch buffet × 40", account: "4020", qty: 40, rate: lkr(2_500) }], vatRateBp: 1800 };
  await store.set(L.vouchers, si);
  await submitVoucher(runner, { voucherId: si.id, actor: acc, now });
  const rec: PaymentVoucher = { id: "REC-CATER-1", type: "payment", status: "draft", postingDate: addDays(opts.today, -3), remarks: "Advance from corporate customer", ...BASE, createdBy: acc.uid, createdAt: now, direction: "receive", partyType: "customer", partyId: "CUS0003", bankAccount: "1010", amount: lkr(59_000), allocations: [{ voucherId: si.id, amount: lkr(59_000) }], bankCharges: 0, reference: "Bank transfer" };
  await store.set(L.vouchers, rec);
  const rr = await submitVoucher(runner, { voucherId: rec.id, actor: acc, now });
  if (rr.status === "submitted") await approveVoucher(runner, { voucherId: rec.id, actor: own, now });

  // Waiting for approval: a utilities journal prepared by the accountant.
  await journal("UTIL-NOV", opts.today, "Electricity bill (CEB) – estimate", [["6200", 85_000, 0], ["2300", 0, 85_000]], false);
  if (v3.outstanding) void v3;

  const months = buildFiscalYear(fyStart, 4).periods.map((p) => p.id);
  const budget = (account: string, monthly: number): GlBudget => ({ id: `${buildFiscalYear(fyStart, 4).id}__${account}__${opts.propertyId}`, fiscalYear: buildFiscalYear(fyStart, 4).id, account, costCenter: opts.propertyId, months: Object.fromEntries(months.map((m) => [m, lkr(monthly)])) });
  await store.batch([budget("4000", 2_100_000), budget("4010", 450_000), budget("6000", 900_000), budget("6100", 250_000), budget("6200", 120_000), budget("5000", 650_000)].map((data) => ({ op: "set" as const, col: L.glBudgets, data })));
  await store.set(L.exchangeRates, { id: `${opts.today}__USD`, date: opts.today, currency: "USD", rateMicros: 300_000_000 });
}
