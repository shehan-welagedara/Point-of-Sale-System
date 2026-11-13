/**
 * "Colombo Tees": the wholesale demo (industry model "wholesale"), a T-shirt wholesaler selling to
 * shops around Sri Lanka, mostly over WhatsApp. Built through the real services, like the restaurant
 * demos: goods received at cost, orders confirmed, dispatched (stock out, invoiced), paid by bank
 * transfer, courier cash on delivery and cheques, a quotation with custom printing, and a WhatsApp
 * conversation in which the ordering assistant takes an order and a payment slip.
 */
import {
  type AccountingSettings,
  type Customer,
  type GoodsReceipt,
  type IntegrationSettings,
  type OrderPayment,
  type PriceList,
  type SalesOrder,
  type Style,
  type TenderMedia,
  type Tenant,
  type WriteOp,
  COLLECTIONS as C,
  DEFAULT_ROLES,
  MemoryStore,
  WHOLESALE,
  addDays,
  builtInEntitlements,
  handleInbound,
  issueStock,
  newId,
  nextDocNumber,
  orderTotals,
  paymentState,
  postGoodsReceipt,
  priceLines,
  printPrice,
  saveStyle,
  styleVariants,
} from "@pos/core";
import { type Actor, LEDGER as L, buildFiscalYear, defaultChartOfAccounts, defaultCostCenters, defaultLedgerSettings, ensureFiscalYear, postPosDay, postSalesOrder, storeRunner, submitVoucher } from "@pos/ledger";
import type { ModuleKey } from "@pos/core";
import type { sampleSettings } from "./index.js";

export const TEES_PROPERTY_ID = "MAIN";
const LOC = "MAIN";
const lkr = (rupees: number) => Math.round(rupees * 100);

export const TEES_MODULES: ModuleKey[] = ["wholesale", "whatsappCommerce", "inventory", "purchasing", "accounting", "crm", "revenue"];

