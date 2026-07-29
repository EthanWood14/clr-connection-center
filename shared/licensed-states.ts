export const US_STATE_OPTIONS = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"],
  ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"],
  ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "West Virginia"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"], ["DC", "Washington, D.C."],
] as const;

const US_STATE_CODES = new Set<string>(US_STATE_OPTIONS.map(([code]) => code));

export type LicensedStatesResult =
  | { success: true; states: string[] }
  | { success: false; error: string };

export function normalizeLicensedStates(value: unknown): LicensedStatesResult {
  if (!Array.isArray(value)) {
    return { success: false, error: "States must be provided as a list." };
  }

  const normalized = value.map((item) => String(item ?? "").trim().toUpperCase());
  const invalid = Array.from(new Set(normalized.filter((code) => !US_STATE_CODES.has(code))));
  if (invalid.length > 0) {
    return {
      success: false,
      error: `Invalid state code${invalid.length === 1 ? "" : "s"}: ${invalid.join(", ")}.`,
    };
  }

  const selected = new Set(normalized);
  return {
    success: true,
    states: US_STATE_OPTIONS.map(([code]) => code).filter((code) => selected.has(code)),
  };
}
