/**
 * Third-party integrations in template/mock form. Each builds the real request format so the
 * switch to sandbox/live is a configuration change plus a server endpoint, not a rewrite.
 */
import { formatAmount, type Cents } from "@pos/engine";
import type { BrandingSettings, BusinessSettings, DailyStats, MenuItem, TenderMedia } from "./types.js";
import { itemSales, tenderSummary } from "./reports.js";

// ───────────────────────────── MD5 (PayHere signatures) ─────────────────────────────

function md5cycle(x: number[], k: number[]): void {
  let [a, b, c, d] = x as [number, number, number, number];
  const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & c) | (~b & d), a, b, x, s, t);
  const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & d) | (c & ~d), a, b, x, s, t);
  const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(b ^ c ^ d, a, b, x, s, t);
  const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(c ^ (b | ~d), a, b, x, s, t);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const T = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);
  for (let i = 0; i < 64; i++) {
    const round = i >> 4;
    const idx = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
    const s = S[round * 4 + (i % 4)]!;
    const f = round === 0 ? ff : round === 1 ? gg : round === 2 ? hh : ii;
    const next = f(a, b, c, d, k[idx]!, s, T[i]!);
    a = d;
    d = c;
    c = b;
    b = next;
  }
  x[0] = (x[0]! + a) | 0;
  x[1] = (x[1]! + b) | 0;
  x[2] = (x[2]! + c) | 0;
  x[3] = (x[3]! + d) | 0;
}

function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
  a = (a + q + x + t) | 0;
  return (((a << s) | (a >>> (32 - s))) + b) | 0;
}

/** MD5 hex digest of a UTF-8 string. */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const n = bytes.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  const padded = new Uint8Array(((n + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[n] = 0x80;
  const bits = n * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bits >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bits / 2 ** 32), true);
  for (let i = 0; i < padded.length; i += 64) {
    const block = Array.from({ length: 16 }, (_, j) => view.getInt32(i + j * 4, true));
    md5cycle(state, block);
  }
  return state.map((w) => [0, 8, 16, 24].map((sh) => ((w >>> sh) & 0xff).toString(16).padStart(2, "0")).join("")).join("");
}

// ───────────────────────────── PayHere ─────────────────────────────

export const PAYHERE_URLS = {
  sandbox: "https://sandbox.payhere.lk/pay/checkout",
  live: "https://www.payhere.lk/pay/checkout",
} as const;

/** PayHere checkout hash: upper(md5(merchant_id + order_id + amount + currency + upper(md5(secret)))). */
export function payhereHash(merchantId: string, orderId: string, amount: Cents, currency: string, merchantSecret: string): string {
  const amountStr = (amount / 100).toFixed(2);
  return md5(merchantId + orderId + amountStr + currency + md5(merchantSecret).toUpperCase()).toUpperCase();
}

/** Verifies the `md5sig` PayHere posts to the notify URL (runs server-side once live). */
export function verifyPayhereNotify(p: { merchant_id: string; order_id: string; payhere_amount: string; payhere_currency: string; status_code: string; md5sig: string }, merchantSecret: string): boolean {
  const local = md5(p.merchant_id + p.order_id + p.payhere_amount + p.payhere_currency + p.status_code + md5(merchantSecret).toUpperCase()).toUpperCase();
  return local === p.md5sig;
}

export interface PayhereCheckout {
  url: string;
  fields: Record<string, string>;
  /** Mock mode: a page-local link the POS shows as a QR code. */
  mock: boolean;
}

/**
 * Builds PayHere checkout fields. In `mock` mode no request leaves the device; in `sandbox`/`live`
 * the hash must be produced server-side (the merchant secret never ships to the POS).
 */
