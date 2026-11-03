import { useState } from "react";
import {
  type CheckModifier,
  type Customer,
  type Discount,
  type MenuItem,
  type ModifierGroup,
  type PrivilegeKey,
  type ReasonCode,
  type Role,
  type Staff,
  COLLECTIONS as C,
  PRIVILEGES,
  hasPrivilege,
  newId,
  verifyPin,
} from "@pos/core";
import { Field, Modal } from "../../components/ui";
import { money, pct } from "../../lib/format";
import { useApp, useStore } from "../../state/app";

export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="keypad">
      {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map((k) => (
        <button key={k} type="button" onClick={() => onKey(k)}>
          {k}
        </button>
      ))}
    </div>
  );
}

export function PinEntry({ onSubmit, length = 4, error }: { onSubmit: (pin: string) => void; length?: number; error?: string }) {
  const [pin, setPin] = useState("");
  const press = (k: string) => {
    if (k === "C") return setPin("");
    if (k === "⌫") return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 8);
    setPin(next);
    if (next.length === length) {
      onSubmit(next);
      setTimeout(() => setPin(""), 150);
    }
  };
  return (
    <div className="stack" style={{ alignItems: "center" }}>
      <div className="pin-dots">
        {Array.from({ length }, (_, i) => <span key={i} className={i < pin.length ? "on" : ""} />)}
      </div>
      {error ? <span className="badge bad">{error}</span> : <span className="tiny muted">&nbsp;</span>}
      <div style={{ width: 280 }}>
        <Keypad onKey={press} />
      </div>
    </div>
  );
}

