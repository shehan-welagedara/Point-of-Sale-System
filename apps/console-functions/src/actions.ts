/**
 * Everything staff change in the console goes through here: the role is checked, the change is
 * validated, and an audit entry is written. The security rules let staff read, never write.
 */
import { randomBytes } from "node:crypto";
import { EDITIONS, type Edition, type LicencePayload, MODULES, type ModuleKey, type UsageLimits, buildEntitlements, publicKeyFromPrivate, signDirective, signLicence } from "@pos/core";
import { type DocumentReference, FieldValue, type Firestore } from "firebase-admin/firestore";
import { type GithubConfig, dispatchRelease, recentRuns, releaseBranchVersion } from "./github.js";
import { type ClientLicence, type ConsoleClient, type Permission, STAFF_ROLES, type StaffRole, type Subscription, can } from "./model.js";

export interface Actor {
  uid: string;
  email: string;
  emailVerified: boolean;
  role?: string;
}

export interface Deps {
  db: Firestore;
  now: Date;
  /** OWNER_EMAIL: the first owner, set by `pnpm console:setup`. */
  ownerEmail: string;
  privateKey: () => string;
  githubToken: () => string;
  setRole: (uid: string, role: StaffRole | null) => Promise<void>;
  fetch?: typeof fetch;
}

export class ActionError extends Error {
  constructor(
    public code: "permission-denied" | "invalid-argument" | "not-found" | "failed-precondition",
    message: string,
  ) {
    super(message);
  }
}

const bad = (m: string) => new ActionError("invalid-argument", m);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function need(actor: Actor, p: Permission) {
  if (!can(actor.role, p)) throw new ActionError("permission-denied", `Your role (${actor.role ?? "none"}) can't do this.`);
}

async function audit(deps: Deps, actor: Actor, action: string, clientId: string | null, summary: string) {
  await deps.db.collection("audit").add({ at: deps.now.toISOString(), uid: actor.uid, email: actor.email, role: actor.role ?? null, action, clientId, summary });
}

async function getClient(deps: Deps, id: unknown): Promise<{ ref: DocumentReference; c: ConsoleClient }> {
  if (typeof id !== "string" || !ID.test(id)) throw bad("clientId is required");
  const ref = deps.db.collection("clients").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new ActionError("not-found", `No client ${id}`);
  return { ref, c: snap.data() as ConsoleClient };
}

const licenceIdFor = (now: Date) => `LIC-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").slice(0, 5).toUpperCase()}`;
/** End of a day in Sri Lanka, as an instant. */
const endOfDay = (d: string) => new Date(Date.parse(`${d}T23:59:59+05:30`)).toISOString();

async function issue(deps: Deps, actor: Actor, c: ConsoleClient, o: { edition: Edition; addOns: ModuleKey[]; limits: Partial<UsageLimits>; expiresAt: string; validFrom?: string; graceDays: number; billing: LicencePayload["billing"]; tenantId: string; reason: string }): Promise<ClientLicence> {
  const issuedAt = deps.now.toISOString();
  const payload: LicencePayload = {
    v: 1,
    licenceId: licenceIdFor(deps.now),
    licensee: { name: c.legalName || c.name, ...(c.contact?.email ? { email: c.contact.email } : {}) },
    edition: o.edition,
    addOns: o.addOns,
    entitlements: buildEntitlements(o.edition, o.addOns, o.limits),
    projectId: c.projectId,
    tenantId: o.tenantId,
    billing: o.billing,
    issuedAt,
    validFrom: o.validFrom ?? issuedAt,
    expiresAt: o.expiresAt,
    graceDays: o.graceDays,
  };
  let key: string;
  try {
    key = deps.privateKey();
  } catch {
    throw new ActionError("failed-precondition", "The licence signing key isn't set up yet: run `pnpm console:setup` (it stores your key in Secret Manager).");
  }
  const token = await signLicence(payload, key);
  const lic: ClientLicence = { licenceId: payload.licenceId, edition: o.edition, addOns: o.addOns, limits: payload.entitlements.limits, tenantId: o.tenantId, issuedAt, validFrom: payload.validFrom, expiresAt: o.expiresAt, graceDays: o.graceDays, billing: o.billing, token, issuedBy: actor.email };
  await deps.db.collection("licences").doc(payload.licenceId).set({ ...payload, token, clientId: c.id, issuedBy: actor.email, reason: o.reason });
  await deps.db.collection("clients").doc(c.id).set({ licence: lic, updatedAt: issuedAt }, { merge: true });
  await audit(deps, actor, "issueLicence", c.id, `${payload.licenceId}: ${o.edition}${o.addOns.length ? ` + ${o.addOns.join(", ")}` : ""} until ${o.expiresAt.slice(0, 10)}${o.reason ? ` (${o.reason})` : ""}`);
  return lic;
}

