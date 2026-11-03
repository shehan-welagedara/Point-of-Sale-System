import {
  type DocumentData,
  type Firestore,
  type Query as FsQuery,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import type { DocData, DocStore, Increments, Query, WriteOp } from "@pos/core";

function toIncrements(inc: Increments): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(inc)) out[k] = typeof v === "number" ? increment(v) : toIncrements(v);
  return out;
}

/** Firestore adapter: collection `x` lives at `tenants/{tenantId}/x`. */
export class FirestoreStore implements DocStore {
  constructor(
    private readonly db: Firestore,
    readonly tenantId: string,
  ) {}

  private col(name: string) {
    return collection(this.db, "tenants", this.tenantId, name);
  }

  private ref(name: string, id: string) {
    return doc(this.db, "tenants", this.tenantId, name, id);
  }

  private build(name: string, q?: Query): FsQuery {
    const parts = [];
    for (const [field, op, value] of q?.where ?? []) parts.push(where(field, op, value));
    if (q?.orderBy) parts.push(orderBy(q.orderBy[0], q.orderBy[1] ?? "asc"));
    if (q?.limit !== undefined) parts.push(limit(q.limit));
    return query(this.col(name), ...parts);
  }

  async get<T>(col: string, id: string): Promise<T | null> {
    const snap = await getDoc(this.ref(col, id));
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null;
  }

  async list<T>(col: string, q?: Query): Promise<T[]> {
    const snap = await getDocs(this.build(col, q));
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
  }

  async set<T extends DocData>(col: string, data: T): Promise<void> {
    await setDoc(this.ref(col, data.id), data as DocumentData);
  }

  async merge(col: string, id: string, data: Record<string, unknown>): Promise<void> {
    await setDoc(this.ref(col, id), data, { merge: true });
  }

  async increment(col: string, id: string, inc: Increments, base?: Record<string, unknown>): Promise<void> {
    await setDoc(this.ref(col, id), { ...(base ?? {}), id, ...toIncrements(inc) }, { merge: true });
  }

  async remove(col: string, id: string): Promise<void> {
    await deleteDoc(this.ref(col, id));
  }

  /**
   * Atomic for up to CHUNK writes (closing a check is 4–6). Security rules may make at most 20
   * document lookups per batched write, so bigger jobs (imports, demo data) are committed as
   * several small batches, a few in parallel.
   */
  async batch(ops: WriteOp[]): Promise<void> {
    const CHUNK = 9;
    const chunks: WriteOp[][] = [];
    for (let i = 0; i < ops.length; i += CHUNK) chunks.push(ops.slice(i, i + CHUNK));
    const commit = async (part: WriteOp[]) => {
      const b = writeBatch(this.db);
      for (const op of part) {
        if (op.op === "set") b.set(this.ref(op.col, op.data.id), op.data as DocumentData);
        else if (op.op === "merge") b.set(this.ref(op.col, op.id), op.data, { merge: true });
        else if (op.op === "increment") b.set(this.ref(op.col, op.id), { ...(op.base ?? {}), id: op.id, ...toIncrements(op.inc) }, { merge: true });
        else b.delete(this.ref(op.col, op.id));
      }
      await b.commit();
    };
    for (let i = 0; i < chunks.length; i += 6) await Promise.all(chunks.slice(i, i + 6).map(commit));
  }

  watch<T>(col: string, q: Query | undefined, cb: (docs: T[]) => void): () => void {
    return onSnapshot(
      this.build(col, q),
      (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T)),
      (err) => console.error(`watch ${col} failed`, err),
    );
  }
}
