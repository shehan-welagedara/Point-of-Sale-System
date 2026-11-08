/**
 * Locks business creation in projects set up before 1.0.0: records the owner of the oldest
 * business as the deployment owner (see firestore.rules mayCreateBusiness). Without this, the first
 * stranger to sign up could claim an existing client's project.
 */
export const id = "0001-deployment-owner";
export const description = "Record the deployment owner so only they (and business owners/admins) can create businesses";

export async function up({ db, log }) {
  const ref = db.doc("deployment/config");
  if ((await ref.get()).exists) return { skipped: "already set" };
  const tenants = (await db.collection("tenants").get()).docs.map((d) => d.data()).sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
  if (!tenants.length) return { skipped: "no businesses yet: the first one created claims the project" };
  await ref.set({ ownerUid: tenants[0].ownerUid, openSignup: false, createdAt: new Date().toISOString(), createdBy: "migration 0001" });
  log(`owner: ${tenants[0].ownerUid} (business ${tenants[0].id})`);
  return { ownerUid: tenants[0].ownerUid };
}
