import { type CheckTotals, formatAmount } from "@pos/engine";
import type { BillLayout, BrandingSettings, BusinessSettings, Check, CheckLine, DailyStats, MenuItem, TenderMedia } from "@pos/core";
import { resolveBillLayout } from "./bill-layout.js";
import type { Block, ReceiptDoc } from "./doc.js";

const amt = (c: number) => formatAmount(c);

function colomboTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function colomboDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${d}-${m}-${y}`;
}

export interface BillArgs {
  kind: "guestCheck" | "invoice";
  check: Check;
  totals: CheckTotals;
  business: BusinessSettings;
  branding: BrandingSettings;
  width: number;
  staffName: string;
  orderTypeName: string;
  tableName?: string;
  tenders: ReadonlyMap<string, TenderMedia>;
  /** Issued invoice number (required for `invoice`). */
  invoiceNo?: string;
  issuedAt?: string;
  copy?: boolean;
  /** QR printed at the bottom (feedback link, e-bill, LankaQR/PayHere pay-by-QR on guest checks). */
  qr?: { data: string; caption: string };
  openDrawer?: boolean;
  printLogo?: boolean;
  /** Bill designer settings (default: branding.bill, else the standard layout). */
  layout?: Partial<BillLayout>;
  /** Guest name and loyalty balance, printed when the layout asks for them. */
  customer?: { name: string; points?: number };
}

interface ItemRow {
  qty: number;
  name: string;
  unitPrice: number;
  gross: number;
  modifiers: CheckLine["modifiers"];
  note?: string;
  seat?: number;
}

function itemRows(lines: readonly CheckLine[], totals: CheckTotals, combine: boolean): ItemRow[] {
  const byId = new Map(totals.lines.map((l) => [l.id, l]));
  const rows: ItemRow[] = [];
  const keyed = new Map<string, ItemRow>();
  for (const l of lines) {
    if (l.voided) continue;
    const gross = byId.get(l.id)?.gross ?? l.qty * l.unitPrice;
    const row: ItemRow = { qty: l.qty, name: l.name, unitPrice: l.unitPrice + l.modifiers.reduce((a, m) => a + m.price, 0), gross, modifiers: l.modifiers, ...(l.note ? { note: l.note } : {}), ...(l.seat ? { seat: l.seat } : {}) };
    if (!combine) {
      rows.push(row);
      continue;
    }
    const key = [l.menuItemId, l.unitPrice, l.modifiers.map((m) => `${m.name}:${m.price}`).join(","), l.note ?? "", l.seat ?? ""].join("|");
    const same = keyed.get(key);
    if (same) {
      same.qty += row.qty;
      same.gross += row.gross;
    } else {
      keyed.set(key, row);
      rows.push(row);
    }
  }
  return rows;
}

function itemBlocks(rows: readonly ItemRow[], L: BillLayout): Block[] {
  const out: Block[] = [];
  for (const r of rows) {
    out.push({ t: "pair", left: L.qtyStyle === "after" ? `${r.name} x${r.qty}` : `${r.qty} ${r.name}`, right: amt(r.gross) });
    if (L.showUnitPrice && r.qty > 1) out.push({ t: "text", text: `   ${r.qty} @ ${amt(r.unitPrice)}` });
    if (L.showModifiers) for (const m of r.modifiers) out.push({ t: "text", text: `   - ${m.name}${m.price && L.showModifierPrices ? ` (+${amt(m.price)})` : ""}` });
    if (L.showNotes && r.note) out.push({ t: "text", text: `   * ${r.note}` });
    if (L.showSeat && r.seat) out.push({ t: "text", text: `   Seat ${r.seat}` });
  }
  return out;
}

/**
 * Guest check (before payment) or final bill, laid out as the administrator chose (Bill designer).
 * VAT-registered sellers get the IRD tax invoice layout, whose required elements always print.
 */
export function buildBill(a: BillArgs): ReceiptDoc {
  const { check, totals, business } = a;
  const L = resolveBillLayout(a.layout ?? a.branding.bill);
  const isInvoice = a.kind === "invoice";
  const taxInvoice = isInvoice && business.vatRegistered;
  const align = L.headerAlign;
  const blocks: Block[] = [];
  if (a.printLogo && L.showLogo) blocks.push({ t: "nvLogo" });
  blocks.push({ t: "text", text: taxInvoice ? "TAX INVOICE" : isInvoice ? L.invoiceTitle || "INVOICE" : L.guestCheckTitle || "GUEST CHECK", align: "center", bold: true, size: taxInvoice ? 2 : L.titleSize });
  if (a.copy) blocks.push({ t: "text", text: "*** COPY ***", align: "center", bold: true });
  blocks.push({ t: "text", text: business.legalName, align, bold: true });
  if (L.showAddress || taxInvoice) for (const l of business.addressLines) blocks.push({ t: "text", text: l, align });
  const idLine = [business.vatRegistered ? `TIN: ${business.tin}` : "", L.showPhone && business.phone ? `Tel: ${business.phone}` : ""].filter(Boolean).join("   ");
  if (idLine) blocks.push({ t: "text", text: idLine, align });
  if (L.showEmail && business.email) blocks.push({ t: "text", text: business.email, align });
  if (L.showWebsite && business.website) blocks.push({ t: "text", text: business.website, align });
  if (L.showTradingName && business.tradingName && business.tradingName !== business.legalName) blocks.push({ t: "text", text: `Trading as: ${business.tradingName}`, align });
  for (const l of a.branding.receiptHeaderLines) blocks.push({ t: "text", text: l, align });
  blocks.push({ t: "rule" });
  if (isInvoice) {
    if (!a.invoiceNo) throw new Error("invoice number required");
    blocks.push({ t: "pair", left: "Invoice No :", right: a.invoiceNo, bold: true });
    blocks.push({ t: "pair", left: "Invoice Dt :", right: colomboTime(a.issuedAt ?? check.closedAt ?? check.openedAt) });
    blocks.push({ t: "pair", left: "Supply Dt  :", right: colomboDate(check.businessDate) });
  } else if (L.showPrintedTime) {
    blocks.push({ t: "pair", left: "Printed    :", right: colomboTime(a.issuedAt ?? new Date().toISOString()) });
  }
  const checkLeft = [L.showCheckNo ? `Check #${check.checkNo}` : "", L.showOrderType ? a.orderTypeName : ""].filter(Boolean).join("  ");
  const checkRight = L.showTable && a.tableName ? `Table ${a.tableName}` : "";
  if (checkLeft || checkRight) blocks.push({ t: "pair", left: checkLeft, right: checkRight });
  const serverLeft = L.showServer ? `${L.serverLabel || "Server"}: ${a.staffName}` : "";
  const serverRight = L.showCovers ? `Covers ${check.covers}` : "";
  if (serverLeft || serverRight) blocks.push({ t: "pair", left: serverLeft, right: serverRight });
  blocks.push({ t: "rule" });
  if (L.showColumnHeader) blocks.push({ t: "pair", left: L.qtyStyle === "after" ? "Item" : "Qty Item", right: "Amount", bold: true });
  const rows = itemRows(check.lines, totals, L.combineSameItems);
  blocks.push(...itemBlocks(rows, L));
  blocks.push({ t: "rule" });
  if (L.showItemCount) blocks.push({ t: "pair", left: "Items", right: String(rows.reduce((n, r) => n + r.qty, 0)) });
  if (L.showSubtotal || taxInvoice) blocks.push({ t: "pair", left: "Subtotal", right: amt(totals.itemsTotal) });
  const discounts = totals.discounts.filter((d) => d.amount);
  if (L.discountDetail === "total" && discounts.length) blocks.push({ t: "pair", left: "Discounts", right: `-${amt(discounts.reduce((s, d) => s + d.amount, 0))}` });
  else for (const d of discounts) blocks.push({ t: "pair", left: `Discount (${d.name})`, right: `-${amt(d.amount)}` });
  for (const c of totals.charges) {
    if (c.kind === "vat") continue;
    if (c.amount || c.kind === "serviceCharge") blocks.push({ t: "pair", left: c.name, right: amt(c.amount) });
  }
  if (business.vatRegistered) {
    blocks.push({ t: "pair", left: "Value excl. VAT", right: amt(totals.valueExclVat) });
    for (const c of totals.charges) if (c.kind === "vat") blocks.push({ t: "pair", left: c.name, right: amt(c.amount) });
  }
  if (totals.roundingAdjustment) blocks.push({ t: "pair", left: "Rounding", right: amt(totals.roundingAdjustment) });
  blocks.push({ t: "rule", char: "=" });
  blocks.push({ t: "pair", left: L.totalLabel || "TOTAL (LKR)", right: amt(totals.amountDue), bold: true, size: L.totalSize });
  blocks.push({ t: "rule" });
  if (isInvoice) {
    if (L.showPayments)
      for (const p of check.payments) {
        const tender = a.tenders.get(p.tenderId);
        const label = tender?.type === "foreignCash" ? `${tender.name} ${tender.currency} ${amt(p.amount)}` : (tender?.name ?? p.tenderId);
        blocks.push({ t: "pair", left: `${label}${p.reference && L.showPaymentRefs ? ` (${p.reference})` : ""}`, right: amt(p.tendered) });
      }
    if (check.change && L.showChange) blocks.push({ t: "pair", left: "Change", right: amt(check.change), bold: true });
    if (check.buyer) {
      blocks.push({ t: "rule" });
      blocks.push({ t: "text", text: "Purchaser:", bold: true });
      blocks.push({ t: "text", text: `${check.buyer.name}  TIN: ${check.buyer.tin}` });
      blocks.push({ t: "text", text: check.buyer.address });
    }
  } else if (L.guestCheckNote.trim()) {
    blocks.push({ t: "text", text: L.guestCheckNote.trim(), align: "center" });
  }
  const discountTotal = discounts.reduce((s, d) => s + d.amount, 0);
  if (L.showSavings && discountTotal > 0) blocks.push({ t: "text", text: `You saved Rs ${amt(discountTotal)}`, align: "center", bold: true });
  if (L.showCustomer && a.customer) {
    blocks.push({ t: "text", text: `Guest: ${a.customer.name}`, align: "center" });
    if (a.customer.points !== undefined) blocks.push({ t: "text", text: `Loyalty points: ${a.customer.points}`, align: "center" });
  }
  blocks.push({ t: "rule" });
  for (const l of a.branding.receiptFooterLines) blocks.push({ t: "text", text: l, align: "center" });
  if (a.qr) blocks.push({ t: "qr", data: a.qr.data, caption: a.qr.caption });
  if (a.branding.poweredBy && L.showPoweredBy) blocks.push({ t: "text", text: `Powered by ${a.branding.poweredBy}`, align: "center" });
  if (L.extraFeed) blocks.push({ t: "feed", lines: L.extraFeed });
  blocks.push({ t: "cut" });
  if (a.openDrawer) blocks.push({ t: "drawer" });
  return { width: a.width, blocks };
}

