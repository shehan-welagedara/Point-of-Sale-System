/**
 * Vendor licence tool (runs on your computer, never in a client deployment).
 *
 *   pnpm licence keygen
 *   pnpm licence issue --licensee "Spice Lagoon (Pvt) Ltd" --edition professional --addons accounting \
 *        --project spice-lagoon-prod --months 12 [--tenant <businessId>] [--limits workstations=6,employees=300] [--demo]
 *   pnpm licence show <licence key>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EDITIONS, type Edition, type LicencePayload, type UsageLimits, buildEntitlements, decodeLicence, generateLicenceKeys, signLicence } from "../../packages/core/src/licensing.js";
import { MODULES, type ModuleKey } from "../../packages/core/src/modules.js";

const KEYS = join(process.cwd(), "licence-keys");
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? "") : def;
};
const flag = (name: string) => args.includes(`--${name}`);
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function readKey(file: string, which: "public" | "private"): string {
  if (!existsSync(file)) fail(`key file not found: ${file} (run "pnpm licence keygen" first)`);
  const m = readFileSync(file, "utf8").match(new RegExp(`^${which}=(.+)$`, "m"));
  return m?.[1] ?? fail(`no ${which} key in ${file}`);
}

async function main() {
  if (cmd === "keygen") {
    const file = join(KEYS, "vendor-key.txt");
    if (existsSync(file) && !flag("force")) fail(`${file} already exists (use --force to replace it; existing licences would stop verifying)`);
    mkdirSync(KEYS, { recursive: true });
    const k = await generateLicenceKeys();
    writeFileSync(file, `# Vendor licence signing key. KEEP PRIVATE. Back it up offline.\npublic=${k.publicKey}\nprivate=${k.privateKey}\n`, { mode: 0o600 });
    console.log(`✓ Key pair written to ${file} (git-ignored).\n\nPut the PUBLIC key in every deployment:\n  apps/web/.env.local        VITE_LICENCE_PUBLIC_KEY=${k.publicKey}\n  apps/functions/.env        LICENCE_PUBLIC_KEY=${k.publicKey}`);
    return;
  }
  if (cmd === "issue") {
    const edition = (opt("edition", "professional") as Edition) ?? "professional";
    if (!EDITIONS.some((e) => e.key === edition)) fail(`edition must be one of ${EDITIONS.map((e) => e.key).join(", ")}`);
    const addOns = (opt("addons", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean) as ModuleKey[];
    for (const a of addOns) if (!MODULES.some((m) => m.key === a)) fail(`unknown module ${a}`);
    const limits: Partial<UsageLimits> = {};
    for (const pair of (opt("limits", "") ?? "").split(",").filter(Boolean)) {
      const [k, v] = pair.split("=");
      limits[k as keyof UsageLimits] = Number(v);
    }
    const licensee = opt("licensee") ?? fail("--licensee is required");
    const project = opt("project") ?? fail("--project is required (Firebase project id, or * for any)");
    const months = Number(opt("months", "12"));
    const now = new Date();
    const expires = new Date(now);
    expires.setUTCMonth(expires.getUTCMonth() + months);
    const payload: LicencePayload = {
      v: 1,
      licenceId: opt("id") ?? `LIC-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      licensee: { name: licensee, ...(opt("email") ? { email: opt("email")! } : {}), ...(opt("tin") ? { tin: opt("tin")! } : {}) },
      edition,
      addOns,
      entitlements: buildEntitlements(edition, addOns, limits),
      projectId: project,
      tenantId: opt("tenant", "*")!,
      billing: (opt("billing", "subscription") as LicencePayload["billing"]) ?? "subscription",
      issuedAt: now.toISOString(),
      validFrom: (opt("from") ? new Date(opt("from")!) : now).toISOString(),
      expiresAt: expires.toISOString(),
      graceDays: Number(opt("grace", "14")),
    };
    const keyFile = flag("demo") ? join(process.cwd(), "tools/licence/demo-key.txt") : join(KEYS, "vendor-key.txt");
    const token = await signLicence(payload, readKey(keyFile, "private"));
    mkdirSync(join(KEYS, "issued"), { recursive: true });
    writeFileSync(join(KEYS, "issued", `${payload.licenceId}.json`), JSON.stringify({ ...payload, token }, null, 2));
    console.log(`✓ ${payload.licenceId} · ${licensee} · ${edition}${addOns.length ? ` + ${addOns.join(", ")}` : ""} · project ${project} · until ${payload.expiresAt.slice(0, 10)}${flag("demo") ? "  (DEMO KEY)" : ""}`);
    console.log(`  modules: ${payload.entitlements.modules.join(", ")}`);
    console.log(`  limits:  ${Object.entries(payload.entitlements.limits).map(([k, v]) => `${k} ${v}`).join(", ")}\n`);
    console.log(token);
    return;
  }
  if (cmd === "show") {
    const token = args[1] ?? fail("pass the licence key");
    const pub = flag("demo") ? readKey(join(process.cwd(), "tools/licence/demo-key.txt"), "public") : readKey(join(KEYS, "vendor-key.txt"), "public");
    console.log(JSON.stringify(await decodeLicence(token, pub), null, 2));
    return;
  }
  console.log("Usage: pnpm licence keygen | issue --licensee <name> --edition <starter|professional|enterprise> --project <id> [--addons a,b] [--months 12] [--tenant id] [--limits k=v,…] [--demo] | show <key> [--demo]");
}

main().catch((e) => fail((e as Error).message));
