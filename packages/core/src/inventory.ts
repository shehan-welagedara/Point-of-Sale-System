import { COLLECTIONS as C, type DocStore, type WriteOp } from "./store.js";
import type {
  AuditEntry,
  Check,
  GoodsReceipt,
  InventoryItem,
  MenuItem,
  ModifierGroup,
  MovementType,
  Recipe,
  StockCount,
  StockLevel,
  StockLot,
  StockMovement,
  StockMovementLine,
} from "./types.js";
import { itemUnitCost, costingContext } from "./costing.js";
import { newId, nowIso } from "./util.js";

export function stockLevelId(locationId: string, itemId: string): string {
  return `${locationId}__${itemId}`;
}

export function emptyLevel(locationId: string, itemId: string): StockLevel {
  return { id: stockLevelId(locationId, itemId), itemId, locationId, qty: 0, value: 0, lots: [], updatedAt: nowIso() };
}

const EPS = 1e-9;

function revalue(level: StockLevel): StockLevel {
  const lotQty = level.lots.reduce((a, l) => a + l.qty, 0);
  const value = Math.round(level.lots.reduce((a, l) => a + l.qty * l.unitCost, 0));
  // `qty` can go below the lots (negative stock) when sales outrun recorded receipts.
  return { ...level, value, qty: level.qty < 0 ? level.qty : lotQty };
}

/** Adds a FIFO lot. If stock was negative, the receipt first covers the shortfall. */
export function addLot(level: StockLevel, lot: StockLot): StockLevel {
  let qty = lot.qty;
  let lots = [...level.lots];
  let currentQty = level.qty;
  if (currentQty < 0) {
    const cover = Math.min(qty, -currentQty);
    qty -= cover;
    currentQty += cover;
  }
  if (qty > EPS) lots = [...lots, { ...lot, qty }].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const next = { ...level, lots, qty: currentQty < 0 ? currentQty : lots.reduce((a, l) => a + l.qty, 0), updatedAt: nowIso() };
  return revalue(next);
}

/**
 * Consumes `qty` from the oldest lots first. Returns the FIFO cost of what was consumed;
 * anything beyond the lots is a shortage, costed at `fallbackUnitCost` and left as negative stock.
 */
export function consumeFifo(level: StockLevel, qty: number, fallbackUnitCost: number): { level: StockLevel; cost: number; shortage: number } {
  let remaining = qty;
  let cost = 0;
  const lots: StockLot[] = [];
  for (const lot of level.lots) {
    if (remaining <= EPS) {
      lots.push(lot);
      continue;
    }
    const take = Math.min(lot.qty, remaining);
    cost += take * lot.unitCost;
    remaining -= take;
    if (lot.qty - take > EPS) lots.push({ ...lot, qty: lot.qty - take });
  }
  const shortage = remaining > EPS ? remaining : 0;
  cost += shortage * fallbackUnitCost;
  const onHand = level.qty - qty;
  return { level: revalue({ ...level, lots, qty: onHand, updatedAt: nowIso() }), cost, shortage };
}

async function loadLevels(store: DocStore, locationId: string, itemIds: Iterable<string>): Promise<Map<string, StockLevel>> {
  const out = new Map<string, StockLevel>();
  await Promise.all(
    [...new Set(itemIds)].map(async (itemId) => {
      out.set(itemId, (await store.get<StockLevel>(C.stockLevels, stockLevelId(locationId, itemId))) ?? emptyLevel(locationId, itemId));
    }),
  );
  return out;
}

export class InventoryError extends Error {}

