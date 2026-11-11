import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { deepenForWhite, readableTextOn } from "../lib/contrast";
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
  type Entitlements,
  type ModuleKey as MK,
  DEMO_LICENCE_PUBLIC_KEY,
  TRIAL_DAYS,
  builtInEntitlements,
  clampModules,
  licenceStatus,
  newId,
  verifyLicence,
  withValidation,
  type StaffAuthRequest,
  type StaffAuthResult,
  runStaffAuth,
  withStaffSecrets, PRODUCT_FULL_NAME, PRODUCT_NAME } from "@pos/core";
import { type Actor, type LedgerRequest, type LedgerSettings, UNAUDITED, makeAuditEvent, runLedgerRequest, storeRunner } from "@pos/ledger";
import { DEMO_PEOPLE, STARTER_PROPERTY_ID, type SampleKind, buildSampleStore, sampleSettings, starterConfig } from "@pos/sample-data";
import { httpsCallable } from "firebase/functions";
import { createUserWithEmailAndPassword, onAuthStateChanged, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut as firebaseSignOut, updateProfile } from "firebase/auth";
import { collectionGroup, doc, getDoc, getDocs, onSnapshot, query, setDoc, where, writeBatch } from "firebase/firestore";
import { firebase, firebaseConfigured } from "../lib/firebase";
import { FirestoreStore } from "../lib/firestore-store";
import { setErrorSink } from "../lib/errors";
import { offlineCard, offlinePin, rememberCard, rememberPin } from "../lib/offline-pin";
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
  /** True once the business's saved settings have arrived (before that, `settings` holds defaults). */
  settingsReady: boolean;
  on: (m: ModuleKey) => boolean;
  toast: (text: string, bad?: boolean) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  /** Emails a password-reset link (silently does nothing for unknown addresses). */
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** A new business: empty (with the chosen modules) or one of the demo businesses. */
  createTenant: (name: string, sample: false | SampleKind, modules?: MK[]) => Promise<void>;
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
  /** Employee PIN / card check: the posAuth Cloud Function in Firebase mode, the same code locally. */
  staffAuth: (req: StaffAuthRequest) => Promise<StaffAuthResult>;
  /** Display name for a user id (members, demo people). */
  personName: (uid: string | undefined) => string;
  /** Licence in force: edition, entitlement, validity. */
  licence: LicenceInfo;
  /** Verifies a vendor licence key and applies it to this business. */
  activateLicence: (token: string) => Promise<void>;
}

export interface LicenceInfo {
  edition: Tenant["plan"];
  entitlements: Entitlements;
  status: "demo" | "trial" | "valid" | "grace" | "expired";
  daysLeft: number | null;
  usable: boolean;
  licensee?: string;
  demoKey: boolean;
}

/** Public key that licence keys must be signed with (your own in production). */
export const LICENCE_PUBLIC_KEY = (import.meta.env.VITE_LICENCE_PUBLIC_KEY as string | undefined) || DEMO_LICENCE_PUBLIC_KEY;

