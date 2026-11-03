import { useState } from "react";
import { newId } from "@pos/core";
import { type ExchangeRate, type JournalVoucher, type LineInput, type Voucher, LEDGER as L } from "@pos/ledger";
import { Field, Modal, ModuleOff } from "../../components/ui";
import { amount, money, toCents, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { AccountSelect, CostCenterSelect, VoucherList, canBooks, newDraftBase, useLedgerAction, useLedgerSettings, useParties } from "./shared";

interface DraftLine {
  account: string;
  debit: string;
  credit: string;
  costCenter: string;
  party: string;
  memo: string;
}

const blank = (): DraftLine => ({ account: "", debit: "", credit: "", costCenter: "", party: "", memo: "" });

function toDraft(l: LineInput): DraftLine {
  return {
    account: l.account,
    debit: l.debit ? String(l.debit / 100) : "",
    credit: l.credit ? String(l.credit / 100) : "",
    costCenter: l.costCenter ?? "",
    party: l.partyType && l.partyId ? `${l.partyType}:${l.partyId}` : "",
    memo: l.memo ?? "",
  };
}

/** Manual journal: balanced lines with cost centre and party, optional foreign currency. */
export function JournalEditor({ voucher, onClose }: { voucher?: JournalVoucher; onClose: () => void }) {
  const { actor, store, toast } = useApp();
  const ls = useLedgerSettings();
  const parties = useParties();
  const rates = useCollection<ExchangeRate>(L.exchangeRates) ?? [];
  const { run, busy } = useLedgerAction();
  const [date, setDate] = useState(voucher?.postingDate ?? todayColombo());
  const [remarks, setRemarks] = useState(voucher?.remarks ?? "");
  const [currency, setCurrency] = useState(voucher?.currency ?? "LKR");
  const [rate, setRate] = useState(String((voucher?.exchangeRateMicros ?? 1_000_000) / 1e6));
  const [lines, setLines] = useState<DraftLine[]>(voucher ? voucher.lines.map(toDraft) : [blank(), blank()]);
  const currencies = ["LKR", ...new Set(rates.map((r) => r.currency))];
  const dr = lines.reduce((a, l) => a + toCents(l.debit || 0), 0);
  const cr = lines.reduce((a, l) => a + toCents(l.credit || 0), 0);
  const balanced = dr === cr && dr > 0;
  const set = (i: number, patch: Partial<DraftLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  function pickCurrency(c: string) {
    setCurrency(c);
    if (c === "LKR") setRate("1");
    else {
      const latest = rates.filter((r) => r.currency === c && r.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (latest) setRate(String(latest.rateMicros / 1e6));
    }
  }

  async function save(submit: boolean) {
    if (!store || !actor) return;
    if (!remarks.trim()) return toast("Add a description", true);
    if (!balanced) return toast("Debits must equal credits", true);
    const bad = lines.find((l) => (toCents(l.debit || 0) || toCents(l.credit || 0)) && !l.account);
    if (bad) return toast("Every line with an amount needs an account", true);
    const out: LineInput[] = lines
      .filter((l) => l.account && (toCents(l.debit || 0) || toCents(l.credit || 0)))
      .map((l) => {
        const [pt, pid] = l.party.split(":");
        return {
          account: l.account,
          debit: toCents(l.debit || 0),
          credit: toCents(l.credit || 0),
          ...(l.costCenter ? { costCenter: l.costCenter } : {}),
          ...(pt && pid ? { partyType: pt as "customer" | "supplier", partyId: pid } : {}),
          ...(l.memo ? { memo: l.memo } : {}),
        };
      });
    const base = newDraftBase(actor.uid, ls?.defaultCostCenter ?? "MAIN");
    const v: JournalVoucher = {
      ...base,
      ...(voucher ? { createdAt: voucher.createdAt } : {}),
      id: voucher?.id ?? `JV-${newId()}`,
      type: "journal",
      postingDate: date,
      remarks: remarks.trim(),
      currency,
      exchangeRateMicros: Math.round(Number(rate) * 1e6) || 1_000_000,
      lines: out,
    };
    await store.set(L.vouchers, v);
    if (submit) {
      const r = await run<{ status: string; number?: string }>({ action: "submit", voucherId: v.id }, (x) => (x.status === "posted" ? `Posted ${x.number ?? ""}` : "Submitted for approval"));
      if (!r) return;
    } else toast("Draft saved");
    onClose();
  }

  return (
    <Modal
      wide
      title={voucher ? "Edit journal" : "New journal"}
      onClose={onClose}
      footer={
        <div className="row between" style={{ width: "100%" }}>
          <span className={`small ${balanced ? "" : "muted"}`}>
            Debits {amount(dr)} · Credits {amount(cr)} {balanced ? <span className="badge good">Balanced</span> : dr || cr ? <span className="badge bad">Off by {amount(Math.abs(dr - cr))}</span> : null}
          </span>
          <div className="row">
            <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
            <button className="btn primary" disabled={busy || !balanced} onClick={() => save(true)}>Submit</button>
          </div>
        </div>
      }
    >
      <div className="stack">
        <div className="grid cols-4">
          <Field label="Posting date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Currency">
            <select className="select" value={currency} onChange={(e) => pickCurrency(e.target.value)}>
              {currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          {currency !== "LKR" ? <Field label={`Rate (LKR per ${currency})`}><input className="input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></Field> : null}
        </div>
        <Field label="Description"><input className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Accrue October electricity" /></Field>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th style={{ minWidth: 220 }}>Account</th><th>Cost centre</th><th>Party</th><th>Memo</th><th className="num">Debit</th><th className="num">Credit</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td><AccountSelect value={l.account} onChange={(v) => set(i, { account: v })} /></td>
                  <td><CostCenterSelect value={l.costCenter} onChange={(v) => set(i, { costCenter: v })} /></td>
                  <td>
                    <select className="select" value={l.party} onChange={(e) => set(i, { party: e.target.value })}>
                      <option value="">—</option>
                      <optgroup label="Suppliers">{parties.vendors.map((v) => <option key={v.id} value={`supplier:${v.id}`}>{v.name}</option>)}</optgroup>
                      <optgroup label="Customers">{parties.customers.map((c) => <option key={c.id} value={`customer:${c.id}`}>{c.name}</option>)}</optgroup>
                    </select>
                  </td>
                  <td><input className="input" value={l.memo} onChange={(e) => set(i, { memo: e.target.value })} /></td>
                  <td><input className="input num" inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, ...(e.target.value ? { credit: "" } : {}) })} style={{ width: 120 }} /></td>
                  <td><input className="input num" inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, ...(e.target.value ? { debit: "" } : {}) })} style={{ width: 120 }} /></td>
                  <td>{lines.length > 2 ? <button className="btn ghost sm" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">✕</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setLines([...lines, blank()])}>Add line</button>
          {!balanced && dr !== cr ? (
            <button className="btn sm ghost" onClick={() => setLines([...lines, { ...blank(), ...(dr > cr ? { credit: String((dr - cr) / 100) } : { debit: String((cr - dr) / 100) }) }])}>Add balancing line</button>
          ) : null}
        </div>
        <p className="small muted">
          {ls && ls.journalApprovalThreshold > 0 ? `Journals of ${money(ls.journalApprovalThreshold)} or more need approval by a second person.` : "Every manual journal is approved by a second person before it posts."} Numbers are given only when a journal posts, so the series has no gaps.
        </p>
      </div>
    </Modal>
  );
}

