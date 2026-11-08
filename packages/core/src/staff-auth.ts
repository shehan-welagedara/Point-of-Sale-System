/**
 * Employee PIN and card checks.
 *
 * PIN hashes and card numbers live in `staffSecrets`, which no client may read (security rules):
 * a 4–6 digit PIN hash can be cracked in seconds by anyone who can read it. Checks therefore run
 * on the server (the `posAuth` Cloud Function) — or, in the local demo, against the local store.
 * Both use this one implementation, including wrong-PIN counting and lockout, so approvals are
 * rate-limited exactly like sign-ins.
 */
import { DEFAULT_SIGN_IN } from "./privileges.js";
import { COLLECTIONS as C, type DocStore, type WriteOp } from "./store.js";
import type { PosSettings, Staff } from "./types.js";
import { verifyPin } from "./util.js";

export interface StaffSecret {
  id: string;
  pinHash?: string;
  pinSalt?: string;
  /** Card number (mag stripe / RFID); empty = no card. */
  cardId?: string;
  pinChangedAt?: string;
}

export const SECRET_FIELDS = ["pinHash", "pinSalt", "cardId"] as const;

export type StaffAuthRequest =
  | { action: "verify"; staffId: string; pin: string; purpose: "signIn" | "approve" }
  | { action: "identifyCard"; card: string }
  | { action: "migrate" };

export type StaffAuthResult =
  | { ok: true; staffId: string; migrated?: number }
  | { ok: false; reason: string; locked?: boolean; triesLeft?: number };

async function secretFor(store: DocStore, staff: Staff): Promise<StaffSecret | null> {
  const s = await store.get<StaffSecret>(C.staffSecrets, staff.id);
  if (s?.pinHash) return s;
  // Records written before PINs moved to staffSecrets: use them once, then move them.
  if (staff.pinHash && staff.pinSalt) return { id: staff.id, pinHash: staff.pinHash, pinSalt: staff.pinSalt, ...(staff.cardId ? { cardId: staff.cardId } : {}) };
  return s;
}

/** Moves any PIN hash or card number still on a staff record into staffSecrets. */
export function moveSecretsOps(staff: Staff, existing: StaffSecret | null): WriteOp[] {
  const legacy = staff as Staff & Record<string, unknown>;
  if (!SECRET_FIELDS.some((k) => legacy[k] !== undefined)) return [];
  const { pinHash, pinSalt, cardId, ...rest } = legacy;
  const secret: StaffSecret = {
    ...(existing ?? {}),
    id: staff.id,
    ...(pinHash && !existing?.pinHash ? { pinHash: String(pinHash), pinSalt: String(pinSalt), pinChangedAt: staff.pinChangedAt ?? new Date().toISOString() } : {}),
    ...(cardId && !existing?.cardId ? { cardId: String(cardId) } : {}),
  };
  return [
    { op: "set", col: C.staffSecrets, data: secret as unknown as { id: string } },
    { op: "set", col: C.staff, data: { ...rest, ...(secret.pinHash ? { pinSet: true } : {}), ...(secret.cardId ? { hasCard: true } : {}) } as unknown as { id: string } },
  ];
}

