/** What every console action shares: the caller, the dependencies, errors, checks and the audit log. */
import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type { GithubConfig } from "./github.js";
import { type ConsoleClient, type Permission, type StaffRole, can } from "./model.js";

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

export const bad = (m: string) => new ActionError("invalid-argument", m);
export const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const ID = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const PROJECT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function need(actor: Actor, p: Permission) {
  if (!can(actor.role, p)) throw new ActionError("permission-denied", `Your role (${actor.role ?? "none"}) can't do this.`);
}

export async function audit(deps: Deps, actor: Actor, action: string, clientId: string | null, summary: string) {
  await deps.db.collection("audit").add({ at: deps.now.toISOString(), uid: actor.uid, email: actor.email, role: actor.role ?? null, action, clientId, summary });
}

export async function getClient(deps: Deps, id: unknown): Promise<{ ref: DocumentReference; c: ConsoleClient }> {
  if (typeof id !== "string" || !ID.test(id)) throw bad("clientId is required");
  const ref = deps.db.collection("clients").doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw new ActionError("not-found", `No client ${id}`);
  return { ref, c: snap.data() as ConsoleClient };
}

export async function githubConfig(deps: Deps): Promise<GithubConfig & { stagingProjectId?: string }> {
  const g = (await deps.db.doc("config/github").get()).data() as (GithubConfig & { stagingProjectId?: string }) | undefined;
  if (!g?.owner || !g.repo) throw new ActionError("failed-precondition", "Set the GitHub repository first (Settings → GitHub).");
  return { ...g, workflow: g.workflow || "release.yml", ref: g.ref || "main" };
}

