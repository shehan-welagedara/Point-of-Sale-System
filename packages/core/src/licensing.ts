/**
 * Licensing: editions, entitlements and signed licence keys.
 *
 * The model follows current cloud/SaaS licensing practice (Keygen, Cryptlex, Salesforce/Oracle
 * Cloud subscriptions):
 *
 * - An **edition** (plan) is a bundle of modules plus usage limits. **Add-ons** extend it.
 * - What a client may use is their **entitlement**: modules + limits (properties, revenue centres,
 *   workstations, employees, back-office users) + validity (subscription term, grace period).
 * - The vendor issues a **licence key**: the entitlement as JSON, signed with the vendor's
 *   private key (ECDSA P-256 / SHA-256). The app and the Cloud Functions verify it with the
 *   public key only, so nobody can raise their own entitlement without the vendor's key.
 * - The licence is bound to a deployment (Firebase project id) and optionally to one business.
 * - Inside the entitlement, the client's administrator switches modules on or off.
 */
import { ecdsaP256Verify, requireSubtle } from "./cryptox.js";
import { MODULES, type ModuleKey } from "./modules.js";

export type Edition = "demo" | "trial" | "starter" | "professional" | "enterprise";

export interface UsageLimits {
  properties: number;
  revenueCenters: number;
  workstations: number;
  employees: number;
  backOfficeUsers: number;
}

export type LimitKey = keyof UsageLimits;

export interface Entitlements {
  modules: ModuleKey[];
  limits: UsageLimits;
}

export interface LicencePayload {
  v: 1;
  licenceId: string;
  licensee: { name: string; email?: string; tin?: string };
  edition: Edition;
  addOns: ModuleKey[];
  entitlements: Entitlements;
  /** Firebase project id the licence is valid in ("*" = any, for demos). */
  projectId: string;
  /** Business (tenant) id, or "*" for any business in the project. */
  tenantId: string;
  billing: "subscription" | "perpetual" | "trial";
  issuedAt: string;
  validFrom: string;
  /** Subscription end (perpetual licences: support/updates end). */
  expiresAt: string;
  /** Days of full use after expiry before the system turns read-only. */
  graceDays: number;
}

export interface EditionInfo {
  key: Edition;
  name: string;
  description: string;
  modules: ModuleKey[];
  limits: UsageLimits;
  /** Modules that can be bought on top of this edition. */
  addOns: ModuleKey[];
}

const POS_CORE: ModuleKey[] = ["pos", "tables", "crm", "lankaqr", "payhere", "revenue"];
const BACK_OF_HOUSE: ModuleKey[] = ["kds", "recipes", "inventory", "purchasing", "loyalty", "whatsapp"];
const available = () => MODULES.filter((m) => m.status === "available").map((m) => m.key);

export const EDITIONS: readonly EditionInfo[] = [
  {
    key: "starter",
    name: "Starter",
    description: "One outlet: POS, tables, customers, LankaQR/PayHere and sales reports.",
    modules: POS_CORE,
    limits: { properties: 1, revenueCenters: 2, workstations: 3, employees: 40, backOfficeUsers: 3 },
    addOns: ["kds", "recipes", "inventory", "purchasing", "loyalty", "whatsapp", "accounting", "wholesale", "whatsappCommerce"],
  },
  {
    key: "professional",
    name: "Professional",
    description: "Restaurants and small hotels: adds kitchen display, recipes and costing, inventory, purchasing, loyalty and WhatsApp reports.",
    modules: [...POS_CORE, ...BACK_OF_HOUSE],
    limits: { properties: 2, revenueCenters: 8, workstations: 12, employees: 200, backOfficeUsers: 10 },
    addOns: ["accounting", "wholesale", "whatsappCommerce"],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Hotels and groups: every module including the general ledger and audit, multiple properties.",
    modules: available(),
    limits: { properties: 25, revenueCenters: 150, workstations: 300, employees: 5000, backOfficeUsers: 250 },
    addOns: [],
  },
  {
    key: "trial",
    name: "Trial",
    description: "Every module for 30 days, small limits.",
    modules: available(),
    limits: { properties: 1, revenueCenters: 3, workstations: 3, employees: 25, backOfficeUsers: 3 },
    addOns: [],
  },
  {
    key: "demo",
    name: "Demo",
    description: "Vendor demonstration: every module, not for live trading.",
    modules: available(),
    limits: { properties: 5, revenueCenters: 20, workstations: 20, employees: 500, backOfficeUsers: 20 },
    addOns: [],
  },
];

