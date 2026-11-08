import { useState } from "react";
import { Link } from "react-router-dom";
import { type Customer, type InventoryItem, type Location, type Vendor, COLLECTIONS as C } from "@pos/core";
import { LEDGER as L } from "@pos/ledger";
import { Field, Modal, ModuleOff, PageHead, Stat } from "../../components/ui";
import { type AccountingImport, type BooksImportResult, buildAccountingWorkbook, importBooks, parseAccountingWorkbook, summarizeImport } from "../../lib/excel";
import { downloadBuffer, money, todayColombo } from "../../lib/format";
import { setBusy as setAppBusy } from "../../lib/version";
import { useApp, useCollection, useStore } from "../../state/app";
import { useAccounts, useLedgerSettings } from "./shared";

type Summary = Awaited<ReturnType<typeof summarizeImport>>;

const fyStart = () => {
  const t = todayColombo();
  return `${Number(t.slice(5, 7)) >= 4 ? t.slice(0, 4) : Number(t.slice(0, 4)) - 1}-04-01`;
};

/**
 * Finance → Excel import: brings a business's books in from the accounting workbook — opening
 * balances, opening stock, suppliers and customers with what they owe, supplier bills (paid or not),
 * expenses, daily sales from manual bills and fixed assets. Checked row by row before anything is
 * saved; importing the same file again skips what is already in.
 */
