import { describe, expect, it } from "vitest";
import { UNAUDITED } from "@pos/ledger";

describe("functions configuration", () => {
  it("never audits its own output collections (no trigger loops)", () => {
    for (const c of ["ledger", "accountBalances", "auditEvents", "auditSeals", "numberSeries", "ledgerHead"]) expect(UNAUDITED.has(c)).toBe(true);
    for (const c of ["vouchers", "menuItems", "staff", "members", "settings", "checks", "invoices"]) expect(UNAUDITED.has(c)).toBe(false);
  });
});

describe("WhatsApp webhook signature", () => {
  it("accepts only bodies signed with the app secret (X-Hub-Signature-256)", async () => {
    const { createHmac } = await import("node:crypto");
    const { validSignature } = await import("../src/whatsapp.js");
    const body = Buffer.from(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    const sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    expect(validSignature(body, sig, "app-secret")).toBe(true);
    expect(validSignature(body, sig, "other-secret")).toBe(false);
    expect(validSignature(Buffer.from(`${body} `), sig, "app-secret")).toBe(false);
    expect(validSignature(body, undefined, "app-secret")).toBe(false);
    expect(validSignature(body, sig, undefined)).toBe(false);
    expect(validSignature(body, "sha1=abc", "app-secret")).toBe(false);
  });
});
