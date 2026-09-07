import {
  CAPTURE_LABELS, UNSCORED_LABELS, QUAL_LABELS,
  TRANSFER_COMPLETENESS_FIELDS, capturedLabels, scoreTransfer,
  type TransferRow,
} from "./transfer-completeness";

/**
 * Everything a CLR actually wrote on one transfer, laid out to be read.
 *
 * C3 has been able to say that somebody's write-ups score 76% since the
 * completeness work, and has never once been able to show WHAT they wrote.
 * `capturedLabels` parses "Label: value" out of the notes and then throws the
 * value away, because scoring only needs to know a field was filled. Nothing
 * in the app renders conversation_notes or prequalification_notes at all.
 *
 * So a manager asking the only question that matters about a transfer — "is
 * this any good?" — has had to open Bonzo, or ask the person.
 *
 * THE FIELD LIST IS THE SCORER'S OWN. This walks
 * TRANSFER_COMPLETENESS_FIELDS rather than a second list of its own, so a
 * field cannot be shown under one rule and counted under another: the section
 * markers that switch off a whole section, and the LOA question that only
 * applies when the loan officer has one, are honoured here because they are
 * honoured there. A page that showed nine blanks under a "Co-Borrower: n/a"
 * would be a page nobody trusted twice.
 *
 * READING, NEVER WRITING. Nothing here edits a transfer or decides anything;
 * it reshapes what is already stored. Whether a given person may see a given
 * transfer is the route's decision, not this file's.
 */

/** One field, as it should appear on screen. */
export interface DetailField {
  label: string;
  /** What was written, or null when nothing was. */
  value: string | null;
  /** Was this field one the score asked for? An extra is neither good nor bad. */
  expected: boolean;
  /** Qualification answers decide whether the lead is workable at all. */
  qualification: boolean;
  /**
   * False when a section marker took this field out of what was asked —
   * "Co-Borrower: n/a" makes the three co-borrower fields not applicable
   * rather than missing, and the score already treats them that way.
   */
  applicable: boolean;
}

export interface TransferDetail {
  /** Every field the score knows about, in the order the script asks them. */
  fields: DetailField[];
  /** Anything captured that the score does not ask for — kept, never hidden. */
  extras: DetailField[];
  /** The free text a CLR wrote in their own words, separate from the fields. */
  narrative: { label: string; value: string }[];
  /** Straight from scoreTransfer, so this page and the board cannot disagree. */
  score: ReturnType<typeof scoreTransfer> & { percent: number | null };
  /** Applicable fields with nothing in them — the quickest read on the page. */
  missing: string[];
}

/**
 * Pull "Label: value" back out of a captured-notes blob.
 *
 * Deliberately the same shape of parse `capturedLabels` does — start of a
 * line, the label, a colon — because a value read one way and scored another
 * is worse than no value at all. The difference is only that this keeps what
 * it finds.
 */
export function capturedValues(blob: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of String(blob ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    for (const label of CAPTURE_LABELS) {
      if (out.has(label)) continue;
      const prefix = `${label}:`;
      if (!line.startsWith(prefix)) continue;
      const value = line.slice(prefix.length).trim();
      if (value) out.set(label, value);
      break;
    }
  }
  return out;
}

/**
 * A line that looks like a captured field but carries a label C3 does not know.
 *
 * Worth surfacing rather than dropping: it is usually either a question that
 * was added to the script and never added to the score, or somebody typing a
 * field name by hand. Both are things a manager should be able to see.
 */
export function extraValues(blob: unknown): Map<string, string> {
  const known = new Set<string>(CAPTURE_LABELS as readonly string[]);
  const out = new Map<string, string>();
  for (const raw of String(blob ?? "").split("\n")) {
    const line = raw.trim();
    if (!line || line.length > 200) continue;
    const colon = line.indexOf(":");
    if (colon <= 0 || colon > 60) continue;
    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    // A label is a short caption, not a sentence somebody happened to punctuate.
    if (!value || !label || label.split(/\s+/).length > 6) continue;
    if (known.has(label) || out.has(label)) continue;
    out.set(label, value);
  }
  return out;
}

/**
 * The columns a CLR writes in their own words, in the order they are useful.
 *
 * These are NOT parsed for captured fields. The scorer reads captured answers
 * out of conversation_notes and only conversation_notes, so scavenging labels
 * from the free-text columns as well would show a field as answered that the
 * percentage counts as blank.
 */
