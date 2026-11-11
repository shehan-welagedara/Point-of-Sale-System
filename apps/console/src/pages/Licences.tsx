import { limit, orderBy } from "firebase/firestore";
import { Link } from "react-router-dom";
import { useCol } from "../state";
import { date, dateTime } from "../types";
import { Loading, PageHead } from "../ui";

interface LicenceRow {
  id: string;
  licenceId: string;
  clientId: string;
  licensee: { name: string };
  edition: string;
  addOns: string[];
  projectId: string;
  tenantId: string;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
  reason?: string;
}

/** Every licence ever issued from the console (newest first). */
export function LicencesPage() {
  const rows = useCol<LicenceRow>("licences", [orderBy("issuedAt", "desc"), limit(300)], "all");
  if (!rows) return <Loading />;
  return (
    <>
      <PageHead title="Licences" sub="Every licence issued from the console. To issue or renew one, open the client." />
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Licence</th><th>Client</th><th>Edition</th><th>Project</th><th>Until</th><th>Issued</th><th>By</th><th>Why</th></tr></thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.licenceId}</td>
                  <td><Link to={`/clients/${l.clientId}`}>{l.licensee?.name ?? l.clientId}</Link></td>
                  <td>{l.edition}{l.addOns?.length ? ` + ${l.addOns.join(", ")}` : ""}</td>
                  <td className="mono">{l.projectId}{l.tenantId !== "*" ? ` · ${l.tenantId}` : ""}</td>
                  <td>{date(l.expiresAt)}</td>
                  <td>{dateTime(l.issuedAt)}</td>
                  <td>{l.issuedBy}</td>
                  <td>{l.reason || "—"}</td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={8} className="empty">No licences issued yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
