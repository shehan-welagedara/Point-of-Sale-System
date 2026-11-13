/**
 * 1.11.0 adds two POS privileges: "pos.adjustClosed" (change the payment method of a closed check)
 * and "pos.tillCount" (cash pickups and till counts). Roles saved before then don't list them, so
 * owners and managers would need approval from nobody. This gives them to the roles that already
 * hold the related privileges: adjustClosed to roles that may refund or approve for others, tillCount to roles that may
 * run End of Day or approve for others.
 */
export const id = "0006-closed-check-privileges";
export const description = "Give existing roles the new privileges: change payment on closed checks, cash pickups and till counts";

/** The privileges a role gets (pure, also used by the core tests). */
export function upgradeRole(role) {
  const p = new Set(role.privileges ?? []);
  const add = [];
  if ((p.has("pos.refund") || p.has("pos.managerOverride")) && !p.has("pos.adjustClosed")) add.push("pos.adjustClosed");
  if ((p.has("pos.endOfDay") || p.has("pos.managerOverride")) && !p.has("pos.tillCount")) add.push("pos.tillCount");
  return add.length ? { ...role, privileges: [...(role.privileges ?? []), ...add] } : null;
}

export async function up({ db, log }) {
  let changed = 0;
  for (const t of (await db.collection("tenants").get()).docs) {
    for (const r of (await t.ref.collection("roles").get()).docs) {
      const next = upgradeRole(r.data());
      if (!next) continue;
      await r.ref.set({ privileges: next.privileges }, { merge: true });
      changed++;
    }
  }
  log(`updated ${changed} role(s)`);
  return { changed };
}
