/** WCAG relative luminance of a #rgb / #rrggbb colour (null if it isn't one). */
export function luminance(hex: string | undefined): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  const n = parseInt(h, 16);
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}

/**
 * White or near-black text, whichever reads better on this background (a brand colour, a category
 * colour). Keeps buttons and tiles readable whatever colour a restaurant chooses.
 */
export function readableTextOn(bg: string | undefined, light = "#ffffff", dark = "#111827"): string {
  const l = luminance(bg);
  if (l === null) return light;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / ((luminance(dark) ?? 0) + 0.05);
  return onWhite >= onDark ? light : dark;
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");

/** Contrast ratio between two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a) ?? 0, luminance(b) ?? 0].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/**
 * The colour itself when white text on it (and it as text on white) is readable (4.5:1), otherwise the
 * same hue deepened just enough. Used for a restaurant's own brand or accent colour.
 */
export function deepenForWhite(hex: string | undefined, min = 4.5): string | undefined {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return hex;
  const h = m[1]!.length === 3 ? m[1]!.replace(/./g, (c) => c + c) : m[1]!;
  const n = parseInt(h, 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  for (let k = 0; k <= 20; k++) {
    const f = 1 - k * 0.05;
    const c = `#${rgb.map((v) => hex2(v * f)).join("")}`;
    if (contrastRatio(c, "#ffffff") >= min) return c;
  }
  return "#000000";
}
