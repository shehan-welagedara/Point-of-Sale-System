import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  type RevenueCenter,
  type Role,
  type Staff,
  type TimeCard,
  type Workstation,
  COLLECTIONS as C,
  DEFAULT_SIGN_IN,
  PosJournal,
  afterFailedSignIn,
  businessDateNow,
  newId,
  roleFor,
  signInDecision,
  verifyPin,
} from "@pos/core";
import { Empty, Loading } from "../../components/ui";
import { timeColombo, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { Keypad, PinEntry } from "./dialogs";
import { PosMain } from "./Pos";
import { resolveTheme, themeStyle } from "./theme";
import { MobileDeviceSetup, MobileRvcPicker, MobileSignIn } from "./mobile/MobileSignIn";
import { type UiStyle, useUiStyle } from "./mobile/ui";

const WS_KEY = "pos-suite.workstation";

export interface PosSession {
  user: Staff;
  rvcId: string;
}

/** Device → employee sign-in → revenue centre → POS, with automatic sign-out when idle. */
export function PosApp() {
  const { on, store, settings } = useApp();
  const workstations = useCollection<Workstation>(C.workstations);
  const staff = useCollection<Staff>(C.staff);
  const roles = useCollection<Role>(C.roles);
  const rvcs = useCollection<RevenueCenter>(C.revenueCenters);
  const [wsId, setWsId] = useState<string | null>(() => localStorage.getItem(WS_KEY));
  const [session, setSession] = useState<PosSession | null>(null);
  const [pendingRvc, setPendingRvc] = useState<{ user: Staff; rvcIds: string[] } | null>(null);
  const ws = workstations?.find((w) => w.id === wsId && w.active);
  const ui = useUiStyle(settings.pos.mobile, ws);
  const openChecks = useCollection<{ rvcId: string; propertyId: string }>(ws ? C.checks : null, { where: [["status", "==", "open"]] }) ?? [];
  const theme = resolveTheme(settings.pos.theme);
  const style = themeStyle(theme, settings.branding.primaryColor);
  const journal = useMemo(
    () => (ws && store ? new PosJournal(store, { propertyId: ws.propertyId, workstationId: ws.id, rvcId: ws.rvcId, businessDate: () => businessDateNow(settings.pos) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws?.id, store],
  );
  const idleSeconds = ws?.autoSignOutSeconds ?? settings.pos.autoSignOutSeconds ?? DEFAULT_SIGN_IN.autoSignOutSeconds;
  useIdle(session && idleSeconds > 0 ? idleSeconds : 0, () => {
    if (session) void journal?.log({ type: "autoSignOut", employeeId: session.user.id });
    setSession(null);
  });

  if (!on("pos")) return <Empty title="The Point of Sale module is not enabled for this business" />;
  if (!store || !workstations || !staff || !roles || !rvcs) return <Loading />;
  if (!ws || !journal)
    return ui !== "terminal" ? (
      <MobileDeviceSetup style={ui} workstations={workstations.filter((w) => w.active)} rvcs={rvcs} onPick={(id) => { localStorage.setItem(WS_KEY, id); setWsId(id); }} />
    ) : (
      <div className="pos-theme" style={style}>
        <DeviceSetup workstations={workstations.filter((w) => w.active)} rvcs={rvcs} onPick={(id) => { localStorage.setItem(WS_KEY, id); setWsId(id); }} />
      </div>
    );

  const begin = (user: Staff, rvcId: string) => {
    journal.setRvc(rvcId);
    setSession({ user, rvcId });
    setPendingRvc(null);
  };

  if (session)
    return (
      <PosMain
        ws={ws}
        user={session.user}
        staff={staff}
        rvcId={session.rvcId}
        journal={journal}
        onSignOut={() => {
          void journal.log({ type: "signOut", employeeId: session.user.id });
          setSession(null);
        }}
        onChangeRvc={(rvcId) => {
          void journal.log({ type: "rvcChange", employeeId: session.user.id, detail: `${session.rvcId} → ${rvcId}` });
          begin(session.user, rvcId);
        }}
      />
    );

  const signIn = (
    <SignIn
      ws={ws}
      ui={ui}
      staff={staff}
      roles={roles}
      rvcs={rvcs}
      journal={journal}
      onSignedIn={(user, rvcIds) => (rvcIds.length === 1 ? begin(user, rvcIds[0]!) : setPendingRvc({ user, rvcIds }))}
      onChangeDevice={() => { localStorage.removeItem(WS_KEY); setWsId(null); }}
    />
  );
  if (ui !== "terminal")
    return pendingRvc ? (
      <MobileRvcPicker style={ui} rvcs={rvcs.filter((r) => pendingRvc.rvcIds.includes(r.id))} user={pendingRvc.user} defaultRvc={ws.rvcId} openCount={(id) => openChecks.filter((c) => c.rvcId === id && c.propertyId === ws.propertyId).length} onPick={(id) => begin(pendingRvc.user, id)} onCancel={() => setPendingRvc(null)} />
    ) : (
      signIn
    );

  return (
    <div className="pos-theme" style={style}>
      {pendingRvc ? (
        <RvcPicker ws={ws} rvcs={rvcs.filter((r) => pendingRvc.rvcIds.includes(r.id))} user={pendingRvc.user} onPick={(id) => begin(pendingRvc.user, id)} onCancel={() => setPendingRvc(null)} />
      ) : (
        signIn
      )}
    </div>
  );
}

/** Signs out after `seconds` without a touch, click or key (0 = off). */
function useIdle(seconds: number, onIdle: () => void) {
  const cb = useRef(onIdle);
  cb.current = onIdle;
  useEffect(() => {
    if (!seconds) return;
    let t = setTimeout(() => cb.current(), seconds * 1000);
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => cb.current(), seconds * 1000);
    };
    const evs = ["pointerdown", "keydown", "wheel"] as const;
    evs.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [seconds]);
}

function Brand({ ws, rvcs }: { ws: Workstation; rvcs: RevenueCenter[] }) {
  const { settings } = useApp();
  const b = settings.branding;
  return (
    <div className="row">
      <div className="brand-logo" style={{ width: 48, height: 48 }}>{b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : b.displayName.slice(0, 1)}</div>
      <div>
        <h2>{b.displayName}</h2>
        <div className="small muted">{ws.name} · {ws.code} · {rvcs.find((r) => r.id === ws.rvcId)?.name}</div>
      </div>
      <span className="grow" />
      <Clock />
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toISOString()), 15_000);
    return () => clearInterval(t);
  }, []);
  return <div style={{ fontSize: 28, fontWeight: 700 }} className="num">{timeColombo(now)}</div>;
}

