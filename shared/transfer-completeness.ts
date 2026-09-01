/**
 * How completely a transfer was written up.
 *
 * The score is: of every field this transfer COULD have had filled in, what
 * share actually was. Not a curated subset — the whole form.
 *
 * Most of that form does not live in its own database column. The
 * qualification answers and the twenty lead-capture fields are composed into
 * conversation_notes as "Label: value" lines by composeLeadCaptureNotes, so
 * they are counted by reading those lines back. Labels are matched at the
 * START of a line: "Credit Score" is a substring of both "Exact Borrower
 * Credit Score" and "Co-Borrower Credit Score", so a plain includes() would
 * over-count it.
 *
 * Conditional fields only count where they apply — an LOA is expected only
 * when the loan officer has one. Measured on prod across 2,777 transfers,
 * scoring LOA against every transfer gives 43.1% while scoring it only where
 * it applies gives 84.1%; marking someone down for a field that was never
 * theirs to fill makes the number worthless.
 */

/**
 * Labels exactly as composeLeadCaptureNotes writes them. These are matched
 * against stored text, so they must track that function — a test asserts the
 * two lists agree, because a silent rename here would quietly zero a field.
 */
export const CAPTURE_LABELS = [
  "Owns Home",
  "Bankruptcy Last 6 Months",
  "Investment/2nd Home",
  "Borrower Email",
  "Borrower DOB",
  "Credit Score",
  "Exact Borrower Credit Score",
  "Co-Borrower Name",
  "Co-Borrower DOB",
  "Co-Borrower Credit Score",
  "Property Address",
  "Goal / Debts to Pay Off",
  "Cash Needed / Take Out",
  "Estimated Home Value",
  "First Mortgage Balance",
  "First Mortgage Rate",
  "Monthly PITI / Payment",
  "HELOC Balance",
  "HELOC Rate",
  "HELOC Monthly Payment",
  "Monthly Income",
  "W2/SE/Retired",
  "Military",
  // Section markers. Not fields — each one states that a whole section does not
  // apply, and takes that section out of what is expected. The colon is what
  // keeps them apart from the fields they cover: a line beginning "HELOC:"
  // cannot be "HELOC Balance:".
  "Co-Borrower",
  "First Mortgage",
  "HELOC",
] as const;

/**
 * Asked on the form, deliberately not counted.
 *
 * The section markers are here because they are conditions rather than fields:
 * scoring them would mark down every transfer that DOES have a co-borrower for
 * not saying it has none.
 */
export const UNSCORED_LABELS = new Set<string>([
  // Ethan, 1 Sep 2026: not part of what a transfer is judged on.
  "Borrower Email",
  // The band is what the LO prices against; the exact figure is a bonus.
  "Exact Borrower Credit Score",
  "Co-Borrower",
  "First Mortgage",
  "HELOC",
]);

/**
 * The qualification answers, weighted four times everything else.
 *
 * They decide whether the lead is workable at all. A write-up missing the
 * home-ownership answer is not one field of twenty-eight short, it is missing
 * the thing the LO
 * needs first, and an unweighted average said otherwise.
 */
export const QUAL_LABELS = ["Owns Home", "Bankruptcy Last 6 Months", "Investment/2nd Home"] as const;
export const QUAL_WEIGHT = 4;

/**
 * The one value each marker is allowed to carry.
 *
 * Matching the label alone was wrong: a free-text note reading
 * "First Mortgage: 320k at 6.5%" DESCRIBES a mortgage, and would have deleted
 * the whole first-mortgage section from the score for saying so. The Shotgun
 * result path stores a CLR's raw note straight into conversation_notes, so
 * that text really does reach this parser. Only what composeLeadCaptureNotes
 * writes counts, and anything else fails closed — the section stays expected.
 */
const MARKER_VALUES: Record<string, string> = {
  "Co-Borrower": "n/a",
  "First Mortgage": "free and clear",
  "HELOC": "n/a",
};

/** Which marker, if any, switches a field off. */
const COVERED_BY: Record<string, string> = {
  "Co-Borrower Name": "Co-Borrower",
  "Co-Borrower DOB": "Co-Borrower",
  "Co-Borrower Credit Score": "Co-Borrower",
  "First Mortgage Balance": "First Mortgage",
  "First Mortgage Rate": "First Mortgage",
  "Monthly PITI / Payment": "First Mortgage",
  "HELOC Balance": "HELOC",
  "HELOC Rate": "HELOC",
  "HELOC Monthly Payment": "HELOC",
};

export interface TransferRow {
  borrowerName?: string | null;
  phoneNumber?: string | null;
  leadSource?: string | null;
  /** The composed capture blob; the qualification and info answers live here. */
  conversationNotes?: string | null;
  /** Free-text "Other Notes". */
  notes?: string | null;
  loId?: number | null;
  loaId?: number | null;
  transferType?: string | null;
  /** True when this transfer's loan officer has an active assistant. */
  loHasLoa?: boolean;
}

const text = (v: unknown): boolean => String(v ?? "").trim().length > 0;