export function JournalsPage() {
  const { on, role } = useApp();
  const [creating, setCreating] = useState(false);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  return (
    <>
      <VoucherList
        types={["journal", "reversal"]}
        title="Journals"
        subtitle="Manual journal entries and reversals. Posted entries can't be edited or deleted – reverse them instead, with a reason."
        actions={canBooks(role) ? <button className="btn primary" onClick={() => setCreating(true)}>New journal</button> : null}
        editor={(v: Voucher, close) => (v.type === "journal" ? <JournalEditor voucher={v} onClose={close} /> : null)}
      />
      {creating ? <JournalEditor onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/** Every accounting document, whatever its source (S/4 "Manage Journal Entries"). */
export function DocumentsPage() {
  const { on } = useApp();
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  return (
    <VoucherList
      types={["journal", "purchaseInvoice", "salesInvoice", "payment", "posDay", "depreciation", "assetDisposal", "periodClose", "reversal"]}
      title="All documents"
      subtitle="Every document that reached the ledger, from POS days and supplier invoices to depreciation and year-end closing."
    />
  );
}

export function ApprovalsPage() {
  const { on, actor } = useApp();
  const vouchers = useCollection<Voucher>(L.vouchers, { where: [["status", "==", "submitted"]] }) ?? [];
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const mine = vouchers.filter((v) => v.createdBy === actor?.uid || v.submittedBy === actor?.uid).length;
  return (
    <VoucherList
      types={["journal", "purchaseInvoice", "salesInvoice", "payment", "reversal"]}
      title="Approvals"
      initialStatus="submitted"
      subtitle={`Documents waiting for a second person (maker–checker). ${mine ? `${mine} of them were prepared by you, so someone else must approve them.` : ""}`}
    />
  );
}
