/**
 * Go-live rehearsal for a small restaurant like Noura Kitchen, from an empty business, in a real
 * browser (local mode, no cloud needed):
 *   pnpm test:golive
 *
 * A new business with Accounting, Inventory, Purchasing, Recipes and the POS; not VAT or SSCL
 * registered; one phone with a Bluetooth printer (a simulated Xprinter XP-T80Q) printing both the
 * kitchen tickets and the bills; the books brought in with the accounting workbook. Every step is
 * done through the screens, the way the owner and the vendor will do it on the day.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
const ExcelJS = createRequire(resolve(root, "packages/excel/package.json"))("exceljs");
const PORT = Number(process.env.PORT ?? 5197);
const B = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const server = await createServer({ root: web, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
let page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.setDefaultTimeout(15_000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const go = async (path) => {
  await page.goto(`${B}${path}${path.includes("?") ? "&" : "?"}mode=local`);
  await page.waitForTimeout(900);
};
/** A field in the open record drawer, by the start of its label. */
const field = (label) => page.locator(".drawer .field", { hasText: new RegExp(`^${label}`) }).locator("input, select, textarea").first();
const saveDrawer = async () => {
  await page.locator(".drawer .btn.primary", { hasText: "Save" }).click();
  await page.waitForTimeout(700);
};
const toasts = async () => (await page.locator(".toast").allTextContents()).join(" | ");

