import { type FirebaseApp, initializeApp } from "firebase/app";
import { type Auth, connectAuthEmulator, getAuth } from "firebase/auth";
import { type Functions, connectFunctionsEmulator, getFunctions } from "firebase/functions";
import {
  type Firestore,
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const env = import.meta.env;

export interface WebConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

/**
 * The client's Firebase project. One build serves every client: on Firebase Hosting the config is
 * read at start-up from /__/firebase/init.json, which Hosting serves for whichever project the
 * site is deployed to. A build-time config (apps/web/.env.local) still wins, for development
 * and the emulators.
 */
export const firebaseConfig: WebConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Call once before rendering. Never throws: without a config the app runs in local demo mode. */
export async function loadFirebaseConfig(): Promise<void> {
  if (firebaseConfig.apiKey && firebaseConfig.projectId) return;
  if (new URLSearchParams(location.search).get("mode") === "local") return;
  try {
    const res = await fetch("/__/firebase/init.json", { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return;
    const c = (await res.json()) as WebConfig;
    if (c.apiKey && c.projectId) Object.assign(firebaseConfig, { apiKey: c.apiKey, authDomain: c.authDomain, projectId: c.projectId, storageBucket: c.storageBucket, messagingSenderId: c.messagingSenderId, appId: c.appId });
  } catch {
    /* not on Firebase Hosting (local demo, vite dev) */
  }
}

/** Firebase mode when a web config is present (and `?mode=local` is not forced). */
export function firebaseConfigured(): boolean {
  if (new URLSearchParams(location.search).get("mode") === "local") return false;
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

let cached: { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions } | null = null;

export function firebase(): { app: FirebaseApp; auth: Auth; db: Firestore; functions: Functions } {
  if (cached) return cached;
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  // Persistent cache keeps the POS selling through short internet drops; writes sync on reconnect.
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  // Must match the region the functions are deployed to (apps/functions/.env LOCATION).
  const functions = getFunctions(app, (env.VITE_FUNCTIONS_REGION as string | undefined) || "asia-south1");
  if (env.VITE_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  }
  cached = { app, auth, db, functions };
  return cached;
}
