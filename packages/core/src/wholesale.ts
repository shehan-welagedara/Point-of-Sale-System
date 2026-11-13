/**
 * Wholesale & distribution (industry model "wholesale"; module "wholesale").
 *
 * - **Styles** with a size × colour matrix. Each variant is a stock item (`inventoryItems`, id =
 *   SKU such as ZX-OVS01-BLACK-XL) so receiving, FIFO costing, counts and the books work as for any
 *   stock, and each has a barcode (EAN-13 in the in-store 20–29 range) for scanning later.
 * - **Prices:** the style's price, a lower price per piece from a quantity (tiers, counted over the
 *   whole style on the order), the customer's price list (a percentage off, or fixed prices per
 *   style), then size and colour surcharges (XXL +Rs 100).
 * - **Sales documents:** quotation → order → packed → dispatched (stock out, invoice) → delivered,
 *   with payments by bank transfer (slip), payment link, cash on delivery through a courier,
 *   cheques (post-dated) or cash, and custom print jobs priced per side and colour.
 * - **Credit:** an order on credit may not take a customer over their credit limit without an
 *   owner's or manager's approval.
 */
import type { Cents } from "@pos/engine";
import { COLLECTIONS as C, type DocStore, type WriteOp } from "./store.js";
import type { Customer, InventoryItem } from "./types.js";

export const WHOLESALE = {
  styles: "styles",
  styleImages: "styleImages",
  priceLists: "priceLists",
  salesOrders: "salesOrders",
  couriers: "couriers",
  codSettlements: "codSettlements",
  cheques: "cheques",
  docSequences: "docSequences",
} as const;

export interface Style {
  id: string;
  /** Short code, the start of every SKU (ZX-OVS01). */
  code: string;
  name: string;
  category: string;
  description?: string;
  fabric?: string;
  sizes: string[];
  colours: { name: string; hex?: string }[];
  /** List price per piece. */
  price: Cents;
  /** Standard cost per piece (until goods are received at their real cost). */
  cost?: Cents;
  /** Lower prices per piece from a quantity of this style on one order. */
  tiers?: { minQty: number; price: Cents }[];
  sizeSurcharge?: Record<string, Cents>;
  colourSurcharge?: Record<string, Cents>;
  /** Pieces per pack (12 = a dozen) for packing and ordering in packs. */
  packSize?: number;
  /** Variant SKU → barcode. */
  barcodes?: Record<string, string>;
  /** Shown in the WhatsApp catalogue and to the order bot. */
  publish?: boolean;
  active: boolean;
  updatedAt?: string;
}

export interface PriceList {
  id: string;
  name: string;
  /** percent: a percentage off the list or tier price; fixed: set prices per style (others: list). */
  kind: "percent" | "fixed";
  /** Basis points off (1000 = 10%). */
  percentOff?: number;
  prices?: Record<string, Cents>;
  active: boolean;
}

export interface PrintSpec {
  description: string;
  method: "screen" | "dtf" | "dtg" | "sublimation" | "embroidery";
  /** Front, back, sleeves… */
  sides: string[];
  colours: number;
  artworkAttachmentId?: string;
  setupFee: Cents;
  pricePerPiece: Cents;
  status: "design" | "approved" | "printing" | "ready";
  dueDate?: string;
}

export interface PrintPricing {
  /** Per piece, per printed side. */
  perSide: Cents;
  /** Per piece, per extra colour on a side. */
  perExtraColour: Cents;
  /** Once per job, per colour per side (screens). */
  setupPerColour: Cents;
  minQty: number;
}

export const DEFAULT_PRINT_PRICING: PrintPricing = { perSide: 150_00, perExtraColour: 40_00, setupPerColour: 1_500_00, minQty: 12 };

export interface SalesLine {
  id: string;
  styleId: string;
  styleCode: string;
  name: string;
  colour: string;
  size: string;
  /** Variant SKU = stock item id. */
  sku: string;
  qty: number;
  /** Price per piece after tier, price list and surcharges. */
  unit: Cents;
  amount: Cents;
}

export type OrderStatus = "quotation" | "draft" | "confirmed" | "packed" | "dispatched" | "delivered" | "cancelled";
export type PaymentMethod = "bank" | "link" | "cod" | "cheque" | "cash" | "card";

