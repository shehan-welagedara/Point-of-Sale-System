import { useState } from "react";
import {
  type InventoryItem,
  type MenuCategory,
  type MenuImage,
  type Printer,
  type TenderMedia,
  COLLECTIONS as C,
  newId,
} from "@pos/core";
import { buildTestPage, widthForPaper } from "@pos/printing";
import { CrudPage, type FieldDef } from "../../components/CrudPage";
import { useApp, useCollection, useDoc, useStore } from "../../state/app";
import { resizeImage } from "../../lib/images";
import { money, pct, stockQty } from "../../lib/format";
import { queuePrint } from "../../lib/printing";
import { Field, ModuleOff, Explain } from "../../components/ui";
import { ConnectedDevices } from "./Devices";

const yes = (b: unknown) => (b ? <span className="badge good">Yes</span> : <span className="badge">No</span>);
const active = (b: unknown) => (b ? <span className="badge good">Active</span> : <span className="badge">Inactive</span>);

function useNames(col: string): Map<string, string> {
  const docs = useCollection<{ id: string; name?: string }>(col);
  return new Map((docs ?? []).map((d) => [d.id, d.name ?? d.id]));
}

const MAJOR_GROUPS = ["Food", "Beverage", "Liquor", "Other"].map((v) => ({ value: v, label: v }));
const ALLERGENS = ["gluten", "egg", "milk", "fish", "crustaceans", "molluscs", "peanuts", "tree nuts", "soy", "sesame", "mustard", "celery", "sulphites"].map((v) => ({ value: v, label: v }));

// ───────────────────────────── Menu ─────────────────────────────

export function CategoriesPage() {
  return (
    <CrudPage
      title="Menu categories"
      subtitle="Categories group items on the POS screen; the major group drives revenue accounts and reports."
      col={C.menuCategories}
      idFrom="code"
      noun="category"
      newDoc={() => ({ code: "", name: "", majorGroup: "Food", color: "#0F766E", sortOrder: 99, active: true })}
      sort={(a, b) => a.sortOrder - b.sortOrder}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "majorGroup", label: "Major group", type: "select", options: MAJOR_GROUPS, required: true },
        { key: "color", label: "Button colour", type: "color" },
        { key: "sortOrder", label: "Sort order", type: "number" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
        { header: "Name", render: (d) => <span className="row"><span style={{ width: 12, height: 12, borderRadius: 4, background: d.color }} />{d.name}</span> },
        { header: "Major group", render: (d) => d.majorGroup },
        { header: "Sort", render: (d) => d.sortOrder, num: true },
        { header: "Status", render: (d) => active(d.active) },
      ]}
    />
  );
}

function MenuThumb({ id }: { id: string }) {
  const img = useDoc<MenuImage>(C.menuImages, id);
  return img ? <img src={img.dataUrl} alt="" style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 6 }} /> : null;
}

/** Photo for the POS button: resized in the browser and saved with the item. */
function MenuImageField({ doc, setDoc }: { doc: Record<string, any>; setDoc: (d: any) => void }) {
  const { toast } = useApp();
  const stored = useDoc<MenuImage>(C.menuImages, doc.id || undefined);
  const pending = doc._image as { dataUrl: string; bytes: number } | null | undefined;
  const shown = pending === null ? null : (pending?.dataUrl ?? (doc.hasImage ? stored?.dataUrl : undefined));
  return (
    <Field label="Photo on the POS (optional)" help="Shown on the item button when the POS theme has photos switched on. Resized to 400 px (about 30 KB); stored in the database, no file storage needed.">
      <div className="row wrap">
        {shown ? <img src={shown} alt="" style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid var(--line)" }} /> : <div className="muted small" style={{ width: 120, height: 90, display: "grid", placeItems: "center", border: "1px dashed var(--line-strong)", borderRadius: 10 }}>No photo</div>}
        <label className="btn sm">
          Choose photo
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                setDoc({ ...doc, _image: await resizeImage(f) });
              } catch (err) {
                toast((err as Error).message, true);
              }
            }}
          />
        </label>
        {shown ? <button type="button" className="btn ghost sm" onClick={() => setDoc({ ...doc, _image: null })}>Remove</button> : null}
        {pending ? <span className="tiny muted">{Math.round(pending.bytes / 1024)} KB · saved with the item</span> : null}
      </div>
    </Field>
  );
}

