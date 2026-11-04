import { Fragment, useState } from "react";
import {
  type PrivilegeKey,
  type Property,
  type RevenueCenter,
  type Role,
  type RoleLimits,
  type Staff,
  type TimeCard,
  COLLECTIONS as C,
  DEFAULT_SIGN_IN,
  PRIVILEGE_GROUPS,
  PRIVILEGES,
  canAdd,
  codeToId,
  hashPin,
  pinPolicyError,
} from "@pos/core";
import { CrudPage } from "../../components/CrudPage";
import { Field, Loading, PageHead } from "../../components/ui";
import { dateTimeColombo, timeColombo, todayColombo } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

const useNames = (col: string) => new Map((useCollection<{ id: string; name: string }>(col) ?? []).map((d) => [d.id, d.name]));

function PinEditor({ doc, setDoc }: { doc: Record<string, any>; setDoc: (d: any) => void }) {
  const { settings, toast } = useApp();
  const [pin, setPin] = useState("");
  const min = settings.pos.pinMinLength ?? DEFAULT_SIGN_IN.pinMinLength;
  return (
    <Field label={doc.pinHash ? "Reset PIN" : "PIN *"} help={`${min}–8 digits, not easy to guess. Stored as a salted hash; nobody can read it back.`}>
      <div className="row">
        <input className="input mono" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
        <button
          type="button"
          className="btn"
          disabled={!pin}
          onClick={async () => {
            const problem = pinPolicyError(pin, min);
            if (problem) return toast(problem, true);
            const { hash, salt } = await hashPin(pin);
            setDoc({ ...doc, pinHash: hash, pinSalt: salt, pinChangedAt: new Date().toISOString(), failedSignIns: 0 });
            setPin("");
          }}
        >
          Set PIN
        </button>
        {doc.pinHash ? <span className="badge good">PIN set</span> : null}
      </div>
    </Field>
  );
}

/** Role per property for people who work in more than one hotel. */
function PropertyRoles({ doc, setDoc }: { doc: Record<string, any>; setDoc: (d: any) => void }) {
  const properties = useCollection<Property>(C.properties) ?? [];
  const roles = useCollection<Role>(C.roles) ?? [];
  const pr = (doc.propertyRoles ?? {}) as Record<string, string>;
  const props = properties.filter((p) => !doc.propertyIds?.length || doc.propertyIds.includes(p.id));
  if (props.length < 2) return null;
  return (
    <Field label="Role at each property" help="Leave as default to use the main role.">
      <div className="stack tight">
        {props.map((p) => (
          <div key={p.id} className="row between">
            <span className="small">{p.name}</span>
            <select className="select" style={{ maxWidth: 220 }} value={pr[p.id] ?? ""} onChange={(e) => { const next = { ...pr }; if (e.target.value) next[p.id] = e.target.value; else delete next[p.id]; setDoc({ ...doc, propertyRoles: next }); }}>
              <option value="">Default role</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        ))}
      </div>
    </Field>
  );
}

