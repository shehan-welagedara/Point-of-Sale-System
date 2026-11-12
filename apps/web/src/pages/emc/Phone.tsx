/**
 * The back office as a phone app (screens up to 600 px wide): a compact top bar, a bottom tab bar
 * for the thumb, a "More" sheet with every module and the account, section pills inside a module,
 * the owner's Today screen and the Tasks inbox. Larger screens keep the sidebar layout (Shell.tsx).
 */
import { type MemberRole, type Check, type InventoryItem, type MenuItem, type PurchaseOrder, type StockLevel, type Attachment, type Budget, COLLECTIONS as C, addDays, itemSales, mergeStats, reorderSuggestions } from "@pos/core";
import { type Voucher, LEDGER as L } from "@pos/ledger";
import { DEMO_PEOPLE } from "@pos/sample-data";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { money, moneyShort, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { type Workspace, visibleWorkspaces, workspaceFor } from "../../workspaces";
import { Icon, type IconName } from "../pos/mobile/icons";
import { useProperty, useStats } from "./Reports";

export { useIsPhone } from "../../lib/useIsPhone";

const firstName = (name: string | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const initials = (name: string) =>
  name
    .split(/[\s@._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";
const greeting = () => {
  const h = new Date(Date.now() + 5.5 * 3_600_000).getUTCHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// ───────────────────────────── Tasks ─────────────────────────────

export interface Task {
  key: string;
  icon: IconName;
  title: string;
  detail: string;
  to: string;
  tone: "bad" | "warn" | "info";
}

const APPROVERS: MemberRole[] = ["owner", "admin", "accountant", "manager"];
const BOOKS: MemberRole[] = ["owner", "admin", "accountant", "manager"];
const STOCK: MemberRole[] = ["owner", "admin", "manager", "storekeeper"];

/** Everything that needs a person: approvals, bills to record, deliveries, low stock, open checks, licence. */
export function useTasks(): Task[] {
  const { on, role, licence, tenant, settings } = useApp();
  const may = (roles: MemberRole[]) => !role || roles.includes(role);
  const books = on("accounting") && may(BOOKS);
  const stock = on("inventory") && may(STOCK);
  const vouchers = useCollection<Voucher>(books && may(APPROVERS) ? L.vouchers : null, { where: [["status", "==", "submitted"]] }) ?? [];
  const bills = useCollection<Attachment>(books ? C.attachments : null, { where: [["status", "==", "inbox"]] }) ?? [];
  const pos = useCollection<PurchaseOrder>(on("purchasing") && may(STOCK) ? C.purchaseOrders : null) ?? [];
  const items = useCollection<InventoryItem>(stock ? C.inventoryItems : null) ?? [];
  const levels = useCollection<StockLevel>(stock ? C.stockLevels : null) ?? [];
  const open = useCollection<Check>(on("pos") && may(["owner", "admin", "manager"]) ? C.checks : null, { where: [["status", "==", "open"]] }) ?? [];
  const today = todayColombo();
  const tasks: Task[] = [];
  const s = licence.suspension;
  if (s.state !== "none") tasks.push({ key: "suspended", icon: "alert", tone: "bad", title: s.state === "blocked" ? "Account suspended by your supplier" : "Your supplier will suspend the account", detail: s.message ?? "Contact them from the About page", to: "/emc/about" });
  if (licence.status === "expired" || licence.status === "grace") tasks.push({ key: "licence", icon: "lock", tone: "bad", title: licence.status === "grace" ? "Licence expired: grace period" : "Licence expired", detail: "Renew to keep using the licensed modules", to: "/emc/setup/licence" });
  else if ((licence.status === "trial" || (licence.status === "demo" && !licence.demoKey)) && licence.daysLeft !== null && licence.daysLeft <= 14) tasks.push({ key: "trial", icon: "lock", tone: "warn", title: `${licence.status === "trial" ? "Trial" : "Demo"} ends in ${licence.daysLeft} day${licence.daysLeft === 1 ? "" : "s"}`, detail: "Activate the licence key from your supplier", to: "/emc/setup/licence" });
  if (vouchers.length) tasks.push({ key: "approvals", icon: "check", tone: "warn", title: `${vouchers.length} document${vouchers.length === 1 ? "" : "s"} to approve`, detail: "Waiting for a second person (maker–checker)", to: "/emc/finance/approvals" });
  const stale = open.filter((c) => c.businessDate < today);
  if (stale.length) tasks.push({ key: "stale-checks", icon: "orders", tone: "warn", title: `${stale.length} check${stale.length === 1 ? "" : "s"} still open from an earlier day`, detail: "Close or void them so the day's figures are complete", to: "/pos" });
  if (bills.length) tasks.push({ key: "bills", icon: "camera", tone: "info", title: `${bills.length} bill photo${bills.length === 1 ? "" : "s"} to record`, detail: "Turn them into expenses or supplier invoices", to: "/emc/finance/bills" });
  const due = pos.filter((p) => p.status === "approved" || p.status === "sent");
  if (due.length) {
    const late = due.filter((p) => p.expectedDate && p.expectedDate < today).length;
    tasks.push({ key: "deliveries", icon: "truck", tone: late ? "warn" : "info", title: `${due.length} deliver${due.length === 1 ? "y" : "ies"} to receive`, detail: late ? `${late} past the expected date` : "Receive the goods when they arrive", to: "/emc/inventory/grn" });
  }
  const low = reorderSuggestions(items, levels);
  if (low.length) tasks.push({ key: "low-stock", icon: "box", tone: "warn", title: `${low.length} item${low.length === 1 ? "" : "s"} below par level`, detail: low.slice(0, 3).map((x) => x.item.name).join(", ") + (low.length > 3 ? "…" : ""), to: "/emc/inventory/po" });
  if (settings.business.isSample && may(["owner", "admin"])) tasks.push({ key: "sample", icon: "settings", tone: "info", title: "Enter your business details", detail: "Legal name, TIN and VAT status before real bills", to: "/emc/setup/business" });
  const notice = tenant?.supplier?.notice;
  if (notice && s.state === "none" && may(["owner", "admin"])) tasks.push({ key: "notice", icon: "bell", tone: notice.level === "warn" ? "warn" : "info", title: `Message from ${tenant?.supplier?.contact?.name ?? "your supplier"}`, detail: notice.text, to: "/emc/about" });
  return tasks;
}

function TaskRow({ t }: { t: Task }) {
  return (
    <Link to={t.to} className={`p-task ${t.tone}`}>
      <span className="p-task-ico" aria-hidden="true"><Icon name={t.icon} size={20} /></span>
      <span className="grow">
        <strong>{t.title}</strong>
        <span>{t.detail}</span>
      </span>
      <Icon name="chevron" size={18} className="p-chev" />
    </Link>
  );
}

/** /emc/tasks: everything that needs someone, on every screen size. */
export function TasksPage() {
  const tasks = useTasks();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Tasks</h1>
          <p>What needs you now, from every module you use.</p>
        </div>
      </div>
      {tasks.length ? (
        <div className="p-tasks card">{tasks.map((t) => <TaskRow key={t.key} t={t} />)}</div>
      ) : (
        <div className="card pad p-alldone">
          <span className="p-task-ico good" aria-hidden="true"><Icon name="check" size={22} /></span>
          <div>
            <strong>All done</strong>
            <p className="muted small">Nothing is waiting for you. New approvals, bills, deliveries and low stock show up here.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Today ─────────────────────────────

/** The owner's phone home: today's sales, the trend, what needs them, and one-tap actions. */
export function TodayPage() {
  const { on, role, settings, user, persona, mode } = useApp();
  const { propertyId } = useProperty();
  const today = todayColombo();
  const sees = (path: string) => {
    const w = workspaceFor(path, "");
    return Boolean(w && visibleWorkspaces(on, role).some((v) => v.key === w.key));
  };
  const sales = (on("pos") || on("accounting")) && sees("/emc/reports");
  const stats = useStats(propertyId, addDays(today, -13), today, sales);
  const menuItems = useCollection<MenuItem>(sales ? C.menuItems : null) ?? [];
  const budgets = useCollection<Budget>(sales ? C.budgets : null) ?? [];
  const open = useCollection<Check>(sales && on("pos") ? C.checks : null, { where: [["status", "==", "open"]] }) ?? [];
  const tasks = useTasks();
  const name = firstName(mode === "local" ? DEMO_PEOPLE[persona].name : user?.name);

  const all: Record<string, { icon: IconName; label: string; to: string; show: boolean }> = {
    pos: { icon: "bolt", label: "Open POS", to: "/pos", show: on("pos") && visibleWorkspaces(on, role).some((v) => v.key === "pos") },
    expense: { icon: "receipt", label: "Record expense", to: "/emc/finance/expense", show: on("accounting") && sees("/emc/finance/expense") },
    bill: { icon: "camera", label: "Snap a bill", to: "/emc/finance/bills", show: on("accounting") && sees("/emc/finance/bills") },
    receive: { icon: "truck", label: "Receive goods", to: "/emc/inventory/grn", show: on("purchasing") && sees("/emc/inventory/grn") },
    count: { icon: "clipboard", label: "Stock count", to: "/emc/inventory/counts", show: on("inventory") && sees("/emc/inventory/counts") },
    order: { icon: "cart", label: "Purchase orders", to: "/emc/inventory/po", show: on("purchasing") && sees("/emc/inventory/po") },
    stock: { icon: "box", label: "Stock on hand", to: "/emc/inventory/stock", show: on("inventory") && sees("/emc/inventory/stock") },
    reports: { icon: "reports", label: "Reports", to: "/emc/reports", show: sees("/emc/reports") },
    approvals: { icon: "check", label: "Approvals", to: "/emc/finance/approvals", show: on("accounting") && sees("/emc/finance/approvals") },
    statements: { icon: "note", label: "Financial statements", to: "/emc/finance/statements", show: on("accounting") && sees("/emc/finance/statements") },
    journals: { icon: "book", label: "Journals", to: "/emc/finance/journals", show: on("accounting") && sees("/emc/finance/journals") },
    audit: { icon: "lock", label: "Audit Center", to: "/emc/audit", show: sees("/emc/audit") },
    menu: { icon: "menu", label: "Menu items", to: "/emc/menu/items", show: sees("/emc/menu/items") },
    staff: { icon: "users", label: "Employees", to: "/emc/people/staff", show: sees("/emc/people/staff") },
  };
  // What each role does day to day; read-only roles get places to look, not forms.
  const order: Record<string, string[]> = {
    accountant: ["expense", "bill", "approvals", "statements", "journals", "reports"],
    storekeeper: ["receive", "count", "order", "stock", "menu", "reports"],
    auditor: ["audit", "statements", "journals", "reports", "stock"],
    viewer: ["reports", "statements", "stock", "menu"],
  };
  const shown = (order[role ?? ""] ?? ["pos", "expense", "bill", "receive", "count", "reports", "menu", "staff"]).map((k) => all[k]!).filter((a) => a.show).slice(0, 6);

  const todayStats = stats?.find((s) => s.businessDate === today);
  const lastWeek = stats?.find((s) => s.businessDate === addDays(today, -7));
  const delta = todayStats && lastWeek?.netSales ? Math.round(((todayStats.netSales - lastWeek.netSales) / lastWeek.netSales) * 100) : null;
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const series = days.map((d) => stats?.find((s) => s.businessDate === d)?.netSales ?? 0);
  const max = Math.max(1, ...series);
  const month = today.slice(0, 7);
  const monthSales = (stats ?? []).filter((s) => s.businessDate.startsWith(month)).reduce((a, s) => a + s.netSales, 0);
  const budget = budgets.find((b) => b.month === month && b.propertyId === propertyId);
  const week = mergeStats((stats ?? []).filter((s) => s.businessDate > addDays(today, -7)));
  const top = todayStats ? itemSales(todayStats, menuItems, []).slice(0, 5) : [];

  return (
    <div className="page p-today">
      <div className="p-hello">
        <span className="muted small">{greeting()}{name ? "," : ""}</span>
        <h1>{name || settings.branding.displayName}</h1>
        <span className="muted small">{settings.branding.displayName} · {new Date(`${today}T12:00:00+05:30`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>

      {sales ? (
        <section className="p-hero" aria-label="Today's sales">
          <span className="p-hero-label">Net sales today</span>
          <strong className="p-hero-value">{stats ? money(todayStats?.netSales) : "…"}</strong>
          <span className="p-hero-sub">
            {delta === null ? "No sales on this day last week to compare" : <><span className={`p-delta ${delta >= 0 ? "up" : "down"}`}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}%</span> vs last {new Date(`${addDays(today, -7)}T12:00:00+05:30`).toLocaleDateString("en-GB", { weekday: "long" })}</>}
          </span>
          <div className="p-bars" role="img" aria-label={`Net sales, last 14 days: ${series.map((v, i) => `${days[i]} ${moneyShort(v)}`).join(", ")}`}>
            {series.map((v, i) => <span key={days[i]} className={i === 13 ? "today" : ""} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />)}
          </div>
          <span className="p-hero-foot">Last 14 days · {moneyShort(series.reduce((a, b) => a + b, 0))}</span>
        </section>
      ) : null}

      {sales ? (
        <div className="p-kpis">
          <Link to="/emc/reports" className="p-kpi"><span>Checks · covers</span><strong>{todayStats?.checks ?? 0} · {todayStats?.covers ?? 0}</strong><em>{open.length} open now</em></Link>
          <Link to="/emc/reports" className="p-kpi"><span>Avg per cover</span><strong>{moneyShort(todayStats?.covers ? Math.round(todayStats.netSales / todayStats.covers) : 0)}</strong><em>7-day {moneyShort(week.covers ? Math.round(week.netSales / week.covers) : 0)}</em></Link>
          <Link to="/emc/reports" className="p-kpi wide">
            <span>Month to date</span>
            <strong>{moneyShort(monthSales)}</strong>
            {budget ? (
              <>
                <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ width: `${Math.min(100, Math.round((monthSales / budget.salesTarget) * 100))}%` }} /></span>
                <em>{Math.round((monthSales / budget.salesTarget) * 100)}% of the {moneyShort(budget.salesTarget)} target</em>
              </>
            ) : <em>No monthly target set</em>}
          </Link>
        </div>
      ) : null}

      <section className="stack tight">
        <div className="row between"><h2 className="p-h2">Needs you</h2>{tasks.length > 3 ? <Link to="/emc/tasks" className="small">See all {tasks.length}</Link> : null}</div>
        {tasks.length ? <div className="p-tasks card">{tasks.slice(0, 3).map((t) => <TaskRow key={t.key} t={t} />)}</div> : <div className="card pad p-alldone"><span className="p-task-ico good" aria-hidden="true"><Icon name="check" size={20} /></span><span className="small">All done. Nothing is waiting for you.</span></div>}
      </section>

      {shown.length ? (
        <section className="stack tight">
          <h2 className="p-h2">Quick actions</h2>
          <div className="p-actions">
            {shown.map((a) => (
              <Link key={a.label} to={a.to} className="p-action">
                <span className="p-action-ico" aria-hidden="true"><Icon name={a.icon} size={22} /></span>
                <span>{a.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {top.length ? (
        <section className="stack tight">
          <div className="row between"><h2 className="p-h2">Best sellers today</h2><Link to="/emc/reports" className="small">Reports</Link></div>
          <div className="card p-list">
            {top.map((r, i) => (
              <div key={r.itemId} className="p-li">
                <span className="p-rank">{i + 1}</span>
                <span className="grow"><strong>{r.name}</strong><span className="muted tiny">{r.qty} sold</span></span>
                <strong className="num small">{moneyShort(r.netSales)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <InstallCard />
    </div>
  );
}

// ───────────────────────────── Install ─────────────────────────────

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
let deferred: InstallPromptEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
}

/** "Add to Home Screen": Android installs with one tap; iPhone gets the two steps. Hidden once installed or dismissed. */
export function InstallCard() {
  const standalone = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("pos-suite.install-dismissed") === "1";
    } catch {
      return false;
    }
  });
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);
  if (standalone || hidden) return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem("pos-suite.install-dismissed", "1");
    } catch {
      /* private mode */
    }
  };
  return (
    <section className="card p-install">
      <span className="p-action-ico" aria-hidden="true"><Icon name="download" size={22} /></span>
      <div className="grow">
        <strong>Put the back office on your home screen</strong>
        <p className="muted small">{deferred ? "It opens like an app, full screen, straight to Today." : ios ? "In Safari, tap Share, then “Add to Home Screen”." : "In Chrome, open the ⋮ menu, then “Add to Home screen” or “Install app”."}</p>
        <div className="row" style={{ marginTop: 8 }}>
          {deferred ? <button className="btn primary sm" onClick={() => void deferred?.prompt().then(() => { deferred = null; dismiss(); })}>Install</button> : null}
          <button className="btn ghost sm" onClick={dismiss}>Not now</button>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────────── Shell parts ─────────────────────────────

export function PhoneTopBar({ title }: { title: string }) {
  const { settings, user, persona, mode } = useApp();
  const tasks = useTasks();
  const b = settings.branding;
  const who = mode === "local" ? DEMO_PEOPLE[persona].name : (user?.name ?? user?.email ?? "");
  return (
    <header className="p-top">
      <Link to="/emc/home" className="brand-logo p-logo" aria-label={`${b.displayName}: Today`}>
        {b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : (b.displayName || "P").slice(0, 1)}
      </Link>
      <h1 className="p-title">{title}</h1>
      <Link to="/emc/tasks" className="p-iconbtn" aria-label={`Tasks: ${tasks.length}`}>
        <Icon name="bell" size={22} />
        {tasks.length ? <span className="p-badge">{tasks.length > 9 ? "9+" : tasks.length}</span> : null}
      </Link>
      <Link to="/emc/account" className="p-avatar" aria-label="Your account">{initials(who)}</Link>
    </header>
  );
}

/** A module's pages as scrollable pills under the top bar (instead of a side menu). */
export function SectionPills({ ws }: { ws: Workspace }) {
  const { on, role } = useApp();
  const loc = useLocation();
  const items = ws.sections.flatMap((s) => s.items).filter((it) => (!it.module || on(it.module)) && (!it.roles || !role || it.roles.includes(role)));
  const active = (to: string) => {
    const [path, query] = to.split("?");
    if (query) return loc.pathname === path && (loc.search.includes(query) || (!loc.search && query === "tab=integrity"));
    return path === "/emc/finance" ? loc.pathname === path : loc.pathname === path || loc.pathname.startsWith(`${path}/`);
  };
  useEffect(() => {
    document.querySelector(".p-pills .on")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [loc.pathname, loc.search]);
  if (items.length < 2) return null;
  return (
    <nav className="p-pills" aria-label={ws.name}>
      {items.map((it) => (
        <Link key={it.to} to={it.to} className={active(it.to) ? "on" : ""} aria-current={active(it.to) ? "page" : undefined}>
          {it.label}
        </Link>
      ))}
    </nav>
  );
}

interface Tab {
  to: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
}

export function BottomNav({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { on, role } = useApp();
  const loc = useLocation();
  const tasks = useTasks();
  const visible = visibleWorkspaces(on, role);
  const sees = (path: string) => {
    const w = workspaceFor(path, "");
    return Boolean(w && visible.some((v) => v.key === w.key));
  };
  const candidates: (Tab & { show: boolean })[] = [
    { to: "/emc/reports", label: "Reports", icon: "reports", match: (p) => p.startsWith("/emc/reports") || p.startsWith("/emc/revenue") || p === "/emc/dashboard", show: sees("/emc/reports") },
    { to: "/pos", label: "POS", icon: "bolt", match: () => false, show: on("pos") && visible.some((v) => v.key === "pos") },
    { to: "/emc/inventory/stock", label: "Stock", icon: "box", match: (p) => p.startsWith("/emc/inventory"), show: on("inventory") && sees("/emc/inventory/stock") },
    { to: "/emc/finance", label: "Finance", icon: "bank", match: (p) => p.startsWith("/emc/finance"), show: on("accounting") && sees("/emc/finance") },
    { to: "/emc/menu/items", label: "Menu", icon: "menu", match: (p) => p.startsWith("/emc/menu") || p.startsWith("/emc/recipes"), show: sees("/emc/menu/items") },
  ];
  // The two places each role uses most.
  const priority: Record<string, string[]> = {
    accountant: ["Finance", "Reports"],
    auditor: ["Reports", "Finance"],
    viewer: ["Reports", "Stock"],
    storekeeper: ["Stock", "Menu"],
  };
  const want = priority[role ?? ""] ?? ["Reports", "POS", "Stock", "Finance", "Menu"];
  const middle = [...want.map((l) => candidates.find((c) => c.label === l)), ...candidates]
    .filter((c, i, a): c is (typeof candidates)[number] => Boolean(c?.show) && a.indexOf(c) === i)
    .slice(0, 2);
  const tabs: Tab[] = [
    { to: "/emc/home", label: "Today", icon: "home", match: (p) => p === "/emc/home" || p === "/emc" || p === "/emc/" },
    ...middle,
    { to: "/emc/tasks", label: "Tasks", icon: "inbox", match: (p) => p === "/emc/tasks" },
  ];
  return (
    <nav className="p-nav" aria-label="Main">
      {tabs.map((t) => {
        const on = !moreOpen && t.match(loc.pathname);
        return (
          <NavLink key={t.to} to={t.to} className={on ? "on" : ""} aria-current={on ? "page" : undefined}>
            <span className="p-nav-ico"><Icon name={t.icon} size={22} />{t.to === "/emc/tasks" && tasks.length ? <span className="p-badge">{tasks.length > 9 ? "9+" : tasks.length}</span> : null}</span>
            <span>{t.label}</span>
          </NavLink>
        );
      })}
      <button className={moreOpen ? "on" : ""} onClick={onMore} aria-expanded={moreOpen} aria-label="More: every module">
        <span className="p-nav-ico"><Icon name="grid" size={22} /></span>
        <span>More</span>
      </button>
    </nav>
  );
}

/** Bottom sheet with every module the person may use. */
export function MoreSheet({ onClose }: { onClose: () => void }) {
  const { on, role } = useApp();
  const navigate = useNavigate();
  const ws = visibleWorkspaces(on, role);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <div className="p-sheet-back" onClick={onClose}>
      <div className="p-sheet" role="dialog" aria-modal="true" aria-label="All modules" onClick={(e) => e.stopPropagation()}>
        <span className="p-grip" aria-hidden="true" />
        <div className="row between"><h2 className="p-h2">All modules</h2><button className="btn ghost sm" onClick={onClose}>Close</button></div>
        <div className="p-modules">
          {ws.map((w) => (
            <button key={w.key} className="p-module" style={{ ["--tone" as string]: w.tone }} onClick={() => go(w.external ?? w.sections[0]?.items[0]?.to ?? "/emc/home")}>
              <span className="p-module-ico" aria-hidden="true">{w.ico}</span>
              <span>{w.name}</span>
            </button>
          ))}
        </div>
        <div className="p-sheet-links">
          <button onClick={() => go("/emc/account")}><Icon name="user" size={20} /> Your account</button>
          <button onClick={() => go("/emc/about")}><Icon name="book" size={20} /> About and help</button>
        </div>
      </div>
    </div>
  );
}

/** /emc/account: who you are, the business, acting-as (demo), sign out; on every screen size. */
export function AccountPage() {
  const { user, role, mode, persona, setPersona, tenants, tenant, switchTenant, signOut, licence } = useApp();
  const who = mode === "local" ? DEMO_PEOPLE[persona].name : (user?.name ?? "");
  return (
    <div className="page">
      <div className="p-account card pad">
        <span className="p-avatar lg" aria-hidden="true">{initials(who || user?.email || "?")}</span>
        <div className="grow">
          <h1 className="p-h1">{who || user?.email}</h1>
          <p className="muted small">{user?.email}{role ? ` · ${role.charAt(0).toUpperCase()}${role.slice(1)}` : ""}</p>
        </div>
      </div>
      <div className="card p-list">
        {mode === "local" ? (
          <label className="p-li">
            <span className="grow"><strong>Acting as (demo)</strong><span className="muted tiny">Switch to see approvals and auditor access</span></span>
            <select className="select" value={persona} onChange={(e) => setPersona(e.target.value as keyof typeof DEMO_PEOPLE)} aria-label="Acting as">
              {(Object.keys(DEMO_PEOPLE) as (keyof typeof DEMO_PEOPLE)[]).map((k) => <option key={k} value={k}>{DEMO_PEOPLE[k].name}</option>)}
            </select>
          </label>
        ) : null}
        {tenants.length > 1 ? (
          <label className="p-li">
            <span className="grow"><strong>Business</strong><span className="muted tiny">Switch between your businesses</span></span>
            <select className="select" value={tenant?.id} onChange={(e) => switchTenant(e.target.value)} aria-label="Business">
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ) : null}
        <Link to="/emc/setup/licence" className="p-li"><span className="grow"><strong>Licence</strong><span className="muted tiny">{licence.status === "valid" ? `Valid${licence.daysLeft !== null ? ` · ${licence.daysLeft} days left` : ""}` : licence.status}</span></span><Icon name="chevron" size={18} className="p-chev" /></Link>
        <Link to="/emc/about" className="p-li"><span className="grow"><strong>About and help</strong><span className="muted tiny">Version, updates, your supplier</span></span><Icon name="chevron" size={18} className="p-chev" /></Link>
        {mode === "firebase" ? <button className="p-li" onClick={() => void signOut()}><span className="grow"><strong style={{ color: "var(--bad)" }}>Sign out</strong></span><Icon name="logout" size={18} /></button> : null}
      </div>
      <InstallCard />
    </div>
  );
}

/** The phone's top-bar title: the module (the page names itself, and the pills show its sections). */
export function phoneTitle(pathname: string, search: string, fallback: string): string {
  if (pathname === "/emc/tasks") return "Tasks";
  if (pathname === "/emc/account") return "Account";
  return workspaceFor(pathname, search)?.name ?? fallback;
}
