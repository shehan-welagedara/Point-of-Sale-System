import { useState } from "react";
import { useApp } from "../../state/app";

export function Login() {
  const { signIn, signUp, toast } = useApp();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else await signUp(email.trim(), password, name.trim() || email.trim());
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      toast(
        code.includes("invalid-credential") || code.includes("wrong-password") ? "Email or password is incorrect" : code.includes("email-already") ? "That email already has an account; sign in instead" : code.includes("weak-password") ? "Use at least 6 characters for the password" : `Sign-in failed: ${code || (err as Error).message}`,
        true,
      );
    } finally {
      setBusy(false);
    }
  }

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
        <div className="seg" style={{ alignSelf: "flex-start" }}>
          <button type="button" className={mode === "in" ? "on" : ""} onClick={() => setMode("in")}>
            Sign in
          </button>
          <button type="button" className={mode === "up" ? "on" : ""} onClick={() => setMode("up")}>
            Create account
          </button>
        </div>
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
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "in" ? "current-password" : "new-password"} />
        </div>
        <button className="btn primary lg" disabled={busy}>
          {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
        </button>
        <p className="tiny muted">POS staff sign in on the terminal with their employee number and PIN. This login is for owners, managers and POS terminal devices.</p>
      </form>
    </div>
  );
}
