import { orderBy } from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import { useCol, useDocData } from "../state";
import { type Client, type UnknownProject, ago, compareVersions, date, healthState, rupees, subscriptionState } from "../types";
import { HealthBadge, Loading, PageHead, StatusBadge, SubscriptionBadge } from "../ui";

export function Dashboard() {
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  const unknown = useCol<UnknownProject>("unknownProjects");
  const gh = useDocData<{ latestVersion?: string }>("config/github");
  const nav = useNavigate();
  if (!clients) return <Loading />;
  const latest = gh?.latestVersion ?? clients.map((c) => c.health?.appVersion).filter((v): v is string => Boolean(v)).sort(compareVersions).pop();
  const live = clients.filter((c) => c.status !== "cancelled");
  const attention = live
    .map((c) => {
      const h = healthState(c, latest);
      const s = subscriptionState(c.subscription);
      const reasons = [...h.reasons.filter((r) => r !== "no check-in yet")];
      if (s.state === "overdue") reasons.push(`payment ${-(s.daysLeft ?? 0)} day(s) late`);
      if (s.state === "due") reasons.push(`renewal in ${s.daysLeft} day(s)`);
      if (c.status === "suspended") reasons.push(`suspended${c.suspension ? ` (grace until ${date(c.suspension.graceUntil)})` : ""}`);
      return { c, reasons };
    })
    .filter((x) => x.reasons.length);
  const dueAmount = live.filter((c) => ["due", "overdue"].includes(subscriptionState(c.subscription).state)).reduce((n, c) => n + (c.subscription?.priceLkr ?? 0), 0);
  const stats: [string, number | string][] = [
    ["Clients", live.length],
    ["Active", live.filter((c) => c.status === "active").length],
    ["Suspended", live.filter((c) => c.status === "suspended").length],
    ["Need attention", attention.length],
    ["Renewals due (14 days)", live.filter((c) => subscriptionState(c.subscription).state === "due").length],
    ["Due or overdue", rupees(dueAmount)],
  ];
  return (
    <>
      <PageHead title="Dashboard" sub={latest ? `Latest POS Suite version: ${latest}` : "Every client at a glance"} />
      <div className="grid cols-6">
        {stats.map(([l, v]) => (
          <div key={l} className="card stat">
            <div className="v">{v}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
      {unknown?.length ? (
        <div className="callout warn">
          {unknown.length} project(s) checked in without being a client yet: {unknown.map((u) => u.projectId).join(", ")}. <Link to="/clients">Add them on Clients</Link>.
        </div>
      ) : null}
      <div className="card">
        <div className="card-head"><h2>Needs attention</h2><span className="muted small">{attention.length ? "" : "Nothing right now"}</span></div>
        {attention.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Client</th><th>Why</th><th>Status</th></tr></thead>
              <tbody>
                {attention.map(({ c, reasons }) => (
                  <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                    <td><strong>{c.name}</strong><div className="tiny muted">{c.projectId}</div></td>
                    <td>{reasons.map((r) => <div key={r}>{r}</div>)}</td>
                    <td><div className="row wrap"><StatusBadge c={c} /><SubscriptionBadge c={c} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty">All clients are healthy and paid.</div>}
      </div>
      <div className="card">
        <div className="card-head"><h2>Versions and check-ins</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Version</th><th>Devices</th><th>Last check-in</th><th>Health</th></tr></thead>
            <tbody>
              {live.map((c) => {
                const devices = c.health?.tenants.flatMap((t) => t.devices) ?? [];
                return (
                  <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.health?.appVersion ?? "—"}</td>
                    <td>{devices.length}{latest ? ` (${devices.filter((d) => d.appVersion && compareVersions(d.appVersion, latest) < 0).length} older)` : ""}</td>
                    <td>{ago(c.health?.lastCheckinAt)}</td>
                    <td><HealthBadge c={c} latest={latest} /></td>
                  </tr>
                );
              })}
              {!live.length ? <tr><td colSpan={5} className="empty">No clients yet. <Link to="/clients">Add your first client</Link>.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
