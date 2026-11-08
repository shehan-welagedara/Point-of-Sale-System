import { useMemo, useState } from "react";
import { type BillLayout, type BrandingSettings, type Check, type Discount, type MenuItem, type TenderMedia, COLLECTIONS as C, activeLines, computeCheckTotals, lankaQrPayload } from "@pos/core";
import { DEFAULT_BILL_LAYOUT, TAX_INVOICE_ALWAYS, TAX_INVOICE_LOCKED, buildBill, feedbackLink, resolveBillLayout, widthForPaper } from "@pos/printing";
import { Field, PageHead, Seg, Toggle } from "../../components/ui";
import { ReceiptView } from "../../components/Receipt";
import { useDraft } from "../../lib/useDraft";
import { useApp, useCollection } from "../../state/app";

type Doc = "invoice" | "guestCheck";

interface Switch {
  key: { [K in keyof BillLayout]: BillLayout[K] extends boolean ? K : never }[keyof BillLayout];
  label: string;
  help?: string;
}

const GROUPS: { title: string; switches: Switch[] }[] = [
  {
    title: "Header",
    switches: [
      { key: "showLogo", label: "Logo", help: "Printed from the printer's memory. Load it once with the printer's logo utility." },
      { key: "showAddress", label: "Address" },
      { key: "showPhone", label: "Phone number" },
      { key: "showEmail", label: "Email" },
      { key: "showWebsite", label: "Website" },
      { key: "showTradingName", label: "'Trading as' name (when it differs from the legal name)" },
    ],
  },
  {
    title: "Check details",
    switches: [
      { key: "showCheckNo", label: "Check number" },
      { key: "showOrderType", label: "Order type (Dine-in, Takeaway…)" },
      { key: "showTable", label: "Table" },
      { key: "showServer", label: "Employee name" },
      { key: "showCovers", label: "Number of guests" },
      { key: "showPrintedTime", label: "Printed time (guest checks)" },
    ],
  },
  {
    title: "Items",
    switches: [
      { key: "showColumnHeader", label: "Column headings (Qty Item … Amount)" },
      { key: "combineSameItems", label: "Combine identical items into one line" },
      { key: "showUnitPrice", label: "Unit price under items ordered more than once" },
      { key: "showModifiers", label: "Modifiers (Extra spicy, No onion…)" },
      { key: "showModifierPrices", label: "Modifier prices" },
      { key: "showNotes", label: "Item notes" },
      { key: "showSeat", label: "Seat numbers" },
    ],
  },
  {
    title: "Totals and payment",
    switches: [
      { key: "showItemCount", label: "Number of items" },
      { key: "showSubtotal", label: "Subtotal" },
      { key: "showSavings", label: "'You saved Rs …' when discounts apply" },
      { key: "showPayments", label: "Payment methods" },
      { key: "showPaymentRefs", label: "Payment references (card approval codes)" },
      { key: "showChange", label: "Change given" },
    ],
  },
  {
    title: "Footer",
    switches: [
      { key: "showPayQr", label: "LankaQR pay-by-QR on guest checks", help: "Needs the LankaQR module." },
      { key: "showFeedbackQr", label: "Feedback QR on invoices" },
      { key: "showCustomer", label: "Guest name and loyalty points" },
      { key: "showPoweredBy", label: "'Powered by' line" },
    ],
  },
];

