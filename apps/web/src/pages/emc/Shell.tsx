import { useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { MEMBER_ROLE_INFO, editionInfo } from "@pos/core";
import { DEMO_PEOPLE } from "@pos/sample-data";
import { useApp } from "../../state/app";
import { type Workspace, WORKSPACES, visibleWorkspaces, workspaceFor } from "../../workspaces";

function LicenceBadge() {
  const { licence } = useApp();
  const label = licence.status === "demo" ? (licence.daysLeft !== null ? `Demo · ${licence.daysLeft} days left` : "Demo licence") : licence.status === "trial" ? `Trial · ${licence.daysLeft} days left` : licence.status === "grace" ? "Licence expired · grace period" : licence.status === "expired" ? "Licence expired" : `${editionInfo(licence.edition).name}${licence.daysLeft !== null && licence.daysLeft < 30 ? ` · renews in ${licence.daysLeft} days` : ""}`;
  const tone = licence.status === "expired" || licence.status === "grace" ? "bad" : licence.status === "trial" || licence.status === "demo" ? "warn" : "good";
  return (
    <Link to="/emc/setup/licence" className={`badge ${tone}`} title="Licence and modules">
      {label}
    </Link>
  );
}

function TopBar({ workspace, onMenu }: { workspace?: Workspace; onMenu?: () => void }) {
  const { settings, tenant, tenants, switchTenant, mode, user, signOut, role, persona, setPersona } = useApp();
  const b = settings.branding;
  return (
    <header className="topbar">
      {onMenu ? (
        <button className="btn ghost icon-btn mobile-nav" onClick={onMenu} aria-label="Menu">
          ☰
        </button>
      ) : null}
      <Link to="/emc/home" className="launcher" title="All modules" aria-label="All modules">
        <span className="dots" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} />
          ))}
        </span>
      </Link>
      <Link to="/emc/home" className="row" style={{ gap: 8, color: "var(--text)" }}>
        <span className="brand-logo" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 13 }}>
          {b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : (b.displayName || "P").slice(0, 1)}
        </span>
        <strong className="hide-sm">{b.displayName}</strong>
      </Link>
      {workspace ? (
        <>
          <span className="muted hide-sm">/</span>
          <span className="ws-title" style={{ color: workspace.tone }}>
            {workspace.ico} {workspace.name}
          </span>
        </>
      ) : null}
      <span className="grow" />
      <LicenceBadge />
      {tenants.length > 1 ? (
        <select className="select hide-sm" style={{ minHeight: 30, width: "auto", padding: "2px 8px", fontSize: 13 }} value={tenant?.id} onChange={(e) => switchTenant(e.target.value)} aria-label="Business">
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : null}
      {mode === "firebase" && (role === "owner" || role === "admin") ? (
        <Link to="/new-business" className="btn ghost sm hide-sm" title="Create another business (for example a training copy with demo data)">+ Business</Link>
      ) : null}
      {mode === "local" ? (
        <select className="select" style={{ minHeight: 30, width: "auto", padding: "2px 8px", fontSize: 13 }} value={persona} onChange={(e) => setPersona(e.target.value as keyof typeof DEMO_PEOPLE)} title="Acting as (demo): switch to see maker-checker and auditor access" aria-label="Acting as">
          {(Object.keys(DEMO_PEOPLE) as (keyof typeof DEMO_PEOPLE)[]).map((k) => (
            <option key={k} value={k}>
              {DEMO_PEOPLE[k].name}
            </option>
          ))}
        </select>
      ) : (
        <span className="tiny muted hide-sm" title={user?.email}>
          {user?.name} · {role ? MEMBER_ROLE_INFO[role].label : ""}
        </span>
      )}
      {mode === "firebase" ? (
        <button className="btn ghost sm" onClick={() => signOut()}>
          Sign out
        </button>
      ) : null}
    </header>
  );
}