function parseLicenceInput(d: Record<string, unknown>, now: Date) {
  const edition = d.edition as Edition;
  if (!EDITIONS.some((e) => e.key === edition) || edition === "demo") throw bad("choose an edition");
  const addOns = (Array.isArray(d.addOns) ? d.addOns : []).map(String) as ModuleKey[];
  for (const a of addOns) if (!MODULES.some((m) => m.key === a)) throw bad(`unknown module ${a}`);
  const limits: Partial<UsageLimits> = {};
  for (const [k, v] of Object.entries((d.limits as Record<string, unknown>) ?? {})) {
    if (!["properties", "revenueCenters", "workstations", "employees", "backOfficeUsers"].includes(k)) throw bad(`unknown limit ${k}`);
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw bad(`${k} must be a whole number`);
    limits[k as keyof UsageLimits] = n;
  }
  let expiresAt: string;
  if (typeof d.expiresOn === "string" && DATE.test(d.expiresOn)) expiresAt = endOfDay(d.expiresOn);
  else {
    const months = Number(d.months ?? 12);
    if (!Number.isInteger(months) || months < 1 || months > 120) throw bad("months must be 1–120");
    const e = new Date(now);
    e.setUTCMonth(e.getUTCMonth() + months);
    expiresAt = e.toISOString();
  }
  if (Date.parse(expiresAt) <= now.getTime()) throw bad("the licence must end in the future");
  const graceDays = d.graceDays === undefined ? 14 : Number(d.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) throw bad("grace days must be 0–90");
  const billing = (["subscription", "perpetual", "trial"].includes(String(d.billing)) ? d.billing : "subscription") as LicencePayload["billing"];
  const tenantId = typeof d.tenantId === "string" && d.tenantId.trim() ? d.tenantId.trim().slice(0, 64) : "*";
  return { edition, addOns, limits, expiresAt, graceDays, billing, tenantId, reason: str(d.reason, 300) };
}

async function directive(deps: Deps, c: ConsoleClient, state: "active" | "suspended", extra: { since?: string; graceUntil?: string; message?: string } = {}) {
  const issuedAt = deps.now.toISOString();
  let key: string;
  try {
    key = deps.privateKey();
  } catch {
    throw new ActionError("failed-precondition", "The licence signing key isn't set up yet: run `pnpm console:setup`.");
  }
  const token = await signDirective({ v: 1, type: "status", projectId: c.projectId, state, ...extra, issuedAt }, key);
  return { token, state, issuedAt };
}

function readSubscription(s: Record<string, unknown>): Subscription {
  const cycle = String(s.cycle ?? "annual") as Subscription["cycle"];
  if (!["monthly", "quarterly", "annual", "perpetual"].includes(cycle)) throw bad("billing cycle");
  const priceLkr = Number(s.priceLkr ?? 0);
  if (!Number.isFinite(priceLkr) || priceLkr < 0 || priceLkr > 100_000_000) throw bad("price");
  for (const k of ["startedOn", "paidUntil"] as const) if (s[k] !== undefined && s[k] !== "" && !(typeof s[k] === "string" && DATE.test(s[k] as string))) throw bad(`${k} must be a date`);
  return {
    plan: str(s.plan, 80) || "Standard",
    priceLkr: Math.round(priceLkr),
    cycle,
    ...(s.startedOn ? { startedOn: String(s.startedOn) } : {}),
    ...(s.paidUntil ? { paidUntil: String(s.paidUntil) } : {}),
    cancelled: Boolean(s.cancelled),
    ...(str(s.notes, 1000) ? { notes: str(s.notes, 1000) } : {}),
  };
}

