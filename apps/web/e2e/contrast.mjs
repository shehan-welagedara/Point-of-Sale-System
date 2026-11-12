/**
 * Colour contrast audit (WCAG 2.1 AA) in a real browser, local demo mode:
 *   pnpm test:contrast
 *
 * Every visible piece of text on the screens below is checked against the background it really sits
 * on (ancestor backgrounds blended, gradients checked at every colour stop, ancestor opacity applied):
 * 4.5:1 for normal text, 3:1 for large text (24px, or 18.66px bold). Disabled controls are exempt,
 * as WCAG allows. Screens: the POS app (Bright and Indigo) on a phone, tablet portrait and landscape,
 * and PC; the classic terminal; the back office in light and dark.
 *
 * Exits non-zero and lists every failure (screen, text, colours, ratio) when anything is below the bar.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5198);
const B = `http://localhost:${PORT}`;
const only = process.argv.slice(2);

/** Runs in the page: returns the text that fails, inside `rootSel` when a dialog is open. */
function auditInPage(rootSel) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  const rgba = (c) => {
    if (cache.has(c)) return cache.get(c);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const v = [d[0], d[1], d[2], d[3] / 255];
    cache.set(c, v);
    return v;
  };
  const blend = (top, bottom) => {
    const a = top[3];
    return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const COLOR_RE = /(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|#[0-9a-f]{3,8}\b)/gi;

  /** Background layers from the element up to the first opaque one; each layer is a list of possible colours. */
  function backgrounds(el) {
    const layers = [];
    let opacity = 1;
    for (let a = el; a && a.nodeType === 1; a = a.parentElement) {
      const cs = getComputedStyle(a);
      opacity *= Number(cs.opacity);
      const img = cs.backgroundImage;
      if (img && img !== "none") {
        if (img.includes("url(")) return { image: true };
        const stops = (img.match(COLOR_RE) ?? []).map(rgba);
        if (stops.length) {
          layers.push(stops);
          if (stops.every((s) => s[3] >= 0.99)) break;
        }
      }
      const bg = rgba(cs.backgroundColor);
      if (bg[3] > 0.01) {
        layers.push([bg]);
        if (bg[3] >= 0.99) break;
      }
      if (a === document.documentElement) layers.push([[255, 255, 255, 1]]);
    }
    // Composite from the bottom layer up; keep every combination of gradient stops (worst case wins).
    let out = [[255, 255, 255, 1]];
    for (let i = layers.length - 1; i >= 0; i--) {
      const next = [];
      for (const top of layers[i]) for (const bottom of out) next.push(blend(top, bottom));
      out = next.slice(0, 40);
    }
    return { colors: out, opacity };
  }

  const root = rootSel ? document.querySelector(rootSel) : document.body;
  if (!root) return { error: `no ${rootSel}` };
  const fails = [];
  let checked = 0;
  let images = 0;
  const seen = new Set();
  const vw = innerWidth;
  const vh = innerHeight;
  const els = [root, ...root.querySelectorAll("*")];
  for (const el of els) {
    const isSvgText = el instanceof SVGTextElement;
    const isInput = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    let text = "";
    if (isSvgText) text = el.textContent.trim();
    else if (isInput && !["checkbox", "radio", "range", "color", "file", "hidden"].includes(el.type)) text = el.value || "";
    else for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = text.replace(/\s+/g, " ").trim();
    const placeholder = isInput && !el.value && el.placeholder ? el.placeholder : "";
    if (!text && !placeholder) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (el.closest("[disabled], [aria-disabled='true'], .disabled, [aria-hidden='true'], .sr-only, .visually-hidden")) continue;
    if (el.closest("select") && !(el instanceof HTMLSelectElement)) continue; // <option>s: drawn by the browser
    // Something drawn over it (a dialog's backdrop): not visible, not checked.
    const inView = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    if (inView) {
      const x = Math.min(vw - 1, Math.max(0, r.left + Math.min(r.width / 2, 12)));
      const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (hit && !el.contains(hit) && !hit.contains(el) && !hit.closest("label")?.contains(el)) {
        const style = getComputedStyle(hit);
        // A translucent overlay (backdrop) over the element: skip it. A sibling that merely overlaps: still check.
        if (hit.closest(".m-sheet-wrap, .modal-backdrop, .backdrop, .overlay, [role='dialog']") && !el.closest(".m-sheet-wrap, .modal-backdrop, .backdrop, .overlay, [role='dialog']")) continue;
        if (style.position === "fixed" && !el.closest(`.${[...hit.classList].join(".") || "__none"}`)) continue;
      }
    }
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const bg = backgrounds(el);
    if (bg.image) {
      images++;
      continue;
    }
    const check = (kind, colorStr, label) => {
      let fg = rgba(colorStr);
      if (fg[3] < 0.01) return;
      let worst = Infinity;
      let worstBg = null;
      for (const b of bg.colors) {
        const f = blend([fg[0], fg[1], fg[2], fg[3] * bg.opacity], b);
        const v = ratio(f, b);
        if (v < worst) {
          worst = v;
          worstBg = b;
        }
      }
      checked++;
      if (worst + 0.005 < need) {
        const path = [];
        for (let a = el; a && a !== document.body && path.length < 4; a = a.parentElement) {
          path.unshift(`${a.tagName.toLowerCase()}${a.classList.length ? `.${[...a.classList].slice(0, 2).join(".")}` : ""}`);
        }
        const key = `${path.join(">")}|${hex(fg)}|${hex(worstBg)}`;
        if (seen.has(key)) return;
        seen.add(key);
        fails.push({ kind, text: label.slice(0, 48), fg: hex(fg) + (fg[3] < 1 ? `@${fg[3].toFixed(2)}` : ""), bg: hex(worstBg), ratio: Math.round(worst * 100) / 100, need, size: Math.round(size * 10) / 10, weight, path: path.join(" > ") });
      }
    };
    if (text) check(isSvgText ? "svg" : "text", isSvgText ? cs.fill : cs.color, text);
    if (placeholder) check("placeholder", getComputedStyle(el, "::placeholder").color, placeholder);
  }
  return { checked, images, fails };
}

const report = [];
let failures = 0;
async function audit(page, screen, rootSel) {
  await page.waitForTimeout(250);
  const res = await page.evaluate(auditInPage, rootSel ?? null);
  if (res.error) {
    console.log(`  ? ${screen}: ${res.error}`);
    return;
  }
  report.push({ screen, ...res });
  failures += res.fails.length;
  console.log(`${res.fails.length ? "✗" : "✓"} ${screen} — ${res.checked} text checks${res.images ? `, ${res.images} on photos` : ""}${res.fails.length ? `, ${res.fails.length} below AA` : ""}`);
  for (const f of res.fails) console.log(`    ${f.ratio}:1 (needs ${f.need}) ${f.fg} on ${f.bg} ${f.size}px/${f.weight} "${f.text}" — ${f.path}${f.kind !== "text" ? ` [${f.kind}]` : ""}`);
}

const server = await createServer({ root: web, server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch();
try {
  const setup = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await setup.goto(`${B}/?mode=local`);
  await audit(setup, "back office · sign-in (light)");
  await setup.getByText("Load the demo restaurant").click();
  await setup.waitForURL(/emc\/home/, { timeout: 90_000 });
  const demo = await setup.context().storageState();

  async function styled(style) {
    await setup.goto(`${B}/emc/pos/mobile?mode=local`);
    await setup.waitForTimeout(700);
    await setup.locator(".style-cards button", { hasText: style === "indigo" ? "Indigo" : "Bright" }).click();
    await setup.getByRole("button", { name: "Save" }).click();
    await setup.waitForTimeout(700);
    return setup.context().storageState();
  }

  // ── The POS app at every size ──
  // The app styles are always light; the phone and PC are also checked with the device set to dark mode.
  const sizes = [
    ["phone", { ...devices["Pixel 7"] }],
    ["tablet portrait", { ...devices["iPad (gen 7)"] }],
    ["tablet landscape", { ...devices["iPad (gen 7) landscape"] }],
    ["PC 1366", { viewport: { width: 1366, height: 768 } }],
    ["PC 1920", { viewport: { width: 1920, height: 1080 } }],
    ["phone, device in dark mode", { ...devices["Pixel 7"], colorScheme: "dark" }],
    ["PC 1366, device in dark mode", { viewport: { width: 1366, height: 768 }, colorScheme: "dark" }],
  ];
  for (const style of ["bright", "indigo"]) {
    if (only.length && !only.includes(style)) continue;
    const st = await styled(style);
    for (const [size, opts] of sizes) {
      const ctx = await browser.newContext({ ...opts, storageState: st });
      await ctx.addInitScript(() => localStorage.setItem("pos-suite.workstation", "W02"));
      ctx.setDefaultTimeout(8000);
      const p = await ctx.newPage();
      const tag = `POS ${style} · ${size}`;
      await p.goto(`${B}/pos?mode=local`);
      await p.waitForTimeout(800);
      await audit(p, `${tag} · sign-in`);
      await p.getByLabel("Employee number or card").fill("1001");
      await p.getByLabel("PIN", { exact: true }).fill("9999");
      await p.getByRole("button", { name: "Sign In" }).click();
      await p.waitForTimeout(700);
      await audit(p, `${tag} · wrong PIN`);
      await p.getByLabel("PIN", { exact: true }).fill("1111");
      await p.getByRole("button", { name: "Sign In" }).click();
      await p.waitForTimeout(900);
      if (await p.locator(".mauth-list button").count()) {
        await audit(p, `${tag} · revenue centres`);
        await p.locator(".mauth-list button").first().click();
      }
      await p.waitForTimeout(700);
      const wide = (await p.locator(".mpos.wide").count()) > 0;
      await audit(p, `${tag} · home`);
      const nav = (label) => p.locator(".m-nav button, .w-nav button", { hasText: label }).first();
      await nav("Tables").click();
      await audit(p, `${tag} · tables`);
      await nav("Menu").click();
      await p.waitForTimeout(400);
      await audit(p, `${tag} · menu`);
      await p.getByPlaceholder("Search dishes or codes").fill("kottu");
      await p.waitForTimeout(300);
      await p.locator(".m-product:not(.out) .m-add").first().click();
      await p.waitForTimeout(400);
      if (await p.locator(".modal").count()) {
        await audit(p, `${tag} · dish choices dialog`, ".modal");
        await p.locator(".modal .btn.primary").last().click();
      }
      await p.getByPlaceholder("Search dishes or codes").fill("");
      await p.locator(".m-product:not(.out) .m-add").nth(1).click();
      await p.waitForTimeout(300);
      if (await p.locator(".modal").count()) await p.locator(".modal .btn.primary").last().click();
      if (!wide) {
        await audit(p, `${tag} · menu with order bar`);
        await p.locator(".m-cartbar").click();
        await p.waitForTimeout(400);
      }
      await audit(p, `${tag} · order`);
      await p.locator("button[aria-label='Order options']").first().click();
      await p.waitForTimeout(350);
      await audit(p, `${tag} · order options`, ".m-sheet");
      await p.keyboard.press("Escape");
      if (await p.locator(".m-sheet-wrap").count()) await p.locator(".m-sheet-wrap").click({ position: { x: 5, y: 5 } }).catch(() => {});
      await p.waitForTimeout(300);
      await p.locator(wide ? ".w-order .m-btn.cta" : ".m-foot .m-btn.cta").first().click();
      await p.waitForTimeout(500);
      await audit(p, `${tag} · payment`);
      await p.getByRole("button", { name: /Pay Now|Complete Payment/ }).click();
      await p.waitForTimeout(1500);
      await p.locator(".m-toast, .toast").first().waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
      await audit(p, `${tag} · payment done`);
      await p.getByRole("button", { name: "Done" }).click();
      await p.waitForTimeout(400);
      await nav("Orders").click();
      await audit(p, `${tag} · orders`);
      await nav("More").click();
      await audit(p, `${tag} · more`);
      await p.locator(".m-sheet-row", { hasText: "Sales dashboard" }).click().catch(() => {});
      await p.waitForTimeout(700);
      await audit(p, `${tag} · reports`);
      await ctx.close();
    }
  }

  // ── The terminal layout: its three themes, with the device in light and in dark mode ──
  if (!only.length || only.includes("terminal")) {
    for (const template of ["Modern", "Classic", "Midnight"]) {
      await setup.goto(`${B}/emc/pos/appearance?mode=local`);
      await setup.waitForTimeout(700);
      await setup.locator("button.card", { hasText: template }).first().click();
      await setup.getByRole("button", { name: "Save" }).first().click();
      await setup.waitForTimeout(700);
      const st = await setup.context().storageState();
      for (const scheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, storageState: st, colorScheme: scheme });
        await ctx.addInitScript(() => localStorage.setItem("pos-suite.workstation", "W01"));
        ctx.setDefaultTimeout(8000);
        const p = await ctx.newPage();
        const tag = `terminal ${template} · device ${scheme}`;
        const keypad = async (digits) => {
          for (const d of digits) await p.locator(".keypad button", { hasText: new RegExp(`^${d}$`) }).first().click();
        };
        await p.goto(`${B}/pos?mode=local`);
        await p.waitForTimeout(900);
        await audit(p, `${tag} · sign-in`);
        await p.getByLabel("Employee number or card").fill("4321");
        await p.keyboard.press("Enter");
        await p.waitForTimeout(600);
        await audit(p, `${tag} · unknown employee`);
        await p.getByLabel("Employee number or card").fill("1002");
        await p.keyboard.press("Enter");
        await p.waitForTimeout(400);
        await audit(p, `${tag} · PIN`);
        await keypad("9999");
        await p.waitForTimeout(600);
        await audit(p, `${tag} · wrong PIN`);
        await keypad("2222");
        await p.waitForTimeout(700);
        if (await p.locator(".rvc-btn").count()) {
          await audit(p, `${tag} · revenue centres`);
          await p.locator(".rvc-btn", { hasText: "Restaurant" }).first().click();
          await p.waitForTimeout(700);
        }
        await audit(p, `${tag} · order screen`);
        for (let i = 0; i < 3; i++) {
          await p.locator(".pos-item:not(.out)").nth(i).click();
          await p.waitForTimeout(300);
          if (await p.locator(".modal").count()) {
            if (i === 0) await audit(p, `${tag} · dish choices`, ".modal");
            await p.locator(".modal .btn.primary").last().click();
            await p.waitForTimeout(200);
          }
        }
        await audit(p, `${tag} · order with items`);
        await p.locator(".pos-actions").getByRole("button", { name: "Discount", exact: true }).click();
        await p.waitForTimeout(400);
        if (await p.locator(".modal").count()) {
          await audit(p, `${tag} · discount`, ".modal");
          await p.keyboard.press("Escape");
          await p.waitForTimeout(300);
        }
        await p.locator(".pos-actions .pay").click();
        await p.waitForTimeout(500);
        if (await p.locator(".modal").count()) {
          await audit(p, `${tag} · payment`, ".modal");
          await p.keyboard.press("Escape");
          await p.waitForTimeout(300);
        }
        for (const tab of ["Tables", "Open", "Reports", "Functions"]) {
          const t = p.getByRole("tab", { name: new RegExp(tab) });
          if (!(await t.count())) continue;
          await t.first().click();
          await p.waitForTimeout(600);
          await audit(p, `${tag} · ${tab.toLowerCase()}`);
        }
        await ctx.close();
      }
    }
    await setup.goto(`${B}/emc/pos/appearance?mode=local`);
    await setup.waitForTimeout(700);
    await setup.locator("button.card", { hasText: "Modern" }).first().click();
    await setup.getByRole("button", { name: "Save" }).first().click();
    await setup.waitForTimeout(500);
  }

  // ── Classic terminal and the back office, light and dark ──
  if (!only.length || only.includes("office")) {
    for (const scheme of ["light", "dark"]) {
      for (const [size, opts] of [["PC", { viewport: { width: 1366, height: 768 } }], ["phone", { ...devices["Pixel 7"] }]]) {
        const ctx = await browser.newContext({ ...opts, storageState: demo, colorScheme: scheme });
        ctx.setDefaultTimeout(8000);
        const p = await ctx.newPage();
        const tag = `back office ${scheme} · ${size}`;
        for (const [name, path] of [
          ["launchpad", "/emc/home"],
          ["dashboard", "/emc/dashboard"],
          ["finance overview", "/emc/finance"],
          ["accounting import", "/emc/finance/import"],
          ["bills & receipts", "/emc/finance/bills"],
          ["statements", "/emc/finance/statements"],
          ["stock", "/emc/inventory/stock"],
          ["goods receipts", "/emc/inventory/grn"],
          ["menu items", "/emc/menu/items"],
          ["bill designer", "/emc/pos/bill"],
          ["POS options", "/emc/pos/options"],
          ["app style", "/emc/pos/mobile"],
          ["workstations & phones", "/emc/setup/devices"],
          ["setup checklist", "/emc/setup/checklist"],
          ["reports", "/emc/reports"],
          ["audit center", "/emc/audit"],
          ["tasks", "/emc/tasks"],
          ["account", "/emc/account"],
          ["journals", "/emc/finance/journals"],
        ]) {
          await p.goto(`${B}${path}?mode=local`);
          await p.waitForTimeout(900);
          await audit(p, `${tag} · ${name}`);
        }
        if (size === "PC") {
          const t = await browser.newContext({ ...opts, storageState: demo, colorScheme: scheme });
          await t.addInitScript(() => localStorage.setItem("pos-suite.workstation", "W01"));
          const tp = await t.newPage();
          await tp.goto(`${B}/pos?mode=local`);
          await tp.waitForTimeout(900);
          await audit(tp, `classic terminal ${scheme} · sign-in`);
          await t.close();
        }
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`\n${failures ? `✗ ${failures} text colour(s) below WCAG AA` : "✓ every checked text meets WCAG AA contrast"} (${report.length} screens)`);
process.exit(failures ? 1 : 0);