export function MenuItemsPage() {
  const store = useStore();
  const cats = useNames(C.menuCategories);
  return (
    <CrudPage
      title="Menu items"
      subtitle="Prices are in LKR and follow the tax setting (exclusive or inclusive). Codes link items to recipes and sales history."
      col={C.menuItems}
      idFrom="code"
      noun="menu item"
      search={(d) => `${d.code} ${d.name} ${d.nameSi ?? ""} ${cats.get(d.categoryId) ?? ""}`}
      newDoc={() => ({ code: "", name: "", categoryId: "", price: 0, taxClass: "standard", kotRoute: "kitchen", modifierGroupIds: [], allergens: [], available: true, active: true, sortOrder: 99 })}
      fields={[
        { key: "code", label: "Item code (PLU)", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name (English)", type: "text", required: true },
        { key: "nameSi", label: "Name (Sinhala)", type: "text" },
        { key: "nameTa", label: "Name (Tamil)", type: "text" },
        { key: "categoryId", label: "Category", type: "select", required: true, optionsFrom: { col: C.menuCategories } },
        { key: "price", label: "Price", type: "money", required: true },
        { key: "taxClass", label: "Tax class", type: "select", options: [{ value: "standard", label: "Standard (VAT-able)" }, { value: "exempt", label: "Exempt" }] },
        { key: "kotRoute", label: "Kitchen ticket goes to", type: "select", options: [{ value: "kitchen", label: "Kitchen printer / KDS" }, { value: "bar", label: "Bar printer" }, { value: "none", label: "No ticket" }] },
        { key: "modifierGroupIds", label: "Modifier groups", type: "multi", optionsFrom: { col: C.modifierGroups } },
        { key: "allergens", label: "Allergens", type: "multi", options: ALLERGENS, help: "Shown to staff on the POS and printed on kitchen tickets." },
        { key: "description", label: "Description", type: "textarea" },
        { key: "sortOrder", label: "Sort order", type: "number" },
        { key: "buttonColor", label: "POS button colour", type: "color", help: "Leave empty to use the category colour." },
        { key: "openPrice", label: "Open price (the price is entered at the POS, needs the open-price privilege)", type: "bool" },
        { key: "available", label: "Available (off = 86'd / out of stock)", type: "bool" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      extraEditor={(d, setDoc) => <MenuImageField doc={d} setDoc={setDoc} />}
      beforeSave={async (d) => {
        const { _image, ...rest } = d as typeof d & { _image?: { dataUrl: string; width: number; height: number; bytes: number } | null };
        if (_image) await store.set(C.menuImages, { id: rest.id, ...(_image as object), updatedAt: new Date().toISOString() });
        if (_image === null) await store.remove(C.menuImages, rest.id);
        return { ...rest, hasImage: _image === null ? false : Boolean(_image) || Boolean(rest.hasImage) };
      }}
      columns={[
        { header: "", render: (d) => (d.hasImage ? <MenuThumb id={d.id} /> : null) },
        { header: "Code", render: (d) => <span className="mono">{d.code}</span> },
        { header: "Name", render: (d) => <div><div>{d.name}</div>{d.nameSi ? <div className="tiny muted">{d.nameSi}</div> : null}</div> },
        { header: "Category", render: (d) => cats.get(d.categoryId) ?? "—" },
        { header: "Price", render: (d) => money(d.price), num: true },
        { header: "Cost", render: (d) => (d.cost ? money(d.cost) : <span className="muted">—</span>), num: true },
        { header: "Cost %", render: (d) => (d.cost && d.price ? pct(Math.round((d.cost / d.price) * 10_000)) : "—"), num: true },
        { header: "Status", render: (d) => (!d.active ? <span className="badge">Inactive</span> : d.available ? <span className="badge good">On sale</span> : <span className="badge bad">86</span>) },
      ]}
    />
  );
}

export function ModifiersPage() {
  return (
    <CrudPage
      title="Modifier groups"
      subtitle="Choices and extras (spice level, rice type, extra cheese). Min 1 forces the cashier to choose. Options can deduct stock."
      col={C.modifierGroups}
      idFrom="code"
      noun="modifier group"
      newDoc={() => ({ code: "", name: "", min: 0, max: 1, options: [] })}
      beforeSave={(d) => ({ ...d, options: (d.options ?? []).map((o: Record<string, unknown>, i: number) => ({ ...o, id: o.id || `${d.id}-${i + 1}-${newId().slice(-4)}`, price: o.price ?? 0 })) })}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "min", label: "Minimum choices", type: "number" },
        { key: "max", label: "Maximum choices", type: "number" },
        {
          key: "options",
          label: "Options",
          type: "lines",
          newRow: () => ({ name: "", price: 0 }),
          fields: [
            { key: "name", label: "Option", type: "text" },
            { key: "price", label: "Price", type: "money" },
            { key: "inventoryItemId", label: "Stock item", type: "select", optionsFrom: { col: C.inventoryItems } },
            { key: "qty", label: "Stock qty", type: "number" },
          ],
        },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
        { header: "Name", render: (d) => d.name },
        { header: "Choice", render: (d) => (d.min > 0 ? `Required (${d.min}–${d.max})` : `Optional (up to ${d.max})`) },
        { header: "Options", render: (d) => (d.options ?? []).map((o: { name: string }) => o.name).join(", ") },
      ]}
    />
  );
}

// ───────────────────────────── POS configuration ─────────────────────────────

export function OrderTypesPage() {
  return (
    <CrudPage
      title="Order types"
      col={C.orderTypes}
      idFrom="code"
      noun="order type"
      newDoc={() => ({ code: "", name: "", requiresTable: false, sortOrder: 9, active: true })}
      sort={(a, b) => a.sortOrder - b.sortOrder}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true, help: "Used by service-charge rules (e.g. dine-in)." },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "requiresTable", label: "Requires a table", type: "bool" },
        { key: "sortOrder", label: "Sort order", type: "number" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
        { header: "Name", render: (d) => d.name },
        { header: "Table", render: (d) => yes(d.requiresTable) },
        { header: "Status", render: (d) => active(d.active) },
      ]}
    />
  );
}

