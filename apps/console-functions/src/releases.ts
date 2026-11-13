/**
 * Releases and rollouts (docs/22 §8): the catalogue of versions (from CHANGELOG.md), and pushing a
 * version to chosen clients, now or in each client's maintenance window.
 *
 *  scheduled ─(due)→ dispatched ─(GitHub run succeeded)→ deployed ─(the system reports it)→ done
 *       │                 └─(run failed)→ failed
 *       └─(no GitHub connection)→ manual: run the shown command on the release PC; the check-in confirms
 *
 * Clients see the maintenance notice from their next check-in (hourly), so updates in the window are
 * scheduled at least an hour ahead. A client is done only when its own system reports the version.
 */
import type { UpdateNotice } from "@pos/core";
import type { Firestore } from "firebase-admin/firestore";
import { type Actor, ActionError, type Deps, audit, bad, githubConfig, str } from "./common.js";
import { type GithubConfig, dispatchRelease, recentRuns, releaseBranchVersion, repoFile, tagExists } from "./github.js";
import { type ConsoleClient, compareVersions } from "./model.js";

// ───────────────────────────── Catalogue ─────────────────────────────

export interface Release {
  version: string;
  date: string;
  /** "Minor (the back office on phones)" */
  type: string;
  /** How it is deployed, from the changelog. */
  deploy: string;
  /** "For clients": what restaurants see, plain text. */
  highlights: string[];
  /** The technical changes, plain text (first 20). */
  changes: string[];
  source: "changelog" | "manual";
  syncedAt: string;
  addedBy?: string;
}

const VERSION = /^\d+\.\d+\.\d+$/;
export const releaseId = (v: string) => v.replace(/\./g, "_");