export function licenceInfo(t: Tenant | null, now = new Date()): LicenceInfo {
  const plan = t?.plan ?? "demo";
  const entitlements = t?.entitlements ?? builtInEntitlements(plan);
  if (t?.licence) {
    const c = licenceStatus(t.licence, now);
    return { edition: t.licence.edition, entitlements, status: c.status === "notYetValid" ? "expired" : c.status, daysLeft: c.daysLeft, usable: c.usable, licensee: t.licence.licensee, demoKey: Boolean(t.licence.demoKey) };
  }
  if (plan === "demo") {
    // Unlimited only in the vendor's own demo environment (public demo key). In a client deployment
    // a demo business is a 30-day training copy, so it can't be used to trade without a licence.
    if (LICENCE_PUBLIC_KEY === DEMO_LICENCE_PUBLIC_KEY) return { edition: "demo", entitlements, status: "demo", daysLeft: null, usable: true, demoKey: true };
    const left = Math.floor((Date.parse(t?.createdAt ?? now.toISOString()) + TRIAL_DAYS * 86_400_000 - now.getTime()) / 86_400_000);
    return { edition: "demo", entitlements, status: left >= 0 ? "demo" : "expired", daysLeft: left, usable: left >= 0, demoKey: false };
  }
  const end = t?.trialEndsAt ? Date.parse(t.trialEndsAt) : Date.parse(t?.createdAt ?? now.toISOString()) + TRIAL_DAYS * 86_400_000;
  const daysLeft = Math.floor((end - now.getTime()) / 86_400_000);
  return { edition: "trial", entitlements, status: daysLeft >= 0 ? "trial" : "expired", daysLeft, usable: daysLeft >= 0, demoKey: false };
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
  if (branding?.primaryColor) {
    root.style.setProperty("--brand", branding.primaryColor);
    root.style.setProperty("--on-brand", readableTextOn(branding.primaryColor));
    // Readable on white and on the brand's own light tints (badges, the selected menu item).
    root.style.setProperty("--brand-ink", deepenForWhite(branding.primaryColor, 6) ?? branding.primaryColor);
  }
  if (branding?.accentColor) root.style.setProperty("--accent", branding.accentColor);
  document.title = branding?.displayName ? `${branding.displayName} · ${PRODUCT_NAME}` : PRODUCT_FULL_NAME;
}

