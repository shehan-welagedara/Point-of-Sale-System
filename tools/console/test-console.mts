/**
 * Polymath Console end to end on the emulators (pnpm test:console): staff sign-in and roles, a client
 * system's real check-in code (apps/functions/src/console-link.ts) against the console's check-in
 * function, licence delivery, suspend/restore with signed directives, usage, notices, refusals; since
 * 1.10.0 the two-step business validation (apps/functions/src/business.ts), duplicates and archiving,
 * the release catalogue and update rollouts with the client's maintenance notice, a message to all
 * clients, and privacy (data agreement, export, erasure rules).
 */
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The repository root doesn't depend on the workspace packages, so they are imported by path.
import { DEMO_LICENCE_PUBLIC_KEY, colomboDate, signDirective, suspensionInfo } from "../../packages/core/src/index.ts";
import { handleBusinessApi } from "../../apps/functions/src/business.ts";
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

// ── Two-step business validation: the client's system (step 1, above) and each business (step 2) ──
const ownerCaller = { uid: "o", email: "owner@noura.example", name: "Nuwan Perera" };
const unthrottle = () => pdb.doc("deployment/link").set({ lastRequestCheckinAt: "2000-01-01T00:00:00Z" }, { merge: true });
await pdb.doc("deployment/config").set({ ownerUid: "o", openSignup: false });
check((await pdb.doc("deployment/link").get()).data()?.approvalRequired === true, "after a check-in, the client's system knows new businesses need Polymath Tech's approval (rules read deployment/link)");
let refused = "";
try {
  await handleBusinessApi(pdb, env(), { uid: "mallory", email: "mallory@example.com" }, { action: "submit", id: "mallory-co-ab12c", name: "Mallory Co" });
} catch (e) {
  refused = (e as Error).message;
}
check(/Only this system's owner/.test(refused), "someone who isn't the system's owner can't ask for a business");
let br = await handleBusinessApi(pdb, env(), ownerCaller, { action: "submit", id: "noura-kitchen-dup01", name: "Noura  kitchen", kind: "business", modules: ["pos"] });
check(br.required && br.request?.status === "pending" && br.similar?.[0]?.id === "noura", "the owner opening Noura Kitchen again is told it exists, and the request goes to Polymath Tech at once");
const dupReq = (await cdb.doc("businessRequests/noura-kitchen__noura-kitchen-dup01").get()).data()!;
check(dupReq?.status === "pending" && dupReq.duplicates.some((d: { where: string; tenantId?: string }) => d.where === "this-system" && d.tenantId === "noura") && dupReq.requestedBy.email === "owner@noura.example", "the console receives the request with who asked and the business it duplicates");
check((await api(supportToken, { action: "decideBusiness", id: dupReq.id, decision: "approved" })).error?.status === "PERMISSION_DENIED", "support can't approve businesses");
check((await api(salesToken, { action: "decideBusiness", id: dupReq.id, decision: "approved" })).error?.status === "FAILED_PRECONDITION", "approving a business that already exists needs a confirmation");
check((await api(salesToken, { action: "decideBusiness", id: dupReq.id, decision: "rejected" })).error?.status === "INVALID_ARGUMENT", "declining needs a message for the owner");
await api(salesToken, { action: "decideBusiness", id: dupReq.id, decision: "rejected", message: "You already have Noura Kitchen: open it from your business list." });
await unthrottle();
br = await handleBusinessApi(pdb, env(), ownerCaller, { action: "check", id: "noura-kitchen-dup01" });
check(br.request?.status === "rejected" && /already have/.test(br.request.message ?? ""), "the owner sees the decline with Polymath Tech's message");
const again2 = await handleBusinessApi(pdb, env(), ownerCaller, { action: "check", id: "noura-kitchen-dup01" });
check(!again2.checkin, "asking again within seconds doesn't call the console again");

await unthrottle();
br = await handleBusinessApi(pdb, env(), ownerCaller, { action: "submit", id: "noura-galle-ab12c", name: "Noura Kitchen Galle", kind: "business", modules: ["pos", "tables"] });
const galle = (await cdb.doc("businessRequests/noura-kitchen__noura-galle-ab12c").get()).data()!;
check(galle?.duplicates.length === 0, "a new outlet with its own name has no duplicates");
await api(salesToken, { action: "decideBusiness", id: galle.id, decision: "approved", message: "Welcome, Galle!" });
check((await api(salesToken, { action: "decideBusiness", id: galle.id, decision: "approved" })).error?.status === "FAILED_PRECONDITION", "a request is decided once");
await unthrottle();
br = await handleBusinessApi(pdb, env(), ownerCaller, { action: "check", id: "noura-galle-ab12c" });
check(br.request?.status === "approved" && typeof br.request.decisionToken === "string" && br.request.message === "Welcome, Galle!", "the signed approval reaches the client's system");
await pdb.doc("tenants/noura-galle-ab12c").set({ id: "noura-galle-ab12c", name: "Noura Kitchen Galle", ownerUid: "o", plan: "trial", modules: { pos: true }, status: "active", createdAt: new Date().toISOString() });
await pdb.doc("tenants/noura-galle-ab12c/members/o").set({ uid: "o", role: "owner", tenantId: "noura-galle-ab12c" });
await runCheckin(pdb, env(), "scheduled");
let hg = ((await cdb.doc("clients/noura-kitchen").get()).data()!.health.tenants as { id: string; status?: string; approval?: { requestId: string } }[]).find((t) => t.id === "noura-galle-ab12c");
check(hg?.approval?.requestId === "noura-galle-ab12c" && hg.status === "active", "the console sees the new business, approved");
// Approvals that Polymath Tech didn't sign are ignored.
const { privateKey: otherKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const forged = await signDirective({ v: 1, type: "business", projectId: CLIENT, requestId: "forged-co-ab12c", decision: "approved", ownerUid: "o", name: "Forged", issuedAt: new Date().toISOString() }, otherKey.export({ format: "der", type: "pkcs8" }).toString("base64url"));
await pdb.doc("businessRequests/forged-co-ab12c").set({ id: "forged-co-ab12c", name: "Forged", kind: "business", modules: [], uid: "o", email: "owner@noura.example", status: "pending", requestedAt: new Date().toISOString() });
await applyResponse(pdb, { v: 1, ok: true, serverTime: "", businessDecisions: [{ token: forged }] }, { projectId: CLIENT, publicKey: DEMO_LICENCE_PUBLIC_KEY }, new Date());
check((await pdb.doc("businessRequests/forged-co-ab12c").get()).data()?.status === "pending", "an approval not signed by Polymath Tech is ignored");
await pdb.doc("businessRequests/forged-co-ab12c").delete();
// The owner archives a business opened by mistake: the console sees it.
await pdb.doc("tenants/noura-galle-ab12c").set({ status: "archived" }, { merge: true });
await runCheckin(pdb, env(), "scheduled");
hg = ((await cdb.doc("clients/noura-kitchen").get()).data()!.health.tenants as { id: string; status?: string }[]).find((t) => t.id === "noura-galle-ab12c");
check(hg?.status === "archived", "an archived business shows as archived in the console");
// Approvals off (Polymath Tech's own demo systems): businesses open straight away.
check((await api(salesToken, { action: "setApprovals", clientId: "noura-kitchen", approvals: "off" })).error?.status === "PERMISSION_DENIED", "only owners and admins switch approvals off");
await api(ownerToken, { action: "setApprovals", clientId: "noura-kitchen", approvals: "off" });
await runCheckin(pdb, env(), "scheduled");
br = await handleBusinessApi(pdb, env(), ownerCaller, { action: "submit", id: "noura-train-ab12c", name: "Noura Training", kind: "demo" });
check(!br.required && (await pdb.doc("deployment/link").get()).data()?.approvalRequired === false, "with approvals off, a business opens without waiting");
await api(ownerToken, { action: "setApprovals", clientId: "noura-kitchen", approvals: "required" });
await runCheckin(pdb, env(), "scheduled");

// ── Releases and updates pushed from the console ──
const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
check((await api(supportToken, { action: "syncReleases", changelog })).error?.status === "PERMISSION_DENIED", "support can't change the release catalogue");
const synced = (await api(ownerToken, { action: "syncReleases", changelog })).result as { count: number; latest: string };
const rel = (await cdb.doc("releases/1_9_0").get()).data();
check(synced?.count > 15 && rel?.highlights?.length > 0 && !String(rel.highlights[0]).includes("**"), "the release catalogue loads from the release notes, with what clients get in plain words");
const ro1 = (await api(ownerToken, { action: "createRollout", version: "1.9.0", clientIds: ["noura-kitchen"], mode: "window", message: "Your back office becomes an app on phones." })).result as { id: string };
check(Boolean(ro1?.id), "the owner schedules 1.9.0 for Noura Kitchen in its maintenance window");
check(/already in the rollout/.test((await api(ownerToken, { action: "createRollout", version: "1.9.0", clientIds: ["noura-kitchen"], mode: "now" })).error?.message ?? ""), "a client is in one rollout at a time");
check(/already runs/.test((await api(ownerToken, { action: "createRollout", version: "1.6.0", clientIds: ["noura-kitchen"], mode: "now" })).error?.message ?? ""), "a client isn't sent a version it already has");
await runCheckin(pdb, env(), "scheduled");
let upd = (await tenant()).supplier?.update;
let roDoc = (await cdb.doc(`rollouts/${ro1.id}`).get()).data()!;
check(upd?.version === "1.9.0" && upd.state === "scheduled" && upd.at === roDoc.clients["noura-kitchen"].scheduledFor && Boolean(upd.until) && upd.highlights?.length > 0 && upd.message === "Your back office becomes an app on phones.", "the client's system receives the maintenance notice: version, window, what's new and the message");
check(Date.parse(upd.at) - Date.now() >= 55 * 60_000, "…at least an hour ahead, so screens see it before the update starts");
await api(ownerToken, { action: "cancelRollout", rolloutId: ro1.id, clientId: "noura-kitchen" });
roDoc = (await cdb.doc(`rollouts/${ro1.id}`).get()).data()!;
await runCheckin(pdb, env(), "scheduled");
check(roDoc.status === "cancelled" && !(await tenant()).supplier?.update, "cancelling removes the notice at the next check-in");
const ro2 = (await api(ownerToken, { action: "createRollout", version: "1.9.0", clientIds: ["noura-kitchen"], mode: "now" })).result as { id: string };
roDoc = (await cdb.doc(`rollouts/${ro2.id}`).get()).data()!;
check(roDoc.clients["noura-kitchen"].state === "manual" && /pnpm release:deploy --target noura-kitchen/.test(roDoc.clients["noura-kitchen"].error), "without a GitHub connection, the console shows the command for the release PC");
await runCheckin(pdb, env(), "scheduled");
check((await tenant()).supplier?.update?.version === "1.9.0", "…and the client is told the update is coming");
r = await runCheckin(pdb, { ...env(), appVersion: "1.9.0" }, "scheduled");
roDoc = (await cdb.doc(`rollouts/${ro2.id}`).get()).data()!;
check(roDoc.clients["noura-kitchen"].state === "done" && roDoc.status === "done" && !(await tenant()).supplier?.update, "when the system reports 1.9.0, the rollout is done and the notice disappears");

// ── A message to every client ──
await api(salesToken, { action: "setBroadcast", text: "Support is closed on Poya day, 15 November.", level: "info" });
await runCheckin(pdb, env(), "scheduled");
check((await tenant()).supplier?.notice?.text === "Support is closed on Poya day, 15 November.", "a message to all clients reaches each client's back office");
await api(salesToken, { action: "setBroadcast", text: "" });
await runCheckin(pdb, env(), "scheduled");
check(!(await tenant()).supplier?.notice, "…and goes when it is cleared");

// ── Privacy ──
check(Boolean((await api(salesToken, { action: "savePrivacy", clientId: "noura-kitchen", privacy: { dpaSignedOn: "2026-11-01", dpaVersion: "1.0", contactName: "Nuwan Perera", contactEmail: "owner@noura.example" } })).result?.ok), "sales records the client's data agreement");
check((await api(salesToken, { action: "exportClient", clientId: "noura-kitchen" })).error?.status === "PERMISSION_DENIED", "only owners and admins export a client's data");
const exported = (await api(ownerToken, { action: "exportClient", clientId: "noura-kitchen" })).result as { client: { name: string; licence?: { token: string } }; payments: unknown[]; licences: { token: string }[]; businessRequests: unknown[]; audit: unknown[] };
check(exported?.client.name === "Noura Kitchen" && exported.payments.length >= 1 && exported.licences.length >= 1 && exported.licences.every((l) => l.token === "(withheld)") && exported.client.licence?.token === "(withheld)" && exported.businessRequests.length >= 2 && exported.audit.length > 3, "the export holds everything the console has about the client, without licence keys");
check((await api(ownerToken, { action: "eraseClient", clientId: "lagoon", confirm: "Lagoon Cafe" })).error?.status === "FAILED_PRECONDITION", "a client's data can't be erased while the contract runs");
check((await api(ownerToken, { action: "saveRetention", retention: { usageDays: 10 } })).error?.status === "INVALID_ARGUMENT", "retention can't be set below 30 days");
check(Boolean((await api(ownerToken, { action: "saveRetention", retention: { usageDays: 730, unknownDays: 90 } })).result), "the owner sets how long data is kept");

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

// For the screens: a business waiting for approval and an update scheduled for two clients.
await unthrottle();
await handleBusinessApi(pdb, env(), ownerCaller, { action: "submit", id: "noura-express-ab12c", name: "Noura Express", kind: "business", modules: ["pos", "lankaqr"], note: "Takeaway counter in Nugegoda" });
await api(ownerToken, { action: "createRollout", version: "1.9.0", clientIds: ["trinco-bay", "galle-fort"], mode: "window", message: "Your back office becomes an app on phones." });

console.log(failed ? `\n${failed} check(s) failed` : "\nAll console checks passed");
process.exit(failed ? 1 : 0);
