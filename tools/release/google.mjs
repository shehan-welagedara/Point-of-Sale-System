/**
 * Talks to Google Cloud for the release tools with the Firebase CLI's own sign-in, so the person
 * deploying needs only `pnpm exec firebase login` (no Google Cloud CLI). On GitHub Actions (no Firebase
 * login) the same calls use the workflow's Google credentials.
 *
 * - signIn / clients: authenticated API clients (firebase-tools' own, version pinned in package.json).
 * - ensureBackupBucket / exportFirestore: the pre-release backup.
 * - childCredentials: Google credentials for a child process (data migrations use firebase-admin).
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const httpStatus = (e) => String(e?.context?.response?.statusCode ?? e?.status ?? /HTTP Error: (\d+)/.exec(e?.message ?? "")?.[1] ?? "");
/** Google's own words, without the request URL. */
export const reason = (e) => String(e?.message ?? e).replace(/^Request to \S+ had /, "").replace(/^HTTP Error: \d+, /, "").replace(/\.+$/, "");

let signedIn;
/** Signs in with the Firebase CLI's account (or, without one, Google application default credentials). Returns the email. */
export async function signIn(projectId) {
  if (signedIn) return signedIn;
  const auth = require("firebase-tools/lib/auth");
  const { requireAuth } = require("firebase-tools/lib/requireAuth");
  const options = { project: projectId, projectRoot: root };
  const account = auth.selectAccount(undefined, root);
  if (account) auth.setActiveAccount(options, account);
  try {
    const who = await requireAuth(options);
    signedIn = who ?? account?.user?.email ?? "Google default credentials";
  } catch {
    throw new Error("the Firebase CLI isn't signed in. Run `pnpm exec firebase login`, then try again.");
  }
  return signedIn;
}

export function clients() {
  const api = require("firebase-tools/lib/api");
  const { Client } = require("firebase-tools/lib/apiv2");
  const c = (urlPrefix, apiVersion) => new Client({ urlPrefix, apiVersion });
  return {
    rm: c(api.resourceManagerOrigin(), "v1"),
    su: c(api.serviceUsageOrigin(), "v1"),
    suBeta: c(api.serviceUsageOrigin(), "v1beta1"),
    iam: c(api.iamOrigin(), "v1"),
    storage: c(api.storageOrigin(), "storage/v1"),
    firestore: c(api.firestoreOrigin(), "v1"),
  };
}

const numbers = {};
export async function projectNumber(projectId) {
  numbers[projectId] ??= (await clients().rm.get(`/projects/${projectId}`)).body.projectNumber;
  return numbers[projectId];
}

/** The backup bucket in the client's project: same region, uniform access, old exports deleted after 90 days. */
export async function ensureBackupBucket({ projectId, bucket, region = "asia-south1", log = () => {} }) {
  await signIn(projectId);
  const { storage } = clients();
  const name = bucket.replace(/^gs:\/\//, "").replace(/\/.*$/, "");
  try {
    await storage.get(`/b/${name}`);
    return;
  } catch (e) {
    if (httpStatus(e) !== "404") throw new Error(`couldn't check the backup bucket ${name}: ${reason(e)}`);
  }
  log(`creating the backup bucket gs://${name} (old backups deleted after 90 days)`);
  await storage.post(`/b?project=${encodeURIComponent(projectId)}`, {
    name,
    location: region,
    iamConfiguration: { uniformBucketLevelAccess: { enabled: true } },
    lifecycle: { rule: [{ action: { type: "Delete" }, condition: { age: 90 } }] },
  });
  // Firestore's own service agent writes the export files.
  const number = await projectNumber(projectId);
  const policy = (await storage.get(`/b/${name}/iam`)).body;
  policy.bindings ??= [];
  const member = `serviceAccount:service-${number}@gcp-sa-firestore.iam.gserviceaccount.com`;
  const binding = policy.bindings.find((b) => b.role === "roles/storage.admin");
  if (binding) binding.members = [...new Set([...(binding.members ?? []), member])];
  else policy.bindings.push({ role: "roles/storage.admin", members: [member] });
  await storage.put(`/b/${name}/iam`, policy);
}

/** Exports the whole Firestore database to `outputUriPrefix` (gs://…) and waits until it's finished. */
export async function exportFirestore({ projectId, outputUriPrefix, log = () => {}, pollMs = 5000, timeoutMs = 30 * 60_000 }) {
  await signIn(projectId);
  const { firestore } = clients();
  let op = (await firestore.post(`/projects/${projectId}/databases/(default):exportDocuments`, { outputUriPrefix })).body;
  const until = Date.now() + timeoutMs;
  let said = false;
  while (!op.done) {
    if (Date.now() > until) throw new Error(`the backup is still running after ${Math.round(timeoutMs / 60_000)} minutes (${op.name}); check it in the Google Cloud console before deploying`);
    if (!said) log("waiting for the backup to finish…");
    said = true;
    await sleep(pollMs);
    op = (await firestore.get(`/${op.name}`)).body;
  }
  if (op.error) throw new Error(`the backup failed: ${op.error.message ?? JSON.stringify(op.error)}`);
  return op;
}

/** Switches on Firestore's delete protection (so the database can't be deleted by mistake). Best effort. */
export async function protectDatabase(projectId) {
  await signIn(projectId);
  await clients().firestore.patch(`/projects/${projectId}/databases/(default)`, { deleteProtectionState: "DELETE_PROTECTION_ENABLED" }, { queryParams: { updateMask: "deleteProtectionState" } });
}

/**
 * Google credentials for a child process that uses Google's client libraries (firebase-admin). Uses what
 * is already there (GOOGLE_APPLICATION_CREDENTIALS, `gcloud auth application-default login`, or GitHub
 * Actions' credentials); otherwise lends the Firebase CLI's sign-in through a temporary file that only
 * this user can read and that `cleanup()` deletes.
 */
export function childCredentials() {
  const none = { env: {}, cleanup: () => {} };
  const adcFile = join(process.platform === "win32" ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")) : join(homedir(), ".config"), "gcloud", "application_default_credentials.json");
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || existsSync(adcFile) || process.env.CI || process.env.GITHUB_ACTIONS) return none;
  const auth = require("firebase-tools/lib/auth");
  const api = require("firebase-tools/lib/api");
  const refresh = auth.selectAccount(undefined, root)?.tokens?.refresh_token;
  if (!refresh) return none;
  const dir = mkdtempSync(join(tmpdir(), "pos-release-"));
  const file = join(dir, "credentials.json");
  writeFileSync(file, JSON.stringify({ type: "authorized_user", client_id: api.clientId(), client_secret: api.clientSecret(), refresh_token: refresh }), { mode: 0o600 });
  return { env: { GOOGLE_APPLICATION_CREDENTIALS: file }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
