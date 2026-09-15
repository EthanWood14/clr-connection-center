/**
 * The lead card: what a CLR captures on a call, and how it becomes the one
 * text block every downstream reader (Bonzo note, LO handoff, reports, the
 * completeness score) sees.
 *
 * Lives in shared/ (moved from client/src/lib on 14 Sep 2026) because the
 * Chrome extension now logs a transfer from the Bonzo page, and the SERVER
 * composes its write-up from the same definitions Input Results uses — one
 * set of questions, one wording, one composer. client/src/lib/lead-capture.ts
 * re-exports everything here.
 */
import { LEAD_SOURCE_OPTIONS } from "./lead-source";
export { LEAD_SOURCE_OPTIONS, canonicalLeadSource } from "./lead-source";

export type QualAnswer = "yes" | "no" | "";

// Sits next to the investment question, which already names the case, so this
// is only the part that says what to DO about it.
export const INVESTMENT_ROUTING_HINT = "Give to LOA Justin, Mateo, or John.";

export type LeadCapture = {
  leadSource: string;        // one of LEAD_SOURCE_OPTIONS or "other"
  leadSourceOther: string;   // what the CLR typed when leadSource === "other"
  qualOwnHome: QualAnswer;
  qualBankruptcy: QualAnswer;
  qualInvestment: QualAnswer;
  infoBorrowerEmail: string;
  infoBorrowerDob: string;
  infoCreditScoreExact: string;
  infoCoborrowerName: string;
  infoCoborrowerDob: string;
  infoCoborrowerCreditScore: string;
  infoAddress: string;
  infoGoal: string;
  infoTakeOut: string;
  infoValue: string;
  infoBalance: string;
  infoRate: string;
  infoPayment: string;
  infoHelocBalance: string;
  infoHelocRate: string;
  infoHelocPayment: string;
  infoIncome: string;
  // Section toggles. "Not asked" and "asked, and there is none" look identical
  // in a blank field, so the score has no way to tell a gap from a fact. These
  // record the fact, and the sections they cover stop being expected.
  naCoborrower: QualAnswer;
  mortgageFreeClear: QualAnswer;
  naHeloc: QualAnswer;
  infoEmployment: string;
  infoEmploymentNotes: string;
  infoCreditScore: string;
  infoMilitary: string;
  infoMilitaryNotes: string;
};

export const QUAL_QUESTIONS: { name: keyof LeadCapture; label: string; cue: string; hint?: string }[] = [
  { name: "qualOwnHome", label: "Do you own a home?", cue: "must be Yes" },
  { name: "qualBankruptcy", label: "Bankruptcy in the last 6 months?", cue: "should be No" },
  // The routing note rides on the question itself, not on a Yes answer: you
  // need to know where it goes BEFORE you decide, and a note that only appears
  // afterwards teaches nobody who to hand it to.
  { name: "qualInvestment", label: "Investment property / secondary residence?", cue: "", hint: INVESTMENT_ROUTING_HINT },
  // Credit lived here too, as "Credit score over 500? (est)" plus a free-text
  // estimate, while Info Gathering asked for "Credit score" separately — the
  // same fact in two places, filled inconsistently. There is now one banded
  // credit field below, and every band is above 500, so the old yes/no gate is
  // answered by picking one.
];

/** The bands LOs price against. Ranges are inclusive of the lower bound. */
export const CREDIT_SCORE_BANDS = ["500-580", "580-620", "620-720", "720+"] as const;

/**
 * An info-gathering field.
 *
 * `options` turns it into a row of buttons instead of a free-text box — the
 * answers people actually give, so they are typed the same way every time and
 * can be counted later. `notes` names a companion text field for the detail a
 * fixed set cannot hold ("W2 + 1099 side work", "Navy, 6 years").
 */
