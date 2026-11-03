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
    for (const [uid, role] of [["owner", "owner"], ["mgr", "manager"], ["till", "terminal"], ["acct", "accountant"], ["view", "viewer"]] as const) {
      await setDoc(doc(db, "tenants", T, "members", uid), { id: uid, uid, email: `${uid}@example.lk`, role, tenantId: T });
    }
    await setDoc(doc(db, "tenants", T, "menuItems", "K001"), { id: "K001", name: "Kottu", price: 120000, available: true });
    await setDoc(doc(db, "tenants", T, "checks", "closed1"), { id: "closed1", status: "closed", depletion: "pending" });
    await setDoc(doc(db, "tenants", T, "invoices", "26NOV_W01_1"), { id: "26NOV_W01_1", hash: "x" });
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
    await assertSucceeds(setDoc(doc(as("acct"), "tenants", T, "settings", "accounting"), { id: "accounting" }));
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
