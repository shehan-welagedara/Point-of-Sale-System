/** Sri Lanka Standard Time is UTC+05:30 all year (no daylight saving). */
export const SRI_LANKA_UTC_OFFSET_MINUTES = 330;

export interface BusinessDayOptions {
  /** Local hour (0–23) at which the business day rolls over, e.g. 4 → sales until 03:59 belong to the previous day. */
  rolloverHour: number;
  utcOffsetMinutes?: number;
}

/** Business date (YYYY-MM-DD) of a moment in time. */
export function businessDate(at: Date, options: BusinessDayOptions): string {
  const { rolloverHour, utcOffsetMinutes = SRI_LANKA_UTC_OFFSET_MINUTES } = options;
  if (!Number.isInteger(rolloverHour) || rolloverHour < 0 || rolloverHour > 23) {
    throw new RangeError(`invalid rollover hour ${rolloverHour}`);
  }
  const shifted = new Date(at.getTime() + (utcOffsetMinutes - rolloverHour * 60) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Local calendar year/month of a moment (used for invoice numbers). */
export function localPeriod(at: Date, utcOffsetMinutes = SRI_LANKA_UTC_OFFSET_MINUTES): { year: number; month: number } {
  const local = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1 };
}