export type InfoField = {
  name: keyof LeadCapture;
  label: string;
  section: "Borrower" | "Co-borrower" | "Property & request" | "First mortgage" | "HELOC" | "Income & eligibility";
  options?: readonly string[];
  notes?: keyof LeadCapture;
  notesPlaceholder?: string;
  type?: "text" | "email" | "date";
  inputMode?: "text" | "email" | "numeric" | "decimal";
  maxLength?: number;
  placeholder?: string;
  digitsOnly?: boolean;
};

export const INFO_FIELDS: InfoField[] = [
  { name: "infoBorrowerEmail", label: "Borrower email", section: "Borrower", type: "email", inputMode: "email" },
  { name: "infoBorrowerDob", label: "Borrower date of birth", section: "Borrower", type: "date" },
  { name: "infoCreditScore", label: "Borrower credit band", section: "Borrower", options: CREDIT_SCORE_BANDS },
  { name: "infoCreditScoreExact", label: "Exact borrower credit score", section: "Borrower", inputMode: "numeric", maxLength: 3, digitsOnly: true, placeholder: "Optional" },

  { name: "infoCoborrowerName", label: "Co-borrower name", section: "Co-borrower" },
  { name: "infoCoborrowerDob", label: "Co-borrower date of birth", section: "Co-borrower", type: "date" },
  { name: "infoCoborrowerCreditScore", label: "Co-borrower credit score", section: "Co-borrower", inputMode: "numeric", maxLength: 3, digitsOnly: true, placeholder: "Optional" },

  { name: "infoAddress", label: "Property address", section: "Property & request" },
  { name: "infoGoal", label: "Goal / debts to pay off", section: "Property & request" },
  { name: "infoTakeOut", label: "Cash needed / amount to take out", section: "Property & request" },
  { name: "infoValue", label: "Estimated home value", section: "Property & request" },

  { name: "infoBalance", label: "First mortgage balance", section: "First mortgage" },
  { name: "infoRate", label: "First mortgage rate", section: "First mortgage" },
  { name: "infoPayment", label: "Monthly PITI / payment", section: "First mortgage" },

  { name: "infoHelocBalance", label: "HELOC balance", section: "HELOC" },
  { name: "infoHelocRate", label: "HELOC rate", section: "HELOC" },
  { name: "infoHelocPayment", label: "HELOC monthly payment", section: "HELOC" },

  { name: "infoIncome", label: "Monthly income", section: "Income & eligibility" },
  {
    name: "infoEmployment", label: "Employment", section: "Income & eligibility",
    options: ["W2", "SE", "Retired"],
    notes: "infoEmploymentNotes", notesPlaceholder: "Employment notes (optional)",
  },
  {
    name: "infoMilitary", label: "Military", section: "Income & eligibility",
    options: ["Yes", "No"],
    notes: "infoMilitaryNotes", notesPlaceholder: "Military notes (optional)",
  },
];

/**
 * A whole section answered in one tap.
 *
 * These are not cosmetic. A blank co-borrower box means either "there isn't
 * one" or "nobody asked", and the completeness score cannot tell those apart —
 * so it marks the second, and the first gets punished for a fact. Ticking the
 * toggle states the fact, writes it into the handoff the LO reads, and takes
 * the section out of what the score expects.
 */
export type SectionToggle = {
  name: keyof LeadCapture;
  section: InfoField["section"];
  /** The tickbox wording on both capture surfaces. */
  label: string;
  /** Written into the composed note in place of the fields it covers. */
  noteLabel: string;
  noteValue: string;
  covers: Array<keyof LeadCapture>;
};

export const SECTION_TOGGLES: SectionToggle[] = [
  {
    name: "naCoborrower", section: "Co-borrower", label: "No co-borrower",
    noteLabel: "Co-Borrower", noteValue: "N/A",
    covers: ["infoCoborrowerName", "infoCoborrowerDob", "infoCoborrowerCreditScore"],
  },
  {
    name: "mortgageFreeClear", section: "First mortgage", label: "Free and clear",
    noteLabel: "First Mortgage", noteValue: "Free and clear",
    covers: ["infoBalance", "infoRate", "infoPayment"],
  },
  {
    name: "naHeloc", section: "HELOC", label: "No HELOC",
    noteLabel: "HELOC", noteValue: "N/A",
    covers: ["infoHelocBalance", "infoHelocRate", "infoHelocPayment"],
  },
];