/** Module launchpad: one tile per licensed, switched-on module the person may use. */
export function Launchpad() {
  const { on, role, licence, settings } = useApp();
  const navigate = useNavigate();
  const visible = visibleWorkspaces(on, role);
  const groups = [...new Set(WORKSPACES.map((w) => w.group))];
  const locked = WORKSPACES.filter((w) => w.modules && !w.modules.some(on) && w.modules.some((m) => !licence.entitlements.modules.includes(m)));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}</h1>
          <p>{settings.business.tradingName} · choose a module</p>
        </div>
      </div>
      <div className="launch-groups">
      {groups.map((g) => {
        const ws = visible.filter((w) => w.group === g);
        if (!ws.length) return null;
        return (
          <section key={g} className="stack tight">
            <span className="section-title">{g}</span>
            <div className="tiles">
              {ws.map((w) => (
                <button key={w.key} className="tile" onClick={() => navigate(w.external ?? w.sections[0]?.items[0]?.to ?? "/emc/home")} style={{ ["--tone" as string]: w.tone }}>
                  <span className="tile-ico">{w.ico}</span>
                  <span className="tile-name">{w.name}</span>
                  <span className="tile-tag">{w.tagline}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      </div>
      {locked.length ? (
        <section className="stack tight">
          <span className="section-title">Not in your licence</span>
          <div className="tiles">
            {locked.map((w) => (
              <Link key={w.key} to="/emc/setup/licence" className="tile locked" style={{ ["--tone" as string]: w.tone }}>
                <span className="tile-ico">🔒</span>
                <span className="tile-name">{w.name}</span>
                <span className="tile-tag">Available as an upgrade or add-on</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function Shell() {
  const { settings, on, role } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const home = loc.pathname === "/emc/home" || loc.pathname === "/emc" || loc.pathname === "/emc/";
  const ws = home ? undefined : workspaceFor(loc.pathname, loc.search);
  const isActive = (to: string) => {
    const [path, query] = to.split("?");
    if (query) return loc.pathname === path && (loc.search.includes(query) || (!loc.search && query === "tab=integrity"));
    return path === "/emc/finance" ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(`${path}/`);
  };
  return (
    <div className={`shell${ws ? "" : " no-side"}`}>
      <TopBar {...(ws ? { workspace: ws, onMenu: () => setOpen(true) } : {})} />
      {ws ? (
        <aside className={`sidebar${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
          <div className="ws-head" style={{ ["--tone" as string]: ws.tone }}>
            <span className="tile-ico sm">{ws.ico}</span>
            <div>
              <div style={{ fontWeight: 700 }}>{ws.name}</div>
              <div className="tiny muted">{ws.tagline}</div>
            </div>
          </div>
          <nav className="nav">
            {ws.sections.map((s, i) => {
              const items = s.items.filter((it) => (!it.module || on(it.module)) && (!it.roles || !role || it.roles.includes(role)));
              if (!items.length) return null;
              return (
                <div key={i} className="nav-group">
                  {s.label ? <div>{s.label}</div> : null}
                  {items.map((it) => (
                    <NavLink key={it.to} to={it.to} className={() => (isActive(it.to) ? "active" : "")}>
                      <span className="ico">{it.ico}</span>
                      {it.label}
                    </NavLink>
                  ))}
                </div>
              );
            })}
          </nav>
          <div style={{ padding: 12, borderTop: "1px solid var(--line)" }}>
            <Link to="/emc/home" className="btn ghost sm block">
              ← All modules
            </Link>
          </div>
        </aside>
      ) : null}
      {open ? <div className="scrim" onClick={() => setOpen(false)} /> : null}
      <div className="main">
        {settings.business.isSample && !loc.pathname.includes("/setup/business") ? (
          <div className="sample-banner">
            Sample business details are in use. Enter the real legal name, TIN and VAT status under <NavLink to="/emc/setup/business">Administration → Business &amp; tax</NavLink> before issuing real bills.
          </div>
        ) : null}
        <Outlet />
      </div>
    </div>
  );
}
