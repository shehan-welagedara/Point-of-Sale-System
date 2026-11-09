/**
 * Phones and tablets as POS devices, over the internet, without shared passwords.
 *
 * A manager creates a one-time pairing code for a workstation (back office → Workstations &
 * printers → Connect a phone). The phone scans the QR code (or types the code) and redeems it
 * here: the server creates a login for that one device, with the POS terminal role, and returns
 * its credentials once. Nobody sees or types a password, every phone has its own login, and a
 * lost phone or a leaver's phone is removed on its own (its login is deleted at once).
 *
 * Codes: 8 characters from a 31-letter alphabet (≈ 8.5 × 10¹¹ combinations), stored only as a
 * SHA-256 hash, valid for 15 minutes and for one phone. Clients can't read or write them.
 */
import { createHash, randomInt } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { type Member, type Tenant, type Workstation, isOn } from "@pos/core";

export const PAIRING_MINUTES = 15;
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MANAGERS = ["owner", "admin", "manager"];
const DEVICE_EMAIL_DOMAIN = "devices.pos-suite.invalid";

export type DeviceRequest =
  | { action: "create"; tenantId: string; workstationId: string; label: string }
  | { action: "pair"; code: string; userAgent?: string }
  | { action: "revoke"; tenantId: string; uid: string };

export interface PairingRecord {
  tenantId: string;
  workstationId: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

/** What a device's member record carries besides the usual fields. */
export interface DeviceInfo {
  workstationId: string;
  pairedAt: string;
  pairedBy: string;
  userAgent?: string;
}

const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const codeHash = (code: string) => createHash("sha256").update(`pos-pairing:${normalize(code)}`).digest("hex");

function newCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** A long random password meeting any Firebase password policy (it is never shown to anyone). */
function devicePassword(): string {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "-_.!"];
  const all = sets.join("");
  const chars = sets.map((s) => s[randomInt(s.length)]!);
  while (chars.length < 40) chars.push(all[randomInt(all.length)]!);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

async function managerOf(db: Firestore, tenantId: string, uid: string): Promise<{ tenant: Tenant; member: Member }> {
  if (typeof tenantId !== "string" || !tenantId) throw new HttpsError("invalid-argument", "tenantId is required");
  const [t, m] = await Promise.all([db.doc(`tenants/${tenantId}`).get(), db.doc(`tenants/${tenantId}/members/${uid}`).get()]);
  if (!t.exists) throw new HttpsError("not-found", "business not found");
  const member = m.data() as Member | undefined;
  if (!member || !MANAGERS.includes(member.role)) throw new HttpsError("permission-denied", "only an owner, administrator or manager can connect or remove devices");
  return { tenant: t.data() as Tenant, member };
}

export async function handleDeviceRequest(db: Firestore, uid: string | undefined, req: DeviceRequest, now = new Date()): Promise<unknown> {
  switch (req?.action) {
    case "create": {
      if (!uid) throw new HttpsError("unauthenticated", "sign in first");
      const { tenant } = await managerOf(db, req.tenantId, uid);
      if (!isOn(tenant.modules, "pos")) throw new HttpsError("failed-precondition", "the Point of Sale module is not enabled for this business");
      const label = typeof req.label === "string" ? req.label.trim().slice(0, 40) : "";
      if (!label) throw new HttpsError("invalid-argument", "give the device a name, for example \"Nimal's phone\"");
      if (typeof req.workstationId !== "string" || !req.workstationId) throw new HttpsError("invalid-argument", "choose a workstation");
      const ws = (await db.doc(`tenants/${req.tenantId}/workstations/${req.workstationId}`).get()).data() as Workstation | undefined;
      if (!ws?.active) throw new HttpsError("failed-precondition", "that workstation doesn't exist or isn't active");
      const code = newCode();
      const expiresAt = new Date(now.getTime() + PAIRING_MINUTES * 60_000).toISOString();
      const rec: PairingRecord = { tenantId: req.tenantId, workstationId: req.workstationId, label, createdBy: uid, createdAt: now.toISOString(), expiresAt };
      await db.doc(`devicePairings/${codeHash(code)}`).set(rec);
      return { code, expiresAt };
    }

    case "pair": {
      if (typeof req.code !== "string" || normalize(req.code).length !== 8) throw new HttpsError("invalid-argument", "type the 8-character code");
      const ref = db.doc(`devicePairings/${codeHash(req.code)}`);
      const invalid = new HttpsError("failed-precondition", "This code isn't valid any more. Ask the manager for a new one (codes work once, for 15 minutes).");
      const rec = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const r = snap.data() as PairingRecord | undefined;
        if (!r || r.usedAt || r.expiresAt < now.toISOString()) throw invalid;
        tx.update(ref, { usedAt: now.toISOString() });
        return r;
      });
      const deviceUid = `dev-${createHash("sha256").update(`${ref.id}:${now.getTime()}:${randomInt(1e9)}`).digest("hex").slice(0, 20)}`;
      const email = `${deviceUid}@${DEVICE_EMAIL_DOMAIN}`;
      const password = devicePassword();
      await getAuth().createUser({ uid: deviceUid, email, password, displayName: rec.label, emailVerified: false });
      const device: DeviceInfo = { workstationId: rec.workstationId, pairedAt: now.toISOString(), pairedBy: rec.createdBy, ...(typeof req.userAgent === "string" ? { userAgent: req.userAgent.slice(0, 200) } : {}) };
      const member: Member & { device: DeviceInfo } = { id: deviceUid, uid: deviceUid, email, name: rec.label, role: "terminal", tenantId: rec.tenantId, createdAt: now.toISOString(), device };
      await db.doc(`tenants/${rec.tenantId}/members/${deviceUid}`).set(member);
      await ref.update({ usedBy: deviceUid });
      return { email, password, tenantId: rec.tenantId, workstationId: rec.workstationId, label: rec.label };
    }

    case "revoke": {
      if (!uid) throw new HttpsError("unauthenticated", "sign in first");
      await managerOf(db, req.tenantId, uid);
      if (typeof req.uid !== "string" || !req.uid) throw new HttpsError("invalid-argument", "which device?");
      const ref = db.doc(`tenants/${req.tenantId}/members/${req.uid}`);
      const m = (await ref.get()).data() as (Member & { device?: DeviceInfo }) | undefined;
      if (!m?.device) throw new HttpsError("not-found", "that device isn't connected to this business");
      // The member record goes first: the security rules refuse the phone at once.
      await ref.delete();
      await getAuth().deleteUser(req.uid).catch((e: { code?: string }) => {
        if (e.code !== "auth/user-not-found") throw e;
      });
      return { removed: req.uid };
    }

    default:
      throw new HttpsError("invalid-argument", "unknown action");
  }
}

/** Removes used and expired pairing codes (kept a day for the record). */
export async function prunePairings(db: Firestore, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const old = await db.collection("devicePairings").where("expiresAt", "<", cutoff).limit(400).get();
  if (old.empty) return 0;
  const b = db.batch();
  old.docs.forEach((d) => b.delete(d.ref));
  await b.commit();
  return old.size;
}

export const _test = { newCode, devicePassword, normalize };
