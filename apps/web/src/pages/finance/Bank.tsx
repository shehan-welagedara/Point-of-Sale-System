import { useMemo, useState } from "react";
import { newId } from "@pos/core";
import { type BankRecon, type BankStatement, type BankStatementLine, type LedgerEntry, LEDGER as L, bankAmount, parseStatementCsv, suggestMatches } from "@pos/ledger";
import { tablesToWorkbook } from "../../lib/excel";
import { Field, Modal, ModuleOff, PageHead, Stat, Explain } from "../../components/ui";
import { amount, downloadBuffer, money, toCents, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { AccountSelect, canBooks } from "./shared";

function ImportStatement({ account, onClose }: { account: string; onClose: () => void }) {
  const { store, actor, toast } = useApp();
  const [text, setText] = useState("");
  const [opening, setOpening] = useState("");
  const parsed = useMemo(() => (text ? parseStatementCsv(text) : null), [text]);
  const lines = parsed?.lines ?? [];
  const sum = lines.reduce((a, l) => a + l.amount, 0);

  async function save() {
    if (!store || !actor || !lines.length) return;
    const dates = lines.map((l) => l.date).sort();
    const st: BankStatement = {
      id: `BS-${newId()}`,
      account,
      from: dates[0]!,
      to: dates[dates.length - 1]!,
      openingBalance: toCents(opening || 0),
      closingBalance: toCents(opening || 0) + sum,
      lines,
      importedBy: actor.uid,
      importedAt: new Date().toISOString(),
    };
    await store.set(L.bankStatements, st);
    toast(`Imported ${lines.length} statement lines`);
    onClose();
  }

  return (
    <Modal
      wide
      title="Import bank statement"
      onClose={onClose}
      footer={<button className="btn primary" disabled={!lines.length} onClick={save}>Import {lines.length || ""} lines</button>}
    >
      <div className="stack">
        <Explain as="p" className="small muted">Download the statement from internet banking as CSV (Commercial Bank, Sampath, HNB, BOC and most others export Date, Description, Reference and Debit/Credit or Amount columns). Imported statements are kept unchanged as audit evidence.</Explain>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <Field label="…or paste the CSV"><textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"Date,Description,Reference,Debit,Credit\n03/11/2026,CHQ 100245,100245,125000.00,"} /></Field>
        <Field label="Opening balance on the statement"><input className="input" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} style={{ maxWidth: 200 }} /></Field>
        {parsed?.errors.length ? <div className="callout warn">{parsed.errors.slice(0, 5).map((e) => <div key={e}>{e}</div>)}</div> : null}
        {lines.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th className="num">Amount</th></tr></thead>
              <tbody>{lines.slice(0, 50).map((l) => <tr key={l.id}><td>{l.date}</td><td>{l.description}</td><td className="mono">{l.reference}</td><td className="num">{amount(l.amount)}</td></tr>)}</tbody>
              <tfoot><tr><td colSpan={3}>Net movement</td><td className="num">{amount(sum)}</td></tr></tfoot>
            </table>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** Bank reconciliation: statement lines matched one-to-one with ledger lines of the bank account. */
export function BankPage() {
  const { on, role, store, actor, toast } = useApp();
  const [account, setAccount] = useState("1010");
  const [importing, setImporting] = useState(false);
  const [selLine, setSelLine] = useState<string | null>(null);
  const [selEntry, setSelEntry] = useState<string | null>(null);
  const statements = useCollection<BankStatement>(L.bankStatements, { where: [["account", "==", account]] }) ?? [];
  const entries = useCollection<LedgerEntry>(L.ledger, { where: [["account", "==", account]] }) ?? [];
  const recons = useCollection<BankRecon>(L.bankRecons, { where: [["account", "==", account]] }) ?? [];
  const books = canBooks(role);

  const lines = useMemo(() => statements.flatMap((s) => s.lines.map((l) => ({ ...l, statementId: s.id }))).sort((a, b) => a.date.localeCompare(b.date)), [statements]);
  const matchedLines = new Set(recons.map((r) => `${r.statementId}:${r.statementLineId}`));
  const matchedEntries = new Set(recons.map((r) => r.ledgerEntryId));
  const openLines = lines.filter((l) => !matchedLines.has(`${l.statementId}:${l.id}`));
  const openEntries = entries.filter((e) => !matchedEntries.has(e.id)).sort((a, b) => a.postingDate.localeCompare(b.postingDate));
  // Line ids are unique within a statement only, so match on "statement:line".
  const suggestions = useMemo(() => suggestMatches(openLines.map((l) => ({ ...l, id: `${l.statementId}:${l.id}` })), openEntries), [openLines, openEntries]);
  const bookBalance = entries.reduce((a, e) => a + bankAmount(e), 0);
  const latest = [...statements].sort((a, b) => b.to.localeCompare(a.to))[0];
  const unclearedBooks = openEntries.reduce((a, e) => a + bankAmount(e), 0);
  const unrecordedBank = openLines.reduce((a, l) => a + l.amount, 0);

  async function match(pairs: { line: BankStatementLine & { statementId: string }; entryId: string }[]) {
    if (!store || !actor) return;
    await store.batch(
      pairs.map(({ line, entryId }) => ({
        op: "set" as const,
        col: L.bankRecons,
        data: { id: `${line.statementId}__${line.id}`, statementId: line.statementId, statementLineId: line.id, ledgerEntryId: entryId, account, clearedOn: line.date, createdBy: actor.uid, createdAt: new Date().toISOString() } satisfies BankRecon,
      })),
    );
    toast(`Matched ${pairs.length}`);
    setSelLine(null);
    setSelEntry(null);
  }

  async function exportXlsx() {
    const buf = await tablesToWorkbook([
      {
        name: "Reconciliation",
        title: `Bank reconciliation ${account} as at ${todayColombo()}`,
        rows: [
          { k: "Balance per bank statement", v: latest?.closingBalance ?? 0 },
          { k: "Add/(less): items in the books not yet on the statement", v: unclearedBooks },
          { k: "Less/(add): items on the statement not yet in the books", v: -unrecordedBank },
          { k: "Balance per books", v: bookBalance },
        ],
        columns: [{ header: "", value: (r) => r.k, width: 56 }, { header: "Amount", value: (r) => r.v, format: "money", width: 18 }],
      },
      { name: "Uncleared in books", rows: openEntries, totals: true, columns: [{ header: "Date", value: (e) => e.postingDate }, { header: "Document", value: (e) => e.voucherNo, width: 18 }, { header: "Memo", value: (e) => e.memo ?? "", width: 36 }, { header: "Amount", value: (e) => bankAmount(e), format: "money", width: 16 }] },
      { name: "Not in books", rows: openLines, totals: true, columns: [{ header: "Date", value: (l) => l.date }, { header: "Description", value: (l) => l.description, width: 36 }, { header: "Reference", value: (l) => l.reference ?? "" }, { header: "Amount", value: (l) => l.amount, format: "money", width: 16 }] },
    ]);
    downloadBuffer(buf, `bank-reconciliation-${account}-${todayColombo()}.xlsx`);
  }

  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const lineSel = openLines.find((l) => `${l.statementId}:${l.id}` === selLine);
  return (
    <div className="page">
      <PageHead
        title="Bank reconciliation"
        subtitle="Import the bank statement, accept the suggested matches and investigate what's left. Bank charges or receipts missing from the books are posted with a journal."
        actions={
          <>
            <button className="btn" onClick={exportXlsx}>Export reconciliation</button>
            {books ? <button className="btn primary" onClick={() => setImporting(true)}>Import statement</button> : null}
          </>
        }
      />
      <div className="row wrap">
        <Field label="Bank account"><AccountSelect value={account} onChange={setAccount} filter={(a) => a.accountType === "Bank" || a.accountType === "Cash"} /></Field>
      </div>
      <div className="grid cols-3">
        <Stat label="Balance per books" value={money(bookBalance)} />
        <Stat label="Balance per statement" value={latest ? money(latest.closingBalance) : "—"} sub={latest ? `to ${latest.to}` : "no statement yet"} />
        <Stat label="In books, not on statement" value={money(unclearedBooks)} sub={`${openEntries.length} items`} />
        <Stat label="On statement, not in books" value={money(unrecordedBank)} sub={`${openLines.length} items`} {...(openLines.length ? { tone: "warn" as const } : {})} />
      </div>
      {books && suggestions.size ? (
        <div className="callout row between">
          <span>{suggestions.size} suggested match{suggestions.size === 1 ? "" : "es"} (same amount, dates within 3 days, reference preferred).</span>
          <button
            className="btn primary sm"
            onClick={() => match([...suggestions].map(([key, entryId]) => ({ line: openLines.find((l) => `${l.statementId}:${l.id}` === key)!, entryId })).filter((p) => p.line))}
          >
            Accept all suggestions
          </button>
        </div>
      ) : null}
      {books && lineSel && selEntry ? (
        <div className="callout row between">
          <span>Match statement line {lineSel.description} ({amount(lineSel.amount)}) with the selected ledger line?</span>
          <button className="btn primary sm" onClick={() => match([{ line: lineSel, entryId: selEntry }])}>Match</button>
        </div>
      ) : null}
      <div className="grid cols-2">
        <div className="card table-wrap">
          <div className="card-head"><h3>Statement lines not matched</h3></div>
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {openLines.map((l) => {
                const key = `${l.statementId}:${l.id}`;
                return (
                  <tr key={key} className="clickable" onClick={() => setSelLine(selLine === key ? null : key)} style={selLine === key ? { outline: "2px solid var(--brand)" } : undefined}>
                    <td>{l.date}</td>
                    <td>{l.description}{l.reference ? <div className="tiny muted mono">{l.reference}</div> : null}{suggestions.has(key) ? <div className="tiny"><span className="badge info">suggested</span></div> : null}</td>
                    <td className="num">{amount(l.amount)}</td>
                  </tr>
                );
              })}
              {!openLines.length ? <tr><td colSpan={3} className="muted">{statements.length ? "Everything on the statement is matched." : "No statement imported for this account yet."}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="card table-wrap">
          <div className="card-head"><h3>Ledger lines not cleared</h3></div>
          <table className="table">
            <thead><tr><th>Date</th><th>Document</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {openEntries.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => setSelEntry(selEntry === e.id ? null : e.id)} style={selEntry === e.id ? { outline: "2px solid var(--brand)" } : undefined}>
                  <td>{e.postingDate}</td>
                  <td><span className="mono">{e.voucherNo}</span>{e.memo ? <div className="tiny muted">{e.memo}</div> : null}</td>
                  <td className="num">{amount(bankAmount(e))}</td>
                </tr>
              ))}
              {!openEntries.length ? <tr><td colSpan={3} className="muted">All ledger lines are cleared.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {recons.length ? (
        <div className="card table-wrap">
          <div className="card-head"><h3>Matched ({recons.length})</h3></div>
          <table className="table">
            <thead><tr><th>Cleared on</th><th>Statement line</th><th>Ledger line</th><th className="num">Amount</th><th /></tr></thead>
            <tbody>
              {recons
                .slice()
                .sort((a, b) => b.clearedOn.localeCompare(a.clearedOn))
                .map((r) => {
                  const l = lines.find((x) => x.statementId === r.statementId && x.id === r.statementLineId);
                  const e = entries.find((x) => x.id === r.ledgerEntryId);
                  return (
                    <tr key={r.id}>
                      <td>{r.clearedOn}</td>
                      <td>{l?.description}</td>
                      <td className="mono">{e?.voucherNo}</td>
                      <td className="num">{amount(l?.amount)}</td>
                      <td>{books ? <button className="btn ghost sm" onClick={() => store?.remove(L.bankRecons, r.id)}>Unmatch</button> : null}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      ) : null}
      {importing ? <ImportStatement account={account} onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
