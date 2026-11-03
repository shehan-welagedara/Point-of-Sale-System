import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  type AccountingSettings,
  type BrandingSettings,
  type BusinessSettings,
  type DocStore,
  type IntegrationSettings,
  type MemberRole,
  type ModuleKey,
  type PosSettings,
  type Query,
  type TaxSettings,
  type Tenant,
  type WriteOp,
  COLLECTIONS as C,
  MemoryStore,
  allModulesOn,
  isOn,
  newId,
} from "@pos/core";
import { type Actor, type LedgerRequest, UNAUDITED, makeAuditEvent, runLedgerRequest, storeRunner } from "@pos/ledger";
import { DEMO_PEOPLE, buildSampleStore, sampleSettings } from "@pos/sample-data";
import { httpsCallable } from "firebase/functions";
import { createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch } from "firebase/firestore";
import { firebase, firebaseConfigured } from "../lib/firebase";
import { FirestoreStore } from "../lib/firestore-store";
import { todayColombo } from "../lib/format";

export interface Settings {
  business: BusinessSettings;
  branding: BrandingSettings;
  tax: TaxSettings;
  pos: PosSettings;
  accounting: AccountingSettings;
  integrations: IntegrationSettings;
}

/** Defaults for a brand-new tenant (no sample data): Sri Lanka tax setup, placeholder business details. */
export function defaultSettings(name = "My Restaurant"): Settings {
  const s = sampleSettings();
  return {
    ...s,
    business: { ...s.business, legalName: `${name} (Pvt) Ltd`, tradingName: name, tin: "", addressLines: ["Address line 1", "Colombo"], phone: "", email: "", isSample: true },
    branding: { ...s.branding, displayName: name, receiptHeaderLines: [], receiptFooterLines: ["Thank you!"] },
  };
}

export interface AppUser {
  uid: string;
  email: string;
  name: string;
}

interface Membership {
  tenantId: string;
  role: MemberRole;
}

interface Toast {
  id: number;
  text: string;
  bad?: boolean;
}

