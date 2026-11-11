/**
 * Bills said "Powered by POS Suite (demo)" in every business set up before 1.6.0: new businesses took
 * the demo restaurant's default. Replaces exactly that text with "Polymath Tech" (the new default);
 * a name the business typed itself is left alone.
 */
export const id = "0004-powered-by";
export const description = 'Bills: replace "Powered by POS Suite (demo)" with "Powered by Polymath Tech"';

export async function up({ db, log }) {
  let changed = 0;
  for (const t of (await db.collection("tenants").get()).docs) {
    const ref = t.ref.collection("settings").doc("branding");
    const b = await ref.get();
    if (b.exists && b.data().poweredBy === "POS Suite (demo)") {
      await ref.set({ poweredBy: "Polymath Tech" }, { merge: true });
      changed++;
    }
  }
  log(`updated ${changed} business(es)`);
  return { changed };
}
