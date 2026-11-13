/**
 * Polymath Console server functions (docs/22-polymath-console.md):
 *  - checkin      HTTPS: a client's daily check-in (Google-signed identity of its project)
 *  - consoleApi   callable: every change staff make (role checked, audited)
 *  - housekeeping daily: follows GitHub release runs and the latest version, applies retention
 *  - rollouts     every 15 minutes: starts updates that are due and follows them (releases.ts)
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { ActionError, type Deps, recordMetrics, runAction } from "./actions.js";
import { handleCheckin } from "./checkin.js";
import { applyRetention } from "./privacy.js";
import { runRollouts } from "./releases.js";
import { IdentityError, verifyGoogleIdToken } from "./identity.js";
import type { StaffRole } from "./model.js";

initializeApp();
const db = getFirestore();
setGlobalOptions({ region: process.env.LOCATION ?? "asia-south1", maxInstances: 3, memory: "256MiB" });

/** Your licence signing key (private half), stored by `pnpm console:setup`. */
const LICENCE_PRIVATE_KEY = defineSecret("LICENCE_PRIVATE_KEY");
/** A GitHub token that may start the release workflow ("none" until set). */
const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

const emulator = process.env.FUNCTIONS_EMULATOR === "true";
const project = process.env.GCLOUD_PROJECT ?? "";

/** Addresses clients send their check-in to (the audience of their identity token). */
function audiences(): string[] {
  const extra = (process.env.CONSOLE_DOMAINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return [`https://${project}.web.app/api/checkin`, `https://${project}.firebaseapp.com/api/checkin`, ...extra.map((d) => `https://${d}/api/checkin`)];
}

export const checkin = onRequest({ maxInstances: 5, timeoutSeconds: 30 }, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  const now = new Date();
  let email: string;
  try {
    // In the emulator, tests name the calling service account directly.
    const testIdentity = emulator ? req.get("x-test-identity") : undefined;
    if (testIdentity) email = testIdentity;
    else {
      const token = /^Bearer (.+)$/.exec(req.get("authorization") ?? "")?.[1];
      if (!token) throw new IdentityError("no identity token");
      email = (await verifyGoogleIdToken(token, audiences(), now.getTime())).email;
    }
  } catch (e) {
    res.status(401).json({ v: 1, ok: false, serverTime: now.toISOString(), error: (e as Error).message });
    return;
  }
  const r = await handleCheckin(db, email, req.body, now);
  res.status(r.status).json(r.body);
});

function deps(now: Date): Deps {
  return {
    db,
    now,
    ownerEmail: process.env.OWNER_EMAIL ?? "",
    privateKey: () => {
      const k = LICENCE_PRIVATE_KEY.value().trim();
      if (!k || k === "none") throw new Error("no key");
      return k;
    },
    githubToken: () => GITHUB_TOKEN.value().trim(),
    setRole: async (uid: string, role: StaffRole | null) => {
      await getAuth().setCustomUserClaims(uid, role ? { consoleRole: role } : {});
    },
  };
}

export const consoleApi = onCall({ secrets: [LICENCE_PRIVATE_KEY, GITHUB_TOKEN], maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "sign in first");
  const t = request.auth.token;
  try {
    const role = typeof t.consoleRole === "string" ? t.consoleRole : undefined;
    return await runAction(deps(new Date()), { uid: request.auth.uid, email: String(t.email ?? ""), emailVerified: t.email_verified === true, ...(role ? { role } : {}) }, (request.data ?? {}) as Record<string, unknown>);
  } catch (e) {
    if (e instanceof ActionError) throw new HttpsError(e.code, e.message);
    throw e;
  }
});

export const housekeeping = onSchedule({ schedule: "every day 06:15", timeZone: "Asia/Colombo", secrets: [LICENCE_PRIVATE_KEY, GITHUB_TOKEN] }, async () => {
  const system = { uid: "system", email: "system", emailVerified: true, role: "support" };
  await runAction(deps(new Date()), system, { action: "refreshDeployments" }).catch(() => undefined);
  await recordMetrics(db, new Date());
  await applyRetention(db, new Date());
});

export const rollouts = onSchedule({ schedule: "every 15 minutes", timeZone: "Asia/Colombo", secrets: [GITHUB_TOKEN] }, async () => {
  await runRollouts({ ...deps(new Date()), privateKey: () => "" });
});
