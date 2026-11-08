/**
 * Runs the data migrations against the Firestore emulator on old-style data, twice (they must be
 * idempotent):  pnpm test:migrations
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/functions/package.json"));
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const PROJECT = "demo-migrations";
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("run under the Firestore emulator (pnpm test:migrations)");
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) process.exitCode = 1;
};

await db.doc("tenants/old-co").set({ id: "old-co", ownerUid: "owner-1", createdAt: "2026-10-01T00:00:00Z" });
await db.doc("tenants/later-co").set({ id: "later-co", ownerUid: "owner-2", createdAt: "2026-11-01T00:00:00Z" });
await db.doc("tenants/old-co/staff/1001").set({ id: "1001", name: "Kasun", pinHash: "h".repeat(64), pinSalt: "s".repeat(32), cardId: "CARD1001", status: "active" });
await db.doc("tenants/old-co/accounts/3000").set({ id: "3000", code: "3000", name: "Stated capital", type: "equity" });
await db.doc("tenants/old-co/staff/1002").set({ id: "1002", name: "Nimali", pinSet: true, status: "active" });

const migrate = () => execFileSync("node", ["tools/release/migrate.mjs", "--project", PROJECT], { cwd: root, env: process.env, encoding: "utf8" });
console.log(migrate());
const cfg = (await db.doc("deployment/config").get()).data();
check(cfg?.ownerUid === "owner-1" && cfg.openSignup === false, "deployment owner is the oldest business's owner");
const s1 = (await db.doc("tenants/old-co/staff/1001").get()).data();
const sec = (await db.doc("tenants/old-co/staffSecrets/1001").get()).data();
check(s1.pinHash === undefined && s1.cardId === undefined && s1.pinSet === true && s1.hasCard === true, "staff record keeps only pinSet/hasCard");
check(sec?.pinHash === "h".repeat(64) && sec.cardId === "CARD1001", "hash and card moved to staffSecrets");
check(!(await db.doc("tenants/old-co/staffSecrets/1002").get()).exists, "records without secrets untouched");
const again = migrate();
check(/0 applied/.test(again), "second run applies nothing (recorded, idempotent)");
check((await db.doc("tenants/old-co/accounts/3900").get()).data()?.name === "Opening balances (temporary)", "opening balances account added where books exist");
check(!(await db.doc("tenants/later-co/accounts/3900").get()).exists, "businesses without books untouched");
check((await db.collection("deployment/config/migrations").get()).size === 3, "every migration recorded");
