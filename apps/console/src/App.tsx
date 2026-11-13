import { orderBy, where } from "firebase/firestore";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Icon, type IconName, Logo } from "./icons";
import { AuditPage } from "./pages/Audit";
import { BusinessesPage } from "./pages/Businesses";
import { ClientDetail } from "./pages/ClientDetail";
import { ClientsPage } from "./pages/Clients";
import { Dashboard } from "./pages/Dashboard";
import { LicencesPage } from "./pages/Licences";
import { MonitoringPage } from "./pages/Monitoring";
import { PrivacyPage } from "./pages/Privacy";
import { ReleasesPage } from "./pages/Releases";
import { ReportsPage } from "./pages/Reports";
import { SettingsPage } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { StaffPage } from "./pages/Staff";
import { SubscriptionsPage } from "./pages/Subscriptions";
import { SupportPage } from "./pages/Support";
import { UpdatesPage } from "./pages/Updates";
import { type Permission, ROLE_LABEL, SessionProvider, useCol, useDocData, useSession } from "./state";
import { type BusinessRequest, type Client, type UnknownProject, attentionList, initials, latestVersion } from "./types";
import { Loading } from "./ui";

// ───────────── Shared data: every screen and the top bar read the same live lists ─────────────

interface ConsoleData {
  clients: Client[] | undefined;
  unknown: UnknownProject[];
  /** Requests to open a business that wait for approval. */
  pending: BusinessRequest[];
  latest: string | undefined;
  company: { name?: string; website?: string; email?: string; phone?: string; whatsapp?: string } | null | undefined;
  me: { name?: string } | null | undefined;
}
const DataCtx = createContext<ConsoleData | null>(null);
export function useConsole(): ConsoleData {
  const d = useContext(DataCtx);
  if (!d) throw new Error("useConsole outside the console");
  return d;
}
function DataProvider({ uid, children }: { uid: string; children: ReactNode }) {
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  const unknown = useCol<UnknownProject>("unknownProjects");
  const pending = useCol<BusinessRequest>("businessRequests", [where("status", "==", "pending")], "pending");
  const gh = useDocData<{ latestVersion?: string }>("config/github");
  const company = useDocData<ConsoleData["company"] & object>("config/company");
  const me = useDocData<{ name?: string }>(`staff/${uid}`);
  const value = useMemo<ConsoleData>(() => ({ clients, unknown: unknown ?? [], pending: pending ?? [], latest: clients ? latestVersion(clients, gh) : undefined, company, me }), [clients, unknown, pending, gh, company, me]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

// ───────────── Navigation ─────────────

const NAV: { to: string; label: string; icon: IconName; perm?: Permission; group: "main" | "admin" }[] = [
  { to: "/", label: "Overview", icon: "overview", group: "main" },
  { to: "/clients", label: "Clients", icon: "clients", group: "main" },
  { to: "/licences", label: "Licences", icon: "licence", group: "main" },
  { to: "/subscriptions", label: "Subscriptions", icon: "subscription", group: "main" },
  { to: "/monitoring", label: "Monitoring", icon: "monitoring", group: "main" },
  { to: "/updates", label: "Updates", icon: "update", group: "main" },
  { to: "/businesses", label: "Businesses", icon: "business", group: "main" },
  { to: "/deployments", label: "Deployments", icon: "deploy", group: "main" },
  { to: "/reports", label: "Reports & Analytics", icon: "reports", group: "main" },
  { to: "/staff", label: "Staff", icon: "staff", perm: "staff", group: "admin" },
  { to: "/audit", label: "Audit log", icon: "audit", group: "admin" },
  { to: "/privacy", label: "Privacy & data", icon: "shield", group: "admin" },
  { to: "/settings", label: "Settings", icon: "settings", group: "admin" },
  { to: "/support", label: "Support", icon: "support", group: "admin" },
];

/** A person's name for greetings and avatars: their staff name, else their Google name, else from their email. */
export const displayName = (me: { name?: string } | null | undefined, email: string | null, fallback?: string | null) => {
  const raw = (me?.name || fallback || email || "").trim();
  const name = raw.includes("@") ? raw.split("@")[0]!.replace(/[._-]+/g, " ") : raw;
  return name.replace(/\b\w/g, (c) => c.toUpperCase()) || "there";
};

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, role, can, signOut } = useSession();
  const { company, me, pending } = useConsole();
  const name = displayName(me, user?.email ?? null, user?.displayName);
  const links = (group: "main" | "admin") =>
    NAV.filter((n) => n.group === group && (!n.perm || can(n.perm))).map((n) => (
      <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => `nav ${isActive ? "active" : ""}`} onClick={onClose}>
        <Icon name={n.icon} />
        <span className="grow">{n.label}</span>
        {n.to === "/businesses" && pending.length ? <span className="nav-count" aria-label={`${pending.length} waiting`}>{pending.length}</span> : null}
      </NavLink>
    ));
  return (
    <>
      <div className={`scrim ${open ? "show" : ""}`} onClick={onClose} aria-hidden="true" />
      <nav className={`side ${open ? "open" : ""}`} aria-label="Console">
        <div className="brand">
          <Logo />
          <div>
            <strong>Polymath</strong>
            <span>Technologies</span>
          </div>
          <button className="icon-btn side-close" onClick={onClose} aria-label="Close menu"><Icon name="close" /></button>
        </div>
        <div className="nav-links">{links("main")}</div>
        <div className="nav-group">Administration</div>
        <div className="nav-links">{links("admin")}</div>
        <div className="ecosystem">
          <div className="eco-art" aria-hidden="true">
            <svg viewBox="0 0 120 56" width="100%" height="56">
              <circle cx="60" cy="28" r="10" fill="var(--accent)" />
              {[[22, 14], [98, 14], [22, 42], [98, 42], [60, 4], [60, 52]].map(([x, y]) => (
                <g key={`${x}-${y}`}>
                  <line x1="60" y1="28" x2={x} y2={y} stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="1.5" />
                  <circle cx={x} cy={y} r="4.5" fill="var(--panel)" stroke="var(--accent)" strokeWidth="1.8" />
                </g>
              ))}
            </svg>
          </div>
          <strong>Polymath Ecosystem</strong>
          <p>POS Suite for restaurants and cafés, Hotel Suite for hotels: every client managed here.</p>
          {company?.website ? (
            <a className="btn sm block" href={/^https?:\/\//.test(company.website) ? company.website : `https://${company.website}`} target="_blank" rel="noreferrer">Visit website</a>
          ) : (
            <Link className="btn sm block" to="/support" onClick={onClose}>Learn more</Link>
          )}
        </div>
        <div className="who">
          <span className="avatar" aria-hidden="true">{initials(name)}</span>
          <div className="grow">
            <strong>{name}</strong>
            <span>{role ? ROLE_LABEL[role] : ""}</span>
          </div>
          <button className="icon-btn" onClick={() => void signOut()} aria-label="Sign out" title="Sign out"><Icon name="logout" /></button>
        </div>
      </nav>
    </>
  );
}

