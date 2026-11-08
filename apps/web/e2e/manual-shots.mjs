/**
 * Takes the screenshots used in the user and training manuals (docs/manual/img), from the demo
 * restaurant in a real browser:  pnpm manual:screenshots (apps/web/e2e/manual-shots.mjs)
 * Re-run after UI changes so the manuals stay true to the screens.
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT = resolve(root, "docs/manual/img");
mkdirSync(OUT, { recursive: true });
const PORT = 5198;
const B = `http://localhost:${PORT}`;
const wait = (p, ms = 700) => p.waitForTimeout(ms);
const shot = async (p, name) => {
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 72 });
  console.log("  ", name);
};

const server = await createServer({ root: resolve(root, "apps/web"), server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.goto(`${B}/?mode=local`);
  await shot(page, "bo-new-business");
  await page.getByText("Load the demo restaurant").click();
  await page.waitForURL(/emc\/home/, { timeout: 90_000 });
  await wait(page, 1000);

  const pages = [
    ["bo-launchpad", "/emc/home"],
    ["bo-dashboard", "/emc/dashboard"],
    ["cfg-organisation", "/emc/setup/organisation"],
    ["cfg-devices", "/emc/setup/devices"],
    ["cfg-tables", "/emc/pos/tables"],
    ["cfg-tenders", "/emc/pos/tenders"],
    ["cfg-discounts", "/emc/pos/discounts"],
    ["cfg-themes", "/emc/pos/appearance"],
    ["cfg-mobile", "/emc/pos/mobile"],
    ["cfg-bill", "/emc/pos/bill"],
    ["menu-items", "/emc/menu/items"],
    ["menu-modifiers", "/emc/menu/modifiers"],
    ["menu-recipes", "/emc/recipes"],
    ["inv-stock", "/emc/inventory/stock"],
    ["inv-po", "/emc/inventory/po"],
    ["inv-counts", "/emc/inventory/counts"],
    ["crm-customers", "/emc/crm/customers"],
    ["rep-reports", "/emc/reports"],
    ["rep-engineering", "/emc/revenue/engineering"],
    ["fin-overview", "/emc/finance"],
    ["fin-journals", "/emc/finance/journals"],
    ["fin-statements", "/emc/finance/statements"],
    ["fin-periods", "/emc/finance/periods"],
    ["audit-integrity", "/emc/audit?tab=integrity"],
    ["audit-journal", "/emc/audit?tab=journal"],
    ["audit-quality", "/emc/audit?tab=quality"],
    ["people-employees", "/emc/people/staff"],
    ["people-roles", "/emc/people/roles"],
    ["people-signin", "/emc/people/signin"],
    ["admin-business", "/emc/setup/business"],
    ["admin-branding", "/emc/setup/branding"],
    ["admin-licence", "/emc/setup/licence"],
    ["admin-data", "/emc/setup/data"],
  ];
  for (const [name, path] of pages) {
    await page.goto(`${B}${path}${path.includes("?") ? "&" : "?"}mode=local`);
    await wait(page, 900);
    if (name === "audit-integrity") {
      await page.getByRole("button", { name: "Run integrity check" }).click();
      await wait(page, 2500);
    }
    if (name === "audit-quality") {
      await page.getByRole("button", { name: "Run data quality check" }).click();
      await wait(page, 1500);
    }
    await shot(page, name);
  }
  await page.goto(`${B}/emc/menu/items?mode=local`);
  await wait(page);
  await page.locator("tbody tr").first().click();
  await wait(page);
  await shot(page, "menu-item-edit");

  // ── Terminal POS (PC / large tablet)
  const state = await page.context().storageState();
  const pc = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: state });
  const t = await pc.newPage();
  const pin = async (digits, scope = "") => {
    for (const d of digits) await t.locator(`${scope} .keypad button`, { hasText: new RegExp(`^${d}$`) }).first().click();
  };
  await t.goto(`${B}/pos?mode=local`);
  await wait(t);
  await shot(t, "pos-device");
  await t.getByRole("button", { name: /Counter POS/ }).click();
  await wait(t);
  await shot(t, "pos-signin");
  await t.getByLabel("Employee number or card").fill("1002");
  await t.keyboard.press("Enter");
  await pin("2222");
  await wait(t);
  await shot(t, "pos-rvc");
  await t.locator(".rvc-btn", { hasText: "Restaurant" }).click();
  await wait(t);
  for (const n of [0, 1, 2]) {
    await t.locator(".pos-item:not(.out)").nth(n).click();
    await wait(t, 300);
    if (await t.locator(".modal").count()) await t.locator(".modal .btn.primary").last().click();
  }
  // An item with modifiers (spice level) for the modifiers picture.
  await t.getByPlaceholder("Search item or code").fill("Chicken Kottu");
  await wait(t, 400);
  await t.locator(".pos-item", { hasText: "Chicken Kottu" }).first().click();
  await wait(t, 400);
  if (await t.locator(".modal").count()) {
    await t.locator(".modal .chip").nth(2).click().catch(() => {});
    await shot(t, "pos-modifiers");
    await t.locator(".modal .btn.primary").last().click();
  }
  await t.getByPlaceholder("Search item or code").fill("");
  await wait(t, 300);
  await t.locator(".pos-line").first().click();
  await wait(t, 300);
  await shot(t, "pos-order");
  await t.getByRole("button", { name: /^Pay/ }).click();
  await wait(t);
  await t.locator(".tender-btn", { hasText: "Cash" }).first().click();
  await wait(t, 300);
  await shot(t, "pos-pay");
  await t.locator(".chip", { hasText: "Exact" }).click();
  await wait(t, 300);
  await t.locator(".modal-foot .btn.primary").click();
  await wait(t, 1500);
  await shot(t, "pos-receipt");
  await t.locator(".modal .btn.primary").click();
  await t.getByRole("tab", { name: "Tables" }).click();
  await wait(t);
  await shot(t, "pos-tables");
  await t.getByRole("tab", { name: "Reports" }).click();
  await wait(t);
  await shot(t, "pos-reports");
  await t.getByRole("tab", { name: "Functions" }).click();
  await wait(t);
  await shot(t, "pos-functions");
  await t.locator(".card", { hasText: "Reprint last bill" }).first().click();
  await wait(t);
  await shot(t, "pos-approval");
  await pc.close();

  // ── Mobile app, Bright then Indigo (phone)
  for (const style of ["bright", "indigo"]) {
    if (style === "indigo") {
      await page.goto(`${B}/emc/pos/mobile?mode=local`);
      await wait(page);
      await page.locator(".style-cards button", { hasText: "Indigo" }).click();
      await page.getByRole("button", { name: "Save" }).click();
      await wait(page);
    }
    const ctx = await browser.newContext({ ...devices["iPhone 13"], deviceScaleFactor: 1.5, storageState: await page.context().storageState() });
    const m = await ctx.newPage();
    const s = (n) => shot(m, `app-${style}-${n}`);
    await m.goto(`${B}/pos?mode=local`);
    await wait(m);
    await m.locator(".device-btn", { hasText: "Counter POS" }).click();
    await wait(m);
    await s("signin");
    await m.getByLabel("Employee number or card").fill("1001");
    await m.getByLabel("PIN", { exact: true }).fill("1111");
    await m.getByRole("button", { name: "Sign In" }).click();
    await wait(m);
    if (style === "bright") await s("rvc");
    await m.locator(".mauth-list button", { hasText: "Restaurant" }).click();
    await wait(m, 1200);
    await s("home");
    await m.locator(".m-nav button", { hasText: "Tables" }).click();
    await wait(m);
    await s("tables");
    await m.locator(".m-table.free").nth(4).click();
    await wait(m, 400);
    await m.locator(".keypad button", { hasText: /^3$/ }).first().click();
    await wait(m);
    await s("menu");
    for (let i = 0; i < 3; i++) {
      await m.locator(".m-product:not(.out) .m-add").nth(i).click();
      await wait(m, 300);
      if (await m.locator(".modal").count()) await m.locator(".modal .btn.primary").last().click();
      await wait(m, 200);
    }
    await m.locator(".m-cartbar").click();
    await wait(m);
    await s("cart");
    await m.locator(".m-line-main").first().click();
    await wait(m, 400);
    if (style === "bright") await s("line-actions");
    await m.locator(".m-sheet-wrap").click({ position: { x: 20, y: 20 } });
    await m.getByRole("button", { name: /Proceed to Payment/ }).click();
    await wait(m);
    await s("pay");
    await m.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
    await wait(m, 1600);
    await s("success");
    await m.getByRole("button", { name: "Done" }).click();
    await m.locator(".m-nav button", { hasText: "Orders" }).click();
    await wait(m);
    await s("orders");
    await m.locator(".m-nav button", { hasText: "More" }).click();
    await wait(m);
    await s("more");
    await m.locator(".m-sheet-row", { hasText: "Sales dashboard" }).click();
    await wait(m, 1000);
    await s("reports");
    await ctx.close();
  }
  // Devices report from the POS (the local demo keeps its data per browser profile, so use this one).
  await page.goto(`${B}/pos?mode=local`);
  await wait(page);
  if (await page.getByRole("button", { name: /Counter POS/ }).count()) await page.getByRole("button", { name: /Counter POS/ }).click();
  await wait(page, 1200);
  await page.goto(`${B}/emc/setup/status?mode=local`);
  await wait(page, 900);
  await shot(page, "admin-status");
} finally {
  await browser.close();
  await server.close();
}
console.log(`Screenshots written to ${OUT}`);