const TENDER_TYPES: { value: TenderMedia["type"]; label: string }[] = [
  { value: "cash", label: "Cash (LKR)" },
  { value: "card", label: "Card (bank terminal)" },
  { value: "lankaqr", label: "LankaQR" },
  { value: "payhere", label: "PayHere (IPG)" },
  { value: "foreignCash", label: "Foreign currency cash" },
  { value: "voucher", label: "Gift voucher" },
  { value: "house", label: "House account (credit)" },
  { value: "comp", label: "Complimentary / staff meal" },
];

export function TendersPage() {
  const accounts = useNames(C.accounts);
  return (
    <CrudPage
      title="Tender media"
      subtitle="How guests pay. Each tender posts to a ledger account and appears on the reconciliation."
      col={C.tenderMedia}
      idFrom="code"
      noun="tender"
      sort={(a, b) => a.sortOrder - b.sortOrder}
      newDoc={() => ({ code: "", name: "", type: "card", allowChange: false, requiresReference: true, opensDrawer: false, accountCode: "", sortOrder: 20, active: true })}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name on POS and bill", type: "text", required: true },
        { key: "type", label: "Type", type: "select", options: TENDER_TYPES, required: true },
        { key: "currency", label: "Currency code", type: "text", show: (d) => d.type === "foreignCash", placeholder: "USD" },
        { key: "exchangeRateMicros", label: "Exchange rate (LKR per unit × 1,000,000)", type: "number", show: (d) => d.type === "foreignCash", help: "e.g. 300.25 LKR per USD → 300250000" },
        { key: "allowChange", label: "Can give change", type: "bool" },
        { key: "requiresReference", label: "Requires a reference (approval code, QR ref…)", type: "bool" },
        { key: "opensDrawer", label: "Opens the cash drawer", type: "bool" },
        { key: "accountCode", label: "Ledger account", type: "select", optionsFrom: { col: C.accounts, label: (a) => `${a.code} ${a.name}` } },
        { key: "sortOrder", label: "Sort order", type: "number" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
        { header: "Name", render: (d) => d.name },
        { header: "Type", render: (d) => TENDER_TYPES.find((t) => t.value === d.type)?.label },
        { header: "Change", render: (d) => yes(d.allowChange) },
        { header: "Account", render: (d) => (d.accountCode ? `${d.accountCode} ${accounts.get(d.accountCode) ?? ""}` : "—") },
        { header: "Status", render: (d) => active(d.active) },
      ]}
    />
  );
}

