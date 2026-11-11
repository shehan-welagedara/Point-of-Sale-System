/** Polymath Console security rules (firebase/console/firestore.rules). Run with `pnpm test:rules`. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { type RulesTestEnvironment, assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-polymath-console",
    firestore: { rules: readFileSync(resolve(__dirname, "../console/firestore.rules"), "utf8") },
  });
});
afterAll(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "clients", "noura-kitchen"), { id: "noura-kitchen", projectId: "noura-kitchen-pos", status: "active" });
    await setDoc(doc(db, "invites", "new@polymath.lk"), { email: "new@polymath.lk", role: "sales" });
    await setDoc(doc(db, "staff", "u-new"), { uid: "u-new", role: "support", active: true });
  });
});

const as = (uid: string, role?: string) => env.authenticatedContext(uid, { email: `${uid}@polymath.lk`, email_verified: true, ...(role ? { consoleRole: role } : {}) }).firestore();

describe("Polymath Console rules", () => {
  it("lets staff read clients", async () => {
    for (const r of ["owner", "admin", "sales", "support", "engineer"]) await assertSucceeds(getDoc(doc(as(`u-${r}`, r), "clients", "noura-kitchen")));
  });
  it("refuses people without a console role, and signed-out visitors", async () => {
    await assertFails(getDoc(doc(as("stranger"), "clients", "noura-kitchen")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "clients", "noura-kitchen")));
    await assertFails(getDoc(doc(as("client-admin", "admin-of-a-restaurant"), "clients", "noura-kitchen")));
  });
  it("lets nobody write directly, not even the owner (changes go through the server and the audit log)", async () => {
    await assertFails(setDoc(doc(as("u-owner", "owner"), "clients", "noura-kitchen"), { status: "suspended" }, { merge: true }));
    await assertFails(setDoc(doc(as("u-owner", "owner"), "audit", "x"), { action: "fake" }));
    await assertFails(setDoc(doc(as("u-owner", "owner"), "staff", "u-owner"), { role: "owner" }));
  });
  it("shows invitations to owners and admins only", async () => {
    await assertSucceeds(getDoc(doc(as("u-admin", "admin"), "invites", "new@polymath.lk")));
    await assertFails(getDoc(doc(as("u-sales", "sales"), "invites", "new@polymath.lk")));
  });
  it("covers every console collection, and nothing else", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const p of ["licences/L1", "deployments/D1", "audit/A1", "config/company", "unknownProjects/p", "clients/noura-kitchen/usage/2026-11-10", "clients/noura-kitchen/payments/P1", "other/x"]) await setDoc(doc(db, p), { x: 1 });
    });
    const support = as("u-support", "support");
    for (const p of ["licences/L1", "deployments/D1", "audit/A1", "config/company", "unknownProjects/p", "clients/noura-kitchen/usage/2026-11-10", "clients/noura-kitchen/payments/P1"]) await assertSucceeds(getDoc(doc(support, p)));
    await assertFails(getDoc(doc(support, "other/x")));
  });
  it("lets a signed-in person read their own staff record", async () => {
    await assertSucceeds(getDoc(doc(as("u-new"), "staff", "u-new")));
    await assertFails(getDoc(doc(as("u-other"), "staff", "u-new")));
  });
});