interface AppState {
  mode: "local" | "firebase";
  ready: boolean;
  user: AppUser | null;
  role: MemberRole | null;
  tenant: Tenant | null;
  tenants: Tenant[];
  store: DocStore | null;
  settings: Settings;
  on: (m: ModuleKey) => boolean;
  toast: (text: string, bad?: boolean) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  createTenant: (name: string, withSample: boolean) => Promise<void>;
  switchTenant: (id: string) => void;
  updateTenant: (patch: Partial<Tenant>) => Promise<void>;
  saveSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => Promise<void>;
  resetLocalDemo: () => void;
  acceptInvite: () => Promise<boolean>;
  /** Local demo: which demo person you are acting as (to show segregation of duties). */
  persona: keyof typeof DEMO_PEOPLE;
  setPersona: (p: keyof typeof DEMO_PEOPLE) => void;
  actor: Actor | null;
  /** Server-side ledger operation: Cloud Functions in Firebase mode, the same code locally. */
  ledger: <T = unknown>(req: LedgerRequest) => Promise<T>;
  /** Display name for a user id (members, demo people). */
  personName: (uid: string | undefined) => string;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

export function useStore(): DocStore {
  const { store } = useApp();
  if (!store) throw new Error("no active tenant");
  return store;
}

/** Live collection (re-subscribes when the query changes). `undefined` while loading. */
export function useCollection<T>(col: string | null, query?: Query): T[] | undefined {
  const { store } = useApp();
  const key = JSON.stringify(query ?? null);
  const [docs, setDocs] = useState<T[] | undefined>(undefined);
  useEffect(() => {
    if (!store || !col) return;
    setDocs(undefined);
    return store.watch<T>(col, query, setDocs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, col, key]);
  return docs;
}

export function useDoc<T>(col: string, id: string | undefined): T | null | undefined {
  const docs = useCollection<T & { id: string }>(col, id ? { where: [["id", "==", id]] } : undefined);
  if (!id) return null;
  return docs === undefined ? undefined : (docs[0] ?? null);
}

const LOCAL_KEY = "pos-suite.local.v1";

interface LocalSave {
  tenant: Tenant;
  data: Record<string, Record<string, unknown>[]>;
}

function applyBrand(branding: BrandingSettings | undefined): void {
  const root = document.documentElement;
  if (branding?.primaryColor) root.style.setProperty("--brand", branding.primaryColor);
  if (branding?.accentColor) root.style.setProperty("--accent", branding.accentColor);
  document.title = branding?.displayName ? `${branding.displayName} · POS Suite` : "POS Suite";
}

async function sampleOps(): Promise<{ ops: WriteOp[]; modules: Tenant["modules"] }> {
  const { store, tenant } = await buildSampleStore({ today: todayColombo(), historyDays: 7, checksPerDay: 18 });
  const snap = store.snapshot();
  const ops: WriteOp[] = Object.entries(snap).flatMap(([col, docs]) => docs.map((data): WriteOp => ({ op: "set", col, data: data as { id: string } })));
  return { ops, modules: tenant.modules };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mode: "local" | "firebase" = firebaseConfigured() ? "firebase" : "local";
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [store, setStore] = useState<DocStore | null>(null);
  const [settingsDocs, setSettingsDocs] = useState<Partial<Settings>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((text: string, bad?: boolean) => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, bad }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 5000 : 2600);
  }, []);

  // ── Local demo mode: one tenant persisted in this browser ──
  const localStore = useRef<MemoryStore | null>(null);
  const localTenant = useRef<Tenant | null>(null);
  const [persona, setPersonaState] = useState<keyof typeof DEMO_PEOPLE>(() => {
    try {
      const p = localStorage.getItem("pos-suite.persona");
      return p && p in DEMO_PEOPLE ? (p as keyof typeof DEMO_PEOPLE) : "owner";
    } catch {
      return "owner";
    }
  });
  const personaRef = useRef(persona);
  personaRef.current = persona;
  const openLocal = useCallback((save: LocalSave | null) => {
    if (!save) {
      setTenant(null);
      setStore(null);
      setReady(true);
      return;
    }
    const m = new MemoryStore();
    m.load(save.data);
    localTenant.current = save.tenant;
    let timer: ReturnType<typeof setTimeout> | undefined;
    m.onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(LOCAL_KEY, JSON.stringify({ tenant: localTenant.current, data: m.snapshot() }));
        } catch (e) {
          console.warn("local save failed", e);
        }
      }, 300);
    };
    // Local audit trail: the same field-level events the Cloud Functions trigger records.
    m.onWrite = (w) => {
      if (UNAUDITED.has(w.col)) return;
      const who = DEMO_PEOPLE[personaRef.current];
      void makeAuditEvent({ id: newId(), at: new Date().toISOString(), actorType: "user", actorId: who.uid, actorSource: "stamp", collection: w.col, docId: w.id, before: w.before, after: w.after }).then((e) => {
        if (e) void m.set("auditEvents", e);
      });
    };
    localStore.current = m;
    setTenant(save.tenant);
    setTenants([save.tenant]);
    setStore(m);
    setReady(true);
  }, []);

  useEffect(() => {
    if (mode !== "local") return;
    const who = DEMO_PEOPLE[persona];
    setUser({ uid: who.uid, email: `${persona}@demo.local`, name: who.name });
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      openLocal(raw ? (JSON.parse(raw) as LocalSave) : null);
    } catch {
      openLocal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, openLocal]);

  useEffect(() => {
    if (mode !== "local") return;
    const who = DEMO_PEOPLE[persona];
    setUser({ uid: who.uid, email: `${persona}@demo.local`, name: who.name });
  }, [mode, persona]);

  // ── Firebase mode ──
  // While a tenant is being created and seeded, auth events must not switch to it half-written.
  const creating = useRef(false);
  const loadMemberships = useCallback(async (u: AppUser) => {
    if (creating.current) return;
    const { db } = firebase();
    const snap = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", u.uid)));
    const ms = snap.docs.map((d) => ({ tenantId: String(d.data().tenantId), role: d.data().role as MemberRole }));
    setMemberships(ms);
    const ts = (await Promise.all(ms.map(async (m) => {
      const t = await getDoc(doc(db, "tenants", m.tenantId));
      return t.exists() ? ({ ...t.data(), id: t.id } as Tenant) : null;
    }))).filter((t): t is Tenant => Boolean(t));
    setTenants(ts);
    const preferred = localStorage.getItem("pos-suite.activeTenant");
    const active = ts.find((t) => t.id === preferred) ?? ts[0] ?? null;
    setTenant(active);
    setStore(active ? new FirestoreStore(db, active.id, () => firebase().auth.currentUser?.uid) : null);
  }, []);

  useEffect(() => {
    if (mode !== "firebase") return;
    const { auth } = firebase();
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) {
          setUser(null);
          setTenant(null);
          setStore(null);
          setReady(true);
          return;
        }
        const u = { uid: fbUser.uid, email: fbUser.email ?? "", name: fbUser.displayName ?? fbUser.email ?? "User" };
        setUser(u);
        try {
          await loadMemberships(u);
        } catch (e) {
          console.error(e);
          toast("Could not load your businesses. Check Firestore rules and indexes are deployed.", true);
        }
        setReady(true);
    });
    return () => unsub();
  }, [mode, loadMemberships, toast]);

  // Live tenant doc + settings for the active tenant.
  useEffect(() => {
    if (!store) {
      setSettingsDocs({});
      return;
    }
    return store.watch<{ id: keyof Settings }>(C.settings, undefined, (docs) => {
      const next: Partial<Settings> = {};
      for (const d of docs) (next as Record<string, unknown>)[d.id] = d;
      setSettingsDocs(next);
    });
  }, [store]);

  useEffect(() => {
    if (mode !== "firebase" || !tenant) return;
    return onSnapshot(doc(firebase().db, "tenants", tenant.id), (snap) => {
      if (snap.exists()) setTenant({ ...(snap.data() as Tenant), id: snap.id });
    });
  }, [mode, tenant?.id]);

  const settings = useMemo<Settings>(() => {
    const d = defaultSettings(tenant?.name);
    return {
      business: settingsDocs.business ?? d.business,
      branding: settingsDocs.branding ?? d.branding,
      tax: settingsDocs.tax ?? d.tax,
      pos: settingsDocs.pos ?? d.pos,
      accounting: settingsDocs.accounting ?? d.accounting,
      integrations: settingsDocs.integrations ?? d.integrations,
    };
  }, [settingsDocs, tenant?.name]);

  useEffect(() => applyBrand(settings.branding), [settings.branding]);

  const role: MemberRole | null = mode === "local" ? (tenant ? DEMO_PEOPLE[persona].role : null) : (memberships.find((m) => m.tenantId === tenant?.id)?.role ?? null);
  const actor: Actor | null = user && role ? { uid: user.uid, name: user.name, role } : null;
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!store || mode !== "firebase") return;
    return store.watch<{ id: string; name?: string; email?: string }>(C.members, undefined, (ms) => setMemberNames(Object.fromEntries(ms.map((m) => [m.id, m.name || m.email || m.id]))));
  }, [store, mode]);

  const ledger = useCallback(
    async <T,>(req: LedgerRequest): Promise<T> => {
      if (!tenant || !actor) throw new Error("no business selected");
      if (mode === "local") {
        const m = localStore.current;
        if (!m) throw new Error("no local data");
        return (await runLedgerRequest({ runner: storeRunner(m), store: m, now: () => new Date(), sealDelayMs: 0 }, actor, req)) as T;
      }
      try {
        const res = await httpsCallable(firebase().functions, "ledgerApi")({ tenantId: tenant.id, ...req });
        return res.data as T;
      } catch (e) {
        throw new Error((e as { message?: string }).message?.replace(/^.*?:\s*/, "") || "the server could not complete this");
      }
    },
    [tenant, actor, mode],
  );

  const createTenant = useCallback(
    async (name: string, withSample: boolean) => {
      const sample = withSample ? await sampleOps() : null;
      const base = defaultSettings(name);
      const configOps: WriteOp[] = sample?.ops ?? Object.values(base).map((data): WriteOp => ({ op: "set", col: C.settings, data }));
      const now = new Date().toISOString();
      if (mode === "local") {
        const t: Tenant = { id: "local", name, ownerUid: "local-owner", modules: sample?.modules ?? { pos: true, tables: true, recipes: true, revenue: true }, plan: "demo", status: "active", createdAt: now };
        const m = new MemoryStore();
        await m.batch(configOps);
        if (withSample) {
          await m.merge(C.settings, "branding", { displayName: name === "Spice Lagoon (demo)" ? "Spice Lagoon" : name });
        }
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ tenant: t, data: m.snapshot() }));
        openLocal({ tenant: t, data: m.snapshot() });
        return;
      }
      if (!user) throw new Error("sign in first");
      creating.current = true;
      try {
        const { db } = firebase();
        const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "tenant"}-${Math.random().toString(36).slice(2, 7)}`;
        const t: Tenant = { id, name, ownerUid: user.uid, modules: sample?.modules ?? { pos: true, tables: true, recipes: true, revenue: true }, plan: withSample ? "demo" : "starter", status: "active", createdAt: now };
        const b = writeBatch(db);
        b.set(doc(db, "tenants", id), t);
        b.set(doc(db, "tenants", id, "members", user.uid), { id: user.uid, uid: user.uid, email: user.email, name: user.name, role: "owner", tenantId: id, createdAt: now });
        await b.commit();
        const fs = new FirestoreStore(db, id, () => firebase().auth.currentUser?.uid);
        await fs.batch(configOps);
        localStorage.setItem("pos-suite.activeTenant", id);
      } finally {
        creating.current = false;
      }
      await loadMemberships(user);
    },
    [mode, user, openLocal, loadMemberships],
  );

  const switchTenant = useCallback(
    (id: string) => {
      localStorage.setItem("pos-suite.activeTenant", id);
      const t = tenants.find((x) => x.id === id) ?? null;
      setTenant(t);
      setStore(t && mode === "firebase" ? new FirestoreStore(firebase().db, t.id, () => firebase().auth.currentUser?.uid) : store);
    },
    [tenants, mode, store],
  );

  const updateTenant = useCallback(
    async (patch: Partial<Tenant>) => {
      if (!tenant) return;
      const next = { ...tenant, ...patch };
      if (mode === "local") {
        localTenant.current = next;
        localStorage.setItem(LOCAL_KEY, JSON.stringify({ tenant: next, data: localStore.current?.snapshot() ?? {} }));
        setTenant(next);
        return;
      }
      await setDoc(doc(firebase().db, "tenants", tenant.id), patch, { merge: true });
    },
    [tenant, mode],
  );

  const saveSetting = useCallback(
    async <K extends keyof Settings>(key: K, value: Settings[K]) => {
      if (!store) return;
      await store.set(C.settings, value);
    },
    [store],
  );

  const value: AppState = {
    mode,
    ready,
    user,
    role,
    tenant,
    tenants,
    store,
    settings,
    on: (m) => isOn(tenant?.modules, m),
    toast,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(firebase().auth, email, password);
    },
    signUp: async (email, password, name) => {
      const cred = await createUserWithEmailAndPassword(firebase().auth, email, password);
      await updateProfile(cred.user, { displayName: name });
    },
    signOut: async () => {
      if (mode === "local") return;
      await firebaseSignOut(firebase().auth);
    },
    createTenant,
    switchTenant,
    updateTenant,
    saveSetting,
    resetLocalDemo: () => {
      localStorage.removeItem(LOCAL_KEY);
      openLocal(null);
    },
    persona,
    setPersona: (p) => {
      try {
        localStorage.setItem("pos-suite.persona", p);
      } catch {
        /* per-browser convenience only */
      }
      setPersonaState(p);
    },
    actor,
    ledger,
    personName: (uid) => {
      if (!uid) return "—";
      const demo = Object.values(DEMO_PEOPLE).find((p) => p.uid === uid);
      return demo?.name ?? memberNames[uid] ?? (user?.uid === uid ? user.name : uid.length > 14 ? `${uid.slice(0, 8)}…` : uid);
    },
    acceptInvite: async () => {
      if (mode !== "firebase" || !user?.email) return false;
      const { db } = firebase();
      const inviteRef = doc(db, "invites", user.email.toLowerCase());
      const inv = await getDoc(inviteRef);
      if (!inv.exists()) return false;
      const { tenantId, role } = inv.data() as { tenantId: string; role: MemberRole };
      const b = writeBatch(db);
      b.set(doc(db, "tenants", tenantId, "members", user.uid), { id: user.uid, uid: user.uid, email: user.email, name: user.name, role, tenantId, createdAt: new Date().toISOString() });
      b.delete(inviteRef);
      await b.commit();
      localStorage.setItem("pos-suite.activeTenant", tenantId);
      await loadMemberships(user);
      return true;
    },
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.bad ? " bad" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export { allModulesOn };
