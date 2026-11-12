/**
 * Makes the PNG app icons for phones' home screens from apps/web/public/favicon.svg:
 * apple-touch-icon.png (180), icon-192.png, icon-512.png and icon-maskable-512.png (full-bleed, the
 * mark inside Android's safe zone).  Run after changing the icon:  node tools/web/make-app-icons.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pub = join(root, "apps/web/public");
const { chromium } = createRequire(import.meta.url)("playwright");
const svg = readFileSync(join(pub, "favicon.svg"), "utf8");
// Maskable: square background, the mark scaled to 70% in the middle (Android crops to a circle or squircle).
const inner = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<rect[^>]*\/>/, "");
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0F766E"/><g transform="translate(9.6 9.6) scale(0.7)">${inner}</g></svg>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, size, source, bg] of [
    ["apple-touch-icon.png", 180, maskable, "#0F766E"],
    ["icon-192.png", 192, svg, "transparent"],
    ["icon-512.png", 512, svg, "transparent"],
    ["icon-maskable-512.png", 512, maskable, "#0F766E"],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:${bg}">${source.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: join(pub, file), omitBackground: bg === "transparent" });
    console.log(`  ${file} (${size} × ${size})`);
  }
} finally {
  await browser.close();
}