/** Posts a goods receipt: adds FIFO lots, updates latest purchase costs, marks the PO received. */
export async function postGoodsReceipt(store: DocStore, grnId: string, by: string): Promise<GoodsReceipt> {
  const grn = await store.get<GoodsReceipt>(C.goodsReceipts, grnId);
  if (!grn) throw new InventoryError("goods receipt not found");
  if (grn.status === "posted") throw new InventoryError("goods receipt already posted");
  if (grn.lines.length === 0) throw new InventoryError("goods receipt has no lines");
  const items = new Map((await store.list<InventoryItem>(C.inventoryItems)).map((i) => [i.id, i]));
  const levels = await loadLevels(store, grn.locationId, grn.lines.map((l) => l.inventoryItemId));
  const at = nowIso();
  const lines: StockMovementLine[] = [];
  const ops: WriteOp[] = [];
  for (const line of grn.lines) {
    const item = items.get(line.inventoryItemId);
    if (!item) throw new InventoryError(`unknown item ${line.inventoryItemId}`);
    if (!(line.qty > 0)) throw new InventoryError(`quantity for ${item.name} must be positive`);
    const stockQty = line.qty * item.purchaseFactor;
    const unitCost = line.unitCost / item.purchaseFactor;
    const level = addLot(levels.get(item.id)!, { lotId: newId(), receivedAt: `${grn.date}T${at.slice(11)}`, qty: stockQty, unitCost, source: grn.number });
    levels.set(item.id, level);
    lines.push({ itemId: item.id, qty: stockQty, cost: Math.round(line.qty * line.unitCost) });
    ops.push({ op: "merge", col: C.inventoryItems, id: item.id, data: { purchaseCost: line.unitCost } });
  }
  for (const level of levels.values()) ops.push({ op: "set", col: C.stockLevels, data: level });
  const movement: StockMovement = { id: newId(), type: "receive", locationId: grn.locationId, businessDate: grn.date, at, ref: grn.number, lines };
  ops.push({ op: "set", col: C.stockMovements, data: movement });
  const posted: GoodsReceipt = { ...grn, status: "posted", postedAt: at };
  ops.push({ op: "set", col: C.goodsReceipts, data: posted });
  if (grn.purchaseOrderId) ops.push({ op: "merge", col: C.purchaseOrders, id: grn.purchaseOrderId, data: { status: "received" } });
  const audit: AuditEntry = { id: newId(), at, by, action: "post", entity: "goodsReceipt", entityId: grn.id };
  ops.push({ op: "set", col: C.audit, data: audit });
  await store.batch(ops);
  return posted;
}

export interface UsageContext {
  menuItems: ReadonlyMap<string, MenuItem>;
  modifierGroups: ReadonlyMap<string, ModifierGroup>;
  recipes: ReadonlyMap<string, Recipe>;
  items: ReadonlyMap<string, InventoryItem>;
}

function addUsage(usage: Map<string, number>, itemId: string, qty: number, ctx: UsageContext, depth = 0): void {
  const item = ctx.items.get(itemId);
  // Prep items that are not stocked are exploded into their own ingredients.
  if (item?.isPrep && !item.trackStock && depth < 8) {
    const recipe = ctx.recipes.get(itemId);
    if (recipe && recipe.yieldQty > 0) {
      for (const l of recipe.lines) addUsage(usage, l.inventoryItemId, (l.qty * qty) / recipe.yieldQty, ctx, depth + 1);
      return;
    }
  }
  if (item && !item.trackStock) return;
  usage.set(itemId, (usage.get(itemId) ?? 0) + qty);
}

/** Theoretical ingredient usage of checks: recipes × quantities, plus modifier stock effects. */
export function theoreticalUsage(checks: readonly Check[], ctx: UsageContext): Map<string, number> {
  const usage = new Map<string, number>();
  for (const check of checks) {
    for (const line of check.lines) {
      if (line.voided && line.sentRound === undefined) continue; // never prepared
      const recipe = ctx.recipes.get(line.menuItemId);
      if (recipe && recipe.yieldQty > 0) {
        for (const l of recipe.lines) addUsage(usage, l.inventoryItemId, (l.qty * line.qty) / recipe.yieldQty, ctx);
      }
      for (const m of line.modifiers) {
        const opt = ctx.modifierGroups.get(m.groupId)?.options.find((o) => o.id === m.optionId);
        if (opt?.inventoryItemId && opt.qty) addUsage(usage, opt.inventoryItemId, opt.qty * line.qty, ctx);
      }
    }
  }
  return usage;
}

