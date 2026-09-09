/**
 * The LOA lead-note template — the deal sheet that travels with a file.
 *
 * Shared between the LAP portal composer (which pre-fills it) and the server
 * (which refuses a note that is nothing but the template). The note is the
 * BODY of the email that goes out with a file's documents, so an untouched
 * template must never make it through.
 *
 * These are Chris's real fields, supplied by Ethan on 9 Sep 2026. The previous
 * list was a placeholder drawn from the CLR Info Sheet, put there precisely to
 * be swapped when the real one arrived.
 *
 * ORDER IS THE ORDER HE SENT THEM. It runs value → loan → pricing → credit →
 * product → outcome → paperwork → notes, which is the order somebody reads a
 * deal in, and it is what the LOAs will be looking for line by line. Do not
 * tidy it into alphabetical or "logical" groups.
 *
 * "TBD" and "N/A" are expected answers here, not gaps — a rate that is not
 * priced yet and a comp figure that does not apply are both real states, and
 * both count as filled in.
 */
export const LOA_NOTE_TEMPLATE_LINES = [
  "Estimated Value: ",
  "Proposed Loan Amount: ",
  "Current Rate: ",
  "Proposed Rate: ",
  "Origination Points: ",
  "Discount Points: ",
  "Revenue Estimate: ",
  "FICO Est: ",
  "FICO Actual: ",
  "Credit Pull (Y/N): ",
  "Hard/Soft: ",
  "Total Proposed Comp: ",
  "Appraisal Needed (Y/N): ",
  "1st MTG or HELOC: ",
  "Pitched Deal (Y/N): ",
  "Deal Accepted Terms: ",
  "Deal Not Accepted Objections: ",
  "How Many Properties Do They Own: ",
  "Completed App in LendingPad (Y/N): ",
  "Full 1003 (Y/N): ",
  "Partial 1003 (Y/N): ",
  "Other Important Notes: ",
] as const;

export const LOA_NOTE_TEMPLATE = LOA_NOTE_TEMPLATE_LINES.join("\n");

/** The bare labels, trimmed so "FICO Est:" matches with or without its trailing space. */
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

/**
 * The template's labels, in order — for anything that wants to render the deal
 * sheet as a table rather than as the raw text the LOA typed.
 */
export const LOA_NOTE_LABELS: readonly string[] =
  LOA_NOTE_TEMPLATE_LINES.map((line) => line.replace(/:\s*$/, ""));

/**
 * Split a filled-in note back into label → value.
 *
 * Anything that is not a known label — the free paragraph an LOA adds at the
 * bottom, a pasted email chain — is returned as `trailing` rather than
 * dropped. Losing the part somebody actually wrote in their own words would
 * defeat the point of sending it.
 */
export function parseLoaNote(body: unknown): {
  fields: Array<{ label: string; value: string }>;
  trailing: string;
} {
  const lines = String(body ?? "").replace(/\r\n/g, "\n").split("\n");
  const fields: Array<{ label: string; value: string }> = [];
  const rest: string[] = [];
  let current: { label: string; value: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    const label = LOA_NOTE_LABELS.find((l) => line.toLowerCase().startsWith(`${l.toLowerCase()}:`));
    if (label) {
      current = { label, value: line.slice(label.length + 1).trim() };
      fields.push(current);
      continue;
    }
    // A continuation of the last field (a long note wrapped over lines) belongs
    // to it; anything before the first label is loose text.
    if (current && line) current.value = `${current.value} ${line}`.trim();
    else if (line) rest.push(line);
  }
  return { fields, trailing: rest.join("\n").trim() };
}
