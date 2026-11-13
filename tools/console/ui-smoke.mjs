/**
 * The console's screens in a browser, against the emulators (run after test-console.mts, which leaves
 * an owner and a client with health, licences, payments and usage). Signs in as the owner, opens every
 * page, checks text contrast (WCAG AA) and that nothing errors, and saves screenshots to
 * manual-pdf/console/ (git-ignored).  Part of `pnpm test:console`.
 */
import { mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

if (process.env.CONSOLE_UI === "skip") {
  console.log("Console screens skipped (CONSOLE_UI=skip)");
  process.exit(0);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "apps/console/package.json"));
const { createServer } = await import(require.resolve("vite"));
const { chromium } = createRequire(import.meta.url)("playwright");

Object.assign(process.env, { VITE_USE_EMULATORS: "true", VITE_FIREBASE_API_KEY: "fake-api-key", VITE_FIREBASE_PROJECT_ID: "demo-polymath-console", VITE_FIREBASE_AUTH_DOMAIN: "demo-polymath-console.firebaseapp.com", VITE_FIREBASE_APP_ID: "1:1:web:1" });
const server = await createServer({ root: join(root, "apps/console"), configFile: join(root, "apps/console/vite.config.ts"), server: { port: 5175, strictPort: true }, logLevel: "error" });
await server.listen();
const shots = join(root, "manual-pdf/console");
mkdirSync(shots, { recursive: true });

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failed++;
};

