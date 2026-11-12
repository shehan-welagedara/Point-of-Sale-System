import { EDITIONS, MODULES, editionInfo } from "@pos/core";
import { limit, orderBy, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAction, useCol, useDocData, useSession } from "../state";
import { type AuditEntry, CYCLE_MONTHS, type Client, type Payment, type UsageDay, ago, compareVersions, date, dateTime, fromCents, healthState, plusMonths, rupees, subscriptionState, todayColombo } from "../types";
import { Field, HealthBadge, Loading, Modal, PageHead, StatusBadge, SubscriptionBadge } from "../ui";
import { ClientFields, type ClientForm, emptyClient } from "./Clients";

type Tab = "overview" | "health" | "licence" | "subscription" | "usage" | "status" | "activity";

export function ClientDetail() {
  const { id = "" } = useParams();
  const c = useDocData<Client>(`clients/${id}`);
  const gh = useDocData<{ latestVersion?: string }>("config/github");
  const [params, setParams] = useSearchParams();
  const tabs: [Tab, string][] = [["overview", "Overview"], ["health", "Health"], ["licence", "Licence"], ["subscription", "Subscription"], ["usage", "Usage"], ["status", "Suspend / notice"], ["activity", "Activity"]];
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = asked && tabs.some(([k]) => k === asked) ? asked : "overview";
  const setTab = (k: Tab) => setParams(k === "overview" ? {} : { tab: k }, { replace: true });
  if (c === undefined) return <Loading />;
  if (c === null) return <div className="empty">No client {id}. <Link to="/clients">Back to clients</Link></div>;
  return (
    <>
      <div className="crumbs small"><Link to="/clients">Clients</Link> / {c.name}</div>
      <PageHead title={c.name} sub={<>{[c.industry, c.city].filter(Boolean).join(" · ")}{c.industry || c.city ? " · " : ""}<span className="mono">{c.projectId}</span> · wave {c.wave} · <a href={`https://${c.projectId}.web.app`} target="_blank" rel="noreferrer">{c.projectId}.web.app</a></>}>
        <div className="row wrap"><StatusBadge c={c} /><HealthBadge c={c} latest={gh?.latestVersion} /><SubscriptionBadge c={c} /></div>
      </PageHead>
      {c.link?.pendingProjectNumber ? <ConfirmProject c={c} /> : null}
      {c.status === "suspended" && c.suspension ? (
        <div className="callout bad">Suspended since {date(c.suspension.since)}; {Date.parse(c.suspension.graceUntil) > Date.now() ? `the client keeps working with a warning until ${dateTime(c.suspension.graceUntil)}` : "the licensed modules are stopped"}. Message shown: “{c.suspension.message}”</div>
      ) : null}
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "overview" ? <Overview c={c} /> : null}
      {tab === "health" ? <Health c={c} latest={gh?.latestVersion} /> : null}
      {tab === "licence" ? <LicenceTab c={c} /> : null}
      {tab === "subscription" ? <SubscriptionTab c={c} /> : null}
      {tab === "usage" ? <Usage c={c} /> : null}
      {tab === "status" ? <StatusTab c={c} /> : null}
      {tab === "activity" ? <Activity c={c} /> : null}
    </>
  );
}

function ConfirmProject({ c }: { c: Client }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  return (
    <div className="callout warn">
      <strong>First check-in from project number {c.link?.pendingProjectNumber}</strong> ({ago(c.link?.pendingAt)}). Check that it matches Firebase console → Project settings → <em>Project number</em> of {c.projectId}, then confirm. Until then the console doesn't answer this project.
      {can("suspend") ? <div style={{ marginTop: 8 }}><button className="btn sm primary" disabled={busy} onClick={() => void run("confirmProject", { clientId: c.id }, "Project confirmed: its next check-in will be answered")}>Confirm project number</button></div> : null}
    </div>
  );
}

