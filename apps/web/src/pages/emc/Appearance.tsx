import { useState } from "react";
import { type MenuCategory, type MenuImage, type MenuItem, type MobileStyle, type MobileUi, type PosSettings, type PosTheme, COLLECTIONS as C, DEFAULT_SIGN_IN } from "@pos/core";
import { resizeImage } from "../../lib/images";
import { useDraft } from "../../lib/useDraft";
import { Icon } from "../pos/mobile/icons";
import { StatTile } from "../pos/mobile/MobileReports";
import { DEFAULT_MOBILE_UI, MOBILE_STYLES, greeting, mobileVars } from "../pos/mobile/ui";
import "../pos/mobile/mobile.css";
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
  const [theme, setTheme, savedTheme] = useDraft<PosTheme>(resolveTheme(settings.pos.theme));
  const tpl = TEMPLATES[theme.template];
  const set = (patch: Partial<PosTheme>) => setTheme({ ...theme, ...patch });
  return (
    <div className="page fill">
      <PageHead
        title="Terminal themes"
        subtitle="The till layout used on counter terminals, PCs and large tablets. Pick a template, then change any colour, size or layout. Phones use the mobile app style (POS Configuration → Mobile app style)."
        actions={
          <>
            <button className="btn" onClick={() => setTheme(applyTemplate(theme.template))}>Reset to template</button>
            <button className="btn primary" onClick={async () => { await saveSetting("pos", { ...settings.pos, theme } as PosSettings); savedTheme(); toast("POS theme saved"); }}>Save</button>
          </>
        }
      />
      <div className="appearance-grid">
      <div className="stack appearance-col">
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
      </div>
      <div className="stack appearance-col">
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
    </div>
  );
}

