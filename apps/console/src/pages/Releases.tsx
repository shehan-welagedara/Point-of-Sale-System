import { limit, orderBy } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAction, useCol, useDocData, useSession } from "../state";
import { type Client, ROLLOUT_STATE, type Release, type Rollout, type RolloutState, compareVersions, date, dateTime } from "../types";
import { Field, Loading, Modal, PageHead } from "../ui";

declare const __POS_CHANGELOG__: string;

const OPEN: RolloutState[] = ["scheduled", "dispatched", "deployed", "manual"];
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Colombo", weekday: "short", day: "numeric", month: "short" });

/** The maintenance notice as the client's owner reads it. */
export function noticeText(version: string, at: string | null, until?: string): string {
  const when = at ? `${day(at)}, ${time(at)}${until ? `–${time(until)}` : ""}` : "shortly";
  return `Update ${version} is scheduled for ${when}. The system may pause for a few minutes during the update: please finish open bills first.`;
}

function ClientVersion({ c, version }: { c: Client; version: string }) {
  const v = c.health?.appVersion;
  if (!v) return <span className="badge">No check-in</span>;
  if (compareVersions(v, version) >= 0) return <span className="badge good">{v} · up to date</span>;
  return <span className="badge warn">{v}</span>;
}

function AddRelease({ onClose }: { onClose: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ version: "", date: new Date().toISOString().slice(0, 10), type: "", highlights: "" });
  return (
    <Modal title="Add a release by hand" onClose={onClose}>
      <p className="small muted">Normally the catalogue is loaded from the release notes (CHANGELOG.md). Add one here only for a release that isn't in them.</p>
      <div className="grid cols-2">
        <Field label="Version"><input className="input" placeholder="1.10.1" value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })} /></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      </div>
      <Field label="Type"><input className="input" placeholder="Patch (fixes)" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} /></Field>
      <Field label="What clients get (one per line)"><textarea className="input" rows={5} value={f.highlights} onChange={(e) => setF({ ...f, highlights: e.target.value })} /></Field>
      <div className="row"><span className="grow" /><button className="btn primary" disabled={busy || !f.version} onClick={async () => (await run("addRelease", f, `Release ${f.version} added`)) && onClose()}>Add release</button></div>
    </Modal>
  );
}

