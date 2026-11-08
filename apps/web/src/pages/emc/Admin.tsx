import { useState } from "react";
import {
  type Customer,
  type InventoryItem,
  type Member,
  type MemberRole,
  type MenuCategory,
  type MenuItem,
  type ModifierGroup,
  type Printer,
  type PrintJob,
  type Recipe,
  type Role,
  type Vendor,
  COLLECTIONS as C,
  MEMBER_ROLE_INFO,
} from "@pos/core";
import { type ImportResult, buildFeederWorkbook, importOps, parseFeederWorkbook } from "@pos/excel";
import type { ReceiptDoc } from "@pos/printing";
import { doc, setDoc } from "firebase/firestore";
import { firebase } from "../../lib/firebase";
import { ConfirmButton, Empty, Field, Loading, Modal, PageHead } from "../../components/ui";
import { ReceiptView } from "../../components/Receipt";
import { dateTimeColombo, downloadBuffer } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

// ───────────────────────────── Back-office logins ─────────────────────────────

export function LoginsPage() {
  const { mode, tenant, role, toast, user } = useApp();
  const store = useStore();
  const members = useCollection<Member>(mode === "firebase" ? C.members : null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<MemberRole>("manager");
  const canManage = role === "owner" || role === "admin";

  async function invite() {
    if (!tenant || !/^\S+@\S+\.\S+$/.test(email)) return toast("Enter a valid email", true);
    await setDoc(doc(firebase().db, "invites", email.trim().toLowerCase()), { tenantId: tenant.id, tenantName: tenant.name, role: newRole, invitedBy: user?.email ?? "", at: new Date().toISOString() });
    toast(`Invitation saved. ${email} can now create an account and choose “I was invited”.`);
    setEmail("");
  }

  return (
    <div className="page">
      <PageHead title="Back-office logins" subtitle="Who can open this back office, and with what access. POS staff sign in with PINs instead (People &amp; Security → Employees)." />
      <div className="grid cols-3">
        {(Object.keys(MEMBER_ROLE_INFO) as MemberRole[]).map((r) => (
          <div key={r} className="card card-body stack tight">
            <strong>{MEMBER_ROLE_INFO[r].label}</strong>
            <span className="small muted">{MEMBER_ROLE_INFO[r].description}</span>
          </div>
        ))}
      </div>
      {mode === "local" ? (
        <div className="callout">Local demo mode has a single owner login. With Firebase configured, invite managers, accountants, storekeepers and POS terminal devices here.</div>
      ) : (
        <>
          {canManage ? (
            <div className="card card-body row wrap">
              <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Access">
                <select className="select" value={newRole} onChange={(e) => setNewRole(e.target.value as MemberRole)}>
                  {(Object.keys(MEMBER_ROLE_INFO) as MemberRole[]).filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{MEMBER_ROLE_INFO[r].label}</option>)}
                </select>
              </Field>
              <button className="btn primary" style={{ alignSelf: "flex-end" }} onClick={invite}>Invite</button>
            </div>
          ) : null}
          <div className="card table-wrap">
            {!members ? <Loading /> : (
              <table className="table">
                <thead><tr><th>Name</th><th>Email</th><th>Access</th><th /></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.email}</td>
                      <td>
                        {canManage && m.role !== "owner" ? (
                          <select className="select" value={m.role} onChange={(e) => store.merge(C.members, m.id, { role: e.target.value })}>
                            {(Object.keys(MEMBER_ROLE_INFO) as MemberRole[]).filter((r) => r !== "owner").map((r) => <option key={r} value={r}>{MEMBER_ROLE_INFO[r].label}</option>)}
                          </select>
                        ) : (
                          <span className="badge brand">{MEMBER_ROLE_INFO[m.role].label}</span>
                        )}
                      </td>
                      <td className="right">{canManage && m.role !== "owner" && m.uid !== user?.uid ? <ConfirmButton className="btn sm danger" onConfirm={() => store.remove(C.members, m.id)}>Remove</ConfirmButton> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────────── Excel import / export ─────────────────────────────

export function DataPage() {
  const { toast, mode, resetLocalDemo } = useApp();
  const store = useStore();
  const [result, setResult] = useState<(ImportResult & { file: string }) | null>(null);
  const [busy, setBusy] = useState(false);

  async function current() {
    const [categories, menuItems, modifierGroups, inventoryItems, recipes, vendors, customers] = await Promise.all([
      store.list<MenuCategory>(C.menuCategories),
      store.list<MenuItem>(C.menuItems),
      store.list<ModifierGroup>(C.modifierGroups),
      store.list<InventoryItem>(C.inventoryItems),
      store.list<Recipe>(C.recipes),
      store.list<Vendor>(C.vendors),
      store.list<Customer>(C.customers),
    ]);
    return { categories, menuItems, modifierGroups, inventoryItems, recipes, vendors, customers };
  }

  async function onFile(file: File) {
    setBusy(true);
    try {
      const data = await current();
      const res = await parseFeederWorkbook(await file.arrayBuffer(), {
        categoryIds: data.categories.map((d) => d.id),
        inventoryIds: data.inventoryItems.map((d) => d.id),
        modifierGroupIds: data.modifierGroups.map((d) => d.id),
        vendorIds: data.vendors.map((d) => d.id),
        menuItemIds: data.menuItems.map((d) => d.id),
      });
      setResult({ ...res, file: file.name });
    } catch (e) {
      toast(`Could not read the workbook: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!result) return;
    setBusy(true);
    try {
      await store.batch(importOps(result.data));
      toast("Import complete");
      setResult(null);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  const counts = result
    ? [
        ["Categories", result.data.categories.length],
        ["Menu items", result.data.menuItems.length],
        ["Modifier groups", result.data.modifierGroups.length],
        ["Stock items", result.data.inventoryItems.length],
        ["Recipes", result.data.recipes.length],
        ["Vendors", result.data.vendors.length],
        ["Customers", result.data.customers.length],
      ]
    : [];

  return (
    <div className="page">
      <PageHead title="Excel import & export" subtitle="Feed the menu, prices, modifiers, stock items, recipes, vendors and customers from one Excel workbook. Codes are the keys, so re-importing updates instead of duplicating." />
      <div className="grid cols-3">
        <div className="card card-body stack">
          <h3>1. Get the template</h3>
          <p className="small muted">Blank workbook with drop-down lists, or the sample restaurant's data as a worked example.</p>
          <button className="btn" onClick={async () => downloadBuffer(await buildFeederWorkbook({ categories: [], menuItems: [], modifierGroups: [], inventoryItems: [], recipes: [], vendors: [], customers: [] }, { title: "Restaurant data feeder" }), "data-feeder-blank.xlsx")}>Download blank template</button>
          <button className="btn" onClick={async () => downloadBuffer(await buildFeederWorkbook(await current(), { title: "Restaurant data feeder – current data" }), "data-feeder-current.xlsx")}>Export current data</button>
        </div>
        <div className="card card-body stack">
          <h3>2. Import</h3>
          <p className="small muted">Choose the filled workbook. Nothing is saved until you review the check results and confirm.</p>
          <input type="file" accept=".xlsx" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </div>
        {mode === "local" ? (
          <div className="card card-body stack">
            <h3>Local demo data</h3>
            <p className="small muted">Clears this browser's demo business so you can load a fresh demo or start a new client setup.</p>
            <ConfirmButton onConfirm={resetLocalDemo}>Reset local demo</ConfirmButton>
          </div>
        ) : null}
      </div>
      {result ? (
        <Modal
          wide
          title={`Check results: ${result.file}`}
          onClose={() => setResult(null)}
          footer={
            <>
              <span className="grow small muted">{result.errors.length ? `${result.errors.length} row(s) with errors will be skipped.` : "No errors."}</span>
              <button className="btn" onClick={() => setResult(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={confirm}>Import {counts.reduce((a, [, n]) => a + Number(n), 0)} records</button>
            </>
          }
        >
          <div className="stack">
            <div className="grid cols-4">
              {counts.map(([label, n]) => <div key={label as string} className="card stat"><span className="label">{label}</span><span className="value">{n}</span></div>)}
            </div>
            {result.errors.length ? (
              <div className="callout bad">
                <strong>Errors</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.errors.slice(0, 50).map((e, i) => <li key={i}>{e.sheet} row {e.row}: {e.message}</li>)}</ul>
              </div>
            ) : null}
            {result.warnings.length ? (
              <div className="callout warn">
                <strong>Warnings</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{result.warnings.slice(0, 30).map((e, i) => <li key={i}>{e.sheet}{e.row ? ` row ${e.row}` : ""}: {e.message}</li>)}</ul>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ───────────────────────────── Print queue ─────────────────────────────

export function PrintQueuePage() {
  const store = useStore();
  const { settings } = useApp();
  const jobs = useCollection<PrintJob>(C.printJobs, { orderBy: ["createdAt", "desc"], limit: 60 });
  const printers = new Map((useCollection<Printer>(C.printers) ?? []).map((p) => [p.id, p.name]));
  const [open, setOpen] = useState<PrintJob | null>(null);
  return (
    <div className="page">
      <PageHead
        title="Print queue"
        subtitle="Bills and KOTs waiting for the Print Agent on the shop network. In demo mode nothing prints physically: preview a job, print it from the browser, or mark it printed."
        actions={<ConfirmButton className="btn" onConfirm={async () => { await store.batch((jobs ?? []).filter((j) => j.status !== "queued").map((j) => ({ op: "delete" as const, col: C.printJobs, id: j.id }))); }}>Clear finished</ConfirmButton>}
      />
      <div className="card table-wrap">
        {!jobs ? <Loading /> : jobs.length === 0 ? <Empty title="Nothing in the queue" /> : (
          <table className="table">
            <thead><tr><th>Time</th><th>Type</th><th>Printer</th><th>From</th><th>Status</th><th /></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>{dateTimeColombo(j.createdAt)}</td>
                  <td><span className="badge">{j.kind.toUpperCase()}</span></td>
                  <td>{printers.get(j.printerId) ?? j.printerId}</td>
                  <td className="mono">{j.workstationId}</td>
                  <td><span className={`badge ${j.status === "printed" ? "good" : j.status === "failed" ? "bad" : "warn"}`}>{j.status}</span>{j.error ? <div className="tiny muted">{j.error}</div> : null}</td>
                  <td className="right">
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <button className="btn sm" onClick={() => setOpen(j)}>Preview</button>
                      {j.status !== "printed" ? <button className="btn sm" onClick={() => store.merge(C.printJobs, j.id, { status: "printed" })}>Mark printed</button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open ? (
        <Modal title={`${open.kind.toUpperCase()} · ${printers.get(open.printerId) ?? ""}`} onClose={() => setOpen(null)} footer={<button className="btn" onClick={() => window.print()}>Print from this device</button>}>
          <ReceiptView doc={open.doc as ReceiptDoc} logo={settings.branding.logoDataUrl} />
        </Modal>
      ) : null}
    </div>
  );
}
