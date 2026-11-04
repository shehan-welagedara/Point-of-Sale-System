import { type ChargeRule, NET } from "./check.js";
import type { BasisPoints } from "./money.js";

/**
 * Default Sri Lanka charge stack (rates as of Oct 2026 — every value is overridable from EMC):
 *   Service charge on net → SSCL on (net + SC) → VAT on (net + SC + SSCL).
 * See docs/06-sri-lanka-compliance.md.
 */
export interface SriLankaChargeOptions {
  vatRegistered: boolean;
  ssclLiable: boolean;
  /** Default 1000 bp (10%). Set 0 to disable. */
  serviceChargeRate?: BasisPoints;
  /** Order types that attract service charge; omit for all. */
  serviceChargeOrderTypes?: readonly string[];
  /** Tourism Development Levy for SLTDA-registered establishments (default off). */
  tdlRate?: BasisPoints;
  vatRate?: BasisPoints;
  ssclRate?: BasisPoints;
  /** Tax classes outside VAT (e.g. exempt items); omit when everything is VAT-able. */
  vatTaxClasses?: readonly string[];
}

export const SL_RULE_IDS = { serviceCharge: "sc", tdl: "tdl", sscl: "sscl", vat: "vat" } as const;

export function sriLankaChargeRules(options: SriLankaChargeOptions): ChargeRule[] {
  const rules: ChargeRule[] = [];
  const scRate = options.serviceChargeRate ?? 1000;
  if (scRate > 0) {
    rules.push({
      id: SL_RULE_IDS.serviceCharge,
      name: `Service Charge ${scRate / 100}%`,
      kind: "serviceCharge",
      rate: scRate,
      base: [NET],
      ...(options.serviceChargeOrderTypes ? { orderTypes: options.serviceChargeOrderTypes } : {}),
    });
  }
  const upTo = () => [NET, ...rules.map((r) => r.id)];
  if (options.tdlRate && options.tdlRate > 0) {
    rules.push({ id: SL_RULE_IDS.tdl, name: `TDL ${options.tdlRate / 100}%`, kind: "levy", rate: options.tdlRate, base: upTo() });
  }
  if (options.ssclLiable) {
    const rate = options.ssclRate ?? 250;
    rules.push({ id: SL_RULE_IDS.sscl, name: `SSCL ${rate / 100}%`, kind: "levy", rate, base: upTo() });
  }
  if (options.vatRegistered) {
    const rate = options.vatRate ?? 1800;
    rules.push({
      id: SL_RULE_IDS.vat,
      name: `VAT ${rate / 100}%`,
      kind: "vat",
      rate,
      base: upTo(),
      ...(options.vatTaxClasses ? { taxClasses: options.vatTaxClasses } : {}),
    });
  }
  return rules;
}
