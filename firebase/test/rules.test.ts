/** Security rules tests. Run with `pnpm test:rules` (starts the Firestore emulator). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { type RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

let env: RulesTestEnvironment;
const T = "spice-demo";

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pos-suite",
    firestore: { rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8") },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());

const as = (uid: string, email = `${uid}@example.lk`, verified = true) => env.authenticatedContext(uid, { email, email_verified: verified }).firestore();

async function seedTenant(modules: Record<string, boolean> = { pos: true, recipes: true, inventory: true, purchasing: true, crm: true, accounting: true }) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "tenants", T), { id: T, name: "Spice", ownerUid: "owner", modules, plan: "demo", status: "active" });
    for (const [uid, role] of [["owner", "owner"], ["mgr", "manager"], ["till", "terminal"], ["acct", "accountant"], ["acct2", "accountant"], ["aud", "auditor"], ["view", "viewer"]] as const) {
      await setDoc(doc(db, "tenants", T, "members", uid), { id: uid, uid, email: `${uid}@example.lk`, role, tenantId: T });
    }
    await setDoc(doc(db, "tenants", T, "menuItems", "K001"), { id: "K001", name: "Kottu", price: 120000, available: true });
    await setDoc(doc(db, "tenants", T, "checks", "closed1"), { id: "closed1", status: "closed", depletion: "pending" });
    await setDoc(doc(db, "tenants", T, "invoices", "26NOV_W01_1"), { id: "26NOV_W01_1", hash: "x" });
    await setDoc(doc(db, "tenants", T, "settings", "accounting"), { id: "accounting", ledger: { journalApprovalThreshold: 0, paymentApprovalThreshold: 5000000, matchTolerance: { qtyBp: 0, priceBp: 200 } }, accounts: {} });
    await setDoc(doc(db, "tenants", T, "vouchers", "posted1"), { id: "posted1", status: "posted", number: "JV-202627-00001", createdBy: "acct" });
    await setDoc(doc(db, "tenants", T, "assets", "A1"), { id: "A1", status: "active", accumulatedDep: 0, name: "Oven" });
    await setDoc(doc(db, "auditLog", T, "events", "e1"), { id: "e1", action: "create" });
  });
}

describe("tenant onboarding", () => {
  it("lets a user create a tenant with themselves as owner in one batch", async () => {
    const db = as("alice");
    const b = writeBatch(db);
    // The first business in a new project claims the deployment in the same batch.
    b.set(doc(db, "deployment", "config"), { ownerUid: "alice", openSignup: false });
    b.set(doc(db, "tenants", "alice-cafe"), { id: "alice-cafe", name: "Alice Cafe", ownerUid: "alice", modules: { pos: true }, plan: "trial", entitlements: { modules: ["pos"], limits: {} } });
    b.set(doc(db, "tenants", "alice-cafe", "members", "alice"), { id: "alice", uid: "alice", role: "owner", tenantId: "alice-cafe" });
    await assertSucceeds(b.commit());
    // …then seed settings in small batches (9 writes) under the rules.
    const b2 = writeBatch(db);
    for (let i = 0; i < 9; i++) b2.set(doc(db, "tenants", "alice-cafe", "orderTypes", `OT${i}`), { id: `OT${i}`, name: `Type ${i}` });
    await assertSucceeds(b2.commit());
    const found = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", "alice")));
    if (found.size !== 1) throw new Error("membership lookup failed");
  });

  it("lets only the deployment owner, existing owners or listed creators add businesses", async () => {
    await seedTenant();
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "deployment", "config"), { ownerUid: "installer", openSignup: false }));
    const newBiz = (uid: string, id: string, extra: Record<string, unknown> = {}) => {
      const db = as(uid);
      const b = writeBatch(db);
      b.set(doc(db, "tenants", id), { id, name: id, ownerUid: uid, modules: { pos: true }, plan: "trial", ...extra });
      b.set(doc(db, "tenants", id, "members", uid), { id: uid, uid, role: "owner", tenantId: id });
      return b.commit();
    };
    // A stranger who signs up can't create a business (or claim the deployment).
    await assertFails(newBiz("mallory", "mallory-co"));
    await assertFails(setDoc(doc(as("mallory"), "deployment", "config"), { ownerUid: "mallory", openSignup: true }));
    // The installer, and the owner of an existing business adding a training copy, can.
    await assertSucceeds(newBiz("installer", "real-co"));
    await assertSucceeds(newBiz("owner", "training-co", { createdFromTenant: T }));
    // A manager of an existing business can't.
    await assertFails(newBiz("mgr", "mgr-co", { createdFromTenant: T }));
    // Opening sign-up (demo/SaaS projects) lets anyone in.
    await assertSucceeds(updateDoc(doc(as("installer"), "deployment", "config"), { openSignup: true }));
    await assertSucceeds(newBiz("mallory", "mallory-co"));
  });

  it("on a system linked to the Polymath Console, opens only a business Polymath Tech approved for the person asking", async () => {
    await seedTenant();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "deployment", "config"), { ownerUid: "owner", openSignup: false });
      await setDoc(doc(db, "deployment", "link"), { approvalRequired: true });
      await setDoc(doc(db, "businessRequests", "noura-2"), { id: "noura-2", uid: "owner", name: "Noura Kitchen Galle", status: "pending" });
      await setDoc(doc(db, "businessRequests", "noura-3"), { id: "noura-3", uid: "owner", name: "Noura Express", status: "approved" });
      await setDoc(doc(db, "businessRequests", "other-co"), { id: "other-co", uid: "someone", name: "Other", status: "approved" });
    });
    const newBiz = (uid: string, id: string, extra: Record<string, unknown> = {}) => {
      const db = as(uid);
      const b = writeBatch(db);
      b.set(doc(db, "tenants", id), { id, name: id, ownerUid: uid, modules: { pos: true }, plan: "trial", status: "active", createdFromTenant: T, ...extra });
      b.set(doc(db, "tenants", id, "members", uid), { id: uid, uid, role: "owner", tenantId: id });
      return b.commit();
    };
    await assertFails(newBiz("owner", "noura-dup"));
    await assertFails(newBiz("owner", "noura-2"));
    await assertFails(newBiz("owner", "other-co"));
    await assertSucceeds(newBiz("owner", "noura-3"));
    // Requests are readable only by the person who asked; nobody writes them or the link.
    await assertSucceeds(getDoc(doc(as("owner"), "businessRequests", "noura-2")));
    await assertFails(getDoc(doc(as("mgr"), "businessRequests", "noura-2")));
    await assertFails(setDoc(doc(as("owner"), "businessRequests", "noura-4"), { id: "noura-4", uid: "owner", status: "approved" }));
    await assertFails(updateDoc(doc(as("owner"), "businessRequests", "noura-2"), { status: "approved" }));
    await assertFails(setDoc(doc(as("owner"), "deployment", "link"), { approvalRequired: false }));
    // An owner can't switch approvals off: the flag lives in deployment/link, which only the server writes.
    await assertSucceeds(updateDoc(doc(as("owner"), "deployment", "config"), { approvalRequired: false }));
    await assertFails(newBiz("owner", "noura-dup"));
    // Approvals switched off by the console: businesses open straight away again.
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "deployment", "link"), { approvalRequired: false }));
    await assertSucceeds(newBiz("owner", "noura-dup"));
  });

  it("lets only the owner archive or restore a business, and never creates one archived", async () => {
    await seedTenant();
    await assertFails(updateDoc(doc(as("mgr"), "tenants", T), { status: "archived" }));
    await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), "tenants", T, "members", "adm"), { id: "adm", uid: "adm", role: "admin", tenantId: T }));
    await assertFails(updateDoc(doc(as("adm"), "tenants", T), { status: "archived" }));
    await assertFails(updateDoc(doc(as("owner"), "tenants", T), { status: "suspended" }));
    await assertSucceeds(updateDoc(doc(as("owner"), "tenants", T), { status: "archived", archivedAt: "2026-11-13T08:00:00Z", archivedBy: "owner" }));
    await assertSucceeds(updateDoc(doc(as("owner"), "tenants", T), { status: "active" }));
    await assertSucceeds(updateDoc(doc(as("adm"), "tenants", T), { name: "Spice Lagoon" }));
    const db = as("owner");
    const b = writeBatch(db);
    b.set(doc(db, "tenants", "x-co"), { id: "x-co", name: "X", ownerUid: "owner", modules: { pos: true }, plan: "trial", status: "archived", createdFromTenant: T });
    b.set(doc(db, "tenants", "x-co", "members", "owner"), { id: "owner", uid: "owner", role: "owner", tenantId: "x-co" });
    await assertFails(b.commit());
  });

  it("refuses ownership of someone else's tenant and outsiders' reads", async () => {
    await seedTenant();
    await assertFails(setDoc(doc(as("eve"), "tenants", T, "members", "eve"), { id: "eve", uid: "eve", role: "owner", tenantId: T }));
    await assertFails(getDoc(doc(as("eve"), "tenants", T)));
    await assertFails(getDoc(doc(as("eve"), "tenants", T, "menuItems", "K001")));
    await assertSucceeds(getDoc(doc(as("view"), "tenants", T, "menuItems", "K001")));
  });

  it("accepts an invitation with exactly the invited role", async () => {
    await seedTenant();
    await assertSucceeds(setDoc(doc(as("owner"), "invites", "bob@example.lk"), { tenantId: T, role: "manager" }));
    await assertFails(setDoc(doc(as("mgr"), "invites", "x@example.lk"), { tenantId: T, role: "manager" }));
    // An unverified address can't take the invitation (someone else may have registered that email).
    await assertFails(setDoc(doc(as("bob", "bob@example.lk", false), "tenants", T, "members", "bob"), { id: "bob", uid: "bob", role: "manager", tenantId: T }));
    const bob = as("bob", "bob@example.lk");
    await assertSucceeds(getDoc(doc(bob, "invites", "bob@example.lk")));
    await assertFails(setDoc(doc(bob, "tenants", T, "members", "bob"), { id: "bob", uid: "bob", role: "admin", tenantId: T }));
    await assertSucceeds(setDoc(doc(bob, "tenants", T, "members", "bob"), { id: "bob", uid: "bob", role: "manager", tenantId: T }));
  });
});

describe("roles", () => {
  beforeEach(() => seedTenant());

  it("restricts configuration to managers and above", async () => {
    await assertSucceeds(setDoc(doc(as("mgr"), "tenants", T, "discounts", "D1"), { id: "D1", name: "10%" }));
    await assertFails(setDoc(doc(as("till"), "tenants", T, "discounts", "D2"), { id: "D2", name: "Free" }));
    await assertFails(setDoc(doc(as("view"), "tenants", T, "settings", "tax"), { id: "tax" }));
    await assertSucceeds(updateDoc(doc(as("acct"), "tenants", T, "settings", "accounting"), { "accounts.vatInput": "1300" }));
    await assertFails(setDoc(doc(as("acct"), "tenants", T, "settings", "accounting"), { id: "accounting" })); // would wipe the approval thresholds
    await assertFails(setDoc(doc(as("acct"), "tenants", T, "settings", "tax"), { id: "tax" }));
  });

  it("lets terminals 86 items but not change prices", async () => {
    const till = as("till");
    await assertSucceeds(updateDoc(doc(till, "tenants", T, "menuItems", "K001"), { available: false }));
    await assertFails(updateDoc(doc(till, "tenants", T, "menuItems", "K001"), { price: 1 }));
  });

  it("keeps invoices and closed checks immutable", async () => {
    const till = as("till");
    await assertSucceeds(setDoc(doc(till, "tenants", T, "checks", "open1"), { id: "open1", status: "open" }));
    await assertSucceeds(updateDoc(doc(till, "tenants", T, "checks", "open1"), { status: "closed" }));
    await assertFails(updateDoc(doc(till, "tenants", T, "checks", "closed1"), { status: "open" }));
    await assertSucceeds(updateDoc(doc(till, "tenants", T, "checks", "closed1"), { depletion: "done" }));
    await assertSucceeds(setDoc(doc(till, "tenants", T, "invoices", "26NOV_W01_2"), { id: "26NOV_W01_2" }));
    await assertFails(updateDoc(doc(as("owner"), "tenants", T, "invoices", "26NOV_W01_1"), { hash: "tampered" }));
  });

  it("closes a check atomically in one batch (check, invoice, sequence, stats, customer)", async () => {
    const till = as("till");
    const b = writeBatch(till);
    b.set(doc(till, "tenants", T, "checks", "c9"), { id: "c9", status: "closed" });
    b.set(doc(till, "tenants", T, "invoices", "26NOV_W01_9"), { id: "26NOV_W01_9" });
    b.set(doc(till, "tenants", T, "sequences", "W01"), { invoiceSeq: 9 }, { merge: true });
    b.set(doc(till, "tenants", T, "dailyStats", "CMB__2026-11-03"), { checks: 1 }, { merge: true });
    b.set(doc(till, "tenants", T, "customers", "C1"), { visits: 1 }, { merge: true });
    b.set(doc(till, "tenants", T, "customers", "C1"), { lastVisit: "x" }, { merge: true });
    await assertSucceeds(b.commit());
  });
});

describe("closed-check corrections", () => {
  beforeEach(async () => seedTenant());
  it("lets POS devices and managers issue credit notes and payment changes, which then never change", async () => {
    const till = as("till");
    await assertSucceeds(setDoc(doc(till, "tenants", T, "creditNotes", "CN-26NOV_W01_1"), { id: "CN-26NOV_W01_1", hash: "h", reason: "Wrong table", depletion: "pending" }));
    await assertFails(setDoc(doc(till, "tenants", T, "creditNotes", "CN-26NOV_W01_2"), { id: "CN-26NOV_W01_2", hash: "h", reason: "" }));
    await assertFails(setDoc(doc(as("acct"), "tenants", T, "creditNotes", "CN-26NOV_W01_3"), { id: "CN-26NOV_W01_3", hash: "h", reason: "x" }));
    await assertSucceeds(updateDoc(doc(till, "tenants", T, "creditNotes", "CN-26NOV_W01_1"), { depletion: "done" }));
    await assertFails(updateDoc(doc(as("mgr"), "tenants", T, "creditNotes", "CN-26NOV_W01_1"), { reason: "changed" }));
    await assertFails(deleteDoc(doc(as("owner"), "tenants", T, "creditNotes", "CN-26NOV_W01_1")));
    await assertSucceeds(setDoc(doc(till, "tenants", T, "checkAdjustments", "A1"), { id: "A1", reason: "Card, not cash" }));
    await assertFails(updateDoc(doc(as("mgr"), "tenants", T, "checkAdjustments", "A1"), { amount: 1 }));
    await assertSucceeds(setDoc(doc(till, "tenants", T, "tillCounts", "TC1"), { id: "TC1", counted: 100 }));
    await assertFails(updateDoc(doc(till, "tenants", T, "tillCounts", "TC1"), { counted: 999 }));
  });
});

describe("module licensing", () => {
  it("blocks ERP and finance writes when the module is off", async () => {
    await seedTenant({ pos: true });
    await assertFails(setDoc(doc(as("owner"), "tenants", T, "stockLevels", "MAIN__I001"), { id: "MAIN__I001" }));
    await assertFails(setDoc(doc(as("owner"), "tenants", T, "accounts", "1000"), { id: "1000" }));
    await assertFails(setDoc(doc(as("owner"), "tenants", T, "customers", "C1"), { id: "C1" }));
  });

  it("allows them when licensed", async () => {
    await seedTenant();
    await assertSucceeds(setDoc(doc(as("mgr"), "tenants", T, "stockLevels", "MAIN__I001"), { id: "MAIN__I001" }));
    await assertSucceeds(setDoc(doc(as("acct"), "tenants", T, "accounts", "1000"), { id: "1000" }));
    await assertFails(setDoc(doc(as("till"), "tenants", T, "accounts", "1001"), { id: "1001" }));
  });
});

describe("accounting and audit", () => {
  beforeEach(() => seedTenant());

  it("lets preparers keep drafts but only the server posts", async () => {
    const acct = as("acct");
    const draft = { id: "d1", type: "journal", status: "draft", createdBy: "acct", lines: [] };
    await assertSucceeds(setDoc(doc(acct, "tenants", T, "vouchers", "d1"), draft));
    await assertSucceeds(updateDoc(doc(acct, "tenants", T, "vouchers", "d1"), { remarks: "Rent", updatedBy: "acct", updatedAt: "now" }));
    await assertFails(updateDoc(doc(as("acct2"), "tenants", T, "vouchers", "d1"), { remarks: "Changed by someone else" }));
    await assertFails(updateDoc(doc(acct, "tenants", T, "vouchers", "d1"), { status: "posted" }));
    await assertFails(setDoc(doc(acct, "tenants", T, "vouchers", "d2"), { ...draft, id: "d2", status: "posted", number: "JV-1" }));
    await assertFails(updateDoc(doc(as("owner"), "tenants", T, "vouchers", "posted1"), { remarks: "edit after posting" }));
    await assertFails(setDoc(doc(as("owner"), "tenants", T, "ledger", "x"), { id: "x" }));
    await assertFails(setDoc(doc(as("owner"), "tenants", T, "accountBalances", "x"), { id: "x" }));
    await assertFails(setDoc(doc(as("owner"), "tenants", T, "fiscalYears", "2026-27"), { id: "2026-27" }));
    await assertFails(setDoc(doc(as("mgr"), "tenants", T, "vouchers", "m1"), { ...draft, id: "m1", createdBy: "mgr" }));
  });

  it("keeps approval thresholds under owner control", async () => {
    await assertFails(updateDoc(doc(as("acct"), "tenants", T, "settings", "accounting"), { "ledger.journalApprovalThreshold": 99999999 }));
    await assertSucceeds(updateDoc(doc(as("acct"), "tenants", T, "settings", "accounting"), { "accounts.vatOutput": "2100" }));
    await assertSucceeds(updateDoc(doc(as("owner"), "tenants", T, "settings", "accounting"), { "ledger.journalApprovalThreshold": 100000 }));
  });

  it("protects depreciation figures on assets", async () => {
    await assertSucceeds(updateDoc(doc(as("acct"), "tenants", T, "assets", "A1"), { name: "Combi oven" }));
    await assertFails(updateDoc(doc(as("acct"), "tenants", T, "assets", "A1"), { accumulatedDep: 5 }));
    await assertFails(updateDoc(doc(as("owner"), "tenants", T, "assets", "A1"), { status: "disposed" }));
  });

  it("opens the audit log to auditors and owners only, and to nobody for writing", async () => {
    await assertSucceeds(getDoc(doc(as("aud"), "auditLog", T, "events", "e1")));
    await assertSucceeds(getDoc(doc(as("owner"), "auditLog", T, "events", "e1")));
    await assertFails(getDoc(doc(as("mgr"), "auditLog", T, "events", "e1")));
    await assertFails(getDoc(doc(as("acct"), "auditLog", T, "events", "e1")));
    await assertFails(setDoc(doc(as("owner"), "auditLog", T, "events", "e2"), { id: "e2" }));
    await assertFails(updateDoc(doc(as("owner"), "auditLog", T, "events", "e1"), { action: "update" }));
    // Auditors read everything but change nothing.
    await assertSucceeds(getDoc(doc(as("aud"), "tenants", T, "menuItems", "K001")));
    await assertSucceeds(getDoc(doc(as("aud"), "tenants", T, "vouchers", "posted1")));
    await assertFails(updateDoc(doc(as("aud"), "tenants", T, "menuItems", "K001"), { price: 1 }));
  });

  it("accepts the audit stamp on narrowly permitted updates", async () => {
    await assertSucceeds(updateDoc(doc(as("till"), "tenants", T, "menuItems", "K001"), { available: false, updatedBy: "till", updatedAt: "2026-11-03T10:00:00Z" }));
  });
});

describe("licensing and POS controls", () => {
  async function seedLicensed() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "tenants", "lic"), { id: "lic", name: "Licensed", ownerUid: "owner", plan: "starter", entitlements: { modules: ["pos", "tables", "crm"], limits: { workstations: 3 } }, modules: { pos: true, tables: false }, status: "active" });
      for (const [uid, role] of [["owner", "owner"], ["till", "terminal"], ["view", "viewer"], ["mgr", "manager"]] as const) await setDoc(doc(db, "tenants", "lic", "members", uid), { id: uid, uid, role, tenantId: "lic" });
      await setDoc(doc(db, "tenants", "lic", "staff", "1002"), { id: "1002", employeeNo: "1002", name: "Nimali", roleId: "cashier", failedSignIns: 0 });
      await setDoc(doc(db, "tenants", "lic", "timeCards", "tc-closed"), { id: "tc-closed", staffId: "1002", clockIn: "x", clockOut: "y" });
    });
  }

  it("lets nobody but the licence function change the edition, entitlement or licence", async () => {
    await seedLicensed();
    const owner = as("owner");
    await assertFails(updateDoc(doc(owner, "tenants", "lic"), { plan: "enterprise" }));
    await assertFails(updateDoc(doc(owner, "tenants", "lic"), { "entitlements.modules": ["pos", "accounting"] }));
    await assertFails(updateDoc(doc(owner, "tenants", "lic"), { licence: { edition: "enterprise" } }));
    // Switching licensed modules is fine; unlicensed ones are refused.
    await assertSucceeds(updateDoc(doc(owner, "tenants", "lic"), { "modules.tables": true }));
    await assertFails(updateDoc(doc(owner, "tenants", "lic"), { "modules.accounting": true }));
    // New businesses start as a trial or demo only.
    await assertFails(setDoc(doc(as("bob"), "tenants", "bob-co"), { id: "bob-co", name: "Bob", ownerUid: "bob", plan: "enterprise", modules: {} }));
  });

  it("keeps the supplier's suspension and notice server-only, while the owner controls figure sharing", async () => {
    await seedLicensed();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), "tenants", "lic"), { supplier: { suspension: { since: "2026-11-01T00:00:00Z", graceUntil: "2026-11-08T00:00:00Z", message: "Please renew" } } });
    });
    const owner = as("owner");
    await assertFails(updateDoc(doc(owner, "tenants", "lic"), { "supplier.suspension": null }));
    await assertFails(updateDoc(doc(owner, "tenants", "lic"), { supplier: {} }));
    await assertSucceeds(updateDoc(doc(owner, "tenants", "lic"), { shareUsage: false }));
    await assertFails(updateDoc(doc(as("view"), "tenants", "lic"), { shareUsage: true }));
    await assertFails(setDoc(doc(as("bob"), "tenants", "bob-co"), { id: "bob-co", name: "Bob", ownerUid: "bob", plan: "trial", modules: {}, supplier: { notice: { text: "x" } } }));
  });

  it("lets terminals record sign-in control on employees but nothing else", async () => {
    await seedLicensed();
    const till = as("till");
    await assertSucceeds(updateDoc(doc(till, "tenants", "lic", "staff", "1002"), { failedSignIns: 5, lockedAt: "2026-11-04T10:00:00Z", updatedBy: "till", updatedAt: "2026-11-04T10:00:00Z" }));
    await assertFails(updateDoc(doc(till, "tenants", "lic", "staff", "1002"), { roleId: "manager" }));
    await assertSucceeds(updateDoc(doc(as("mgr"), "tenants", "lic", "staff", "1002"), { roleId: "supervisor" }));
  });

  it("keeps PIN hashes and card numbers unreadable to every client", async () => {
    await seedLicensed();
    const mgr = as("mgr");
    await assertSucceeds(setDoc(doc(mgr, "tenants", "lic", "staffSecrets", "1002"), { id: "1002", pinHash: "a".repeat(64), pinSalt: "b".repeat(32), cardId: "CARD9" }));
    for (const who of ["owner", "mgr", "till", "aud"]) await assertFails(getDoc(doc(as(who), "tenants", "lic", "staffSecrets", "1002")));
    await assertFails(setDoc(doc(as("till"), "tenants", "lic", "staffSecrets", "1003"), { id: "1003", pinHash: "x".repeat(64), pinSalt: "y".repeat(32) }));
    await assertFails(setDoc(doc(mgr, "tenants", "lic", "staffSecrets", "1004"), { id: "1004", pinHash: "x".repeat(64), note: "extra" }));
    // Staff records may not carry new hashes or card numbers.
    await assertFails(setDoc(doc(mgr, "tenants", "lic", "staff", "2001"), { id: "2001", name: "New", pinHash: "x".repeat(64), pinSalt: "y".repeat(32) }));
    await assertSucceeds(setDoc(doc(mgr, "tenants", "lic", "staff", "2001"), { id: "2001", name: "New", pinSet: true }));
    await assertFails(updateDoc(doc(mgr, "tenants", "lic", "staff", "2001"), { cardId: "CARD1" }));
  });

  it("lets devices report status and errors, readable by managers", async () => {
    await seedLicensed();
    const till = as("till");
    await assertSucceeds(setDoc(doc(till, "tenants", "lic", "deviceStatus", "W01"), { id: "W01", uid: "till", appVersion: "1.2.0", lastSeenAt: "2026-11-08T10:00:00Z" }));
    await assertFails(setDoc(doc(till, "tenants", "lic", "deviceStatus", "W02"), { id: "W02", uid: "someone-else", appVersion: "1.2.0" }));
    await assertSucceeds(setDoc(doc(till, "tenants", "lic", "clientErrors", "e1"), { id: "e1", uid: "till", message: "boom", stack: "at x" }));
    await assertFails(setDoc(doc(till, "tenants", "lic", "clientErrors", "e2"), { id: "e2", uid: "till", message: "x".repeat(3000) }));
    await assertFails(getDoc(doc(till, "tenants", "lic", "clientErrors", "e1")));
    await assertSucceeds(getDoc(doc(as("mgr"), "tenants", "lic", "clientErrors", "e1")));
  });

  it("keeps the POS journal append-only and closed time cards fixed", async () => {
    await seedLicensed();
    const till = as("till");
    const ev = { id: "ev1", workstationId: "W01", type: "noSale", employeeId: "1002", prevHash: "", hash: "abc" };
    await assertSucceeds(setDoc(doc(till, "tenants", "lic", "posJournal", "ev1"), ev));
    await assertFails(updateDoc(doc(till, "tenants", "lic", "posJournal", "ev1"), { type: "signIn" }));
    await assertFails(updateDoc(doc(as("owner"), "tenants", "lic", "posJournal", "ev1"), { amount: 0 }));
    await assertFails(setDoc(doc(as("view"), "tenants", "lic", "posJournal", "ev2"), { ...ev, id: "ev2" }));
    await assertSucceeds(setDoc(doc(till, "tenants", "lic", "timeCards", "tc1"), { id: "tc1", staffId: "1002", clockIn: "x" }));
    await assertSucceeds(updateDoc(doc(till, "tenants", "lic", "timeCards", "tc1"), { clockOut: "y", minutes: 480 }));
    await assertFails(updateDoc(doc(till, "tenants", "lic", "timeCards", "tc-closed"), { minutes: 1 }));
  });
});

describe("accounting and stock first (no POS)", () => {
  const B = "books";
  async function seedBooks() {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "tenants", B), { id: B, name: "Books first", ownerUid: "owner", modules: { pos: false, inventory: true, purchasing: false, crm: false, accounting: true }, plan: "demo", status: "active" });
      for (const [uid, role] of [["owner", "owner"], ["acct", "accountant"], ["store", "storekeeper"], ["till", "terminal"], ["view", "viewer"], ["aud", "auditor"]] as const) {
        await setDoc(doc(db, "tenants", B, "members", uid), { id: uid, uid, role, tenantId: B });
      }
      await setDoc(doc(db, "tenants", B, "attachments", "linked"), { id: "linked", fileName: "veg.jpg", contentType: "image/jpeg", size: 1000, sha256: "a".repeat(64), chunks: 1, status: "linked", linkedTo: { col: "vouchers", id: "PI-1" }, uploadedBy: "acct", uploadedAt: "x" });
    });
  }
  const att = (id: string, uid: string, extra: Record<string, unknown> = {}) => ({ id, fileName: "bill.jpg", contentType: "image/jpeg", size: 120_000, sha256: "b".repeat(64), chunks: 1, status: "inbox", uploadedBy: uid, uploadedAt: "2026-11-08T10:00:00Z", ...extra });

  it("lets the accountant keep suppliers and customers without the purchasing or CRM modules", async () => {
    await seedBooks();
    await assertSucceeds(setDoc(doc(as("acct"), "tenants", B, "vendors", "VEG01"), { id: "VEG01", code: "VEG01", name: "Perera Vegetable Stores", phone: "", paymentTermsDays: 7, active: true }));
    await assertSucceeds(setDoc(doc(as("acct"), "tenants", B, "customers", "ABC01"), { id: "ABC01", name: "ABC Holdings", phone: "" }));
    await assertFails(setDoc(doc(as("view"), "tenants", B, "vendors", "X"), { id: "X", code: "X", name: "X" }));
    await assertFails(setDoc(doc(as("till"), "tenants", B, "customers", "Y"), { id: "Y", name: "Y" }));
  });

  it("files bill photos as evidence that cannot be swapped afterwards", async () => {
    await seedBooks();
    const store = as("store");
    // Storekeepers and accountants file bills; tills and viewers can't, nor read them.
    await assertSucceeds(setDoc(doc(store, "tenants", B, "attachmentChunks", "a1_0"), { id: "a1_0", attachmentId: "a1", index: 0, data: "QUJD" }));
    await assertSucceeds(setDoc(doc(store, "tenants", B, "attachments", "a1"), att("a1", "store")));
    await assertFails(setDoc(doc(as("till"), "tenants", B, "attachments", "a2"), att("a2", "till")));
    await assertFails(getDoc(doc(as("view"), "tenants", B, "attachments", "a1")));
    await assertSucceeds(getDoc(doc(as("aud"), "tenants", B, "attachmentChunks", "a1_0")));
    // Filed in someone else's name, too large, or a chunk over the limit: refused.
    await assertFails(setDoc(doc(store, "tenants", B, "attachments", "a3"), att("a3", "acct")));
    await assertFails(setDoc(doc(store, "tenants", B, "attachments", "a4"), att("a4", "store", { size: 11 * 1024 * 1024 })));
    await assertFails(setDoc(doc(store, "tenants", B, "attachmentChunks", "big"), { id: "big", attachmentId: "a1", index: 1, data: "x".repeat(700_001) }));
    // Linking and describing are allowed; the file, its fingerprint and its chunks are fixed.
    await assertSucceeds(updateDoc(doc(as("acct"), "tenants", B, "attachments", "a1"), { status: "linked", linkedTo: { col: "vouchers", id: "PI-9" }, supplierName: "Perera", amount: 1425000 }));
    await assertFails(updateDoc(doc(as("acct"), "tenants", B, "attachments", "a1"), { sha256: "c".repeat(64) }));
    await assertFails(updateDoc(doc(as("owner"), "tenants", B, "attachmentChunks", "a1_0"), { data: "WFla" }));
    // Only an administrator removes, and only what is still unfiled in the inbox.
    await assertSucceeds(setDoc(doc(store, "tenants", B, "attachments", "a5"), att("a5", "store")));
    await assertFails(deleteDoc(doc(as("acct"), "tenants", B, "attachments", "a5")));
    await assertSucceeds(deleteDoc(doc(as("owner"), "tenants", B, "attachments", "a5")));
    await assertFails(deleteDoc(doc(as("owner"), "tenants", B, "attachments", "linked")));
  });

  it("lets the accountant prepare opening balances and the asset register, but never post", async () => {
    await seedBooks();
    const acct = as("acct");
    const draft = { id: "OPEN-2026-04-01", type: "journal", status: "draft", opening: true, createdBy: "acct", postingDate: "2026-04-01", lines: [] };
    await assertSucceeds(setDoc(doc(acct, "tenants", B, "vouchers", draft.id), draft));
    await assertFails(setDoc(doc(acct, "tenants", B, "vouchers", "J2"), { ...draft, id: "J2", status: "posted" }));
    await assertFails(setDoc(doc(acct, "tenants", B, "vouchers", "J3"), { ...draft, id: "J3", createdBy: "owner" }));
    // Assets owned before the books start come in with their depreciation to date…
    await assertSucceeds(setDoc(doc(acct, "tenants", B, "assets", "FA-001"), { id: "FA-001", name: "Combi oven", status: "active", cost: 60000000, accumulatedDep: 6250000, lastDepPeriod: "2026-03" }));
    // …which only the server changes from then on.
    await assertFails(updateDoc(doc(acct, "tenants", B, "assets", "FA-001"), { accumulatedDep: 0 }));
    await assertSucceeds(updateDoc(doc(acct, "tenants", B, "assets", "FA-001"), { name: "Combi oven (Rational)" }));
    await assertFails(setDoc(doc(as("store"), "tenants", B, "assets", "FA-002"), { id: "FA-002", name: "Fridge", status: "active", accumulatedDep: 0 }));
  });
});

describe("connected phones and tablets", () => {
  it("keeps pairing codes server-only and connected devices as POS terminals", async () => {
    await seedTenant();
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "devicePairings", "abc"), { tenantId: T, workstationId: "P01", label: "Phone", expiresAt: "2099-01-01T00:00:00Z" });
      await setDoc(doc(db, "tenants", T, "members", "dev-1"), { id: "dev-1", uid: "dev-1", role: "terminal", tenantId: T, name: "Phone", email: "dev-1@devices.pos-suite.invalid", device: { workstationId: "P01" } });
    });
    for (const uid of ["owner", "mgr", "dev-1"]) {
      await assertFails(getDoc(doc(as(uid), "devicePairings", "abc")));
      await assertFails(setDoc(doc(as(uid), "devicePairings", "new"), { tenantId: T }));
    }
    const owner = as("owner");
    await assertSucceeds(updateDoc(doc(owner, "tenants", T, "members", "dev-1"), { name: "Bar phone" }));
    await assertFails(updateDoc(doc(owner, "tenants", T, "members", "dev-1"), { role: "manager" }));
    // The device itself can't change its own record either.
    await assertFails(updateDoc(doc(as("dev-1"), "tenants", T, "members", "dev-1"), { role: "admin" }));
  });
});
