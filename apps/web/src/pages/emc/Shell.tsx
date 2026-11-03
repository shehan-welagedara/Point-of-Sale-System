import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { ModuleKey } from "@pos/core";
import { DEMO_PEOPLE } from "@pos/sample-data";
import { useApp } from "../../state/app";

interface NavItem {
  to: string;
  label: string;
  ico: string;
  module?: ModuleKey;
}

export const NAV: { group: string; module?: ModuleKey; items: NavItem[] }[] = [
  {
    group: "Overview",
    items: [
      { to: "/emc/dashboard", label: "Dashboard", ico: "◎" },
      { to: "/emc/reports", label: "Reports", ico: "▤" },
      { to: "/emc/revenue/engineering", label: "Menu engineering", ico: "◆", module: "revenue" },
    ],
  },
  {
    group: "Point of Sale",
    module: "pos",
    items: [
      { to: "/pos", label: "Open POS", ico: "▶" },
      { to: "/emc/pos/print-queue", label: "Print queue", ico: "⎙" },
      { to: "/emc/pos/tables", label: "Tables", ico: "▦", module: "tables" },
      { to: "/emc/pos/order-types", label: "Order types", ico: "⇄" },
      { to: "/emc/pos/tenders", label: "Tender media", ico: "₨" },
      { to: "/emc/pos/discounts", label: "Discounts", ico: "%" },
      { to: "/emc/pos/reasons", label: "Reason codes", ico: "✎" },
    ],
  },
  {
    group: "Menu",
    items: [
      { to: "/emc/menu/items", label: "Menu items", ico: "☰" },
      { to: "/emc/menu/categories", label: "Categories", ico: "▣" },
      { to: "/emc/menu/modifiers", label: "Modifiers", ico: "⊕" },
      { to: "/emc/recipes", label: "Recipes & costing", ico: "⚖", module: "recipes" },
    ],
  },
  {
    group: "Inventory",
    module: "inventory",
    items: [
      { to: "/emc/inventory/stock", label: "Stock on hand", ico: "▥" },
      { to: "/emc/inventory/items", label: "Stock items", ico: "◫" },
      { to: "/emc/inventory/po", label: "Purchase orders", ico: "✉", module: "purchasing" },
      { to: "/emc/inventory/grn", label: "Goods receipts", ico: "⬇", module: "purchasing" },
      { to: "/emc/inventory/vendors", label: "Vendors", ico: "⌂", module: "purchasing" },
      { to: "/emc/inventory/counts", label: "Stock counts", ico: "✓" },
      { to: "/emc/inventory/adjust", label: "Waste & transfers", ico: "⇣" },
      { to: "/emc/inventory/movements", label: "Movements", ico: "≡" },
    ],
  },
  {
    group: "Customers",
    module: "crm",
    items: [{ to: "/emc/crm/customers", label: "Customers", ico: "☺" }],
  },
  {
    group: "Finance",
    module: "accounting",
    items: [
      { to: "/emc/finance", label: "Overview", ico: "◎" },
      { to: "/emc/finance/approvals", label: "Approvals", ico: "✓" },
      { to: "/emc/finance/journals", label: "Journals", ico: "⎘" },
      { to: "/emc/finance/payables", label: "Payables", ico: "↗" },
      { to: "/emc/finance/receivables", label: "Receivables", ico: "↙" },
      { to: "/emc/finance/bank", label: "Bank reconciliation", ico: "⌂" },
      { to: "/emc/finance/assets", label: "Fixed assets", ico: "▣" },
      { to: "/emc/finance/budgets", label: "Budgets", ico: "◔" },
      { to: "/emc/finance/statements", label: "Financial statements", ico: "Σ" },
      { to: "/emc/finance/documents", label: "All documents", ico: "≡" },
      { to: "/emc/finance/periods", label: "Period close", ico: "⏏" },
      { to: "/emc/finance/accounts", label: "Chart of accounts", ico: "#" },
      { to: "/emc/finance/settings", label: "Finance settings", ico: "↔" },
    ],
  },
  {
    group: "Assurance",
    items: [{ to: "/emc/audit", label: "Audit Center", ico: "⛨" }],
  },
  {
    group: "People",
    items: [
      { to: "/emc/people/staff", label: "POS staff", ico: "☻" },
      { to: "/emc/people/roles", label: "Roles & privileges", ico: "⚑" },
      { to: "/emc/people/logins", label: "Back-office logins", ico: "⚿" },
    ],
  },
  {
    group: "Setup",
    items: [
      { to: "/emc/setup/business", label: "Business & tax", ico: "⚙" },
      { to: "/emc/setup/branding", label: "Branding", ico: "✦" },
      { to: "/emc/setup/organisation", label: "Outlets & revenue centres", ico: "⌖" },
      { to: "/emc/setup/devices", label: "Devices & printers", ico: "⌨" },
      { to: "/emc/setup/modules", label: "Modules", ico: "⧉" },
      { to: "/emc/setup/integrations", label: "Integrations", ico: "⟲" },
      { to: "/emc/setup/data", label: "Excel import & export", ico: "⇪" },
    ],
  },
];

