import { calculateCheck, type CheckTotals } from "@pos/engine";
import { type BusinessSettings, type TaxSettings, chargeRulesFor } from "@pos/core";

export type { BrandingSettings, BusinessSettings, IntegrationSettings, ModuleKey, TaxSettings } from "@pos/core";
export { MODULES, lankaQrPayload, payhereCheckout, setModule } from "@pos/core";

/** Rs 1,000 dine-in check with the given settings, for the live preview on the tax screen. */
export function calculateCheckPreview(tax: TaxSettings, business: BusinessSettings): CheckTotals {
  return calculateCheck({
    pricing: tax.pricing,
    orderType: "dine-in",
    rules: chargeRulesFor(tax, business),
    lines: [{ id: "x", name: "x", quantity: 1, unitPrice: 100_000, taxClass: "standard" }],
    ...(tax.billRoundingUnit > 1 ? { billRounding: { unit: tax.billRoundingUnit, mode: "nearest" as const } } : {}),
  });
}
