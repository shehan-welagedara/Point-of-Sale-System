/**
 * Tenant-scoped document store. Services only see collection names; the Firestore adapter
 * (apps/web) maps them to `tenants/{tenantId}/{collection}`, the memory adapter keeps them
 * in maps (tests, local demo mode).
 */
export const COLLECTIONS = {
  settings: "settings",
  properties: "properties",
  revenueCenters: "revenueCenters",
  workstations: "workstations",
  printers: "printers",
  tables: "tables",
  orderTypes: "orderTypes",
  menuCategories: "menuCategories",
  menuItems: "menuItems",
  modifierGroups: "modifierGroups",
  discounts: "discounts",
  reasonCodes: "reasonCodes",
  tenderMedia: "tenderMedia",
  roles: "roles",
  staff: "staff",
  members: "members",
  timeCards: "timeCards",
  posJournal: "posJournal",
  menuImages: "menuImages",
  inventoryItems: "inventoryItems",
  locations: "locations",
  recipes: "recipes",
  vendors: "vendors",
  purchaseOrders: "purchaseOrders",
  goodsReceipts: "goodsReceipts",
  stockLevels: "stockLevels",
  stockMovements: "stockMovements",
  stockCounts: "stockCounts",
  customers: "customers",
  checks: "checks",
  invoices: "invoices",
  sequences: "sequences",
  dailyStats: "dailyStats",
  accounts: "accounts",
  journals: "journals",
  budgets: "budgets",
  printJobs: "printJobs",
  messageLog: "messageLog",
  audit: "audit",
} as const;

export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export type DocData = { id: string };

export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "array-contains";

export interface Query {
  where?: [field: string, op: WhereOp, value: unknown][];
  orderBy?: [field: string, direction?: "asc" | "desc"];
  limit?: number;
}

/** Nested object whose number leaves are added to the stored values. */
export type Increments = { [key: string]: number | Increments };

export type WriteOp =
  | { op: "set"; col: string; data: DocData }
  | { op: "merge"; col: string; id: string; data: Record<string, unknown> }
  | { op: "increment"; col: string; id: string; inc: Increments; base?: Record<string, unknown> }
  | { op: "delete"; col: string; id: string };

export interface DocStore {
  get<T>(col: string, id: string): Promise<T | null>;
  list<T>(col: string, query?: Query): Promise<T[]>;
  /** Create or fully replace a document. */
  set<T extends DocData>(col: string, data: T): Promise<void>;
  /** Deep-merge fields into a document (creating it if needed). */
  merge(col: string, id: string, data: Record<string, unknown>): Promise<void>;
  /** Atomically add numbers (creating the document from `base` if needed). */
  increment(col: string, id: string, inc: Increments, base?: Record<string, unknown>): Promise<void>;
  remove(col: string, id: string): Promise<void>;
  /** Apply several writes atomically (adapters chunk to the backend's batch limit). */
  batch(ops: WriteOp[]): Promise<void>;
  /** Live results; returns an unsubscribe function. */
  watch<T>(col: string, query: Query | undefined, cb: (docs: T[]) => void): () => void;
}

// ───────────────────────────── Memory implementation ─────────────────────────────

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : clone(v);
  }
  return out;
}

export function applyIncrements(target: Record<string, unknown>, inc: Increments): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [k, v] of Object.entries(inc)) {
    if (typeof v === "number") out[k] = (typeof out[k] === "number" ? (out[k] as number) : 0) + v;
    else out[k] = applyIncrements(isPlainObject(out[k]) ? (out[k] as Record<string, unknown>) : {}, v);
  }
  return out;
}

