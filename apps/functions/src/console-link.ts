/**
 * The daily check-in with the supplier's Polymath Console (docs/22-polymath-console.md).
 *
 * Sends what the supplier needs to support this deployment (versions, devices, recent errors,
 * licences, and yesterday's totals if the owner shares them), proving which project it comes from
 * with the project's own Google identity. Applies what comes back only after checking it:
 * - a newer licence key, verified with the licence public key and bound to this project;
 * - the active/suspended status, verified the same way (older directives are ignored);
 * - a notice for the owner, and the supplier's contact details.
 * If the console can't be reached nothing changes here.
 */
import { type CheckinRequest, type CheckinResponse, type CheckinTenant, LicenceError, type Tenant, clampModules, colomboDate, decodeLicence, licenceStatus, suspensionInfo, verifyDirective, verifyLicence } from "@pos/core";
import { FieldValue, type Firestore, type Query } from "firebase-admin/firestore";

export interface LinkEnv {
  consoleUrl: string | undefined;
  projectId: string;
  appVersion: string;
  publicKey: string;
  /** Headers proving who is calling (a Google ID token for the console's address). */
  identity: (audience: string) => Promise<Record<string, string>>;
  fetch?: typeof fetch;
}

export interface CheckinOutcome {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  /** What changed here: licence applied, suspended, restored … */
  applied: string[];
  at: string;
}

