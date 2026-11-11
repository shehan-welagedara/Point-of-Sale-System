/**
 * Settings for running the Polymath Console's functions on the emulators (pnpm console:emulators,
 * pnpm test:console): the public DEMO licence key (never your own) and a test owner.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dist = join(root, "apps/console-functions/dist");
const demo = /^private=(.+)$/m.exec(readFileSync(join(root, "tools/licence/demo-key.txt"), "utf8"))[1].trim();
writeFileSync(join(dist, ".secret.local"), `LICENCE_PRIVATE_KEY=${demo}\nGITHUB_TOKEN=none\n`);
writeFileSync(join(dist, ".env.local"), `OWNER_EMAIL=${process.env.CONSOLE_OWNER_EMAIL ?? "owner@polymath.test"}\n`);
console.log("Console emulator settings written (demo licence key; owner owner@polymath.test)");