function getField(doc: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((v, k) => (isPlainObject(v) ? v[k] : undefined), doc);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

export function matches(doc: Record<string, unknown>, query: Query | undefined): boolean {
  for (const [field, op, value] of query?.where ?? []) {
    const v = getField(doc, field);
    const ok =
      op === "==" ? v === value
      : op === "!=" ? v !== value
      : op === "<" ? v !== undefined && compare(v, value) < 0
      : op === "<=" ? v !== undefined && compare(v, value) <= 0
      : op === ">" ? v !== undefined && compare(v, value) > 0
      : op === ">=" ? v !== undefined && compare(v, value) >= 0
      : op === "in" ? Array.isArray(value) && value.includes(v)
      : Array.isArray(v) && v.includes(value);
    if (!ok) return false;
  }
  return true;
}

export function runQuery<T>(docs: Record<string, unknown>[], query: Query | undefined): T[] {
  let out = docs.filter((d) => matches(d, query));
  if (query?.orderBy) {
    const [field, dir = "asc"] = query.orderBy;
    out = out.sort((a, b) => compare(getField(a, field), getField(b, field)) * (dir === "asc" ? 1 : -1));
  }
  if (query?.limit !== undefined) out = out.slice(0, query.limit);
  return out.map((d) => clone(d) as T);
}

type Listener = { col: string; query: Query | undefined; cb: (docs: unknown[]) => void };

/** In-memory store with change notifications; `snapshot()`/`load()` let the web app persist it. */
export class MemoryStore implements DocStore {
  private data = new Map<string, Map<string, Record<string, unknown>>>();
  private listeners = new Set<Listener>();
  /** Called after every write, e.g. to persist to localStorage. */
  onChange?: () => void;
  /** Called for every document change with its before/after state (local audit trail). */
  onWrite?: (change: { col: string; id: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }) => void;

  private colMap(col: string): Map<string, Record<string, unknown>> {
    let m = this.data.get(col);
    if (!m) this.data.set(col, (m = new Map()));
    return m;
  }

  async get<T>(col: string, id: string): Promise<T | null> {
    const d = this.colMap(col).get(id);
    return d ? (clone(d) as T) : null;
  }

  async list<T>(col: string, query?: Query): Promise<T[]> {
    return runQuery<T>([...this.colMap(col).values()], query);
  }

  async set<T extends DocData>(col: string, data: T): Promise<void> {
    this.apply([{ op: "set", col, data }]);
  }

  async merge(col: string, id: string, data: Record<string, unknown>): Promise<void> {
    this.apply([{ op: "merge", col, id, data }]);
  }

  async increment(col: string, id: string, inc: Increments, base?: Record<string, unknown>): Promise<void> {
    this.apply([{ op: "increment", col, id, inc, ...(base ? { base } : {}) }]);
  }

  async remove(col: string, id: string): Promise<void> {
    this.apply([{ op: "delete", col, id }]);
  }

  async batch(ops: WriteOp[]): Promise<void> {
    this.apply(ops);
  }

  watch<T>(col: string, query: Query | undefined, cb: (docs: T[]) => void): () => void {
    const l: Listener = { col, query, cb: cb as (docs: unknown[]) => void };
    this.listeners.add(l);
    queueMicrotask(() => {
      if (this.listeners.has(l)) cb(runQuery<T>([...this.colMap(col).values()], query));
    });
    return () => this.listeners.delete(l);
  }

  private apply(ops: WriteOp[]): void {
    const touched = new Set<string>();
    for (const op of ops) {
      const m = this.colMap(op.col);
      const id = op.op === "set" ? op.data.id : op.id;
      const before = m.get(id) ?? null;
      if (op.op === "set") {
        if (!op.data.id) throw new Error(`document in ${op.col} has no id`);
        m.set(op.data.id, clone(op.data) as Record<string, unknown>);
      } else if (op.op === "merge") {
        m.set(op.id, deepMerge(m.get(op.id) ?? { id: op.id }, op.data));
      } else if (op.op === "increment") {
        const existing = m.get(op.id) ?? deepMerge({ id: op.id }, op.base ?? {});
        m.set(op.id, applyIncrements(existing, op.inc));
      } else {
        m.delete(op.id);
      }
      touched.add(op.col);
      this.onWrite?.({ col: op.col, id, before, after: m.get(id) ?? null });
    }
    for (const l of this.listeners) {
      if (touched.has(l.col)) l.cb(runQuery([...this.colMap(l.col).values()], l.query));
    }
    this.onChange?.();
  }

  /** Whole store as plain JSON. */
  snapshot(): Record<string, Record<string, unknown>[]> {
    return Object.fromEntries([...this.data].map(([col, m]) => [col, [...m.values()]]));
  }

  load(snapshot: Record<string, Record<string, unknown>[]>): void {
    this.data.clear();
    for (const [col, docs] of Object.entries(snapshot)) {
      const m = this.colMap(col);
      for (const d of docs) m.set(String(d.id), d);
    }
    for (const l of this.listeners) l.cb(runQuery([...this.colMap(l.col).values()], l.query));
  }
}
