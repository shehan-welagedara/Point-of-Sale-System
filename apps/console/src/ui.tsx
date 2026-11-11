import type { ReactNode } from "react";
import { useEffect } from "react";
import { type Client, healthState, subscriptionState } from "./types";

export function PageHead({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>{title}</h1>
        {sub ? <p className="muted small">{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      {label}
      {children}
      {hint ? <span className="tiny muted" style={{ fontWeight: 400 }}>{hint}</span> : null}
    </label>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head">
          <h2 className="grow">{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-body stack">{children}</div>
      </div>
    </div>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}

const HEALTH: Record<string, [string, string]> = { ok: ["good", "Healthy"], attention: ["warn", "Attention"], offline: ["bad", "Offline"], unknown: ["", "No check-in yet"] };
export function HealthBadge({ c, latest }: { c: Client; latest?: string }) {
  const h = healthState(c, latest);
  const [cls, label] = HEALTH[h.state]!;
  return <span className={`badge ${cls}`} title={h.reasons.join("; ")}>{label}</span>;
}

export function StatusBadge({ c }: { c: Client }) {
  if (c.status === "suspended") return <span className="badge bad">Suspended</span>;
  if (c.status === "cancelled") return <span className="badge">Cancelled</span>;
  if (!c.enabled) return <span className="badge">Updates off</span>;
  return <span className="badge good">Active</span>;
}

const SUB: Record<string, [string, string]> = { none: ["", "No subscription"], paid: ["good", "Paid"], due: ["warn", "Renewal due"], overdue: ["bad", "Overdue"], cancelled: ["", "Cancelled"], perpetual: ["info", "Perpetual"] };
export function SubscriptionBadge({ c }: { c: Client }) {
  const s = subscriptionState(c.subscription);
  const [cls, label] = SUB[s.state]!;
  return <span className={`badge ${cls}`}>{label}{s.daysLeft !== undefined && s.state !== "paid" ? ` · ${s.daysLeft < 0 ? `${-s.daysLeft} d late` : `${s.daysLeft} d`}` : ""}</span>;
}
