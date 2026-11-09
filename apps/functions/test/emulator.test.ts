/**
 * End-to-end on the Firebase Emulator Suite (Auth + Firestore with the real rules + these
 * functions). Run with `pnpm test:functions` from the repository root.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp } from "firebase/app";
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDoc, getDocs, initializeFirestore, setDoc, writeBatch } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildEntitlements, hashPin, signLicence } from "@pos/core";
import { buildFiscalYear, defaultChartOfAccounts, defaultCostCenters, defaultLedgerSettings } from "@pos/ledger";

const PROJECT = "demo-pos-suite";
const T = `t-${Date.now()}`;
const app = initializeApp({ projectId: PROJECT, apiKey: "demo-key", authDomain: "localhost" }, "e2e");
const auth = getAuth(app);
const db = initializeFirestore(app, { ignoreUndefinedProperties: true });
const fns = getFunctions(app, "asia-south1");
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectFunctionsEmulator(fns, "127.0.0.1", 5001);
const ledgerApi = httpsCallable(fns, "ledgerApi");
const call = (data: Record<string, unknown>) => ledgerApi({ tenantId: T, ...data }).then((r) => r.data as Record<string, unknown>);
const admin = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { ...init, headers: { Authorization: "Bearer owner", "Content-Type": "application/json" } });
/** Reads documents through the emulator's REST API (plain values) without opening client streams. */
async function adminList(path: string): Promise<Record<string, unknown>[]> {
  const j = (await (await admin(`${path}?pageSize=1000`)).json()) as { documents?: { fields: Record<string, unknown> }[] };
  const plain = (v: Record<string, unknown>): unknown =>
    "stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "booleanValue" in v ? v.booleanValue
    : "arrayValue" in v ? ((v.arrayValue as { values?: Record<string, unknown>[] }).values ?? []).map(plain)
    : "mapValue" in v ? Object.fromEntries(Object.entries((v.mapValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {}).map(([k, x]) => [k, plain(x)])) : null;
  return (j.documents ?? []).map((d) => Object.fromEntries(Object.entries(d.fields).map(([k, v]) => [k, plain(v as Record<string, unknown>)])));
}
const stamp = (uid: string) => ({ updatedBy: uid, updatedAt: new Date().toISOString() });

let owner = "";
let accountant = "";

async function as(email: string) {
  await signOut(auth);
  await signInWithEmailAndPassword(auth, email, "secret123");
}

async function until<T>(f: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 300));
  }
}

beforeAll(async () => {
  accountant = (await createUserWithEmailAndPassword(auth, `acc-${T}@demo.lk`, "secret123")).user.uid;
  owner = (await createUserWithEmailAndPassword(auth, `own-${T}@demo.lk`, "secret123")).user.uid;
  const b = writeBatch(db);
  // The first business in the project claims the deployment (firestore.rules).
  if (!(await getDoc(doc(db, "deployment", "config"))).exists()) b.set(doc(db, "deployment", "config"), { ownerUid: owner, openSignup: false });
  b.set(doc(db, "tenants", T), { id: T, name: "E2E", ownerUid: owner, modules: { pos: true, accounting: true }, plan: "demo", status: "active" });
  b.set(doc(db, "tenants", T, "members", owner), { id: owner, uid: owner, role: "owner", tenantId: T, name: "Owner", email: "o" });
  await b.commit();
  await setDoc(doc(db, "tenants", T, "members", accountant), { id: accountant, uid: accountant, role: "accountant", tenantId: T, name: "Accountant", email: "a" });
  const s = writeBatch(db);
  s.set(doc(db, "tenants", T, "settings", "accounting"), { id: "accounting", accounts: {}, ledger: defaultLedgerSettings("CMB") });
  for (const a of defaultChartOfAccounts()) s.set(doc(db, "tenants", T, "accounts", a.id), a);
  await s.commit();
  const c = writeBatch(db);
  for (const cc of defaultCostCenters([{ id: "CMB", name: "Colombo" }])) c.set(doc(db, "tenants", T, "costCenters", cc.id), cc);
  await c.commit();
  await call({ action: "ensureFiscalYear", date: "2026-11-03" });
}, 60_000);

afterAll(async () => deleteApp(app));

