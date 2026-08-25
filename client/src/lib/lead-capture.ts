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

export type LeadCapture = {
  leadSource: string;        // one of LEAD_SOURCE_OPTIONS or "other"
  leadSourceOther: string;   // what the CLR typed when leadSource === "other"
  qualOwnHome: QualAnswer;
  qualBankruptcy: QualAnswer;
  qualInvestment: QualAnswer;
  infoAddress: string;
  infoGoal: string;
  infoTakeOut: string;
  infoValue: string;
  infoBalance: string;
  infoRate: string;
  infoPayment: string;
  infoIncome: string;
  infoEmployment: string;
  infoEmploymentNotes: string;
  infoCreditScore: string;
  infoMilitary: string;
  infoMilitaryNotes: string;
};

export const QUAL_QUESTIONS: { name: keyof LeadCapture; label: string; cue: string }[] = [
  { name: "qualOwnHome", label: "Do you own a home?", cue: "must be Yes" },
  { name: "qualBankruptcy", label: "Bankruptcy in the last 6 months?", cue: "should be No" },
  { name: "qualInvestment", label: "Investment property / secondary residence?", cue: "" },
  // Credit lived here too, as "Credit score over 500? (est)" plus a free-text
  // estimate, while Info Gathering asked for "Credit score" separately — the
  // same fact in two places, filled inconsistently. There is now one banded
  // credit field below, and every band is above 500, so the old yes/no gate is
  // answered by picking one.
];

export const INVESTMENT_ROUTING_HINT = "Investment / secondary residence — give this to LOA Justin, Mateo, or John.";

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
  options?: readonly string[];
  notes?: keyof LeadCapture;
  notesPlaceholder?: string;
};

export const INFO_FIELDS: InfoField[] = [
  { name: "infoAddress", label: "Address" },
  { name: "infoGoal", label: "Goal" },
  { name: "infoTakeOut", label: "How much are you looking to take out?" },
  { name: "infoValue", label: "Value of home" },
  { name: "infoBalance", label: "Balance on mortgage" },
  { name: "infoRate", label: "Rate on mortgage" },
  { name: "infoPayment", label: "Monthly payment" },
  { name: "infoIncome", label: "Monthly income" },
  {
    name: "infoEmployment", label: "Employment",
    options: ["W2", "SE", "Retired"],
    notes: "infoEmploymentNotes", notesPlaceholder: "Employment notes (optional)",
  },
  { name: "infoCreditScore", label: "Credit score", options: CREDIT_SCORE_BANDS },
  {
    name: "infoMilitary", label: "Military",
    options: ["Yes", "No"],
    notes: "infoMilitaryNotes", notesPlaceholder: "Military notes (optional)",
  },
];

export function emptyLeadCapture(): LeadCapture {
  return {
    leadSource: "", leadSourceOther: "",
    qualOwnHome: "", qualBankruptcy: "", qualInvestment: "",
    infoAddress: "", infoGoal: "", infoTakeOut: "", infoValue: "", infoBalance: "",
    infoRate: "", infoPayment: "", infoIncome: "",
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
    ["Address", c.infoAddress], ["Goal", c.infoGoal], ["Take Out", c.infoTakeOut],
    ["Home Value", c.infoValue], ["Mortgage Balance", c.infoBalance], ["Mortgage Rate", c.infoRate],
    ["Monthly Payment", c.infoPayment], ["Monthly Income", c.infoIncome],
    ["W2/SE/Retired", withNotes(c.infoEmployment, c.infoEmploymentNotes)],
    ["Credit Score", c.infoCreditScore],
    ["Military", withNotes(c.infoMilitary, c.infoMilitaryNotes)],
  ];
  const filled = info.filter(([, v]) => v.trim());
  if (filled.length) lines.push(filled.map(([k, v]) => `${k}: ${v.trim()}`).join("\n"));
  return lines.join("\n\n");
}
