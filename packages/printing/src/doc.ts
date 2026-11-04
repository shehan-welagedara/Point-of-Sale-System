/**
 * Printer-independent receipt document. The same document renders to ESC/POS bytes (thermal
 * printers via the Print Agent / POS Shell) and to text (on-screen preview, tests).
 */
export type Align = "left" | "center" | "right";

export type Block =
  | { t: "text"; text: string; align?: Align; bold?: boolean; size?: 1 | 2; invert?: boolean }
  | { t: "pair"; left: string; right: string; bold?: boolean; size?: 1 | 2 }
  | { t: "rule"; char?: "-" | "=" }
  | { t: "feed"; lines: number }
  | { t: "qr"; data: string; caption?: string }
  /** Logo stored in the printer's NV memory (Epson "NV graphics" key 1, loaded once with the printer utility). */
  | { t: "nvLogo" }
  | { t: "cut" }
  | { t: "drawer" };

export interface ReceiptDoc {
  /** Characters per line in normal size: 48 for 80 mm, 32 for 58 mm printers (Font A). */
  width: number;
  blocks: Block[];
}

export function widthForPaper(paperWidthMm: 80 | 58): number {
  return paperWidthMm === 58 ? 32 : 48;
}

/** Word-wraps text to a column width (long words are hard-split). */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (para.length <= width) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > width) {
        if (line) {
          out.push(line);
          line = "";
        }
        out.push(w.slice(0, width));
        w = w.slice(width);
      }
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

export function pad(text: string, width: number, align: Align): string {
  const t = text.slice(0, width);
  const space = width - t.length;
  if (align === "right") return " ".repeat(space) + t;
  if (align === "center") return " ".repeat(Math.floor(space / 2)) + t + " ".repeat(Math.ceil(space / 2));
  return t + " ".repeat(space);
}

/** Left text and right-aligned amount on one line; the left side wraps if needed. */
export function pairLines(left: string, right: string, width: number): string[] {
  const room = width - right.length - 1;
  if (room < 4) return [...wrap(left, width), pad(right, width, "right")];
  const lines = wrap(left, room);
  const last = lines.pop() ?? "";
  return [...lines, pad(last, room, "left") + " " + right];
}

/** Plain-text rendering (double-size text uses half the columns, like the printer does). */
export function toText(doc: ReceiptDoc): string {
  const out: string[] = [];
  for (const b of doc.blocks) {
    const w = "size" in b && b.size === 2 ? Math.floor(doc.width / 2) : doc.width;
    switch (b.t) {
      case "text":
        for (const l of wrap(b.text, w)) out.push(pad(l, w, b.align ?? "left").trimEnd());
        break;
      case "pair":
        out.push(...pairLines(b.left, b.right, w));
        break;
      case "rule":
        out.push((b.char ?? "-").repeat(doc.width));
        break;
      case "feed":
        for (let i = 0; i < b.lines; i++) out.push("");
        break;
      case "qr":
        out.push(pad("[QR]", doc.width, "center").trimEnd());
        if (b.caption) out.push(pad(b.caption, doc.width, "center").trimEnd());
        break;
      case "nvLogo":
        out.push(pad("[LOGO]", doc.width, "center").trimEnd());
        break;
      case "cut":
        out.push("✂" + "-".repeat(doc.width - 1));
        break;
      case "drawer":
        break;
    }
  }
  return out.join("\n");
}
