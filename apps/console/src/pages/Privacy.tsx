import { orderBy } from "firebase/firestore";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useCol, useDocData, useSession } from "../state";
import { type Client, type ClientPrivacy, date } from "../types";
import { Field, Loading, Modal, PageHead } from "../ui";

interface Retention {
  usageDays: number;
  unknownDays: number;
  requestDays: number;
  deploymentDays: number;
}
const DEFAULTS: Retention = { usageDays: 730, unknownDays: 90, requestDays: 730, deploymentDays: 730 };

function AgreementForm({ c, onClose }: { c: Client; onClose: () => void }) {
  const { busy, run } = useAction();
  const [p, setP] = useState<ClientPrivacy>({ dpaSignedOn: "", dpaVersion: "1.0", contactName: c.contact?.name ?? "", contactEmail: c.contact?.email ?? "", notes: "", ...(c.privacy ?? {}) });
  return (
    <Modal title={`Data agreement · ${c.name}`} onClose={onClose}>
      <div className="grid cols-2">
        <Field label="Signed on"><input className="input" type="date" value={p.dpaSignedOn ?? ""} onChange={(e) => setP({ ...p, dpaSignedOn: e.target.value })} /></Field>
        <Field label="Agreement version"><input className="input" value={p.dpaVersion ?? ""} onChange={(e) => setP({ ...p, dpaVersion: e.target.value })} /></Field>
        <Field label="Client's data protection contact"><input className="input" value={p.contactName ?? ""} onChange={(e) => setP({ ...p, contactName: e.target.value })} /></Field>
        <Field label="Their email"><input className="input" type="email" value={p.contactEmail ?? ""} onChange={(e) => setP({ ...p, contactEmail: e.target.value })} /></Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={3} value={p.notes ?? ""} onChange={(e) => setP({ ...p, notes: e.target.value })} /></Field>
      <div className="row"><span className="grow" /><button className="btn primary" disabled={busy} onClick={async () => (await run("savePrivacy", { clientId: c.id, privacy: p }, "Saved")) && onClose()}>Save</button></div>
    </Modal>
  );
}

function EraseForm({ c, onClose }: { c: Client; onClose: () => void }) {
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState("");
  return (
    <Modal title={`Erase ${c.name}'s data`} onClose={onClose}>
      <p className="small">Removes the contact details, notes, town, check-in health, daily figures and business requests the console holds about {c.name}. Payments, licences and the audit log stay: they are financial and contract records the law requires us to keep.</p>
      <Field label={`Type ${c.name} to confirm`}><input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      <div className="row"><span className="grow" /><button className="btn danger" disabled={busy || confirm !== c.name} onClick={async () => (await run("eraseClient", { clientId: c.id, confirm }, `${c.name}'s data erased`)) && onClose()}>Erase</button></div>
    </Modal>
  );
}

async function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Privacy & data: what the console holds about clients and why, how long it is kept, each client's
 * data agreement, and exporting or erasing a client's data (docs/24).
 */
