import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useConsole } from "../App";
import { COUNTRIES, LK_TOWNS } from "../geo";
import { Icon } from "../icons";
import { useAction, useSession } from "../state";
import { INDUSTRIES, ago, date, initials, liveStatus } from "../types";
import { Field, Loading, Modal, PageHead, SubscriptionBadge } from "../ui";

export interface ClientForm {
  id: string;
  name: string;
  legalName: string;
  contact: { name: string; email: string; phone: string };
  address: string;
  industry: string;
  city: string;
  country: string;
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
  industry: "Restaurant",
  city: "",
  country: "LK",
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
      <Field label="Industry">
        <select className="input" value={f.industry} onChange={(e) => set({ ...f, industry: e.target.value })}>
          <option value="">Not set</option>
          {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
        </select>
      </Field>
      <Field label="Town or city" hint={f.country === "LK" ? "Shown on the map (e.g. Colombo, Kandy, Galle)" : "Shown in lists; the map uses the country"}>
        <input className="input" list="lk-towns" value={f.city} onChange={(e) => set({ ...f, city: e.target.value })} placeholder="Colombo" />
        <datalist id="lk-towns">{Object.keys(LK_TOWNS).map((t) => <option key={t} value={t.replace(/\b\w/g, (ch) => ch.toUpperCase())} />)}</datalist>
      </Field>
      <Field label="Country">
        <select className="input" value={f.country} onChange={(e) => set({ ...f, country: e.target.value })}>
          {Object.entries(COUNTRIES).sort((a, b) => (a[0] === "LK" ? -1 : b[0] === "LK" ? 1 : a[1][0].localeCompare(b[1][0]))).map(([code, [name]]) => <option key={code} value={code}>{name}</option>)}
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
  const { clients, unknown, latest } = useConsole();
  const { can } = useSession();
  const { busy, run } = useAction();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState<ClientForm | null>(null);
  const [q, setQ] = useState("");
  // The dashboard's "Add client" opens the form here.
  useEffect(() => {
    if (params.get("add") === "1" && can("clients")) {
      setAdding(emptyClient());
      setParams({}, { replace: true });
    }
  }, [params, setParams, can]);
  if (!clients) return <Loading />;
  const t = q.trim().toLowerCase();
  const shown = t ? clients.filter((c) => [c.name, c.id, c.projectId, c.city, c.industry, c.contact?.name].some((v) => v?.toLowerCase().includes(t))) : clients;

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
        {can("clients") ? <button className="btn primary" onClick={() => setAdding(emptyClient())}><Icon name="plus" size={18} /> Add client</button> : null}
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
        <div className="card-head">
          <h2 className="grow">All clients <span className="muted small">({clients.length})</span></h2>
          <div className="search inline">
            <Icon name="search" size={18} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, town, project…" aria-label="Filter clients" />
          </div>
        </div>
        <div className="table-wrap">
          <table className="clients-table">
            <thead><tr><th>Client</th><th className="hide-sm">Industry</th><th className="hide-sm">Location</th><th>Status</th><th className="hide-sm">Version</th><th className="hide-sm">Licence until</th><th>Subscription</th></tr></thead>
            <tbody>
              {shown.map((c) => {
                const st = liveStatus(c, latest);
                return (
                  <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                    <td><div className="who-cell"><span className="avatar sm" aria-hidden="true">{initials(c.name)}</span><span><strong>{c.name}</strong><span className="tiny muted">{c.projectId} · wave {c.wave}{c.enabled ? "" : " · updates off"}</span></span></div></td>
                    <td className="hide-sm">{c.industry || "—"}</td>
                    <td className="hide-sm">{[c.city, c.country && c.country !== "LK" ? c.country : ""].filter(Boolean).join(", ") || "—"}</td>
                    <td><span className="status"><span className={`status-dot ${st.tone}`} aria-hidden="true" />{st.label}</span></td>
                    <td className="hide-sm">{c.health?.appVersion ?? "—"}</td>
                    <td className="hide-sm">{c.licence ? `${date(c.licence.expiresAt)} · ${c.licence.edition}` : "—"}</td>
                    <td><SubscriptionBadge c={c} /></td>
                  </tr>
                );
              })}
              {!shown.length ? <tr><td colSpan={7} className="empty">{clients.length ? `No client matches “${q}”.` : "No clients yet."}</td></tr> : null}
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
