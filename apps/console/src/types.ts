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
  industry?: string;
  city?: string;
  /** ISO 3166 two-letter code. */
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
  /** Filled in when payments of every client are read at once. */
  clientId?: string;
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

/** One day's figures (metrics/{date}, written by the console's server every morning). */
export interface DailyMetrics {
  id: string;
  date: string;
  clients: number;
  active: number;
  suspended: number;
  reporting: number;
  healthy: number;
  attention: number;
  offline: number;
  noCheckin: number;
  licencesValid: number;
  paid: number;
  due: number;
  overdue: number;
  mrrLkr: number;
  versions: Record<string, number>;
}

export const INDUSTRIES = ["Restaurant", "Café", "Bakery", "Bar & pub", "Hotel", "Resort", "Catering", "Retail", "Other"] as const;

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

/** Rs 12.8M · Rs 845K · Rs 9,500 */
export const rupeesShort = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `Rs ${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (a >= 1e5) return `Rs ${Math.round(n / 1e3).toLocaleString("en-LK")}K`;
  return rupees(n);
};
export const percent = (r: number, digits = 1) => `${(Math.round(r * 1000) / 10).toFixed(digits).replace(/\.0$/, "")}%`;

/** The subscription's monthly equivalent (0 for perpetual or cancelled). */
export function monthlyLkr(s: Subscription | undefined): number {
  if (!s || s.cancelled || !CYCLE_MONTHS[s.cycle]) return 0;
  return s.priceLkr / CYCLE_MONTHS[s.cycle]!;
}

/** The newest POS Suite version: the release branch's, else the newest any client runs. */
export function latestVersion(clients: Client[], gh?: { latestVersion?: string } | null): string | undefined {
  return gh?.latestVersion ?? clients.map((c) => c.health?.appVersion).filter((v): v is string => Boolean(v)).sort(compareVersions).pop();
}

/** Everything that needs a person's attention, newest problems first. */
export function attentionList(clients: Client[], latest: string | undefined, now = new Date()): { c: Client; reasons: string[]; level: "warn" | "bad" }[] {
  return clients
    .filter((c) => c.status !== "cancelled")
    .map((c) => {
      const h = healthState(c, latest, now);
      const s = subscriptionState(c.subscription, now);
      const reasons = h.reasons.filter((r) => r !== "no check-in yet");
      if (s.state === "overdue") reasons.push(`payment ${-(s.daysLeft ?? 0)} day(s) late`);
      if (s.state === "due") reasons.push(`renewal in ${s.daysLeft} day(s)`);
      if (c.status === "suspended") reasons.push(`suspended${c.suspension ? ` (grace until ${date(c.suspension.graceUntil)})` : ""}`);
      const level: "warn" | "bad" = h.state === "offline" || c.status === "suspended" || s.state === "overdue" ? "bad" : "warn";
      return { c, reasons, level };
    })
    .filter((x) => x.reasons.length)
    .sort((a, b) => (a.level === b.level ? a.c.name.localeCompare(b.c.name) : a.level === "bad" ? -1 : 1));
}

/** "Online", "Warning", "Critical" or "Not linked yet", as the client list shows it. */
export function liveStatus(c: Client, latest: string | undefined, now = new Date()): { tone: "good" | "warn" | "bad" | "none"; label: string } {
  if (c.status === "suspended") return { tone: "bad", label: "Suspended" };
  if (c.status === "cancelled") return { tone: "none", label: "Cancelled" };
  const h = healthState(c, latest, now).state;
  if (h === "ok") return { tone: "good", label: "Online" };
  if (h === "attention") return { tone: "warn", label: "Warning" };
  if (h === "offline") return { tone: "bad", label: "Offline" };
  return { tone: "none", label: "Not linked yet" };
}

/** Initials for an avatar: "Noura Kitchen" → "NK". */
export const initials = (name: string) => name.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** This month in Sri Lanka: "2026-11". */
export const colomboMonth = (d = new Date()) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
