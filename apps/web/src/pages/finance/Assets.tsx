import { useState } from "react";
import { addDays } from "@pos/core";
import { type Asset, LEDGER as L, depreciationSchedule, netBookValue } from "@pos/ledger";
import { tablesToWorkbook } from "@pos/excel";
import { Drawer, Field, Modal, ModuleOff, PageHead, Stat } from "../../components/ui";
import { amount, downloadBuffer, money, toCents, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { AccountSelect, CostCenterSelect, canBooks, useLedgerAction } from "./shared";

const ACC_DEP: Record<string, string> = { "1500": "1591", "1510": "1592", "1520": "1593", "1530": "1594" };

function AssetEditor({ asset, onClose }: { asset?: Asset; onClose: () => void }) {
  const { store, toast } = useApp();
  const [a, setA] = useState<Asset>(
    asset ?? {
      id: "",
      code: "",
      name: "",
      category: "Kitchen equipment",
      assetAccount: "1500",
      accumulatedDepAccount: "1591",
      depExpenseAccount: "6600",
      purchaseDate: todayColombo(),
      availableDate: todayColombo(),
      cost: 0,
      salvageValue: 0,
      method: "SL",
      usefulLifeMonths: 60,
      status: "active",
      accumulatedDep: 0,
    },
  );
  const [cost, setCost] = useState(asset ? String(asset.cost / 100) : "");
  const [salvage, setSalvage] = useState(asset ? String(asset.salvageValue / 100) : "0");
  const locked = Boolean(asset?.lastDepPeriod);

  async function save() {
    if (!store) return;
    if (!a.code.trim() || !a.name.trim() || toCents(cost) <= 0) return toast("Code, name and cost are required", true);
    const { lastDepPeriod: _l, disposalDate: _d, ...rest } = a;
    const doc: Asset = { ...rest, id: asset?.id ?? a.code.trim(), code: a.code.trim(), cost: toCents(cost), salvageValue: toCents(salvage || 0), ...(asset?.lastDepPeriod ? { lastDepPeriod: asset.lastDepPeriod } : {}), ...(asset?.disposalDate ? { disposalDate: asset.disposalDate } : {}) };
    if (asset) await store.merge(L.assets, asset.id, { ...doc, accumulatedDep: asset.accumulatedDep, status: asset.status });
    else await store.set(L.assets, doc);
    toast("Asset saved");
    onClose();
  }

  return (
    <Modal wide title={asset ? `Asset ${asset.code}` : "New fixed asset"} onClose={onClose} footer={<button className="btn primary" onClick={save}>Save</button>}>
      <div className="stack">
        {!asset ? <div className="callout">Register the asset after its cost is in the books (supplier invoice or journal to the asset account). Depreciation then runs monthly.</div> : null}
        {locked ? <div className="callout warn">Depreciation has been posted for this asset, so cost, life and method can't change. Dispose of it and register a new one if they were wrong.</div> : null}
        <div className="grid cols-3">
          <Field label="Asset code"><input className="input" value={a.code} disabled={Boolean(asset)} onChange={(e) => setA({ ...a, code: e.target.value })} placeholder="FA-004" /></Field>
          <Field label="Name"><input className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></Field>
          <Field label="Category"><input className="input" value={a.category} onChange={(e) => setA({ ...a, category: e.target.value })} /></Field>
          <Field label="Asset account"><AccountSelect value={a.assetAccount} onChange={(v) => setA({ ...a, assetAccount: v, accumulatedDepAccount: ACC_DEP[v] ?? a.accumulatedDepAccount })} filter={(x) => x.accountType === "FixedAsset"} /></Field>
          <Field label="Accumulated depreciation"><AccountSelect value={a.accumulatedDepAccount} onChange={(v) => setA({ ...a, accumulatedDepAccount: v })} filter={(x) => x.accountType === "AccumulatedDepreciation"} /></Field>
          <Field label="Depreciation expense"><AccountSelect value={a.depExpenseAccount} onChange={(v) => setA({ ...a, depExpenseAccount: v })} filter={(x) => x.accountType === "Depreciation"} /></Field>
          <Field label="Purchase date"><input className="input" type="date" value={a.purchaseDate} disabled={locked} onChange={(e) => setA({ ...a, purchaseDate: e.target.value })} /></Field>
          <Field label="Available for use from"><input className="input" type="date" value={a.availableDate} disabled={locked} onChange={(e) => setA({ ...a, availableDate: e.target.value })} /></Field>
          <Field label="Cost (LKR)"><input className="input" inputMode="decimal" value={cost} disabled={locked} onChange={(e) => setCost(e.target.value)} /></Field>
          <Field label="Residual value"><input className="input" inputMode="decimal" value={salvage} disabled={locked} onChange={(e) => setSalvage(e.target.value)} /></Field>
          <Field label="Method">
            <select className="select" value={a.method} disabled={locked} onChange={(e) => setA({ ...a, method: e.target.value as Asset["method"] })}>
              <option value="SL">Straight line</option>
              <option value="WDV">Written-down value</option>
            </select>
          </Field>
          {a.method === "SL" ? (
            <Field label="Useful life (months)"><input className="input" inputMode="numeric" value={a.usefulLifeMonths} disabled={locked} onChange={(e) => setA({ ...a, usefulLifeMonths: Number(e.target.value) || 0 })} /></Field>
          ) : (
            <Field label="Annual rate %"><input className="input" inputMode="decimal" value={(a.wdvRateBp ?? 2000) / 100} disabled={locked} onChange={(e) => setA({ ...a, wdvRateBp: Math.round(Number(e.target.value) * 100) })} /></Field>
          )}
          <Field label="Cost centre"><CostCenterSelect value={a.costCenter ?? ""} onChange={(v) => setA({ ...a, costCenter: v, propertyId: v })} /></Field>
          <Field label="Serial number"><input className="input" value={a.serialNo ?? ""} onChange={(e) => setA({ ...a, serialNo: e.target.value })} /></Field>
          <Field label="Location"><input className="input" value={a.location ?? ""} onChange={(e) => setA({ ...a, location: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function AssetDetail({ asset, onClose, onEdit }: { asset: Asset; onClose: () => void; onEdit: () => void }) {
  const { role } = useApp();
  const { run, busy } = useLedgerAction();
  const [date, setDate] = useState(todayColombo());
  const [proceeds, setProceeds] = useState("0");
  const [account, setAccount] = useState("1010");
  const schedule = depreciationSchedule(asset).slice(0, 120);
  return (
    <Drawer title={`${asset.code} ${asset.name}`} onClose={onClose} footer={canBooks(role) && asset.status !== "disposed" ? <button className="btn" onClick={onEdit}>Edit details</button> : undefined}>
      <div className="stack">
        <div className="grid cols-2 small">
          <div>Cost: <strong>{money(asset.cost)}</strong></div>
          <div>Accumulated depreciation: <strong>{money(asset.accumulatedDep)}</strong></div>
          <div>Net book value: <strong>{money(netBookValue(asset))}</strong></div>
          <div>Depreciated to: <strong>{asset.lastDepPeriod ?? "—"}</strong></div>
          <div>Method: <strong>{asset.method === "SL" ? `Straight line, ${asset.usefulLifeMonths} months` : `WDV ${((asset.wdvRateBp ?? 0) / 100).toFixed(1)}% a year`}</strong></div>
          <div>Status: <strong>{asset.status}{asset.disposalDate ? ` on ${asset.disposalDate}` : ""}</strong></div>
        </div>
        {canBooks(role) && asset.status !== "disposed" ? (
          <div className="card card-body stack">
            <h3>Sell or scrap</h3>
            <div className="grid cols-3">
              <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Proceeds"><input className="input" inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.target.value)} /></Field>
              <Field label="Received into"><AccountSelect value={account} onChange={setAccount} filter={(a) => a.accountType === "Bank" || a.accountType === "Cash" || a.accountType === "Receivable"} /></Field>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn danger" disabled={busy} onClick={() => run({ action: "disposeAsset", assetId: asset.id, date, proceeds: toCents(proceeds || 0), proceedsAccount: account }, () => "Disposal posted (depreciation to date, gain or loss)").then((r) => r && onClose())}>
                Post disposal
              </button>
            </div>
          </div>
        ) : null}
        <div className="card table-wrap">
          <div className="card-head"><h3>Depreciation schedule</h3></div>
          <table className="table">
            <thead><tr><th>Period</th><th className="num">Charge</th><th className="num">Accumulated</th><th className="num">Book value</th></tr></thead>
            <tbody>
              {schedule.map((r) => (
                <tr key={r.period} style={asset.lastDepPeriod && r.period <= asset.lastDepPeriod ? { opacity: 0.6 } : undefined}>
                  <td>{r.period}{asset.lastDepPeriod && r.period <= asset.lastDepPeriod ? " ✓" : ""}</td>
                  <td className="num">{amount(r.amount)}</td>
                  <td className="num">{amount(r.accumulated)}</td>
                  <td className="num">{amount(r.netBookValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Drawer>
  );
}

export function AssetsPage() {
  const { on, role, settings } = useApp();
  const assets = useCollection<Asset>(L.assets) ?? [];
  const { run, busy } = useLedgerAction();
  const [period, setPeriod] = useState(addDays(`${todayColombo().slice(0, 7)}-01`, -1).slice(0, 7));
  const [open, setOpen] = useState<Asset | null>(null);
  const [editing, setEditing] = useState<Asset | "new" | null>(null);
  if (!on("accounting")) return <ModuleOff name="Accounting" />;
  const list = assets.slice().sort((a, b) => a.code.localeCompare(b.code));
  const live = list.filter((a) => a.status !== "disposed");
  const cost = live.reduce((x, a) => x + a.cost, 0);
  const dep = live.reduce((x, a) => x + a.accumulatedDep, 0);

  async function exportXlsx() {
    const buf = await tablesToWorkbook([
      {
        name: "Fixed asset register",
        title: `Fixed asset register – ${settings.business.legalName} – ${todayColombo()}`,
        totals: true,
        rows: list,
        columns: [
          { header: "Code", value: (a) => a.code },
          { header: "Name", value: (a) => a.name, width: 32 },
          { header: "Category", value: (a) => a.category, width: 22 },
          { header: "Available from", value: (a) => a.availableDate },
          { header: "Method", value: (a) => (a.method === "SL" ? `SL ${a.usefulLifeMonths}m` : `WDV ${(a.wdvRateBp ?? 0) / 100}%`) },
          { header: "Cost", value: (a) => a.cost, format: "money", width: 16 },
          { header: "Accumulated depreciation", value: (a) => a.accumulatedDep, format: "money", width: 16 },
          { header: "Net book value", value: (a) => netBookValue(a), format: "money", width: 16 },
          { header: "Depreciated to", value: (a) => a.lastDepPeriod ?? "" },
          { header: "Status", value: (a) => a.status },
          { header: "Serial", value: (a) => a.serialNo ?? "" },
          { header: "Location", value: (a) => a.location ?? "" },
        ],
      },
    ]);
    downloadBuffer(buf, `fixed-asset-register-${todayColombo()}.xlsx`);
  }

  return (
    <div className="page">
      <PageHead
        title="Fixed assets"
        subtitle="Asset register with straight-line or written-down-value depreciation (LKAS 16), monthly depreciation runs that catch up missed months, and disposals with gain or loss."
        actions={
          <>
            <button className="btn" onClick={exportXlsx}>Export register</button>
            {canBooks(role) ? <button className="btn primary" onClick={() => setEditing("new")}>New asset</button> : null}
          </>
        }
      />
      <div className="grid cols-3">
        <Stat label="Cost" value={money(cost)} />
        <Stat label="Accumulated depreciation" value={money(dep)} />
        <Stat label="Net book value" value={money(cost - dep)} />
        <Stat label="Assets in use" value={live.length} />
      </div>
      {canBooks(role) ? (
        <div className="card card-body row wrap">
          <Field label="Depreciation for period"><input className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
          <button className="btn primary" style={{ alignSelf: "flex-end" }} disabled={busy} onClick={() => run<{ number?: string } | null>({ action: "runDepreciation", period }, (r) => (r ? `Depreciation posted ${r.number ?? ""}` : "Nothing to depreciate for that period"))}>
            Run depreciation
          </button>
        </div>
      ) : null}
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Code</th><th>Asset</th><th>Category</th><th className="num">Cost</th><th className="num">Accumulated</th><th className="num">Book value</th><th>Depreciated to</th><th>Status</th></tr></thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setOpen(a)}>
                <td className="mono">{a.code}</td>
                <td>{a.name}</td>
                <td className="muted">{a.category}</td>
                <td className="num">{amount(a.cost)}</td>
                <td className="num">{amount(a.accumulatedDep)}</td>
                <td className="num">{amount(netBookValue(a))}</td>
                <td>{a.lastDepPeriod ?? "—"}</td>
                <td><span className={`badge ${a.status === "active" ? "good" : a.status === "disposed" ? "bad" : ""}`}>{a.status === "fullyDepreciated" ? "Fully depreciated" : a.status}</span></td>
              </tr>
            ))}
            {!list.length ? <tr><td colSpan={8} className="muted">No assets registered.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {open && !editing ? <AssetDetail asset={open} onClose={() => setOpen(null)} onEdit={() => setEditing(open)} /> : null}
      {editing ? <AssetEditor {...(editing === "new" ? {} : { asset: editing })} onClose={() => { setEditing(null); setOpen(null); }} /> : null}
    </div>
  );
}