export function EmployeesPage() {
  const { licence, toast } = useApp();
  const store = useStore();
  const roles = useNames(C.roles);
  const rvcs = useNames(C.revenueCenters);
  const staff = useCollection<Staff>(C.staff) ?? [];
  const active = staff.filter((s) => s.status === "active").length;
  return (
    <CrudPage
      title="Employees"
      subtitle={`People who sign in to the POS (employee number or card, plus PIN). Their role at each property sets what they may do; revenue centres set where they may work. ${active} active of ${licence.entitlements.limits.employees} licensed.`}
      col={C.staff}
      idFrom="code"
      codeKey="employeeNo"
      noun="employee"
      search={(d) => `${d.employeeNo} ${d.name} ${d.jobTitle ?? ""} ${d.department ?? ""}`}
      newDoc={() => ({ employeeNo: "", name: "", roleId: "server", propertyIds: [], rvcIds: [], status: "active", hireDate: todayColombo() })}
      validate={(d) => {
        if (!d.pinHash) return "Set a PIN before saving";
        const isNew = !staff.some((s) => s.id === d.employeeNo);
        if (isNew && d.status === "active" && !canAdd(licence.entitlements, "employees", active).ok) return `The licence allows ${licence.entitlements.limits.employees} active employees`;
        if (d.cardId && staff.some((s) => s.cardId === d.cardId && s.id !== (d.id ?? d.employeeNo))) return "That card is already assigned to someone else";
        return null;
      }}
      fields={[
        { key: "employeeNo", label: "Employee number (sign-in ID)", type: "text", required: true, readOnlyOnEdit: true, help: "Digits only." },
        { key: "name", label: "Name", type: "text", required: true },
        { key: "jobTitle", label: "Job title", type: "text" },
        { key: "department", label: "Department", type: "select", options: ["Front of house", "Kitchen", "Bar", "Management", "Finance", "Housekeeping", "Room service"].map((v) => ({ value: v, label: v })) },
        { key: "roleId", label: "Role (default at every property)", type: "select", optionsFrom: { col: C.roles }, required: true },
        { key: "propertyIds", label: "Properties", type: "multi", optionsFrom: { col: C.properties }, help: "Empty = every property." },
        { key: "rvcIds", label: "Revenue centres (operator records)", type: "multi", optionsFrom: { col: C.revenueCenters }, help: "Empty = every revenue centre of their properties." },
        { key: "cardId", label: "Staff card (mag stripe / RFID)", type: "text", help: "Swipe the card into this field. Cards sign in and authorise manager overrides." },
        { key: "phone", label: "Mobile", type: "text" },
        { key: "email", label: "Email", type: "text" },
        { key: "hireDate", label: "Start date", type: "date" },
        { key: "terminationDate", label: "End date", type: "date", help: "After this date the employee can't sign in." },
        { key: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "terminated", label: "Terminated (access removed)" }] },
      ]}
      extraEditor={(d, setDoc) => (
        <>
          <PinEditor doc={d} setDoc={setDoc} />
          <PropertyRoles doc={d} setDoc={setDoc} />
          {d.lockedAt ? (
            <div className="callout warn row between">
              <span>Locked {dateTimeColombo(d.lockedAt)} after {d.failedSignIns} wrong PINs.</span>
              <button type="button" className="btn sm" onClick={() => { const { lockedAt: _l, ...rest } = d; setDoc({ ...rest, failedSignIns: 0 }); }}>Unlock</button>
            </div>
          ) : null}
        </>
      )}
      rowActions={(d) =>
        d.lockedAt ? (
          <button className="btn sm" onClick={async (e) => { e.stopPropagation(); const { lockedAt: _l, ...rest } = d; await store.set(C.staff, { ...rest, failedSignIns: 0 }); toast(`${d.name} unlocked`); }}>
            Unlock
          </button>
        ) : null
      }
      columns={[
        { header: "No.", render: (d) => <span className="mono">{d.employeeNo ?? d.id}</span> },
        { header: "Name", render: (d) => <div><div>{d.name}</div><div className="tiny muted">{[d.jobTitle, d.department].filter(Boolean).join(" · ")}</div></div> },
        { header: "Role", render: (d) => <>{roles.get(d.roleId) ?? d.roleId}{d.propertyRoles && Object.keys(d.propertyRoles).length ? <span className="tiny muted"> +{Object.keys(d.propertyRoles).length}</span> : null}</> },
        { header: "Revenue centres", render: (d) => <span className="small">{d.rvcIds?.length ? d.rvcIds.map((r: string) => rvcs.get(r) ?? r).join(", ") : "All"}</span> },
        { header: "Last sign-in", render: (d) => <span className="small muted">{d.lastSignInAt ? dateTimeColombo(d.lastSignInAt) : "—"}</span> },
        { header: "Status", render: (d) => (d.lockedAt ? <span className="badge bad">Locked</span> : <span className={`badge ${d.status === "active" ? "good" : "bad"}`}>{d.status}</span>) },
      ]}
    />
  );
}