export interface OrderPayment {
  id: string;
  method: PaymentMethod;
  amount: Cents;
  at: string;
  by: string;
  reference?: string;
  /** Photo of a bank slip sent on WhatsApp (attachments). */
  proofAttachmentId?: string;
  /** pending: to check (a slip, a cheque not cleared, COD not yet settled); confirmed: in the books. */
  status: "pending" | "confirmed" | "rejected";
  chequeId?: string;
  /** Ledger receipt once confirmed. */
  voucherId?: string;
}

export interface Delivery {
  method: "courier" | "own" | "pickup";
  courierId?: string;
  address?: string;
  phone?: string;
  trackingNo?: string;
  /** Cash on delivery: the courier collects `codAmount`. */
  cod: boolean;
  codAmount?: Cents;
  dispatchedAt?: string;
  deliveredAt?: string;
}

export interface SalesOrder {
  id: string;
  /** QT-000001 for quotations, SO-000001 once it is an order. */
  number: string;
  quotationNo?: string;
  status: OrderStatus;
  customerId: string;
  customerName: string;
  channel: "whatsapp" | "phone" | "walk-in" | "rep" | "web";
  date: string;
  validUntil?: string;
  lines: SalesLine[];
  print?: PrintSpec;
  /** Order discount (cents) and delivery charge. */
  discount: Cents;
  deliveryCharge: Cents;
  subtotal: Cents;
  vat: Cents;
  total: Cents;
  delivery?: Delivery;
  payments: OrderPayment[];
  paid: Cents;
  paymentStatus: "unpaid" | "partial" | "paid";
  /** On credit (invoice, paid later within the customer's terms). */
  onCredit: boolean;
  dueDate?: string;
  /** Ledger sales invoice (voucher id and number) and the stock movement of the dispatch. */
  invoiceId?: string;
  invoiceNo?: string;
  stockMovementId?: string;
  /** Credit limit exceeded, approved by. */
  creditApprovedBy?: string;
  conversationId?: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: { at: string; by: string; status: OrderStatus; note?: string }[];
}

export interface Courier {
  id: string;
  name: string;
  phone?: string;
  /** COD handling fee in basis points of the amount collected (e.g. 150 = 1.5%). */
  codFeeBp?: number;
  /** Fixed fee per parcel. */
  parcelFee?: Cents;
  trackingUrl?: string;
  active: boolean;
}

export interface CodSettlement {
  id: string;
  courierId: string;
  date: string;
  orderIds: string[];
  collected: Cents;
  fees: Cents;
  net: Cents;
  reference?: string;
  by: string;
  at: string;
}

export interface Cheque {
  id: string;
  customerId: string;
  orderId?: string;
  bank: string;
  number: string;
  amount: Cents;
  /** Date written on the cheque (post-dated cheques can't be banked before). */
  chequeDate: string;
  status: "received" | "deposited" | "cleared" | "bounced" | "returned";
  receivedAt: string;
  by: string;
  depositedAt?: string;
  clearedAt?: string;
  bouncedAt?: string;
  note?: string;
}

// ───────────────────────────── Variants and barcodes ─────────────────────────────

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "X";

/** SKU of a variant: style code, colour, size (ZX-OVS01-BLACK-XL). */
export function variantSku(styleCode: string, colour: string, size: string): string {
  return `${styleCode.toUpperCase().replace(/[^A-Z0-9-]+/g, "")}-${slug(colour)}-${slug(size)}`;
}

export function styleVariants(style: Pick<Style, "code" | "sizes" | "colours">): { sku: string; size: string; colour: string }[] {
  return style.colours.flatMap((c) => style.sizes.map((size) => ({ sku: variantSku(style.code, c.name, size), size, colour: c.name })));
}

/** EAN-13 check digit for 12 digits. */
export function ean13CheckDigit(d12: string): number {
  const s = d12.split("").reduce((a, ch, i) => a + Number(ch) * (i % 2 ? 3 : 1), 0);
  return (10 - (s % 10)) % 10;
}

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** A stable in-store EAN-13 for a SKU (prefix 2, from a hash of the SKU): for labels and scanning. */
export function barcodeForSku(sku: string): string {
  let h = 2166136261;
  for (const ch of sku) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const body = `2${String(h % 100_000_000_000).padStart(11, "0")}`;
  return `${body}${ean13CheckDigit(body)}`;
}

