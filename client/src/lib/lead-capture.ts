// Lead capture — the qualification checklist, info-gathering fields, and lead
// source asked on every logged call.
//
// One definition shared by the Input Results wizard (outcomes.tsx) and the
// live-call Script page. Both surfaces collect the same facts and both
// serialize them into one text block, so a lead captured mid-call and a lead
// typed in afterwards look identical to Bonzo, the LO handoff, and reports.

export const LEAD_SOURCE_OPTIONS = [
  "Retail", "BulkTexts", "Single Dialing", "Mojo", "CallTools", "Responded",
] as const;

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