const LIMIT_FIELDS: { key: keyof RoleLimits; label: string; unit: "%" | "Rs" }[] = [
  { key: "maxDiscountBp", label: "Max discount", unit: "%" },
  { key: "maxVoidAmount", label: "Max single void", unit: "Rs" },
  { key: "maxPriceOverrideBp", label: "Max price change", unit: "%" },
  { key: "maxPaidOut", label: "Max paid out", unit: "Rs" },
  { key: "maxRefundAmount", label: "Max refund", unit: "Rs" },
];

/**
 * Roles & privileges matrix. Each cell cycles: not allowed → allowed → allowed with a second
 * person's approval. Levels decide who may approve for whom.
 */
export function RolesPage() {
  const store = useStore();
  const { toast, role: memberRole } = useApp();
  const roles = useCollection<Role>(C.roles);
  const [newName, setNewName] = useState("");
  if (!roles) return <div className="page"><Loading /></div>;
  const ordered = [...roles].sort((a, b) => (a.level ?? 99) - (b.level ?? 99) || a.name.localeCompare(b.name));
  const canEdit = memberRole === "owner" || memberRole === "admin" || memberRole === null;

  async function save(r: Role) {
    try {
      await store.set(C.roles, r);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  function cycle(r: Role, p: PrivilegeKey) {
    const has = r.privileges.includes(p);
    const auth = (r.requireAuth ?? []).includes(p);
    if (!has) return save({ ...r, privileges: [...r.privileges, p], requireAuth: (r.requireAuth ?? []).filter((x) => x !== p) });
    if (!auth) return save({ ...r, requireAuth: [...(r.requireAuth ?? []), p] });
    return save({ ...r, privileges: r.privileges.filter((x) => x !== p), requireAuth: (r.requireAuth ?? []).filter((x) => x !== p) });
  }
  function setLimit(r: Role, key: keyof RoleLimits, text: string, unit: "%" | "Rs") {
    const limits = { ...(r.limits ?? {}) };
    if (text.trim() === "") delete limits[key];
    else limits[key] = Math.round(Number(text) * 100);
    void save({ ...r, limits });
    void unit;
  }

  return (
    <div className="page fill">
      <PageHead
        title="Roles & privileges"
        subtitle="What each role may do on the POS, its limits, and its level. Level 1 is the most senior: people can approve actions only for roles at their level or below, and only within their own limits."
        actions={
          canEdit ? (
            <div className="row">
              <input className="input" placeholder="New role name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn primary" disabled={!newName.trim()} onClick={async () => { await save({ id: codeToId(newName), name: newName.trim(), level: 50, privileges: ["pos.signIn", "pos.clockInOut", "pos.openCheck"], limits: {} }); setNewName(""); toast("Role added"); }}>Add role</button>
            </div>
          ) : null
        }
      />
      <div className="callout small" style={{ flex: "none" }}>Click a cell to cycle: <span className="badge">—</span> not allowed → <span className="badge good">✓</span> allowed → <span className="badge warn">✓ approval</span> allowed but a senior employee must approve each time.</div>
      <div className="card table-wrap fill-card">
        <table className="table">
          <thead>
            <tr>
              <th>Privilege</th>
              {ordered.map((r) => (
                <th key={r.id} style={{ textAlign: "center", minWidth: 110 }}>
                  <div>{r.name}</div>
                  <label className="tiny muted">
                    Level{" "}
                    <input className="input num" style={{ width: 52, minHeight: 26, padding: "2px 4px", display: "inline-block" }} type="number" min={1} max={99} disabled={!canEdit || r.id === "owner"} value={r.level ?? 99} onChange={(e) => save({ ...r, level: Math.max(1, Math.min(99, Number(e.target.value) || 99)) })} />
                  </label>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PRIVILEGE_GROUPS.map((g) => (
              <Fragment key={g.key}>
                <tr><td colSpan={ordered.length + 1} className="section-title">{g.label}</td></tr>
                {(Object.keys(g.privileges) as PrivilegeKey[]).map((p) => (
                  <tr key={p}>
                    <td>{PRIVILEGES[p]}</td>
                    {ordered.map((r) => {
                      const has = r.privileges.includes(p);
                      const auth = (r.requireAuth ?? []).includes(p);
                      return (
                        <td key={r.id} style={{ textAlign: "center" }}>
                          <button className={`badge ${has ? (auth ? "warn" : "good") : ""}`} style={{ cursor: canEdit && r.id !== "owner" ? "pointer" : "default", border: 0 }} disabled={!canEdit || r.id === "owner"} aria-label={`${r.name}: ${PRIVILEGES[p]}: ${has ? (auth ? "needs approval" : "allowed") : "not allowed"}`} onClick={() => cycle(r, p)}>
                            {has ? (auth ? "✓ approval" : "✓") : "—"}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
            <tr><td colSpan={ordered.length + 1} className="section-title">Limits (empty = no limit)</td></tr>
            {LIMIT_FIELDS.map((f) => (
              <tr key={f.key}>
                <td>{f.label} ({f.unit})</td>
                {ordered.map((r) => (
                  <td key={r.id} style={{ textAlign: "center" }}>
                    <input className="input num" style={{ width: 90, minHeight: 28, padding: "2px 6px" }} type="number" min={0} disabled={!canEdit || r.id === "owner"} defaultValue={r.limits?.[f.key] !== undefined ? r.limits[f.key]! / 100 : ""} onBlur={(e) => setLimit(r, f.key, e.target.value, f.unit)} aria-label={`${r.name} ${f.label}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Time and attendance: shifts clocked on the POS, with hours per employee. */
export function TimeCardsPage() {
  const staff = useCollection<Staff>(C.staff) ?? [];
  const rvcs = useCollection<RevenueCenter>(C.revenueCenters) ?? [];
  const [from, setFrom] = useState(todayColombo().slice(0, 8) + "01");
  const [to, setTo] = useState(todayColombo());
  const cards = (useCollection<TimeCard>(C.timeCards, { where: [["businessDate", ">=", from], ["businessDate", "<=", to]] }) ?? []).sort((a, b) => b.clockIn.localeCompare(a.clockIn));
  const name = (id: string) => staff.find((s) => s.id === id)?.name ?? id;
  const totals = new Map<string, number>();
  for (const c of cards) if (c.minutes) totals.set(c.staffId, (totals.get(c.staffId) ?? 0) + c.minutes);
  return (
    <div className="page">
      <PageHead title="Time cards" subtitle="Clock-in and clock-out on the POS (switch on 'must clock in' under Sign-in policy). Exports to payroll from Reports." />
      <div className="row wrap">
        <Field label="From"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      <div className="grid cols-2">
        <div className="card table-wrap">
          <div className="card-head"><h3>Shifts</h3></div>
          <table className="table">
            <thead><tr><th>Employee</th><th>Date</th><th>In</th><th>Out</th><th>Outlet</th><th className="num">Hours</th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id}>
                  <td>{name(c.staffId)}</td>
                  <td>{c.businessDate}</td>
                  <td>{timeColombo(c.clockIn)}</td>
                  <td>{c.clockOut ? timeColombo(c.clockOut) : <span className="badge good">on shift</span>}</td>
                  <td className="small">{rvcs.find((r) => r.id === c.rvcId)?.name ?? c.rvcId}</td>
                  <td className="num">{c.minutes ? (c.minutes / 60).toFixed(2) : ""}</td>
                </tr>
              ))}
              {!cards.length ? <tr><td colSpan={6} className="muted">No shifts in this range.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <div className="card table-wrap">
          <div className="card-head"><h3>Hours per employee</h3></div>
          <table className="table">
            <tbody>{[...totals].map(([id, m]) => <tr key={id}><td>{name(id)}</td><td className="num">{(m / 60).toFixed(2)} h</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
