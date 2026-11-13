import { useEffect, useMemo, useRef, useState } from "react";
import {
  type Broadcast,
  type Customer,
  type IntegrationSettings,
  type PriceList,
  type SalesOrder,
  type WaConversation,
  type WaMessage,
  type WaOutbound,
  COLLECTIONS as C,
  WA,
  WHOLESALE,
  broadcastAudience,
  inServiceWindow,
} from "@pos/core";
import { ConfirmButton, Empty, Explain, Field, Loading, ModuleOff, PageHead, Toggle } from "../../components/ui";
import { dateTimeColombo, money, timeColombo } from "../../lib/format";
import { firebase } from "../../lib/firebase";
import { type WaStatus, tick, useWhatsApp } from "../../lib/whatsapp";
import { useApp, useCollection, useStore } from "../../state/app";
import { StatusBadge } from "./shared";

function useWaStatus(): WaStatus | null {
  const wa = useWhatsApp();
  const { settings } = useApp();
  const [s, setS] = useState<WaStatus | null>(null);
  useEffect(() => {
    wa<WaStatus>({ action: "status" }).then(setS).catch(() => setS({ accessToken: false, appSecret: false, verifyToken: false, live: false, phoneNumberId: "" }));
  }, [wa, settings.integrations.whatsapp.mode]);
  return s;
}

// ───────────────────────────── Inbox ─────────────────────────────