export interface KotArgs {
  check: Check;
  lines: readonly CheckLine[];
  station: string;
  width: number;
  staffName: string;
  orderTypeName: string;
  tableName?: string;
  menuItems: ReadonlyMap<string, MenuItem>;
  at: string;
  reprint?: boolean;
}

/** Kitchen order ticket: large, uncluttered, allergies highlighted. */
export function buildKot(a: KotArgs): ReceiptDoc {
  const blocks: Block[] = [
    { t: "text", text: `KOT - ${a.station.toUpperCase()}`, align: "center", bold: true, size: 2 },
  ];
  if (a.reprint) blocks.push({ t: "text", text: "*** REPRINT ***", align: "center", bold: true });
  blocks.push(
    { t: "pair", left: `Check #${a.check.checkNo}`, right: a.tableName ? `TABLE ${a.tableName}` : a.orderTypeName.toUpperCase(), bold: true, size: 2 },
    { t: "pair", left: `${a.orderTypeName} · Covers ${a.check.covers}`, right: `Round ${a.lines[0]?.sentRound ?? a.check.sentRounds}` },
    { t: "pair", left: `Server: ${a.staffName}`, right: colomboTime(a.at).slice(11) },
    { t: "rule", char: "=" },
  );
  const allergens = new Set<string>();
  for (const l of a.lines) {
    blocks.push({ t: "text", text: `${l.voided ? "VOID " : ""}${l.qty} x ${l.name}`, bold: true, size: 2 });
    for (const m of l.modifiers) blocks.push({ t: "text", text: `   > ${m.name}`, bold: true });
    if (l.note) blocks.push({ t: "text", text: `   NOTE: ${l.note}`, bold: true });
    if (l.seat) blocks.push({ t: "text", text: `   Seat ${l.seat}` });
    for (const al of a.menuItems.get(l.menuItemId)?.allergens ?? []) allergens.add(al);
  }
  if (allergens.size) {
    blocks.push({ t: "rule" });
    blocks.push({ t: "text", text: `CONTAINS: ${[...allergens].join(", ").toUpperCase()}`, bold: true, invert: true });
  }
  blocks.push({ t: "rule", char: "=" }, { t: "cut" });
  return { width: a.width, blocks };
}

