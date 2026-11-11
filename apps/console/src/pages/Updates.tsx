import { limit, orderBy } from "firebase/firestore";
import { useState } from "react";
import { useAction, useCol, useDocData, useSession } from "../state";
import { type Client, type Deployment, compareVersions, dateTime } from "../types";
import { Field, Loading, PageHead } from "../ui";

const STATUS: Record<string, string> = { success: "good", completed: "good", failure: "bad", failed: "bad", cancelled: "", timed_out: "bad", in_progress: "info", queued: "info", requested: "info", waiting: "warn", pending: "info" };

/** Releases started from the console run the GitHub Actions release workflow (docs/20). */
export function UpdatesPage() {
  const { can } = useSession();
  const { busy, run } = useAction();
  const deployments = useCol<Deployment>("deployments", [orderBy("at", "desc"), limit(50)], "d");
  const clients = useCol<Client>("clients", [orderBy("name")], "name");
  const gh = useDocData<{ owner?: string; repo?: string; latestVersion?: string; latestCheckedAt?: string; stagingProjectId?: string }>("config/github");
  const [kind, setKind] = useState<"staging" | "wave:1" | "wave:2" | "clients">("staging");
  const [picked, setPicked] = useState<string[]>([]);
  if (!deployments || !clients) return <Loading />;
  const target = kind === "clients" ? picked.join(",") : kind;
  const affected = kind === "clients" ? clients.filter((c) => picked.includes(c.id)) : kind === "staging" ? [] : clients.filter((c) => c.enabled && c.status !== "cancelled" && c.wave === (kind === "wave:1" ? 1 : 2));
  return (
    <>
      <PageHead title="Updates" sub={gh?.latestVersion ? `Version on ${gh.owner}/${gh.repo}: ${gh.latestVersion} (checked ${dateTime(gh.latestCheckedAt)})` : "Release a version to your staging project, a wave, or chosen clients."}>
        <button className="btn" disabled={busy} onClick={() => void run("refreshDeployments", {}, "Refreshed from GitHub")}>Refresh from GitHub</button>
      </PageHead>
      {!gh?.owner ? <div className="callout warn">Set the GitHub repository in Settings → GitHub first.</div> : null}
      {can("deploy") ? (
        <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("startDeployment", { target }, "Release started on GitHub Actions"); }}>
          <h2>New update</h2>
          <p className="small muted">Deploys the current <code>{gh?.owner ? "main" : "release"}</code> build with the release tool, client by client: backup, database indexes, data updates, security rules and server functions, then the app. Production waves wait for approval in GitHub (docs/20). Release after the clients' closing time.</p>
          <div className="row wrap">
            <Field label="Target">
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="staging">Staging{gh?.stagingProjectId ? ` (${gh.stagingProjectId})` : ""}</option>
                <option value="wave:1">Wave 1 (pilot clients)</option>
                <option value="wave:2">Wave 2 (everyone else)</option>
                <option value="clients">Chosen clients</option>
              </select>
            </Field>
            <span className="grow" />
            <button className="btn primary" disabled={busy || !gh?.owner || (kind === "clients" && !picked.length)}>Start update</button>
          </div>
          {kind === "clients" ? (
            <div className="grid cols-3">
              {clients.filter((c) => c.status !== "cancelled").map((c) => (
                <label key={c.id} className="check"><input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((p) => p !== c.id))} /> {c.name}</label>
              ))}
            </div>
          ) : null}
          {affected.length ? <div className="small muted">Clients: {affected.map((c) => `${c.name}${c.health?.appVersion ? ` (now ${c.health.appVersion}${gh?.latestVersion && compareVersions(c.health.appVersion, gh.latestVersion) >= 0 ? ", up to date" : ""})` : ""}`).join(", ")}</div> : null}
        </form>
      ) : null}
      <div className="card">
        <div className="card-head"><h2>History</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Started</th><th>Target</th><th>By</th><th>Status</th><th>Run</th></tr></thead>
            <tbody>
              {deployments.map((d) => (
                <tr key={d.id}>
                  <td>{dateTime(d.at)}</td>
                  <td>{d.target}</td>
                  <td>{d.requestedBy}</td>
                  <td><span className={`badge ${STATUS[d.status] ?? ""}`}>{d.status.replace(/_/g, " ")}</span>{d.error ? <div className="tiny muted">{d.error}</div> : null}</td>
                  <td>{d.run ? <a href={d.run.url} target="_blank" rel="noreferrer">GitHub run</a> : "—"}</td>
                </tr>
              ))}
              {!deployments.length ? <tr><td colSpan={5} className="empty">No updates started from the console yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
