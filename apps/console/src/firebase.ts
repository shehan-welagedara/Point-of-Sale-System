import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, connectAuthEmulator, getAuth } from "firebase/auth";
import { type Firestore, connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { type Functions, connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";

const env = import.meta.env;

interface WebConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  appId?: string;
}

/** On Firebase Hosting the console reads its own project's settings at start-up (no config in the build). */
const config: WebConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** The console's emulator ports (firebase.console.json), so it runs beside a client's emulators. */
export const EMULATOR = { auth: 9199, firestore: 8180, functions: 5101 };
export const usingEmulators = env.VITE_USE_EMULATORS === "true";

export async function loadConfig(): Promise<boolean> {
  if (config.apiKey && config.projectId) return true;
  try {
    const res = await fetch("/__/firebase/init.json", { cache: "no-store" });
    if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) Object.assign(config, await res.json());
  } catch {
    /* not on Hosting */
  }
  return Boolean(config.apiKey && config.projectId);
}

let fb: { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions } | null = null;

export function firebase() {
  if (fb) return fb;
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const functions = getFunctions(app, (env.VITE_FUNCTIONS_REGION as string | undefined) || "asia-south1");
  if (usingEmulators) {
    connectAuthEmulator(auth, `http://127.0.0.1:${EMULATOR.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", EMULATOR.firestore);
    connectFunctionsEmulator(functions, "127.0.0.1", EMULATOR.functions);
  }
  fb = { app, auth, db, functions };
  return fb;
}

export function projectId(): string {
  return config.projectId ?? "";
}

/** Every change goes through the console's server (role checked, audited). */
export async function call<T = Record<string, unknown>>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const fn = httpsCallable(firebase().functions, "consoleApi");
  const r = await fn({ action, ...data });
  return r.data as T;
}

/** The message of a failed call, without Firebase's prefixes. */
export function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  return m.replace(/^FirebaseError:\s*/, "").replace(/^Firebase:\s*/, "").replace(/\s*\(functions\/[a-z-]+\)\.?$/, "");
}
