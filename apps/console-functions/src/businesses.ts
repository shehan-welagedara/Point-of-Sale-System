/**
 * Business approvals (docs/22 §9): a client's request to open a business arrives with its check-in;
 * staff see who asked and any business with the same name (in that system, in its other requests, or
 * at another client), then approve or decline. The decision is signed with the licence key and goes
 * back at the client's next check-in; only the person who asked can then open that business.
 */
import { type BusinessDecision, type BusinessRequest, type CheckinRequest, businessKey, signDirective } from "@pos/core";
import type { Firestore } from "firebase-admin/firestore";
import { type Actor, ActionError, type Deps, audit, bad, str } from "./common.js";
import type { ConsoleClient } from "./model.js";

export interface Duplicate {
  where: "this-system" | "request" | "other-client";
  name: string;
  tenantId?: string;
  clientId?: string;
  clientName?: string;
  status?: string;
}

export interface ConsoleBusinessRequest {
  id: string;
  clientId: string;
  clientName: string;
  projectId: string;
  requestId: string;
  name: string;
  kind: "business" | "demo";
  modules: string[];
  industry?: string;
  requestedBy: { uid: string; email: string; name?: string };
  requestedAt: string;
  note?: string;
  receivedAt: string;
  lastSeenAt: string;
  status: "pending" | "approved" | "rejected";
  duplicates: Duplicate[];
  decidedBy?: string;
  decidedAt?: string;
  message?: string;
  token?: string;
}

export const requestDocId = (clientId: string, requestId: string) => `${clientId}__${requestId}`;
const REQ_ID = /^[a-z0-9][a-z0-9-]{2,40}$/;

function cleanRequest(r: BusinessRequest): BusinessRequest | null {
  if (!r || typeof r.id !== "string" || !REQ_ID.test(r.id) || typeof r.name !== "string" || !r.requestedBy || typeof r.requestedBy.uid !== "string") return null;
  return {
    id: r.id,
    name: r.name.slice(0, 80),
    kind: r.kind === "demo" ? "demo" : "business",
    modules: (Array.isArray(r.modules) ? r.modules : []).slice(0, 40).map((m) => String(m).slice(0, 40)),
    ...(typeof r.industry === "string" && /^[a-z]{3,20}$/.test(r.industry) ? { industry: r.industry } : {}),
    requestedBy: { uid: r.requestedBy.uid.slice(0, 128), email: String(r.requestedBy.email ?? "").slice(0, 120), ...(r.requestedBy.name ? { name: String(r.requestedBy.name).slice(0, 80) } : {}) },
    requestedAt: String(r.requestedAt ?? "").slice(0, 40),
    ...(r.note ? { note: String(r.note).slice(0, 300) } : {}),
  };
}

async function findDuplicates(db: Firestore, client: ConsoleClient, req: CheckinRequest, r: BusinessRequest): Promise<Duplicate[]> {
  const key = businessKey(r.name);
  const out: Duplicate[] = [];
  for (const t of req.tenants) if (businessKey(t.name) === key) out.push({ where: "this-system", name: t.name, tenantId: t.id, status: t.status ?? "active" });
  for (const o of req.businessRequests ?? []) if (o.id !== r.id && businessKey(o.name) === key) out.push({ where: "request", name: o.name, tenantId: o.id, status: "pending" });
  for (const d of (await db.collection("clients").get()).docs) {
    const c = d.data() as ConsoleClient;
    if (c.id === client.id) continue;
    for (const t of c.health?.tenants ?? []) if (businessKey(t.name) === key) out.push({ where: "other-client", name: t.name, tenantId: t.id, clientId: c.id, clientName: c.name });
  }
  return out.slice(0, 20);
}

/** Stores the requests a check-in reports and returns the decisions already taken on them. */
export async function businessRequestsAtCheckin(db: Firestore, client: ConsoleClient, req: CheckinRequest, now: Date): Promise<{ token: string }[]> {
  const decisions: { token: string }[] = [];
  const reported = (Array.isArray(req.businessRequests) ? req.businessRequests : []).slice(0, 20).map(cleanRequest).filter((r): r is BusinessRequest => Boolean(r));
  req.businessRequests = reported;
  for (const r of reported) {
    const ref = db.collection("businessRequests").doc(requestDocId(client.id, r.id));
    const cur = (await ref.get()).data() as ConsoleBusinessRequest | undefined;
    if (cur && cur.status !== "pending") {
      if (cur.token) decisions.push({ token: cur.token });
      continue;
    }
    const duplicates = await findDuplicates(db, client, req, r);
    const doc: ConsoleBusinessRequest = {
      id: ref.id,
      clientId: client.id,
      clientName: client.name,
      projectId: client.projectId,
      requestId: r.id,
      name: r.name,
      kind: r.kind,
      modules: r.modules,
      requestedBy: r.requestedBy,
      requestedAt: r.requestedAt,
      ...(r.note ? { note: r.note } : {}),
      receivedAt: cur?.receivedAt ?? now.toISOString(),
      lastSeenAt: now.toISOString(),
      status: "pending",
      duplicates,
    };
    await ref.set(doc);
  }
  return decisions;
}

export async function decideBusiness(deps: Deps, actor: Actor, d: Record<string, unknown>): Promise<{ status: string }> {
  const ref = deps.db.collection("businessRequests").doc(str(d.id, 120));
  const cur = (await ref.get()).data() as ConsoleBusinessRequest | undefined;
  if (!cur) throw new ActionError("not-found", "No such request");
  if (cur.status !== "pending") throw new ActionError("failed-precondition", `This request was already ${cur.status}.`);
  const decision = d.decision === "approved" ? "approved" : d.decision === "rejected" ? "rejected" : null;
  if (!decision) throw bad("approve or decline");
  const message = str(d.message, 400);
  if (decision === "rejected" && !message) throw bad("Tell the client why (they see this message)");
  if (decision === "approved" && cur.duplicates.some((x) => x.where === "this-system") && d.confirmDuplicate !== true) {
    throw new ActionError("failed-precondition", "This system already has a business with this name: confirm it is a different business.");
  }
  const payload: BusinessDecision = { v: 1, type: "business", projectId: cur.projectId, requestId: cur.requestId, decision, ownerUid: cur.requestedBy.uid, name: cur.name, ...(message ? { message } : {}), issuedAt: deps.now.toISOString() };
  let key: string;
  try {
    key = deps.privateKey();
  } catch {
    throw new ActionError("failed-precondition", "The licence signing key isn't set up yet: run `pnpm console:setup`.");
  }
  const token = await signDirective(payload, key);
  await ref.set({ status: decision, decidedBy: actor.email, decidedAt: payload.issuedAt, ...(message ? { message } : {}), token }, { merge: true });
  await audit(deps, actor, decision === "approved" ? "approveBusiness" : "declineBusiness", cur.clientId, `${cur.name} (${cur.requestedBy.email})${message ? `: ${message}` : ""}`);
  return { status: decision };
}
