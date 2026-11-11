/**
 * Bluetooth receipt printers next to a phone or tablet, without a Print Agent PC: for a small
 * business with one phone and one printer (for example an Xprinter XP-T80Q).
 *
 * Two routes, chosen per workstation:
 *  - browser: Web Bluetooth in Chrome on Android (Bluetooth Low Energy printers). The phone sends
 *    ESC/POS bytes straight to the printer. The printer is chosen once; afterwards it reconnects
 *    by itself while the POS is open.
 *  - rawbt: the RawBT app on Android, which talks to any Bluetooth printer (also classic
 *    Bluetooth). The POS hands the bytes to the app, which prints them.
 * iPhones and iPads have no Web Bluetooth in Safari or Chrome; the Bluefy browser adds it.
 */
import { useSyncExternalStore } from "react";
import { type ReceiptDoc, toEscPos } from "@pos/printing";

// Minimal Web Bluetooth types (not in TypeScript's DOM library).
interface BtCharacteristic {
  uuid: string;
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue(data: BufferSource): Promise<void>;
  writeValueWithResponse?(data: BufferSource): Promise<void>;
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
}
interface BtService {
  uuid: string;
  getCharacteristics(): Promise<BtCharacteristic[]>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BtService>;
}
interface BtDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BtServer;
}
interface BtApi {
  getAvailability?(): Promise<boolean>;
  requestDevice(options: { acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
}

const u16 = (x: string) => `0000${x}-0000-1000-8000-00805f9b34fb`;
/** GATT services that receipt printers use for raw ESC/POS data. */
export const PRINTER_SERVICES = [
  u16("18f0"), // most thermal printers (characteristic 2AF1)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // Xprinter, Gprinter, Munbyn
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // Microchip transparent UART (many Bluetooth modules)
  u16("ff00"),
  u16("ffe0"),
  u16("ae30"),
  u16("fee7"),
  u16("fff0"),
  u16("ffe5"),
];

const SAVED_KEY = "pos-suite.btPrinter";

export type BtStatus = "unsupported" | "idle" | "connecting" | "ready" | "printing" | "error";
export interface BtState {
  status: BtStatus;
  deviceName?: string;
  /** Prints waiting for the printer (kept while the POS is open). */
  pending: number;
  message?: string;
}

const api = (): BtApi | undefined => (typeof navigator !== "undefined" ? (navigator as Navigator & { bluetooth?: BtApi }).bluetooth : undefined);
export const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);

let state: BtState = { status: api() ? "idle" : "unsupported", pending: 0, ...(savedPrinter() ? { deviceName: savedPrinter()!.name } : {}) };
const listeners = new Set<() => void>();
function set(patch: Partial<BtState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

let device: BtDevice | null = null;
let channel: BtCharacteristic | null = null;
let chunkSize = 100;
const queue: Uint8Array[] = [];
let chain: Promise<unknown> = Promise.resolve();

function savedPrinter(): { id: string; name: string } | null {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as { id: string; name: string }) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function findChannel(server: BtServer): Promise<BtCharacteristic> {
  for (const uuid of PRINTER_SERVICES) {
    let service: BtService;
    try {
      service = await server.getPrimaryService(uuid);
    } catch {
      continue;
    }
    const chars = await service.getCharacteristics();
    const writable = chars.find((c) => c.properties.writeWithoutResponse) ?? chars.find((c) => c.properties.write);
    if (writable) return writable;
  }
  throw new Error("This Bluetooth device doesn't offer a printing service. Check it is the receipt printer, or use the RawBT app (Bluetooth printing via RawBT).");
}

async function open(d: BtDevice): Promise<void> {
  if (!d.gatt) throw new Error("This device can't be connected over Bluetooth");
  set({ status: "connecting", deviceName: d.name ?? "Printer", message: "" });
  const server = d.gatt.connected ? d.gatt : await d.gatt.connect();
  channel = await findChannel(server);
  if (device !== d) {
    d.addEventListener("gattserverdisconnected", () => {
      channel = null;
      set({ status: "idle", message: "Printer disconnected (switched off or out of range). It reconnects at the next print." });
    });
  }
  device = d;
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({ id: d.id, name: d.name ?? "Printer" }));
  } catch {
    /* private mode: the printer is chosen again next time */
  }
  set({ status: "ready", deviceName: d.name ?? "Printer", message: "" });
}