async function sampleOps(kind: SampleKind): Promise<{ ops: WriteOp[]; modules: Tenant["modules"] }> {
  const { store, tenant } = await buildSampleStore(kind === "noura-kitchen" ? { today: todayColombo(), historyDays: 30, checksPerDay: 12, kind } : { today: todayColombo(), historyDays: 7, checksPerDay: 18 });
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
  const [settingsReady, setSettingsReady] = useState(false);
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
    setStore(withValidation(withStaffSecrets(m)));
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
    setStore(active ? withValidation(withStaffSecrets(new FirestoreStore(db, active.id, () => firebase().auth.currentUser?.uid))) : null);
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
    setSettingsReady(false);
    if (!store) {
      setSettingsDocs({});
      return;
    }
    return store.watch<{ id: keyof Settings }>(C.settings, undefined, (docs) => {
      const next: Partial<Settings> = {};
      for (const d of docs) (next as Record<string, unknown>)[d.id] = d;
      setSettingsDocs(next);
      setSettingsReady(true);
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

  const staffAuth = useCallback(
    async (req: StaffAuthRequest): Promise<StaffAuthResult> => {
      if (!tenant) throw new Error("no business selected");
      if (mode === "local") {
        const m = localStore.current;
        if (!m) throw new Error("no local data");
        return runStaffAuth(withStaffSecrets(m), req);
      }
      const offline = async (): Promise<StaffAuthResult> => {
        if (req.action === "verify") {
          const r = await offlinePin(tenant.id, req.staffId, req.pin);
          return r.ok ? { ok: true, staffId: req.staffId } : { ok: false, reason: r.reason ?? "Wrong PIN" };
        }
        if (req.action === "identifyCard") {
          const id = await offlineCard(tenant.id, req.card);
          return id ? { ok: true, staffId: id } : { ok: false, reason: "No connection to the server: sign in with your employee number" };
        }
        return { ok: false, reason: "No connection to the server" };
      };
      if (!navigator.onLine) return offline();
      try {
        const res = await httpsCallable(firebase().functions, "posAuth", { timeout: 8000 })({ tenantId: tenant.id, ...req });
        const r = res.data as StaffAuthResult;
        // Remember on this device for sign-in during an internet outage (lib/offline-pin).
        if (r.ok && req.action === "verify") void rememberPin(tenant.id, req.staffId, req.pin);
        if (r.ok && req.action === "identifyCard") void rememberCard(tenant.id, req.card, r.staffId);
        return r;
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        const msg = (e as { message?: string }).message?.replace(/^.*?:\s*/, "") ?? "";
        if (/unavailable|deadline-exceeded|internal/.test(code) || /network|fetch/i.test(msg)) return offline();
        return { ok: false, reason: msg || "The PIN could not be checked" };
      }
    },
    [tenant, mode],
  );

  // A write the server refused after the screen moved on (offline-tolerant writes): tell the user.
  useEffect(() => {
    const on = (e: Event) => toast(`Not saved on the server: ${String((e as CustomEvent).detail).replace(/^.*?:\s*/, "")}`, true);
    window.addEventListener("pos-suite:write-failed", on);
    return () => window.removeEventListener("pos-suite:write-failed", on);
  }, [toast]);

  // Unexpected errors are kept in the business's clientErrors (Administration → System status).
  useEffect(() => {
    if (!store) return setErrorSink(null);
    const uid = mode === "firebase" ? firebase().auth.currentUser?.uid : (DEMO_PEOPLE[personaRef.current]?.uid ?? "local");
    if (!uid) return setErrorSink(null);
    setErrorSink(async (r) => store.set(C.clientErrors, { ...r, uid }));
    return () => setErrorSink(null);
  }, [store, mode, user?.uid]);

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
    async (name: string, withSample: false | SampleKind, chosen?: MK[]) => {
      const sample = withSample ? await sampleOps(withSample) : null;
      // Demo data runs on the demo edition; a new client business starts a trial with the
      // modules chosen at installation (always within the edition's entitlement).
      const plan: Tenant["plan"] = withSample ? "demo" : "trial";
      const ent = builtInEntitlements(plan);
      const requested = chosen ? Object.fromEntries(chosen.map((k) => [k, true])) : (sample?.modules ?? { pos: true, tables: true, recipes: true, revenue: true });
      const licensing = { plan, entitlements: ent, modules: clampModules(requested, ent), ...(plan === "trial" ? { trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString() } : {}) };
      const base = defaultSettings(name);
      // A new client business gets its outlet, stores, payment methods, roles and chart of accounts
      // at once (sample-data starter kit), so every module works from the first screen.
      const starter: Settings = {
        ...base,
        pos: { ...base.pos, defaultPropertyId: STARTER_PROPERTY_ID },
        accounting: { ...base.accounting, ledger: { ...(base.accounting as AccountingSettings & { ledger: LedgerSettings }).ledger, defaultCostCenter: STARTER_PROPERTY_ID } } as AccountingSettings,
      };
      const configOps: WriteOp[] = sample?.ops ?? [
        ...Object.values(starter).map((data): WriteOp => ({ op: "set", col: C.settings, data })),
        ...starterConfig({ name, addressLines: base.business.addressLines, modules: licensing.modules }),
      ];
      const openYear = !sample && licensing.modules.accounting;
      const now = new Date().toISOString();
      if (mode === "local") {
        const t: Tenant = { id: "local", name, ownerUid: "local-owner", ...licensing, status: "active", createdAt: now };
        const m = new MemoryStore();
        await withStaffSecrets(m).batch(configOps);
        if (openYear) await runLedgerRequest({ runner: storeRunner(m), store: m, now: () => new Date(), sealDelayMs: 0 }, { uid: "local-owner", name, role: "owner" }, { action: "ensureFiscalYear", date: todayColombo() });
        if (withSample) {
          await m.merge(C.settings, "branding", { displayName: name.replace(/ \(demo\)$/, "") });
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
        // An owner/administrator adding a business (e.g. a training copy) proves it with their current one;
        // the very first business in a new project claims the deployment (see firestore.rules).
        const from = tenant && memberships.some((m) => m.tenantId === tenant.id && (m.role === "owner" || m.role === "admin")) ? tenant.id : undefined;
        const t = { id, name, ownerUid: user.uid, ...licensing, status: "active", createdAt: now, ...(from ? { createdFromTenant: from } : {}) } as Tenant;
        const b = writeBatch(db);
        const deployment = await getDoc(doc(db, "deployment", "config")).catch(() => null);
        if (deployment && !deployment.exists()) b.set(doc(db, "deployment", "config"), { ownerUid: user.uid, openSignup: false, createdAt: now });
        b.set(doc(db, "tenants", id), t);
        b.set(doc(db, "tenants", id, "members", user.uid), { id: user.uid, uid: user.uid, email: user.email, name: user.name, role: "owner", tenantId: id, createdAt: now });
        await b.commit();
        const fs = withStaffSecrets(new FirestoreStore(db, id, () => firebase().auth.currentUser?.uid));
        await fs.batch(configOps);
        // The fiscal year is created by the ledger function (clients can't write it).
        if (openYear) await httpsCallable(firebase().functions, "ledgerApi")({ tenantId: id, action: "ensureFiscalYear", date: todayColombo() }).catch(() => undefined);
        localStorage.setItem("pos-suite.activeTenant", id);
      } finally {
        creating.current = false;
      }
      await loadMemberships(user);
    },
    [mode, user, openLocal, loadMemberships, tenant, memberships],
  );

  const switchTenant = useCallback(
    (id: string) => {
      localStorage.setItem("pos-suite.activeTenant", id);
      const t = tenants.find((x) => x.id === id) ?? null;
      setTenant(t);
      setStore(t && mode === "firebase" ? withValidation(withStaffSecrets(new FirestoreStore(firebase().db, t.id, () => firebase().auth.currentUser?.uid))) : store);
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

  const lic = useMemo(() => licenceInfo(tenant), [tenant]);

  const activateLicence = useCallback(
    async (token: string) => {
      if (!tenant) return;
      if (mode === "local") {
        const { payload } = await verifyLicence(token, LICENCE_PUBLIC_KEY, { projectId: "local", tenantId: tenant.id }, new Date());
        const licence = { token: token.trim(), licenceId: payload.licenceId, licensee: payload.licensee.name, edition: payload.edition, addOns: payload.addOns, billing: payload.billing, validFrom: payload.validFrom, expiresAt: payload.expiresAt, graceDays: payload.graceDays, activatedAt: new Date().toISOString(), activatedBy: actor?.uid ?? "local", demoKey: LICENCE_PUBLIC_KEY === DEMO_LICENCE_PUBLIC_KEY };
        await updateTenant({ plan: payload.edition, entitlements: payload.entitlements, licence, modules: clampModules(tenant.modules, payload.entitlements) });
        return;
      }
      await httpsCallable(firebase().functions, "licenceApi")({ tenantId: tenant.id, action: "activate", token: token.trim() });
    },
    [tenant, mode, actor, updateTenant],
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
    settingsReady,
    on: (m) => Boolean(tenant?.modules?.[m]) && lic.usable && lic.entitlements.modules.includes(m),
    toast,
    signIn: async (email, password) => {
      await signInWithEmailAndPassword(firebase().auth, email, password);
    },
    signUp: async (email, password, name) => {
      const cred = await createUserWithEmailAndPassword(firebase().auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      // Invitations are only accepted from a verified address, so nobody can claim someone else's invite.
      await sendEmailVerification(cred.user).catch(() => undefined);
    },
    resetPassword: async (email) => {
      await sendPasswordResetEmail(firebase().auth, email).catch((e: { code?: string }) => {
        // Don't reveal whether an address has an account; only report real problems.
        if (e.code === "auth/user-not-found") return;
        throw e;
      });
    },
    signOut: async () => {
      if (mode === "local") return;
      await firebaseSignOut(firebase().auth);
    },
    createTenant,
    switchTenant,
    updateTenant,
    licence: lic,
    activateLicence,
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
    staffAuth,
    personName: (uid) => {
      if (!uid) return "—";
      const demo = Object.values(DEMO_PEOPLE).find((p) => p.uid === uid);
      return demo?.name ?? memberNames[uid] ?? (user?.uid === uid ? user.name : uid.length > 14 ? `${uid.slice(0, 8)}…` : uid);
    },
    acceptInvite: async () => {
      if (mode !== "firebase" || !user?.email) return false;
      const { db, auth } = firebase();
      const me = auth.currentUser;
      if (me && !me.emailVerified) {
        await me.reload();
        if (!auth.currentUser?.emailVerified) {
          await sendEmailVerification(me).catch(() => undefined);
          throw new Error(`verify your email address first: open the link we sent to ${user.email} (check spam), then press this button again`);
        }
        await me.getIdToken(true);
      }
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
