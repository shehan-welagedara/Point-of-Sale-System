import { spawn } from "node:child_process";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Sends raw ESC/POS bytes to a network printer (raw TCP, usually port 9100). */
export function sendTcp(host: string, port: number, data: Uint8Array, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`printer ${host}:${port} did not answer within ${timeoutMs / 1000}s`));
    }, timeoutMs);
    socket.on("connect", () => socket.end(Buffer.from(data)));
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`printer ${host}:${port}: ${e.message}`));
    });
    socket.on("close", (hadError) => {
      clearTimeout(timer);
      if (!hadError) resolve();
    });
  });
}

/**
 * Sends raw bytes to a USB printer.
 * - Windows: share the printer (e.g. as "POS80") and use `\\localhost\POS80`, or give the share name;
 *   the bytes are copied in binary mode, bypassing the driver's rendering (works for any ESC/POS model).
 * - Linux / Raspberry Pi: the device path, e.g. /dev/usb/lp0.
 */
export async function sendUsb(address: string, data: Uint8Array): Promise<void> {
  if (process.platform === "win32") {
    const target = address.startsWith("\\\\") ? address : `\\\\localhost\\${address}`;
    const dir = await mkdtemp(join(tmpdir(), "pos-print-"));
    const file = join(dir, "job.bin");
    try {
      await writeFile(file, data);
      await new Promise<void>((resolve, reject) => {
        const p = spawn("cmd.exe", ["/c", "copy", "/b", file, target], { windowsHide: true });
        p.on("error", reject);
        p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`copy to ${target} failed (exit ${code})`))));
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return;
  }
  await writeFile(address, data);
}
