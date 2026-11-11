/** Console records as the screens read them (written only by the console's server functions). */
export interface Subscription {
  plan: string;
  priceLkr: number;
  cycle: "monthly" | "quarterly" | "annual" | "perpetual";
  startedOn?: string;
  paidUntil?: string;
  cancelled?: boolean;
  notes?: string;
}

export interface ClientLicence {
  licenceId: string;
  edition: string;
  addOns: string[];
  limits: Record<string, number>;
  tenantId: string;
  issuedAt: string;
  validFrom: string;
  expiresAt: string;
  graceDays: number;
  billing: string;
  token: string;
  issuedBy: string;
}

export interface HealthTenant {
  id: string;
  name: string;
  plan: string;
  licence?: { licenceId: string; expiresAt: string; status: string };
  modules: string[];
  devices: { id: string; appVersion?: string; lastSeenAt?: string }[];
  errors24h: number;
  counts: { workstations: number; employees: number; backOfficeUsers: number };
  shareUsage: boolean;
}

export interface Client {
  id: string;
  name: string;
  legalName?: string;
  contact?: { name?: string; email?: string; phone?: string };
  address?: string;
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
  notice?: { text: string; level: "info" | "warn"; until?: string };
  health?: { lastCheckinAt: string; appVersion: string; reason: string; tenants: HealthTenant[] };
  link?: { pendingProjectNumber?: string | null; pendingAt?: string | null; lastError?: string | null; lastErrorAt?: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface UsageDay {
  id: string;
  date: string;
  checks: number;
  covers: number;
  netSales: number;
  total: number;
  tenants: Record<string, { name: string; checks: number; covers: number; netSales: number; total: number }>;
}

export interface Payment {
  id: string;
  date: string;
  amount: number;
  method: string;
  reference?: string;
  paidUntil: string;
  recordedBy: string;
  at: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  email: string;
  role: string | null;
  action: string;
  clientId: string | null;
  summary: string;
}

export interface Deployment {
  id: string;
  target: string;
  requestedBy: string;
  at: string;
  status: string;
  error?: string;
  run?: { id: number; url: string; status: string; conclusion: string | null; createdAt: string };
}

export interface Staff {
  id: string;
  uid: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  joinedAt: string;
}

export interface UnknownProject {
  id: string;
  projectId: string;
  callerEmail: string;
  appVersion: string;
  businesses: string[];
  lastAt: string;
}

// ── Rules shared with the server (apps/console-functions/src/model.ts) ──

const DAY = 86_400_000;
const dayStart = (d: string) => Date.parse(`${d}T00:00:00+05:30`);

export function subscriptionState(s: Subscription | undefined, now = new Date()): { state: "none" | "paid" | "due" | "overdue" | "cancelled" | "perpetual"; daysLeft?: number } {
  if (!s) return { state: "none" };
  if (s.cancelled) return { state: "cancelled" };
  if (s.cycle === "perpetual") return { state: "perpetual" };
  if (!s.paidUntil) return { state: "due", daysLeft: 0 };
  const daysLeft = Math.floor((dayStart(s.paidUntil) + DAY - now.getTime()) / DAY);
  if (daysLeft < 0) return { state: "overdue", daysLeft };
  return { state: daysLeft <= 14 ? "due" : "paid", daysLeft };
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

export function healthState(c: Client, latestVersion: string | undefined, now = new Date()): { state: "unknown" | "ok" | "attention" | "offline"; reasons: string[] } {
  const reasons: string[] = [];
  if (c.link?.pendingProjectNumber) reasons.push("first check-in waiting for your confirmation");
  if (!c.health) return { state: reasons.length ? "attention" : "unknown", reasons: reasons.length ? reasons : ["no check-in yet"] };
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
  if (c.link?.lastError && !c.link.pendingProjectNumber) reasons.push(`check-in refused: ${c.link.lastError}`);
  if (age > 36 * 3600_000) return { state: "offline", reasons };
  return { state: reasons.length ? "attention" : "ok", reasons };
}

// ── Formatting (Sri Lanka) ──

export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const date = (iso?: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00+05:30` : iso).toLocaleDateString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", year: "numeric" }) : "—");
export const rupees = (n?: number) => (n === undefined || n === null ? "—" : `Rs ${Math.round(n).toLocaleString("en-LK")}`);
/** POS amounts are in cents. */
export const fromCents = (c?: number) => rupees((c ?? 0) / 100);
export const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
};
export const todayColombo = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
export const plusMonths = (d: string, months: number) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCMonth(x.getUTCMonth() + months);
  return x.toISOString().slice(0, 10);
};
export const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12, perpetual: 0 };
