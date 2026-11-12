/**
 * Rehearses an update of a live client: the deploy that runs on every release after the first
 * (backup → indexes → data updates → rules and functions → web app → version check), end to end,
 * with Google played by stand-ins:
 *
 * - a local web server answers for the client's site (/version.json) and for Google's Storage,
 *   Firestore export, project and sign-in APIs, and records every call;
 * - the Firestore emulator holds a client whose businesses were created on 1.5.8, reached through a
 *   relay that speaks only HTTP/1.1 (as through antivirus HTTPS scanning or a proxy), so the data
 *   updates must work without HTTP/2 (1.8.0 used gRPC and failed on such a PC);
 * - a stand-in `pnpm` records the Firebase deploy commands (it loads the built server functions the
 *   way Firebase does, and publishes the new version.json when the web app is "deployed");
 * - a throw-away Firebase CLI sign-in, so the backup and the data updates use the person's sign-in
 *   exactly as on a PC.
 *
 * Then checks the order of the steps, the backup, that the data updates changed only what they
 * should, that a second run changes nothing, and that a failed backup stops the deploy before
 * anything is touched.  Run:  pnpm test:update   (needs Java for the Firestore emulator)
 */
import { createServer as createHttp, request as httpRequest } from "node:http";
import { createServer as createHttps } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run under the Firestore emulator (pnpm test:update)");
const require = createRequire(join(root, "apps/functions/package.json"));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PROJECT = "demo-noura-kitchen";
const OLD = "1.5.8";
const version = JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8")).version;
initializeApp({ projectId: PROJECT });
const db = getFirestore();

