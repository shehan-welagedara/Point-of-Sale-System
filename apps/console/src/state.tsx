import { type User, onIdTokenChanged, signOut } from "firebase/auth";
import { type DocumentData, type QueryConstraint, collection, collectionGroup, doc, onSnapshot, query } from "firebase/firestore";
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from "react";
import { call, errorText, firebase } from "./firebase";

export type Role = "owner" | "admin" | "sales" | "support" | "engineer";
export type Permission = "read" | "clients" | "licences" | "suspend" | "deploy" | "staff" | "settings";

const MATRIX: Record<Role, Permission[]> = {
  owner: ["read", "clients", "licences", "suspend", "deploy", "staff", "settings"],
  admin: ["read", "clients", "licences", "suspend", "deploy", "staff", "settings"],
  sales: ["read", "clients", "licences"],
  support: ["read"],
  engineer: ["read", "deploy"],
};

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", sales: "Sales", support: "Support", engineer: "Engineer" };

interface Session {
  user: User | null | undefined;
  role: Role | null;
  /** Why access was refused (not invited, email not verified …). */
  denied: string | null;
  can: (p: Permission) => boolean;
  signOut: () => Promise<void>;
  toast: (text: string, bad?: boolean) => void;
}

const Ctx = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [role, setRole] = useState<Role | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; bad?: boolean }[]>([]);

  useEffect(
    () =>
      onIdTokenChanged(firebase().auth, async (u) => {
        if (!u) {
          setUser(null);
          setRole(null);
          return;
        }
        const claims = (await u.getIdTokenResult()).claims;
        const r = (claims.consoleRole as Role | undefined) ?? null;
        if (r) {
          setRole(r);
          setDenied(null);
          setUser(u);
          return;
        }
        // First sign-in (or a role just granted): ask the server, then refresh the token.
        try {
          await call("claimAccess", { name: u.displayName ?? "" });
          await u.getIdToken(true);
        } catch (e) {
          setDenied(errorText(e));
          setUser(u);
        }
      }),
    [],
  );

  const value = useMemo<Session>(
    () => ({
      user,
      role,
      denied,
      can: (p) => Boolean(role && MATRIX[role].includes(p)),
      signOut: () => signOut(firebase().auth),
      toast: (text, bad) => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t, { id, text, bad }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), bad ? 7000 : 3500);
      },
    }),
    [user, role, denied],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.bad ? "bad" : ""}`}>
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Live query. `undefined` while loading. `key` must change whenever `constraints` change. */
export function useCol<T = DocumentData>(path: string | null, constraints: QueryConstraint[] = [], key = ""): T[] | undefined {
  const [docs, setDocs] = useState<T[] | undefined>(undefined);
  useEffect(() => {
    if (!path) return;
    setDocs(undefined);
    return onSnapshot(
      query(collection(firebase().db, path), ...constraints),
      (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T)),
      () => setDocs([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return docs;
}

/** Live query over every client's sub-collection of this name (payments, usage); adds clientId. */
export function useGroup<T = DocumentData>(name: string, constraints: QueryConstraint[] = [], key = ""): T[] | undefined {
  const [docs, setDocs] = useState<T[] | undefined>(undefined);
  useEffect(() => {
    setDocs(undefined);
    return onSnapshot(
      query(collectionGroup(firebase().db, name), ...constraints),
      (snap) => setDocs(snap.docs.map((d) => ({ id: d.id, clientId: d.ref.parent.parent?.id, ...d.data() }) as T)),
      () => setDocs([]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
  return docs;
}

/** Live document. `undefined` while loading, `null` when missing. */
export function useDocData<T = DocumentData>(path: string | null): T | null | undefined {
  const [data, setData] = useState<T | null | undefined>(undefined);
  useEffect(() => {
    if (!path) return;
    setData(undefined);
    return onSnapshot(
      doc(firebase().db, path),
      (snap) => setData(snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null),
      () => setData(null),
    );
  }, [path]);
  return data;
}

/** Runs a console action with a busy flag and a toast. */
export function useAction() {
  const { toast } = useSession();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(action: string, data: Record<string, unknown>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await call<T>(action, data);
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(errorText(e), true);
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
