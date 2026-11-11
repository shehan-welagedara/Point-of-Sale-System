/**
 * Makes sure a client's project lets the server functions be deployed, and says exactly what is wrong
 * when it doesn't. Uses the Firebase CLI's sign-in (no Google Cloud CLI needed):
 *
 *   pnpm deploy:access --project noura-kitchen-pos
 *
 * Run by `release:deploy` before the first deploy of the server functions. Firebase's own step only
 * says "We failed to modify the IAM policy for the project" and hides Google's reason. This checks, in
 * order, and fixes what it can:
 *   1. your Google account may change the project's permissions (it must be an Owner);
 *   2. the Compute Engine API is on: switching it on creates the "Compute Engine default service
 *      account" that the server functions run as (new projects don't have it until then);
 *   3. that account and the Pub/Sub and Eventarc service agents exist;
 *   4. they have the three roles Firebase needs (Cloud Run Invoker, Eventarc Event Receiver, Service
 *      Account Token Creator), granted here with Google's own error message if it refuses.
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "package.json"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (e) => e?.context?.response?.statusCode ?? e?.status ?? /HTTP Error: (\d+)/.exec(e?.message ?? "")?.[1];
/** Google's own words, without the request URL. */
const reason = (e) => String(e?.message ?? e).replace(/^Request to \S+ had /, "").replace(/^HTTP Error: \d+, /, "").replace(/\.+$/, "");

async function signIn(projectId) {
  const auth = require("firebase-tools/lib/auth");
  const { requireAuth } = require("firebase-tools/lib/requireAuth");
  const options = { project: projectId, projectRoot: root };
  const account = auth.selectAccount(undefined, root);
  if (!account) throw new Error("the Firebase CLI isn't signed in. Run `pnpm exec firebase login`, then deploy again.");
  auth.setActiveAccount(options, account);
  await requireAuth(options);
  return account.user?.email ?? "your Google account";
}

function clients() {
  const api = require("firebase-tools/lib/api");
  const { Client } = require("firebase-tools/lib/apiv2");
  return {
    rm: new Client({ urlPrefix: api.resourceManagerOrigin(), apiVersion: "v1" }),
    su: new Client({ urlPrefix: api.serviceUsageOrigin(), apiVersion: "v1" }),
    suBeta: new Client({ urlPrefix: api.serviceUsageOrigin(), apiVersion: "v1beta1" }),
    iam: new Client({ urlPrefix: api.iamOrigin(), apiVersion: "v1" }),
  };
}

/**
 * Returns { ok, problems }. `problems` are plain-language steps for the person deploying. Never
 * throws for a problem it can explain; an unexpected error comes back as a problem too.
 */