/** A realistic check from this business's own menu, for the live preview. */
function useSampleCheck(withBuyer: boolean, withDiscount: boolean) {
  const { settings } = useApp();
  const menu = (useCollection<MenuItem>(C.menuItems) ?? []).filter((m) => m.active && !m.openPrice).sort((a, b) => a.sortOrder - b.sortOrder);
  const discounts = useCollection<Discount>(C.discounts) ?? [];
  const tenders = useCollection<TenderMedia>(C.tenderMedia) ?? [];
  return useMemo(() => {
    const picks = menu.length >= 3 ? [menu[0]!, menu[Math.floor(menu.length / 2)]!, menu[menu.length - 1]!] : [];
    const fallback = [
      { id: "S1", name: "Chicken Kottu", price: 120_000 },
      { id: "S2", name: "Lime Juice", price: 45_000 },
      { id: "S3", name: "Watalappan", price: 65_000 },
    ];
    const items = picks.length ? picks.map((m) => ({ id: m.id, name: m.name, price: m.price })) : fallback;
    const checkPct = discounts.filter((d) => d.active && d.type === "percent" && d.scope === "check");
    const pct = checkPct.find((d) => !/staff|employee/i.test(d.name)) ?? checkPct[0];
    const cash = tenders.find((t) => t.type === "cash") ?? { id: "CASH", name: "Cash", type: "cash" as const };
    const now = new Date().toISOString();
    const lines = items.map((m, i) => ({
      id: `L${i}`, menuItemId: m.id, name: m.name, qty: i === 0 ? 2 : 1, unitPrice: m.price, taxClass: "standard" as const, kotRoute: "kitchen" as const, categoryId: "", discountIds: [], sentRound: 1,
      modifiers: i === 0 ? [{ groupId: "g", optionId: "o", name: "Extra cheese", price: 15_000 }] : [],
      ...(i === 1 ? { note: "Less sugar" } : {}),
      ...(i === 0 ? { seat: 1 } : {}),
    }));
    const base: Check = {
      id: "preview", propertyId: "", rvcId: "", workstationId: "W01", checkNo: 1042, orderTypeId: "dine-in", tableId: "T5", covers: 2, staffId: "S", status: "closed", sentRounds: 1, businessDate: now.slice(0, 10), openedAt: now, closedAt: now, channel: "pos",
      checkDiscountIds: withDiscount && pct ? [pct.id] : [], change: 0, lines, payments: [],
      ...(withBuyer ? { buyer: { name: "Lanka Traders (Pvt) Ltd", tin: "114567890", address: "No. 8, Temple Road, Kandy" } } : {}),
    };
    const ctx = { tax: settings.tax, business: settings.business, discounts: new Map(discounts.map((d) => [d.id, d])) };
    const totals = computeCheckTotals(base, ctx);
    const tendered = Math.ceil(totals.amountDue / 100_000) * 100_000 + 100_000;
    const check: Check = { ...base, payments: [{ id: "P", tenderId: cash.id, amount: tendered, applied: totals.amountDue, tendered, at: now, by: "S" }], change: tendered - totals.amountDue };
    return { check, totals, tenders: new Map<string, TenderMedia>(tenders.map((t) => [t.id, t])), hasLines: activeLines(base).length > 0 };
  }, [menu, discounts, tenders, settings.tax, settings.business, withBuyer, withDiscount]);
}

