import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { httpsCallable } from "firebase/functions";
import { type Member, type RevenueCenter, type Workstation, COLLECTIONS as C, canAdd } from "@pos/core";
import { ConfirmButton, Field, Modal } from "../../components/ui";
import { dateTimeColombo } from "../../lib/format";
import { firebase } from "../../lib/firebase";
import { useApp, useCollection, useStore } from "../../state/app";

type DeviceMember = Member & { device?: { workstationId: string; pairedAt: string; pairedBy: string; userAgent?: string } };
type DeviceStatus = { id: string; uid: string; appVersion?: string; lastSeenAt: string; online?: boolean; employeeId?: string };

const MANAGERS = ["owner", "admin", "manager"];

function deviceApi<T>(data: Record<string, unknown>): Promise<T> {
  return httpsCallable(firebase().functions, "deviceApi")(data).then((r) => r.data as T);
}

/** "iPhone", "Android phone"… from the browser's description, for the device list. */
function kind(ua = ""): string {
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS/.test(ua)) return "Mac";
  return "";
}

function ago(iso?: string): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return dateTimeColombo(iso);
}

/**
 * Phones and tablets connected to this business. Each has its own login, created by scanning a
 * one-time code: no shared passwords, and a lost phone or a leaver's phone is removed on its own.
 */
export function ConnectedDevices() {
  const { mode, role, tenant, toast } = useApp();
  const members = useCollection<DeviceMember>(C.members) ?? [];
  const status = useCollection<DeviceStatus>(C.deviceStatus) ?? [];
  const workstations = useCollection<Workstation>(C.workstations) ?? [];
  const [connecting, setConnecting] = useState(false);
  const devices = members.filter((m) => m.device).sort((a, b) => (a.device!.pairedAt < b.device!.pairedAt ? 1 : -1));
  const canManage = MANAGERS.includes(role ?? "");
  const wsName = (id: string) => workstations.find((w) => w.id === id)?.name ?? id;

  async function remove(d: DeviceMember) {
    try {
      await deviceApi({ action: "revoke", tenantId: tenant!.id, uid: d.uid });
      toast(`${d.name} removed: it is signed out and can't get back in`);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <h3>Connected phones and tablets</h3>
            <div className="small muted">Staff phones and tablets work over the internet (mobile data or Wi-Fi). Each one is connected once with a code and gets its own login.</div>
          </div>
          {canManage ? (
            <button className="btn primary" disabled={mode === "local"} title={mode === "local" ? "Connecting phones works on the live system" : undefined} onClick={() => setConnecting(true)}>
              📱 Connect a phone
            </button>
          ) : null}
        </div>
        <div className="table-wrap">
          <table className="table cards-sm">
            <thead>
              <tr><th>Device</th><th>Workstation</th><th>Connected</th><th>Last seen</th><th /></tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const s = status.find((x) => x.uid === d.uid);
                return (
                  <tr key={d.uid}>
                    <td data-label="Device"><strong>{d.name}</strong> <span className="tiny muted">{kind(d.device!.userAgent)}</span></td>
                    <td data-label="Workstation"><span className="mono">{d.device!.workstationId}</span> <span className="small muted">{wsName(d.device!.workstationId)}</span></td>
                    <td data-label="Connected" className="small">{dateTimeColombo(d.device!.pairedAt)}</td>
                    <td data-label="Last seen" className="small">{ago(s?.lastSeenAt)}{s?.appVersion ? <span className="tiny muted"> · v{s.appVersion}</span> : null}</td>
                    <td data-label="" className="right">{canManage ? <ConfirmButton className="btn sm danger" confirmText="Tap again to remove" onConfirm={() => void remove(d)}>Remove</ConfirmButton> : null}</td>
                  </tr>
                );
              })}
              {!devices.length ? (
                <tr><td colSpan={5} className="small muted">{mode === "local" ? "In the demo, open the POS on this device instead (Point of Sale). On the live system, connect each staff phone here." : "No phones or tablets connected yet. Press Connect a phone, then scan the code with the phone's camera."}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      {connecting ? <ConnectPhone onClose={() => setConnecting(false)} connected={devices} /> : null}
    </div>
  );
}

function nextPhoneCode(existing: string[]): string {
  for (let i = 1; i < 100; i++) {
    const c = `P${String(i).padStart(2, "0")}`;
    if (!existing.includes(c)) return c;
  }
  return "P99";
}

