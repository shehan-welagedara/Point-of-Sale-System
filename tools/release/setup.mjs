/**
 * Prepares this computer to deploy one client, in one go (deployment manual E and F):
 *
 *   pnpm deploy:setup
 *   pnpm deploy:setup --client noura-kitchen --name "Noura Kitchen" --project noura-kitchen-pos --yes
 *
 * 1. Checks the tools and sign-ins the deploy needs, and says exactly what to do for any that's missing.
 * 2. Creates your licence signing key the first time (or reuses it) and puts its public half in the two
 *    settings files: apps/web/.env.production and apps/functions/.env.
 * 3. Registers the client in release/clients.json (project ID, region, backup bucket, switched on).
 * 4. Prints the two commands that deploy it.
 *
 * Safe to run again: it only fills in or updates those values. Works on Windows, macOS and Linux.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { checkNetwork } from "./netcheck.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const yes = argv.includes("--yes") || !process.stdin.isTTY;
const win = process.platform === "win32";
const registryPath = resolve(root, opt("registry") ?? "release/clients.json");

const ok = (m) => console.log(`  ✓ ${m}`);
const todo = [];
/** Not needed for the first deploy, but before the first update (backups and data updates). */
const later = [];
const notYet = (m, fix) => {
  console.log(`  ! ${m}`);
  later.push(fix);
};
const missing = (m, fix) => {
  console.log(`  ✗ ${m}`);
  todo.push(fix);
};

function quiet(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", shell: win, timeout: 60_000 });
  return { ok: !r.error && r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });
async function ask(question, def) {
  if (!rl) return def ?? "";
  const a = (await rl.question(`  ${question}${def ? ` [${def}]` : ""}: `)).trim();
  return a || def || "";
}

/** Sets KEY=value in a .env file, keeping every other line (and comments) as they are. */
function setEnv(file, values) {
  const path = join(root, file);
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!text && file === "apps/functions/.env" && existsSync(join(root, "apps/functions/.env.example"))) text = readFileSync(join(root, "apps/functions/.env.example"), "utf8");
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

console.log("\nPOS Suite: set up this computer to deploy a client\n");

