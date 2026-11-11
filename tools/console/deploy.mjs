/**
 * Builds and deploys the Polymath Console to its own Firebase project (docs/22):
 *
 *   pnpm console:deploy                 (project from release/console.json)
 *   pnpm console:deploy --project polymath-console [--dry-run]
 *
 * Web app, server functions, security rules and indexes, through firebase.console.json. On the first
 * deploy it also sets up the project's permissions for server functions and its web address.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureFunctionsAccess } from "../release/functions-access.mjs";
import { ensureHostingSite, root } from "../release/google.mjs";
import { runCommand } from "../release/run-cmd.mjs";

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const dryRun = argv.includes("--dry-run");
const saved = existsSync(join(root, "release/console.json")) ? JSON.parse(readFileSync(join(root, "release/console.json"), "utf8")) : {};
const project = opt("project") ?? saved.projectId;
const fail = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};
if (!project) fail("which project? Run `pnpm console:setup` first, or pass --project");
if (!existsSync(join(root, "apps/console-functions/.env"))) fail("run `pnpm console:setup` first (it stores the keys and writes apps/console-functions/.env)");

function run(cmd, args) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  if (dryRun) return true;
  const r = runCommand(cmd, args, { cwd: root, stdio: "inherit", env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60" } });
  return r.status === 0;
}

console.log(`\nPolymath Console → ${project}${dryRun ? " [dry run]" : ""}\n`);
if (!run("pnpm", ["run", "build:console"])) fail("the console web app didn't build");
if (!run("pnpm", ["run", "build:console-functions"])) fail("the console functions didn't build");

if (!dryRun) {
  console.log("  checking the project's permissions for server functions…");
  const access = await ensureFunctionsAccess(project);
  if (!access.ok && !access.unexpected) fail(access.problems.join("\n\n  "));
  // The web address (a new project has no Hosting site until one is created).
  try {
    await ensureHostingSite(project, (m) => console.log(`  ${m}`));
  } catch (e) {
    console.warn(`  ! couldn't check the web address (${e.message}); if the deploy says there is no Hosting site, open Firebase console → Hosting → Get started, then deploy again`);
  }
}

const deploy = (extra = []) => run("pnpm", ["exec", "firebase", "deploy", "--config", "firebase.console.json", "--project", project, "--non-interactive", "--force", ...extra]);
let done = deploy();
for (const wait of dryRun ? [] : [3, 5]) {
  if (done) break;
  console.log(`\n  Didn't finish (see above). A new project needs a few minutes before its server functions can be deployed: waiting ${wait} minutes, then trying again…\n`);
  await new Promise((r) => setTimeout(r, wait * 60_000));
  done = deploy();
}
if (!done) fail("the console didn't deploy. Read the Error line above; deployment manual U lists the usual messages. Running the same command again is safe.");
console.log(dryRun ? `\n✓ dry run: these steps would deploy https://${project}.web.app\n` : `\n✓ Polymath Console is live: https://${project}.web.app\n`);
