import ExcelJS from "exceljs";
import { PRODUCT_FULL_NAME } from "@pos/core";

export interface TableColumn<T> {
  header: string;
  width?: number;
  /** "money" values are cents and are written as rupees with 2 decimals; "percentBp" are basis points. */
  format?: "text" | "number" | "money" | "percentBp";
  value: (row: T) => string | number | undefined;
}

export interface TableSheet<T = unknown> {
  name: string;
  title?: string;
  columns: TableColumn<T>[];
  rows: T[];
  /** Adds a totals row summing money/number columns. */
  totals?: boolean;
}

/** Report/journal export: one formatted sheet per table, money as real numbers so Excel can sum them. */
export async function tablesToWorkbook(sheets: TableSheet<any>[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = PRODUCT_FULL_NAME;
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31));
    let start = 1;
    if (sheet.title) {
      ws.getCell(1, 1).value = sheet.title;
      ws.getCell(1, 1).font = { bold: true, size: 14 };
      start = 3;
    }
    const header = ws.getRow(start);
    sheet.columns.forEach((c, i) => {
      header.getCell(i + 1).value = c.header;
      ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 2);
    });
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F766E" } };
    sheet.rows.forEach((r, ri) => {
      const row = ws.getRow(start + 1 + ri);
      sheet.columns.forEach((c, ci) => {
        const v = c.value(r);
        const cell = row.getCell(ci + 1);
        if (c.format === "money" && typeof v === "number") {
          cell.value = v / 100;
          cell.numFmt = "#,##0.00";
        } else if (c.format === "percentBp" && typeof v === "number") {
          cell.value = v / 10_000;
          cell.numFmt = "0.0%";
        } else cell.value = v ?? "";
      });
    });
    if (sheet.totals && sheet.rows.length) {
      const row = ws.getRow(start + 1 + sheet.rows.length);
      row.getCell(1).value = "Total";
      row.font = { bold: true };
      sheet.columns.forEach((c, ci) => {
        if (ci === 0 || (c.format !== "money" && c.format !== "number")) return;
        const col = ws.getColumn(ci + 1).letter;
        const cell = row.getCell(ci + 1);
        const values = sheet.rows.map((r) => Number(c.value(r) ?? 0));
        const sum = values.reduce((a, b) => a + b, 0);
        cell.value = { formula: `SUM(${col}${start + 1}:${col}${start + sheet.rows.length})`, result: c.format === "money" ? sum / 100 : sum };
        if (c.format === "money") cell.numFmt = "#,##0.00";
      });
    }
    ws.views = [{ state: "frozen", ySplit: start }];
  }
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
