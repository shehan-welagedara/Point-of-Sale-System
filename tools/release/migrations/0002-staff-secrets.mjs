/**
 * Moves employee PIN hashes and card numbers off staff records (readable by everyone in the
 * business) into staffSecrets (readable only by the server). The posAuth function also moves them
 * one by one on first use; this does all of them at once.
 */
export const id = "0002-staff-secrets";
export const description = "Move PIN hashes and card numbers into staffSecrets";

export async function up({ db, FieldValue, log }) {
  let moved = 0;
  for (const t of (await db.collection("tenants").get()).docs) {
    const staff = await t.ref.collection("staff").get();
    let batch = db.batch();
    let n = 0;
    for (const s of staff.docs) {
      const d = s.data();
      if (d.pinHash === undefined && d.pinSalt === undefined && d.cardId === undefined) continue;
      const secretRef = t.ref.collection("staffSecrets").doc(s.id);
      const existing = (await secretRef.get()).data() ?? {};
      batch.set(secretRef, {
        id: s.id,
        ...(d.pinHash && !existing.pinHash ? { pinHash: d.pinHash, pinSalt: d.pinSalt, pinChangedAt: d.pinChangedAt ?? new Date().toISOString() } : {}),
        ...(d.cardId && !existing.cardId ? { cardId: d.cardId } : {}),
      }, { merge: true });
      batch.update(s.ref, {
        pinHash: FieldValue.delete(),
        pinSalt: FieldValue.delete(),
        cardId: FieldValue.delete(),
        ...(d.pinHash || existing.pinHash ? { pinSet: true } : {}),
        ...(d.cardId || existing.cardId ? { hasCard: true } : {}),
      });
      moved++;
      if (++n >= 200) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n) await batch.commit();
  }
  log(`${moved} employee record(s) secured`);
  return { moved };
}
