import { type ReactNode, useMemo, useState } from "react";
import { codeToId, newId } from "@pos/core";
import { useApp, useCollection, useStore } from "../state/app";
import { ConfirmButton, Drawer, Empty, Field, Loading, PageHead, Toggle } from "./ui";

type AnyDoc = { id: string } & Record<string, any>;

export interface Option {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "money" | "percent" | "select" | "multi" | "bool" | "color" | "tags" | "lines" | "date";
  help?: ReactNode;
  required?: boolean;
  options?: Option[];
  optionsFrom?: { col: string; label?: (d: AnyDoc) => string; filter?: (d: AnyDoc) => boolean };
  /** Sub-fields for `lines` (an editable list of rows). */
  fields?: FieldDef[];
  newRow?: () => Record<string, unknown>;
  readOnlyOnEdit?: boolean;
  show?: (doc: AnyDoc) => boolean;
  placeholder?: string;
  step?: number;
}

export interface ColumnDef {
  header: string;
  render: (d: AnyDoc) => ReactNode;
  num?: boolean;
}

function useOptions(def: FieldDef): Option[] {
  const docs = useCollection<AnyDoc>(def.optionsFrom?.col ?? null);
  if (def.options) return def.options;
  if (!def.optionsFrom || !docs) return [];
  return docs
    .filter((d) => (def.optionsFrom!.filter ? def.optionsFrom!.filter(d) : true))
    .map((d) => ({ value: d.id, label: def.optionsFrom!.label ? def.optionsFrom!.label(d) : String(d.name ?? d.id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function FieldInput({ def, value, onChange, disabled }: { def: FieldDef; value: any; onChange: (v: any) => void; disabled?: boolean }) {
  const options = useOptions(def);
  switch (def.type) {
    case "textarea":
      return <textarea className="textarea" value={value ?? ""} disabled={disabled} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
    case "number":
      return <input className="input num" type="number" step={def.step ?? "any"} value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
    case "money":
      return (
        <div className="row">
          <span className="muted small">Rs</span>
          <input className="input num" type="number" step="0.01" min="0" value={value === undefined ? "" : (value / 100).toString()} disabled={disabled} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))} />
        </div>
      );
    case "percent":
      return (
        <div className="row">
          <input className="input num" type="number" step="0.01" min="0" max="100" value={value === undefined ? "" : (value / 100).toString()} disabled={disabled} onChange={(e) => onChange(Math.round(Number(e.target.value || 0) * 100))} />
          <span className="muted small">%</span>
        </div>
      );
    case "select":
      return (
        <select className="select" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    case "multi": {
      const set = new Set<string>(value ?? []);
      return (
        <div className="chips">
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              disabled={disabled}
              className={`chip${set.has(o.value) ? " on" : ""}`}
              onClick={() => {
                const next = new Set(set);
                if (next.has(o.value)) next.delete(o.value);
                else next.add(o.value);
                onChange(options.map((x) => x.value).filter((v) => next.has(v)));
              }}
            >
              {o.label}
            </button>
          ))}
          {options.length === 0 ? <span className="muted small">Nothing to choose yet</span> : null}
        </div>
      );
    }
    case "bool":
      return <Toggle on={Boolean(value)} onChange={onChange} label={def.label} disabled={disabled} />;
    case "color":
      return (
        <div className="row">
          <input type="color" value={value || "#64748b"} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: 48, height: 40, border: 0, background: "none" }} />
          <input className="input mono" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "tags":
      return <input className="input" value={(value ?? []).join(", ")} disabled={disabled} placeholder={def.placeholder ?? "comma, separated"} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} />;
    case "date":
      return <input className="input" type="date" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case "lines":
      return <LinesEditor def={def} value={value ?? []} onChange={onChange} disabled={disabled} />;
    default:
      return <input className="input" value={value ?? ""} disabled={disabled} placeholder={def.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
}

