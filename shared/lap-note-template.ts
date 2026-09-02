/**
 * The LOA lead-note template.
 *
 * Shared between the LAP portal composer (which pre-fills it) and the server
 * (which refuses a note that is nothing but the template). Every posted note
 * emails Chris, so an untouched template must never make it through.
 *
 * Drawn from the CLR Info Sheet fields that already travel with every
 * transfer — swap the wording the moment the LOAs share Chris's actual
 * email template.
 */
export const LOA_NOTE_TEMPLATE_LINES = [
  "Borrower: ",
  "Goal / Loan type: ",
  "Credit score: ",
  "Income (W2 / SE / Retired): ",
  "Home value / 1st mortgage balance & rate: ",
  "Monthly payment (PITI): ",
  "Notes for Chris: ",
  "Next steps: ",
] as const;

export const LOA_NOTE_TEMPLATE = LOA_NOTE_TEMPLATE_LINES.join("\n");

/** The bare labels, trimmed so "Borrower:" matches with or without its trailing space. */
const LABELS = new Set<string>(LOA_NOTE_TEMPLATE_LINES.map((line) => line.trim()));

/** The note's lines with CRLF folded to LF, each trimmed, blank lines dropped. */
function normalise(body: string): string[] {
  return body
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * True when a note is blank, or is nothing but bare template labels.
 *
 * Judged line by line. The earlier version compared the whole body to the
 * whole template, so deleting one label line or reordering the labels made a
 * note that was still nothing but labels look "filled in" — and it went out
 * by email to the loan officer and Chris.
 */
export function isUntouchedLoaNote(body: string): boolean {
  return normalise(body ?? "").every((line) => LABELS.has(line));
}

/** True when any line is more than a bare label: a filled-in label or free text. */
export function loaNoteHasContent(body: string): boolean {
  return !isUntouchedLoaNote(body);
}
