import { limit, orderBy } from "firebase/firestore";
import { Link } from "react-router-dom";
import { useCol } from "../state";
import { type AuditEntry, dateTime } from "../types";
import { Loading, PageHead } from "../ui";

export function AuditPage() {
  const rows = useCol<AuditEntry>("audit", [orderBy("at", "desc"), limit(300)], "a");
  if (!rows) return <Loading />;
  return (
    <>
      <PageHead title="Audit log" sub="Every change made in the console, by whom and when (latest 300). Entries can't be edited or deleted." />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Client</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>{dateTime(e.at)}</td>
                  <td>{e.email}<div className="tiny muted">{e.role ?? ""}</div></td>
                  <td><strong>{e.action}</strong></td>
                  <td>{e.clientId ? <Link to={`/clients/${e.clientId}`}>{e.clientId}</Link> : "—"}</td>
                  <td>{e.summary}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={5} className="empty">Nothing yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
