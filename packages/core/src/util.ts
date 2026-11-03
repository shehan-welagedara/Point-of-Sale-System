const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID-style id: time-sortable, generated on the device (works during internet drops). */
export function newId(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let rand = "";
  for (const b of bytes) rand += CROCKFORD[b % 32];
  return time + rand;
}

/** Normalise a user-entered code into a safe document id (Excel imports use codes as ids). */
export function codeToId(code: string): string {
  const id = code.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error(`invalid code "${code}"`);
  return id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** PBKDF2-SHA256 PIN hash. Production verifies PINs server-side; the demo verifies on the device. */
export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4–8 digits");
  const salt = saltHex ?? toHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const saltBytes = new Uint8Array(salt.match(/../g)!.map((h) => parseInt(h, 16)));
  const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 50_000 }, key, 256);
  return { hash: toHex(new Uint8Array(bits)), salt };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  if (!/^\d{4,8}$/.test(pin)) return false;
  return (await hashPin(pin, salt)).hash === hash;
}

export function sum<T>(items: readonly T[], f: (x: T) => number): number {
  return items.reduce((a, x) => a + f(x), 0);
}

/** `YYYY-MM-DD` dates between two inclusive bounds. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