/** Which capture labels this blob actually answered, matched line by line. */
export function capturedLabels(blob: unknown): Set<string> {
  const found = new Set<string>();
  const lines = String(blob ?? "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    for (const label of CAPTURE_LABELS) {
      if (found.has(label)) continue;
      const prefix = `${label}:`;
      if (!line.startsWith(prefix)) continue;
      const value = line.slice(prefix.length).trim();
      if (!value) continue;
      // A marker states that a section does not apply. Any other value is
      // somebody describing the section, which is the opposite claim.
      const only = MARKER_VALUES[label];
      if (only && value.toLowerCase() !== only) continue;
      found.add(label);
    }
  }
  return found;
}

export interface CompletenessField {
  key: string;
  label: string;
  /** How many of everything else this one field is worth. */
  weight: number;
  expected: (row: TransferRow, captured: Set<string>) => boolean;
  filled: (row: TransferRow, captured: Set<string>) => boolean;
}

/** The fields stored in their own columns. */
const COLUMN_FIELDS: CompletenessField[] = [
  { key: "borrowerName", label: "Borrower name", weight: 1, expected: () => true, filled: (r) => text(r.borrowerName) },
  { key: "phoneNumber", label: "Phone number", weight: 1, expected: () => true, filled: (r) => text(r.phoneNumber) },
  { key: "leadSource", label: "Lead source", weight: 1, expected: () => true, filled: (r) => text(r.leadSource) },
  { key: "loId", label: "Loan officer", weight: 1, expected: () => true, filled: (r) => Number(r.loId ?? 0) > 0 },
  { key: "transferType", label: "Transfer type", weight: 1, expected: () => true, filled: (r) => text(r.transferType) },
  { key: "notes", label: "Other notes", weight: 1, expected: () => true, filled: (r) => text(r.notes) },
  // Only a fair ask when the loan officer actually has an assistant.
  { key: "loaId", label: "LOA", weight: 1, expected: (r) => !!r.loHasLoa, filled: (r) => Number(r.loaId ?? 0) > 0 },
];

const QUAL_SET = new Set<string>(QUAL_LABELS);

export const TRANSFER_COMPLETENESS_FIELDS: CompletenessField[] = [
  ...COLUMN_FIELDS,
  ...CAPTURE_LABELS.filter((label) => !UNSCORED_LABELS.has(label)).map((label) => ({
    key: `capture:${label}`,
    label,
    weight: QUAL_SET.has(label) ? QUAL_WEIGHT : 1,
    expected: (_r: TransferRow, captured: Set<string>) => {
      const marker = COVERED_BY[label];
      return !marker || !captured.has(marker);
    },
    filled: (_r: TransferRow, captured: Set<string>) => captured.has(label),
  })),
];

export interface TransferScore {
  filled: number;
  expected: number;
  missing: string[];
}

export function scoreTransfer(row: TransferRow): TransferScore {
  const captured = capturedLabels(row.conversationNotes);
  let filled = 0;
  let expected = 0;
  const missing: string[] = [];
  for (const f of TRANSFER_COMPLETENESS_FIELDS) {
    if (!f.expected(row, captured)) continue;
    expected += f.weight;
    if (f.filled(row, captured)) filled += f.weight;
    else missing.push(f.key);
  }
  return { filled, expected, missing };
}

export interface CompletenessSummary {
  /** 0-100, or null when there is nothing to score. */
  pct: number | null;
  transfers: number;
  filled: number;
  expected: number;
  byField: Array<{ key: string; label: string; weight: number; filled: number; expected: number; pct: number | null }>;
  /** Transfers with every expected field present. */
  complete: number;
}

export function summarizeCompleteness(rows: TransferRow[]): CompletenessSummary {
  // byField counts TRANSFERS, unweighted — "how often did anyone fill this in"
  // is a different question from "how much did it move the score", and mixing
  // them would make a 4x field look four times as common as it is.
  const byField = TRANSFER_COMPLETENESS_FIELDS.map((f) => ({
    key: f.key, label: f.label, weight: f.weight, filled: 0, expected: 0, pct: null as number | null,
  }));
  let filled = 0;
  let expected = 0;
  let complete = 0;

  for (const row of rows) {
    const captured = capturedLabels(row.conversationNotes);
    let rowExpected = 0;
    let rowMissing = 0;
    for (let i = 0; i < TRANSFER_COMPLETENESS_FIELDS.length; i += 1) {
      const f = TRANSFER_COMPLETENESS_FIELDS[i];
      if (!f.expected(row, captured)) continue;
      byField[i].expected += 1;
      rowExpected += f.weight;
      if (f.filled(row, captured)) { byField[i].filled += 1; filled += f.weight; }
      else rowMissing += 1;
    }
    expected += rowExpected;
    if (rowExpected > 0 && rowMissing === 0) complete += 1;
  }

  for (const f of byField) f.pct = f.expected > 0 ? Math.round((f.filled / f.expected) * 100) : null;

  return {
    pct: expected > 0 ? Math.round((filled / expected) * 100) : null,
    transfers: rows.length,
    filled,
    expected,
    byField,
    complete,
  };
}
