import { type DocStore, type PrintJob, type Printer, type Workstation, COLLECTIONS as C, newId } from "@pos/core";
import { type ReceiptDoc, widthForPaper } from "@pos/printing";

/** Characters per line for this device's printing: its own Bluetooth printer, or the given printer. */
export function paperWidthFor(ws: Pick<Workstation, "printMode" | "paperWidthMm">, printer?: Pick<Printer, "paperWidthMm">): number {
  return widthForPaper(ws.printMode === "bluetooth" ? (ws.paperWidthMm ?? 80) : (printer?.paperWidthMm ?? 80));
}

/**
 * Sends a document to a printer through the Print Agent queue. Dedicated terminals and tablets
 * both use the queue: the agent on the shop LAN owns the USB/network printers, so tablets can
 * print bills and KOTs without drivers. Jobs expire after a day (Firestore TTL on `expireAt`).
 */
export async function queuePrint(store: DocStore, args: { printer: Printer | undefined; workstationId: string; kind: PrintJob["kind"]; doc: ReceiptDoc }): Promise<PrintJob | null> {
  if (!args.printer) return null;
  const now = new Date();
  const job: PrintJob = {
    id: newId(),
    printerId: args.printer.id,
    workstationId: args.workstationId,
    kind: args.kind,
    doc: args.doc,
    status: "queued",
    createdAt: now.toISOString(),
    expireAt: new Date(now.getTime() + 24 * 3600_000).toISOString(),
  };
  await store.set(C.printJobs, job);
  return job;
}

/** Printer for a KOT route, falling back to its backup when inactive. */
export function routePrinter(printers: readonly Printer[], role: Printer["role"]): Printer | undefined {
  const p = printers.find((x) => x.role === role && x.active) ?? printers.find((x) => x.role === role);
  if (p && !p.active && p.backupPrinterId) return printers.find((x) => x.id === p.backupPrinterId);
  return p;
}
