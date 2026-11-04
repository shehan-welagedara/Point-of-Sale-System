// Bundles the functions and the workspace packages they use into dist/, with a package.json that
// lists only the runtime dependencies Cloud Build installs (no workspace links to resolve).
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  external: Object.keys(pkg.dependencies),
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
writeFileSync(
  "dist/package.json",
  JSON.stringify({ name: "pos-functions", private: true, type: "module", main: "index.js", engines: { node: "22" }, dependencies: pkg.dependencies }, null, 2),
);
if (existsSync(".env")) copyFileSync(".env", "dist/.env");
else writeFileSync("dist/.env", "LOCATION=asia-south1\n");
// The Firebase CLI discovers the Functions SDK under <source>/node_modules (used by the emulator and
// by deploy-time analysis; node_modules itself is never uploaded).
if (!existsSync("dist/node_modules")) symlinkSync(resolve("node_modules"), resolve("dist/node_modules"), process.platform === "win32" ? "junction" : "dir");
console.log("Built dist/index.js");
