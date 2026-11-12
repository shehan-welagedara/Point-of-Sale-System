/**
 * The console's records and the rules about them that don't need the database (so they're unit-tested):
 * roles, health, subscriptions, renewal notices, and check-in validation.
 */
import type { CheckinRequest, Edition, ModuleKey, SupplierContact, UsageLimits } from "@pos/core";

export const STAFF_ROLES = ["owner", "admin", "sales", "support", "engineer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission = "read" | "clients" | "licences" | "suspend" | "deploy" | "staff" | "settings";

const MATRIX: Record<StaffRole, Permission[]> = {
  owner: ["read", "clients", "licences", "suspend", "deploy", "staff", "settings"],
  admin: ["read", "clients", "licences", "suspend", "deploy", "staff", "settings"],
  sales: ["read", "clients", "licences"],
  support: ["read"],
  engineer: ["read", "deploy"],
};

export function can(role: string | undefined, p: Permission): boolean {
  return Boolean(role && (STAFF_ROLES as readonly string[]).includes(role) && MATRIX[role as StaffRole].includes(p));
}

export interface Subscription {
  plan: string;
  /** Price per cycle, in rupees (whole). */
  priceLkr: number;
  cycle: "monthly" | "quarterly" | "annual" | "perpetual";
  startedOn?: string;
  /** Paid up to and including this date (YYYY-MM-DD). */
  paidUntil?: string;
  cancelled?: boolean;
  notes?: string;
}

export interface ClientLicence {
  licenceId: string;
  edition: Edition;
  addOns: ModuleKey[];
  limits: UsageLimits;
  tenantId: string;
  issuedAt: string;
  validFrom: string;
  expiresAt: string;
  graceDays: number;
  billing: "subscription" | "perpetual" | "trial";
  token: string;
  issuedBy: string;
}

export interface ClientHealth {
  lastCheckinAt: string;
  appVersion: string;
  reason: string;
  tenants: {
    id: string;
    name: string;
    plan: string;
    licence?: { licenceId: string; expiresAt: string; status: string };
    modules: string[];
    devices: { id: string; appVersion?: string; lastSeenAt?: string }[];
    errors24h: number;
    counts: { workstations: number; employees: number; backOfficeUsers: number };
    shareUsage: boolean;
  }[];
}

export interface ConsoleClient {
  id: string;
  name: string;
  legalName?: string;
  contact?: { name?: string; email?: string; phone?: string };
  address?: string;
  /** For the dashboard's map and lists. country: ISO 3166 two-letter code (LK, MV, …). */
  industry?: string;
  city?: string;
  country?: string;
  notes?: string;
  projectId: string;
  projectNumber?: string;
  region: string;
  wave: number;
  maintenanceWindow?: string;
  enabled: boolean;
  status: "active" | "suspended" | "cancelled";
  subscription?: Subscription;
  licence?: ClientLicence;
  suspension?: { since: string; graceDays: number; graceUntil: string; message: string; reason?: string; by: string };
  directive?: { token: string; state: "active" | "suspended"; issuedAt: string };
  notice?: { text: string; level: "info" | "warn"; until?: string };
  health?: ClientHealth;
  link?: { pendingProjectNumber?: string; pendingAt?: string; lastError?: string; lastErrorAt?: string };
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SUPPLIER: SupplierContact = { name: "Polymath Tech" };

export const INDUSTRIES = ["Restaurant", "Café", "Bakery", "Bar & pub", "Hotel", "Resort", "Catering", "Retail", "Other"] as const;

const DAY = 86_400_000;
const dayStart = (d: string) => Date.parse(`${d}T00:00:00+05:30`);

/** paid: paid ahead; due: renewal within 14 days; overdue: past paid-until; none/cancelled. */
export function subscriptionState(s: Subscription | undefined, now: Date): { state: "none" | "paid" | "due" | "overdue" | "cancelled" | "perpetual"; daysLeft?: number } {
  if (!s) return { state: "none" };
  if (s.cancelled) return { state: "cancelled" };
  if (s.cycle === "perpetual") return { state: "perpetual" };
  if (!s.paidUntil) return { state: "due", daysLeft: 0 };
  const daysLeft = Math.floor((dayStart(s.paidUntil) + DAY - now.getTime()) / DAY);
  if (daysLeft < 0) return { state: "overdue", daysLeft };
  return { state: daysLeft <= 14 ? "due" : "paid", daysLeft };
}

/** Health for the dashboard: offline after 36 hours without a check-in. */
export function healthState(c: Pick<ConsoleClient, "health" | "status" | "licence">, latestVersion: string | undefined, now: Date): { state: "unknown" | "ok" | "attention" | "offline"; reasons: string[] } {
  const reasons: string[] = [];
  if (!c.health) return { state: "unknown", reasons: ["no check-in yet"] };
  const age = now.getTime() - Date.parse(c.health.lastCheckinAt);
  if (age > 36 * 3600_000) reasons.push(`not seen for ${Math.floor(age / DAY)} day(s)`);
  const errors = c.health.tenants.reduce((n, t) => n + t.errors24h, 0);
  if (errors) reasons.push(`${errors} app error(s) in 24 h`);
  if (latestVersion && compareVersions(c.health.appVersion, latestVersion) < 0) reasons.push(`runs ${c.health.appVersion} (latest ${latestVersion})`);
  const old = latestVersion ? c.health.tenants.flatMap((t) => t.devices).filter((d) => d.appVersion && compareVersions(d.appVersion, latestVersion) < 0).length : 0;
  if (old) reasons.push(`${old} device(s) on an older version`);
  if (c.licence) {
    const left = Math.floor((Date.parse(c.licence.expiresAt) - now.getTime()) / DAY);
    if (left < 0) reasons.push("licence expired");
    else if (left <= 30) reasons.push(`licence ends in ${left} day(s)`);
  }
  if (age > 36 * 3600_000) return { state: "offline", reasons };
  return { state: reasons.length ? "attention" : "ok", reasons };
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number(x) || 0);
  const pb = b.split(/[.-]/).map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const lkr = (n: number) => `Rs ${n.toLocaleString("en-LK")}`;
const longDate = (d: string) => new Date(dayStart(d) + DAY / 2).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Colombo" });

/** The notice the client's owner sees: the staff's own message, else a renewal reminder. */
export function noticeFor(c: Pick<ConsoleClient, "notice" | "subscription">, supplierName: string, now: Date): { text: string; level: "info" | "warn" } | null {
  if (c.notice?.text && (!c.notice.until || Date.parse(c.notice.until) >= now.getTime())) return { text: c.notice.text, level: c.notice.level };
  const s = subscriptionState(c.subscription, now);
  const sub = c.subscription;
  if (!sub?.paidUntil) return null;
  if (s.state === "due") return { text: `Your ${supplierName} subscription renews on ${longDate(sub.paidUntil)}${sub.priceLkr ? ` (${lkr(sub.priceLkr)})` : ""}. Thank you for renewing on time.`, level: "info" };
  if (s.state === "overdue") return { text: `Your ${supplierName} subscription was due on ${longDate(sub.paidUntil)}. Please contact ${supplierName} to renew.`, level: "warn" };
  return null;
}

/** Check-in bodies come from client servers; still, never store unbounded data. */
export function validateCheckin(b: unknown): CheckinRequest {
  const r = b as CheckinRequest;
  if (!r || typeof r !== "object" || r.v !== 1) throw new Error("unsupported check-in");
  if (typeof r.projectId !== "string" || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(r.projectId)) throw new Error("bad projectId");
  if (typeof r.appVersion !== "string" || r.appVersion.length > 40) throw new Error("bad appVersion");
  if (!Array.isArray(r.tenants) || r.tenants.length > 50) throw new Error("bad tenants");
  for (const t of r.tenants) {
    if (typeof t.id !== "string" || t.id.length > 64 || typeof t.name !== "string") throw new Error("bad tenant");
    t.name = t.name.slice(0, 120);
    t.devices = (Array.isArray(t.devices) ? t.devices : []).slice(0, 100).map((d) => ({
      id: String(d.id).slice(0, 64),
      ...(d.appVersion ? { appVersion: String(d.appVersion).slice(0, 40) } : {}),
      ...(d.lastSeenAt ? { lastSeenAt: String(d.lastSeenAt).slice(0, 40) } : {}),
    }));
    t.modules = (Array.isArray(t.modules) ? t.modules : []).slice(0, 40).map(String);
    t.errors24h = Math.max(0, Math.min(Number(t.errors24h) || 0, 1_000_000));
  }
  return r;
}

const CYCLE_MONTHS: Record<Subscription["cycle"], number> = { monthly: 1, quarterly: 3, annual: 12, perpetual: 0 };

/** The subscription's monthly equivalent in rupees (0 for perpetual or cancelled). */
export function monthlyLkr(s: Subscription | undefined): number {
  if (!s || s.cancelled || !CYCLE_MONTHS[s.cycle]) return 0;
  return s.priceLkr / CYCLE_MONTHS[s.cycle];
}

/** One day's figures for the dashboard's trends (metrics/{date}). */
export interface DailyMetrics {
  date: string;
  at: string;
  clients: number;
  active: number;
  suspended: number;
  /** Checked in within 36 hours. */
  reporting: number;
  healthy: number;
  attention: number;
  offline: number;
  noCheckin: number;
  licencesValid: number;
  paid: number;
  due: number;
  overdue: number;
  /** Monthly recurring revenue: every live subscription at its monthly equivalent. */
  mrrLkr: number;
  versions: Record<string, number>;
}

export function dailyMetrics(clients: ConsoleClient[], latestVersion: string | undefined, now: Date): DailyMetrics {
  const live = clients.filter((c) => c.status !== "cancelled");
  const health = live.map((c) => healthState(c, latestVersion, now).state);
  const subs = live.map((c) => subscriptionState(c.subscription, now).state);
  const versions: Record<string, number> = {};
  for (const c of live) if (c.health?.appVersion) versions[c.health.appVersion.replace(/\./g, "_")] = (versions[c.health.appVersion.replace(/\./g, "_")] ?? 0) + 1;
  return {
    date: new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10),
    at: now.toISOString(),
    clients: live.length,
    active: live.filter((c) => c.status === "active").length,
    suspended: live.filter((c) => c.status === "suspended").length,
    reporting: health.filter((h) => h === "ok" || h === "attention").length,
    healthy: health.filter((h) => h === "ok").length,
    attention: health.filter((h) => h === "attention").length,
    offline: health.filter((h) => h === "offline").length,
    noCheckin: health.filter((h) => h === "unknown").length,
    licencesValid: live.filter((c) => c.licence && Date.parse(c.licence.expiresAt) >= now.getTime()).length,
    paid: subs.filter((x) => x === "paid" || x === "perpetual").length,
    due: subs.filter((x) => x === "due").length,
    overdue: subs.filter((x) => x === "overdue").length,
    mrrLkr: Math.round(live.reduce((n, c) => n + monthlyLkr(c.subscription), 0)),
    versions,
  };
}
