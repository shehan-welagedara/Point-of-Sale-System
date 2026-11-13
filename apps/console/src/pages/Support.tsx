import { useState } from "react";
import { Link } from "react-router-dom";
import { useConsole } from "../App";
import { Icon } from "../icons";
import { useAction, useDocData, useSession } from "../state";
import { ago, dateTime, healthState, initials } from "../types";
import { Field, Loading, PageHead } from "../ui";

/** One message for every client at once (a client's own notice takes precedence). */
function Broadcast() {
  const { can } = useSession();
  const { busy, run } = useAction();
  const current = useDocData<{ text?: string; level?: "info" | "warn"; until?: string; by?: string; at?: string }>("config/broadcast");
  const [f, setF] = useState<{ text: string; level: "info" | "warn"; until: string } | null>(null);
  if (current === undefined) return null;
  const v = f ?? { text: current?.text ?? "", level: current?.level ?? "info", until: current?.until?.slice(0, 10) ?? "" };
  return (
    <section className="card card-body stack">
      <div className="row wrap"><h2 className="grow">Message to all clients</h2>{current?.text ? <span className="small muted">Showing since {dateTime(current.at)} ({current.by})</span> : null}</div>
      <p className="small muted">Shown in every client's back office from their next check-in (within the hour), unless you set a notice for that client. Use it for support hours, holidays or planned work.</p>
      <Field label="Message"><textarea className="input" maxLength={400} value={v.text} disabled={!can("clients")} onChange={(e) => setF({ ...v, text: e.target.value })} /></Field>
      <div className="row wrap">
        <Field label="Style"><select className="input" value={v.level} disabled={!can("clients")} onChange={(e) => setF({ ...v, level: e.target.value as "info" | "warn" })}><option value="info">Information</option><option value="warn">Warning</option></select></Field>
        <Field label="Until (optional)"><input className="input" type="date" value={v.until} disabled={!can("clients")} onChange={(e) => setF({ ...v, until: e.target.value })} /></Field>
        <span className="grow" />
        {can("clients") ? <button className="btn primary" disabled={busy || !f} onClick={async () => (await run("setBroadcast", v, v.text ? "Message saved" : "Message cleared")) && setF(null)}>{v.text ? "Save message" : "Clear message"}</button> : null}
      </div>
    </section>
  );
}

export function SupportPage() {
  const { clients, latest, company } = useConsole();
  const { can } = useSession();
  const gh = useDocData<{ owner?: string; repo?: string; ref?: string }>("config/github");
  if (!clients) return <Loading />;
  const now = new Date();
  const live = clients.filter((c) => c.status !== "cancelled");
  const problems = live
    .map((c) => ({ c, h: healthState(c, latest, now) }))
    .filter(({ c, h }) => h.state === "offline" || (c.health?.tenants.some((t) => t.errors24h > 0) ?? false) || Boolean(c.link?.lastError));
  const docs = gh?.owner && gh.repo ? `https://github.com/${gh.owner}/${gh.repo}/blob/${gh.ref || "main"}/docs` : null;
  const guides: [string, string, string][] = [
    ["Deploying and updating clients", "18-deployment-manual.md", "Set up a client's Firebase project, first deploy and updates"],
    ["Polymath Console", "22-polymath-console.md", "How the console, the hourly check-in, updates and approvals work"],
    ["Privacy and data protection", "24-privacy-and-data-protection.md", "What each side holds, agreements, access and erasure"],
    ["Console deployment and configuration", "23-polymath-console-deployment.md", "Set up this console, staff, clients and GitHub"],
    ["User manual", "user-manual.md", "For the client's owner and staff"],
  ];
  return (
    <>
      <PageHead title="Support center" sub="Who to call at each client, which systems need help, and the guides." />
      <div className="grid cols-2">
        <section className="card">
          <div className="card-head"><h2 className="grow">What your clients see</h2>{can("settings") ? <Link to="/settings" className="small">Edit in Settings</Link> : null}</div>
          <div className="card-body stack">
            <p className="small muted">Every client's About page shows these details under “Polymath Tech: help and support”. They update at the next check-in.</p>
            <dl className="kv">
              <dt>Name</dt><dd>{company?.name || "Polymath Tech"}</dd>
              <dt>Email</dt><dd>{company?.email || <span className="muted">not set</span>}</dd>
              <dt>Phone</dt><dd>{company?.phone || <span className="muted">not set</span>}</dd>
              <dt>WhatsApp</dt><dd>{company?.whatsapp || <span className="muted">not set</span>}</dd>
              <dt>Website</dt><dd>{company?.website || <span className="muted">not set</span>}</dd>
            </dl>
          </div>
        </section>
        <section className="card">
          <div className="card-head"><h2 className="grow">Guides</h2></div>
          <ul className="guide-list">
            {guides.map(([t, f, s]) => (
              <li key={f}>
                <span className="act-icon" aria-hidden="true"><Icon name="book" size={18} /></span>
                <span className="grow">
                  {docs ? <a href={`${docs}/${f}`} target="_blank" rel="noreferrer"><strong>{t}</strong></a> : <strong>{t}</strong>}
                  <span className="tiny muted">{s}{docs ? "" : ` (docs/${f} in the repository)`}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <Broadcast />
      <section className="card">
        <div className="card-head"><h2 className="grow">Systems that need help</h2><Link to="/monitoring" className="small">Monitoring</Link></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Client</th><th>Problem</th><th>Last check-in</th><th>Call</th></tr></thead>
            <tbody>
              {problems.map(({ c, h }) => (
                <tr key={c.id}>
                  <td><Link to={`/clients/${c.id}?tab=health`}><strong>{c.name}</strong></Link></td>
                  <td className="small">{[...h.reasons, ...(c.link?.lastError ? [`check-in refused: ${c.link.lastError}`] : [])].filter((r, i, a) => a.indexOf(r) === i).slice(0, 3).join("; ")}</td>
                  <td>{ago(c.health?.lastCheckinAt)}</td>
                  <td className="small">{c.contact?.name || "—"}{c.contact?.phone ? <> · <a href={`tel:${c.contact.phone.replace(/\s/g, "")}`}>{c.contact.phone}</a></> : null}</td>
                </tr>
              ))}
              {!problems.length ? <tr><td colSpan={4} className="empty"><Icon name="check" /> No system needs help right now.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card">
        <div className="card-head"><h2 className="grow">Client contacts</h2></div>
        <div className="contacts">
          {live.map((c) => (
            <div key={c.id} className="contact">
              <span className="avatar" aria-hidden="true">{initials(c.name)}</span>
              <div className="grow stack tight">
                <Link to={`/clients/${c.id}`}><strong>{c.name}</strong></Link>
                <span className="small">{c.contact?.name || <span className="muted">No contact person</span>}</span>
                <span className="row wrap small">
                  {c.contact?.phone ? <a href={`tel:${c.contact.phone.replace(/\s/g, "")}`} className="row"><Icon name="phone" size={16} />{c.contact.phone}</a> : null}
                  {c.contact?.email ? <a href={`mailto:${c.contact.email}`} className="row"><Icon name="mail" size={16} />{c.contact.email}</a> : null}
                </span>
                <span className="tiny muted">Maintenance window {c.maintenanceWindow || "—"}</span>
              </div>
            </div>
          ))}
          {!live.length ? <div className="empty">No clients yet.</div> : null}
        </div>
      </section>
    </>
  );
}
