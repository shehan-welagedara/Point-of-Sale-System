import { describe, expect, it } from "vitest";
import { UNAUDITED } from "@pos/ledger";

describe("functions configuration", () => {
  it("never audits its own output collections (no trigger loops)", () => {
    for (const c of ["ledger", "accountBalances", "auditEvents", "auditSeals", "numberSeries", "ledgerHead"]) expect(UNAUDITED.has(c)).toBe(true);
    for (const c of ["vouchers", "menuItems", "staff", "members", "settings", "checks", "invoices"]) expect(UNAUDITED.has(c)).toBe(false);
  });
});