function LinesEditor({ def, value, onChange, disabled }: { def: FieldDef; value: Record<string, any>[]; onChange: (v: any) => void; disabled?: boolean }) {
  const fields = def.fields ?? [];
  return (
    <div className="stack tight">
      {value.length ? (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                {fields.map((f) => (
                  <th key={f.key}>{f.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {value.map((row, i) => (
                <tr key={i}>
                  {fields.map((f) => (
                    <td key={f.key} style={{ minWidth: f.type === "select" ? 180 : 90 }}>
                      <FieldInput def={f} value={row[f.key]} disabled={disabled} onChange={(v) => onChange(value.map((r, j) => (j === i ? { ...r, [f.key]: v } : r)))} />
                    </td>
                  ))}
                  <td>
                    <button type="button" className="btn ghost sm" disabled={disabled} onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove row">
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div>
        <button type="button" className="btn sm" disabled={disabled} onClick={() => onChange([...value, def.newRow ? def.newRow() : {}])}>
          + Add line
        </button>
      </div>
    </div>
  );
}

export function RecordForm({ fields, doc, setDoc, isNew }: { fields: FieldDef[]; doc: AnyDoc; setDoc: (d: AnyDoc) => void; isNew: boolean }) {
  return (
    <div className="stack">
      {fields
        .filter((f) => (f.show ? f.show(doc) : true))
        .map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} help={f.help}>
            <FieldInput def={f} value={doc[f.key]} disabled={!isNew && f.readOnlyOnEdit} onChange={(v) => setDoc({ ...doc, [f.key]: v })} />
          </Field>
        ))}
    </div>
  );
}

export interface CrudProps {
  title: string;
  subtitle?: ReactNode;
  col: string;
  fields: FieldDef[];
  columns: ColumnDef[];
  /** `code`: the id is the normalised `code` field; `auto`: a generated id. */
  idFrom: "code" | "auto";
  /** Field holding the code when `idFrom` is "code" (default `code`). */
  codeKey?: string;
  newDoc: () => Record<string, unknown>;
  search?: (d: AnyDoc) => string;
  sort?: (a: AnyDoc, b: AnyDoc) => number;
  rowActions?: (d: AnyDoc) => ReactNode;
  headerActions?: ReactNode;
  canDelete?: (d: AnyDoc) => boolean;
  canEdit?: (d: AnyDoc) => boolean;
  validate?: (d: AnyDoc) => string | null;
  beforeSave?: (d: AnyDoc, isNew: boolean) => AnyDoc | Promise<AnyDoc>;
  filter?: (d: AnyDoc) => boolean;
  extraEditor?: (d: AnyDoc, setDoc: (d: AnyDoc) => void) => ReactNode;
  noun?: string;
}

export function CrudPage(p: CrudProps) {
  const { toast } = useApp();
  const store = useStore();
  const docs = useCollection<AnyDoc>(p.col);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<{ doc: AnyDoc; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const noun = p.noun ?? "record";

  const rows = useMemo(() => {
    let list = (docs ?? []).filter((d) => (p.filter ? p.filter(d) : true));
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((d) => (p.search ? p.search(d) : `${d.id} ${d.name ?? ""} ${d.code ?? ""}`).toLowerCase().includes(needle));
    }
    return list.sort(p.sort ?? ((a, b) => String(a.code ?? a.name ?? a.id).localeCompare(String(b.code ?? b.name ?? b.id))));
  }, [docs, q, p]);

  async function save() {
    if (!editing) return;
    let d = { ...editing.doc };
    for (const f of p.fields) {
      if (f.required && (d[f.key] === undefined || d[f.key] === "" || (Array.isArray(d[f.key]) && d[f.key].length === 0)) && (!f.show || f.show(d))) {
        toast(`${f.label} is required`, true);
        return;
      }
    }
    const problem = p.validate?.(d);
    if (problem) {
      toast(problem, true);
      return;
    }
    if (editing.isNew) {
      const codeKey = p.codeKey ?? "code";
      try {
        d.id = p.idFrom === "code" ? codeToId(String(d[codeKey] ?? "")) : newId();
      } catch {
        toast("Enter a valid code (letters and digits)", true);
        return;
      }
      if (p.idFrom === "code") d[codeKey] = d.id;
      if ((docs ?? []).some((x) => x.id === d.id)) {
        toast(`Code ${d.id} is already used`, true);
        return;
      }
    }
    setSaving(true);
    try {
      if (p.beforeSave) d = await p.beforeSave(d, editing.isNew);
      await store.set(p.col, d);
      toast(`${editing.isNew ? "Added" : "Saved"} ${d.name ?? d.code ?? noun}`);
      setEditing(null);
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`, true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page fill">
      <PageHead
        title={p.title}
        subtitle={p.subtitle}
        actions={
          <>
            {p.headerActions}
            <button className="btn primary" onClick={() => setEditing({ doc: { id: "", ...p.newDoc() }, isNew: true })}>
              + New {noun}
            </button>
          </>
        }
      />
      <div className="card fill-card">
        <div className="card-head">
          <input className="input" style={{ maxWidth: 320 }} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">{docs ? `${rows.length} of ${docs.filter((d) => (p.filter ? p.filter(d) : true)).length}` : ""}</span>
        </div>
        {!docs ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title={q ? "No matches" : `No ${noun}s yet`}>
            {!q ? <p>Add one with “New {noun}”, or import from Excel under Data.</p> : null}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table cards-sm">
              <thead>
                <tr>
                  {p.columns.map((c) => (
                    <th key={c.header} className={c.num ? "num" : ""}>
                      {c.header}
                    </th>
                  ))}
                  {p.rowActions ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className={p.canEdit && !p.canEdit(d) ? "" : "clickable"} onClick={() => (p.canEdit && !p.canEdit(d) ? undefined : setEditing({ doc: d, isNew: false }))}>
                    {p.columns.map((c) => (
                      <td key={c.header} className={c.num ? "num" : ""} data-label={c.header}>
                        {c.render(d)}
                      </td>
                    ))}
                    {p.rowActions ? (
                      <td className="right" onClick={(e) => e.stopPropagation()}>
                        {p.rowActions(d)}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {editing ? (
        <Drawer
          title={editing.isNew ? `New ${noun}` : String(editing.doc.name ?? editing.doc.code ?? editing.doc.id)}
          onClose={() => setEditing(null)}
          footer={
            <>
              {!editing.isNew && (p.canDelete ? p.canDelete(editing.doc) : true) ? (
                <ConfirmButton
                  onConfirm={async () => {
                    await store.remove(p.col, editing.doc.id);
                    toast("Deleted");
                    setEditing(null);
                  }}
                >
                  Delete
                </ConfirmButton>
              ) : null}
              <span className="grow" />
              <button className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <RecordForm fields={p.fields} doc={editing.doc} setDoc={(d) => setEditing({ ...editing, doc: d })} isNew={editing.isNew} />
          {p.extraEditor ? <div style={{ marginTop: 18 }}>{p.extraEditor(editing.doc, (d) => setEditing({ ...editing, doc: d }))}</div> : null}
        </Drawer>
      ) : null}
    </div>
  );
}