export function payhereCheckout(args: {
  mode: "mock" | "sandbox" | "live";
  merchantId: string;
  orderId: string;
  amount: Cents;
  items: string;
  customer?: { firstName: string; lastName?: string; email?: string; phone?: string };
  returnUrl: string;
  notifyUrl: string;
  hash?: string;
}): PayhereCheckout {
  const fields: Record<string, string> = {
    merchant_id: args.merchantId,
    return_url: args.returnUrl,
    cancel_url: args.returnUrl,
    notify_url: args.notifyUrl,
    order_id: args.orderId,
    items: args.items,
    currency: "LKR",
    amount: (args.amount / 100).toFixed(2),
    first_name: args.customer?.firstName ?? "Guest",
    last_name: args.customer?.lastName ?? "",
    email: args.customer?.email ?? "",
    phone: args.customer?.phone ?? "",
    address: "",
    city: "Colombo",
    country: "Sri Lanka",
    ...(args.hash ? { hash: args.hash } : {}),
  };
  if (args.mode === "mock") {
    return { url: `payhere-mock://checkout?order_id=${encodeURIComponent(args.orderId)}&amount=${fields.amount}`, fields, mock: true };
  }
  return { url: PAYHERE_URLS[args.mode], fields, mock: false };
}

// ───────────────────────────── LankaQR (EMVCo merchant-presented QR) ─────────────────────────────

function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

/** CRC-16/CCITT-FALSE as required by EMVCo QR (tag 63). */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Dynamic LankaQR payload in EMVCo format for a bill. The merchant account template (tag 26) is a
 * placeholder until the acquiring bank issues the real merchant identifiers.
 */
export function lankaQrPayload(args: { merchantId: string; merchantName: string; merchantCity: string; mcc: string; amount: Cents; reference: string }): string {
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("26", tlv("00", "LK.LANKAQR.SAMPLE") + tlv("01", args.merchantId)) +
    tlv("52", args.mcc) +
    tlv("53", "144") +
    tlv("54", (args.amount / 100).toFixed(2)) +
    tlv("58", "LK") +
    tlv("59", args.merchantName.slice(0, 25)) +
    tlv("60", args.merchantCity.slice(0, 15)) +
    tlv("62", tlv("05", args.reference.slice(0, 25))) +
    "6304";
  return body + crc16(body);
}

// ───────────────────────────── WhatsApp end-of-day message ─────────────────────────────

const rs = (c: Cents) => `Rs ${formatAmount(c)}`;

/** Text of the end-of-day WhatsApp report (sent with the PDF once the Cloud API is live). */
export function eodWhatsAppText(args: {
  stats: DailyStats;
  business: BusinessSettings;
  branding: BrandingSettings;
  menuItems: readonly MenuItem[];
  tenders: readonly TenderMedia[];
  propertyName: string;
}): string {
  const s = args.stats;
  const top = itemSales(s, args.menuItems, []).slice(0, 5);
  const tenders = tenderSummary(s, args.tenders);
  return [
    `*${args.branding.displayName} – End of Day*`,
    `${args.propertyName} · ${s.businessDate}`,
    "",
    `Net sales: *${rs(s.netSales)}*`,
    `Total incl. taxes: ${rs(s.total)}`,
    `Checks: ${s.checks} · Covers: ${s.covers}`,
    `Avg per cover: ${rs(s.covers ? Math.round(s.netSales / s.covers) : 0)}`,
    `Discounts: ${rs(s.discounts)} · Voids: ${s.voids.qty} (${rs(s.voids.amount)})`,
    `Service charge: ${rs(s.serviceCharge)} · VAT: ${rs(s.vat)}${s.sscl ? ` · SSCL: ${rs(s.sscl)}` : ""}`,
    "",
    "*Top items*",
    ...top.map((r, i) => `${i + 1}. ${r.name} × ${r.qty} – ${rs(r.netSales)}`),
    "",
    "*Payments*",
    ...tenders.map((t) => `${t.label}: ${rs(t.amount)}`),
    "",
    "Full report (PDF) attached.",
  ].join("\n");
}
