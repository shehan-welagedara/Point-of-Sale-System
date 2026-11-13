/**
 * Opening a business on a system linked to the Polymath Console (docs/22 §9, two-step validation):
 *
 *  1. The client: the console only answers a project it has registered and whose identity it has
 *     confirmed (check-in, console-link.ts).
 *  2. The business: the owner's request goes to Polymath Tech at once (a check-in); staff check who is
 *     asking and whether the business already exists, then approve or decline. The signed decision
 *     comes back with the next check-in (the app asks every few seconds while the owner waits).
 *
 * The security rules then let only the person who asked open that business, under the id they asked
 * for. Systems that aren't linked (no CONSOLE_URL), and systems the console has set to "approvals
 * off", open businesses straight away as before.
 */
import { businessKey } from "@pos/core";
import type { Firestore } from "firebase-admin/firestore";
import { type CheckinOutcome, type LinkEnv, runCheckin } from "./console-link.js";

export interface BusinessApiRequest {
  action: "submit" | "check" | "cancel";
  id?: string;
  name?: string;
  kind?: "business" | "demo";
  /** For a demo: which sample business to load. */
  sample?: string;
  modules?: string[];
  note?: string;
}

/** businessRequests/{id}: readable by the person who asked; written only here and by the check-in. */
export interface StoredBusinessRequest {
  id: string;
  name: string;
  kind: "business" | "demo";
  sample?: string;
  modules: string[];
  uid: string;
  email: string;
  userName?: string;
  note?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedAt: string;
  decidedAt?: string;
  message?: string;
  decisionToken?: string;
}

export interface BusinessApiResult {
  /** false: this system opens businesses without approval (go ahead). */
  required: boolean;
  request?: StoredBusinessRequest;
  /** Businesses this person already has with the same name (to warn about duplicates). */
  similar?: { id: string; name: string; status: string }[];
  checkin?: { ok: boolean; error?: string };
}

export class BusinessApiError extends Error {
  constructor(
    public code: "invalid-argument" | "permission-denied" | "not-found" | "failed-precondition" | "already-exists",
    message: string,
  ) {
    super(message);
  }
}

const ID = /^[a-z0-9][a-z0-9-]{2,40}$/;
/** A check-in runs at most this often for requests (the app polls while the owner waits). */
const CHECKIN_GAP_MS = 15_000;

interface Caller {
  uid: string;
  email: string;
  name?: string;
}

/** Same people as the rules' mayCreateBusiness(): platform admins, the deployment's owner and creators, owners/admins of a business here, or anyone for the very first business. */
export async function mayRequestBusiness(db: Firestore, uid: string): Promise<boolean> {
  if ((await db.doc(`platformAdmins/${uid}`).get()).exists) return true;
  const dep = (await db.doc("deployment/config").get()).data() as { ownerUid?: string; openSignup?: boolean; creators?: string[] } | undefined;
  if (!dep) return true;
  if (dep.openSignup === true || dep.ownerUid === uid || (dep.creators ?? []).includes(uid)) return true;
  const mine = await db.collectionGroup("members").where("uid", "==", uid).limit(20).get();
  return mine.docs.some((d) => ["owner", "admin"].includes(String(d.data().role)));
}

/** Whether new businesses need approval here: linked to a console that hasn't switched approvals off. */
export async function approvalRequired(db: Firestore, env: Pick<LinkEnv, "consoleUrl">): Promise<boolean> {
  if (!env.consoleUrl) return false;
  const link = (await db.doc("deployment/link").get()).data() as { approvalRequired?: boolean } | undefined;
  return link?.approvalRequired !== false;
}

async function similarBusinesses(db: Firestore, uid: string, name: string): Promise<{ id: string; name: string; status: string }[]> {
  const key = businessKey(name);
  const out: { id: string; name: string; status: string }[] = [];
  for (const m of (await db.collectionGroup("members").where("uid", "==", uid).limit(20).get()).docs) {
    const tenantId = String(m.data().tenantId ?? m.ref.parent.parent?.id ?? "");
    if (!tenantId) continue;
    const t = (await db.doc(`tenants/${tenantId}`).get()).data() as { name?: string; status?: string } | undefined;
    if (t?.name && businessKey(t.name) === key) out.push({ id: tenantId, name: t.name, status: t.status ?? "active" });
  }
  return out;
}