export async function runStaffAuth(store: DocStore, req: StaffAuthRequest, now = new Date()): Promise<StaffAuthResult> {
  if (req.action === "migrate") {
    const staff = await store.list<Staff>(C.staff);
    let migrated = 0;
    for (const s of staff) {
      const ops = moveSecretsOps(s, await store.get<StaffSecret>(C.staffSecrets, s.id));
      if (ops.length) {
        await store.batch(ops);
        migrated++;
      }
    }
    return { ok: true, staffId: "", migrated };
  }

  if (req.action === "identifyCard") {
    const card = req.card.trim();
    if (card.length < 4) return { ok: false, reason: "Unknown card" };
    const hits = (await store.list<StaffSecret>(C.staffSecrets, { where: [["cardId", "==", card]] })).map((s) => s.id);
    // Cards still on old-style staff records.
    for (const s of await store.list<Staff>(C.staff, { where: [["cardId", "==", card]] })) if (!hits.includes(s.id)) hits.push(s.id);
    if (hits.length !== 1) return { ok: false, reason: hits.length ? "This card is assigned to more than one employee" : "Unknown card" };
    const staff = await store.get<Staff>(C.staff, hits[0]!);
    if (!staff || staff.status !== "active") return { ok: false, reason: "This card's employee is not active" };
    if (staff.lockedAt) return { ok: false, reason: "Locked after too many wrong PINs. A manager must unlock you.", locked: true };
    return { ok: true, staffId: staff.id };
  }

  const staff = await store.get<Staff>(C.staff, req.staffId);
  if (!staff) return { ok: false, reason: "Unknown employee" };
  if (staff.status !== "active") return { ok: false, reason: "This employee is not active" };
  if (staff.lockedAt) return { ok: false, reason: "Locked after too many wrong PINs. A manager must unlock you.", locked: true };
  const secret = await secretFor(store, staff);
  if (!secret?.pinHash || !secret.pinSalt) return { ok: false, reason: "No PIN set. A manager sets it under People & Security → Employees." };

  const pos = await store.get<PosSettings>(C.settings, "pos");
  const maxFailed = pos?.maxFailedSignIns ?? DEFAULT_SIGN_IN.maxFailedSignIns;
  const at = now.toISOString();
  if (!(await verifyPin(req.pin, secret.pinHash, secret.pinSalt))) {
    const failed = (staff.failedSignIns ?? 0) + 1;
    const locked = failed >= maxFailed;
    await store.merge(C.staff, staff.id, { failedSignIns: failed, ...(locked ? { lockedAt: at } : {}) });
    return locked
      ? { ok: false, reason: `Locked after ${maxFailed} wrong PINs. A manager must unlock you.`, locked: true, triesLeft: 0 }
      : { ok: false, reason: `Wrong PIN (${maxFailed - failed} tries left)`, triesLeft: maxFailed - failed };
  }
  const ops: WriteOp[] = moveSecretsOps(staff, await store.get<StaffSecret>(C.staffSecrets, staff.id));
  if (ops.length) await store.batch(ops);
  await store.merge(C.staff, staff.id, { failedSignIns: 0, ...(req.purpose === "signIn" ? { lastSignInAt: at } : {}) });
  return { ok: true, staffId: staff.id };
}

/**
 * Store wrapper: whenever a staff record is saved with a PIN hash or card number (the employee
 * form, demo data, imports), those go to staffSecrets and the staff record keeps only
 * `pinSet` / `hasCard`. `removeCard: true` clears the card.
 */
export function withStaffSecrets(store: DocStore): DocStore {
  const split = (data: Record<string, unknown>): WriteOp[] => {
    const { pinHash, pinSalt, cardId, removeCard, ...rest } = data;
    const id = String(data.id);
    const card = typeof cardId === "string" ? cardId.trim() : "";
    const ops: WriteOp[] = [];
    if (pinHash || card || removeCard) {
      ops.push({ op: "merge", col: C.staffSecrets, id, data: { id, ...(pinHash ? { pinHash, pinSalt, pinChangedAt: rest.pinChangedAt ?? new Date().toISOString() } : {}), ...(card ? { cardId: card } : removeCard ? { cardId: "" } : {}) } });
    }
    ops.push({ op: "set", col: C.staff, data: { ...rest, ...(pinHash ? { pinSet: true } : {}), ...(card ? { hasCard: true } : removeCard ? { hasCard: false } : {}) } as { id: string } });
    return ops;
  };
  const rewrite = (ops: readonly WriteOp[]): WriteOp[] =>
    ops.flatMap((o) => (o.col === C.staff && o.op === "set" ? split(o.data as Record<string, unknown>) : [o]));
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === "set")
        return async (col: string, data: { id: string }) => (col === C.staff ? target.batch(split(data as unknown as Record<string, unknown>)) : target.set(col, data));
      if (prop === "batch") return async (ops: WriteOp[]) => target.batch(rewrite(ops));
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
