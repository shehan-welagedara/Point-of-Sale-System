import { useMemo, useState } from "react";
import {
  type InventoryItem,
  type MenuCategory,
  type MenuItem,
  type Recipe,
  type WriteOp,
  COLLECTIONS as C,
  costMenuItem,
  costRecipe,
  costingContext,
  suggestedPrice,
} from "@pos/core";
import { Drawer, Empty, Field, Loading, ModuleOff, PageHead, Seg } from "../../components/ui";
import { money, pct, stockQty } from "../../lib/format";
import { useApp, useCollection, useStore } from "../../state/app";

function costTone(bp: number): string {
  if (bp === 0) return "";
  if (bp <= 3200) return "good";
  if (bp <= 4000) return "warn";
  return "bad";
}

export function RecipesPage() {
  const { on, settings, toast } = useApp();
  const store = useStore();
  const menuItems = useCollection<MenuItem>(C.menuItems);
  const categories = useCollection<MenuCategory>(C.menuCategories) ?? [];
  const items = useCollection<InventoryItem>(C.inventoryItems);
  const recipes = useCollection<Recipe>(C.recipes);
  const [tab, setTab] = useState<"menu" | "prep">("menu");
  const [target, setTarget] = useState(3200);
  const [editing, setEditing] = useState<{ recipe: Recipe; title: string; price?: number; taxClass?: string } | null>(null);
  const [q, setQ] = useState("");

  const ctx = useMemo(() => costingContext(items ?? [], recipes ?? []), [items, recipes]);
  const costings = useMemo(
    () => (menuItems ?? []).filter((m) => m.active).map((m) => ({ item: m, c: costMenuItem(m, ctx, settings.tax, settings.business) })),
    [menuItems, ctx, settings.tax, settings.business],
  );
  if (!on("recipes")) return <ModuleOff name="Recipes & Costing" />;
  if (!menuItems || !items || !recipes) return <div className="page"><Loading /></div>;

  const cats = new Map(categories.map((c) => [c.id, c.name]));
  const withRecipe = costings.filter((x) => x.c.hasRecipe);
  const avgBp = withRecipe.length ? Math.round(withRecipe.reduce((a, x) => a + x.c.costPctBp, 0) / withRecipe.length) : 0;
  const prepItems = items.filter((i) => i.isPrep);
  const needle = q.toLowerCase();

  async function refreshCosts() {
    const ops: WriteOp[] = costings.filter((x) => x.item.cost !== x.c.cost).map((x) => ({ op: "merge", col: C.menuItems, id: x.item.id, data: { cost: x.c.cost } }));
    await store.batch(ops);
    toast(ops.length ? `Updated cost on ${ops.length} item(s)` : "Costs are up to date");
  }

  return (
    <div className="page">
      <PageHead
        title="Recipes & costing"
        subtitle="Portion cost from current ingredient costs (latest purchase price; prep items from their own recipes). Food cost % is measured against the price before service charge and taxes."
        actions={<button className="btn primary" onClick={refreshCosts}>Save costs to menu items</button>}
      />
      <div className="grid cols-4">
        <div className="card stat"><span className="label">Items with recipes</span><span className="value">{withRecipe.length} / {costings.length}</span></div>
        <div className="card stat"><span className="label">Average food cost</span><span className="value">{pct(avgBp)}</span><span className="delta muted">Simple average across items</span></div>
        <div className="card stat"><span className="label">Above target</span><span className="value">{withRecipe.filter((x) => x.c.costPctBp > target).length}</span><span className="delta muted">Target {pct(target, 0)}</span></div>
        <div className="card stat">
          <span className="label">Target cost %</span>
          <div className="row"><input className="input num" type="number" min={5} max={80} value={target / 100} onChange={(e) => setTarget(Math.round(Number(e.target.value || 0) * 100))} style={{ width: 90 }} /><span>%</span></div>
          <span className="delta muted">Used for suggested prices</span>
        </div>
      </div>
      <div className="row between wrap">
        <Seg value={tab} onChange={setTab} options={[{ value: "menu", label: "Menu recipes" }, { value: "prep", label: `Prep recipes (${prepItems.length})` }]} />
        <input className="input" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
      </div>
      {tab === "menu" ? (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Category</th>
                <th className="num">Price</th>
                <th className="num">Net price</th>
                <th className="num">Portion cost</th>
                <th className="num">Cost %</th>
                <th className="num">Gross profit</th>
                <th className="num">Price at target</th>
              </tr>
            </thead>
            <tbody>
              {costings
                .filter((x) => `${x.item.code} ${x.item.name}`.toLowerCase().includes(needle))
                .sort((a, b) => b.c.costPctBp - a.c.costPctBp)
                .map(({ item, c }) => (
                  <tr key={item.id} className="clickable" onClick={() => setEditing({ recipe: recipes.find((r) => r.id === item.id) ?? { id: item.id, kind: "menu", yieldQty: 1, lines: [] }, title: `${item.code} ${item.name}`, price: c.netPrice, taxClass: item.taxClass })}>
                    <td>
                      <div>{item.name}</div>
                      {!c.hasRecipe ? <span className="badge warn">No recipe</span> : c.warnings.length ? <span className="badge bad">{c.warnings[0]}</span> : null}
                    </td>
                    <td className="muted">{cats.get(item.categoryId)}</td>
                    <td className="num">{money(item.price)}</td>
                    <td className="num">{money(c.netPrice)}</td>
                    <td className="num">{c.hasRecipe ? money(c.cost) : "—"}</td>
                    <td className="num">{c.hasRecipe ? <span className={`badge ${costTone(c.costPctBp)}`}>{pct(c.costPctBp)}</span> : "—"}</td>
                    <td className="num">{c.hasRecipe ? money(c.grossProfit) : "—"}</td>
                    <td className="num muted">{c.hasRecipe ? money(suggestedPrice(c.cost, target)) : "—"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card table-wrap">
          {prepItems.length === 0 ? (
            <Empty title="No prep items yet">
              <p>Mark a stock item as “Prep item” (curries, sambols, sauces) to give it a sub-recipe.</p>
            </Empty>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Prep item</th>
                  <th className="num">Batch yield</th>
                  <th className="num">Batch cost</th>
                  <th className="num">Cost per unit</th>
                </tr>
              </thead>
              <tbody>
                {prepItems
                  .filter((p) => p.name.toLowerCase().includes(needle))
                  .map((p) => {
                    const r = recipes.find((x) => x.id === p.id) ?? { id: p.id, kind: "prep" as const, yieldQty: 1000, lines: [] };
                    const rc = costRecipe(r, ctx);
                    return (
                      <tr key={p.id} className="clickable" onClick={() => setEditing({ recipe: r, title: `${p.code} ${p.name}` })}>
                        <td>{p.name} {r.lines.length === 0 ? <span className="badge warn">No recipe</span> : null}</td>
                        <td className="num">{stockQty(r.yieldQty, p.stockUnit)}</td>
                        <td className="num">{money(rc.totalCost)}</td>
                        <td className="num">{money(Math.round((rc.totalCost / r.yieldQty) * (p.stockUnit === "pcs" ? 1 : 1000)))} / {p.stockUnit === "pcs" ? "pc" : p.stockUnit === "g" ? "kg" : "l"}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>
      )}
      {editing ? <RecipeEditor key={editing.recipe.id} {...editing} items={items} ctxRecipes={recipes} target={target} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function RecipeEditor({ recipe, title, price, items, ctxRecipes, target, onClose }: { recipe: Recipe; title: string; price?: number; items: InventoryItem[]; ctxRecipes: Recipe[]; target: number; onClose: () => void }) {
  const store = useStore();
  const { toast } = useApp();
  const [r, setR] = useState<Recipe>(recipe);
  const [pick, setPick] = useState("");
  const ctx = useMemo(() => costingContext(items, ctxRecipes.filter((x) => x.id !== r.id).concat(r)), [items, ctxRecipes, r]);
  const rc = costRecipe(r, ctx);
  const byId = new Map(items.map((i) => [i.id, i]));
  const options = items.filter((i) => i.active && i.id !== r.id).sort((a, b) => a.name.localeCompare(b.name));

  async function save() {
    if (!(r.yieldQty > 0)) return toast("Yield must be greater than zero", true);
    await store.set(C.recipes, { ...r, lines: r.lines.filter((l) => l.qty > 0) });
    if (r.kind === "menu") await store.merge(C.menuItems, r.id, { cost: rc.unitCost });
    toast("Recipe saved");
    onClose();
  }

  return (
    <Drawer
      title={title}
      onClose={onClose}
      footer={
        <>
          <span className="grow small muted">{r.kind === "menu" ? "Cost per portion" : "Batch cost"}: <strong>{money(r.kind === "menu" ? rc.unitCost : rc.totalCost)}</strong></span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save recipe</button>
        </>
      }
    >
      <div className="stack">
        <div className="grid cols-2">
          <Field label={r.kind === "menu" ? "Portions produced" : "Batch yield (stock units)"} help={r.kind === "prep" ? `e.g. 5000 ${byId.get(r.id)?.stockUnit ?? "g"} of curry from this batch` : "Usually 1"}>
            <input className="input num" type="number" min={0} step="any" value={r.yieldQty} onChange={(e) => setR({ ...r, yieldQty: Number(e.target.value) })} />
          </Field>
          {price !== undefined ? (
            <Field label="Cost % of net price" help={`Price at ${pct(target, 0)} target: ${money(suggestedPrice(rc.unitCost, target))}`}>
              <div className="input num" style={{ display: "flex", alignItems: "center" }}>
                <span className={`badge ${costTone(price ? Math.round((rc.unitCost / price) * 10_000) : 0)}`}>{price ? pct(Math.round((rc.unitCost / price) * 10_000)) : "—"}</span>
                <span className="muted small" style={{ marginLeft: 8 }}>of {money(price)}</span>
              </div>
            </Field>
          ) : null}
        </div>
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ingredient</th>
                <th className="num">Qty</th>
                <th>Unit</th>
                <th className="num">Unit cost</th>
                <th className="num">Line cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l, i) => {
                const it = byId.get(l.inventoryItemId);
                const line = rc.lines[i];
                return (
                  <tr key={`${l.inventoryItemId}-${i}`}>
                    <td>
                      {it?.name ?? l.inventoryItemId} {it?.isPrep ? <span className="badge info">Prep</span> : null}
                      {line?.problem ? <div><span className="badge bad">{line.problem === "no-cost" ? "no cost" : line.problem}</span></div> : null}
                    </td>
                    <td className="num" style={{ width: 110 }}>
                      <input className="input num" type="number" min={0} step="any" value={l.qty} onChange={(e) => setR({ ...r, lines: r.lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) } : x)) })} />
                    </td>
                    <td className="muted">{it?.stockUnit}</td>
                    <td className="num muted">{line ? `${(line.unitCost / 100).toFixed(it?.stockUnit === "pcs" ? 2 : 4)}` : ""}</td>
                    <td className="num">{line ? money(Math.round(line.cost)) : ""}</td>
                    <td>
                      <button className="btn ghost sm" aria-label="Remove" onClick={() => setR({ ...r, lines: r.lines.filter((_, j) => j !== i) })}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total for {r.yieldQty} {r.kind === "menu" ? "portion(s)" : "units"}</td>
                <td className="num">{money(rc.totalCost)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="row">
          <select className="select grow" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add an ingredient…</option>
            {options.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.code}, {i.stockUnit}){i.isPrep ? " – prep" : ""}
              </option>
            ))}
          </select>
          <button className="btn" disabled={!pick} onClick={() => { setR({ ...r, lines: [...r.lines, { inventoryItemId: pick, qty: 0 }] }); setPick(""); }}>
            Add
          </button>
        </div>
        <Field label="Method / notes">
          <textarea className="textarea" value={r.method ?? ""} onChange={(e) => setR({ ...r, method: e.target.value })} placeholder="Preparation steps, plating, portion notes" />
        </Field>
        {rc.warnings.length ? <div className="callout warn">{rc.warnings.join(" · ")}</div> : null}
      </div>
    </Drawer>
  );
}
