import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type Check,
  type CheckLine,
  type Customer,
  type MenuCategory,
  type MenuItem,
  type MobileStyle,
  type OrderType,
  type PosContext,
  type PosJournal,
  type Printer,
  type PrivilegeKey,
  type RevenueCenter,
  type Role,
  type Staff,
  type Table,
  type TenderMedia,
  type Workstation,
  type LimitKind,
  COLLECTIONS as C,
  activeLines,
  computeCheckTotals,
  hasPrivilege,
} from "@pos/core";
import type { CheckTotals } from "@pos/engine";
import { type ReceiptDoc, buildBill, widthForPaper } from "@pos/printing";
import { minutesSince, money, moneyShort, timeColombo } from "../../../lib/format";
import { paperWidthFor } from "../../../lib/printing";
import { useApp, useCollection } from "../../../state/app";
import { Icon, type IconName } from "./icons";
import { MobilePay, PaySuccess } from "./MobilePay";
import { BluetoothPrinterButton, BluetoothPrinterPanel } from "../BluetoothPrinter";
import { MobileReports, SalesChart, StatTile, change, useSales } from "./MobileReports";
import { greeting, initials, mobileVars, useViewport } from "./ui";
import "./mobile.css";

type Limit = { kind: LimitKind; value: number; label: string };

export interface PaidResult {
  invoiceNo: string;
  checkNo: number;
  tableName?: string;
  total: number;
  change: number;
  doc: ReceiptDoc;
  printed: boolean;
  tenders: string[];
}

/** Everything the phone/tablet screens need from the POS (same rules, journal and printing as the terminal). */
export interface PosApi {
  ws: Workstation;
  user: Staff;
  role: Role | undefined;
  staff: Staff[];
  rvcs: RevenueCenter[];
  rvcId: string;
  rvc: RevenueCenter | undefined;
  myRvcs: string[];
  ctx: PosContext;
  bd: string;
  menuItems: MenuItem[];
  categories: MenuCategory[];
  tables: Table[];
  openChecks: Check[];
  orderTypes: OrderType[];
  tenders: TenderMedia[];
  printers: Printer[];
  imageOf: Map<string, string>;
  catColor: Map<string, string>;
  customer: Customer | undefined;
  check: Check | null;
  setCheck: (c: Check | null) => void;
  totals: CheckTotals | null;
  itemCount: number;
  startCheck: (opts?: { orderTypeId?: string; tableId?: string; covers?: number }) => Promise<Check>;
  tapItem: (m: MenuItem) => void;
  changeQty: (l: CheckLine, delta: number) => void;
  voidLine: (l: CheckLine) => void;
  overridePrice: (l: CheckLine) => void;
  splitLine: (l: CheckLine) => void;
  send: (c?: Check | null, leave?: boolean) => Promise<Check | null>;
  printGuestCheck: () => Promise<void>;
  /** Prints the kitchen tickets of what was already sent, marked REPRINT. */
  reprintKot: () => Promise<void>;
  /** Sending an order prints its kitchen ticket (POS options). */
  kotOnSend: boolean;
  cancelCheck: () => void;
  pickUp: (c: Check) => void;
  openTable: (t: Table) => Promise<void>;
  withPrivilege: (p: PrivilegeKey, run: (by: Staff) => void, limit?: Limit) => void;
  finish: (paid: Check) => Promise<PaidResult | null>;
  print: (kind: "kot" | "bill" | "receipt" | "report", doc: ReceiptDoc, printer: Printer | undefined) => Promise<void>;
  journal: PosJournal;
  lastInvoice: ReceiptDoc | null;
  openDiscount: (scope: "item" | "check", lineId?: string) => void;
  openTransfer: () => void;
  openCustomer: () => Promise<void>;
  openCovers: () => void;
  setOrderType: (id: string) => Promise<void>;
  previewReceipt: (doc: ReceiptDoc, title: string) => void;
  changeRvc: (to: string) => void;
  onSignOut: () => void;
  tableName: (id?: string) => string | undefined;
  staffName: (id: string) => string;
  orderTypeName: (id: string) => string;
  functionsPanel: ReactNode;
  reportsPanel: ReactNode;
}

type Tab = "home" | "tables" | "menu" | "cart" | "orders" | "reports" | "more";
type Overlay = null | { t: "pay" } | { t: "done"; result: PaidResult } | { t: "functions" } | { t: "detailed" } | { t: "rvc" } | { t: "line"; line: CheckLine } | { t: "check" } | { t: "order"; c: Check };

const lineValue = (l: CheckLine) => l.qty * (l.unitPrice + l.modifiers.reduce((a, m) => a + m.price, 0));

/**
 * The POS as a phone/tablet app (Bright or Indigo style): bottom navigation, photo menu, cart with
 * steppers, full-screen payment and a "payment successful" screen. All actions go through the same
 * POS functions as the terminal, so privileges, manager approvals, the journal and printing are identical.
 */
