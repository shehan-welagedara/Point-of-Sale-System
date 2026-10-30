/**
 * IRD tax invoice serial number (Gazette Extraordinary 2481/22): `YYMMM_QQQQ_XXXXX`
 *   YY   – 2-digit year           MMM – 3-letter month (JAN…DEC)
 *   QQQQ – classification code, 1–15 characters (we use a workstation/outlet code)
 *   XXXXX – sequential number, digits only
 * No spaces, at most 40 characters. The sequence may restart at a new month or year
 * (IRD Circular SEC/2026/E/03). Example: 26OCT_W01_1234.
 */
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"] as const;
const MAX_LENGTH = 40;
const CODE_PATTERN = /^[A-Z0-9]{1,15}$/;
const INVOICE_PATTERN = /^(\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)_([A-Z0-9]{1,15})_(\d+)$/;

export type SequenceReset = "never" | "monthly" | "yearly";

export interface InvoicePeriod {
  /** Full year, e.g. 2026. */
  year: number;
  /** 1–12. */
  month: number;
}

export interface InvoiceNumberParts extends InvoicePeriod {
  classificationCode: string;
  sequence: number;
}

export function isValidClassificationCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function formatInvoiceNumber(parts: InvoiceNumberParts): string {
  const { year, month, classificationCode, sequence } = parts;
  if (!Number.isInteger(year) || year < 2000 || year > 2099) throw new RangeError(`invalid year ${year}`);
  const mmm = MONTHS[month - 1];
  if (!mmm) throw new RangeError(`invalid month ${month}`);
  if (!isValidClassificationCode(classificationCode)) {
    throw new RangeError(`classification code must be 1–15 uppercase letters/digits, got "${classificationCode}"`);
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new RangeError(`invalid sequence ${sequence}`);
  const value = `${String(year % 100).padStart(2, "0")}${mmm}_${classificationCode}_${sequence}`;
  if (value.length > MAX_LENGTH) throw new RangeError(`invoice number exceeds ${MAX_LENGTH} characters`);
  return value;
}

export function parseInvoiceNumber(value: string): InvoiceNumberParts | null {
  if (value.length > MAX_LENGTH) return null;
  const m = INVOICE_PATTERN.exec(value);
  if (!m) return null;
  const [, yy, mmm, code, seq] = m as unknown as [string, string, (typeof MONTHS)[number], string, string];
  const sequence = Number(seq);
  if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
  return { year: 2000 + Number(yy), month: MONTHS.indexOf(mmm) + 1, classificationCode: code, sequence };
}

/** The sequence number to issue next, given the last one issued on this classification code. */
export function nextSequence(
  last: (InvoicePeriod & { sequence: number }) | null,
  now: InvoicePeriod,
  reset: SequenceReset,
): number {
  if (!last) return 1;
  const newPeriod =
    (reset === "monthly" && (last.year !== now.year || last.month !== now.month)) ||
    (reset === "yearly" && last.year !== now.year);
  return newPeriod ? 1 : last.sequence + 1;
}
