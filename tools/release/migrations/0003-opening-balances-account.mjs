/**
 * Adds account 3900 "Opening balances (temporary)" to businesses that keep books. Opening stock,
 * opening balances imported from Excel and suppliers' and customers' opening amounts post against
 * it; it nets to zero once all opening balances are in.
 */
export const id = "0003-opening-balances-account";
export const description = "Add account 3900 Opening balances (temporary) to existing charts of accounts";

export async function up({ db, log }) {
  let added = 0;
  for (const t of (await db.collection("tenants").get()).docs) {
    const accounts = t.ref.collection("accounts");
    if ((await accounts.limit(1).get()).empty) continue;
    const ref = accounts.doc("3900");
    if ((await ref.get()).exists) continue;
    await ref.set({ id: "3900", code: "3900", name: "Opening balances (temporary)", type: "equity", parentId: "3", isGroup: false });
    added++;
  }
  log(`added to ${added} business(es)`);
  return { added };
}