function Overview({ c }: { c: Client }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const [f, setF] = useState<ClientForm>(() => toForm(c));
  useEffect(() => setF(toForm(c)), [c.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!can("clients")) {
    return (
      <div className="card card-body">
        <dl className="kv">
          <dt>Registered name</dt><dd>{c.legalName || "—"}</dd>
          <dt>Industry</dt><dd>{c.industry || "—"}</dd>
          <dt>Location</dt><dd>{[c.city, c.country].filter(Boolean).join(", ") || "—"}</dd>
          <dt>Contact</dt><dd>{[c.contact?.name, c.contact?.email, c.contact?.phone].filter(Boolean).join(" · ") || "—"}</dd>
          <dt>Project</dt><dd className="mono">{c.projectId}{c.projectNumber ? ` (${c.projectNumber})` : ""}</dd>
          <dt>Notes</dt><dd>{c.notes || "—"}</dd>
        </dl>
      </div>
    );
  }
  return (
    <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("saveClient", { client: f }, "Saved"); }}>
      <ClientFields f={f} set={setF} isNew={false} />
      <div className="row"><span className="tiny muted grow">Added {date(c.createdAt)} · project number {c.projectNumber ?? "not confirmed yet"}</span><button className="btn primary" disabled={busy}>Save</button></div>
    </form>
  );
}

const toForm = (c: Client): ClientForm => emptyClient({ id: c.id, name: c.name, legalName: c.legalName ?? "", contact: { name: c.contact?.name ?? "", email: c.contact?.email ?? "", phone: c.contact?.phone ?? "" }, address: c.address ?? "", industry: c.industry ?? "", city: c.city ?? "", country: c.country ?? "LK", notes: c.notes ?? "", projectId: c.projectId, projectNumber: c.projectNumber ?? "", region: c.region, wave: c.wave, maintenanceWindow: c.maintenanceWindow ?? "", enabled: c.enabled });

