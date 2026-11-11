import { useEffect, useState } from "react";
import { projectId } from "../firebase";
import { useAction, useDocData, useSession } from "../state";
import { Field, PageHead } from "../ui";

interface Company { name: string; email: string; phone: string; whatsapp: string; website: string; address: string }
interface Github { owner: string; repo: string; workflow: string; ref: string; stagingProjectId: string }

export function SettingsPage() {
  const { can } = useSession();
  const { busy, run } = useAction();
  const company = useDocData<Company>("config/company");
  const github = useDocData<Github>("config/github");
  const [c, setC] = useState<Company>({ name: "Polymath Tech", email: "", phone: "", whatsapp: "", website: "", address: "" });
  const [g, setG] = useState<Github>({ owner: "", repo: "", workflow: "release.yml", ref: "main", stagingProjectId: "" });
  const [pub, setPub] = useState<string | null | undefined>(undefined);
  useEffect(() => { if (company) setC({ ...c, ...company }); }, [company]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (github) setG({ ...g, ...github }); }, [github]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void run<{ publicKey: string | null }>("publicKey", {}).then((r) => setPub(r?.publicKey ?? null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = can("settings");
  const checkin = `https://${projectId()}.web.app/api/checkin`;
  return (
    <>
      <PageHead title="Settings" sub="Polymath Tech's details, the release repository, and the console's keys." />
      <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("saveCompany", { company: c }, "Saved: clients see it from their next check-in"); }}>
        <h2>Company</h2>
        <p className="small muted">Shown to every client on their About page (Help and support), and in renewal reminders.</p>
        <div className="grid cols-3">
          <Field label="Company name"><input className="input" value={c.name} disabled={!edit} onChange={(e) => setC({ ...c, name: e.target.value })} /></Field>
          <Field label="Support email"><input className="input" type="email" value={c.email} disabled={!edit} onChange={(e) => setC({ ...c, email: e.target.value })} /></Field>
          <Field label="Support phone"><input className="input" value={c.phone} disabled={!edit} onChange={(e) => setC({ ...c, phone: e.target.value })} /></Field>
          <Field label="WhatsApp"><input className="input" value={c.whatsapp} disabled={!edit} onChange={(e) => setC({ ...c, whatsapp: e.target.value })} placeholder="+94 7X XXX XXXX" /></Field>
          <Field label="Website"><input className="input" value={c.website} disabled={!edit} onChange={(e) => setC({ ...c, website: e.target.value })} /></Field>
          <Field label="Address"><input className="input" value={c.address} disabled={!edit} onChange={(e) => setC({ ...c, address: e.target.value })} /></Field>
        </div>
        {edit ? <div className="row"><span className="grow" /><button className="btn primary" disabled={busy}>Save company</button></div> : null}
      </form>
      <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("saveGithub", { github: g }, "Saved"); }}>
        <h2>GitHub (updates)</h2>
        <p className="small muted">The repository whose release workflow deploys updates (docs/20). The token that may start it is kept in Secret Manager: <code>pnpm console:setup --github-token</code>.</p>
        <div className="grid cols-3">
          <Field label="Owner"><input className="input" value={g.owner} disabled={!edit} onChange={(e) => setG({ ...g, owner: e.target.value })} placeholder="your-github-account" /></Field>
          <Field label="Repository"><input className="input" value={g.repo} disabled={!edit} onChange={(e) => setG({ ...g, repo: e.target.value })} placeholder="Point-of-Sale-System" /></Field>
          <Field label="Workflow file"><input className="input" value={g.workflow} disabled={!edit} onChange={(e) => setG({ ...g, workflow: e.target.value })} /></Field>
          <Field label="Release branch"><input className="input" value={g.ref} disabled={!edit} onChange={(e) => setG({ ...g, ref: e.target.value })} /></Field>
          <Field label="Staging project ID"><input className="input mono" value={g.stagingProjectId} disabled={!edit} onChange={(e) => setG({ ...g, stagingProjectId: e.target.value })} /></Field>
        </div>
        {edit ? <div className="row"><span className="grow" /><button className="btn primary" disabled={busy}>Save GitHub settings</button></div> : null}
      </form>
      <div className="card card-body stack">
        <h2>Keys and addresses</h2>
        <dl className="kv">
          <dt>Check-in address</dt><dd className="mono">{checkin}</dd>
          <dt>Licence public key</dt>
          <dd>{pub === undefined ? "…" : pub ? <div className="key">{pub}</div> : <span className="badge bad">The signing key isn't set up: run pnpm console:setup</span>}</dd>
        </dl>
        <p className="small muted">Clients verify licences and suspensions with this public key. It must be the one in their deployments (<code>apps/functions/.env</code> LICENCE_PUBLIC_KEY), which <code>pnpm console:setup</code> takes from the same key file.</p>
      </div>
    </>
  );
}
