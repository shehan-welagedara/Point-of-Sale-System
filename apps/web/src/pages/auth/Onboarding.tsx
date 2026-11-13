import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MODULES, type ModuleKey, type Tenant, builtInEntitlements, businessKey, setModule } from "@pos/core";
import type { SampleKind } from "@pos/sample-data";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { firebase } from "../../lib/firebase";
import { type BusinessRequestDoc, newBusinessId, useApp } from "../../state/app";

const STARTER: ModuleKey[] = ["pos", "tables", "recipes", "revenue", "crm", "lankaqr"];
const DEMOS: { kind: SampleKind; name: string; title: string; text: string }[] = [
  { kind: "noura-kitchen", name: "Noura Kitchen (demo)", title: "Noura Kitchen demo", text: "Restaurant and takeaway, one counter phone with a Bluetooth printer, not VAT registered. POS sign-in: 1001 / PIN 1111." },
  { kind: "spice-lagoon", name: "Spice Lagoon (demo)", title: "Spice Lagoon demo", text: "A larger VAT-registered restaurant with network printers, recipes, stock and full books. POS sign-in: 1001 / PIN 1111." },
];

/** The requests this person sent to Polymath Tech, live. */
function useMyRequests(): BusinessRequestDoc[] {
  const { mode, user } = useApp();
  const [list, setList] = useState<BusinessRequestDoc[]>([]);
  useEffect(() => {
    if (mode !== "firebase" || !user) return;
    return onSnapshot(
      query(collection(firebase().db, "businessRequests"), where("uid", "==", user.uid)),
      (snap) => setList(snap.docs.map((d) => d.data() as BusinessRequestDoc).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))),
      () => setList([]),
    );
  }, [mode, user]);
  return list;
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Colombo", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** A request waiting for Polymath Tech, approved (open it now) or declined. */
function RequestCard({ r, onOpen }: { r: BusinessRequestDoc; onOpen: (r: BusinessRequestDoc) => void }) {
  const { businessRequest, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  // While waiting, ask Polymath Tech again every 20 seconds (the server sends it at most every 15).
  useEffect(() => {
    if (r.status !== "pending") return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void businessRequest("check", r.id).catch(() => undefined);
    }, 20_000);
    return () => clearInterval(t);
  }, [r.status, r.id, businessRequest]);
  if (hidden || r.status === "cancelled") return null;
  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`card pad stack request-card ${r.status}`} data-testid={`request-${r.status}`}>
      <div className="row wrap" style={{ gap: 8 }}>
        <h3 className="grow" style={{ margin: 0 }}>{r.name}</h3>
        <span className={`badge ${r.status === "approved" ? "good" : r.status === "rejected" ? "bad" : "warn"}`}>{r.status === "approved" ? "Approved" : r.status === "rejected" ? "Declined" : "Waiting for approval"}</span>
      </div>
      {r.status === "pending" ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>Sent to Polymath Tech {when(r.requestedAt)}. You can leave this page: the business appears here when it is approved.</p>
          <div className="row wrap">
            <button className="btn sm" disabled={busy} onClick={() => act(async () => { const res = await businessRequest("check", r.id); if (res.checkin && !res.checkin.ok) toast(`Couldn't reach Polymath Tech: ${res.checkin.error ?? "no answer"}. It will try again.`, true); })}>{busy ? "Checking…" : "Check now"}</button>
            <button className="btn ghost sm" disabled={busy} onClick={() => act(() => businessRequest("cancel", r.id))}>Cancel request</button>
          </div>
        </>
      ) : null}
      {r.message ? <p className="small" style={{ margin: 0 }}>Polymath Tech: “{r.message}”</p> : null}
      {r.status === "approved" ? <div><button className="btn primary" disabled={busy} onClick={() => act(async () => onOpen(r))}>{busy ? "Opening…" : `Open ${r.name}`}</button></div> : null}
      {r.status === "rejected" ? <div><button className="btn ghost sm" onClick={() => setHidden(true)}>Dismiss</button></div> : null}
    </div>
  );
}

/** Businesses the owner archived: kept with all their data, restored in one tap. */
function Archived({ list }: { list: Tenant[] }) {
  const { setTenantArchived, toast } = useApp();
  const fail = (e: unknown) => toast(/permission|insufficient/i.test((e as Error).message) ? "Only the business's owner can restore it." : (e as Error).message, true);
  const [busy, setBusy] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <div className="card pad stack">
      <h3 style={{ margin: 0 }}>Archived businesses</h3>
      {list.map((t) => (
        <div key={t.id} className="row wrap">
          <span className="grow">{t.name}</span>
          <button className="btn sm" disabled={busy === t.id} onClick={async () => { setBusy(t.id); try { await setTenantArchived(t.id, false); toast(`${t.name} restored`); } catch (e) { fail(e); } finally { setBusy(null); } }}>Restore</button>
        </div>
      ))}
    </div>
  );
}

