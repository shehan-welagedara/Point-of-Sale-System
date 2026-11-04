import { useState } from "react";
import { type MenuCategory, type MenuImage, type MenuItem, type PosSettings, type PosTheme, COLLECTIONS as C, DEFAULT_SIGN_IN } from "@pos/core";
import { Field, PageHead, Seg, Toggle } from "../../components/ui";
import { money } from "../../lib/format";
import { useApp, useCollection } from "../../state/app";
import { TEMPLATES, applyTemplate, gridColumns, resolveTheme, themeClass, themeStyle } from "../pos/theme";

const COLOR_LABEL: Record<keyof PosTheme["colors"], string> = {
  brand: "Brand / highlights",
  accent: "Accent",
  bg: "Background",
  surface: "Panels",
  text: "Text",
  muted: "Secondary text",
  line: "Lines",
  button: "Item buttons",
  buttonText: "Item button text",
  checkBg: "Check panel",
  danger: "Warnings",
};

/** A miniature, non-interactive POS rendered with the theme being edited. */
function Preview({ theme }: { theme: PosTheme }) {
  const { settings } = useApp();
  const cats = (useCollection<MenuCategory>(C.menuCategories) ?? []).filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 6);
  const items = (useCollection<MenuItem>(C.menuItems) ?? []).filter((m) => m.active && m.categoryId === cats[0]?.id).slice(0, 8);
  const images = useCollection<MenuImage>(theme.showImages ? C.menuImages : null) ?? [];
  const img = new Map(images.map((i) => [i.id, i.dataUrl]));
  const color = new Map(cats.map((c) => [c.id, c.color]));
  return (
    <div className="theme-preview" aria-label="Preview">
      <div className={themeClass(theme)} style={themeStyle(theme, settings.branding.primaryColor)}>
        <header className="pos-top">
          <div className="brand-logo">{settings.branding.displayName.slice(0, 1)}</div>
          <strong>{settings.branding.displayName}</strong>
          <span className="pos-rvc">Restaurant</span>
          <span className="grow" />
          <div className="seg"><button className="on">Order</button><button>Tables</button><button>Reports</button></div>
        </header>
        <div className="pos-body" style={{ gridTemplateColumns: theme.checkSide === "left" ? "220px minmax(0,1fr)" : "minmax(0,1fr) 220px" }}>
          <section className="pos-menu">
            <div className="pos-cats">
              {cats.map((c, i) => <button key={c.id} className={`pos-cat${i === 0 ? " on" : ""}`} style={i === 0 ? {} : { borderLeft: `4px solid ${c.color}` }}>{c.name}</button>)}
            </div>
            <div className="pos-grid" style={gridColumns(theme)}>
              {items.map((m) => {
                const pic = theme.showImages && m.hasImage ? img.get(m.id) : undefined;
                const meta = (
                  <>
                    <span className="name">{m.name}</span>
                    <span className="price">{money(m.price)}</span>
                  </>
                );
                return (
                  <div key={m.id} className={`pos-item${pic ? " has-img" : ""}`} style={{ ["--cat" as string]: m.buttonColor || color.get(m.categoryId) }}>
                    {pic ? (<><img src={pic} alt="" /><span className="meta">{meta}</span></>) : meta}
                  </div>
                );
              })}
            </div>
          </section>
          <aside className="pos-check">
            <div className="pos-check-head"><strong>Check #12 · Table 4</strong></div>
            <div className="pos-lines">
              {items.slice(0, 3).map((m, i) => (
                <div key={m.id} className={`pos-line${i === 0 ? " sel" : ""}`}><span className="qty">{i + 1}</span><div>{m.name}</div><span className="num">{money(m.price * (i + 1))}</span></div>
              ))}
            </div>
            <div className="pos-actions" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button className="btn">Send</button>
              <button className="btn primary">Pay</button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

export function PosThemesPage() {
  const { settings, saveSetting, toast } = useApp();
  const [theme, setTheme] = useState<PosTheme>(resolveTheme(settings.pos.theme));
  const tpl = TEMPLATES[theme.template];
  const set = (patch: Partial<PosTheme>) => setTheme({ ...theme, ...patch });
  return (
    <div className="page">
      <PageHead
        title="POS themes"
        subtitle="Pick a template, then change any colour, size or layout. Every workstation and tablet uses this look from the next screen refresh."
        actions={
          <>
            <button className="btn" onClick={() => setTheme(applyTemplate(theme.template))}>Reset to template</button>
            <button className="btn primary" onClick={async () => { await saveSetting("pos", { ...settings.pos, theme } as PosSettings); toast("POS theme saved"); }}>Save</button>
          </>
        }
      />
      <div className="grid cols-3">
        {Object.values(TEMPLATES).map((t) => (
          <button key={t.key} className="card card-body stack tight" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--text)", outline: theme.template === t.key ? "2px solid var(--brand)" : undefined }} onClick={() => setTheme(applyTemplate(t.key))}>
            <div className="row">
              {(["bg", "surface", "button", "brand", "accent"] as const).map((k) => <span key={k} style={{ width: 22, height: 22, borderRadius: 6, background: t.colors[k] || settings.branding.primaryColor, border: "1px solid var(--line)" }} />)}
              <span className="grow" />
              {theme.template === t.key ? <span className="badge brand">Selected</span> : null}
            </div>
            <strong>{t.name}</strong>
            <span className="small muted">{t.description}</span>
          </button>
        ))}
      </div>
      <Preview theme={theme} />
      <div className="grid cols-2">
        <div className="card card-body stack">
          <h3>Layout</h3>
          <Field label="Check panel"><Seg<PosTheme["checkSide"]> value={theme.checkSide} onChange={(v) => set({ checkSide: v })} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} /></Field>
          <Field label="Categories"><Seg<PosTheme["categoryStyle"]> value={theme.categoryStyle} onChange={(v) => set({ categoryStyle: v })} options={[{ value: "tabs", label: "Top tabs" }, { value: "rail", label: "Side rail" }]} /></Field>
          <Field label="Item button size"><Seg<PosTheme["buttonSize"]> value={theme.buttonSize} onChange={(v) => set({ buttonSize: v })} options={[{ value: "compact", label: "Compact" }, { value: "regular", label: "Regular" }, { value: "large", label: "Large" }]} /></Field>
          <Field label="Columns of items">
            <select className="select" value={theme.columns} onChange={(e) => set({ columns: Number(e.target.value) })}>
              <option value={0}>Automatic (fit the screen)</option>
              {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label={`Text size ${Math.round(theme.fontScale * 100)}%`}><input type="range" min={0.85} max={1.4} step={0.05} value={theme.fontScale} onChange={(e) => set({ fontScale: Number(e.target.value) })} /></Field>
          <Field label={`Corner rounding ${theme.radius}px`}><input type="range" min={0} max={24} step={1} value={theme.radius} onChange={(e) => set({ radius: Number(e.target.value) })} /></Field>
          <div className="row between"><span>Show item photos</span><Toggle on={theme.showImages} onChange={(v) => set({ showImages: v })} label="Show item photos" /></div>
          <div className="row between"><span>Tint item buttons with their category colour</span><Toggle on={theme.colorByCategory} onChange={(v) => set({ colorByCategory: v })} label="Category colours" /></div>
          <p className="tiny muted">Photos are added per item under Menu Management → Menu items.</p>
        </div>
        <div className="card card-body stack">
          <h3>Colours</h3>
          {(Object.keys(COLOR_LABEL) as (keyof PosTheme["colors"])[]).map((k) => {
            const value = theme.colors[k] || tpl.colors[k] || settings.branding.primaryColor;
            return (
              <div key={k} className="row between">
                <span className="small">{COLOR_LABEL[k]}</span>
                <div className="row">
                  {theme.colors[k] ? <button className="btn ghost sm" onClick={() => { const { [k]: _x, ...rest } = theme.colors; set({ colors: rest }); }}>Reset</button> : <span className="tiny muted">template</span>}
                  <input type="color" value={value.startsWith("#") && value.length === 7 ? value : "#000000"} onChange={(e) => set({ colors: { ...theme.colors, [k]: e.target.value } })} aria-label={COLOR_LABEL[k]} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Sign-in and session security for every workstation (People & Security). */
export function SignInPolicyPage() {
  const { settings, saveSetting, toast } = useApp();
  const [p, setP] = useState<PosSettings>({ ...settings.pos });
  return (
    <div className="page">
      <PageHead title="Sign-in policy" subtitle="How employees sign in to the POS and how sessions are protected." actions={<button className="btn primary" onClick={async () => { await saveSetting("pos", p); toast("Sign-in policy saved"); }}>Save</button>} />
      <div className="grid cols-2">
        <div className="card card-body stack">
          <Field label="Sign-in method" help="Employee number + PIN suits most venues; card swipe also authorises manager overrides. 'Tap your name' shows everyone's name on the screen and is best only for small teams.">
            <Seg<NonNullable<PosSettings["signInMode"]>> value={p.signInMode ?? DEFAULT_SIGN_IN.mode} onChange={(v) => setP({ ...p, signInMode: v })} options={[{ value: "idPin", label: "Employee no. + PIN" }, { value: "card", label: "Card swipe + PIN" }, { value: "tapName", label: "Tap name + PIN" }]} />
          </Field>
          <Field label="Wrong PINs before lockout"><input className="input num" type="number" min={3} max={10} value={p.maxFailedSignIns ?? DEFAULT_SIGN_IN.maxFailedSignIns} onChange={(e) => setP({ ...p, maxFailedSignIns: Number(e.target.value) })} /></Field>
          <Field label="Sign out after inactivity (seconds, 0 = never)" help="Each workstation can override this (shared bar terminals: shorter)."><input className="input num" type="number" min={0} max={3600} value={p.autoSignOutSeconds ?? DEFAULT_SIGN_IN.autoSignOutSeconds} onChange={(e) => setP({ ...p, autoSignOutSeconds: Number(e.target.value) })} /></Field>
          <Field label="Minimum PIN length"><input className="input num" type="number" min={4} max={8} value={p.pinMinLength ?? DEFAULT_SIGN_IN.pinMinLength} onChange={(e) => setP({ ...p, pinMinLength: Number(e.target.value) })} /></Field>
          <div className="row between"><span>Employees must clock in before working</span><Toggle on={Boolean(p.requireClockIn)} onChange={(v) => setP({ ...p, requireClockIn: v })} label="Require clock in" /></div>
        </div>
        <div className="card card-body stack small">
          <h3>What is enforced</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }} className="stack tight">
            <li>Only active employees within their employment dates, set up for the property and revenue centre, can sign in.</li>
            <li>PINs are stored as salted hashes; easy PINs (1111, 1234) are refused when set.</li>
            <li>Wrong PINs are counted and logged; at the limit the employee is locked until a manager unlocks them on the POS.</li>
            <li>Every sign-in, sign-out, failed attempt, lockout and unlock is written to the tamper-evident POS journal.</li>
            <li>Privileges come from the employee's role at that property; actions beyond a role's privileges or limits need a more senior employee's card or PIN.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
