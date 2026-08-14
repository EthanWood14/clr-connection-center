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
  qualCredit500: QualAnswer;
  qualCreditEst: string;
  infoAddress: string;
  infoGoal: string;
  infoTakeOut: string;
  infoValue: string;
  infoBalance: string;
  infoRate: string;
  infoPayment: string;
  infoIncome: string;
  infoEmployment: string;
  infoCreditScore: string;
  infoMilitary: string;
};

export const QUAL_QUESTIONS: { name: keyof LeadCapture; label: string; cue: string }[] = [
  { name: "qualOwnHome", label: "Do you own a home?", cue: "must be Yes" },
  { name: "qualBankruptcy", label: "Bankruptcy in the last 6 months?", cue: "should be No" },
  { name: "qualInvestment", label: "Investment property / secondary residence?", cue: "" },
  { name: "qualCredit500", label: "Credit score over 500? (est)", cue: "" },
];

export const INVESTMENT_ROUTING_HINT = "Investment / secondary residence — give this to LOA Justin, Mateo, or John.";

export const INFO_FIELDS: { name: keyof LeadCapture; label: string }[] = [
  { name: "infoAddress", label: "Address" },
  { name: "infoGoal", label: "Goal" },
  { name: "infoTakeOut", label: "How much are you looking to take out?" },
  { name: "infoValue", label: "Value of home" },
  { name: "infoBalance", label: "Balance on mortgage" },
  { name: "infoRate", label: "Rate on mortgage" },
  { name: "infoPayment", label: "Monthly payment" },
  { name: "infoIncome", label: "Monthly income" },
  { name: "infoEmployment", label: "W2 / SE / Retired" },
  { name: "infoCreditScore", label: "Credit score" },
  { name: "infoMilitary", label: "Military" },
];

export function emptyLeadCapture(): LeadCapture {
  return {
    leadSource: "", leadSourceOther: "",
    qualOwnHome: "", qualBankruptcy: "", qualInvestment: "", qualCredit500: "", qualCreditEst: "",
    infoAddress: "", infoGoal: "", infoTakeOut: "", infoValue: "", infoBalance: "",
    infoRate: "", infoPayment: "", infoIncome: "", infoEmployment: "", infoCreditScore: "", infoMilitary: "",
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
  if (c.qualCredit500) qual.push(`Credit Over 500 (est): ${yn(c.qualCredit500)}${c.qualCreditEst.trim() ? ` (${c.qualCreditEst.trim()})` : ""}`);
  if (qual.length) lines.push(qual.join("\n"));
  const info: Array<[string, string]> = [
    ["Address", c.infoAddress], ["Goal", c.infoGoal], ["Take Out", c.infoTakeOut],
    ["Home Value", c.infoValue], ["Mortgage Balance", c.infoBalance], ["Mortgage Rate", c.infoRate],
    ["Monthly Payment", c.infoPayment], ["Monthly Income", c.infoIncome],
    ["W2/SE/Retired", c.infoEmployment], ["Credit Score", c.infoCreditScore], ["Military", c.infoMilitary],
  ];
  const filled = info.filter(([, v]) => v.trim());
  if (filled.length) lines.push(filled.map(([k, v]) => `${k}: ${v.trim()}`).join("\n"));
  return lines.join("\n\n");
}
