import type { PrintJob, Printer } from "@pos/core";
import { type ReceiptDoc, toEscPos, toText } from "@pos/printing";

export interface Sender {
  send(printer: Printer, bytes: Uint8Array, text: string): Promise<void>;
}

export interface JobResult {
  status: "printed" | "failed";
  printerId?: string;
  error?: string;
}

/** Prints one job, falling back to the printer's backup printer when the first attempt fails. */
export async function processJob(job: PrintJob, printers: ReadonlyMap<string, Printer>, sender: Sender): Promise<JobResult> {
  const doc = job.doc as ReceiptDoc;
  if (!doc || !Array.isArray(doc.blocks)) return { status: "failed", error: "job has no printable document" };
  const bytes = toEscPos(doc);
  const text = toText(doc);
  const first = printers.get(job.printerId);
  if (!first) return { status: "failed", error: `printer ${job.printerId} is not handled by this agent` };
  const errors: string[] = [];
  for (const printer of [first, first.backupPrinterId ? printers.get(first.backupPrinterId) : undefined]) {
    if (!printer) continue;
    try {
      await sender.send(printer, bytes, text);
      return { status: "printed", printerId: printer.id };
    } catch (e) {
      errors.push(`${printer.name}: ${(e as Error).message}`);
    }
  }
  return { status: "failed", error: errors.join("; ") };
}