export function PrivacyPage() {
  const { can } = useSession();
  const { busy, run } = useAction();
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  const saved = useDocData<Retention>("config/privacy");
  const [r, setR] = useState<Retention | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
  const [erasing, setErasing] = useState<Client | null>(null);
  if (!clients || saved === undefined) return <Loading />;
  const ret = r ?? { ...DEFAULTS, ...(saved ?? {}) };
  const signed = clients.filter((c) => c.privacy?.dpaSignedOn).length;
  const INVENTORY: [string, string, string, string][] = [
    ["Client records", "Business and legal name, address, town, contact person (name, phone, email)", "The contract, support and billing", "Until erased after the contract ends"],
    ["Licences and status", "Licence ids, edition, modules, dates; signed active/suspended status", "Licensing the software", "Kept with the contract records"],
    ["Payments", "Amounts, dates, methods, references", "Billing and tax records", "As long as tax law requires"],
    ["Check-in health", "App versions, device ids and versions, error counts, business names, numbers of employees and logins", "Support and updates", "Latest check-in only"],
    ["Daily figures", "Per business per day: checks, covers, net sales, total — only when the owner shares them", "Reports and the client's own analytics", `${ret.usageDays} days`],
    ["Business requests", "Business name, modules, and the name and email of the person asking", "Approving new businesses", `${ret.requestDays} days after the decision`],
    ["Unregistered check-ins", "Project id, business names, version", "Adding a new client", `${ret.unknownDays} days`],
    ["Audit log", "What each staff member did, when", "Accountability", "Kept"],
  ];
  return (
    <>
      <PageHead title="Privacy & data" sub="What the console holds about clients and why, how long it is kept, and each client's data agreement." />
      <div className="callout good small">
        The console never receives clients' guest, customer or employee details, bills or menus: they stay in each client's own Firebase project. Check-ins carry versions, counts and — only if the owner allows — daily totals.
      </div>
      <div className="card">
        <div className="card-head"><h2>What the console holds</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Data</th><th>What</th><th>Why</th><th>Kept</th></tr></thead>
            <tbody>{INVENTORY.map(([a, b, c, d]) => <tr key={a}><td><strong>{a}</strong></td><td className="small">{b}</td><td className="small">{c}</td><td className="small">{d}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      {can("settings") ? (
        <div className="card card-body stack">
          <h2>How long data is kept</h2>
          <p className="small muted">Applied every morning. Payments, licences and the audit log are not deleted automatically.</p>
          <div className="grid cols-4">
            <Field label="Daily figures (days)"><input className="input" type="number" min={30} max={3650} value={ret.usageDays} onChange={(e) => setR({ ...ret, usageDays: Number(e.target.value) })} /></Field>
            <Field label="Business requests (days)"><input className="input" type="number" min={30} max={3650} value={ret.requestDays} onChange={(e) => setR({ ...ret, requestDays: Number(e.target.value) })} /></Field>
            <Field label="Unregistered check-ins (days)"><input className="input" type="number" min={30} max={3650} value={ret.unknownDays} onChange={(e) => setR({ ...ret, unknownDays: Number(e.target.value) })} /></Field>
            <Field label="Deployment records (days)"><input className="input" type="number" min={30} max={3650} value={ret.deploymentDays} onChange={(e) => setR({ ...ret, deploymentDays: Number(e.target.value) })} /></Field>
          </div>
          <div className="row"><span className="grow" /><button className="btn primary" disabled={busy || !r} onClick={async () => (await run("saveRetention", { retention: ret }, "Retention saved")) && setR(null)}>Save</button></div>
        </div>
      ) : null}
      <div className="card">
        <div className="card-head"><h2 className="grow">Data agreements</h2><span className={`badge ${signed === clients.length ? "good" : "warn"}`}>{signed} of {clients.length} signed</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Agreement</th><th>Data contact</th><th>Shares daily figures</th><th /></tr></thead>
            <tbody>
              {clients.map((c) => {
                const sharing = c.health?.tenants.length ? c.health.tenants.every((t) => t.shareUsage) ? "Yes" : c.health.tenants.some((t) => t.shareUsage) ? "Some businesses" : "No" : "—";
                return (
                  <tr key={c.id}>
                    <td><Link to={`/clients/${c.id}`}>{c.name}</Link>{c.erasedAt ? <div className="tiny muted">Data erased {date(c.erasedAt)}</div> : null}</td>
                    <td>{c.privacy?.dpaSignedOn ? <span className="badge good">v{c.privacy.dpaVersion || "1"} · {date(c.privacy.dpaSignedOn)}</span> : <span className="badge warn">Not signed</span>}</td>
                    <td className="small">{c.privacy?.contactEmail || c.privacy?.contactName || "—"}</td>
                    <td className="small">{sharing}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {can("clients") ? <button className="btn sm" onClick={() => setEditing(c)}>Agreement</button> : null}
                        {can("suspend") ? <button className="btn sm" disabled={busy} onClick={async () => { const d = await run("exportClient", { clientId: c.id }, "Export ready"); if (d) await download(`${c.id}-console-data.json`, d); }}>Export</button> : null}
                        {can("settings") && c.status === "cancelled" && !c.erasedAt ? <button className="btn sm danger" onClick={() => setErasing(c)}>Erase</button> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!clients.length ? <tr><td colSpan={5} className="empty">No clients yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {editing ? <AgreementForm c={editing} onClose={() => setEditing(null)} /> : null}
      {erasing ? <EraseForm c={erasing} onClose={() => setErasing(null)} /> : null}
    </>
  );
}