describe("ledger on Cloud Functions", () => {
  it("enforces maker-checker approval and posts only on the server", async () => {
    // The fiscal year was created by the server; clients cannot write it.
    expect((await getDoc(doc(db, "tenants", T, "fiscalYears", "2026-27"))).data()?.periods).toHaveLength(12);
    await expect(setDoc(doc(db, "tenants", T, "fiscalYears", "2027-28"), buildFiscalYear(2027, 4))).rejects.toThrow(/PERMISSION_DENIED/);

    await as(`acc-${T}@demo.lk`);
    await setDoc(doc(db, "tenants", T, "vouchers", "j1"), {
      id: "j1", type: "journal", status: "draft", postingDate: "2026-11-03", remarks: "Rent", currency: "LKR", exchangeRateMicros: 1_000_000, costCenter: "CMB", createdBy: accountant, createdAt: new Date().toISOString(), ...stamp(accountant),
      lines: [{ account: "6100", debit: 150_000_00, credit: 0 }, { account: "1010", debit: 0, credit: 150_000_00 }],
    });
    // A client cannot fake a posted voucher or write the ledger.
    await expect(setDoc(doc(db, "tenants", T, "vouchers", "fake"), { id: "fake", status: "posted", createdBy: accountant, number: "JV-1" })).rejects.toThrow(/PERMISSION_DENIED/);
    await expect(setDoc(doc(db, "tenants", T, "ledger", "x"), { id: "x", debit: 1 })).rejects.toThrow(/PERMISSION_DENIED/);

    expect(await call({ action: "submit", voucherId: "j1" })).toMatchObject({ status: "submitted" });
    await expect(call({ action: "approve", voucherId: "j1" })).rejects.toThrow(/segregation of duties/);

    await as(`own-${T}@demo.lk`);
    const posted = await call({ action: "approve", voucherId: "j1" });
    expect(posted).toMatchObject({ status: "posted", voucher: { number: "JV-202627-00001", approvedBy: owner, createdBy: accountant } });
    const ledger = await getDocs(collection(db, "tenants", T, "ledger"));
    expect(ledger.size).toBe(2);
  }, 60_000);

  it("captures an audit trail server-side, seals it and detects tampering", async () => {
    await as(`own-${T}@demo.lk`);
    // The trigger records each change with the signed-in user who made it.
    const events = await until(async () => {
      const list = await adminList(`auditLog/${T}/events`);
      const has = (f: (e: Record<string, unknown>) => boolean) => list.some(f);
      return has((e) => e.collection === "vouchers" && e.action === "create") && has((e) => e.collection === "vouchers" && (e.changedFields as string[]).includes("approvedBy")) ? list : null;
    });
    const create = events.find((e) => e.collection === "vouchers" && e.action === "create")!;
    expect(create).toMatchObject({ docId: "j1", actorType: "user", actorId: accountant });
    // The server's later change is not pinned on the accountant's earlier stamp.
    const approval = events.find((e) => e.collection === "vouchers" && (e.changedFields as string[]).includes("approvedBy"))!;
    expect(approval.actorId).not.toBe(accountant);
    expect(events.some((e) => e.collection === "ledger")).toBe(false); // the ledger is its own trail

    // Clients cannot touch the audit log.
    await expect(setDoc(doc(db, "auditLog", T, "events", "fake"), { id: "fake" })).rejects.toThrow(/PERMISSION_DENIED/);

    const seal = await call({ action: "seal" });
    expect(seal).toMatchObject({ seq: 1 });
    const clean = await call({ action: "verify" });
    expect(clean).toMatchObject({ ok: true, issues: [] });

    // Even an edit with full database access (console/Admin) is detected.
    const lines = await getDocs(collection(db, "tenants", T, "ledger"));
    const debit = lines.docs.find((d) => d.data().account === "6100")!;
    await admin(`tenants/${T}/ledger/${debit.id}?updateMask.fieldPaths=debit`, { method: "PATCH", body: JSON.stringify({ fields: { debit: { integerValue: "100000" } } }) });
    const tampered = await call({ action: "verify" }) as { ok: boolean; issues: { message: string }[] };
    expect(tampered.ok).toBe(false);
    expect(tampered.issues.map((i) => i.message).join(" | ")).toMatch(/hash mismatch/);
  }, 60_000);

  it("refuses ledger actions to roles without the privilege", async () => {
    const viewer = (await createUserWithEmailAndPassword(auth, `view-${T}@demo.lk`, "secret123")).user.uid;
    await as(`own-${T}@demo.lk`);
    await setDoc(doc(db, "tenants", T, "members", viewer), { id: viewer, uid: viewer, role: "viewer", tenantId: T, name: "Viewer", email: "v", ...stamp(owner) });
    await as(`view-${T}@demo.lk`);
    await expect(call({ action: "verify" })).rejects.toThrow(/cannot verify/);
    await expect(getDocs(collection(db, "auditLog", T, "events"))).rejects.toMatchObject({ code: "permission-denied" });
  }, 60_000);
});

