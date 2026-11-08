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
 */
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/functions/package.json"));
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const argv = process.argv.slice(2);
const i = argv.indexOf("--project");
const projectId = i >= 0 ? argv[i + 1] : undefined;
const dryRun = argv.includes("--dry-run");
if (!projectId) {
  console.error("--project is required");
  process.exit(1);
}

initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
const db = getFirestore();
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