function DeviceSetup({ workstations, rvcs, onPick }: { workstations: Workstation[]; rvcs: RevenueCenter[]; onPick: (id: string) => void }) {
  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(640px, 100%)" }}>
        <h1>Set up this device</h1>
        <p className="muted">Choose which workstation this screen is. Each workstation numbers its own bills (IRD invoice series) and keeps its own transaction journal, so use each one on only one device.</p>
        <div className="stack tight">
          {workstations.map((w) => (
            <button key={w.id} className="btn lg block device-btn" style={{ justifyContent: "space-between" }} onClick={() => onPick(w.id)}>
              <span>{w.name}</span>
              <span className={`badge ${w.deviceProfile === "mobile" ? "info" : "brand"}`}>
                {rvcs.find((r) => r.id === w.rvcId)?.name} · {w.code}
              </span>
            </button>
          ))}
          {workstations.length === 0 ? <p className="muted">No workstations yet. Add one under POS Configuration → Workstations &amp; printers.</p> : null}
        </div>
        <Link to="/emc/home" className="small">← Back office</Link>
      </div>
    </div>
  );
}

/**
 * Employee sign-in (Simphony style): employee number + PIN, or a card swipe, or tap a name (for
 * small venues). Wrong PINs count towards a lockout; locked or ended employees can't sign in.
 */