/** Text that fails WCAG AA (4.5:1, or 3:1 for large text) against its effective background. */
const contrastFailures = () =>
  document.querySelectorAll("*").length &&
  [...document.querySelectorAll("body *")].flatMap((el) => {
    const text = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!text) return [];
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || r.width === 0 || r.height === 0 || Number(cs.opacity) < 0.5) return [];
    const parse = (c) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]) => [r, g, b].map((v) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    let bg = null;
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) > 0.5) { bg = c; break; }
    }
    bg ??= [255, 255, 255];
    const fg = parse(cs.color);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700);
    return ratio < (large ? 3 : 4.5) && !el.closest("[disabled]") ? [`${text.slice(0, 40)} (${ratio.toFixed(2)})`] : [];
  });

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    for (const vp of [{ name: "pc", width: 1366, height: 860 }, { name: "phone", width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: scheme, deviceScaleFactor: scheme === "light" && vp.name === "pc" ? 2 : 1 });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && !/Failed to load resource|favicon/.test(m.text()) && errors.push(m.text()));
      await page.goto("http://localhost:5175/");
      await page.getByLabel("Email").fill("owner@polymath.test");
      await page.getByLabel("Password").fill("Correct-Horse-9");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByRole("heading", { name: "Client distribution" }).waitFor({ timeout: 20_000 });
      const tag = `${vp.name} ${scheme}`;
      const visit = async (label, path, expect, shot) => {
        await page.goto(`http://localhost:5175${path}`);
        await page.getByText(expect, { exact: false }).first().waitFor({ timeout: 15_000 });
        await page.waitForTimeout(300);
        const bad = await page.evaluate(contrastFailures);
        check(!bad.length, `${tag} · ${label}${bad.length ? `: low contrast ${bad.slice(0, 3).join("; ")}` : ""}`);
        const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(wide <= 1, `${tag} · ${label} fits the screen width${wide > 1 ? ` (${wide}px too wide)` : ""}`);
        if (shot && scheme === "light") await page.screenshot({ path: join(shots, `${vp.name}-${shot}.png`), fullPage: vp.name === "pc" });
      };
      await visit("overview", "/", "Client distribution", "dashboard");
      await page.getByText("Kandy Mist").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
      check(await page.getByText("Welcome back, Owner!").isVisible(), `${tag} · overview greets the signed-in person`);
      check((await page.locator(".kpi").count()) === 4 && (await page.locator(".spark svg").count()) === 4, `${tag} · four figures with their trend lines`);
      check((await page.locator(".map .pin").count()) >= 1, `${tag} · clients on the map`);
      if (vp.name === "pc") {
        // The map's Sri Lanka view and the platform health donut.
        await page.getByRole("tab", { name: "Sri Lanka" }).click();
        check((await page.locator(".map .pin").count()) >= 5, `${tag} · Sri Lanka view shows each town`);
        if (scheme === "light") await page.locator(".dash-row").first().screenshot({ path: join(shots, "pc-dashboard-row.png") });
        // Search: type a client's town, Enter opens it.
        await page.getByRole("combobox", { name: "Search" }).fill("kandy");
        await page.getByRole("option", { name: /Kandy Mist/ }).waitFor();
        await page.keyboard.press("Enter");
        await page.getByRole("heading", { name: "Kandy Mist Café" }).waitFor({ timeout: 10_000 });
        check(true, `${tag} · search finds a client by town and opens it`);
        // Alerts: the bell lists clients that need attention.
        await page.getByRole("button", { name: /^Alerts/ }).click();
        await page.getByRole("dialog", { name: "Alerts" }).getByText("Ella Bakehouse").waitFor();
        if (scheme === "light") await page.screenshot({ path: join(shots, "pc-alerts.png") });
        check(true, `${tag} · the bell lists clients that need attention`);
        await page.keyboard.press("Escape");
        await page.mouse.click(5, 400);
      } else {
        // The menu opens from the top bar on a phone.
        await page.getByRole("button", { name: "Open menu" }).click();
        const menu = page.getByRole("navigation", { name: "Console" });
        await menu.getByRole("link", { name: "Subscriptions" }).waitFor();
        await page.waitForTimeout(400); // the menu slides in
        if (scheme === "light") await page.screenshot({ path: join(shots, "phone-menu.png") });
        await menu.getByRole("link", { name: "Subscriptions" }).click();
        await page.getByRole("heading", { name: "Subscriptions", level: 1 }).waitFor();
        check(true, `${tag} · the phone menu opens and navigates`);
      }
      await visit("clients", "/clients", "Noura Kitchen", "clients");
      await visit("client overview", "/clients/noura-kitchen", "Registered name", "client");
      for (const [tab, text, shot] of [["Health", "Server version", "client-health"], ["Licence", "Current licence", "client-licence"], ["Subscription", "Payments", "client-subscription"], ["Usage", "Bills, last", null], ["Controls", "Notice to the client", "client-status"], ["Activity", "issueLicence", null]]) {
        await page.goto("http://localhost:5175/clients/noura-kitchen");
        await page.getByRole("tab", { name: tab }).click();
        await page.getByText(text).first().waitFor({ timeout: 15_000 });
        const bad = await page.evaluate(contrastFailures);
        check(!bad.length, `${tag} · client ${tab}${bad.length ? `: low contrast ${bad.slice(0, 3).join("; ")}` : ""}`);
        if (shot && scheme === "light") await page.screenshot({ path: join(shots, `${vp.name}-${shot}.png`), fullPage: vp.name === "pc" });
      }
      await visit("licences", "/licences", "LIC-", "licences");
      await visit("deployments", "/deployments", "New update", "deployments");
      await visit("updates", "/updates", "Rollouts", "updates");
      check(await page.getByTestId("notice-preview").isVisible(), `${tag} · updates show what clients will see`);
      await visit("businesses", "/businesses", "Waiting for approval", "businesses");
      check((await page.locator("[data-request]").count()) >= 1, `${tag} · a business request waits for approval with its checks`);
      await visit("privacy", "/privacy", "What the console holds", "privacy");
      await visit("subscriptions", "/subscriptions", "Monthly recurring revenue", "subscriptions");
      await visit("monitoring", "/monitoring", "Unrecognised check-ins", "monitoring");
      await visit("reports", "/reports", "Revenue collected", "reports");
      await visit("support", "/support", "Client contacts", "support");
      await visit("staff", "/staff", "sales@polymath.test", "staff");
      await visit("audit log", "/audit", "suspend", null);
      await visit("settings", "/settings", "Licence public key", "settings");
      if (vp.name === "pc" && scheme === "light") {
        await page.goto("http://localhost:5175/clients/noura-kitchen");
        await page.getByRole("tab", { name: "Licence" }).click();
        await page.getByRole("button", { name: "Renew or change" }).click();
        await page.getByRole("dialog").waitFor();
        await page.screenshot({ path: join(shots, "pc-issue-licence.png") });
        check(await page.getByRole("dialog").getByText("Add-on modules").isVisible(), "issue-licence form opens with add-ons");
        await page.keyboard.press("Escape");
      }
      check(!errors.length, `${tag} · no browser errors${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(failed ? `\n${failed} screen check(s) failed` : `\nAll console screens passed (screenshots in manual-pdf/console)`);
process.exit(failed ? 1 : 0);