/** Sign-in and session security for every workstation (People & Security). */
export function SignInPolicyPage() {
  const { settings, saveSetting, toast } = useApp();
  const [p, setP, savedPolicy] = useDraft<PosSettings>({ ...settings.pos });
  return (
    <div className="page">
      <PageHead title="Sign-in policy" subtitle="How employees sign in to the POS and how sessions are protected." actions={<button className="btn primary" onClick={async () => { await saveSetting("pos", p); savedPolicy(); toast("Sign-in policy saved"); }}>Save</button>} />
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

// ───────────────────────────── Mobile app style ─────────────────────────────

type PreviewScreen = "signin" | "home" | "menu" | "cart";

/** A static phone mock-up drawn with the real app styles. */
function PhonePreview({ style, screen, accent }: { style: MobileStyle; screen: PreviewScreen; accent?: string }) {
  const { settings } = useApp();
  const cats = (useCollection<MenuCategory>(C.menuCategories) ?? []).filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const items = (useCollection<MenuItem>(C.menuItems) ?? []).filter((m) => m.active && m.categoryId === cats[0]?.id).slice(0, 4);
  const images = useCollection<MenuImage>(C.menuImages) ?? [];
  const img = new Map(images.map((i) => [i.id, i.dataUrl]));
  const color = new Map(cats.map((c) => [c.id, c.color]));
  const b = settings.branding;
  const vars = mobileVars({ ...DEFAULT_MOBILE_UI, ...(accent ? { accent } : {}) });
  const thumb = (m: MenuItem) => (m.hasImage && img.get(m.id) ? <img className="m-thumb fill" src={img.get(m.id)} alt="" /> : <span className="m-thumb ph fill" style={{ ["--c" as string]: m.buttonColor || color.get(m.categoryId) || "#94a3b8" }}>{m.name.slice(0, 2).toUpperCase()}</span>);
  return (
    <div className="phone-frame" aria-label={`${MOBILE_STYLES[style].name} preview`}>
      {screen === "signin" ? (
        <div className={`mauth ${style} mpos-preview`} style={vars}>
          <div className={`mauth-hero${b.heroImageDataUrl ? "" : " plain"}`} style={b.heroImageDataUrl ? { backgroundImage: `url(${b.heroImageDataUrl})` } : undefined}>
            <div className="mauth-logo">{b.logoDataUrl ? <img src={b.logoDataUrl} alt="" /> : b.displayName.slice(0, 1)}</div>
            <h1>{b.displayName}</h1>
          </div>
          <div className="mauth-card">
            <h2>Welcome back</h2>
            <div className="m-input" />
            <div className="m-input" />
            <div className="m-btn cta block">Sign In</div>
          </div>
        </div>
      ) : (
        <div className={`mpos ${style} mpos-preview`} style={vars}>
          <div className="m-main">
            {screen === "home" ? (
              <div className="m-screen">
                <div className="m-hello"><span className="m-avatar">KP</span><div className="grow"><span className="m-muted small">{greeting()},</span><h1>Kasun!</h1></div></div>
                {style === "indigo" ? <div className="m-gradient-card"><span>Today's sales</span><strong>Rs 125,400</strong><span className="m-delta light">+12.5% vs yesterday</span></div> : null}
                <div className="m-stats">
                  {style === "bright" ? <StatTile icon="cash" tone="#1a73e8" label="Today's sales" value="Rs 125,400" delta={{ text: "+12.5%", up: true }} /> : null}
                  <StatTile icon="orders" tone="#16a34a" label="Orders" value="48" />
                  <StatTile icon="users" tone="#ea580c" label="Guests" value="112" />
                  {style === "indigo" ? <StatTile icon="trend" tone="#9333ea" label="Avg order" value="Rs 2,612" /> : null}
                </div>
                <div className="m-quick">{(["New", "Tables", "Orders", "Reports"] as const).map((l, i) => <div key={l} className="m-quick-btn"><span className="m-quick-ico" style={{ ["--tone" as string]: ["#1a73e8", "#16a34a", "#ea580c", "#9333ea"][i] }}><Icon name={(["plus", "tables", "orders", "reports"] as const)[i]!} /></span><span>{l}</span></div>)}</div>
              </div>
            ) : screen === "menu" ? (
              <div className="m-screen">
                <div className="m-chips"><span className="m-chip on">All</span>{cats.slice(0, 3).map((c) => <span key={c.id} className="m-chip">{c.name}</span>)}</div>
                <div className="m-products">
                  {items.map((m) => (
                    <div key={m.id} className="m-product">
                      <div className="m-product-tap">{thumb(m)}</div>
                      <div className="m-product-meta"><span className="m-product-name">{m.name}</span><div className="row between"><strong className="m-price">{money(m.price)}</strong><span className="m-add"><Icon name="plus" size={16} /></span></div></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="m-screen">
                <div className="m-card m-list">
                  {items.slice(0, 3).map((m, i) => (
                    <div key={m.id} className="m-line">
                      <span className="m-line-main"><span style={{ width: 44, height: 44, display: "block", borderRadius: 12, overflow: "hidden", flex: "none" }}>{thumb(m)}</span><span className="m-line-text"><strong>{m.name}</strong><span className="m-line-price">{money(m.price * (i + 1))}</span></span></span>
                      <span className="m-stepper"><span className="m-step"><Icon name="minus" size={14} /></span><span className="num">{i + 1}</span><span className="m-step on"><Icon name="plus" size={14} /></span></span>
                    </div>
                  ))}
                </div>
                <div className="m-card m-totals"><div className="row between m-grand"><span>Total</span><strong>Rs 7,850.00</strong></div></div>
                <div className="m-btn cta block">Proceed to Payment</div>
              </div>
            )}
          </div>
          <nav className="m-nav">
            {(["home", "tables", "menu", "orders", "more"] as const).map((n, i) => <span key={n} className={`m-nav-btn${(screen === "home" && i === 0) || (screen !== "home" && i === 2) ? " on" : ""}`}><span className="m-nav-ico"><Icon name={n} /></span><span>{n[0]!.toUpperCase() + n.slice(1)}</span></span>)}
          </nav>
        </div>
      )}
    </div>
  );
}

/** POS Configuration → Mobile app style: the phone/tablet look, where it is used, and the sign-in picture. */
export function MobileStylePage() {
  const { settings, saveSetting, toast } = useApp();
  const [m, setM, savedMobile] = useDraft<MobileUi>({ ...DEFAULT_MOBILE_UI, ...settings.pos.mobile });
  const [screen, setScreen] = useState<PreviewScreen>("home");
  const [busy, setBusy] = useState(false);
  const shownStyle: MobileStyle = m.style === "terminal" ? "bright" : m.style;
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await resizeImage(file, 960, 0.72);
      await saveSetting("branding", { ...settings.branding, heroImageDataUrl: r.dataUrl });
      toast(`Sign-in picture saved (${Math.round(r.bytes / 1024)} KB)`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page fill">
      <PageHead
        title="Mobile app style"
        subtitle="How the POS looks on phones and tablets. Pick a style; staff see it from their next sign-in. Each workstation can also choose its own (Workstations & printers → Screen style)."
        actions={<button className="btn primary" onClick={async () => { const { accent, ...rest } = m; await saveSetting("pos", { ...settings.pos, mobile: { ...rest, ...(accent ? { accent } : {}) } }); savedMobile(); toast("Mobile app style saved"); }}>Save</button>}
      />
      <div className="appearance-grid">
        <div className="stack appearance-col">
          <div className="grid cols-3 style-cards">
            {(["bright", "indigo", "terminal"] as const).map((k) => {
              const info = k === "terminal" ? { name: "Terminal", description: "The till layout on every screen: menu grid and check side by side. For counter terminals and large tablets.", swatch: ["#f8fafc", "#0f766e", "#e2e8f0", "#c2410c"] } : MOBILE_STYLES[k];
              return (
                <button key={k} className="card card-body stack tight" style={{ textAlign: "left", cursor: "pointer", font: "inherit", color: "var(--text)", outline: m.style === k ? "2px solid var(--brand)" : undefined }} onClick={() => setM({ ...m, style: k })} aria-pressed={m.style === k}>
                  <div className="row">
                    {info.swatch.map((c) => <span key={c} style={{ width: 22, height: 22, borderRadius: 6, background: c, border: "1px solid var(--line)" }} />)}
                    <span className="grow" />
                    {m.style === k ? <span className="badge brand">Selected</span> : null}
                  </div>
                  <strong>{info.name}</strong>
                  <span className="small muted">{info.description}</span>
                </button>
              );
            })}
          </div>
          <div className="card card-body stack">
            <h3>Where to use it</h3>
            <Seg<MobileUi["useOn"]> value={m.useOn} onChange={(v) => setM({ ...m, useOn: v })} options={[{ value: "phones", label: "Phones" }, { value: "phonesTablets", label: "Phones and tablets" }, { value: "all", label: "Every screen" }]} />
            <p className="small muted">Phones are screens narrower than 600 px (any phone, portrait or landscape). Tablets are touch screens up to 1,100 px on the short side. Other screens keep the terminal layout and its theme (Terminal themes).</p>
            <div className="row between"><span>Show today's sales on the home screen</span><Toggle on={m.showSalesOnHome} onChange={(v) => setM({ ...m, showSalesOnHome: v })} label="Show sales on home" /></div>
            <p className="tiny muted">Only employees whose role includes reports see the figures; others see their own sales or none.</p>
            <div className="row between">
              <span>Accent colour</span>
              <div className="row">
                {m.accent ? <button className="btn ghost sm" onClick={() => { const { accent: _a, ...rest } = m; setM(rest); }}>Style default</button> : <span className="tiny muted">style default</span>}
                <input type="color" value={m.accent ?? (shownStyle === "bright" ? "#1a73e8" : "#4f46e5")} onChange={(e) => setM({ ...m, accent: e.target.value })} aria-label="Accent colour" />
              </div>
            </div>
          </div>
          <div className="card card-body stack">
            <h3>Sign-in picture</h3>
            <p className="small muted">Shown at the top of the phone sign-in screen: your restaurant, a signature dish or the view. Landscape photos work best; they are resized to about 100 KB.</p>
            {settings.branding.heroImageDataUrl ? <img src={settings.branding.heroImageDataUrl} alt="Sign-in" style={{ width: "100%", maxHeight: 180, objectFit: "cover", borderRadius: 12 }} /> : <div className="empty small">No picture: the sign-in screen uses the style's colours.</div>}
            <div className="row wrap">
              <label className="btn">{busy ? "Saving…" : "Choose picture…"}<input type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} /></label>
              {settings.branding.heroImageDataUrl ? <button className="btn ghost" onClick={async () => { const { heroImageDataUrl: _h, ...rest } = settings.branding; await saveSetting("branding", rest); toast("Sign-in picture removed"); }}>Remove</button> : null}
            </div>
          </div>
        </div>
        <div className="stack appearance-col" style={{ alignItems: "center" }}>
          <Seg<PreviewScreen> value={screen} onChange={setScreen} options={[{ value: "signin", label: "Sign in" }, { value: "home", label: "Home" }, { value: "menu", label: "Menu" }, { value: "cart", label: "Order" }]} />
          <PhonePreview style={shownStyle} screen={screen} {...(m.accent ? { accent: m.accent } : {})} />
          {m.style === "terminal" ? <p className="small muted">Terminal layout selected: phones will show the till layout. The preview shows the Bright style for comparison.</p> : null}
        </div>
      </div>
    </div>
  );
}
