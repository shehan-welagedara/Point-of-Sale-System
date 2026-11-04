import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MODULES, type ModuleKey, builtInEntitlements, setModule } from "@pos/core";
import { useApp } from "../../state/app";

const STARTER: ModuleKey[] = ["pos", "tables", "recipes", "revenue", "crm", "lankaqr"];

/** First run: create a business (tenant), optionally filled with the Sri Lankan sample restaurant. */
export function Onboarding() {
  const { createTenant, mode, toast, acceptInvite, user, signOut, tenant } = useApp();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Partial<Record<ModuleKey, boolean>>>(Object.fromEntries(STARTER.map((k) => [k, true])));
  const trial = builtInEntitlements("trial");
  const picked = MODULES.filter((m) => chosen[m.key]).map((m) => m.key);

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(label);
    try {
      await f();
      if (tenant) navigate("/emc/home");
    } catch (e) {
      toast(`Could not finish: ${(e as Error).message}`, true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(560px, 100%)" }}>
        {tenant ? <Link to="/emc/home" className="small">← Back to {tenant.name}</Link> : null}
        <h1>Set up a business</h1>
        <p className="muted">
          {mode === "local"
            ? "Local demo mode: everything is stored in this browser only. Add a Firebase config to use the cloud."
            : `Signed in as ${user?.email}. Each business (restaurant or group) is a separate tenant with its own data.`}
        </p>
        <div className="card pad stack" style={{ background: "var(--surface-2)" }}>
          <h3>Demo restaurant</h3>
          <p className="small muted">
            Loads “Spice Lagoon”, a sample Colombo restaurant: 37 menu items with recipes and costs, 57 stock items plus 6 prep sub-recipes, vendors, employees (sign in with number 1001 and PIN 1111, or 1002/2222, 1006/6666…), customers, a week of sales, stock and full books. VAT-registered, SSCL not liable.
          </p>
          <button className="btn primary" disabled={Boolean(busy)} onClick={() => run("demo", () => createTenant("Spice Lagoon (demo)", true))}>
            {busy === "demo" ? "Building demo data…" : "Load the demo restaurant"}
          </button>
        </div>
        <div className="card pad stack">
          <h3>New client business</h3>
          <div className="field">
            <label htmlFor="bname">Business name</label>
            <input id="bname" className="input" value={name} placeholder="e.g. Lagoon Café" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label>Modules to provide to this client</label>
            <div className="chips">
              {MODULES.filter((m) => m.status === "available" && trial.modules.includes(m.key)).map((m) => (
                <button key={m.key} type="button" className={`chip${chosen[m.key] ? " on" : ""}`} title={m.description} onClick={() => setChosen(setModule(chosen, m.key, !chosen[m.key]))}>
                  {m.name}
                </button>
              ))}
            </div>
            <div className="help">Modules a chosen one needs are added automatically. The business starts a 30-day trial; activate the client's licence key under Administration → Licence &amp; modules, which limits modules and capacity to what they bought.</div>
          </div>
          <div className="row wrap">
            <button className="btn primary" disabled={!name.trim() || Boolean(busy) || !picked.length} onClick={() => run("empty", () => createTenant(name.trim(), false, picked))}>
              {busy === "empty" ? "Creating…" : "Create business"}
            </button>
          </div>
          <p className="tiny muted">New businesses start with Sri Lankan tax defaults. Feed the menu, recipes and stock from the Excel data feeder.</p>
        </div>
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
