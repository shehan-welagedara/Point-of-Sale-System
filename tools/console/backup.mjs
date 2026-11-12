/**
 * Backs up the Polymath Console's database (clients, licences, payments, staff, audit log) into a
 * bucket in its own project, the same way client deploys back up their data (google.mjs):
 *
 *   pnpm console:backup                      (project from release/console.json)
 *   pnpm console:backup --project polymath-console
 *
 * The bucket gs://<project>-backups is created the first time (old backups deleted after 90 days).
 * Also switches on Firestore's delete protection, so the database can't be deleted by mistake.
 * Uses the Firebase CLI's sign-in (pnpm exec firebase login).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureBackupBucket, exportFirestore, protectDatabase, reason, root, signIn } from "../release/google.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--project");
const saved = existsSync(join(root, "release/console.json")) ? JSON.parse(readFileSync(join(root, "release/console.json"), "utf8")) : {};
const project = (i >= 0 ? argv[i + 1] : undefined) ?? saved.projectId;
const fail = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};
if (!project) fail("which project? Run `pnpm console:setup` first, or pass --project");

const bucket = `gs://${project}-backups`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const target = `${bucket}/console/${stamp}`;
try {
  console.log(`\nPolymath Console backup → ${target}\n`);
  console.log(`  signed in as ${await signIn(project)}`);
  await ensureBackupBucket({ projectId: project, bucket, log: (m) => console.log(`  ${m}`) });
  await exportFirestore({ projectId: project, outputUriPrefix: target, log: (m) => console.log(`  ${m}`) });
  console.log("  ✓ backup finished");
  await protectDatabase(project).then(
    () => console.log("  ✓ delete protection is on"),
    (e) => console.warn(`  ! couldn't switch on delete protection (${reason(e)}); you can in Firebase console → Firestore → Settings`),
  );
  console.log(`\n✓ Restore it, if ever needed: Google Cloud console → Firestore → Import/Export → Import, folder ${target}\n`);
} catch (e) {
  fail(`the backup didn't finish: ${reason(e)}`);
}