/**
 * Depletes stock for closed checks waiting for it, oldest lots first (FIFO). Usage is aggregated
 * per business date so a run costs one read and one write per ingredient, not per sale line.
 */
export async function processDepletion(store: DocStore, args: { locationId: string; by: string; limit?: number }): Promise<{ checks: number; movements: StockMovement[]; returns: number }> {
  const sold = await depleteChecks(store, args);
  const back = await restockCreditNotes(store, args);
  return { checks: sold.checks, movements: [...sold.movements, ...back.movements], returns: back.notes };
}

/** Pseudo-checks for the items on credit notes (to reuse the recipe and modifier usage). */
function creditNoteChecks(notes: readonly CreditNoteLike[]): Check[] {
  return notes.map((n) => ({ id: n.id, lines: n.lines.map((l) => ({ id: l.lineId, menuItemId: l.menuItemId, name: l.name, qty: l.qty, unitPrice: 0, modifiers: l.modifiers, taxClass: "", kotRoute: "kitchen", categoryId: l.categoryId, discountIds: [], sentRound: 1 })) }) as unknown as Check);
}

interface CreditNoteLike {
  id: string;
  businessDate: string;
  lines: { lineId: string; menuItemId: string; name: string; categoryId: string; qty: number; modifiers: Check["lines"][number]["modifiers"] }[];
}

/**
 * Puts the goods of credit notes marked "back into stock" back, as new lots at the item's current
 * cost, and reduces that day's cost of sales by the same amount.
 */
export async function restockCreditNotes(store: DocStore, args: { locationId: string; limit?: number }): Promise<{ notes: number; movements: StockMovement[] }> {
  const pending = await store.list<CreditNoteLike>(C.creditNotes, { where: [["depletion", "==", "pending"]], limit: args.limit ?? 400 });
  if (!pending.length) return { notes: 0, movements: [] };
  const [menuItems, modifierGroups, recipes, items] = await Promise.all([store.list<MenuItem>(C.menuItems), store.list<ModifierGroup>(C.modifierGroups), store.list<Recipe>(C.recipes), store.list<InventoryItem>(C.inventoryItems)]);
  const ctx: UsageContext = { menuItems: new Map(menuItems.map((m) => [m.id, m])), modifierGroups: new Map(modifierGroups.map((g) => [g.id, g])), recipes: new Map(recipes.map((r) => [r.id, r])), items: new Map(items.map((i) => [i.id, i])) };
  const costing = costingContext(items, recipes);
  const byDate = new Map<string, CreditNoteLike[]>();
  for (const n of pending) byDate.set(n.businessDate, [...(byDate.get(n.businessDate) ?? []), n]);
  const ids = new Set<string>();
  const usageByDate = new Map<string, Map<string, number>>();
  for (const [date, notes] of byDate) {
    const usage = theoreticalUsage(creditNoteChecks(notes), ctx);
    usageByDate.set(date, usage);
    for (const id of usage.keys()) ids.add(id);
  }
  const levels = await loadLevels(store, args.locationId, ids);
  const ops: WriteOp[] = [];
  const movements: StockMovement[] = [];
  for (const date of [...usageByDate.keys()].sort()) {
    const lines: StockMovementLine[] = [];
    const costByMajorGroup: Record<string, number> = {};
    for (const [itemId, qty] of usageByDate.get(date)!) {
      const unitCost = itemUnitCost(itemId, costing).cost;
      const at = nowIso();
      levels.set(itemId, addLot(levels.get(itemId)!, { lotId: newId(), receivedAt: at, qty, unitCost, source: "return" }));
      const cost = Math.round(qty * unitCost);
      lines.push({ itemId, qty, cost });
      const group = ctx.items.get(itemId)?.majorGroup ?? "Other";
      costByMajorGroup[group] = (costByMajorGroup[group] ?? 0) - cost;
    }
    const notes = byDate.get(date)!;
    const movement: StockMovement = { id: newId(), type: "sale", locationId: args.locationId, businessDate: date, at: nowIso(), ref: `returns: ${notes.map((n) => n.id).join(", ")}`.slice(0, 200), lines, costByMajorGroup };
    movements.push(movement);
    ops.push({ op: "set", col: C.stockMovements, data: movement });
    for (const n of notes) ops.push({ op: "merge", col: C.creditNotes, id: n.id, data: { depletion: "done" } });
  }
  for (const level of levels.values()) ops.push({ op: "set", col: C.stockLevels, data: level });
  await store.batch(ops);
  return { notes: pending.length, movements };
}

