import { type ReceiptDoc, pad, pairLines, wrap } from "./doc.js";

const ESC = 0x1b;
const GS = 0x1d;
const FS = 0x1c;
const LF = 0x0a;

/**
 * Printers' built-in code pages have no Sinhala/Tamil glyphs; until those are rasterised, map
 * common typographic characters to ASCII and replace the rest.
 */
function toAscii(text: string): number[] {
  const map: Record<string, string> = { "–": "-", "—": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "×": "x", "…": "...", "₨": "Rs", "•": "*", "✂": "-" };
  const out: number[] = [];
  for (const ch of text) {
    const m = map[ch] ?? ch;
    for (const c of m) {
      const code = c.charCodeAt(0);
      out.push(code >= 0x20 && code < 0x7f ? code : 0x3f);
    }
  }
  return out;
}

function qr(data: string): number[] {
  const bytes = toAscii(data);
  const len = bytes.length + 3;
  return [
    GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00, // model 2
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 0x06, // module size 6
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31, // error correction M
    GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...bytes, // store
    GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, // print
  ];
}

/** ESC/POS bytes for Epson-compatible thermal printers (Epson TM series, Xprinter, Rongta, Sewoo…). */
export function toEscPos(doc: ReceiptDoc): Uint8Array {
  const out: number[] = [ESC, 0x40]; // initialise
  const align = (a: "left" | "center" | "right") => out.push(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  const style = (bold: boolean, size: 1 | 2, invert = false) => {
    out.push(ESC, 0x45, bold ? 1 : 0);
    out.push(GS, 0x21, size === 2 ? 0x11 : 0x00);
    out.push(GS, 0x42, invert ? 1 : 0);
  };
  const line = (text: string) => out.push(...toAscii(text), LF);

  for (const b of doc.blocks) {
    switch (b.t) {
      case "text": {
        const size = b.size ?? 1;
        const w = size === 2 ? Math.floor(doc.width / 2) : doc.width;
        align("left");
        style(Boolean(b.bold), size, Boolean(b.invert));
        for (const l of wrap(b.text, w)) line(pad(l, w, b.align ?? "left").trimEnd());
        style(false, 1);
        break;
      }
      case "pair": {
        const size = b.size ?? 1;
        const w = size === 2 ? Math.floor(doc.width / 2) : doc.width;
        align("left");
        style(Boolean(b.bold), size);
        for (const l of pairLines(b.left, b.right, w)) line(l);
        style(false, 1);
        break;
      }
      case "rule":
        align("left");
        line((b.char ?? "-").repeat(doc.width));
        break;
      case "feed":
        for (let i = 0; i < b.lines; i++) out.push(LF);
        break;
      case "qr":
        align("center");
        out.push(...qr(b.data));
        out.push(LF);
        if (b.caption) line(b.caption);
        align("left");
        break;
      case "nvLogo":
        align("center");
        out.push(FS, 0x70, 0x01, 0x00);
        out.push(LF);
        align("left");
        break;
      case "cut":
        out.push(LF, LF, LF, GS, 0x56, 0x42, 0x00); // feed and partial cut
        break;
      case "drawer":
        out.push(ESC, 0x70, 0x00, 0x19, 0xfa); // pulse pin 2 (RJ11 drawer port)
        break;
    }
  }
  return Uint8Array.from(out);
}
