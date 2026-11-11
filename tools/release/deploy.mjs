/**
 * Deploys the built release to staging or to client projects, one client at a time, safely:
 *
 *   node tools/release/deploy.mjs --target staging
 *   node tools/release/deploy.mjs --target wave:1            (pilot clients)
 *   node tools/release/deploy.mjs --target kandy-myst         (one client; comma-separate several)
 *   options: --dry-run  --skip-backup  --first-deploy  --only hosting|functions|rules|indexes (comma list)
 *
 * For each project: backup (Firestore export) → indexes → data migrations → rules and functions →
 * hosting → check that /version.json reports the new version. Stops at the first failure.
 * Needs Google credentials with deploy rights on each project (CI: workload identity; laptop:
 * `gcloud auth login`, `gcloud auth application-default login` and `pnpm exec firebase login`).
 * Works from Windows, macOS and Linux. Run by hand, it builds the web app first when needed.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runCommand } from "./run-cmd.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dryRun = flag("dry-run");
const win = process.platform === "win32";
const ci = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const parts = new Set((opt("only") ?? "indexes,rules,functions,hosting").split(","));
const target = opt("target");
if (!target) fail("--target is required (staging, wave:N or client ids)");

const registry = JSON.parse(readFileSync(resolve(root, opt("registry") ?? "release/clients.json"), "utf8"));
const version = JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8")).version;

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function targets() {
  if (target === "staging") return [registry.staging];
  const enabled = registry.clients.filter((c) => c.enabled !== false);
  if (target.startsWith("wave:")) {
    const w = Number(target.slice(5));
    return enabled.filter((c) => c.wave === w);
  }
  return target.split(",").map((id) => registry.clients.find((c) => c.id === id) ?? fail(`unknown client "${id}" (release/clients.json)`));
}

const HINT = {
  gcloud: "Install the Google Cloud CLI (https://cloud.google.com/sdk/docs/install), then run `gcloud auth login` and `gcloud auth application-default login`. The first deploy of a new client doesn't need it.",
  pnpm: "Install pnpm (https://pnpm.io/installation) and run `pnpm install` in the project folder.",
};

/** Runs a command; on Windows through the shell, so pnpm.cmd and gcloud.cmd are found. */
function exec(cmd, args, { always = false } = {}) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  if (dryRun && !always) return;
  const r = runCommand(cmd, args, { cwd: root, stdio: "inherit", env: process.env });
  if (r.error) fail(`${cmd} could not start (${r.error.message}). ${HINT[cmd] ?? ""}`);
  if (r.status !== 0) fail(`${cmd} ${args[0]} failed (exit ${r.status})${cmd === "gcloud" ? `. ${HINT.gcloud}` : ""}`);
}
const run = (cmd, args) => exec(cmd, args);

const firebase = (project, only) => run("pnpm", ["exec", "firebase", "deploy", "--only", only, "--project", project, "--non-interactive"]);

function preflight() {
  const live = join(root, "apps/web/dist/version.json");
  const stale = () => !existsSync(live) || JSON.parse(readFileSync(live, "utf8")).version !== version;
  if (stale()) {
    // CI builds once and deploys that same build everywhere; by hand, build it now.
    if (ci) fail("no web build of this version: run `pnpm build` first");
    console.log(`Building the web app (version ${version}) first…`);
    exec("pnpm", ["build"], { always: true });
    if (stale()) fail("the build did not produce apps/web/dist/version.json for this version");
  }
  const built = JSON.parse(readFileSync(live, "utf8"));
  // A build made with apps/web/.env.local would point every client at that one project.
  const assets = join(root, "apps/web/dist/assets");
  for (const f of readdirSync(assets).filter((n) => n.endsWith(".js"))) {
    if (/AIza[0-9A-Za-z_-]{35}/.test(readFileSync(join(assets, f), "utf8"))) fail(`the build contains a Firebase API key (${f}): build without apps/web/.env.local so each client uses its own project`);
  }
  const fnEnv = join(root, "apps/functions/.env");
  const fnKey = existsSync(fnEnv) && /^LICENCE_PUBLIC_KEY=\S+/m.test(readFileSync(fnEnv, "utf8"));
  if (!process.env.LICENCE_PUBLIC_KEY && !fnKey) console.warn("! No licence public key in apps/functions/.env: the system will accept only demo licence keys. Run `pnpm deploy:setup` to add yours.");
  return built;
}

/**
 * What is live on a project: { version } when a release is deployed, { none: true } only when Firebase
 * Hosting clearly answers "nothing here" (404), and { unknown } for anything else (no connection, an
 * error page): a live client is never mistaken for an empty one.
 */
