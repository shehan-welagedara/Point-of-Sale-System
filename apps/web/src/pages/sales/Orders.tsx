import { useState } from "react";
import {
  type Courier,
  type Customer,
  type OrderMessageKind,
  type OrderPayment,
  type PaymentMethod,
  type PrintSpec,
  type SalesLine,
  type SalesOrder,
  type Style,
  WHOLESALE,
  COLLECTIONS as C,
  creditCheck,
  issueStock,
  newId,
  nextDocNumber,
  orderTotals,
  paymentState,
  priceLines,
  printPrice,
  variantSku,
} from "@pos/core";
import { ConfirmButton, Empty, Field, Loading, Modal, ModuleOff, PageHead, Seg, Stat, Toggle } from "../../components/ui";
import { dateColombo, dateTimeColombo, money, toCents, todayColombo } from "../../lib/format";
import { useWhatsApp } from "../../lib/whatsapp";
import { useApp, useCollection, useStore } from "../../state/app";
import { PAY_LABEL, PayBadge, SIDES, StatusBadge, addDays, owingFor, useDefaultLocation, usePropertyId, useSalesData } from "./shared";

type Tab = "todo" | "quotes" | "road" | "done" | "all";

export function SalesOrdersPage() {
  const { on } = useApp();
  const data = useSalesData();
  const [tab, setTab] = useState<Tab>("todo");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<SalesOrder | "quotation" | "order" | null>(null);
  if (!on("wholesale")) return <ModuleOff name="Sales & Orders" />;
  if (!data.ready) return <div className="page"><Loading /></div>;

  const inTab = (o: SalesOrder) =>
    tab === "all" ? true : tab === "todo" ? ["draft", "confirmed", "packed"].includes(o.status) : tab === "quotes" ? o.status === "quotation" : tab === "road" ? o.status === "dispatched" : o.status === "delivered";
  const needle = q.trim().toLowerCase();
  const rows = data.orders
    .filter(inTab)
    .filter((o) => !needle || `${o.number} ${o.quotationNo ?? ""} ${o.customerName} ${o.invoiceNo ?? ""} ${o.delivery?.trackingNo ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = data.orders.filter((o) => o.status !== "cancelled" && o.status !== "quotation");
  const toPack = live.filter((o) => o.status === "confirmed").reduce((a, o) => a + o.lines.reduce((x, l) => x + l.qty, 0), 0);
  const fresh = live.filter((o) => o.status === "draft").length;
  const owed = live.filter((o) => o.status === "dispatched" || o.status === "delivered").reduce((a, o) => a + Math.max(0, o.total - o.paid), 0);
  const cod = live.filter((o) => o.status === "dispatched" && o.delivery?.cod).reduce((a, o) => a + (o.delivery?.codAmount ?? 0), 0);
  const current = open ? data.orders.find((o) => o.id === open) : undefined;

  return (
    <div className="page">
      <PageHead
        title="Orders"
        subtitle="Quotations, orders from WhatsApp, phone and reps, packing, dispatch and payments. Dispatching takes the goods out of stock and invoices the customer; confirmed payments go to the books."
        actions={
          <>
            <button className="btn" onClick={() => setEditing("quotation")}>New quotation</button>
            <button className="btn primary" onClick={() => setEditing("order")}>New order</button>
          </>
        }
      />
      <div className="stats">
        <Stat label="New orders to check" value={fresh} tone={fresh ? "warn" : undefined} sub={fresh ? "from WhatsApp and reps" : "none waiting"} />
        <Stat label="Pieces to pack" value={toPack.toLocaleString("en-US")} />
        <Stat label="Cash with couriers" value={money(cod)} sub="cash on delivery not settled" />
        <Stat label="Owed by customers" value={money(owed)} />
      </div>
      <div className="row wrap" style={{ margin: "12px 0" }}>
        <Seg<Tab> value={tab} onChange={setTab} options={[{ value: "todo", label: "To do" }, { value: "quotes", label: "Quotations" }, { value: "road", label: "On the way" }, { value: "done", label: "Delivered" }, { value: "all", label: "All" }]} />
        <input className="input grow" placeholder="Search number, customer, invoice, tracking" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
      </div>
      <div className="card">
        {rows.length === 0 ? (
          <Empty title="Nothing here">{tab === "todo" ? <p>New orders from WhatsApp appear here for you to check and confirm.</p> : null}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th className="num">Pieces</th><th className="num">Total</th><th>Status</th><th>Payment</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => setOpen(o.id)} data-testid={`order-${o.number}`}>
                    <td><div className="mono">{o.number}</div><div className="tiny muted">{o.channel === "whatsapp" ? "💬 WhatsApp" : o.channel}</div></td>
                    <td>{o.customerName}</td>
                    <td>{dateColombo(o.date)}</td>
                    <td className="num">{o.lines.reduce((a, l) => a + l.qty, 0)}</td>
                    <td className="num">{money(o.total)}</td>
                    <td><StatusBadge status={o.status} /></td>
                    <td><PayBadge o={o} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {current ? <OrderDetail order={current} data={data} onClose={() => setOpen(null)} onEdit={() => { setEditing(current); setOpen(null); }} /> : null}
      {editing ? <OrderEditor initial={typeof editing === "string" ? null : editing} kind={typeof editing === "string" ? editing : editing.status === "quotation" ? "quotation" : "order"} data={data} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); setOpen(id); }} /> : null}
    </div>
  );
}

// ───────────────────────────── Order editor ─────────────────────────────

type Data = ReturnType<typeof useSalesData>;

function OrderEditor({ initial, kind, data, onClose, onSaved }: { initial: SalesOrder | null; kind: "quotation" | "order"; data: Data; onClose: () => void; onSaved: (id: string) => void }) {
  const { toast, settings, user, role } = useApp();
  const store = useStore();
  const couriers = (useCollection<Courier>(WHOLESALE.couriers) ?? []).filter((c) => c.active);
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [newCustomer, setNewCustomer] = useState<{ name: string; shopName: string; phone: string; area: string } | null>(null);
  const [lines, setLines] = useState<Omit<SalesLine, "unit" | "amount">[]>(initial?.lines ?? []);
  const [styleId, setStyleId] = useState("");
  const [grid, setGrid] = useState<Record<string, number>>({});
  const [print, setPrint] = useState<PrintSpec | null>(initial?.print ?? null);
  const [discount, setDiscount] = useState(initial?.discount ?? 0);
  const [delivery, setDelivery] = useState<NonNullable<SalesOrder["delivery"]>>(initial?.delivery ?? { method: "courier", cod: true });
  const [deliveryCharge, setDeliveryCharge] = useState(initial?.deliveryCharge ?? 0);
  const [onCredit, setOnCredit] = useState(initial?.onCredit ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [validDays, setValidDays] = useState(14);
  const [busy, setBusy] = useState(false);

  const customer = data.customers.find((c) => c.id === customerId);
  const priceList = data.priceLists.find((p) => p.id === customer?.priceListId) ?? null;
  const styles = new Map(data.styles.map((s) => [s.id, s]));
  const priced = priceLines(lines, styles, priceList);
  const vatRateBp = settings.business.vatRegistered ? settings.tax.vatRate : 0;
  const totals = orderTotals({ lines: priced, ...(print ? { print } : {}), discount, deliveryCharge }, vatRateBp);
  const owing = customer ? owingFor(customer.id, data.orders, initial?.id) : 0;
  const credit = customer && onCredit ? creditCheck(customer, owing, totals.total) : null;
  const style = styles.get(styleId);
  const manager = role === "owner" || role === "admin" || role === "manager";

  function addGrid() {
    if (!style) return;
    const add = Object.entries(grid).filter(([, n]) => n > 0);
    if (!add.length) return toast("Enter quantities in the grid", true);
    const next = [...lines];
    for (const [key, qty] of add) {
      const [colour, size] = key.split("|") as [string, string];
      const sku = variantSku(style.code, colour, size);
      const hit = next.findIndex((l) => l.sku === sku);
      if (hit >= 0) next[hit] = { ...next[hit]!, qty: next[hit]!.qty + qty };
      else next.push({ id: newId(), styleId: style.id, styleCode: style.code, name: style.name, colour, size, sku, qty });
    }
    setLines(next);
    setGrid({});
    setStyleId("");
  }

  async function save(confirm: boolean) {
    if (busy) return;
    if (!customerId && !newCustomer?.name.trim()) return toast("Choose or add the customer", true);
    if (!lines.length) return toast("Add at least one style", true);
    setBusy(true);
    try {
      let cust = customer;
      if (!cust && newCustomer) {
        const phone = newCustomer.phone.replace(/[^\d+]/g, "");
        const wa = phone.replace(/^\+/, "").replace(/^0(\d{9})$/, "94$1");
        cust = { id: newId(), name: newCustomer.name.trim(), phone: phone || "-", ...(newCustomer.shopName ? { shopName: newCustomer.shopName } : {}), ...(newCustomer.area ? { area: newCustomer.area } : {}), ...(/^\d{10,15}$/.test(wa) ? { whatsapp: wa } : {}), tags: ["wholesale"], marketingConsent: false, visits: 0, totalSpend: 0, points: 0, createdAt: new Date().toISOString() };
        await store.set(C.customers, cust);
      }
      const now = new Date().toISOString();
      const by = user?.name ?? "staff";
      const quoting = kind === "quotation" && !confirm;
      // Over the credit limit: a manager confirms; others save it for a manager.
      const blocked = confirm && onCredit && cust && !creditCheck(cust, owingFor(cust.id, data.orders, initial?.id), totals.total).allowed && !manager;
      const status: SalesOrder["status"] = quoting ? "quotation" : confirm && !blocked ? "confirmed" : "draft";
      let number = initial?.number ?? "";
      let quotationNo = initial?.quotationNo;
      if (!initial) number = await nextDocNumber(store, quoting ? "QT" : "SO");
      if (initial?.status === "quotation" && !quoting) {
        quotationNo = initial.number;
        number = await nextDocNumber(store, "SO");
      }
      const base: SalesOrder = {
        ...(initial ?? { id: newId(), createdBy: by, createdAt: now, history: [], payments: [], paid: 0, paymentStatus: "unpaid" as const, channel: "phone" as const, date: todayColombo() }),
        number,
        ...(quotationNo ? { quotationNo } : {}),
        status,
        customerId: cust!.id,
        customerName: cust!.shopName ? `${cust!.shopName} (${cust!.name})` : cust!.name,
        lines: priced,
        ...(print ? { print } : {}),
        discount,
        deliveryCharge,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        delivery: { ...delivery, ...(delivery.cod ? { codAmount: totals.total } : {}) },
        onCredit,
        ...(onCredit && confirm && manager && credit && !credit.allowed ? { creditApprovedBy: by } : {}),
        ...(quoting ? { validUntil: addDays(todayColombo(), validDays) } : {}),
        ...(notes ? { notes } : {}),
        updatedAt: now,
      } as SalesOrder;
      if (!print) delete (base as Partial<SalesOrder>).print;
      const order: SalesOrder = { ...base, ...paymentState(base.total, base.payments), history: [...base.history, { at: now, by, status, note: initial ? "edited" : "created" }] };
      await store.set(WHOLESALE.salesOrders, order);
      toast(blocked ? `${order.number} saved: over the credit limit, a manager must confirm it` : `${order.number} saved`, Boolean(blocked));
      onSaved(order.id);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      wide
      title={initial ? `Edit ${initial.number}` : kind === "quotation" ? "New quotation" : "New order"}
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted">{totals.pieces} pcs · {money(totals.total)}</span>
          {kind === "quotation" ? <button className="btn" disabled={busy} onClick={() => save(false)}>Save quotation</button> : <button className="btn" disabled={busy} onClick={() => save(false)}>Save for later</button>}
          <button className="btn primary" disabled={busy} onClick={() => save(true)}>{kind === "quotation" ? "Save as order" : "Confirm order"}</button>
        </>
      }
    >
      <div className="grid cols-2">
        <Field label="Customer">
          {newCustomer ? (
            <div className="stack">
              <input className="input" placeholder="Contact name" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} aria-label="Contact name" />
              <input className="input" placeholder="Shop name" value={newCustomer.shopName} onChange={(e) => setNewCustomer({ ...newCustomer, shopName: e.target.value })} aria-label="Shop name" />
              <div className="row">
                <input className="input grow" placeholder="Mobile / WhatsApp" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} aria-label="Mobile" />
                <input className="input grow" placeholder="Area (e.g. Kandy)" value={newCustomer.area} onChange={(e) => setNewCustomer({ ...newCustomer, area: e.target.value })} aria-label="Area" />
              </div>
              <button className="btn ghost small" onClick={() => setNewCustomer(null)}>Choose an existing customer</button>
            </div>
          ) : (
            <div className="row">
              <select className="input grow" value={customerId} onChange={(e) => setCustomerId(e.target.value)} aria-label="Customer">
                <option value="">Choose…</option>
                {[...data.customers].sort((a, b) => (a.shopName ?? a.name).localeCompare(b.shopName ?? b.name)).map((c) => (
                  <option key={c.id} value={c.id}>{c.shopName ? `${c.shopName} – ${c.name}` : c.name}{c.area ? ` (${c.area})` : ""}</option>
                ))}
              </select>
              <button className="btn" onClick={() => { setCustomerId(""); setNewCustomer({ name: "", shopName: "", phone: "", area: "" }); }}>New</button>
            </div>
          )}
        </Field>
        <div className="stack small">
          {customer ? (
            <>
              <div>{customer.priceListId ? <span className="badge info">{priceList?.name ?? "Price list"}</span> : <span className="badge">List prices</span>} {customer.creditLimit ? <span className="badge">Credit {money(customer.creditLimit)} · {customer.paymentTermsDays ?? 30} days</span> : <span className="badge">Cash customer</span>}</div>
              {owing ? <div className="muted">Owes {money(owing)} on earlier orders</div> : null}
            </>
          ) : null}
        </div>
      </div>

      <div className="section-title">Styles</div>
      <div className="row wrap">
        <select className="input grow" value={styleId} onChange={(e) => { setStyleId(e.target.value); setGrid({}); }} aria-label="Add a style">
          <option value="">Add a style…</option>
          {data.styles.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
        </select>
      </div>
      {style ? <SizeGrid style={style} grid={grid} setGrid={setGrid} available={data.available} onAdd={addGrid} /> : null}
      {priced.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Style</th><th>Colour / size</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {priced.map((l) => (
                <tr key={l.id}>
                  <td>{l.name}<div className="tiny muted mono">{l.sku}</div></td>
                  <td>{l.colour} / {l.size}{(data.available.get(l.sku) ?? 0) < l.qty ? <div className="tiny bad-text">only {Math.max(0, data.available.get(l.sku) ?? 0)} free</div> : null}</td>
                  <td className="num"><input className="input num" style={{ width: 80 }} type="number" min={0} value={l.qty} aria-label={`Quantity ${l.sku}`} onChange={(e) => setLines(lines.map((x) => (x.id === l.id ? { ...x, qty: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)).filter((x) => x.qty > 0 || x.id === l.id))} /></td>
                  <td className="num">{money(l.unit)}</td>
                  <td className="num">{money(l.amount)}</td>
                  <td><button className="btn ghost icon-btn" aria-label={`Remove ${l.sku}`} onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="section-title row">
        <span className="grow">Custom printing</span>
        <Toggle on={Boolean(print)} label="Custom printing" onChange={(v) => setPrint(v ? { description: "", method: "screen", sides: ["Front"], colours: 1, status: "design", ...printPrice({ method: "screen", sides: ["Front"], colours: 1 }) } : null)} />
      </div>
      {print ? (
        <div className="grid cols-2">
          <Field label="Design"><input className="input" value={print.description} placeholder="e.g. Club logo, front left chest" onChange={(e) => setPrint({ ...print, description: e.target.value })} aria-label="Print design" /></Field>
          <Field label="Method">
            <select className="input" value={print.method} aria-label="Print method" onChange={(e) => { const method = e.target.value as PrintSpec["method"]; setPrint({ ...print, method, ...printPrice({ ...print, method }) }); }}>
              <option value="screen">Screen print</option><option value="dtf">DTF</option><option value="dtg">DTG</option><option value="sublimation">Sublimation</option><option value="embroidery">Embroidery</option>
            </select>
          </Field>
          <Field label="Sides">
            <div className="chips">
              {SIDES.map((s) => (
                <button key={s} type="button" className={`chip${print.sides.includes(s) ? " on" : ""}`} onClick={() => { const sides = print.sides.includes(s) ? print.sides.filter((x) => x !== s) : [...print.sides, s]; setPrint({ ...print, sides, ...printPrice({ ...print, sides }) }); }}>{s}</button>
              ))}
            </div>
          </Field>
          <Field label="Colours per side"><input className="input num" type="number" min={1} max={12} value={print.colours} aria-label="Print colours" onChange={(e) => { const colours = Math.max(1, Number(e.target.value) || 1); setPrint({ ...print, colours, ...printPrice({ ...print, colours }) }); }} /></Field>
          <Field label="Per piece (Rs)"><input className="input num" type="number" value={print.pricePerPiece / 100} aria-label="Print price per piece" onChange={(e) => setPrint({ ...print, pricePerPiece: toCents(e.target.value) })} /></Field>
          <Field label="Set-up (Rs)"><input className="input num" type="number" value={print.setupFee / 100} aria-label="Print set-up" onChange={(e) => setPrint({ ...print, setupFee: toCents(e.target.value) })} /></Field>
        </div>
      ) : null}

      <div className="section-title">Delivery and payment</div>
      <div className="grid cols-2">
        <Field label="Delivery">
          <select className="input" value={delivery.method} aria-label="Delivery method" onChange={(e) => setDelivery({ ...delivery, method: e.target.value as "courier" | "own" | "pickup", ...(e.target.value === "pickup" ? { cod: false } : {}) })}>
            <option value="courier">Courier</option><option value="own">Our vehicle</option><option value="pickup">Customer collects</option>
          </select>
        </Field>
        {delivery.method === "courier" ? (
          <Field label="Courier">
            <select className="input" value={delivery.courierId ?? ""} aria-label="Courier" onChange={(e) => setDelivery({ ...delivery, ...(e.target.value ? { courierId: e.target.value } : {}) })}>
              <option value="">Choose at dispatch</option>
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        ) : <div />}
        {delivery.method !== "pickup" ? <Field label="Address"><textarea className="textarea" value={delivery.address ?? customer?.address ?? ""} aria-label="Delivery address" onChange={(e) => setDelivery({ ...delivery, address: e.target.value })} /></Field> : null}
        <div className="stack">
          {delivery.method !== "pickup" ? <label className="row"><Toggle on={delivery.cod} label="Cash on delivery" onChange={(v) => setDelivery({ ...delivery, cod: v })} /> Cash on delivery</label> : null}
          {customer?.creditLimit ? <label className="row"><Toggle on={onCredit} label="On credit" onChange={(v) => { setOnCredit(v); if (v) setDelivery({ ...delivery, cod: false }); }} /> On the customer's account ({customer.paymentTermsDays ?? 30} days)</label> : null}
          <div className="row">
            <Field label="Delivery charge (Rs)"><input className="input num" type="number" min={0} value={deliveryCharge / 100} aria-label="Delivery charge" onChange={(e) => setDeliveryCharge(toCents(e.target.value))} /></Field>
            <Field label="Discount (Rs)"><input className="input num" type="number" min={0} value={discount / 100} aria-label="Discount" onChange={(e) => setDiscount(toCents(e.target.value))} /></Field>
          </div>
        </div>
        {kind === "quotation" && (!initial || initial.status === "quotation") ? <Field label="Valid for (days)"><input className="input num" type="number" min={1} value={validDays} onChange={(e) => setValidDays(Math.max(1, Number(e.target.value) || 14))} /></Field> : null}
        <Field label="Notes"><textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" /></Field>
      </div>
      <div className="card pad" data-testid="order-totals">
        <div className="row"><span className="grow">Goods ({totals.pieces} pcs)</span><span>{money(priced.reduce((a, l) => a + l.amount, 0))}</span></div>
        {print ? <div className="row"><span className="grow">Printing</span><span>{money(print.pricePerPiece * totals.pieces + print.setupFee)}</span></div> : null}
        {discount ? <div className="row"><span className="grow">Discount</span><span>−{money(discount)}</span></div> : null}
        {deliveryCharge ? <div className="row"><span className="grow">Delivery</span><span>{money(deliveryCharge)}</span></div> : null}
        {totals.vat ? <div className="row"><span className="grow">VAT</span><span>{money(totals.vat)}</span></div> : null}
        <div className="row"><b className="grow">Total</b><b>{money(totals.total)}</b></div>
        {credit && !credit.allowed ? <div className="bad-text small">Over the credit limit by {money(credit.over)}{manager ? ": confirming approves it" : ": a manager must confirm"}</div> : null}
      </div>
    </Modal>
  );
}

/** Size × colour grid: type quantities, see what is free to sell. */
function SizeGrid({ style, grid, setGrid, available, onAdd }: { style: Style; grid: Record<string, number>; setGrid: (g: Record<string, number>) => void; available: ReadonlyMap<string, number>; onAdd: () => void }) {
  const total = Object.values(grid).reduce((a, n) => a + n, 0);
  const packs = style.packSize && style.packSize > 1 ? style.packSize : 0;
  return (
    <div className="card pad size-grid" data-testid="size-grid">
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Colour</th>{style.sizes.map((s) => <th key={s} className="num">{s}</th>)}</tr></thead>
          <tbody>
            {style.colours.map((c) => (
              <tr key={c.name}>
                <td><span className="swatch" style={{ background: c.hex ?? "var(--surface-2)" }} /> {c.name}</td>
                {style.sizes.map((s) => {
                  const key = `${c.name}|${s}`;
                  const free = available.get(variantSku(style.code, c.name, s)) ?? 0;
                  return (
                    <td key={s} className="num">
                      <input className="input num" style={{ width: 64 }} type="number" min={0} inputMode="numeric" value={grid[key] || ""} aria-label={`${c.name} ${s}`} onChange={(e) => setGrid({ ...grid, [key]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
                      <div className={`tiny ${free > 0 ? "muted" : "bad-text"}`}>{free > 0 ? `${free} free` : "none"}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <span className="grow small muted">{total} pcs{packs ? ` · ${Math.floor(total / packs)} packs of ${packs}${total % packs ? ` + ${total % packs}` : ""}` : ""}</span>
        <button className="btn primary" onClick={onAdd}>Add to order</button>
      </div>
    </div>
  );
}

// ───────────────────────────── Order detail ─────────────────────────────

function OrderDetail({ order: o, data, onClose, onEdit }: { order: SalesOrder; data: Data; onClose: () => void; onEdit: () => void }) {
  const { toast, user, role, on, ledger, settings } = useApp();
  const store = useStore();
  const wa = useWhatsApp();
  const location = useDefaultLocation();
  const propertyId = usePropertyId();
  const couriers = useCollection<Courier>(WHOLESALE.couriers) ?? [];
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const customer = data.customers.find((c) => c.id === o.customerId);
  const by = user?.name ?? "staff";
  const manager = role === "owner" || role === "admin" || role === "manager";
  const books = on("accounting");
  const canWa = on("whatsappCommerce") && Boolean(o.conversationId ?? customer?.whatsapp);
  const auto = settings.integrations.whatsapp.autoNotify !== false;

  async function run(label: string, f: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast(`${label}: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }
  const step = (status: SalesOrder["status"], note: string, extra: Partial<SalesOrder> = {}) =>
    store.merge(WHOLESALE.salesOrders, o.id, { status, ...extra, updatedAt: new Date().toISOString(), history: [...o.history, { at: new Date().toISOString(), by, status, note }] });
  const notify = async (kind: OrderMessageKind, silent = false) => {
    if (!canWa) return;
    try {
      await wa({ action: "orderMessage", orderId: o.id, kind });
      if (!silent) toast("Sent on WhatsApp");
    } catch (e) {
      toast(`WhatsApp: ${(e as Error).message}`, true);
    }
  };

  const confirm = () =>
    run("Confirm", async () => {
      if (o.onCredit && customer) {
        const c = creditCheck(customer, owingFor(customer.id, data.orders, o.id), o.total);
        if (!c.allowed && !manager) throw new Error(`over the credit limit by ${money(c.over)}: a manager must confirm`);
        if (!c.allowed) await store.merge(WHOLESALE.salesOrders, o.id, { creditApprovedBy: by });
      }
      const number = o.status === "quotation" ? await nextDocNumber(store, "SO") : o.number;
      await step("confirmed", o.status === "quotation" ? `from quotation ${o.number}` : "confirmed", o.status === "quotation" ? { number, quotationNo: o.number } : {});
      toast(`${number} confirmed`);
      if (auto) await notify("confirmation", true);
    });

  const dispatch = (courierId: string, trackingNo: string) =>
    run("Dispatch", async () => {
      const today = todayColombo();
      const mv = await issueStock(store, { locationId: location, lines: o.lines.map((l) => ({ itemId: l.sku, qty: l.qty })), businessDate: today, ref: o.number });
      const terms = customer?.paymentTermsDays ?? 30;
      await step("dispatched", trackingNo ? `dispatched, tracking ${trackingNo}` : "dispatched", {
        stockMovementId: mv.id,
        delivery: { ...(o.delivery ?? { method: "courier", cod: false }), ...(courierId ? { courierId } : {}), ...(trackingNo ? { trackingNo } : {}), dispatchedAt: new Date().toISOString() },
        dueDate: o.onCredit ? addDays(today, terms) : today,
      });
      if (books) {
        await ledger({ action: "postSalesOrder", orderId: o.id, event: "invoice", date: today });
        await ledger({ action: "postPosDay", propertyId, businessDate: today }).catch(() => undefined);
      }
      const short = mv.shortages?.length ? ` (${mv.shortages.reduce((a, s) => a + s.qty, 0)} pcs were not in stock: count and correct stock)` : "";
      toast(`${o.number} dispatched${books ? " and invoiced" : ""}${short}`, Boolean(short));
      setDispatching(false);
      if (auto) await notify("dispatch", true);
    });

  const confirmPayment = (p: OrderPayment, fees = 0) =>
    run("Payment", async () => {
      const today = todayColombo();
      if (books) await ledger({ action: "postSalesOrder", orderId: o.id, event: "payment", paymentId: p.id, date: today, ...(fees ? { fees } : {}) });
      else {
        const payments = o.payments.map((x) => (x.id === p.id ? { ...x, status: "confirmed" as const } : x));
        await store.merge(WHOLESALE.salesOrders, o.id, { payments, ...paymentState(o.total, payments), updatedAt: new Date().toISOString() });
      }
      toast(`${money(p.amount)} confirmed`);
      if (auto) await notify("payment", true);
    });

  const rejectPayment = (p: OrderPayment) =>
    run("Payment", async () => {
      const payments = o.payments.map((x) => (x.id === p.id ? { ...x, status: "rejected" as const } : x));
      await store.merge(WHOLESALE.salesOrders, o.id, { payments, ...paymentState(o.total, payments), updatedAt: new Date().toISOString() });
    });

  const due = o.total - o.paid;
  const courier = couriers.find((c) => c.id === o.delivery?.courierId);
  return (
    <Modal
      wide
      title={<span className="row">{o.number} <StatusBadge status={o.status} /> <PayBadge o={o} /></span>}
      onClose={onClose}
      footer={
        <div className="row wrap grow" data-testid="order-actions">
          <button className="btn" onClick={() => printOrder(o, settings, customer)}>Print / PDF</button>
          {canWa ? (
            <select className="input" value="" aria-label="Send on WhatsApp" onChange={(e) => e.target.value && notify(e.target.value as OrderMessageKind)}>
              <option value="">💬 Send on WhatsApp…</option>
              {o.status === "quotation" ? <option value="quotation">Quotation</option> : null}
              {o.status !== "quotation" ? <option value="confirmation">Order confirmation</option> : null}
              {o.status === "dispatched" ? <option value="dispatch">On the way</option> : null}
              {o.invoiceNo ? <option value="invoice">Invoice</option> : null}
              {due > 0 && o.status !== "quotation" ? <option value="reminder">Payment reminder</option> : null}
              {o.paid > 0 ? <option value="payment">Payment received</option> : null}
            </select>
          ) : null}
          <span className="grow" />
          {["quotation", "draft", "confirmed"].includes(o.status) ? <button className="btn" onClick={onEdit}>Edit</button> : null}
          {["quotation", "draft", "confirmed", "packed"].includes(o.status) ? <ConfirmButton className="btn ghost" onConfirm={() => run("Cancel", () => step("cancelled", "cancelled"))}>Cancel order</ConfirmButton> : null}
          {o.status !== "cancelled" && o.status !== "quotation" && due > 0 ? <button className="btn" onClick={() => setPaying(true)}>Record payment</button> : null}
          {o.status === "quotation" || o.status === "draft" ? <button className="btn primary" disabled={busy} onClick={confirm}>{o.status === "quotation" ? "Make it an order" : "Confirm"}</button> : null}
          {o.status === "confirmed" ? <button className="btn primary" disabled={busy} onClick={() => run("Packed", () => step("packed", "packed"))}>Packed</button> : null}
          {o.status === "packed" ? <button className="btn primary" disabled={busy} onClick={() => setDispatching(true)}>Dispatch</button> : null}
          {o.status === "dispatched" ? <button className="btn primary" disabled={busy} onClick={() => run("Delivered", async () => { await step("delivered", "delivered", { delivery: { ...o.delivery!, deliveredAt: new Date().toISOString() } }); if (auto) await notify("delivered", true); })}>Delivered</button> : null}
        </div>
      }
    >
      <div className="grid cols-2">
        <div className="stack small">
          <div><b>{o.customerName}</b>{customer?.area ? ` · ${customer.area}` : ""}</div>
          <div className="muted">{o.channel === "whatsapp" ? "💬 Ordered on WhatsApp" : `Taken by ${o.createdBy}`} · {dateColombo(o.date)}{o.quotationNo ? ` · from ${o.quotationNo}` : ""}{o.validUntil && o.status === "quotation" ? ` · valid until ${dateColombo(o.validUntil)}` : ""}</div>
          {o.invoiceNo ? <div>Invoice <span className="mono">{o.invoiceNo}</span>{o.dueDate && due > 0 ? ` · due ${dateColombo(o.dueDate)}` : ""}</div> : null}
          {o.notes ? <div className="callout small">{o.notes}</div> : null}
        </div>
        <div className="stack small">
          <div>{o.delivery?.method === "pickup" ? "Customer collects" : o.delivery?.method === "own" ? "Our vehicle" : `Courier${courier ? `: ${courier.name}` : ""}`}{o.delivery?.trackingNo ? ` · tracking ${o.delivery.trackingNo}` : ""}</div>
          {o.delivery?.address ? <div className="muted">{o.delivery.address}</div> : null}
          {o.delivery?.cod ? <div><span className="badge warn">Cash on delivery {money(o.delivery.codAmount ?? o.total)}</span></div> : null}
          {o.onCredit ? <div><span className="badge">On credit</span>{o.creditApprovedBy ? <span className="tiny muted"> over the limit, approved by {o.creditApprovedBy}</span> : null}</div> : null}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Style</th><th>Colour / size</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {o.lines.map((l) => <tr key={l.id}><td>{l.name}<div className="tiny muted mono">{l.sku}</div></td><td>{l.colour} / {l.size}</td><td className="num">{l.qty}</td><td className="num">{money(l.unit)}</td><td className="num">{money(l.amount)}</td></tr>)}
            {o.print ? <tr><td colSpan={2}>Printing: {o.print.description || o.print.method} ({o.print.sides.join(", ")}, {o.print.colours} col.)</td><td className="num">{o.lines.reduce((a, l) => a + l.qty, 0)}</td><td className="num">{money(o.print.pricePerPiece)}</td><td className="num">{money(o.print.pricePerPiece * o.lines.reduce((a, l) => a + l.qty, 0) + o.print.setupFee)}</td></tr> : null}
            {o.discount ? <tr><td colSpan={4}>Discount</td><td className="num">−{money(o.discount)}</td></tr> : null}
            {o.deliveryCharge ? <tr><td colSpan={4}>Delivery</td><td className="num">{money(o.deliveryCharge)}</td></tr> : null}
            {o.vat ? <tr><td colSpan={4}>VAT</td><td className="num">{money(o.vat)}</td></tr> : null}
            <tr><td colSpan={4}><b>Total</b></td><td className="num"><b>{money(o.total)}</b></td></tr>
            {o.paid ? <tr><td colSpan={4}>Paid</td><td className="num">{money(o.paid)}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {o.payments.length ? (
        <>
          <div className="section-title">Payments</div>
          <div className="stack">
            {o.payments.map((p) => (
              <div key={p.id} className="row wrap card pad" data-testid="order-payment">
                <span className="grow">{PAY_LABEL[p.method] ?? p.method} · {money(p.amount)}{p.reference ? ` · ${p.reference}` : ""}{p.proofAttachmentId ? " · 🧾 slip on WhatsApp" : ""}<div className="tiny muted">{dateTimeColombo(p.at)} · {p.by}</div></span>
                {p.status === "pending" ? (
                  <>
                    {p.proofAttachmentId ? <SlipButton mediaId={p.proofAttachmentId} /> : null}
                    <ConfirmButton className="btn ghost" onConfirm={() => rejectPayment(p)}>Reject</ConfirmButton>
                    <button className="btn primary" disabled={busy} onClick={() => confirmPayment(p)}>Confirm received</button>
                  </>
                ) : <span className={`badge ${p.status === "confirmed" ? "good" : "bad"}`}>{p.status === "confirmed" ? "Confirmed" : "Rejected"}</span>}
              </div>
            ))}
          </div>
        </>
      ) : null}
      <details className="small">
        <summary>History</summary>
        <ul>{o.history.map((h, i) => <li key={i}>{dateTimeColombo(h.at)} · {h.by}: {h.note ?? h.status}</li>)}</ul>
      </details>
      {paying ? <PaymentForm order={o} onClose={() => setPaying(false)} /> : null}
      {dispatching ? (
        <DispatchForm order={o} couriers={couriers.filter((c) => c.active)} busy={busy} onClose={() => setDispatching(false)} onDispatch={dispatch} />
      ) : null}
    </Modal>
  );
}

function SlipButton({ mediaId }: { mediaId: string }) {
  const wa = useWhatsApp();
  const { toast } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  return (
    <>
      <button className="btn" onClick={() => wa<{ dataUrl: string }>({ action: "media", mediaId }).then((r) => setUrl(r.dataUrl)).catch((e: Error) => toast(e.message, true))}>View slip</button>
      {url ? <Modal title="Payment slip" onClose={() => setUrl(null)}><img src={url} alt="Payment slip" style={{ maxWidth: "100%" }} /></Modal> : null}
    </>
  );
}

function DispatchForm({ order, couriers, busy, onClose, onDispatch }: { order: SalesOrder; couriers: Courier[]; busy: boolean; onClose: () => void; onDispatch: (courierId: string, tracking: string) => void }) {
  const [courierId, setCourierId] = useState(order.delivery?.courierId ?? couriers[0]?.id ?? "");
  const [tracking, setTracking] = useState("");
  return (
    <Modal title={`Dispatch ${order.number}`} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={() => onDispatch(order.delivery?.method === "courier" ? courierId : "", tracking.trim())}>Dispatch now</button>}>
      <p className="small muted">Takes {order.lines.reduce((a, l) => a + l.qty, 0)} pieces out of stock and invoices {order.customerName}.</p>
      {order.delivery?.method === "courier" ? (
        <>
          <Field label="Courier">
            <select className="input" value={courierId} onChange={(e) => setCourierId(e.target.value)} aria-label="Courier">
              {couriers.length ? null : <option value="">Add couriers under Sales → Couriers</option>}
              {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Tracking / waybill number"><input className="input" value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="Tracking number" /></Field>
        </>
      ) : null}
    </Modal>
  );
}

function PaymentForm({ order: o, onClose }: { order: SalesOrder; onClose: () => void }) {
  const { toast, user } = useApp();
  const store = useStore();
  const [method, setMethod] = useState<PaymentMethod>(o.delivery?.cod ? "cod" : "bank");
  const [amount, setAmount] = useState(((o.total - o.paid) / 100).toString());
  const [reference, setReference] = useState("");
  const [cheque, setCheque] = useState({ bank: "", number: "", chequeDate: todayColombo() });
  async function save() {
    const cents = toCents(amount);
    if (cents <= 0) return toast("Enter the amount", true);
    if (method === "cheque" && (!cheque.bank || !cheque.number)) return toast("Enter the cheque's bank and number", true);
    const at = new Date().toISOString();
    const by = user?.name ?? "staff";
    let chequeId: string | undefined;
    if (method === "cheque") {
      chequeId = newId();
      await store.set(WHOLESALE.cheques, { id: chequeId, customerId: o.customerId, orderId: o.id, bank: cheque.bank, number: cheque.number, amount: cents, chequeDate: cheque.chequeDate, status: "received", receivedAt: at, by });
    }
    // Cash in hand is confirmed at once; transfers, links, COD and cheques are checked first.
    const p: OrderPayment = { id: newId(), method, amount: cents, at, by, ...(reference ? { reference } : {}), ...(chequeId ? { chequeId } : {}), status: "pending" };
    const payments = [...o.payments, p];
    await store.merge(WHOLESALE.salesOrders, o.id, { payments, ...paymentState(o.total, payments), updatedAt: at });
    toast(method === "cheque" ? "Cheque recorded: confirm it when it clears" : "Payment recorded: confirm it once you see the money");
    onClose();
  }
  return (
    <Modal title={`Payment for ${o.number}`} onClose={onClose} footer={<button className="btn primary" onClick={save}>Record</button>}>
      <Field label="How">
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} aria-label="Payment method">
          {(["bank", "cod", "cheque", "cash", "link", "card"] as const).map((m) => <option key={m} value={m}>{PAY_LABEL[m]}</option>)}
        </select>
      </Field>
      <Field label="Amount (Rs)"><input className="input num" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount" /></Field>
      {method === "cheque" ? (
        <div className="grid cols-2">
          <Field label="Bank"><input className="input" value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} aria-label="Cheque bank" /></Field>
          <Field label="Cheque number"><input className="input" value={cheque.number} onChange={(e) => setCheque({ ...cheque, number: e.target.value })} aria-label="Cheque number" /></Field>
          <Field label="Date on the cheque"><input className="input" type="date" value={cheque.chequeDate} onChange={(e) => setCheque({ ...cheque, chequeDate: e.target.value })} aria-label="Cheque date" /></Field>
        </div>
      ) : null}
      <Field label="Reference"><input className="input" value={reference} placeholder="Slip number, transfer reference" onChange={(e) => setReference(e.target.value)} aria-label="Reference" /></Field>
    </Modal>
  );
}

