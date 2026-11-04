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

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

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
