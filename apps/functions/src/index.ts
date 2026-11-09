/**
 * Cloud Functions (2nd gen). Five functions only, to keep deployments and build storage small:
 *
 *  - ledgerApi    callable: every accounting operation (post, approve, reverse, close, verify…)
 *  - auditTrail   Firestore trigger: records every change to tenant data with the actor
 *  - auditTenant  Firestore trigger: records changes to the tenant record (licensed modules)
 *  - auditSealer  hourly: seals new audit events into the hash chain
 *  - licenceApi   callable: verifies a vendor licence key and applies the entitlement
 *  - posAuth      callable: checks employee PINs and cards (hashes are unreadable to clients)
 *  - deviceApi    callable: connects phones and tablets with one-time codes, and removes them
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { type Member, type StaffAuthRequest, type Tenant, DEMO_LICENCE_PUBLIC_KEY, LicenceError, TRIAL_DAYS, builtInEntitlements, clampModules, isOn, licenceStatus, newId, runStaffAuth, verifyLicence } from "@pos/core";
import { type Actor, type LedgerRequest, LedgerError, PermissionError, UNAUDITED, makeAuditEvent, runLedgerRequest, sealPending } from "@pos/ledger";
import { AdminStore, adminRunner, collectionRef } from "./admin-store.js";
import { type DeviceRequest, handleDeviceRequest, prunePairings } from "./devices.js";

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

// One small instance at most per function; nothing kept warm (no idle cost).
setGlobalOptions({ region: process.env.LOCATION ?? "asia-south1", maxInstances: 3, memory: "256MiB" });

async function actorFor(tenantId: string, uid: string, name: string): Promise<{ actor: Actor; tenant: Tenant }> {
  const [tenantSnap, memberSnap] = await Promise.all([db.collection("tenants").doc(tenantId).get(), db.collection("tenants").doc(tenantId).collection("members").doc(uid).get()]);
  if (!tenantSnap.exists) throw new HttpsError("not-found", "business not found");
  if (!memberSnap.exists) throw new HttpsError("permission-denied", "you are not a member of this business");
  const member = memberSnap.data() as Member;
  return { actor: { uid, name: member.name || name, role: member.role }, tenant: tenantSnap.data() as Tenant };
}

export const ledgerApi = onCall<{ tenantId: string } & LedgerRequest>(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in first");
  const { tenantId, ...req } = request.data;
  if (!tenantId || !req.action) throw new HttpsError("invalid-argument", "tenantId and action are required");
  const { actor, tenant } = await actorFor(tenantId, request.auth.uid, String(request.auth.token.email ?? ""));
  if (!entitled(tenant, "accounting") && req.action !== "verify" && req.action !== "seal") {
    if (req.action === "postPosDay") return null;
    throw new HttpsError("failed-precondition", "the Accounting module is not in this business's licence");
  }
  if (!isOn(tenant.modules, "accounting") && req.action !== "postPosDay" && req.action !== "verify" && req.action !== "seal") {
    throw new HttpsError("failed-precondition", "the Accounting module is not enabled for this business");
  }
  if (req.action === "postPosDay" && !isOn(tenant.modules, "accounting")) return null;
  try {
    const store = new AdminStore(db, tenantId);
    const sealDelayMs = process.env.SEAL_DELAY_MS ? Number(process.env.SEAL_DELAY_MS) : undefined;
    return await runLedgerRequest({ runner: adminRunner(db, tenantId), store, now: () => new Date(), ...(sealDelayMs !== undefined ? { sealDelayMs } : {}) }, actor, req as LedgerRequest);
  } catch (e) {
    if (e instanceof PermissionError) throw new HttpsError("permission-denied", e.message);
    if (e instanceof LedgerError) throw new HttpsError("failed-precondition", e.message);
    throw e;
  }
});

/** The licence (or built-in trial/demo) allows the module and has not lapsed. */
function entitled(t: Tenant, module: "accounting"): boolean {
  const ent = t.entitlements ?? builtInEntitlements(t.plan);
  if (!ent.modules.includes(module)) return false;
  if (t.licence) return licenceStatus(t.licence, new Date()).usable;
  if (t.plan === "trial" && t.trialEndsAt) return Date.now() <= Date.parse(t.trialEndsAt);
  // A demo business in a client deployment is a 30-day training copy (see the web app's licenceInfo).
  if (t.plan === "demo" && LICENCE_PUBLIC_KEY !== DEMO_LICENCE_PUBLIC_KEY) return Date.now() <= Date.parse(t.createdAt) + TRIAL_DAYS * 86_400_000;
  return true;
}

const LICENCE_PUBLIC_KEY = process.env.LICENCE_PUBLIC_KEY || DEMO_LICENCE_PUBLIC_KEY;

/**
 * Licence activation. The signature is checked here with the vendor's public key, and only this
 * function may write the licence, edition and entitlement (the security rules refuse clients).
 */