/** The project's own Google identity, from the metadata server of the function's runtime. */
export async function metadataIdentity(audience: string): Promise<Record<string, string>> {
  if (process.env.FUNCTIONS_EMULATOR === "true") return { "x-test-identity": process.env.CONSOLE_TEST_IDENTITY ?? `${process.env.GCLOUD_PROJECT}@appspot.gserviceaccount.com` };
  const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`;
  const r = await fetch(url, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`no identity token from the metadata server (HTTP ${r.status})`);
  return { authorization: `Bearer ${(await r.text()).trim()}` };
}

async function count(q: Query): Promise<number> {
  return (await q.count().get()).data().count;
}

export async function buildReport(db: Firestore, env: Pick<LinkEnv, "projectId" | "appVersion">, reason: "scheduled" | "manual", now: Date): Promise<CheckinRequest> {
  const tenants: CheckinTenant[] = [];
  const yesterday = colomboDate(now, -1);
  for (const snap of (await db.collection("tenants").limit(50).get()).docs) {
    const t = snap.data() as Tenant;
    const ref = snap.ref;
    const business = (await ref.collection("settings").doc("business").get()).data() as { tradingName?: string } | undefined;
    const devices = (await ref.collection("deviceStatus").limit(100).get()).docs.map((d) => {
      const x = d.data() as { id?: string; appVersion?: string; lastSeenAt?: string };
      return { id: String(x.id ?? d.id), ...(x.appVersion ? { appVersion: x.appVersion } : {}), ...(x.lastSeenAt ? { lastSeenAt: x.lastSeenAt } : {}) };
    });
    const since = new Date(now.getTime() - 86_400_000).toISOString();
    const susp = suspensionInfo(t.supplier, now);
    let usage: CheckinTenant["usage"] = null;
    const share = t.shareUsage !== false;
    if (share) {
      const days = (await ref.collection("dailyStats").where("businessDate", "==", yesterday).get()).docs.map((d) => d.data() as { checks?: number; covers?: number; netSales?: number; total?: number });
      usage = { date: yesterday, checks: 0, covers: 0, netSales: 0, total: 0 };
      for (const d of days) {
        usage.checks += d.checks ?? 0;
        usage.covers += d.covers ?? 0;
        usage.netSales += d.netSales ?? 0;
        usage.total += d.total ?? 0;
      }
    }
    tenants.push({
      id: snap.id,
      name: business?.tradingName || t.name || snap.id,
      plan: t.plan,
      ...(t.licence ? { licence: { licenceId: t.licence.licenceId, ...(t.licence.issuedAt ? { issuedAt: t.licence.issuedAt } : {}), expiresAt: t.licence.expiresAt, status: susp.state === "blocked" ? "suspended" : licenceStatus(t.licence, now).status } } : {}),
      modules: Object.entries(t.modules ?? {}).filter(([, on]) => on).map(([k]) => k),
      devices,
      errors24h: await count(ref.collection("clientErrors").where("at", ">=", since)),
      counts: {
        workstations: await count(ref.collection("workstations").where("active", "==", true)),
        employees: await count(ref.collection("staff")),
        backOfficeUsers: await count(ref.collection("members").where("role", "!=", "terminal")),
      },
      usage,
      shareUsage: share,
    });
  }
  return { v: 1, projectId: env.projectId, appVersion: env.appVersion, sentAt: now.toISOString(), reason, tenants };
}

/** When a licence was issued: recorded since 1.7.0, else read from its own key. */
async function issuedAt(l: Tenant["licence"], publicKey: string): Promise<string | undefined> {
  if (!l) return undefined;
  if (l.issuedAt) return l.issuedAt;
  try {
    return (await decodeLicence(l.token, publicKey)).issuedAt;
  } catch {
    return undefined;
  }
}

export async function applyResponse(db: Firestore, res: CheckinResponse, env: Pick<LinkEnv, "projectId" | "publicKey">, now: Date): Promise<string[]> {
  const applied: string[] = [];
  let directive: Awaited<ReturnType<typeof verifyDirective>> | null = null;
  if (res.directive?.token) {
    try {
      directive = await verifyDirective(res.directive.token, env.publicKey, env.projectId);
    } catch (e) {
      applied.push(`status ignored: ${(e as Error).message}`);
    }
  }
  for (const snap of (await db.collection("tenants").limit(50).get()).docs) {
    const t = snap.data() as Tenant;
    const update: Record<string, unknown> = {};
    const supplier: Record<string, unknown> = { lastCheckinAt: now.toISOString(), lastCheckinOk: true, lastCheckinError: FieldValue.delete() };

    if (res.licence?.token) {
      try {
        const { payload } = await verifyLicence(res.licence.token, env.publicKey, { projectId: env.projectId, tenantId: snap.id }, now);
        const current = await issuedAt(t.licence, env.publicKey);
        if (t.licence?.licenceId !== payload.licenceId && (!current || payload.issuedAt > current)) {
          update.plan = payload.edition;
          update.entitlements = payload.entitlements;
          update.licence = { token: res.licence.token.trim(), licenceId: payload.licenceId, licensee: payload.licensee.name, edition: payload.edition, addOns: payload.addOns, billing: payload.billing, validFrom: payload.validFrom, expiresAt: payload.expiresAt, graceDays: payload.graceDays, issuedAt: payload.issuedAt, activatedAt: now.toISOString(), activatedBy: "console", source: "console", demoKey: false };
          update.modules = clampModules(t.modules ?? {}, payload.entitlements);
          applied.push(`${snap.id}: licence ${payload.licenceId} (${payload.edition}, until ${payload.expiresAt.slice(0, 10)})`);
        }
      } catch (e) {
        // A licence for another business in the project, or one that has expired: leave this one as it is.
        if (!(e instanceof LicenceError)) throw e;
      }
    }

    if (directive && (!t.supplier?.directiveAt || directive.issuedAt > t.supplier.directiveAt)) {
      supplier.directiveAt = directive.issuedAt;
      if (directive.state === "suspended") {
        supplier.suspension = { since: directive.since ?? directive.issuedAt, graceUntil: directive.graceUntil ?? directive.issuedAt, ...(directive.message ? { message: directive.message } : {}) };
        if (!t.supplier?.suspension) applied.push(`${snap.id}: suspended (grace until ${(directive.graceUntil ?? directive.issuedAt).slice(0, 10)})`);
      } else {
        supplier.suspension = FieldValue.delete();
        if (t.supplier?.suspension) applied.push(`${snap.id}: restored`);
      }
    }
    supplier.notice = res.notice?.text ? { text: String(res.notice.text).slice(0, 400), level: res.notice.level === "warn" ? "warn" : "info" } : FieldValue.delete();
    if (res.supplier?.name) supplier.contact = Object.fromEntries(Object.entries(res.supplier).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, String(v).slice(0, 200)]));
    await snap.ref.set({ ...update, supplier }, { merge: true });
  }
  return applied;
}

async function recordFailure(db: Firestore, error: string, now: Date) {
  for (const snap of (await db.collection("tenants").limit(50).get()).docs) {
    await snap.ref.set({ supplier: { lastCheckinAt: now.toISOString(), lastCheckinOk: false, lastCheckinError: error.slice(0, 300) } }, { merge: true });
  }
}

export async function runCheckin(db: Firestore, env: LinkEnv, reason: "scheduled" | "manual", now = new Date()): Promise<CheckinOutcome> {
  const at = now.toISOString();
  if (!env.consoleUrl) return { ok: false, skipped: true, error: "This system isn't linked to a supplier console (CONSOLE_URL is not set).", applied: [], at };
  let res: CheckinResponse;
  try {
    const report = await buildReport(db, env, reason, now);
    const r = await (env.fetch ?? fetch)(env.consoleUrl, {
      method: "POST",
      headers: { "content-type": "application/json", ...(await env.identity(env.consoleUrl)) },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(20_000),
    });
    res = (await r.json().catch(() => ({ v: 1, ok: false, serverTime: at, error: `HTTP ${r.status}` }))) as CheckinResponse;
    if (!r.ok || !res.ok) throw new Error(res.error ?? `HTTP ${r.status}`);
  } catch (e) {
    const error = (e as Error).message;
    await recordFailure(db, error, now);
    return { ok: false, error, applied: [], at };
  }
  const applied = await applyResponse(db, res, env, now);
  return { ok: true, applied, at };
}
