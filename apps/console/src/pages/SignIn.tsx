import { GoogleAuthProvider, createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut } from "firebase/auth";
import { useState } from "react";
import { errorText, firebase } from "../firebase";
import { Field } from "../ui";

/** Staff sign in with Google (recommended) or with a verified email and password. */
export function SignIn({ denied }: { denied: string | null }) {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const auth = firebase().auth;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(errorText(e).replace(/auth\//, ""));
    } finally {
      setBusy(false);
    }
  };

  const unverified = auth.currentUser && !auth.currentUser.emailVerified && auth.currentUser.providerData.some((p) => p.providerId === "password");

  return (
    <div className="auth">
      <div className="card">
        <div className="card-body stack">
          <div className="row">
            <div className="logo" aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: "#0f766e", color: "#fff", display: "grid", placeItems: "center", fontWeight: 800 }}>P</div>
            <div>
              <h2>Polymath Console</h2>
              <div className="small muted">Polymath Tech · clients, licences and updates</div>
            </div>
          </div>
          {denied ? (
            <div className="callout bad" role="alert">
              {unverified ? "Verify your email address first: open the link we sent, then sign in again." : denied}
              <div className="row" style={{ marginTop: 8 }}>
                {unverified ? <button className="btn sm" onClick={() => void run(() => sendEmailVerification(auth.currentUser!))}>Send the link again</button> : null}
                <button className="btn sm" onClick={() => void signOut(auth)}>Use another account</button>
              </div>
            </div>
          ) : null}
          <button className="btn primary" disabled={busy} onClick={() => void run(() => signInWithPopup(auth, new GoogleAuthProvider()))}>
            Sign in with Google
          </button>
          <div className="row muted small"><span className="grow" style={{ borderTop: "1px solid var(--line)" }} />or with email<span className="grow" style={{ borderTop: "1px solid var(--line)" }} /></div>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (mode === "in") await signInWithEmailAndPassword(auth, email.trim(), password);
                else {
                  const c = await createUserWithEmailAndPassword(auth, email.trim(), password);
                  await sendEmailVerification(c.user);
                  setMsg("Account created. Open the link we emailed you, then sign in.");
                }
              });
            }}
          >
            <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Password"><input className="input" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <button className="btn" disabled={busy}>{mode === "in" ? "Sign in" : "Create account"}</button>
          </form>
          <button className="btn ghost sm" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "Invited? Create an account with your email" : "Have an account? Sign in"}
          </button>
          {msg ? <div className="callout" role="status">{msg}</div> : null}
          <p className="tiny muted" style={{ margin: 0 }}>For Polymath Tech staff only. Every action is recorded.</p>
        </div>
      </div>
    </div>
  );
}