// ───────────── Top bar: search, alerts, profile ─────────────

function useOutside(ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, close]);
}

function Search() {
  const { clients } = useConsole();
  const { can } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, () => setOpen(false));
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const t = q.trim().toLowerCase();
  const results: { key: string; to: string; title: string; sub: string; icon: IconName }[] = t
    ? [
        ...(clients ?? [])
          .filter((c) => [c.name, c.id, c.projectId, c.city, c.industry, c.contact?.name, c.contact?.email, c.licence?.licenceId].some((v) => v?.toLowerCase().includes(t)))
          .slice(0, 6)
          .map((c) => ({ key: `c-${c.id}`, to: `/clients/${c.id}`, title: c.name, sub: [c.city, c.projectId, c.licence?.licenceId?.toLowerCase().includes(t) ? c.licence.licenceId : ""].filter(Boolean).join(" · "), icon: "clients" as IconName })),
        ...NAV.filter((n) => (!n.perm || can(n.perm)) && n.label.toLowerCase().includes(t)).map((n) => ({ key: `p-${n.to}`, to: n.to, title: n.label, sub: "Page", icon: n.icon })),
      ]
    : [];
  const go = (to: string) => {
    nav(to);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="search" ref={box}>
      <Icon name="search" size={18} />
      <input
        ref={input}
        value={q}
        placeholder="Search clients, projects or licences…"
        aria-label="Search"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="search-results"
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setSel((s) => Math.min(results.length - 1, s + 1));
          else if (e.key === "ArrowUp") setSel((s) => Math.max(0, s - 1));
          else if (e.key === "Enter" && results[sel]) go(results[sel]!.to);
          else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
      />
      <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
      {open && t ? (
        <div className="popover search-results" id="search-results" role="listbox">
          {results.length ? (
            results.map((r, i) => (
              <button key={r.key} role="option" aria-selected={i === sel} className={`result ${i === sel ? "sel" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(r.to)}>
                <span className="result-icon"><Icon name={r.icon} size={18} /></span>
                <span className="grow"><strong>{r.title}</strong><span className="tiny muted">{r.sub}</span></span>
              </button>
            ))
          ) : (
            <div className="empty small">Nothing matches “{q}”.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Alerts() {
  const { clients, unknown, latest, pending } = useConsole();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, () => setOpen(false));
  const items = clients ? attentionList(clients, latest) : [];
  const count = items.length + unknown.length + pending.length;
  return (
    <div className="pop-anchor" ref={box}>
      <button className="icon-btn bell" onClick={() => setOpen(!open)} aria-label={`Alerts: ${count}`} aria-expanded={open}>
        <Icon name="bell" />
        {count ? <span className="dot-count">{count > 9 ? "9+" : count}</span> : null}
      </button>
      {open ? (
        <div className="popover alerts" role="dialog" aria-label="Alerts">
          <div className="pop-head"><strong>Alerts</strong><span className="tiny muted">{count ? `${count} to look at` : "All clear"}</span></div>
          {pending.map((r) => (
            <Link key={r.id} to="/businesses" className="alert-row" onClick={() => setOpen(false)}>
              <span className="status-dot warn" aria-hidden="true" />
              <span className="grow"><strong>{r.name}</strong><span className="tiny muted">New business at {r.clientName}: waiting for approval</span></span>
            </Link>
          ))}
          {unknown.map((u) => (
            <Link key={u.id} to="/clients" className="alert-row" onClick={() => setOpen(false)}>
              <span className="status-dot warn" aria-hidden="true" />
              <span className="grow"><strong>{u.businesses[0] ?? u.projectId}</strong><span className="tiny muted">Checked in, not a client yet ({u.projectId})</span></span>
            </Link>
          ))}
          {items.slice(0, 8).map(({ c, reasons, level }) => (
            <Link key={c.id} to={`/clients/${c.id}`} className="alert-row" onClick={() => setOpen(false)}>
              <span className={`status-dot ${level}`} aria-hidden="true" />
              <span className="grow"><strong>{c.name}</strong><span className="tiny muted">{reasons.slice(0, 2).join(" · ")}</span></span>
            </Link>
          ))}
          {!count ? <div className="empty small">Every client is healthy and paid.</div> : null}
          <Link to="/monitoring" className="pop-foot" onClick={() => setOpen(false)}>Open monitoring <Icon name="arrowRight" size={16} /></Link>
        </div>
      ) : null}
    </div>
  );
}

function Profile() {
  const { user, role, signOut } = useSession();
  const { me } = useConsole();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useOutside(box, () => setOpen(false));
  const name = displayName(me, user?.email ?? null, user?.displayName);
  return (
    <div className="pop-anchor" ref={box}>
      <button className="avatar-btn" onClick={() => setOpen(!open)} aria-label="Your account" aria-expanded={open}>
        <span className="avatar" aria-hidden="true">{initials(name)}</span>
      </button>
      {open ? (
        <div className="popover profile" role="dialog" aria-label="Your account">
          <div className="pop-head stack tight">
            <strong>{name}</strong>
            <span className="tiny muted">{user?.email}</span>
            <span className="badge brand">{role ? ROLE_LABEL[role] : ""}</span>
          </div>
          <Link to="/settings" className="alert-row" onClick={() => setOpen(false)}><Icon name="settings" size={18} /> Settings</Link>
          <button className="alert-row" onClick={() => void signOut()}><Icon name="logout" size={18} /> Sign out</button>
        </div>
      ) : null}
    </div>
  );
}

function Shell() {
  const { user, role, denied } = useSession();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  if (user === undefined) return <div className="auth"><div className="card card-body"><Loading /></div></div>;
  if (!user || !role) return <SignIn denied={user ? denied : null} />;
  return (
    <DataProvider uid={user.uid}>
      <div className="shell">
        <Sidebar open={menu} onClose={() => setMenu(false)} />
        <div className="content">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" /></button>
            <Link to="/" className="top-logo" aria-label="Overview"><Logo size={32} /></Link>
            <Search />
            <div className="top-actions">
              <Alerts />
              <Profile />
            </div>
          </header>
          <main className="main">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:id" element={<ClientDetail />} />
              <Route path="/licences" element={<LicencesPage />} />
              <Route path="/subscriptions" element={<SubscriptionsPage />} />
              <Route path="/monitoring" element={<MonitoringPage />} />
              <Route path="/updates" element={<ReleasesPage />} />
              <Route path="/businesses" element={<BusinessesPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/deployments" element={<UpdatesPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/staff" element={<StaffPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </main>
        </div>
      </div>
    </DataProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </SessionProvider>
  );
}