function ConnectPhone({ onClose, connected }: { onClose: () => void; connected: DeviceMember[] }) {
  const { tenant, settings, licence, toast } = useApp();
  const store = useStore();
  const workstations = (useCollection<Workstation>(C.workstations) ?? []).filter((w) => w.active);
  const rvcs = useCollection<RevenueCenter>(C.revenueCenters) ?? [];
  const taken = new Set(connected.map((d) => d.device!.workstationId));
  const [wsId, setWsId] = useState("__new");
  const [newCode, setNewCode] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; url: string; qr: string; workstationId: string } | null>(null);
  const [, tick] = useState(0);
  const suggested = nextPhoneCode(workstations.map((w) => w.id));
  useEffect(() => {
    const free = workstations.find((w) => w.deviceProfile === "mobile" && !taken.has(w.id));
    if (free && wsId === "__new" && !newCode) setWsId(free.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workstations.length]);
  useEffect(() => {
    if (!pairing) return;
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [pairing]);

  async function create() {
    if (!label.trim()) return toast("Name the phone, for example “Nimal's phone” or “Bar phone 1”", true);
    setBusy(true);
    try {
      let id = wsId;
      if (wsId === "__new") {
        const code = (newCode || suggested).toUpperCase();
        if (!/^[A-Z0-9]{1,15}$/.test(code)) throw new Error("Workstation code: 1–15 capital letters or digits");
        if (workstations.some((w) => w.id === code)) throw new Error(`Workstation ${code} already exists: choose it from the list`);
        const lim = canAdd(licence.entitlements, "workstations", workstations.length); // active ones
        if (!lim.ok) throw new Error(`The licence allows ${lim.limit} workstations. Remove one you no longer use, or ask your supplier for more.`);
        const propertyId = settings.pos.defaultPropertyId;
        const rvc = rvcs.find((r) => r.propertyId === propertyId && r.active) ?? rvcs.find((r) => r.active);
        if (!rvc) throw new Error("Add a revenue centre first (Properties & revenue centres)");
        const ws: Workstation = { id: code, code, name: label.trim(), propertyId: rvc.propertyId, rvcId: rvc.id, deviceProfile: "mobile", receiptPrinterId: "", printMode: "agent", uiStyle: "default", active: true };
        await store.set(C.workstations, ws);
        id = code;
      }
      const r = await deviceApi<{ code: string; expiresAt: string }>({ action: "create", tenantId: tenant!.id, workstationId: id, label: label.trim() });
      const url = `${location.origin}/pair?code=${encodeURIComponent(r.code)}`;
      setPairing({ ...r, url, workstationId: id, qr: await QRCode.toDataURL(url, { margin: 1, width: 480 }) });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const minutesLeft = pairing ? Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - Date.now()) / 60_000)) : 0;
  return (
    <Modal title="Connect a phone or tablet" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>{pairing ? "Done" : "Cancel"}</button>}>
      {!pairing ? (
        <div className="stack">
          <Field label="Name of this phone" help="Who uses it or where it is: it appears in the device list and on reports.">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Nimal's phone, Bar phone 1" aria-label="Name of this phone" />
          </Field>
          <Field label="Workstation" help="Each phone needs its own workstation: it numbers the phone's bills (IRD series).">
            <select className="select" value={wsId} onChange={(e) => setWsId(e.target.value)} aria-label="Workstation">
              <option value="__new">+ New workstation for this phone</option>
              {workstations.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.id} · {w.name}{taken.has(w.id) ? " (has a connected device)" : ""}
                </option>
              ))}
            </select>
          </Field>
          {wsId === "__new" ? (
            <Field label="Code of the new workstation" help={`Appears in invoice numbers; never reused. ${workstations.length} of ${licence.entitlements.limits.workstations} workstations used.`}>
              <input className="input mono" value={newCode} placeholder={suggested} onChange={(e) => setNewCode(e.target.value.toUpperCase())} aria-label="Workstation code" />
            </Field>
          ) : taken.has(wsId) ? (
            <div className="callout warn small">This workstation already has a connected device. Use it for a replacement phone only, and remove the old one: a workstation must be used on one device at a time.</div>
          ) : null}
          <button className="btn primary" disabled={busy} onClick={create}>{busy ? "Please wait…" : "Show the code"}</button>
        </div>
      ) : (
        <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
          <p className="small" style={{ margin: 0 }}>On <strong>{label}</strong>, open the camera and scan this code, then tap the link.</p>
          <img src={pairing.qr} alt="Pairing QR code" style={{ width: 240, height: 240, imageRendering: "pixelated" }} />
          <div className="small muted">Or open <strong>{location.host}/pair</strong> on the phone and type:</div>
          <div className="mono" style={{ fontSize: 30, letterSpacing: 4, fontWeight: 700 }} aria-label="Pairing code">{pairing.code}</div>
          <div className={`small ${minutesLeft ? "muted" : "bad"}`}>{minutesLeft ? `Works once, for the next ${minutesLeft} min.` : "This code has expired: close and create a new one."}</div>
          <div className="callout small" style={{ textAlign: "left" }}>
            Once connected, the phone opens the POS on workstation <strong className="mono">{pairing.workstationId}</strong>. Staff sign in with their employee number and PIN. Then add it to the home screen (Share → Add to Home Screen on iPhone; ⋮ → Install app on Android).
          </div>
        </div>
      )}
    </Modal>
  );
}
