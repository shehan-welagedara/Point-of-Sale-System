import type { ReactNode } from "react";

export interface PhoneListRow {
  key: string;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  /** A small line under the value (a second figure or its label). */
  valueSub?: ReactNode;
  badge?: ReactNode;
  onOpen?: () => void;
  actions?: ReactNode;
}

/** A list on a phone: one compact row per record (name, details, figure, status); tap to open. */
export function PhoneList({ rows }: { rows: PhoneListRow[] }) {
  return (
    <ul className="p-rows">
      {rows.map((r) => (
        <li key={r.key}>
          <div
            className={`p-row${r.onOpen ? " clickable" : ""}`}
            role={r.onOpen ? "button" : undefined}
            tabIndex={r.onOpen ? 0 : undefined}
            onClick={r.onOpen}
            onKeyDown={(e) => r.onOpen && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), r.onOpen())}
          >
            <div className="p-row-main">
              <strong className="p-row-title">{r.title}</strong>
              {r.sub ? <span className="p-row-sub">{r.sub}</span> : null}
            </div>
            {r.value !== undefined || r.badge || r.valueSub ? (
              <div className="p-row-side">
                {r.value !== undefined ? <strong className="num">{r.value}</strong> : null}
                {r.valueSub ? <span className="tiny muted">{r.valueSub}</span> : null}
                {r.badge ? <span className="p-row-badge">{r.badge}</span> : null}
              </div>
            ) : null}
          </div>
          {r.actions ? <div className="p-row-actions">{r.actions}</div> : null}
        </li>
      ))}
    </ul>
  );
}