/** The toggle covering a section, if it has one. */
export function toggleForSection(section: InfoField["section"]): SectionToggle | undefined {
  return SECTION_TOGGLES.find((tg) => tg.section === section);
}

export function emptyLeadCapture(): LeadCapture {
  return {
    leadSource: "", leadSourceOther: "",
    qualOwnHome: "", qualBankruptcy: "", qualInvestment: "",
    infoBorrowerEmail: "", infoBorrowerDob: "", infoCreditScoreExact: "",
    infoCoborrowerName: "", infoCoborrowerDob: "", infoCoborrowerCreditScore: "",
    infoAddress: "", infoGoal: "", infoTakeOut: "", infoValue: "", infoBalance: "",
    infoRate: "", infoPayment: "", infoHelocBalance: "", infoHelocRate: "", infoHelocPayment: "", infoIncome: "",
    naCoborrower: "", mortgageFreeClear: "", naHeloc: "",
    infoEmployment: "", infoEmploymentNotes: "",
    infoCreditScore: "",
    infoMilitary: "", infoMilitaryNotes: "",
  };
}

/** The stored lead source: what the CLR typed when they chose "other". */
export function resolveLeadSource(c: Pick<LeadCapture, "leadSource" | "leadSourceOther">): string | null {
  if (c.leadSource === "other") return c.leadSourceOther.trim() || null;
  return c.leadSource || null;
}

/** True when any qualification or info field has been touched. */
export function leadCaptureHasContent(c: LeadCapture): boolean {
  return Object.entries(c).some(([k, v]) => k !== "leadSource" && k !== "leadSourceOther" && String(v ?? "").trim() !== "")
    || !!resolveLeadSource(c);
}

/**
 * Whatever a client sent, as a LeadCapture: every key present, every value a
 * string, unknown keys dropped. The extension posts a plain object; this is
 * what makes it safe to hand to the composer.
 */
export function leadCaptureFrom(raw: unknown): LeadCapture {
  const out = emptyLeadCapture();
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const key of Object.keys(out) as Array<keyof LeadCapture>) {
    const v = src[key];
    if (v == null) continue;
    const s = String(v).trim().slice(0, 500);
    (out as any)[key] = key.startsWith("qual") || key.startsWith("na") || key === "mortgageFreeClear"
      ? (s === "yes" || s === "no" ? s : "")
      : s;
  }
  return out;
}