function Health({ c, latest }: { c: Client; latest?: string }) {
  const h = healthState(c, latest);
  if (!c.health) {
    return (
      <div className="card card-body stack">
        <p>No check-in yet. The client's system checks in once a day after it is deployed with POS Suite 1.7.0 or later and the console's address (docs/22 §4). Their owner can also press <strong>About → Check now</strong> in the back office.</p>
        {c.link?.lastError ? <div className="callout bad">Last check-in refused ({dateTime(c.link.lastErrorAt)}): {c.link.lastError}</div> : null}
      </div>
    );
  }
  return (
    <>
      <div className="grid cols-3">
        <div className="card stat"><div className="v">{c.health.appVersion}</div><div className="l">Server version{latest && compareVersions(c.health.appVersion, latest) < 0 ? ` (latest ${latest})` : ""}</div></div>
        <div className="card stat"><div className="v">{ago(c.health.lastCheckinAt)}</div><div className="l">Last check-in ({c.health.reason}) · {dateTime(c.health.lastCheckinAt)}</div></div>
        <div className="card stat"><div className="v">{c.health.tenants.reduce((n, t) => n + t.errors24h, 0)}</div><div className="l">App errors in the last 24 hours</div></div>
      </div>
      {h.reasons.length ? <div className="callout warn">{h.reasons.join(" · ")}</div> : <div className="callout good">Healthy.</div>}
      {c.health.tenants.map((t) => (
        <div key={t.id} className="card">
          <div className="card-head">
            <h3 className="grow">{t.name}</h3>
            <span className="badge brand">{editionInfo(t.plan as never)?.name ?? t.plan}</span>
            {t.licence ? <span className={`badge ${t.licence.status === "valid" ? "good" : "warn"}`}>Licence {t.licence.status} · {date(t.licence.expiresAt)}</span> : <span className="badge warn">No licence</span>}
            {t.shareUsage ? null : <span className="badge">Figures not shared</span>}
          </div>
          <div className="card-body stack tight">
            <div className="small muted">Business ID <span className="mono">{t.id}</span> · {t.counts.workstations} workstation(s), {t.counts.employees} employee(s), {t.counts.backOfficeUsers} back-office login(s) · modules: {t.modules.join(", ") || "—"}</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Device</th><th>Version</th><th>Last seen</th></tr></thead>
                <tbody>
                  {t.devices.map((d) => (
                    <tr key={d.id}><td>{d.id}</td><td>{d.appVersion ?? "—"}{latest && d.appVersion && compareVersions(d.appVersion, latest) < 0 ? <span className="badge warn" style={{ marginLeft: 6 }}>older</span> : null}</td><td>{ago(d.lastSeenAt)}</td></tr>
                  ))}
                  {!t.devices.length ? <tr><td colSpan={3} className="empty">No POS devices have reported yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function LicenceTab({ c }: { c: Client }) {
  const { can, toast } = useSession();
  const history = useCol<{ id: string; licenceId: string; edition: string; addOns: string[]; expiresAt: string; issuedAt: string; issuedBy: string; reason?: string }>("licences", [where("clientId", "==", c.id), orderBy("issuedAt", "desc"), limit(50)], c.id);
  const [issuing, setIssuing] = useState(false);
  const lic = c.licence;
  return (
    <>
      <div className="card">
        <div className="card-head">
          <h2 className="grow">Current licence</h2>
          {can("licences") ? <button className="btn primary" onClick={() => setIssuing(true)}>{lic ? "Renew or change" : "Issue licence"}</button> : null}
        </div>
        {lic ? (
          <div className="card-body stack">
            <dl className="kv">
              <dt>Licence</dt><dd className="mono">{lic.licenceId}</dd>
              <dt>Edition</dt><dd>{editionInfo(lic.edition as never)?.name ?? lic.edition}{lic.addOns.length ? ` + ${lic.addOns.map((a) => MODULES.find((m) => m.key === a)?.name ?? a).join(", ")}` : ""}</dd>
              <dt>Valid</dt><dd>{date(lic.validFrom)} to {date(lic.expiresAt)}, then {lic.graceDays} day(s) grace</dd>
              <dt>Limits</dt><dd>{Object.entries(lic.limits).map(([k, v]) => `${k} ${v}`).join(", ")}</dd>
              <dt>Business</dt><dd>{lic.tenantId === "*" ? "Every business in the project" : <span className="mono">{lic.tenantId}</span>}</dd>
              <dt>Issued</dt><dd>{dateTime(lic.issuedAt)} by {lic.issuedBy}</dd>
              <dt>Delivery</dt><dd>{c.health?.tenants.some((t) => t.licence?.licenceId === lic.licenceId) ? <span className="badge good">Active in the client's system</span> : <span className="badge warn">Reaches the client at its next check-in</span>}</dd>
            </dl>
            <div className="key" aria-label="Licence key">{lic.token}</div>
            <div className="row"><button className="btn sm" onClick={() => void navigator.clipboard.writeText(lic.token).then(() => toast("Licence key copied"))}>Copy key</button><span className="tiny muted">For pasting into Administration → Licence & modules when the client's system can't check in.</span></div>
          </div>
        ) : <div className="empty">No licence issued from the console yet.</div>}
      </div>
      <div className="card">
        <div className="card-head"><h2>History</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Licence</th><th>Edition</th><th>Until</th><th>Issued</th><th>By</th><th>Why</th></tr></thead>
            <tbody>
              {(history ?? []).map((l) => (
                <tr key={l.id}><td className="mono">{l.licenceId}</td><td>{l.edition}{l.addOns?.length ? ` + ${l.addOns.join(", ")}` : ""}</td><td>{date(l.expiresAt)}</td><td>{dateTime(l.issuedAt)}</td><td>{l.issuedBy}</td><td>{l.reason || "—"}</td></tr>
              ))}
              {history && !history.length ? <tr><td colSpan={6} className="empty">None yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {issuing ? <IssueLicence c={c} onClose={() => setIssuing(false)} /> : null}
    </>
  );
}

function IssueLicence({ c, onClose }: { c: Client; onClose: () => void }) {
  const { busy, run } = useAction();
  const prev = c.licence;
  const sub = c.subscription;
  const [edition, setEdition] = useState(prev?.edition ?? "starter");
  const [addOns, setAddOns] = useState<string[]>(prev?.addOns ?? []);
  const [expiresOn, setExpiresOn] = useState(sub?.paidUntil && sub.paidUntil > todayColombo() ? sub.paidUntil : plusMonths(todayColombo(), 12));
  const [graceDays, setGraceDays] = useState(prev?.graceDays ?? 14);
  const [workstations, setWorkstations] = useState(String(prev?.limits.workstations ?? ""));
  const [tenantId, setTenantId] = useState(prev?.tenantId ?? "*");
  const [reason, setReason] = useState(prev ? "renewal" : "new client");
  const info = editionInfo(edition as never);
  const extra = MODULES.filter((m) => m.status === "available" && !info?.modules.includes(m.key));
  const tenants = c.health?.tenants ?? [];
  const submit = async () => {
    const r = await run("issueLicence", { clientId: c.id, edition, addOns, expiresOn, graceDays, limits: workstations ? { workstations: Number(workstations) } : {}, tenantId, reason }, "Licence issued: it reaches the client at its next check-in");
    if (r) onClose();
  };
  return (
    <Modal title={prev ? "Renew or change the licence" : "Issue a licence"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="grid cols-2">
          <Field label="Edition">
            <select className="input" value={edition} onChange={(e) => setEdition(e.target.value)}>
              {EDITIONS.filter((e) => e.key !== "demo").map((e) => <option key={e.key} value={e.key}>{e.name}</option>)}
            </select>
          </Field>
          <Field label="Valid until" hint={sub?.paidUntil ? `Subscription paid until ${date(sub.paidUntil)}` : undefined}>
            <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} required />
          </Field>
          <Field label="Grace period (days)" hint="Full use after the end date, before modules stop"><input className="input" type="number" min={0} max={90} value={graceDays} onChange={(e) => setGraceDays(Number(e.target.value))} /></Field>
          <Field label="POS workstations (optional)" hint={`Edition default: ${info?.limits.workstations ?? "—"}`}><input className="input" type="number" min={1} value={workstations} onChange={(e) => setWorkstations(e.target.value)} /></Field>
          <Field label="For">
            <select className="input" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="*">Every business in {c.projectId}</option>
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name} only</option>)}
            </select>
          </Field>
          <Field label="Reason (for the history)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <div className="small muted">{info?.description}</div>
        {extra.length ? (
          <fieldset className="stack tight" style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
            <legend className="small muted">Add-on modules</legend>
            <div className="grid cols-3">
              {extra.map((m) => (
                <label key={m.key} className="check"><input type="checkbox" checked={addOns.includes(m.key)} onChange={(e) => setAddOns(e.target.checked ? [...addOns, m.key] : addOns.filter((a) => a !== m.key))} /> {m.name}</label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <div className="row"><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Issue licence</button></div>
      </form>
    </Modal>
  );
}

function SubscriptionTab({ c }: { c: Client }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const payments = useCol<Payment>(`clients/${c.id}/payments`, [orderBy("at", "desc"), limit(50)], "p");
  const s = c.subscription;
  const [f, setF] = useState({ plan: s?.plan ?? "Standard", priceLkr: s?.priceLkr ?? 0, cycle: s?.cycle ?? "annual", startedOn: s?.startedOn ?? todayColombo(), paidUntil: s?.paidUntil ?? "", cancelled: Boolean(s?.cancelled), notes: s?.notes ?? "" });
  const [paying, setPaying] = useState(false);
  const st = subscriptionState(s);
  return (
    <>
      <div className="grid cols-3">
        <div className="card stat"><div className="v">{s ? rupees(s.priceLkr) : "—"}</div><div className="l">{s ? `per ${s.cycle === "annual" ? "year" : s.cycle === "monthly" ? "month" : s.cycle === "quarterly" ? "quarter" : "licence"} · ${s.plan}` : "No subscription"}</div></div>
        <div className="card stat"><div className="v">{s?.paidUntil ? date(s.paidUntil) : "—"}</div><div className="l">Paid until</div></div>
        <div className="card stat"><div className="v"><SubscriptionBadge c={c} /></div><div className="l">{st.state === "due" ? "The client sees a renewal reminder" : st.state === "overdue" ? "The client sees an overdue notice" : "Status"}</div></div>
      </div>
      <div className="card">
        <div className="card-head"><h2 className="grow">Payments</h2>{can("clients") ? <button className="btn primary" onClick={() => setPaying(true)}>Record payment</button> : null}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Paid until</th><th>By</th></tr></thead>
            <tbody>
              {(payments ?? []).map((p) => <tr key={p.id}><td>{date(p.date)}</td><td className="num">{rupees(p.amount)}</td><td>{p.method}</td><td>{p.reference || "—"}</td><td>{date(p.paidUntil)}</td><td>{p.recordedBy}</td></tr>)}
              {payments && !payments.length ? <tr><td colSpan={6} className="empty">No payments recorded.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      {can("clients") ? (
        <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("saveSubscription", { clientId: c.id, subscription: f }, "Subscription saved"); }}>
          <h2>Plan</h2>
          <div className="grid cols-3">
            <Field label="Plan name"><input className="input" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
            <Field label="Price (Rs)"><input className="input" type="number" min={0} value={f.priceLkr} onChange={(e) => setF({ ...f, priceLkr: Number(e.target.value) })} /></Field>
            <Field label="Billing cycle">
              <select className="input" value={f.cycle} onChange={(e) => setF({ ...f, cycle: e.target.value as typeof f.cycle })}>
                <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option><option value="perpetual">Perpetual (one-off)</option>
              </select>
            </Field>
            <Field label="Started on"><input className="input" type="date" value={f.startedOn} onChange={(e) => setF({ ...f, startedOn: e.target.value })} /></Field>
            <Field label="Paid until"><input className="input" type="date" value={f.paidUntil} onChange={(e) => setF({ ...f, paidUntil: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={f.cancelled} onChange={(e) => setF({ ...f, cancelled: e.target.checked })} /> Cancelled</label>
          </div>
          <Field label="Notes"><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <div className="row"><span className="grow" /><button className="btn primary" disabled={busy}>Save plan</button></div>
        </form>
      ) : null}
      {paying ? <RecordPayment c={c} onClose={() => setPaying(false)} /> : null}
    </>
  );
}

function RecordPayment({ c, onClose }: { c: Client; onClose: () => void }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const s = c.subscription;
  const from = s?.paidUntil && s.paidUntil > todayColombo() ? s.paidUntil : todayColombo();
  const [f, setF] = useState({ date: todayColombo(), amount: s?.priceLkr ?? 0, method: "bank transfer", reference: "", paidUntil: plusMonths(from, CYCLE_MONTHS[s?.cycle ?? "annual"] || 12), renewLicence: Boolean(c.licence) && can("licences") });
  const submit = async () => {
    const r = await run("recordPayment", { clientId: c.id, ...f }, f.renewLicence ? "Payment recorded and licence renewed" : "Payment recorded");
    if (r) onClose();
  };
  return (
    <Modal title="Record payment" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="grid cols-2">
          <Field label="Date received"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Amount (Rs)"><input className="input" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} required /></Field>
          <Field label="Method">
            <select className="input" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              <option>bank transfer</option><option>cash</option><option>cheque</option><option>card</option><option>LankaQR</option>
            </select>
          </Field>
          <Field label="Reference"><input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} placeholder="Bank ref, receipt no." /></Field>
          <Field label="Now paid until"><input className="input" type="date" value={f.paidUntil} onChange={(e) => setF({ ...f, paidUntil: e.target.value })} required /></Field>
        </div>
        {c.licence ? <label className="check"><input type="checkbox" checked={f.renewLicence} disabled={!can("licences")} onChange={(e) => setF({ ...f, renewLicence: e.target.checked })} /> Renew the licence to {date(f.paidUntil)} (same edition and modules)</label> : <div className="small muted">Issue the first licence on the Licence tab.</div>}
        <div className="row"><span className="grow" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>Record payment</button></div>
      </form>
    </Modal>
  );
}

function Usage({ c }: { c: Client }) {
  const days = useCol<UsageDay>(`clients/${c.id}/usage`, [orderBy("date", "desc"), limit(60)], "u");
  if (!days) return <Loading />;
  if (!days.length) return <div className="card empty">No figures yet. They arrive with the daily check-in when the client's owner shares them (About → Share daily figures with Polymath Tech).</div>;
  const last30 = days.slice(0, 30).reverse();
  const max = Math.max(...last30.map((d) => d.netSales), 1);
  const sum = (k: "checks" | "covers" | "netSales" | "total") => last30.reduce((n, d) => n + d[k], 0);
  return (
    <>
      <div className="grid cols-3">
        <div className="card stat"><div className="v">{sum("checks").toLocaleString()}</div><div className="l">Bills, last {last30.length} day(s)</div></div>
        <div className="card stat"><div className="v">{fromCents(sum("netSales"))}</div><div className="l">Net sales</div></div>
        <div className="card stat"><div className="v">{fromCents(sum("total"))}</div><div className="l">Total with charges and taxes</div></div>
      </div>
      <div className="card card-body">
        <div className="small muted">Net sales per day</div>
        <div className="bars" aria-hidden="true">{last30.map((d) => <div key={d.id} title={`${d.date}: ${fromCents(d.netSales)}`} style={{ height: `${Math.max(2, (d.netSales / max) * 100)}%` }} />)}</div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th className="num">Bills</th><th className="num">Covers</th><th className="num">Net sales</th><th className="num">Total</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.id}><td>{date(d.date)}</td><td className="num">{d.checks}</td><td className="num">{d.covers}</td><td className="num">{fromCents(d.netSales)}</td><td className="num">{fromCents(d.total)}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function StatusTab({ c }: { c: Client }) {
  const { can } = useSession();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("Your subscription payment is overdue. Please contact Polymath Tech to keep using the system.");
  const [graceDays, setGraceDays] = useState(7);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState({ text: c.notice?.text ?? "", level: c.notice?.level ?? "info", until: c.notice?.until?.slice(0, 10) ?? "" });
  return (
    <>
      <div className="card card-body stack">
        <h2>{c.status === "suspended" ? "Suspended" : "Suspend"}</h2>
        {c.status === "suspended" ? (
          <>
            <p className="small">Since {dateTime(c.suspension?.since)} by {c.suspension?.by}. Grace until {dateTime(c.suspension?.graceUntil)}.{c.suspension?.reason ? ` Reason: ${c.suspension.reason}.` : ""}</p>
            {can("suspend") ? <div><button className="btn primary" disabled={busy} onClick={() => void run("restore", { clientId: c.id }, "Restored: it takes effect at the client's next check-in")}>Restore</button></div> : null}
          </>
        ) : (
          <>
            <p className="small muted">The client's system shows your message for the grace period, then stops the licensed modules, as when a licence expires. Their data is kept, and Restore brings everything back. It takes effect at their next check-in (daily, or when they press Check now).</p>
            {can("suspend") ? (
              <div className="grid cols-2">
                <Field label="Message the client sees"><textarea className="input" value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
                <div className="stack">
                  <Field label="Grace period (days)"><input className="input" type="number" min={0} max={60} value={graceDays} onChange={(e) => setGraceDays(Number(e.target.value))} /></Field>
                  <Field label="Internal reason"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. invoice 2026-114 unpaid" /></Field>
                  <div><button className="btn danger" onClick={() => setConfirm(true)}>Suspend {c.name}…</button></div>
                </div>
              </div>
            ) : <p className="small muted">Only an owner or admin can suspend.</p>}
          </>
        )}
      </div>
      <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("setNotice", { clientId: c.id, ...notice }, notice.text ? "Notice saved" : "Notice cleared"); }}>
        <h2>Notice to the client</h2>
        <p className="small muted">Shown to the client's owner and administrators in their back office from the next check-in. Leave empty to show the automatic renewal reminders instead.</p>
        <Field label="Message"><textarea className="input" value={notice.text} onChange={(e) => setNotice({ ...notice, text: e.target.value })} disabled={!can("clients")} /></Field>
        <div className="row wrap">
          <Field label="Style"><select className="input" value={notice.level} onChange={(e) => setNotice({ ...notice, level: e.target.value as "info" | "warn" })} disabled={!can("clients")}><option value="info">Information</option><option value="warn">Warning</option></select></Field>
          <Field label="Until (optional)"><input className="input" type="date" value={notice.until} onChange={(e) => setNotice({ ...notice, until: e.target.value })} disabled={!can("clients")} /></Field>
          <span className="grow" />
          {can("clients") ? <button className="btn primary" disabled={busy}>Save notice</button> : null}
        </div>
      </form>
      {confirm ? (
        <Modal title={`Suspend ${c.name}?`} onClose={() => setConfirm(false)}>
          <p>From their next check-in, {c.name} sees: “{message}”. {graceDays ? `After ${graceDays} day(s)` : "At once"}, their licensed modules stop until you restore them. Their data is kept.</p>
          <div className="row"><span className="grow" /><button className="btn" onClick={() => setConfirm(false)}>Cancel</button><button className="btn danger" disabled={busy} onClick={() => void run("suspend", { clientId: c.id, message, graceDays, reason }, "Suspended").then(() => setConfirm(false))}>Suspend</button></div>
        </Modal>
      ) : null}
    </>
  );
}

function Activity({ c }: { c: Client }) {
  const entries = useCol<AuditEntry>("audit", [where("clientId", "==", c.id), orderBy("at", "desc"), limit(100)], c.id);
  if (!entries) return <Loading />;
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
          <tbody>
            {entries.map((e) => <tr key={e.id}><td>{dateTime(e.at)}</td><td>{e.email}</td><td><strong>{e.action}</strong> · {e.summary}</td></tr>)}
            {!entries.length ? <tr><td colSpan={3} className="empty">No activity yet.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