export function Shell() {
  const { settings, tenant, tenants, switchTenant, on, mode, user, signOut, role, persona, setPersona } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const b = settings.branding;
  return (
    <div className="shell">
      <aside className={`sidebar${open ? " open" : ""}`} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
        <div className="brand-block">
          <div className="brand-logo">{b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : (b.displayName || "P").slice(0, 1)}</div>
          <div className="grow">
            <div style={{ fontWeight: 700, lineHeight: 1.2 }}>{b.displayName}</div>
            {tenants.length > 1 ? (
              <select className="select" style={{ minHeight: 28, padding: "2px 6px", fontSize: 12, marginTop: 4 }} value={tenant?.id} onChange={(e) => switchTenant(e.target.value)}>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="tiny muted">{mode === "local" ? "Local demo" : (role ?? "")}</div>
            )}
          </div>
        </div>
        <nav className="nav">
          {NAV.filter((g) => !g.module || on(g.module)).map((g) => (
            <div key={g.group} className="nav-group">
              <div>{g.group}</div>
              {g.items
                .filter((i) => !i.module || on(i.module))
                .map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === "/emc/finance"} className={({ isActive }) => (isActive ? "active" : "")}>
                    <span className="ico">{i.ico}</span>
                    {i.label}
                  </NavLink>
                ))}
            </div>
          ))}
        </nav>
        {mode === "local" ? (
          <div style={{ padding: "10px 12px 0", borderTop: "1px solid var(--line)" }}>
            <label className="tiny muted" htmlFor="persona">Acting as (demo)</label>
            <select id="persona" className="select" style={{ minHeight: 30, padding: "2px 6px", fontSize: 13 }} value={persona} onChange={(e) => setPersona(e.target.value as keyof typeof DEMO_PEOPLE)} title="Switch person to see maker-checker and auditor access">
              {(Object.keys(DEMO_PEOPLE) as (keyof typeof DEMO_PEOPLE)[]).map((k) => (
                <option key={k} value={k}>
                  {DEMO_PEOPLE[k].name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div style={{ padding: 12, borderTop: mode === "local" ? undefined : "1px solid var(--line)" }} className="row between">
          <span className="tiny muted" title={user?.email}>
            {user?.name}
          </span>
          {mode === "firebase" ? (
            <button className="btn ghost sm" onClick={() => signOut()}>
              Sign out
            </button>
          ) : null}
        </div>
      </aside>
      <div className="main">
        <div className="topbar-mobile">
          <button className="btn ghost icon-btn" onClick={() => setOpen(true)} aria-label="Menu">
            ☰
          </button>
          <strong>{b.displayName}</strong>
        </div>
        {settings.business.isSample && !loc.pathname.includes("/setup/business") ? (
          <div className="sample-banner">
            Sample business details are in use. Enter the real legal name, TIN and VAT status under <NavLink to="/emc/setup/business">Setup → Business &amp; tax</NavLink> before issuing real bills.
          </div>
        ) : null}
        <Outlet />
      </div>
    </div>
  );
}
