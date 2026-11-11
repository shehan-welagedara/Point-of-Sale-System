import { orderBy } from "firebase/firestore";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAction, useCol, useDocData, useSession } from "../state";
import { type Client, type UnknownProject, ago, compareVersions, date } from "../types";
import { Field, HealthBadge, Loading, Modal, PageHead, StatusBadge, SubscriptionBadge } from "../ui";

export interface ClientForm {
  id: string;
  name: string;
  legalName: string;
  contact: { name: string; email: string; phone: string };
  address: string;
  notes: string;
  projectId: string;
  projectNumber: string;
  region: string;
  wave: number;
  maintenanceWindow: string;
  enabled: boolean;
}

export const emptyClient = (p: Partial<ClientForm> = {}): ClientForm => ({
  id: "",
  name: "",
  legalName: "",
  contact: { name: "", email: "", phone: "" },
  address: "",
  notes: "",
  projectId: "",
  projectNumber: "",
  region: "asia-south1",
  wave: 1,
  maintenanceWindow: "23:30-05:00 Asia/Colombo",
  enabled: true,
  ...p,
});

export function ClientFields({ f, set, isNew }: { f: ClientForm; set: (f: ClientForm) => void; isNew: boolean }) {
  return (
    <div className="grid cols-2">
      <Field label="Client id" hint="Short, lowercase, with dashes. Used by the release tool (release:deploy --target …).">
        <input className="input" value={f.id} disabled={!isNew} onChange={(e) => set({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") })} placeholder="noura-kitchen" required />
      </Field>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => set({ ...f, name: e.target.value })} placeholder="Noura Kitchen" required /></Field>
      <Field label="Registered name (on the licence)"><input className="input" value={f.legalName} onChange={(e) => set({ ...f, legalName: e.target.value })} placeholder="Noura Kitchen (Pvt) Ltd" /></Field>
      <Field label="Firebase project ID" hint="Firebase console → Project settings → Project ID">
        <input className="input mono" value={f.projectId} onChange={(e) => set({ ...f, projectId: e.target.value.trim().toLowerCase() })} placeholder="noura-kitchen-pos" required />
      </Field>
      <Field label="Project number (optional)" hint="Same page, under the ID. If empty, you confirm it at the first check-in.">
        <input className="input mono" value={f.projectNumber} onChange={(e) => set({ ...f, projectNumber: e.target.value.replace(/\D/g, "") })} />
      </Field>
      <Field label="Release wave" hint="1 = pilot clients, updated first; 2 = everyone else">
        <select className="input" value={f.wave} onChange={(e) => set({ ...f, wave: Number(e.target.value) })}>
          <option value={1}>Wave 1 (pilot)</option>
          <option value={2}>Wave 2</option>
        </select>
      </Field>
      <Field label="Contact person"><input className="input" value={f.contact.name} onChange={(e) => set({ ...f, contact: { ...f.contact, name: e.target.value } })} /></Field>
      <Field label="Contact email"><input className="input" type="email" value={f.contact.email} onChange={(e) => set({ ...f, contact: { ...f.contact, email: e.target.value } })} /></Field>
      <Field label="Contact phone"><input className="input" value={f.contact.phone} onChange={(e) => set({ ...f, contact: { ...f.contact, phone: e.target.value } })} /></Field>
      <Field label="Maintenance window"><input className="input" value={f.maintenanceWindow} onChange={(e) => set({ ...f, maintenanceWindow: e.target.value })} /></Field>
      <Field label="Address"><input className="input" value={f.address} onChange={(e) => set({ ...f, address: e.target.value })} /></Field>
      <Field label="Region"><input className="input" value={f.region} onChange={(e) => set({ ...f, region: e.target.value })} /></Field>
      <label className="check"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ ...f, enabled: e.target.checked })} /> Include in releases</label>
      <div style={{ gridColumn: "1 / -1" }}>
        <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => set({ ...f, notes: e.target.value })} /></Field>
      </div>
    </div>
  );
}

export function ClientsPage() {
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  const unknown = useCol<UnknownProject>("unknownProjects");
  const gh = useDocData<{ latestVersion?: string }>("config/github");
  const { can } = useSession();
  const { busy, run } = useAction();
  const nav = useNavigate();
  const [adding, setAdding] = useState<ClientForm | null>(null);
  if (!clients) return <Loading />;
  const latest = gh?.latestVersion ?? clients.map((c) => c.health?.appVersion).filter((v): v is string => Boolean(v)).sort(compareVersions).pop();

  const save = async () => {
    if (!adding) return;
    const r = await run<{ id: string }>("saveClient", { create: true, client: adding }, `${adding.name} added`);
    if (r) {
      setAdding(null);
      nav(`/clients/${r.id}`);
    }
  };

  return (
    <>
      <PageHead title="Clients" sub="Every business running POS Suite, with its project, status, licence and subscription.">
        {can("clients") ? <button className="btn primary" onClick={() => setAdding(emptyClient())}>Add client</button> : null}
      </PageHead>
      {unknown?.length ? (
        <div className="card">
          <div className="card-head"><h2>Checked in, not a client yet</h2><span className="muted small">A deployed system is checking in; add it as a client to manage it.</span></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Project</th><th>Businesses</th><th>Version</th><th>Last seen</th><th /></tr></thead>
              <tbody>
                {unknown.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.projectId}</td>
                    <td>{u.businesses.join(", ") || "—"}</td>
                    <td>{u.appVersion}</td>
                    <td>{ago(u.lastAt)}</td>
                    <td className="row">
                      {can("clients") ? <button className="btn sm" onClick={() => setAdding(emptyClient({ id: u.projectId.replace(/-pos$/, ""), name: u.businesses[0] ?? "", projectId: u.projectId }))}>Add as client</button> : null}
                      {can("clients") ? <button className="btn sm ghost" disabled={busy} onClick={() => void run("dismissUnknown", { projectId: u.projectId })}>Dismiss</button> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Project</th><th>Status</th><th>Health</th><th>Version</th><th>Licence until</th><th>Subscription</th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                  <td><strong>{c.name}</strong><div className="tiny muted">{c.id} · wave {c.wave}</div></td>
                  <td className="mono">{c.projectId}</td>
                  <td><StatusBadge c={c} /></td>
                  <td><HealthBadge c={c} latest={latest} /></td>
                  <td>{c.health?.appVersion ?? "—"}</td>
                  <td>{c.licence ? `${date(c.licence.expiresAt)} · ${c.licence.edition}` : "—"}</td>
                  <td><SubscriptionBadge c={c} /></td>
                </tr>
              ))}
              {!clients.length ? <tr><td colSpan={7} className="empty">No clients yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {adding ? (
        <Modal title="Add client" onClose={() => setAdding(null)}>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <ClientFields f={adding} set={setAdding} isNew />
            <div className="row"><span className="grow" /><button type="button" className="btn" onClick={() => setAdding(null)}>Cancel</button><button className="btn primary" disabled={busy}>Add client</button></div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