async function liveState(projectId) {
  try {
    const r = await fetch(`https://${projectId}.web.app/version.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (r.status === 404) return { none: true };
    if (!r.ok) return { unknown: `HTTP ${r.status}` };
    const v = (await r.json().catch(() => ({}))).version;
    return v ? { version: v } : { unknown: "version.json without a version" };
  } catch (e) {
    return { unknown: e?.cause?.code ?? e?.message ?? "no connection" };
  }
}

/** The backup bucket (90-day retention) in the client's project, created the first time it's needed. */
function ensureBackupBucket(c) {
  if (dryRun) return;
  const describe = runCommand("gcloud", ["storage", "buckets", "describe", c.backupBucket, "--project", c.projectId], { cwd: root, stdio: "ignore" });
  if (describe.error) fail(`gcloud could not start (${describe.error.message}). ${HINT.gcloud}`);
  if (describe.status === 0) return;
  console.log(`  creating the backup bucket ${c.backupBucket} (old backups deleted after 90 days)`);
  exec("gcloud", ["storage", "buckets", "create", c.backupBucket, "--project", c.projectId, "--location", c.region ?? "asia-south1", "--uniform-bucket-level-access"]);
  const lifecycle = join(tmpdir(), "pos-backup-lifecycle.json");
  writeFileSync(lifecycle, '{"rule":[{"action":{"type":"Delete"},"condition":{"age":90}}]}');
  exec("gcloud", ["storage", "buckets", "update", c.backupBucket, `--lifecycle-file=${lifecycle}`]);
  // Firestore's own service agent writes the export files.
  const number = runCommand("gcloud", ["projects", "describe", c.projectId, "--format=value(projectNumber)"], { cwd: root, encoding: "utf8" }).stdout?.trim();
  if (number) exec("gcloud", ["storage", "buckets", "add-iam-policy-binding", c.backupBucket, `--member=serviceAccount:service-${number}@gcp-sa-firestore.iam.gserviceaccount.com`, "--role=roles/storage.admin"]);
}

async function verify(projectId) {
  const url = `https://${projectId}.web.app/version.json`;
  for (let i = 0; i < 6; i++) {
    try {
      const v = await (await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" })).json();
      if (v.version === version) return console.log(`  ✓ ${url} reports ${v.version}`);
    } catch {
      /* not live yet */
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  fail(`${url} does not report ${version}`);
}

const list = targets();
if (!list.length) fail(`no enabled projects for ${target}`);
const built = preflight();
console.log(`Release ${version} (${built.commit}) → ${list.map((c) => c.id).join(", ")}${dryRun ? " [dry run]" : ""}`);
const summary = [`### Release ${version} → ${target}`, "", "| Client | Project | Result |", "|---|---|---|"];

for (const c of list) {
  if (!c.projectId || c.projectId.startsWith("REPLACE")) fail(`${c.id}: set its projectId in release/clients.json`);
  console.log(`\n▶ ${c.name} (${c.projectId})`);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // --first-deploy: the person deploying says this client has never been deployed (when the check can't tell).
  const state = flag("first-deploy") ? { none: true } : await liveState(c.projectId);
  if (state.unknown && !dryRun) fail(`can't tell what is live on https://${c.projectId}.web.app (${state.unknown}). Check the internet connection (\`pnpm deploy:check\`) and run the deploy again. If this client has never been deployed, add --first-deploy.`);
  const first = Boolean(state.none);
  const before = state.version;
  console.log(before ? `  live now: ${before}` : first ? "  nothing deployed yet: this is the first deploy" : `  ! couldn't check what is live (${state.unknown})`);
  if (flag("skip-backup")) console.warn("  ! --skip-backup: no pre-release backup");
  else if (first) console.log("  first deploy: nothing to back up yet");
  else if (c.backupBucket && !c.backupBucket.includes("REPLACE")) {
    ensureBackupBucket(c);
    run("gcloud", ["firestore", "export", `${c.backupBucket}/pre-release/${version}-${stamp}`, "--project", c.projectId, "--quiet"]);
  } else console.warn("  ! no backupBucket in release/clients.json: skipping the pre-release backup (run pnpm deploy:setup)");
  if (parts.has("indexes")) firebase(c.projectId, "firestore:indexes");
  // Data updates (migrations) need Google application default credentials (gcloud). A new project has
  // no data yet: the first deploy skips them, and the next deploy runs them (each is safe to run later).
  if (first) console.log("  first deploy: no data to update yet (data updates run from the next deploy on)");
  else run("node", ["tools/release/migrate.mjs", "--project", c.projectId, ...(dryRun ? ["--dry-run"] : [])]);
  if (parts.has("functions")) {
    // Per-project function settings (Firebase reads .env.<projectId> next to the functions code).
    const env = [`LOCATION=${c.region ?? "asia-south1"}`, ...(process.env.LICENCE_PUBLIC_KEY ? [`LICENCE_PUBLIC_KEY=${process.env.LICENCE_PUBLIC_KEY}`] : [])].join("\n");
    if (!dryRun) writeFileSync(join(root, `apps/functions/dist/.env.${c.projectId}`), `${env}\n`);
  }
  const rulesAndFunctions = ["rules", "functions"].filter((p) => parts.has(p)).map((p) => (p === "rules" ? "firestore:rules" : "functions"));
  if (rulesAndFunctions.length) firebase(c.projectId, rulesAndFunctions.join(","));
  if (parts.has("hosting")) {
    firebase(c.projectId, "hosting");
    if (!dryRun) await verify(c.projectId);
  }
  summary.push(`| ${c.name} | ${c.projectId} | ${dryRun ? "dry run" : "deployed"} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
console.log(`\n✓ ${version} ${dryRun ? "would be" : "is"} live on ${list.length} project(s).`);