/** Modifier choice with min/max rules and allergen notice. */
export function ModifierDialog({ item, groups, onAdd, onClose }: { item: MenuItem; groups: ModifierGroup[]; onAdd: (mods: CheckModifier[], qty: number, note: string) => void; onClose: () => void }) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const missing = groups.filter((g) => (chosen[g.id]?.length ?? 0) < g.min);
  const extra = groups.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id))).reduce((a, o) => a + o.price, 0);
  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <div className="row grow">
            <button className="btn icon-btn" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less">−</button>
            <strong className="num" style={{ minWidth: 24, textAlign: "center" }}>{qty}</strong>
            <button className="btn icon-btn" onClick={() => setQty(qty + 1)} aria-label="More">+</button>
          </div>
          <button
            className="btn primary lg"
            disabled={missing.length > 0}
            onClick={() =>
              onAdd(
                groups.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id)).map((o) => ({ groupId: g.id, optionId: o.id, name: o.name, price: o.price }))),
                qty,
                note.trim(),
              )
            }
          >
            Add · {money((item.price + extra) * qty)}
          </button>
        </>
      }
    >
      <div className="stack">
        {item.allergens.length ? <div className="callout warn">Contains: <strong>{item.allergens.join(", ")}</strong></div> : null}
        {groups.map((g) => (
          <div key={g.id} className="stack tight">
            <div className="row between">
              <h3>{g.name}</h3>
              <span className={`badge ${g.min > 0 ? ((chosen[g.id]?.length ?? 0) >= g.min ? "good" : "warn") : ""}`}>{g.min > 0 ? "Required" : "Optional"}{g.max > 1 ? ` · up to ${g.max}` : ""}</span>
            </div>
            <div className="chips">
              {g.options.map((o) => {
                const on = chosen[g.id]?.includes(o.id) ?? false;
                return (
                  <button
                    key={o.id}
                    className={`chip${on ? " on" : ""}`}
                    style={{ padding: "10px 14px", fontSize: 14 }}
                    onClick={() => {
                      const cur = chosen[g.id] ?? [];
                      const next = on ? cur.filter((x) => x !== o.id) : g.max === 1 ? [o.id] : cur.length < g.max ? [...cur, o.id] : cur;
                      setChosen({ ...chosen, [g.id]: next });
                    }}
                  >
                    {o.name}{o.price ? ` +${money(o.price)}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Field label="Kitchen note">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no onions, serve with main" />
        </Field>
      </div>
    </Modal>
  );
}

/** Asks for the PIN of someone holding a privilege (manager override). */
export function ManagerAuth({ privilege, staff, roles, onApproved, onClose }: { privilege: PrivilegeKey; staff: Staff[]; roles: Role[]; onApproved: (by: Staff) => void; onClose: () => void }) {
  const [err, setErr] = useState("");
  const eligible = staff.filter((s) => s.status === "active" && hasPrivilege(roles.find((r) => r.id === s.roleId), privilege));
  return (
    <Modal title="Manager approval" onClose={onClose}>
      <div className="stack" style={{ alignItems: "center" }}>
        <p className="muted" style={{ textAlign: "center" }}>“{PRIVILEGES[privilege]}” needs approval. A manager enters their PIN.</p>
        <PinEntry
          error={err}
          onSubmit={async (pin) => {
            for (const s of eligible) {
              if (await verifyPin(pin, s.pinHash, s.pinSalt)) return onApproved(s);
            }
            setErr("Not authorised");
          }}
        />
      </div>
    </Modal>
  );
}

export function ReasonDialog({ title, reasons, onPick, onClose }: { title: string; reasons: ReasonCode[]; onPick: (r: ReasonCode) => void; onClose: () => void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack tight">
        {reasons.map((r) => (
          <button key={r.id} className="btn lg block" style={{ justifyContent: "flex-start" }} onClick={() => onPick(r)}>
            {r.name}
          </button>
        ))}
        {reasons.length === 0 ? <p className="muted">No reason codes set up (Point of Sale → Reason codes).</p> : null}
      </div>
    </Modal>
  );
}

export function DiscountDialog({ discounts, scope, onPick, onClose }: { discounts: Discount[]; scope: "item" | "check"; onPick: (d: Discount) => void; onClose: () => void }) {
  const list = discounts.filter((d) => d.active && d.scope === scope);
  return (
    <Modal title={scope === "item" ? "Discount this item" : "Discount the check"} onClose={onClose}>
      <div className="grid cols-2">
        {list.map((d) => (
          <button key={d.id} className="tender-btn" onClick={() => onPick(d)}>
            <span>{d.name}</span>
            <span className="small muted">{d.type === "percent" ? pct(d.value, 0) : money(d.value)}{d.requiresManager ? " · manager" : ""}</span>
          </button>
        ))}
        {list.length === 0 ? <p className="muted">No {scope} discounts set up.</p> : null}
      </div>
    </Modal>
  );
}

export function CustomerDialog({ customers, current, allergies, onPick, onAllergies, onBuyer, buyer, onClose }: {
  customers: Customer[];
  current?: string;
  allergies: string[];
  buyer?: { name: string; tin: string; address: string };
  onPick: (c: Customer | null) => void;
  onAllergies: (a: string[]) => void;
  onBuyer: (b: { name: string; tin: string; address: string } | undefined) => void;
  onClose: () => void;
}) {
  const store = useStore();
  const { on, toast } = useApp();
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [allergyText, setAllergyText] = useState(allergies.join(", "));
  const [b, setB] = useState(buyer ?? { name: "", tin: "", address: "" });
  const needle = q.replace(/\s/g, "").toLowerCase();
  const matches = needle.length >= 2 ? customers.filter((c) => `${c.phone.replace(/\s/g, "")} ${c.name.toLowerCase()}`.includes(needle)).slice(0, 8) : [];
  return (
    <Modal title="Guest" onClose={onClose} footer={<button className="btn primary" onClick={() => { onAllergies(allergyText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)); onBuyer(b.tin ? b : undefined); onClose(); }}>Done</button>}>
      <div className="stack">
        {on("crm") ? (
          <>
            <Field label="Find customer (mobile or name)">
              <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="077…" />
            </Field>
            <div className="stack tight">
              {matches.map((c) => (
                <button key={c.id} className={`btn block${c.id === current ? " primary" : ""}`} style={{ justifyContent: "space-between" }} onClick={() => { onPick(c); if (c.vatTin) setB({ name: c.name, tin: c.vatTin, address: c.address ?? "" }); }}>
                  <span>{c.name}</span>
                  <span className="small">{c.phone} · {c.visits} visits{on("loyalty") ? ` · ${c.points} pts` : ""}</span>
                </button>
              ))}
              {needle.length >= 2 && matches.length === 0 ? (
                <div className="row">
                  <input className="input" placeholder="Name for new customer" value={name} onChange={(e) => setName(e.target.value)} />
                  <button className="btn" disabled={!name.trim()} onClick={async () => {
                    const c: Customer = { id: newId(), name: name.trim(), phone: q.trim(), tags: [], marketingConsent: false, visits: 0, totalSpend: 0, points: 0, createdAt: new Date().toISOString() };
                    await store.set(C.customers, c);
                    onPick(c);
                    toast("Customer added");
                  }}>Add</button>
                </div>
              ) : null}
              {current ? <button className="btn sm ghost" onClick={() => onPick(null)}>Remove customer from check</button> : null}
            </div>
          </>
        ) : null}
        <Field label="Guest allergies" help="Items containing these trigger a warning before they are added (e.g. egg, milk, crustaceans).">
          <input className="input" value={allergyText} onChange={(e) => setAllergyText(e.target.value)} />
        </Field>
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>VAT-registered business buyer (printed on the tax invoice)</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            <Field label="Buyer name"><input className="input" value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} /></Field>
            <Field label="Buyer TIN"><input className="input mono" value={b.tin} onChange={(e) => setB({ ...b, tin: e.target.value.replace(/\D/g, "").slice(0, 9) })} /></Field>
            <Field label="Buyer address"><input className="input" value={b.address} onChange={(e) => setB({ ...b, address: e.target.value })} /></Field>
          </div>
        </details>
      </div>
    </Modal>
  );
}
