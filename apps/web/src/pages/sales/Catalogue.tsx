import { useState } from "react";
import { type Style, WHOLESALE, barcodeForSku, saveStyle, variantSku } from "@pos/core";
import { CrudPage } from "../../components/CrudPage";
import { Empty, Field, Loading, Modal, ModuleOff, PageHead, Toggle } from "../../components/ui";
import { money, toCents } from "../../lib/format";
import { useApp, useStore } from "../../state/app";
import { useSalesData } from "./shared";

const blank = (): Style => ({ id: "", code: "", name: "", category: "T-shirts", sizes: ["S", "M", "L", "XL", "XXL"], colours: [{ name: "Black", hex: "#111111" }, { name: "White", hex: "#ffffff" }], price: 0, cost: 0, tiers: [], packSize: 12, publish: true, active: true });

export function StylesPage() {
  const { on, role } = useApp();
  const data = useSalesData();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Style | null>(null);
  const [labels, setLabels] = useState<Style | null>(null);
  if (!on("wholesale")) return <ModuleOff name="Sales & Orders" />;
  if (!data.ready) return <div className="page"><Loading /></div>;
  const canEdit = role === "owner" || role === "admin" || role === "manager" || role === "storekeeper";
  const needle = q.trim().toLowerCase();
  const rows = data.styles.filter((s) => !needle || `${s.code} ${s.name} ${s.category}`.toLowerCase().includes(needle)).sort((a, b) => a.code.localeCompare(b.code));
  return (
    <div className="page">
      <PageHead
        title="Styles"
        subtitle="Each style comes in sizes and colours; every size and colour is a stock item with its own SKU and barcode. Quantity prices apply per style on an order, customer price lists on top."
        actions={canEdit ? <button className="btn primary" onClick={() => setEditing(blank())}>New style</button> : null}
      />
      <input className="input" style={{ marginBottom: 12 }} placeholder="Search styles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search styles" />
      {rows.length === 0 ? (
        <div className="card"><Empty title="No styles yet">{canEdit ? <p>Add your first style: code, sizes, colours and prices.</p> : null}</Empty></div>
      ) : (
        <div className="stack">
          {rows.map((s) => {
            const pcs = s.colours.reduce((a, c) => a + s.sizes.reduce((x, z) => x + (data.onHand.get(variantSku(s.code, c.name, z)) ?? 0), 0), 0);
            return (
              <div key={s.id} className="card pad" data-testid={`style-${s.code}`}>
                <div className="row wrap">
                  <div className="grow">
                    <b>{s.name}</b> <span className="mono small muted">{s.code}</span> {s.active ? null : <span className="badge">Inactive</span>} {s.publish === false ? null : <span className="badge info">On WhatsApp</span>}
                    <div className="small muted">{s.category} · {money(s.price)} each{(s.tiers ?? []).length ? ` · ${(s.tiers ?? []).map((t) => `${t.minQty}+ ${money(t.price)}`).join(" · ")}` : ""}{s.packSize ? ` · packs of ${s.packSize}` : ""}</div>
                  </div>
                  <span className="badge">{pcs.toLocaleString("en-US")} pcs in stock</span>
                  <button className="btn" onClick={() => setLabels(s)}>Barcodes</button>
                  {canEdit ? <button className="btn" onClick={() => setEditing(s)}>Edit</button> : null}
                </div>
                <div className="table-wrap">
                  <table className="table compact">
                    <thead><tr><th>Colour</th>{s.sizes.map((z) => <th key={z} className="num">{z}</th>)}</tr></thead>
                    <tbody>
                      {s.colours.map((c) => (
                        <tr key={c.name}>
                          <td><span className="swatch" style={{ background: c.hex ?? "var(--surface-2)" }} /> {c.name}</td>
                          {s.sizes.map((z) => {
                            const sku = variantSku(s.code, c.name, z);
                            const n = data.onHand.get(sku) ?? 0;
                            const free = data.available.get(sku) ?? 0;
                            return <td key={z} className={`num${n <= 0 ? " bad-text" : ""}`} title={`${sku}: ${n} in stock, ${free} free to sell`}>{n}{free !== n ? <span className="tiny muted"> ({free})</span> : null}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing ? <StyleEditor initial={editing} onClose={() => setEditing(null)} /> : null}
      {labels ? <BarcodeSheet style={labels} onClose={() => setLabels(null)} /> : null}
    </div>
  );
}

const csv = (list: string[]) => list.join(", ");
const parseList = (text: string) => text.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function StyleEditor({ initial, onClose }: { initial: Style; onClose: () => void }) {
  const { toast, on } = useApp();
  const store = useStore();
  const [s, setS] = useState<Style>(initial);
  const [sizes, setSizes] = useState(csv(initial.sizes));
  const [busy, setBusy] = useState(false);
  const isNew = !initial.id;
  async function save() {
    const code = s.code.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(code)) return toast("Code: 2–20 letters, digits or -", true);
    if (!s.name.trim()) return toast("Enter the style name", true);
    const sz = parseList(sizes);
    if (!sz.length || !s.colours.length) return toast("Add sizes and colours", true);
    if (s.price <= 0) return toast("Enter the price per piece", true);
    setBusy(true);
    try {
      const style: Style = { ...s, id: s.id || code, code, name: s.name.trim(), sizes: sz, colours: s.colours.filter((c) => c.name.trim()), tiers: (s.tiers ?? []).filter((t) => t.minQty > 1 && t.price > 0).sort((a, b) => a.minQty - b.minQty), updatedAt: new Date().toISOString() };
      if (isNew && (await store.get(WHOLESALE.styles, style.id))) throw new Error(`a style with code ${code} exists`);
      await saveStyle(store, style);
      toast(`${style.name} saved with ${style.sizes.length * style.colours.length} variants`);
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal wide title={isNew ? "New style" : `Edit ${initial.code}`} onClose={onClose} footer={<button className="btn primary" disabled={busy} onClick={save}>Save style</button>}>
      <div className="grid cols-2">
        <Field label="Code" help="Starts every SKU, e.g. ZX-OVS01"><input className="input mono" value={s.code} disabled={!isNew} onChange={(e) => setS({ ...s, code: e.target.value.toUpperCase() })} aria-label="Style code" /></Field>
        <Field label="Name"><input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} aria-label="Style name" /></Field>
        <Field label="Category"><input className="input" value={s.category} onChange={(e) => setS({ ...s, category: e.target.value })} aria-label="Category" /></Field>
        <Field label="Fabric"><input className="input" value={s.fabric ?? ""} placeholder="e.g. 220 GSM cotton" onChange={(e) => setS({ ...s, fabric: e.target.value })} aria-label="Fabric" /></Field>
        <Field label="Sizes" help="In order, separated by commas"><input className="input" value={sizes} onChange={(e) => setSizes(e.target.value)} aria-label="Sizes" /></Field>
        <Field label="Pieces per pack"><input className="input num" type="number" min={1} value={s.packSize ?? 1} onChange={(e) => setS({ ...s, packSize: Math.max(1, Number(e.target.value) || 1) })} aria-label="Pack size" /></Field>
        <Field label="Price per piece (Rs)"><input className="input num" type="number" min={0} value={s.price ? s.price / 100 : ""} onChange={(e) => setS({ ...s, price: toCents(e.target.value) })} aria-label="Price" /></Field>
        <Field label="Cost per piece (Rs)" help="Until goods are received at their real cost"><input className="input num" type="number" min={0} value={s.cost ? s.cost / 100 : ""} onChange={(e) => setS({ ...s, cost: toCents(e.target.value) })} aria-label="Cost" /></Field>
      </div>
      <div className="section-title">Colours</div>
      <div className="stack">
        {s.colours.map((c, i) => (
          <div key={i} className="row">
            <input type="color" value={c.hex ?? "#888888"} aria-label={`Colour swatch ${i + 1}`} onChange={(e) => setS({ ...s, colours: s.colours.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x)) })} />
            <input className="input grow" value={c.name} aria-label={`Colour ${i + 1}`} onChange={(e) => setS({ ...s, colours: s.colours.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            <input className="input num" style={{ width: 120 }} type="number" min={0} placeholder="+ Rs" title="Extra per piece for this colour" aria-label={`Extra for ${c.name}`} value={s.colourSurcharge?.[c.name] ? s.colourSurcharge[c.name]! / 100 : ""} onChange={(e) => setS({ ...s, colourSurcharge: { ...(s.colourSurcharge ?? {}), [c.name]: toCents(e.target.value) } })} />
            <button className="btn ghost icon-btn" aria-label={`Remove ${c.name}`} onClick={() => setS({ ...s, colours: s.colours.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setS({ ...s, colours: [...s.colours, { name: "", hex: "#888888" }] })}>＋ Colour</button>
      </div>
      <div className="section-title">Quantity prices</div>
      <div className="stack">
        {(s.tiers ?? []).map((t, i) => (
          <div key={i} className="row">
            <span>From</span>
            <input className="input num" style={{ width: 90 }} type="number" min={2} value={t.minQty} aria-label={`Tier ${i + 1} quantity`} onChange={(e) => setS({ ...s, tiers: (s.tiers ?? []).map((x, j) => (j === i ? { ...x, minQty: Number(e.target.value) || 0 } : x)) })} />
            <span>pcs, Rs</span>
            <input className="input num" style={{ width: 120 }} type="number" min={0} value={t.price / 100} aria-label={`Tier ${i + 1} price`} onChange={(e) => setS({ ...s, tiers: (s.tiers ?? []).map((x, j) => (j === i ? { ...x, price: toCents(e.target.value) } : x)) })} />
            <span>each</span>
            <button className="btn ghost icon-btn" aria-label="Remove tier" onClick={() => setS({ ...s, tiers: (s.tiers ?? []).filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setS({ ...s, tiers: [...(s.tiers ?? []), { minQty: (s.tiers ?? []).length ? (s.tiers ?? [])[(s.tiers ?? []).length - 1]!.minQty * 2 : 12, price: s.price }] })}>＋ Quantity price</button>
      </div>
      <div className="section-title">Size extras</div>
      <div className="row wrap">
        {parseList(sizes).map((z) => (
          <label key={z} className="row small">{z} + Rs <input className="input num" style={{ width: 90 }} type="number" min={0} value={s.sizeSurcharge?.[z] ? s.sizeSurcharge[z]! / 100 : ""} aria-label={`Extra for ${z}`} onChange={(e) => setS({ ...s, sizeSurcharge: { ...(s.sizeSurcharge ?? {}), [z]: toCents(e.target.value) } })} /></label>
        ))}
      </div>
      <Field label="Description (catalogue)"><textarea className="textarea" value={s.description ?? ""} onChange={(e) => setS({ ...s, description: e.target.value })} aria-label="Description" /></Field>
      <div className="row wrap">
        <label className="row"><Toggle on={s.active} label="Active" onChange={(v) => setS({ ...s, active: v })} /> Selling</label>
        {on("whatsappCommerce") ? <label className="row"><Toggle on={s.publish !== false} label="On WhatsApp" onChange={(v) => setS({ ...s, publish: v })} /> In the WhatsApp catalogue and assistant</label> : null}
      </div>
    </Modal>
  );
}

/** Barcode labels for every variant (EAN-13), printed from the browser. */
function BarcodeSheet({ style, onClose }: { style: Style; onClose: () => void }) {
  const variants = style.colours.flatMap((c) => style.sizes.map((z) => ({ sku: variantSku(style.code, c.name, z), colour: c.name, size: z })));
  const code = (sku: string) => style.barcodes?.[sku] ?? barcodeForSku(sku);
  function print() {
    const w = window.open("", "_blank");
    if (!w) return;
    const cells = variants.map((v) => `<div class="l"><b>${style.name}</b><div>${v.colour} · ${v.size}</div>${ean13Svg(code(v.sku))}<div class="m">${v.sku}</div></div>`).join("");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${style.code} labels</title><style>body{font:11px system-ui;margin:8px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.l{border:1px dashed #bbb;padding:6px;text-align:center}.m{font-family:monospace}svg{width:100%;height:56px}</style></head><body><div class="g">${cells}</div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }
  return (
    <Modal title={`Barcodes: ${style.name}`} onClose={onClose} footer={<button className="btn primary" onClick={print}>Print labels</button>}>
      <div className="table-wrap">
        <table className="table compact">
          <thead><tr><th>SKU</th><th>Colour / size</th><th>Barcode</th></tr></thead>
          <tbody>{variants.map((v) => <tr key={v.sku}><td className="mono">{v.sku}</td><td>{v.colour} / {v.size}</td><td className="mono">{code(v.sku)}</td></tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}

// EAN-13 bars (left: L/G by the first digit's parity pattern, right: R), as an inline SVG.
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).reverse().join(""));
const R = L.map((p) => [...p].map((b) => (b === "0" ? "1" : "0")).join(""));
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
export function ean13Bits(code: string): string {
  const d = [...code].map(Number);
  const par = PARITY[d[0]!]!;
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === "L" ? L : G)[d[i]!]!;
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += R[d[i]!]!;
  return `${bits}101`;
}
function ean13Svg(code: string): string {
  const bits = ean13Bits(code);
  const bars = [...bits].map((b, i) => (b === "1" ? `<rect x="${i}" y="0" width="1" height="50"/>` : "")).join("");
  return `<svg viewBox="0 0 ${bits.length} 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}<text x="${bits.length / 2}" y="59" font-size="9" text-anchor="middle">${code}</text></svg>`;
}

export function PriceListsPage() {
  const { on } = useApp();
  if (!on("wholesale")) return <ModuleOff name="Sales & Orders" />;
  return (
    <CrudPage
      title="Price lists"
      subtitle="Special prices for groups of customers (A-grade shops, resellers): a percentage off the list or quantity price, or set prices per style. Choose a customer's price list on the customer."
      col={WHOLESALE.priceLists}
      idFrom="auto"
      noun="price list"
      newDoc={() => ({ name: "", kind: "percent", percentOff: 500, active: true })}
      fields={[
        { key: "name", label: "Name", type: "text", required: true },
        { key: "kind", label: "Kind", type: "select", options: [{ value: "percent", label: "A percentage off" }, { value: "fixed", label: "Set prices per style" }] },
        { key: "percentOff", label: "Percentage off", type: "percent", show: (d) => d.kind !== "fixed" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Name", render: (d) => d.name },
        { header: "Rule", render: (d) => (d.kind === "fixed" ? `${Object.keys(d.prices ?? {}).length} set prices` : `${((d.percentOff ?? 0) / 100).toFixed(1)}% off`) },
        { header: "Status", render: (d) => (d.active ? "Active" : "Off") },
      ]}
    />
  );
}

export function CouriersPage() {
  const { on } = useApp();
  if (!on("wholesale")) return <ModuleOff name="Sales & Orders" />;
  return (
    <CrudPage
      title="Couriers"
      subtitle="Delivery companies, their cash-on-delivery fee and parcel fee. The courier's cash collections are settled under Payments & COD."
      col={WHOLESALE.couriers}
      idFrom="auto"
      noun="courier"
      newDoc={() => ({ name: "", phone: "", codFeeBp: 100, parcelFee: 350_00, active: true })}
      fields={[
        { key: "name", label: "Name", type: "text", required: true },
        { key: "phone", label: "Phone", type: "text" },
        { key: "codFeeBp", label: "COD fee (% of cash collected)", type: "percent" },
        { key: "parcelFee", label: "Fee per parcel", type: "money" },
        { key: "trackingUrl", label: "Tracking page", type: "text", placeholder: "https://…?waybill={n}" },
        { key: "active", label: "Active", type: "bool" },
      ]}
      columns={[
        { header: "Courier", render: (d) => d.name },
        { header: "COD fee", render: (d) => `${((d.codFeeBp ?? 0) / 100).toFixed(1)}%` },
        { header: "Per parcel", render: (d) => money(d.parcelFee ?? 0), num: true },
        { header: "Status", render: (d) => (d.active ? "Active" : "Off") },
      ]}
    />
  );
}

