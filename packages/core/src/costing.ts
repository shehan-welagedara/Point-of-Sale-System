import { calculateCheck, type Cents } from "@pos/engine";
import type { BusinessSettings, InventoryItem, MenuItem, Recipe, TaxSettings } from "./types.js";
import { chargeRulesFor } from "./pos.js";

export interface CostingContext {
  items: ReadonlyMap<string, InventoryItem>;
  recipes: ReadonlyMap<string, Recipe>;
}

export function costingContext(items: readonly InventoryItem[], recipes: readonly Recipe[]): CostingContext {
  return { items: new Map(items.map((i) => [i.id, i])), recipes: new Map(recipes.map((r) => [r.id, r])) };
}

export interface CostLine {
  itemId: string;
  name: string;
  qty: number;
  unit: string;
  /** Cents per stock unit (may be fractional). */
  unitCost: number;
  /** Cents, unrounded. */
  cost: number;
  problem?: "missing-item" | "no-cost" | "cycle";
}

export interface RecipeCost {
  recipeId: string;
  yieldQty: number;
  lines: CostLine[];
  /** Total cost of the recipe batch, cents. */
  totalCost: Cents;
  /** Cost per portion (menu) or per stock unit ×1 (prep), cents (rounded). */
  unitCost: Cents;
  warnings: string[];
}

/**
 * Standard cost of one stock unit of an item, in cents: the latest purchase cost, or — for prep
 * items with a recipe — the recipe cost divided by its yield (sub-recipes resolved recursively).
 */
export function itemUnitCost(itemId: string, ctx: CostingContext, stack: string[] = []): { cost: number; problem?: CostLine["problem"] } {
  const item = ctx.items.get(itemId);
  if (!item) return { cost: 0, problem: "missing-item" };
  if (item.isPrep) {
    const recipe = ctx.recipes.get(itemId);
    if (recipe && recipe.yieldQty > 0) {
      if (stack.includes(itemId)) return { cost: 0, problem: "cycle" };
      let total = 0;
      let problem: CostLine["problem"];
      for (const l of recipe.lines) {
        const sub = itemUnitCost(l.inventoryItemId, ctx, [...stack, itemId]);
        total += l.qty * sub.cost;
        problem ??= sub.problem;
      }
      return problem ? { cost: total / recipe.yieldQty, problem } : { cost: total / recipe.yieldQty };
    }
  }
  if (!(item.purchaseFactor > 0) || !(item.purchaseCost > 0)) return { cost: 0, problem: "no-cost" };
  return { cost: item.purchaseCost / item.purchaseFactor };
}

export function costRecipe(recipe: Recipe, ctx: CostingContext): RecipeCost {
  const warnings: string[] = [];
  const lines: CostLine[] = recipe.lines.map((l) => {
    const item = ctx.items.get(l.inventoryItemId);
    const { cost: unitCost, problem } = itemUnitCost(l.inventoryItemId, ctx, [recipe.id]);
    if (problem === "missing-item") warnings.push(`Ingredient ${l.inventoryItemId} does not exist`);
    else if (problem === "no-cost") warnings.push(`${item?.name ?? l.inventoryItemId} has no purchase cost`);
    else if (problem === "cycle") warnings.push(`${item?.name ?? l.inventoryItemId} refers back to itself`);
    return {
      itemId: l.inventoryItemId,
      name: item?.name ?? l.inventoryItemId,
      qty: l.qty,
      unit: item?.stockUnit ?? "",
      unitCost,
      cost: unitCost * l.qty,
      ...(problem ? { problem } : {}),
    };
  });
  const total = lines.reduce((a, l) => a + l.cost, 0);
  const yieldQty = recipe.yieldQty > 0 ? recipe.yieldQty : 1;
  if (!(recipe.yieldQty > 0)) warnings.push("Yield must be greater than zero");
  return {
    recipeId: recipe.id,
    yieldQty,
    lines,
    totalCost: Math.round(total),
    unitCost: Math.round(total / yieldQty),
    warnings,
  };
}

/** Price of a menu item before service charge and taxes (back-calculated when prices are tax-inclusive). */
export function netMenuPrice(item: Pick<MenuItem, "price" | "taxClass">, tax: TaxSettings, business: BusinessSettings): Cents {
  if (tax.pricing === "exclusive" || item.price === 0) return item.price;
  const totals = calculateCheck({
    pricing: "inclusive",
    orderType: "__costing__",
    rules: chargeRulesFor(tax, business),
    lines: [{ id: "x", name: "x", quantity: 1, unitPrice: item.price, taxClass: item.taxClass }],
  });
  return totals.netSubtotal;
}

export interface MenuItemCosting {
  menuItemId: string;
  name: string;
  price: Cents;
  netPrice: Cents;
  cost: Cents;
  /** Food/beverage cost as basis points of the net price. */
  costPctBp: number;
  grossProfit: Cents;
  hasRecipe: boolean;
  warnings: string[];
}

export function costMenuItem(item: MenuItem, ctx: CostingContext, tax: TaxSettings, business: BusinessSettings): MenuItemCosting {
  const recipe = ctx.recipes.get(item.id);
  const rc = recipe ? costRecipe(recipe, ctx) : null;
  const netPrice = netMenuPrice(item, tax, business);
  const cost = rc?.unitCost ?? 0;
  return {
    menuItemId: item.id,
    name: item.name,
    price: item.price,
    netPrice,
    cost,
    costPctBp: netPrice > 0 ? Math.round((cost / netPrice) * 10_000) : 0,
    grossProfit: netPrice - cost,
    hasRecipe: Boolean(recipe),
    warnings: rc?.warnings ?? ["No recipe"],
  };
}

/** Price needed to hit a target cost % (basis points), rounded up to `roundTo` cents (default Rs 10). */
export function suggestedPrice(cost: Cents, targetCostBp: number, roundTo: Cents = 1_000): Cents {
  if (targetCostBp <= 0) return 0;
  const raw = (cost * 10_000) / targetCostBp;
  return Math.ceil(raw / roundTo) * roundTo;
}
