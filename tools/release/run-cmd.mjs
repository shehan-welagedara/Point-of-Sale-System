import { spawnSync } from "node:child_process";

const win = process.platform === "win32";

/**
 * Starts a program the same way on Windows, macOS and Linux. On Windows, pnpm and gcloud are .cmd
 * files that only start through the shell; the command line is built (and quoted) here and passed as
 * one string, which is what newer Node.js versions expect (no DEP0190 warning).
 */
export function runCommand(cmd, args = [], opts = {}) {
  if (!win) return spawnSync(cmd, args, opts);
  const quote = (a) => (a === "" || /[\s"&|<>^()]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a);
  return spawnSync([cmd, ...args].map(quote).join(" "), { ...opts, shell: true });
}
