import { APP_VERSION } from "./version";

/** Where error reports go: set by the app once a business and login are known. */
type Sink = (report: ClientErrorReport) => Promise<void>;
let sink: Sink | null = null;
let sent = 0;
const seen = new Set<string>();

export interface ClientErrorReport {
  id: string;
  uid: string;
  message: string;
  stack?: string;
  path: string;
  appVersion: string;
  userAgent: string;
  workstationId?: string;
  at: string;
}

export function setErrorSink(s: Sink | null): void {
  sink = s;
}

/** Records an unexpected error for support (at most 20 distinct errors per session). */
export function reportError(error: unknown, context: { workstationId?: string } = {}): void {
  const e = error instanceof Error ? error : new Error(String(error));
  const key = `${e.message}|${(e.stack ?? "").split("\n")[1] ?? ""}`;
  if (seen.has(key) || sent >= 20) return;
  seen.add(key);
  sent++;
  console.error(e);
  if (!sink) return;
  const report: ClientErrorReport = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    uid: "",
    message: e.message.slice(0, 2000),
    stack: (e.stack ?? "").slice(0, 8000),
    path: location.pathname,
    appVersion: APP_VERSION,
    userAgent: navigator.userAgent.slice(0, 200),
    ...(context.workstationId ? { workstationId: context.workstationId } : {}),
    at: new Date().toISOString(),
  };
  void sink(report).catch(() => undefined);
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener("unhandledrejection", (ev) => reportError(ev.reason));
}