describe("licence activation on Cloud Functions", () => {
  const demoKey = readFileSync(resolve(__dirname, "../../../tools/licence/demo-key.txt"), "utf8").match(/^private=(.+)$/m)![1]!;
  const licence = (projectId: string) =>
    signLicence(
      { v: 1, licenceId: "LIC-E2E", licensee: { name: "E2E Hotels" }, edition: "starter", addOns: ["accounting"], entitlements: buildEntitlements("starter", ["accounting"]), projectId, tenantId: T, billing: "subscription", issuedAt: "2026-11-01T00:00:00Z", validFrom: "2026-11-01T00:00:00Z", expiresAt: "2099-12-31T00:00:00Z", graceDays: 14 },
      demoKey,
    );
  const activate = httpsCallable(fns, "licenceApi");

  it("verifies the vendor signature and project binding, and lets only the owner activate", async () => {
    await as(`acc-${T}@demo.lk`);
    await expect(activate({ tenantId: T, action: "activate", token: await licence(PROJECT) })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await as(`own-${T}@demo.lk`);
    await expect(activate({ tenantId: T, action: "activate", token: await licence("someone-elses-project") })).rejects.toThrow(/project/);
    const good = await licence(PROJECT);
    const [pre, body, sig] = good.split(".");
    const forged = JSON.parse(Buffer.from(body!, "base64url").toString());
    forged.edition = "enterprise";
    await expect(activate({ tenantId: T, action: "activate", token: `${pre}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}` })).rejects.toThrow(/signature/);

    await activate({ tenantId: T, action: "activate", token: good });
    const t = (await getDoc(doc(db, "tenants", T))).data()!;
    expect(t.plan).toBe("starter");
    expect(t.licence.licenceId).toBe("LIC-E2E");
    expect(t.entitlements.modules).toContain("accounting");
    expect(t.modules.accounting).toBe(true);
    // The owner still can't raise the entitlement directly.
    await expect(setDoc(doc(db, "tenants", T), { plan: "enterprise" }, { merge: true })).rejects.toThrow(/PERMISSION_DENIED/);
  });
});

describe("employee PIN checks on the server (posAuth)", () => {
  const posAuth = httpsCallable(fns, "posAuth");
  const auth2 = (data: Record<string, unknown>) => posAuth({ tenantId: T, ...data }).then((r) => r.data as { ok: boolean; reason?: string; triesLeft?: number; locked?: boolean; staffId?: string; migrated?: number });
  /** Writes a document as the emulator's admin (bypassing the rules), e.g. an old-style staff record. */
  const adminSet = (path: string, data: Record<string, string | number | boolean | string[]>) =>
    admin(path, { method: "PATCH", body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? { arrayValue: { values: v.map((x) => ({ stringValue: x })) } } : typeof v === "number" ? { integerValue: String(v) } : typeof v === "boolean" ? { booleanValue: v } : { stringValue: v }])) }) });

  it("checks PINs with lockout, hides the hashes and moves old ones", async () => {
    await as(`own-${T}@demo.lk`);
    const { hash, salt } = await hashPin("4826");
    await setDoc(doc(db, "tenants", T, "staff", "2001"), { id: "2001", employeeNo: "2001", name: "Supun", roleId: "cashier", propertyIds: [], status: "active", pinSet: true, hasCard: true, ...stamp(owner) });
    await setDoc(doc(db, "tenants", T, "staffSecrets", "2001"), { id: "2001", pinHash: hash, pinSalt: salt, cardId: "CARD-2001-XYZ" });
    // Nobody can read the secret back, not even the owner.
    await expect(getDoc(doc(db, "tenants", T, "staffSecrets", "2001"))).rejects.toMatchObject({ code: "permission-denied" });

    expect(await auth2({ action: "verify", staffId: "2001", pin: "1111", purpose: "signIn" })).toMatchObject({ ok: false, triesLeft: 4 });
    expect(await auth2({ action: "verify", staffId: "2001", pin: "4826", purpose: "signIn" })).toMatchObject({ ok: true, staffId: "2001" });
    expect((await getDoc(doc(db, "tenants", T, "staff", "2001"))).data()?.failedSignIns).toBe(0);
    expect(await auth2({ action: "identifyCard", card: "CARD-2001-XYZ" })).toMatchObject({ ok: true, staffId: "2001" });
    expect(await auth2({ action: "identifyCard", card: "CARD-NOPE" })).toMatchObject({ ok: false });

    // Five wrong PINs lock the employee; the right PIN then no longer works.
    for (let i = 0; i < 5; i++) await auth2({ action: "verify", staffId: "2001", pin: "9999", purpose: "approve" });
    expect(await auth2({ action: "verify", staffId: "2001", pin: "4826", purpose: "signIn" })).toMatchObject({ ok: false, locked: true });

    // An old-style record with the hash on the staff document is moved on first use.
    const old = await hashPin("7319");
    await adminSet(`tenants/${T}/staff/2002`, { id: "2002", employeeNo: "2002", name: "Old", roleId: "server", status: "active", pinHash: old.hash, pinSalt: old.salt });
    expect(await auth2({ action: "verify", staffId: "2002", pin: "7319", purpose: "signIn" })).toMatchObject({ ok: true });
    const moved = (await getDoc(doc(db, "tenants", T, "staff", "2002"))).data()!;
    expect(moved.pinHash).toBeUndefined();
    expect(moved.pinSet).toBe(true);

    // Logins without POS rights can't check PINs.
    await as(`acc-${T}@demo.lk`);
    await expect(auth2({ action: "verify", staffId: "2002", pin: "7319", purpose: "signIn" })).rejects.toMatchObject({ code: "functions/permission-denied" });
  });
});

