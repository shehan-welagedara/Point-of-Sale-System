import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import type { PrintJob, Printer } from "@pos/core";
import { buildTestPage } from "@pos/printing";
import { processJob } from "../src/process.js";
import { sendTcp } from "../src/transport.js";

const printer = (id: string, extra: Partial<Printer> = {}): Printer => ({
  id, propertyId: "P", name: id, role: "kitchen", model: "x", connection: "network", address: "127.0.0.1", port: 9100, paperWidthMm: 80, agentId: "A", active: true, ...extra,
});
const job: PrintJob = { id: "j1", printerId: "K", workstationId: "W01", kind: "kot", doc: buildTestPage("Kitchen", 48), status: "queued", createdAt: "", expireAt: "" };

describe("print agent", () => {
  it("streams ESC/POS bytes to a network printer", async () => {
    const received: Buffer[] = [];
    const server = createServer((s) => s.on("data", (d) => received.push(d)));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    await sendTcp("127.0.0.1", port, Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]));
    await new Promise((r) => setTimeout(r, 50));
    server.close();
    expect([...Buffer.concat(received)]).toEqual([0x1b, 0x40, 0x41, 0x0a]);
  });

  it("reports an unreachable printer", async () => {
    await expect(sendTcp("127.0.0.1", 1, new Uint8Array([1]), 1000)).rejects.toThrow(/127.0.0.1:1/);
  });

  it("falls back to the backup printer", async () => {
    const printers = new Map([["K", printer("K", { backupPrinterId: "B" })], ["B", printer("B")]]);
    const tried: string[] = [];
    const result = await processJob(job, printers, {
      async send(p, bytes, text) {
        tried.push(p.id);
        expect(bytes[0]).toBe(0x1b);
        expect(text).toContain("PRINTER TEST");
        if (p.id === "K") throw new Error("paper out");
      },
    });
    expect(tried).toEqual(["K", "B"]);
    expect(result).toEqual({ status: "printed", printerId: "B" });
  });

  it("fails cleanly for unknown printers and empty jobs", async () => {
    expect((await processJob({ ...job, printerId: "X" }, new Map(), { send: async () => {} })).status).toBe("failed");
    expect((await processJob({ ...job, doc: null }, new Map([["K", printer("K")]]), { send: async () => {} })).error).toMatch(/no printable/);
  });
});
