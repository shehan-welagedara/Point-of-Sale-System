import { useState } from "react";
import { useApp } from "../../state/app";

/** New back-office passwords: these logins reach the books over the internet. */
const MIN_NEW_PASSWORD = 10;

export function Login() {
  const { signIn, signUp, resetPassword, toast } = useApp();
  const [mode, setMode] = useState<"in" | "up" | "reset">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "reset") {
        await resetPassword(email.trim());
        setResetSent(true);
      } else if (mode === "in") await signIn(email.trim(), password);
      else await signUp(email.trim(), password, name.trim() || email.trim());
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      toast(
        code.includes("invalid-credential") || code.includes("wrong-password")
          ? "Email or password is incorrect"
          : code.includes("too-many-requests")
            ? "Too many attempts. Wait a few minutes, or reset your password."
            : code.includes("email-already")
              ? "That email already has an account; sign in instead"
              : code.includes("weak-password") || code.includes("password-does-not-meet-requirements")
                ? `Use at least ${MIN_NEW_PASSWORD} characters, with letters and numbers`
                : code.includes("invalid-email")
                  ? "Check the email address"
                  : `Sign-in failed: ${code || (err as Error).message}`,
        true,
      );
    } finally {
      setBusy(false);
    }
  }

  const go = (m: typeof mode) => {
    setMode(m);
    setResetSent(false);
  };

  return (
    <div className="auth">
      <form className="card auth-card" onSubmit={submit}>
        <div className="row">
          <div className="brand-logo">P</div>
          <div>
            <h2>POS Suite</h2>
            <div className="muted small">Restaurant POS · Back office · Inventory · Accounting</div>
          </div>
        </div>
        {mode === "reset" ? (
          <>
            <h3 style={{ margin: 0 }}>Reset your password</h3>
            {resetSent ? (
              <div className="callout small" role="status">
                If <strong>{email.trim()}</strong> has an account, a link to choose a new password is on its way. Check the inbox (and the spam folder), then sign in with the new password.
              </div>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>Enter the email you sign in with. We'll send a link to choose a new password.</p>
            )}
          </>
        ) : (
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button type="button" className={mode === "in" ? "on" : ""} onClick={() => go("in")}>
              Sign in
            </button>
            <button type="button" className={mode === "up" ? "on" : ""} onClick={() => go("up")}>
              Create account
            </button>
          </div>
        )}
        {mode === "up" ? (
          <div className="field">
            <label htmlFor="name">Your name</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        {mode !== "reset" ? (
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              required
              minLength={mode === "up" ? MIN_NEW_PASSWORD : 6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
            {mode === "up" ? <span className="tiny muted">At least {MIN_NEW_PASSWORD} characters, with letters and numbers. Don't reuse a password from another site.</span> : null}
          </div>
        ) : null}
        {!(mode === "reset" && resetSent) ? (
          <button className="btn primary lg" disabled={busy}>
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}
          </button>
        ) : null}
        {mode === "in" ? (
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => go("reset")}>
            Forgot password?
          </button>
        ) : mode === "reset" ? (
          <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => go("in")}>
            ← Back to sign in
          </button>
        ) : null}
        {mode === "in" ? (
          <div className="callout small">
            <strong>Restaurant phone or tablet?</strong> Don't sign in here: <a href="/pair">connect it with the code</a> from the manager's screen. Staff then sign in on the POS with their employee number and PIN.
          </div>
        ) : null}
        <p className="tiny muted">This login is for owners, managers, accountants and other back-office staff.</p>
      </form>
    </div>
  );
}
