/**
 * Polymath Console end to end on the emulators (pnpm test:console): staff sign-in and roles, a client
 * system's real check-in code (apps/functions/src/console-link.ts) against the console's check-in
 * function, licence delivery, suspend/restore with signed directives, usage, notices, refusals.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The repository root doesn't depend on the workspace packages, so they are imported by path.
import { DEMO_LICENCE_PUBLIC_KEY, colomboDate, suspensionInfo } from "../../packages/core/src/index.ts";
import { applyResponse, runCheckin } from "../../apps/functions/src/console-link.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/functions/package.json"));
const { initializeApp } = require("firebase-admin/app") as typeof import("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore") as typeof import("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth") as typeof import("firebase-admin/auth");

const CONSOLE = "demo-polymath-console";
const CLIENT = "demo-pos-client";
const FN = `http://127.0.0.1:5101/${CONSOLE}/asia-south1`;
const AUTH = "http://127.0.0.1:9199/identitytoolkit.googleapis.com/v1";
const consoleApp = initializeApp({ projectId: CONSOLE }, "console");
const clientApp = initializeApp({ projectId: CLIENT }, "client");
const cdb = getFirestore(consoleApp);
const pdb = getFirestore(clientApp);
const auth = getAuth(consoleApp);

let failed = 0;
const check = (ok: unknown, msg: string) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failed++;
};

async function signUp(email: string): Promise<{ uid: string; token: () => Promise<string> }> {
  const password = "Correct-Horse-9";
  const r = (await (await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json()) as { localId: string };
  await auth.updateUser(r.localId, { emailVerified: true });
  const token = async () => ((await (await fetch(`${AUTH}/accounts:signInWithPassword?key=fake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) })).json()) as { idToken: string }).idToken;
  return { uid: r.localId, token };
}

async function api(token: string, data: Record<string, unknown>): Promise<{ result?: Record<string, unknown>; error?: { status: string; message: string } }> {
  const r = await fetch(`${FN}/consoleApi`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ data }) });
  return (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } };
}

const identity = (email: string) => async () => ({ "x-test-identity": email });
const env = (email = `${CLIENT}@appspot.gserviceaccount.com`) => ({ consoleUrl: `${FN}/checkin`, projectId: CLIENT, appVersion: "1.7.0", publicKey: DEMO_LICENCE_PUBLIC_KEY, identity: identity(email) });
const tenant = async () => (await pdb.doc("tenants/noura").get()).data()!;

// ── Staff ──
const owner = await signUp("owner@polymath.test");
check((await api(await owner.token(), { action: "claimAccess" })).result?.role === "owner", "the owner's email (OWNER_EMAIL) becomes the console owner");
const ownerToken = await owner.token();
const stranger = await signUp("stranger@example.com");
check((await api(await stranger.token(), { action: "claimAccess" })).error?.status === "PERMISSION_DENIED", "someone not invited is refused");
check((await api(ownerToken, { action: "inviteStaff", email: "sales@polymath.test", role: "sales" })).result?.ok, "owner invites a sales person");
check((await api(ownerToken, { action: "inviteStaff", email: "help@polymath.test", role: "support" })).result?.ok, "owner invites a support person");
const sales = await signUp("sales@polymath.test");
check((await api(await sales.token(), { action: "claimAccess" })).result?.role === "sales", "the invited person joins with the invited role");
const salesToken = await sales.token();
const support = await signUp("help@polymath.test");
await api(await support.token(), { action: "claimAccess" });
const supportToken = await support.token();
check((await api(ownerToken, { action: "publicKey" })).result?.publicKey === DEMO_LICENCE_PUBLIC_KEY, "the console signs with the key in Secret Manager (public half shown in Settings)");

// ── Client system with real data ──
const yesterday = colomboDate(new Date(), -1);
await pdb.doc("tenants/noura").set({ id: "noura", name: "Noura Kitchen", ownerUid: "o", plan: "trial", modules: { pos: true, accounting: true, inventory: true }, status: "active", createdAt: new Date().toISOString() });
await pdb.doc("tenants/noura/settings/business").set({ id: "business", tradingName: "Noura Kitchen" });
await pdb.doc("tenants/noura/deviceStatus/P01").set({ id: "P01", appVersion: "1.6.0", lastSeenAt: new Date().toISOString() });
await pdb.doc("tenants/noura/workstations/P01").set({ id: "P01", active: true });
await pdb.doc("tenants/noura/members/o").set({ uid: "o", role: "owner" });
await pdb.doc("tenants/noura/members/phone").set({ uid: "phone", role: "terminal" });
await pdb.doc("tenants/noura/clientErrors/e1").set({ at: new Date().toISOString(), message: "x", uid: "phone" });
await pdb.doc(`tenants/noura/dailyStats/MAIN_${yesterday}`).set({ propertyId: "MAIN", businessDate: yesterday, checks: 42, covers: 70, netSales: 1_234_500, total: 1_300_000 });

// Not registered yet.
let r = await runCheckin(pdb, env(), "manual");
check(!r.ok && /isn't registered/.test(r.error ?? ""), "an unregistered project's check-in is refused");
check((await cdb.doc(`unknownProjects/${CLIENT}`).get()).data()?.businesses?.[0] === "Noura Kitchen", "…and listed for staff to add as a client");
check((await tenant()).supplier?.lastCheckinOk === false, "the client records that the check-in didn't work (nothing else changes)");

check((await api(supportToken, { action: "saveClient", create: true, client: { id: "noura-kitchen", name: "Noura Kitchen", projectId: CLIENT } })).error?.status === "PERMISSION_DENIED", "support can't add clients");
check((await api(salesToken, { action: "saveClient", create: true, client: { id: "noura-kitchen", name: "Noura Kitchen", legalName: "Noura Kitchen (Pvt) Ltd", projectId: CLIENT, wave: 1 } })).result?.id === "noura-kitchen", "sales adds the client");
check(!(await cdb.doc(`unknownProjects/${CLIENT}`).get()).exists, "…which clears it from the unknown list");

// First check-in with the project's own identity.
r = await runCheckin(pdb, env(), "manual");
check(r.ok, "the client's check-in is accepted (identity of its own project)");
const c1 = (await cdb.doc("clients/noura-kitchen").get()).data()!;
check(c1.health?.appVersion === "1.7.0" && c1.health.tenants[0].devices[0].appVersion === "1.6.0" && c1.health.tenants[0].errors24h === 1, "health recorded: server version, device versions, errors in 24 h");
check(c1.health?.tenants[0].counts.workstations === 1 && c1.health.tenants[0].counts.backOfficeUsers === 1, "counts: workstations and back-office logins (phones excluded)");
const usage = (await cdb.doc(`clients/noura-kitchen/usage/${yesterday}`).get()).data();
check(usage?.checks === 42 && usage.netSales === 1_234_500, "yesterday's figures recorded (shared by default)");
check((await tenant()).supplier?.contact?.name === "Polymath Tech", "the client receives Polymath Tech's contact details");

// Another project pretending to be this one.
const res = await fetch(`${FN}/checkin`, { method: "POST", headers: { "content-type": "application/json", "x-test-identity": "other-project@appspot.gserviceaccount.com" }, body: JSON.stringify({ v: 1, projectId: CLIENT, appVersion: "9", sentAt: "", reason: "manual", tenants: [] }) });
check(res.status === 403, "a check-in from another project's identity is refused");

// A project known only by number: confirmed once by a person.
await api(salesToken, { action: "saveClient", create: true, client: { id: "lagoon", name: "Lagoon Cafe", projectId: "lagoon-cafe-pos" } });
const numbered = await fetch(`${FN}/checkin`, { method: "POST", headers: { "content-type": "application/json", "x-test-identity": "555000111-compute@developer.gserviceaccount.com" }, body: JSON.stringify({ v: 1, projectId: "lagoon-cafe-pos", appVersion: "1.7.0", sentAt: "", reason: "scheduled", tenants: [] }) });
check(numbered.status === 403 && (await cdb.doc("clients/lagoon").get()).data()?.link?.pendingProjectNumber === "555000111", "a new project number waits for confirmation");
check((await api(salesToken, { action: "confirmProject", clientId: "lagoon" })).error?.status === "PERMISSION_DENIED", "sales can't confirm a project (owner/admin only)");
await api(ownerToken, { action: "confirmProject", clientId: "lagoon" });
const again = await fetch(`${FN}/checkin`, { method: "POST", headers: { "content-type": "application/json", "x-test-identity": "555000111-compute@developer.gserviceaccount.com" }, body: JSON.stringify({ v: 1, projectId: "lagoon-cafe-pos", appVersion: "1.7.0", sentAt: "", reason: "scheduled", tenants: [] }) });
check(again.status === 200, "after confirmation the project is answered");
const imposter = await fetch(`${FN}/checkin`, { method: "POST", headers: { "content-type": "application/json", "x-test-identity": "999-compute@developer.gserviceaccount.com" }, body: JSON.stringify({ v: 1, projectId: "lagoon-cafe-pos", appVersion: "1", sentAt: "", reason: "scheduled", tenants: [] }) });
check(imposter.status === 403, "…and a different project number is refused");

// ── Licence delivered automatically ──
check((await api(supportToken, { action: "issueLicence", clientId: "noura-kitchen", edition: "starter", months: 12 })).error?.status === "PERMISSION_DENIED", "support can't issue licences");
const issued = (await api(salesToken, { action: "issueLicence", clientId: "noura-kitchen", edition: "starter", addOns: ["accounting", "inventory", "purchasing"], months: 12, reason: "new client" })).result as { licenceId: string; token: string };
check(/^LIC-\d{8}-[A-Z0-9]{5}$/.test(issued?.licenceId ?? ""), "sales issues a licence from the browser");
r = await runCheckin(pdb, env(), "scheduled");
const t1 = await tenant();
check(r.ok && t1.licence?.licenceId === issued.licenceId && t1.licence.source === "console" && t1.plan === "starter", "the licence reaches the client at the next check-in, verified and applied");
check(t1.modules?.pos === true && t1.modules?.accounting === true, "modules stay on within the new entitlement");
check(r.applied.some((a: string) => a.includes(issued.licenceId)), "…and the client is told what changed");
r = await runCheckin(pdb, env(), "scheduled");
check(r.ok && r.applied.length === 0, "the same licence isn't applied twice");
check((await cdb.doc("clients/noura-kitchen").get()).data()?.health?.tenants[0].licence?.licenceId === issued.licenceId, "the console sees the licence active in the client's system");

// A newer key pasted by hand is not replaced by an older one from the console.
await pdb.doc("tenants/noura").set({ licence: { ...t1.licence, licenceId: "LIC-MANUAL-NEWER", issuedAt: new Date(Date.now() + 86_400_000).toISOString(), source: "manual" } }, { merge: true });
await runCheckin(pdb, env(), "scheduled");
check((await tenant()).licence?.licenceId === "LIC-MANUAL-NEWER", "a newer licence activated by hand is kept");
await pdb.doc("tenants/noura").set({ licence: t1.licence }, { merge: true });

// ── Subscription, payments, notice ──
const soon = colomboDate(new Date(), 9);
await api(salesToken, { action: "saveSubscription", clientId: "noura-kitchen", subscription: { plan: "Starter + books", priceLkr: 60000, cycle: "annual", paidUntil: soon } });
await runCheckin(pdb, env(), "scheduled");
check(/renews on/.test((await tenant()).supplier?.notice?.text ?? ""), "a renewal reminder appears in the client's back office before the paid-until date");
const paid = (await api(salesToken, { action: "recordPayment", clientId: "noura-kitchen", amount: 60000, method: "bank transfer", reference: "BOC 123", paidUntil: colomboDate(new Date(), 374), renewLicence: true })).result as { licenceId: string };
check(Boolean(paid?.licenceId) && paid.licenceId !== issued.licenceId, "recording a payment renews the licence to the new paid-until date");
await runCheckin(pdb, env(), "scheduled");
check((await tenant()).licence?.licenceId === paid.licenceId && !(await tenant()).supplier?.notice, "the renewed licence arrives and the reminder disappears");

// ── Suspend and restore ──
check((await api(salesToken, { action: "suspend", clientId: "noura-kitchen", graceDays: 0 })).error?.status === "PERMISSION_DENIED", "sales can't suspend");
await api(ownerToken, { action: "suspend", clientId: "noura-kitchen", graceDays: 7, message: "Invoice 114 is overdue", reason: "unpaid" });
await runCheckin(pdb, env(), "scheduled");
let s = suspensionInfo((await tenant()).supplier, new Date());
check(s.state === "grace" && s.message === "Invoice 114 is overdue", "suspension: the client sees the message and keeps working during the grace period");
const suspendedToken = (await cdb.doc("clients/noura-kitchen").get()).data()!.directive.token as string;
await api(ownerToken, { action: "suspend", clientId: "noura-kitchen", graceDays: 0, message: "Suspended" });
await runCheckin(pdb, env(), "scheduled");
s = suspensionInfo((await tenant()).supplier, new Date(Date.now() + 1000));
check(s.state === "blocked", "after the grace period the client's licensed modules stop (data kept)");
await api(ownerToken, { action: "restore", clientId: "noura-kitchen" });
r = await runCheckin(pdb, env(), "scheduled");
check(suspensionInfo((await tenant()).supplier, new Date()).state === "none" && r.applied.some((a: string) => a.includes("restored")), "restore brings everything back at the next check-in");
await applyResponse(pdb, { v: 1, ok: true, serverTime: "", directive: { token: suspendedToken } }, { projectId: CLIENT, publicKey: DEMO_LICENCE_PUBLIC_KEY }, new Date());
check(suspensionInfo((await tenant()).supplier, new Date()).state === "none", "an older suspension can't be replayed after a restore");
await applyResponse(pdb, { v: 1, ok: true, serverTime: "", directive: { token: suspendedToken.replace(/.$/, (ch) => (ch === "A" ? "B" : "A")) } }, { projectId: CLIENT, publicKey: DEMO_LICENCE_PUBLIC_KEY }, new Date());
check(suspensionInfo((await tenant()).supplier, new Date()).state === "none", "a tampered status is ignored");

// ── Usage sharing off ──
await pdb.doc("tenants/noura").set({ shareUsage: false }, { merge: true });
await cdb.doc(`clients/noura-kitchen/usage/${yesterday}`).delete();
await runCheckin(pdb, env(), "scheduled");
check(!(await cdb.doc(`clients/noura-kitchen/usage/${yesterday}`).get()).exists && (await cdb.doc("clients/noura-kitchen").get()).data()?.health?.tenants[0].shareUsage === false, "with sharing off, no figures are sent");

// ── Audit ──
const audit = (await cdb.collection("audit").get()).docs.map((d) => d.data().action as string);
check(["claimAccess", "inviteStaff", "createClient", "issueLicence", "saveSubscription", "recordPayment", "suspend", "restore", "confirmProject"].every((a) => audit.includes(a)), "every staff action is in the audit log");

// ── Location and industry; the dashboard's daily figures ──
await api(salesToken, { action: "saveClient", client: { id: "noura-kitchen", name: "Noura Kitchen", legalName: "Noura Kitchen (Pvt) Ltd", projectId: CLIENT, wave: 1, industry: "Restaurant", city: "Colombo", country: "lk", contact: { name: "Nuwan Perera", phone: "+94 77 555 0101", email: "owner@noura.example" } } });
const located = (await cdb.doc("clients/noura-kitchen").get()).data()!;
check(located.industry === "Restaurant" && located.city === "Colombo" && located.country === "LK", "a client's industry, town and country are saved (country as its code)");
await api(salesToken, { action: "saveClient", client: { id: "lagoon", name: "Lagoon Cafe", projectId: "lagoon-cafe-pos", industry: "Spaceport", country: "Sri Lanka" } });
const lagoon = (await cdb.doc("clients/lagoon").get()).data()!;
check(lagoon.industry === "" && lagoon.country === "LK", "an unknown industry or a country that isn't a code isn't stored");
await api(salesToken, { action: "saveClient", client: { id: "lagoon", name: "Lagoon Cafe", projectId: "lagoon-cafe-pos", industry: "Café", city: "Negombo", country: "LK" } });
const today = (await api(supportToken, { action: "recordMetrics" })).result as { date: string; clients: number; mrrLkr: number; paid: number } | undefined;
check(today?.clients === 2 && today.mrrLkr === 5000 && today.paid === 1 && (await cdb.doc(`metrics/${today.date}`).get()).exists, "today's dashboard figures are recorded (clients, monthly revenue, paid)");
check((await api(await stranger.token(), { action: "recordMetrics" })).error?.status === "PERMISSION_DENIED", "…but not for someone outside the staff");

// Leave a realistic picture for the screen test (ui-smoke.mjs): sharing back on, two weeks of figures.
await pdb.doc("tenants/noura").set({ shareUsage: true }, { merge: true });
await runCheckin(pdb, env(), "scheduled");
for (let d = 2; d <= 14; d++) {
  const date = colomboDate(new Date(), -d);
  const checks = 30 + ((d * 7) % 25);
  await cdb.doc(`clients/noura-kitchen/usage/${date}`).set({ date, checks, covers: Math.round(checks * 1.7), netSales: checks * 2_950_00, total: checks * 3_150_00, tenants: {}, reportedAt: new Date().toISOString() });
}
await api(ownerToken, { action: "saveCompany", company: { name: "Polymath Tech", email: "support@polymath.example", phone: "+94 11 234 5678", whatsapp: "+94 77 123 4567", website: "polymath.example" } });

// More clients in different states, a year of payments and a month of daily figures, for the screens.
const DAY_MS = 86_400_000;
const isoAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
const health = (name: string, version: string, hoursAgo: number, errors = 0, devices = 3) => ({
  lastCheckinAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
  appVersion: version,
  reason: "scheduled",
  tenants: [{ id: "main", name, plan: "professional", modules: ["pos", "tables", "inventory"], devices: Array.from({ length: devices }, (_, i) => ({ id: `T0${i + 1}`, appVersion: version, lastSeenAt: isoAgo(0) })), errors24h: errors, counts: { workstations: devices, employees: 9, backOfficeUsers: 2 }, shareUsage: true }],
});
const demo = [
  { id: "galle-fort", name: "Galle Fort Bistro", industry: "Restaurant", city: "Galle", country: "LK", created: 300, plan: ["Enterprise", 240000, "annual"], paid: 200, health: health("Galle Fort Bistro", "1.7.0", 5), edition: "enterprise", contact: "Dilini Fernando" },
  { id: "kandy-mist", name: "Kandy Mist Café", industry: "Café", city: "Kandy", country: "LK", created: 240, plan: ["Premium", 15000, "monthly"], paid: 18, health: health("Kandy Mist Café", "1.7.0", 3, 0, 2), edition: "professional", contact: "Ravi Senanayake" },
  { id: "trinco-bay", name: "Trinco Bay Resort", industry: "Resort", city: "Trincomalee", country: "LK", created: 180, plan: ["Enterprise", 360000, "annual"], paid: 300, health: health("Trinco Bay Resort", "1.6.0", 7, 0, 5), edition: "enterprise", contact: "Mohamed Rizwan" },
  { id: "male-harbour", name: "Malé Harbour Grill", industry: "Restaurant", city: "Malé", country: "MV", created: 120, plan: ["Premium", 180000, "annual"], paid: 270, health: health("Malé Harbour Grill", "1.7.0", 9), edition: "professional", contact: "Aishath Shifa" },
  { id: "ella-bakehouse", name: "Ella Bakehouse", industry: "Bakery", city: "Ella", country: "LK", created: 90, plan: ["Standard", 36000, "quarterly"], paid: -5, health: health("Ella Bakehouse", "1.7.0", 80, 2, 1), edition: "starter", contact: "Kasun Jayasuriya" },
  { id: "negombo-beach", name: "Negombo Beach Bar", industry: "Bar & pub", city: "Negombo", country: "LK", created: 12, plan: ["Standard", 9500, "monthly"], paid: 5, health: null, edition: null, contact: "Chamari Silva" },
] as const;
let n = 1;
for (const d of demo) {
  n++;
  await api(ownerToken, { action: "saveClient", create: true, client: { id: d.id, name: d.name, industry: d.industry, city: d.city, country: d.country, projectId: `${d.id}-pos`, wave: n % 2 ? 1 : 2, contact: { name: d.contact, phone: `+94 77 555 01${String(n).padStart(2, "0")}` } } });
  await api(ownerToken, { action: "saveSubscription", clientId: d.id, subscription: { plan: d.plan[0], priceLkr: d.plan[1], cycle: d.plan[2], startedOn: colomboDate(new Date(), -d.created), paidUntil: colomboDate(new Date(), d.paid) } });
  if (d.edition) await api(ownerToken, { action: "issueLicence", clientId: d.id, edition: d.edition, expiresOn: colomboDate(new Date(), d.paid > 0 ? 365 : 20), reason: "new client" });
  await cdb.doc(`clients/${d.id}`).set({ createdAt: isoAgo(d.created), ...(d.health ? { health: d.health } : {}) }, { merge: true });
}
await cdb.doc("clients/noura-kitchen").set({ createdAt: isoAgo(360) }, { merge: true });
await cdb.doc("clients/lagoon").set({ createdAt: isoAgo(45) }, { merge: true });
// A year of payments (older ones written directly; the latest through the console, so they are in the audit log).
const pay = (clientId: string, daysAgo: number, amount: number, paidUntil: number) =>
  cdb.collection(`clients/${clientId}/payments`).add({ date: colomboDate(new Date(), -daysAgo), amount, method: "bank transfer", reference: `INV-${1000 + daysAgo}`, paidUntil: colomboDate(new Date(), paidUntil), recordedBy: "sales@polymath.test", at: isoAgo(daysAgo) });
for (let m = 1; m <= 8; m++) await pay("kandy-mist", 30 * m + 2, 15000, 18 - 30 * m);
await pay("galle-fort", 165, 240000, 200);
await pay("trinco-bay", 65, 360000, 300);
await pay("male-harbour", 95, 180000, 270);
await pay("ella-bakehouse", 98, 36000, -5);
await pay("noura-kitchen", 330, 60000, 30);
await api(salesToken, { action: "recordPayment", clientId: "kandy-mist", amount: 15000, method: "card", reference: "VISA 4471", date: colomboDate(new Date(), -1), paidUntil: colomboDate(new Date(), 18), renewLicence: false });
await api(salesToken, { action: "recordPayment", clientId: "negombo-beach", amount: 9500, method: "cash", reference: "RCPT 0042", date: colomboDate(new Date(), 0), paidUntil: colomboDate(new Date(), 5), renewLicence: false });
// A month of daily figures, as the server's housekeeping writes them, with today's from the console itself.
for (let d = 30; d >= 1; d--) {
  const date = colomboDate(new Date(), -d);
  const clients = 6 + (d < 12 ? 2 : d < 20 ? 1 : 0);
  const reporting = clients - 2 - (d % 9 === 0 ? 1 : 0);
  const healthy = reporting - 1 - (d % 7 === 0 ? 1 : 0);
  await cdb.doc(`metrics/${date}`).set({ date, at: isoAgo(d), clients, active: clients - 1, suspended: 1, reporting, healthy, attention: reporting - healthy, offline: 1, noCheckin: 1, licencesValid: clients - 2, paid: clients - 3, due: 1, overdue: 1, mrrLkr: 80000 + (30 - d) * 900, versions: { "1_7_0": reporting - 1, "1_6_0": 1 } });
}
await api(ownerToken, { action: "recordMetrics" });
for (const id of ["galle-fort", "kandy-mist", "trinco-bay"]) {
  for (let d = 1; d <= 28; d++) {
    const date = colomboDate(new Date(), -d);
    const checks = (id === "trinco-bay" ? 60 : id === "galle-fort" ? 85 : 40) + ((d * 11) % 30);
    await cdb.doc(`clients/${id}/usage/${date}`).set({ date, checks, covers: Math.round(checks * 1.8), netSales: checks * 3_400_00, total: checks * 3_650_00, tenants: {}, reportedAt: isoAgo(d) });
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nAll console checks passed");
process.exit(failed ? 1 : 0);