export function editionInfo(e: Edition): EditionInfo {
  return EDITIONS.find((x) => x.key === e) ?? EDITIONS[0]!;
}

/** Edition + add-ons (+ dependencies of everything) → entitlements. */
export function buildEntitlements(edition: Edition, addOns: ModuleKey[] = [], limits: Partial<UsageLimits> = {}): Entitlements {
  const info = editionInfo(edition);
  const set = new Set<ModuleKey>([...info.modules, ...addOns]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const k of [...set]) {
      for (const r of MODULES.find((m) => m.key === k)?.requires ?? []) {
        if (!set.has(r)) {
          set.add(r);
          grew = true;
        }
      }
    }
  }
  return { modules: MODULES.map((m) => m.key).filter((k) => set.has(k)), limits: { ...info.limits, ...limits } };
}

/** Entitlements of a business that has no licence key yet (a new trial or the demo). */
export function builtInEntitlements(plan: string | undefined): Entitlements {
  return buildEntitlements(plan === "demo" ? "demo" : "trial");
}

export const TRIAL_DAYS = 30;

// ───────────────────────────── Signing and verification ─────────────────────────────

const PREFIX = "POSL1";

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

const ALG = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

/** New vendor key pair. Keep the private key secret (never in the repository or the app). */
export async function generateLicenceKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const s = requireSubtle("Generating licence keys");
  const kp = (await s.generateKey(ALG, true, ["sign", "verify"])) as CryptoKeyPair;
  const pub = new Uint8Array(await s.exportKey("spki", kp.publicKey));
  const priv = new Uint8Array(await s.exportKey("pkcs8", kp.privateKey));
  return { publicKey: b64url(pub), privateKey: b64url(priv) };
}

export async function signLicence(payload: LicencePayload, privateKey: string): Promise<string> {
  const s = requireSubtle("Signing licences");
  const key = await s.importKey("pkcs8", unb64url(privateKey) as BufferSource, ALG, false, ["sign"]);
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await s.sign(SIGN, key, new TextEncoder().encode(`${PREFIX}.${body}`)));
  return `${PREFIX}.${body}.${b64url(sig)}`;
}

export class LicenceError extends Error {}

/** Checks the signature and returns the payload (does not check dates or binding). */
export async function decodeLicence(token: string, publicKey: string): Promise<LicencePayload> {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new LicenceError("Not a licence key");
  const ok = await ecdsaP256Verify(unb64url(publicKey), unb64url(parts[2]!), new TextEncoder().encode(`${PREFIX}.${parts[1]}`));
  if (!ok) throw new LicenceError("The licence key's signature is not valid (altered, or issued with another key)");
  const payload = JSON.parse(new TextDecoder().decode(unb64url(parts[1]!))) as LicencePayload;
  if (payload.v !== 1) throw new LicenceError("Unsupported licence version");
  return payload;
}

export type LicenceStatus = "valid" | "grace" | "expired" | "notYetValid";

export interface LicenceCheck {
  status: LicenceStatus;
  /** Whole days until expiry (negative once expired). */
  daysLeft: number;
  /** Full use allowed (valid or within the grace period). */
  usable: boolean;
}