/** Markdown to plain text: bold, code, links and stray markers removed. */
export function plain(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Reads CHANGELOG.md: `## 1.9.0 — 2026-11-12`, a **Type:** line, then `### For clients` and `### Changes` bullets. */
export function parseChangelog(md: string, now: Date): Release[] {
  const out: Release[] = [];
  const parts = md.split(/^## /m).slice(1);
  for (const part of parts) {
    const head = /^(\d+\.\d+\.\d+)\s*[—–-]\s*(\d{4}-\d{2}-\d{2})/.exec(part);
    if (!head) continue;
    const meta = /\*\*Type:\*\*\s*(.+?)(?:\s*·\s*\*\*Deploy:\*\*\s*(.+))?$/m.exec(part);
    const section = (name: RegExp) => {
      const m = new RegExp(`^### ${name.source}\\s*$([\\s\\S]*?)(?=^### |$(?![\\s\\S]))`, "m").exec(part);
      if (!m) return [];
      return m[1]!
        .split(/\n(?=- )/)
        .map((b) => b.trim())
        .filter((b) => b.startsWith("- "))
        .map((b) => plain(b.slice(2)));
    };
    out.push({
      version: head[1]!,
      date: head[2]!,
      type: plain(meta?.[1] ?? ""),
      deploy: plain(meta?.[2] ?? ""),
      highlights: section(/For clients/).slice(0, 12).map((h) => h.slice(0, 400)),
      changes: section(/Changes/).slice(0, 20).map((h) => h.slice(0, 400)),
      source: "changelog",
      syncedAt: now.toISOString(),
    });
  }
  return out;
}

export async function syncReleases(deps: Deps, actor: Actor, changelog?: string): Promise<{ count: number; latest?: string; source: "github" | "console build" }> {
  let text = changelog;
  let source: "github" | "console build" = "console build";
  if (!text) {
    const g = await githubConfig(deps);
    const token = deps.githubToken();
    if (!token || token === "none") throw new ActionError("failed-precondition", "No GitHub token: load the release notes from this console's build instead.");
    text = await repoFile(g, token, "CHANGELOG.md", deps.fetch);
    source = "github";
  }
  if (text.length > 1_000_000) throw bad("the changelog is too large");
  const releases = parseChangelog(text, deps.now);
  if (!releases.length) throw bad("No releases found in the changelog");
  const batch = deps.db.batch();
  for (const r of releases.slice(0, 200)) batch.set(deps.db.collection("releases").doc(releaseId(r.version)), r, { merge: true });
  await batch.commit();
  const latest = releases.map((r) => r.version).sort(compareVersions).pop();
  await audit(deps, actor, "syncReleases", null, `${releases.length} releases from ${source} (latest ${latest})`);
  return { count: releases.length, ...(latest ? { latest } : {}), source };
}

export async function addRelease(deps: Deps, actor: Actor, d: Record<string, unknown>): Promise<{ version: string }> {
  const version = str(d.version, 20);
  if (!VERSION.test(version)) throw bad("version like 1.10.0");
  const date = str(d.date, 10) || deps.now.toISOString().slice(0, 10);
  const lines = (v: unknown) => (typeof v === "string" ? v.split("\n") : Array.isArray(v) ? v.map(String) : []).map((l) => plain(l.replace(/^\s*[-•*]\s*/, ""))).filter(Boolean).slice(0, 12);
  const r: Release = { version, date, type: str(d.type, 120), deploy: str(d.deploy, 200), highlights: lines(d.highlights), changes: lines(d.changes), source: "manual", syncedAt: deps.now.toISOString(), addedBy: actor.email };
  await deps.db.collection("releases").doc(releaseId(version)).set(r);
  await audit(deps, actor, "addRelease", null, version);
  return { version };
}

// ───────────────────────────── Maintenance windows ─────────────────────────────

/** Minutes the zone is ahead of UTC at `at` (Asia/Colombo: 330). */
export function zoneOffset(zone: string, at: Date): number {
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
    return Math.round((Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return 330;
  }
}

/**
 * The first maintenance window that starts at or after `from` ("23:30-05:00 Asia/Colombo"). A window
 * already open with at least 30 minutes left starts at `from`. Returns null for an unreadable window.
 */
export function nextWindow(window: string | undefined, from: Date): { start: Date; end: Date } | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})(?:\s+([A-Za-z_/+-]+))?\s*$/.exec(window || "23:30-05:00 Asia/Colombo");
  if (!m) return null;
  const [sh, sm, eh, em] = [m[1], m[2], m[3], m[4]].map(Number) as [number, number, number, number];
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return null;
  const zone = m[5] || "Asia/Colombo";
  const offset = zoneOffset(zone, from);
  const localMidnight = Math.floor((from.getTime() + offset * 60_000) / 86_400_000) * 86_400_000 - offset * 60_000;
  let duration = (eh * 60 + em - (sh * 60 + sm)) * 60_000;
  if (duration <= 0) duration += 86_400_000;
  for (let d = -1; d <= 2; d++) {
    const start = localMidnight + d * 86_400_000 + (sh * 60 + sm) * 60_000;
    const end = start + duration;
    if (start >= from.getTime()) return { start: new Date(start), end: new Date(end) };
    if (end - from.getTime() >= 30 * 60_000) return { start: new Date(from), end: new Date(end) };
  }
  return null;
}

// ───────────────────────────── Rollouts ─────────────────────────────

export type RolloutState = "scheduled" | "dispatched" | "deployed" | "done" | "failed" | "manual" | "cancelled";
const OPEN: RolloutState[] = ["scheduled", "dispatched", "deployed", "manual"];

export interface RolloutClient {
  name: string;
  projectId: string;
  /** Version the client ran when the rollout was created. */
  from?: string;
  state: RolloutState;
  scheduledFor: string;
  windowEnd?: string;
  deploymentId?: string;
  dispatchedAt?: string;
  doneAt?: string;
  error?: string;
}

export interface Rollout {
  id: string;
  version: string;
  mode: "now" | "window" | "at";
  message?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "done" | "cancelled";
  clientIds: string[];
  clients: Record<string, RolloutClient>;
}

/** An hour's notice: clients check in hourly, so they see the notice before the update starts. */
export const NOTICE_LEAD_MS = 60 * 60_000;

