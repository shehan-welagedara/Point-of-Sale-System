/**
 * Runs pending data migrations on one Firebase project, in file-name order, each exactly once:
 *
 *   node tools/release/migrate.mjs --project <projectId> [--dry-run]
 *
 * Migrations live in tools/release/migrations/NNNN-name.mjs and export { id, description, up }.
 * Applied ones are recorded in deployment/config/migrations/{id}. Every migration must be safe to
 * run twice and must work with the previous app version still running (expand → migrate →
 * contract over separate releases). Fiscal records (invoices, ledger, POS journal) are never edited.
 * Uses Google application default credentials, or the Firestore emulator when
 * FIRESTORE_EMULATOR_HOST is set.
 *
 * Talks to Firestore over plain HTTPS (REST), like the rest of the release tool, not gRPC: gRPC needs
 * HTTP/2 all the way to Google, which antivirus HTTPS scanning and some proxies break on Windows PCs
 * ("14 UNAVAILABLE: No connection established. Last error: Protocol error").
 */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { initializeFirestore, FieldValue } = require("firebase-admin/firestore");

const argv = process.argv.slice(2);
const i = argv.indexOf("--project");
const projectId = i >= 0 ? argv[i + 1] : undefined;
const dryRun = argv.includes("--dry-run");
if (!projectId) {
  console.error("--project is required");
  process.exit(1);
}

const app = initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
const db = initializeFirestore(app, { preferRest: true });
// On the emulator the REST transport needs the emulator's own sign-in (gRPC sends it by itself).
if (process.env.FIRESTORE_EMULATOR_HOST) db.settings({ auth: { getRequestHeaders: async () => ({ Authorization: "Bearer owner" }) } });

/** Explains a failure in plain words (the full error is printed too). */
function explain(e) {
  const m = String(e?.message ?? e);
  if (/UNAVAILABLE|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|fetch failed|Protocol error/i.test(m)) {
    return "couldn't reach Firestore. Check the internet connection (`pnpm deploy:check`), then run the same deploy again: data updates that already ran are not repeated.";
  }
  if (/PERMISSION_DENIED|UNAUTHENTICATED|invalid_grant|Could not load the default credentials|insufficient/i.test(m)) {
    return "Google refused the sign-in for the data updates. Run `pnpm exec firebase login --reauth` with the project owner's account, then deploy again.";
  }
  return "read the error above. Nothing after the last \"migrating:\" line ran; deploying again continues from there.";
}
process.on("unhandledRejection", (e) => {
  console.error(e);
  console.error(`\n  data updates stopped: ${explain(e)}`);
  process.exit(1);
});
const version = (await import(pathToFileURL(join(root, "apps/web/package.json")).href, { with: { type: "json" } })).default.version;

const dir = join(root, "tools/release/migrations");
const files = readdirSync(dir).filter((f) => /^\d{4}-.+\.mjs$/.test(f)).sort();
let applied = 0;
for (const f of files) {
  const m = await import(pathToFileURL(join(dir, f)).href);
  const record = db.doc(`deployment/config/migrations/${m.id}`);
  if ((await record.get()).exists) continue;
  if (dryRun) {
    console.log(`  pending: ${m.id} — ${m.description}`);
    continue;
  }
  console.log(`  migrating: ${m.id} — ${m.description}`);
  const result = await m.up({ db, FieldValue, log: (s) => console.log(`    ${s}`) });
  await record.set({ id: m.id, description: m.description, appliedAt: new Date().toISOString(), appVersion: version, result: result ?? null });
  applied++;
}
console.log(`  migrations: ${applied} applied${dryRun ? " (dry run)" : ""}, ${files.length} known`);