// ───────────────────────────── Printable document ─────────────────────────────

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Quotation, order or invoice as a printable page (Print → Save as PDF to send it). */
export function printOrder(o: SalesOrder, settings: ReturnType<typeof useApp>["settings"], customer?: Customer) {
  const b = settings.business;
  const title = o.status === "quotation" ? "QUOTATION" : o.invoiceNo ? (b.vatRegistered ? "TAX INVOICE" : "INVOICE") : "SALES ORDER";
  const pieces = o.lines.reduce((a, l) => a + l.qty, 0);
  const rows = o.lines.map((l) => `<tr><td>${esc(l.name)}<br><small>${esc(l.sku)}</small></td><td>${esc(l.colour)} / ${esc(l.size)}</td><td class="n">${l.qty}</td><td class="n">${money(l.unit)}</td><td class="n">${money(l.amount)}</td></tr>`).join("");
  const extra = [
    o.print ? `<tr><td colspan="4">Printing: ${esc(o.print.description || o.print.method)} (${esc(o.print.sides.join(", "))})</td><td class="n">${money(o.print.pricePerPiece * pieces + o.print.setupFee)}</td></tr>` : "",
    o.discount ? `<tr><td colspan="4">Discount</td><td class="n">−${money(o.discount)}</td></tr>` : "",
    o.deliveryCharge ? `<tr><td colspan="4">Delivery</td><td class="n">${money(o.deliveryCharge)}</td></tr>` : "",
    o.vat ? `<tr><td colspan="4">VAT</td><td class="n">${money(o.vat)}</td></tr>` : "",
  ].join("");
  const bank = settings.integrations.whatsapp.bankDetails;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} ${esc(o.invoiceNo ?? o.number)}</title><style>