async function depleteChecks(store: DocStore, args: { locationId: string; by: string; limit?: number }): Promise<{ checks: number; movements: StockMovement[] }> {
  const pending = await store.list<Check>(C.checks, { where: [["depletion", "==", "pending"]], limit: args.limit ?? 400 });
  if (pending.length === 0) return { checks: 0, movements: [] };
  const [menuItems, modifierGroups, recipes, items] = await Promise.all([
    store.list<MenuItem>(C.menuItems),
    store.list<ModifierGroup>(C.modifierGroups),
    store.list<Recipe>(C.recipes),
    store.list<InventoryItem>(C.inventoryItems),
  ]);
  const ctx: UsageContext = {
    menuItems: new Map(menuItems.map((m) => [m.id, m])),
    modifierGroups: new Map(modifierGroups.map((g) => [g.id, g])),
    recipes: new Map(recipes.map((r) => [r.id, r])),
    items: new Map(items.map((i) => [i.id, i])),
  };
  const costing = costingContext(items, recipes);
  const byDate = new Map<string, Check[]>();
  for (const c of pending) byDate.set(c.businessDate, [...(byDate.get(c.businessDate) ?? []), c]);

  const allItemIds = new Set<string>();
  const usageByDate = new Map<string, Map<string, number>>();
  for (const [date, checks] of byDate) {
    const usage = theoreticalUsage(checks, ctx);
    usageByDate.set(date, usage);
    for (const id of usage.keys()) allItemIds.add(id);
  }
  const levels = await loadLevels(store, args.locationId, allItemIds);
  const ops: WriteOp[] = [];
  const movements: StockMovement[] = [];
  for (const date of [...usageByDate.keys()].sort()) {
    const usage = usageByDate.get(date)!;
    const lines: StockMovementLine[] = [];
    const costByMajorGroup: Record<string, number> = {};
    const shortages: { itemId: string; qty: number }[] = [];
    for (const [itemId, qty] of usage) {
      const { level, cost, shortage } = consumeFifo(levels.get(itemId)!, qty, itemUnitCost(itemId, costing).cost);
      levels.set(itemId, level);
      const rounded = Math.round(cost);
      lines.push({ itemId, qty: -qty, cost: -rounded });
      const group = ctx.items.get(itemId)?.majorGroup ?? "Other";
      costByMajorGroup[group] = (costByMajorGroup[group] ?? 0) + rounded;
      if (shortage > 0) shortages.push({ itemId, qty: shortage });
    }
    const checks = byDate.get(date)!;
    const movement: StockMovement = {
      id: newId(),
      type: "sale",
      locationId: args.locationId,
      businessDate: date,
      at: nowIso(),
      ref: `${checks.length} check(s)`,
      lines,
      costByMajorGroup,
      ...(shortages.length ? { shortages } : {}),
    };
    movements.push(movement);
    ops.push({ op: "set", col: C.stockMovements, data: movement });
    for (const c of checks) ops.push({ op: "merge", col: C.checks, id: c.id, data: { depletion: "done" } });
  }
  for (const level of levels.values()) ops.push({ op: "set", col: C.stockLevels, data: level });
  await store.batch(ops);
  return { checks: pending.length, movements };
}