export function WhatsAppInboxPage() {
  const { on } = useApp();
  const convs = useCollection<WaConversation>(WA.conversations);
  const status = useWaStatus();
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sim, setSim] = useState(false);
  if (!on("whatsappCommerce")) return <ModuleOff name="WhatsApp Business" />;
  if (!convs) return <div className="page"><Loading /></div>;
  const needle = q.trim().toLowerCase();
  const list = [...convs].filter((c) => !needle || `${c.name ?? ""} ${c.id} ${c.lastText ?? ""}`.toLowerCase().includes(needle)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const current = convs.find((c) => c.id === openId);
  const live = status?.live ?? false;
  return (
    <div className="page">
      <PageHead
        title="WhatsApp inbox"
        subtitle="Customers order and ask here. The assistant answers, takes orders and payment slips; take over a chat to reply yourself, and hand it back when done."
        actions={!live ? <button className="btn" onClick={() => setSim(!sim)} data-testid="wa-sim-toggle">{sim ? "Close simulator" : "Try as a customer"}</button> : null}
      />
      {!live && status ? <Explain>Not connected to WhatsApp yet: messages here are simulated. Connect the business number under WhatsApp → Connection & assistant.</Explain> : null}
      <div className={`wa-grid${sim ? " with-sim" : ""}`}>
        <div className="card wa-list">
          <input className="input" placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search chats" />
          {list.length === 0 ? <Empty title="No chats yet" /> : list.map((c) => (
            <button key={c.id} className={`wa-conv${c.id === openId ? " on" : ""}`} onClick={() => setOpenId(c.id)} data-testid={`wa-conv-${c.id}`}>
              <span className="grow">
                <b>{c.name ?? `+${c.id}`}</b> {c.mode === "human" ? <span className="badge warn">You</span> : <span className="badge info">Assistant</span>}
                <span className="tiny muted wa-last">{c.lastText ?? ""}</span>
              </span>
              <span className="tiny muted">{timeColombo(c.updatedAt)}{c.unread ? <span className="wa-unread">{c.unread}</span> : null}</span>
            </button>
          ))}
        </div>
        {current ? <Thread conv={current} /> : <div className="card"><Empty title="Choose a chat" /></div>}
        {sim ? <Simulator onOpen={setOpenId} /> : null}
      </div>
    </div>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const p = m.payload as WaOutbound | undefined;
  const body = p && "kind" in p && p.kind === "buttons" ? p.text : p && "kind" in p && p.kind === "list" ? p.text : m.text;
  return (
    <div className={`wa-msg ${m.direction}`} data-testid="wa-msg">
      <div className="wa-text">{body}</div>
      {p && "kind" in p && p.kind === "buttons" ? <div className="chips">{p.buttons.map((b) => <span key={b.id} className="chip">{b.title}</span>)}</div> : null}
      {p && "kind" in p && p.kind === "list" ? <div className="stack tiny">{p.rows.map((r) => <span key={r.id}>• {r.title}{r.description ? ` · ${r.description}` : ""}</span>)}</div> : null}
      <div className="tiny muted">{timeColombo(m.at)} {m.by ? `· ${m.by}` : m.direction === "out" ? "· assistant" : ""} {tick(m)}{m.error ? ` · ${m.error}` : ""}</div>
    </div>
  );
}

function Thread({ conv }: { conv: WaConversation }) {
  const { toast, settings } = useApp();
  const store = useStore();
  const wa = useWhatsApp();
  const msgs = useCollection<WaMessage>(WA.messages, { where: [["conversationId", "==", conv.id]] });
  const customer = useCollection<Customer>(C.customers, { where: [["whatsapp", "==", conv.id]] })?.[0];
  const orders = useCollection<SalesOrder>(WHOLESALE.salesOrders, { where: [["conversationId", "==", conv.id]] }) ?? [];
  const [text, setText] = useState("");
  const [template, setTemplate] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const sorted = useMemo(() => [...(msgs ?? [])].sort((a, b) => a.at.localeCompare(b.at)), [msgs]);
  const open = inServiceWindow(conv, new Date());
  const templates = Object.values(settings.integrations.whatsapp.templates ?? {}).filter(Boolean) as string[];
  useEffect(() => {
    if (conv.unread) void store.merge(WA.conversations, conv.id, { unread: 0 });
  }, [conv.id, conv.unread, store]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [sorted.length]);
  async function send(message: WaOutbound) {
    try {
      await wa({ action: "send", conversationId: conv.id, message });
      setText("");
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  return (
    <div className="card wa-thread">
      <div className="row wrap wa-head">
        <div className="grow">
          <b>{conv.name ?? `+${conv.id}`}</b> <span className="tiny muted">+{conv.id}</span>
          {customer ? <div className="tiny muted">{customer.shopName ? `${customer.shopName} · ` : ""}{customer.area ?? ""}{customer.whatsappOptOutAt ? " · opted out of offers" : ""}</div> : null}
        </div>
        {conv.mode === "human" ? (
          <button className="btn" onClick={() => store.merge(WA.conversations, conv.id, { mode: "bot", step: "idle" })}>Hand back to assistant</button>
        ) : (
          <button className="btn" onClick={() => store.merge(WA.conversations, conv.id, { mode: "human" })}>Take over</button>
        )}
      </div>
      {orders.length ? (
        <div className="row wrap small wa-orders">
          {orders.slice(0, 4).map((o) => <span key={o.id} className="chip">{o.number} · {money(o.total)} <StatusBadge status={o.status} /></span>)}
        </div>
      ) : null}
      <div className="wa-msgs">
        {sorted.map((m) => <Bubble key={m.id} m={m} />)}
        <div ref={end} />
      </div>
      {open ? (
        <div className="row wa-compose">
          <input className="input grow" placeholder="Type a reply" value={text} aria-label="Reply" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && send({ kind: "text", text: text.trim() })} />
          <button className="btn primary" disabled={!text.trim()} onClick={() => send({ kind: "text", text: text.trim() })}>Send</button>
        </div>
      ) : (
        <div className="row wa-compose">
          <span className="small muted grow">More than 24 hours since their last message: WhatsApp allows approved templates only.</span>
          <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">
            <option value="">Template…</option>
            {templates.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn primary" disabled={!template} onClick={() => send({ kind: "template", name: template, params: [], ...(settings.integrations.whatsapp.templateLanguage ? { language: settings.integrations.whatsapp.templateLanguage } : {}) })}>Send template</button>
        </div>
      )}
    </div>
  );
}

/** A pretend customer's phone: try the assistant before the business number is connected. */
function Simulator({ onOpen }: { onOpen: (id: string) => void }) {
  const { toast } = useApp();
  const wa = useWhatsApp();
  const [phone, setPhone] = useState("94770000001");
  const [name, setName] = useState("Test customer");
  const [text, setText] = useState("");
  const from = phone.replace(/\D/g, "");
  const msgs = useCollection<WaMessage>(WA.messages, { where: [["conversationId", "==", from]] });
  const last = [...(msgs ?? [])].filter((m) => m.direction === "out").sort((a, b) => b.at.localeCompare(a.at))[0];
  const p = last?.payload as WaOutbound | undefined;
  const choices = p && "kind" in p ? (p.kind === "buttons" ? p.buttons : p.kind === "list" ? p.rows : []) : [];
  async function say(message: { type: "text"; text: string } | { type: "interactive"; replyId: string; text: string } | { type: "image"; image: { mediaId: string; caption?: string } }) {
    try {
      await wa({ action: "simulate", message: { from, name, ...message } });
      setText("");
      onOpen(from);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }
  return (
    <div className="card pad wa-sim" data-testid="wa-sim">
      <div className="section-title">Customer's phone (simulated)</div>
      <div className="row">
        <input className="input grow" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Customer number" />
        <input className="input grow" value={name} onChange={(e) => setName(e.target.value)} aria-label="Customer name" />
      </div>
      {choices.length ? (
        <div className="stack">
          <span className="tiny muted">Tap like the customer would:</span>
          <div className="chips">{choices.map((c) => <button key={c.id} className="chip" onClick={() => say({ type: "interactive", replyId: c.id, text: c.title })}>{c.title}</button>)}</div>
        </div>
      ) : null}
      <div className="row">
        <input className="input grow" placeholder="Message as the customer" value={text} aria-label="Customer message" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && text.trim() && say({ type: "text", text: text.trim() })} />
        <button className="btn primary" disabled={!text.trim()} onClick={() => say({ type: "text", text: text.trim() })}>Send</button>
      </div>
      <button className="btn ghost" onClick={() => say({ type: "image", image: { mediaId: `sim-slip-${Date.now()}`, caption: "Bank slip" } })}>📷 Send a payment slip photo</button>
    </div>
  );
}

// ───────────────────────────── Broadcasts ─────────────────────────────

export function WhatsAppBroadcastsPage() {
  const { on, toast, settings, role } = useApp();
  const wa = useWhatsApp();
  const customers = useCollection<Customer>(C.customers);
  const priceLists = useCollection<PriceList>(WHOLESALE.priceLists) ?? [];
  const sent = useCollection<Broadcast>(WA.broadcasts);
  const templates = Object.values(settings.integrations.whatsapp.templates ?? {}).filter(Boolean) as string[];
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(settings.integrations.whatsapp.templates?.new_arrivals ?? "");
  const [params, setParams] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [area, setArea] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [test, setTest] = useState("");
  const [busy, setBusy] = useState(false);
  if (!on("whatsappCommerce")) return <ModuleOff name="WhatsApp Business" />;
  if (!customers || !sent) return <div className="page"><Loading /></div>;
  const segment = { ...(tags.length ? { tags } : {}), ...(area ? { area } : {}), ...(priceListId ? { priceListId } : {}) };
  const audience = broadcastAudience(customers, segment);
  const allTags = [...new Set(customers.flatMap((c) => c.tags ?? []))].sort();
  const areas = [...new Set(customers.map((c) => c.area).filter(Boolean) as string[])].sort();
  const optedIn = customers.filter((c) => c.whatsappOptIn && !c.whatsappOptOutAt).length;
  const canSend = role === "owner" || role === "admin" || role === "manager";
  async function go(testOnly: boolean) {
    if (!template) return toast("Choose an approved template", true);
    setBusy(true);
    try {
      const list = params.split("\n").map((x) => x.trim()).filter(Boolean);
      const r = await wa<Broadcast & { test?: unknown }>({ action: "broadcast", name, template, params: list, segment, ...(testOnly ? { test } : {}) });
      toast(testOnly ? "Test sent" : `Sent to ${r.sent} customers${r.failed ? `, ${r.failed} failed` : ""}${r.simulated ? " (simulated)" : ""}`, Boolean(r.failed));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <PageHead title="Broadcasts" subtitle="New designs, restocks and offers to customers who agreed to receive them. WhatsApp requires an approved template; anyone can reply STOP to opt out, and they are never messaged again." />
      <div className="grid cols-2">
        <div className="card pad stack">
          <Field label="Name (for your records)"><input className="input" value={name} placeholder="e.g. December new arrivals" onChange={(e) => setName(e.target.value)} aria-label="Broadcast name" /></Field>
          <Field label="Approved template">
            {templates.length ? (
              <select className="input" value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">
                <option value="">Choose…</option>
                {templates.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            ) : <input className="input mono" value={template} placeholder="template_name" onChange={(e) => setTemplate(e.target.value.toLowerCase())} aria-label="Template" />}
          </Field>
          <Field label="Template values" help="One per line, in the order of {{1}}, {{2}}…"><textarea className="textarea" value={params} onChange={(e) => setParams(e.target.value)} aria-label="Template values" /></Field>
          <Field label="Customers with tags">
            <div className="chips">{allTags.map((t) => <button key={t} type="button" className={`chip${tags.includes(t) ? " on" : ""}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>)}</div>
          </Field>
          <div className="row">
            <Field label="Area"><select className="input" value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">All</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
            <Field label="Price list"><select className="input" value={priceListId} onChange={(e) => setPriceListId(e.target.value)} aria-label="Price list"><option value="">All</option>{priceLists.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          </div>
          <div className="row wrap">
            <input className="input grow" placeholder="Test number (94…)" value={test} onChange={(e) => setTest(e.target.value)} aria-label="Test number" />
            <button className="btn" disabled={busy || !test} onClick={() => go(true)}>Send test</button>
          </div>
          <div className="row">
            <span className="grow" data-testid="bc-audience"><b>{audience.length}</b> of {optedIn} opted-in customers</span>
            {canSend ? <ConfirmButton className="btn primary" confirmText={`Send to ${audience.length}?`} onConfirm={() => go(false)}>Send broadcast</ConfirmButton> : <span className="small muted">A manager sends broadcasts</span>}
          </div>
        </div>
        <div className="card">
          {sent.length === 0 ? <Empty title="No broadcasts yet" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Broadcast</th><th>When</th><th className="num">Sent</th><th className="num">Failed</th></tr></thead>
                <tbody>{[...sent].sort((a, b) => b.at.localeCompare(a.at)).map((b) => <tr key={b.id}><td>{b.name}<div className="tiny muted mono">{b.template}{b.simulated ? " · simulated" : ""}</div></td><td>{dateTimeColombo(b.at)}</td><td className="num">{b.sent}</td><td className="num">{b.failed}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── Connection & assistant ─────────────────────────────

const TEMPLATE_KEYS: { key: keyof NonNullable<IntegrationSettings["whatsapp"]["templates"]>; label: string }[] = [
  { key: "order_confirmed", label: "Order confirmed" },
  { key: "order_dispatched", label: "Order on the way" },
  { key: "order_delivered", label: "Delivered" },
  { key: "invoice_ready", label: "Invoice" },
  { key: "payment_received", label: "Payment received" },
  { key: "payment_reminder", label: "Payment reminder" },
  { key: "quotation", label: "Quotation" },
  { key: "new_arrivals", label: "New arrivals (broadcast)" },
];

export function WhatsAppSettingsPage() {
  const { on, toast, settings, saveSetting, mode, role } = useApp();
  const wa = useWhatsApp();
  const status = useWaStatus();
  const [w, setW] = useState(settings.integrations.whatsapp);
  const [secrets, setSecrets] = useState({ accessToken: "", appSecret: "", verifyToken: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setW(settings.integrations.whatsapp);
  }, [settings.integrations.whatsapp]);
  if (!on("whatsappCommerce")) return <ModuleOff name="WhatsApp Business" />;
  const admin = role === "owner" || role === "admin";
  const region = (import.meta.env.VITE_FUNCTIONS_REGION as string | undefined) || "asia-south1";
  const projectId = mode === "firebase" ? firebase().app.options.projectId : "your-project";
  const webhook = `https://${region}-${projectId}.cloudfunctions.net/whatsappWebhook`;

  async function saveAll(next = w) {
    await saveSetting("integrations", { ...settings.integrations, whatsapp: next });
  }
  async function connect() {
    if (!w.phoneNumberId) return toast("Enter the Phone number ID", true);
    setBusy(true);
    try {
      await wa({ action: "connect", phoneNumberId: w.phoneNumberId.trim(), ...(secrets.accessToken ? { accessToken: secrets.accessToken } : {}), ...(secrets.appSecret ? { appSecret: secrets.appSecret } : {}), ...(secrets.verifyToken ? { verifyToken: secrets.verifyToken } : {}) });
      await saveAll({ ...w, mode: "live" });
      setSecrets({ accessToken: "", appSecret: "", verifyToken: "" });
      toast("WhatsApp connected");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    try {
      const r = await wa<{ items: number }>({ action: "syncCatalogue", imageBase: w.catalogImageBase ?? "", link: w.catalogLink ?? `https://wa.me/${(w.displayPhone ?? "").replace(/\D/g, "")}` });
      toast(`${r.items} products sent to the WhatsApp catalogue`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const bot = w.bot ?? { enabled: true };
  return (
    <div className="page">
      <PageHead title="WhatsApp connection & assistant" subtitle="Connect the business number with Meta's WhatsApp Cloud API, set what the ordering assistant says, and the approved message templates. The access token and app secret are kept on the server; nobody can read them back." />
      <div className="grid cols-2">
        <div className="card pad stack">
          <div className="row"><b className="grow">Connection</b>{status?.live ? <span className="badge good">Live</span> : <span className="badge warn">Not connected (simulated)</span>}</div>
          <Field label="Phone number ID"><input className="input mono" value={w.phoneNumberId} disabled={!admin} onChange={(e) => setW({ ...w, phoneNumberId: e.target.value.trim() })} aria-label="Phone number ID" /></Field>
          <Field label="WhatsApp Business Account ID"><input className="input mono" value={w.wabaId ?? ""} disabled={!admin} onChange={(e) => setW({ ...w, wabaId: e.target.value.trim() })} aria-label="WABA ID" /></Field>
          <Field label="Business number (as customers see it)"><input className="input" value={w.displayPhone ?? ""} placeholder="+94 77 123 4567" disabled={!admin} onChange={(e) => setW({ ...w, displayPhone: e.target.value })} aria-label="Display number" /></Field>
          <Field label="Access token (system user, permanent)" help={status?.accessToken ? "Saved ✓ (enter a new one to replace it)" : "Not saved"}><input className="input mono" type="password" autoComplete="off" value={secrets.accessToken} disabled={!admin} onChange={(e) => setSecrets({ ...secrets, accessToken: e.target.value })} aria-label="Access token" /></Field>
          <Field label="App secret" help={status?.appSecret ? "Saved ✓" : "Not saved: Meta's App settings → Basic"}><input className="input mono" type="password" autoComplete="off" value={secrets.appSecret} disabled={!admin} onChange={(e) => setSecrets({ ...secrets, appSecret: e.target.value })} aria-label="App secret" /></Field>
          <Field label="Webhook verify token" help={status?.verifyToken ? "Saved ✓" : "Any long random text; type the same in Meta"}>
            <div className="row">
              <input className="input mono grow" value={secrets.verifyToken} disabled={!admin} onChange={(e) => setSecrets({ ...secrets, verifyToken: e.target.value })} aria-label="Verify token" />
              <button className="btn" disabled={!admin} onClick={() => setSecrets({ ...secrets, verifyToken: Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("") })}>Generate</button>
            </div>
          </Field>
          <Field label="Webhook URL (paste in Meta → WhatsApp → Configuration)"><input className="input mono" readOnly value={webhook} aria-label="Webhook URL" onFocus={(e) => e.target.select()} /></Field>
          {admin ? (
            <div className="row wrap">
              <button className="btn primary" disabled={busy || mode !== "firebase"} onClick={connect}>Connect</button>
              {status?.live ? <ConfirmButton className="btn ghost" onConfirm={async () => { await wa({ action: "disconnect" }).catch((e: Error) => toast(e.message, true)); await saveAll({ ...w, mode: "mock" }); }}>Disconnect</ConfirmButton> : null}
              {mode !== "firebase" ? <span className="small muted">The local demo simulates WhatsApp.</span> : null}
            </div>
          ) : null}
        </div>
        <div className="card pad stack">
          <div className="row"><b className="grow">Ordering assistant</b><Toggle on={bot.enabled} label="Assistant on" onChange={(v) => setW({ ...w, bot: { ...bot, enabled: v } })} /></div>
          <Field label="Welcome"><textarea className="textarea" value={bot.welcome ?? ""} placeholder={`Welcome to ${settings.business.tradingName}! 👋 How can we help you today?`} onChange={(e) => setW({ ...w, bot: { ...bot, welcome: e.target.value } })} aria-label="Welcome message" /></Field>
          <Field label="When someone asks for a person"><textarea className="textarea" value={bot.handoff ?? ""} placeholder="A member of our team will reply shortly." onChange={(e) => setW({ ...w, bot: { ...bot, handoff: e.target.value } })} aria-label="Hand-over message" /></Field>
          <Field label="Opening hours"><input className="input" value={bot.hours ?? ""} placeholder="Mon–Sat 9am–6pm" onChange={(e) => setW({ ...w, bot: { ...bot, hours: e.target.value } })} aria-label="Opening hours" /></Field>
          <Field label="Bank details for transfers"><textarea className="textarea" value={w.bankDetails ?? ""} placeholder={"Bank of Ceylon, Pettah\nAcc. 0001234567\nZevix (Pvt) Ltd"} onChange={(e) => setW({ ...w, bankDetails: e.target.value })} aria-label="Bank details" /></Field>
          <label className="row"><Toggle on={w.autoNotify !== false} label="Automatic order messages" onChange={(v) => setW({ ...w, autoNotify: v })} /> Send order confirmations, dispatch, delivery and payment messages automatically</label>
          <button className="btn primary" onClick={() => saveAll().then(() => toast("Saved"))}>Save</button>
        </div>
        <div className="card pad stack">
          <b>Approved templates</b>
          <Explain>Outside 24 hours from a customer's last message WhatsApp only delivers templates approved by Meta. Create them in WhatsApp Manager and type their names here.</Explain>
          {TEMPLATE_KEYS.map((t) => (
            <div key={t.key} className="row">
              <span className="grow small">{t.label}</span>
              <input className="input mono" style={{ width: 220 }} placeholder="template_name" value={w.templates?.[t.key] ?? ""} aria-label={`Template ${t.label}`} onChange={(e) => setW({ ...w, templates: { ...(w.templates ?? {}), [t.key]: e.target.value.toLowerCase() } })} />
            </div>
          ))}
          <Field label="Template language code"><input className="input mono" value={w.templateLanguage ?? "en"} onChange={(e) => setW({ ...w, templateLanguage: e.target.value })} aria-label="Template language" /></Field>
          <button className="btn primary" onClick={() => saveAll().then(() => toast("Saved"))}>Save templates</button>
        </div>
        <div className="card pad stack">
          <b>WhatsApp catalogue</b>
          <Explain>Styles marked "On WhatsApp" are sent to the Meta catalogue, one product per size and colour with its stock, so customers can browse and send a cart.</Explain>
          <Field label="Catalogue ID (Commerce Manager)"><input className="input mono" value={w.catalogId ?? ""} onChange={(e) => setW({ ...w, catalogId: e.target.value.trim() })} aria-label="Catalogue ID" /></Field>
          <Field label="Photos folder (public URL)" help="Each style's photo at <folder>/<style id>.jpg"><input className="input mono" value={w.catalogImageBase ?? ""} placeholder="https://zevix.lk/images/styles" onChange={(e) => setW({ ...w, catalogImageBase: e.target.value.trim() })} aria-label="Photos folder" /></Field>
          <div className="row wrap">
            <button className="btn" onClick={() => saveAll().then(() => toast("Saved"))}>Save</button>
            <button className="btn primary" disabled={busy || !status?.live} onClick={sync}>Sync catalogue now</button>
            {w.catalogSyncedAt ? <span className="small muted">Last sync {dateTimeColombo(w.catalogSyncedAt)}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