function RolloutCard({ r, canDeploy }: { r: Rollout; canDeploy: boolean }) {
  const { busy, run } = useAction();
  const entries = Object.entries(r.clients);
  const done = entries.filter(([, c]) => c.state === "done").length;
  return (
    <div className="card" data-rollout={r.version}>
      <div className="card-head">
        <h2 className="grow">
          {r.version} <span className="small muted">· {r.mode === "now" ? "now" : r.mode === "at" ? "at a set time" : "maintenance windows"} · {r.createdBy} · {dateTime(r.createdAt)}</span>
        </h2>
        <span className={`badge ${r.status === "done" ? "good" : r.status === "cancelled" ? "" : "info"}`}>{r.status === "active" ? `${done} of ${entries.length} done` : r.status}</span>
      </div>
      {r.message ? <div className="card-body small">Message to clients: {r.message}</div> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Client</th><th>From</th><th>When</th><th>Status</th><th /></tr></thead>
          <tbody>
            {entries.map(([id, c]) => {
              const [cls, label] = ROLLOUT_STATE[c.state];
              return (
                <tr key={id}>
                  <td><Link to={`/clients/${id}`}>{c.name}</Link></td>
                  <td>{c.from ?? "—"}</td>
                  <td>{c.state === "done" ? `done ${dateTime(c.doneAt)}` : `${dateTime(c.scheduledFor)}${c.windowEnd ? `–${time(c.windowEnd)}` : ""}`}</td>
                  <td>
                    <span className={`badge ${cls}`}>{label}</span>
                    {c.error ? <div className="tiny muted" style={{ maxWidth: 460, whiteSpace: "normal" }}>{c.error}</div> : null}
                  </td>
                  <td>
                    {canDeploy ? (
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        {c.state === "scheduled" || c.state === "manual" ? <button className="btn sm" disabled={busy} onClick={() => void run("cancelRollout", { rolloutId: r.id, clientId: id }, `Cancelled for ${c.name}`)}>Cancel</button> : null}
                        {c.state === "manual" || c.state === "deployed" ? <button className="btn sm" disabled={busy} onClick={() => void run("markRollout", { rolloutId: r.id, clientId: id, state: "done" }, `${c.name} marked done`)}>Mark done</button> : null}
                        {c.state === "failed" ? <button className="btn sm" disabled={busy} onClick={() => void run("markRollout", { rolloutId: r.id, clientId: id, state: "scheduled" }, `Retrying ${c.name}`)}>Retry now</button> : null}
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Updates: the catalogue of POS Suite versions, which version each client runs, and pushing a version
 * to chosen clients now or in their maintenance window (clients see a notice first; docs/22 §8).
 */
export function ReleasesPage() {
  const { can } = useSession();
  const { busy, run } = useAction();
  const [params] = useSearchParams();
  const releases = useCol<Release>("releases", [orderBy("date", "desc"), limit(60)], "r");
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  const rollouts = useCol<Rollout>("rollouts", [orderBy("createdAt", "desc"), limit(30)], "ro");
  const gh = useDocData<{ owner?: string; latestVersion?: string }>("config/github");
  const sorted = useMemo(() => (releases ? [...releases].sort((a, b) => compareVersions(b.version, a.version)) : []), [releases]);
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<"window" | "now" | "at">("window");
  const [at, setAt] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const version = selected ?? sorted[0]?.version ?? null;
  const release = sorted.find((r) => r.version === version);
  const live = (clients ?? []).filter((c) => c.status !== "cancelled" && c.enabled !== false);
  const inRollout = (id: string) => (rollouts ?? []).find((r) => r.status === "active" && r.clients[id] && OPEN.includes(r.clients[id]!.state));

  // Preselect the clients behind the chosen version (or the one opened from a client's page).
  useEffect(() => {
    if (!version || !clients) return;
    const only = params.get("client");
    setPicked(only ? [only] : live.filter((c) => c.health?.appVersion && compareVersions(c.health.appVersion, version) < 0 && !inRollout(c.id)).map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, clients?.length, rollouts?.length]);

  if (!releases || !clients || !rollouts) return <Loading />;
  const canDeploy = can("deploy");
  const load = () => (gh?.owner ? run("syncReleases", {}, "Release notes loaded from GitHub") : run("syncReleases", { changelog: __POS_CHANGELOG__ }, "Release notes loaded from this console's build"));
  const atIso = mode === "at" && at ? new Date(`${at}:00+05:30`).toISOString() : null;
  const active = rollouts.filter((r) => r.status === "active");
  const recent = rollouts.filter((r) => r.status !== "active").slice(0, 10);

  return (
    <>
      <PageHead title="Updates" sub="Choose a version and the clients to update. They see a maintenance notice first; each update runs in the client's maintenance window, or now.">
        {canDeploy ? (
          <>
            <button className="btn" disabled={busy} onClick={() => void load()}>{gh?.owner ? "Load release notes from GitHub" : "Load release notes"}</button>
            <button className="btn" onClick={() => setAdding(true)}>Add a release</button>
          </>
        ) : null}
      </PageHead>
      {adding ? <AddRelease onClose={() => setAdding(false)} /> : null}
      {!sorted.length ? (
        <div className="card card-body stack">
          <h2>No releases in the catalogue yet</h2>
          <p className="small muted">Load the release notes: every version of the POS Suite with what clients get in it.</p>
          {canDeploy ? <div><button className="btn primary" disabled={busy} onClick={() => void load()}>Load release notes</button></div> : null}
        </div>
      ) : (
        <div className="grid releases-grid">
          <div className="card">
            <div className="card-head"><h2 className="grow">Versions</h2>{gh?.latestVersion ? <span className="badge brand">main: {gh.latestVersion}</span> : null}</div>
            <div className="release-list" role="listbox" aria-label="Versions">
              {sorted.map((r) => {
                const on = live.filter((c) => c.health?.appVersion === r.version).length;
                return (
                  <button key={r.id} role="option" aria-selected={r.version === version} className={`release-row${r.version === version ? " on" : ""}`} onClick={() => setSelected(r.version)}>
                    <strong>{r.version}</strong>
                    <span className="tiny muted">{date(r.date)}{r.type ? ` · ${r.type.split(" (")[0]}` : ""}</span>
                    {on ? <span className="badge">{on} client{on === 1 ? "" : "s"}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
          {release ? (
            <div className="stack">
              <div className="card card-body stack">
                <div className="row wrap">
                  <h2 className="grow">POS Suite {release.version}</h2>
                  <span className="small muted">{date(release.date)}{release.type ? ` · ${release.type}` : ""}</span>
                </div>
                {release.highlights.length ? (
                  <ul className="notes">{release.highlights.slice(0, 6).map((h, i) => <li key={i}>{h}</li>)}</ul>
                ) : <p className="small muted">No notes for clients.</p>}
                {release.deploy ? <p className="tiny muted">Deploy: {release.deploy}</p> : null}
              </div>
              <div className="card">
                <div className="card-head">
                  <h2 className="grow">Clients</h2>
                  <button className="btn sm ghost" onClick={() => setPicked(live.filter((c) => !c.health?.appVersion || compareVersions(c.health.appVersion, release.version) < 0).filter((c) => !inRollout(c.id)).map((c) => c.id))}>Select all behind</button>
                  <button className="btn sm ghost" onClick={() => setPicked([])}>Clear</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th /><th>Client</th><th>Runs now</th><th>Maintenance window</th><th>Last check-in</th></tr></thead>
                    <tbody>
                      {live.map((c) => {
                        const busyIn = inRollout(c.id);
                        return (
                          <tr key={c.id}>
                            <td><input type="checkbox" aria-label={`Update ${c.name}`} disabled={Boolean(busyIn)} checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((p) => p !== c.id))} /></td>
                            <td><Link to={`/clients/${c.id}`}>{c.name}</Link>{busyIn ? <div className="tiny muted">In the rollout of {busyIn.version}</div> : null}</td>
                            <td><ClientVersion c={c} version={release.version} /></td>
                            <td className="small">{c.maintenanceWindow || "—"}</td>
                            <td className="small">{dateTime(c.health?.lastCheckinAt)}</td>
                          </tr>
                        );
                      })}
                      {!live.length ? <tr><td colSpan={5} className="empty">No clients yet.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                {canDeploy ? (
                  <div className="card-body stack">
                    <div className="seg wrap" role="group" aria-label="When">
                      <button className={mode === "window" ? "on" : ""} onClick={() => setMode("window")}>In each maintenance window</button>
                      <button className={mode === "now" ? "on" : ""} onClick={() => setMode("now")}>Now</button>
                      <button className={mode === "at" ? "on" : ""} onClick={() => setMode("at")}>At a time…</button>
                    </div>
                    {mode === "at" ? <Field label="Date and time (Sri Lanka)"><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field> : null}
                    <Field label="Message to clients (optional)" hint="Shown with the maintenance notice."><input className="input" maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. New: approvals for new businesses" /></Field>
                    <div className="callout small" data-testid="notice-preview">
                      Clients see: “{noticeText(release.version, mode === "now" ? null : atIso, undefined)}”
                      {mode === "window" ? " (with each client's own window)" : ""}
                      {mode === "now" ? " The update starts now; clients that check in first see the notice." : ""}
                    </div>
                    <div className="row">
                      <span className="grow small muted">{picked.length} client{picked.length === 1 ? "" : "s"} selected</span>
                      <button
                        className="btn primary"
                        disabled={busy || !picked.length || (mode === "at" && !at)}
                        onClick={async () => {
                          const r = await run<{ id: string; dispatched: number }>("createRollout", { version: release.version, clientIds: picked, mode, ...(atIso ? { at: atIso } : {}), ...(message ? { message } : {}) }, mode === "now" ? "Update started" : "Update scheduled: clients will see the notice");
                          if (r) setPicked([]);
                        }}
                      >
                        {mode === "now" ? "Update now" : "Schedule update"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      )}
      <div className="row">
        <h2 className="grow" style={{ fontSize: 18 }}>Rollouts</h2>
        {canDeploy && active.length ? <button className="btn sm" disabled={busy} onClick={() => void run("runRollouts", {}, "Checked for due updates")}>Start due updates now</button> : null}
      </div>
      {active.map((r) => <RolloutCard key={r.id} r={r} canDeploy={canDeploy} />)}
      {recent.map((r) => <RolloutCard key={r.id} r={r} canDeploy={canDeploy} />)}
      {!rollouts.length ? <div className="card empty">No updates pushed from the console yet.</div> : null}
    </>
  );
}
