import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { type Workstation, COLLECTIONS as C, MODULES, editionInfo } from "@pos/core";
import { PageHead } from "../../components/ui";
import { firebaseConfig } from "../../lib/firebase";
import { dateColombo, dateTimeColombo } from "../../lib/format";
import { APP_BUILT_AT, APP_COMMIT, APP_VERSION, type LiveVersion, RELEASE_NOTES, compareVersions, fetchLiveVersion } from "../../lib/version";
import { useApp, useCollection } from "../../state/app";

interface DeviceStatus {
  id: string;
  appVersion: string;
  lastSeenAt: string;
}

/** **bold**, *italic* and `code` in release notes. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g).filter(Boolean).map((part, i) => {
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    return part;
  });
}

const STATUS_TEXT: Record<string, string> = { demo: "Demo", trial: "Trial", valid: "Licensed", grace: "Renewal due (grace period)", expired: "Expired" };

/**
 * About this system: the version running here and on the server, whether an update is waiting, what
 * changed in recent releases, the licence and modules, and where the data lives. For owners and admins.
 */
export function AboutPage() {
  const { role, mode, tenant, licence, on, settings } = useApp();
  const [live, setLive] = useState<LiveVersion | null | undefined>(undefined);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const devices = useCollection<DeviceStatus>(C.deviceStatus) ?? [];
  const workstations = useCollection<Workstation>(C.workstations) ?? [];
  const check = async () => {
    setLive(undefined);
    setLive(await fetchLiveVersion());
    setCheckedAt(new Date().toISOString());
  };
  useEffect(() => void check(), []);
  if (role !== "owner" && role !== "admin") {
    return (
      <div className="page">
        <PageHead title="About this system" />
        <div className="callout">Only the owner or an administrator can see the system details. You are running version {APP_VERSION}.</div>
      </div>
    );
  }

  const newer = live && compareVersions(live.version, APP_VERSION) > 0;
  const tooOld = live && compareVersions(APP_VERSION, live.minSupportedVersion) < 0;
  const edition = editionInfo(licence.edition);
  const enabled = MODULES.filter((m) => m.status === "available" && on(m.key));
  const behind = devices.filter((d) => compareVersions(d.appVersion, live?.version ?? APP_VERSION) < 0);
  const updateText =
    live === undefined ? "Checking for updates…"
    : live === null ? (mode === "local" ? "Update check isn't available in local demo mode: it works once the system is deployed." : "Couldn't reach the server to check for updates.")
    : tooOld ? `Version ${live.version} is live and this screen must update before use.`
    : newer ? `Version ${live.version} is available.`
    : "This is the latest version.";

  return (
    <div className="page">
      <PageHead title="About this system" subtitle="The version you are running, updates and what's new, your licence and where your data is kept." />
      <div className="grid cols-3 about-cards">
        <div className="card card-body stack tight">
          <span className="small muted">POS Suite · Cloud Restaurant Edition</span>
          <strong style={{ fontSize: 28 }}>Version {APP_VERSION}</strong>
          <span className="small muted">Built {APP_BUILT_AT ? dateTimeColombo(APP_BUILT_AT) : "in development"} · {APP_COMMIT}</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`badge ${live === undefined || live === null ? "" : newer || tooOld ? "warn" : "good"}`} role="status">{live === undefined ? "Checking…" : live === null ? "Not checked" : newer || tooOld ? "Update available" : "Up to date"}</span>
          </div>
          <p className="small" style={{ margin: 0 }}>{updateText}</p>
          <div className="row wrap" style={{ gap: 8 }}>
            {newer || tooOld ? <button className="btn primary sm" onClick={() => location.reload()}>Update now</button> : null}
            <button className="btn sm" onClick={() => void check()} disabled={live === undefined}>Check for updates</button>
          </div>
          {checkedAt ? <span className="tiny muted">Checked {dateTimeColombo(checkedAt)}</span> : null}
          {live ? <span className="tiny muted">On the server: {live.version}{live.builtAt ? ` (released ${dateColombo(live.builtAt.slice(0, 10))})` : ""} · oldest version allowed {live.minSupportedVersion}</span> : null}
        </div>

        <div className="card card-body stack tight">
          <span className="small muted">Licence</span>
          <strong style={{ fontSize: 20 }}>{edition.name} edition</strong>
          <span className="small">{STATUS_TEXT[licence.status] ?? licence.status}{licence.daysLeft !== null ? ` · ${licence.daysLeft} day(s) left` : ""}{licence.licensee ? ` · licensed to ${licence.licensee}` : ""}</span>
          <span className="small muted">Up to {licence.entitlements.limits.workstations} workstations, {licence.entitlements.limits.employees} employees, {licence.entitlements.limits.backOfficeUsers} back-office users, {licence.entitlements.limits.properties} outlet(s).</span>
          <div className="chips" aria-label="Modules switched on">
            {enabled.map((m) => <span key={m.key} className="badge brand">{m.name}</span>)}
          </div>
          <Link to="/emc/setup/licence" className="small">Licence &amp; modules →</Link>
        </div>

        <div className="card card-body stack tight">
          <span className="small muted">Where it runs</span>
          <strong style={{ fontSize: 20 }}>{mode === "local" ? "Local demo (this browser)" : "Cloud (Google Firebase)"}</strong>
          <dl className="about-dl">
            <dt>Business</dt>
            <dd>{settings.business.tradingName || tenant?.name}</dd>
            {mode === "firebase" ? (
              <>
                <dt>Project</dt>
                <dd className="mono">{firebaseConfig.projectId}</dd>
                <dt>Data region</dt>
                <dd>Mumbai (asia-south1)</dd>
              </>
            ) : (
              <>
                <dt>Data</dt>
                <dd>Kept only in this browser; clearing site data removes it</dd>
              </>
            )}
            <dt>Business ID</dt>
            <dd className="mono">{tenant?.id}</dd>
            <dt>Time zone</dt>
            <dd>Asia/Colombo</dd>
            <dt>Devices</dt>
            <dd>
              {workstations.filter((w) => w.active).length} workstation(s){devices.length ? ` · ${behind.length ? `${behind.length} not updated yet` : "all up to date"}` : ""}
            </dd>
          </dl>
          <Link to="/emc/setup/status" className="small">System status: each device's version and recent errors →</Link>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>What's new</h3><span className="small muted">Release notes of the latest versions</span></div>
        <div className="card-body stack">
          {RELEASE_NOTES.length ? RELEASE_NOTES.map((r) => (
            <section key={r.version} className="stack tight release-note">
              <div className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                <h4 style={{ margin: 0 }}>Version {r.version}</h4>
                <span className="small muted">{dateColombo(r.date)}{r.type ? ` · ${r.type}` : ""}</span>
                {r.version === APP_VERSION ? <span className="badge good">You are on this version</span> : compareVersions(r.version, APP_VERSION) > 0 ? <span className="badge warn">Newer</span> : null}
              </div>
              {r.notes.length ? <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>{r.notes.map((n, i) => <li key={i}>{inline(n)}</li>)}</ul> : <p className="small muted" style={{ margin: 0 }}>Fixes and improvements.</p>}
            </section>
          )) : <p className="small muted">Release notes are included when the system is built.</p>}
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card card-body stack tight">
          <h3>Updates</h3>
          <p className="small" style={{ margin: 0 }}>
            Updates are installed on the server by your supplier, outside service hours. Every screen notices a new version within a few minutes: screens that nobody is using reload by themselves; a screen in use shows <em>Version … is available</em> with an <em>Update now</em> button. Nothing already saved is lost. A version that is too old to use safely asks to update before it can be used.
          </p>
        </div>
        <div className="card card-body stack tight">
          <h3>Help and support</h3>
          <p className="small" style={{ margin: 0 }}>
            The user manual, the configuration guide and the training manuals come with the system as PDFs from your supplier. For help, contact your system supplier{settings.branding.poweredBy ? ` (${settings.branding.poweredBy})` : ""}, quoting the version and business ID above.
          </p>
          <p className="tiny muted" style={{ margin: 0 }}>Built with open-source software including React, Vite, Firebase, ExcelJS and Zod, used under their licences.</p>
        </div>
      </div>
    </div>
  );
}
