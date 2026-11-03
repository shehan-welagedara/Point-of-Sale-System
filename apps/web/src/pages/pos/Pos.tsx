import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  type Check,
  type CheckLine,
  type CheckModifier,
  type Customer,
  type DailyStats,
  type Discount,
  type Invoice,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type OrderType,
  type PosContext,
  type Printer,
  type PrivilegeKey,
  type ReasonCode,
  type RevenueCenter,
  type Role,
  type Staff,
  type Table,
  type TenderMedia,
  type Workstation,
  COLLECTIONS as C,
  activeLines,
  allocateCheckNo,
  businessDateNow,
  closeCheck,
  computeCheckTotals,
  eodWhatsAppText,
  hasPrivilege,
  lankaQrPayload,
  newCheck,
  newId,
  processDepletion,
  sendRound,
  statsId,
  verifyPin,
} from "@pos/core";
import { type ReceiptDoc, buildBill, buildDaySummary, buildKot, widthForPaper } from "@pos/printing";
import { Empty, Loading, Modal, Seg } from "../../components/ui";
import { ReceiptView } from "../../components/Receipt";
import { minutesSince, money, timeColombo } from "../../lib/format";
import { queuePrint, routePrinter } from "../../lib/printing";
import { useApp, useCollection, useStore } from "../../state/app";
import { CustomerDialog, DiscountDialog, ManagerAuth, ModifierDialog, PinEntry, ReasonDialog } from "./dialogs";
import { PayDialog } from "./PayDialog";

const WS_KEY = "pos-suite.workstation";

export function PosApp() {
  const { on, store, settings } = useApp();
  const workstations = useCollection<Workstation>(C.workstations);
  const staff = useCollection<Staff>(C.staff);
  const [wsId, setWsId] = useState<string | null>(() => localStorage.getItem(WS_KEY));
  const [user, setUser] = useState<Staff | null>(null);
  if (!on("pos")) return <Empty title="The Point of Sale module is not enabled for this business" />;
  if (!store || !workstations || !staff) return <Loading />;
  const ws = workstations.find((w) => w.id === wsId && w.active);
  if (!ws) return <DeviceSetup workstations={workstations.filter((w) => w.active)} onPick={(id) => { localStorage.setItem(WS_KEY, id); setWsId(id); }} />;
  if (!user) return <SignIn ws={ws} staff={staff.filter((s) => s.status === "active" && (!s.propertyIds?.length || s.propertyIds.includes(ws.propertyId)))} brand={settings.branding.displayName} logo={settings.branding.logoDataUrl} onSignIn={setUser} onChangeDevice={() => { localStorage.removeItem(WS_KEY); setWsId(null); }} />;
  return <PosMain ws={ws} user={user} staff={staff} onSignOut={() => setUser(null)} />;
}

function DeviceSetup({ workstations, onPick }: { workstations: Workstation[]; onPick: (id: string) => void }) {
  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(620px, 100%)" }}>
        <h1>Set up this device</h1>
        <p className="muted">Choose which workstation this screen is. Each workstation numbers its own bills (IRD invoice series), so use each one on only one device.</p>
        <div className="stack tight">
          {workstations.map((w) => (
            <button key={w.id} className="btn lg block" style={{ justifyContent: "space-between" }} onClick={() => onPick(w.id)}>
              <span>{w.name}</span>
              <span className={`badge ${w.deviceProfile === "mobile" ? "info" : "brand"}`}>{w.deviceProfile === "mobile" ? "Tablet / mobile" : "Dedicated terminal"} · {w.code}</span>
            </button>
          ))}
          {workstations.length === 0 ? <p className="muted">No workstations yet. Add one under Setup → Devices &amp; printers.</p> : null}
        </div>
        <Link to="/emc/dashboard" className="small">← Back office</Link>
      </div>
    </div>
  );
}