export async function createRollout(deps: Deps, actor: Actor, d: Record<string, unknown>): Promise<{ id: string; dispatched: number }> {
  const { db, now } = deps;
  const version = str(d.version, 20);
  if (!VERSION.test(version)) throw bad("Choose a version");
  const release = (await db.collection("releases").doc(releaseId(version)).get()).data() as Release | undefined;
  if (!release) throw new ActionError("not-found", `Version ${version} isn't in the catalogue: sync the release notes first.`);
  const mode = d.mode === "now" || d.mode === "at" ? d.mode : "window";
  let at: Date | null = null;
  if (mode === "at") {
    at = new Date(str(d.at, 40));
    if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime() - 60_000) throw bad("Choose a date and time in the future");
  }
  const ids = Array.isArray(d.clientIds) ? [...new Set(d.clientIds.map(String))].slice(0, 200) : [];
  if (!ids.length) throw bad("Choose at least one client");
  const open = (await db.collection("rollouts").where("status", "==", "active").get()).docs.map((x) => x.data() as Rollout);
  const clients: Record<string, RolloutClient> = {};
  for (const id of ids) {
    const snap = await db.collection("clients").doc(id).get();
    if (!snap.exists) throw new ActionError("not-found", `No client ${id}`);
    const c = snap.data() as ConsoleClient;
    if (c.status === "cancelled" || c.enabled === false) throw bad(`${c.name} is cancelled or switched off for updates`);
    if (c.health?.appVersion && compareVersions(c.health.appVersion, version) >= 0 && d.force !== true) throw bad(`${c.name} already runs ${c.health.appVersion}`);
    const busy = open.find((r) => r.clients[id] && OPEN.includes(r.clients[id]!.state));
    if (busy) throw bad(`${c.name} is already in the rollout of ${busy.version}: cancel it there first`);
    let start: Date;
    let end: Date | undefined;
    if (mode === "now") start = now;
    else if (mode === "at") start = at!;
    else {
      const w = nextWindow(c.maintenanceWindow, new Date(now.getTime() + NOTICE_LEAD_MS));
      if (!w) throw bad(`${c.name}'s maintenance window "${c.maintenanceWindow}" isn't readable (like 23:30-05:00 Asia/Colombo)`);
      start = w.start;
      end = w.end;
    }
    clients[id] = { name: c.name, projectId: c.projectId, ...(c.health?.appVersion ? { from: c.health.appVersion } : {}), state: "scheduled", scheduledFor: start.toISOString(), ...(end ? { windowEnd: end.toISOString() } : {}) };
  }
  const ref = db.collection("rollouts").doc();
  const message = str(d.message, 400);
  const rollout: Rollout = { id: ref.id, version, mode, ...(message ? { message } : {}), createdBy: actor.email, createdAt: now.toISOString(), updatedAt: now.toISOString(), status: "active", clientIds: ids, clients };
  await ref.set(rollout);
  await audit(deps, actor, "createRollout", ids.length === 1 ? ids[0]! : null, `${version} to ${Object.values(clients).map((c) => c.name).join(", ")} (${mode === "now" ? "now" : mode === "at" ? `at ${at!.toISOString()}` : "in each maintenance window"})`);
  const { dispatched } = await runRollouts(deps);
  return { id: ref.id, dispatched };
}

export async function cancelRollout(deps: Deps, actor: Actor, d: Record<string, unknown>): Promise<{ cancelled: number }> {
  const ref = deps.db.collection("rollouts").doc(str(d.rolloutId, 60));
  const r = (await ref.get()).data() as Rollout | undefined;
  if (!r) throw new ActionError("not-found", "No such rollout");
  const only = typeof d.clientId === "string" ? d.clientId : null;
  let n = 0;
  for (const [id, c] of Object.entries(r.clients)) {
    if (only && id !== only) continue;
    if (c.state === "scheduled" || c.state === "manual") {
      c.state = "cancelled";
      n++;
    }
  }
  if (only && !n) throw new ActionError("failed-precondition", "That update has already started on GitHub and can't be cancelled here.");
  finish(r, deps.now);
  await ref.set(r);
  await audit(deps, actor, "cancelRollout", only, `${r.version}: ${n} client(s) cancelled`);
  return { cancelled: n };
}

