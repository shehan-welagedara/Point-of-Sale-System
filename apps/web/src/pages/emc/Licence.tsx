import { useState } from "react";
import { type Member, type ModuleKey, COLLECTIONS as C, EDITIONS, LIMIT_LABEL, MODULES, type UsageLimits, clampModules, editionInfo, setModule, usageReport } from "@pos/core";
import { Bar, Field, PageHead, Seg, Toggle } from "../../components/ui";
import { firebaseConfig } from "../../lib/firebase";
import { dateTimeColombo } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";

/** Licence key, entitlement, usage against limits, and the module switches within it. */
export function LicencePage() {
  const { tenant, licence, activateLicence, updateTenant, toast, role, mode } = useApp();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"licence" | "modules" | "editions">("licence");
  const counts: UsageLimits = {
    properties: (useCollection<{ active: boolean }>(C.properties) ?? []).filter((p) => p.active).length,
    revenueCenters: (useCollection<{ active: boolean }>(C.revenueCenters) ?? []).filter((p) => p.active).length,
    workstations: (useCollection<{ active: boolean }>(C.workstations) ?? []).filter((p) => p.active).length,
    employees: (useCollection<{ status: string }>(C.staff) ?? []).filter((s) => s.status === "active").length,
    backOfficeUsers: (useCollection<Member>(C.members) ?? []).length || (mode === "local" ? 3 : 0),
  };
  const canEdit = mode === "local" || role === "owner" || role === "admin";
  const mods = tenant?.modules ?? {};
  const entitled = new Set(licence.entitlements.modules);
  const addOns = new Set(editionInfo(licence.edition).addOns);
  const groups = [...new Set(MODULES.map((m) => m.group))];
  const projectId = mode === "local" ? "local" : (firebaseConfig.projectId ?? "");

  async function activate() {
    setBusy(true);
    try {
      await activateLicence(token);
      setToken("");
      toast("Licence activated");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(key: ModuleKey, on: boolean) {
    const next = clampModules(setModule(mods, key, on), licence.entitlements, licence.usable);
    await updateTenant({ modules: next });
    toast(`${on ? "Enabled" : "Disabled"}: ${MODULES.filter((m) => Boolean(next[m.key]) !== Boolean(mods[m.key])).map((m) => m.name).join(", ") || "no change"}`);
  }

  const l = tenant?.licence;
  return (
    <div className="page">
      <PageHead title="Licence & modules" subtitle="What this business is licensed for, how much of it is in use, and which licensed modules are switched on." />
      {licence.status === "expired" ? <div className="callout bad">The licence has expired. Modules are switched off until a renewed licence key is activated; data is kept.</div> : null}
      {licence.status === "grace" ? <div className="callout warn">The licence has expired and is in its grace period ({l?.graceDays} days). Activate the renewal key to avoid interruption.</div> : null}
      {l?.demoKey && mode === "firebase" ? <div className="callout warn">This licence is signed with the public demo key. Generate your own key pair (<code>pnpm licence keygen</code>) before selling licences.</div> : null}
      <Seg value={tab} onChange={setTab} options={[{ value: "licence", label: "Licence and usage" }, { value: "modules", label: "Modules" }, { value: "editions", label: "Editions" }]} />
      {tab === "licence" ? (
      <div className="grid cols-2">
        <div className="card card-body stack">
          <div className="row between">
            <h3>{editionInfo(licence.edition).name} edition</h3>
            <span className={`badge ${licence.usable ? (licence.status === "valid" ? "good" : "warn") : "bad"}`}>{licence.status === "demo" ? "Demo" : licence.status === "trial" ? `Trial · ${licence.daysLeft} days left` : licence.status}</span>
          </div>
          <p className="small muted">{editionInfo(licence.edition).description}</p>
          {l ? (
            <div className="grid cols-2 small">
              <div>Licensee: <strong>{l.licensee}</strong></div>
              <div>Licence: <strong className="mono">{l.licenceId}</strong></div>
              <div>Billing: <strong>{l.billing}</strong></div>
              <div>Valid: <strong>{l.validFrom.slice(0, 10)} → {l.expiresAt.slice(0, 10)}</strong></div>
              <div>Add-ons: <strong>{l.addOns.map((a) => MODULES.find((m) => m.key === a)?.name).join(", ") || "none"}</strong></div>
              <div>Activated: <strong>{dateTimeColombo(l.activatedAt)}</strong></div>
            </div>
          ) : (
            <p className="small">{licence.status === "demo" ? "Demonstration business with every module. Not for live trading." : "Every module is available during the trial. Activate a licence key before it ends."}</p>
          )}
          <div className="callout small">
            To get a licence key, send the vendor these identifiers:
            <div className="mono" style={{ marginTop: 6 }}>Project: {projectId || "—"}<br />Business: {tenant?.id}</div>
          </div>
          {canEdit ? (
            <>
              <Field label="Licence key">
                <textarea className="textarea mono" rows={3} value={token} onChange={(e) => setToken(e.target.value)} placeholder="POSL1.eyJ2Ijox…" />
              </Field>
              <button className="btn primary" disabled={!token.trim() || busy} onClick={activate}>{busy ? "Checking…" : "Activate licence"}</button>
              <p className="tiny muted">The key is checked against the vendor's signature{mode === "firebase" ? " on the server" : ""}; it can't be altered to add modules or capacity.</p>
            </>
          ) : null}
        </div>
        <div className="card card-body stack">
          <h3>Usage</h3>
          {usageReport(licence.entitlements, counts).map((u) => (
            <div key={u.key} className="stack tight">
              <div className="row between small">
                <span>{LIMIT_LABEL[u.key]}</span>
                <span className={u.ok ? "" : "badge bad"}>{u.used} of {u.limit}</span>
              </div>
              <Bar value={u.used} max={u.limit} {...(u.ok ? {} : { color: "var(--bad)" })} />
            </div>
          ))}
          <p className="tiny muted">Adding beyond a limit is refused (new workstations, employees, revenue centres). Ask the vendor for a higher tier or a capacity add-on.</p>
        </div>
      </div>
      ) : null}
      {tab === "modules" ? (
      <>
      {!canEdit ? <div className="callout warn">Only the owner or an administrator can switch modules.</div> : null}
      {groups.map((g) => (
        <div key={g} className="stack tight">
          <span className="section-title">{g}</span>
          <div className="grid cols-2">
            {MODULES.filter((m) => m.group === g).map((m) => {
              const ok = entitled.has(m.key) && m.status === "available";
              return (
                <div key={m.key} className="card card-body row" style={{ alignItems: "flex-start", opacity: ok ? 1 : 0.65 }}>
                  <div className="grow stack tight">
                    <div className="row wrap">
                      <h3>{m.name}</h3>
                      {m.status === "planned" ? <span className="badge">Planned</span> : !entitled.has(m.key) ? <span className="badge warn">{addOns.has(m.key) ? "Add-on" : "Higher edition"}</span> : null}
                    </div>
                    <p className="small muted">{m.description}</p>
                    {m.requires.length ? <p className="tiny muted">Needs: {m.requires.map((r) => MODULES.find((x) => x.key === r)?.name).join(", ")}</p> : null}
                  </div>
                  <Toggle on={Boolean(mods[m.key]) && ok} disabled={!canEdit || !ok || !licence.usable} onChange={(v) => toggle(m.key, v)} label={m.name} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
      </>
      ) : null}
      {tab === "editions" ? (
      <div className="grid cols-3">
        {EDITIONS.filter((e) => e.key !== "demo" && e.key !== "trial").map((e) => (
          <div key={e.key} className="card card-body stack tight" style={e.key === licence.edition ? { outline: "2px solid var(--brand)" } : undefined}>
            <h3>{e.name}</h3>
            <p className="small muted">{e.description}</p>
            <div className="tiny">{e.modules.map((k) => MODULES.find((m) => m.key === k)?.name).join(" · ")}</div>
            <div className="tiny muted">Up to {e.limits.properties} properties, {e.limits.revenueCenters} revenue centres, {e.limits.workstations} workstations, {e.limits.employees} employees.</div>
            {e.addOns.length ? <div className="tiny muted">Add-ons: {e.addOns.map((k) => MODULES.find((m) => m.key === k)?.name).join(", ")}</div> : null}
          </div>
        ))}
      </div>
      ) : null}
    </div>
  );
}