export function DiscountsPage() {
  return (
    <CrudPage
      title="Discounts"
      col={C.discounts}
      idFrom="code"
      noun="discount"
      newDoc={() => ({ code: "", name: "", type: "percent", value: 1000, scope: "check", requiresManager: false, active: true })}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "type", label: "Type", type: "select", options: [{ value: "percent", label: "Percentage" }, { value: "amount", label: "Fixed amount" }] },
        { key: "value", label: "Percentage", type: "percent", show: (d) => d.type === "percent" },
        { key: "value", label: "Amount", type: "money", show: (d) => d.type === "amount" },
        { key: "scope", label: "Applies to", type: "select", options: [{ value: "check", label: "Whole check" }, { value: "item", label: "Selected item" }] },
        { key: "requiresManager", label: "Needs a manager", type: "bool" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
        { header: "Name", render: (d) => d.name },
        { header: "Value", render: (d) => (d.type === "percent" ? pct(d.value, 0) : money(d.value)), num: true },
        { header: "Scope", render: (d) => (d.scope === "item" ? "Item" : "Check") },
        { header: "Manager", render: (d) => yes(d.requiresManager) },
        { header: "Status", render: (d) => active(d.active) },
      ]}
    />
  );
}

export function ReasonsPage() {
  const types = ["void", "refund", "discount", "comp", "waste", "paidOut"].map((v) => ({ value: v, label: v }));
  return (
    <CrudPage
      title="Reason codes"
      subtitle="Staff must pick a reason for voids, refunds, comps and waste; reasons appear on exception reports."
      col={C.reasonCodes}
      idFrom="auto"
      noun="reason"
      sort={(a, b) => `${a.type}${a.name}`.localeCompare(`${b.type}${b.name}`)}
      newDoc={() => ({ type: "void", name: "" })}
      fields={[
        { key: "type", label: "Used for", type: "select", options: types, required: true },
        { key: "name", label: "Reason", type: "text", required: true },
      ]}
      columns={[
        { header: "Used for", render: (d) => <span className="badge">{d.type}</span> },
        { header: "Reason", render: (d) => d.name },
      ]}
    />
  );
}

export function TablesPage() {
  const props = useNames(C.properties);
  return (
    <CrudPage
      title="Tables"
      col={C.tables}
      idFrom="auto"
      noun="table"
      sort={(a, b) => a.sortOrder - b.sortOrder}
      newDoc={() => ({ name: "", area: "Indoor", seats: 4, sortOrder: 99, propertyId: "" })}
      fields={[
        { key: "propertyId", label: "Outlet", type: "select", optionsFrom: { col: C.properties }, required: true },
        { key: "name", label: "Table name / number", type: "text", required: true },
        { key: "area", label: "Area", type: "text" },
        { key: "seats", label: "Seats", type: "number" },
        { key: "sortOrder", label: "Sort order", type: "number" },
      ]}
      columns={[
        { header: "Table", render: (d) => <strong>{d.name}</strong> },
        { header: "Area", render: (d) => d.area },
        { header: "Seats", render: (d) => d.seats, num: true },
        { header: "Outlet", render: (d) => props.get(d.propertyId) ?? "—" },
      ]}
    />
  );
}

// ───────────────────────────── Organisation & devices ─────────────────────────────

