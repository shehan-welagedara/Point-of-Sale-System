import type { DocStore, Increments, Query, WriteOp } from "@pos/core";

/**
 * Transaction used by posting. Like Firestore transactions, all reads happen before any write,
 * and writes are applied together at the end (all or nothing).
 */
export interface Tx {
  get<T>(col: string, id: string): Promise<T | null>;
  query<T>(col: string, q?: Query): Promise<T[]>;
  set<T extends { id: string }>(col: string, data: T): void;
  merge(col: string, id: string, data: Record<string, unknown>): void;
  increment(col: string, id: string, inc: Increments, base?: Record<string, unknown>): void;
}

export interface TxRunner {
  run<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

export class ReadAfterWriteError extends Error {}

/** Transaction runner over any DocStore (local demo mode and tests). */
export function storeRunner(store: DocStore): TxRunner {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      // Serialise transactions on this runner, like Firestore's optimistic retries would.
      const next = chain.then(async () => {
        const ops: WriteOp[] = [];
        const guard = () => {
          if (ops.length) throw new ReadAfterWriteError("transactions must read everything before writing");
        };
        const tx: Tx = {
          async get(col, id) {
            guard();
            return store.get(col, id);
          },
          async query(col, q) {
            guard();
            return store.list(col, q);
          },
          set(col, data) {
            ops.push({ op: "set", col, data });
          },
          merge(col, id, data) {
            ops.push({ op: "merge", col, id, data });
          },
          increment(col, id, inc, base) {
            ops.push({ op: "increment", col, id, inc, ...(base ? { base } : {}) });
          },
        };
        const result = await fn(tx);
        if (ops.length) await store.batch(ops);
        return result;
      });
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