export async function ensureFunctionsAccess(projectId, { log = (m) => console.log(`  ${m}`), waitSeconds = 180, pollMs = 5000 } = {}) {
  const problems = [];
  const consoleUrl = (path) => `https://console.cloud.google.com/${path}?project=${projectId}`;
  try {
    const email = await signIn(projectId);
    const { rm, su, suBeta, iam } = clients();
    const number = (await rm.get(`/projects/${projectId}`)).body.projectNumber;

    // 1. May this account change the project's permissions?
    const wanted = ["resourcemanager.projects.getIamPolicy", "resourcemanager.projects.setIamPolicy", "serviceusage.services.enable"];
    const allowed = (await rm.post(`/projects/${projectId}:testIamPermissions`, { permissions: wanted })).body.permissions ?? [];
    if (!allowed.includes("resourcemanager.projects.setIamPolicy")) {
      problems.push(
        `Your Google account ${email} can't change the permissions of ${projectId}: it needs the Owner role. Either sign the Firebase CLI in with the account that created the project (\`pnpm exec firebase login:add\`, then \`pnpm exec firebase login:use THAT-EMAIL\`), or have the owner give ${email} the Owner role in ${consoleUrl("iam-admin/iam")} (Grant access → Role: Owner).`,
      );
      return { ok: false, problems };
    }

    // 2. Compute Engine API on (creates the default service account the functions run as).
    const computeState = async () => (await su.get(`/projects/${number}/services/compute.googleapis.com`)).body.state;
    if ((await computeState()) !== "ENABLED") {
      log("switching on the Compute Engine API (it creates the account the server functions run as; no cost by itself)…");
      await su.post(`/projects/${number}/services/compute.googleapis.com:enable`, {});
      const until = Date.now() + waitSeconds * 1000;
      while (Date.now() < until && (await computeState()) !== "ENABLED") await sleep(pollMs);
    }

    // 3. The accounts exist (Google creates them a little after the API is switched on).
    for (const svc of ["pubsub.googleapis.com", "eventarc.googleapis.com"]) {
      await suBeta.post(`/projects/${number}/services/${svc}:generateServiceIdentity`, {}).catch(() => undefined);
    }
    const computeSa = `${number}-compute@developer.gserviceaccount.com`;
    let sa;
    const saUntil = Date.now() + waitSeconds * 1000;
    for (let first = true; ; first = false) {
      try {
        sa = (await iam.get(`/projects/${projectId}/serviceAccounts/${computeSa}`)).body;
        break;
      } catch (e) {
        if (String(status(e)) !== "404" || Date.now() >= saUntil) {
          problems.push(
            String(status(e)) === "404"
              ? `The project has no "Compute Engine default service account" (${computeSa}), which the server functions run as. Open ${consoleUrl("apis/library/compute.googleapis.com")} and make sure the API is enabled (if it is, disable it and enable it again: that recreates the account), wait 2 minutes and deploy again.`
              : `Couldn't check the account ${computeSa}: ${reason(e)}`,
          );
          return { ok: false, problems };
        }
        if (first) log("waiting for Google to create the Compute Engine default service account…");
        await sleep(pollMs * 2);
      }
    }
    if (sa?.disabled) {
      problems.push(`The account ${computeSa} is disabled. Enable it in ${consoleUrl("iam-admin/serviceaccounts")} (open it → Enable), then deploy again.`);
      return { ok: false, problems };
    }

    // 4. The roles Firebase grants on a first functions deploy, granted here so a refusal shows Google's reason.
    const need = [
      { role: "roles/iam.serviceAccountTokenCreator", member: `serviceAccount:service-${number}@gcp-sa-pubsub.iam.gserviceaccount.com`, name: "Service Account Token Creator" },
      { role: "roles/run.invoker", member: `serviceAccount:${computeSa}`, name: "Cloud Run Invoker" },
      { role: "roles/eventarc.eventReceiver", member: `serviceAccount:${computeSa}`, name: "Eventarc Event Receiver" },
    ];
    for (let attempt = 1; ; attempt++) {
      const policy = (await rm.post(`/projects/${projectId}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).body;
      policy.bindings ??= [];
      const missing = need.filter((n) => !policy.bindings.some((b) => b.role === n.role && !b.condition && b.members?.includes(n.member)));
      if (!missing.length) return { ok: true, problems };
      for (const n of missing) {
        const b = policy.bindings.find((x) => x.role === n.role && !x.condition);
        if (b) b.members = [...(b.members ?? []), n.member];
        else policy.bindings.push({ role: n.role, members: [n.member] });
      }
      try {
        log(`giving the server functions' accounts their roles: ${missing.map((n) => n.name).join(", ")}`);
        await rm.post(`/projects/${projectId}:setIamPolicy`, { policy: { ...policy, version: 3 }, updateMask: "bindings,etag" });
        return { ok: true, problems };
      } catch (e) {
        // An account Google is still creating ("does not exist") appears within minutes; a changed policy (409) is simply read again.
        const retry = attempt < 4 && (/does not exist|409|concurrent|etag/i.test(String(e?.message)) || String(status(e)) === "409");
        if (retry) {
          log(`Google refused the roles for now (${reason(e)}); trying again in ${Math.round((pollMs * 6) / 1000)} seconds…`);
          await sleep(pollMs * 6);
          continue;
        }
        problems.push(
          `Google refused to give the server functions' accounts their roles: ${reason(e)}. In ${consoleUrl("iam-admin/iam")} use Grant access for each of these, then deploy again:\n${need.map((n) => `       - New principal ${n.member.replace("serviceAccount:", "")}, role "${n.name}"`).join("\n")}`,
        );
        return { ok: false, problems };
      }
    }
  } catch (e) {
    problems.push(`Couldn't check the project's permissions: ${reason(e)}`);
    return { ok: false, problems, unexpected: true };
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--project");
  const projectId = i >= 0 ? process.argv[i + 1] : undefined;
  if (!projectId) {
    console.error("Usage: pnpm deploy:access --project PROJECT-ID");
    process.exit(1);
  }
  console.log(`\nCan the server functions be deployed to ${projectId}?\n`);
  const r = await ensureFunctionsAccess(projectId);
  if (r.ok) console.log("\n  ✓ Permissions are in place. Run the deploy again.\n");
  else {
    console.log("");
    r.problems.forEach((p) => console.log(`  ✗ ${p}\n`));
  }
  process.exit(r.ok ? 0 : 1);
}