/** End-of-day (Z) or mid-day (X) summary for the receipt printer. */
export function buildDaySummary(a: { stats: DailyStats; kind: "X" | "Z"; width: number; businessName: string; propertyName: string; tenders: readonly TenderMedia[]; printedAt: string }): ReceiptDoc {
  const s = a.stats;
  const names = new Map(a.tenders.map((t) => [t.id, t.name]));
  const blocks: Block[] = [
    { t: "text", text: `${a.kind} REPORT`, align: "center", bold: true, size: 2 },
    { t: "text", text: a.businessName, align: "center", bold: true },
    { t: "text", text: a.propertyName, align: "center" },
    { t: "pair", left: "Business date", right: colomboDate(s.businessDate) },
    { t: "pair", left: "Printed", right: colomboTime(a.printedAt) },
    { t: "rule" },
    { t: "pair", left: "Checks", right: String(s.checks) },
    { t: "pair", left: "Covers", right: String(s.covers) },
    { t: "pair", left: "Gross sales", right: amt(s.itemsTotal) },
    { t: "pair", left: "Discounts", right: `-${amt(s.discounts)}` },
    { t: "pair", left: "Net sales", right: amt(s.netSales), bold: true },
    { t: "pair", left: "Service charge", right: amt(s.serviceCharge) },
    { t: "pair", left: "SSCL / TDL", right: amt(s.sscl + s.tdl) },
    { t: "pair", left: "VAT", right: amt(s.vat) },
    { t: "pair", left: "Rounding", right: amt(s.rounding) },
    { t: "pair", left: "TOTAL", right: amt(s.total), bold: true },
    { t: "rule" },
    { t: "text", text: "Payments", bold: true },
    ...Object.entries(s.tenders).map(([id, v]): Block => ({ t: "pair", left: `${names.get(id) ?? id} (${v.qty})`, right: amt(v.amount) })),
    { t: "rule" },
    { t: "pair", left: `Voids (${s.voids.qty})`, right: amt(s.voids.amount) },
    { t: "cut" },
  ];
  return { width: a.width, blocks };
}

export function buildTestPage(printerName: string, width: number): ReceiptDoc {
  return {
    width,
    blocks: [
      { t: "text", text: "PRINTER TEST", align: "center", bold: true, size: 2 },
      { t: "text", text: printerName, align: "center" },
      { t: "rule" },
      { t: "pair", left: "Left aligned", right: "1,234.56" },
      { t: "text", text: "Bold text", bold: true },
      { t: "text", text: "Reverse text", invert: true },
      { t: "qr", data: "https://example.lk/pos-test", caption: "QR code" },
      { t: "cut" },
    ],
  };
}
