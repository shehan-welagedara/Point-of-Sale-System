import { useState } from "react";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { firebase } from "../../lib/firebase";
import { useApp } from "../../state/app";

const WS_KEY = "pos-suite.workstation";
/** Logins the server creates for connected phones and tablets (apps/functions/src/devices.ts). */
export const isDeviceLogin = (email?: string | null) => Boolean(email?.endsWith("@devices.pos-suite.invalid"));
const TENANT_KEY = "pos-suite.activeTenant";

const format = (raw: string) => {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
};

/**
 * /pair — connects this phone or tablet to the business with the one-time code a manager shows
 * under POS Configuration → Workstations & printers. The phone gets its own login (nobody types a
 * password) and opens the POS on its workstation; staff then sign in with their number and PIN.
 */
export function PairDevice() {
  const { mode, user } = useApp();
  const [code, setCode] = useState(() => format(new URLSearchParams(location.search).get("code") ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (mode === "local") {
    return (
      <div className="auth">
        <div className="card auth-card stack">
          <h2>Connect this phone</h2>
          <p className="small muted">Connecting phones works on the live system. In the demo, open the POS on this device: <a href="/pos?mode=local">Point of Sale</a>.</p>
        </div>
      </div>
    );
  }

  async function pair(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { auth, functions } = firebase();
      const r = (await httpsCallable(functions, "deviceApi")({ action: "pair", code, userAgent: navigator.userAgent })).data as { email: string; password: string; tenantId: string; workstationId: string };
      if (auth.currentUser) await signOut(auth);
      localStorage.setItem(TENANT_KEY, r.tenantId);
      localStorage.setItem(WS_KEY, r.workstationId);
      await signInWithEmailAndPassword(auth, r.email, r.password);
      // A fresh start loads the business and opens the POS on this phone's workstation.
      location.replace("/pos");
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "";
      setError(/network|unavailable|internal/i.test(msg) ? "No connection to the system. Check the internet on this phone and try again." : msg || "Couldn't connect this phone.");
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={pair}>
        <div className="row">
          <div className="brand-logo">P</div>
          <div>
            <h2>Connect this phone</h2>
            <div className="muted small">to the restaurant's POS</div>
          </div>
        </div>
        {user ? (
          <div className="callout warn small">
            This browser is signed in as <strong>{user.name}</strong>. Connecting signs that login out here and makes this device a POS phone. On your own back-office phone, use a different browser for the POS instead.
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="pair-code">Code from the manager's screen</label>
          <input
            id="pair-code"
            className="input mono"
            style={{ fontSize: 26, letterSpacing: 3, textAlign: "center" }}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            placeholder="ABCD-2345"
            value={code}
            onChange={(e) => setCode(format(e.target.value))}
            required
            aria-label="Pairing code"
          />
        </div>
        {error ? <div className="callout bad small" role="alert">{error}</div> : null}
        <button className="btn primary lg" disabled={busy || code.replace("-", "").length !== 8}>{busy ? "Connecting…" : "Connect"}</button>
        <p className="tiny muted">The manager creates the code under POS Configuration → Workstations &amp; printers → Connect a phone. It works once, for 15 minutes.</p>
      </form>
    </div>
  );
}

/** A connected phone whose login was removed (lost phone, leaver) or whose business is gone. */
export function DeviceDisconnected() {
  const { signOut } = useApp();
  return (
    <div className="auth">
      <div className="card auth-card stack" role="alert">
        <h2>This phone is no longer connected</h2>
        <p className="small muted">A manager removed it from the restaurant's POS, so it can't open the POS or see any data. To use it again, ask the manager for a new code (POS Configuration → Workstations &amp; printers → Connect a phone).</p>
        <a className="btn primary lg" href="/pair" onClick={() => void signOut()}>Connect with a new code</a>
      </div>
    </div>
  );
}
