import { type DocumentData, FieldValue, type Firestore, type Query as FsQuery, type Transaction } from "firebase-admin/firestore";
import type { DocData, DocStore, Increments, Query, WriteOp } from "@pos/core";
import { LEDGER, type Tx, type TxRunner } from "@pos/ledger";

/** Audit trail lives outside tenants/… so writing it never re-triggers the audit trigger. */
export function collectionRef(db: Firestore, tenantId: string, col: string) {
  if (col === LEDGER.auditEvents) return db.collection("auditLog").doc(tenantId).collection("events");
  if (col === LEDGER.auditSeals) return db.collection("auditLog").doc(tenantId).collection("seals");
  return db.collection("tenants").doc(tenantId).collection(col);
}

function toIncrements(inc: Increments): DocumentData {
  const out: DocumentData = {};
  for (const [k, v] of Object.entries(inc)) out[k] = typeof v === "number" ? FieldValue.increment(v) : toIncrements(v);
  return out;
}

function build(db: Firestore, tenantId: string, col: string, q?: Query): FsQuery {
  let query: FsQuery = collectionRef(db, tenantId, col);
  for (const [field, op, value] of q?.where ?? []) query = query.where(field, op, value);
  if (q?.orderBy) query = query.orderBy(q.orderBy[0], q.orderBy[1] ?? "asc");
  if (q?.limit !== undefined) query = query.limit(q.limit);
  return query;
}

/** Tenant-scoped store over the Admin SDK (bypasses security rules; used only by trusted code). */
export class AdminStore implements DocStore {
  constructor(
    private readonly db: Firestore,
    readonly tenantId: string,
  ) {}

  private ref(col: string, id: string) {
    return collectionRef(this.db, this.tenantId, col).doc(id);
  }

  async get<T>(col: string, id: string): Promise<T | null> {
    const snap = await this.ref(col, id).get();
    return snap.exists ? ({ ...snap.data(), id: snap.id } as T) : null;
  }

  async list<T>(col: string, q?: Query): Promise<T[]> {
    const snap = await build(this.db, this.tenantId, col, q).get();
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
  }

  async set<T extends DocData>(col: string, data: T): Promise<void> {
    await this.ref(col, data.id).set(data as DocumentData);
  }

  async merge(col: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.ref(col, id).set(data, { merge: true });
  }

  async increment(col: string, id: string, inc: Increments, base?: Record<string, unknown>): Promise<void> {
    await this.ref(col, id).set({ ...(base ?? {}), id, ...toIncrements(inc) }, { merge: true });
  }

  async nextSequence(col: string, id: string): Promise<number> {
    const ref = this.ref(col, id);
    return this.db.runTransaction(async (t: Transaction) => {
      const seq = (Number((await t.get(ref)).get("seq")) || 0) + 1;
      t.set(ref, { id, seq }, { merge: true });
      return seq;
    });
  }

  async remove(col: string, id: string): Promise<void> {
    await this.ref(col, id).delete();
  }

  async batch(ops: WriteOp[]): Promise<void> {
    for (let i = 0; i < ops.length; i += 450) {
      const b = this.db.batch();
      for (const op of ops.slice(i, i + 450)) {
        if (op.op === "set") b.set(this.ref(op.col, op.data.id), op.data as DocumentData);
        else if (op.op === "merge") b.set(this.ref(op.col, op.id), op.data, { merge: true });
        else if (op.op === "increment") b.set(this.ref(op.col, op.id), { ...(op.base ?? {}), id: op.id, ...toIncrements(op.inc) }, { merge: true });
        else b.delete(this.ref(op.col, op.id));
      }
      await b.commit();
    }
  }

  watch(): () => void {
    throw new Error("watch is not used server-side");
  }
}

/** Ledger transactions on Firestore: serialisable, retried on contention, all-or-nothing. */
export function adminRunner(db: Firestore, tenantId: string): TxRunner {
  return {
    run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      return db.runTransaction(async (t: Transaction) => {
        const ref = (col: string, id: string) => collectionRef(db, tenantId, col).doc(id);
        const tx: Tx = {
          async get(col, id) {
            const snap = await t.get(ref(col, id));
            return snap.exists ? ({ ...snap.data(), id: snap.id } as never) : null;
          },
          async query(col, q) {
            const snap = await t.get(build(db, tenantId, col, q));
            return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as never);
          },
          set(col, data) {
            t.set(ref(col, data.id), data as DocumentData);
          },
          merge(col, id, data) {
            t.set(ref(col, id), data, { merge: true });
          },
          increment(col, id, inc, base) {
            t.set(ref(col, id), { ...(base ?? {}), id, ...toIncrements(inc) }, { merge: true });
          },
        };
        return fn(tx);
      });
    },
  };
}
