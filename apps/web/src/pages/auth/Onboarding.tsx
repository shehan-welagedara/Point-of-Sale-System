import { useState } from "react";
import { useApp } from "../../state/app";

/** First run: create a business (tenant), optionally filled with the Sri Lankan sample restaurant. */
export function Onboarding() {
  const { createTenant, mode, toast, acceptInvite, user, signOut } = useApp();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, f: () => Promise<unknown>) {
    setBusy(label);
    try {
      await f();
    } catch (e) {
      toast(`Could not finish: ${(e as Error).message}`, true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(560px, 100%)" }}>
        <h1>Set up a business</h1>
        <p className="muted">
          {mode === "local"
            ? "Local demo mode: everything is stored in this browser only. Add a Firebase config to use the cloud."
            : `Signed in as ${user?.email}. Each business (restaurant or group) is a separate tenant with its own data.`}
        </p>
        <div className="card pad stack" style={{ background: "var(--surface-2)" }}>
          <h3>Demo restaurant</h3>
          <p className="small muted">
            Loads “Spice Lagoon”, a sample Colombo restaurant: 37 menu items with recipes and costs, 57 stock items plus 6 prep sub-recipes, vendors, staff (PINs 1111–5555, owner 9999), customers, a week of sales, stock, and journals. VAT-registered, SSCL not liable.
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
          <div className="row wrap">
            <button className="btn" disabled={!name.trim() || Boolean(busy)} onClick={() => run("empty", () => createTenant(name.trim(), false))}>
              {busy === "empty" ? "Creating…" : "Create empty"}
            </button>
            <button className="btn" disabled={!name.trim() || Boolean(busy)} onClick={() => run("sample", () => createTenant(name.trim(), true))}>
              {busy === "sample" ? "Creating…" : "Create with sample data"}
            </button>
          </div>
          <p className="tiny muted">Empty businesses start with Sri Lankan tax defaults. Feed the menu, recipes and stock from the Excel data feeder.</p>
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
