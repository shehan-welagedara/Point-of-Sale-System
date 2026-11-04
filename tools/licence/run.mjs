// Bundles the TypeScript licence tool with esbuild and runs it (no build step to remember).
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(tmpdir(), `pos-licence-${process.pid}.mjs`);
await build({ entryPoints: [join(here, "cli.ts")], bundle: true, platform: "node", format: "esm", target: "node22", outfile: out, logLevel: "error" });
await import(pathToFileURL(out).href);
