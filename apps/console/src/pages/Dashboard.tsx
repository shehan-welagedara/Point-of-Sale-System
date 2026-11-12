import { limit, orderBy } from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import { displayName, useConsole } from "../App";
import { Donut, Meter, Sparkline } from "../charts";
import { Icon, type IconName } from "../icons";
import { ClientMap } from "../map";
import { useCol, useGroup, useSession } from "../state";
import { type AuditEntry, type Client, type DailyMetrics, type Payment, ago, attentionList, colomboMonth, compareVersions, healthState, initials, liveStatus, percent, rupeesShort, subscriptionState, todayColombo } from "../types";
import { Loading } from "../ui";

const DAY = 86_400_000;
const dayKey = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

function Kpi({ icon, label, value, delta, trend, trendLabel }: { icon: IconName; label: string; value: string; delta?: { text: string; good: boolean | null; up: boolean | null }; trend: number[]; trendLabel: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-top">
        <span className="kpi-icon" aria-hidden="true"><Icon name={icon} /></span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-main">
        <div>
          <div className="kpi-value">{value}</div>
          {delta ? (
            <span className={`delta ${delta.good === null ? "" : delta.good ? "good" : "bad"}`}>
              {delta.up !== null ? <Icon name={delta.up ? "arrowUp" : "arrowDown"} size={14} /> : null}
              {delta.text}
            </span>
          ) : null}
        </div>
        <Sparkline values={trend} label={trendLabel} />
      </div>
    </div>
  );
}

const ACTIVITY_ICON: Record<string, IconName> = {
  createClient: "clients", updateClient: "clients", confirmProject: "link", issueLicence: "licence", recordPayment: "pay", saveSubscription: "subscription",
  suspend: "pause", restore: "play", setNotice: "bell", startDeployment: "deploy", inviteStaff: "staff", updateStaff: "staff", claimAccess: "staff", cancelInvite: "staff",
  saveCompany: "settings", saveGithub: "settings",
};