function SignIn({ ws, ui, staff, roles, rvcs, journal, onSignedIn, onChangeDevice }: { ws: Workstation; ui: UiStyle; staff: Staff[]; roles: Role[]; rvcs: RevenueCenter[]; journal: PosJournal; onSignedIn: (s: Staff, rvcIds: string[]) => void; onChangeDevice: () => void }) {
  const { settings, store, toast } = useApp();
  const mode = settings.pos.signInMode ?? DEFAULT_SIGN_IN.mode;
  const maxFailed = settings.pos.maxFailedSignIns ?? DEFAULT_SIGN_IN.maxFailedSignIns;
  const [who, setWho] = useState<Staff | null>(null);
  const [idText, setIdText] = useState("");
  const [err, setErr] = useState("");
  const [clockFor, setClockFor] = useState<{ s: Staff; rvcIds: string[] } | null>(null);
  const cardRef = useRef<HTMLInputElement>(null);
  const propertyRvcIds = rvcs.filter((r) => r.propertyId === ws.propertyId && r.active).map((r) => r.id);
  const here = staff.filter((s) => s.status === "active" && (!s.propertyIds?.length || s.propertyIds.includes(ws.propertyId)));
  useEffect(() => cardRef.current?.focus(), [who]);

  function identify(text: string): Staff | null {
    const t = text.trim();
    if (!t) return null;
    const s = staff.find((x) => x.cardId === t) ?? staff.find((x) => x.employeeNo === t);
    if (!s) {
      setErr("Unknown employee number or card");
      return null;
    }
    const d = signInDecision(s, roleFor(s, ws.propertyId, roles), ws, propertyRvcIds, todayColombo());
    if (!d.ok) {
      setErr(d.reason ?? "Not allowed");
      return null;
    }
    setErr("");
    setWho(s);
    setIdText("");
    return s;
  }

  async function checkPin(pin: string, person: Staff | null = who) {
    if (!person || !store) return;
    const current = staff.find((s) => s.id === person.id) ?? person;
    const d = signInDecision(current, roleFor(current, ws.propertyId, roles), ws, propertyRvcIds, todayColombo());
    if (!d.ok) return setErr(d.reason ?? "Not allowed");
    if (!(await verifyPin(pin, current.pinHash, current.pinSalt))) {
      const next = afterFailedSignIn(current, maxFailed, new Date().toISOString());
      await store.merge(C.staff, current.id, next);
      await journal.log({ type: "signInFailed", employeeId: current.id, detail: `attempt ${next.failedSignIns} of ${maxFailed}` });
      if (next.lockedAt) {
        await journal.log({ type: "lockout", employeeId: current.id });
        setErr(`Locked after ${maxFailed} wrong PINs. A manager must unlock you.`);
      } else setErr(`Wrong PIN (${maxFailed - (next.failedSignIns ?? 0)} tries left)`);
      return;
    }
    await store.merge(C.staff, current.id, { failedSignIns: 0, lastSignInAt: new Date().toISOString() });
    await journal.log({ type: "signIn", employeeId: current.id });
    if (settings.pos.requireClockIn && !current.clockedInAt) return setClockFor({ s: current, rvcIds: d.rvcIds });
    onSignedIn(current, d.rvcIds);
  }

  async function clockIn() {
    if (!clockFor || !store) return;
    const now = new Date().toISOString();
    const card: TimeCard = { id: newId(), staffId: clockFor.s.id, propertyId: ws.propertyId, rvcId: clockFor.rvcIds[0] ?? ws.rvcId, businessDate: businessDateNow(settings.pos), clockIn: now, workstationId: ws.id };
    await store.set(C.timeCards, card);
    await store.merge(C.staff, clockFor.s.id, { clockedInAt: now });
    await journal.log({ type: "clockIn", employeeId: clockFor.s.id });
    toast(`Clocked in at ${timeColombo(now)}`);
    onSignedIn({ ...clockFor.s, clockedInAt: now }, clockFor.rvcIds);
  }

  if (ui !== "terminal")
    return (
      <MobileSignIn
        style={ui}
        ws={ws}
        rvcs={rvcs}
        onChangeDevice={onChangeDevice}
        view={{
          mode,
          here,
          who,
          err,
          clockFor,
          identify,
          pick: (s) => { setErr(""); setWho(s ? identify(s.employeeNo) : null); },
          checkPin: (pin, person) => checkPin(pin, person ?? who),
          clockIn,
          cancelClock: () => { setClockFor(null); setWho(null); },
        }}
      />
    );

  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(760px, 100%)" }}>
        <Brand ws={ws} rvcs={rvcs} />
        {clockFor ? (
          <div className="stack" style={{ alignItems: "center" }}>
            <h2>Hello {clockFor.s.name.split(" ")[0]}</h2>
            <p className="muted">You need to clock in before starting work.</p>
            <button className="btn primary lg" onClick={clockIn}>Clock in now</button>
            <button className="btn ghost sm" onClick={() => { setClockFor(null); setWho(null); }}>Cancel</button>
          </div>
        ) : who ? (
          <div className="stack" style={{ alignItems: "center" }}>
            <p><strong>{who.name}</strong>{who.jobTitle ? <span className="muted"> · {who.jobTitle}</span> : null}, enter your PIN</p>
            <PinEntry error={err} onSubmit={checkPin} />
            <button className="btn ghost sm" onClick={() => { setWho(null); setErr(""); }}>Not {who.name.split(" ")[0]}?</button>
          </div>
        ) : mode === "tapName" ? (
          <>
            <p className="muted">Tap your name</p>
            <div className="grid cols-3" style={{ width: "100%" }}>
              {here.map((s) => (
                <button key={s.id} className="btn lg" style={{ flexDirection: "column", height: 78, borderRadius: 16 }} onClick={() => identify(s.employeeNo)}>
                  <span>{s.name}</span>
                  <span className="tiny muted">#{s.employeeNo}{s.lockedAt ? " · locked" : ""}</span>
                </button>
              ))}
            </div>
            {err ? <div className="callout bad">{err}</div> : null}
          </>
        ) : (
          <div className="signin-grid">
            <div className="stack">
              <h3>{mode === "card" ? "Swipe your card" : "Employee number"}</h3>
              <input
                ref={cardRef}
                className="input num"
                style={{ fontSize: 24, textAlign: "center", letterSpacing: 4 }}
                inputMode="numeric"
                autoComplete="off"
                aria-label="Employee number or card"
                placeholder={mode === "card" ? "Swipe or type your number" : "e.g. 1002"}
                value={idText}
                onChange={(e) => setIdText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && identify(idText)}
              />
              {err ? <div className="callout bad small">{err}</div> : <p className="small muted">A card reader types the card number and Enter, so a swipe signs you in straight away.</p>}
            </div>
            <div className="stack">
              <Keypad onKey={(k) => (k === "C" ? setIdText("") : k === "⌫" ? setIdText((v) => v.slice(0, -1)) : setIdText((v) => (v + k).slice(0, 12)))} />
              <button className="btn primary lg" disabled={!idText} onClick={() => identify(idText)}>Next</button>
            </div>
          </div>
        )}
        <div className="row wrap">
          <Link to="/emc/home" className="btn ghost sm">Back office</Link>
          <button className="btn ghost sm" onClick={onChangeDevice}>Change workstation</button>
        </div>
      </div>
    </div>
  );
}