/** Asks the user to choose the printer (needs a tap: browsers only show the list after one). */
export async function choosePrinter(): Promise<boolean> {
  const bt = api();
  if (!bt) {
    set({ status: "unsupported", message: unsupportedMessage() });
    return false;
  }
  try {
    if (bt.getAvailability && !(await bt.getAvailability())) throw new Error("Bluetooth is off on this phone. Switch it on and try again.");
    const d = await bt.requestDevice({ acceptAllDevices: true, optionalServices: PRINTER_SERVICES });
    await open(d);
    void flush();
    return true;
  } catch (e) {
    const msg = (e as Error).name === "NotFoundError" ? "No printer chosen." : (e as Error).message;
    set({ status: "error", message: msg });
    return false;
  }
}

/** Reconnects to the printer chosen before, without asking (when the browser allows it). */
async function reconnect(): Promise<boolean> {
  if (channel && device?.gatt?.connected) return true;
  try {
    if (device) {
      await open(device);
      return true;
    }
    const saved = savedPrinter();
    const bt = api();
    if (!saved || !bt?.getDevices) return false;
    const d = (await bt.getDevices()).find((x) => x.id === saved.id);
    if (!d) return false;
    await Promise.race([open(d), sleep(8000).then(() => Promise.reject(new Error("The printer didn't answer: is it on?")))]);
    return true;
  } catch (e) {
    set({ status: "idle", message: (e as Error).message });
    return false;
  }
}

async function writeAll(bytes: Uint8Array): Promise<void> {
  const ch = channel!;
  const fast = ch.properties.writeWithoutResponse && ch.writeValueWithoutResponse;
  for (let i = 0; i < bytes.length; ) {
    const part = bytes.slice(i, i + chunkSize);
    try {
      if (fast) await ch.writeValueWithoutResponse!(part);
      else if (ch.writeValueWithResponse) await ch.writeValueWithResponse(part);
      else await ch.writeValue(part);
      i += part.length;
      // Give the printer's small buffer time to empty.
      if (fast) await sleep(chunkSize > 20 ? 20 : 6);
    } catch (e) {
      if (chunkSize > 20) {
        chunkSize = 20; // the printer accepts only small packets: retry this part smaller
        continue;
      }
      throw e;
    }
  }
}

async function flush(): Promise<void> {
  while (queue.length && channel) {
    const next = queue[0]!;
    set({ status: "printing", pending: queue.length });
    try {
      await writeAll(next);
      queue.shift();
    } catch (e) {
      channel = null;
      set({ status: "error", pending: queue.length, message: `Printing stopped: ${(e as Error).message}` });
      return;
    }
  }
  set({ status: channel ? "ready" : state.status, pending: queue.length });
}

function unsupportedMessage(): string {
  return isIos()
    ? "iPhones and iPads can't print to Bluetooth printers from Safari or Chrome. Open the POS in the Bluefy browser (App Store), or use the Print Agent."
    : "This browser can't use Bluetooth. Use Chrome on Android, or choose “Bluetooth via the RawBT app” for this workstation.";
}

/** Hands ESC/POS bytes to the RawBT app (Android), which prints them on its Bluetooth printer. */
export function rawbtLink(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `intent:base64,${btoa(bin)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

/**
 * Prints a receipt document on this device's Bluetooth printer. Returns true when it printed (or
 * went to RawBT); false when it is waiting for the printer, in which case the POS shows the
 * printer button and the job prints once the printer is connected.
 */
export function printBluetooth(doc: ReceiptDoc, via: "browser" | "rawbt" = "browser"): Promise<boolean> {
  const bytes = toEscPos(doc);
  if (via === "rawbt") {
    location.href = rawbtLink(bytes);
    return Promise.resolve(true);
  }
  const job = chain.then(async () => {
    queue.push(bytes);
    set({ pending: queue.length });
    if (!(await reconnect())) {
      set({ status: state.status === "unsupported" ? "unsupported" : "idle", message: api() ? "Printer not connected: tap the printer button to connect." : unsupportedMessage() });
      return false;
    }
    const before = queue.length;
    await flush();
    return queue.length < before;
  });
  chain = job.catch(() => undefined);
  return job;
}

/** Forgets the printer (to choose a different one). */
export function forgetPrinter(): void {
  try {
    device?.gatt?.disconnect();
  } catch {
    /* already gone */
  }
  device = null;
  channel = null;
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    /* ignore */
  }
  state = { status: api() ? "idle" : "unsupported", message: "", pending: queue.length };
  for (const l of listeners) l();
}

/** Drops prints that were waiting (they can be reprinted from the orders). */
export function clearPending(): void {
  queue.length = 0;
  set({ pending: 0 });
}

export function useBluetoothPrinter(): BtState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const _test = { reset: () => { device = null; channel = null; queue.length = 0; chunkSize = 100; state = { status: api() ? "idle" : "unsupported", pending: 0 }; } };