/** For updates run by hand: mark a client failed, or done when its check-in can't confirm it. */
export async function markRollout(deps: Deps, actor: Actor, d: Record<string, unknown>): Promise<{ ok: true }> {
  const ref = deps.db.collection("rollouts").doc(str(d.rolloutId, 60));
  const r = (await ref.get()).data() as Rollout | undefined;
  const id = str(d.clientId, 60);
  const c = r?.clients[id];
  if (!r || !c) throw new ActionError("not-found", "No such client in the rollout");
  const state = d.state === "failed" ? "failed" : d.state === "done" ? "done" : d.state === "scheduled" ? "scheduled" : null;
  if (!state) throw bad("state");
  c.state = state;
  if (state === "done") c.doneAt = deps.now.toISOString();
  if (state === "scheduled") {
    c.scheduledFor = deps.now.toISOString();
    delete c.error;
    delete c.deploymentId;
  }
  const note = str(d.note, 300);
  if (note) c.error = note;
  r.status = "active";
  finish(r, deps.now);
  await ref.set(r);
  await audit(deps, actor, "markRollout", id, `${r.version}: ${state}${note ? ` (${note})` : ""}`);
  if (state === "scheduled") await runRollouts(deps);
  return { ok: true };
}

function finish(r: Rollout, now: Date) {
  r.updatedAt = now.toISOString();
  if (r.status === "active" && Object.values(r.clients).every((c) => !OPEN.includes(c.state))) r.status = Object.values(r.clients).every((c) => c.state === "cancelled") ? "cancelled" : "done";
}

/** The release tool's client list for the workflow (only the clients being updated need to be right). */
export function registryFor(clients: ConsoleClient[], g: { stagingProjectId?: string }) {
  return {
    staging: g.stagingProjectId ? { id: "staging", name: "Staging", projectId: g.stagingProjectId, region: "asia-south1", backupBucket: `gs://${g.stagingProjectId}-backups` } : { id: "staging", name: "Staging", projectId: "REPLACE" },
    clients: clients.filter((c) => c.status !== "cancelled").map((c) => ({ id: c.id, name: c.name, projectId: c.projectId, region: c.region, wave: c.wave, maintenanceWindow: c.maintenanceWindow, backupBucket: `gs://${c.projectId}-backups`, enabled: c.enabled !== false })),
  };
}

/** Follows the console's GitHub runs (deployments/*). */
export async function followRuns(deps: Deps, g: GithubConfig, token: string): Promise<void> {
  const runs = await recentRuns(g, token, deps.fetch);
  const open = await deps.db.collection("deployments").where("status", "in", ["requested", "queued", "in_progress", "waiting", "pending"]).get();
  for (const d of open.docs) {
    const run = runs.find((r) => r.title.includes(d.id));
    if (run) await d.ref.set({ status: run.status === "completed" ? (run.conclusion ?? "completed") : run.status, run }, { merge: true });
  }
}

const RUN_OK = ["success", "completed"];
const RUN_BAD = ["failure", "failed", "cancelled", "timed_out", "startup_failure"];

/**
 * Starts the updates that are due and follows the ones running (every 15 minutes, and right after a
 * rollout is created). Without a GitHub connection, due clients are marked "manual" with the command.
 */
