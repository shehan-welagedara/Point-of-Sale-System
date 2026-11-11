import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readableTextOn } from "../../lib/contrast";
import { Link } from "react-router-dom";
import {
  type Check,
  type CheckLine,
  type CheckModifier,
  type Customer,
  type DailyStats,
  type Discount,
  type Invoice,
  type LimitKind,
  type MenuCategory,
  type MenuImage,
  type MenuItem,
  type ModifierGroup,
  type OrderType,
  type PosContext,
  type PosEvent,
  type PosJournal,
  type TimeCard,
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
  EXCEPTION_EVENTS,
  POS_EVENT_LABEL,
  PRIVILEGES,
  canPerform,
  lankaQrPayload,
  newCheck,
  newId,
  processDepletion,
  sendRound,
  roleFor,
  statsId,
  withinLimit,
} from "@pos/core";
import { type ReceiptDoc, buildBill, buildDaySummary, buildKot, feedbackLink, resolveBillLayout, widthForPaper } from "@pos/printing";
import { Empty, Modal, Seg } from "../../components/ui";
import { ReceiptView } from "../../components/Receipt";
import { minutesSince, money, timeColombo } from "../../lib/format";
import { paperWidthFor, queuePrint, routePrinter } from "../../lib/printing";
import { printBluetooth } from "../../lib/bluetooth-printer";
import { BluetoothPrinterButton } from "./BluetoothPrinter";
import { useApp, useCollection, useStore } from "../../state/app";
import { AmountDialog, CustomerDialog, DiscountDialog, ManagerAuth, ModifierDialog, ReasonDialog } from "./dialogs";
import { PayDialog } from "./PayDialog";
import { PosReports } from "./PosReports";
import { gridColumns, resolveTheme, themeClass, themeStyle } from "./theme";
import { MobilePos, type PaidResult, type PosApi } from "./mobile/MobilePos";
import { useUiStyle } from "./mobile/ui";

type View = "order" | "tables" | "checks" | "reports" | "functions";

type Limit = { kind: LimitKind; value: number; label: string };

