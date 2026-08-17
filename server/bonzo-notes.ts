// Rendering C3 notes for Bonzo's note feed.
//
// Bonzo stores and renders note content as HTML — its own notes are wrapped in
// <p> and use <br />. Plain "\n" therefore collapses to a single space, which
// is why the first version of the transfer note arrived as one unreadable
// run-on paragraph. Everything C3 posts must be real markup.
//
// Values are CLR-typed free text, so every one is HTML-escaped on the way in.

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A line the LO must act on, called out instead of buried in the list. */
const CALLOUT_RE = /give (this )?to LOA/i;

// Section headings, keyed off labels this codebase controls (lead-capture.ts).
// If a label is ever renamed the heading simply doesn't appear — the note stays
// correct, it just loses one flourish. Free-form notes match nothing and pass
// through unheaded, which is what you want for prose.
const SECTIONS: { heading: string; probe: RegExp }[] = [
  { heading: "QUALIFICATION", probe: /^(Owns Home|Bankruptcy|Investment\/2nd Home|Credit Over 500)\b/im },
  { heading: "BORROWER DETAILS", probe: /^(Address|Goal|Take Out|Home Value|Mortgage Balance)\b/im },
];

function headingFor(block: string): string | null {
  for (const s of SECTIONS) if (s.probe.test(block)) return s.heading;
  return null;
}

/**
 * Turn the plain composed note (blank-line-separated blocks of "Label: value"
 * lines) into Bonzo-ready HTML.
 *
 * - blank line  → new <p> block, so the sections breathe
 * - line break  → <br />, so each field sits on its own line
 * - "Label: v"  → <strong>Label:</strong> v, so the eye can run down the labels
 * - routing line→ its own highlighted callout
 *
 * Lines that aren't "Label: value" (a CLR typing free-form notes) pass through
 * unchanged apart from escaping, so this never mangles ordinary prose.
 */
export function notesToBonzoHtml(text: string, opts?: { title?: string; subtitle?: string }): string {
  const blocks = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  const out: string[] = [];
  if (opts?.title) {
    const sub = opts.subtitle ? `<br /><em>${escapeHtml(opts.subtitle)}</em>` : "";
    out.push(`<p><strong>${escapeHtml(opts.title)}</strong>${sub}</p>`);
  }

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const rendered: string[] = [];
    // Callouts are collected and emitted AFTER the block. Emitting them inline
    // would cut the list in half and orphan whatever follows.
    const callouts: string[] = [];
    for (const line of lines) {
      let body = line;
      if (CALLOUT_RE.test(line)) {
        // "Investment/2nd Home: Yes — give to LOA …" becomes a clean
        // "Investment/2nd Home: Yes" in the list, plus a callout that keeps the
        // label so the instruction still says what it is about.
        const [head, ...rest] = line.split(/\s+—\s+/);
        const instruction = rest.join(" — ").trim();
        if (instruction) {
          body = head;
          const label = /^([^:]{1,40}):/.exec(head)?.[1]?.trim();
          callouts.push(`<p><strong>⚠️ ${escapeHtml(label ? `${label} — ${instruction}` : instruction)}</strong></p>`);
        }
      }
      const m = /^([^:]{1,40}):\s*(.*)$/.exec(body);
      rendered.push(m
        ? `<strong>${escapeHtml(m[1])}:</strong> ${escapeHtml(m[2])}`
        : escapeHtml(body));
    }
    if (rendered.length) {
      const heading = headingFor(block);
      const head = heading ? `<strong>${escapeHtml(heading)}</strong><br />` : "";
      out.push(`<p>${head}${rendered.join("<br />")}</p>`);
    }
    out.push(...callouts);
  }
  // Joined with nothing: the stored content then contains no raw newline at
  // all, so there is no chance a newline is silently doing a line break's job.
  return out.join("");
}

/**
 * The marker that makes a posted note identifiable on re-sync, independent of
 * how it is formatted. Content-matching alone cannot do this: the moment the
 * rendering adds a heading, a text comparison against the plain source stops
 * matching and the sync posts a duplicate on every run.
 */
export function transferNoteMarker(outcomeId: number): string {
  return `C3 transfer #${outcomeId}`;
}

/** Normalized plain text of a note — used to spot a CLR's manual paste. */
export function notePlainText(html: string): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
