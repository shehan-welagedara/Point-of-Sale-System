/**
 * End-to-end smoke test in a real browser (local demo mode, no cloud needed):
 *   pnpm test:e2e
 * Needs Playwright with Chromium available (`npm i -g playwright && npx playwright install chromium`).
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
const PORT = 5199;
const B = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const server = await createServer({ root: web, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const pin = async (digits, scope = "") => {
  for (const d of digits) await page.locator(`${scope} .keypad button`, { hasText: new RegExp(`^${d}$`) }).first().click();
};

try {
  await page.goto(`${B}/?mode=local`);
  await page.getByText("Load the demo restaurant").click();
  await page.waitForURL(/emc\/home/, { timeout: 90_000 });
  const tiles = await page.locator(".tile-name").allTextContents();
  check("launchpad shows module workspaces", tiles.length >= 10, tiles.join(", "));

  await page.locator(".tile", { hasText: "Finance" }).click();
  await page.waitForTimeout(800);
  check("Finance opens as its own workspace", (await page.locator(".ws-title").textContent())?.includes("Finance") && (await page.locator(".nav a").count()) >= 10);

  await page.goto(`${B}/emc/finance/statements?mode=local`);
  await page.getByRole("tab", { name: "Trial balance" }).click();
  await page.waitForTimeout(600);
  check("trial balance balances", (await page.locator(".card-head .badge").first().textContent()) === "Balanced");

  // POS sign-in, lockout counting, revenue centre, privileges and manager approval
  await page.goto(`${B}/pos?mode=local`);
  await page.getByRole("button", { name: /Counter POS/ }).click();
  await page.getByLabel("Employee number or card").fill("1002");
  await page.keyboard.press("Enter");
  await pin("9999");
  await page.waitForTimeout(600);
  check("wrong PIN is refused and counted", (await page.locator(".auth-card").innerText()).includes("tries left"));
  await pin("2222");
  await page.waitForTimeout(600);
  check("revenue centre list after sign-in", (await page.locator(".rvc-btn").count()) === 2);
  await page.locator(".rvc-btn", { hasText: "Restaurant" }).click();
  await page.waitForTimeout(600);
  const item = page.locator(".pos-item:not(.out)").first();
  await item.click();
  await page.waitForTimeout(300);
  if (await page.locator(".modal").count()) await page.locator(".modal .btn.primary").last().click();
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("tab", { name: /Open/ }).click();
  await page.waitForTimeout(400);
  await page.locator(".card.card-body").first().click();
  await page.waitForTimeout(400);
  await page.locator(".pos-line").first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Void" }).click();
  check("a cashier's void needs approval", (await page.locator(".modal-head h2").textContent()) === "Manager approval");
  await pin("2222", ".modal");
  await page.waitForTimeout(500);
  check("a cashier can't approve for themselves", (await page.locator(".modal").innerText()).includes("Not authorised") || (await page.locator(".modal").innerText()).includes("Nobody"));
  await pin("6666", ".modal");
  await page.waitForTimeout(500);
  await page.locator(".modal .btn.lg").first().click();
  await page.waitForTimeout(500);
  check("supervisor approves the void", (await page.locator(".toast").allTextContents()).some((t) => t.startsWith("Voided")));
  // Split: move one item of a two-item check to a new check
  await page.getByRole("tab", { name: "Order" }).click();
  for (const n of [1, 2]) {
    await page.locator(".pos-item:not(.out)").nth(n).click();
    await page.waitForTimeout(300);
    if (await page.locator(".modal").count()) await page.locator(".modal .btn.primary").last().click();
  }
  await page.locator(".pos-line").nth(1).click();
  await page.getByRole("button", { name: "Split" }).click();
  await page.waitForTimeout(800);
  check("split moves an item to a new check", (await page.locator(".toast").allTextContents()).some((t) => t.includes("moved to check")));
  await page.getByRole("tab", { name: "Reports" }).click();
  await page.getByRole("tab", { name: /Exceptions/ }).click();
  await page.waitForTimeout(500);
  check("exceptions report lists the void and approval", (await page.locator("tbody tr").count()) >= 2);

  // Audit Center: integrity (incl. POS journal chain) and data quality
  await page.goto(`${B}/emc/audit?tab=integrity&mode=local`);
  await page.getByRole("button", { name: "Run integrity check" }).click();
  await page.waitForTimeout(3000);
  check("integrity check passes", (await page.locator(".callout.good").count()) > 0, await page.locator(".callout").nth(1).textContent());
  await page.goto(`${B}/emc/audit?tab=quality&mode=local`);
  await page.getByRole("button", { name: "Run data quality check" }).click();
  await page.waitForTimeout(2000);
  check("data quality: no issues", (await page.locator(".callout.good").count()) > 0, await page.locator(".callout").nth(1).textContent());

  // Licence activation with a demo-signed key
  const out = execFileSync("node", ["tools/licence/run.mjs", "issue", "--licensee", "E2E Restaurant", "--edition", "professional", "--addons", "accounting", "--project", "local", "--months", "12", "--demo"], { cwd: root, encoding: "utf8" });
  const token = out.trim().split("\n").pop();
  await page.goto(`${B}/emc/setup/licence?mode=local`);
  await page.locator("textarea").fill(token);
  await page.getByRole("button", { name: "Activate licence" }).click();
  await page.waitForTimeout(1000);
  check("licence key activates the Professional edition", (await page.locator("h3").first().textContent())?.includes("Professional"));

  check("no browser errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  await page.screenshot({ path: resolve(root, "e2e-failure.png") }).catch(() => {});
  check("run completed", false, `${e.message.split("\n")[0]} (screenshot: e2e-failure.png)`);
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