export function PosMain({ ws, user, staff, rvcId, journal, onSignOut, onChangeRvc }: { ws: Workstation; user: Staff; staff: Staff[]; rvcId: string; journal: PosJournal; onSignOut: () => void; onChangeRvc: (rvcId: string) => void }) {
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
  const openChecks = (useCollection<Check>(C.checks, { where: [["status", "==", "open"]] }) ?? []).filter((c) => c.propertyId === ws.propertyId && (c.rvcId ?? rvcId) === rvcId);
  const theme = resolveTheme(settings.pos.theme);
  const ui = useUiStyle(settings.pos.mobile, ws);
  const images = useCollection<MenuImage>(theme.showImages || ui !== "terminal" ? C.menuImages : null) ?? [];
  const imageOf = useMemo(() => new Map(images.map((i) => [i.id, i.dataUrl])), [images]);

  const role = roleFor(user, ws.propertyId, roles);
  const rvc = rvcs.find((r) => r.id === rvcId);
  const myRvcs = (ws.allowedRvcIds?.length ? ws.allowedRvcIds : [ws.rvcId]).filter((r) => !user.rvcIds?.length || user.rvcIds.includes(r));
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
  // Item buttons are paged like a terminal on PCs and tablets (no scrolling); phones scroll.
  const gridRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(0);
  const [itemPage, setItemPage] = useState(0);
  const swipe = useRef<number | null>(null);
  const [dialog, setDialog] = useState<
    | { t: "mods"; item: MenuItem }
    | { t: "allergy"; item: MenuItem; hits: string[] }
    | { t: "auth"; privilege: PrivilegeKey; limit?: Limit; then: (by: Staff) => void }
    | { t: "amount"; title: string; help?: string; initial?: number; then: (cents: number) => void }
    | { t: "transfer" }
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
  const paperWidth = (p?: Printer) => paperWidthFor(ws, p);
  /**
   * Printer for a kitchen ticket: the station's printer (kitchen or bar), else the kitchen printer,
   * else this device's bill printer, so a restaurant with one printer gets KOTs and bills on it.
   */
  const kotPrinter = (route: "kitchen" | "bar") => routePrinter(printers, route) ?? routePrinter(printers, "kitchen") ?? printers.find((p) => p.id === ws.receiptPrinterId && p.active);
  const kotOnSend = settings.pos.printKotOnSend !== false;
  const staffName = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  const orderTypeName = (id: string) => orderTypes.find((o) => o.id === id)?.name ?? id;
  const tableName = (id?: string) => tables.find((t) => t.id === id)?.name;

  /** Runs `run` if this employee may (within their limit); otherwise asks a senior employee to approve. */
  function withPrivilege(p: PrivilegeKey, run: (by: Staff) => void, limit?: Limit) {
    if (canPerform(role, p) && (!limit || withinLimit(role, limit.kind, limit.value))) return run(user);
    setDialog({
      t: "auth",
      privilege: p,
      ...(limit ? { limit } : {}),
      then: (by) => {
        setDialog(null);
        void journal.log({ type: "managerAuth", employeeId: user.id, authorizedBy: by.id, detail: `${PRIVILEGES[p]}${limit ? ` (${limit.label})` : ""}`, ...(check ? { checkId: check.id, checkNo: check.checkNo } : {}) });
        run(by);
      },
    });
  }
  const onCheck = (c: Check | null) => (c ? { checkId: c.id, checkNo: c.checkNo } : {});
  const lineValue = (l: CheckLine) => l.qty * (l.unitPrice + l.modifiers.reduce((a, m) => a + m.price, 0));

  async function print(kind: "kot" | "bill" | "receipt" | "report", doc: ReceiptDoc, printer: Printer | undefined) {
    // A phone or tablet with its own Bluetooth printer prints everything there (kitchen tickets
    // too, unless the kitchen has its own printer through the Print Agent).
    if (ws.printMode === "bluetooth" && (kind !== "kot" || ws.kitchenOnBluetooth !== false)) {
      const printed = await printBluetooth(doc, ws.bluetoothVia ?? "browser");
      if (!printed) toast(`${kind === "kot" ? "Kitchen ticket" : "Print"} waiting for the printer: tap the printer button to connect it.`, true);
      return;
    }
    if (ws.printMode === "preview" || !printer) {
      setDialog({ t: "receipt", doc, title: kind === "kot" ? "Kitchen ticket" : "Preview" });
      return;
    }
    await queuePrint(store, { printer, workstationId: ws.id, kind, doc });
  }

  async function startCheck(opts: { orderTypeId?: string; tableId?: string; covers?: number } = {}): Promise<Check> {
    const checkNo = await allocateCheckNo(store, ws.id, bd);
    const c = newCheck({ propertyId: ws.propertyId, rvcId, workstationId: ws.id, checkNo, orderTypeId: opts.orderTypeId ?? rvc?.defaultOrderTypeId ?? orderTypes[0]?.id ?? "dine-in", staffId: user.id, businessDate: bd, covers: opts.covers ?? 1, ...(opts.tableId ? { tableId: opts.tableId } : {}) });
    void journal.log({ type: "checkBegin", employeeId: user.id, ...onCheck(c), ...(opts.tableId ? { detail: `table ${tableName(opts.tableId) ?? opts.tableId}` } : {}) });
    setCheck(c);
    setSel(null);
    return c;
  }

  async function persist(c: Check) {
    setCheck(c);
    await store.set(C.checks, c);
  }

  async function addItem(item: MenuItem, mods: CheckModifier[], qty: number, note: string, price = item.price) {
    const c = check ?? (await startCheck());
    const line: CheckLine = { id: newId(), menuItemId: item.id, name: item.name, qty, unitPrice: price, modifiers: mods, taxClass: item.taxClass, kotRoute: item.kotRoute, categoryId: item.categoryId, discountIds: [], ...(note ? { note } : {}) };
    setCheck({ ...c, lines: [...c.lines, line] });
    setSel(line.id);
    setDialog(null);
  }

  function tapItem(item: MenuItem) {
    if (!item.available) return toast(`${item.name} is out of stock (86)`, true);
    if (item.openPrice)
      return withPrivilege("pos.openPrice", (by) =>
        setDialog({ t: "amount", title: `Price for ${item.name}`, help: "Open-price item: enter the amount to charge.", then: (cents) => { void journal.log({ type: "priceOverride", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), itemId: item.id, itemName: item.name, amount: cents, detail: "open price", ...onCheck(check) }); void addItem(item, [], 1, "", cents); } }),
      );
    const hits = item.allergens.filter((a) => check?.allergies?.includes(a));
    if (hits.length) return setDialog({ t: "allergy", item, hits });
    const groups = item.modifierGroupIds.map((id) => modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => Boolean(g));
    if (groups.length) setDialog({ t: "mods", item });
    else addItem(item, [], 1, "");
  }

  async function send(c = check, leave = true): Promise<Check | null> {
    if (!c) return null;
    const { check: next, sent } = sendRound(c);
    if (sent.length && kotOnSend) await printKots(next, sent, false);
    await persist(next);
    if (sent.length) void journal.log({ type: "send", employeeId: user.id, ...onCheck(next), qty: sent.reduce((a, l) => a + l.qty, 0), amount: sent.reduce((a, l) => a + lineValue(l), 0), detail: `round ${next.sentRounds}` });
    toast(sent.length ? `Sent ${sent.reduce((a, l) => a + l.qty, 0)} item(s) to the kitchen${kotOnSend ? " · KOT printed" : ""}` : "Check saved");
    if (leave) {
      setCheck(null);
      setSel(null);
      setSheetOpen(false);
    }
    return next;
  }

  /** Kitchen tickets for these lines, one per station (kitchen, bar). */
  async function printKots(c: Check, lines: CheckLine[], reprint: boolean) {
    const itemMap = new Map(menuItems.map((m) => [m.id, m]));
    for (const route of ["kitchen", "bar"] as const) {
      const own = lines.filter((l) => l.kotRoute === route);
      if (!own.length) continue;
      const printer = kotPrinter(route);
      await print("kot", buildKot({ check: c, lines: own, station: route === "bar" ? "Bar" : "Kitchen", width: paperWidth(printer), staffName: staffName(c.staffId), orderTypeName: orderTypeName(c.orderTypeId), tableName: tableName(c.tableId), menuItems: itemMap, at: new Date().toISOString(), reprint }), printer);
    }
  }

  /** Prints the kitchen tickets of everything already sent on this check again (marked REPRINT). */
  async function reprintKot(c = check) {
    if (!c) return;
    const sentLines = c.lines.filter((l) => l.sentRound !== undefined && !l.voided && l.kotRoute !== "none");
    if (!sentLines.length) return toast("Nothing sent to the kitchen yet on this check", true);
    await printKots(c, sentLines, true);
    void journal.log({ type: "reprint", employeeId: user.id, ...onCheck(c), detail: "kitchen ticket" });
    toast("Kitchen ticket printed again");
  }

  async function printGuestCheck() {
    if (!check || !totals) return;
    const saved = await send(check, false);
    if (!saved) return;
    const printer = printers.find((p) => p.id === ws.receiptPrinterId);
    const layout = resolveBillLayout(settings.branding.bill);
    const qr = on("lankaqr") && layout.showPayQr ? { data: lankaQrPayload({ ...settings.integrations.lankaqr, amount: totals.amountDue, reference: `CHK${saved.checkNo}` }), caption: "Scan to pay with LankaQR" } : undefined;
    await print("bill", buildBill({ kind: "guestCheck", check: saved, totals, business: settings.business, branding: settings.branding, width: paperWidth(printer), staffName: staffName(saved.staffId), orderTypeName: orderTypeName(saved.orderTypeId), tableName: tableName(saved.tableId), tenders: ctx.tenders, ...customerOnBill(saved), ...(qr ? { qr } : {}) }), printer);
    void journal.log({ type: "guestCheck", employeeId: user.id, ...onCheck(saved), amount: totals.amountDue });
    toast("Bill printed");
  }

  /** Closes the check (issues the invoice). `paid` is the check with its final payments, when just added. */
  async function finish(paid: Check | null = check, showReceipt = true): Promise<PaidResult | null> {
    if (!paid) return null;
    try {
      const sent = sendRound(paid).sent.length ? await send(paid, false) : paid;
      if (!sent) return null;
      const { check: closed, invoice } = await closeCheck(store, sent, ctx, { workstationCode: ws.code });
      for (const p of closed.payments) void journal.log({ type: "payment", employeeId: p.by, ...onCheck(closed), amount: p.applied, detail: `${ctx.tenders.get(p.tenderId)?.name ?? p.tenderId}${p.reference ? ` ref ${p.reference}` : ""}` });
      void journal.log({ type: "checkClose", employeeId: user.id, ...onCheck(closed), amount: invoice.totals.amountDue, detail: `invoice ${invoice.id}` });
      const printer = printers.find((p) => p.id === ws.receiptPrinterId);
      const drawer = closed.payments.some((p) => ctx.tenders.get(p.tenderId)?.opensDrawer);
      const feedback = feedbackLink(resolveBillLayout(settings.branding.bill), invoice.id, settings.business.website);
      const doc = buildBill({ kind: "invoice", check: closed, totals: invoice.totals, business: settings.business, branding: settings.branding, width: paperWidth(printer), staffName: staffName(closed.staffId), orderTypeName: orderTypeName(closed.orderTypeId), tableName: tableName(closed.tableId), tenders: ctx.tenders, invoiceNo: invoice.id, issuedAt: invoice.issuedAt, openDrawer: drawer, printLogo: Boolean(settings.branding.logoDataUrl), ...customerOnBill(closed), ...(feedback ? { qr: { data: feedback, caption: resolveBillLayout(settings.branding.bill).feedbackCaption } } : {}) });
      const printed = settings.pos.autoPrintBillOnClose && ws.printMode !== "preview" && (ws.printMode === "bluetooth" || Boolean(printer));
      if (printed) await print("receipt", doc, printer);
      setLastInvoice(doc);
      setCheck(null);
      setSel(null);
      setSheetOpen(false);
      if (showReceipt) setDialog({ t: "receipt", doc, change: closed.change, title: `Invoice ${invoice.id}` });
      return { invoiceNo: invoice.id, checkNo: closed.checkNo, ...(closed.tableId ? { tableName: tableName(closed.tableId) ?? closed.tableId } : {}), total: invoice.totals.amountDue, change: closed.change ?? 0, doc, printed, tenders: closed.payments.map((p) => ctx.tenders.get(p.tenderId)?.name ?? p.tenderId) };
    } catch (e) {
      toast((e as Error).message, true);
      return null;
    }
  }

  function customerOnBill(c: Check): { customer?: { name: string; points?: number } } {
    const cu = customers.find((x) => x.id === c.customerId);
    return cu ? { customer: { name: cu.name, ...(on("loyalty") ? { points: cu.points } : {}) } } : {};
  }

  function voidLine(line: CheckLine) {
    if (!check) return;
    if (line.sentRound === undefined) {
      void journal.log({ type: "itemRemove", employeeId: user.id, ...onCheck(check), itemId: line.menuItemId, itemName: line.name, qty: line.qty, amount: lineValue(line) });
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
          const printer = kotPrinter(line.kotRoute === "bar" ? "bar" : "kitchen");
          if (kotOnSend) await print("kot", buildKot({ check: next, lines: [voided], station: line.kotRoute === "bar" ? "Bar" : "Kitchen", width: paperWidth(printer), staffName: staffName(next.staffId), orderTypeName: orderTypeName(next.orderTypeId), tableName: tableName(next.tableId), menuItems: new Map(menuItems.map((m) => [m.id, m])), at: new Date().toISOString() }), printer);
          await persist(next);
          void journal.log({ type: "itemVoid", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), ...onCheck(next), itemId: line.menuItemId, itemName: line.name, qty: line.qty, amount: lineValue(line), reasonId: r.id, reason: r.name });
          setDialog(null);
          toast(`Voided: ${r.name}`);
        },
      }),
    { kind: "voidAmount", value: lineValue(line), label: money(lineValue(line)) });
  }

  function overridePrice(line: CheckLine) {
    if (!check || line.sentRound !== undefined) return toast("Item already sent; void it and re-enter", true);
    setDialog({
      t: "amount",
      title: `New price for ${line.name}`,
      initial: line.unitPrice,
      then: (cents) => {
        const bp = line.unitPrice ? Math.round((Math.abs(line.unitPrice - cents) / line.unitPrice) * 10_000) : 10_000;
        setDialog(null);
        withPrivilege(
          "pos.priceOverride",
          (by) => {
            setCheck({ ...check, lines: check.lines.map((l) => (l.id === line.id ? { ...l, unitPrice: cents } : l)) });
            void journal.log({ type: "priceOverride", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), ...onCheck(check), itemId: line.menuItemId, itemName: line.name, amount: cents, detail: `${money(line.unitPrice)} → ${money(cents)}` });
          },
          { kind: "priceOverrideBp", value: bp, label: `${(bp / 100).toFixed(1)}% change` },
        );
      },
    });
  }

  function cancelCheck() {
    if (!check) return;
    const unsent = check.lines.filter((l) => l.sentRound === undefined && !l.voided);
    if (!unsent.length) {
      setCheck(null);
      setSel(null);
      setSheetOpen(false);
      return;
    }
    withPrivilege("pos.cancelCheck", (by) => {
      setSel(null);
      void journal.log({ type: "checkCancel", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), ...onCheck(check), qty: unsent.reduce((a, l) => a + l.qty, 0), amount: unsent.reduce((a, l) => a + lineValue(l), 0) });
      setCheck(null);
      setSheetOpen(false);
    });
  }

  /** Gives the check to another employee or moves it to another table. */
  function transferCheck(to: { staffId?: string; tableId?: string }) {
    if (!check) return;
    setDialog(null);
    withPrivilege("pos.transferCheck", async (by) => {
      const next = { ...check, ...(to.staffId ? { staffId: to.staffId } : {}), ...(to.tableId ? { tableId: to.tableId } : {}) };
      await persist(next);
      void journal.log({ type: "checkTransfer", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), ...onCheck(next), detail: to.staffId ? `to ${staffName(to.staffId)}` : `to table ${tableName(to.tableId) ?? to.tableId}` });
      toast(to.staffId ? `Check #${next.checkNo} transferred to ${staffName(to.staffId)}` : `Check #${next.checkNo} moved to table ${tableName(to.tableId)}`);
      setCheck(null);
      setSel(null);
    });
  }

  /** Moves the selected item to a new check (separate bills). */
  function splitLine(line: CheckLine) {
    if (!check) return;
    if (check.payments.length) return toast("Split before taking payments", true);
    const rest = check.lines.filter((l) => l.id !== line.id);
    if (!rest.some((l) => !l.voided)) return toast("The check needs at least one other item", true);
    withPrivilege("pos.splitCheck", async (by) => {
      const saved = sendRound(check).sent.length ? await send(check, false) : check;
      if (!saved) return;
      const moved = saved.lines.filter((l) => l.id === line.id);
      const checkNo = await allocateCheckNo(store, ws.id, bd);
      const nc: Check = { ...newCheck({ propertyId: ws.propertyId, rvcId, workstationId: ws.id, checkNo, orderTypeId: saved.orderTypeId, staffId: saved.staffId, businessDate: bd, covers: 1, ...(saved.tableId ? { tableId: saved.tableId } : {}) }), lines: moved, sentRounds: saved.sentRounds };
      await store.set(C.checks, nc);
      await persist({ ...saved, lines: saved.lines.filter((l) => l.id !== line.id) });
      setSel(null);
      void journal.log({ type: "checkSplit", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), ...onCheck(saved), itemId: line.menuItemId, itemName: line.name, amount: lineValue(line), detail: `moved to new check #${checkNo}` });
      toast(`${line.name} moved to check #${checkNo}`);
    });
  }

  function pickUp(c: Check) {
    const go = () => {
      setCheck(c);
      setSel(null);
      setView("order");
    };
    if (c.staffId === user.id) return go();
    withPrivilege("pos.pickupAnyCheck", go);
  }

  function changeQty(line: CheckLine, delta: number) {
    if (!check || line.sentRound !== undefined) return toast("Item already sent; void it instead", true);
    const qty = line.qty + delta;
    if (qty <= 0) return voidLine(line);
    setCheck({ ...check, lines: check.lines.map((l) => (l.id === line.id ? { ...l, qty } : l)) });
  }

  function applyDiscount(d: Discount, scope: "item" | "check") {
    if (!check) return;
    const next = scope === "check" ? { ...check, checkDiscountIds: [...new Set([...check.checkDiscountIds, d.id])] } : sel ? { ...check, lines: check.lines.map((l) => (l.id === sel ? { ...l, discountIds: [...new Set([...l.discountIds, d.id])] } : l)) } : check;
    const before = activeLines(check).length ? computeCheckTotals(check, ctx).discountTotal : 0;
    const after = activeLines(next).length ? computeCheckTotals(next, ctx).discountTotal : 0;
    const base = scope === "item" && selLine ? lineValue(selLine) : totals?.itemsTotal ?? 0;
    const bp = d.type === "percent" ? d.value : base ? Math.round(((after - before) / base) * 10_000) : 0;
    setDialog(null);
    withPrivilege(
      d.requiresManager ? "pos.discountManager" : "pos.discount",
      (by) => {
        setCheck(next);
        void journal.log({ type: "discount", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), ...onCheck(check), amount: after - before, detail: `${d.name} (${scope})`, ...(scope === "item" && selLine ? { itemId: selLine.menuItemId, itemName: selLine.name } : {}) });
      },
      { kind: "discountBp", value: bp, label: `${(bp / 100).toFixed(1)}%` },
    );
  }

  async function openTable(t: Table) {
    const existing = openChecks.find((c) => c.tableId === t.id);
    if (existing) return pickUp(existing);
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
  const pageCount = perPage > 0 ? Math.max(1, Math.ceil(items.length / perPage)) : 1;
  const shownPage = Math.min(itemPage, pageCount - 1);
  const shown = perPage > 0 && items.length > perPage ? items.slice(shownPage * perPage, (shownPage + 1) * perPage) : items;
  const selLine = check?.lines.find((l) => l.id === sel);
  const customer = customers.find((c) => c.id === check?.customerId);
  const itemCount = check ? activeLines(check).reduce((a, l) => a + l.qty, 0) : 0;

  useEffect(() => setItemPage(0), [cat, q]);
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      if (window.innerWidth <= 860) return setPerPage(0);
      const cs = getComputedStyle(el);
      const cols = cs.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
      const gap = parseFloat(cs.rowGap) || 10;
      const itemH = el.querySelector<HTMLElement>(".pos-item")?.offsetHeight || 92;
      const avail = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const rows = Math.max(1, Math.floor((avail + gap) / (itemH + gap)));
      setPerPage(cols * rows);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, theme.buttonSize, theme.showImages, theme.columns, theme.fontScale, items.length > 0]);

  const dialogs = (
    <>
      {dialog?.t === "mods" ? (
        <ModifierDialog item={dialog.item} groups={dialog.item.modifierGroupIds.map((id) => modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => Boolean(g))} onAdd={(mods, qty, note) => addItem(dialog.item, mods, qty, note)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.t === "allergy" ? (
        <Modal title="Allergy alert" onClose={() => setDialog(null)} footer={<><button className="btn" onClick={() => setDialog(null)}>Don't add</button><button className="btn danger solid" onClick={() => { const item = dialog.item; setDialog(null); const groups = item.modifierGroupIds.map((id) => modifierGroups.find((g) => g.id === id)).filter((g): g is ModifierGroup => Boolean(g)); if (groups.length) setDialog({ t: "mods", item }); else addItem(item, [], 1, `ALLERGY CHECKED: ${dialog.hits.join(", ")}`); }}>Add anyway</button></>}>
          <div className="callout bad"><strong>{dialog.item.name}</strong> contains <strong>{dialog.hits.join(", ")}</strong>, which this guest is allergic to.</div>
        </Modal>
      ) : null}
      {dialog?.t === "auth" ? <ManagerAuth privilege={dialog.privilege} requester={user} propertyId={ws.propertyId} staff={staff} roles={roles} {...(dialog.limit ? { limit: dialog.limit } : {})} onApproved={dialog.then} onClose={() => setDialog(null)} /> : null}
      {dialog?.t === "transfer" && check ? (
        <Modal title={`Transfer check #${check.checkNo}`} onClose={() => setDialog(null)}>
          <div className="stack">
            <span className="section-title">To another employee</span>
            <div className="chips">
              {staff.filter((s) => s.status === "active" && s.id !== check.staffId && (!s.propertyIds?.length || s.propertyIds.includes(ws.propertyId))).map((s) => <button key={s.id} className="chip" onClick={() => transferCheck({ staffId: s.id })}>{s.name}</button>)}
            </div>
            {tables.length ? (
              <>
                <span className="section-title">To another table</span>
                <div className="chips">
                  {tables.filter((t) => t.id !== check.tableId && !openChecks.some((c) => c.tableId === t.id)).map((t) => <button key={t.id} className="chip" onClick={() => transferCheck({ tableId: t.id })}>Table {t.name}</button>)}
                </div>
              </>
            ) : null}
          </div>
        </Modal>
      ) : null}
      {dialog?.t === "amount" ? <AmountDialog title={dialog.title} {...(dialog.help ? { help: dialog.help } : {})} {...(dialog.initial ? { initial: dialog.initial } : {})} onDone={dialog.then} onClose={() => setDialog(null)} /> : null}
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
          onFinish={() => void finish()}
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
    </>
  );

  const functionsPanel = <Functions ws={ws} user={user} role={role} roles={roles} staff={staff} printers={printers} ctx={ctx} lastInvoice={lastInvoice} menuItems={menuItems} withPrivilege={withPrivilege} print={print} journal={journal} openAmount={(title, help, then) => setDialog({ t: "amount", title, ...(help ? { help } : {}), then: (c) => { setDialog(null); then(c); } })} onPreview={(doc, title) => setDialog({ t: "receipt", doc, title })} />;
  const reportsPanel = <PosReports ws={ws} user={user} role={role} rvcId={rvcId} staff={staff} rvcs={rvcs} ctx={ctx} journal={journal} withPrivilege={withPrivilege} print={print} printers={printers} />;

  if (ui !== "terminal") {
    const api: PosApi = {
      ws, user, role, staff, rvcs, rvcId, rvc, myRvcs, ctx, bd,
      menuItems, categories: visibleCats, tables, openChecks, orderTypes, tenders, printers, imageOf, catColor, customer,
      check, setCheck, totals, itemCount,
      startCheck, tapItem, changeQty, voidLine, overridePrice, splitLine, send, printGuestCheck, reprintKot: () => reprintKot(), kotOnSend, cancelCheck, pickUp, openTable,
      withPrivilege, finish: (paid) => finish(paid, false), print, journal, lastInvoice,
      openDiscount: (scope, lineId) => { if (lineId) setSel(lineId); setDialog({ t: "discount", scope }); },
      openTransfer: () => setDialog({ t: "transfer" }),
      openCustomer: async () => { if (!check) await startCheck(); setDialog({ t: "customer" }); },
      openCovers: () => { if (check) withPrivilege("pos.changeCovers", () => setDialog({ t: "covers", then: (n) => { setCheck({ ...check, covers: n }); setDialog(null); } })); },
      setOrderType: async (id) => { const c = check ?? (await startCheck({ orderTypeId: id })); setCheck({ ...c, orderTypeId: id }); },
      previewReceipt: (doc, title) => setDialog({ t: "receipt", doc, title }),
      changeRvc: (to) => withPrivilege("pos.changeRvc", () => { setCheck(null); onChangeRvc(to); }),
      onSignOut, tableName, staffName, orderTypeName,
      functionsPanel, reportsPanel,
    };
    return <MobilePos style={ui} api={api}>{dialogs}</MobilePos>;
  }

  return (
    <div className={themeClass(theme)} style={themeStyle(theme, settings.branding.primaryColor)}>
      <header className="pos-top">
        <div className="brand-logo">{settings.branding.logoDataUrl ? <img src={settings.branding.logoDataUrl} alt="" /> : settings.branding.displayName.slice(0, 1)}</div>
        <div className="stack tight" style={{ gap: 0 }}>
          <strong>{settings.branding.displayName}</strong>
          <span className="tiny muted">{ws.code} · {user.name}{role ? ` (${role.name})` : ""} · {bd}</span>
        </div>
        {myRvcs.length > 1 ? (
          <select className="select pos-rvc" style={{ width: "auto", minHeight: 30 }} value={rvcId} aria-label="Revenue centre" onChange={(e) => { const to = e.target.value; withPrivilege("pos.changeRvc", () => { setCheck(null); onChangeRvc(to); }); }}>
            {myRvcs.map((r) => <option key={r} value={r}>{rvcs.find((x) => x.id === r)?.name ?? r}</option>)}
          </select>
        ) : (
          <span className="pos-rvc">{rvc?.name ?? rvcId}</span>
        )}
        <span className="grow" />
        <BluetoothPrinterButton ws={ws} className="btn ghost sm" />
        <Seg<View> value={view} onChange={setView} options={[{ value: "order", label: "Order" }, ...(on("tables") ? [{ value: "tables" as View, label: "Tables" }] : []), { value: "checks", label: `Open (${openChecks.length})` }, { value: "reports", label: "Reports" }, { value: "functions", label: "Functions" }]} />
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
              <button key={c.id} className="card card-body stack tight" style={{ textAlign: "left", cursor: "pointer" }} onClick={() => pickUp(c)}>
                <div className="row between"><strong>#{c.checkNo} {c.tableId ? `· Table ${tableName(c.tableId)}` : ""}</strong><span className="badge">{orderTypeName(c.orderTypeId)}</span></div>
                <span className="small muted">{staffName(c.staffId)} · opened {timeColombo(c.openedAt)} · {minutesSince(c.openedAt)} min</span>
                <span className="num">{money(activeLines(c).length ? computeCheckTotals(c, ctx).amountDue : 0)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : view === "reports" ? (
        reportsPanel
      ) : view === "functions" ? (
        functionsPanel
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
            <div
              ref={gridRef}
              className={`pos-grid${pageCount > 1 ? " paged" : ""}`}
              style={gridColumns(theme)}
              onPointerDown={(e) => (swipe.current = e.clientX)}
              onPointerUp={(e) => {
                const dx = swipe.current === null ? 0 : e.clientX - swipe.current;
                swipe.current = null;
                if (pageCount > 1 && Math.abs(dx) > 80) setItemPage(Math.max(0, Math.min(pageCount - 1, shownPage + (dx < 0 ? 1 : -1))));
              }}
            >
              {shown.map((m) => {
                const img = theme.showImages && m.hasImage ? imageOf.get(m.id) : undefined;
                const meta = (
                  <>
                    <span className="name">{m.name}</span>
                    <span className="row between">
                      <span className="price">{m.openPrice ? "Open price" : money(m.price)}</span>
                      {m.allergens.length ? <span className="tiny" title={`Contains ${m.allergens.join(", ")}`}>⚠ {m.allergens.length}</span> : null}
                    </span>
                  </>
                );
                return (
                  <button key={m.id} className={`pos-item${m.available ? "" : " out"}${img ? " has-img" : ""}`} style={{ ["--cat" as string]: m.buttonColor || catColor.get(m.categoryId), ["--cat-text" as string]: readableTextOn(m.buttonColor || catColor.get(m.categoryId)) }} onClick={() => tapItem(m)}>
                    {!m.available ? <span className="badge bad tag86">86</span> : null}
                    {img ? (
                      <>
                        <img src={img} alt="" loading="lazy" />
                        <span className="meta">{meta}</span>
                      </>
                    ) : (
                      meta
                    )}
                  </button>
                );
              })}
            </div>
            {pageCount > 1 ? (
              <div className="pos-pager" aria-label="Item pages">
                <button className="btn" disabled={shownPage === 0} onClick={() => setItemPage(shownPage - 1)} aria-label="Previous page">‹ Prev</button>
                <span className="small muted">Page {shownPage + 1} of {pageCount}</span>
                <button className="btn" disabled={shownPage >= pageCount - 1} onClick={() => setItemPage(shownPage + 1)} aria-label="Next page">Next ›</button>
              </div>
            ) : null}
          </section>

          <aside className={`pos-check${sheetOpen ? " open" : ""}`}>
            <button className="btn ghost mobile-only" style={{ margin: "6px auto 0" }} onClick={() => setSheetOpen(!sheetOpen)}>
              {sheetOpen ? "Hide check ▾" : `Check · ${itemCount} item(s) · ${money(totals?.amountDue)} ▴`}
            </button>
            <div className="pos-check-head">
              <div className="row between">
                <strong>{check ? `Check #${check.checkNo}` : "New check"}{check?.tableId ? ` · Table ${tableName(check.tableId)}` : ""}</strong>
                {check && check.lines.length ? <button className="btn ghost sm" onClick={() => setDialog({ t: "transfer" })}>Transfer</button> : null}
                {check ? (
                  <button className="btn ghost sm" onClick={() => withPrivilege("pos.changeCovers", () => setDialog({ t: "covers", then: (n) => { setCheck({ ...check, covers: n }); setDialog(null); } }))}>{check.covers} pax</button>
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
                {selLine.sentRound === undefined ? <button className="btn sm" onClick={() => overridePrice(selLine)}>Price</button> : null}
                <button className="btn sm" onClick={() => splitLine(selLine)}>Split</button>
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
              <button className="btn" disabled={!check} onClick={() => send()} title={kotOnSend ? "Send the new items to the kitchen and print the kitchen ticket (KOT)" : "Send the new items to the kitchen"}>{kotOnSend ? "Send KOT" : "Send"}</button>
              <button className="btn" disabled={!totals} onClick={printGuestCheck}>Print bill</button>
              <button className="btn" disabled={!totals} onClick={() => setDialog({ t: "discount", scope: "check" })}>Discount</button>
              <button className="btn" disabled={!check} onClick={cancelCheck}>{check && check.lines.some((l) => l.sentRound === undefined) ? "Cancel" : "Close"}</button>
              <button className="btn primary pay" disabled={!totals} onClick={() => withPrivilege("pos.tender", () => setDialog({ t: "pay" }))}>Pay {totals ? money(totals.amountDue) : ""}</button>
              <button className="btn" disabled={!check} onClick={() => send()}>Hold &amp; new</button>
              <button className="btn" disabled={!check || !check.lines.some((l) => l.sentRound !== undefined && !l.voided)} onClick={() => void reprintKot()}>Reprint KOT</button>
            </div>
          </aside>
        </div>
      )}

      {dialogs}
    </div>
  );
}

function Functions({ ws, user, role, roles, staff, printers, ctx, lastInvoice, menuItems, withPrivilege, print, journal, openAmount, onPreview }: {
  ws: Workstation;
  user: Staff;
  role: Role | undefined;
  roles: Role[];
  staff: Staff[];
  printers: Printer[];
  ctx: PosContext;
  lastInvoice: ReceiptDoc | null;
  menuItems: MenuItem[];
  withPrivilege: (p: PrivilegeKey, run: (by: Staff) => void, limit?: Limit) => void;
  print: (kind: "kot" | "bill" | "receipt" | "report", doc: ReceiptDoc, printer: Printer | undefined) => Promise<void>;
  journal: PosJournal;
  openAmount: (title: string, help: string | undefined, then: (cents: number) => void) => void;
  onPreview: (doc: ReceiptDoc, title: string) => void;
}) {
  const { settings, on, toast, ledger } = useApp();
  const store = useStore();
  const [eod, setEod] = useState<string[] | null>(null);
  const [panel, setPanel] = useState<"unlock" | "journal" | null>(null);
  const bd = businessDateNow(settings.pos);
  const receiptPrinter = printers.find((p) => p.id === ws.receiptPrinterId);
  const tenders = [...ctx.tenders.values()];
  const authBy = (by: Staff) => (by.id !== user.id ? { authorizedBy: by.id } : {});
  const drawer = () => print("receipt", { width: paperWidthFor(ws, receiptPrinter), blocks: [{ t: "drawer" }] }, receiptPrinter);

  async function report(kind: "X" | "Z") {
    const stats = (await store.get<DailyStats>(C.dailyStats, statsId(ws.propertyId, bd))) ?? null;
    if (!stats) return toast("No sales yet today", true);
    const doc = buildDaySummary({ stats, kind, width: paperWidthFor(ws, receiptPrinter), businessName: settings.business.tradingName, propertyName: ws.propertyId, tenders, printedAt: new Date().toISOString() });
    await print("report", doc, receiptPrinter);
    void journal.log({ type: "report", employeeId: user.id, detail: `${kind} report` });
    onPreview(doc, `${kind} report`);
    return stats;
  }

  async function endOfDay(by: Staff) {
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
      const doc = buildDaySummary({ stats, kind: "Z", width: paperWidthFor(ws, receiptPrinter), businessName: settings.business.tradingName, propertyName: ws.propertyId, tenders, printedAt: new Date().toISOString() });
      await print("report", doc, receiptPrinter);
      steps.push(`Z report printed: net sales ${money(stats.netSales)}, ${stats.checks} checks.`);
      if (on("whatsapp")) {
        const text = eodWhatsAppText({ stats, business: settings.business, branding: settings.branding, menuItems, tenders, propertyName: ws.propertyId });
        const at = new Date().toISOString();
        await store.batch(settings.integrations.whatsapp.eodRecipients.map((r) => ({ op: "set" as const, col: C.messageLog, data: { id: newId(), channel: "whatsapp", to: r.phone, template: "eod_report", body: text, mode: settings.integrations.whatsapp.mode, status: "simulated", at } })));
        steps.push(`WhatsApp EOD report ${settings.integrations.whatsapp.mode === "mock" ? "simulated" : "queued"} for ${settings.integrations.whatsapp.eodRecipients.length} manager(s).`);
      }
    } else steps.push("No sales recorded today.");
    void journal.log({ type: "endOfDay", employeeId: user.id, ...authBy(by), ...(stats ? { amount: stats.netSales } : {}), detail: bd });
    setEod(steps);
  }

  function paid(kind: "paidIn" | "paidOut") {
    openAmount(kind === "paidIn" ? "Paid in" : "Paid out", kind === "paidIn" ? "Cash put into the drawer (float, change from the bank)." : "Cash taken out of the drawer for a small purchase. Keep the receipt.", (cents) => {
      if (cents <= 0) return;
      withPrivilege(
        "pos.paidInOut",
        async (by) => {
          await drawer();
          await journal.log({ type: kind, employeeId: user.id, ...authBy(by), amount: cents });
          toast(`${kind === "paidIn" ? "Paid in" : "Paid out"} ${money(cents)} (logged)`);
        },
        kind === "paidOut" ? { kind: "paidOutAmount", value: cents, label: money(cents) } : undefined,
      );
    });
  }

  async function clockOut() {
    if (!user.clockedInAt) return toast("You are not clocked in", true);
    const now = new Date().toISOString();
    const cards = await store.list<TimeCard>(C.timeCards, { where: [["staffId", "==", user.id]] });
    const open = cards.filter((c) => !c.clockOut).sort((a, b) => b.clockIn.localeCompare(a.clockIn))[0];
    if (open) await store.set(C.timeCards, { ...open, clockOut: now, minutes: Math.round((Date.parse(now) - Date.parse(open.clockIn)) / 60_000) });
    const { clockedInAt: _c, ...rest } = staff.find((s) => s.id === user.id) ?? user;
    await store.set(C.staff, rest);
    await journal.log({ type: "clockOut", employeeId: user.id });
    toast(`Clocked out at ${timeColombo(now)}`);
  }

  const tiles: { label: string; sub: string; privilege?: PrivilegeKey; run: (by: Staff) => void; show?: boolean }[] = [
    { label: "X report", sub: "Sales so far today", privilege: "pos.reports", run: () => void report("X") },
    { label: "End of Day", sub: "Z report, stock, ledger, WhatsApp", privilege: "pos.endOfDay", run: (by) => void endOfDay(by) },
    { label: "Reprint last bill", sub: "Marked COPY", privilege: "pos.reprint", run: (by) => (lastInvoice ? print("receipt", { ...lastInvoice, blocks: [{ t: "text", text: "*** COPY ***", align: "center", bold: true }, ...lastInvoice.blocks.filter((b) => b.t !== "drawer")] }, receiptPrinter).then(() => { void journal.log({ type: "reprint", employeeId: user.id, ...authBy(by) }); toast("Copy sent"); }) : toast("No bill printed on this device yet", true)) },
    { label: "No sale", sub: "Open the cash drawer", privilege: "pos.noSale", run: (by) => void drawer().then(async () => { await journal.log({ type: "noSale", employeeId: user.id, ...authBy(by) }); toast("Drawer opened (logged)"); }) },
    { label: "Paid in", sub: "Cash into the drawer", privilege: "pos.paidInOut", run: () => paid("paidIn") },
    { label: "Paid out", sub: "Cash out for small purchases", privilege: "pos.paidInOut", run: () => paid("paidOut") },
    { label: "Clock out", sub: user.clockedInAt ? `In since ${timeColombo(user.clockedInAt)}` : "Time and attendance", run: () => void clockOut(), show: Boolean(user.clockedInAt) || Boolean(settings.pos.requireClockIn) },
    { label: "Unlock employee", sub: "After too many wrong PINs", privilege: "pos.unlockEmployee", run: () => setPanel("unlock") },
    { label: "Transaction journal", sub: "This workstation, today", privilege: "pos.journal", run: () => setPanel("journal") },
  ];

  return (
    <div style={{ overflowY: "auto", padding: 16 }} className="stack">
      <div className="grid cols-4">
        {tiles.filter((t) => t.show !== false).map((t) => (
          <button key={t.label} className="card card-body stack tight" style={{ textAlign: "left", cursor: "pointer", minHeight: 96 }} onClick={() => (t.privilege && t.label !== "Paid in" && t.label !== "Paid out" ? withPrivilege(t.privilege, (by) => t.run(by)) : t.run(user))}>
            <strong>{t.label}</strong>
            <span className="small muted">{t.sub}</span>
            {t.privilege && !canPerform(role, t.privilege) ? <span className="badge warn">Needs approval</span> : null}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h3>Item availability (86)</h3><span className="small muted">Tap to mark out of stock / back on sale</span></div>
        <div className="card-body chips">
          {menuItems.filter((m) => m.active).sort((a, b) => a.name.localeCompare(b.name)).map((m) => (
            <button key={m.id} className={`chip${m.available ? "" : " on"}`} onClick={() => withPrivilege("pos.eightySix", async (by) => { await store.merge(C.menuItems, m.id, { available: !m.available }); void journal.log({ type: "eightySix", employeeId: user.id, ...authBy(by), itemId: m.id, itemName: m.name, detail: m.available ? "out of stock" : "back on sale" }); toast(`${m.name} ${m.available ? "86'd" : "back on sale"}`); })}>
              {m.available ? m.name : `86 · ${m.name}`}
            </button>
          ))}
        </div>
      </div>
      <div className="card card-body row wrap between">
        <span className="small muted">Device: {ws.name} ({ws.deviceProfile === "mobile" ? "mobile" : "dedicated"}) · printing via {ws.printMode} · {roles.length} roles · {staff.length} employees</span>
        <Link className="btn sm" to="/emc/home">Back office</Link>
      </div>
      {panel === "unlock" ? (
        <Modal title="Locked employees" onClose={() => setPanel(null)}>
          <div className="stack tight">
            {staff.filter((s) => s.lockedAt).map((s) => (
              <div key={s.id} className="row between">
                <span>{s.name} <span className="tiny muted">locked {timeColombo(s.lockedAt)}</span></span>
                <button className="btn sm" onClick={async () => { const { lockedAt: _l, ...rest } = s; await store.set(C.staff, { ...rest, failedSignIns: 0 }); await journal.log({ type: "unlock", employeeId: user.id, detail: s.name }); toast(`${s.name} unlocked`); }}>Unlock</button>
              </div>
            ))}
            {!staff.some((s) => s.lockedAt) ? <p className="muted">Nobody is locked out.</p> : null}
          </div>
        </Modal>
      ) : null}
      {panel === "journal" ? <JournalPanel ws={ws} staff={staff} onClose={() => setPanel(null)} /> : null}
      {eod ? (
        <Modal title={`End of Day · ${bd}`} onClose={() => setEod(null)} footer={<button className="btn primary" onClick={() => setEod(null)}>Done</button>}>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="stack tight">{eod.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Modal>
      ) : null}
    </div>
  );
}

function JournalPanel({ ws, staff, onClose }: { ws: Workstation; staff: Staff[]; onClose: () => void }) {
  const { settings } = useApp();
  const bd = businessDateNow(settings.pos);
  const events = (useCollection<PosEvent>(C.posJournal, { where: [["businessDate", "==", bd]] }) ?? []).filter((e) => e.workstationId === ws.id).sort((a, b) => b.at.localeCompare(a.at));
  const name = (id?: string) => staff.find((s) => s.id === id)?.name ?? id ?? "";
  return (
    <Modal wide title={`Transaction journal · ${ws.code} · ${bd}`} onClose={onClose}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Time</th><th>Employee</th><th>Event</th><th>Check</th><th>Detail</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className="small">{timeColombo(e.at)}</td>
                <td>{name(e.employeeId)}{e.authorizedBy ? <div className="tiny muted">approved by {name(e.authorizedBy)}</div> : null}</td>
                <td><span className={`badge ${EXCEPTION_EVENTS.includes(e.type) ? "warn" : ""}`}>{POS_EVENT_LABEL[e.type]}</span></td>
                <td>{e.checkNo ? `#${e.checkNo}` : ""}</td>
                <td className="small">{[e.itemName, e.reason, e.detail].filter(Boolean).join(" · ")}</td>
                <td className="num">{e.amount !== undefined ? money(e.amount) : ""}</td>
              </tr>
            ))}
            {!events.length ? <tr><td colSpan={6} className="muted">No events yet today.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export type { Invoice };