async function simpleMovement(
  store: DocStore,
  type: MovementType,
  args: { locationId: string; lines: { itemId: string; qty: number }[]; businessDate: string; ref: string; reason?: string },
): Promise<StockMovement> {
  const [items, recipes] = await Promise.all([store.list<InventoryItem>(C.inventoryItems), store.list<Recipe>(C.recipes)]);
  const costing = costingContext(items, recipes);
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const levels = await loadLevels(store, args.locationId, args.lines.map((l) => l.itemId));
  const lines: StockMovementLine[] = [];
  const costByMajorGroup: Record<string, number> = {};
  for (const l of args.lines) {
    if (!itemMap.has(l.itemId)) throw new InventoryError(`unknown item ${l.itemId}`);
    const unit = itemUnitCost(l.itemId, costing).cost;
    const level = levels.get(l.itemId)!;
    if (l.qty < 0) {
      const r = consumeFifo(level, -l.qty, unit);
      levels.set(l.itemId, r.level);
      lines.push({ itemId: l.itemId, qty: l.qty, cost: -Math.round(r.cost) });
      const g = itemMap.get(l.itemId)!.majorGroup;
      costByMajorGroup[g] = (costByMajorGroup[g] ?? 0) + Math.round(r.cost);
    } else if (l.qty > 0) {
      levels.set(l.itemId, addLot(level, { lotId: newId(), receivedAt: nowIso(), qty: l.qty, unitCost: unit, source: args.ref }));
      lines.push({ itemId: l.itemId, qty: l.qty, cost: Math.round(l.qty * unit) });
    }
  }
  const movement: StockMovement = {
    id: newId(),
    type,
    locationId: args.locationId,
    businessDate: args.businessDate,
    at: nowIso(),
    ref: args.ref,
    lines,
    costByMajorGroup,
    ...(args.reason ? { reason: args.reason } : {}),
  };
  await store.batch([
    ...[...levels.values()].map((data): WriteOp => ({ op: "set", col: C.stockLevels, data })),
    { op: "set", col: C.stockMovements, data: movement },
  ]);
  return movement;
}

export function recordWaste(store: DocStore, args: { locationId: string; lines: { itemId: string; qty: number }[]; reason: string; businessDate: string }) {
  return simpleMovement(store, "waste", { ...args, lines: args.lines.map((l) => ({ itemId: l.itemId, qty: -Math.abs(l.qty) })), ref: "Waste" });
}

/** Moves stock between locations, carrying FIFO cost from the source lots. */
export async function transferStock(store: DocStore, args: { from: string; to: string; lines: { itemId: string; qty: number }[]; businessDate: string }) {
  const out = await simpleMovement(store, "transferOut", {
    locationId: args.from,
    lines: args.lines.map((l) => ({ itemId: l.itemId, qty: -Math.abs(l.qty) })),
    businessDate: args.businessDate,
    ref: `Transfer to ${args.to}`,
  });
  const levels = await loadLevels(store, args.to, args.lines.map((l) => l.itemId));
  const lines: StockMovementLine[] = out.lines.map((l) => ({ itemId: l.itemId, qty: -l.qty, cost: -l.cost }));
  for (const l of lines) {
    levels.set(l.itemId, addLot(levels.get(l.itemId)!, { lotId: newId(), receivedAt: nowIso(), qty: l.qty, unitCost: l.qty ? l.cost / l.qty : 0, source: `Transfer from ${args.from}` }));
  }
  const movement: StockMovement = { id: newId(), type: "transferIn", locationId: args.to, businessDate: args.businessDate, at: nowIso(), ref: `Transfer from ${args.from}`, lines };
  await store.batch([
    ...[...levels.values()].map((data): WriteOp => ({ op: "set", col: C.stockLevels, data })),
    { op: "set", col: C.stockMovements, data: movement },
  ]);
  return { out, in: movement };
}

