/**
 * Builds print-ready A4 PDFs of the user manual and the training manuals, to hand to a client:
 *
 *   pnpm manual:pdf
 *   pnpm manual:pdf -- --client "Kandy Myst Restaurant"
 *
 * Output: manual-pdf/*.pdf (git-ignored). Screenshots come from docs/manual/img
 * (refresh them with `pnpm manual:screenshots`).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked } from "marked";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manual = join(root, "docs/manual");
const out = join(root, "manual-pdf");
const tmp = join(out, ".html");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const client = flag("client");
const product = flag("product") ?? "Restaurant POS & Back Office";
const issued = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });

const docs = [
  { file: join(manual, "user-manual.md"), name: "User-Manual", kind: "User manual" },
  { file: join(manual, "configuration-guide.md"), name: "Configuration-Guide", kind: "Configuration guide" },
  ...readdirSync(join(manual, "training"))
    .filter((f) => /^\d\d-.*\.md$/.test(f))
    .sort()
    .map((f) => ({ file: join(manual, "training", f), name: `Training-${basename(f, ".md").replace(/^(\d\d)-/, "$1-").replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase())}`, kind: "Training manual" })),
];

/** GitHub-style heading ids, so the contents links work inside the PDF. */
const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");

function toHtml(md) {
  let html = marked.parse(md, { gfm: true });
  html = html.replace(/<h([1-4])>(.*?)<\/h\1>/g, (_, n, inner) => `<h${n} id="${slug(inner)}">${inner}</h${n}>`);
  // Links to other manuals become plain references (each manual is its own PDF).
  html = html.replace(/<a href="(?!#|https?:)[^"]*">(.*?)<\/a>/g, '<span class="xref">$1</span>');
  return html;
}

const CSS = `
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Inter", "Segoe UI", Roboto, "Noto Sans Sinhala", sans-serif; color: #1f2937; }
h1 { font-size: 22pt; margin: 0 0 6pt; color: #0f172a; }
h2 { font-size: 16pt; margin: 0 0 8pt; padding-bottom: 4pt; border-bottom: 2px solid #1a73e8; color: #0f172a; break-before: page; break-after: avoid; }
h3 { font-size: 12.5pt; margin: 14pt 0 4pt; color: #0f172a; break-after: avoid; }
h4 { font-size: 11pt; margin: 10pt 0 4pt; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #1a73e8; text-decoration: none; }
.xref { font-weight: 600; }
code { font: 9.5pt ui-monospace, Consolas, monospace; background: #f1f5f9; padding: 0 3px; border-radius: 3px; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 9.5pt; }
th, td { border: 1px solid #e2e8f0; padding: 4pt 6pt; text-align: left; vertical-align: top; }
th { background: #f1f5f9; }
tr { break-inside: avoid; }
img { max-width: 100%; max-height: 120mm; display: block; margin: 6pt auto 10pt; border: 1px solid #e2e8f0; border-radius: 6px; break-inside: avoid; }
img[src*="app-"] { max-height: 105mm; border-radius: 14px; }
td img, td img[src*="app-"] { max-height: 70mm; margin: 2pt auto; }
blockquote { margin: 8pt 0; padding: 6pt 10pt; background: #eff6ff; border-left: 4px solid #1a73e8; border-radius: 4px; }
hr { display: none; }
li > input[type=checkbox] { margin-right: 6px; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; break-after: page; }
.cover .band { height: 10mm; background: linear-gradient(90deg, #1a73e8, #7c3aed); border-radius: 4px; margin-bottom: 24mm; }
.cover .kind { font-size: 12pt; letter-spacing: 2px; text-transform: uppercase; color: #64748b; }
.cover .title { font-size: 30pt; font-weight: 800; color: #0f172a; margin: 4mm 0; line-height: 1.15; }
.cover .product { font-size: 14pt; color: #334155; }
.cover .for { margin-top: 24mm; font-size: 13pt; }
.cover .for strong { font-size: 16pt; color: #0f172a; }
.cover .meta { margin-top: auto; color: #64748b; font-size: 10pt; }
.doc > h1:first-child { display: none; }
.doc > h2:first-of-type { break-before: auto; }
body.training h2 { break-before: auto; margin-top: 18pt; }
`;

mkdirSync(tmp, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const d of docs) {
    const md = readFileSync(d.file, "utf8");
    const title = (md.match(/^# (.+)$/m)?.[1] ?? d.name).replace(/^Training: /, "");
    const body = toHtml(md);
    const html = `<!doctype html><html><head><meta charset="utf-8"><base href="${pathToFileURL(dirname(d.file)).href}/"><style>${CSS}</style></head><body class="${d.kind === "Training manual" ? "training" : "manual"}">
<section class="cover">
  <div class="band"></div>
  <div class="kind">${d.kind}</div>
  <div class="title">${title}</div>
  <div class="product">${product}</div>
  ${client ? `<div class="for">Prepared for<br><strong>${client.replace(/</g, "&lt;")}</strong></div>` : `<div class="for">Prepared for: ______________________________</div>`}
  <div class="meta">Issued ${issued}. The screens shown are from the demo restaurant; your system shows your own name, menu and prices.</div>
</section>
<main class="doc">${body}</main></body></html>`;
    const htmlFile = join(tmp, `${d.name}.html`);
    writeFileSync(htmlFile, html);
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    const pdf = join(out, `${d.name}.pdf`);
    await page.pdf({
      path: pdf,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font: 8pt sans-serif; color: #94a3b8; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>${title.replace(/</g, "&lt;")}${client ? ` · ${client.replace(/</g, "&lt;")}` : ""}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      margin: { top: "18mm", bottom: "20mm", left: "16mm", right: "16mm" },
    });
    console.log(`  ${basename(pdf)}`);
  }
} finally {
  await browser.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`PDFs written to ${out}`);