export function OrganisationPage() {
  const props = useNames(C.properties);
  return (
    <>
      <CrudPage
        title="Outlets"
        subtitle="Each outlet (property) has its own tables, devices, stock and daily totals."
        col={C.properties}
        idFrom="code"
        noun="outlet"
        newDoc={() => ({ code: "", name: "", addressLines: [], active: true })}
        fields={[
          { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
          { key: "name", label: "Name", type: "text", required: true },
          { key: "addressLines", label: "Address lines", type: "tags", placeholder: "No. 25, Galle Road, Colombo 03" },
          { key: "phone", label: "Phone", type: "text" },
          { key: "active", label: "Active", type: "bool" },
        ]}
        columns={[
          { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
          { header: "Name", render: (d) => d.name },
          { header: "Address", render: (d) => (d.addressLines ?? []).join(", ") },
          { header: "Status", render: (d) => active(d.active) },
        ]}
      />
      <CrudPage
        title="Revenue centres"
        subtitle="Areas of the business that sell (restaurant, bar, takeaway). Table service or quick service per centre."
        col={C.revenueCenters}
        idFrom="code"
        noun="revenue centre"
        newDoc={() => ({ code: "", name: "", propertyId: "", serviceMode: "table", defaultOrderTypeId: "dine-in", active: true })}
        fields={[
          { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
          { key: "name", label: "Name", type: "text", required: true },
          { key: "propertyId", label: "Outlet", type: "select", optionsFrom: { col: C.properties }, required: true },
          { key: "serviceMode", label: "Service mode", type: "select", options: [{ value: "table", label: "Table service" }, { value: "quick", label: "Quick service (counter)" }] },
          { key: "defaultOrderTypeId", label: "Default order type", type: "select", optionsFrom: { col: C.orderTypes } },
          { key: "active", label: "Active", type: "bool" },
        ]}
        columns={[
          { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
          { header: "Name", render: (d) => d.name },
          { header: "Outlet", render: (d) => props.get(d.propertyId) ?? "—" },
          { header: "Mode", render: (d) => (d.serviceMode === "table" ? "Table service" : "Quick service") },
        ]}
      />
    </>
  );
}

function PrinterTest({ printer }: { printer: Printer }) {
  const store = useStore();
  const { toast } = useApp();
  return (
    <button
      className="btn sm"
      onClick={async () => {
        await queuePrint(store, { printer, workstationId: "EMC", kind: "test", doc: buildTestPage(printer.name, widthForPaper(printer.paperWidthMm)) });
        toast(`Test page queued for ${printer.name}`);
      }}
    >
      Test print
    </button>
  );
}

export function DevicesPage() {
  const printers = useNames(C.printers);
  const rvcs = useNames(C.revenueCenters);
  const { licence } = useApp();
  const wsDocs = useCollection<{ id: string; active?: boolean }>(C.workstations) ?? [];
  const existing = wsDocs.map((w) => w.id);
  const activeCount = wsDocs.filter((w) => w.active !== false).length;
  return (
    <>
      <div className="page" style={{ paddingBottom: 0 }}>
        <div className="grid cols-2">
          <div className="card pad stack tight">
            <h3>Dedicated hardware</h3>
            <Explain as="p" className="small muted">Windows 10/11 PC or touch POS terminal running the POS full-screen. USB or network bill printer, cash drawer on the printer's RJ11 port, optional customer display.</Explain>
          </div>
          <div className="card pad stack tight">
            <h3>Phones and tablets</h3>
            <Explain as="p" className="small muted">Staff phones, iPads and Android tablets run the POS app in the browser over the internet (Wi-Fi or mobile data). Bills and KOTs still print on the physical printers: phones send print jobs through the cloud to the Print Agent in the restaurant, which drives the printers and cash drawer.</Explain>
          </div>
        </div>
      </div>
      <ConnectedDevices />
      <CrudPage
        fill={false}
        beforeSave={(d) => (d.printMode === "bluetooth" ? { ...d, bluetoothVia: d.bluetoothVia === "rawbt" ? "rawbt" : "browser", paperWidthMm: Number(d.paperWidthMm) === 58 ? 58 : 80, kitchenOnBluetooth: d.kitchenOnBluetooth !== false } : d)}
        title="Workstations"
        subtitle="Every POS device. The code is the invoice classification code in IRD invoice numbers (e.g. 26NOV_W01_123)."
        col={C.workstations}
        idFrom="code"
        noun="workstation"
        newDoc={() => ({ code: "", name: "", propertyId: "", rvcId: "", deviceProfile: "dedicated", receiptPrinterId: "", printMode: "agent", active: true })}
        validate={(d) => {
          const code = String(d.code ?? d.id).toUpperCase();
          if (!/^[A-Z0-9]{1,15}$/.test(code)) return "Code must be 1–15 letters or digits (it appears in invoice numbers)";
          const lim = licence.entitlements.limits.workstations;
          if (!existing.includes(code) && d.active !== false && activeCount >= lim) return `The licence allows ${lim} active workstations. Deactivate one you no longer use, or ask your supplier for more.`;
          return null;
        }}
        fields={[
          { key: "code", label: "Code (invoice classification)", type: "text", required: true, readOnlyOnEdit: true },
          { key: "name", label: "Name", type: "text", required: true },
          { key: "propertyId", label: "Outlet", type: "select", optionsFrom: { col: C.properties }, required: true },
          { key: "rvcId", label: "Revenue centre", type: "select", optionsFrom: { col: C.revenueCenters }, required: true },
          { key: "deviceProfile", label: "Hardware model", type: "select", options: [{ value: "dedicated", label: "Dedicated POS / Windows PC" }, { value: "mobile", label: "Mobile (tablet / phone)" }] },
          { key: "uiStyle", label: "Screen style", type: "select", options: [{ value: "default", label: "Business setting (Mobile app style page)" }, { value: "terminal", label: "Terminal layout" }, { value: "bright", label: "Bright app" }, { value: "indigo", label: "Indigo app" }] },
          { key: "receiptPrinterId", label: "Bill printer", type: "select", optionsFrom: { col: C.printers, filter: (p) => p.role === "receipt" } },
          { key: "printMode", label: "Printing", type: "select", options: [{ value: "agent", label: "Print Agent (the restaurant's printers, for every device)" }, { value: "bluetooth", label: "Bluetooth printer next to this phone or tablet (no Print Agent)" }, { value: "direct", label: "Direct from POS Shell (USB on this PC)" }, { value: "preview", label: "On-screen only (demo)" }] },
          {
            key: "bluetoothVia",
            label: "Bluetooth route",
            type: "select",
            show: (d) => d.printMode === "bluetooth",
            help: "Chrome on Android talks to Bluetooth LE printers directly. The RawBT app (Android) works with any Bluetooth printer. iPhone: use the Bluefy browser.",
            options: [{ value: "browser", label: "From the browser (Chrome on Android)" }, { value: "rawbt", label: "Through the RawBT app (Android, any Bluetooth printer)" }],
          },
          { key: "paperWidthMm", label: "Bluetooth printer paper", type: "select", show: (d) => d.printMode === "bluetooth", options: [{ value: "80", label: "80 mm" }, { value: "58", label: "58 mm" }] },
          { key: "kitchenOnBluetooth", label: "Kitchen and bar tickets print on this printer too", type: "bool", show: (d) => d.printMode === "bluetooth", help: "Off when the kitchen has its own printer through the Print Agent." },
          { key: "active", label: "Active", type: "bool" },
        ]}
        columns={[
          { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
          { header: "Name", render: (d) => d.name },
          { header: "Model", render: (d) => (d.deviceProfile === "mobile" ? <span className="badge info">Mobile</span> : <span className="badge brand">Dedicated</span>) },
          { header: "Revenue centre", render: (d) => rvcs.get(d.rvcId) ?? "—" },
          { header: "Bill printer", render: (d) => (d.printMode === "bluetooth" ? <span className="badge info">Bluetooth{d.bluetoothVia === "rawbt" ? " (RawBT)" : ""}</span> : d.printMode === "preview" ? "On screen" : (printers.get(d.receiptPrinterId) ?? "—")) },
        ]}
      />
      <CrudPage
        fill={false}
        title="Printers"
        subtitle="Any 80 mm or 58 mm ESC/POS thermal printer (Epson TM series, Xprinter, Rongta, Sewoo…), USB or network."
        col={C.printers}
        idFrom="code"
        noun="printer"
        newDoc={() => ({ code: "", name: "", propertyId: "", role: "kitchen", model: "", connection: "network", address: "192.168.1.", port: 9100, paperWidthMm: 80, agentId: "AGENT-1", active: true })}
        fields={[
          { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
          { key: "name", label: "Name", type: "text", required: true },
          { key: "propertyId", label: "Outlet", type: "select", optionsFrom: { col: C.properties }, required: true },
          { key: "role", label: "Prints", type: "select", options: [{ value: "receipt", label: "Bills / receipts" }, { value: "kitchen", label: "Kitchen KOTs" }, { value: "bar", label: "Bar KOTs" }, { value: "report", label: "Reports" }] },
          { key: "model", label: "Model", type: "text", placeholder: "Epson TM-T82III" },
          { key: "connection", label: "Connection", type: "select", options: [{ value: "network", label: "Network (LAN / Wi-Fi)" }, { value: "usb", label: "USB (via Print Agent PC)" }, { value: "bluetooth", label: "Bluetooth (Android tablet)" }] },
          { key: "address", label: "IP address / Windows printer name", type: "text" },
          { key: "port", label: "Port", type: "number", show: (d) => d.connection === "network" },
          { key: "paperWidthMm", label: "Paper width (mm)", type: "select", options: [{ value: "80", label: "80 mm" }, { value: "58", label: "58 mm" }] },
          { key: "agentId", label: "Print Agent id", type: "text" },
          { key: "backupPrinterId", label: "Backup printer", type: "select", optionsFrom: { col: C.printers } },
          { key: "active", label: "Active", type: "bool" },
        ]}
        beforeSave={(d) => ({ ...d, paperWidthMm: Number(d.paperWidthMm) === 58 ? 58 : 80, port: Number(d.port) || 9100 })}
        rowActions={(d) => <PrinterTest printer={d as unknown as Printer} />}
        columns={[
          { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
          { header: "Name", render: (d) => d.name },
          { header: "Prints", render: (d) => <span className="badge">{d.role}</span> },
          { header: "Model", render: (d) => d.model },
          { header: "Connection", render: (d) => `${d.connection} ${d.address}${d.connection === "network" ? `:${d.port}` : ""}` },
          { header: "Status", render: (d) => active(d.active) },
        ]}
      />
    </>
  );
}

// ───────────────────────────── Inventory masters ─────────────────────────────

export function StockItemsPage() {
  const { on } = useApp();
  const vendors = useNames(C.vendors);
  if (!on("inventory") && !on("recipes")) return <ModuleOff name="Inventory" />;
  return (
    <CrudPage
      title="Stock items"
      subtitle="Ingredients and goods. Recipes use the stock unit; purchasing uses the purchase unit."
      col={C.inventoryItems}
      idFrom="code"
      noun="stock item"
      search={(d) => `${d.code} ${d.name} ${d.category}`}
      newDoc={() => ({ code: "", name: "", category: "General", majorGroup: "Food", stockUnit: "g", purchaseUnit: "kg", purchaseFactor: 1000, purchaseCost: 0, parLevel: 0, reorderQty: 0, isPrep: false, trackStock: true, active: true })}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "category", label: "Category", type: "text" },
        { key: "majorGroup", label: "Major group (for cost of sales)", type: "select", options: MAJOR_GROUPS },
        { key: "stockUnit", label: "Stock unit", type: "select", options: [{ value: "g", label: "grams (g)" }, { value: "ml", label: "millilitres (ml)" }, { value: "pcs", label: "pieces (pcs)" }] },
        { key: "purchaseUnit", label: "Purchase unit", type: "text", placeholder: "kg, tray 30, bottle 750 ml" },
        { key: "purchaseFactor", label: "Stock units per purchase unit", type: "number", help: "kg → 1000 g; tray of 30 eggs → 30 pcs" },
        { key: "purchaseCost", label: "Cost per purchase unit", type: "money", help: "Updated automatically from goods receipts." },
        { key: "vendorId", label: "Main vendor", type: "select", optionsFrom: { col: C.vendors } },
        { key: "parLevel", label: "Par level (purchase units)", type: "number" },
        { key: "reorderQty", label: "Reorder quantity (purchase units)", type: "number" },
        { key: "isPrep", label: "Prep item (made in-house from a sub-recipe)", type: "bool" },
        { key: "trackStock", label: "Track stock (off for prep items consumed via their ingredients)", type: "bool" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.code}</span> },
        { header: "Name", render: (d) => <span>{d.name} {d.isPrep ? <span className="badge info">Prep</span> : null}</span> },
        { header: "Category", render: (d) => d.category },
        { header: "Purchase", render: (d) => `${d.purchaseUnit} = ${stockQty(d.purchaseFactor, d.stockUnit)}` },
        { header: "Cost", render: (d) => (d.isPrep ? <span className="muted">from recipe</span> : `${money(d.purchaseCost)} / ${d.purchaseUnit}`), num: true },
        { header: "Vendor", render: (d) => vendors.get(d.vendorId) ?? "—" },
      ]}
    />
  );
}

export function VendorsPage() {
  return (
    <CrudPage
      title="Vendors"
      col={C.vendors}
      idFrom="code"
      noun="vendor"
      newDoc={() => ({ code: "", name: "", phone: "", paymentTermsDays: 30, active: true })}
      fields={[
        { key: "code", label: "Code", type: "text", required: true, readOnlyOnEdit: true },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "contactName", label: "Contact person", type: "text" },
        { key: "phone", label: "Phone / WhatsApp", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "address", label: "Address", type: "textarea" },
        { key: "vatNumber", label: "VAT number", type: "text" },
        { key: "paymentTermsDays", label: "Payment terms (days)", type: "number" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Code", render: (d) => <span className="mono">{d.id}</span> },
        { header: "Name", render: (d) => d.name },
        { header: "Contact", render: (d) => `${d.contactName ?? ""} ${d.phone ?? ""}` },
        { header: "Terms", render: (d) => (d.paymentTermsDays ? `${d.paymentTermsDays} days` : "COD") },
      ]}
    />
  );
}

// ───────────────────────────── CRM & finance masters ─────────────────────────────

export function CustomersPage() {
  const { on } = useApp();
  if (!on("crm")) return <ModuleOff name="Customers (CRM)" />;
  return (
    <CrudPage
      title="Customers"
      subtitle="Guests and business buyers. Visits, spend and points update automatically when a check with the customer is closed."
      col={C.customers}
      idFrom="auto"
      noun="customer"
      search={(d) => `${d.name} ${d.phone} ${d.email ?? ""} ${(d.tags ?? []).join(" ")}`}
      sort={(a, b) => (b.totalSpend ?? 0) - (a.totalSpend ?? 0)}
      newDoc={() => ({ name: "", phone: "", tags: [], marketingConsent: false, visits: 0, totalSpend: 0, points: 0, createdAt: new Date().toISOString() })}
      fields={[
        { key: "name", label: "Name", type: "text", required: true },
        { key: "phone", label: "Mobile", type: "text", required: true },
        { key: "email", label: "Email", type: "text" },
        { key: "birthday", label: "Birthday", type: "date" },
        { key: "tags", label: "Tags", type: "tags" },
        { key: "marketingConsent", label: "Agreed to WhatsApp/email offers", type: "bool" },
        { key: "vatTin", label: "VAT TIN (business buyer)", type: "text", help: "Printed on tax invoices when the customer is VAT-registered." },
        { key: "address", label: "Address", type: "textarea" },
        { key: "notes", label: "Notes (preferences, allergies)", type: "textarea" },
      ]}
      columns={[
        { header: "Name", render: (d) => <div><div>{d.name}</div><div className="tiny muted">{(d.tags ?? []).join(" · ")}</div></div> },
        { header: "Mobile", render: (d) => d.phone },
        { header: "Visits", render: (d) => d.visits ?? 0, num: true },
        { header: "Spend", render: (d) => money(d.totalSpend), num: true },
        { header: "Points", render: (d) => d.points ?? 0, num: true },
        { header: "Last visit", render: (d) => (d.lastVisit ? d.lastVisit.slice(0, 10) : "—") },
      ]}
    />
  );
}

// ───────────────────────────── People ─────────────────────────────


export type { InventoryItem, MenuCategory };
