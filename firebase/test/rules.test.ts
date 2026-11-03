/** Security rules tests. Run with `pnpm test:rules` (starts the Firestore emulator). */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { type RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collectionGroup, doc, getDoc, getDocs, query, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";

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

const as = (uid: string, email = `${uid}@example.lk`) => env.authenticatedContext(uid, { email }).firestore();

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
    b.set(doc(db, "tenants", "alice-cafe"), { id: "alice-cafe", name: "Alice Cafe", ownerUid: "alice", modules: { pos: true } });
    b.set(doc(db, "tenants", "alice-cafe", "members", "alice"), { id: "alice", uid: "alice", role: "owner", tenantId: "alice-cafe" });
    await assertSucceeds(b.commit());
    // …then seed settings in small batches (9 writes) under the rules.
    const b2 = writeBatch(db);
    for (let i = 0; i < 9; i++) b2.set(doc(db, "tenants", "alice-cafe", "orderTypes", `OT${i}`), { id: `OT${i}`, name: `Type ${i}` });
    await assertSucceeds(b2.commit());
    const found = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", "alice")));
    if (found.size !== 1) throw new Error("membership lookup failed");
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

