/**
 * Print Agent. Listens for queued print jobs of one business and prints them on the printers
 * assigned to this agent (EMC → Devices & printers → "Print Agent id").
 *
 *   cp .env.example .env   # fill in, then:
 *   pnpm --filter @pos/print-agent start
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getFirestore, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import type { PrintJob, Printer } from "@pos/core";
import { processJob, type Sender } from "./process.js";
import { sendTcp, sendUsb } from "./transport.js";

function loadEnv(file = ".env"): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.replace(/^"|"$/g, "");
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} in .env`);
  return v;
}

loadEnv();
const dryRun = process.env.DRY_RUN === "1";
const agentId = process.env.AGENT_ID ?? "AGENT-1";
const tenantId = required("TENANT_ID");
const app = initializeApp({
  apiKey: required("FIREBASE_API_KEY"),
  projectId: required("FIREBASE_PROJECT_ID"),
  ...(process.env.FIREBASE_AUTH_DOMAIN ? { authDomain: process.env.FIREBASE_AUTH_DOMAIN } : {}),
  ...(process.env.FIREBASE_APP_ID ? { appId: process.env.FIREBASE_APP_ID } : {}),
});
const auth = getAuth(app);
const db = getFirestore(app);
if (process.env.USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const sender: Sender = dryRun
  ? {
      async send(printer, bytes, text) {
        const dir = join(process.cwd(), "out");
        mkdirSync(dir, { recursive: true });
        const base = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${printer.id}`);
        writeFileSync(`${base}.bin`, bytes);
        writeFileSync(`${base}.txt`, text);
        console.log(`[dry-run] ${printer.name}: ${bytes.length} bytes → ${base}.txt`);
      },
    }
  : {
      async send(printer, bytes) {
        if (printer.connection === "network") return sendTcp(printer.address, printer.port || 9100, bytes);
        if (printer.connection === "usb") return sendUsb(printer.address, bytes);
        throw new Error(`${printer.connection} printers are driven by the tablet app, not the agent`);
      },
    };

await signInWithEmailAndPassword(auth, required("AGENT_EMAIL"), required("AGENT_PASSWORD"));
console.log(`Print Agent ${agentId} signed in for tenant ${tenantId}${dryRun ? " (dry run)" : ""}`);

let printers = new Map<string, Printer>();
onSnapshot(query(collection(db, "tenants", tenantId, "printers"), where("agentId", "==", agentId)), (snap) => {
  printers = new Map(snap.docs.map((d) => [d.id, { ...(d.data() as Printer), id: d.id }]));
  console.log(`Handling ${printers.size} printer(s): ${[...printers.values()].map((p) => `${p.name} (${p.connection} ${p.address})`).join(", ")}`);
});

const inFlight = new Set<string>();
onSnapshot(query(collection(db, "tenants", tenantId, "printJobs"), where("status", "==", "queued")), async (snap) => {
  for (const d of snap.docs) {
    const job = { ...(d.data() as PrintJob), id: d.id };
    if (!printers.has(job.printerId) || inFlight.has(job.id)) continue;
    inFlight.add(job.id);
    const result = await processJob(job, printers, sender);
    await updateDoc(doc(db, "tenants", tenantId, "printJobs", job.id), {
      status: result.status,
      agentId,
      ...(result.status === "printed" ? { printedAt: new Date().toISOString() } : { error: result.error ?? "failed" }),
    });
    console.log(`${result.status === "printed" ? "✓" : "✗"} ${job.kind} ${job.id} → ${result.printerId ?? job.printerId}${result.error ? ` (${result.error})` : ""}`);
    inFlight.delete(job.id);
  }
});