export const DEFAULT_NARRATIVE: ReadonlyArray<{ label: string; key: string }> = [
  { label: "What they want", key: "leadGoal" },
  { label: "Other notes", key: "notes" },
  { label: "Pre-qualification notes", key: "prequalificationNotes" },
  { label: "What the LO plans to do", key: "loActionPlan" },
  { label: "Next steps", key: "nextSteps" },
];

/** How a stored column reads on screen when the score asks for it by key. */
const COLUMN_VALUE: Record<string, (row: any) => string> = {
  borrowerName: (r) => String(r?.borrowerName ?? ""),
  phoneNumber: (r) => String(r?.phoneNumber ?? ""),
  leadSource: (r) => String(r?.leadSource ?? ""),
  transferType: (r) => String(r?.transferType ?? ""),
  notes: (r) => String(r?.notes ?? ""),
  // The names are resolved by the query; the ids are the fallback, because a
  // transfer whose LO record was renamed should still say where it went.
  loId: (r) => String(r?.loName ?? (Number(r?.loId ?? 0) > 0 ? `LO #${r.loId}` : "")),
  loaId: (r) => String(r?.loaName ?? (Number(r?.loaId ?? 0) > 0 ? `LOA #${r.loaId}` : "")),
};

const QUALS = new Set<string>(QUAL_LABELS as readonly string[]);

/**
 * Assemble one transfer for reading.
 *
 * `row` is the stored outcome, plus whatever names the query resolved and the
 * `loHasLoa` flag the score needs.
 */
export function buildTransferDetail(
  row: TransferRow & Record<string, unknown>,
  narrativeColumns: ReadonlyArray<{ label: string; key: string }> = DEFAULT_NARRATIVE,
): TransferDetail {
  const blob = row?.conversationNotes;
  const captured = capturedLabels(blob);
  const values = capturedValues(blob);
  const score = scoreTransfer(row);

  const fields: DetailField[] = TRANSFER_COMPLETENESS_FIELDS.map((f) => {
    const applicable = f.expected(row, captured);
    const label = f.label;
    const raw = f.key.startsWith("capture:")
      ? (values.get(label) ?? "")
      : (COLUMN_VALUE[f.key]?.(row) ?? "");
    const value = String(raw).trim();
    return {
      label,
      value: value || null,
      expected: true,
      qualification: QUALS.has(label),
      applicable,
    };
  });

  // Two kinds of extra, both shown rather than dropped: a label the score asks
  // for but deliberately does not count — "Co-Borrower: n/a" is the sentence
  // that explains an empty co-borrower section, and a reader wants it — and a
  // label C3 has never heard of.
  const extras: DetailField[] = [
    ...(CAPTURE_LABELS as readonly string[])
      .filter((label) => UNSCORED_LABELS.has(label) && values.has(label))
      .map((label) => ({
        label, value: values.get(label)!, expected: false, qualification: false, applicable: true,
      })),
    ...Array.from(extraValues(blob).entries()).map(([label, value]) => ({
      label, value, expected: false, qualification: false, applicable: true,
    })),
  ];

  const narrative = narrativeColumns
    .map(({ label, key }) => ({ label, value: String((row as any)?.[key] ?? "").trim() }))
    .filter((n) => n.value.length > 0);

  return {
    fields,
    extras,
    narrative,
    score: {
      ...score,
      percent: score.expected > 0 ? Math.round((score.filled / score.expected) * 100) : null,
    },
    missing: fields.filter((f) => f.applicable && f.value === null).map((f) => f.label),
  };
}

/**
 * A one-line summary for a list, so a reader can tell a thorough write-up from
 * a thin one without opening it.
 */
export function detailSummary(detail: TransferDetail): string {
  const asked = detail.fields.filter((f) => f.applicable);
  const filled = asked.length - detail.missing.length;
  const missingQuals = asked.filter((f) => f.qualification && f.value === null).length;
  const parts = [`${filled} of ${asked.length} fields`];
  if (detail.narrative.length) {
    parts.push(`${detail.narrative.length} written note${detail.narrative.length === 1 ? "" : "s"}`);
  }
  // The qualification answers decide whether the lead was workable at all, so a
  // missing one is worth saying out loud rather than leaving in a count.
  if (missingQuals) {
    parts.push(`${missingQuals} qualification answer${missingQuals === 1 ? "" : "s"} missing`);
  }
  return parts.join(" · ");
}
