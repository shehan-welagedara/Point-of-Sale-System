import { describe, expect, it } from "vitest";
import {
  type LicencePayload,
  type PosEvent,
  type Role,
  type Staff,
  COLLECTIONS as C,
  DEFAULT_ROLES,
  LicenceError,
  MemoryStore,
  PosJournal,
  afterFailedSignIn,
  buildEntitlements,
  canAuthorize,
  canPerform,
  clampModules,
  dataHealth,
  decodeLicence,
  generateLicenceKeys,
  licenceStatus,
  pinPolicyError,
  roleFor,
  signInDecision,
  signLicence,
  validateDoc,
  verifyLicence,
  verifyPosJournal,
} from "../src/index.js";

const payload = (over: Partial<LicencePayload> = {}): LicencePayload => ({
  v: 1,
  licenceId: "LIC-0001",
  licensee: { name: "Spice Lagoon (Pvt) Ltd" },
  edition: "professional",
  addOns: ["accounting"],
  entitlements: buildEntitlements("professional", ["accounting"]),
  projectId: "spice-prod",
  tenantId: "*",
  billing: "subscription",
  issuedAt: "2026-11-01T00:00:00Z",
  validFrom: "2026-11-01T00:00:00Z",
  expiresAt: "2027-10-31T23:59:59Z",
  graceDays: 14,
  ...over,
});