async function githubConfig(deps: Deps): Promise<GithubConfig & { stagingProjectId?: string }> {
  const g = (await deps.db.doc("config/github").get()).data() as (GithubConfig & { stagingProjectId?: string }) | undefined;
  if (!g?.owner || !g.repo) throw new ActionError("failed-precondition", "Set the GitHub repository first (Settings → GitHub).");
  return { ...g, workflow: g.workflow || "release.yml", ref: g.ref || "main" };
}

export async function runAction(deps: Deps, actor: Actor, data: Record<string, unknown>): Promise<unknown> {
  const { db, now } = deps;
  const at = now.toISOString();
  const action = String(data?.action ?? "");

  if (action === "claimAccess") {
    if (!actor.emailVerified || !actor.email) throw new ActionError("permission-denied", "Sign in with a Google account, or verify your email address first.");
    const email = actor.email.toLowerCase();
    const staffRef = db.collection("staff").doc(actor.uid);
    const existing = (await staffRef.get()).data() as { role: StaffRole; active: boolean } | undefined;
    if (existing?.active) {
      await deps.setRole(actor.uid, existing.role);
      return { role: existing.role };
    }
    let role: StaffRole | undefined;
    if (deps.ownerEmail && email === deps.ownerEmail.toLowerCase()) role = "owner";
    const invite = await db.collection("invites").doc(email).get();
    if (!role && invite.exists) role = invite.data()!.role as StaffRole;
    if (!role) throw new ActionError("permission-denied", `${email} hasn't been invited to the Polymath Console. Ask the owner to invite you.`);
    await staffRef.set({ uid: actor.uid, email, name: str(data.name, 80) || email, role, active: true, joinedAt: at });
    if (invite.exists) await invite.ref.delete();
    await deps.setRole(actor.uid, role);
    await audit(deps, { ...actor, role }, "claimAccess", null, `${email} joined as ${role}`);
    return { role };
  }

  need(actor, "read");
  switch (action) {
    // ── Staff ──
    case "inviteStaff": {
      need(actor, "staff");
      const email = str(data.email, 120).toLowerCase();
      const role = String(data.role) as StaffRole;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("email");
      if (!(STAFF_ROLES as readonly string[]).includes(role)) throw bad("role");
      if (role === "owner" && actor.role !== "owner") throw new ActionError("permission-denied", "Only an owner can invite another owner.");
      await db.collection("invites").doc(email).set({ email, role, invitedBy: actor.email, at });
      await audit(deps, actor, "inviteStaff", null, `${email} as ${role}`);
      return { ok: true };
    }
    case "cancelInvite": {
      need(actor, "staff");
      const email = str(data.email, 120).toLowerCase();
      await db.collection("invites").doc(email).delete();
      await audit(deps, actor, "cancelInvite", null, email);
      return { ok: true };
    }
    case "updateStaff": {
      need(actor, "staff");
      const uid = str(data.uid, 128);
      const ref = db.collection("staff").doc(uid);
      const s = (await ref.get()).data() as { role: StaffRole; active: boolean; email: string } | undefined;
      if (!s) throw new ActionError("not-found", "No such staff member");
      const role = (data.role ? String(data.role) : s.role) as StaffRole;
      const active = data.active === undefined ? s.active : Boolean(data.active);
      if (!(STAFF_ROLES as readonly string[]).includes(role)) throw bad("role");
      if ((s.role === "owner" || role === "owner") && actor.role !== "owner") throw new ActionError("permission-denied", "Only an owner can change an owner.");
      if (s.role === "owner" && (role !== "owner" || !active)) {
        const owners = (await db.collection("staff").where("role", "==", "owner").where("active", "==", true).get()).size;
        if (owners <= 1) throw new ActionError("failed-precondition", "The console needs at least one owner.");
      }
      await ref.set({ role, active, updatedAt: at }, { merge: true });
      await deps.setRole(uid, active ? role : null);
      await audit(deps, actor, "updateStaff", null, `${s.email}: ${role}${active ? "" : " (deactivated)"}`);
      return { ok: true };
    }

    // ── Clients ──
    case "saveClient": {
      need(actor, "clients");
      const d = (data.client ?? {}) as Record<string, unknown>;
      const id = str(d.id, 41);
      if (!ID.test(id)) throw bad("Client id: lowercase letters, digits and dashes (e.g. noura-kitchen)");
      const name = str(d.name, 120);
      if (!name) throw bad("Client name");
      const projectId = str(d.projectId, 30);
      if (!PROJECT.test(projectId)) throw bad("Firebase project ID (lowercase, 6–30 characters)");
      const projectNumber = str(d.projectNumber, 20);
      if (projectNumber && !/^\d{6,20}$/.test(projectNumber)) throw bad("Project number: digits only (Firebase console → Project settings)");
      const clash = await db.collection("clients").where("projectId", "==", projectId).get();
      if (clash.docs.some((x) => x.id !== id)) throw bad(`Project ${projectId} already belongs to another client`);
      const ref = db.collection("clients").doc(id);
      const exists = (await ref.get()).exists;
      if (!exists && data.create !== true) throw new ActionError("not-found", `No client ${id}`);
      if (exists && data.create === true) throw bad(`Client id ${id} is taken`);
      const wave = Number(d.wave ?? 1);
      const record: Partial<ConsoleClient> = {
        id,
        name,
        legalName: str(d.legalName, 160),
        contact: { name: str((d.contact as Record<string, unknown>)?.name, 120), email: str((d.contact as Record<string, unknown>)?.email, 120), phone: str((d.contact as Record<string, unknown>)?.phone, 40) },
        address: str(d.address, 300),
        notes: str(d.notes, 2000),
        projectId,
        ...(projectNumber ? { projectNumber } : {}),
        region: str(d.region, 40) || "asia-south1",
        wave: wave === 2 ? 2 : 1,
        maintenanceWindow: str(d.maintenanceWindow, 60) || "23:30-05:00 Asia/Colombo",
        enabled: d.enabled !== false,
        updatedAt: at,
        ...(exists ? {} : { status: "active" as const, createdAt: at }),
      };
      await ref.set(record, { merge: true });
      if (!exists) await db.collection("unknownProjects").doc(projectId).delete();
      await audit(deps, actor, exists ? "updateClient" : "createClient", id, `${name} (${projectId})`);
      return { id };
    }
    case "confirmProject": {
      need(actor, "suspend");
      const { ref, c } = await getClient(deps, data.clientId);
      const n = c.link?.pendingProjectNumber;
      if (!n) throw new ActionError("failed-precondition", "No check-in is waiting for confirmation.");
      await ref.set({ projectNumber: n, link: { pendingProjectNumber: null, pendingAt: null, lastError: null, lastErrorAt: null }, updatedAt: at }, { merge: true });
      await audit(deps, actor, "confirmProject", c.id, `project ${c.projectId} = number ${n}`);
      return { projectNumber: n };
    }
    case "dismissUnknown": {
      need(actor, "clients");
      await db.collection("unknownProjects").doc(str(data.projectId, 30)).delete();
      return { ok: true };
    }

    // ── Licences ──
    case "issueLicence": {
      need(actor, "licences");
      const { c } = await getClient(deps, data.clientId);
      const lic = await issue(deps, actor, c, parseLicenceInput(data, now));
      return { licenceId: lic.licenceId, token: lic.token, expiresAt: lic.expiresAt };
    }
    case "publicKey": {
      try {
        return { publicKey: await publicKeyFromPrivate(deps.privateKey()) };
      } catch {
        return { publicKey: null };
      }
    }

    // ── Suspend / restore ──
    case "suspend": {
      need(actor, "suspend");
      const { ref, c } = await getClient(deps, data.clientId);
      const graceDays = data.graceDays === undefined ? 7 : Number(data.graceDays);
      if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 60) throw bad("grace days must be 0–60");
      const message = str(data.message, 400) || "Your subscription needs attention. Please contact your supplier.";
      const graceUntil = new Date(now.getTime() + graceDays * 86_400_000).toISOString();
      const d = await directive(deps, c, "suspended", { since: at, graceUntil, message });
      await ref.set({ status: "suspended", suspension: { since: at, graceDays, graceUntil, message, reason: str(data.reason, 300), by: actor.email }, directive: d, updatedAt: at }, { merge: true });
      await audit(deps, actor, "suspend", c.id, `grace ${graceDays} day(s): ${message}`);
      return { graceUntil };
    }
    case "restore": {
      need(actor, "suspend");
      const { ref, c } = await getClient(deps, data.clientId);
      const d = await directive(deps, c, "active");
      await ref.set({ status: "active", suspension: FieldValue.delete(), directive: d, updatedAt: at }, { merge: true });
      await audit(deps, actor, "restore", c.id, "restored");
      return { ok: true };
    }

    // ── Subscription and payments ──
    case "saveSubscription": {
      need(actor, "clients");
      const { ref, c } = await getClient(deps, data.clientId);
      const sub = readSubscription((data.subscription ?? {}) as Record<string, unknown>);
      await ref.set({ subscription: sub, updatedAt: at }, { merge: true });
      await audit(deps, actor, "saveSubscription", c.id, `${sub.plan}, Rs ${sub.priceLkr} ${sub.cycle}${sub.paidUntil ? `, paid until ${sub.paidUntil}` : ""}`);
      return { ok: true };
    }
    case "recordPayment": {
      need(actor, "clients");
      const { ref, c } = await getClient(deps, data.clientId);
      const amount = Number(data.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw bad("amount");
      const paidUntil = str(data.paidUntil, 10);
      if (!DATE.test(paidUntil)) throw bad("paid until");
      const date = str(data.date, 10) || at.slice(0, 10);
      if (!DATE.test(date)) throw bad("date");
      await ref.collection("payments").add({ date, amount: Math.round(amount), method: str(data.method, 40) || "bank transfer", reference: str(data.reference, 120), paidUntil, recordedBy: actor.email, at });
      const sub = { ...(c.subscription ?? { plan: "Standard", priceLkr: Math.round(amount), cycle: "annual" as const }), paidUntil };
      await ref.set({ subscription: sub, updatedAt: at }, { merge: true });
      await audit(deps, actor, "recordPayment", c.id, `Rs ${Math.round(amount)} (${str(data.method, 40) || "bank transfer"}), paid until ${paidUntil}`);
      let licence: ClientLicence | undefined;
      if (data.renewLicence) {
        need(actor, "licences");
        if (!c.licence) throw new ActionError("failed-precondition", "Issue the client's first licence before renewing it.");
        licence = await issue(deps, actor, c, { edition: c.licence.edition, addOns: c.licence.addOns, limits: c.licence.limits, expiresAt: endOfDay(paidUntil), graceDays: c.licence.graceDays, billing: c.licence.billing, tenantId: c.licence.tenantId, reason: `renewed with payment to ${paidUntil}` });
      }
      return { ok: true, licenceId: licence?.licenceId };
    }
    case "setNotice": {
      need(actor, "clients");
      const { ref, c } = await getClient(deps, data.clientId);
      const text = str(data.text, 400);
      const until = str(data.until, 10);
      if (until && !DATE.test(until)) throw bad("until must be a date");
      await ref.set({ notice: text ? { text, level: data.level === "warn" ? "warn" : "info", ...(until ? { until: endOfDay(until) } : {}) } : FieldValue.delete(), updatedAt: at }, { merge: true });
      await audit(deps, actor, "setNotice", c.id, text || "(cleared)");
      return { ok: true };
    }

    // ── Settings ──
    case "saveCompany": {
      need(actor, "settings");
      const d = (data.company ?? {}) as Record<string, unknown>;
      const company = { name: str(d.name, 80) || "Polymath Tech", email: str(d.email, 120), phone: str(d.phone, 40), whatsapp: str(d.whatsapp, 40), website: str(d.website, 120), address: str(d.address, 300) };
      await db.doc("config/company").set(company);
      await audit(deps, actor, "saveCompany", null, company.name);
      return { ok: true };
    }
    case "saveGithub": {
      need(actor, "settings");
      const d = (data.github ?? {}) as Record<string, unknown>;
      const g = { owner: str(d.owner, 80), repo: str(d.repo, 100), workflow: str(d.workflow, 100) || "release.yml", ref: str(d.ref, 100) || "main", stagingProjectId: str(d.stagingProjectId, 30) };
      if (!/^[A-Za-z0-9-]+$/.test(g.owner) || !/^[A-Za-z0-9._-]+$/.test(g.repo)) throw bad("GitHub owner and repository");
      if (g.stagingProjectId && !PROJECT.test(g.stagingProjectId)) throw bad("staging project ID");
      await db.doc("config/github").set(g, { merge: true });
      await audit(deps, actor, "saveGithub", null, `${g.owner}/${g.repo} ${g.workflow}@${g.ref}`);
      return { ok: true };
    }

    // ── Updates ──
    case "startDeployment": {
      need(actor, "deploy");
      const g = await githubConfig(deps);
      const target = str(data.target, 400);
      const clients = (await db.collection("clients").get()).docs.map((d) => d.data() as ConsoleClient);
      let deployTarget: string;
      if (target === "staging") {
        if (!g.stagingProjectId) throw bad("Set the staging project in Settings → GitHub first");
        deployTarget = "staging";
      } else if (target === "wave:1" || target === "wave:2") deployTarget = target;
      else {
        const ids = target.split(",").map((s) => s.trim()).filter(Boolean);
        if (!ids.length || ids.some((i) => !clients.some((c) => c.id === i))) throw bad("Choose staging, a wave, or existing clients");
        deployTarget = ids.join(",");
      }
      const registry = {
        staging: g.stagingProjectId ? { id: "staging", name: "Staging", projectId: g.stagingProjectId, region: "asia-south1", backupBucket: `gs://${g.stagingProjectId}-backups` } : { id: "staging", name: "Staging", projectId: "REPLACE" },
        clients: clients.filter((c) => c.status !== "cancelled").map((c) => ({ id: c.id, name: c.name, projectId: c.projectId, region: c.region, wave: c.wave, maintenanceWindow: c.maintenanceWindow, backupBucket: `gs://${c.projectId}-backups`, enabled: c.enabled !== false })),
      };
      const ref = db.collection("deployments").doc();
      await ref.set({ id: ref.id, target: deployTarget, requestedBy: actor.email, at, status: "requested" });
      try {
        await dispatchRelease(g, deps.githubToken(), { target: deployTarget, registry: JSON.stringify(registry), requestId: ref.id }, deps.fetch);
      } catch (e) {
        await ref.set({ status: "failed", error: (e as Error).message }, { merge: true });
        throw new ActionError("failed-precondition", (e as Error).message);
      }
      await audit(deps, actor, "startDeployment", null, `target ${deployTarget}`);
      return { id: ref.id };
    }
    case "refreshDeployments": {
      const g = await githubConfig(deps);
      const token = deps.githubToken();
      if (!token || token === "none") return { ok: false, reason: "no GitHub token" };
      const runs = await recentRuns(g, token, deps.fetch);
      const open = await db.collection("deployments").where("status", "in", ["requested", "queued", "in_progress", "waiting", "pending"]).get();
      for (const d of open.docs) {
        const run = runs.find((r) => r.title.includes(d.id));
        if (run) await d.ref.set({ status: run.status === "completed" ? (run.conclusion ?? "completed") : run.status, run }, { merge: true });
      }
      const latest = await releaseBranchVersion(g, token, deps.fetch).catch(() => undefined);
      if (latest) await db.doc("config/github").set({ latestVersion: latest, latestCheckedAt: at }, { merge: true });
      return { ok: true, latestVersion: latest };
    }
  }
  throw bad(`unknown action ${action}`);
}
