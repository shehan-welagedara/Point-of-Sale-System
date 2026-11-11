/**
 * Sets up the Polymath Console's Firebase project from this PC (docs/22-polymath-console.md §4):
 *
 *   pnpm console:setup
 *   pnpm console:setup --project polymath-console --owner you@example.com --yes
 *   pnpm console:setup --github-token          (asks for the GitHub token and stores it)
 *
 * 1. Stores your licence signing key (licence-keys/vendor-key.txt, private half) in the console
 *    project's Secret Manager as LICENCE_PRIVATE_KEY, and a GitHub token (or "none") as GITHUB_TOKEN.
 * 2. Writes apps/console-functions/.env (the owner's email, the region).
 * 3. Writes release/console.json and adds CONSOLE_URL to apps/functions/.env, so every client deploy
 *    after this checks in with the console.
 * Safe to run again.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { root } from "../release/google.mjs";
import { runCommand } from "../release/run-cmd.mjs";

const argv = process.argv.slice(2);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
};
const yes = argv.includes("--yes") || !process.stdin.isTTY;
const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def) => (rl ? (await rl.question(`  ${q}${def ? ` [${def}]` : ""}: `)).trim() || def || "" : def ?? "");
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};

function setEnv(file, values) {
  const path = join(root, file);
  let text = existsSync(path) ? readFileSync(path, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`;
  }
  writeFileSync(path, text);
}

/** Stores a secret value through the Firebase CLI (it switches on Secret Manager if needed). */
function setSecret(project, name, value) {
  const dir = mkdtempSync(join(tmpdir(), "pos-console-"));
  const file = join(dir, "value.txt");
  writeFileSync(file, value, { mode: 0o600 });
  try {
    const r = runCommand("pnpm", ["exec", "firebase", "functions:secrets:set", name, "--project", project, "--data-file", file, "--force", "--non-interactive"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    if (r.status !== 0) fail(`couldn't store ${name} in Secret Manager:\n${(r.stderr || r.stdout || "").trim().split("\n").slice(-6).join("\n")}\nIs the project on the Blaze plan, and are you signed in as its owner (pnpm exec firebase login)?`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\nPolymath Console: set up its Firebase project\n");
const saved = existsSync(join(root, "release/console.json")) ? JSON.parse(readFileSync(join(root, "release/console.json"), "utf8")) : {};
const project = (opt("project") ?? (await ask("Console's Firebase project ID", saved.projectId ?? "polymath-console"))).trim();
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) fail(`"${project}" isn't a Firebase project ID`);
const owner = (opt("owner") ?? (await ask("Owner's email (signs in first, as owner)", saved.owner))).trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(owner)) fail("enter the owner's email address");

const keyFile = join(root, "licence-keys", "vendor-key.txt");
if (!existsSync(keyFile)) fail("no licence signing key on this PC (licence-keys/vendor-key.txt). Copy it from your backup, or run `pnpm deploy:setup` to create one.");
const text = readFileSync(keyFile, "utf8");
const priv = /^private=(.+)$/m.exec(text)?.[1]?.trim();
const pub = /^public=(.+)$/m.exec(text)?.[1]?.trim();
if (!priv || !pub) fail(`${keyFile} has no key pair`);

console.log("\n1. Keys in Secret Manager (only the console's server functions can read them)");
setSecret(project, "LICENCE_PRIVATE_KEY", priv);
ok("LICENCE_PRIVATE_KEY: your licence signing key");
let token = argv.includes("--github-token") ? (opt("github-token") ?? (await ask("GitHub token that may run the release workflow (fine-grained, Actions: read and write)", ""))) : "";
if (token) {
  setSecret(project, "GITHUB_TOKEN", token.trim());
  ok("GITHUB_TOKEN: stored");
} else if (!saved.githubTokenSet) {
  setSecret(project, "GITHUB_TOKEN", "none");
  ok("GITHUB_TOKEN: none yet (Updates from the console need it: run `pnpm console:setup --github-token` later)");
}

console.log("\n2. Settings files");
setEnv("apps/console-functions/.env", { OWNER_EMAIL: owner, LOCATION: "asia-south1", LICENCE_PUBLIC_KEY: pub });
ok("apps/console-functions/.env: owner and region");
const url = `https://${project}.web.app`;
const checkin = `${url}/api/checkin`;
writeFileSync(join(root, "release/console.json"), `${JSON.stringify({ projectId: project, url, checkinUrl: checkin, owner, githubTokenSet: Boolean(token) || Boolean(saved.githubTokenSet) }, null, 2)}\n`);
ok("release/console.json");
setEnv("apps/functions/.env", { CONSOLE_URL: checkin });
ok(`apps/functions/.env: CONSOLE_URL=${checkin} (client deploys from now on check in here)`);
rl?.close();

console.log(`\n3. Next\n\n    pnpm console:deploy\n\n  Then open ${url}, sign in as ${owner}, and add your clients (docs/22 §4).\n  For GitHub Actions releases, also set the repository variable CONSOLE_URL=${checkin}.\n`);