export async function runRollouts(deps: Deps): Promise<{ dispatched: number }> {
  const { db, now } = deps;
  const active = await db.collection("rollouts").where("status", "==", "active").get();
  if (active.empty) return { dispatched: 0 };
  let g: (GithubConfig & { stagingProjectId?: string }) | null = null;
  try {
    g = await githubConfig(deps);
  } catch {
    g = null;
  }
  const token = (() => {
    try {
      return deps.githubToken();
    } catch {
      return "";
    }
  })();
  const github = g && token && token !== "none" ? g : null;
  if (github) await followRuns(deps, github, token).catch(() => undefined);
  let dispatched = 0;
  for (const snap of active.docs) {
    const r = snap.data() as Rollout;
    // Follow what was started.
    for (const c of Object.values(r.clients)) {
      if (c.state !== "dispatched" || !c.deploymentId) continue;
      const dep = (await db.collection("deployments").doc(c.deploymentId).get()).data() as { status?: string; error?: string; run?: { url?: string } } | undefined;
      if (dep?.status && RUN_OK.includes(dep.status)) c.state = "deployed";
      else if (dep?.status && RUN_BAD.includes(dep.status)) {
        c.state = "failed";
        c.error = dep.error || `GitHub run ${dep.status}${dep.run?.url ? ` (${dep.run.url})` : ""}`;
      }
    }
    // Start what is due.
    const due = Object.entries(r.clients).filter(([, c]) => c.state === "scheduled" && Date.parse(c.scheduledFor) <= now.getTime());
    if (due.length) {
      const ids = due.map(([id]) => id);
      if (!github) {
        for (const [, c] of due) {
          c.state = "manual";
          c.error = `No GitHub connection: on the release PC, check out ${r.version} and run  pnpm release:deploy --target ${ids.join(",")}`;
        }
      } else {
        let ref: string | null = null;
        let why = "";
        try {
          if (await tagExists(github, token, `v${r.version}`, deps.fetch)) ref = `v${r.version}`;
          else {
            const onBranch = await releaseBranchVersion(github, token, deps.fetch);
            if (onBranch === r.version) ref = github.ref;
            else why = `${r.version} isn't on ${github.ref} any more (it has ${onBranch ?? "no version"}) and there is no tag v${r.version}`;
          }
        } catch (e) {
          why = (e as Error).message;
        }
        if (!ref) {
          for (const [, c] of due) {
            c.state = "failed";
            c.error = why;
          }
        } else {
          const clients = (await db.collection("clients").get()).docs.map((x) => x.data() as ConsoleClient);
          const depRef = db.collection("deployments").doc();
          await depRef.set({ id: depRef.id, target: ids.join(","), requestedBy: `rollout of ${r.version} (${r.createdBy})`, at: now.toISOString(), status: "requested", rolloutId: r.id, version: r.version, ref });
          try {
            await dispatchRelease(github, token, { target: ids.join(","), registry: JSON.stringify(registryFor(clients, github)), requestId: depRef.id }, deps.fetch, ref);
            for (const [, c] of due) {
              c.state = "dispatched";
              c.deploymentId = depRef.id;
              c.dispatchedAt = now.toISOString();
              delete c.error;
            }
            dispatched += due.length;
          } catch (e) {
            await depRef.set({ status: "failed", error: (e as Error).message }, { merge: true });
            for (const [, c] of due) {
              c.state = "failed";
              c.error = (e as Error).message;
            }
          }
        }
      }
    }
    finish(r, now);
    await snap.ref.set(r);
  }
  return { dispatched };
}

/**
 * At a client's check-in: marks it done once it reports the version, and returns the maintenance
 * notice for an update still to come (null when none).
 */
export async function rolloutAtCheckin(db: Firestore, client: ConsoleClient, appVersion: string, now: Date): Promise<UpdateNotice | null> {
  const snaps = await db.collection("rollouts").where("clientIds", "array-contains", client.id).get();
  let notice: UpdateNotice | null = null;
  for (const snap of snaps.docs.sort((a, b) => String(b.data().createdAt).localeCompare(String(a.data().createdAt)))) {
    const r = snap.data() as Rollout;
    const c = r.clients[client.id];
    if (!c || !OPEN.includes(c.state)) continue;
    if (compareVersions(appVersion, r.version) >= 0) {
      c.state = "done";
      c.doneAt = now.toISOString();
      delete c.error;
      finish(r, now);
      await snap.ref.set(r);
      continue;
    }
    if (notice) continue;
    const release = (await db.collection("releases").doc(releaseId(r.version)).get()).data() as Release | undefined;
    notice = {
      version: r.version,
      state: c.state === "dispatched" ? "updating" : c.state === "deployed" ? "deployed" : "scheduled",
      at: c.scheduledFor,
      ...(c.windowEnd ? { until: c.windowEnd } : {}),
      ...(release?.highlights.length ? { highlights: release.highlights.slice(0, 6) } : {}),
      ...(r.message ? { message: r.message } : {}),
    };
  }
  return notice;
}
