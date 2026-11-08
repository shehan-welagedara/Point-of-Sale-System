import type { BillLayout } from "@pos/core";

/** The standard bill: what every business prints until the administrator changes it. */
export const DEFAULT_BILL_LAYOUT: BillLayout = {
  showLogo: true,
  headerAlign: "center",
  titleSize: 2,
  guestCheckTitle: "GUEST CHECK",
  invoiceTitle: "INVOICE",
  showAddress: true,
  showPhone: true,
  showEmail: false,
  showWebsite: false,
  showTradingName: true,
  showCheckNo: true,
  showOrderType: true,
  showTable: true,
  showServer: true,
  serverLabel: "Server",
  showCovers: true,
  showPrintedTime: true,
  showColumnHeader: true,
  qtyStyle: "before",
  showUnitPrice: false,
  combineSameItems: false,
  showModifiers: true,
  showModifierPrices: true,
  showNotes: true,
  showSeat: false,
  showItemCount: false,
  showSubtotal: true,
  discountDetail: "each",
  showSavings: false,
  totalLabel: "TOTAL (LKR)",
  totalSize: 2,
  showPayments: true,
  showPaymentRefs: true,
  showChange: true,
  guestCheckNote: "This is not a tax invoice. Please pay at the counter or by QR.",
  showPayQr: true,
  showCustomer: false,
  showFeedbackQr: true,
  feedbackUrl: "https://{website}/feedback?inv={invoice}",
  feedbackCaption: "Tell us how we did",
  showPoweredBy: true,
  extraFeed: 0,
};

export function resolveBillLayout(saved?: Partial<BillLayout>): BillLayout {
  const out = { ...DEFAULT_BILL_LAYOUT };
  for (const [k, v] of Object.entries(saved ?? {})) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  out.extraFeed = Math.max(0, Math.min(6, Math.round(out.extraFeed)));
  return out;
}

/**
 * Layout switches a VAT-registered seller's tax invoice ignores (Inland Revenue, VAT Act s.21
 * requires the element). The designer shows them as locked.
 */
export const TAX_INVOICE_LOCKED: Partial<Record<keyof BillLayout, string>> = {
  showAddress: "The seller's address is required on a tax invoice",
};

/** The things always printed on a tax invoice (shown in the designer as a checklist). */
export const TAX_INVOICE_ALWAYS = [
  "The words TAX INVOICE",
  "Seller's registered name, address and TIN",
  "Invoice number and invoice date",
  "Date of supply",
  "Description, quantity and value of each item",
  "Value excluding VAT, VAT rate and VAT amount",
  "Total amount payable",
  "Purchaser's name, address and TIN (when the buyer is VAT registered)",
] as const;

/** The feedback QR link for an invoice, or undefined when switched off. */
export function feedbackLink(layout: BillLayout, invoiceNo: string, website?: string): string | undefined {
  if (!layout.showFeedbackQr || !layout.feedbackUrl.trim()) return undefined;
  if (layout.feedbackUrl.includes("{website}") && !website) return undefined;
  return layout.feedbackUrl.replaceAll("{invoice}", encodeURIComponent(invoiceNo)).replaceAll("{website}", website ?? "");
}
