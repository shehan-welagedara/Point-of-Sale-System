import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useConsole } from "../App";
import { Icon } from "../icons";
import { ago, compareVersions, date, healthState, liveStatus } from "../types";
import { Loading, PageHead } from "../ui";

export function MonitoringPage() {
  const { clients, unknown, latest } = useConsole();
  const nav = useNavigate();
  const [filter, setFilter] = useState<"all" | "problems" | "offline">("all");
  if (!clients) return <Loading />;
  const now = new Date();
  const live = clients.filter((c) => c.status !== "cancelled");
  const rows = live.map((c) => ({ c, h: healthState(c, latest, now), st: liveStatus(c, latest, now) }));
  const count = (s: string) => rows.filter((r) => r.h.state === s).length;
  const shown = rows
    .filter((r) => (filter === "all" ? true : filter === "offline" ? r.h.state === "offline" : r.h.state === "offline" || r.h.state === "attention" || r.c.status === "suspended"))
    .sort((a, b) => ({ bad: 0, warn: 1, none: 2, good: 3 })[a.st.tone] - ({ bad: 0, warn: 1, none: 2, good: 3 })[b.st.tone] || a.c.name.localeCompare(b.c.name));
  const devices = live.flatMap((c) => c.health?.tenants.flatMap((t) => t.devices) ?? []);
  const older = latest ? devices.filter((d) => d.appVersion && compareVersions(d.appVersion, latest) < 0).length : 0;
  const errors = live.reduce((n, c) => n + (c.health?.tenants.reduce((m, t) => m + t.errors24h, 0) ?? 0), 0);
  const stats: [string, number, "good" | "warn" | "bad" | "none"][] = [
    ["Healthy", count("ok"), "good"],
    ["Need attention", count("attention"), "warn"],
    ["Offline (36 h+)", count("offline"), "bad"],
    ["Not linked yet", count("unknown"), "none"],
  ];
  return (
    <>
      <PageHead title="Monitoring" sub={`Every client's system as it reported at its last daily check-in.${latest ? ` Latest POS Suite version: ${latest}.` : ""}`} />
      <div className="grid stats4">
        {stats.map(([l, n, t]) => (
          <div key={l} className="card stat">
            <div className="l"><span className={`status-dot ${t}`} aria-hidden="true" /> {l}</div>
            <div className="v">{n}</div>
          </div>
        ))}
      </div>
      <div className="grid cols-3">
        <div className="card stat"><div className="l">Devices reporting</div><div className="v">{devices.length}</div><div className="tiny muted">{older ? `${older} on an older version` : "All on the latest version"}</div></div>
        <div className="card stat"><div className="l">App errors (24 h)</div><div className="v">{errors}</div><div className="tiny muted">Reported by tills and phones</div></div>
        <div className="card stat"><div className="l">Unrecognised check-ins</div><div className="v">{unknown.length}</div><div className="tiny muted">{unknown.length ? <Link to="/clients">Add them as clients</Link> : "None"}</div></div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2 className="grow">Systems</h2>
          <div className="seg" role="tablist" aria-label="Show">
            {(["all", "problems", "offline"] as const).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "problems" ? "Problems" : "Offline"}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Status</th><th>Version</th><th className="num">Devices</th><th className="num hide-sm">Errors 24 h</th><th>Last check-in</th><th className="hide-sm">Licence until</th><th>What to look at</th></tr></thead>
            <tbody>
              {shown.map(({ c, h, st }) => {
                const devs = c.health?.tenants.flatMap((t) => t.devices) ?? [];
                const old = latest ? devs.filter((d) => d.appVersion && compareVersions(d.appVersion, latest) < 0).length : 0;
                return (
                  <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}?tab=health`)}>
                    <td><strong>{c.name}</strong><div className="tiny muted">{c.health?.tenants.map((t) => t.name).join(", ") || c.projectId}</div></td>
                    <td><span className="status"><span className={`status-dot ${st.tone}`} aria-hidden="true" />{st.label}</span></td>
                    <td>{c.health?.appVersion ?? "—"}{latest && c.health && compareVersions(c.health.appVersion, latest) >= 0 ? <span className="tiny muted"> · latest</span> : null}</td>
                    <td className="num">{devs.length}{old ? <span className="tiny muted"> ({old} older)</span> : null}</td>
                    <td className="num hide-sm">{c.health?.tenants.reduce((n, t) => n + t.errors24h, 0) ?? "—"}</td>
                    <td>{ago(c.health?.lastCheckinAt)}</td>
                    <td className="hide-sm">{date(c.licence?.expiresAt)}</td>
                    <td className="small">{h.reasons.length ? h.reasons.slice(0, 2).join("; ") : <span className="muted"><Icon name="check" size={16} /> Nothing</span>}</td>
                  </tr>
                );
              })}
              {!shown.length ? <tr><td colSpan={8} className="empty">{filter === "all" ? "No clients yet." : "Nothing here: every system is fine."}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <p className="tiny muted">A system checks in once a day (03:17 Sri Lanka time) and when its administrator presses “Check now” on the About page. Offline means no check-in for 36 hours: the client's internet, or the project's billing, is worth a call.</p>
    </>
  );
}
