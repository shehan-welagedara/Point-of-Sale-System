import { useState } from "react";
import { Link } from "react-router-dom";
import { COLLECTIONS as C, type ModuleKey } from "@pos/core";
import { type FiscalYear, LEDGER as L } from "@pos/ledger";
import { starterConfig } from "@pos/sample-data";
import { Field, PageHead } from "../../components/ui";
import { todayColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

interface Step {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  to?: string;
  action?: React.ReactNode | undefined;
  module?: ModuleKey;
}

const ids = (docs: { id: string }[] | undefined) => new Set((docs ?? []).map((d) => d.id));

/**
 * Administration → Setup checklist: what a new business still needs before it can trade or keep
 * its books, in order, each with a link (or a button) to do it. Steps follow the chosen modules.
 */
export function SetupChecklistPage() {
  const { settings, tenant, on, ledger, toast, role } = useApp();
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [booksFrom, setBooksFrom] = useState(`${Number(todayColombo().slice(5, 7)) >= 4 ? todayColombo().slice(0, 4) : Number(todayColombo().slice(0, 4)) - 1}-04-01`);
  const props = useCollection<{ id: string }>(C.properties);
  const roles = useCollection<{ id: string }>(C.roles);
  const tenders = useCollection<{ id: string }>(C.tenderMedia);
  const reasons = useCollection<{ id: string }>(C.reasonCodes);
  const rvcs = useCollection<{ id: string }>(on("pos") ? C.revenueCenters : null);
  const orderTypes = useCollection<{ id: string }>(on("pos") ? C.orderTypes : null);
  const locations = useCollection<{ id: string }>(on("inventory") ? C.locations : null);
  const accounts = useCollection<{ id: string }>(on("accounting") ? C.accounts : null);
  const costCenters = useCollection<{ id: string }>(on("accounting") ? L.costCenters : null);
  const fys = useCollection<FiscalYear>(on("accounting") ? L.fiscalYears : null) ?? [];
  const openingJournals = useCollection<{ id: string; status: string; opening?: boolean }>(on("accounting") ? L.vouchers : null, { where: [["opening", "==", true]] }) ?? [];
  const vendors = useCollection<{ id: string }>(C.vendors) ?? [];
  const items = useCollection<{ id: string }>(on("inventory") ? C.inventoryItems : null) ?? [];
  const counts = useCollection<{ id: string; kind?: string; status: string }>(on("inventory") ? C.stockCounts : null) ?? [];
  const menu = useCollection<{ id: string }>(on("pos") ? C.menuItems : null) ?? [];
  const staff = useCollection<{ id: string; pinSet?: boolean; pinHash?: string }>(on("pos") ? C.staff : null) ?? [];
  const members = useCollection<{ id: string }>(C.members) ?? [];
  const loaded = props && roles && tenders && reasons;

  const missingBasics = loaded
    ? starterConfig({
        name: tenant?.name ?? settings.business.tradingName,
        addressLines: settings.business.addressLines,
        modules: { pos: on("pos"), inventory: on("inventory"), accounting: on("accounting"), lankaqr: on("lankaqr"), payhere: on("payhere") },
        existing: { [C.properties]: ids(props), [C.roles]: ids(roles), [C.tenderMedia]: ids(tenders), [C.reasonCodes]: ids(reasons), [C.revenueCenters]: ids(rvcs), [C.orderTypes]: ids(orderTypes), [C.locations]: ids(locations), [C.accounts]: ids(accounts), [L.costCenters]: ids(costCenters) },
      })
    : [];
  // Only report gaps in collections that are empty (a business may have replaced the defaults).
  const emptyCols = new Set(
    [
      [C.properties, props],
      [C.roles, roles],
      [C.tenderMedia, tenders],
      [C.revenueCenters, rvcs],
      [C.locations, locations],
      [C.accounts, accounts],
      [L.costCenters, costCenters],
    ]
      .filter(([, docs]) => Array.isArray(docs) && (docs as unknown[]).length === 0)
      .map(([c]) => c as string),
  );
  const basicsToAdd = missingBasics.filter((o) => emptyCols.has(o.col));

  async function addBasics() {
    setBusy(true);
    try {
      await store.batch(basicsToAdd);
      toast(`Added ${basicsToAdd.length} standard record(s)`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function openYears() {
    setBusy(true);
    try {
      await ledger({ action: "ensureFiscalYear", date: booksFrom });
      await ledger({ action: "ensureFiscalYear", date: todayColombo() });
      toast("Fiscal year(s) open");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const all: Step[] = [
    { key: "business", title: "Business and tax details", detail: "Legal name, TIN, VAT registration, address: they print on every bill and report.", done: !settings.business.isSample, to: "/emc/setup/business" },
    {
      key: "basics",
      title: "Standard set-up",
      detail: "Outlet, roles, payment methods, reason codes" + (on("inventory") ? ", main store" : "") + (on("accounting") ? ", chart of accounts and cost centres" : "") + ". Added automatically for new businesses.",
      done: loaded ? basicsToAdd.length === 0 : false,
      action: basicsToAdd.length && (role === "owner" || role === "admin") ? <button className="btn sm primary" disabled={busy} onClick={addBasics}>Add the missing basics ({basicsToAdd.length})</button> : undefined,
    },
    {
      key: "fy",
      module: "accounting",
      title: "Fiscal year",
      detail: "The books need a fiscal year (April to March) covering every date you will enter, including earlier bills.",
      done: fys.length > 0 && fys.some((f) => f.start <= todayColombo() && f.end >= todayColombo()),
      action: (
        <div className="row wrap">
          <Field label="Books start on"><input className="input" type="date" value={booksFrom} onChange={(e) => setBooksFrom(e.target.value)} /></Field>
          <button className="btn sm" disabled={busy} onClick={openYears}>Open fiscal year(s)</button>
        </div>
      ),
    },
    { key: "suppliers", title: "Suppliers", detail: "Everyone you buy from, with payment terms.", done: vendors.length > 0, to: "/emc/finance/suppliers" },
    { key: "opening", module: "accounting", title: "Opening balances", detail: "Cash, bank, amounts owed to suppliers and by customers, equipment and capital on the day the books start. Easiest with the accounting Excel workbook.", done: openingJournals.some((v) => v.status === "posted"), to: "/emc/finance/import" },
    { key: "stock", module: "inventory", title: "Stock items", detail: "Ingredients and goods with units and costs (Excel import is quickest).", done: items.length > 0, to: "/emc/inventory/items" },
    { key: "openingStock", module: "inventory", title: "Opening stock", detail: "Count what is in the store on the first day: Stock counts → Start a count → type Opening stock.", done: counts.some((c) => c.kind === "opening" && c.status === "posted"), to: "/emc/inventory/counts" },
    { key: "menu", module: "pos", title: "Menu", detail: "Categories, items, prices and modifiers.", done: menu.length > 0, to: "/emc/menu/items" },
    { key: "staff", module: "pos", title: "Employees with PINs", detail: "Everyone who uses the POS, with their own PIN.", done: staff.some((s) => s.pinSet || s.pinHash), to: "/emc/people/staff" },
    { key: "logins", title: "Back-office logins", detail: "Invite your manager, storekeeper and accountant with their own logins.", done: members.length > 1, to: "/emc/people/logins" },
    { key: "licence", title: "Licence", detail: "Activate the licence key from your supplier before the trial ends.", done: Boolean(tenant?.licence), to: "/emc/setup/licence" },
  ] satisfies Step[];
  const steps = all.filter((s) => !s.module || on(s.module));

  const done = steps.filter((s) => s.done).length;
  return (
    <div className="page">
      <PageHead title="Setup checklist" subtitle={`What this business still needs, in order. ${done} of ${steps.length} done.`} />
      <div className="card">
        <div className="table-wrap">
          <table className="table cards-sm">
            <tbody>
              {steps.map((s, i) => (
                <tr key={s.key}>
                  <td data-label="" style={{ width: 36 }}><span className={`badge ${s.done ? "good" : "warn"}`} aria-label={s.done ? "done" : "to do"}>{s.done ? "✓" : i + 1}</span></td>
                  <td data-label="">
                    <strong>{s.title}</strong>
                    <div className="small muted">{s.detail}</div>
                  </td>
                  <td data-label="" className="right">
                    {s.action && !s.done ? s.action : s.to ? <Link className="btn sm" to={s.to}>{s.done ? "Review" : "Open"}</Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted">The configuration guide explains each step with examples (docs/manual/configuration-guide.md, or the PDF from your supplier).</p>
    </div>
  );
}