/** The stock items a style's variants are kept as (new ones created, names kept up to date). */
export function variantItems(style: Style, existing: ReadonlyMap<string, InventoryItem>): InventoryItem[] {
  return styleVariants(style).map(({ sku, size, colour }) => {
    const prev = existing.get(sku);
    return {
      ...(prev ?? { parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, vendorId: undefined }),
      id: sku,
      code: sku,
      name: `${style.name} · ${colour} · ${size}`,
      category: style.category,
      majorGroup: "Other",
      stockUnit: "pcs",
      purchaseUnit: style.packSize && style.packSize > 1 ? `pack of ${style.packSize}` : "pcs",
      purchaseFactor: style.packSize && style.packSize > 1 ? style.packSize : 1,
      purchaseCost: prev?.purchaseCost ?? (style.cost ?? 0) * (style.packSize && style.packSize > 1 ? style.packSize : 1),
      active: style.active,
      styleId: style.id,
      size,
      colour,
      barcode: style.barcodes?.[sku] ?? barcodeForSku(sku),
    } as InventoryItem;
  });
}

/** Saves a style and its variants (stock items), in one batch. */
export async function saveStyle(store: DocStore, style: Style): Promise<Style> {
  const items = new Map((await store.list<InventoryItem>(C.inventoryItems)).map((i) => [i.id, i]));
  const withCodes: Style = { ...style, barcodes: Object.fromEntries(styleVariants(style).map((v) => [v.sku, style.barcodes?.[v.sku] ?? barcodeForSku(v.sku)])), updatedAt: new Date().toISOString() };
  const ops: WriteOp[] = [{ op: "set", col: WHOLESALE.styles, data: withCodes }, ...variantItems(withCodes, items).map((data): WriteOp => ({ op: "set", col: C.inventoryItems, data: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as InventoryItem }))];
  await store.batch(ops);
  return withCodes;
}

// ───────────────────────────── Prices ─────────────────────────────

export interface PriceBreakdown {
  unit: Cents;
  base: Cents;
  tier?: { minQty: number; price: Cents };
  listOff: Cents;
  surcharge: Cents;
}

/**
 * Price per piece of a variant: the list price, or the best quantity tier for `styleQty` (pieces of
 * this style on the order); the customer's price list (fixed price for the style, or a percentage
 * off); then size and colour surcharges, which are never discounted.
 */
