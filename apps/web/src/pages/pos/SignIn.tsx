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
  businessDateNow,
  newId,
  roleFor,
  signInDecision,
} from "@pos/core";
import { Empty, Loading, Explain } from "../../components/ui";
import { PosMaintenanceNotice } from "../../components/UpdateNotices";
import { timeColombo, todayColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { Keypad, PinEntry } from "./dialogs";
import { PosMain } from "./Pos";
import { resolveTheme, themeStyle } from "./theme";
import { MobileDeviceSetup, MobileRvcPicker, MobileSignIn } from "./mobile/MobileSignIn";
import { type UiStyle, useUiStyle } from "./mobile/ui";
import { APP_VERSION, setBusy } from "../../lib/version";
import { reportError } from "../../lib/errors";

interface DeviceStatus {
  id: string;
  uid: string;
  deviceId: string;
  appVersion: string;
  lastSeenAt: string;
  employeeId?: string;
  online?: boolean;
}

/** A random id for this browser, so two devices using one workstation can be told apart. */
function thisDeviceId(): string {
  try {
    let id = localStorage.getItem("pos-suite.device");
    if (!id) {
      id = newId();
      localStorage.setItem("pos-suite.device", id);
    }
    return id;
  } catch {
    return "unknown";
  }
}

/**
 * Reports this device's app version and last contact every few minutes (System status page;
 * which devices still run an old release), and warns when the same workstation is open on a
 * second device: each workstation numbers its own bills, so it must be used on one device only.
 */
function useDeviceHeartbeat(wsId: string | undefined, employeeId: string | undefined): boolean {
  const { store, user, mode } = useApp();
  const deviceId = useMemo(thisDeviceId, []);
  const status = (useCollection<DeviceStatus>(wsId ? C.deviceStatus : null, wsId ? { where: [["id", "==", wsId]] } : undefined) ?? [])[0];
  useEffect(() => {
    if (!wsId || !store) return;
    const uid = mode === "firebase" ? user?.uid : "local";
    if (!uid) return;
    const beat = () => void store.set(C.deviceStatus, { id: wsId, uid, deviceId, appVersion: APP_VERSION, lastSeenAt: new Date().toISOString(), online: navigator.onLine, ...(employeeId ? { employeeId } : {}) }).catch(() => undefined);
    beat();
    const t = setInterval(beat, 4 * 60_000);
    return () => clearInterval(t);
  }, [wsId, store, user?.uid, mode, deviceId, employeeId]);
  return Boolean(status && status.deviceId !== deviceId && Date.now() - Date.parse(status.lastSeenAt) < 6 * 60_000);
}

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
  const sharedDevice = useDeviceHeartbeat(ws?.id, session?.user.id);
  useEffect(() => {
    // A signed-in employee's screen never reloads by itself for an update.
    setBusy("pos-session", Boolean(session));
    return () => setBusy("pos-session", false);
  }, [session]);
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

  const shared = sharedDevice ? (
    <div className="sys-banner warn" role="alert" style={{ top: 10, bottom: "auto" }}>
      <span>Workstation {ws.code} is also open on another device. Use each workstation on one device only: bills are numbered per workstation and may fail to close.</span>
    </div>
  ) : null;

  if (session)
    return (
      <>
      {shared}
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
      </>
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
      <>{shared}<MobileRvcPicker style={ui} rvcs={rvcs.filter((r) => pendingRvc.rvcIds.includes(r.id))} user={pendingRvc.user} defaultRvc={ws.rvcId} openCount={(id) => openChecks.filter((c) => c.rvcId === id && c.propertyId === ws.propertyId).length} onPick={(id) => begin(pendingRvc.user, id)} onCancel={() => setPendingRvc(null)} /></>
    ) : (
      <>{shared}{signIn}</>
    );

  return (
    <div className="pos-theme" style={style}>
      {shared}
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
        <Explain as="p" className="muted">Choose which workstation this screen is. Each workstation numbers its own bills (IRD invoice series) and keeps its own transaction journal, so use each one on only one device.</Explain>
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
  const { settings, store, toast, staffAuth } = useApp();
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

  /** Employee number (looked up here) or card (checked on the server: card numbers aren't readable). */
  async function identify(text: string): Promise<Staff | null> {
    try {
      return await identifyInner(text);
    } catch (e) {
      failed(e);
      return null;
    }
  }

  async function identifyInner(text: string): Promise<Staff | null> {
    const t = text.trim();
    if (!t) return null;
    let s = staff.find((x) => x.employeeNo === t) ?? null;
    if (!s) {
      const r = await staffAuth({ action: "identifyCard", card: t });
      s = r.ok ? (staff.find((x) => x.id === r.staffId) ?? null) : null;
      if (!s) {
        setErr(r.ok ? "Unknown employee number or card" : r.reason === "Unknown card" ? "Unknown employee number or card" : r.reason);
        return null;
      }
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

  /** Sign-in must never just stop: say what went wrong, and keep it in System status. */
  function failed(e: unknown) {
    reportError(e, { workstationId: ws.id });
    const msg = (e as Error)?.message ?? String(e);
    setErr(/requires an index|FAILED_PRECONDITION|failed-precondition/i.test(msg)
      ? "The system's database is missing an update (a search index). Please ask Polymath Tech to run the latest update; it takes a few minutes."
      : /offline|unavailable|network/i.test(msg)
        ? "No connection to the server. Check the internet and try again."
        : `Couldn't sign in: ${msg.replace(/^.*?:\s*/, "").slice(0, 160)}`);
  }

  async function checkPin(pin: string, person: Staff | null = who) {
    try {
      await checkPinInner(pin, person);
    } catch (e) {
      failed(e);
    }
  }

  async function checkPinInner(pin: string, person: Staff | null = who) {
    if (!person || !store) return;
    const current = staff.find((s) => s.id === person.id) ?? person;
    const d = signInDecision(current, roleFor(current, ws.propertyId, roles), ws, propertyRvcIds, todayColombo());
    if (!d.ok) return setErr(d.reason ?? "Not allowed");
    // Checked on the server, which also counts wrong PINs and locks the employee out.
    const r = await staffAuth({ action: "verify", staffId: current.id, pin, purpose: "signIn" });
    if (!r.ok) {
      if (r.triesLeft !== undefined) await journal.log({ type: "signInFailed", employeeId: current.id, detail: `attempt ${maxFailed - r.triesLeft} of ${maxFailed}` });
      if (r.locked && r.triesLeft === 0) await journal.log({ type: "lockout", employeeId: current.id });
      setErr(r.reason);
      return;
    }
    await journal.log({ type: "signIn", employeeId: current.id });
    if (settings.pos.requireClockIn && !current.clockedInAt) return setClockFor({ s: current, rvcIds: d.rvcIds });
    onSignedIn(current, d.rvcIds);
  }

  async function clockIn() {
    try {
      await clockInInner();
    } catch (e) {
      failed(e);
    }
  }

  async function clockInInner() {
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
          pick: (s) => { setErr(""); if (s) void identify(s.employeeNo); else setWho(null); },
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
        <PosMaintenanceNotice />
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
                <button key={s.id} className="btn lg" style={{ flexDirection: "column", height: 78, borderRadius: 16 }} onClick={() => void identify(s.employeeNo)}>
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
                onKeyDown={(e) => { if (e.key === "Enter") void identify(idText); }}
              />
              {err ? <div className="callout bad small">{err}</div> : <p className="small muted">A card reader types the card number and Enter, so a swipe signs you in straight away.</p>}
            </div>
            <div className="stack">
              <Keypad onKey={(k) => (k === "C" ? setIdText("") : k === "⌫" ? setIdText((v) => v.slice(0, -1)) : setIdText((v) => (v + k).slice(0, 12)))} />
              <button className="btn primary lg" disabled={!idText} onClick={() => void identify(idText)}>Next</button>
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
        <PosMaintenanceNotice />
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
