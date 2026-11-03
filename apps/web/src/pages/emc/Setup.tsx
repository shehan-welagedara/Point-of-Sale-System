import { useState } from "react";
import {
  type BrandingSettings,
  type BusinessSettings,
  type IntegrationSettings,
  type ModuleKey,
  type TaxSettings,
  calculateCheckPreview,
  MODULES,
  lankaQrPayload,
  payhereCheckout,
  setModule,
} from "./setup-helpers";
import { Field, PageHead, Toggle } from "../../components/ui";
import { QrCode } from "../../components/Receipt";
import { money } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";

export function BusinessTaxPage() {
  const { settings, saveSetting, toast } = useApp();
  const orderTypes = useCollection<{ id: string; name: string }>("orderTypes") ?? [];
  const [b, setB] = useState<BusinessSettings>(settings.business);
  const [t, setT] = useState<TaxSettings>(settings.tax);
  const preview = calculateCheckPreview(t, b);

  async function save() {
    if (b.vatRegistered && !/^\d{9}$/.test(b.tin)) return toast("TIN must be 9 digits for a VAT-registered business", true);
    const isSample = b.isSample && b.tin === settings.business.tin && b.legalName === settings.business.legalName;
    await saveSetting("business", { ...b, isSample });
    await saveSetting("tax", t);
    toast("Business and tax settings saved");
  }

  const pctInput = (value: number, onChange: (v: number) => void) => (
    <div className="row"><input className="input num" type="number" step="0.01" min={0} value={value / 100} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))} /><span className="muted">%</span></div>
  );

  return (
    <div className="page">
      <PageHead title="Business & tax" subtitle="Legal details print on every bill exactly as entered (IRD tax invoice format). Rates are editable as the law changes." actions={<button className="btn primary" onClick={save}>Save</button>} />
      {b.isSample ? <div className="callout warn">These are sample details. Replace them with the client's registered name, address and 9-digit TIN before issuing real bills.</div> : null}
      <div className="grid cols-2">
        <div className="card card-body stack">
          <h3>Legal entity</h3>
          <Field label="Registered name (as on the VAT certificate)"><input className="input" value={b.legalName} onChange={(e) => setB({ ...b, legalName: e.target.value })} /></Field>
          <Field label="Trading name"><input className="input" value={b.tradingName} onChange={(e) => setB({ ...b, tradingName: e.target.value })} /></Field>
          <Field label="Registered address (one line per row)"><textarea className="textarea" value={b.addressLines.join("\n")} onChange={(e) => setB({ ...b, addressLines: e.target.value.split("\n") })} /></Field>
          <div className="grid cols-2">
            <Field label="Phone"><input className="input" value={b.phone} onChange={(e) => setB({ ...b, phone: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={b.email} onChange={(e) => setB({ ...b, email: e.target.value })} /></Field>
          </div>
          <Field label="TIN (9 digits)"><input className="input mono" inputMode="numeric" maxLength={9} value={b.tin} onChange={(e) => setB({ ...b, tin: e.target.value.replace(/\D/g, "") })} /></Field>
          <div className="row between"><span>VAT-registered (prints “TAX INVOICE” with VAT)</span><Toggle on={b.vatRegistered} onChange={(v) => setB({ ...b, vatRegistered: v })} /></div>
          <div className="row between"><span>SSCL-liable (adds SSCL line)</span><Toggle on={b.ssclLiable} onChange={(v) => setB({ ...b, ssclLiable: v })} /></div>
        </div>
        <div className="card card-body stack">
          <h3>Charges and taxes</h3>
          <Field label="Menu prices are">
            <select className="select" value={t.pricing} onChange={(e) => setT({ ...t, pricing: e.target.value as TaxSettings["pricing"] })}>
              <option value="exclusive">Exclusive (service charge and taxes added on the bill)</option>
              <option value="inclusive">Inclusive (prices already include them)</option>
            </select>
          </Field>
          <div className="grid cols-2">
            <Field label="Service charge">{pctInput(t.serviceChargeRate, (v) => setT({ ...t, serviceChargeRate: v }))}</Field>
            <Field label="VAT">{pctInput(t.vatRate, (v) => setT({ ...t, vatRate: v }))}</Field>
            <Field label="SSCL">{pctInput(t.ssclRate, (v) => setT({ ...t, ssclRate: v }))}</Field>
            <Field label="TDL (SLTDA-registered only)">{pctInput(t.tdlRate, (v) => setT({ ...t, tdlRate: v }))}</Field>
          </div>
          <Field label="Service charge applies to" help="None selected = all order types.">
            <div className="chips">
              {orderTypes.map((o) => {
                const onSel = t.serviceChargeOrderTypes.includes(o.id);
                return <button key={o.id} type="button" className={`chip${onSel ? " on" : ""}`} onClick={() => setT({ ...t, serviceChargeOrderTypes: onSel ? t.serviceChargeOrderTypes.filter((x) => x !== o.id) : [...t.serviceChargeOrderTypes, o.id] })}>{o.name}</button>;
              })}
            </div>
          </Field>
          <div className="grid cols-2">
            <Field label="Round bills to">
              <select className="select" value={t.billRoundingUnit} onChange={(e) => setT({ ...t, billRoundingUnit: Number(e.target.value) })}>
                <option value={0}>No rounding</option>
                <option value={100}>Rs 1</option>
                <option value={500}>Rs 5</option>
                <option value={1000}>Rs 10</option>
              </select>
            </Field>
            <Field label="Invoice number sequence restarts">
              <select className="select" value={t.invoiceSequenceReset} onChange={(e) => setT({ ...t, invoiceSequenceReset: e.target.value as TaxSettings["invoiceSequenceReset"] })}>
                <option value="monthly">Every month (26NOV_W01_1)</option>
                <option value="yearly">Every year</option>
                <option value="never">Never</option>
              </select>
            </Field>
          </div>
          <div className="callout">
            <strong>Rs 1,000.00 dine-in check:</strong>{" "}
            {preview.charges.map((c) => `${c.name} ${money(c.amount)}`).join(" · ") || "no charges"} → <strong>{money(preview.amountDue)}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

async function fileToLogo(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, 360 / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BrandingPage() {
  const { settings, saveSetting, toast } = useApp();
  const [b, setB] = useState<BrandingSettings>(settings.branding);
  return (
    <div className="page">
      <PageHead title="Branding" subtitle="The restaurant's name, logo, colours and bill text. Applied across the POS, back office and printed bills." actions={<button className="btn primary" onClick={async () => { await saveSetting("branding", b); toast("Branding saved"); }}>Save</button>} />
      <div className="grid cols-2">
        <div className="card card-body stack">
          <Field label="Display name"><input className="input" value={b.displayName} onChange={(e) => setB({ ...b, displayName: e.target.value })} /></Field>
          <Field label="Logo" help="PNG, JPG or SVG. Resized to 360 px and stored with the settings (no file storage needed). For the printed logo, load it into the printer's NV memory with the printer utility.">
            <div className="row">
              <div className="brand-logo" style={{ width: 64, height: 64 }}>{b.logoDataUrl ? <img src={b.logoDataUrl} alt="Logo" /> : b.displayName.slice(0, 1)}</div>
              <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setB({ ...b, logoDataUrl: await fileToLogo(f) }); }} />
              {b.logoDataUrl ? <button className="btn sm" onClick={() => setB({ ...b, logoDataUrl: undefined })}>Remove</button> : null}
            </div>
          </Field>
          <div className="grid cols-2">
            <Field label="Primary colour"><input type="color" value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value })} style={{ width: "100%", height: 40, border: 0 }} /></Field>
            <Field label="Accent colour"><input type="color" value={b.accentColor} onChange={(e) => setB({ ...b, accentColor: e.target.value })} style={{ width: "100%", height: 40, border: 0 }} /></Field>
          </div>
          <Field label="Bill header lines"><textarea className="textarea" value={b.receiptHeaderLines.join("\n")} onChange={(e) => setB({ ...b, receiptHeaderLines: e.target.value.split("\n").filter(Boolean) })} /></Field>
          <Field label="Bill footer lines"><textarea className="textarea" value={b.receiptFooterLines.join("\n")} onChange={(e) => setB({ ...b, receiptFooterLines: e.target.value.split("\n").filter(Boolean) })} /></Field>
          <Field label="Software name on bills (“Powered by …”)"><input className="input" value={b.poweredBy} onChange={(e) => setB({ ...b, poweredBy: e.target.value })} /></Field>
        </div>
        <div className="card card-body stack" style={{ alignItems: "center" }}>
          <span className="section-title">Preview</span>
          <div className="card" style={{ width: "100%", overflow: "hidden" }}>
            <div style={{ background: b.primaryColor, color: "#fff", padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
              <div className="brand-logo" style={{ background: "#fff", color: b.primaryColor }}>{b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : b.displayName.slice(0, 1)}</div>
              <strong>{b.displayName}</strong>
            </div>
            <div style={{ padding: 16 }} className="row">
              <button className="btn" style={{ background: b.primaryColor, color: "#fff", borderColor: b.primaryColor }}>Pay</button>
              <button className="btn" style={{ borderColor: b.accentColor, color: b.accentColor }}>Send to kitchen</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ModulesPage() {
  const { tenant, updateTenant, toast, role, mode } = useApp();
  const mods = tenant?.modules ?? {};
  const canEdit = mode === "local" || role === "owner" || role === "admin";
  const groups = [...new Set(MODULES.map((m) => m.group))];
  async function toggle(key: ModuleKey, on: boolean) {
    const next = setModule(mods, key, on);
    await updateTenant({ modules: next });
    const changed = MODULES.filter((m) => Boolean(next[m.key]) !== Boolean(mods[m.key])).map((m) => m.name);
    toast(`${on ? "Enabled" : "Disabled"}: ${changed.join(", ")}`);
  }
  return (
    <div className="page">
      <PageHead title="Modules" subtitle="Switch on only what this client has bought. Everything shares one database, so turning a module on later uses the data already there." />
      {!canEdit ? <div className="callout warn">Only the owner or an administrator can change modules.</div> : null}
      {groups.map((g) => (
        <div key={g} className="stack tight">
          <span className="section-title">{g}</span>
          <div className="grid cols-2">
            {MODULES.filter((m) => m.group === g).map((m) => (
              <div key={m.key} className="card card-body row" style={{ alignItems: "flex-start" }}>
                <div className="grow stack tight">
                  <div className="row"><h3>{m.name}</h3>{m.status === "planned" ? <span className="badge">Planned</span> : null}</div>
                  <p className="small muted">{m.description}</p>
                  {m.requires.length ? <p className="tiny muted">Needs: {m.requires.map((r) => MODULES.find((x) => x.key === r)?.name).join(", ")}</p> : null}
                </div>
                <Toggle on={Boolean(mods[m.key])} disabled={!canEdit || m.status === "planned"} onChange={(v) => toggle(m.key, v)} label={m.name} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function IntegrationsPage() {
  const { settings, saveSetting, toast } = useApp();
  const [s, setS] = useState<IntegrationSettings>(settings.integrations);
  const [demo, setDemo] = useState<"lankaqr" | "payhere" | null>(null);
  const modeSel = (value: string, onChange: (v: IntegrationSettings["payhere"]["mode"]) => void) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value as IntegrationSettings["payhere"]["mode"])}>
      <option value="mock">Mock (demo, nothing leaves the device)</option>
      <option value="sandbox">Sandbox (test account)</option>
      <option value="live">Live</option>
    </select>
  );
  const amount = 341_261;
  return (
    <div className="page">
      <PageHead title="Integrations" subtitle="Third-party connections run as templates with sample data (mock mode) until the client's accounts are approved. Switching to sandbox or live also needs the server-side endpoint deployed." actions={<button className="btn primary" onClick={async () => { await saveSetting("integrations", s); toast("Integration settings saved"); }}>Save</button>} />
      <div className="grid cols-2">
        <div className="card card-body stack">
          <div className="row between"><h3>PayHere</h3><span className="badge info">{s.payhere.mode}</span></div>
          <p className="small muted">Online card payments, payment links and pay-by-QR on the bill. The merchant secret is never stored in the POS; signatures are made server-side.</p>
          <Field label="Mode">{modeSel(s.payhere.mode, (v) => setS({ ...s, payhere: { ...s.payhere, mode: v } }))}</Field>
          <Field label="Merchant ID"><input className="input mono" value={s.payhere.merchantId} onChange={(e) => setS({ ...s, payhere: { ...s.payhere, merchantId: e.target.value } })} /></Field>
          <button className="btn" onClick={() => setDemo("payhere")}>Try a sample payment</button>
        </div>
        <div className="card card-body stack">
          <div className="row between"><h3>LankaQR</h3><span className="badge info">{s.lankaqr.mode}</span></div>
          <p className="small muted">Dynamic LankaQR (EMVCo format) on the customer display or bill. 0% merchant fee up to Rs 5,000. Replace the sample merchant ID with the one from the acquiring bank.</p>
          <Field label="Mode">{modeSel(s.lankaqr.mode, (v) => setS({ ...s, lankaqr: { ...s.lankaqr, mode: v } }))}</Field>
          <div className="grid cols-2">
            <Field label="Merchant name"><input className="input" value={s.lankaqr.merchantName} onChange={(e) => setS({ ...s, lankaqr: { ...s.lankaqr, merchantName: e.target.value } })} /></Field>
            <Field label="City"><input className="input" value={s.lankaqr.merchantCity} onChange={(e) => setS({ ...s, lankaqr: { ...s.lankaqr, merchantCity: e.target.value } })} /></Field>
            <Field label="Merchant ID"><input className="input mono" value={s.lankaqr.merchantId} onChange={(e) => setS({ ...s, lankaqr: { ...s.lankaqr, merchantId: e.target.value } })} /></Field>
            <Field label="MCC"><input className="input mono" value={s.lankaqr.mcc} onChange={(e) => setS({ ...s, lankaqr: { ...s.lankaqr, mcc: e.target.value } })} /></Field>
          </div>
          <button className="btn" onClick={() => setDemo("lankaqr")}>Show a sample QR</button>
        </div>
        <div className="card card-body stack">
          <div className="row between"><h3>WhatsApp reports</h3><span className="badge info">{s.whatsapp.mode}</span></div>
          <p className="small muted">End-of-day report (Daily Revenue, Item-wise, Covers, Sales) to managers. Needs a Meta Business account, a dedicated number and an approved “eod_report” template.</p>
          <Field label="Mode">{modeSel(s.whatsapp.mode, (v) => setS({ ...s, whatsapp: { ...s.whatsapp, mode: v } }))}</Field>
          <Field label="Send at"><input className="input" type="time" value={s.whatsapp.eodTime} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, eodTime: e.target.value } })} /></Field>
          <Field label="Managers (name, +94 number), one per line">
            <textarea className="textarea" value={s.whatsapp.eodRecipients.map((r) => `${r.name}, ${r.phone}`).join("\n")} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, eodRecipients: e.target.value.split("\n").filter(Boolean).map((l) => { const [name, phone] = l.split(","); return { name: (name ?? "").trim(), phone: (phone ?? "").trim() }; }) } })} />
          </Field>
        </div>
        <div className="card card-body stack">
          <h3>Accounting export</h3>
          <p className="small muted">The books are kept in the built-in ledger (Finance). This setting is only for groups that also consolidate in an external system: export the journal entries and SAF-T file from Finance and the Audit Center, or connect ERPNext/Akaunting later.</p>
          <Field label="Target">
            <select className="select" value={s.accountingExport.target} onChange={(e) => setS({ ...s, accountingExport: { ...s.accountingExport, target: e.target.value as IntegrationSettings["accountingExport"]["target"] } })}>
              <option value="excel">Excel workbook</option>
              <option value="erpnext">ERPNext (planned connector)</option>
              <option value="akaunting">Akaunting (planned connector)</option>
            </select>
          </Field>
          {s.accountingExport.target !== "excel" ? <Field label="Server URL"><input className="input" value={s.accountingExport.baseUrl ?? ""} onChange={(e) => setS({ ...s, accountingExport: { ...s.accountingExport, baseUrl: e.target.value } })} /></Field> : null}
        </div>
      </div>
      {demo ? (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setDemo(null)}>
          <div className="modal">
            <div className="modal-head"><h2>{demo === "lankaqr" ? "LankaQR sample" : "PayHere sample"}</h2><button className="btn ghost icon-btn" onClick={() => setDemo(null)}>✕</button></div>
            <div className="modal-body stack" style={{ alignItems: "center" }}>
              <QrCode data={demo === "lankaqr" ? lankaQrPayload({ ...s.lankaqr, amount, reference: "26NOV_W01_1" }) : payhereCheckout({ mode: "mock", merchantId: s.payhere.merchantId, orderId: "26NOV_W01_1", amount, items: "Sample bill", returnUrl: location.origin, notifyUrl: `${location.origin}/payhere/notify` }).url} />
              <strong className="num">{money(amount)}</strong>
              <p className="small muted" style={{ textAlign: "center" }}>{demo === "lankaqr" ? "EMVCo payload with CRC. Real bank merchant IDs make this scannable by any LankaQR app." : "Mock checkout link. In sandbox mode this opens the PayHere sandbox checkout page."}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
