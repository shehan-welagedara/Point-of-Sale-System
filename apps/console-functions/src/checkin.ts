/**
 * A client's check-in (docs/22-polymath-console.md §2): record what it reports, answer with its
 * current licence key, its signed status, a notice and Polymath Tech's contact details; since 1.10.0
 * also the update scheduled for it (maintenance notice), whether new businesses need approval, and
 * the decisions on the business requests it reported.
 */
import type { CheckinResponse, SupplierContact } from "@pos/core";
import type { Firestore } from "firebase-admin/firestore";
import { businessRequestsAtCheckin } from "./businesses.js";
import { serviceAccountProject } from "./identity.js";
import { type Broadcast, type ClientHealth, type ConsoleClient, DEFAULT_SUPPLIER, compareVersions, maintenanceText, noticeFor, validateCheckin } from "./model.js";
import { rolloutAtCheckin } from "./releases.js";

export interface CheckinResult {
  status: number;
  body: CheckinResponse;
}

const fail = (status: number, error: string, now: Date): CheckinResult => ({ status, body: { v: 1, ok: false, serverTime: now.toISOString(), error } });

export async function handleCheckin(db: Firestore, callerEmail: string, raw: unknown, now: Date): Promise<CheckinResult> {
  let req;
  try {
    req = validateCheckin(raw);
  } catch (e) {
    return fail(400, (e as Error).message, now);
  }
  const found = await db.collection("clients").where("projectId", "==", req.projectId).limit(1).get();
  if (found.empty) {
    // Shown on the console's Clients page, so the project can be added in one click.
    await db.collection("unknownProjects").doc(req.projectId).set(
      {
        projectId: req.projectId,
        callerEmail,
        appVersion: req.appVersion,
        businesses: req.tenants.map((t) => t.name).slice(0, 10),
        requests: (Array.isArray(req.businessRequests) ? req.businessRequests : []).slice(0, 5).map((r) => `${String(r?.name ?? "").slice(0, 80)} (${String(r?.requestedBy?.email ?? "").slice(0, 120)})`),
        lastAt: now.toISOString(),
      },
      { merge: true },
    );
    return fail(404, "This project isn't registered in the Polymath Console yet.", now);
  }
  const ref = found.docs[0]!.ref;
  const client = found.docs[0]!.data() as ConsoleClient;

  // The caller must be this project's own service account.
  const sa = serviceAccountProject(callerEmail);
  const reject = async (error: string) => {
    await ref.set({ link: { ...(client.link ?? {}), lastError: error, lastErrorAt: now.toISOString() } }, { merge: true });
    return fail(403, error, now);
  };
  if (sa.projectId) {
    if (sa.projectId !== client.projectId) return reject(`identity is for project ${sa.projectId}`);
  } else if (sa.projectNumber) {
    if (!client.projectNumber) {
      // First contact: a person confirms the project number once (Clients → the client → Confirm).
      await ref.set({ link: { pendingProjectNumber: sa.projectNumber, pendingAt: now.toISOString(), lastError: "waiting for the project number to be confirmed", lastErrorAt: now.toISOString() } }, { merge: true });
      return fail(403, "Waiting for Polymath Tech to confirm this project.", now);
    }
    if (sa.projectNumber !== client.projectNumber) return reject(`identity is for project number ${sa.projectNumber}, not ${client.projectNumber}`);
  } else {
    return reject(`unexpected identity ${callerEmail}`);
  }

  const health: ClientHealth = {
    lastCheckinAt: now.toISOString(),
    appVersion: req.appVersion,
    reason: req.reason === "manual" ? "manual" : "scheduled",
    tenants: req.tenants.map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      ...(t.licence ? { licence: { licenceId: String(t.licence.licenceId), expiresAt: String(t.licence.expiresAt), status: String(t.licence.status) } } : {}),
      modules: t.modules,
      devices: t.devices.map((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as { id: string }),
      errors24h: t.errors24h,
      counts: { workstations: Number(t.counts?.workstations) || 0, employees: Number(t.counts?.employees) || 0, backOfficeUsers: Number(t.counts?.backOfficeUsers) || 0 },
      shareUsage: t.shareUsage !== false,
      ...(t.status ? { status: t.status } : {}),
      ...(t.createdAt ? { createdAt: t.createdAt } : {}),
      ...(t.approval ? { approval: t.approval } : {}),
    })),
  };
  const approvals = client.approvals === "off" ? "off" : "required";
  await ref.set(
    { health, link: { lastError: null, lastErrorAt: null, pendingProjectNumber: null, pendingAt: null }, ...(approvals === "required" && !client.approvalsSince ? { approvalsSince: now.toISOString() } : {}) },
    { merge: true },
  );
  const businessDecisions = await businessRequestsAtCheckin(db, client, req, now);
  const update = await rolloutAtCheckin(db, client, req.appVersion, now);

  // Yesterday's figures, one document per business date.
  const byDate = new Map<string, Record<string, unknown>>();
  for (const t of req.tenants) {
    if (!t.usage || t.shareUsage === false || !/^\d{4}-\d{2}-\d{2}$/.test(t.usage.date)) continue;
    const u = { name: t.name, checks: Number(t.usage.checks) || 0, covers: Number(t.usage.covers) || 0, netSales: Number(t.usage.netSales) || 0, total: Number(t.usage.total) || 0 };
    byDate.set(t.usage.date, { ...(byDate.get(t.usage.date) ?? {}), [t.id]: u });
  }
  for (const [date, tenants] of byDate) {
    const sum = (k: "checks" | "covers" | "netSales" | "total") => Object.values(tenants).reduce((n: number, t) => n + Number((t as Record<string, number>)[k]), 0);
    await ref.collection("usage").doc(date).set({ date, tenants, checks: sum("checks"), covers: sum("covers"), netSales: sum("netSales"), total: sum("total"), reportedAt: now.toISOString() });
  }

  const company = (await db.doc("config/company").get()).data() as SupplierContact | undefined;
  const broadcast = (await db.doc("config/broadcast").get()).data() as Broadcast | undefined;
  const supplier: SupplierContact = { ...DEFAULT_SUPPLIER, ...(company ?? {}) };
  return {
    status: 200,
    body: {
      v: 1,
      ok: true,
      serverTime: now.toISOString(),
      clientId: client.id,
      licence: client.licence?.token ? { token: client.licence.token } : null,
      directive: client.directive?.token ? { token: client.directive.token } : null,
      // Systems before 1.10.0 don't know the update notice: they get it as a plain message instead.
      notice: noticeFor(client, supplier.name, now, broadcast) ?? (update && compareVersions(req.appVersion, "1.10.0") < 0 ? { text: maintenanceText(update, now), level: "info" } : null),
      supplier,
      update,
      approvals,
      ...(businessDecisions.length ? { businessDecisions } : {}),
    },
  };
}