export function licenceStatus(p: Pick<LicencePayload, "validFrom" | "expiresAt" | "graceDays">, now: Date): LicenceCheck {
  const day = 86_400_000;
  const t = now.getTime();
  const daysLeft = Math.floor((Date.parse(p.expiresAt) - t) / day);
  if (t < Date.parse(p.validFrom)) return { status: "notYetValid", daysLeft, usable: false };
  if (t <= Date.parse(p.expiresAt)) return { status: "valid", daysLeft, usable: true };
  if (t <= Date.parse(p.expiresAt) + p.graceDays * day) return { status: "grace", daysLeft, usable: true };
  return { status: "expired", daysLeft, usable: false };
}

/** Full verification for activation: signature, binding and dates. */
export async function verifyLicence(token: string, publicKey: string, binding: { projectId: string; tenantId: string }, now: Date): Promise<{ payload: LicencePayload; check: LicenceCheck }> {
  const payload = await decodeLicence(token, publicKey);
  if (payload.projectId !== "*" && payload.projectId !== binding.projectId) throw new LicenceError(`This licence is for project "${payload.projectId}", not "${binding.projectId}"`);
  if (payload.tenantId !== "*" && payload.tenantId !== binding.tenantId) throw new LicenceError("This licence is for a different business");
  const check = licenceStatus(payload, now);
  if (check.status === "notYetValid") throw new LicenceError(`This licence starts on ${payload.validFrom.slice(0, 10)}`);
  if (check.status === "expired") throw new LicenceError(`This licence expired on ${payload.expiresAt.slice(0, 10)}`);
  return { payload, check };
}

// ───────────────────────────── Applying entitlements ─────────────────────────────

/** Modules the administrator may switch on: entitled and (for licences) not expired. */
export function allowedModules(ent: Entitlements | undefined, usable = true): Set<ModuleKey> {
  return usable && ent ? new Set(ent.modules) : new Set();
}

/** The tenant's module switches restricted to what the entitlement allows (dependencies kept). */
export function clampModules(requested: Partial<Record<ModuleKey, boolean>>, ent: Entitlements, usable = true): Record<ModuleKey, boolean> {
  const allowed = allowedModules(ent, usable);
  const on = new Set(MODULES.filter((m) => requested[m.key] && allowed.has(m.key)).map((m) => m.key));
  // A module whose dependency is off cannot run.
  let changed = true;
  while (changed) {
    changed = false;
    for (const k of [...on]) {
      if ((MODULES.find((m) => m.key === k)?.requires ?? []).some((r) => !on.has(r))) {
        on.delete(k);
        changed = true;
      }
    }
  }
  return Object.fromEntries(MODULES.map((m) => [m.key, on.has(m.key)])) as Record<ModuleKey, boolean>;
}

export const LIMIT_LABEL: Record<LimitKey, string> = {
  properties: "Properties (hotels / outlets)",
  revenueCenters: "Revenue centres",
  workstations: "POS workstations",
  employees: "Employees",
  backOfficeUsers: "Back-office users",
};

export interface LimitCheck {
  key: LimitKey;
  used: number;
  limit: number;
  ok: boolean;
}

/** Whether one more record of `key` may be added. */
export function canAdd(ent: Entitlements, key: LimitKey, used: number): LimitCheck {
  const limit = ent.limits[key];
  return { key, used, limit, ok: used < limit };
}

export function usageReport(ent: Entitlements, used: UsageLimits): LimitCheck[] {
  return (Object.keys(LIMIT_LABEL) as LimitKey[]).map((k) => ({ key: k, used: used[k], limit: ent.limits[k], ok: used[k] <= ent.limits[k] }));
}

/**
 * Public key of the bundled **demo** key pair. Its private key is in `tools/licence/demo-key.txt`
 * so anyone can issue demo licences with it: production deployments must use their own key pair
 * (`pnpm licence keygen`) and set VITE_LICENCE_PUBLIC_KEY / LICENCE_PUBLIC_KEY.
 */
export const DEMO_LICENCE_PUBLIC_KEY = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE85ylaqW1wjgPRsjQpHPcJzbLym6yTypROXgPgJbNik_kkKimzb3INbrq5HPDxUcQxzuHhzf-gm500yRWTw3N2Q";