const SIZES = ["S", "M", "L", "XL", "XXL"];
export const TEES_STYLES: Style[] = [
  { id: "OVS01", code: "CT-OVS01", name: "Oversized tee", category: "Oversized", fabric: "240 GSM combed cotton", description: "Drop-shoulder oversized fit, heavy cotton.", sizes: SIZES, colours: [{ name: "Black", hex: "#111111" }, { name: "Off-white", hex: "#f3efe6" }, { name: "Sage", hex: "#9caf88" }, { name: "Navy", hex: "#1f2a44" }], price: lkr(1450), cost: lkr(780), tiers: [{ minQty: 12, price: lkr(1300) }, { minQty: 50, price: lkr(1200) }, { minQty: 100, price: lkr(1120) }], sizeSurcharge: { XXL: lkr(100) }, packSize: 12, publish: true, active: true },
  { id: "CRW01", code: "CT-CRW01", name: "Classic crew-neck tee", category: "Basics", fabric: "180 GSM cotton", sizes: ["XS", ...SIZES], colours: [{ name: "Black", hex: "#111111" }, { name: "White", hex: "#ffffff" }, { name: "Grey melange", hex: "#9a9a9a" }, { name: "Maroon", hex: "#6d1a2a" }, { name: "Royal blue", hex: "#2b4fbf" }], price: lkr(950), cost: lkr(480), tiers: [{ minQty: 12, price: lkr(850) }, { minQty: 50, price: lkr(780) }, { minQty: 200, price: lkr(720) }], sizeSurcharge: { XXL: lkr(50) }, packSize: 12, publish: true, active: true },
  { id: "POL01", code: "CT-POL01", name: "Piqué polo", category: "Polo", fabric: "220 GSM piqué", sizes: SIZES, colours: [{ name: "Black", hex: "#111111" }, { name: "White", hex: "#ffffff" }, { name: "Navy", hex: "#1f2a44" }], price: lkr(1850), cost: lkr(1050), tiers: [{ minQty: 12, price: lkr(1700) }, { minQty: 50, price: lkr(1580) }], packSize: 10, publish: true, active: true },
  { id: "KID01", code: "CT-KID01", name: "Kids tee", category: "Kids", fabric: "160 GSM cotton", sizes: ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y"], colours: [{ name: "Yellow", hex: "#f5c518" }, { name: "Sky blue", hex: "#7cc4f0" }, { name: "Pink", hex: "#f4a6c0" }, { name: "White", hex: "#ffffff" }], price: lkr(650), cost: lkr(320), tiers: [{ minQty: 12, price: lkr(590) }, { minQty: 50, price: lkr(540) }], packSize: 12, publish: true, active: true },
  { id: "HOD01", code: "CT-HOD01", name: "Pullover hoodie", category: "Hoodies", fabric: "320 GSM fleece", sizes: SIZES, colours: [{ name: "Black", hex: "#111111" }, { name: "Charcoal", hex: "#3a3a3a" }, { name: "Navy", hex: "#1f2a44" }], price: lkr(3950), cost: lkr(2350), tiers: [{ minQty: 10, price: lkr(3650) }, { minQty: 30, price: lkr(3400) }], packSize: 5, publish: true, active: true },
];

const PRICE_LISTS: PriceList[] = [
  { id: "A-GRADE", name: "A-grade shops (5% off)", kind: "percent", percentOff: 500, active: true },
  { id: "RESELLER", name: "Resellers (10% off)", kind: "percent", percentOff: 1000, active: true },
];

/** [id, contact, shop, area, phone (WhatsApp 94…), price list, credit limit (Rs), days, opted in to offers] */
const SHOPS: [string, string, string, string, string, string | null, number, number, boolean][] = [
  ["SHOP01", "Nimal Perera", "Lanka Fashion House", "Kandy", "94771230001", "A-GRADE", 500_000, 30, true],
  ["SHOP02", "Fathima Rizwan", "Trendz Boutique", "Colombo 06", "94771230002", "A-GRADE", 300_000, 30, true],
  ["SHOP03", "Kasun Jayasinghe", "KJ Clothing", "Galle", "94771230003", null, 0, 0, true],
  ["SHOP04", "Ruwan Silva", "Silva Textiles", "Kurunegala", "94771230004", "RESELLER", 750_000, 45, true],
  ["SHOP05", "Dilani Fernando", "Little Stars Kids", "Negombo", "94771230005", null, 0, 0, false],
  ["SHOP06", "Mohamed Imran", "Imran Traders", "Batticaloa", "94771230006", "RESELLER", 400_000, 30, true],
  ["SHOP07", "Sanduni Wickrama", "Online reseller (Instagram)", "Matara", "94771230007", null, 0, 0, true],
  ["SHOP08", "Tharindu Bandara", "Uni Merch Club", "Peradeniya", "94771230008", null, 0, 0, false],
];

export function teesSettings(s: ReturnType<typeof sampleSettings>): ReturnType<typeof sampleSettings> {
  return {
    ...s,
    business: { ...s.business, legalName: "Colombo Tees (Pvt) Ltd", tradingName: "Colombo Tees", tin: "", vatRegistered: false, ssclLiable: false, addressLines: ["Demo address (replace under Business & tax)", "Colombo 11"], phone: "+94 11 000 0000", email: "", website: "", isSample: true, country: "LK", currency: "LKR", locale: "en-LK", timeZone: "Asia/Colombo", taxProfile: "LK" },
    branding: { ...s.branding, displayName: "Colombo Tees", receiptHeaderLines: [], receiptFooterLines: ["Thank you for your business!"] },
    pos: { ...s.pos, defaultPropertyId: TEES_PROPERTY_ID },
    accounting: { ...s.accounting, accounts: { ...s.accounting.accounts, salesByMajorGroup: { ...s.accounting.accounts.salesByMajorGroup, Other: "4020" }, cogsByMajorGroup: { ...s.accounting.accounts.cogsByMajorGroup, Other: "5020" } }, ledger: defaultLedgerSettings(TEES_PROPERTY_ID) } as AccountingSettings,
    integrations: {
      ...s.integrations,
      whatsapp: {
        ...s.integrations.whatsapp,
        mode: "mock",
        displayPhone: "+94 77 000 0000",
        bot: { enabled: true, hours: "Mon–Sat 9am–6pm" },
        bankDetails: "Sample Bank PLC, Pettah branch\nAccount 0001 2345 6789\nColombo Tees (Pvt) Ltd",
        templates: { order_dispatched: "order_on_the_way", payment_reminder: "payment_due_reminder", new_arrivals: "new_arrivals" },
        templateLanguage: "en",
        autoNotify: true,
      },
    },
  };
}

/** Builds the Colombo Tees demo in a MemoryStore (see the file comment). */
export async function buildWholesaleSample(opts: { today: string; settings: ReturnType<typeof sampleSettings>; tenders: TenderMedia[] }): Promise<{ store: MemoryStore; tenant: Omit<Tenant, "ownerUid" | "createdAt"> }> {
  const store = new MemoryStore();
  const now = new Date().toISOString();
  const runner = storeRunner(store);
  const owner: Actor = { uid: "local-owner", name: "Owner (demo)", role: "owner" };
  const sales: Actor = { uid: "local-sales", name: "Sales (demo)", role: "sales" };
  for (const doc of Object.values(opts.settings)) await store.set(C.settings, doc);
  await store.set(C.properties, { id: TEES_PROPERTY_ID, code: TEES_PROPERTY_ID, name: "Colombo Tees warehouse", addressLines: ["Colombo 11"], active: true });
  await store.set(C.locations, { id: LOC, name: "Warehouse", isDefault: true });
  const put = (col: string, data: object): WriteOp => ({ op: "set", col, data: data as { id: string } });
  await store.batch([
    ...DEFAULT_ROLES.map((data) => put(C.roles, data)),
    ...opts.tenders.map((t) => put(C.tenderMedia, { ...t, active: t.type === "cash" || t.type === "card" })),
    ...defaultChartOfAccounts().map((a) => put(C.accounts, a.id === "4020" ? { ...a, name: "Sales – garments" } : a.id === "5020" ? { ...a, name: "Cost of sales – garments" } : a.id === "1200" ? { ...a, name: "Inventory – garments" } : a)),
    ...defaultCostCenters([{ id: TEES_PROPERTY_ID, name: "Colombo Tees" }]).map((data) => put(L.costCenters, data)),
    ...PRICE_LISTS.map((data) => put(WHOLESALE.priceLists, data)),
    put(WHOLESALE.couriers, { id: "ISLAND", name: "Island Express (sample)", phone: "+94 11 000 0001", codFeeBp: 100, parcelFee: lkr(350), active: true }),
    put(WHOLESALE.couriers, { id: "CITY", name: "City Courier (sample)", phone: "+94 11 000 0002", codFeeBp: 150, parcelFee: lkr(300), active: true }),
    put(C.vendors, { id: "MILL", code: "MILL", name: "Knit mill (sample)", contactName: "Sales desk", phone: "+94 11 000 0003", paymentTermsDays: 30, active: true }),
  ]);
  const fyStart = Number(opts.today.slice(5, 7)) >= 4 ? Number(opts.today.slice(0, 4)) : Number(opts.today.slice(0, 4)) - 1;
  await store.set(L.fiscalYears, buildFiscalYear(fyStart, 4));
  const openDate = addDays(opts.today, -14);
  await ensureFiscalYear(runner, { date: openDate });

  // Opening capital in the bank.
  await store.set(L.vouchers, { id: "OPEN-TEES", type: "journal", status: "draft", postingDate: openDate, remarks: "Opening capital", currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: TEES_PROPERTY_ID, propertyId: TEES_PROPERTY_ID, createdBy: owner.uid, createdAt: now, lines: [{ account: "1010", debit: lkr(4_000_000), credit: 0 }, { account: "3000", debit: 0, credit: lkr(4_000_000) }] });
  const opened = await submitVoucher(runner, { voucherId: "OPEN-TEES", actor: owner, now });
  if (opened.status !== "posted") await store.merge(L.vouchers, "OPEN-TEES", { status: "draft" });

  // Styles, their variants as stock items, and stock received from the mill.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const s of TEES_STYLES) await saveStyle(store, { ...s, updatedAt: now });
  // Received in packs (the style's pack size) at the cost per pack: 4–11 packs per size and colour.
  const lines = TEES_STYLES.flatMap((s) => styleVariants(s).map((v) => ({ inventoryItemId: v.sku, qty: rnd() < 0.08 ? 0 : 4 + Math.floor(rnd() * 8), unitCost: s.cost! * (s.packSize ?? 1) }))).filter((l) => l.qty > 0);
  const grn: GoodsReceipt = { id: "GRN-0001", number: "GRN-0001", vendorId: "MILL", locationId: LOC, supplierInvoiceNo: "MILL-2611-01", date: openDate, lines, inputVat: 0, status: "draft" };
  await store.set(C.goodsReceipts, grn);
  await postGoodsReceipt(store, grn.id, "sample-data");

  // Shops.
  for (const [id, name, shopName, area, wa, priceListId, credit, days, optIn] of SHOPS) {
    const c: Customer = { id, name, shopName, area, phone: `+${wa}`, whatsapp: wa, whatsappOptIn: optIn, tags: ["wholesale", ...(credit ? ["credit"] : [])], marketingConsent: optIn, visits: 0, totalSpend: 0, points: 0, createdAt: now, ...(priceListId ? { priceListId } : {}), ...(credit ? { creditLimit: lkr(credit), paymentTermsDays: days } : {}) };
    await store.set(C.customers, c);
  }

  // Orders through their life: confirmed → packed → dispatched (stock out, invoice) → delivered, with payments.
  const styles = new Map(TEES_STYLES.map((s) => [s.id, s]));
  const lists = new Map(PRICE_LISTS.map((p) => [p.id, p]));
  const make = async (args: { customer: string; date: string; items: [string, string, string, number][]; status: SalesOrder["status"]; courier?: string; cod?: boolean; credit?: boolean; channel?: SalesOrder["channel"]; print?: boolean; payments?: [OrderPayment["method"], number, "confirm" | "pending", string?][] }) => {
    const shop = SHOPS.find((x) => x[0] === args.customer)!;
    const priceList = shop[5] ? lists.get(shop[5])! : null;
    const priced = priceLines(args.items.map(([styleId, colour, size, qty]) => { const s = styles.get(styleId)!; return { id: newId(), styleId, styleCode: s.code, name: s.name, colour, size, sku: styleVariants(s).find((v) => v.colour === colour && v.size === size)!.sku, qty }; }), styles, priceList);
    const print = args.print ? { description: "Club logo, front chest", method: "screen" as const, sides: ["Front"], colours: 2, status: "design" as const, ...printPrice({ method: "screen", sides: ["Front"], colours: 2 }) } : undefined;
    const t = orderTotals({ lines: priced, ...(print ? { print } : {}), discount: 0, deliveryCharge: args.courier ? lkr(450) : 0 }, 0);
    const quote = args.status === "quotation";
    const o: SalesOrder = {
      id: newId(), number: await nextDocNumber(store, quote ? "QT" : "SO"), status: quote ? "quotation" : "confirmed", customerId: shop[0], customerName: `${shop[2]} (${shop[1]})`, channel: args.channel ?? "phone", date: args.date,
      lines: priced, ...(print ? { print } : {}), discount: 0, deliveryCharge: args.courier ? lkr(450) : 0, subtotal: t.subtotal, vat: t.vat, total: t.total,
      delivery: args.courier ? { method: "courier", courierId: args.courier, address: `${shop[2]}, ${shop[3]}`, phone: `+${shop[4]}`, cod: Boolean(args.cod), ...(args.cod ? { codAmount: t.total } : {}) } : { method: "pickup", cod: false },
      payments: [], paid: 0, paymentStatus: "unpaid", onCredit: Boolean(args.credit), createdBy: "Sales (demo)", createdAt: `${args.date}T04:30:00.000Z`, updatedAt: `${args.date}T04:30:00.000Z`,
      ...(quote ? { validUntil: addDays(args.date, 14) } : {}),
      history: [{ at: `${args.date}T04:30:00.000Z`, by: "Sales (demo)", status: quote ? "quotation" : "confirmed", note: "created" }],
    };
    await store.set(WHOLESALE.salesOrders, o);
    if (["dispatched", "delivered"].includes(args.status)) {
      const mv = await issueStock(store, { locationId: LOC, lines: o.lines.map((l) => ({ itemId: l.sku, qty: l.qty })), businessDate: args.date, ref: o.number });
      await store.merge(WHOLESALE.salesOrders, o.id, { status: "dispatched", stockMovementId: mv.id, dueDate: args.credit ? addDays(args.date, shop[7] || 30) : args.date, delivery: { ...o.delivery!, trackingNo: `IE${String(1000 + Math.floor(rnd() * 8999))}`, dispatchedAt: `${args.date}T09:00:00.000Z` } });
      await postSalesOrder(runner, { orderId: o.id, event: "invoice", date: args.date, actor: sales, now });
      if (args.status === "delivered") await store.merge(WHOLESALE.salesOrders, o.id, { status: "delivered", delivery: { ...o.delivery!, deliveredAt: `${addDays(args.date, 1)}T08:00:00.000Z` } });
    } else if (args.status === "packed") await store.merge(WHOLESALE.salesOrders, o.id, { status: "packed" });
    for (const [method, share, state, ref] of args.payments ?? []) {
      const cur = (await store.get<SalesOrder>(WHOLESALE.salesOrders, o.id))!;
      const p: OrderPayment = { id: newId(), method, amount: Math.round(cur.total * share), at: `${args.date}T10:00:00.000Z`, by: "Sales (demo)", ...(ref ? { reference: ref } : {}), status: "pending" };
      const payments = [...cur.payments, p];
      await store.merge(WHOLESALE.salesOrders, o.id, { payments, ...paymentState(cur.total, payments) });
      if (state === "confirm") await postSalesOrder(runner, { orderId: o.id, event: "payment", paymentId: p.id, date: args.date, ...(method === "cod" ? { fees: lkr(350) + Math.round(p.amount * 0.01) } : {}), actor: sales, now });
    }
    return o;
  };
  const d = (n: number) => addDays(opts.today, -n);
  await make({ customer: "SHOP01", date: d(12), status: "delivered", courier: "ISLAND", credit: true, items: [["OVS01", "Black", "M", 24], ["OVS01", "Black", "L", 24], ["OVS01", "Off-white", "L", 12], ["CRW01", "White", "M", 36]], payments: [["bank", 1, "confirm", "BOC transfer 5521"]] });
  await make({ customer: "SHOP04", date: d(10), status: "delivered", courier: "CITY", credit: true, items: [["CRW01", "Black", "M", 60], ["CRW01", "Black", "L", 60], ["CRW01", "Grey melange", "L", 36], ["POL01", "Navy", "L", 20]] });
  await make({ customer: "SHOP03", date: d(8), status: "delivered", courier: "ISLAND", cod: true, items: [["OVS01", "Sage", "M", 12], ["OVS01", "Navy", "XL", 12]], payments: [["cod", 1, "confirm", "Island Express statement 44"]] });
  await make({ customer: "SHOP02", date: d(6), status: "delivered", courier: "ISLAND", credit: true, items: [["OVS01", "Off-white", "S", 12], ["OVS01", "Off-white", "M", 24], ["HOD01", "Black", "M", 10]], payments: [["cheque", 0.5, "pending", "Sampath 004512"]] });
  await make({ customer: "SHOP06", date: d(3), status: "dispatched", courier: "CITY", cod: true, items: [["CRW01", "Maroon", "M", 24], ["CRW01", "Royal blue", "L", 24]] });
  await make({ customer: "SHOP05", date: d(2), status: "dispatched", courier: "ISLAND", cod: true, items: [["KID01", "Yellow", "4-5Y", 12], ["KID01", "Sky blue", "6-7Y", 12], ["KID01", "Pink", "4-5Y", 12]] });
  await make({ customer: "SHOP07", date: d(1), status: "packed", courier: "ISLAND", items: [["OVS01", "Black", "XL", 12], ["OVS01", "Black", "XXL", 6]], payments: [["bank", 1, "pending", "Slip on WhatsApp"]] });
  await make({ customer: "SHOP01", date: d(0), status: "confirmed", courier: "ISLAND", credit: true, items: [["POL01", "Black", "M", 20], ["POL01", "White", "L", 20]] });
  await make({ customer: "SHOP08", date: d(0), status: "quotation", print: true, items: [["CRW01", "Black", "S", 20], ["CRW01", "Black", "M", 40], ["CRW01", "Black", "L", 40], ["CRW01", "Black", "XL", 20]] });

  // A WhatsApp conversation: the assistant takes an order and a payment slip.
  const settings = (await store.get<IntegrationSettings>(C.settings, "integrations"))!.whatsapp;
  const at = (min: number) => new Date(Date.parse(`${opts.today}T03:00:00.000Z`) + min * 60_000);
  const talk = [
    { text: "Hi" }, { replyId: "m:order" }, { replyId: "s:OVS01" }, { replyId: "c:Black" }, { replyId: "z:M" }, { text: "24" },
    { replyId: "c:checkout" }, { text: "No 12, Main Street, Kandy. 0771230009" }, { replyId: "p:bank" },
  ];
  let i = 0;
  for (const m of talk) {
    i++;
    const r = await handleInbound(store, { id: `demo.wa.${i}`, from: "94771230009", name: "Chathura (Kandy)", at: at(i).toISOString(), type: "replyId" in m ? "interactive" : "text", ...m }, { settings, businessName: "Colombo Tees", vatRateBp: 0, paymentLink: false, now: at(i) });
    for (const reply of r.replies) await store.set("waMessages", { id: `demo.out.${i}.${r.replies.indexOf(reply)}`, conversationId: "94771230009", direction: "out", at: new Date(at(i).getTime() + 2000).toISOString(), text: reply.kind === "text" ? reply.text : "text" in reply ? reply.text : "", payload: reply, status: "simulated" });
  }
  await handleInbound(store, { id: "demo.wa.slip", from: "94771230009", name: "Chathura (Kandy)", at: at(15).toISOString(), type: "image", image: { mediaId: "demo-slip", caption: "Paid" } }, { settings, businessName: "Colombo Tees", vatRateBp: 0, paymentLink: false, now: at(15) });

  // The days' cost of sales and goods received into the books.
  for (let day = openDate; day <= opts.today; day = addDays(day, 1)) await postPosDay(runner, { propertyId: TEES_PROPERTY_ID, businessDate: day, actor: owner, now });

  const modules = Object.fromEntries(TEES_MODULES.map((m) => [m, true])) as Tenant["modules"];
  return { store, tenant: { id: "demo-colombo-tees", name: "Colombo Tees (demo)", industry: "wholesale", modules, plan: "demo", entitlements: builtInEntitlements("demo"), status: "active" } };
}
