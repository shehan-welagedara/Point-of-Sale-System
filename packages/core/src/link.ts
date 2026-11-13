/**
 * The link between a client's system and the Polymath Console (docs/22-polymath-console.md).
 *
 * Once a day (or when an administrator presses "Check now") the client's server sends a check-in:
 * its version, devices, recent errors, licences and, if the owner allows, yesterday's figures. It
 * proves which Firebase project it runs in with a Google-signed identity token, so no secret is
 * shared. The console answers with the client's current licence key, its status (active or
 * suspended) as a **signed directive**, a notice to show, and Polymath Tech's contact details.
 *
 * Both the licence and the directive are signed with the vendor's licence key; the client checks
 * them with the public key it already has, so nobody else can upgrade, suspend or restore a client.
 */
import { ecdsaP256Verify, requireSubtle } from "./cryptox.js";
import type { Edition, LicenceStatus } from "./licensing.js";

export const LINK_PROTOCOL = 1;

/** One business (tenant) in the client's project, as reported at check-in. */
export interface CheckinTenant {
  id: string;
  name: string;
  plan: Edition;
  licence?: { licenceId: string; issuedAt?: string; expiresAt: string; status: LicenceStatus | "suspended" };
  modules: string[];
  devices: { id: string; appVersion?: string; lastSeenAt?: string }[];
  /** App errors reported by devices in the last 24 hours. */
  errors24h: number;
  counts: { workstations: number; employees: number; backOfficeUsers: number };
  /** Yesterday's figures (Asia/Colombo business date); null when the owner switched sharing off. */
  usage: { date: string; checks: number; covers: number; netSales: number; total: number } | null;
  shareUsage: boolean;
  /** Since 1.10.0: archived businesses are kept but hidden and closed to the POS. */
  status?: "active" | "archived";
  createdAt?: string;
  /** Since 1.10.0: Polymath Tech's approval of this business (none for businesses opened before approvals). */
  approval?: { requestId: string; approvedAt: string };
}

/** A request to open a new business, waiting for Polymath Tech (since 1.10.0; docs/22 §9). */
export interface BusinessRequest {
  /** The id the new business will have. */
  id: string;
  name: string;
  /** "demo": a demo or training business filled with sample data. */
  kind: "business" | "demo";
  modules: string[];
  requestedBy: { uid: string; email: string; name?: string };
  requestedAt: string;
  note?: string;
}

export interface CheckinRequest {
  v: 1;
  projectId: string;
  /** Version of the release deployed to the project (set by the release tool). */
  appVersion: string;
  sentAt: string;
  reason: "scheduled" | "manual";
  tenants: CheckinTenant[];
  /** Since 1.10.0: businesses waiting for approval. */
  businessRequests?: BusinessRequest[];
}

export interface SupplierContact {
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  website?: string;
}

export interface CheckinResponse {
  v: 1;
  ok: boolean;
  serverTime: string;
  clientId?: string;
  /** Current licence key for the project (the client applies it when newer than its own). */
  licence?: { token: string } | null;
  /** Signed active/suspended status. */
  directive?: { token: string } | null;
  /** A message for the client's owner and administrators (renewal reminders and the like). */
  notice?: { text: string; level: "info" | "warn" } | null;
  supplier?: SupplierContact;
  /** Since 1.10.0: an update Polymath Tech has scheduled for this system (null: none). */
  update?: UpdateNotice | null;
  /** Since 1.10.0: signed decisions on the business requests the client reported. */
  businessDecisions?: { token: string }[];
  /** Since 1.10.0: whether opening a new business needs Polymath Tech's approval. */
  approvals?: "required" | "off";
  error?: string;
}

/** An update scheduled from the console, as the client shows it (maintenance notice). */
export interface UpdateNotice {
  version: string;
  /** scheduled: announced; updating: the deploy has started; deployed: finished, waiting for the system to confirm. */
  state: "scheduled" | "updating" | "deployed";
  /** Start and end of the maintenance window (ISO). */
  at?: string;
  until?: string;
  /** The release's "For clients" notes, plain text. */
  highlights?: string[];
  message?: string;
}

/** The client's status, signed by the console. */
export interface StatusDirective {
  v: 1;
  type: "status";
  projectId: string;
  state: "active" | "suspended";
  /** When the suspension started (suspended only). */
  since?: string;
  /** Until then the client keeps working with a warning; after it, licensed modules stop. */
  graceUntil?: string;
  message?: string;
  issuedAt: string;
}

/** Polymath Tech's answer to a request to open a business, signed by the console. */
export interface BusinessDecision {
  v: 1;
  type: "business";
  projectId: string;
  requestId: string;
  decision: "approved" | "rejected";
  /** The person who asked (only they may open the approved business). */
  ownerUid: string;
  name: string;
  message?: string;
  issuedAt: string;
}