let failed = 0;
const check = (ok, msg, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${msg}${!ok && detail ? `\n    ${detail}` : ""}`);
  if (!ok) failed++;
};

// ───────────── The client's data, as 1.5.8 left it (real business + a demo copy) ─────────────
const T = "noura-kitchen-k3x9q";
const D = "noura-kitchen-demo-p2m7d";
const at = "2026-11-12T03:15:00.000Z";
const seed = {
  "deployment/config": { ownerUid: "owner-uid", openSignup: false, createdAt: at },
  [`tenants/${T}`]: { id: T, name: "Noura Kitchen", ownerUid: "owner-uid", plan: "standard", modules: ["pos", "tables", "recipes", "inventory", "purchasing", "accounting", "revenue"], status: "active", createdAt: at },
  [`tenants/${T}/members/owner-uid`]: { id: "owner-uid", uid: "owner-uid", email: "owner@example.test", name: "Owner", role: "owner", tenantId: T, createdAt: at },
  [`tenants/${T}/settings/branding`]: { id: "branding", displayName: "Noura Kitchen", receiptHeaderLines: ["No. 12, Galle Road"], receiptFooterLines: ["Thank you!"], poweredBy: "POS Suite (demo)" },
  [`tenants/${T}/settings/business`]: { id: "business", name: "Noura Kitchen", addressLines: ["No. 12, Galle Road", "Colombo 03"], currency: "LKR" },
  [`tenants/${T}/accounts/1000`]: { id: "1000", code: "1000", name: "Cash", type: "asset", parentId: "1", isGroup: false },
  [`tenants/${T}/accounts/3900`]: { id: "3900", code: "3900", name: "Opening balances (temporary)", type: "equity", parentId: "3", isGroup: false },
  [`tenants/${T}/staff/1001`]: { id: "1001", name: "Kasun", status: "active", pinSet: true, roleIds: ["cashier"] },
  [`tenants/${T}/staffSecrets/1001`]: { id: "1001", pinHash: "h".repeat(64), pinSalt: "s".repeat(32), pinChangedAt: at },
  [`tenants/${T}/menuItems/m1`]: { id: "m1", name: "Chicken kottu", price: 1_450_00, active: true },
  [`tenants/${T}/checks/c1`]: { id: "c1", number: 1, status: "closed", total: 1_450_00, closedAt: at },
  [`tenants/${D}`]: { id: D, name: "Noura Kitchen (demo)", ownerUid: "owner-uid", plan: "standard", modules: ["pos"], status: "active", createdAt: "2026-11-12T03:05:00.000Z" },
  [`tenants/${D}/settings/branding`]: { id: "branding", displayName: "Noura Kitchen", poweredBy: "POS Suite (demo)" },
};
for (const [path, data] of Object.entries(seed)) await db.doc(path).set(data);
const snapshot = async () => {
  const out = {};
  const walk = async (ref) => {
    for (const c of await ref.listCollections()) {
      for (const d of (await c.get()).docs) {
        out[d.ref.path] = d.data();
        await walk(d.ref);
      }
    }
  };
  for (const c of await db.listCollections()) {
    for (const d of (await c.get()).docs) {
      out[d.ref.path] = d.data();
      await walk(d.ref);
    }
  }
  return out;
};
const before = await snapshot();

// ───────────── Stand-ins for Google and the client's site ─────────────
const dir = mkdtempSync(join(tmpdir(), "pos-update-"));
const hosted = join(dir, "hosted");
const state = { live: OLD, bucket: null, iam: null, exportFails: false, siteDown: false, calls: [], auth: new Set() };
// HTTPS with a throw-away certificate when openssl is there: the Firebase CLI sends a placeholder
// token to plain-HTTP addresses (it takes them for emulators), so only HTTPS shows the real sign-in.
const certDir = join(dir, "tls");
mkdirSync(certDir);
const tls = spawnSync("openssl", ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" }).status === 0;
if (!tls) console.log("(openssl not found: the stand-ins use plain HTTP and the sign-in check is skipped)");
const handler = async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const url = new URL(req.url, "http://x");
  const path = decodeURIComponent(url.pathname);
  state.calls.push(`${req.method} ${path}`);
  if (!path.startsWith("/site/") && !path.startsWith("/token/")) state.auth.add(`${req.headers.authorization ?? "none"}`);
  if (process.env.DEBUG_UPDATE) console.log(`    [stand-in] ${req.method} ${path} ${req.headers.authorization ?? "(no sign-in)"}`);
  const json = (status, data) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const gerr = (status, message) => json(status, { error: { code: status, message, status: status === 404 ? "NOT_FOUND" : "PERMISSION_DENIED" } });
  // The site starts reporting the new version once the web app is "deployed".
  if (existsSync(hosted)) {
    state.live = version;
    rmSync(hosted);
  }
  if (path === `/site/${PROJECT}/version.json`) return state.siteDown ? json(503, {}) : json(200, { version: state.live, commit: "abc1234" });
  if (path.includes("/token")) return json(200, { access_token: "stand-in-access", expires_in: 3600, token_type: "Bearer" });
  if (path === `/rm/v1/projects/${PROJECT}`) return json(200, { projectId: PROJECT, projectNumber: "123456789012" });
  const bucket = `${PROJECT}-backups`;
  if (req.method === "GET" && path === `/storage/storage/v1/b/${bucket}`) return state.bucket ? json(200, state.bucket) : gerr(404, "The specified bucket does not exist.");
  if (req.method === "POST" && path === "/storage/storage/v1/b") {
    state.bucket = { ...JSON.parse(body), project: url.searchParams.get("project") };
    return json(200, state.bucket);
  }
  if (path === `/storage/storage/v1/b/${bucket}/iam`) {
    if (req.method === "PUT") state.iam = JSON.parse(body);
    return json(200, state.iam ?? { bindings: [{ role: "roles/storage.legacyBucketOwner", members: [`projectOwner:${PROJECT}`] }], etag: "CAE=" });
  }
  if (req.method === "POST" && path === `/fs/v1/projects/${PROJECT}/databases/(default):exportDocuments`) {
    if (state.exportFails) return gerr(403, "The caller does not have permission");
    state.exportTo = JSON.parse(body).outputUriPrefix;
    return json(200, { name: `projects/${PROJECT}/databases/(default)/operations/op-1`, done: false });
  }
  if (path === `/fs/v1/projects/${PROJECT}/databases/(default)/operations/op-1`) return json(200, { name: `projects/${PROJECT}/databases/(default)/operations/op-1`, done: true, response: { outputUriPrefix: state.exportTo } });
  gerr(404, `stand-in has no ${req.method} ${path}`);
};
const server = tls ? createHttps({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, handler) : createHttp(handler);
await new Promise((r) => server.listen(0, "127.0.0.1", r));

// The deploy reaches the database only through an HTTP/1.1 relay: anything that needs HTTP/2 fails here.
const [emuHost, emuPort] = process.env.FIRESTORE_EMULATOR_HOST.split(":");
const relayed = { ok: 0, refused: 0 };
const relay = createHttp((req, res) => {
  relayed.ok++;
  const up = httpRequest({ host: emuHost, port: emuPort, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(up);
});
relay.on("clientError", (_e, socket) => {
  relayed.refused++;
  socket.destroy();
});
await new Promise((r) => relay.listen(0, "127.0.0.1", r));
const base = `${tls ? "https" : "http"}://127.0.0.1:${server.address().port}`;

// Stand-in pnpm: Firebase commands are recorded (and checked the way Firebase would), everything else runs.
const bin = join(dir, "bin");
mkdirSync(bin);
const realPnpm = spawnSync(process.platform === "win32" ? "where" : "which", ["pnpm"], { encoding: "utf8" }).stdout.trim().split(/\r?\n/)[0];
const firebaseLog = join(dir, "firebase.log");
writeFileSync(
  join(bin, "pnpm"),
  `#!${process.execPath}
const { appendFileSync, readFileSync, writeFileSync, existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] !== "exec" || args[1] !== "firebase") process.exit(spawnSync(${JSON.stringify(realPnpm)}, args, { stdio: "inherit" }).status ?? 1);
const entry = { args: args.slice(2) };
const only = args[args.indexOf("--only") + 1] ?? "";
if (args[2] === "deploy" && only.split(",").includes("functions")) {
  // Firebase loads the code to find the functions, with the project's .env files.
  const envFile = ${JSON.stringify(join(root, "apps/functions/dist"))} + "/.env.${PROJECT}";
  entry.env = existsSync(envFile) ? readFileSync(envFile, "utf8") : null;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", "const m = await import(process.argv[1]); console.log(JSON.stringify(Object.keys(m).sort()))", ${JSON.stringify(join(root, "apps/functions/dist/index.js"))}], { encoding: "utf8", env: { ...process.env, GCLOUD_PROJECT: "${PROJECT}" } });
  entry.functions = r.status === 0 ? JSON.parse(r.stdout.trim().split("\\n").pop()) : { error: r.stderr.slice(-400) };
}
if (args[2] === "deploy" && only === "hosting") writeFileSync(${JSON.stringify(join(dir, "hosted"))}, "1");
appendFileSync(${JSON.stringify(firebaseLog)}, JSON.stringify(entry) + "\\n");
`,
);
chmodSync(join(bin, "pnpm"), 0o755);
// Stand-in node (Linux and macOS): notes the Google credentials the data updates are given, then runs node.
const credLog = join(dir, "migration-credentials.txt");
if (process.platform !== "win32") {
  writeFileSync(
    join(bin, "node"),
    `#!/bin/sh
case "$*" in *migrate.mjs*) if [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]; then { stat -c %a "$GOOGLE_APPLICATION_CREDENTIALS" 2>/dev/null || stat -f %Lp "$GOOGLE_APPLICATION_CREDENTIALS"; cat "$GOOGLE_APPLICATION_CREDENTIALS"; } > ${JSON.stringify(credLog)}; fi;; esac
exec ${JSON.stringify(process.execPath)} "$@"
`,
  );
  chmodSync(join(bin, "node"), 0o755);
}
// A Firebase CLI sign-in that only exists for this rehearsal.
const config = join(dir, "config");
mkdirSync(join(config, "configstore"), { recursive: true });
writeFileSync(
  join(config, "configstore/firebase-tools.json"),
  JSON.stringify({ user: { email: "release-rehearsal@example.test" }, tokens: { access_token: "stand-in-access", refresh_token: "stand-in-refresh", expires_at: Date.now() + 3_600_000, scopes: ["https://www.googleapis.com/auth/cloud-platform"] } }),
);
const registry = join(dir, "clients.json");
writeFileSync(registry, JSON.stringify({ staging: { id: "staging", projectId: "REPLACE" }, clients: [{ id: "noura-kitchen", name: "Noura Kitchen", projectId: PROJECT, region: "asia-south1", wave: 1, backupBucket: `gs://${PROJECT}-backups`, enabled: true }] }));

const tempSignIns = () => readdirSync(tmpdir()).filter((n) => n.startsWith("pos-release-"));
// Runs the deploy as a separate process (this one answers for Google meanwhile).
const deploy = async (extra = []) => {
  const r = await new Promise((done) => {
    const child = spawn(process.execPath, ["tools/release/deploy.mjs", "--target", "noura-kitchen", "--registry", registry, ...extra], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`,
      HOME: dir,
      XDG_CONFIG_HOME: config,
      CI: "",
      GITHUB_ACTIONS: "",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      POS_LIVE_BASE: `${base}/site/{project}`,
      FIREBASE_STORAGE_URL: `${base}/storage`,
      FIRESTORE_URL: `${base}/fs`,
      FIREBASE_RESOURCEMANAGER_URL: `${base}/rm`,
      FIREBASE_TOKEN_URL: `${base}/token`,
      FIREBASE_GOOGLE_URL: `${base}/token`,
      CONSOLE_URL: "",
      LICENCE_PUBLIC_KEY: "",
      ...(tls ? { NODE_EXTRA_CA_CERTS: join(certDir, "cert.pem") } : {}),
      FIRESTORE_EMULATOR_HOST: `127.0.0.1:${relay.address().port}`,
      NO_PROXY: [process.env.NO_PROXY, "127.0.0.1"].filter(Boolean).join(","),
      no_proxy: [process.env.no_proxy, "127.0.0.1"].filter(Boolean).join(","),
    },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 600_000);
    child.on("close", (status) => {
      clearTimeout(timer);
      done({ status, out });
    });
  });
  const out = r.out;
  const fb = existsSync(firebaseLog) ? readFileSync(firebaseLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  rmSync(firebaseLog, { force: true });
  return { status: r.status, out, fb };
};
const order = (out, steps) => steps.map((s) => out.indexOf(s)).every((i, n, a) => i >= 0 && (n === 0 || i > a[n - 1]));
const only = (fb) => fb.filter((e) => e.args[0] === "deploy").map((e) => e.args[e.args.indexOf("--only") + 1]);

try {
  // ───────────── 1. The update: OLD → this version ─────────────
  console.log(`\n▶ Update ${OLD} → ${version} on a client with live data`);
  const signInsBefore = tempSignIns();
  const r1 = await deploy();
  if (r1.status !== 0) console.log(r1.out.split("\n").slice(-30).join("\n"));
  check(r1.status === 0, `the deploy finishes (exit ${r1.status})`);
  check(r1.out.includes(`live now: ${OLD}`), `it sees ${OLD} live, so this is an update, not a first deploy`);
  check(order(r1.out, ["backup →", "✓ backup finished", "firestore:indexes", "migrating:", "firestore:rules,functions", "--only hosting", `reports ${version}`]), "steps run in order: backup, indexes, data updates, rules and functions, web app, version check");
  check(state.bucket?.location === "asia-south1" && state.bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled && state.bucket.lifecycle?.rule?.[0]?.condition?.age === 90 && state.bucket.project === PROJECT, "backup bucket created in the client's project and region, old backups deleted after 90 days");
  check(state.iam?.bindings?.some((b) => b.role === "roles/storage.admin" && b.members.includes("serviceAccount:service-123456789012@gcp-sa-firestore.iam.gserviceaccount.com")) && state.iam.bindings.some((b) => b.role === "roles/storage.legacyBucketOwner"), "Firestore's service agent may write the backup (existing bucket permissions kept)");
  check(new RegExp(`^gs://${PROJECT}-backups/pre-release/${version.replace(/\./g, "\\.")}-\\d{4}-`).test(state.exportTo ?? ""), `the whole database exported to gs://…/pre-release/${version}-<time>`, state.exportTo);
  check(only(r1.fb).join(" | ") === "firestore:indexes | firestore:rules,functions | hosting", "Firebase deploys indexes, then rules and functions, then the web app", only(r1.fb).join(" | "));
  check(!r1.fb.some((e) => e.args.includes("--force")), "no --force on an update (Firebase would ask before deleting anything)");
  check(!r1.out.includes("checking the project's permissions") && !r1.out.includes("creating the web address"), "first-deploy steps skipped");
  const fnDeploy = r1.fb.find((e) => only([e])[0]?.includes("functions"));
  check(Array.isArray(fnDeploy?.functions) && ["consoleCheckin", "consoleLinkNow", "auditSealer", "ledgerApi", "licenceApi", "posAuth", "deviceApi"].every((f) => fnDeploy.functions.includes(f)), `the server functions load and include the new ones (${Array.isArray(fnDeploy?.functions) ? fnDeploy.functions.length : 0} functions)`, JSON.stringify(fnDeploy?.functions));
  check(/^LOCATION=asia-south1$/m.test(fnDeploy?.env ?? "") && new RegExp(`^APP_VERSION=${version.replace(/\./g, "\\.")}$`, "m").test(fnDeploy?.env ?? "") && !/CONSOLE_URL/.test(fnDeploy?.env ?? ""), "the functions' settings name the region and the release (no console address until one is set up)", fnDeploy?.env);
  check(/0001-deployment-owner/.test(r1.out) && /0004-powered-by/.test(r1.out) && /4 applied/.test(r1.out), "all four data updates run once", r1.out.match(/migrations: .*/)?.[0] ?? r1.out.split("\n").filter((l) => /UNAVAILABLE|stopped/.test(l)).join(" "));
  check(relayed.ok > 0 && relayed.refused === 0, "the data updates use plain HTTPS (HTTP/1.1): no HTTP/2 needed, so antivirus scanning or a proxy can't break them", `${relayed.ok} relayed, ${relayed.refused} refused`);
  const after = await snapshot();
  const changed = Object.keys({ ...before, ...after }).filter((p) => JSON.stringify(before[p]) !== JSON.stringify(after[p]));
  const expected = [`tenants/${T}/settings/branding`, `tenants/${D}/settings/branding`];
  const records = changed.filter((p) => p.startsWith("deployment/config/migrations/"));
  check(after[`tenants/${T}/settings/branding`]?.poweredBy === "Polymath Tech" && after[`tenants/${D}/settings/branding`]?.poweredBy === "Polymath Tech", 'bills now say "Powered by Polymath Tech" (both businesses)');
  check(JSON.stringify(after["deployment/config"]) === JSON.stringify(before["deployment/config"]), "the deployment owner recorded at sign-up is kept (0001 skips)");
  check(records.length === 4, "each data update is recorded");
  const other = changed.filter((p) => !expected.includes(p) && !records.includes(p));
  check(other.length === 0, "nothing else in the client's data changed (sales, staff, PINs, accounts, menu)", other.join(", "));
  check(JSON.stringify({ ...after[`tenants/${T}/settings/branding`], poweredBy: "x" }) === JSON.stringify({ ...before[`tenants/${T}/settings/branding`], poweredBy: "x" }), "the rest of the bill settings untouched");
  if (tls) check([...state.auth].join() === "Bearer stand-in-access", "the backup used the Firebase CLI sign-in (no Google Cloud CLI)", [...state.auth].join());
  if (process.platform !== "win32") {
    const [mode, ...json] = existsSync(credLog) ? readFileSync(credLog, "utf8").trim().split("\n") : [""];
    const cred = json.length ? JSON.parse(json.join("\n")) : {};
    check(mode === "600" && cred.type === "authorized_user" && cred.refresh_token === "stand-in-refresh" && Boolean(cred.client_id), "the data updates get the same sign-in through a file only this user can read", `mode ${mode}, type ${cred.type}`);
  }
  check(tempSignIns().length === signInsBefore.length, "that file is deleted afterwards");

  // ───────────── 2. Running the same deploy again ─────────────
  console.log("\n▶ The same deploy again (safe to repeat)");
  const calls = state.calls.length;
  const r2 = await deploy();
  check(r2.status === 0 && r2.out.includes(`live now: ${version}`), "finishes, seeing the new version live");
  check(!state.calls.slice(calls).some((c) => c.startsWith("POST /storage")), "the existing backup bucket is reused");
  check(/0 applied, 4 known/.test(r2.out), "no data update runs twice");
  const again = await snapshot();
  check(Object.keys(again).every((p) => p.startsWith("deployment/config/migrations/") || JSON.stringify(again[p]) === JSON.stringify(after[p])), "the client's data is unchanged");

  // ───────────── 3. A backup that fails stops everything ─────────────
  console.log("\n▶ When the backup fails");
  state.exportFails = true;
  const r3 = await deploy();
  state.exportFails = false;
  check(r3.status === 1 && r3.out.includes("the pre-release backup failed") && r3.out.includes("Nothing has been changed"), "the deploy stops and says nothing was changed", r3.out.split("\n").filter((l) => l.includes("✗")).join(" "));
  check(r3.out.includes("The caller does not have permission"), "Google's reason is shown");
  check(r3.fb.length === 0 && !r3.out.includes("migrating"), "no Firebase deploy and no data update ran");

  // ───────────── 4. When the site can't be reached ─────────────
  console.log("\n▶ When the live site can't be checked");
  state.siteDown = true;
  const callsBefore4 = state.calls.length;
  const r4 = await deploy();
  state.siteDown = false;
  check(r4.status === 1 && r4.out.includes("can't tell what is live") && r4.fb.length === 0 && !state.calls.slice(callsBefore4).some((c) => !c.startsWith("GET /site/")), "the deploy stops before doing anything (a live client is never treated as new)");
} finally {
  server.close();
  relay.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} update check(s) failed` : `\nThe update rehearsal passed (${OLD} → ${version})`);
process.exit(failed ? 1 : 0);
