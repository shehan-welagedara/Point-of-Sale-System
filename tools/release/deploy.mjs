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
 * Needs Google credentials with deploy rights on each project: on a PC only `pnpm exec firebase login`
 * (backups and data updates use that sign-in too, see google.mjs); on GitHub Actions, workload identity.
 * Works from Windows, macOS and Linux. Run by hand, it builds the web app first when needed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { runCommand } from "./run-cmd.mjs";
import { ensureFunctionsAccess } from "./functions-access.mjs";
import { childCredentials, ensureBackupBucket, exportFirestore } from "./google.mjs";
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
// Firebase gives the functions code 10 seconds to load before it deploys them ("User code failed to
// load … Timeout after 10000"). A Windows PC with antivirus scanning can take longer the first time.
process.env.FUNCTIONS_DISCOVERY_TIMEOUT ||= "60";
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
  pnpm: "Install pnpm (https://pnpm.io/installation) and run `pnpm install` in the project folder.",
};

/**
 * Runs a command; on Windows through the shell, so pnpm.cmd is found. Stops the deploy
 * when it fails, unless `soft` (then returns false so the caller can try again).
 */
function exec(cmd, args, { always = false, soft = false, env = {} } = {}) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  if (dryRun && !always) return true;
  const r = runCommand(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (r.error) fail(`${cmd} could not start (${r.error.message}). ${HINT[cmd] ?? ""}`);
  if (r.status === 0) return true;
  if (soft) return false;
  fail(`${cmd} ${args[0]} failed (exit ${r.status})`);
}
const run = (cmd, args) => exec(cmd, args);

const firebase = (project, only, extra = [], opts = {}) => exec("pnpm", ["exec", "firebase", "deploy", "--only", only, "--project", project, "--non-interactive", ...extra], opts);

/** A Firebase CLI command's --json answer ({ status, result }), or null. */
function firebaseJson(args) {
  const r = runCommand("pnpm", ["exec", "firebase", ...args, "--json"], { cwd: root, encoding: "utf8", env: process.env, timeout: 120_000 });
  const out = r.stdout ?? "";
  try {
    return JSON.parse(out.slice(out.indexOf("{")));
  } catch {
    return null;
  }
}

/**
 * New Firebase projects have no Hosting site (the web address) until one is created, and the Firebase CLI
 * won't create it in a scripted deploy. Creates https://<projectId>.web.app, linked to the project's web
 * app so the system can read its Firebase settings from Hosting.
 */