function SignIn({ ws, staff, brand, logo, onSignIn, onChangeDevice }: { ws: Workstation; staff: Staff[]; brand: string; logo?: string; onSignIn: (s: Staff) => void; onChangeDevice: () => void }) {
  const [who, setWho] = useState<Staff | null>(null);
  const [err, setErr] = useState("");
  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(620px, 100%)", alignItems: "center" }}>
        <div className="row">
          <div className="brand-logo" style={{ width: 48, height: 48 }}>{logo ? <img src={logo} alt="" /> : brand.slice(0, 1)}</div>
          <div>
            <h2>{brand}</h2>
            <div className="small muted">{ws.name} · {ws.code}</div>
          </div>
        </div>
        {!who ? (
          <>
            <p className="muted">Tap your name</p>
            <div className="grid cols-3" style={{ width: "100%" }}>
              {staff.map((s) => (
                <button key={s.id} className="btn lg" style={{ flexDirection: "column", height: 78, borderRadius: 16 }} onClick={() => { setWho(s); setErr(""); }}>
                  <span>{s.name}</span>
                  <span className="tiny muted">#{s.employeeNo}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p><strong>{who.name}</strong>, enter your PIN</p>
            <PinEntry error={err} onSubmit={async (pin) => ((await verifyPin(pin, who.pinHash, who.pinSalt)) ? onSignIn(who) : setErr("Wrong PIN"))} />
            <button className="btn ghost sm" onClick={() => setWho(null)}>Not {who.name.split(" ")[0]}?</button>
          </>
        )}
        <div className="row">
          <Link to="/emc/dashboard" className="btn ghost sm">Back office</Link>
          <button className="btn ghost sm" onClick={onChangeDevice}>Change workstation</button>
        </div>
      </div>
    </div>
  );
}

type View = "order" | "tables" | "checks" | "functions";

function PosMain({ ws, user, staff, onSignOut }: { ws: Workstation; user: Staff; staff: Staff[]; onSignOut: () => void }) {
  const { settings, on, toast } = useApp();
  const store = useStore();
  const menuItems = useCollection<MenuItem>(C.menuItems) ?? [];
  const categories = useCollection<MenuCategory>(C.menuCategories) ?? [];
  const modifierGroups = useCollection<ModifierGroup>(C.modifierGroups) ?? [];
  const tenders = useCollection<TenderMedia>(C.tenderMedia) ?? [];
  const discounts = useCollection<Discount>(C.discounts) ?? [];
  const orderTypes = (useCollection<OrderType>(C.orderTypes) ?? []).filter((o) => o.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const tables = (useCollection<Table>(on("tables") ? C.tables : null) ?? []).filter((t) => t.propertyId === ws.propertyId).sort((a, b) => a.sortOrder - b.sortOrder);
  const printers = (useCollection<Printer>(C.printers) ?? []).filter((p) => p.propertyId === ws.propertyId);
  const reasons = useCollection<ReasonCode>(C.reasonCodes) ?? [];
  const roles = useCollection<Role>(C.roles) ?? [];
  const rvcs = useCollection<RevenueCenter>(C.revenueCenters) ?? [];
  const customers = useCollection<Customer>(on("crm") ? C.customers : null) ?? [];
  const openChecks = (useCollection<Check>(C.checks, { where: [["status", "==", "open"]] }) ?? []).filter((c) => c.propertyId === ws.propertyId);

  const role = roles.find((r) => r.id === user.roleId);
  const rvc = rvcs.find((r) => r.id === ws.rvcId);
  const ctx: PosContext = useMemo(
    () => ({
      tax: settings.tax,
      business: settings.business,
      pos: settings.pos,
      discounts: new Map(discounts.map((d) => [d.id, d])),
      tenders: new Map(tenders.map((t) => [t.id, t])),
      categories: new Map(categories.map((c) => [c.id, c])),
      inventoryOn: on("inventory"),
      crmOn: on("crm"),
      loyaltyOn: on("loyalty"),
    }),
    [settings, discounts, tenders, categories, on],
  );

  const [view, setView] = useState<View>("order");
  const [check, setCheck] = useState<Check | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialog, setDialog] = useState<
    | { t: "mods"; item: MenuItem }
    | { t: "allergy"; item: MenuItem; hits: string[] }
    | { t: "auth"; privilege: PrivilegeKey; then: (by: Staff) => void }
    | { t: "reason"; type: ReasonCode["type"]; title: string; then: (r: ReasonCode) => void }
    | { t: "discount"; scope: "item" | "check" }
    | { t: "customer" }
    | { t: "covers"; then: (n: number) => void }
    | { t: "pay" }
    | { t: "receipt"; doc: ReceiptDoc; change?: number; title: string }
    | null
  >(null);
  const [lastInvoice, setLastInvoice] = useState<ReceiptDoc | null>(null);

  const visibleCats = categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder);
  useEffect(() => {
    if (!cat && visibleCats[0]) setCat(visibleCats[0].id);
  }, [cat, visibleCats]);

  const totals = useMemo(() => (check && activeLines(check).length ? computeCheckTotals(check, ctx) : null), [check, ctx]);
  const bd = businessDateNow(settings.pos);
  const paperWidth = (p?: Printer) => widthForPaper(p?.paperWidthMm ?? 80);
  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  const orderTypeName = (id: string) => orderTypes.find((o) => o.id === id)?.name ?? id;
  const tableName = (id?: string) => tables.find((t) => t.id === id)?.name;

  function withPrivilege(p: PrivilegeKey, run: (by: Staff) => void) {
    if (hasPrivilege(role, p)) return run(user);
    setDialog({ t: "auth", privilege: p, then: (by) => { setDialog(null); run(by); } });
  }

  async function print(kind: "kot" | "bill" | "receipt" | "report", doc: ReceiptDoc, printer: Printer | undefined) {
    if (ws.printMode === "preview" || !printer) {
      setDialog({ t: "receipt", doc, title: kind === "kot" ? "Kitchen ticket" : "Preview" });
      return;
    }
    await queuePrint(store, { printer, workstationId: ws.id, kind, doc });
  }

  async function startCheck(opts: { orderTypeId?: string; tableId?: string; covers?: number } = {}): Promise<Check> {
    const checkNo = await allocateCheckNo(store, ws.id, bd);
    const c = newCheck({ propertyId: ws.propertyId, rvcId: ws.rvcId, workstationId: ws.id, checkNo, orderTypeId: opts.orderTypeId ?? rvc?.defaultOrderTypeId ?? orderTypes[0]?.id ?? "dine-in", staffId: user.id, businessDate: bd, covers: opts.covers ?? 1, ...(opts.tableId ? { tableId: opts.tableId } : {}) });
    setCheck(c);
    setSel(null);
    return c;
  }

  async function persist(c: Check) {
    setCheck(c);
    await store.set(C.checks, c);
  }

  async function addItem(item: MenuItem, mods: CheckModifier[], qty: number, note: string) {
    const c = check ?? (await startCheck());
    const line: CheckLine = { id: newId(), menuItemId: item.id, name: item.name, qty, unitPrice: item.price, modifiers: mods, taxClass: item.taxClass, kotRoute: item.kotRoute, categoryId: item.categoryId, discountIds: [], ...(note ? { note } : {}) };
    setCheck({ ...c, lines: [...c.lines, line] });
    setSel(line.id);
    setDialog(null);
  }

  function tapItem(item: MenuItem) {
    if (!item.available) return toast(`${item.name} is out of stock (86)`, true);
    const hits = item.allergens.filter((a) => check?.allergies?.includes(a));
    if (hits.length) return setDialog({ t: "allergy", item, hits });
    const groups = item.modifierGroupIds.map((id) => modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => Boolean(g));
    if (groups.length) setDialog({ t: "mods", item });
    else addItem(item, [], 1, "");
  }

  async function send(c = check, leave = true): Promise<Check | null> {
    if (!c) return null;
    const { check: next, sent } = sendRound(c);
    if (sent.length) {
      const itemMap = new Map(menuItems.map((m) => [m.id, m]));
      for (const route of ["kitchen", "bar"] as const) {
        const lines = sent.filter((l) => l.kotRoute === route);
        if (!lines.length) continue;
        const printer = routePrinter(printers, route) ?? routePrinter(printers, "kitchen");
        await print("kot", buildKot({ check: next, lines, station: route === "bar" ? "Bar" : "Kitchen", width: paperWidth(printer), staffName: staffName(next.staffId), orderTypeName: orderTypeName(next.orderTypeId), tableName: tableName(next.tableId), menuItems: itemMap, at: new Date().toISOString() }), printer);
      }
    }
    await persist(next);
    toast(sent.length ? `Sent ${sent.reduce((a, l) => a + l.qty, 0)} item(s) to the kitchen` : "Check saved");
    if (leave) {
      setCheck(null);
      setSheetOpen(false);
    }
    return next;
  }

  async function printGuestCheck() {
    if (!check || !totals) return;
    const saved = await send(check, false);
    if (!saved) return;
    const printer = printers.find((p) => p.id === ws.receiptPrinterId);
    const qr = on("lankaqr") ? { data: lankaQrPayload({ ...settings.integrations.lankaqr, amount: totals.amountDue, reference: `CHK${saved.checkNo}` }), caption: "Scan to pay with LankaQR" } : undefined;
    await print("bill", buildBill({ kind: "guestCheck", check: saved, totals, business: settings.business, branding: settings.branding, width: paperWidth(printer), staffName: staffName(saved.staffId), orderTypeName: orderTypeName(saved.orderTypeId), tableName: tableName(saved.tableId), tenders: ctx.tenders, ...(qr ? { qr } : {}) }), printer);
    toast("Bill printed");
  }

  async function finish() {
    if (!check) return;
    try {
      const sent = sendRound(check).sent.length ? await send(check, false) : check;
      if (!sent) return;
      const { check: closed, invoice } = await closeCheck(store, sent, ctx, { workstationCode: ws.code });
      const printer = printers.find((p) => p.id === ws.receiptPrinterId);
      const drawer = closed.payments.some((p) => ctx.tenders.get(p.tenderId)?.opensDrawer);
      const doc = buildBill({ kind: "invoice", check: closed, totals: invoice.totals, business: settings.business, branding: settings.branding, width: paperWidth(printer), staffName: staffName(closed.staffId), orderTypeName: orderTypeName(closed.orderTypeId), tableName: tableName(closed.tableId), tenders: ctx.tenders, invoiceNo: invoice.id, issuedAt: invoice.issuedAt, openDrawer: drawer, printLogo: Boolean(settings.branding.logoDataUrl), qr: { data: `https://${settings.business.website ?? "example.lk"}/feedback?inv=${invoice.id}`, caption: "Tell us how we did" } });
      if (settings.pos.autoPrintBillOnClose && ws.printMode !== "preview") await print("receipt", doc, printer);
      setLastInvoice(doc);
      setCheck(null);
      setSheetOpen(false);
      setDialog({ t: "receipt", doc, change: closed.change, title: `Invoice ${invoice.id}` });
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  function voidLine(line: CheckLine) {
    if (!check) return;
    if (line.sentRound === undefined) {
      setCheck({ ...check, lines: check.lines.filter((l) => l.id !== line.id) });
      setSel(null);
      return;
    }
    withPrivilege("pos.voidSent", (by) =>
      setDialog({
        t: "reason",
        type: "void",
        title: `Void ${line.qty} × ${line.name}`,
        then: async (r) => {
          const voided = { ...line, voided: { reasonId: r.id, by: by.id, at: new Date().toISOString() } };
          const next = { ...check, lines: check.lines.map((l) => (l.id === line.id ? voided : l)) };
          const printer = routePrinter(printers, line.kotRoute === "bar" ? "bar" : "kitchen");
          await print("kot", buildKot({ check: next, lines: [voided], station: line.kotRoute === "bar" ? "Bar" : "Kitchen", width: paperWidth(printer), staffName: staffName(next.staffId), orderTypeName: orderTypeName(next.orderTypeId), tableName: tableName(next.tableId), menuItems: new Map(menuItems.map((m) => [m.id, m])), at: new Date().toISOString() }), printer);
          await persist(next);
          setDialog(null);
          toast(`Voided: ${r.name}`);
        },
      }),
    );
  }

  function changeQty(line: CheckLine, delta: number) {
    if (!check || line.sentRound !== undefined) return toast("Item already sent; void it instead", true);
    const qty = line.qty + delta;
    if (qty <= 0) return voidLine(line);
    setCheck({ ...check, lines: check.lines.map((l) => (l.id === line.id ? { ...l, qty } : l)) });
  }

  function applyDiscount(d: Discount, scope: "item" | "check") {
    if (!check) return;
    withPrivilege(d.requiresManager ? "pos.discountManager" : "pos.discount", () => {
      if (scope === "check") setCheck({ ...check, checkDiscountIds: [...new Set([...check.checkDiscountIds, d.id])] });
      else if (sel) setCheck({ ...check, lines: check.lines.map((l) => (l.id === sel ? { ...l, discountIds: [...new Set([...l.discountIds, d.id])] } : l)) });
      setDialog(null);
    });
  }

  async function openTable(t: Table) {
    const existing = openChecks.find((c) => c.tableId === t.id);
    if (existing) {
      setCheck(existing);
      setView("order");
      return;
    }
    setDialog({
      t: "covers",
      then: async (n) => {
        setDialog(null);
        await startCheck({ orderTypeId: orderTypes.find((o) => o.requiresTable)?.id ?? "dine-in", tableId: t.id, covers: n });
        setView("order");
      },
    });
  }

  const items = menuItems
    .filter((m) => m.active)
    .filter((m) => (q.trim() ? `${m.code} ${m.name} ${m.nameSi ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()) : m.categoryId === cat))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const catColor = new Map(categories.map((c) => [c.id, c.color]));
  const selLine = check?.lines.find((l) => l.id === sel);
  const customer = customers.find((c) => c.id === check?.customerId);
  const itemCount = check ? activeLines(check).reduce((a, l) => a + l.qty, 0) : 0;

  return (
    <div className="pos">
      <header className="pos-top">
        <div className="brand-logo">{settings.branding.logoDataUrl ? <img src={settings.branding.logoDataUrl} alt="" /> : settings.branding.displayName.slice(0, 1)}</div>
        <div className="stack tight" style={{ gap: 0 }}>
          <strong>{settings.branding.displayName}</strong>
          <span className="tiny muted">{ws.code} · {user.name} · {bd}</span>
        </div>
        <span className="grow" />
        <Seg<View> value={view} onChange={setView} options={[{ value: "order", label: "Order" }, ...(on("tables") ? [{ value: "tables" as View, label: "Tables" }] : []), { value: "checks", label: `Open (${openChecks.length})` }, { value: "functions", label: "Functions" }]} />
        <button className="btn ghost sm" onClick={onSignOut}>Sign out</button>
      </header>

      {view === "tables" ? (
        <div style={{ overflowY: "auto", padding: 16 }}>
          {[...new Set(tables.map((t) => t.area))].map((area) => (
            <div key={area} className="stack" style={{ marginBottom: 18 }}>
              <span className="section-title">{area}</span>
              <div className="table-tiles">
                {tables.filter((t) => t.area === area).map((t) => {
                  const c = openChecks.find((x) => x.tableId === t.id);
                  const amt = c && activeLines(c).length ? computeCheckTotals(c, ctx).amountDue : 0;
                  return (
                    <button key={t.id} className={`table-tile${c ? " busy" : ""}`} onClick={() => openTable(t)}>
                      <span className="tname">{t.name}</span>
                      <span className="tiny muted">{c ? `${c.covers} pax · ${minutesSince(c.openedAt)} min` : `${t.seats} seats`}</span>
                      {c ? <span className="small num">{money(amt)}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : view === "checks" ? (
        <div style={{ overflowY: "auto", padding: 16 }} className="stack">
          {openChecks.length === 0 ? <Empty title="No open checks" /> : null}
          <div className="grid cols-3">
            {openChecks.sort((a, b) => a.openedAt.localeCompare(b.openedAt)).map((c) => (
              <button key={c.id} className="card card-body stack tight" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => { setCheck(c); setView("order"); }}>
                <div className="row between"><strong>#{c.checkNo} {c.tableId ? `· Table ${tableName(c.tableId)}` : ""}</strong><span className="badge">{orderTypeName(c.orderTypeId)}</span></div>
                <span className="small muted">{staffName(c.staffId)} · opened {timeColombo(c.openedAt)} · {minutesSince(c.openedAt)} min</span>
                <span className="num">{money(activeLines(c).length ? computeCheckTotals(c, ctx).amountDue : 0)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : view === "functions" ? (
        <Functions ws={ws} user={user} role={role} roles={roles} staff={staff} printers={printers} ctx={ctx} lastInvoice={lastInvoice} menuItems={menuItems} withPrivilege={withPrivilege} print={print} onPreview={(doc, title) => setDialog({ t: "receipt", doc, title })} />
      ) : (
        <div className="pos-body">
          <section className="pos-menu">
            <div className="pos-cats">
              {visibleCats.map((c) => (
                <button key={c.id} className={`pos-cat${cat === c.id && !q ? " on" : ""}`} onClick={() => { setCat(c.id); setQ(""); }} style={cat === c.id && !q ? {} : { borderLeft: `4px solid ${c.color}` }}>
                  {c.name}
                </button>
              ))}
            </div>
            <div className="pos-search">
              <input className="input" placeholder="Search item or code" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="pos-grid">
              {items.map((m) => (
                <button key={m.id} className={`pos-item${m.available ? "" : " out"}`} style={{ ["--cat" as string]: catColor.get(m.categoryId) }} onClick={() => tapItem(m)}>
                  {!m.available ? <span className="badge bad tag86">86</span> : null}
                  <span className="name">{m.name}</span>
                  <span className="row between">
                    <span className="price">{money(m.price)}</span>
                    {m.allergens.length ? <span className="tiny muted" title={`Contains ${m.allergens.join(", ")}`}>⚠ {m.allergens.length}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className={`pos-check${sheetOpen ? " open" : ""}`}>
            <button className="btn ghost mobile-only" style={{ margin: "6px auto 0" }} onClick={() => setSheetOpen(!sheetOpen)}>
              {sheetOpen ? "Hide check ▾" : `Check · ${itemCount} item(s) · ${money(totals?.amountDue)} ▴`}
            </button>
            <div className="pos-check-head">
              <div className="row between">
                <strong>{check ? `Check #${check.checkNo}` : "New check"}{check?.tableId ? ` · Table ${tableName(check.tableId)}` : ""}</strong>
                {check ? (
                  <button className="btn ghost sm" onClick={() => setDialog({ t: "covers", then: (n) => { setCheck({ ...check, covers: n }); setDialog(null); } })}>{check.covers} pax</button>
                ) : null}
              </div>
              <div className="row wrap">
                {orderTypes.map((o) => (
                  <button key={o.id} className={`chip${(check?.orderTypeId ?? rvc?.defaultOrderTypeId) === o.id ? " on" : ""}`} onClick={async () => { const c = check ?? (await startCheck({ orderTypeId: o.id })); setCheck({ ...c, orderTypeId: o.id }); }}>
                    {o.name}
                  </button>
                ))}
              </div>
              <button className="btn sm" onClick={async () => { if (!check) await startCheck(); setDialog({ t: "customer" }); }} style={{ justifyContent: "flex-start" }}>
                {customer ? `☺ ${customer.name}${on("loyalty") ? ` · ${customer.points} pts` : ""}` : on("crm") ? "+ Customer / allergies" : "+ Allergies / VAT buyer"}
                {check?.allergies?.length ? <span className="badge bad">Allergy: {check.allergies.join(", ")}</span> : null}
              </button>
            </div>
            <div className="pos-lines">
              {!check || check.lines.length === 0 ? <div className="empty small">Tap items to start a check.</div> : null}
              {check?.lines.map((l) => (
                <div key={l.id} className={`pos-line${sel === l.id ? " sel" : ""}${l.sentRound !== undefined ? " sent" : ""}${l.voided ? " void" : ""}`} onClick={() => !l.voided && setSel(sel === l.id ? null : l.id)}>
                  <span className="qty">{l.qty}</span>
                  <div>
                    <div>{l.name}</div>
                    {l.modifiers.length ? <div className="mods">{l.modifiers.map((m) => m.name).join(" · ")}</div> : null}
                    {l.note ? <div className="mods">“{l.note}”</div> : null}
                    {l.discountIds.length ? <div className="mods">{l.discountIds.map((d) => ctx.discounts.get(d)?.name).join(", ")}</div> : null}
                    {l.voided ? <div className="mods">VOID</div> : l.sentRound === undefined ? <span className="badge warn">not sent</span> : null}
                  </div>
                  <span className="num">{money(l.qty * (l.unitPrice + l.modifiers.reduce((a, m) => a + m.price, 0)))}</span>
                </div>
              ))}
            </div>
            {selLine ? (
              <div className="row wrap" style={{ padding: "8px 14px", borderTop: "1px solid var(--line)" }}>
                <button className="btn sm" onClick={() => changeQty(selLine, -1)}>−</button>
                <button className="btn sm" onClick={() => changeQty(selLine, 1)}>+</button>
                <button className="btn sm" onClick={() => setDialog({ t: "discount", scope: "item" })}>Discount</button>
                <button className="btn sm danger" onClick={() => voidLine(selLine)}>{selLine.sentRound === undefined ? "Remove" : "Void"}</button>
              </div>
            ) : null}
            {totals ? (
              <div className="pos-totals">
                <div className="t"><span>Subtotal</span><span>{money(totals.itemsTotal)}</span></div>
                {totals.discountTotal ? <div className="t"><span>Discounts</span><span>−{money(totals.discountTotal)}</span></div> : null}
                {totals.charges.filter((c) => c.amount).map((c) => <div key={c.ruleId} className="t muted"><span>{c.name}</span><span>{money(c.amount)}</span></div>)}
                {totals.roundingAdjustment ? <div className="t muted"><span>Rounding</span><span>{money(totals.roundingAdjustment)}</span></div> : null}
                <div className="t grand"><span>Total</span><span>{money(totals.amountDue)}</span></div>
              </div>
            ) : null}
            <div className="pos-actions">
              <button className="btn" disabled={!check} onClick={() => send()}>Send</button>
              <button className="btn" disabled={!totals} onClick={printGuestCheck}>Print bill</button>
              <button className="btn" disabled={!totals} onClick={() => setDialog({ t: "discount", scope: "check" })}>Discount</button>
              <button className="btn" disabled={!check} onClick={() => { setCheck(null); setSheetOpen(false); }}>{check && check.lines.some((l) => l.sentRound === undefined) ? "Cancel" : "Close"}</button>
              <button className="btn primary pay" disabled={!totals} onClick={() => withPrivilege("pos.tender", () => setDialog({ t: "pay" }))}>Pay {totals ? money(totals.amountDue) : ""}</button>
              <button className="btn" style={{ gridColumn: "span 2" }} disabled={!check} onClick={() => send()}>Hold &amp; new</button>
            </div>
          </aside>
        </div>
      )}

      {dialog?.t === "mods" ? (
        <ModifierDialog item={dialog.item} groups={dialog.item.modifierGroupIds.map((id) => modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => Boolean(g))} onAdd={(mods, qty, note) => addItem(dialog.item, mods, qty, note)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.t === "allergy" ? (
        <Modal title="Allergy alert" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Don't add</button><button className="btn danger solid" onClick={() => { const item = dialog.item; setDialog(null); const groups = item.modifierGroupIds.map((id) => modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => Boolean(g)); if (groups.length) setDialog({ t: "mods", item }); else addItem(item, [], 1, `ALLERGY CHECKED: ${dialog.hits.join(", ")}`); }}>Add anyway</button></>}>
          <div className="callout bad"><strong>{dialog.item.name}</strong> contains <strong>{dialog.hits.join(", ")}</strong>, which this guest is allergic to.</div>
        </Modal>
      ) : null}
      {dialog?.t === "auth" ? <ManagerAuth privilege={dialog.privilege} staff={staff} roles={roles} onApproved={dialog.then} onClose={() => setDialog(null)} /> : null}
      {dialog?.t === "reason" ? <ReasonDialog title={dialog.title} reasons={reasons.filter((r) => r.type === dialog.type)} onPick={dialog.then} onClose={() => setDialog(null)} /> : null}
      {dialog?.t === "discount" ? <DiscountDialog discounts={discounts} scope={dialog.scope} onPick={(d) => applyDiscount(d, dialog.scope)} onClose={() => setDialog(null)} /> : null}
      {dialog?.t === "customer" && check ? (
        <CustomerDialog
          customers={customers}
          current={check.customerId}
          allergies={check.allergies ?? []}
          buyer={check.buyer}
          onPick={(c) => setCheck((cur) => (cur ? (c ? { ...cur, customerId: c.id } : (({ customerId: _x, ...rest }) => rest)(cur)) : cur))}
          onAllergies={(a) => setCheck((cur) => (cur ? { ...cur, allergies: a } : cur))}
          onBuyer={(b) => setCheck((cur) => (cur ? (b ? { ...cur, buyer: b } : (({ buyer: _b, ...rest }) => rest)(cur)) : cur))}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.t === "covers" ? (
        <Modal title="Number of guests" onClose={() => setDialog(null)}>
          <div className="keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15].map((n) => <button key={n} onClick={() => dialog.then(n)}>{n}</button>)}
          </div>
        </Modal>
      ) : null}
      {dialog?.t === "pay" && check && totals ? (
        <PayDialog
          check={check}
          amountDue={totals.amountDue}
          tenders={tenders}
          staffId={user.id}
          reference={`CHK${check.checkNo}-${ws.code}`}
          onPayments={(payments) => setCheck({ ...check, payments })}
          onClose={() => setDialog(null)}
          onFinish={finish}
        />
      ) : null}
      {dialog?.t === "receipt" ? (
        <Modal title={dialog.title} onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => window.print()}>Print from this device</button><button className="btn primary" onClick={() => setDialog(null)}>New check</button></>}>
          <div className="stack" style={{ alignItems: "center" }}>
            {dialog.change ? <div className="callout good" style={{ fontSize: 20 }}>Change due: <strong className="num">{money(dialog.change)}</strong></div> : null}
            <ReceiptView doc={dialog.doc} logo={settings.branding.logoDataUrl} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Functions({ ws, user, role, roles, staff, printers, ctx, lastInvoice, menuItems, withPrivilege, print, onPreview }: {
  ws: Workstation;
  user: Staff;
  role: Role | undefined;
  roles: Role[];
  staff: Staff[];
  printers: Printer[];
  ctx: PosContext;
  lastInvoice: ReceiptDoc | null;
  menuItems: MenuItem[];
  withPrivilege: (p: PrivilegeKey, run: (by: Staff) => void) => void;
  print: (kind: "kot" | "bill" | "receipt" | "report", doc: ReceiptDoc, printer: Printer | undefined) => Promise<void>;
  onPreview: (doc: ReceiptDoc, title: string) => void;
}) {
  const { settings, on, toast, ledger } = useApp();
  const store = useStore();
  const [eod, setEod] = useState<string[] | null>(null);
  const bd = businessDateNow(settings.pos);
  const receiptPrinter = printers.find((p) => p.id === ws.receiptPrinterId);
  const tenders = [...ctx.tenders.values()];

  async function report(kind: "X" | "Z") {
    const stats = (await store.get<DailyStats>(C.dailyStats, statsId(ws.propertyId, bd))) ?? null;
    if (!stats) return toast("No sales yet today", true);
    const doc = buildDaySummary({ stats, kind, width: widthForPaper(receiptPrinter?.paperWidthMm ?? 80), businessName: settings.business.tradingName, propertyName: ws.propertyId, tenders, printedAt: new Date().toISOString() });
    await print("report", doc, receiptPrinter);
    onPreview(doc, `${kind} report`);
    return stats;
  }

  async function endOfDay() {
    const steps: string[] = [];
    const open = (await store.list<Check>(C.checks, { where: [["status", "==", "open"]] })).filter((c) => c.businessDate === bd && c.propertyId === ws.propertyId);
    if (open.length) steps.push(`⚠ ${open.length} check(s) still open; they stay on ${bd} until closed.`);
    if (on("inventory")) {
      const locs = await store.list<{ id: string; isDefault: boolean }>(C.locations);
      const r = await processDepletion(store, { locationId: locs.find((l) => l.isDefault)?.id ?? "MAIN", by: user.name });
      steps.push(`Stock deducted for ${r.checks} check(s) (FIFO).`);
    }
    const stats = await store.get<DailyStats>(C.dailyStats, statsId(ws.propertyId, bd));
    if (on("accounting")) {
      // Posted by the ledger service (a Cloud Function in production): numbered, hash-chained and
      // audited. Re-running End of Day later posts only the difference (late sales).
      try {
        const v = await ledger<{ number?: string } | null>({ action: "postPosDay", propertyId: ws.propertyId, businessDate: bd });
        steps.push(v ? `Day posted to the ledger as ${v.number ?? "a POS day journal"}.` : "Ledger already up to date for this day.");
      } catch (e) {
        steps.push(`⚠ Ledger posting failed (${(e as Error).message}). Post the day later from Finance → Overview.`);
      }
    }
    if (stats) {
      const doc = buildDaySummary({ stats, kind: "Z", width: widthForPaper(receiptPrinter?.paperWidthMm ?? 80), businessName: settings.business.tradingName, propertyName: ws.propertyId, tenders, printedAt: new Date().toISOString() });
      await print("report", doc, receiptPrinter);
      steps.push(`Z report printed: net sales ${money(stats.netSales)}, ${stats.checks} checks.`);
      if (on("whatsapp")) {
        const text = eodWhatsAppText({ stats, business: settings.business, branding: settings.branding, menuItems, tenders, propertyName: ws.propertyId });
        const at = new Date().toISOString();
        await store.batch(settings.integrations.whatsapp.eodRecipients.map((r) => ({ op: "set" as const, col: C.messageLog, data: { id: newId(), channel: "whatsapp", to: r.phone, template: "eod_report", body: text, mode: settings.integrations.whatsapp.mode, status: "simulated", at } })));
        steps.push(`WhatsApp EOD report ${settings.integrations.whatsapp.mode === "mock" ? "simulated" : "queued"} for ${settings.integrations.whatsapp.eodRecipients.length} manager(s).`);
      }
    } else steps.push("No sales recorded today.");
    setEod(steps);
  }

  const tiles: { label: string; sub: string; privilege?: PrivilegeKey; run: () => void }[] = [
    { label: "X report", sub: "Sales so far today", privilege: "pos.reports", run: () => void report("X") },
    { label: "End of Day", sub: "Z report, stock, journal, WhatsApp", privilege: "pos.endOfDay", run: endOfDay },
    { label: "Reprint last bill", sub: "Marked COPY", privilege: "pos.reprint", run: () => (lastInvoice ? print("receipt", { ...lastInvoice, blocks: [{ t: "text", text: "*** COPY ***", align: "center", bold: true }, ...lastInvoice.blocks.filter((b) => b.t !== "drawer")] }, receiptPrinter).then(() => toast("Copy sent")) : toast("No bill printed on this device yet", true)) },
    { label: "No sale", sub: "Open the cash drawer", privilege: "pos.noSale", run: () => void print("receipt", { width: 48, blocks: [{ t: "drawer" }] }, receiptPrinter).then(async () => { await store.set(C.audit, { id: newId(), at: new Date().toISOString(), by: user.id, action: "noSale", entity: "workstation", entityId: ws.id }); toast("Drawer opened (logged)"); }) },
  ];

  return (
    <div style={{ overflowY: "auto", padding: 16 }} className="stack">
      <div className="grid cols-4">
        {tiles.map((t) => (
          <button key={t.label} className="card card-body stack tight" style={{ textAlign: "left", cursor: "pointer", minHeight: 96 }} onClick={() => (t.privilege ? withPrivilege(t.privilege, () => t.run()) : t.run())}>
            <strong>{t.label}</strong>
            <span className="small muted">{t.sub}</span>
            {t.privilege && !hasPrivilege(role, t.privilege) ? <span className="badge warn">Manager</span> : null}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h3>Item availability (86)</h3><span className="small muted">Tap to mark out of stock / back on sale</span></div>
        <div className="card-body chips">
          {menuItems.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
            <button key={m.id} className={`chip${m.available ? "" : " on"}`} onClick={() => withPrivilege("pos.eightySix", async () => { await store.merge(C.menuItems, m.id, { available: !m.available }); toast(`${m.name} ${m.available ? "86'd" : "back on sale"}`); })}>
              {m.available ? m.name : `86 · ${m.name}`}
            </button>
          ))}
        </div>
      </div>
      <div className="card card-body row wrap between">
        <span className="small muted">Device: {ws.name} ({ws.deviceProfile === "mobile" ? "mobile" : "dedicated"}) · printing via {ws.printMode} · {roles.length} roles · {staff.length} staff</span>
        <Link className="btn sm" to="/emc/dashboard">Back office</Link>
      </div>
      {eod ? (
        <Modal title={`End of Day · ${bd}`} onClose={() => setEod(null)} footer={<button className="btn primary" onClick={() => setEod(null)}>Done</button>}>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="stack tight">{eod.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Modal>
      ) : null}
    </div>
  );
}

export type { Invoice };