// Serialized in the shape LOs already know from the call script — one text
// block, empty fields omitted rather than rendered as blank labels.
export function composeLeadCaptureNotes(c: LeadCapture): string {
  const yn = (x: QualAnswer) => (x === "yes" ? "Yes" : x === "no" ? "No" : "");
  const lines: string[] = [];
  const src = resolveLeadSource(c);
  if (src) lines.push(`Lead Source: ${src}`);
  const qual: string[] = [];
  if (c.qualOwnHome) qual.push(`Owns Home: ${yn(c.qualOwnHome)}`);
  if (c.qualBankruptcy) qual.push(`Bankruptcy Last 6 Months: ${yn(c.qualBankruptcy)}`);
  if (c.qualInvestment) qual.push(`Investment/2nd Home: ${yn(c.qualInvestment)}${c.qualInvestment === "yes" ? " — give to LOA Justin, Mateo, or John" : ""}`);
  if (qual.length) lines.push(qual.join("\n"));
  // A field and its notes read as one line: "Military: Yes — Navy, 6 years".
  const withNotes = (value: string, notes: string) => {
    const v = value.trim(), n = notes.trim();
    if (v && n) return `${v} — ${n}`;
    return v || n;
  };
  const info: Array<[string, string]> = [
    ["Borrower Email", c.infoBorrowerEmail], ["Borrower DOB", c.infoBorrowerDob],
    ["Credit Score", c.infoCreditScore], ["Exact Borrower Credit Score", c.infoCreditScoreExact],
    ...(c.naCoborrower === "yes"
      ? [["Co-Borrower", "N/A"] as [string, string]]
      : ([["Co-Borrower Name", c.infoCoborrowerName], ["Co-Borrower DOB", c.infoCoborrowerDob],
          ["Co-Borrower Credit Score", c.infoCoborrowerCreditScore]] as Array<[string, string]>)),
    ["Property Address", c.infoAddress], ["Goal / Debts to Pay Off", c.infoGoal], ["Cash Needed / Take Out", c.infoTakeOut],
    ["Estimated Home Value", c.infoValue],
    ...(c.mortgageFreeClear === "yes"
      ? [["First Mortgage", "Free and clear"] as [string, string]]
      : ([["First Mortgage Balance", c.infoBalance], ["First Mortgage Rate", c.infoRate],
          ["Monthly PITI / Payment", c.infoPayment]] as Array<[string, string]>)),
    ...(c.naHeloc === "yes"
      ? [["HELOC", "N/A"] as [string, string]]
      : ([["HELOC Balance", c.infoHelocBalance], ["HELOC Rate", c.infoHelocRate],
          ["HELOC Monthly Payment", c.infoHelocPayment]] as Array<[string, string]>)),
    ["Monthly Income", c.infoIncome],
    ["W2/SE/Retired", withNotes(c.infoEmployment, c.infoEmploymentNotes)],
    ["Military", withNotes(c.infoMilitary, c.infoMilitaryNotes)],
  ];
  const filled = info.filter(([, v]) => v.trim());
  if (filled.length) lines.push(filled.map(([k, v]) => `${k}: ${v.trim()}`).join("\n"));
  return lines.join("\n\n");
}