export function unitPrice(style: Style, args: { size: string; colour: string; styleQty: number; priceList?: PriceList | null }): PriceBreakdown {
  const tier = [...(style.tiers ?? [])].filter((t) => args.styleQty >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
  let base = tier ? Math.min(tier.price, style.price) : style.price;
  let listOff = 0;
  const pl = args.priceList?.active ? args.priceList : null;
  if (pl?.kind === "fixed" && pl.prices?.[style.id] !== undefined) {
    const fixed = pl.prices[style.id]!;
    listOff = Math.max(0, base - fixed);
    base = Math.min(base, fixed);
  } else if (pl?.kind === "percent" && pl.percentOff) {
    listOff = Math.round((base * pl.percentOff) / 10_000);
    base -= listOff;
  }
  const surcharge = (style.sizeSurcharge?.[args.size] ?? 0) + (style.colourSurcharge?.[args.colour] ?? 0);
  return { unit: base + surcharge, base, ...(tier ? { tier } : {}), listOff, surcharge };
}

/** Prices every line again (tiers count all pieces of a style on the order). */
export function priceLines(lines: readonly Omit<SalesLine, "unit" | "amount">[], styles: ReadonlyMap<string, Style>, priceList?: PriceList | null): SalesLine[] {
  const qtyByStyle = new Map<string, number>();
  for (const l of lines) qtyByStyle.set(l.styleId, (qtyByStyle.get(l.styleId) ?? 0) + l.qty);
  return lines.map((l) => {
    const style = styles.get(l.styleId);
    if (!style) throw new Error(`unknown style ${l.styleId}`);
    const { unit } = unitPrice(style, { size: l.size, colour: l.colour, styleQty: qtyByStyle.get(l.styleId) ?? l.qty, priceList: priceList ?? null });
    return { ...l, unit, amount: unit * l.qty };
  });
}

/** Price per piece of a print job, and its setup fee. */
export function printPrice(spec: Pick<PrintSpec, "sides" | "colours" | "method">, pricing: PrintPricing = DEFAULT_PRINT_PRICING): { pricePerPiece: Cents; setupFee: Cents } {
  const sides = Math.max(1, spec.sides.length);
  const colours = Math.max(1, spec.colours);
  const perPiece = sides * (pricing.perSide + (colours - 1) * pricing.perExtraColour);
  // Screens are made per colour per side; digital methods (DTF, DTG, sublimation) need no screens.
  const setup = spec.method === "screen" ? sides * colours * pricing.setupPerColour : spec.method === "embroidery" ? sides * pricing.setupPerColour : 0;
  return { pricePerPiece: perPiece, setupFee: setup };
}

export function orderTotals(o: Pick<SalesOrder, "lines" | "print" | "discount" | "deliveryCharge">, vatRateBp = 0): { subtotal: Cents; vat: Cents; total: Cents; pieces: number } {
  const pieces = o.lines.reduce((a, l) => a + l.qty, 0);
  const goods = o.lines.reduce((a, l) => a + l.amount, 0);
  const print = o.print ? o.print.pricePerPiece * pieces + o.print.setupFee : 0;
  const subtotal = goods + print - o.discount + o.deliveryCharge;
  const vat = Math.round((subtotal * vatRateBp) / 10_000);
  return { subtotal, vat, total: subtotal + vat, pieces };
}

/** Whether an order on credit fits within the customer's limit (what they owe already + this order). */
export function creditCheck(customer: Pick<Customer, "creditLimit">, owing: Cents, orderTotal: Cents): { allowed: boolean; available: Cents; over: Cents } {
  const limit = customer.creditLimit ?? 0;
  const available = Math.max(0, limit - owing);
  const over = Math.max(0, owing + orderTotal - limit);
  return { allowed: limit > 0 && over === 0, available, over };
}

export function paymentState(total: Cents, payments: readonly OrderPayment[]): { paid: Cents; paymentStatus: SalesOrder["paymentStatus"] } {
  const paid = payments.filter((p) => p.status === "confirmed").reduce((a, p) => a + p.amount, 0);
  return { paid, paymentStatus: paid <= 0 ? "unpaid" : paid >= total ? "paid" : "partial" };
}

/** What a courier owes for delivered COD parcels: collected less their fees. */
export function codSettlementFor(courier: Pick<Courier, "codFeeBp" | "parcelFee">, orders: readonly Pick<SalesOrder, "delivery">[]): { collected: Cents; fees: Cents; net: Cents } {
  const collected = orders.reduce((a, o) => a + (o.delivery?.cod ? (o.delivery.codAmount ?? 0) : 0), 0);
  const fees = orders.reduce((a, o) => a + (courier.parcelFee ?? 0) + Math.round(((o.delivery?.cod ? (o.delivery.codAmount ?? 0) : 0) * (courier.codFeeBp ?? 0)) / 10_000), 0);
  return { collected, fees, net: collected - fees };
}

/** Next document number (QT-000001, SO-000001…), kept per prefix in docSequences. */
export async function nextDocNumber(store: DocStore, prefix: "QT" | "SO" | "CS"): Promise<string> {
  const cur = await store.get<{ id: string; seq: number }>(WHOLESALE.docSequences, prefix);
  const seq = (cur?.seq ?? 0) + 1;
  await store.set(WHOLESALE.docSequences, { id: prefix, seq });
  return `${prefix}-${String(seq).padStart(6, "0")}`;
}

/** Pieces available to promise per SKU: on hand less what confirmed, undispatched orders hold. */
export function availableToPromise(onHand: ReadonlyMap<string, number>, orders: readonly Pick<SalesOrder, "status" | "lines">[]): Map<string, number> {
  const out = new Map(onHand);
  for (const o of orders) if (o.status === "confirmed" || o.status === "packed") for (const l of o.lines) out.set(l.sku, (out.get(l.sku) ?? 0) - l.qty);
  return out;
}
