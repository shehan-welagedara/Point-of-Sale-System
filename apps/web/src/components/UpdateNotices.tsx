import type { UpdateNotice } from "@pos/core";
import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { APP_VERSION, RELEASE_NOTES, compareVersions } from "../lib/version";
import { useApp } from "../state/app";

const TZ = "Asia/Colombo";
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: TZ });
/** "tonight", "tomorrow" or "Fri 14 Nov". */
function whenDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (dayKey(d) === dayKey(now)) return Number(time(iso).slice(0, 2)) >= 18 ? "tonight" : "today";
  if (dayKey(d) === dayKey(new Date(now.getTime() + 86_400_000))) return "tomorrow";
  return d.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
}

/** The scheduled update in plain words (null once this screen already runs it). */
export function updateMessage(u: UpdateNotice | undefined, now = new Date()): { title: string; detail: string; tone: "info" | "warn"; soon: boolean } | null {
  if (!u || compareVersions(APP_VERSION, u.version) >= 0) return null;
  if (u.state === "updating") return { title: `Updating to ${u.version} now`, detail: "The system may pause for a few minutes and comes back by itself.", tone: "warn", soon: true };
  if (u.state === "deployed") return { title: `Update ${u.version} is installed`, detail: "Screens switch to it when they are free.", tone: "info", soon: true };
  const start = u.at ? Date.parse(u.at) : now.getTime();
  const soon = start - now.getTime() < 12 * 3_600_000;
  const when = u.at && start > now.getTime() ? `${whenDay(u.at, now)}, ${time(u.at)}${u.until ? `–${time(u.until)}` : ""}` : "shortly";
  return {
    title: `Update ${u.version} ${when === "shortly" ? "shortly" : when}`,
    detail: `The system may pause for a few minutes${u.at && start > now.getTime() ? `: finish open bills before ${time(u.at)}` : ""}.${u.message ? ` ${u.message}` : ""}`,
    tone: soon ? "warn" : "info",
    soon,
  };
}

const dismissKey = (u: UpdateNotice) => `pos-suite.update-seen.${u.version}.${u.state}`;
const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
};

/** Back office: the maintenance notice, for owners, administrators and managers. */
export function MaintenanceBanner() {
  const { tenant, role } = useApp();
  const u = tenant?.supplier?.update;
  const [hidden, setHidden] = useState(false);
  if (!u || !role || !["owner", "admin", "manager"].includes(role)) return null;
  const m = updateMessage(u);
  if (!m || hidden || (!m.soon && read(dismissKey(u)))) return null;
  return (
    <div className={`callout ${m.tone === "warn" ? "warn" : ""} supplier-banner update-banner`} role="status" data-testid="maintenance-banner">
      <strong>{m.title}.</strong> <span>{m.detail}</span>
      {u.highlights?.length ? <> <Link to="/emc/about">What's new</Link></> : null}
      {!m.soon ? (
        <button className="btn ghost sm" aria-label="Hide until closer to the time" onClick={() => { write(dismissKey(u), "1"); setHidden(true); }}>✕</button>
      ) : null}
    </div>
  );
}

/** POS: a short notice on the sign-in screen when an update is close or running. */
export function PosMaintenanceNotice({ className = "" }: { className?: string }) {
  const { tenant } = useApp();
  const m = updateMessage(tenant?.supplier?.update);
  if (!m?.soon) return null;
  return (
    <div className={`callout ${m.tone === "warn" ? "warn" : ""} small ${className}`} role="status" data-testid="pos-maintenance">
      <strong>{m.title}.</strong> {m.detail}
    </div>
  );
}

const SEEN = "pos-suite.whats-new-seen";
/**
 * Whether this browser was already used before this page load (a business was open last time).
 * Read once when the app loads, so someone who creates their first business now isn't taken for
 * someone updating.
 */
const USED_BEFORE = read("pos-suite.activeTenant") !== null;

/** Bold (**…**) and code (`…`) in release notes, without HTML. */
function rich(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((p, i) => (p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith("`") ? <code key={i}>{p.slice(1, -1)}</code> : p));
}

/**
 * After an update: "What's new" once per version for back-office users. The first time the app
 * runs on a device it only remembers the version (nothing new to tell).
 */
export function WhatsNew() {
  const { role } = useApp();
  const [open, setOpen] = useState(false);
  const notes = RELEASE_NOTES.find((r) => r.version === APP_VERSION);
  useEffect(() => {
    // Versions before 1.10.0 didn't record what was seen: someone who used the system before is updating.
    const seen = read(SEEN) ?? (USED_BEFORE ? "1.9.0" : null);
    if (!seen) write(SEEN, APP_VERSION);
    else if (compareVersions(seen, APP_VERSION) < 0) {
      if (notes?.notes.length && role && role !== "terminal") setOpen(true);
      else write(SEEN, APP_VERSION);
    }
  }, [notes, role]);
  if (!open || !notes) return null;
  const close = () => {
    write(SEEN, APP_VERSION);
    setOpen(false);
  };
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`What's new in ${APP_VERSION}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal whats-new">
        <div className="row"><h2 className="grow">What's new in {APP_VERSION}</h2><button className="btn ghost sm" onClick={close} aria-label="Close">✕</button></div>
        <ul>{notes.notes.slice(0, 6).map((n, i) => <li key={i}>{rich(n)}</li>)}</ul>
        <div className="row"><Link to="/emc/about" className="btn ghost" onClick={close}>All updates</Link><span className="grow" /><button className="btn primary" onClick={close}>Got it</button></div>
      </div>
    </div>
  );
}