export function AccountingImportPage() {
  const { actor, settings, tenant, ledger, toast, on, role } = useApp();
  const store = useStore();
  const ls = useLedgerSettings();
  const { list: chart } = useAccounts();
  const items = useCollection<InventoryItem>(on("inventory") ? C.inventoryItems : null) ?? [];
  const locations = useCollection<Location>(on("inventory") ? C.locations : null) ?? [];
  const openings = useCollection<{ id: string; postingDate: string; status: string; number?: string }>(on("accounting") ? L.vouchers : null, { where: [["opening", "==", true]] }) ?? [];
  const [asAt, setAsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ file: string; data: AccountingImport; summary: Summary } | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [result, setResult] = useState<BooksImportResult | null>(null);

  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const startDate = asAt || openings[0]?.postingDate || fyStart();
  const vatOn = settings.business.vatRegistered;
  const ssclOn = settings.business.ssclLiable;
  const canImport = ["owner", "admin", "accountant"].includes(role ?? "");
  const name = tenant?.name ?? settings.business.tradingName;

  async function download(sample: boolean) {
    downloadBuffer(await buildAccountingWorkbook({ chart, items, asAt: startDate, sample, ...(sample ? {} : { businessName: name }) }), sample ? "accounting-workbook-EXAMPLE.xlsx" : `accounting-workbook-${startDate}.xlsx`);
  }

  async function onFile(file: File) {
    setBusy(true);
    try {
      const [vendors, customers] = await Promise.all([store.list<Vendor>(C.vendors), store.list<Customer>(C.customers)]);
      const data = await parseAccountingWorkbook(await file.arrayBuffer(), { chart, vendors, customers, items, vatRegistered: vatOn, ssclRegistered: ssclOn, asAt: startDate, allowSample: Boolean(settings.business.isSample) });
      setCheck({ file: file.name, data, summary: await summarizeImport(data, items) });
    } catch (e) {
      toast(`Could not read the workbook: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!check || !actor || !ls) return;
    setBusy(true);
    setAppBusy("books-import", true);
    setProgress({ done: 0, total: check.summary.documents, label: "Starting…" });
    try {
      const res = await importBooks(check.data, {
        store,
        ledger,
        uid: actor.uid,
        asAt: startDate,
        costCenter: ls.defaultCostCenter,
        propertyId: settings.pos.defaultPropertyId || ls.defaultCostCenter,
        locationId: locations.find((l) => l.isDefault)?.id ?? locations[0]?.id ?? "MAIN",
        accounting: settings.accounting.accounts,
        vatRegistered: vatOn,
        ssclRegistered: ssclOn,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      setResult(res);
      setCheck(null);
      toast(res.failed.length ? `Imported with ${res.failed.length} problem(s): see the results` : "Import complete");
    } catch (e) {
      toast(`Import stopped: ${(e as Error).message}. Choose the same file again to finish: what is already in is skipped.`, true);
    } finally {
      setBusy(false);
      setAppBusy("books-import", false);
      setProgress(null);
    }
  }

  const journalsWait = (ls?.journalApprovalThreshold ?? 0) === 0;
  const s = check?.summary;
  return (
    <div className="page">
      <PageHead
        title="Excel import: bring your books in"
        subtitle="Opening balances, opening stock, suppliers and customers with what they owe, supplier bills, expenses, daily sales from manual bills and fixed assets, from one workbook. Checked before anything is saved."
      />
      <div className="grid cols-3">
        <div className="card card-body stack">
          <h3>1. The date your books start</h3>
          <Field label="Books start on" help="Opening balances are on this date; bills, expenses and sales after it keep their own dates. Usually the first day of the fiscal year or of a month.">
            <input className="input" type="date" value={startDate} onChange={(e) => setAsAt(e.target.value)} disabled={openings.some((o) => o.status !== "draft")} aria-label="Books start on" />
          </Field>
          {openings.some((o) => o.status !== "draft") ? <p className="tiny muted">Opening balances are already in ({openings.map((o) => o.number ?? o.id).join(", ")}). Later imports add bills, expenses and sales.</p> : null}
        </div>
        <div className="card card-body stack">
          <h3>2. Get the workbook</h3>
          <p className="small muted">The example is filled with a small restaurant's figures so you can see what goes where. Fill the blank copy with your own.</p>
          <button className="btn" onClick={() => download(true)}>Download the example (filled in)</button>
          <button className="btn" onClick={() => download(false)}>Download the blank workbook</button>
        </div>
        <div className="card card-body stack">
          <h3>3. Import</h3>
          <p className="small muted">Choose the filled workbook. You see totals and any problems first; nothing is saved until you press Import.</p>
          {canImport ? (
            <input type="file" accept=".xlsx" disabled={busy} aria-label="Accounting workbook" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
          ) : (
            <p className="small">Only the owner, an administrator or the accountant can import.</p>
          )}
          <p className="tiny muted">Bill photos: after importing, open each bill under <Link to="/emc/finance/payables">Payables</Link> or <Link to="/emc/finance/bills">Bills &amp; receipts</Link> to attach its photo.</p>
        </div>
      </div>

      {progress ? (
        <div className="card card-body stack" role="status">
          <strong>Importing… {progress.done} of {progress.total}</strong>
          <progress max={Math.max(1, progress.total)} value={progress.done} style={{ width: "100%" }} />
          <span className="small muted">{progress.label}. Keep this page open.</span>
        </div>
      ) : null}

      {result ? (
        <div className="card card-body stack">
          <h3>Import results</h3>
          <div className="grid cols-4">
            <Stat label="Posted" value={result.posted.length} tone="good" />
            <Stat label="Waiting for approval" value={result.awaitingApproval.length} {...(result.awaitingApproval.length ? { tone: "warn" as const } : {})} />
            <Stat label="Already in (skipped)" value={result.skipped.length} />
            <Stat label="Problems" value={result.failed.length} {...(result.failed.length ? { tone: "bad" as const } : {})} />
          </div>
          <p className="small muted">
            New: {result.created.accounts} account(s), {result.created.suppliers} supplier(s), {result.created.customers} customer(s), {result.created.assets} fixed asset(s).
            {result.retainedEarnings ? ` Retained earnings (earlier years): ${money(Math.abs(result.retainedEarnings))} ${result.retainedEarnings > 0 ? "profit" : "loss"}.` : ""}
          </p>
          {result.awaitingApproval.length ? (
            <div className="callout warn">
              <strong>Waiting for a second person</strong> — approve under <Link to="/emc/finance/approvals">Finance → Approvals</Link>:
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.awaitingApproval.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ) : null}
          {result.failed.length ? (
            <div className="callout bad">
              <strong>Not imported</strong> — fix and choose the file again (what is already in is skipped):
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.failed.map((f, i) => <li key={i}>{f.what}: {f.message}</li>)}</ul>
            </div>
          ) : null}
          <div className="row wrap">
            <Link className="btn" to="/emc/finance/statements">Trial balance and statements</Link>
            <Link className="btn" to="/emc/finance/payables">Payables</Link>
            <Link className="btn" to="/emc/setup/checklist">Setup checklist</Link>
            <button className="btn ghost" onClick={() => setResult(null)}>Close</button>
          </div>
        </div>
      ) : null}

      {check && s ? (
        <Modal
          wide
          title={`Check results: ${check.file}`}
          onClose={() => setCheck(null)}
          footer={
            <>
              <span className="grow small muted">{check.data.errors.length ? `${check.data.errors.length} problem(s): fix them in the workbook and choose it again.` : `Ready: ${s.documents} document(s) to post.`}</span>
              <button className="btn" onClick={() => setCheck(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || check.data.errors.length > 0} onClick={run}>Import</button>
            </>
          }
        >
          <div className="stack">
            <p className="small">Books start on <strong>{startDate}</strong>.</p>
            <div className="grid cols-4">
              <Stat label="Opening balances" value={`${money(s.openingDebit)} Dr`} sub={`${money(s.openingCredit)} Cr`} />
              <Stat label="Opening stock (estimate)" value={money(s.stock)} sub={`${check.data.openingStock.length} item(s)`} />
              <Stat label="We owe suppliers" value={money(s.suppliersOwed)} sub={`${check.data.suppliers.length} supplier(s)`} />
              <Stat label="Customers owe us" value={money(s.customersOwe)} sub={`${check.data.customers.length} customer(s)`} />
              <Stat label="Fixed assets" value={money(s.assetsCost - s.assetsDepreciation)} sub={`cost ${money(s.assetsCost)}, ${check.data.assets.length} asset(s)`} />
              <Stat label="Supplier bills" value={money(s.bills)} sub={`${check.data.bills.length} bill(s), ${s.billsPaid} paid`} />
              <Stat label="Expenses" value={money(s.expenses)} sub={`${check.data.expenses.length} row(s)`} />
              <Stat label="Daily sales" value={money(s.sales)} sub={`${check.data.sales.length} day(s)`} />
            </div>
            {s.retainedEarnings ? (
              <div className="callout">
                The opening figures don't balance by <strong>{money(Math.abs(s.retainedEarnings))}</strong>: this goes to <strong>3100 Retained earnings</strong> as {s.retainedEarnings > 0 ? "profits" : "losses"} of the years before the books start. If that looks wrong, check the opening balances (capital, loans, bank) before importing.
              </div>
            ) : null}
            {check.data.isSample ? <div className="callout warn">This is the example data. It is allowed here only because this is a demo business.</div> : null}
            {check.data.openingStock.length && !["owner", "admin"].includes(role ?? "") ? (
              <div className="callout warn">Opening stock changes the stores, which an accountant can't do: that part will be skipped. Ask the owner or an administrator to import this file, or count the opening stock under Inventory → Stock counts (type Opening stock).</div>
            ) : null}
            {journalsWait && (check.data.opening.length || check.data.sales.length || check.data.assets.length) ? (
              <div className="callout warn">Every journal needs approval by a second person in this business (Finance settings → journal approval limit 0). The opening balances and daily sales will wait under Finance → Approvals until someone else approves them.</div>
            ) : null}
            {check.data.errors.length ? (
              <div className="callout bad">
                <strong>Problems to fix</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{check.data.errors.slice(0, 80).map((e, i) => <li key={i}>{e.sheet}{e.row ? ` row ${e.row}` : ""}: {e.message}</li>)}</ul>
                {check.data.errors.length > 80 ? <p className="small">…and {check.data.errors.length - 80} more.</p> : null}
              </div>
            ) : null}
            {check.data.warnings.length ? (
              <div className="callout warn">
                <strong>Please check</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{check.data.warnings.slice(0, 50).map((e, i) => <li key={i}>{e.sheet} row {e.row}: {e.message}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
