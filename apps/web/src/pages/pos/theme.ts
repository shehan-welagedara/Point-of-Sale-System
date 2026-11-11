import type { CSSProperties } from "react";
import type { PosTheme } from "@pos/core";
import { readableTextOn } from "../../lib/contrast";

type Colors = Required<PosTheme["colors"]>;

export interface Template {
  key: PosTheme["template"];
  name: string;
  description: string;
  defaults: Omit<PosTheme, "template" | "colors">;
  colors: Colors;
}

/** Three starting points; every value can be overridden per client. */
export const TEMPLATES: Record<PosTheme["template"], Template> = {
  classic: {
    key: "classic",
    name: "Classic",
    description: "Dense, high-contrast terminal layout in the style of enterprise hotel POS: category rail on the left, solid colour-coded keys, check on the left.",
    defaults: { fontScale: 1, buttonSize: "compact", radius: 4, checkSide: "left", categoryStyle: "rail", columns: 5, showImages: false, colorByCategory: true },
    colors: { brand: "#1f3a5f", accent: "#f59e0b", bg: "#dfe4ea", surface: "#ffffff", text: "#0b1220", muted: "#4b5563", line: "#c3cad4", button: "#2b4c7e", buttonText: "#ffffff", checkBg: "#fffdf6", danger: "#b91c1c" },
  },
  modern: {
    key: "modern",
    name: "Modern",
    description: "Light, airy touch layout with rounded keys, category tabs, optional photos, check on the right.",
    defaults: { fontScale: 1, buttonSize: "regular", radius: 14, checkSide: "right", categoryStyle: "tabs", columns: 0, showImages: true, colorByCategory: false },
    colors: { brand: "", accent: "#ff9f0a", bg: "#f5f5f7", surface: "#ffffff", text: "#1d1d1f", muted: "#5c5c61", line: "#e3e3e8", button: "#ffffff", buttonText: "#1d1d1f", checkBg: "#ffffff", danger: "#c8001a" },
  },
  midnight: {
    key: "midnight",
    name: "Midnight",
    description: "Dark theme for bars, lounges and evening service: large photo tiles, glowing accents, easy on the eyes in low light.",
    defaults: { fontScale: 1.05, buttonSize: "large", radius: 12, checkSide: "right", categoryStyle: "tabs", columns: 0, showImages: true, colorByCategory: false },
    colors: { brand: "#22d3ee", accent: "#f472b6", bg: "#0b0f17", surface: "#151b26", text: "#e6edf6", muted: "#a9b5c7", line: "#263042", button: "#1b2331", buttonText: "#e6edf6", checkBg: "#111722", danger: "#f87171" },
  },
};

export const DEFAULT_THEME: PosTheme = { template: "modern", colors: {}, ...TEMPLATES.modern.defaults };

/** A full theme from stored settings (missing values come from the template). */
export function resolveTheme(t: Partial<PosTheme> | undefined): PosTheme {
  const tpl = TEMPLATES[t?.template ?? "modern"] ?? TEMPLATES.modern;
  return { ...tpl.defaults, ...t, template: tpl.key, colors: { ...(t?.colors ?? {}) } };
}

/** Switching template resets layout to the template's defaults but keeps colour overrides out. */
export function applyTemplate(key: PosTheme["template"]): PosTheme {
  return { template: key, colors: {}, ...TEMPLATES[key].defaults };
}

const HEIGHT = { compact: 64, regular: 92, large: 118 } as const;

/**
 * Status colours (good, warning, error, information) and shadows for a light or a dark terminal.
 * The terminal sets every colour itself, so it looks the same whatever the device's light/dark setting.
 */
const STATUS = {
  light: { "--good": "#17703d", "--warn": "#955a00", "--info": "#0a64c9", "--good-bg": "#e7f6ed", "--warn-bg": "#fff4e0", "--bad-bg": "#fdecec", "--info-bg": "#e8f1fd", "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.05), 0 1px 1px rgba(0, 0, 0, 0.03)", "--shadow": "0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.05)" },
  dark: { "--good": "#4cc27a", "--warn": "#f0a840", "--info": "#5aa6ff", "--good-bg": "#12301f", "--warn-bg": "#33270f", "--bad-bg": "#3a1717", "--info-bg": "#10243d", "--shadow-sm": "0 1px 2px rgba(0, 0, 0, 0.4)", "--shadow": "0 4px 16px rgba(0, 0, 0, 0.4)" },
} as const;

/** CSS variables for the POS root: the global design tokens are re-pointed at the theme. */
export function themeStyle(theme: PosTheme, brandFallback: string): CSSProperties {
  const tpl = TEMPLATES[theme.template];
  const c = (k: keyof Colors) => theme.colors[k] || tpl.colors[k] || "";
  const brand = c("brand") || brandFallback;
  const dark = theme.template === "midnight" || isDark(c("bg"));
  const vars: Record<string, string | number> = {
    ...STATUS[dark ? "dark" : "light"],
    // The brand colour as text, nudged toward the text colour so any brand stays readable.
    "--brand-text": `color-mix(in srgb, ${brand} ${dark ? 60 : 80}%, ${c("text")})`,
    "--brand": brand,
    "--brand-soft": `color-mix(in srgb, ${brand} 14%, transparent)`,
    "--on-brand": readableTextOn(brand),
    "--accent": c("accent"),
    "--bg": c("bg"),
    "--surface": c("surface"),
    "--surface-2": `color-mix(in srgb, ${c("surface")} 92%, ${c("text")})`,
    "--sunken": `color-mix(in srgb, ${c("surface")} 85%, ${c("text")})`,
    "--text": c("text"),
    "--text-2": c("muted"),
    "--text-3": c("muted"),
    "--line": c("line"),
    "--line-strong": `color-mix(in srgb, ${c("line")} 70%, ${c("text")})`,
    "--bad": c("danger"),
    "--pos-btn": c("button"),
    "--pos-btn-text": c("buttonText"),
    "--pos-check-bg": c("checkBg"),
    "--pos-radius": `${theme.radius}px`,
    "--pos-scale": theme.fontScale,
    "--pos-item-h": `${HEIGHT[theme.buttonSize]}px`,
    color: c("text"),
    background: c("bg"),
    colorScheme: dark ? "dark" : "light",
  };
  return vars as CSSProperties;
}

function isDark(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
}

export function themeClass(theme: PosTheme): string {
  return [`pos`, `tpl-${theme.template}`, theme.checkSide === "left" ? "check-left" : "", theme.categoryStyle === "rail" ? "cat-rail" : "", theme.colorByCategory ? "by-cat" : "", `btn-${theme.buttonSize}`].filter(Boolean).join(" ");
}

export function gridColumns(theme: PosTheme): CSSProperties {
  return theme.columns > 0 ? { gridTemplateColumns: `repeat(${theme.columns}, minmax(0, 1fr))` } : {};
}
