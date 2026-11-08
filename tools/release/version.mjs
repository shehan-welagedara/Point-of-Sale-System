/**
 * Starts a release: sets the new version and adds a CHANGELOG entry from the commits since the
 * last release tag.
 *
 *   pnpm release:version 1.1.0
 *
 * Then review CHANGELOG.md, commit, tag and push: the Release workflow builds once, deploys to
 * staging, and waits for approval before each wave of clients.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const next = process.argv[2];
const SEMVER = /^\d+\.\d+\.\d+$/;
if (!next || !SEMVER.test(next)) {
  console.error("usage: pnpm release:version <major.minor.patch>");
  process.exit(1);
}
const cmp = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};
const files = ["package.json", "apps/web/package.json"];
const current = JSON.parse(readFileSync(join(root, "apps/web/package.json"), "utf8")).version;
if (cmp(next, current) <= 0) {
  console.error(`${next} must be higher than the current version ${current}`);
  process.exit(1);
}
for (const f of files) {
  const p = join(root, f);
  const d = JSON.parse(readFileSync(p, "utf8"));
  d.version = next;
  writeFileSync(p, `${JSON.stringify(d, null, 2)}\n`);
}

const git = (...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v*");
const log = git("log", "--no-merges", "--pretty=format:- %s", ...(lastTag ? [`${lastTag}..HEAD`] : ["-30"]));
const kind = next.split(".")[0] !== current.split(".")[0] ? "Major (data or rule changes: plan with clients, backup first)" : next.split(".")[1] !== current.split(".")[1] ? "Minor (new features)" : "Patch (fixes)";
const entry = `## ${next} — ${new Date().toISOString().slice(0, 10)}\n\n**Type:** ${kind}\n\n### For clients\n\n- (Write what changes for restaurant staff, in plain words.)\n\n### Changes\n\n${log || "- (no commits found)"}\n\n`;
const changelog = join(root, "CHANGELOG.md");
const head = "# Changelog\n\nEvery release, newest first. The \"For clients\" part is what you send to clients as release notes.\n\n";
const body = existsSync(changelog) ? readFileSync(changelog, "utf8").replace(head, "") : "";
writeFileSync(changelog, head + entry + body);
console.log(`Version ${current} → ${next}. Edit the "For clients" notes in CHANGELOG.md, then:`);
console.log(`  git commit -am "Release ${next}" && git tag v${next} && git push && git push origin v${next}`);
console.log("If this release needs every screen to reload before use, raise minSupportedVersion in release/policy.json first.");