export function Dashboard() {
  const { clients, unknown, latest, me, company } = useConsole();
  const { user, can } = useSession();
  const metrics = useCol<DailyMetrics>("metrics", [orderBy("date", "desc"), limit(31)], "m31");
  const payments = useGroup<Payment>("payments");
  const audit = useCol<AuditEntry>("audit", [orderBy("at", "desc"), limit(5)], "a5");
  const nav = useNavigate();
  if (!clients) return <Loading />;
  const now = new Date();
  const live = clients.filter((c) => c.status !== "cancelled");
  const states = live.map((c) => healthState(c, latest, now).state);
  const reporting = states.filter((s) => s === "ok" || s === "attention").length;
  const linked = states.filter((s) => s !== "unknown").length;
  const healthy = states.filter((s) => s === "ok").length;
  const attention = attentionList(clients, latest, now);
  const history = [...(metrics ?? [])].reverse().filter((m) => m.date !== todayColombo());
  const weekAgo = history.find((m) => m.date === dayKey(new Date(now.getTime() - 7 * DAY)));

  // Clients: how many there were on each of the last 30 days.
  const clientTrend = Array.from({ length: 30 }, (_, i) => {
    const end = now.getTime() - (29 - i) * DAY;
    return live.filter((c) => Date.parse(c.createdAt) <= end).length;
  });
  const new30 = live.filter((c) => now.getTime() - Date.parse(c.createdAt) <= 30 * DAY).length;

  // Revenue this month (payments recorded with this month's date), against the same days last month.
  const month = colomboMonth(now);
  const dayOfMonth = Number(todayColombo().slice(8, 10));
  const prevMonth = colomboMonth(new Date(Date.parse(`${month}-01T12:00:00+05:30`) - 2 * DAY));
  const pays = payments ?? [];
  const mtd = pays.filter((p) => p.date.startsWith(month)).reduce((n, p) => n + p.amount, 0);
  const prev = pays.filter((p) => p.date.startsWith(prevMonth) && Number(p.date.slice(8, 10)) <= dayOfMonth).reduce((n, p) => n + p.amount, 0);
  const revenueTrend = Array.from({ length: dayOfMonth }, (_, i) => pays.filter((p) => p.date.startsWith(month) && Number(p.date.slice(8, 10)) <= i + 1).reduce((n, p) => n + p.amount, 0));
  const revenueDelta = prev ? (mtd - prev) / prev : null;

  const healthRatio = linked ? healthy / linked : null;
  const healthTrend = [...history.map((m) => (m.clients - m.noCheckin ? m.healthy / (m.clients - m.noCheckin) : 0)), healthRatio ?? 0];
  const lastSeen = live.map((c) => c.health?.lastCheckinAt).filter((v): v is string => Boolean(v)).sort().pop();
  const problems = attention.length + unknown.length;
  // What the banner's status says: never "all systems online" when nothing has checked in yet.
  const status: { tone: "good" | "warn" | "none"; title: string; sub: string; to: string } =
    problems > 0
      ? { tone: "warn", title: `${problems} need${problems === 1 ? "s" : ""} attention`, sub: lastSeen ? `Last check-in ${ago(lastSeen)}` : "No check-ins yet", to: "/monitoring" }
      : !live.length
        ? { tone: "none", title: "No clients yet", sub: "Add your first client to start", to: "/clients?add=1" }
        : !lastSeen
          ? { tone: "none", title: "Waiting for the first check-in", sub: "Deploy a client, then About → Check now", to: "/monitoring" }
          : reporting < live.length
            ? { tone: "none", title: `${reporting} of ${live.length} systems checking in`, sub: `Last check-in ${ago(lastSeen)}`, to: "/monitoring" }
            : { tone: "good", title: "All systems online", sub: `Last check-in ${ago(lastSeen)}`, to: "/monitoring" };
  const name = displayName(me, user?.email ?? null, user?.displayName).split(" ")[0]!;

  // Platform health beside the donut.
  const withSub = live.filter((c) => c.subscription && !c.subscription.cancelled);
  const paid = withSub.filter((c) => ["paid", "perpetual"].includes(subscriptionState(c.subscription, now).state)).length;
  const licencesValid = live.filter((c) => c.licence && Date.parse(c.licence.expiresAt) >= now.getTime()).length;
  const onLatest = latest ? live.filter((c) => c.health && compareVersions(c.health.appVersion, latest) >= 0).length : 0;
  const rows: [string, number, number][] = [
    ["Checking in", reporting, live.length],
    ["Licences valid", licencesValid, live.length],
    ["Subscriptions paid", paid, withSub.length],
    [latest ? `On ${latest}` : "On the latest version", onLatest, linked],
  ];
  const tone = (r: number) => (r >= 0.95 ? "good" : r >= 0.75 ? "warn" : "bad");

  // Clients to show: problems first, then the most recently changed.
  const order = (c: Client) => ({ bad: 0, warn: 1, none: 2, good: 3 })[liveStatus(c, latest, now).tone];
  const top = [...live].sort((a, b) => order(a) - order(b) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const website = company?.website ? (/^https?:\/\//.test(company.website) ? company.website : `https://${company.website}`) : null;

  const quick: { icon: IconName; label: string; to: string; show: boolean }[] = [
    { icon: "plus", label: "Add client", to: "/clients?add=1", show: can("clients") },
    { icon: "deploy", label: "Deploy update", to: "/deployments", show: true },
    { icon: "subscription", label: "Subscriptions", to: "/subscriptions", show: true },
    { icon: "reports", label: "View reports", to: "/reports", show: true },
    { icon: "monitoring", label: "System monitor", to: "/monitoring", show: true },
    { icon: "support", label: "Support center", to: "/support", show: true },
  ];

  return (
    <>
      <h1 className="sr-only">Overview</h1>
      <section className="hero card">
        <div className="hero-text">
          <p className="hero-hello">Welcome back, {name}!</p>
          <h2>One Platform. <span>Total Control.</span></h2>
          <p className="hero-sub">Manage every POS Suite client from here: licences, subscriptions, health and updates.</p>
          <div className="row wrap">
            <Link to="/reports" className="btn primary">Explore analytics <Icon name="arrowRight" size={16} /></Link>
            {can("clients") ? <Link to="/clients?add=1" className="btn">Add client</Link> : null}
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <HeroArt />
        </div>
        <Link to={status.to} className={`hero-status ${status.tone}`}>
          <span className={`status-dot ${status.tone}`} />
          <span>
            <strong>{status.title}</strong>
            <span className="tiny">{status.sub}</span>
          </span>
        </Link>
      </section>

      {unknown.length ? (
        <div className="callout warn row wrap">
          <Icon name="alert" />
          <span className="grow">{unknown.length} project(s) checked in without being a client yet: {unknown.map((u) => u.projectId).join(", ")}.</span>
          <Link to="/clients" className="btn sm">Add on Clients</Link>
        </div>
      ) : null}

      <div className="grid kpis">
        <Kpi icon="clients" label="Total clients" value={String(live.length)} delta={{ text: `+${new30} in 30 days`, good: new30 > 0 ? true : null, up: new30 > 0 ? true : null }} trend={clientTrend} trendLabel="Clients over the last 30 days" />
        <Kpi
          icon="server"
          label="Active systems"
          value={`${reporting}`}
          delta={weekAgo ? { text: `${reporting - weekAgo.reporting >= 0 ? "+" : ""}${reporting - weekAgo.reporting} vs last week`, good: reporting === weekAgo.reporting ? null : reporting > weekAgo.reporting, up: reporting === weekAgo.reporting ? null : reporting > weekAgo.reporting } : { text: `of ${live.length} checking in`, good: null, up: null }}
          trend={[...history.map((m) => m.reporting), reporting]}
          trendLabel="Systems checking in, by day"
        />
        <Kpi
          icon="pay"
          label="Revenue (month to date)"
          value={rupeesShort(mtd)}
          delta={revenueDelta === null ? { text: "Payments recorded this month", good: null, up: null } : { text: `${revenueDelta >= 0 ? "+" : ""}${percent(revenueDelta, 0)} vs last month`, good: revenueDelta >= 0, up: revenueDelta >= 0 }}
          trend={revenueTrend.length ? revenueTrend : [0]}
          trendLabel="Revenue this month, day by day"
        />
        <Kpi
          icon="monitoring"
          label="System health"
          value={healthRatio === null ? "—" : percent(healthRatio)}
          delta={healthRatio !== null && weekAgo && weekAgo.clients - weekAgo.noCheckin ? (() => {
            const d = healthRatio - weekAgo.healthy / (weekAgo.clients - weekAgo.noCheckin);
            return { text: `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pts vs last week`, good: Math.abs(d) < 0.0005 ? null : d > 0, up: Math.abs(d) < 0.0005 ? null : d > 0 };
          })() : { text: `${healthy} of ${linked} healthy`, good: null, up: null }}
          trend={healthTrend}
          trendLabel="Share of healthy systems, by day"
        />
      </div>

      <div className="grid dash-row">
        <section className="card">
          <div className="card-head"><h2 className="grow">Client distribution</h2><Link to="/clients" className="small">All clients</Link></div>
          <div className="card-body"><ClientMap clients={live} /></div>
        </section>
        <section className="card health-card">
          <div className="card-head"><h2 className="grow">Platform health</h2><Link to="/monitoring" className="small">Monitor</Link></div>
          <div className="card-body health-body">
            <Donut
              size={150}
              center={healthRatio === null ? "—" : percent(healthRatio)}
              sub="healthy"
              slices={[
                { label: "Healthy", value: healthy, color: "var(--good)" },
                { label: "Attention", value: states.filter((s) => s === "attention").length, color: "var(--warn-mark)" },
                { label: "Offline", value: states.filter((s) => s === "offline").length, color: "var(--bad)" },
                { label: "Not linked yet", value: states.filter((s) => s === "unknown").length, color: "var(--none-mark)" },
              ]}
            />
            <ul className="legend">
              {([["Healthy", "good", healthy], ["Attention", "warn", states.filter((s) => s === "attention").length], ["Offline", "bad", states.filter((s) => s === "offline").length], ["Not linked yet", "none", states.filter((s) => s === "unknown").length]] as const).map(([l, t, n]) => (
                <li key={l}><span className={`status-dot ${t}`} aria-hidden="true" />{l}<strong>{n}</strong></li>
              ))}
            </ul>
            <div className="meters">
              {rows.map(([l, n, d]) => (
                <div key={l} className="meter-row">
                  <span className="grow small">{l}</span>
                  <Meter ratio={d ? n / d : 0} tone={d ? tone(n / d) : "accent"} label={l} />
                  <strong className="small num">{d ? percent(n / d, 0) : "—"}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="grow">Recent activity</h2><Link to="/audit" className="small">View all</Link></div>
          <ul className="activity">
            {(audit ?? []).map((a) => (
              <li key={a.id}>
                <span className="act-icon" aria-hidden="true"><Icon name={ACTIVITY_ICON[a.action] ?? "audit"} size={18} /></span>
                <span className="grow">
                  {a.clientId ? <span className="act-client">{clients.find((c) => c.id === a.clientId)?.name ?? a.clientId}</span> : null}
                  <span className="act-text">{a.summary || a.action}</span>
                  <span className="tiny muted">{a.email.split("@")[0]} · {ago(a.at)}</span>
                </span>
              </li>
            ))}
            {audit && !audit.length ? <li className="muted small">Nothing yet.</li> : null}
          </ul>
        </section>
      </div>

      <div className="grid dash-row bottom">
        <section className="card">
          <div className="card-head"><h2 className="grow">Your clients</h2><Link to="/clients" className="small">View all</Link></div>
          <div className="table-wrap">
            <table className="clients-table">
              <thead><tr><th>Client</th><th className="hide-sm">Location</th><th>Status</th><th className="hide-xs">Subscription</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {top.map((c) => {
                  const st = liveStatus(c, latest, now);
                  return (
                    <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                      <td><div className="who-cell"><span className="avatar sm" aria-hidden="true">{initials(c.name)}</span><span><strong>{c.name}</strong><span className="tiny muted">{c.industry || c.projectId}</span></span></div></td>
                      <td className="hide-sm">{[c.city, c.country && c.country !== "LK" ? c.country : c.city ? "" : "Sri Lanka"].filter(Boolean).join(", ") || "—"}</td>
                      <td><span className="status"><span className={`status-dot ${st.tone}`} aria-hidden="true" />{st.label}</span></td>
                      <td className="hide-xs">{c.subscription ? <span className="badge brand">{c.subscription.plan}</span> : <span className="muted small">—</span>}</td>
                      <td className="num"><Link to={`/clients/${c.id}`} className="icon-btn" aria-label={`Open ${c.name}`} onClick={(e) => e.stopPropagation()}><Icon name="more" /></Link></td>
                    </tr>
                  );
                })}
                {!top.length ? <tr><td colSpan={5} className="empty">No clients yet. {can("clients") ? <Link to="/clients?add=1">Add your first client</Link> : null}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2>Quick actions</h2></div>
          <div className="card-body quick">
            {quick.filter((q) => q.show).map((q) => (
              <Link key={q.label} to={q.to} className="quick-tile">
                <span className="kpi-icon" aria-hidden="true"><Icon name={q.icon} /></span>
                <span>{q.label}</span>
              </Link>
            ))}
          </div>
        </section>
        <section className="card promo">
          <div className="promo-art" aria-hidden="true"><PromoArt /></div>
          <h2>Powering the next generation of hospitality</h2>
          <p>POS Suite and Hotel Suite by Polymath Tech, built in Sri Lanka for restaurants, cafés and hotels.</p>
          {website ? <a href={website} target="_blank" rel="noreferrer" className="btn on-dark">Discover Polymath</a> : <Link to="/support" className="btn on-dark">Discover Polymath</Link>}
        </section>
      </div>
    </>
  );
}

/** A hotel and restaurant front, drawn in the brand colours (no photo to license or load). */
function HeroArt() {
  return (
    <svg viewBox="0 0 360 220" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id="h-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--hero-sky-1)" />
          <stop offset="1" stopColor="var(--hero-sky-2)" />
        </linearGradient>
        <linearGradient id="h-tower" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b6cff" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="360" height="220" rx="18" fill="url(#h-sky)" />
      <circle cx="292" cy="52" r="22" fill="#ffd27a" opacity="0.9" />
      <path d="M40 60c6-10 22-10 28 0 8-2 14 4 12 10H34c-4-6 0-12 6-10Z" fill="#fff" opacity="0.8" />
      <rect x="120" y="44" width="92" height="176" rx="6" fill="url(#h-tower)" />
      {Array.from({ length: 7 }).map((_, r) => Array.from({ length: 4 }).map((__, c) => <rect key={`${r}-${c}`} x={132 + c * 19} y={58 + r * 20} width="11" height="12" rx="2" fill="#fff" opacity={(r + c) % 3 === 0 ? 0.95 : 0.55} />))}
      <rect x="150" y="196" width="32" height="24" rx="3" fill="#fff" opacity="0.9" />
      <rect x="212" y="104" width="78" height="116" rx="6" fill="#6d5df5" opacity="0.85" />
      {Array.from({ length: 4 }).map((_, r) => Array.from({ length: 3 }).map((__, c) => <rect key={`b${r}-${c}`} x={222 + c * 21} y={118 + r * 20} width="13" height="11" rx="2" fill="#fff" opacity={(r + c) % 2 ? 0.5 : 0.85} />))}
      <path d="M206 196h90l-8-14h-74Z" fill="#ff8a65" />
      <rect x="62" y="132" width="58" height="88" rx="5" fill="#a99bff" />
      <path d="M56 140h70l-6-12H62Z" fill="#4f46e5" />
      {Array.from({ length: 3 }).map((_, r) => <rect key={`s${r}`} x={72} y={150 + r * 22} width="38" height="12" rx="2" fill="#fff" opacity="0.75" />)}
      <path d="M318 220v-58" stroke="#4b3f8f" strokeWidth="4" strokeLinecap="round" />
      <path d="M318 164c-14-10-28-8-34 0 10-2 22 0 34 0Zm0 0c10-14 26-16 34-10-10 0-24 4-34 10Zm0 0c-4-14-16-22-26-20 10 4 20 10 26 20Zm0 0c6-12 18-18 28-16-10 2-20 8-28 16Z" fill="#22a06b" />
      <rect x="0" y="214" width="360" height="6" fill="var(--hero-ground)" />
    </svg>
  );
}

function PromoArt() {
  return (
    <svg viewBox="0 0 160 90" width="100%" height="90">
      <circle cx="130" cy="20" r="34" fill="#fff" opacity="0.08" />
      <circle cx="18" cy="84" r="28" fill="#fff" opacity="0.06" />
      <rect x="54" y="18" width="40" height="64" rx="5" fill="#fff" opacity="0.92" />
      {Array.from({ length: 4 }).map((_, r) => Array.from({ length: 2 }).map((__, c) => <rect key={`${r}-${c}`} x={62 + c * 15} y={26 + r * 13} width="9" height="8" rx="1.5" fill="#6d5df5" opacity="0.8" />))}
      <rect x="96" y="44" width="30" height="38" rx="4" fill="#fff" opacity="0.7" />
      <path d="M92 82h40" stroke="#fff" strokeOpacity="0.6" strokeWidth="2" />
      <circle cx="40" cy="60" r="10" fill="#ffd27a" />
    </svg>
  );
}
