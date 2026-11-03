/**
 * Cloud Functions (2nd gen). Four functions only, to keep deployments and build storage small:
 *
 *  - ledgerApi    callable: every accounting operation (post, approve, reverse, close, verify…)
 *  - auditTrail   Firestore trigger: records every change to tenant data with the actor
 *  - auditTenant  Firestore trigger: records changes to the tenant record (licensed modules)
 *  - auditSealer  hourly: seals new audit events into the hash chain
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentWrittenWithAuthContext } from "firebase-functions/v2/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { type Member, type Tenant, isOn, newId } from "@pos/core";
import { type Actor, type LedgerRequest, LedgerError, PermissionError, UNAUDITED, makeAuditEvent, runLedgerRequest, sealPending } from "@pos/ledger";
import { AdminStore, adminRunner, collectionRef } from "./admin-store.js";

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
});
