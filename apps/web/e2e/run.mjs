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
// Every query the app runs is reported here, then checked against firebase/firestore.indexes.json
// (production Firestore refuses a query whose composite index isn't declared; the demo doesn't).
const queryShapes = new Set();
const newContext = browser.newContext.bind(browser);
browser.newContext = async (opts) => {
  const ctx = await newContext(opts);
  await ctx.exposeFunction("__posQueryAudit", (shape) => queryShapes.add(shape));
  return ctx;
};
browser.newPage = async (opts) => (await browser.newContext(opts)).newPage();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const pin = async (digits, scope = "") => {
  for (const d of digits) await page.locator(`${scope} .keypad button`, { hasText: new RegExp(`^${d}$`) }).first().click();
};

try {
  await page.goto(`${B}/?mode=local`);
  await page.getByText("Try a demo business").click();
  await page.getByRole("button", { name: "Load Spice Lagoon" }).click();
  await page.waitForURL(/emc\/home/, { timeout: 90_000 });
  // The launchpad renders its tiles once the business has loaded.
  await page.waitForFunction(() => document.querySelectorAll(".tile-name").length >= 10, null, { timeout: 15_000 }).catch(() => {});
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
  await page.getByRole("button", { name: "Send KOT", exact: true }).click();
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
    // A phone is set up on a mobile workstation (T01); the counter PC (W01) keeps the terminal layout.
    if (label === "phone") await ctx.addInitScript(() => localStorage.setItem("pos-suite.workstation", "T01"));
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
    // Phones and tablets run on a mobile workstation (T01); the demo's counter PC W01 keeps the terminal layout.
    await ctx.addInitScript(() => localStorage.setItem("pos-suite.workstation", "T01"));
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
    check("payment successful screen with invoice number", (await p.locator(".m-success h1").textContent()) === "Payment Successful" && /_T01_/.test(await p.locator(".m-receipt-card").innerText()));
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

  // ── The back office as a phone app: Today, tasks, bottom tabs, the More sheet, phone lists.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState: await page.context().storageState() });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`phone back office: ${e.message}`));
    const phoneProblems = async () =>
      p.evaluate(() => ({
        wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        small: [...document.querySelectorAll(".p-main button, .p-main input, .p-main select, .p-nav a, .p-nav button, .p-top a, .p-pills a, .p-fab")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.height < 40 && getComputedStyle(e).visibility !== "hidden" && !(e instanceof HTMLInputElement && (e.type === "checkbox" || e.type === "radio"));
          })
          .map((e) => (e.textContent || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 24)),
      }));
    await p.goto(`${B}/emc/home?mode=local`);
    await p.waitForTimeout(1200);
    check("phone: Today shows today's sales", (await p.locator(".p-hero-value").count()) === 1 && /Rs/.test(await p.locator(".p-hero-value").innerText()));
    const tabs = (await p.locator(".p-nav a, .p-nav button").allInnerTexts()).map((t) => t.replace(/\d+|\s+/g, " ").trim());
    check("phone: bottom tabs Today, Reports, POS, Tasks, More", ["Today", "Reports", "POS", "Tasks", "More"].every((t) => tabs.some((x) => x.startsWith(t))), tabs.join(" | "));
    check("phone: quick actions on Today", (await p.locator(".p-action").count()) >= 4);
    await p.locator(".p-nav a", { hasText: "Tasks" }).click();
    await p.waitForTimeout(600);
    check("phone: Tasks lists what needs the owner", (await p.locator(".p-task", { hasText: "to approve" }).count()) === 1);
    await p.locator(".p-nav button", { hasText: "More" }).click();
    await p.waitForTimeout(300);
    check("phone: More shows every module", (await p.locator(".p-module").count()) >= 8);
    await p.locator(".p-module", { hasText: "Menu Management" }).click();
    await p.waitForTimeout(900);
    check("phone: a module's pages are pills", (await p.locator(".p-pills a", { hasText: "Menu items" }).count()) === 1 && (await p.locator(".p-pills a.on").innerText()) === "Menu items");
    check("phone: lists are compact rows", (await p.locator(".p-row").count()) > 10 && (await p.locator(".table.cards-sm").count()) === 0);
    await p.locator(".p-fab").click();
    await p.waitForTimeout(400);
    check("phone: the + button opens a new record", (await p.locator(".drawer h2", { hasText: "New menu item" }).count()) === 1);
    await p.locator(".drawer button", { hasText: "Cancel" }).click();
    await p.goto(`${B}/emc/reports?mode=local`);
    await p.waitForTimeout(1000);
    await p.locator(".chip", { hasText: "Yesterday" }).click();
    check("phone: report period chips", (await p.locator(".chip", { hasText: "Yesterday" }).getAttribute("aria-pressed")) === "true");
    await p.goto(`${B}/emc/account?mode=local`);
    await p.waitForTimeout(600);
    check("phone: account page with acting-as", (await p.getByLabel("Acting as").count()) === 1);
    const bad = [];
    for (const path of ["/emc/home", "/emc/tasks", "/emc/reports", "/emc/menu/items", "/emc/inventory/stock", "/emc/finance", "/emc/finance/journals", "/emc/finance/expense", "/emc/people/staff", "/emc/account"]) {
      await p.goto(`${B}${path}?mode=local`);
      await p.waitForTimeout(700);
      const m = await phoneProblems();
      if (m.wide > 1 || m.small.length) bad.push(`${path}${m.wide > 1 ? ` ${m.wide}px wider` : ""}${m.small.length ? ` small: ${m.small.slice(0, 3).join(", ")}` : ""}`);
    }
    check("phone: back-office screens fit, with touch targets of 40 px or more", !bad.length, bad.join("; "));
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
    await phone.addInitScript(() => localStorage.setItem("pos-suite.workstation", "T01"));
    const pp = await phone.newPage();
    await pp.goto(`${B}/pos?mode=local`);
    await pp.waitForTimeout(800);
    if (await pp.locator(".device-btn", { hasText: "Counter POS" }).count()) await pp.locator(".device-btn", { hasText: "Counter POS" }).click();
    check("administrator switches phones to the Indigo style", (await pp.locator(".mauth.indigo").count()) === 1);
    await phone.close();
    const tablet = await browser.newContext({ ...devices["iPad (gen 7)"], storageState: st });
    await tablet.addInitScript(() => localStorage.setItem("pos-suite.workstation", "T01"));
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

  // ── Updates from Polymath Tech (1.10.0): the maintenance notice in the back office, the POS sign-in,
  // Tasks and About; What's new once after an update; a business typed again is flagged as a duplicate.
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: await page.context().storageState() });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`update notice: ${e.message}`));
    await p.goto(`${B}/emc/home?mode=local`);
    await p.waitForTimeout(800);
    const at = new Date(Date.now() + 3 * 3600_000).toISOString();
    const until = new Date(Date.now() + 4 * 3600_000).toISOString();
    await p.evaluate(({ at, until }) => {
      const k = "pos-suite.local.v1";
      const save = JSON.parse(localStorage.getItem(k));
      save.tenant.supplier = { ...(save.tenant.supplier ?? {}), update: { version: "99.1.0", state: "scheduled", at, until, highlights: ["Approvals for new businesses"], message: "New: approvals." } };
      localStorage.setItem(k, JSON.stringify(save));
      localStorage.setItem("pos-suite.whats-new-seen", "1.0.0");
    }, { at, until });
    await p.reload();
    await p.waitForTimeout(1500);
    check("after an update, What's new shows the release notes", (await p.getByRole("dialog", { name: /What's new in/ }).count()) === 1);
    if (await p.getByRole("button", { name: "Got it" }).count()) await p.getByRole("button", { name: "Got it" }).click();
    const banner = (await p.getByTestId("maintenance-banner").textContent().catch(() => "")) ?? "";
    check("owners see the maintenance notice with its time", banner.includes("Update 99.1.0") && banner.includes("finish open bills"), banner);
    await p.reload();
    await p.waitForTimeout(1000);
    check("…and What's new shows only once", (await p.getByRole("dialog", { name: /What's new in/ }).count()) === 0);
    await p.goto(`${B}/emc/about?mode=local`);
    await p.waitForTimeout(800);
    check("About shows the coming update and what it brings", ((await p.getByTestId("coming-update").textContent().catch(() => "")) ?? "").includes("Approvals for new businesses"));
    await p.goto(`${B}/emc/tasks?mode=local`);
    await p.waitForTimeout(800);
    check("Tasks lists the update", (await p.getByText("Update 99.1.0").count()) > 0);
    await p.goto(`${B}/pos?mode=local`);
    await p.waitForTimeout(1500);
    check("the POS sign-in warns of an update a few hours away", (await p.getByTestId("pos-maintenance").count()) === 1);
    await p.goto(`${B}/new-business?mode=local`);
    await p.waitForTimeout(800);
    await p.locator("#bname").fill("spice  lagoon");
    check("typing an existing business's name warns and holds Create", (await p.getByTestId("duplicate-warning").count()) === 1 && (await p.getByRole("button", { name: "Create business" }).isDisabled()));
    await p.getByLabel("It's a different business").check();
    check("…until it is confirmed as a different business", await p.getByRole("button", { name: "Create business" }).isEnabled());
    await ctx.close();
  }

  // ── Accounting without the POS: photos of paper bills, expenses, manual sales, the Excel import.
  {
    // A small photo of a "bill" (drawn on a canvas), as a phone would send it.
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 400;
      c.height = 600;
      const g = c.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, 400, 600);
      g.fillStyle = "#000";
      g.font = "28px sans-serif";
      g.fillText("Perera Vegetable Stores", 20, 60);
      g.fillText("Vegetables  Rs 4,250.00", 20, 140);
      return c.toDataURL("image/png").split(",")[1];
    });
    const bill = { name: "veg-bill.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") };

    await page.goto(`${B}/emc/finance/bills?mode=local`);
    await page.waitForTimeout(800);
    await page.locator(".page input[type=file]").first().setInputFiles(bill);
    await page.waitForTimeout(1500);
    check("bill photos go into Bills & receipts", (await page.locator(".att-thumb").count()) >= 1);
    await page.getByRole("button", { name: "Record as expense" }).first().click();
    await page.waitForURL(/finance\/expense\?attachment=/);
    await page.waitForTimeout(800);
    await page.getByLabel("Supplier").selectOption("__new");
    await page.getByPlaceholder("e.g. Perera Vegetable Stores").fill("Perera Vegetable Stores");
    await page.getByLabel("Expense category").selectOption({ index: 1 });
    await page.getByLabel("Total").fill("4250");
    await page.getByRole("button", { name: "Record expense" }).click();
    await page.waitForTimeout(1500);
    const toast = (await page.locator(".toast").allTextContents()).join(" ");
    check("an expense from a bill photo is posted and paid", /Expense recorded: PINV-/.test(toast) && toast.includes("paid"), toast.slice(0, 120));
    await page.goto(`${B}/emc/finance/bills?mode=local`);
    await page.waitForTimeout(800);
    check("the photo leaves the inbox once filed", (await page.locator(".att-thumb").count()) === 0);

    await page.goto(`${B}/emc/finance/expense?mode=local`);
    await page.waitForTimeout(800);
    await page.locator(".att-panel input[type=file]").setInputFiles(bill);
    await page.waitForTimeout(1500);
    await page.locator(".att-panel .att-thumb").first().click();
    await page.waitForTimeout(1200);
    check("an attached bill opens with its fingerprint verified", (await page.locator(".modal .badge.good", { hasText: "Fingerprint verified" }).count()) === 1);
    await page.locator(".modal .btn.primary", { hasText: "Close" }).click();

    await page.goto(`${B}/emc/finance/sales?mode=local`);
    await page.waitForTimeout(800);
    await page.getByLabel("Food").fill("10000");
    await page.getByLabel("Cash").fill("10000");
    await page.getByRole("button", { name: "Post the day" }).click();
    await page.waitForTimeout(1200);
    check("a day of manual bills goes to the books", (await page.locator(".toast").allTextContents()).some((t) => t.startsWith("Sales for")));

    await page.goto(`${B}/emc/finance/import?mode=local`);
    await page.waitForTimeout(1000);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the example (filled in)" }).click();
    const file = await (await dl).path();
    await page.getByLabel("Accounting workbook").setInputFiles({ name: "accounting-workbook-EXAMPLE.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: (await import("node:fs")).readFileSync(file) });
    await page.waitForTimeout(2500);
    const modal = await page.locator(".modal").innerText();
    check("the accounting workbook is checked before import", modal.includes("Check results") && modal.includes("We owe suppliers") && modal.includes("example data"), modal.slice(0, 80));
    await page.locator(".modal .btn.primary", { hasText: "Import" }).click();
    await page.waitForSelector("text=Import results", { timeout: 60_000 });
    const res = await page.locator(".card", { hasText: "Import results" }).innerText();
    const problems = res.match(/Problems\s*(\d+)/)?.[1];
    check("the example imports into the demo books", problems === "0" && /Posted\s*\d+/.test(res), res.replace(/\s+/g, " ").slice(0, 160));

    await page.goto(`${B}/emc/setup/checklist?mode=local`);
    await page.waitForTimeout(800);
    check("setup checklist lists the steps for the chosen modules", (await page.locator("tbody tr").count()) >= 8);
  }

  // ── One phone, one Bluetooth printer, no Print Agent (small businesses): an Android phone prints
  //    bills, kitchen tickets and the drawer kick straight to an Xprinter over Web Bluetooth.
  {
    await page.goto(`${B}/emc/setup/devices?mode=local`);
    await page.waitForTimeout(900);
    await page.locator("tr.clickable", { hasText: "T01" }).first().click();
    await page.locator(".drawer .field", { hasText: /^Printing/ }).locator("select").selectOption("bluetooth");
    await page.waitForTimeout(200);
    check("the workstation offers the Bluetooth options", (await page.locator(".drawer .field", { hasText: "Bluetooth route" }).count()) === 1 && (await page.locator(".drawer .field", { hasText: "Kitchen and bar tickets" }).count()) === 1);
    await page.locator(".drawer .btn.primary", { hasText: "Save" }).click();
    await page.waitForTimeout(800);
    check("the workstation list shows Bluetooth printing", (await page.locator("tr", { hasText: "T01" }).locator(".badge", { hasText: "Bluetooth" }).count()) === 1);

    const ctx = await browser.newContext({ ...devices["Pixel 7"], storageState: await page.context().storageState() });
    // A simulated XP-T80Q: a Bluetooth LE printer on service 18F0 / characteristic 2AF1.
    await ctx.addInitScript(() => {
      localStorage.setItem("pos-suite.workstation", "T01");
      const writes = [];
      window.__btWrites = writes;
      // Like many printers' Bluetooth modules, it accepts only 20-byte packets.
      const take = async (d) => { if (d.byteLength > 20) throw new DOMException("GATT operation failed", "NetworkError"); writes.push(...new Uint8Array(d)); };
      const ch = { uuid: "00002af1-0000-1000-8000-00805f9b34fb", properties: { write: true, writeWithoutResponse: true }, writeValue: take, writeValueWithoutResponse: take };
      const svc = { uuid: "000018f0-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [ch] };
      const server = { connected: false, async connect() { this.connected = true; return this; }, disconnect() { this.connected = false; }, async getPrimaryService(u) { if (u === svc.uuid) return svc; throw new DOMException("no such service", "NotFoundError"); } };
      const dev = Object.assign(new EventTarget(), { id: "xp-t80q-1", name: "XP-T80Q", gatt: server });
      Object.defineProperty(navigator, "bluetooth", { value: { getAvailability: async () => true, requestDevice: async () => dev, getDevices: async () => [dev] } });
    });
    const ph = await ctx.newPage();
    ph.on("pageerror", (e) => errors.push(`bt: ${e.message}`));
    const printed = async () => ph.evaluate(() => String.fromCharCode(...window.__btWrites));
    await ph.goto(`${B}/pos?mode=local`);
    await ph.waitForTimeout(900);
    await ph.getByLabel("Employee number or card").fill("1002");
    await ph.getByLabel("PIN", { exact: true }).fill("2222");
    await ph.getByRole("button", { name: "Sign In" }).click();
    await ph.waitForTimeout(800);
    if (await ph.locator(".mauth-list button").count()) await ph.locator(".mauth-list button").first().click();
    await ph.waitForTimeout(600);
    check("the phone shows Connect printer", (await ph.getByRole("button", { name: "Connect printer" }).count()) === 1);
    await ph.getByRole("button", { name: "Connect printer" }).click();
    await ph.getByRole("button", { name: /Choose the printer|Connect printer/ }).last().click();
    await ph.waitForTimeout(500);
    await ph.getByRole("button", { name: "Test print" }).click();
    await ph.waitForTimeout(1200);
    check("the phone connects to the Bluetooth printer and test-prints", (await ph.locator(".modal", { hasText: "XP-T80Q" }).count()) === 1 && (await printed()).includes("TEST"));
    await ph.locator(".modal .btn.primary", { hasText: "Close" }).click();
    await ph.evaluate(() => { window.__btWrites.length = 0; });
    await ph.locator(".m-nav button", { hasText: "Menu" }).click();
    await ph.waitForTimeout(500);
    await ph.locator(".m-product:not(.out) .m-add").first().click();
    await ph.waitForTimeout(300);
    if (await ph.locator(".modal").count()) await ph.locator(".modal .btn.primary").last().click();
    await ph.locator(".m-cartbar").click();
    await ph.waitForTimeout(400);
    await ph.getByRole("button", { name: /Proceed to Payment/ }).click();
    await ph.waitForTimeout(500);
    await ph.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
    await ph.waitForTimeout(2500);
    const out = await printed();
    check("kitchen ticket, bill and drawer kick print over Bluetooth", out.includes("KOT - ") && out.includes("TAX INVOICE") && out.includes("\x1bp"), `${out.length} bytes`);

    // One printer for kitchen tickets and bills: Send KOT prints the ticket straight away (no bill, no drawer),
    // and the ticket can be printed again from the order, marked REPRINT.
    await ph.getByRole("button", { name: "Done" }).click();
    await ph.waitForTimeout(400);
    await ph.evaluate(() => { window.__btWrites.length = 0; });
    await ph.locator(".m-nav button", { hasText: "Menu" }).click();
    await ph.waitForTimeout(400);
    await ph.locator(".m-product:not(.out) .m-add").nth(1).click();
    await ph.waitForTimeout(300);
    if (await ph.locator(".modal").count()) await ph.locator(".modal .btn.primary").last().click();
    await ph.locator(".m-cartbar").click();
    await ph.waitForTimeout(400);
    check("the order shows Send KOT", (await ph.getByRole("button", { name: "Send and print the kitchen ticket" }).count()) === 1);
    await ph.getByRole("button", { name: "Send and print the kitchen ticket" }).click();
    await ph.waitForTimeout(1500);
    const kot = await printed();
    check("Send KOT prints the kitchen ticket on the shared printer", kot.includes("KOT - ") && !kot.includes("INVOICE") && !kot.includes("\x1bp"), `${kot.length} bytes`);
    await ph.evaluate(() => { window.__btWrites.length = 0; });
    await ph.locator(".m-nav button", { hasText: "Orders" }).click();
    await ph.waitForTimeout(400);
    await ph.locator(".m-order", { has: ph.locator(".m-order-ico.open") }).first().click();
    await ph.waitForTimeout(500);
    await ph.locator("button[aria-label='Order options']").first().click();
    await ph.waitForTimeout(300);
    await ph.locator(".m-sheet-row", { hasText: "Print kitchen ticket again" }).click();
    await ph.waitForTimeout(1500);
    check("the kitchen ticket reprints, marked REPRINT", (await printed()).includes("REPRINT"));
    await ctx.close();
  }

  // ── The app style on every screen: a PC and a landscape tablet get their own layout (navigation rail,
  //    the order beside the menu, payment methods and amount side by side), not the phone screens stretched.
  {
    await page.goto(`${B}/emc/pos/mobile?mode=local`);
    await page.waitForTimeout(700);
    await page.getByRole("tab", { name: "Every screen" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.waitForTimeout(700);
    const st = await page.context().storageState();
    for (const [label, opts] of [["PC 1366×768", { viewport: { width: 1366, height: 768 } }], ["tablet landscape", { ...devices["iPad (gen 7) landscape"] }]]) {
      const ctx = await browser.newContext({ ...opts, storageState: st });
      await ctx.addInitScript(() => localStorage.setItem("pos-suite.workstation", "W02"));
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
      await p.goto(`${B}/pos?mode=local`);
      await p.waitForTimeout(900);
      await p.getByLabel("Employee number or card").fill("1001");
      await p.getByLabel("PIN", { exact: true }).fill("1111");
      await p.getByRole("button", { name: "Sign In" }).click();
      await p.waitForTimeout(800);
      if (await p.locator(".mauth-list button").count()) await p.locator(".mauth-list button").first().click();
      await p.waitForTimeout(600);
      check(`${label}: app style with a side navigation rail`, (await p.locator(".mpos.wide .w-rail").count()) === 1 && (await p.locator(".m-nav").count()) === 0);
      await p.locator(".w-nav button", { hasText: "Menu" }).click();
      await p.waitForTimeout(400);
      await p.locator(".m-product:not(.out) .m-add").first().click();
      await p.waitForTimeout(300);
      if (await p.locator(".modal").count()) await p.locator(".modal .btn.primary").last().click();
      await p.waitForTimeout(300);
      const cols = await p.evaluate(() => getComputedStyle(document.querySelector(".m-products")).gridTemplateColumns.split(" ").length);
      check(`${label}: the order stays beside the menu`, (await p.locator(".w-order .m-line").count()) >= 1 && (await p.locator(".m-products").isVisible()) && cols >= 3, `${cols} columns`);
      await p.locator(".w-order .m-btn.cta").click();
      await p.waitForTimeout(500);
      const payGrid = await p.evaluate(() => getComputedStyle(document.querySelector(".m-pay .m-screen")).display);
      const over = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      check(`${label}: payment shows the order, methods and amount side by side`, (await p.locator(".w-pay-order").count()) === 1 && payGrid === "grid" && over <= 1, `${payGrid}, ${over}px`);
      await p.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
      await p.waitForTimeout(1200);
      check(`${label}: payment completes`, (await p.getByText("Payment Successful").count()) === 1);
      await ctx.close();
    }
  }

  // ── Manager functions on closed checks (1.11.0): find, change payment, refund items, void, reopen;
  //    cash pickup and till count. On the app-style POS of a PC (same Functions as the terminal).
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: await page.context().storageState() });
    await ctx.addInitScript(() => localStorage.setItem("pos-suite.workstation", "W02"));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`closed checks: ${e.message}`));
    await p.goto(`${B}/pos?mode=local`);
    await p.waitForTimeout(900);
    await p.getByLabel("Employee number or card").fill("1001");
    await p.getByLabel("PIN", { exact: true }).fill("1111");
    await p.getByRole("button", { name: "Sign In" }).click();
    await p.waitForTimeout(800);
    if (await p.locator(".mauth-list button").count()) await p.locator(".mauth-list button").first().click();
    await p.waitForTimeout(600);
    for (const n of [0, 1]) {
      await p.locator(".w-nav button", { hasText: "Menu" }).click();
      await p.waitForTimeout(300);
      for (const k of [0, 1]) {
        await p.locator(".m-product:not(.out) .m-add").nth(n + k).click();
        await p.waitForTimeout(250);
        if (await p.locator(".modal").count()) await p.locator(".modal .btn.primary").last().click();
      }
      await p.locator(".w-order .m-btn.cta").click();
      await p.waitForTimeout(400);
      await p.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
      await p.waitForTimeout(1000);
      await p.getByRole("button", { name: "Done" }).click();
      await p.waitForTimeout(300);
    }
    const openFunctions = async () => {
      await p.locator(".w-nav button", { hasText: "More" }).click();
      await p.waitForTimeout(300);
      await p.locator(".m-sheet-row", { hasText: "Functions" }).click();
      await p.waitForTimeout(400);
    };
    await openFunctions();
    await p.locator(".card", { hasText: "Closed checks" }).first().click();
    await p.waitForTimeout(600);
    check("Closed checks lists today's paid checks", (await p.locator(".closed-row").count()) >= 2);
    const toastText = async () => (await p.locator(".toast").allTextContents()).join(" | ");
    await p.locator(".closed-row").nth(0).click();
    await p.getByRole("button", { name: "Change payment" }).click();
    await p.getByPlaceholder("e.g. Paid by card, rung up as cash").fill("Paid by card");
    await p.getByTestId("credit-tender").getByRole("button", { name: "Change" }).click();
    await p.waitForTimeout(700);
    check("a closed check's payment method can be changed", (await toastText()).includes("Payment method changed") && (await p.locator(".closed-row .badge", { hasText: "Payment changed" }).count()) === 1, await toastText());
    await p.getByRole("button", { name: "Refund items" }).click();
    await p.getByTestId("credit-refund").getByRole("button", { name: /^More / }).first().click();
    await p.getByTestId("credit-refund").getByPlaceholder(/Why/).fill("Customer returned it");
    await p.getByTestId("credit-refund").getByRole("button", { name: "Refund", exact: true }).click();
    await p.waitForTimeout(900);
    check("refunding one item issues a credit note", /CN-\d{2}[A-Z]{3}_W02_1: Rs [\d,.]+ refunded/.test(await toastText()) && (await p.locator(".closed-row .badge", { hasText: "Refunded" }).count()) === 1, await toastText());
    await p.getByRole("button", { name: "Void check" }).click();
    await p.getByTestId("credit-void").getByPlaceholder(/Why/).fill("Should not have been closed");
    await p.getByTestId("credit-void").getByRole("button", { name: "Void check" }).click();
    await p.waitForTimeout(800);
    check("a partly refunded check can't be voided whole (refund the rest item by item)", (await toastText()).includes("item by item"), await toastText());
    await p.locator(".closed-row").nth(1).click();
    await p.getByRole("button", { name: "Reopen" }).first().click();
    await p.getByTestId("credit-reopen").getByPlaceholder(/Why/).fill("Add a dessert");
    await p.getByTestId("credit-reopen").getByRole("button", { name: "Reopen" }).click();
    await p.waitForTimeout(1200);
    check("reopening a closed check cancels its bill and opens it again to correct", (await toastText()).includes("is open again") && (await p.locator(".w-order .m-line").count()) >= 2, await toastText());
    await openFunctions();
    await p.locator(".card", { hasText: "Till count" }).first().click();
    await p.waitForTimeout(400);
    await p.getByLabel("Rs 1000").fill("3");
    await p.waitForTimeout(200);
    const summary = await p.getByTestId("till-summary").innerText();
    check("till count compares the drawer with the cash expected", /Counted\s+Rs 3,000\.00/.test(summary) && /Expected/.test(summary), summary.replace(/\n/g, " "));
    await p.getByRole("button", { name: "Save count" }).click();
    await p.waitForTimeout(800);
    check("the till count is saved and logged", /Till (balanced|over|short)/.test(await toastText()), await toastText());
    await ctx.close();
  }

  // ── The Noura Kitchen demo: their set-up with sample data to explore; the About page.
  {
    const version = JSON.parse((await import("node:fs")).readFileSync(resolve(web, "package.json"), "utf8")).version;
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`noura demo: ${e.message}`));
    await p.goto(`${B}/?mode=local`);
    await p.getByText("Try a demo business").click();
    await p.getByRole("button", { name: "Load Noura Kitchen" }).click();
    await p.waitForURL(/emc\/home/, { timeout: 90_000 });
    await p.waitForFunction(() => document.querySelectorAll(".tile-name").length >= 8, null, { timeout: 15_000 }).catch(() => {});
    const nTiles = await p.locator(".tile-name").allTextContents();
    check("Noura Kitchen demo loads with its modules and the About tile", ["Point of Sale", "Inventory & Purchasing", "Finance", "About"].every((t) => nTiles.includes(t)), nTiles.join(", "));
    await p.goto(`${B}/emc/setup/business?mode=local`);
    await p.waitForTimeout(800);
    const vatOn = await p.locator(".row.between", { hasText: "VAT-registered" }).getByRole("switch").getAttribute("aria-checked");
    const ssclOn = await p.locator(".row.between", { hasText: "SSCL-liable" }).getByRole("switch").getAttribute("aria-checked");
    check("Noura Kitchen demo is not VAT or SSCL registered", vatOn === "false" && ssclOn === "false");
    await p.goto(`${B}/emc/finance/statements?mode=local`);
    await p.getByRole("tab", { name: "Trial balance" }).click();
    await p.waitForTimeout(600);
    check("Noura Kitchen demo books balance", (await p.locator(".card-head .badge").first().textContent()) === "Balanced");
    await p.goto(`${B}/emc/about?mode=local`);
    await p.waitForTimeout(900);
    const about = await p.locator(".page").innerText();
    check("About shows the running version, licence, environment and what's new", about.includes(`Version ${version}`) && about.includes("Demo edition") && about.includes("Local demo (this browser)") && (await p.locator(".release-note").count()) >= 2, about.replace(/\s+/g, " ").slice(0, 120));
    // Exploring on the office PC: the app style, bills shown on screen, a standard bill.
    await p.goto(`${B}/pos?mode=local`);
    await p.waitForTimeout(900);
    await p.locator(".device-btn", { hasText: "Office PC" }).click();
    await p.waitForTimeout(600);
    await p.getByLabel("Employee number or card").fill("1002");
    await p.getByLabel("PIN", { exact: true }).fill("2222");
    await p.getByRole("button", { name: "Sign In" }).click();
    await p.waitForTimeout(800);
    if (await p.locator(".mauth-list button").count()) await p.locator(".mauth-list button", { hasText: "Takeaway" }).first().click();
    await p.waitForTimeout(700);
    await p.locator(".w-nav button", { hasText: "Menu" }).click();
    await p.waitForTimeout(400);
    await p.locator(".m-product:not(.out) .m-add").first().click();
    await p.waitForTimeout(300);
    if (await p.locator(".modal").count()) await p.locator(".modal .btn.primary").last().click();
    await p.locator(".w-order .m-btn.cta").click();
    await p.waitForTimeout(500);
    await p.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
    await p.waitForTimeout(1500);
    // On screen, each print opens in turn: the kitchen ticket for the new items, then the bill.
    let receipt = "";
    for (let i = 0; i < 4; i++) {
      if (!(await p.locator(".modal").count())) {
        if (await p.getByRole("button", { name: "View receipt" }).count()) await p.getByRole("button", { name: "View receipt" }).click();
        await p.waitForTimeout(400);
      }
      receipt = await p.locator(".modal").last().innerText().catch(() => "");
      if (receipt.includes("Bill No")) break;
      await p.locator(".modal").last().getByRole("button", { name: /Close|✕/ }).first().click().catch(() => p.keyboard.press("Escape"));
      await p.waitForTimeout(400);
    }
    check("the office PC shows a standard bill on screen (Bill No, no tax invoice, no VAT)", receipt.includes("Bill No") && !receipt.includes("TAX INVOICE") && !/VAT\s/.test(receipt), receipt.split("\n").slice(0, 3).join(" / "));
    await ctx.close();
  }

  // ── Accounting switched on after the business was created: Finance asks to open the fiscal year.
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`late books: ${e.message}`));
    await p.goto(`${B}/?mode=local`);
    await p.locator("#bname").fill("Late Books Cafe");
    await p.getByRole("button", { name: "Create business" }).click();
    await p.waitForURL(/emc\/home/, { timeout: 60_000 });
    await p.goto(`${B}/emc/setup/licence?mode=local`);
    await p.waitForTimeout(800);
    await p.getByRole("tab", { name: "Modules" }).click();
    await p.getByRole("switch", { name: "Accounting" }).click();
    await p.waitForTimeout(800);
    await p.goto(`${B}/emc/finance?mode=local`);
    await p.waitForTimeout(1000);
    const ask = await p.locator(".callout", { hasText: "Open the fiscal year first" }).count();
    await p.getByRole("button", { name: "Open fiscal year" }).click();
    await p.waitForTimeout(1200);
    check("Finance asks to open the fiscal year, and opens it", ask === 1 && /Fiscal year \d{4}-\d{2}/.test(await p.locator(".page-head").first().innerText()));
    await ctx.close();
  }

  check("no browser errors", errors.length === 0, errors.slice(0, 5).join(" | "));

  // ── Every query has the Firestore index it needs in production.
  {
    const { compositeIndexNeeded, indexDeclared, firestoreCollection } = await server.ssrLoadModule(resolve(root, "packages/core/src/indexes.ts"));
    const declared = JSON.parse((await import("node:fs")).readFileSync(resolve(root, "firebase/firestore.indexes.json"), "utf8")).indexes;
    const missing = [];
    for (const shape of queryShapes) {
      const q = JSON.parse(shape);
      const need = compositeIndexNeeded({ where: q.where.map(([f, op]) => [f, op, null]), orderBy: q.orderBy });
      if (need && !indexDeclared(firestoreCollection(q.collection), need, declared)) missing.push(`${q.collection}: ${[...need.equality, ...need.then.map((t) => `${t.field} ${t.order}`)].join(", ")}`);
    }
    check(`every query the app ran (${queryShapes.size} shapes) has its Firestore index`, queryShapes.size > 20 && missing.length === 0, missing.join(" | "));
  }
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
