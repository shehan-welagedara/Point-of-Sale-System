/**
 * Excel export/import, loaded only when someone exports or imports: the Excel library is large
 * (≈270 KB compressed) and the POS screens never need it.
 */
import type { FeederData, ImportResult, TableSheet } from "@pos/excel";

const lib = () => import("@pos/excel");

export async function tablesToWorkbook(sheets: TableSheet<any>[]): Promise<ArrayBuffer> {
  return (await lib()).tablesToWorkbook(sheets);
}
export async function buildFeederWorkbook(data: FeederData, opts: { title?: string } = {}): Promise<ArrayBuffer> {
  return (await lib()).buildFeederWorkbook(data, opts);
}
export async function parseFeederWorkbook(...args: Parameters<typeof import("@pos/excel").parseFeederWorkbook>): Promise<ImportResult> {
  return (await lib()).parseFeederWorkbook(...args);
}
export async function importOps(data: FeederData) {
  return (await lib()).importOps(data);
}
export type { ImportResult, TableSheet };
