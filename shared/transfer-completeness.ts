/**
 * How completely a transfer was written up.
 *
 * Scored per transfer as "fields filled / fields that were actually expected",
 * then averaged. The conditional part matters: an LOA is only expected when the
 * loan officer has one. Measured on prod over 2,777 transfers since 2026-06-01,
 * scoring LOA against every transfer gives 43.1%, while scoring it only where
 * it applies gives 84.1% — nearly double. A statistic that marks people down
 * for a field that does not apply to them is one nobody will trust.
 *
 * Fields deliberately NOT counted, with the rates that decided it:
 *   transferType   100.0% — the form defaults it, so it carries no signal
 *   loId            99.9% — the server already refuses a transfer without one
 *   notes           17.3% — "Other Notes" is genuinely optional
 *   leadTimeframe    0.0% — no longer asked for on the form
 *   loActionPlan     0.2% — same
 * Counting dead fields would put a ceiling on the score that no effort could
 * lift, which is the fastest way to make a number meaningless.
 */

export interface TransferRow {
  borrowerName?: string | null;
  phoneNumber?: string | null;
  leadSource?: string | null;
  conversationNotes?: string | null;
  loaId?: number | null;
  /** True when this transfer's loan officer has an active assistant. */
  loHasLoa?: boolean;
}

export interface CompletenessField {
  key: string;
  label: string;
  /** Whether this field was expected for this particular transfer. */
  expected: (row: TransferRow) => boolean;
  filled: (row: TransferRow) => boolean;
}

const text = (v: unknown): boolean => String(v ?? "").trim().length > 0;

export const TRANSFER_COMPLETENESS_FIELDS: CompletenessField[] = [
  { key: "borrowerName", label: "Borrower name", expected: () => true, filled: (r) => text(r.borrowerName) },
  { key: "phoneNumber", label: "Phone number", expected: () => true, filled: (r) => text(r.phoneNumber) },
  { key: "leadSource", label: "Lead source", expected: () => true, filled: (r) => text(r.leadSource) },
  { key: "conversationNotes", label: "Call summary", expected: () => true, filled: (r) => text(r.conversationNotes) },
  {
    key: "loaId",
    label: "LOA",
    // Only a fair ask when the loan officer actually has an assistant.
    expected: (r) => !!r.loHasLoa,
    filled: (r) => Number(r.loaId ?? 0) > 0,
  },
];

export interface TransferScore {
  filled: number;
  expected: number;
  missing: string[];
}

export function scoreTransfer(row: TransferRow): TransferScore {
  let filled = 0;
  let expected = 0;
  const missing: string[] = [];
  for (const f of TRANSFER_COMPLETENESS_FIELDS) {
    if (!f.expected(row)) continue;
    expected += 1;
    if (f.filled(row)) filled += 1;
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
  /** Per field: how often it was filled when it was expected. */
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
    for (let i = 0; i < TRANSFER_COMPLETENESS_FIELDS.length; i += 1) {
      const f = TRANSFER_COMPLETENESS_FIELDS[i];
      if (!f.expected(row)) continue;
      byField[i].expected += 1;
      if (f.filled(row)) byField[i].filled += 1;
    }
    const s = scoreTransfer(row);
    filled += s.filled;
    expected += s.expected;
    if (s.expected > 0 && s.missing.length === 0) complete += 1;
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
