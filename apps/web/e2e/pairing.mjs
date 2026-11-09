/**
 * Connecting phones with one-time codes, end to end in a real browser against the Firebase
 * emulators (Auth, Firestore with the real rules, and the Cloud Functions):
 *   pnpm test:pairing
 * An owner signs up and creates a business, connects a phone with a code, the phone (an emulated
 * iPhone) opens the link and lands on the POS on its own workstation, the code can't be reused,
 * and removing the phone locks it out.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(web, "../..");
Object.assign(process.env, { VITE_USE_EMULATORS: "true", VITE_FIREBASE_API_KEY: "demo-key", VITE_FIREBASE_AUTH_DOMAIN: "demo-pos-suite.firebaseapp.com", VITE_FIREBASE_PROJECT_ID: "demo-pos-suite", VITE_FIREBASE_APP_ID: "demo-app" });
const B = "http://localhost:5196";
const server = await createServer({ root: web, server: { port: 5196, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
const out = [];
const check = (n, ok, d = "") => { out.push([n, ok]); console.log(`${ok ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };
try {
  const owner = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await owner.goto(B);
  await owner.waitForSelector("#password", { timeout: 60000 });
  await owner.getByRole("button", { name: "Create account" }).first().click();
  await owner.locator("#name").fill("Noura Owner");
  await owner.locator("#email").fill("owner@noura.test");
  await owner.locator("#password").fill("Noura-Kitchen-2026");
  await owner.locator("form button.btn.primary").click();
  await owner.waitForSelector("#bname", { timeout: 30000 });
  await owner.locator("#bname").fill("Noura Kitchen");
  const pos = owner.locator(".chip", { hasText: "Point of Sale" });
  if (!(await pos.getAttribute("class")).includes(" on")) await pos.click();
  await owner.getByRole("button", { name: "Create business" }).click();
  await owner.waitForURL(/emc\/home/, { timeout: 60000 });
  await owner.goto(`${B}/emc/setup/devices`);
  await owner.getByRole("button", { name: /Connect a phone/ }).click();
  await owner.getByLabel("Name of this phone").fill("Nimal's phone");
  await owner.getByRole("button", { name: "Show the code" }).click();
  const codeEl = owner.locator("[aria-label='Pairing code']");
  await codeEl.waitFor({ timeout: 30000 });
  const code = (await codeEl.textContent()).trim();
  check("manager gets a QR code and a one-time code", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code) && (await owner.locator("img[alt='Pairing QR code']").count()) === 1, code);

  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = await ctx.newPage();
  await phone.goto(`${B}/pair?code=${encodeURIComponent(code)}`);
  await phone.waitForSelector("[aria-label='Pairing code']", { timeout: 60000 });
  check("the link fills in the code on the phone", (await phone.locator("[aria-label='Pairing code']").inputValue()) === code);
  await phone.getByRole("button", { name: "Connect" }).click();
  await phone.waitForURL(/\/pos/, { timeout: 60000 });
  await phone.waitForTimeout(3000);
  const ws = await phone.evaluate(() => localStorage.getItem("pos-suite.workstation"));
  const signIn = (await phone.getByLabel("Employee number or card").count()) > 0;
  check("the phone opens the POS on its own workstation", ws === "P01" && signIn, `workstation ${ws}`);
  // The same code can't connect a second phone.
  const ctx2 = await browser.newContext({ ...devices["Pixel 7"] });
  const other = await ctx2.newPage();
  await other.goto(`${B}/pair?code=${encodeURIComponent(code)}`);
  await other.getByRole("button", { name: "Connect" }).click();
  await other.waitForSelector("[role=alert]", { timeout: 30000 });
  check("a used code is refused", /isn't valid any more/.test(await other.locator("[role=alert]").innerText()));

  await owner.getByRole("button", { name: "Done" }).click();
  await owner.waitForTimeout(2000);
  const card = () => owner.locator(".card", { has: owner.locator("h3", { hasText: "Connected phones and tablets" }) });
  const row = card().locator("tbody tr", { hasText: "Nimal's phone" });
  check("the device list shows the phone", (await row.count()) === 1 && (await row.innerText()).includes("P01") && (await row.innerText()).includes("iPhone"), (await row.innerText()).replace(/\s+/g, " "));
  await owner.goto(`${B}/emc/people/logins`);
  await owner.waitForTimeout(1500);
  check("the phone isn't listed as a back-office login", (await owner.locator("tbody tr", { hasText: "devices.pos-suite.invalid" }).count()) === 0 && (await owner.getByText(/connected phone/).count()) === 1);
  await owner.goto(`${B}/emc/setup/devices`);
  await owner.waitForTimeout(1500);
  const rm = card().locator("tbody tr", { hasText: "Nimal's phone" }).getByRole("button", { name: /Remove/ });
  await rm.click();
  await owner.waitForTimeout(300);
  await card().locator("tbody tr", { hasText: "Nimal's phone" }).locator("button").click();
  await owner.waitForTimeout(3000);
  check("removing the phone takes it off the list", (await card().locator("tbody tr", { hasText: "Nimal's phone" }).count()) === 0);
  await phone.reload();
  await phone.waitForTimeout(4000);
  check("the removed phone is locked out", (await phone.getByText("This phone is no longer connected").count()) === 1 || (await phone.locator("#password").count()) === 1);
} catch (e) {
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: resolve(root, `e2e-pairing-failure-${browser.contexts().indexOf(c)}.png`) }).catch(() => {});
  check("run completed", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  await server.close();
}
console.log(`\n${out.filter(([, ok]) => ok).length}/${out.length} checks passed`);
process.exit(out.length === 8 && out.every(([, ok]) => ok) ? 0 : 1);
