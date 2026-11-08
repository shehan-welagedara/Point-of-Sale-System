import { hashPin, sha256Hex, verifyPin } from "@pos/core";

/**
 * Sign-in when the internet is down. After the server accepts a PIN (or a card), this device keeps
 * its own salted hash of it for 7 days, so that employee can still sign in here — and only here —
 * while the server can't be reached. Five wrong offline PINs erase the entry, so the device then
 * needs the server again. Nothing leaves the device; the business-wide PIN store stays unreadable.
 */
const DAYS = 7;
const MAX_FAILED = 5;

interface Entry {
  hash: string;
  salt: string;
  at: number;
  failed: number;
}

const key = (tenantId: string) => `pos-suite.offline.${tenantId}`;

function load(tenantId: string): { pins: Record<string, Entry>; cards: Record<string, string> } {
  try {
    const v = JSON.parse(localStorage.getItem(key(tenantId)) ?? "null") as { pins?: Record<string, Entry>; cards?: Record<string, string> } | null;
    return { pins: v?.pins ?? {}, cards: v?.cards ?? {} };
  } catch {
    return { pins: {}, cards: {} };
  }
}

function save(tenantId: string, v: { pins: Record<string, Entry>; cards: Record<string, string> }): void {
  try {
    localStorage.setItem(key(tenantId), JSON.stringify(v));
  } catch {
    /* storage full or blocked: offline sign-in simply isn't available */
  }
}

export async function rememberPin(tenantId: string, staffId: string, pin: string): Promise<void> {
  const v = load(tenantId);
  const { hash, salt } = await hashPin(pin);
  v.pins[staffId] = { hash, salt, at: Date.now(), failed: 0 };
  save(tenantId, v);
}

export async function rememberCard(tenantId: string, card: string, staffId: string): Promise<void> {
  const v = load(tenantId);
  v.cards[await sha256Hex(`${tenantId}|${card.trim()}`)] = staffId;
  save(tenantId, v);
}

export async function offlineCard(tenantId: string, card: string): Promise<string | null> {
  return load(tenantId).cards[await sha256Hex(`${tenantId}|${card.trim()}`)] ?? null;
}

export async function offlinePin(tenantId: string, staffId: string, pin: string): Promise<{ ok: boolean; reason?: string }> {
  const v = load(tenantId);
  const e = v.pins[staffId];
  if (!e || Date.now() - e.at > DAYS * 86_400_000) return { ok: false, reason: "No connection to the server, and this employee hasn't signed in on this device recently. Check the internet." };
  if (await verifyPin(pin, e.hash, e.salt)) {
    e.failed = 0;
    save(tenantId, v);
    return { ok: true };
  }
  e.failed += 1;
  if (e.failed >= MAX_FAILED) delete v.pins[staffId];
  save(tenantId, v);
  return { ok: false, reason: e.failed >= MAX_FAILED ? "Too many wrong PINs while offline. Sign in again when the internet is back." : `Wrong PIN (offline, ${MAX_FAILED - e.failed} tries left)` };
}