export const licenceApi = onCall<{ tenantId: string; action: "activate"; token: string }>(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in first");
  const { tenantId, action, token } = request.data;
  if (!tenantId || action !== "activate" || !token) throw new HttpsError("invalid-argument", "tenantId and token are required");
  const { actor, tenant } = await actorFor(tenantId, request.auth.uid, String(request.auth.token.email ?? ""));
  if (actor.role !== "owner" && actor.role !== "admin") throw new HttpsError("permission-denied", "only the owner or an administrator can activate a licence");
  const projectId = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT ?? "";
  try {
    const { payload } = await verifyLicence(token, LICENCE_PUBLIC_KEY, { projectId, tenantId }, new Date());
    const licence = { token: token.trim(), licenceId: payload.licenceId, licensee: payload.licensee.name, edition: payload.edition, addOns: payload.addOns, billing: payload.billing, validFrom: payload.validFrom, expiresAt: payload.expiresAt, graceDays: payload.graceDays, activatedAt: new Date().toISOString(), activatedBy: actor.uid, demoKey: LICENCE_PUBLIC_KEY === DEMO_LICENCE_PUBLIC_KEY };
    await db.collection("tenants").doc(tenantId).set({ plan: payload.edition, entitlements: payload.entitlements, licence, modules: clampModules(tenant.modules, payload.entitlements) }, { merge: true });
    return { edition: payload.edition, expiresAt: payload.expiresAt };
  } catch (e) {
    if (e instanceof LicenceError) throw new HttpsError("failed-precondition", e.message);
    throw e;
  }
});

/**
 * Employee PIN and card checks for sign-in and manager approvals. Only POS devices and managers
 * may ask; wrong PINs count towards the employee's lockout, so PINs can't be guessed.
 */
export const posAuth = onCall<{ tenantId: string } & StaffAuthRequest>({ maxInstances: 10 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in first");
  const { tenantId, ...req } = request.data;
  if (!tenantId || !req.action) throw new HttpsError("invalid-argument", "tenantId and action are required");
  const { actor } = await actorFor(tenantId, request.auth.uid, String(request.auth.token.email ?? ""));
  const allowed = req.action === "migrate" ? ["owner", "admin"] : ["owner", "admin", "manager", "terminal"];
  if (!allowed.includes(actor.role)) throw new HttpsError("permission-denied", "this login can't check employee PINs");
  if (req.action === "verify" && (typeof req.staffId !== "string" || typeof req.pin !== "string" || !/^\d{4,8}$/.test(req.pin) || !["signIn", "approve"].includes(req.purpose))) {
    throw new HttpsError("invalid-argument", "staffId, a 4–8 digit PIN and the purpose are required");
  }
  if (req.action === "identifyCard" && (typeof req.card !== "string" || req.card.length > 64)) throw new HttpsError("invalid-argument", "card is required");
  if (!["verify", "identifyCard", "migrate"].includes(req.action)) throw new HttpsError("invalid-argument", "unknown action");
  return runStaffAuth(new AdminStore(db, tenantId), req as StaffAuthRequest, new Date());
});

/** Phones and tablets: one-time pairing codes instead of shared passwords (see devices.ts). */
export const deviceApi = onCall<DeviceRequest>({ maxInstances: 5 }, async (request) => handleDeviceRequest(db, request.auth?.uid, request.data));

function actorType(authType: string): "user" | "service" | "system" | "unknown" {
  if (authType === "app_user") return "user";
  if (authType === "service_account" || authType === "api_key") return "service";
  if (authType === "system") return "system";
  return "unknown";
}

/**
 * Who made a change: Firebase's verified auth context when it names a user; otherwise the audit
 * stamp the client wrote, but only if this very write changed it (never a stale earlier stamp).
 */
function resolveActor(authType: string, authId: string | undefined, before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  if (authType === "app_user" && authId) return { actorType: "user" as const, actorId: authId, actorSource: "auth" as const };
  if (after?.updatedBy && after.updatedAt && after.updatedAt !== before?.updatedAt) {
    return { actorType: "user" as const, actorId: String(after.updatedBy), actorSource: "stamp" as const };
  }
  return { actorType: actorType(authType), ...(authId ? { actorId: authId } : {}) };
}

export const auditTrail = onDocumentWrittenWithAuthContext("tenants/{tenantId}/{collection}/{docId}", async (event) => {
  const { tenantId, collection, docId } = event.params;
  if (UNAUDITED.has(collection)) return;
  const before = event.data?.before.exists ? (event.data.before.data() as Record<string, unknown>) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as Record<string, unknown>) : null;
  const e = await makeAuditEvent({
    id: newId(Date.parse(event.time)),
    at: event.time,
    ...resolveActor(event.authType, event.authId, before, after),
    collection,
    docId,
    before,
    after,
  });
  if (e) await collectionRef(db, tenantId, "auditEvents").doc(e.id).set(e);
});

export const auditTenant = onDocumentWrittenWithAuthContext("tenants/{tenantId}", async (event) => {
  const before = event.data?.before.exists ? (event.data.before.data() as Record<string, unknown>) : null;
  const after = event.data?.after.exists ? (event.data.after.data() as Record<string, unknown>) : null;
  const e = await makeAuditEvent({ id: newId(Date.parse(event.time)), at: event.time, ...resolveActor(event.authType, event.authId, before, after), collection: "tenant", docId: event.params.tenantId, before, after });
  if (e) await collectionRef(db, event.params.tenantId, "auditEvents").doc(e.id).set(e);
});

export const auditSealer = onSchedule({ schedule: "every 60 minutes", timeZone: "Asia/Colombo" }, async () => {
  const tenants = await db.collection("tenants").select().get();
  for (const t of tenants.docs) {
    try {
      await sealPending(new AdminStore(db, t.id), new Date());
    } catch (e) {
      console.error(`sealing ${t.id} failed`, e);
    }
  }
  // Housekeeping on the same schedule: used and expired device pairing codes.
  await prunePairings(db, new Date()).catch((e) => console.error("pruning pairing codes failed", e));
});