/** Posts a stock count: differences become adjustment movements (gains at standard cost, losses at FIFO). */
export async function postStockCount(store: DocStore, countId: string): Promise<StockMovement | null> {
  const count = await store.get<StockCount>(C.stockCounts, countId);
  if (!count) throw new InventoryError("stock count not found");
  if (count.status === "posted") throw new InventoryError("stock count already posted");
  const levels = await loadLevels(store, count.locationId, count.lines.map((l) => l.itemId));
  const diffs = count.lines
    .map((l) => ({ itemId: l.itemId, qty: l.counted - (levels.get(l.itemId)?.qty ?? 0) }))
    .filter((d) => Math.abs(d.qty) > EPS);
  // Usage counts post what is missing as kitchen usage (cost of sales); opening counts post what is
  // there as opening stock. The other direction is an ordinary count difference.
  const kind = count.kind ?? "count";
  const main = kind === "usage" ? diffs.filter((d) => d.qty < 0) : kind === "opening" ? diffs.filter((d) => d.qty > 0) : diffs;
  const rest = kind === "count" ? [] : diffs.filter((d) => !main.includes(d));
  const ref = kind === "usage" ? `Kitchen usage to ${count.date}` : kind === "opening" ? `Opening stock ${count.date}` : `Count ${count.date}`;
  const movement = main.length ? await simpleMovement(store, kind === "count" ? "adjust" : kind, { locationId: count.locationId, lines: main, businessDate: count.date, ref }) : null;
  if (rest.length) await simpleMovement(store, "adjust", { locationId: count.locationId, lines: rest, businessDate: count.date, ref: `Count ${count.date}` });
  await store.merge(C.stockCounts, countId, {
    status: "posted",
    lines: count.lines.map((l) => ({ ...l, expected: levels.get(l.itemId)?.qty ?? 0 })),
  });
  return movement;
}

/** Produces a batch of a prep item: consumes its ingredients (FIFO) and adds a lot at the actual cost. */
export async function produceBatch(store: DocStore, args: { locationId: string; prepItemId: string; qty: number; businessDate: string }): Promise<StockMovement> {
  const recipe = await store.get<Recipe>(C.recipes, args.prepItemId);
  if (!recipe || recipe.kind !== "prep" || !(recipe.yieldQty > 0)) throw new InventoryError("prep recipe not found");
  const factor = args.qty / recipe.yieldQty;
  const consumed = await simpleMovement(store, "consumption", {
    locationId: args.locationId,
    lines: recipe.lines.map((l) => ({ itemId: l.inventoryItemId, qty: -l.qty * factor })),
    businessDate: args.businessDate,
    ref: `Production of ${args.prepItemId}`,
  });
  const cost = -consumed.lines.reduce((a, l) => a + l.cost, 0);
  const level = (await store.get<StockLevel>(C.stockLevels, stockLevelId(args.locationId, args.prepItemId))) ?? emptyLevel(args.locationId, args.prepItemId);
  const next = addLot(level, { lotId: newId(), receivedAt: nowIso(), qty: args.qty, unitCost: cost / args.qty, source: "Production" });
  const movement: StockMovement = {
    id: newId(),
    type: "production",
    locationId: args.locationId,
    businessDate: args.businessDate,
    at: nowIso(),
    ref: `Batch of ${args.prepItemId}`,
    lines: [{ itemId: args.prepItemId, qty: args.qty, cost }],
  };
  await store.batch([
    { op: "set", col: C.stockLevels, data: next },
    { op: "set", col: C.stockMovements, data: movement },
  ]);
  return movement;
}

export interface ReorderSuggestion {
  item: InventoryItem;
  onHand: number;
  /** In purchase units, rounded up. */
  suggestQty: number;
}

export function reorderSuggestions(items: readonly InventoryItem[], levels: readonly StockLevel[]): ReorderSuggestion[] {
  const onHand = new Map<string, number>();
  for (const l of levels) onHand.set(l.itemId, (onHand.get(l.itemId) ?? 0) + l.qty);
  return items
    .filter((i) => i.active && i.trackStock && !i.isPrep && i.parLevel > 0 && i.purchaseFactor > 0)
    .map((item) => ({ item, onHand: onHand.get(item.id) ?? 0 }))
    .filter((x) => x.onHand / x.item.purchaseFactor < x.item.parLevel)
    .map((x) => {
      const short = x.item.parLevel - x.onHand / x.item.purchaseFactor;
      return { ...x, suggestQty: Math.ceil(Math.max(short, x.item.reorderQty)) };
    });
}
