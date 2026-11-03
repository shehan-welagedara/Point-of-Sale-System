import type { Cents } from "@pos/engine";
import type { BankStatementLine, LedgerEntry } from "./types.js";

/** Signed bank movement of a ledger line: money in = positive. */
export function bankAmount(e: LedgerEntry): Cents {
  return e.debit - e.credit;
}

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/**
 * Proposes statement-line ↔ ledger-line matches: same amount, value dates within `days`,
 * preferring a reference that appears in the voucher number or memo, then the closest date.
 */
export function suggestMatches(lines: readonly BankStatementLine[], entries: readonly LedgerEntry[], days = 3): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const line of [...lines].sort((a, b) => a.date.localeCompare(b.date))) {
    const candidates = entries
      .filter((e) => !used.has(e.id) && bankAmount(e) === line.amount && Math.abs(day(e.postingDate) - day(line.date)) <= days)
      .map((e) => {
        const ref = (line.reference ?? "").trim().toLowerCase();
        const refHit = ref.length >= 3 && `${e.voucherNo} ${e.memo ?? ""}`.toLowerCase().includes(ref);
        return { e, score: (refHit ? 0 : 100) + Math.abs(day(e.postingDate) - day(line.date)) };
      })
      .sort((a, b) => a.score - b.score);
    const best = candidates[0];
    if (best) {
      out.set(line.id, best.e.id);
      used.add(best.e.id);
    }
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function toIsoDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t); // day/month/year (Sri Lankan bank exports)
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

const money = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[, ]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Parses a bank statement CSV. Recognises a header with Date, Description/Narration, Reference,
 * and either Amount or separate Debit/Withdrawal and Credit/Deposit columns.
 */
export function parseStatementCsv(text: string): { lines: BankStatementLine[]; errors: string[] } {
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map(parseCsvLine);
  const header = (rows.shift() ?? []).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
  const iDate = col("date");
  const iDesc = col("description", "narration", "details", "particular");
  const iRef = col("reference", "ref", "cheque");
  const iAmt = col("amount");
  const iOut = col("debit", "withdrawal", "paid out");
  const iIn = col("credit", "deposit", "paid in");
  const errors: string[] = [];
  if (iDate < 0 || (iAmt < 0 && (iIn < 0 || iOut < 0))) return { lines: [], errors: ["Could not find Date and Amount (or Debit and Credit) columns"] };
  const lines: BankStatementLine[] = [];
  rows.forEach((r, i) => {
    const date = toIsoDate(r[iDate] ?? "");
    if (!date) {
      errors.push(`Row ${i + 2}: unreadable date "${r[iDate] ?? ""}"`);
      return;
    }
    const amount = iAmt >= 0 ? money(r[iAmt]) : money(r[iIn]) - money(r[iOut]);
    lines.push({ id: `L${String(i + 1).padStart(4, "0")}`, date, description: r[iDesc] ?? "", ...(iRef >= 0 && r[iRef] ? { reference: r[iRef] } : {}), amount });
  });
  return { lines, errors };
}