function RvcPicker({ ws, rvcs, user, onPick, onCancel }: { ws: Workstation; rvcs: RevenueCenter[]; user: Staff; onPick: (id: string) => void; onCancel: () => void }) {
  const open = useCollection<{ rvcId: string; propertyId: string }>(C.checks, { where: [["status", "==", "open"]] }) ?? [];
  return (
    <div className="auth">
      <div className="card auth-card" style={{ width: "min(760px, 100%)" }}>
        <Brand ws={ws} rvcs={rvcs} />
        <h2>Choose a revenue centre</h2>
        <p className="muted">{user.name}, you work in more than one outlet on this workstation.</p>
        <div className="rvc-list">
          {rvcs.map((r) => (
            <button key={r.id} className="rvc-btn" onClick={() => onPick(r.id)}>
              <strong style={{ fontSize: 18 }}>{r.name}</strong>
              <span className="small muted">{r.serviceMode === "table" ? "Table service" : "Quick service"} · {open.filter((c) => c.rvcId === r.id && c.propertyId === ws.propertyId).length} open checks</span>
              {r.id === ws.rvcId ? <span className="badge brand">Default for this workstation</span> : null}
            </button>
          ))}
        </div>
        <button className="btn ghost sm" onClick={onCancel}>Sign out</button>
      </div>
    </div>
  );
}