/** Back office → POS Configuration → Bill designer: what the printed bills show, with a live preview. */
export function BillDesignerPage() {
  const { settings, saveSetting, toast, on } = useApp();
  const [layout, setLayout, saved] = useDraft<BillLayout>(resolveBillLayout(settings.branding.bill));
  const [header, setHeader] = useDraft(settings.branding.receiptHeaderLines.join("\n"));
  const [footer, setFooter] = useDraft(settings.branding.receiptFooterLines.join("\n"));
  const [doc, setDoc] = useState<Doc>("invoice");
  const [paper, setPaper] = useState<80 | 58>(80);
  const [buyer, setBuyer] = useState(false);
  const [discount, setDiscount] = useState(true);
  const set = (patch: Partial<BillLayout>) => setLayout({ ...layout, ...patch });
  const vat = settings.business.vatRegistered;
  const sample = useSampleCheck(buyer, discount);
  const branding: BrandingSettings = { ...settings.branding, receiptHeaderLines: lines(header), receiptFooterLines: lines(footer), bill: layout };
  const qr =
    doc === "invoice"
      ? (() => { const url = feedbackLink(layout, "26NOV_W01_1042", settings.business.website); return url ? { data: url, caption: layout.feedbackCaption } : undefined; })()
      : layout.showPayQr && on("lankaqr")
        ? { data: lankaQrPayload({ ...settings.integrations.lankaqr, amount: sample.totals.amountDue, reference: "CHK1042" }), caption: "Scan to pay with LankaQR" }
        : undefined;
  const preview = buildBill({
    kind: doc, check: sample.check, totals: sample.totals, business: settings.business, branding, width: widthForPaper(paper), staffName: "Nimali", orderTypeName: "Dine-in", tableName: "5", tenders: sample.tenders,
    ...(doc === "invoice" ? { invoiceNo: "26NOV_W01_1042", issuedAt: sample.check.closedAt } : {}),
    printLogo: Boolean(settings.branding.logoDataUrl), customer: { name: "Ayesha Perera", points: 420 }, ...(qr ? { qr } : {}),
  });

  async function save() {
    const changed = Object.fromEntries(Object.entries(layout).filter(([k, v]) => DEFAULT_BILL_LAYOUT[k as keyof BillLayout] !== v)) as Partial<BillLayout>;
    await saveSetting("branding", { ...settings.branding, receiptHeaderLines: lines(header), receiptFooterLines: lines(footer), bill: changed });
    saved();
    toast("Bill layout saved. New bills print with it straight away.");
  }

  const locked = (k: keyof BillLayout) => vat && doc === "invoice" && k in TAX_INVOICE_LOCKED;

  return (
    <div className="page fill">
      <PageHead
        title="Bill designer"
        subtitle="Choose what your guest checks and invoices show. The preview uses your own menu and business details."
        actions={
          <>
            <button className="btn" onClick={() => { setLayout({ ...DEFAULT_BILL_LAYOUT }); toast("Standard layout restored (not saved yet)"); }}>Standard layout</button>
            <button className="btn primary" onClick={save}>Save</button>
          </>
        }
      />
      <div className="appearance-grid bill-grid">
        <div className="stack appearance-col">
          {vat ? (
            <div className="callout small">
              <strong>Tax invoice rules apply.</strong> Your business is VAT registered, so every final bill is an IRD tax invoice. These always print, whatever you switch off: {TAX_INVOICE_ALWAYS.join("; ")}.
            </div>
          ) : null}
          <div className="card card-body stack">
            <h3>Titles and wording</h3>
            <div className="grid cols-2">
              <Field label="Final bill title" help={vat ? "Fixed as TAX INVOICE for VAT-registered businesses." : undefined}><input className="input" disabled={vat} value={vat ? "TAX INVOICE" : layout.invoiceTitle} onChange={(e) => set({ invoiceTitle: e.target.value })} /></Field>
              <Field label="Guest check title"><input className="input" value={layout.guestCheckTitle} onChange={(e) => set({ guestCheckTitle: e.target.value })} /></Field>
              <Field label="Employee label"><input className="input" value={layout.serverLabel} placeholder="Server" onChange={(e) => set({ serverLabel: e.target.value })} /></Field>
              <Field label="Total label"><input className="input" value={layout.totalLabel} onChange={(e) => set({ totalLabel: e.target.value })} /></Field>
            </div>
            <Field label="Note on guest checks" help="Leave empty for no note."><input className="input" value={layout.guestCheckNote} onChange={(e) => set({ guestCheckNote: e.target.value })} /></Field>
            <div className="grid cols-2">
              <Field label="Lines under the address (one per line)"><textarea className="input" rows={3} value={header} onChange={(e) => setHeader(e.target.value)} placeholder="e.g. Authentic Sri Lankan Kitchen" /></Field>
              <Field label="Footer lines (one per line)"><textarea className="input" rows={3} value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="e.g. Thank you! Come again" /></Field>
            </div>
          </div>
          <div className="card card-body stack">
            <h3>Print style</h3>
            <div className="grid cols-2">
              <Field label="Header alignment"><Seg<BillLayout["headerAlign"]> value={layout.headerAlign} onChange={(v) => set({ headerAlign: v })} options={[{ value: "center", label: "Centre" }, { value: "left", label: "Left" }]} /></Field>
              <Field label="Quantity"><Seg<BillLayout["qtyStyle"]> value={layout.qtyStyle} onChange={(v) => set({ qtyStyle: v })} options={[{ value: "before", label: "2 Kottu" }, { value: "after", label: "Kottu x2" }]} /></Field>
              <Field label="Title size"><Seg<"1" | "2"> value={String(layout.titleSize) as "1" | "2"} onChange={(v) => set({ titleSize: Number(v) as 1 | 2 })} options={[{ value: "1", label: "Normal" }, { value: "2", label: "Large" }]} /></Field>
              <Field label="Total size"><Seg<"1" | "2"> value={String(layout.totalSize) as "1" | "2"} onChange={(v) => set({ totalSize: Number(v) as 1 | 2 })} options={[{ value: "1", label: "Normal" }, { value: "2", label: "Large" }]} /></Field>
              <Field label="Discounts"><Seg<BillLayout["discountDetail"]> value={layout.discountDetail} onChange={(v) => set({ discountDetail: v })} options={[{ value: "each", label: "Each discount" }, { value: "total", label: "One total" }]} /></Field>
              <Field label={`Blank lines before the cut: ${layout.extraFeed}`}><input type="range" min={0} max={6} value={layout.extraFeed} onChange={(e) => set({ extraFeed: Number(e.target.value) })} /></Field>
            </div>
          </div>
          {GROUPS.map((g) => (
            <div key={g.title} className="card card-body stack tight">
              <h3>{g.title}</h3>
              {g.switches.map((s) => (
                <div key={s.key} className="row between bill-switch">
                  <span className="small">
                    {s.label}
                    {locked(s.key) ? <span className="badge info" style={{ marginLeft: 6 }}>Always on a tax invoice</span> : null}
                    {s.help ? <span className="tiny muted" style={{ display: "block" }}>{s.help}</span> : null}
                  </span>
                  <Toggle on={locked(s.key) || layout[s.key]} disabled={locked(s.key)} onChange={(v) => set({ [s.key]: v } as Partial<BillLayout>)} label={s.label} />
                </div>
              ))}
              {g.title === "Footer" && layout.showFeedbackQr ? (
                <div className="grid cols-2">
                  <Field label="Feedback link" help="{invoice} = invoice number, {website} = your website."><input className="input" value={layout.feedbackUrl} onChange={(e) => set({ feedbackUrl: e.target.value })} /></Field>
                  <Field label="Caption under the QR"><input className="input" value={layout.feedbackCaption} onChange={(e) => set({ feedbackCaption: e.target.value })} /></Field>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="stack appearance-col bill-preview-col">
          <div className="card card-body stack">
            <div className="row wrap between">
              <Seg<Doc> value={doc} onChange={setDoc} options={[{ value: "invoice", label: vat ? "Tax invoice" : "Invoice" }, { value: "guestCheck", label: "Guest check" }]} />
              <Seg<"80" | "58"> value={String(paper) as "80" | "58"} onChange={(v) => setPaper(Number(v) as 80 | 58)} options={[{ value: "80", label: "80 mm" }, { value: "58", label: "58 mm" }]} />
            </div>
            <div className="row wrap">
              <label className="row small"><input type="checkbox" checked={discount} onChange={(e) => setDiscount(e.target.checked)} /> With a discount</label>
              {doc === "invoice" ? <label className="row small"><input type="checkbox" checked={buyer} onChange={(e) => setBuyer(e.target.checked)} /> VAT-registered buyer</label> : null}
            </div>
            <div className="bill-preview" aria-label="Bill preview">
              <ReceiptView doc={preview} logo={settings.branding.logoDataUrl} />
            </div>
            {!settings.business.website && layout.showFeedbackQr && layout.feedbackUrl.includes("{website}") ? <p className="tiny muted">Add your website under Administration → Business details to print the feedback QR.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}