/** What the client keeps from the console on each business (written only by its server). */
export interface TenantSupplierLink {
  suspension?: { since: string; graceUntil: string; message?: string };
  update?: UpdateNotice;
  /** issuedAt of the last directive applied (older ones are ignored). */
  directiveAt?: string;
  notice?: { text: string; level: "info" | "warn" };
  contact?: SupplierContact;
  lastCheckinAt?: string;
  lastCheckinOk?: boolean;
  lastCheckinError?: string;
}

// ───────────────────────────── Signed directives ─────────────────────────────

const DIRECTIVE_PREFIX = "POSD1";
const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class DirectiveError extends Error {}

export async function signDirective(payload: StatusDirective | BusinessDecision, privateKey: string): Promise<string> {
  const s = requireSubtle("Signing directives");
  const key = await s.importKey("pkcs8", unb64url(privateKey) as BufferSource, ALG, false, ["sign"]);
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await s.sign(SIGN, key, new TextEncoder().encode(`${DIRECTIVE_PREFIX}.${body}`)));
  return `${DIRECTIVE_PREFIX}.${body}.${b64url(sig)}`;
}

async function verifySigned(token: string, publicKey: string, projectId: string, type: string): Promise<{ v: number; type: string; projectId: string }> {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== DIRECTIVE_PREFIX) throw new DirectiveError("Not a signed directive");
  const ok = await ecdsaP256Verify(unb64url(publicKey), unb64url(parts[2]!), new TextEncoder().encode(`${DIRECTIVE_PREFIX}.${parts[1]}`));
  if (!ok) throw new DirectiveError("The directive's signature is not valid");
  const d = JSON.parse(new TextDecoder().decode(unb64url(parts[1]!))) as { v: number; type: string; projectId: string };
  if (d.v !== 1 || d.type !== type) throw new DirectiveError("Unsupported directive");
  if (d.projectId !== projectId) throw new DirectiveError(`This directive is for project "${d.projectId}"`);
  return d;
}

/** Checks the signature and that the directive is for this project. */
export async function verifyDirective(token: string, publicKey: string, projectId: string): Promise<StatusDirective> {
  return (await verifySigned(token, publicKey, projectId, "status")) as StatusDirective;
}

/** Checks a decision on a business request (signature, project). */
export async function verifyBusinessDecision(token: string, publicKey: string, projectId: string): Promise<BusinessDecision> {
  const d = (await verifySigned(token, publicKey, projectId, "business")) as BusinessDecision;
  if (typeof d.requestId !== "string" || !["approved", "rejected"].includes(d.decision) || typeof d.ownerUid !== "string") throw new DirectiveError("Incomplete business decision");
  return d;
}

/** Business names compared for duplicates: case, accents, spaces, punctuation, "(demo)", "Pvt Ltd" and the like ignored. */
export function businessKey(name: string): string {
  const plain = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\(demo\)/g, " ");
  const key = (s: string) => s.replace(/[^a-z0-9\u0d80-\u0dff\u0b80-\u0bff]+/g, "");
  return key(plain.replace(/\b(the|pvt|ltd|private|limited|restaurant|cafe)\b/g, " ")) || key(plain);
}

/** The public half of a vendor key pair (to show and check which key the console signs with). */
export async function publicKeyFromPrivate(privateKey: string): Promise<string> {
  const s = requireSubtle("Reading the licence key");
  const priv = await s.importKey("pkcs8", unb64url(privateKey) as BufferSource, ALG, true, ["sign"]);
  const jwk = (await s.exportKey("jwk", priv)) as JsonWebKey;
  const pub = await s.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x!, y: jwk.y!, ext: true }, ALG, true, ["verify"]);
  return b64url(new Uint8Array(await s.exportKey("spki", pub)));
}

// ───────────────────────────── Suspension ─────────────────────────────

export interface SuspensionInfo {
  /** none: active; grace: suspended, still working with a warning; blocked: licensed modules stop. */
  state: "none" | "grace" | "blocked";
  graceUntil?: string;
  message?: string;
  daysLeft?: number;
}

export function suspensionInfo(link: TenantSupplierLink | undefined, now: Date): SuspensionInfo {
  const s = link?.suspension;
  if (!s) return { state: "none" };
  const left = Math.ceil((Date.parse(s.graceUntil) - now.getTime()) / 86_400_000);
  return { state: now.getTime() <= Date.parse(s.graceUntil) ? "grace" : "blocked", graceUntil: s.graceUntil, ...(s.message ? { message: s.message } : {}), daysLeft: left };
}

/** Business date (YYYY-MM-DD) in Sri Lanka, `days` from `now`. */
export function colomboDate(now: Date, days = 0): string {
  return new Date(now.getTime() + days * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