describe("phones and tablets connected with one-time codes (deviceApi)", () => {
  const deviceApi = httpsCallable(fns, "deviceApi");
  const dev = (data: Record<string, unknown>) => deviceApi(data).then((r) => r.data as Record<string, string>);

  it("pairs a phone without a shared password, once, and removes it on its own", async () => {
    await as(`own-${T}@demo.lk`);
    await setDoc(doc(db, "tenants", T, "workstations", "P01"), { id: "P01", code: "P01", name: "Phone 1", propertyId: "CMB", rvcId: "R1", deviceProfile: "mobile", receiptPrinterId: "", printMode: "agent", active: true, ...stamp(owner) });

    // Only managers create codes.
    await as(`acc-${T}@demo.lk`);
    await expect(dev({ action: "create", tenantId: T, workstationId: "P01", label: "Nimal's phone" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await as(`own-${T}@demo.lk`);
    await expect(dev({ action: "create", tenantId: T, workstationId: "NOPE", label: "x" })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    const { code, expiresAt } = await dev({ action: "create", tenantId: T, workstationId: "P01", label: "Nimal's phone" });
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(Date.parse(expiresAt!) - Date.now()).toBeGreaterThan(14 * 60_000);
    // The codes themselves are unreadable to everyone, even the owner.
    await expect(getDocs(collection(db, "devicePairings"))).rejects.toMatchObject({ code: "permission-denied" });

    // The phone, signed out, redeems the code (lower case and without the dash works too).
    await signOut(auth);
    const paired = await dev({ action: "pair", code: code!.toLowerCase().replace("-", ""), userAgent: "Mozilla/5.0 (iPhone)" });
    expect(paired).toMatchObject({ tenantId: T, workstationId: "P01", label: "Nimal's phone" });
    await expect(dev({ action: "pair", code })).rejects.toMatchObject({ code: "functions/failed-precondition" });
    await expect(dev({ action: "pair", code: "ABCD-EFGH" })).rejects.toMatchObject({ code: "functions/failed-precondition" });

    // Its own login: a POS terminal of this business, nothing more.
    const phone = (await signInWithEmailAndPassword(auth, paired.email!, paired.password!)).user.uid;
    const me = (await getDoc(doc(db, "tenants", T, "members", phone))).data()!;
    expect(me).toMatchObject({ role: "terminal", tenantId: T, name: "Nimal's phone", device: { workstationId: "P01", pairedBy: owner } });
    await expect(dev({ action: "create", tenantId: T, workstationId: "P01", label: "Another" })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(getDocs(collection(db, "tenants", T, "vouchers"))).rejects.toMatchObject({ code: "permission-denied" });

    // An administrator can rename it but never promote it.
    await as(`own-${T}@demo.lk`);
    await setDoc(doc(db, "tenants", T, "members", phone), { name: "Nimal (bar phone)", ...stamp(owner) }, { merge: true });
    await expect(setDoc(doc(db, "tenants", T, "members", phone), { role: "admin", ...stamp(owner) }, { merge: true })).rejects.toThrow(/PERMISSION_DENIED/);

    // Removing it deletes its login: the phone can't get back in.
    expect(await dev({ action: "revoke", tenantId: T, uid: phone })).toMatchObject({ removed: phone });
    expect((await getDoc(doc(db, "tenants", T, "members", phone))).exists()).toBe(false);
    await signOut(auth);
    await expect(signInWithEmailAndPassword(auth, paired.email!, paired.password!)).rejects.toMatchObject({ code: "auth/user-not-found" });
    // Only device logins can be removed this way.
    await as(`own-${T}@demo.lk`);
    await expect(dev({ action: "revoke", tenantId: T, uid: accountant })).rejects.toMatchObject({ code: "functions/not-found" });
  }, 60_000);
});
