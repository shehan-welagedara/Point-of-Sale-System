import { useEffect, useRef, useState } from "react";

/** This screen's version (set at build time from apps/web/package.json). */
export const APP_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0-dev";
export const APP_COMMIT = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "dev";
export const APP_BUILT_AT = typeof __APP_BUILT_AT__ === "string" ? __APP_BUILT_AT__ : "";
/** Release notes for clients of the latest versions (from CHANGELOG.md at build time). */
export const RELEASE_NOTES: { version: string; date: string; type: string; notes: string[] }[] = typeof __APP_RELEASE_NOTES__ === "object" ? __APP_RELEASE_NOTES__ : [];

export interface LiveVersion {
  version: string;
  minSupportedVersion: string;
  commit?: string;
  builtAt?: string;
}

/** Compares dotted versions numerically (1.10.0 > 1.9.3). Pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split("-")[0]!.split(".").map((n) => Number(n) || 0);
  const pb = b.split("-")[0]!.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export type UpdateState = { status: "current" | "unknown" } | { status: "available" | "required"; live: LiveVersion };

export async function fetchLiveVersion(): Promise<LiveVersion | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const v = (await res.json()) as LiveVersion;
    return v.version ? v : null;
  } catch {
    return null;
  }
}

export function updateStateFor(live: LiveVersion | null, current = APP_VERSION): UpdateState {
  if (!live) return { status: "unknown" };
  if (compareVersions(current, live.minSupportedVersion) < 0) return { status: "required", live };
  if (compareVersions(live.version, current) > 0) return { status: "available", live };
  return { status: "current" };
}

/**
 * Watches for a newer release: every few minutes, when the screen comes back into view, and when
 * the connection returns. Nothing happens in development (no version.json).
 */
export function useUpdateCheck(everyMs = 5 * 60_000): UpdateState {
  const [state, setState] = useState<UpdateState>({ status: "unknown" });
  const busy = useRef(false);
  useEffect(() => {
    const check = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        setState(updateStateFor(await fetchLiveVersion()));
      } finally {
        busy.current = false;
      }
    };
    void check();
    const t = setInterval(() => void check(), everyMs);
    const onVisible = () => document.visibilityState === "visible" && void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [everyMs]);
  return state;
}

/** Screens that must not reload by themselves (an employee is signed in, a form is open). */
const busyReasons = new Set<string>();
export function setBusy(reason: string, on: boolean): void {
  if (on) busyReasons.add(reason);
  else busyReasons.delete(reason);
}
export const isBusy = () => busyReasons.size > 0;