describe("licensing", () => {
  it("signs and verifies, and refuses altered keys, other keys and other projects", async () => {
    const keys = await generateLicenceKeys();
    const token = await signLicence(payload(), keys.privateKey);
    const ok = await verifyLicence(token, keys.publicKey, { projectId: "spice-prod", tenantId: "t1" }, new Date("2027-01-01"));
    expect(ok.payload.entitlements.modules).toContain("accounting");
    expect(ok.check.status).toBe("valid");

    // Raising the entitlement without the private key breaks the signature.
    const [pre, body, sig] = token.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString());
    forged.entitlements.limits.workstations = 999;
    await expect(decodeLicence(`${pre}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, keys.publicKey)).rejects.toBeInstanceOf(LicenceError);

    const other = await generateLicenceKeys();
    await expect(decodeLicence(token, other.publicKey)).rejects.toThrow(/signature/);
    await expect(verifyLicence(token, keys.publicKey, { projectId: "someone-else", tenantId: "t1" }, new Date("2027-01-01"))).rejects.toThrow(/project/);
  });

  it("has a grace period after expiry", () => {
    const p = payload();
    expect(licenceStatus(p, new Date("2027-11-05T00:00:00Z")).status).toBe("grace");
    expect(licenceStatus(p, new Date("2027-11-20T00:00:00Z"))).toMatchObject({ status: "expired", usable: false });
    expect(licenceStatus(p, new Date("2026-10-01T00:00:00Z")).status).toBe("notYetValid");
  });

  it("builds entitlements with dependencies and clamps module switches to them", () => {
    const starter = buildEntitlements("starter", ["purchasing"]);
    // Purchasing needs inventory, which needs recipes.
    expect(starter.modules).toEqual(expect.arrayContaining(["purchasing", "inventory", "recipes"]));
    expect(starter.modules).not.toContain("accounting");
    const on = clampModules({ pos: true, accounting: true, inventory: true, purchasing: true, recipes: false }, starter);
    expect(on.accounting).toBe(false); // not licensed
    expect(on.purchasing).toBe(false); // its dependency (recipes) is switched off
    expect(on.pos).toBe(true);
    expect(Object.values(clampModules({ pos: true }, starter, false)).some(Boolean)).toBe(false); // expired licence
  });
});

const staff = (id: string, roleId: string, over: Partial<Staff> = {}): Staff => ({ id, employeeNo: id.replace(/\D/g, "") || "1", name: id, roleId, propertyIds: ["CMB"], pinHash: "x".repeat(64), pinSalt: "salt12345", status: "active", ...over });
const role = (id: string) => DEFAULT_ROLES.find((r) => r.id === id)!;

describe("access control", () => {
  it("authorises only with a senior-enough, different person within their limit", () => {
    const cashier = staff("E1", "cashier");
    const sup = staff("E2", "supervisor");
    const mgr = staff("E3", "manager");
    const base = { requester: cashier, requesterRole: role("cashier"), privilege: "pos.voidSent" as const };
    expect(canAuthorize({ ...base, authorizer: sup, authorizerRole: role("supervisor") }).ok).toBe(true);
    expect(canAuthorize({ ...base, authorizer: sup, authorizerRole: role("supervisor"), limit: { kind: "voidAmount", value: 20_000_00 } }).ok).toBe(false);
    expect(canAuthorize({ ...base, authorizer: mgr, authorizerRole: role("manager"), limit: { kind: "voidAmount", value: 20_000_00 } }).ok).toBe(true);
    expect(canAuthorize({ ...base, authorizer: cashier, authorizerRole: role("cashier") }).reason).toMatch(/Another person/);
    // A supervisor can't approve for the manager (junior role).
    expect(canAuthorize({ requester: mgr, requesterRole: role("manager"), authorizer: sup, authorizerRole: role("supervisor"), privilege: "pos.discountManager" }).ok).toBe(false);
    expect(canAuthorize({ ...base, authorizer: { ...mgr, lockedAt: "2026-11-04T00:00:00Z" }, authorizerRole: role("manager") }).ok).toBe(false);
  });

  it("applies 'needs authorisation' and per-property roles", () => {
    expect(canPerform(role("cashier"), "pos.tender")).toBe(true);
    expect(canPerform(role("cashier"), "pos.reprint")).toBe(false); // held but needs a second person
    const roles: Role[] = DEFAULT_ROLES;
    const e = staff("E9", "server", { propertyIds: ["CMB", "KDY"], propertyRoles: { KDY: "supervisor" } });
    expect(roleFor(e, "CMB", roles)?.id).toBe("server");
    expect(roleFor(e, "KDY", roles)?.id).toBe("supervisor");
  });

  it("controls sign-in: status, lockout, dates, property and revenue centres", () => {
    const ws = { propertyId: "CMB", rvcId: "REST", allowedRvcIds: ["REST", "BAR"] };
    const all = ["REST", "BAR", "ROOM"];
    expect(signInDecision(staff("E1", "cashier"), role("cashier"), ws, all, "2026-11-04")).toEqual({ ok: true, rvcIds: ["REST", "BAR"] });
    expect(signInDecision(staff("E1", "cashier", { rvcIds: ["BAR"] }), role("cashier"), ws, all, "2026-11-04").rvcIds).toEqual(["BAR"]);
    expect(signInDecision(staff("E1", "cashier", { rvcIds: ["ROOM"] }), role("cashier"), ws, all, "2026-11-04").ok).toBe(false);
    expect(signInDecision(staff("E1", "cashier", { lockedAt: "x" }), role("cashier"), ws, all, "2026-11-04").reason).toMatch(/Locked/);
    expect(signInDecision(staff("E1", "cashier", { terminationDate: "2026-10-31" }), role("cashier"), ws, all, "2026-11-04").ok).toBe(false);
    expect(signInDecision(staff("E1", "cashier", { propertyIds: ["KDY"] }), role("cashier"), ws, all, "2026-11-04").ok).toBe(false);
    let e = staff("E1", "cashier");
    for (let i = 0; i < 5; i++) e = { ...e, ...afterFailedSignIn(e, 5, "2026-11-04T10:00:00Z") };
    expect(e.lockedAt).toBeDefined();
    expect(pinPolicyError("1111", 4)).toMatch(/easy/);
    expect(pinPolicyError("1234", 4)).toMatch(/easy/);
    expect(pinPolicyError("4821", 4)).toBeNull();
  });
});

describe("POS journal", () => {
  it("chains events per workstation and detects edits and deletions", async () => {
    const store = new MemoryStore();
    const j = new PosJournal(store, { propertyId: "CMB", workstationId: "W01", rvcId: "REST", businessDate: () => "2026-11-04" });
    await Promise.all([j.log({ type: "signIn", employeeId: "E1" }), j.log({ type: "checkBegin", employeeId: "E1", checkNo: 1 }), j.log({ type: "itemVoid", employeeId: "E1", authorizedBy: "E2", amount: 1500_00, reason: "Wrong order" })]);
    // A second session continues the same chain.
    const j2 = new PosJournal(store, { propertyId: "CMB", workstationId: "W01", rvcId: "REST", businessDate: () => "2026-11-04" });
    await j2.log({ type: "noSale", employeeId: "E1" });
    const events = await store.list<PosEvent>(C.posJournal);
    expect(events).toHaveLength(4);
    expect((await verifyPosJournal(events)).map((i) => i.message)).toEqual([]);
    const voidEvent = events.find((e) => e.type === "itemVoid")!;
    expect((await verifyPosJournal(events.map((e) => (e.id === voidEvent.id ? { ...e, amount: 15_00 } : e)))).length).toBeGreaterThan(0);
    expect((await verifyPosJournal(events.filter((e) => e.id !== voidEvent.id)))[0]?.message).toMatch(/not linked/);
  });
});

describe("validation", () => {
  it("refuses bad documents with readable messages", () => {
    expect(validateDoc(C.menuItems, { id: "BAD", code: "BAD", name: "", categoryId: "C1", price: -5, taxClass: "standard", kotRoute: "kitchen", modifierGroupIds: [], allergens: [], available: true, active: true, sortOrder: 1 }).map((i) => i.path)).toEqual(expect.arrayContaining(["name", "price"]));
    expect(validateDoc(C.workstations, { id: "W", propertyId: "P", rvcId: "R", code: "w-01", name: "Bar", deviceProfile: "dedicated", receiptPrinterId: "", printMode: "agent", active: true })[0]?.message).toMatch(/workstation code/);
    // A phone printing to its own Bluetooth printer (no printer record, no Print Agent).
    const phone = { id: "P01", propertyId: "P", rvcId: "R", code: "P01", name: "Counter phone", deviceProfile: "mobile", receiptPrinterId: "", printMode: "bluetooth", bluetoothVia: "browser", paperWidthMm: 80, kitchenOnBluetooth: true, active: true };
    expect(validateDoc(C.workstations, phone)).toEqual([]);
    expect(validateDoc(C.workstations, { ...phone, bluetoothVia: "usb" }).map((i) => i.path)).toEqual(["bluetoothVia"]);
    expect(validateDoc(C.workstations, { ...phone, paperWidthMm: 76 }).map((i) => i.path)).toEqual(["paperWidthMm"]);
    expect(validateDoc(C.discounts, { id: "D", name: "Too much", type: "percent", value: 12_000, scope: "check", requiresManager: false, active: true })[0]?.message).toMatch(/100%/);
    expect(validateDoc("somethingElse", { anything: true })).toEqual([]);
  });

  it("finds broken references, duplicates and circular recipes across modules", () => {
    const issues = dataHealth(
      {
        properties: [{ id: "P1", code: "P1", name: "Hotel", addressLines: [], active: true }],
        revenueCenters: [{ id: "R1", propertyId: "P1", code: "R1", name: "Restaurant", serviceMode: "table", defaultOrderTypeId: "dine", active: true }],
        orderTypes: [{ id: "dine", name: "Dine in", requiresTable: true, sortOrder: 1, active: true }],
        workstations: [
          { id: "W1", propertyId: "P1", rvcId: "R1", code: "W01", name: "A", deviceProfile: "dedicated", receiptPrinterId: "", printMode: "agent", active: true },
          { id: "W2", propertyId: "P1", rvcId: "R9", code: "W01", name: "B", deviceProfile: "dedicated", receiptPrinterId: "", printMode: "agent", active: true },
        ],
        menuItems: [{ id: "M1", code: "M1", name: "Rice", categoryId: "NOPE", price: 1000, taxClass: "standard", kotRoute: "kitchen", modifierGroupIds: [], allergens: [], available: true, active: true, sortOrder: 1 }],
        inventoryItems: [
          { id: "A", code: "A", name: "A", category: "x", majorGroup: "Food", stockUnit: "g", purchaseUnit: "kg", purchaseFactor: 1000, purchaseCost: 100, parLevel: 0, reorderQty: 0, isPrep: true, trackStock: true, active: true },
          { id: "B", code: "B", name: "B", category: "x", majorGroup: "Food", stockUnit: "g", purchaseUnit: "kg", purchaseFactor: 1000, purchaseCost: 100, parLevel: 0, reorderQty: 0, isPrep: true, trackStock: true, active: true },
        ],
        recipes: [
          { id: "A", kind: "prep", yieldQty: 1, lines: [{ inventoryItemId: "B", qty: 1 }] },
          { id: "B", kind: "prep", yieldQty: 1, lines: [{ inventoryItemId: "A", qty: 1 }] },
        ],
        roles: [],
        staff: [
          { id: "S1", employeeNo: "101", name: "A", roleId: "nobody", propertyIds: ["P1"], pinHash: "x".repeat(64), pinSalt: "12345678", status: "active" },
          { id: "S2", employeeNo: "101", name: "B", roleId: "nobody", propertyIds: ["P1"], pinHash: "x".repeat(64), pinSalt: "12345678", status: "active" },
        ],
      },
      { recipes: true },
    );
    const text = issues.map((i) => `${i.collection}/${i.id}: ${i.message}`).join("\n");
    expect(text).toMatch(/menuItems\/M1: categoryId "NOPE"/);
    expect(text).toMatch(/workstations\/W2: revenue centre "R9" does not exist/);
    expect(text).toMatch(/workstation code W01 is also used/);
    expect(text).toMatch(/employee number 101 is also used/);
    expect(text).toMatch(/recipes\/A: prep recipes refer to each other/);
    expect(text).toMatch(/staff\/S1: roleId "nobody"/);
  });
});
