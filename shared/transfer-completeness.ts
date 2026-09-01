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
] as const;

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
      if (line.startsWith(prefix) && line.slice(prefix.length).trim().length > 0) {
        found.add(label);
      }
    }
  }
  return found;
}

export interface CompletenessField {
  key: string;
  label: string;
  expected: (row: TransferRow) => boolean;
  filled: (row: TransferRow, captured: Set<string>) => boolean;
}

/** The fields stored in their own columns. */
const COLUMN_FIELDS: CompletenessField[] = [
  { key: "borrowerName", label: "Borrower name", expected: () => true, filled: (r) => text(r.borrowerName) },
  { key: "phoneNumber", label: "Phone number", expected: () => true, filled: (r) => text(r.phoneNumber) },
  { key: "leadSource", label: "Lead source", expected: () => true, filled: (r) => text(r.leadSource) },
  { key: "loId", label: "Loan officer", expected: () => true, filled: (r) => Number(r.loId ?? 0) > 0 },
  { key: "transferType", label: "Transfer type", expected: () => true, filled: (r) => text(r.transferType) },
  { key: "notes", label: "Other notes", expected: () => true, filled: (r) => text(r.notes) },
  // Only a fair ask when the loan officer actually has an assistant.
  { key: "loaId", label: "LOA", expected: (r) => !!r.loHasLoa, filled: (r) => Number(r.loaId ?? 0) > 0 },
];

export const TRANSFER_COMPLETENESS_FIELDS: CompletenessField[] = [
  ...COLUMN_FIELDS,
  ...CAPTURE_LABELS.map((label) => ({
    key: `capture:${label}`,
    label,
    expected: () => true,
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
    if (!f.expected(row)) continue;
    expected += 1;
    if (f.filled(row, captured)) filled += 1;
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
  byField: Array<{ key: string; label: string; filled: number; expected: number; pct: number | null }>;
  /** Transfers with every expected field present. */
  complete: number;
}

export function summarizeCompleteness(rows: TransferRow[]): CompletenessSummary {
  const byField = TRANSFER_COMPLETENESS_FIELDS.map((f) => ({
    key: f.key, label: f.label, filled: 0, expected: 0, pct: null as number | null,
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
      if (!f.expected(row)) continue;
      byField[i].expected += 1;
      rowExpected += 1;
      if (f.filled(row, captured)) { byField[i].filled += 1; filled += 1; }
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
