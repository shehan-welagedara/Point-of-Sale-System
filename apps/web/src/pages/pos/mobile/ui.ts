import { useEffect, useState } from "react";
import type { MobileStyle, MobileUi, Workstation } from "@pos/core";
import { deepenForWhite } from "../../../lib/contrast";

/** New businesses: the app style on every screen (phones, tablets and PCs, each with its own layout). */
export const DEFAULT_MOBILE_UI: MobileUi = { style: "bright", useOn: "all", showSalesOnHome: true };

export const MOBILE_STYLES: Record<MobileStyle, { name: string; description: string; swatch: string[] }> = {
  bright: { name: "Bright", description: "Light and airy: white cards, blue highlights, photo menu. Easy to read in daylight.", swatch: ["#f4f5fb", "#ffffff", "#1a73e8", "#1e8e3e"] },
  indigo: { name: "Indigo", description: "Premium look: navy and purple gradients, bold totals. Suits evening service and lounges.", swatch: ["#f3f4fa", "#1e1b4b", "#4f46e5", "#7c3aed"] },
};

export type UiStyle = "terminal" | MobileStyle;

export interface Viewport {
  w: number;
  h: number;
  coarse: boolean;
}

function readViewport(): Viewport {
  return { w: window.innerWidth, h: window.innerHeight, coarse: typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches };
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    const on = () => setVp(readViewport());
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return vp;
}

export const isPhone = (vp: Viewport) => vp.w < 600 || Math.min(vp.w, vp.h) < 480;
export const isTablet = (vp: Viewport) => !isPhone(vp) && vp.coarse && Math.min(vp.w, vp.h) < 1100;

/**
 * Which screen style this device shows: the workstation's own choice, else the business setting
 * applied to phones, phones and tablets, or every screen.
 */
export function resolveUiStyle(saved: MobileUi | undefined, ws: Pick<Workstation, "uiStyle"> | undefined, vp: Viewport): UiStyle {
  if (ws?.uiStyle && ws.uiStyle !== "default") return ws.uiStyle;
  const cfg = { ...DEFAULT_MOBILE_UI, ...saved };
  if (cfg.style === "terminal") return "terminal";
  if (cfg.useOn === "all" || isPhone(vp) || (cfg.useOn === "phonesTablets" && isTablet(vp))) return cfg.style;
  return "terminal";
}

export function useUiStyle(saved: MobileUi | undefined, ws?: Pick<Workstation, "uiStyle">): UiStyle {
  return resolveUiStyle(saved, ws, useViewport());
}

/** CSS variables for the accent colour override. */
export function mobileVars(saved: MobileUi | undefined): Record<string, string> {
  // A light accent is deepened just enough for white text on it and for it as text on white.
  const accent = deepenForWhite(saved?.accent, 5.5);
  return accent ? { "--m-accent": accent, "--m-accent-2": accent } : {};
}

export function greeting(now = new Date()): string {
  const h = (now.getUTCHours() + 5 + Math.floor((now.getUTCMinutes() + 30) / 60)) % 24;
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