body{font:13px/1.45 system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left}.n{text-align:right}.top{display:flex;justify-content:space-between;gap:24px}small{color:#555}
</style></head><body><div class="top"><div><h1>${esc(b.tradingName || b.legalName)}</h1><div>${b.addressLines.map(esc).join("<br>")}</div><div>${esc(b.phone)} ${esc(b.email)}</div>${b.vatRegistered && b.tin ? `<div>VAT TIN ${esc(b.tin)}</div>` : ""}</div>
<div style="text-align:right"><h1>${title}</h1><div>${esc(o.invoiceNo ?? o.number)}</div><div>${dateColombo(o.date)}</div>${o.validUntil && o.status === "quotation" ? `<div>Valid until ${dateColombo(o.validUntil)}</div>` : ""}${o.dueDate && o.invoiceNo ? `<div>Due ${dateColombo(o.dueDate)}</div>` : ""}</div></div>
<p><b>To:</b> ${esc(o.customerName)}${customer?.vatTin ? `<br>VAT TIN ${esc(customer.vatTin)}` : ""}${o.delivery?.address ? `<br>${esc(o.delivery.address)}` : ""}</p>
<table><thead><tr><th>Style</th><th>Colour / size</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Amount</th></tr></thead><tbody>${rows}${extra}
<tr><td colspan="4"><b>Total (${pieces} pcs)</b></td><td class="n"><b>${money(o.total)}</b></td></tr>${o.paid ? `<tr><td colspan="4">Paid</td><td class="n">${money(o.paid)}</td></tr><tr><td colspan="4"><b>Balance</b></td><td class="n"><b>${money(o.total - o.paid)}</b></td></tr>` : ""}</tbody></table>
${bank ? `<p><b>Pay by bank transfer:</b><br>${esc(bank).replace(/\n/g, "<br>")}</p>` : ""}<p><small>Thank you for your business.</small></p><script>window.onload=()=>window.print()</script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

