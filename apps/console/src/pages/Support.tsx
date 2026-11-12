import { Link } from "react-router-dom";
import { useConsole } from "../App";
import { Icon } from "../icons";
import { useDocData, useSession } from "../state";
import { ago, healthState, initials } from "../types";
import { Loading, PageHead } from "../ui";

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
    ["Polymath Console", "22-polymath-console.md", "How the console and the daily check-in work"],
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
