/**
 * Which queries need a composite Firestore index (firebase/firestore.indexes.json).
 *
 * Firestore answers queries on one field, and equality-only queries on several fields, from its
 * automatic single-field indexes. An equality filter combined with a range or a sort on another
 * field (or a range and a sort on different fields) needs a composite index, and without it the
 * query fails in production with "The query requires an index", while the emulator and the local
 * demo answer it anyway. The end-to-end suite records every query the app runs (`queryAudit`) and
 * checks each one with these functions, so a missing index fails the tests instead of a client.
 */
import type { Query } from "./store.js";

export interface IndexNeed {
  /** Equality (and array-contains) fields, in any order, first in the index. */
  equality: string[];
  /** Then these fields, in this order and direction. */
  then: { field: string; order: "ASCENDING" | "DESCENDING" }[];
}

export interface DeclaredIndex {
  collectionGroup: string;
  queryScope?: string;
  fields: { fieldPath: string; order?: string; arrayConfig?: string }[];
}

const EQUALITY = new Set(["==", "in"]);

/** The composite index a query needs, or null when Firestore's automatic indexes are enough. */
export function compositeIndexNeeded(q: Query | undefined): IndexNeed | null {
  const where = q?.where ?? [];
  const equality = [...new Set(where.filter(([, op]) => EQUALITY.has(op) || op === "array-contains").map(([f]) => f))];
  const ranges = [...new Set(where.filter(([, op]) => !EQUALITY.has(op) && op !== "array-contains").map(([f]) => f))];
  const order = q?.orderBy;
  const then: IndexNeed["then"] = ranges.filter((f) => !order || order[0] !== f).map((field) => ({ field, order: "ASCENDING" as const }));
  if (order) then.push({ field: order[0], order: order[1] === "desc" ? "DESCENDING" : "ASCENDING" });
  const fields = new Set([...equality, ...then.map((t) => t.field)]);
  if (fields.size <= 1) return null;
  const hasContains = where.some(([, op]) => op === "array-contains");
  if (!then.length && !hasContains) return null;
  return { equality, then };
}

/** Whether one of the declared indexes serves the need (collection scope). */
export function indexDeclared(collection: string, need: IndexNeed, indexes: readonly DeclaredIndex[]): boolean {
  const eq = [...need.equality].sort().join(",");
  return indexes.some((ix) => {
    if (ix.collectionGroup !== collection || (ix.queryScope ?? "COLLECTION") !== "COLLECTION") return false;
    const fields = ix.fields.filter((f) => f.fieldPath !== "__name__");
    const k = need.equality.length;
    if (fields.slice(0, k).map((f) => f.fieldPath).sort().join(",") !== eq) return false;
    const rest = fields.slice(k);
    return need.then.every((t, i) => rest[i]?.fieldPath === t.field && (rest[i]?.order ?? "ASCENDING") === t.order);
  });
}

/** The Firestore collection a store collection name is kept in (audit events live under auditLog). */
export function firestoreCollection(storeName: string): string {
  return storeName === "auditEvents" ? "events" : storeName === "auditSeals" ? "seals" : storeName;
}