/** First run, or another business: create it (approved by Polymath Tech first on linked systems). */
export function Onboarding() {
  const { createTenant, requestBusiness, mode, toast, acceptInvite, user, signOut, tenant, tenants, switchTenant } = useApp();
  const navigate = useNavigate();
  const requests = useMyRequests();
  const [name, setName] = useState("");
  const [different, setDifferent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Partial<Record<ModuleKey, boolean>>>(Object.fromEntries(STARTER.map((k) => [k, true])));
  const trial = builtInEntitlements("trial");
  const picked = MODULES.filter((m) => chosen[m.key]).map((m) => m.key);
  const key = businessKey(name);
  const same = name.trim() ? [...tenants.map((t) => ({ name: t.name, archived: t.status === "archived" })), ...requests.filter((r) => r.status === "pending" || r.status === "approved").map((r) => ({ name: r.name, archived: false }))].filter((t) => businessKey(t.name) === key) : [];
  const live = tenants.filter((t) => t.status !== "archived");
  const archived = tenants.filter((t) => t.status === "archived");
  const open = requests.filter((r) => r.status !== "cancelled" && !tenants.some((t) => t.id === r.id));

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(label);
    try {
      await f();
    } catch (e) {
      const msg = (e as Error).message;
      toast(/permission|insufficient/i.test(msg) ? "Only this system's owner can add businesses here. Ask them to invite you, then use “I was invited to a business”." : `Could not finish: ${msg}`, true);
    } finally {
      setBusy(null);
    }
  }

  /** Request first; open at once where no approval is needed. */
  async function start(label: string, bname: string, sample: SampleKind | false, modules: ModuleKey[]) {
    await run(label, async () => {
      const id = newBusinessId(bname);
      const res = await requestBusiness({ id, name: bname, kind: sample ? "demo" : "business", ...(sample ? { sample } : {}), modules });
      if (res.required && res.request?.status !== "approved") {
        toast("Sent to Polymath Tech for approval");
        setName("");
        return;
      }
      await createTenant(bname, sample, sample ? undefined : modules, res.required ? id : undefined);
      if (tenant || mode === "local") navigate("/emc/home");
    });
  }

  const openApproved = (r: BusinessRequestDoc) =>
    run("open", async () => {
      await createTenant(r.name, r.kind === "demo" ? (r.sample ?? (r.name.startsWith("Noura") ? "noura-kitchen" : "spice-lagoon")) : false, r.kind === "demo" ? undefined : (r.modules as ModuleKey[]), r.id);
      navigate("/emc/home");
    });

  return (
    <div className="auth">
      <div className="card auth-card stack" style={{ width: "min(560px, 100%)" }}>
        {tenant && tenant.status !== "archived" ? <Link to="/emc/home" className="small">← Back to {tenant.name}</Link> : null}
        <h1>Set up a business</h1>
        <p className="muted" style={{ margin: 0 }}>{mode === "local" ? "Local demo: everything stays in this browser." : `Signed in as ${user?.email}.`}</p>
        {mode === "local" && tenant ? <div className="callout warn small">This browser keeps one business: a new one replaces <strong>{tenant.name}</strong>.</div> : null}
        {tenant?.status === "archived" ? <div className="callout small">{tenant.name} is archived: its data is kept. Restore it below, or open another business.</div> : null}
        {tenant?.status === "archived" && live.length ? (
          <div className="card pad stack">
            <h3 style={{ margin: 0 }}>Your businesses</h3>
            {live.map((t) => (
              <div key={t.id} className="row wrap"><span className="grow">{t.name}</span><button className="btn sm primary" onClick={() => { switchTenant(t.id); navigate("/emc/home"); }}>Open</button></div>
            ))}
          </div>
        ) : null}

        {open.map((r) => <RequestCard key={r.id} r={r} onOpen={openApproved} />)}

        <div className="card pad stack">
          <h3 style={{ margin: 0 }}>New business</h3>
          <div className="field">
            <label htmlFor="bname">Business name</label>
            <input id="bname" className="input" value={name} placeholder="e.g. Lagoon Café" onChange={(e) => { setName(e.target.value); setDifferent(false); }} />
          </div>
          {same.length ? (
            <div className="callout warn small stack" data-testid="duplicate-warning" style={{ gap: 6 }}>
              <span>You already have <strong>{same[0]!.name}</strong>{same[0]!.archived ? " (archived)" : ""}. Open it instead of creating it again.</span>
              <div className="row wrap">
                {live.some((t) => businessKey(t.name) === key) ? <Link className="btn sm" to="/emc/home">Open {live.find((t) => businessKey(t.name) === key)!.name}</Link> : null}
                <label className="check small"><input type="checkbox" checked={different} onChange={(e) => setDifferent(e.target.checked)} /> It's a different business</label>
              </div>
            </div>
          ) : null}
          <div className="field">
            <label>Modules</label>
            <div className="chips">
              {MODULES.filter((m) => m.status === "available" && trial.modules.includes(m.key)).map((m) => (
                <button key={m.key} type="button" className={`chip${chosen[m.key] ? " on" : ""}`} title={m.description} onClick={() => setChosen(setModule(chosen, m.key, !chosen[m.key]))}>
                  {m.name}
                </button>
              ))}
            </div>
            <div className="help">Starts a 30-day trial. Your licence key sets the final modules.</div>
          </div>
          <div className="row wrap">
            <button className="btn primary" disabled={!name.trim() || Boolean(busy) || !picked.length || (same.length > 0 && !different)} onClick={() => start("empty", name.trim(), false, picked)}>
              {busy === "empty" ? "Creating…" : "Create business"}
            </button>
          </div>
        </div>

        <details className="card pad demo-box">
          <summary><strong>Try a demo business</strong> <span className="small muted">— sample menu, stock, sales and books</span></summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {DEMOS.map((d) => (
              <div key={d.kind} className="row wrap" style={{ alignItems: "flex-start" }}>
                <div className="grow" style={{ minWidth: 200 }}><strong>{d.title}</strong><div className="small muted">{d.text}</div></div>
                <button className="btn sm" disabled={Boolean(busy)} onClick={() => start(d.kind, d.name, d.kind, [])}>{busy === d.kind ? "Building…" : `Load ${d.title.replace(/ demo$/, "")}`}</button>
              </div>
            ))}
          </div>
        </details>

        <Archived list={archived} />

        {mode === "firebase" ? (
          <div className="row between">
            <button className="btn ghost sm" onClick={() => run("invite", async () => (await acceptInvite()) || toast("No invitation found for this email", true))}>
              I was invited to a business
            </button>
            <button className="btn ghost sm" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