try {
  // ── 1. The owner creates the business (deployment manual section H, Noura plan section 2).
  await page.goto(`${B}/?mode=local`);
  await page.locator("#bname").fill("Noura Kitchen");
  await page.getByRole("radio", { name: /^.?\s*Restaurant/ }).click();
  await page.locator("details.field summary").click();
  for (const m of ["Accounting", "Inventory", "Purchasing", "Recipes & Costing", "Point of Sale"]) {
    const chip = page.locator(".chip", { hasText: new RegExp(`^${m}$`) });
    if (!(await chip.getAttribute("class")).includes(" on")) await chip.click();
  }
  await page.getByRole("button", { name: "Create business" }).click();
  await page.waitForURL(/emc\/home/, { timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll(".tile-name").length >= 3, null, { timeout: 15_000 }).catch(() => {});
  const tiles = await page.locator(".tile-name").allTextContents();
  check("the new business opens with its modules", ["Finance", "Inventory", "Point of Sale"].every((t) => tiles.some((x) => x.includes(t))), tiles.join(", "));

  // ── 2. Business & tax: not VAT or SSCL registered.
  await go("/emc/setup/business");
  const pageField = (label) => page.locator(".field", { hasText: new RegExp(`^${label}`) }).locator("input, textarea, select").first();
  await pageField("Registered name").fill("Noura Kitchen (Pvt) Ltd");
  await pageField("Registered address").fill("12 Galle Road\nColombo 03");
  await pageField("Phone").fill("0112345678");
  for (const t of ["VAT-registered", "SSCL-liable"]) {
    const sw = page.locator(".row.between", { hasText: t }).getByRole("switch");
    if ((await sw.getAttribute("aria-checked")) === "true") await sw.click();
  }
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForTimeout(700);
  check("business saved as not VAT or SSCL registered", (await toasts()).includes("Business and tax settings saved"));

  await go("/emc/pos/bill");
  const billText = await page.locator(".bill-preview").first().innerText().catch(() => "");
  check("the bill designer previews a standard bill, not a tax invoice", !billText.includes("TAX INVOICE"), billText.split("\n").slice(0, 2).join(" / "));

  // ── 3. Menu, staff and the counter phone (configuration guide).
  await go("/emc/menu/categories");
  await page.getByRole("button", { name: "+ New category" }).click();
  await field("Code").fill("MAINS");
  await field("Name").fill("Mains");
  await saveDrawer();
  await go("/emc/menu/items");
  for (const [code, name, price, route] of [["NK01", "Chicken Kottu", "1200", "kitchen"], ["NK02", "Lime Juice", "450", "bar"]]) {
    await page.getByRole("button", { name: "+ New menu item" }).click();
    await field("Item code").fill(code);
    await field("Name \\(English\\)").fill(name);
    await field("Category").selectOption("MAINS");
    await field("Price").fill(price);
    await field("Kitchen ticket goes to").selectOption(route);
    await saveDrawer();
  }
  check("menu items added", (await page.locator("tbody tr").count()) === 2);

  await go("/emc/people/staff");
  await page.getByRole("button", { name: "+ New employee" }).click();
  await field("Employee number").fill("2001");
  await field("Name").fill("Fathima Cashier");
  await field("Role").selectOption("manager");
  await page.locator(".drawer input[placeholder='••••']").fill("2580");
  await page.locator(".drawer").getByRole("button", { name: "Set PIN" }).click();
  await page.waitForTimeout(500);
  await saveDrawer();
  check("employee with a PIN added", (await page.locator("tbody tr", { hasText: "Fathima Cashier" }).count()) === 1, await toasts());

  await go("/emc/setup/devices");
  await page.getByRole("button", { name: "+ New workstation" }).click();
  await field("Code").fill("P01");
  await field("Name").fill("Counter phone");
  await field("Outlet").selectOption("MAIN");
  await field("Revenue centre").selectOption("TAKEAWAY");
  await field("Hardware model").selectOption("mobile");
  await field("Printing").selectOption("bluetooth");
  await page.waitForTimeout(200);
  await saveDrawer();
  check("the counter phone prints to a Bluetooth printer (no Print Agent, no printer records)", (await page.locator("tr", { hasText: "P01" }).locator(".badge", { hasText: "Bluetooth" }).count()) === 1 && (await page.locator(".card", { hasText: "Printers" }).locator("tbody tr").count()) === 0);
  const state = await page.context().storageState();

  // ── 4. The phone and the XP-T80Q (Noura plan section 5).
  const ctx = await browser.newContext({ ...devices["Pixel 7"], storageState: state });
  ctx.setDefaultTimeout(15_000);
  await ctx.addInitScript(() => {
    localStorage.setItem("pos-suite.workstation", "P01");
    const writes = [];
    window.__btWrites = writes;
    const take = async (d) => { if (d.byteLength > 20) throw new DOMException("GATT operation failed", "NetworkError"); writes.push(...new Uint8Array(d)); };
    const ch = { uuid: "00002af1-0000-1000-8000-00805f9b34fb", properties: { write: true, writeWithoutResponse: true }, writeValue: take, writeValueWithoutResponse: take };
    const svc = { uuid: "000018f0-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [ch] };
    const gatt = { connected: false, async connect() { this.connected = true; return this; }, disconnect() { this.connected = false; }, async getPrimaryService(u) { if (u === svc.uuid) return svc; throw new DOMException("no such service", "NotFoundError"); } };
    const dev = Object.assign(new EventTarget(), { id: "xp-t80q-1", name: "XP-T80Q", gatt });
    Object.defineProperty(navigator, "bluetooth", { value: { getAvailability: async () => true, requestDevice: async () => dev, getDevices: async () => [dev] } });
  });
  const ph = await ctx.newPage();
  ph.on("pageerror", (e) => errors.push(`phone: ${e.message}`));
  const printed = async () => ph.evaluate(() => new TextDecoder("latin1").decode(new Uint8Array(window.__btWrites)));
  const clearPrinted = () => ph.evaluate(() => { window.__btWrites.length = 0; });
  await ph.goto(`${B}/pos?mode=local`);
  await ph.waitForTimeout(1000);
  await ph.getByLabel("Employee number or card").fill("2001");
  await ph.getByLabel("PIN", { exact: true }).fill("2580");
  await ph.getByRole("button", { name: "Sign In" }).click();
  await ph.waitForTimeout(900);
  if (await ph.locator(".mauth-list button").count()) await ph.locator(".mauth-list button", { hasText: "Takeaway" }).first().click();
  await ph.waitForTimeout(700);
  check("the cashier signs in on the phone (app style)", (await ph.locator(".mpos .m-nav").count()) === 1);
  await ph.getByRole("button", { name: "Connect printer" }).click();
  await ph.getByRole("button", { name: /Choose the printer|Connect printer/ }).last().click();
  await ph.waitForTimeout(500);
  await ph.getByRole("button", { name: "Test print" }).click();
  await ph.waitForTimeout(1200);
  check("the phone connects to the XP-T80Q and prints a test page", (await printed()).includes("TEST"));
  await ph.locator(".modal .btn.primary", { hasText: "Close" }).click();

  // Order: Send KOT prints the kitchen ticket (both dishes, the juice too: there is no bar printer).
  await clearPrinted();
  await ph.locator(".m-nav button", { hasText: "Menu" }).click();
  await ph.waitForTimeout(400);
  await ph.locator(".m-product", { hasText: "Chicken Kottu" }).locator(".m-add").click();
  await ph.locator(".m-product", { hasText: "Lime Juice" }).locator(".m-add").click();
  await ph.waitForTimeout(300);
  await ph.locator(".m-cartbar").click();
  await ph.waitForTimeout(400);
  await ph.getByRole("button", { name: "Send and print the kitchen ticket" }).click();
  await ph.waitForTimeout(1500);
  const kot = await printed();
  check("Send KOT prints the kitchen tickets on the same printer, and nothing else", kot.includes("KOT - ") && kot.includes("Chicken Kottu") && kot.includes("Lime Juice") && !kot.includes("Bill No") && !kot.includes("\x1bp"), `${kot.length} bytes`);

  await clearPrinted();
  await ph.locator(".m-nav button", { hasText: "Orders" }).click();
  await ph.waitForTimeout(400);
  await ph.locator(".m-order", { has: ph.locator(".m-order-ico.open") }).first().click();
  await ph.waitForTimeout(500);
  await ph.locator("button[aria-label='Order options']").first().click();
  await ph.locator(".m-sheet-row", { hasText: "Print kitchen ticket again" }).click();
  await ph.waitForTimeout(1500);
  check("a lost kitchen ticket reprints, marked REPRINT", (await printed()).includes("REPRINT"));

  // Payment: the standard Sri Lankan bill (no VAT, no TIN) and the cash drawer.
  await clearPrinted();
  if (!(await ph.getByRole("button", { name: /Proceed to Payment/ }).count())) {
    await ph.locator(".m-nav button", { hasText: "Orders" }).click();
    await ph.locator(".m-order", { has: ph.locator(".m-order-ico.open") }).first().click();
    await ph.waitForTimeout(400);
  }
  await ph.getByRole("button", { name: /Proceed to Payment/ }).click();
  await ph.waitForTimeout(500);
  await ph.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
  await ph.waitForTimeout(2500);
  const bill = await printed();
  check("cash payment prints a standard bill (Bill No, no TAX INVOICE, no VAT) and opens the drawer", bill.includes("Bill No") && !bill.includes("TAX INVOICE") && !/VAT\s+\d/.test(bill) && !bill.includes("TIN:") && bill.includes("1,650.00") && bill.includes("\x1bp"), bill.match(/TOTAL[^\n]*/)?.[0] ?? `${bill.length} bytes`);
  check("no kitchen ticket is printed again at payment", !bill.includes("KOT - "));
  await ph.getByRole("button", { name: "Done" }).click();
  await ph.waitForTimeout(400);

  // X report on the phone's printer.
  await clearPrinted();
  await ph.locator(".m-nav button", { hasText: "More" }).click();
  await ph.locator(".m-sheet-row", { hasText: "Functions" }).click();
  await ph.waitForTimeout(500);
  const x = ph.getByRole("button", { name: /X report/ }).first();
  if (await x.count()) {
    await x.click();
    await ph.waitForTimeout(1500);
    const rep = await printed();
    check("the X report prints on the phone's printer", rep.length > 100 && /X REPORT|X Report/i.test(rep), `${rep.length} bytes`);
  } else check("the X report prints on the phone's printer", false, "no X report button");
  // Local mode keeps the data in each browser's storage; in the cloud the phone and the back office
  // share one database. Carry the phone's data over to the back office.
  const after = await ctx.storageState();
  await ctx.close();
  await page.context().close();
  page = await (await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: after })).newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (e) => errors.push(e.message));

  await go("/emc/reports");
  const reports = await page.locator(".page").innerText();
  check("the back office sees the phone's sale", reports.includes("1,650") || reports.includes("1,650.00"), reports.replace(/\s+/g, " ").slice(0, 120));

  // ── 5. The books: the day's sales post, the accounting workbook imports, the trial balance balances.
  await go("/emc/finance");
  // Past days are listed under Days to post; today (still trading) is posted with Post day, as End of Day does.
  const businessDate = new Date(Date.now() + (5.5 - 4) * 3600_000).toISOString().slice(0, 10);
  await page.getByLabel("Day to post").fill(businessDate);
  await page.getByRole("button", { name: "Post day" }).click();
  await page.waitForTimeout(1500);
  const posted = await toasts();
  check("the POS day posts to the books", /Posted|Submitted|approval/i.test(posted), posted.slice(0, 120));

  // One person keeps the books (Noura plan, finance settings): journals up to Rs 1,000,000 need no second approver.
  await go("/emc/finance/settings");
  await page.locator(".field", { hasText: /^Journals needing a second approver/ }).locator("input").fill("1000000");
  await page.getByRole("button", { name: "Save" }).first().click();
  await page.waitForTimeout(800);

  await go("/emc/finance/import");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download the (blank )?workbook|Download the blank/ }).first().click();
  const blank = await (await dl).path();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(blank);
  const asAt = wb.getWorksheet("Read me")?.getColumn(2).values.find((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v));
  const ob = wb.getWorksheet("Opening balances");
  const firstEmpty = (ws) => {
    for (let r = 2; r < 400; r++) if (!ws.getRow(r).getCell(1).value) return r;
    return 2;
  };
  let r = firstEmpty(ob);
  ob.getRow(r).values = ["1000", "Cash", 25000, null, "Cash in the till"];
  ob.getRow(r + 1).values = ["1010", "Bank", 150000, null, "Current account"];
  ob.getRow(r + 2).values = ["3000", "Capital", null, 175000, "Owner's capital"];
  const sup = wb.getWorksheet("Suppliers");
  r = firstEmpty(sup);
  const supCols = sup.getRow(1).values.map((v) => String(v ?? ""));
  const row = [];
  row[supCols.findIndex((h) => /^Code/.test(h))] = "PVS";
  row[supCols.findIndex((h) => /^Name/.test(h))] = "Perera Vegetable Stores";
  sup.getRow(r).values = row;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  await page.getByLabel("Accounting workbook").setInputFiles({ name: "noura-books.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf });
  await page.waitForTimeout(2500);
  const modal = await page.locator(".modal").innerText().catch(() => "");
  check("the filled workbook passes its checks", modal.includes("Check results") && !/\bErrors?\s*[1-9]/.test(modal), modal.replace(/\s+/g, " ").slice(0, 160) || (asAt ?? ""));
  await page.locator(".modal .btn.primary", { hasText: "Import" }).click();
  await page.waitForSelector("text=Import results", { timeout: 60_000 });
  const res = await page.locator(".card", { hasText: "Import results" }).innerText();
  // Local mode saves to the browser's storage a moment after the last write; let it finish before reloading.
  await page.waitForTimeout(1500);
  check("the opening balances and supplier import with no problems, posted straight away", res.match(/Problems\s*(\d+)/)?.[1] === "0" && res.match(/Waiting for approval\s*(\d+)/)?.[1] === "0" && Number(res.match(/Posted\s*(\d+)/)?.[1]) >= 1, res.replace(/\s+/g, " ").slice(0, 600));

  await go("/emc/finance/approvals");
  const approve = page.getByRole("button", { name: /^Approve/ });
  for (let i = 0; i < 10 && (await approve.count()); i++) {
    await approve.first().click();
    await page.waitForTimeout(700);
  }
  await go("/emc/finance/statements");
  await page.getByRole("tab", { name: "Trial balance" }).click();
  await page.waitForTimeout(800);
  const tb = await page.locator(".card").first().innerText();
  check("the trial balance balances", (await page.locator(".card-head .badge").first().textContent()) === "Balanced", tb.replace(/\s+/g, " ").slice(0, 100));
  const tbRow = async (code) => (await page.locator("tr", { hasText: new RegExp(`^\\s*${code}\\b`) }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  const cash = await tbRow("1000");
  const capital = await tbRow("3000");
  check("cash = opening Rs 25,000 + the day's cash sale Rs 1,650", cash.includes("26,650.00"), cash);
  check("capital Rs 175,000 from the opening balances", capital.includes("175,000.00"), capital);
  const tbTable = await page.locator("table").first().innerText();
  check("sales of Rs 1,650 with no VAT or SSCL in the books", (await tbRow("4000")).includes("1,650.00") && !/VAT|SSCL/i.test(tbTable), await tbRow("4000"));

  // ── 6. Audit Center and data quality: nothing flagged as an error.
  await go("/emc/audit");
  const audit = await page.locator(".page").innerText();
  check("Audit Center opens and the audit trail is intact", !/tamper|broken chain|mismatch/i.test(audit), audit.replace(/\s+/g, " ").slice(0, 120));
  const dq = page.getByRole("tab", { name: /Data quality/ });
  if (await dq.count()) {
    await dq.click();
    await page.waitForTimeout(800);
    const q = await page.locator(".page").innerText();
    const errs = q.match(/(\d+)\s+errors?/i)?.[1];
    check("data quality shows no errors", !errs || errs === "0", q.replace(/\s+/g, " ").slice(0, 160));
  }

  await go("/emc/setup/checklist");
  const list = await page.locator(".page").innerText();
  check("the setup checklist shows what is still to do", (await page.locator("tbody tr").count()) >= 6, list.replace(/\s+/g, " ").slice(0, 100));

  check("no browser errors", errors.length === 0, errors.slice(0, 5).join(" | "));
} catch (e) {
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: resolve(root, `e2e-golive-failure-${browser.contexts().indexOf(c)}.png`) }).catch(() => {});
  check("run completed", false, `${e.message.split("\n")[0]} (screenshots: e2e-golive-failure-*.png)`);
} finally {
  await browser.close();
  await server.close();
}
const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