/** Read the same labels we write, without guessing answers from legacy prose. */
export function parseLeadCaptureNotes(notes: string | null | undefined, storedSource?: string | null) {
  const capture = emptyLeadCapture();
  const retained: string[] = [];
  const labels: Record<string, keyof LeadCapture> = {
    "lead source": "leadSource", "owns home": "qualOwnHome",
    "bankruptcy last 6 months": "qualBankruptcy", "investment/2nd home": "qualInvestment",
    "borrower email": "infoBorrowerEmail", "borrower dob": "infoBorrowerDob",
    "credit score": "infoCreditScore", "exact borrower credit score": "infoCreditScoreExact",
    "co-borrower name": "infoCoborrowerName", "co-borrower dob": "infoCoborrowerDob",
    "co-borrower credit score": "infoCoborrowerCreditScore",
    "property address": "infoAddress", "goal / debts to pay off": "infoGoal",
    "cash needed / take out": "infoTakeOut", "estimated home value": "infoValue",
    "first mortgage balance": "infoBalance", "first mortgage rate": "infoRate",
    "monthly piti / payment": "infoPayment", "heloc balance": "infoHelocBalance",
    "heloc rate": "infoHelocRate", "heloc monthly payment": "infoHelocPayment",
    "monthly income": "infoIncome", "w2/se/retired": "infoEmployment", "military": "infoMilitary",
  };
  const lines = String(notes ?? "").split(/\r?\n/);
  const labelOf = (line: string) => line.match(/^([^:]+):[ \t]*(.*)$/);
  // Conflicting/duplicate legacy labels stay visible as saved details. Never
  // silently select one and discard another person's write-up.
  const counts = new Map<string, number>();
  for (const line of lines) {
    const m = labelOf(line);
    if (m) counts.set(m[1].trim().toLowerCase(), (counts.get(m[1].trim().toLowerCase()) ?? 0) + 1);
  }
  for (const line of lines) {
    const m = labelOf(line);
    if (!m) { retained.push(line); continue; }
    const label = m[1].trim().toLowerCase(), value = m[2].trim();
    if (counts.get(label) !== 1) { retained.push(line); continue; }
    const toggle = SECTION_TOGGLES.find(t => t.noteLabel.toLowerCase() === label && t.noteValue.toLowerCase() === value.toLowerCase());
    if (toggle) { capture[toggle.name] = "yes"; continue; }
    const key = labels[label];
    if (!key || !value) { retained.push(line); continue; }
    if (key.startsWith("qual")) {
      const answer = value.match(/^(yes|no)(?: — give to LOA Justin, Mateo, or John)?$/i);
      if (!answer) { retained.push(line); continue; }
      (capture as any)[key] = answer[1].toLowerCase();
    } else if (key === "infoEmployment" || key === "infoMilitary") {
      const options = INFO_FIELDS.find(f => f.name === key)!.options!;
      const option = options.find(o => value.toLowerCase() === o.toLowerCase() || value.toLowerCase().startsWith(`${o.toLowerCase()} — `));
      const notesKey = key === "infoEmployment" ? "infoEmploymentNotes" : "infoMilitaryNotes";
      capture[key] = option || "";
      capture[notesKey] = option ? value.slice(option.length).replace(/^ — /, "") : value;
    } else {
      // Browser date/numeric/email inputs cannot faithfully show these older
      // free-text answers; retain them visibly instead of showing an empty box.
      if ((key.endsWith("Dob") && !/^\d{4}-\d{2}-\d{2}$/.test(value)) ||
          ((key === "infoCreditScoreExact" || key === "infoCoborrowerCreditScore") && (!/^\d{3}$/.test(value) || Number(value) < 300 || Number(value) > 850)) ||
          (key === "infoBorrowerEmail" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) {
        retained.push(line); continue;
      }
      (capture as any)[key] = value;
    }
  }
  // A section with contradictory legacy details is not silently hidden by N/A.
  for (const toggle of SECTION_TOGGLES) {
    if (capture[toggle.name] === "yes" && toggle.covers.some(k => capture[k])) {
      capture[toggle.name] = "";
      retained.push(`${toggle.noteLabel}: ${toggle.noteValue}`);
    }
  }
  if (storedSource != null && capture.leadSource && storedSource !== capture.leadSource) {
    retained.push(`Lead Source: ${capture.leadSource}`);
  }
  const source = storedSource != null ? storedSource : capture.leadSource;
  capture.leadSource = (LEAD_SOURCE_OPTIONS as readonly string[]).includes(source) ? source : source ? "other" : "";
  capture.leadSourceOther = capture.leadSource === "other" ? source : "";
  return { capture, retainedNotes: retained.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** Preserve an untouched historical write-up byte-for-byte; edits use our one composer. */
export function composeEditedLeadCaptureNotes(
  original: string | null | undefined,
  initial: LeadCapture,
  current: LeadCapture,
  initialRetained: string,
  retained: string,
): string {
  if ((Object.keys(emptyLeadCapture()) as Array<keyof LeadCapture>).every(k => initial[k] === current[k]) && initialRetained === retained) {
    return original ?? "";
  }
  return [composeLeadCaptureNotes(current), retained.trim()].filter(Boolean).join("\n\n");
}

/** The result choices the extension offers — the same set Input Results has. */
export const OUTCOME_TYPE_OPTIONS = [
  { value: "transfer", label: "Transfer" },
  { value: "appointment", label: "Appointment" },
  { value: "deferral", label: "Deferral" },
  { value: "fell_through", label: "Fell Through" },
  { value: "no_answer", label: "No Answer" },
  { value: "not_interested", label: "Not Interested" },
  { value: "wrong_number", label: "Wrong Number" },
  { value: "other", label: "Other" },
] as const;
