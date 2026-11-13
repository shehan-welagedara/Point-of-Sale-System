import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MobileStyle, RevenueCenter, Staff, Workstation } from "@pos/core";
import { timeColombo } from "../../../lib/format";
import { PosMaintenanceNotice } from "../../../components/UpdateNotices";
import { useApp } from "../../../state/app";
import { Icon } from "./icons";
import { initials, mobileVars } from "./ui";
import "./mobile.css";

/** Hero picture (Branding → sign-in picture), logo and name above a sign-in card. */
export function MobileAuthFrame({ style, children }: { style: MobileStyle; children: ReactNode }) {
  const { settings } = useApp();
  const b = settings.branding;
  const hero = b.heroImageDataUrl;
  return (
    <div className={`mauth ${style}`} style={mobileVars(settings.pos.mobile)} data-ui={style}>
      <div className={`mauth-hero${hero ? "" : " plain"}`} style={hero ? { backgroundImage: `url(${hero})` } : undefined}>
        <div className="mauth-logo">{b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : b.displayName.slice(0, 1)}</div>
        <h1>{b.displayName}</h1>
        <p>{b.receiptHeaderLines[0] ?? "Fast. Simple. Secure."}</p>
      </div>
      <div className="mauth-card">
        <PosMaintenanceNotice />
        {children}
      </div>
      <p className="mauth-powered">{b.poweredBy ? `Powered by ${b.poweredBy}` : ""}</p>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <>{timeColombo(now)}</>;
}

export interface SignInView {
  mode: "idPin" | "card" | "tapName";
  here: Staff[];
  who: Staff | null;
  err: string;
  clockFor: { s: Staff } | null;
  identify: (text: string) => Promise<Staff | null>;
  pick: (s: Staff | null) => void;
  checkPin: (pin: string, person?: Staff) => Promise<void>;
  clockIn: () => Promise<void>;
  cancelClock: () => void;
}

/** Employee sign-in in the app style: employee number (or card) and PIN on one card. */
export function MobileSignIn({ style, ws, rvcs, view, onChangeDevice }: { style: MobileStyle; ws: Workstation; rvcs: RevenueCenter[]; view: SignInView; onChangeDevice: () => void }) {
  const [idText, setIdText] = useState("");
  const [pin, setPin] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (view.who) pinRef.current?.focus();
  }, [view.who]);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const person = view.who ?? (await view.identify(idText));
      if (person && pin) await view.checkPin(pin, person);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const where = `${ws.code} · ${rvcs.find((r) => r.id === ws.rvcId)?.name ?? ""}`;
  if (view.clockFor) {
    return (
      <MobileAuthFrame style={style}>
        <h2>Hello {view.clockFor.s.name.split(" ")[0]}</h2>
        <p className="sub">Clock in to start your shift.</p>
        <button className="m-btn cta block" onClick={() => void view.clockIn()}><Icon name="clock" size={18} /> Clock in now</button>
        <button className="m-link" onClick={view.cancelClock}>Cancel</button>
      </MobileAuthFrame>
    );
  }
  return (
    <MobileAuthFrame style={style}>
      <div className="row between" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h2>{view.who ? `Hi ${view.who.name.split(" ")[0]}` : "Welcome back"}</h2>
        <span className="m-muted small"><Clock /></span>
      </div>
      <p className="sub">{view.who ? "Enter your PIN to continue" : `Sign in to start · ${where}`}</p>
      <form className="stack" style={{ display: "flex", flexDirection: "column", gap: 14 }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {view.mode === "tapName" && !view.who ? (
          <div className="mauth-people">
            {view.here.map((s) => (
              <button type="button" key={s.id} onClick={() => view.pick(s)}>
                <span className="m-avatar">{initials(s.name)}</span>
                <span>{s.name.split(" ")[0]}{s.lockedAt ? " 🔒" : ""}</span>
              </button>
            ))}
          </div>
        ) : null}
        {!view.who && view.mode !== "tapName" ? (
          <label className="m-field">
            <span>{view.mode === "card" ? "Swipe your card or type your number" : "Employee number"}</span>
            <input className="m-input" inputMode="numeric" autoComplete="username" value={idText} onChange={(e) => setIdText(e.target.value.trim())} placeholder="e.g. 1002" aria-label="Employee number or card" autoFocus />
          </label>
        ) : null}
        {view.who || view.mode !== "tapName" ? (
          <label className="m-field">
            <span>PIN</span>
            <span className="m-pin">
              <input ref={pinRef} className="m-input num" type={show ? "text" : "password"} inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="••••" aria-label="PIN" />
              <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide PIN" : "Show PIN"}><Icon name={show ? "eyeOff" : "eye"} size={20} /></button>
            </span>
          </label>
        ) : null}
        {view.err ? <div className="mauth-error" role="alert">{view.err}</div> : null}
        {view.who || view.mode !== "tapName" ? (
          <button className="m-btn cta block" type="submit" disabled={busy || !pin || (!view.who && !idText)}>{busy ? "Signing in…" : "Sign In"}</button>
        ) : null}
      </form>
      <div className="mauth-foot">
        {view.who ? <button onClick={() => { view.pick(null); setPin(""); }}>Not {view.who.name.split(" ")[0]}?</button> : <Link to="/emc/home">Back office</Link>}
        <button onClick={onChangeDevice}>Change device</button>
      </div>
    </MobileAuthFrame>
  );
}

export function MobileRvcPicker({ style, rvcs, user, openCount, defaultRvc, onPick, onCancel }: { style: MobileStyle; rvcs: RevenueCenter[]; user: Staff; openCount: (rvcId: string) => number; defaultRvc: string; onPick: (id: string) => void; onCancel: () => void }) {
  return (
    <MobileAuthFrame style={style}>
      <h2>Where are you working?</h2>
      <p className="sub">{user.name}, choose a revenue centre.</p>
      <div className="mauth-list">
        {rvcs.map((r) => (
          <button key={r.id} onClick={() => onPick(r.id)}>
            <span className="m-tender-ico"><Icon name={r.serviceMode === "table" ? "tables" : "bolt"} /></span>
            <span className="grow" style={{ flex: 1 }}>
              <strong>{r.name}</strong>
              <small>{r.serviceMode === "table" ? "Table service" : "Quick service"} · {openCount(r.id)} open{r.id === defaultRvc ? " · default" : ""}</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
      </div>
      <button className="m-link" onClick={onCancel}>Sign out</button>
    </MobileAuthFrame>
  );
}

export function MobileDeviceSetup({ style, workstations, rvcs, onPick }: { style: MobileStyle; workstations: Workstation[]; rvcs: RevenueCenter[]; onPick: (id: string) => void }) {
  return (
    <MobileAuthFrame style={style}>
      <h2>Set up this device</h2>
      <p className="sub">Choose which workstation this phone or tablet is. Use each workstation on one device only: it numbers its own bills.</p>
      <div className="mauth-list">
        {workstations.map((w) => (
          <button key={w.id} className="device-btn" onClick={() => onPick(w.id)}>
            <span className="m-tender-ico"><Icon name={w.deviceProfile === "mobile" ? "phone" : "tables"} /></span>
            <span style={{ flex: 1 }}>
              <strong>{w.name}</strong>
              <small>{rvcs.find((r) => r.id === w.rvcId)?.name} · {w.code}</small>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
        {workstations.length === 0 ? <p className="m-muted">No workstations yet. Add one in the back office under POS Configuration → Workstations &amp; printers.</p> : null}
      </div>
      <div className="mauth-foot"><Link to="/emc/home">← Back office</Link></div>
    </MobileAuthFrame>
  );
}