/** Sends pending requests to the console now, unless a check-in ran in the last few seconds. */
async function sendNow(db: Firestore, env: LinkEnv, now: Date): Promise<CheckinOutcome | null> {
  const ref = db.doc("deployment/link");
  const last = (await ref.get()).data()?.lastRequestCheckinAt as string | undefined;
  if (last && now.getTime() - Date.parse(last) < CHECKIN_GAP_MS) return null;
  await ref.set({ lastRequestCheckinAt: now.toISOString() }, { merge: true });
  return runCheckin(db, env, "manual", now);
}

export async function handleBusinessApi(db: Firestore, env: LinkEnv, caller: Caller | null, data: BusinessApiRequest, now = new Date()): Promise<BusinessApiResult> {
  if (!caller) throw new BusinessApiError("permission-denied", "sign in first");
  const action = data?.action;
  if (!["submit", "check", "cancel"].includes(String(action))) throw new BusinessApiError("invalid-argument", "unknown action");
  const required = await approvalRequired(db, env);

  if (action === "submit") {
    const name = typeof data.name === "string" ? data.name.trim().slice(0, 80) : "";
    const id = typeof data.id === "string" ? data.id : "";
    if (!name) throw new BusinessApiError("invalid-argument", "Enter the business name");
    if (!ID.test(id)) throw new BusinessApiError("invalid-argument", "bad business id");
    const similar = await similarBusinesses(db, caller.uid, name);
    if (!required) return { required: false, similar };
    if (!(await mayRequestBusiness(db, caller.uid))) throw new BusinessApiError("permission-denied", "Only this system's owner can add businesses here. Ask them to invite you (Back-office logins), then use “I was invited to a business”.");
    if ((await db.doc(`tenants/${id}`).get()).exists) throw new BusinessApiError("already-exists", "A business with this id already exists");
    const ref = db.doc(`businessRequests/${id}`);
    const existing = (await ref.get()).data() as StoredBusinessRequest | undefined;
    if (existing && existing.uid !== caller.uid) throw new BusinessApiError("already-exists", "This request belongs to someone else");
    if (!existing || existing.status === "cancelled") {
      const open = await db.collection("businessRequests").where("uid", "==", caller.uid).where("status", "==", "pending").get();
      if (open.size >= 3) throw new BusinessApiError("failed-precondition", "You already have 3 requests waiting for Polymath Tech. Wait for an answer, or cancel one.");
      const modules = (Array.isArray(data.modules) ? data.modules : []).slice(0, 40).map((m) => String(m).slice(0, 40));
      const req: StoredBusinessRequest = {
        id,
        name,
        kind: data.kind === "demo" ? "demo" : "business",
        ...(data.kind === "demo" && typeof data.sample === "string" && /^[a-z-]{3,30}$/.test(data.sample) ? { sample: data.sample } : {}),
        modules,
        uid: caller.uid,
        email: caller.email,
        ...(caller.name ? { userName: caller.name.slice(0, 80) } : {}),
        ...(typeof data.note === "string" && data.note.trim() ? { note: data.note.trim().slice(0, 300) } : {}),
        status: "pending",
        requestedAt: now.toISOString(),
      };
      await ref.set(req);
    }
    // From the first request on, the rules ask for approval even before the console has answered.
    await db.doc("deployment/link").set({ approvalRequired: true }, { merge: true });
    const outcome = await sendNow(db, env, now);
    return { required: true, request: (await ref.get()).data() as StoredBusinessRequest, similar, ...(outcome ? { checkin: { ok: outcome.ok, ...(outcome.error ? { error: outcome.error } : {}) } } : {}) };
  }

  const id = typeof data.id === "string" ? data.id : "";
  if (!ID.test(id)) throw new BusinessApiError("invalid-argument", "bad request id");
  const ref = db.doc(`businessRequests/${id}`);
  const current = (await ref.get()).data() as StoredBusinessRequest | undefined;
  if (!current || current.uid !== caller.uid) throw new BusinessApiError("not-found", "No such request");

  if (action === "cancel") {
    if (current.status === "pending") await ref.set({ status: "cancelled", decidedAt: now.toISOString() }, { merge: true });
    return { required, request: (await ref.get()).data() as StoredBusinessRequest };
  }

  // check: ask the console again while the owner waits.
  const outcome = current.status === "pending" && required ? await sendNow(db, env, now) : null;
  return { required, request: (await ref.get()).data() as StoredBusinessRequest, ...(outcome ? { checkin: { ok: outcome.ok, ...(outcome.error ? { error: outcome.error } : {}) } } : {}) };
}
