import { useMemo, useState } from "react";
import {
  type Check,
  type MenuItem,
  type PosContext,
  type PosEvent,
  type PosJournal,
  type Printer,
  type PrivilegeKey,
  type RevenueCenter,
  type Role,
  type Staff,
  type Workstation,
  COLLECTIONS as C,
  EXCEPTION_EVENTS,
  POS_EVENT_LABEL,
  activeLines,
  aggregateChecks,
  businessDateNow,
  canPerform,
  computeCheckTotals,
  employeeActivity,
  expectedCash,
  hasPrivilege,
  itemSales,
} from "@pos/core";
import { type Block, type ReceiptDoc, buildDaySummary, widthForPaper } from "@pos/printing";
import { Seg, Stat } from "../../components/ui";
import { amount, money, timeColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";

type Scope = "mine" | "rvc" | "property";
type Kind = "summary" | "employees" | "items" | "open" | "exceptions";

/**
 * Reports on the workstation (Simphony "Reports" on the POS): system or revenue-centre sales,
 * employee financial/cashier report, menu item sales, open checks and exceptions. Employees with
 * only "own reports" see their own figures; property figures need the reports privilege.
 */
export function PosReports({ ws, user, role, rvcId, staff, rvcs, ctx, journal, withPrivilege, print, printers }: {
  ws: Workstation;
  user: Staff;
  role: Role | undefined;
  rvcId: string;
  staff: Staff[];
  rvcs: RevenueCenter[];
  ctx: PosContext;
  journal: PosJournal;
  withPrivilege: (p: PrivilegeKey, run: (by: Staff) => void) => void;
  print: (kind: "report", doc: ReceiptDoc, printer: Printer | undefined) => Promise<void>;
  printers: Printer[];
}) {
  const { settings } = useApp();
  const allowedAll = hasPrivilege(role, "pos.reports");
  const [date, setDate] = useState(businessDateNow(settings.pos));
  const [scope, setScope] = useState<Scope>(allowedAll ? "rvc" : "mine");
  const [kind, setKind] = useState<Kind>("summary");
  const checks = useCollection<Check>(C.checks, { where: [["businessDate", "==", date]] }) ?? [];
  const events = useCollection<PosEvent>(C.posJournal, { where: [["businessDate", "==", date]] }) ?? [];
  const menuItems = useCollection<MenuItem>(C.menuItems) ?? [];
  const name = (id?: string) => staff.find((s) => s.id === id)?.name ?? id ?? "";
  const inScope = <T extends { propertyId: string; rvcId?: string }>(x: T, owner: string | undefined) => x.propertyId === ws.propertyId && (scope === "property" || (x.rvcId ?? rvcId) === rvcId) && (scope !== "mine" || owner === user.id);
  const myChecks = checks.filter((c) => inScope(c, c.staffId));
  const myEvents = events.filter((e) => inScope(e, e.employeeId));
  const closed = myChecks.filter((c) => c.status === "closed");
  const stats = useMemo(() => aggregateChecks(closed, ctx, `${scope}-${date}`), [closed, ctx, scope, date]);
  const people = employeeActivity(closed, myEvents);
  const cashIds = new Set([...ctx.tenders.values()].filter((t) => t.type === "cash").map((t) => t.id));
  const open = myChecks.filter((c) => c.status === "open");
  const exceptions = myEvents.filter((e) => EXCEPTION_EVENTS.includes(e.type)).sort((a, b) => b.at.localeCompare(a.at));
  const scopeLabel = scope === "mine" ? user.name : scope === "rvc" ? (rvcs.find((r) => r.id === rvcId)?.name ?? rvcId) : "Whole property";
  const printer = printers.find((p) => p.id === ws.receiptPrinterId);
  const width = widthForPaper(printer?.paperWidthMm ?? 80);

  function chooseScope(s: Scope) {
    if (s === "mine") return setScope(s);
    if (canPerform(role, "pos.reports")) return setScope(s);
    withPrivilege("pos.reports", () => setScope(s));
  }

  async function printIt() {
    let doc: ReceiptDoc;
    if (kind === "summary") doc = buildDaySummary({ stats: { ...stats, propertyId: ws.propertyId, businessDate: date }, kind: "X", width, businessName: settings.business.tradingName, propertyName: scopeLabel, tenders: [...ctx.tenders.values()], printedAt: new Date().toISOString() });
    else {
      const blocks: Block[] = [{ t: "text", text: { employees: "EMPLOYEE FINANCIAL", items: "MENU ITEM SALES", open: "OPEN CHECKS", exceptions: "EXCEPTIONS" }[kind], align: "center", bold: true }, { t: "text", text: `${scopeLabel} · ${date}`, align: "center" }, { t: "rule" }];
      if (kind === "employees") for (const p of people) blocks.push({ t: "pair", left: name(p.employeeId), right: amount(p.netSales), bold: true }, { t: "pair", left: `  checks ${p.checksClosed}  voids ${p.voids.count}`, right: `disc ${amount(p.discounts.amount)}` });
      if (kind === "items") for (const r of itemSales(stats, menuItems, []).slice(0, 60)) blocks.push({ t: "pair", left: `${r.qty} ${r.name}`, right: amount(r.netSales) });
      if (kind === "open") for (const c of open) blocks.push({ t: "pair", left: `#${c.checkNo} ${name(c.staffId)}`, right: amount(activeLines(c).length ? computeCheckTotals(c, ctx).amountDue : 0) });
      if (kind === "exceptions") for (const e of exceptions) blocks.push({ t: "pair", left: `${timeColombo(e.at)} ${POS_EVENT_LABEL[e.type]}`, right: e.amount !== undefined ? amount(e.amount) : "" }, { t: "text", text: `  ${name(e.employeeId)}${e.authorizedBy ? ` / ${name(e.authorizedBy)}` : ""}` });
      blocks.push({ t: "rule" }, { t: "text", text: `Printed ${timeColombo(new Date().toISOString())} by ${user.name}`, align: "center" });
      doc = { width, blocks };
    }
    await print("report", doc, printer);
    void journal.log({ type: "report", employeeId: user.id, detail: `${kind} · ${scopeLabel} · ${date}` });
  }

  const avg = stats.checks ? Math.round(stats.netSales / stats.checks) : 0;
  return (
    <div style={{ overflowY: "auto", padding: 16 }} className="stack">
      <div className="row wrap">
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} aria-label="Business date" />
        <Seg<Scope> value={scope} onChange={chooseScope} options={[{ value: "mine", label: "My sales" }, { value: "rvc", label: "Revenue centre" }, { value: "property", label: "Property" }]} />
        <span className="grow" />
        <button className="btn" onClick={printIt}>Print</button>
      </div>
      <Seg<Kind> value={kind} onChange={setKind} options={[{ value: "summary", label: scope === "mine" ? "My sales" : "Daily sales" }, { value: "employees", label: "Employee financial" }, { value: "items", label: "Menu items" }, { value: "open", label: `Open checks (${open.length})` }, { value: "exceptions", label: `Exceptions (${exceptions.length})` }]} />
      {kind === "summary" ? (
        <>
          <div className="grid cols-4">
            <Stat label="Net sales" value={money(stats.netSales)} sub={scopeLabel} />
            <Stat label="Checks / covers" value={`${stats.checks} / ${stats.covers}`} sub={`avg check ${money(avg)}`} />
            <Stat label="Discounts" value={money(stats.discounts)} />
            <Stat label="Voids" value={money(stats.voids?.amount)} sub={`${stats.voids?.qty ?? 0} items`} {...(stats.voids?.qty ? { tone: "warn" as const } : {})} />
          </div>
          <div className="grid cols-3">
            <div className="card table-wrap">
              <div className="card-head"><h3>Totals</h3></div>
              <table className="table"><tbody>
                <tr><td>Items at menu price</td><td className="num">{money(stats.itemsTotal)}</td></tr>
                <tr><td>Discounts</td><td className="num">−{money(stats.discounts)}</td></tr>
                <tr><td><strong>Net sales</strong></td><td className="num"><strong>{money(stats.netSales)}</strong></td></tr>
                <tr><td>Service charge</td><td className="num">{money(stats.serviceCharge)}</td></tr>
                <tr><td>SSCL / TDL</td><td className="num">{money(stats.sscl + stats.tdl)}</td></tr>
                <tr><td>VAT</td><td className="num">{money(stats.vat)}</td></tr>
                <tr><td><strong>Total collected</strong></td><td className="num"><strong>{money(stats.total)}</strong></td></tr>
              </tbody></table>
            </div>
            <div className="card table-wrap">
              <div className="card-head"><h3>By tender</h3></div>
              <table className="table"><tbody>
                {Object.entries(stats.tenders ?? {}).map(([id, t]) => <tr key={id}><td>{ctx.tenders.get(id)?.name ?? id} <span className="tiny muted">× {t.qty}</span></td><td className="num">{money(t.amount)}</td></tr>)}
                <tr><td>Cash expected in drawer</td><td className="num">{money(expectedCash(closed, myEvents, cashIds, scope === "mine" ? user.id : undefined))}</td></tr>
              </tbody></table>
            </div>
            <div className="card table-wrap">
              <div className="card-head"><h3>By major group and hour</h3></div>
              <table className="table"><tbody>
                {Object.entries(stats.majorGroups ?? {}).map(([g, v]) => <tr key={g}><td>{g}</td><td className="num">{money(v.amount)}</td></tr>)}
                {Object.entries(stats.hours ?? {}).sort().map(([h, v]) => <tr key={h}><td className="muted">{h}:00</td><td className="num">{money(v.amount)} <span className="tiny muted">({v.qty})</span></td></tr>)}
              </tbody></table>
            </div>
          </div>
        </>
      ) : kind === "employees" ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Employee</th><th className="num">Checks</th><th className="num">Net sales</th><th>Collected</th><th className="num">Voids</th><th className="num">Discounts</th><th className="num">No sales</th><th className="num">Paid out</th><th className="num">Approvals given</th></tr></thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.employeeId}>
                  <td>{name(p.employeeId)}</td>
                  <td className="num">{p.checksClosed}</td>
                  <td className="num">{amount(p.netSales)}</td>
                  <td className="small">{Object.entries(p.collected).map(([t, a]) => `${ctx.tenders.get(t)?.name ?? t} ${amount(a)}`).join(" · ")}</td>
                  <td className="num">{p.voids.count ? `${p.voids.count} · ${amount(p.voids.amount)}` : ""}</td>
                  <td className="num">{p.discounts.count ? `${p.discounts.count} · ${amount(p.discounts.amount)}` : ""}</td>
                  <td className="num">{p.noSales || ""}</td>
                  <td className="num">{p.paidOut ? amount(p.paidOut) : ""}</td>
                  <td className="num">{p.authorisationsGiven || ""}</td>
                </tr>
              ))}
              {!people.length ? <tr><td colSpan={9} className="muted">No activity.</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : kind === "items" ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Net sales</th></tr></thead>
            <tbody>{itemSales(stats, menuItems, []).map((r) => <tr key={r.itemId}><td>{r.name}</td><td className="num">{r.qty}</td><td className="num">{amount(r.netSales)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : kind === "open" ? (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Check</th><th>Employee</th><th>Opened</th><th className="num">Amount</th></tr></thead>
            <tbody>{open.map((c) => <tr key={c.id}><td>#{c.checkNo}</td><td>{name(c.staffId)}</td><td>{timeColombo(c.openedAt)}</td><td className="num">{money(activeLines(c).length ? computeCheckTotals(c, ctx).amountDue : 0)}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead><tr><th>Time</th><th>Event</th><th>Employee</th><th>Approved by</th><th>Detail</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {exceptions.map((e) => (
                <tr key={e.id}>
                  <td className="small">{timeColombo(e.at)}</td>
                  <td><span className="badge warn">{POS_EVENT_LABEL[e.type]}</span></td>
                  <td>{name(e.employeeId)}</td>
                  <td>{name(e.authorizedBy)}</td>
                  <td className="small">{[e.checkNo ? `#${e.checkNo}` : "", e.itemName, e.reason, e.detail].filter(Boolean).join(" · ")}</td>
                  <td className="num">{e.amount !== undefined ? money(e.amount) : ""}</td>
                </tr>
              ))}
              {!exceptions.length ? <tr><td colSpan={6} className="muted">No exceptions.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
