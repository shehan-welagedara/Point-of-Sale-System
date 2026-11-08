import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const policy = JSON.parse(readFileSync(new URL("../../release/policy.json", import.meta.url), "utf8")) as { minSupportedVersion: string };
const commit = process.env.GITHUB_SHA ?? (() => { try { return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return "unknown"; } })();
const builtAt = new Date().toISOString();

/** Publishes /version.json next to the app, so open screens can see that a newer release is live. */
function versionFile(): Plugin {
  return {
    name: "version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: pkg.version, minSupportedVersion: policy.minSupportedVersion, commit: commit.slice(0, 12), builtAt }, null, 2) });
    },
  };
}

// Same security headers as Firebase Hosting (firebase.json), so `pnpm demo` exercises them.
// upgrade-insecure-requests is dropped here: the demo is served over plain http on the LAN.
const securityHeaders = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(new URL("./security-headers.json", import.meta.url), "utf8")) as Record<string, string>).map(([k, v]) => [k, k === "Content-Security-Policy" ? v.replace(/; upgrade-insecure-requests/, "") : v]),
);

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit.slice(0, 12)),
    __APP_BUILT_AT__: JSON.stringify(builtAt),
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Big libraries in their own files: they change rarely, so browsers keep them cached across updates.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("exceljs")) return "excel";
          if (id.includes("firebase") || id.includes("@firebase")) return "firebase";
          if (id.includes("react") || id.includes("scheduler")) return "react";
          return "vendor";
        },
      },
    },
  },
  preview: { headers: securityHeaders },
  optimizeDeps: {
    include: ["exceljs"],
  },
});
