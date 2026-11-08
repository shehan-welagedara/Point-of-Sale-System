import { useEffect, useState } from "react";
import { type Staff, type Workstation, COLLECTIONS as C } from "@pos/core";
import { PageHead } from "../../components/ui";
import { dateTimeColombo } from "../../lib/format";
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION, type LiveVersion, compareVersions, fetchLiveVersion } from "../../lib/version";
import { useApp, useCollection } from "../../state/app";

interface DeviceStatus {
  id: string;
  deviceId: string;
  appVersion: string;
  lastSeenAt: string;
  employeeId?: string;
  online?: boolean;
}

interface ClientError {
  id: string;
  message: string;
  path: string;
  appVersion: string;
  workstationId?: string;
  userAgent?: string;
  at: string;
}

const minutesAgo = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 60_000);

/** Administration → System status: release on the server, each device's version, recent errors. */
export function SystemStatusPage() {
  const { role, staffAuth, toast, mode } = useApp();
  const [live, setLive] = useState<LiveVersion | null>(null);
  const devices = useCollection<DeviceStatus>(C.deviceStatus) ?? [];
  const workstations = useCollection<Workstation>(C.workstations) ?? [];
  const staff = useCollection<Staff>(C.staff) ?? [];
  const errors = useCollection<ClientError>(C.clientErrors, { orderBy: ["at", "desc"], limit: 50 }) ?? [];
  const legacy = staff.filter((s) => s.pinHash || s.cardId).length;
  useEffect(() => void fetchLiveVersion().then(setLive), []);
  const wsName = (id: string) => workstations.find((w) => w.id === id);
  const name = (id?: string) => staff.find((s) => s.id === id)?.name ?? id ?? "";
  const latest = live?.version ?? APP_VERSION;

  return (
    <div className="page">
      <PageHead title="System status" subtitle="The release running on the server and on each device, and recent errors seen on screens. Use it before and after an update, and when something goes wrong." />
      <div className="grid cols-3">
        <div className="card card-body stack tight">
          <span className="small muted">On the server</span>
          <strong style={{ fontSize: 22 }}>{live ? `Version ${live.version}` : mode === "local" ? "Local demo" : "Unknown"}</strong>
          {live ? <span className="small muted">Minimum supported {live.minSupportedVersion} · built {dateTimeColombo(live.builtAt)}</span> : null}
        </div>
        <div className="card card-body stack tight">
          <span className="small muted">This browser</span>
          <strong style={{ fontSize: 22 }}>Version {APP_VERSION}</strong>
          <span className="small muted">{APP_COMMIT} · built {APP_BUILT_AT ? dateTimeColombo(APP_BUILT_AT) : "in development"}</span>
        </div>
        <div className="card card-body stack tight">
          <span className="small muted">Employee PINs</span>
          <strong style={{ fontSize: 22 }}>{legacy ? `${legacy} to secure` : "Secure"}</strong>
          <span className="small muted">PIN hashes and card numbers are kept where only the server can read them.</span>
          {legacy && (role === "owner" || role === "admin") ? (
            <button className="btn sm primary" onClick={async () => { const r = await staffAuth({ action: "migrate" }); toast(r.ok ? `Moved ${r.migrated ?? 0} employee record(s) to secure storage` : r.reason, !r.ok); }}>Secure them now</button>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Devices</h3><span className="small muted">Each POS device reports every few minutes</span></div>
        <div className="table-wrap">
          <table className="table cards-sm">
            <thead><tr><th>Workstation</th><th>Version</th><th>Last contact</th><th>Signed in</th><th>Device</th></tr></thead>
            <tbody>
              {devices.sort((a, b) => a.id.localeCompare(b.id)).map((d) => {
                const old = compareVersions(d.appVersion, latest) < 0;
                const stale = minutesAgo(d.lastSeenAt) > 15;
                return (
                  <tr key={d.id}>
                    <td data-label="Workstation"><strong>{wsName(d.id)?.code ?? d.id}</strong> <span className="small muted">{wsName(d.id)?.name}</span></td>
                    <td data-label="Version"><span className={`badge ${old ? "warn" : "good"}`}>{d.appVersion}{old ? " · update pending" : ""}</span></td>
                    <td data-label="Last contact"><span className={stale ? "muted" : ""}>{dateTimeColombo(d.lastSeenAt)}</span>{d.online === false ? <span className="badge warn"> offline</span> : null}</td>
                    <td data-label="Signed in">{d.employeeId ? name(d.employeeId) : <span className="muted">—</span>}</td>
                    <td data-label="Device" className="mono small">{d.deviceId.slice(-6)}</td>
                  </tr>
                );
              })}
              {!devices.length ? <tr><td colSpan={5} className="muted">No device has reported yet. Devices report when the POS is open.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Recent errors on screens</h3><span className="small muted">Latest 50, newest first</span></div>
        <div className="table-wrap">
          <table className="table cards-sm">
            <thead><tr><th>When</th><th>Screen</th><th>Version</th><th>Error</th></tr></thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <td data-label="When" className="small">{dateTimeColombo(e.at)}</td>
                  <td data-label="Screen" className="small mono">{e.path}{e.workstationId ? ` · ${e.workstationId}` : ""}</td>
                  <td data-label="Version" className="small">{e.appVersion}</td>
                  <td data-label="Error" className="small">{e.message}</td>
                </tr>
              ))}
              {!errors.length ? <tr><td colSpan={4} className="muted">No errors reported.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