function ensureHostingSite(c) {
  if (dryRun) return console.log(`  first deploy: creates the web address https://${c.projectId}.web.app if the project has none yet`);
  const listed = firebaseJson(["hosting:sites:list", "--project", c.projectId]);
  const sites = listed?.result?.sites;
  if (!Array.isArray(sites)) return console.warn(`  ! couldn't list the project's Hosting sites (${listed?.error ?? "no answer"}); trying the deploy anyway`);
  if (sites.some((s) => s.type === "DEFAULT_SITE")) return;
  const apps = firebaseJson(["apps:list", "WEB", "--project", c.projectId])?.result;
  const app = Array.isArray(apps) ? apps[0] : undefined;
  if (!app) console.warn("  ! the project has no web app yet: register one (deployment manual B, \"Register the web app\") so the system can read its Firebase settings");
  console.log(`  creating the web address https://${c.projectId}.web.app`);
  exec("pnpm", ["exec", "firebase", "hosting:sites:create", c.projectId, "--project", c.projectId, "--non-interactive", ...(app?.appId ? ["--app", app.appId] : [])]);
  const again = firebaseJson(["hosting:sites:list", "--project", c.projectId])?.result?.sites;
  if (Array.isArray(again) && !again.some((s) => s.type === "DEFAULT_SITE")) {
    fail(`the web address was created but Firebase doesn't treat it as the project's main site. Open Firebase console → Build → Hosting → Get started (click through to the end), then run the deploy again.`);
  }
}

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
  if (parts.has("functions")) {
    // Built here, not only by Firebase's predeploy step: on Windows the Firebase CLI runs that step
    // through cross-env, which turns every "/" in it into "\" (so a filter like @pos/functions matched
    // nothing and the functions were never built). The dry run builds too, so it catches a broken build.
    console.log("Building the server functions…");
    exec("pnpm", ["run", "build:functions"], { always: true });
    for (const f of ["package.json", "index.js"]) {
      if (!existsSync(join(root, "apps/functions/dist", f))) fail(`the server functions build did not produce apps/functions/dist/${f}. Run \`pnpm run build:functions\` and read its error.`);
    }
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

/** Pre-release backup: a Firestore export into the client's backup bucket (created the first time, 90-day retention). */
async function backup(c, stamp) {
  const target = `${c.backupBucket.replace(/\/$/, "")}/pre-release/${version}-${stamp}`;
  console.log(`  backup → ${target}`);
  if (dryRun) return;
  try {
    await ensureBackupBucket({ projectId: c.projectId, bucket: c.backupBucket, region: c.region ?? "asia-south1", log: (m) => console.log(`  ${m}`) });
    await exportFirestore({ projectId: c.projectId, outputUriPrefix: target, log: (m) => console.log(`  ${m}`) });
    console.log("  ✓ backup finished");
  } catch (e) {
    fail(`the pre-release backup failed: ${e.message}. Nothing has been changed on ${c.projectId}. Run the deploy again; if it keeps failing, check the bucket ${c.backupBucket} in the Google Cloud console.`);
  }
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
    await backup(c, stamp);
  } else console.warn("  ! no backupBucket in release/clients.json: skipping the pre-release backup (run pnpm deploy:setup)");
  if (parts.has("indexes")) firebase(c.projectId, "firestore:indexes");
  // A new project has no data yet: the first deploy skips the data updates, and the next deploy runs
  // them (each is safe to run later). They use the Firebase CLI's sign-in (google.mjs).
  if (first) console.log("  first deploy: no data to update yet (data updates run from the next deploy on)");
  else {
    const creds = childCredentials();
    const ok = exec("node", ["tools/release/migrate.mjs", "--project", c.projectId, ...(dryRun ? ["--dry-run"] : [])], { always: true, soft: true, env: creds.env });
    creds.cleanup();
    if (!ok) fail("the data updates (migrations) failed: read the error above. The backup taken before this deploy is in the client's backup bucket.");
  }
  if (parts.has("functions")) {
    // Per-project function settings (Firebase reads .env.<projectId> next to the functions code). The
    // functions are built into dist/ by Firebase just before they upload; on a fresh copy of the
    // project that folder doesn't exist yet.
    const env = [`LOCATION=${c.region ?? "asia-south1"}`, ...(process.env.LICENCE_PUBLIC_KEY ? [`LICENCE_PUBLIC_KEY=${process.env.LICENCE_PUBLIC_KEY}`] : [])].join("\n");
    if (!dryRun) {
      mkdirSync(join(root, "apps/functions/dist"), { recursive: true });
      writeFileSync(join(root, `apps/functions/dist/.env.${c.projectId}`), `${env}\n`);
    }
  }
  const rulesAndFunctions = ["rules", "functions"].filter((p) => parts.has(p)).map((p) => (p === "rules" ? "firestore:rules" : "functions"));
  if (rulesAndFunctions.length) {
    // First deploy: --force lets Firebase set the clean-up policy for old function images (it otherwise
    // stops to ask, which a scripted deploy can't answer). A new project has no functions to replace.
    const extra = first && parts.has("functions") ? ["--force"] : [];
    // First deploy: Firebase's own permission step only says "We failed to modify the IAM policy". This
    // switches on what the functions need, grants their roles and, if Google refuses, says why.
    if (first && parts.has("functions")) {
      if (dryRun) console.log("  first deploy: checks the project's permissions for the server functions (switches on the Compute Engine API if needed)");
      else {
        console.log("  checking the project's permissions for the server functions…");
        const access = await ensureFunctionsAccess(c.projectId);
        if (access.ok) console.log("  ✓ the server functions' permissions are in place");
        else if (access.unexpected) console.warn(`  ! ${access.problems.join(" ")}; continuing, Firebase will try itself`);
        else fail(`the server functions can't be deployed to ${c.projectId} yet:\n\n  ${access.problems.join("\n\n  ")}\n`);
      }
    }
    let done = firebase(c.projectId, rulesAndFunctions.join(","), extra, { soft: first });
    // A new project: Google switches on the services the functions need during this deploy and creates
    // their service accounts a few minutes later. Until then, granting them their roles fails ("We failed
    // to modify the IAM policy", "Eventarc Service Agent"). Waiting and trying again fixes it.
    const waits = first ? [3, 5] : [];
    for (let i = 0; !done && i < waits.length; i++) {
      const minutes = Number(process.env.POS_DEPLOY_RETRY_MINUTES ?? waits[i]);
      console.log(`\n  The server functions didn't finish (see the Error line above). On a brand-new project that is usual: Google is still creating the accounts and permissions they need.`);
      console.log(`  Waiting ${minutes} minutes, then trying again (attempt ${i + 2} of ${waits.length + 1}; nothing is lost, leave this window open)…\n`);
      await new Promise((r) => setTimeout(r, minutes * 60_000));
      done = firebase(c.projectId, rulesAndFunctions.join(","), extra, { soft: true });
    }
    if (!done) {
      fail("the server functions didn't deploy. Read the Error line above; deployment manual U lists the usual ones and what to do. Firebase's full log is in firebase-debug.log in this folder (send it to your supplier if you need help). Running the same deploy command again is safe: it continues where it stopped.");
    }
  }
  if (parts.has("hosting")) {
    if (first) ensureHostingSite(c);
    firebase(c.projectId, "hosting");
    if (!dryRun) await verify(c.projectId);
  }
  summary.push(`| ${c.name} | ${c.projectId} | ${dryRun ? "dry run" : "deployed"} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary.join("\n")}\n`);
console.log(`\n✓ ${version} ${dryRun ? "would be" : "is"} live on ${list.length} project(s).`);
