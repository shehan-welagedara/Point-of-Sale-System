/**
 * Can this computer's Node.js reach the Google and Firebase services the deploy needs?
 *
 *   pnpm deploy:check
 *
 * The browser may work while Node.js (which runs the Firebase and release tools) is blocked: antivirus
 * "HTTPS scanning" or a company network replaces Google's certificates with its own (Chrome trusts it,
 * Node.js doesn't), or a proxy/firewall lets only the browser out. This finds out which, and says how
 * to fix it. Also run by `pnpm deploy:setup`.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// NETCHECK_URLS (comma-separated) replaces the list, for testing the checker itself.
const override = process.env.NETCHECK_URLS?.split(",").filter(Boolean).map((u) => [new URL(u).host, u, "test"]);
export const SERVICES = override ?? [
  ["auth.firebase.tools", "https://auth.firebase.tools/", "signing in to the Firebase tools"],
  ["oauth2.googleapis.com", "https://oauth2.googleapis.com/", "Google sign-in"],
  ["firebase.googleapis.com", "https://firebase.googleapis.com/", "Firebase projects"],
  ["firebasehosting.googleapis.com", "https://firebasehosting.googleapis.com/", "publishing the web app"],
  ["firestore.googleapis.com", "https://firestore.googleapis.com/", "database rules, indexes and data updates"],
  ["cloudfunctions.googleapis.com", "https://cloudfunctions.googleapis.com/", "server functions"],
  ["storage.googleapis.com", "https://storage.googleapis.com/", "backups"],
  ["registry.npmjs.org", "https://registry.npmjs.org/", "installing the project's parts"],
];

const CERT = new Set(["SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "UNABLE_TO_GET_ISSUER_CERT", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS_CERT_ALTNAME_INVALID", "CERT_UNTRUSTED"]);
const DNS = new Set(["ENOTFOUND", "EAI_AGAIN"]);

/** One request per service; any HTTP answer (even 404) means the service is reachable. */
export async function probe() {
  return Promise.all(
    SERVICES.map(async ([host, url, why]) => {
      try {
        const r = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000) });
        return { host, why, ok: true, detail: `HTTP ${r.status}` };
      } catch (e) {
        const code = e?.cause?.code ?? (e?.name === "TimeoutError" ? "TIMEOUT" : e?.cause?.message ?? e?.message ?? "error");
        return { host, why, ok: false, code: String(code), kind: CERT.has(code) ? "cert" : DNS.has(code) ? "dns" : "blocked" };
      }
    }),
  );
}

/** Runs the probe again with Node.js trusting the Windows/macOS certificate store. */
function probeWithSystemCa() {
  const r = spawnSync(process.execPath, ["--use-system-ca", fileURLToPath(import.meta.url), "--json"], { encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0 && /bad option|unknown option/i.test(r.stderr ?? "")) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

function systemProxy() {
  if (process.platform !== "win32") return null;
  const r = spawnSync("netsh", ["winhttp", "show", "proxy"], { encoding: "utf8" });
  return /Proxy Server\(s\)\s*:\s*(\S+)/i.exec(r.stdout ?? "")?.[1] ?? null;
}

/** Prints the result and what to do. Returns true when every service is reachable. */
export async function checkNetwork({ quiet = false } = {}) {
  const win = process.platform === "win32";
  const results = await probe();
  const bad = results.filter((r) => !r.ok);
  if (!quiet || bad.length) {
    for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.host} (${r.why})${r.ok ? "" : `: ${r.code}`}`);
  }
  if (!bad.length) return true;

  // Command Prompt and PowerShell set a variable differently; show both on Windows.
  const set = (name, value) => (win ? `set ${name}=${value}          (Command Prompt)\n      $env:${name}="${value}"   (PowerShell)` : `export ${name}="${value}"`);
  const forever = (name, value) => (win ? `setx ${name} "${value}"` : `add  export ${name}="${value}"  to your shell profile`);
  console.log("\n  Node.js can't reach some Google services, so `firebase login` and the deploy fail although the browser works.");
  if (bad.some((r) => r.kind === "cert")) {
    const again = probeWithSystemCa();
    if (again && again.every((r) => r.ok)) {
      console.log("  Cause: your antivirus or network checks HTTPS traffic with its own certificate, which Windows trusts but Node.js doesn't.");
      console.log("  Fix (tested on this computer): let Node.js trust the Windows certificates. In this terminal:\n");
      console.log(`      ${set("NODE_OPTIONS", "--use-system-ca")}\n`);
      console.log("  then run `pnpm exec firebase login` again. To keep it for every new terminal:\n");
      console.log(`      ${forever("NODE_OPTIONS", "--use-system-ca")}\n`);
    } else {
      console.log("  Cause: HTTPS scanning (antivirus \"web shield\" / \"SSL scanning\", or a company firewall) replaces Google's certificates.");
      console.log("  Fix: in the antivirus, switch off HTTPS/SSL scanning or exclude node.exe; or ask IT for the company root certificate (a .pem file) and run:");
      console.log(`\n      ${set("NODE_EXTRA_CA_CERTS", win ? "C:\\path\\to\\company-root.pem" : "/path/to/company-root.pem")}\n`);
    }
  }
  if (bad.some((r) => r.kind === "blocked")) {
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || systemProxy();
    console.log("  Cause: a firewall, antivirus or proxy lets the browser out but not Node.js.");
    if (proxy && !process.env.HTTPS_PROXY && !process.env.https_proxy) {
      console.log(`  This computer uses the proxy ${proxy}. Tell Node.js about it, in this terminal:\n\n      ${set("HTTPS_PROXY", proxy.startsWith("http") ? proxy : `http://${proxy}`)}\n`);
    } else {
      console.log("  Fix: allow node.exe in the firewall/antivirus (outgoing connections), or ask IT to open the hosts above. To confirm, connect the PC to a phone hotspot and run `pnpm deploy:check` again.");
    }
  }
  if (bad.some((r) => r.kind === "dns")) console.log("  Cause: these names don't resolve (DNS). Check the internet connection, or set the network's DNS to 8.8.8.8.");
  console.log("  No luck? Deploy from Google Cloud Shell in the browser instead (deployment manual U, \"Deploying from Cloud Shell\").\n");
  return false;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(await probe()));
  } else {
    console.log("\nCan Node.js on this computer reach Google and Firebase?\n");
    const ok = await checkNetwork();
    console.log(ok ? "\n  ✓ All reachable. If `firebase login` still fails, run `pnpm exec firebase logout`, then `pnpm exec firebase login --reauth`.\n" : "");
    process.exit(ok ? 0 : 1);
  }
}
