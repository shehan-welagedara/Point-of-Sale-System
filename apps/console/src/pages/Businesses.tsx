import { businessKey } from "@pos/core";
import { limit, orderBy } from "firebase/firestore";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useCol, useSession } from "../state";
import { type BusinessRequest, type Client, date, dateTime } from "../types";
import { Field, Loading, PageHead } from "../ui";

const WHERE: Record<string, string> = { "this-system": "already in this system", request: "also requested", "other-client": "at another client" };

function RequestCard({ r, client, canDecide }: { r: BusinessRequest; client?: Client; canDecide: boolean }) {
  const { busy, run } = useAction();
  const [message, setMessage] = useState("");
  const [different, setDifferent] = useState(false);
  const here = r.duplicates.filter((d) => d.where === "this-system");
  const contact = client?.contact?.email?.toLowerCase();
  const isContact = Boolean(contact && contact === r.requestedBy.email.toLowerCase());
  return (
    <div className="card card-body stack" data-request={r.name}>
      <div className="row wrap">
        <h3 className="grow" style={{ margin: 0 }}>
          {r.name} {r.kind === "demo" ? <span className="badge">Demo</span> : null}
        </h3>
        <span className="small muted">{dateTime(r.receivedAt)}</span>
      </div>
      <div className="small">
        <Link to={`/clients/${r.clientId}`}>{r.clientName}</Link> · asked by <strong>{r.requestedBy.name || r.requestedBy.email}</strong> ({r.requestedBy.email}){" "}
        {contact ? isContact ? <span className="badge good">client's contact</span> : <span className="badge warn">not the client's contact ({client?.contact?.email})</span> : <span className="badge">no contact email on file</span>}
      </div>
      {r.modules.length ? <div className="row wrap">{r.modules.map((m) => <span key={m} className="badge">{m}</span>)}</div> : null}
      {r.note ? <div className="small">Note: {r.note}</div> : null}
      {r.duplicates.length ? (
        <div className={`callout ${here.length ? "warn" : ""} small`}>
          Same name {r.duplicates.map((d) => `${WHERE[d.where]}: ${d.name}${d.clientName ? ` (${d.clientName})` : ""}${d.status && d.status !== "active" ? ` [${d.status}]` : ""}`).join("; ")}.
          {here.length ? " If it was opened by mistake, decline and ask the owner to use the existing one." : ""}
        </div>
      ) : (
        <div className="callout good small">No business with this name anywhere.</div>
      )}
      {canDecide ? (
        <>
          <Field label="Message to the owner" hint="Required to decline; shown on their screen."><input className="input" value={message} maxLength={400} onChange={(e) => setMessage(e.target.value)} placeholder={here.length ? "You already have this business: open it from the business list." : "Welcome! Your business is ready to set up."} /></Field>
          {here.length ? <label className="check"><input type="checkbox" checked={different} onChange={(e) => setDifferent(e.target.checked)} /> It's a different business with the same name</label> : null}
          <div className="row">
            <span className="grow" />
            <button className="btn danger" disabled={busy || !message.trim()} onClick={() => void run("decideBusiness", { id: r.id, decision: "rejected", message }, `Declined ${r.name}`)}>Decline</button>
            <button className="btn primary" disabled={busy || (here.length > 0 && !different)} onClick={() => void run("decideBusiness", { id: r.id, decision: "approved", message, confirmDuplicate: different }, `Approved ${r.name}`)}>Approve</button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * Businesses: requests to open a business wait here for approval (step two after the client's system
 * is confirmed), with duplicates flagged; and every business in every client's system (docs/22 §9).
 */
export function BusinessesPage() {
  const { can } = useSession();
  const requests = useCol<BusinessRequest>("businessRequests", [orderBy("receivedAt", "desc"), limit(200)], "br");
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  if (!requests || !clients) return <Loading />;
  const byId = new Map(clients.map((c) => [c.id, c]));
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending").slice(0, 20);
  const rows = clients.flatMap((c) =>
    (c.health?.tenants ?? []).map((t) => {
      const dup = (c.health?.tenants ?? []).filter((o) => o.id !== t.id && o.status !== "archived" && businessKey(o.name) === businessKey(t.name));
      const unapproved = !t.approval && Boolean(c.approvalsSince && t.createdAt && t.createdAt > c.approvalsSince && c.approvals !== "off");
      return { c, t, dup, unapproved };
    }),
  );
  const flagged = rows.filter((r) => (r.dup.length && r.t.status !== "archived") || r.unapproved).length;
  return (
    <>
      <PageHead title="Businesses" sub="New businesses wait here for your approval. Check who is asking and whether the business already exists." />
      <div className="card">
        <div className="card-head"><h2 className="grow">Waiting for approval</h2>{pending.length ? <span className="badge warn">{pending.length}</span> : null}</div>
        <div className="card-body stack">
          {pending.map((r) => <RequestCard key={r.id} r={r} client={byId.get(r.clientId)} canDecide={can("clients")} />)}
          {!pending.length ? <div className="empty" style={{ padding: 12 }}>Nothing waiting. When a client opens a new business, it appears here first.</div> : null}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2 className="grow">Every business</h2>{flagged ? <span className="badge warn">{flagged} to look at</span> : null}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Business</th><th>Status</th><th>Opened</th><th>Approval</th></tr></thead>
            <tbody>
              {rows.map(({ c, t, dup, unapproved }) => (
                <tr key={`${c.id}/${t.id}`}>
                  <td><Link to={`/clients/${c.id}`}>{c.name}</Link></td>
                  <td>
                    {t.name}
                    {dup.length && t.status !== "archived" ? <div><span className="badge warn">Same name as {dup.map((d) => d.name).join(", ")}</span></div> : null}
                  </td>
                  <td>{t.status === "archived" ? <span className="badge">Archived</span> : <span className="badge good">Active</span>}</td>
                  <td className="small">{t.createdAt ? date(t.createdAt) : "—"}</td>
                  <td className="small">{t.approval ? <span className="badge good">Approved {date(t.approval.approvedAt)}</span> : unapproved ? <span className="badge bad">Not approved</span> : <span className="muted">Before approvals</span>}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={5} className="empty">No check-ins yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {decided.length ? (
        <div className="card">
          <div className="card-head"><h2>Decided</h2></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Business</th><th>Client</th><th>Asked by</th><th>Decision</th><th>By</th></tr></thead>
              <tbody>
                {decided.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.clientName}</td>
                    <td className="small">{r.requestedBy.email}</td>
                    <td><span className={`badge ${r.status === "approved" ? "good" : "bad"}`}>{r.status === "approved" ? "Approved" : "Declined"}</span>{r.message ? <div className="tiny muted">{r.message}</div> : null}</td>
                    <td className="small">{r.decidedBy} · {dateTime(r.decidedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}
