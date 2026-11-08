import { formatAmount } from "@pos/engine";

export const money = (cents: number | undefined) => `Rs ${formatAmount(Math.round(cents ?? 0))}`;
export const amount = (cents: number | undefined) => formatAmount(Math.round(cents ?? 0));
export const pct = (bp: number | undefined, digits = 1) => `${((bp ?? 0) / 100).toFixed(digits)}%`;
export const qty = (n: number, digits = 2) => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: digits }));

/** Rupees typed by a user → cents. */
export function toCents(text: string | number): number {
  const n = typeof text === "number" ? text : Number(String(text).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function colomboNow(): Date {
  return new Date();
}

export function todayColombo(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export function timeColombo(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(11, 16);
}

export function dateTimeColombo(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

export function minutesSince(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export function stockQty(n: number, unit: string): string {
  if (unit === "g" && Math.abs(n) >= 1000) return `${qty(n / 1000)} kg`;
  if (unit === "ml" && Math.abs(n) >= 1000) return `${qty(n / 1000)} l`;
  return `${qty(n)} ${unit}`;
}

export function downloadBuffer(buffer: ArrayBuffer | Uint8Array, filename: string, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): void {
  const blob = new Blob([buffer as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Whole rupees for dashboards and tiles: "Rs 125,400". */
export const moneyShort = (cents: number | undefined) => `Rs ${Math.round((cents ?? 0) / 100).toLocaleString("en-US")}`;
