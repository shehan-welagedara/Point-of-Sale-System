import { type Check, type CreditNote, type PosEvent, type PosJournal, type PrivilegeKey, type Staff, type TenderMedia, type Workstation, COLLECTIONS as C, businessDateNow, expectedCash, newId } from "@pos/core";
import type { ReceiptDoc } from "@pos/printing";
import { formatAmount } from "@pos/engine";
import { useState } from "react";
import { Field, Modal } from "../../components/ui";
import { money, timeColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

/** Notes and coins counted in a drawer (rupees). */
const DENOMINATIONS: Record<string, number[]> = { LKR: [5000, 2000, 1000, 500, 100, 50, 20, 10, 5, 2, 1] };

/**
 * Till count (Simphony "Till/cash pull"): count the drawer by notes and coins and compare with the
 * cash it should hold (float, cash taken, paid in and out, pickups and cash refunds on this
 * workstation today). The count, the expected amount and the difference are kept and logged.
 */
export function TillCount({ ws, user, staff, tenders, journal, withPrivilege, onPrint, onClose }: {
  ws: Workstation;
  user: Staff;
  staff: Staff[];
  tenders: TenderMedia[];
  journal: PosJournal;
  withPrivilege: (p: PrivilegeKey, run: (by: Staff) => void) => void;
  onPrint: (doc: ReceiptDoc) => Promise<void>;
  onClose: () => void;
}) {
  const { settings, toast } = useApp();
  const store = useStore();
  const bd = businessDateNow(settings.pos);
  const checks = (useCollection<Check>(C.checks, { where: [["businessDate", "==", bd]] }) ?? []).filter((c) => c.workstationId === ws.id);
  const events = (useCollection<PosEvent>(C.posJournal, { where: [["businessDate", "==", bd]] }) ?? []).filter((e) => e.workstationId === ws.id);
  const notes = (useCollection<CreditNote>(C.creditNotes, { where: [["businessDate", "==", bd]] }) ?? []).filter((n) => n.workstationId === ws.id);
  const denoms = DENOMINATIONS[settings.business.currency ?? "LKR"] ?? DENOMINATIONS.LKR!;
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [float, setFloat] = useState("");
  const [busy, setBusy] = useState(false);
  const cashIds = new Set(tenders.filter((t) => t.type === "cash").map((t) => t.id));
  const floatCents = Math.round(Number(float || 0) * 100);
  const expected = floatCents + expectedCash(checks, events, cashIds, undefined, notes);
  const counted = denoms.reduce((a, d) => a + d * 100 * Number(counts[d] || 0), 0);
  const variance = counted - expected;

  const save = () =>
    withPrivilege("pos.tillCount", (by) => {
      setBusy(true);
      void (async () => {
        try {
          const at = new Date().toISOString();
          const doc = { id: newId(), workstationId: ws.id, propertyId: ws.propertyId, businessDate: bd, at, by: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), float: floatCents, expected, counted, variance, denominations: Object.fromEntries(denoms.map((d) => [String(d), Number(counts[d] || 0)])) };
          await store.set(C.tillCounts, doc);
          await journal.log({ type: "tillCount", employeeId: user.id, ...(by.id !== user.id ? { authorizedBy: by.id } : {}), amount: counted, detail: `expected ${formatAmount(expected)}, ${variance === 0 ? "balanced" : variance > 0 ? `over ${formatAmount(variance)}` : `short ${formatAmount(-variance)}`}` });
          await onPrint({
            width: 48,
            blocks: [
              { t: "text", text: "TILL COUNT", align: "center", bold: true, size: 2 },
              { t: "pair", left: "Workstation", right: ws.code },
              { t: "pair", left: "Counted by", right: staff.find((s) => s.id === user.id)?.name ?? user.id },
              { t: "pair", left: "Time", right: timeColombo(at) },
              { t: "rule" },
              ...denoms.filter((d) => Number(counts[d] || 0) > 0).map((d) => ({ t: "pair" as const, left: `${d} x ${counts[d]}`, right: formatAmount(d * 100 * Number(counts[d])) })),
              { t: "rule" },
              { t: "pair", left: "Counted", right: formatAmount(counted), bold: true },
              { t: "pair", left: "Expected", right: formatAmount(expected) },
              { t: "pair", left: variance >= 0 ? "Over" : "Short", right: formatAmount(Math.abs(variance)), bold: true },
              { t: "cut" },
            ],
          });
          toast(variance === 0 ? "Till balanced" : `Till ${variance > 0 ? "over" : "short"} by ${money(Math.abs(variance))} (recorded)`, variance !== 0);
          onClose();
        } catch (e) {
          toast((e as Error).message, true);
        } finally {
          setBusy(false);
        }
      })();
    });

  return (
    <Modal title={`Till count · ${ws.code}`} onClose={onClose} footer={<button className="btn primary" disabled={busy || counted === 0} onClick={save}>Save count</button>}>
      <div className="stack">
        <Field label="Opening float (Rs)"><input className="input" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" /></Field>
        <div className="till-grid">
          {denoms.map((d) => (
            <label key={d} className="till-row">
              <span>{d.toLocaleString("en-LK")}</span>
              <input className="input" inputMode="numeric" aria-label={`Rs ${d}`} value={counts[d] ?? ""} onChange={(e) => setCounts({ ...counts, [d]: e.target.value.replace(/\D/g, "") })} placeholder="0" />
              <span className="num small muted">{money(d * 100 * Number(counts[d] || 0))}</span>
            </label>
          ))}
        </div>
        <div className="card pad stack tight" data-testid="till-summary">
          <div className="row between"><span>Counted</span><strong>{money(counted)}</strong></div>
          <div className="row between"><span>Expected</span><span>{money(expected)}</span></div>
          <div className="row between"><span>{variance >= 0 ? "Over" : "Short"}</span><strong className={variance === 0 ? "" : "bad-text"}>{money(Math.abs(variance))}</strong></div>
        </div>
      </div>
    </Modal>
  );
}
