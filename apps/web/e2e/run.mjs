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
const { chromium, devices } = require("playwright");
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
  const approvers = await page.locator(".modal [aria-label=Approvers] .chip").allTextContents();
  check("a cashier can't approve for themselves", approvers.length > 0 && !approvers.some((t) => t.includes("Nimali")), approvers.join(", "));
  await page.locator(".modal .chip", { hasText: "Dilan" }).click();
  await pin("1234", ".modal");
  await page.waitForTimeout(500);
  check("a wrong approval PIN is refused and counted", (await page.locator(".modal").innerText()).includes("tries left"));
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

  // ── Responsive: 16:9 PCs and landscape tablets fit without page scrolling; nothing overflows sideways anywhere.
  const state = await page.context().storageState();
  const measure = (p) => p.evaluate(() => {
    const se = document.scrollingElement;
    const els = [se, document.querySelector(".main"), document.querySelector(".pos"), document.querySelector(".auth")].filter(Boolean);
    return { hx: se.scrollWidth - window.innerWidth, vy: Math.max(...els.map((e) => e.scrollHeight - e.clientHeight)) };
  });
  const FIT = ["/emc/home", "/emc/dashboard", "/emc/finance", "/emc/menu/items", "/emc/people/roles", "/emc/finance/statements", "/emc/inventory/stock", "/emc/pos/appearance", "/emc/pos/mobile", "/emc/pos/bill"];
  const views = [["PC 1920×1080", 1920, 1080, true], ["PC 1366×768", 1366, 768, true], ["PC 1280×720", 1280, 720, true], ["tablet landscape", 1180, 820, true], ["tablet portrait", 820, 1180, false], ["phone", 390, 844, false]];
  for (const [label, width, height, fit] of views) {
    const ctx = await browser.newContext({ viewport: { width, height }, storageState: state });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    const bad = [];
    for (const path of FIT) {
      await p.goto(`${B}${path}?mode=local`);
      await p.waitForTimeout(500);
      const m = await measure(p);
      if (m.hx > 1 || (fit && m.vy > 1)) bad.push(`${path} (${m.hx > 1 ? `${m.hx}px wider` : `${m.vy}px taller`})`);
    }
    await p.goto(`${B}/pos?mode=local`);
    await p.waitForTimeout(500);
    if (await p.getByRole("button", { name: /Counter POS/ }).count()) await p.getByRole("button", { name: /Counter POS/ }).click();
    if (label === "phone") {
      // Phones get the mobile app style (default Bright): check its main screens.
      await p.getByLabel("Employee number or card").fill("1001");
      await p.getByLabel("PIN", { exact: true }).fill("1111");
      await p.getByRole("button", { name: "Sign In" }).click();
      await p.waitForTimeout(700);
      await p.locator(".mauth-list button").first().click();
      await p.waitForTimeout(600);
      for (const tab of ["Home", "Tables", "Menu", "Orders", "More"]) {
        await p.locator(".m-nav button", { hasText: tab }).click();
        await p.waitForTimeout(400);
        const m = await measure(p);
        if (m.hx > 1) bad.push(`POS app ${tab} (${m.hx}px wider)`);
      }
    } else {
      await p.getByLabel("Employee number or card").fill("1001");
      await p.keyboard.press("Enter");
      for (const d of "1111") await p.locator(".keypad button", { hasText: new RegExp(`^${d}$`) }).first().click();
      await p.waitForTimeout(700);
      await p.locator(".rvc-btn").first().click();
      await p.waitForTimeout(600);
      for (const tab of ["Order", "Tables", "Reports", "Functions"]) {
        await p.getByRole("tab", { name: tab }).click();
        await p.waitForTimeout(400);
        const m = await measure(p);
        if (m.hx > 1 || m.vy > 1) bad.push(`POS ${tab} (${m.hx > 1 ? `${m.hx}px wider` : `${m.vy}px taller`})`);
      }
    }
    check(`${label}: ${fit ? "every screen fits without scrolling" : "nothing overflows sideways"}`, bad.length === 0, bad.join(", "));
    await ctx.close();
  }
  // Item buttons page like a terminal when they don't fit (no scrolling on PCs and tablets).
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 600 }, storageState: state });
    const p = await ctx.newPage();
    await p.goto(`${B}/pos?mode=local`);
    await p.waitForTimeout(500);
    if (await p.getByRole("button", { name: /Counter POS/ }).count()) await p.getByRole("button", { name: /Counter POS/ }).click();
    await p.getByLabel("Employee number or card").fill("1001");
    await p.keyboard.press("Enter");
    for (const d of "1111") await p.locator(".keypad button", { hasText: new RegExp(`^${d}$`) }).first().click();
    await p.waitForTimeout(700);
    await p.locator(".rvc-btn").first().click();
    await p.getByPlaceholder("Search item or code").fill("a");
    await p.waitForTimeout(600);
    const pager = await p.locator(".pos-pager").textContent().catch(() => null);
    const overflow = await p.evaluate(() => { const g = document.querySelector(".pos-grid"); return g.scrollHeight - g.clientHeight; });
    await p.getByRole("button", { name: "Next page" }).click().catch(() => {});
    const after = await p.locator(".pos-pager").textContent().catch(() => null);
    check("item buttons page instead of scrolling", Boolean(pager) && overflow <= 1 && /Page 2/.test(after ?? ""), `${pager} → ${after}`);
    await ctx.close();
  }

  // ── Bill designer: the administrator's layout reaches the printed bill; tax invoice particulars stay.
  await page.goto(`${B}/emc/pos/bill?mode=local`);
  await page.waitForTimeout(800);
  await page.locator(".field", { hasText: "Total label" }).locator("input").fill("AMOUNT DUE");
  await page.locator(".bill-switch", { hasText: "Phone number" }).getByRole("switch").click();
  await page.locator(".bill-switch", { hasText: /^Address/ }).getByRole("switch").click({ force: true }).catch(() => {});
  const previewText = await page.locator(".bill-preview").innerText();
  check("bill designer previews the layout live", previewText.includes("AMOUNT DUE") && !previewText.includes("Tel:") && previewText.includes("TAX INVOICE") && previewText.includes("Galle Road"));
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(600);
  await page.reload();
  await page.waitForTimeout(1200);
  check("bill layout is saved", (await page.locator(".field", { hasText: "Total label" }).locator("input").inputValue()) === "AMOUNT DUE");

  // ── Mobile app (phone): sign in, table, menu, cart, payment, success — Bright style by default.
  {
    const ctx = await browser.newContext({ ...devices["iPhone 13"], storageState: await page.context().storageState() });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`app: ${e.message}`));
    await p.goto(`${B}/pos?mode=local`);
    await p.waitForTimeout(800);
    if (await p.locator(".device-btn", { hasText: "Counter POS" }).count()) await p.locator(".device-btn", { hasText: "Counter POS" }).click();
    check("phone shows the app-style sign-in (Bright)", (await p.locator(".mauth.bright").count()) === 1);
    await p.getByLabel("Employee number or card").fill("1002");
    await p.getByLabel("PIN", { exact: true }).fill("0000");
    await p.getByRole("button", { name: "Sign In" }).click();
    await p.waitForTimeout(600);
    check("app sign-in refuses a wrong PIN", ((await p.locator(".mauth-error").textContent()) ?? "").includes("tries left"));
    await p.getByLabel("PIN", { exact: true }).fill("2222");
    await p.getByRole("button", { name: "Sign In" }).click();
    await p.waitForTimeout(800);
    if (await p.locator(".mauth-list button").count()) await p.locator(".mauth-list button").first().click();
    await p.waitForTimeout(600);
    await p.locator(".m-nav button", { hasText: "Tables" }).click();
    await p.locator(".m-table.free").first().click();
    await p.locator(".keypad button", { hasText: /^2$/ }).first().click();
    await p.waitForTimeout(600);
    check("opening a table goes to the photo menu", (await p.locator(".m-product").count()) > 5);
    for (let i = 0; i < 2; i++) {
      await p.locator(".m-product:not(.out) .m-add").nth(i).click();
      await p.waitForTimeout(300);
      if (await p.locator(".modal").count()) await p.locator(".modal .btn.primary").last().click();
      await p.waitForTimeout(200);
    }
    await p.locator(".m-cartbar").click();
    await p.waitForTimeout(400);
    await p.locator(".m-stepper").first().getByRole("button", { name: /One more/ }).click();
    const qty = await p.locator(".m-stepper .num").first().textContent();
    check("cart steppers change quantities", qty === "2", `qty ${qty}`);
    await p.getByRole("button", { name: /Proceed to Payment/ }).click();
    await p.waitForTimeout(500);
    check("payment lists tender methods", (await p.locator(".m-tender").count()) >= 3);
    await p.getByRole("button", { name: /Pay Now/ }).click();
    await p.waitForTimeout(1500);
    check("payment successful screen with invoice number", (await p.locator(".m-success h1").textContent()) === "Payment Successful" && /_W01_/.test(await p.locator(".m-receipt-card").innerText()));
    await p.getByRole("button", { name: "View receipt" }).click();
    await p.waitForTimeout(400);
    check("printed bill follows the bill designer", (await p.locator(".modal .paper").innerText()).includes("AMOUNT DUE"));
    await p.locator(".modal .btn.primary").click();
    await p.getByRole("button", { name: "Done" }).click();
    await p.locator(".m-nav button", { hasText: "Orders" }).click();
    await p.locator(".m-chip", { hasText: "Paid" }).click();
    await p.waitForTimeout(400);
    check("orders list shows the paid order", (await p.locator(".m-order .m-status.closed").count()) >= 1);
    await ctx.close();
  }

  // ── Indigo style chosen by the administrator; tablets follow when set to phones and tablets.
  await page.goto(`${B}/emc/pos/mobile?mode=local`);
  await page.waitForTimeout(700);
  await page.locator(".style-cards button", { hasText: "Indigo" }).click();
  await page.getByRole("tab", { name: "Phones and tablets" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(600);
  {
    const st = await page.context().storageState();
    const phone = await browser.newContext({ ...devices["iPhone 13"], storageState: st });
    const pp = await phone.newPage();
    await pp.goto(`${B}/pos?mode=local`);
    await pp.waitForTimeout(800);
    if (await pp.locator(".device-btn", { hasText: "Counter POS" }).count()) await pp.locator(".device-btn", { hasText: "Counter POS" }).click();
    check("administrator switches phones to the Indigo style", (await pp.locator(".mauth.indigo").count()) === 1);
    await phone.close();
    const tablet = await browser.newContext({ ...devices["iPad (gen 7)"], storageState: st });
    const tp = await tablet.newPage();
    await tp.goto(`${B}/pos?mode=local`);
    await tp.waitForTimeout(800);
    if (await tp.locator(".device-btn", { hasText: "Counter POS" }).count()) await tp.locator(".device-btn", { hasText: "Counter POS" }).click();
    await tp.getByLabel("Employee number or card").fill("1001");
    await tp.getByLabel("PIN", { exact: true }).fill("1111");
    await tp.getByRole("button", { name: "Sign In" }).click();
    await tp.waitForTimeout(700);
    if (await tp.locator(".mauth-list button").count()) await tp.locator(".mauth-list button").first().click();
    await tp.waitForTimeout(600);
    await tp.locator(".m-nav button", { hasText: "Menu" }).click();
    await tp.waitForTimeout(400);
    const cols = await tp.evaluate(() => getComputedStyle(document.querySelector(".m-products")).gridTemplateColumns.split(" ").length);
    const hx = await tp.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
    check("tablet uses the app style with more columns", (await tp.locator(".mpos.indigo").count()) === 1 && cols >= 3 && hx <= 1, `${cols} columns`);
    await tablet.close();
  }

  // ── Releases: devices report their version; a newer release shows a banner; an unsupported one blocks.
  await page.goto(`${B}/emc/setup/status?mode=local`);
  await page.waitForTimeout(800);
  check("system status lists POS devices and their version", (await page.locator("tbody tr", { hasText: "W01" }).count()) > 0 && (await page.getByText("Secure", { exact: true }).count()) > 0);
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: await page.context().storageState() });
    const p = await ctx.newPage();
    let live = { version: "99.0.0", minSupportedVersion: "0.0.1" };
    await p.route("**/version.json*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(live) }));
    await p.goto(`${B}/emc/home?mode=local`);
    await p.waitForTimeout(1200);
    check("a newer release shows the update banner", ((await p.locator(".sys-banner.info").textContent()) ?? "").includes("99.0.0"));
    live = { version: "99.0.0", minSupportedVersion: "98.0.0" };
    await p.reload();
    await p.waitForTimeout(1200);
    check("an unsupported version must update before use", (await p.getByRole("alertdialog", { name: "Update required" }).count()) === 1);
    await ctx.close();
  }

  check("no browser errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: resolve(root, `e2e-failure-${browser.contexts().indexOf(c)}.png`) }).catch(() => {});
  check("run completed", false, `${e.message.split("\n")[0]} (screenshots: e2e-failure-*.png)`);
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
