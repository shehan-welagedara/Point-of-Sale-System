import { orderBy } from "firebase/firestore";
import { useState } from "react";
import { ROLE_LABEL, type Role, useAction, useCol, useSession } from "../state";
import { type Staff, dateTime } from "../types";
import { Field, Loading, PageHead } from "../ui";

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including other owners",
  admin: "Everything except owners: clients, licences, suspend, updates, staff, settings",
  sales: "Clients, subscriptions, payments and licences",
  support: "Read-only: health, usage, licences, activity",
  engineer: "Read-only, plus starting updates",
};

export function StaffPage() {
  const { can, role: myRole, user } = useSession();
  const { busy, run } = useAction();
  const staff = useCol<Staff>("staff", [orderBy("email")], "s");
  const invites = useCol<{ id: string; email: string; role: Role; invitedBy: string; at: string }>(can("staff") ? "invites" : null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("support");
  if (!staff) return <Loading />;
  return (
    <>
      <PageHead title="Staff" sub="Who can use the console, and what they may do. Every action is in the audit log." />
      {can("staff") ? (
        <form className="card card-body stack" onSubmit={(e) => { e.preventDefault(); void run("inviteStaff", { email, role }, `${email} invited: they sign in with that email to join`).then(() => setEmail("")); }}>
          <h2>Invite</h2>
          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <div className="grow"><Field label="Email (their Google account, or an email they will verify)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field></div>
            <Field label="Role">
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== "owner" || myRole === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            <button className="btn primary" disabled={busy}>Invite</button>
          </div>
          <div className="small muted">{ROLE_HELP[role]}</div>
        </form>
      ) : null}
      {invites?.length ? (
        <div className="card">
          <div className="card-head"><h2>Waiting to join</h2></div>
          <div className="table-wrap"><table><thead><tr><th>Email</th><th>Role</th><th>Invited</th><th /></tr></thead><tbody>
            {invites.map((i) => <tr key={i.id}><td>{i.email}</td><td>{ROLE_LABEL[i.role]}</td><td>{dateTime(i.at)} by {i.invitedBy}</td><td><button className="btn sm" disabled={busy} onClick={() => void run("cancelInvite", { email: i.email }, "Invitation withdrawn")}>Withdraw</button></td></tr>)}
          </tbody></table></div>
        </div>
      ) : null}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Staff</th><th>Role</th><th>Joined</th><th>Status</th></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong><div className="tiny muted">{s.email}</div></td>
                  <td>
                    {can("staff") && s.uid !== user?.uid && (s.role !== "owner" || myRole === "owner") ? (
                      <select className="input" style={{ width: "auto" }} value={s.role} disabled={busy} onChange={(e) => void run("updateStaff", { uid: s.uid, role: e.target.value }, "Role changed")}>
                        {(Object.keys(ROLE_LABEL) as Role[]).filter((r) => r !== "owner" || myRole === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : ROLE_LABEL[s.role as Role] ?? s.role}
                  </td>
                  <td>{dateTime(s.joinedAt)}</td>
                  <td>
                    {s.active ? <span className="badge good">Active</span> : <span className="badge">Deactivated</span>}{" "}
                    {can("staff") && s.uid !== user?.uid && (s.role !== "owner" || myRole === "owner") ? <button className="btn sm" disabled={busy} onClick={() => void run("updateStaff", { uid: s.uid, active: !s.active }, s.active ? "Deactivated" : "Reactivated")}>{s.active ? "Deactivate" : "Reactivate"}</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
