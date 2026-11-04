import { useMemo, useState } from "react";
import {
  type GoodsReceipt,
  type InventoryItem,
  type Location,
  type PurchaseOrder,
  type StockCount,
  type StockLevel,
  type StockMovement,
  type Vendor,
  COLLECTIONS as C,
  newId,
  postGoodsReceipt,
  postStockCount,
  processDepletion,
  produceBatch,
  receiptValue,
  recordWaste,
  reorderSuggestions,
  transferStock,
} from "@pos/core";
import { tablesToWorkbook } from "@pos/excel";
import { CrudPage, type FieldDef } from "../../components/CrudPage";
import { Empty, Field, Loading, Modal, ModuleOff, PageHead, Seg } from "../../components/ui";
import { downloadBuffer, money, stockQty, todayColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

function useDefaultLocation(): string {
  const locs = useCollection<Location>(C.locations) ?? [];
  return locs.find((l) => l.isDefault)?.id ?? locs[0]?.id ?? "MAIN";
}

export function StockOnHand() {
  const { on, toast, user } = useApp();
  const store = useStore();
  const items = useCollection<InventoryItem>(C.inventoryItems);
  const levels = useCollection<StockLevel>(C.stockLevels);
  const locations = useCollection<Location>(C.locations) ?? [];
  const pending = useCollection<{ id: string }>(C.checks, { where: [["depletion", "==", "pending"]] }) ?? [];
  const defaultLoc = useDefaultLocation();
  const [loc, setLoc] = useState<string>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  if (!on("inventory")) return <ModuleOff name="Inventory" />;
  if (!items || !levels) return <div className="page"><Loading /></div>;

  const filtered = levels.filter((l) => loc === "all" || l.locationId === loc);
  const byItem = new Map<string, { qty: number; value: number }>();
  for (const l of filtered) {
    const cur = byItem.get(l.itemId) ?? { qty: 0, value: 0 };
    byItem.set(l.itemId, { qty: cur.qty + l.qty, value: cur.value + l.value });
  }
  const rows = items
    .filter((i) => i.trackStock && `${i.code} ${i.name} ${i.category}`.toLowerCase().includes(q.toLowerCase()))
    .map((i) => ({ item: i, ...(byItem.get(i.id) ?? { qty: 0, value: 0 }) }))
    .sort((a, b) => a.item.category.localeCompare(b.item.category) || a.item.name.localeCompare(b.item.name));
  const total = rows.reduce((a, r) => a + r.value, 0);
  const below = new Set(reorderSuggestions(items, filtered).map((s) => s.item.id));

  async function deplete() {
    setBusy(true);
    try {
      const r = await processDepletion(store, { locationId: defaultLoc, by: user?.email ?? "user" });
      toast(r.checks ? `Deducted stock for ${r.checks} check(s)` : "No sales waiting for stock deduction");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function exportValuation() {
    const buf = await tablesToWorkbook([
      {
        name: "Stock valuation",
        title: `Stock valuation (FIFO) ${todayColombo()}`,
        totals: true,
        rows,
        columns: [
          { header: "Code", value: (r) => r.item.code },
          { header: "Item", value: (r) => r.item.name, width: 32 },
          { header: "Category", value: (r) => r.item.category, width: 18 },
          { header: "On hand", value: (r) => Math.round(r.qty * 1000) / 1000, format: "number" },
          { header: "Unit", value: (r) => r.item.stockUnit },
          { header: "Value (FIFO)", value: (r) => r.value, format: "money", width: 14 },
        ],
      },
    ]);
    downloadBuffer(buf, `stock-valuation-${todayColombo()}.xlsx`);
  }

  return (
    <div className="page fill">
      <PageHead
        title="Stock on hand"
        subtitle="Quantities and FIFO value per item. Sales deduct stock through recipes; deduction runs in batches to keep cloud usage low."
        actions={
          <>
            <button className="btn" onClick={exportValuation}>Export valuation</button>
            <button className="btn primary" disabled={busy} onClick={deplete}>
              {busy ? "Deducting…" : `Deduct sold stock${pending.length ? ` (${pending.length} checks)` : ""}`}
            </button>
          </>
        }
      />
      <div className="row wrap between">
        <Seg value={loc} onChange={setLoc} options={[{ value: "all", label: "All locations" }, ...locations.map((l) => ({ value: l.id, label: l.name }))]} />
        <div className="row">
          <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
          <span className="badge brand">Value {money(total)}</span>
        </div>
      </div>
      <div className="card table-wrap fill-card">
        <table className="table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Item</th>
              <th>Category</th>
              <th className="num">On hand</th>
              <th className="num">Par</th>
              <th className="num">Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.item.id}>
                <td className="mono">{r.item.code}</td>
                <td>{r.item.name}</td>
                <td className="muted">{r.item.category}</td>
                <td className="num">{stockQty(r.qty, r.item.stockUnit)}</td>
                <td className="num muted">{r.item.parLevel ? `${r.item.parLevel} ${r.item.purchaseUnit}` : "—"}</td>
                <td className="num">{money(r.value)}</td>
                <td>{r.qty < 0 ? <span className="badge bad">Negative</span> : below.has(r.item.id) ? <span className="badge warn">Below par</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const lineFields = (costLabel: string): FieldDef[] => [
  { key: "inventoryItemId", label: "Item", type: "select", optionsFrom: { col: C.inventoryItems, filter: (i) => !i.isPrep, label: (i) => `${i.name} (${i.purchaseUnit})` } },
  { key: "qty", label: "Qty (purchase units)", type: "number" },
  { key: "unitCost", label: costLabel, type: "money" },
];

export function PurchaseOrdersPage() {
  const { on, toast } = useApp();
  const store = useStore();
  const vendors = new Map((useCollection<Vendor>(C.vendors) ?? []).map((v) => [v.id, v.name]));
  const items = useCollection<InventoryItem>(C.inventoryItems) ?? [];
  const levels = useCollection<StockLevel>(C.stockLevels) ?? [];
  const pos = useCollection<PurchaseOrder>(C.purchaseOrders) ?? [];
  const defaultLoc = useDefaultLocation();
  if (!on("purchasing")) return <ModuleOff name="Purchasing" />;

  async function suggest() {
    const sugg = reorderSuggestions(items, levels);
    if (!sugg.length) return toast("Nothing is below par level");
    const byVendor = new Map<string, typeof sugg>();
    for (const s of sugg) byVendor.set(s.item.vendorId ?? "", [...(byVendor.get(s.item.vendorId ?? "") ?? []), s]);
    let n = pos.length;
    for (const [vendorId, list] of byVendor) {
      n++;
      const po: PurchaseOrder = {
        id: `PO-${String(n).padStart(4, "0")}`,
        number: `PO-${String(n).padStart(4, "0")}`,
        vendorId,
        locationId: defaultLoc,
        status: "draft",
        orderDate: todayColombo(),
        lines: list.map((s) => ({ inventoryItemId: s.item.id, qty: s.suggestQty, unitCost: s.item.purchaseCost })),
        notes: "Suggested from par levels",
      };
      await store.set(C.purchaseOrders, po);
    }
    toast(`Created ${byVendor.size} draft purchase order(s)`);
  }

  async function receive(po: PurchaseOrder) {
    const grn: GoodsReceipt = {
      id: `GRN-${po.number.replace(/^PO-/, "")}-${newId().slice(-4)}`,
      number: `GRN-${po.number.replace(/^PO-/, "")}`,
      vendorId: po.vendorId,
      locationId: po.locationId,
      purchaseOrderId: po.id,
      date: todayColombo(),
      lines: po.lines,
      inputVat: 0,
      status: "draft",
    };
    await store.set(C.goodsReceipts, grn);
    toast(`Draft ${grn.number} created; check quantities and prices, then post it under Goods receipts`);
  }

  return (
    <CrudPage
      title="Purchase orders"
      subtitle="Order from vendors. Approve, then turn a purchase order into a goods receipt when the delivery arrives."
      col={C.purchaseOrders}
      idFrom="code"
      codeKey="number"
      noun="purchase order"
      sort={(a, b) => String(b.number).localeCompare(String(a.number))}
      newDoc={() => ({ number: `PO-${String(pos.length + 1).padStart(4, "0")}`, vendorId: "", locationId: defaultLoc, status: "draft", orderDate: todayColombo(), lines: [] })}
      headerActions={<button className="btn" onClick={suggest}>Suggest from par levels</button>}
      fields={[
        { key: "number", label: "PO number", type: "text", required: true, readOnlyOnEdit: true },
        { key: "vendorId", label: "Vendor", type: "select", optionsFrom: { col: C.vendors }, required: true },
        { key: "locationId", label: "Deliver to", type: "select", optionsFrom: { col: C.locations } },
        { key: "status", label: "Status", type: "select", options: ["draft", "approved", "sent", "received", "cancelled"].map((v) => ({ value: v, label: v })) },
        { key: "orderDate", label: "Order date", type: "date" },
        { key: "expectedDate", label: "Expected delivery", type: "date" },
        { key: "lines", label: "Items", type: "lines", fields: lineFields("Price per unit"), newRow: () => ({ inventoryItemId: "", qty: 1, unitCost: 0 }) },
        { key: "notes", label: "Notes", type: "textarea" },
      ]}
      rowActions={(d) => (d.status === "approved" || d.status === "sent" ? <button className="btn sm" onClick={() => receive(d as unknown as PurchaseOrder)}>Receive</button> : null)}
      columns={[
        { header: "PO", render: (d) => <span className="mono">{d.number}</span> },
        { header: "Vendor", render: (d) => vendors.get(d.vendorId) ?? "—" },
        { header: "Date", render: (d) => d.orderDate },
        { header: "Lines", render: (d) => (d.lines ?? []).length, num: true },
        { header: "Value", render: (d) => money(receiptValue(d as unknown as GoodsReceipt)), num: true },
        { header: "Status", render: (d) => <span className={`badge ${d.status === "received" ? "good" : d.status === "approved" ? "info" : d.status === "cancelled" ? "bad" : ""}`}>{d.status}</span> },
      ]}
    />
  );
}

export function GoodsReceiptsPage() {
  const { on, toast, user } = useApp();
  const store = useStore();
  const vendors = new Map((useCollection<Vendor>(C.vendors) ?? []).map((v) => [v.id, v.name]));
  const grns = useCollection<GoodsReceipt>(C.goodsReceipts) ?? [];
  const defaultLoc = useDefaultLocation();
  if (!on("purchasing")) return <ModuleOff name="Purchasing" />;
  return (
    <CrudPage
      title="Goods receipts (GRN)"
      subtitle="Record deliveries. Posting adds FIFO stock lots at the received cost and updates the latest purchase price."
      col={C.goodsReceipts}
      idFrom="code"
      codeKey="number"
      noun="goods receipt"
      canEdit={(d) => d.status !== "posted"}
      canDelete={(d) => d.status !== "posted"}
      sort={(a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number))}
      newDoc={() => ({ number: `GRN-${String(grns.length + 1).padStart(4, "0")}`, vendorId: "", locationId: defaultLoc, date: todayColombo(), lines: [], inputVat: 0, status: "draft" })}
      fields={[
        { key: "number", label: "GRN number", type: "text", required: true, readOnlyOnEdit: true },
        { key: "vendorId", label: "Vendor", type: "select", optionsFrom: { col: C.vendors }, required: true },
        { key: "supplierInvoiceNo", label: "Supplier invoice no.", type: "text" },
        { key: "locationId", label: "Received into", type: "select", optionsFrom: { col: C.locations } },
        { key: "date", label: "Date", type: "date" },
        { key: "lines", label: "Items received", type: "lines", fields: lineFields("Cost per unit (excl. VAT)"), newRow: () => ({ inventoryItemId: "", qty: 1, unitCost: 0 }) },
        { key: "inputVat", label: "Input VAT on invoice", type: "money" },
      ]}
      rowActions={(d) =>
        d.status === "posted" ? (
          <span className="badge good">Posted</span>
        ) : (
          <button
            className="btn sm primary"
            onClick={async () => {
              try {
                await postGoodsReceipt(store, d.id, user?.email ?? "user");
                toast(`${d.number} posted to stock`);
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Post to stock
          </button>
        )
      }
      columns={[
        { header: "GRN", render: (d) => <span className="mono">{d.number}</span> },
        { header: "Vendor", render: (d) => vendors.get(d.vendorId) ?? "—" },
        { header: "Date", render: (d) => d.date },
        { header: "Invoice", render: (d) => d.supplierInvoiceNo ?? "" },
        { header: "Value", render: (d) => money(receiptValue(d as unknown as GoodsReceipt)), num: true },
        { header: "Input VAT", render: (d) => money(d.inputVat), num: true },
      ]}
    />
  );
}

export function StockCountsPage() {
  const { on, toast } = useApp();
  const store = useStore();
  const counts = useCollection<StockCount>(C.stockCounts);
  const items = useCollection<InventoryItem>(C.inventoryItems) ?? [];
  const levels = useCollection<StockLevel>(C.stockLevels) ?? [];
  const locations = useCollection<Location>(C.locations) ?? [];
  const defaultLoc = useDefaultLocation();
  const [open, setOpen] = useState<StockCount | null>(null);
  const [blind, setBlind] = useState(true);
  if (!on("inventory")) return <ModuleOff name="Inventory" />;
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const levelOf = (loc: string, id: string) => levels.find((l) => l.locationId === loc && l.itemId === id)?.qty ?? 0;

  async function start() {
    const c: StockCount = {
      id: `CNT-${todayColombo()}-${newId().slice(-4)}`,
      locationId: defaultLoc,
      date: todayColombo(),
      status: "draft",
      lines: items.filter((i) => i.trackStock && i.active).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)).map((i) => ({ itemId: i.id, counted: Math.max(0, Math.round(levelOf(defaultLoc, i.id))) })),
    };
    await store.set(C.stockCounts, c);
    setOpen(c);
  }

  return (
    <div className="page">
      <PageHead title="Stock counts" subtitle="Count what is on the shelves. Posting a count adjusts stock: losses at FIFO cost, gains at standard cost." actions={<button className="btn primary" onClick={start}>Start a count</button>} />
      <div className="card table-wrap">
        {!counts ? <Loading /> : counts.length === 0 ? <Empty title="No counts yet" /> : (
          <table className="table">
            <thead><tr><th>Count</th><th>Location</th><th>Date</th><th className="num">Items</th><th>Status</th></tr></thead>
            <tbody>
              {counts.sort((a, b) => b.date.localeCompare(a.date)).map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setOpen(c)}>
                  <td className="mono">{c.id}</td>
                  <td>{locations.find((l) => l.id === c.locationId)?.name ?? c.locationId}</td>
                  <td>{c.date}</td>
                  <td className="num">{c.lines.length}</td>
                  <td><span className={`badge ${c.status === "posted" ? "good" : "warn"}`}>{c.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? (
        <Modal
          wide
          title={`Count ${open.date} · ${locations.find((l) => l.id === open.locationId)?.name ?? ""}`}
          onClose={() => setOpen(null)}
          footer={
            open.status === "draft" ? (
              <>
                <label className="check small"><input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind count (hide system quantities)</label>
                <span className="grow" />
                <button className="btn" onClick={async () => { await store.set(C.stockCounts, open); toast("Count saved"); }}>Save</button>
                <button className="btn primary" onClick={async () => { await store.set(C.stockCounts, open); const m = await postStockCount(store, open.id); toast(m ? `Posted with ${m.lines.length} adjustment(s)` : "Posted: no differences"); setOpen(null); }}>Post count</button>
              </>
            ) : undefined
          }
        >
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Item</th>{!blind || open.status === "posted" ? <th className="num">System</th> : null}<th className="num">Counted</th><th>Unit</th></tr></thead>
              <tbody>
                {open.lines.map((l, i) => {
                  const it = itemMap.get(l.itemId);
                  return (
                    <tr key={l.itemId}>
                      <td>{it?.name ?? l.itemId}</td>
                      {!blind || open.status === "posted" ? <td className="num muted">{stockQty(l.expected ?? levelOf(open.locationId, l.itemId), it?.stockUnit ?? "")}</td> : null}
                      <td className="num" style={{ width: 140 }}>
                        <input className="input num" type="number" min={0} step="any" disabled={open.status === "posted"} value={l.counted} onChange={(e) => setOpen({ ...open, lines: open.lines.map((x, j) => (j === i ? { ...x, counted: Number(e.target.value) } : x)) })} />
                      </td>
                      <td className="muted">{it?.stockUnit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function AdjustPage() {
  const { on, toast } = useApp();
  const store = useStore();
  const items = useCollection<InventoryItem>(C.inventoryItems) ?? [];
  const locations = useCollection<Location>(C.locations) ?? [];
  const reasons = (useCollection<{ id: string; type: string; name: string }>(C.reasonCodes) ?? []).filter((r) => r.type === "waste");
  const defaultLoc = useDefaultLocation();
  const [mode, setMode] = useState<"waste" | "transfer" | "production">("waste");
  const [itemId, setItemId] = useState("");
  const [qtyText, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  if (!on("inventory")) return <ModuleOff name="Inventory" />;
  const item = items.find((i) => i.id === itemId);
  const qtyN = Number(qtyText);
  const list = mode === "production" ? items.filter((i) => i.isPrep) : items.filter((i) => i.trackStock);

  async function submit() {
    if (!item || !(qtyN > 0)) return toast("Choose an item and a quantity", true);
    try {
      if (mode === "waste") await recordWaste(store, { locationId: from || defaultLoc, lines: [{ itemId, qty: qtyN }], reason: reasons.find((r) => r.id === reason)?.name ?? "Waste", businessDate: todayColombo() });
      else if (mode === "transfer") {
        if (!from || !to || from === to) return toast("Choose two different locations", true);
        await transferStock(store, { from, to, lines: [{ itemId, qty: qtyN }], businessDate: todayColombo() });
      } else await produceBatch(store, { locationId: from || defaultLoc, prepItemId: itemId, qty: qtyN, businessDate: todayColombo() });
      toast(mode === "waste" ? "Waste recorded" : mode === "transfer" ? "Transfer posted" : "Batch produced");
      setQty("");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <div className="page">
      <PageHead title="Waste, transfers & production" subtitle="Record spoilage with a reason, move stock between stores, or cook a batch of a prep item (consumes its ingredients at FIFO cost)." />
      <Seg value={mode} onChange={(m) => { setMode(m); setItemId(""); }} options={[{ value: "waste", label: "Waste" }, { value: "transfer", label: "Transfer" }, { value: "production", label: "Production (prep batch)" }]} />
      <div className="card card-body stack" style={{ maxWidth: 640 }}>
        <Field label="Item">
          <select className="select" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Choose…</option>
            {list.sort((a, b) => a.name.localeCompare(b.name)).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.stockUnit})</option>)}
          </select>
        </Field>
        <Field label={`Quantity${item ? ` in ${item.stockUnit}` : ""}`}>
          <input className="input num" type="number" min={0} step="any" value={qtyText} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label={mode === "transfer" ? "From" : "Location"}>
          <select className="select" value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{mode === "transfer" ? "Choose…" : "Default location"}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
        {mode === "transfer" ? (
          <Field label="To">
            <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        ) : null}
        {mode === "waste" ? (
          <Field label="Reason">
            <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose…</option>
              {reasons.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        ) : null}
        <div><button className="btn primary" onClick={submit}>{mode === "waste" ? "Record waste" : mode === "transfer" ? "Transfer stock" : "Produce batch"}</button></div>
      </div>
    </div>
  );
}

export function MovementsPage() {
  const { on } = useApp();
  const movements = useCollection<StockMovement>(C.stockMovements, { orderBy: ["at", "desc"], limit: 200 });
  const items = useCollection<InventoryItem>(C.inventoryItems) ?? [];
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);
  const [open, setOpen] = useState<StockMovement | null>(null);
  if (!on("inventory")) return <ModuleOff name="Inventory" />;
  const label: Record<string, string> = { receive: "Receipt", sale: "Sales (recipes)", waste: "Waste", adjust: "Count adjustment", transferIn: "Transfer in", transferOut: "Transfer out", production: "Production", consumption: "Used in production" };
  return (
    <div className="page">
      <PageHead title="Stock movements" subtitle="Every change to stock with its FIFO cost: the audit trail behind stock value and cost of sales." />
      <div className="card table-wrap">
        {!movements ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th className="num">Lines</th><th className="num">Value</th></tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id} className="clickable" onClick={() => setOpen(m)}>
                  <td>{m.businessDate}</td>
                  <td><span className="badge">{label[m.type] ?? m.type}</span> {m.shortages?.length ? <span className="badge bad">{m.shortages.length} short</span> : null}</td>
                  <td>{m.ref}{m.reason ? ` · ${m.reason}` : ""}</td>
                  <td className="num">{m.lines.length}</td>
                  <td className="num">{money(m.lines.reduce((a, l) => a + l.cost, 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? (
        <Modal title={`${label[open.type] ?? open.type} · ${open.businessDate}`} onClose={() => setOpen(null)} wide>
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Cost</th></tr></thead>
            <tbody>
              {open.lines.map((l) => {
                const it = items.find((i) => i.id === l.itemId);
                return <tr key={l.itemId}><td>{names.get(l.itemId) ?? l.itemId}</td><td className="num">{stockQty(l.qty, it?.stockUnit ?? "")}</td><td className="num">{money(l.cost)}</td></tr>;
              })}
            </tbody>
          </table>
        </Modal>
      ) : null}
    </div>
  );
}
