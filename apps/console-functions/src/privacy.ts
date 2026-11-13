/**
 * Privacy in the console (docs/24-privacy-and-data-protection.md): the console holds business data
 * about clients, never their guests' or staff's personal data (check-ins carry counts and totals).
 * Here: each client's data agreement, a full export of what the console holds about a client (their
 * right of access), erasure after the contract ends (financial records kept as the law requires), and
 * the retention periods applied every morning.
 */
import type { Firestore } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { type Actor, ActionError, DATE, type Deps, audit, bad, getClient, str } from "./common.js";
import type { ClientPrivacy } from "./model.js";

export interface RetentionSettings {
  /** Daily figures (usage) kept this many days. */
  usageDays: number;
  /** Unregistered projects' check-ins. */
  unknownDays: number;
  /** Decided business requests. */
  requestDays: number;
  /** GitHub deployment records. */
  deploymentDays: number;
}

export const DEFAULT_RETENTION: RetentionSettings = { usageDays: 730, unknownDays: 90, requestDays: 730, deploymentDays: 730 };

export async function retention(db: Firestore): Promise<RetentionSettings> {
  const r = (await db.doc("config/privacy").get()).data() as Partial<RetentionSettings> | undefined;
  return { ...DEFAULT_RETENTION, ...(r ?? {}) };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function savePrivacy(deps: Deps, actor: Actor, d: Record<string, unknown>) {
  const { ref, c } = await getClient(deps, d.clientId);
  const p = (d.privacy ?? {}) as Record<string, unknown>;
  const privacy: ClientPrivacy = {};
  const signed = str(p.dpaSignedOn, 10);
  if (signed && !DATE.test(signed)) throw bad("the signing date");
  if (signed) privacy.dpaSignedOn = signed;
  if (str(p.dpaVersion, 20)) privacy.dpaVersion = str(p.dpaVersion, 20);
  if (str(p.contactName, 80)) privacy.contactName = str(p.contactName, 80);
  const email = str(p.contactEmail, 120);
  if (email && !EMAIL.test(email)) throw bad("the data protection contact's email");
  if (email) privacy.contactEmail = email;
  if (str(p.notes, 1000)) privacy.notes = str(p.notes, 1000);
  await ref.set({ privacy, updatedAt: deps.now.toISOString() }, { merge: true });
  await audit(deps, actor, "savePrivacy", c.id, privacy.dpaSignedOn ? `agreement ${privacy.dpaVersion ?? ""} signed ${privacy.dpaSignedOn}` : "privacy details");
  return { ok: true };
}

export async function saveRetention(deps: Deps, actor: Actor, d: Record<string, unknown>) {
  const r = (d.retention ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_RETENTION };
  for (const k of Object.keys(DEFAULT_RETENTION) as (keyof RetentionSettings)[]) {
    if (r[k] === undefined) continue;
    const n = Number(r[k]);
    if (!Number.isInteger(n) || n < 30 || n > 3650) throw bad(`${k}: 30–3650 days`);
    out[k] = n;
  }
  await deps.db.doc("config/privacy").set(out);
  await audit(deps, actor, "saveRetention", null, Object.entries(out).map(([k, v]) => `${k} ${v}`).join(", "));
  return out;
}

/** Everything the console holds about one client, for the client (right of access) or an audit. */
export async function exportClient(deps: Deps, actor: Actor, d: Record<string, unknown>) {
  const { ref, c } = await getClient(deps, d.clientId);
  const docs = async (q: FirebaseFirestore.Query) => (await q.get()).docs.map((x) => ({ id: x.id, ...x.data() }) as { id: string } & Record<string, unknown>);
  const { licence, directive, ...client } = c;
  const out = {
    exportedAt: deps.now.toISOString(),
    exportedBy: actor.email,
    note: "Everything the Polymath Console holds about this client. Licence keys and signed status tokens are shown by id only.",
    client: { ...client, ...(licence ? { licence: { ...licence, token: "(withheld)" } } : {}), ...(directive ? { directive: { state: directive.state, issuedAt: directive.issuedAt } } : {}) },
    payments: await docs(ref.collection("payments")),
    usage: await docs(ref.collection("usage")),
    licences: (await docs(deps.db.collection("licences").where("clientId", "==", c.id))).map((l) => ({ ...l, token: "(withheld)" })),
    businessRequests: (await docs(deps.db.collection("businessRequests").where("clientId", "==", c.id))).map((b) => ({ ...b, token: b.token ? "(withheld)" : undefined })),
    rollouts: (await docs(deps.db.collection("rollouts").where("clientIds", "array-contains", c.id))).map((r) => ({ id: r.id, version: (r as { version?: string }).version, client: (r as { clients?: Record<string, unknown> }).clients?.[c.id] })),
    audit: await docs(deps.db.collection("audit").where("clientId", "==", c.id)),
  };
  await audit(deps, actor, "exportClient", c.id, `export of ${out.usage.length} daily figures, ${out.payments.length} payments, ${out.audit.length} audit entries`);
  return out;
}

/**
 * After the contract ends: removes the client's contact details, notes, health and daily figures,
 * and its business requests. Payments, licences and the audit log stay (financial and legal records).
 */
export async function eraseClient(deps: Deps, actor: Actor, d: Record<string, unknown>) {
  const { ref, c } = await getClient(deps, d.clientId);
  if (c.status !== "cancelled") throw new ActionError("failed-precondition", "Cancel the client first (Clients → the client → Status): data is erased only after the contract ends.");
  if (str(d.confirm, 120) !== c.name) throw bad(`Type the client's name (${c.name}) to confirm`);
  let n = 0;
  for (const u of (await ref.collection("usage").get()).docs) {
    await u.ref.delete();
    n++;
  }
  for (const b of (await deps.db.collection("businessRequests").where("clientId", "==", c.id).get()).docs) await b.ref.delete();
  await deps.db.collection("unknownProjects").doc(c.projectId).delete();
  await ref.set(
    {
      contact: FieldValue.delete(),
      address: FieldValue.delete(),
      notes: FieldValue.delete(),
      health: FieldValue.delete(),
      link: FieldValue.delete(),
      privacy: FieldValue.delete(),
      notice: FieldValue.delete(),
      city: FieldValue.delete(),
      erasedAt: deps.now.toISOString(),
      updatedAt: deps.now.toISOString(),
    },
    { merge: true },
  );
  await audit(deps, actor, "eraseClient", c.id, `erased contact details, health and ${n} daily figures; payments and licences kept`);
  return { ok: true, usageDeleted: n };
}

/** Applies the retention periods (every morning). */
export async function applyRetention(db: Firestore, now: Date): Promise<Record<string, number>> {
  const r = await retention(db);
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const day = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const removed: Record<string, number> = { usage: 0, unknownProjects: 0, businessRequests: 0, deployments: 0 };
  for (const d of (await db.collectionGroup("usage").where("date", "<", day(before(r.usageDays))).limit(500).get()).docs) {
    await d.ref.delete();
    removed.usage!++;
  }
  for (const d of (await db.collection("unknownProjects").where("lastAt", "<", before(r.unknownDays).toISOString()).limit(500).get()).docs) {
    await d.ref.delete();
    removed.unknownProjects!++;
  }
  for (const d of (await db.collection("businessRequests").where("decidedAt", "<", before(r.requestDays).toISOString()).limit(500).get()).docs) {
    await d.ref.delete();
    removed.businessRequests!++;
  }
  for (const d of (await db.collection("deployments").where("at", "<", before(r.deploymentDays).toISOString()).limit(500).get()).docs) {
    await d.ref.delete();
    removed.deployments!++;
  }
  return removed;
}
