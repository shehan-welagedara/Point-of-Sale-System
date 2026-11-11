import { BrowserRouter, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { AuditPage } from "./pages/Audit";
import { ClientDetail } from "./pages/ClientDetail";
import { ClientsPage } from "./pages/Clients";
import { Dashboard } from "./pages/Dashboard";
import { LicencesPage } from "./pages/Licences";
import { SettingsPage } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";
import { StaffPage } from "./pages/Staff";
import { UpdatesPage } from "./pages/Updates";
import { ROLE_LABEL, SessionProvider, useSession } from "./state";
import { Loading } from "./ui";

function Shell() {
  const { user, role, denied, can, signOut } = useSession();
  if (user === undefined) return <div className="auth"><div className="card card-body"><Loading /></div></div>;
  if (!user || !role) return <SignIn denied={user ? denied : null} />;
  const nav: [string, string, boolean][] = [
    ["/", "Dashboard", true],
    ["/clients", "Clients", true],
    ["/licences", "Licences", true],
    ["/updates", "Updates", true],
    ["/staff", "Staff", can("staff")],
    ["/audit", "Audit log", true],
    ["/settings", "Settings", true],
  ];
  return (
    <div className="shell">
      <nav className="side" aria-label="Console">
        <div className="brand">
          <div className="logo" aria-hidden="true">P</div>
          <div>
            <strong>Polymath Console</strong>
            <span>by Polymath Tech</span>
          </div>
        </div>
        <div className="nav-links">
          {nav.filter(([, , show]) => show).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `nav ${isActive ? "active" : ""}`}>
              {label}
            </NavLink>
          ))}
        </div>
        <div className="who">
          <strong>{user.email}</strong>
          <span>{ROLE_LABEL[role]}</span>
          <div>
            <button className="btn sm" onClick={() => void signOut()}>Sign out</button>
          </div>
        </div>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/licences" element={<LicencesPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/staff" element={<StaffPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
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