// ── 1. Tools and sign-ins ──
console.log("1. Tools and sign-ins");
const node = Number(process.versions.node.split(".")[0]);
if (node >= 22) ok(`Node.js ${process.versions.node}`);
else missing(`Node.js ${process.versions.node} (22 or newer needed)`, "Install Node.js 22 LTS from nodejs.org, then run `pnpm install` again.");
if (await checkNetwork({ quiet: true })) ok("Node.js can reach Google and Firebase");
else todo.push("Fix the connection as shown above (then `pnpm deploy:check` confirms it).");
if (quiet("git", ["--version"]).ok) ok("Git");
else missing("Git not found", "Install Git from git-scm.com (on Windows it includes Git Bash).");
const fb = quiet("pnpm", ["exec", "firebase", "login:list"]);
const fbAccount = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(fb.out)?.[0];
if (fb.ok && fbAccount && !/No authorized accounts/i.test(fb.out)) ok(`Firebase CLI signed in as ${fbAccount}`);
else missing("Firebase CLI not signed in", `Run \`pnpm exec firebase login${process.env.CLOUD_SHELL === "true" ? " --no-localhost" : ""}\` and sign in with the Google account that is a member of the client's project (manual B.3). If it fails, run \`pnpm deploy:check\`.`);
const gcloud = quiet("gcloud", ["--version"]);
if (gcloud.ok) {
  ok("Google Cloud CLI");
  const acct = quiet("gcloud", ["config", "get-value", "account"]).out.trim().split(/\s+/).find((s) => s.includes("@"));
  if (acct) ok(`gcloud signed in as ${acct}`);
  else notYet("gcloud not signed in (needed from the second deploy on)", "Run `gcloud auth login`.");
} else notYet("Google Cloud CLI not installed (not needed for the first deploy; needed for backups and data updates from the second deploy on)", "Install the Google Cloud CLI from cloud.google.com/sdk/docs/install (Windows: the installer), open a new terminal, then run `gcloud auth login`.");
const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS || join(win ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming")) : join(homedir(), ".config"), "gcloud", "application_default_credentials.json");
if (existsSync(adc) || process.env.CLOUD_SHELL === "true") ok("Application default credentials (used for data updates)");
else notYet("Application default credentials not set (needed from the second deploy on)", "Run `gcloud auth application-default login` (after installing the Google Cloud CLI).");

// ── 2. Licence key and settings files ──
console.log("\n2. Licence key and settings files");
const keyFile = join(root, "licence-keys", "vendor-key.txt");
if (!existsSync(keyFile)) {
  const make = (await ask("No licence signing key on this computer yet. Create it now? (y/n)", "y")).toLowerCase().startsWith("y");
  if (make) {
    const r = spawnSync(process.execPath, [join(root, "tools/licence/run.mjs"), "keygen"], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(1);
    }
    ok("Licence signing key created in licence-keys/vendor-key.txt");
    console.log("    ! Back this file up now (USB drive in a safe, password manager). If it is lost, you can't issue licences for existing clients.");
  }
}
const publicKey = existsSync(keyFile) ? /^public=(.+)$/m.exec(readFileSync(keyFile, "utf8"))?.[1]?.trim() : undefined;
if (publicKey) {
  setEnv("apps/web/.env.production", { VITE_LICENCE_PUBLIC_KEY: publicKey });
  ok("apps/web/.env.production has your licence public key");
} else missing("No licence key: the system will accept only demo licence keys", "Run `pnpm deploy:setup` again and answer y to create the licence key (once, for all clients).");

// ── 3. The client ──
console.log("\n3. The client");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const placeholder = (v) => !v || String(v).startsWith("REPLACE") || String(v).includes("REPLACE");
const first = registry.clients.find((c) => placeholder(c.projectId));
const id = (opt("client") ?? (await ask("Client id (short, lowercase, e.g. noura-kitchen)", first?.id ?? registry.clients[0]?.id))).trim();
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
  console.error(`\n✗ "${id}" isn't a valid client id: use lowercase letters, digits and dashes.`);
  process.exit(1);
}
const existing = registry.clients.find((c) => c.id === id);
const name = (opt("name") ?? (await ask("Client name (as it appears in reports)", existing?.name ?? id))).trim();
const project = (opt("project") ?? (await ask("Firebase project ID (Firebase console → Project settings → Project ID)", placeholder(existing?.projectId) ? undefined : existing?.projectId))).trim();
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
  console.error(`\n✗ "${project}" isn't a Firebase project ID. It is lowercase, 6–30 characters, e.g. noura-kitchen-pos (see Project settings in the Firebase console).`);
  process.exit(1);
}
const region = opt("region") ?? existing?.region ?? "asia-south1";
const entry = { ...(existing ?? { id, wave: 1, maintenanceWindow: "23:30-05:00 Asia/Colombo" }), id, name, projectId: project, region, backupBucket: `gs://${project}-backups`, enabled: true };
if (existing) Object.assign(existing, entry);
else registry.clients.push(entry);
writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
ok(`release/clients.json: ${id} → ${project} (${region}), switched on`);
setEnv("apps/functions/.env", { LOCATION: region, ...(publicKey ? { LICENCE_PUBLIC_KEY: publicKey } : {}) });
ok(`apps/functions/.env: region ${region}${publicKey ? " and licence public key" : ""}`);
rl?.close();

// ── 4. Next ──
console.log("\n4. Next");
if (todo.length) {
  console.log("  First fix these, then run `pnpm deploy:setup` again to check:");
  todo.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
}
console.log(`  ${todo.length ? "Then deploy" : "Deploy"}: see every step first (nothing changes), then deploy for real:\n`);
console.log(`    pnpm release:deploy --target ${id} --dry-run`);
console.log(`    pnpm release:deploy --target ${id}\n`);
console.log("  The first deploy takes 5–10 minutes. Commit release/clients.json so the next update finds this client.\n");
if (later.length) {
  console.log("  Before the first UPDATE (not needed now):");
  later.forEach((t, i) => console.log(`   ${i + 1}. ${t}`));
  console.log("");
}
process.exit(todo.length ? 2 : 0);