export function MobilePos({ style, api, children }: { style: MobileStyle; api: PosApi; children: ReactNode }) {
  const { settings, on } = useApp();
  const vp = useViewport();
  /**
   * PCs and landscape tablets: the same app, laid out for the width (navigation rail, menu and
   * order side by side, split payment). Phones and portrait tablets: the phone layout.
   */
  const wide = vp.w >= 960 && vp.h >= 540;
  const [tab, setTab] = useState<Tab>("home");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const lastCheckId = useRef<string | null>(null);

  // Opening a table or picking up a check moves on to the menu (new check) or the order (existing).
  useEffect(() => {
    const id = api.check?.id ?? null;
    if (id && id !== lastCheckId.current && (tab === "tables" || tab === "orders" || tab === "home")) setTab(api.check?.lines.length ? "cart" : "menu");
    lastCheckId.current = id;
  }, [api.check?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nav: { key: Tab; label: string; icon: IconName; badge?: number }[] = [
    { key: "home", label: "Home", icon: "home" },
    ...(on("tables") && api.tables.length ? [{ key: "tables" as Tab, label: "Tables", icon: "tables" as IconName }] : []),
    { key: "menu", label: "Menu", icon: "menu" },
    { key: "orders", label: "Orders", icon: "orders", badge: api.openChecks.length },
    { key: "more", label: "More", icon: "more" },
  ];
  if (!nav.some((n) => n.key === "tables")) nav.splice(3, 0, { key: "reports", label: "Reports", icon: "reports" });

  const go = (t: Tab) => {
    setOverlay(null);
    setTab(t);
  };
  const afterSend = () => setTab(on("tables") && api.tables.length ? "tables" : wide ? "menu" : "home");
  const startPay = () => api.withPrivilege("pos.tender", () => setOverlay({ t: "pay" }));

  let screen: ReactNode;
  if (overlay?.t === "pay" && api.check && api.totals) {
    screen = wide ? (
      <div className="w-pay">
        <aside className="w-pay-order" aria-label="Order"><OrderSummary api={api} /></aside>
        <div className="w-pay-main"><MobilePay api={api} style={style} onBack={() => setOverlay(null)} onPaid={(result) => setOverlay({ t: "done", result })} /></div>
      </div>
    ) : (
      <MobilePay api={api} style={style} onBack={() => setOverlay(null)} onPaid={(result) => setOverlay({ t: "done", result })} />
    );
  } else if (overlay?.t === "done") {
    screen = <PaySuccess api={api} result={overlay.result} onDone={() => go(on("tables") && api.tables.length ? "tables" : "menu")} />;
  } else if (overlay?.t === "functions" || overlay?.t === "detailed") {
    screen = (
      <div className="m-page">
        <MHead title={overlay.t === "functions" ? "Functions" : "Detailed reports"} onBack={() => setOverlay(null)} />
        <div className="m-embed">{overlay.t === "functions" ? api.functionsPanel : api.reportsPanel}</div>
      </div>
    );
  } else {
    screen = (
      <>
        {tab === "home" ? <Home api={api} style={style} go={go} onRvc={() => setOverlay({ t: "rvc" })} /> : null}
        {tab === "tables" ? <Tables api={api} onQuick={async () => { await api.startCheck({ ...(api.orderTypes.find((o) => !o.requiresTable) ? { orderTypeId: api.orderTypes.find((o) => !o.requiresTable)!.id } : {}) }); setTab("menu"); }} /> : null}
        {tab === "menu" || (wide && tab === "cart") ? <Menu api={api} wide={wide} onBack={() => setTab(api.check?.tableId ? "tables" : "home")} onCart={() => setTab("cart")} /> : null}
        {tab === "cart" && !wide ? <Cart api={api} onBack={() => setTab("menu")} onPay={startPay} onLine={(line) => setOverlay({ t: "line", line })} onMore={() => setOverlay({ t: "check" })} onSent={afterSend} /> : null}
        {tab === "orders" ? <Orders api={api} onOpenOrder={(c) => (c.status === "open" ? api.pickUp(c) : setOverlay({ t: "order", c }))} /> : null}
        {tab === "reports" ? <><MHead title="Reports" /><MobileReports api={api} style={style} onDetailed={() => setOverlay({ t: "detailed" })} /></> : null}
        {tab === "more" ? <More api={api} go={go} onFunctions={() => setOverlay({ t: "functions" })} onReports={() => setTab("reports")} onDetailed={() => setOverlay({ t: "detailed" })} onRvc={() => setOverlay({ t: "rvc" })} /> : null}
      </>
    );
  }

  const fullScreen = overlay?.t === "pay" || overlay?.t === "done";
  const showCartBar = !wide && !fullScreen && !overlay && (tab === "menu" || tab === "tables" || tab === "home") && api.check && api.itemCount > 0;
  const navOn = (n: Tab) => (tab === n || (wide && n === "menu" && tab === "cart")) && (!overlay || overlay.t === "line" || overlay.t === "check" || overlay.t === "rvc" || overlay.t === "order");
  // On wide screens the order stays beside the menu and the tables.
  const orderPanel = wide && !fullScreen && (tab === "menu" || tab === "cart" || tab === "tables") && overlay?.t !== "functions" && overlay?.t !== "detailed";
  const sheets = (
    <>
      {overlay?.t === "rvc" ? (
        <Sheet title="Revenue centre" onClose={() => setOverlay(null)}>
          {api.myRvcs.map((r) => (
            <button key={r} className={`m-sheet-row${r === api.rvcId ? " on" : ""}`} onClick={() => { setOverlay(null); if (r !== api.rvcId) api.changeRvc(r); }}>
              <Icon name="tables" /> <span className="grow">{api.rvcs.find((x) => x.id === r)?.name ?? r}</span>{r === api.rvcId ? <Icon name="check" /> : null}
            </button>
          ))}
        </Sheet>
      ) : null}
      {overlay?.t === "line" && api.check ? <LineSheet api={api} line={api.check.lines.find((l) => l.id === overlay.line.id) ?? overlay.line} onClose={() => setOverlay(null)} /> : null}
      {overlay?.t === "check" && api.check ? <CheckSheet api={api} onClose={() => setOverlay(null)} onLeave={() => { setOverlay(null); afterSend(); }} /> : null}
      {overlay?.t === "order" ? <OrderSheet api={api} c={overlay.c} onClose={() => setOverlay(null)} /> : null}
    </>
  );

  if (wide) {
    return (
      <div className={`mpos wide ${style}`} style={mobileVars(settings.pos.mobile)} data-ui={style}>
        {!fullScreen ? (
          <aside className="w-rail">
            <div className="w-brand" title={settings.branding.displayName}>
              {settings.branding.logoDataUrl ? <img src={settings.branding.logoDataUrl} alt="" /> : settings.branding.displayName.slice(0, 1)}
            </div>
            <nav className="w-nav" aria-label="POS navigation">
              {nav.map((n) => (
                <button key={n.key} className={navOn(n.key) ? "on" : ""} onClick={() => go(n.key)} aria-label={n.label} aria-current={navOn(n.key) ? "page" : undefined}>
                  <span className="w-nav-ico"><Icon name={n.icon} />{n.badge ? <span className="m-badge">{n.badge}</span> : null}</span>
                  <span>{n.label}</span>
                </button>
              ))}
            </nav>
            <span className="grow" />
            <button className="w-user" onClick={() => go("more")} aria-label={`${api.user.name}: profile and sign out`} title={`${api.user.name} · ${api.ws.code}`}>
              <span className="m-avatar">{initials(api.user.name)}</span>
            </button>
          </aside>
        ) : null}
        <main className={`m-main w-main${fullScreen ? " full" : ""}`}>{screen}</main>
        {orderPanel ? (
          <aside className="w-order" aria-label="Current order">
            <Cart api={api} panel onBack={() => setTab("menu")} onPay={startPay} onLine={(line) => setOverlay({ t: "line", line })} onMore={() => setOverlay({ t: "check" })} onSent={afterSend} />
          </aside>
        ) : null}
        {sheets}
        {children}
      </div>
    );
  }

  return (
    <div className={`mpos ${style}`} style={mobileVars(settings.pos.mobile)} data-ui={style}>
      <main className={`m-main${fullScreen ? " full" : ""}`}>{screen}</main>
      {showCartBar ? (
        <button className="m-cartbar" onClick={() => setTab("cart")}>
          <span className="m-cartbar-count">{api.itemCount}</span>
          <span className="grow">{api.check?.tableId ? `Table ${api.tableName(api.check.tableId)}` : `Order #${api.check?.checkNo}`}<span className="m-cartbar-sub"> · view order</span></span>
          <strong>{money(api.totals?.amountDue)}</strong>
          <Icon name="chevron" size={18} />
        </button>
      ) : null}
      {!fullScreen ? (
        <nav className="m-nav" aria-label="POS navigation">
          {nav.map((n) => (
            <button key={n.key} className={navOn(n.key) ? "on" : ""} onClick={() => go(n.key)} aria-label={n.label}>
              <span className="m-nav-ico"><Icon name={n.icon} />{n.badge ? <span className="m-badge">{n.badge}</span> : null}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {sheets}
      {children}
    </div>
  );
}

function MHead({ title, sub, onBack, right }: { title: string; sub?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="m-head">
      {onBack ? <button className="m-icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" /></button> : <span className="m-icon-btn" />}
      <div className="m-head-title"><strong>{title}</strong>{sub ? <span>{sub}</span> : null}</div>
      {right ?? <span className="m-icon-btn" />}
    </header>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="m-sheet-wrap" onClick={onClose}>
      <div className="m-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <div className="m-sheet-head"><strong>{title}</strong><button className="m-icon-btn sm" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button></div>
        <div className="m-sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Item photo, or a tile in the category colour with the item's initials. `size` 0 = fill the parent. */
function Thumb({ api, item, size = 52 }: { api: PosApi; item: MenuItem | undefined; size?: number }) {
  const img = item?.hasImage ? api.imageOf.get(item.id) : undefined;
  const box = size ? { width: size, height: size } : {};
  if (img) return <img className={`m-thumb${size ? "" : " fill"}`} src={img} alt="" style={box} loading="lazy" />;
  const color = item ? item.buttonColor || api.catColor.get(item.categoryId) || "#94a3b8" : "#94a3b8";
  return <span className={`m-thumb ph${size ? "" : " fill"}`} style={{ ...box, ["--c" as string]: color }} aria-hidden="true">{initials(item?.name ?? "?")}</span>;
}

// ───────────────────────────── Home ─────────────────────────────

function Home({ api, style, go, onRvc }: { api: PosApi; style: MobileStyle; go: (t: Tab) => void; onRvc: () => void }) {
  const { settings, on } = useApp();
  const showSales = settings.pos.mobile?.showSalesOnHome ?? true;
  const sales = useSales(api, 7);
  const t = sales.today;
  const first = api.user.name.split(" ")[0] ?? api.user.name;
  const mine = api.openChecks.filter((c) => c.staffId === api.user.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const quick: { label: string; icon: IconName; run: () => void; tone: string }[] = [
    { label: "New order", icon: "plus", run: () => go("menu"), tone: "#1a73e8" },
    ...(on("tables") && api.tables.length ? [{ label: "Tables", icon: "tables" as IconName, run: () => go("tables"), tone: "#16a34a" }] : []),
    { label: "Orders", icon: "orders", run: () => go("orders"), tone: "#ea580c" },
    { label: "Reports", icon: "reports", run: () => go("reports"), tone: "#9333ea" },
  ];
  return (
    <div className="m-screen">
      <div className="m-hello">
        <span className="m-avatar">{initials(api.user.name)}</span>
        <div className="grow">
          <span className="m-muted small">{greeting()},</span>
          <h1>{first}!</h1>
        </div>
        <button className="m-pill" onClick={api.myRvcs.length > 1 ? onRvc : undefined} aria-label="Revenue centre">{api.rvc?.name ?? api.rvcId}{api.myRvcs.length > 1 ? " ▾" : ""}</button>
      </div>
      <BluetoothPrinterButton ws={api.ws} className="m-btn block bt-home" />
      {showSales && sales.scope !== "none" ? (
        style === "indigo" ? (
          <div className="m-gradient-card">
            <span>{sales.scope === "mine" ? "My sales today" : "Today's sales"}</span>
            <strong>{moneyShort(t?.netSales ?? 0)}</strong>
            {change(t?.netSales ?? 0, sales.yesterday?.netSales) ? <span className="m-delta light">{change(t?.netSales ?? 0, sales.yesterday?.netSales)!.text} vs yesterday</span> : <span className="m-delta light">{api.bd}</span>}
            {sales.series.length ? <SalesChart data={sales.series} kind="bars" height={96} /> : null}
          </div>
        ) : null
      ) : null}
      {showSales && sales.scope !== "none" ? (
        <div className="m-stats">
          {style === "bright" ? <StatTile icon="cash" tone="#1a73e8" label={sales.scope === "mine" ? "My sales" : "Today's sales"} value={moneyShort(t?.netSales ?? 0)} delta={change(t?.netSales ?? 0, sales.yesterday?.netSales)} /> : null}
          <StatTile icon="orders" tone="#16a34a" label="Orders" value={String(t?.checks ?? 0)} delta={change(t?.checks ?? 0, sales.yesterday?.checks)} />
          <StatTile icon="users" tone="#ea580c" label="Guests" value={String(t?.covers ?? 0)} />
          <StatTile icon="trend" tone="#9333ea" label="Avg order" value={moneyShort(t?.checks ? Math.round(t.netSales / t.checks) : 0)} />
          {style === "indigo" ? <StatTile icon="clock" tone="#0891b2" label="Open now" value={String(api.openChecks.length)} /> : null}
        </div>
      ) : null}
      {showSales && sales.scope === "property" && style === "bright" && sales.series.length ? (
        <div className="m-card">
          <div className="m-card-head"><strong>Sales this week</strong><button className="m-link" onClick={() => go("reports")}>See report</button></div>
          <SalesChart data={sales.series} kind="line" />
        </div>
      ) : null}
      <div className="m-section-title">Quick actions</div>
      <div className="m-quick">
        {quick.map((q) => (
          <button key={q.label} onClick={q.run}>
            <span className="m-quick-ico" style={{ ["--tone" as string]: q.tone }}><Icon name={q.icon} /></span>
            <span>{q.label}</span>
          </button>
        ))}
      </div>
      <div className="m-section-title row between"><span>My open orders</span>{mine.length ? <button className="m-link" onClick={() => go("orders")}>See all</button> : null}</div>
      {mine.length ? (
        <div className="m-card m-list">
          {mine.slice(0, 4).map((c) => <OrderRow key={c.id} api={api} c={c} onClick={() => api.pickUp(c)} />)}
        </div>
      ) : (
        <div className="m-card m-empty small"><p>No open orders. Tap <strong>New order</strong> to start.</p></div>
      )}
    </div>
  );
}

// ───────────────────────────── Tables ─────────────────────────────

function Tables({ api, onQuick }: { api: PosApi; onQuick: () => void }) {
  const areas = [...new Set(api.tables.map((t) => t.area))];
  const [area, setArea] = useState<string>("");
  const [status, setStatus] = useState<"" | "free" | "busy">("");
  const busy = new Map(api.openChecks.filter((c) => c.tableId).map((c) => [c.tableId!, c]));
  const shown = api.tables.filter((t) => (!area || t.area === area) && (!status || (status === "busy") === busy.has(t.id)));
  return (
    <>
      <MHead title="Tables" sub={`${api.tables.length - busy.size} available · ${busy.size} occupied`} />
      <div className="m-screen">
        <div className="m-chips">
          <button className={`m-chip${!area ? " on" : ""}`} onClick={() => setArea("")}>All</button>
          {areas.map((a) => <button key={a} className={`m-chip${area === a ? " on" : ""}`} onClick={() => setArea(a)}>{a}</button>)}
        </div>
        <div className="m-legend">
          <button className={status === "free" ? "on" : ""} onClick={() => setStatus(status === "free" ? "" : "free")}><i className="free" /> Available</button>
          <button className={status === "busy" ? "on" : ""} onClick={() => setStatus(status === "busy" ? "" : "busy")}><i className="busy" /> Occupied</button>
          <span><i className="mine" /> Ordering</span>
        </div>
        <div className="m-tables">
          {shown.map((t) => {
            const c = busy.get(t.id);
            const ordering = api.check?.tableId === t.id;
            const amt = c && activeLines(c).length ? computeCheckTotals(c, api.ctx).amountDue : 0;
            return (
              <button key={t.id} className={`m-table ${ordering ? "mine" : c ? "busy" : "free"}`} onClick={() => void api.openTable(t)} aria-label={`Table ${t.name}`}>
                <span className="m-table-name">{t.name}</span>
                <span className="m-table-seats"><Icon name="users" size={14} /> {c ? `${c.covers}/${t.seats}` : t.seats}</span>
                <span className="m-table-status">{ordering ? "Ordering" : c ? "Occupied" : "Available"}</span>
                {c ? <span className="m-table-amt">{money(amt)} · {minutesSince(c.openedAt)}m</span> : null}
              </button>
            );
          })}
        </div>
      </div>
      <button className="m-fab" onClick={onQuick} aria-label="Order without a table"><Icon name="plus" size={26} /></button>
    </>
  );
}

// ───────────────────────────── Menu ─────────────────────────────

function Menu({ api, onBack, onCart, wide = false }: { api: PosApi; onBack: () => void; onCart: () => void; wide?: boolean }) {
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const catOrder = new Map(api.categories.map((c, i) => [c.id, i]));
  const qty = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of api.check ? activeLines(api.check) : []) m.set(l.menuItemId, (m.get(l.menuItemId) ?? 0) + l.qty);
    return m;
  }, [api.check]);
  const items = api.menuItems
    .filter((m) => m.active && catOrder.has(m.categoryId))
    .filter((m) => (q.trim() ? `${m.code} ${m.name} ${m.nameSi ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()) : !cat || m.categoryId === cat))
    .sort((a, b) => (catOrder.get(a.categoryId)! - catOrder.get(b.categoryId)!) || a.sortOrder - b.sortOrder);
  const title = api.check ? (api.check.tableId ? `Table ${api.tableName(api.check.tableId)}` : `Order #${api.check.checkNo}`) : "New order";
  return (
    <>
      {wide ? (
        <MHead title="Menu" sub={`${api.rvc?.name ?? api.rvcId} · tap a dish to add it to the order`} />
      ) : (
        <MHead
          title={title}
          sub={api.check ? `${api.orderTypeName(api.check.orderTypeId)} · ${api.check.covers} guest${api.check.covers === 1 ? "" : "s"}` : "Tap + to add items"}
          onBack={onBack}
          right={<button className="m-icon-btn" onClick={onCart} aria-label="Order"><Icon name="cart" />{api.itemCount ? <span className="m-badge">{api.itemCount}</span> : null}</button>}
        />
      )}
      <div className="m-screen">
        <label className="m-search"><Icon name="search" size={18} /><input placeholder="Search dishes or codes" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search menu" /></label>
        <div className="m-chips">
          <button className={`m-chip${!cat && !q ? " on" : ""}`} onClick={() => { setCat(""); setQ(""); }}>All</button>
          {api.categories.map((c) => <button key={c.id} className={`m-chip${cat === c.id && !q ? " on" : ""}`} onClick={() => { setCat(c.id); setQ(""); }}>{c.name}</button>)}
        </div>
        <div className="m-products">
          {items.map((m) => {
            const n = qty.get(m.id) ?? 0;
            return (
              <div key={m.id} className={`m-product${m.available ? "" : " out"}`}>
                <button className="m-product-tap" onClick={() => api.tapItem(m)} aria-label={`Add ${m.name}`}>
                  <Thumb api={api} item={m} size={0} />
                  {!m.available ? <span className="m-sold">Sold out</span> : null}
                  {n ? <span className="m-qty-badge">{n}</span> : null}
                </button>
                <div className="m-product-meta">
                  <span className="m-product-name">{m.name}</span>
                  <div className="row between">
                    <strong className="m-price">{m.openPrice ? "Open price" : money(m.price)}</strong>
                    <button className="m-add" onClick={() => api.tapItem(m)} disabled={!m.available} aria-label={`Add one ${m.name}`}><Icon name="plus" size={18} strokeWidth={2.6} /></button>
                  </div>
                  {m.allergens.length ? <span className="m-allergen">Contains {m.allergens.join(", ")}</span> : null}
                </div>
              </div>
            );
          })}
          {!items.length ? <p className="m-muted">No items found.</p> : null}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── Cart / order ─────────────────────────────

function Cart({ api, onBack, onPay, onLine, onMore, onSent, panel = false }: { api: PosApi; onBack: () => void; onPay: () => void; onLine: (l: CheckLine) => void; onMore: () => void; onSent: () => void; panel?: boolean }) {
  const { on } = useApp();
  const c = api.check;
  const menu = new Map(api.menuItems.map((m) => [m.id, m]));
  const unsent = c?.lines.filter((l) => l.sentRound === undefined && !l.voided).length ?? 0;
  const t = api.totals;
  return (
    <div className="m-page">
      <MHead
        title={c ? (c.tableId ? `Table ${api.tableName(c.tableId)}` : `Order #${c.checkNo}`) : panel ? "New order" : "Order"}
        {...(c ? { sub: `Check #${c.checkNo} · ${api.staffName(c.staffId)}` } : panel ? { sub: "Tap a dish to start" } : {})}
        {...(panel ? {} : { onBack })}
        right={c ? <button className="m-icon-btn" onClick={onMore} aria-label="Order options"><Icon name="dots" /></button> : undefined}
      />
      <div className="m-screen">
        {!c || !c.lines.length ? (
          panel ? (
            <div className="m-empty"><Icon name="cart" size={40} /><p>No items yet. Tap a dish on the menu{api.tables.length ? ", or choose a table" : ""}.</p></div>
          ) : (
            <div className="m-empty"><Icon name="cart" size={40} /><p>No items yet.</p><button className="m-btn cta" onClick={onBack}>Browse the menu</button></div>
          )
        ) : (
          <>
            <div className="m-order-info">
              <button className="m-pill" onClick={api.openCovers}><Icon name="users" size={16} /> {c.covers} guest{c.covers === 1 ? "" : "s"}</button>
              {api.orderTypes.length > 1 ? (
                <select className="m-pill" value={c.orderTypeId} onChange={(e) => void api.setOrderType(e.target.value)} aria-label="Order type">
                  {api.orderTypes.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : null}
              <button className="m-pill" onClick={() => void api.openCustomer()}><Icon name="user" size={16} /> {api.customer ? api.customer.name : on("crm") ? "Guest" : "Allergies / VAT"}</button>
            </div>
            {c.allergies?.length ? <div className="m-alert">Allergy: {c.allergies.join(", ")}</div> : null}
            <div className="m-card m-list">
              {c.lines.map((l) => (
                <div key={l.id} className={`m-line${l.voided ? " void" : ""}`}>
                  <button className="m-line-main" onClick={() => !l.voided && onLine(l)} aria-label={`${l.name} options`}>
                    <Thumb api={api} item={menu.get(l.menuItemId)} size={48} />
                    <span className="m-line-text">
                      <strong>{l.name}</strong>
                      {l.modifiers.length ? <span>{l.modifiers.map((m) => m.name).join(" · ")}</span> : null}
                      {l.note ? <span>“{l.note}”</span> : null}
                      {l.discountIds.length ? <span className="m-good">{l.discountIds.map((d) => api.ctx.discounts.get(d)?.name).join(", ")}</span> : null}
                      <span className="m-line-price">{money(lineValue(l))}{l.voided ? " · VOID" : l.sentRound !== undefined ? " · sent" : ""}</span>
                    </span>
                  </button>
                  {l.voided ? null : l.sentRound === undefined ? (
                    <span className="m-stepper">
                      <button onClick={() => api.changeQty(l, -1)} aria-label={`One less ${l.name}`}>{l.qty === 1 ? <Icon name="trash" size={16} /> : <Icon name="minus" size={16} />}</button>
                      <span className="num">{l.qty}</span>
                      <button onClick={() => api.changeQty(l, 1)} aria-label={`One more ${l.name}`}><Icon name="plus" size={16} /></button>
                    </span>
                  ) : (
                    <span className="m-sent">×{l.qty}</span>
                  )}
                </div>
              ))}
            </div>
            {t ? (
              <div className="m-card m-totals">
                <div className="row between"><span>Subtotal</span><span>{money(t.itemsTotal)}</span></div>
                {t.discountTotal ? <div className="row between m-good"><span>Discounts</span><span>−{money(t.discountTotal)}</span></div> : null}
                {t.charges.filter((x) => x.amount).map((x) => <div key={x.ruleId} className="row between m-muted"><span>{x.name}</span><span>{money(x.amount)}</span></div>)}
                {t.roundingAdjustment ? <div className="row between m-muted"><span>Rounding</span><span>{money(t.roundingAdjustment)}</span></div> : null}
                <div className="row between m-grand"><span>Total</span><strong>{money(t.amountDue)}</strong></div>
              </div>
            ) : null}
          </>
        )}
      </div>
      {c && c.lines.length ? (
        <footer className="m-foot row">
          <button className="m-btn outline" disabled={!unsent} onClick={async () => { await api.send(); onSent(); }} aria-label={api.kotOnSend ? "Send and print the kitchen ticket" : "Send to the kitchen"}><Icon name="send" size={18} /> {api.kotOnSend ? "Send KOT" : "Send"}{unsent ? ` (${unsent})` : ""}</button>
          <button className="m-btn cta grow lg" disabled={!t} onClick={onPay}>{panel && t ? `Pay ${money(t.amountDue)}` : "Proceed to Payment"} <Icon name="chevron" size={18} /></button>
        </footer>
      ) : null}
    </div>
  );
}

/** The order beside the payment on wide screens: what the guest is paying for, read only. */
function OrderSummary({ api }: { api: PosApi }) {
  const c = api.check!;
  const t = api.totals;
  const menu = new Map(api.menuItems.map((m) => [m.id, m]));
  return (
    <div className="m-page">
      <MHead title={c.tableId ? `Table ${api.tableName(c.tableId)}` : `Order #${c.checkNo}`} sub={`Check #${c.checkNo} · ${api.staffName(c.staffId)} · ${c.covers} guest${c.covers === 1 ? "" : "s"}`} />
      <div className="m-screen">
        <div className="m-card m-list">
          {activeLines(c).map((l) => (
            <div key={l.id} className="m-line">
              <span className="m-line-main static">
                <Thumb api={api} item={menu.get(l.menuItemId)} size={40} />
                <span className="m-line-text">
                  <strong>{l.qty} × {l.name}</strong>
                  {l.modifiers.length ? <span>{l.modifiers.map((m) => m.name).join(" · ")}</span> : null}
                  <span className="m-line-price">{money(lineValue(l))}</span>
                </span>
              </span>
            </div>
          ))}
        </div>
        {t ? (
          <div className="m-card m-totals">
            <div className="row between"><span>Subtotal</span><span>{money(t.itemsTotal)}</span></div>
            {t.discountTotal ? <div className="row between m-good"><span>Discounts</span><span>−{money(t.discountTotal)}</span></div> : null}
            {t.charges.filter((x) => x.amount).map((x) => <div key={x.ruleId} className="row between m-muted"><span>{x.name}</span><span>{money(x.amount)}</span></div>)}
            {t.roundingAdjustment ? <div className="row between m-muted"><span>Rounding</span><span>{money(t.roundingAdjustment)}</span></div> : null}
            <div className="row between m-grand"><span>Total</span><strong>{money(t.amountDue)}</strong></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LineSheet({ api, line, onClose }: { api: PosApi; line: CheckLine; onClose: () => void }) {
  const unsent = line.sentRound === undefined;
  const act = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Sheet title={`${line.qty} × ${line.name}`} onClose={onClose}>
      <button className="m-sheet-row" onClick={act(() => api.openDiscount("item", line.id))}><Icon name="percent" /> <span className="grow">Discount this item</span></button>
      {unsent ? <button className="m-sheet-row" onClick={act(() => api.overridePrice(line))}><Icon name="note" /> <span className="grow">Change price</span></button> : null}
      <button className="m-sheet-row" onClick={act(() => api.splitLine(line))}><Icon name="swap" /> <span className="grow">Move to a separate bill</span></button>
      <button className="m-sheet-row bad" onClick={act(() => api.voidLine(line))}><Icon name="trash" /> <span className="grow">{unsent ? "Remove" : "Void (manager may need to approve)"}</span></button>
    </Sheet>
  );
}

function CheckSheet({ api, onClose, onLeave }: { api: PosApi; onClose: () => void; onLeave: () => void }) {
  const c = api.check!;
  const unsent = c.lines.some((l) => l.sentRound === undefined && !l.voided);
  const act = (fn: () => void) => () => { onClose(); fn(); };
  return (
    <Sheet title={`Check #${c.checkNo}`} onClose={onClose}>
      <button className="m-sheet-row" disabled={!api.totals} onClick={act(() => void api.printGuestCheck())}><Icon name="printer" /> <span className="grow">Print bill (guest check)</span></button>
      <button className="m-sheet-row" disabled={!api.totals} onClick={act(() => api.openDiscount("check"))}><Icon name="percent" /> <span className="grow">Discount the whole bill</span></button>
      <button className="m-sheet-row" onClick={act(api.openCovers)}><Icon name="users" /> <span className="grow">Number of guests</span></button>
      <button className="m-sheet-row" onClick={act(() => void api.openCustomer())}><Icon name="user" /> <span className="grow">Guest, allergies, VAT buyer</span></button>
      {c.lines.length ? <button className="m-sheet-row" onClick={act(api.openTransfer)}><Icon name="swap" /> <span className="grow">Transfer to a table or employee</span></button> : null}
      <button className="m-sheet-row" onClick={async () => { onClose(); await api.send(); onLeave(); }}><Icon name="send" /> <span className="grow">{api.kotOnSend ? "Send, print the KOT and hold" : "Send and hold"}</span></button>
      {c.lines.some((l) => l.sentRound !== undefined && !l.voided) ? <button className="m-sheet-row" onClick={act(() => void api.reprintKot())}><Icon name="printer" /> <span className="grow">Print kitchen ticket again (KOT)</span></button> : null}
      <button className="m-sheet-row bad" onClick={() => { onClose(); api.cancelCheck(); if (!unsent) onLeave(); }}><Icon name="x" /> <span className="grow">{unsent ? "Cancel unsent items" : "Close this screen"}</span></button>
    </Sheet>
  );
}

// ───────────────────────────── Orders ─────────────────────────────

function OrderRow({ api, c, onClick }: { api: PosApi; c: Check; onClick: () => void }) {
  const amt = c.status === "closed" ? (c.totals?.amountDue ?? 0) : activeLines(c).length ? computeCheckTotals(c, api.ctx).amountDue : 0;
  const n = activeLines(c).reduce((a, l) => a + l.qty, 0);
  return (
    <button className="m-order" onClick={onClick}>
      <span className={`m-order-ico ${c.status}`}><Icon name={c.status === "open" ? "clock" : c.status === "closed" ? "check" : "x"} size={18} /></span>
      <span className="m-order-text">
        <strong>#{c.checkNo}{c.tableId ? ` · Table ${api.tableName(c.tableId)}` : ` · ${api.orderTypeName(c.orderTypeId)}`}</strong>
        <span>{timeColombo(c.closedAt ?? c.openedAt)} · {n} item{n === 1 ? "" : "s"} · {api.staffName(c.staffId)}</span>
      </span>
      <span className="m-order-right">
        <strong>{money(amt)}</strong>
        <span className={`m-status ${c.status}`}>{c.status === "open" ? "Open" : c.status === "closed" ? "Paid" : "Voided"}</span>
      </span>
    </button>
  );
}

function Orders({ api, onOpenOrder }: { api: PosApi; onOpenOrder: (c: Check) => void }) {
  const [f, setF] = useState<"all" | "open" | "closed" | "mine">("all");
  const [q, setQ] = useState("");
  const today = (useCollection<Check>(C.checks, { where: [["businessDate", "==", api.bd]] }) ?? []).filter((c) => c.propertyId === api.ws.propertyId && (c.rvcId ?? api.rvcId) === api.rvcId);
  const seeAll = hasPrivilege(api.role, "pos.pickupAnyCheck") || hasPrivilege(api.role, "pos.reports");
  const list = today
    .filter((c) => seeAll || c.staffId === api.user.id)
    .filter((c) => (f === "all" ? true : f === "mine" ? c.staffId === api.user.id : c.status === f))
    .filter((c) => !q.trim() || `${c.checkNo} ${api.tableName(c.tableId) ?? ""} ${c.invoiceNo ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || (b.closedAt ?? b.openedAt).localeCompare(a.closedAt ?? a.openedAt));
  const count = (s: string) => today.filter((c) => (seeAll || c.staffId === api.user.id) && (s === "mine" ? c.staffId === api.user.id : s === "all" || c.status === s)).length;
  return (
    <>
      <MHead title="Orders" sub={`Today · ${api.rvc?.name ?? api.rvcId}`} />
      <div className="m-screen">
        <label className="m-search"><Icon name="search" size={18} /><input placeholder="Check, table or invoice number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" /></label>
        <div className="m-chips">
          {([["all", "All"], ["open", "Open"], ["closed", "Paid"], ["mine", "Mine"]] as const).map(([k, label]) => (
            <button key={k} className={`m-chip${f === k ? " on" : ""}`} onClick={() => setF(k)}>{label} <span className="m-chip-n">{count(k)}</span></button>
          ))}
        </div>
        {list.length ? <div className="m-card m-list">{list.map((c) => <OrderRow key={c.id} api={api} c={c} onClick={() => onOpenOrder(c)} />)}</div> : <div className="m-empty"><Icon name="orders" size={36} /><p>No orders here yet.</p></div>}
      </div>
    </>
  );
}

function OrderSheet({ api, c, onClose }: { api: PosApi; c: Check; onClose: () => void }) {
  const { settings } = useApp();
  const printer = api.printers.find((p) => p.id === api.ws.receiptPrinterId);
  const doc = () =>
    c.totals && c.invoiceNo
      ? buildBill({ kind: "invoice", check: c, totals: c.totals, business: settings.business, branding: settings.branding, width: paperWidthFor(api.ws, printer), staffName: api.staffName(c.staffId), orderTypeName: api.orderTypeName(c.orderTypeId), tableName: api.tableName(c.tableId), tenders: api.ctx.tenders, invoiceNo: c.invoiceNo, issuedAt: c.closedAt ?? c.openedAt, copy: true })
      : null;
  return (
    <Sheet title={`#${c.checkNo} · ${c.invoiceNo ?? ""}`} onClose={onClose}>
      <div className="m-receipt-card m-card">
        <div className="row between"><span className="m-muted">Paid</span><strong>{money(c.totals?.amountDue ?? 0)}</strong></div>
        <div className="row between"><span className="m-muted">Closed</span><span>{timeColombo(c.closedAt)}</span></div>
        <div className="row between"><span className="m-muted">By</span><span>{c.payments.map((p) => api.ctx.tenders.get(p.tenderId)?.name ?? p.tenderId).join(", ")}</span></div>
      </div>
      <button className="m-sheet-row" onClick={() => { const d = doc(); onClose(); if (d) api.previewReceipt(d, `Invoice ${c.invoiceNo} (copy)`); }}><Icon name="orders" /> <span className="grow">View receipt</span></button>
      <button className="m-sheet-row" onClick={() => { const d = doc(); onClose(); if (d) api.withPrivilege("pos.reprint", (by) => void api.print("receipt", d, printer).then(() => api.journal.log({ type: "reprint", employeeId: api.user.id, ...(by.id !== api.user.id ? { authorizedBy: by.id } : {}), ...{ checkId: c.id, checkNo: c.checkNo }, detail: c.invoiceNo ?? "" }))); }}><Icon name="printer" /> <span className="grow">Reprint a copy</span></button>
    </Sheet>
  );
}

// ───────────────────────────── More ─────────────────────────────

function More({ api, go, onFunctions, onReports, onDetailed, onRvc }: { api: PosApi; go: (t: Tab) => void; onFunctions: () => void; onReports: () => void; onDetailed: () => void; onRvc: () => void }) {
  const { settings } = useApp();
  const [printerOpen, setPrinterOpen] = useState(false);
  return (
    <>
      <MHead title="More" />
      <div className="m-screen">
        <div className="m-card m-profile">
          <span className="m-avatar lg">{initials(api.user.name)}</span>
          <div className="grow">
            <strong>{api.user.name}</strong>
            <span className="m-muted small">{api.role?.name ?? "Employee"} · #{api.user.employeeNo}</span>
            <span className="m-muted small">{api.ws.name} ({api.ws.code}) · {api.rvc?.name}</span>
          </div>
        </div>
        <div className="m-card m-list">
          {api.myRvcs.length > 1 ? <button className="m-sheet-row" onClick={onRvc}><Icon name="tables" /> <span className="grow">Change revenue centre</span><Icon name="chevron" size={18} /></button> : null}
          <button className="m-sheet-row" onClick={onFunctions}><Icon name="bolt" /> <span className="grow">Functions: X/Z report, cash, 86, clock out</span><Icon name="chevron" size={18} /></button>
          <button className="m-sheet-row" onClick={onReports}><Icon name="reports" /> <span className="grow">Sales dashboard</span><Icon name="chevron" size={18} /></button>
          <button className="m-sheet-row" onClick={onDetailed}><Icon name="orders" /> <span className="grow">Detailed reports</span><Icon name="chevron" size={18} /></button>
          <button className="m-sheet-row" onClick={() => go("orders")}><Icon name="clock" /> <span className="grow">Today's orders</span><Icon name="chevron" size={18} /></button>
          {api.ws.printMode === "bluetooth" ? <button className="m-sheet-row" onClick={() => setPrinterOpen(true)}><span aria-hidden>🖨</span> <span className="grow">Bluetooth printer</span><Icon name="chevron" size={18} /></button> : null}
          <Link className="m-sheet-row" to="/emc/home"><Icon name="settings" /> <span className="grow">Back office</span><Icon name="chevron" size={18} /></Link>
        </div>
        <button className="m-btn danger block" onClick={api.onSignOut}><Icon name="logout" size={18} /> Sign out</button>
        <p className="m-muted tiny center">{settings.branding.displayName}{settings.branding.poweredBy ? ` · Powered by ${settings.branding.poweredBy}` : ""}</p>
      </div>
      {printerOpen ? <BluetoothPrinterPanel ws={api.ws} onClose={() => setPrinterOpen(false)} /> : null}
    </>
  );
}
