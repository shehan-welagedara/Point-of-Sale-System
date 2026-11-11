// Bundles the console functions and the shared licence code into dist/, with a package.json that lists
// only the runtime dependencies Cloud Build installs.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
  JSON.stringify({ name: "polymath-console-functions", private: true, type: "module", main: "index.js", engines: { node: "22" }, dependencies: pkg.dependencies }, null, 2),
);
// Settings written by `pnpm console:setup` (OWNER_EMAIL, LICENCE_PUBLIC_KEY, CONSOLE_DOMAIN …).
if (existsSync(".env")) copyFileSync(".env", "dist/.env");
else if (!existsSync("dist/.env")) writeFileSync("dist/.env", "");
if (!existsSync("dist/node_modules")) symlinkSync(resolve("node_modules"), resolve("dist/node_modules"), process.platform === "win32" ? "junction" : "dir");
console.log("Built dist/index.js");
