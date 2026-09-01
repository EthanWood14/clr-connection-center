/**
 * W2-only states.
 *
 * In these states the lender will only take W2 borrowers, so a loan officer who
 * cannot write that business must not be licensed-listed there. Chris Redoble
 * is permanently excluded: the exclusion is enforced on the server every time
 * licensed states are saved, not just hidden in the picker, because a rule that
 * only exists in the UI is one API call away from being undone.
 *
 * Business-purpose loans are unaffected — those are fine in every state, which
 * is why the note travels with the flag rather than living in someone's head.
 */

export const W2_ONLY_STATES = [
  "AR", // Arkansas
  "GA", // Georgia
  "IL", // Illinois
  "IN", // Indiana
  "MD", // Maryland
  "MS", // Mississippi
  "MT", // Montana
  "NJ", // New Jersey
  "NC", // North Carolina
  "SC", // South Carolina
  "VT", // Vermont
] as const;

export type W2OnlyState = (typeof W2_ONLY_STATES)[number];

const W2_SET = new Set<string>(W2_ONLY_STATES);

export function isW2OnlyState(abbr: unknown): boolean {
  return W2_SET.has(String(abbr ?? "").trim().toUpperCase());
}

/**
 * States nobody may be licensed in.
 *
 * Stricter than W2-only and it wins wherever the two overlap: Illinois is on
 * both lists, and "nobody can be licensed here" makes "only W2 borrowers here"
 * moot rather than contradicting it. Both lists stay honest; the map paints the
 * stricter one.
 *
 * Chosen from the roster, not invented: Illinois, Massachusetts and New York
 * were already the only three states with zero licensed loan officers, and
 * Hawaii joins them by Ethan's instruction on 1 Sep 2026.
 *
 * Business purpose loans do not need the licence, which is why the note about
 * them is the one thing these states still say.
 */
export const NO_LICENSE_STATES = [
  "HI", // Hawaii
  "IL", // Illinois
  "MA", // Massachusetts
  "NY", // New York
] as const;

export type NoLicenseState = (typeof NO_LICENSE_STATES)[number];

const NO_LICENSE_SET = new Set<string>(NO_LICENSE_STATES);

export function isNoLicenseState(abbr: unknown): boolean {
  return NO_LICENSE_SET.has(String(abbr ?? "").trim().toUpperCase());
}

/** Shown on the states nobody may be licensed in. */
export const NO_LICENSE_NOTE = "No one can be licensed in this state.";

/** Shown against every state, W2-only or not. */
export const BUSINESS_PURPOSE_NOTE =
  "Business purpose loans are okay in all states.";

/** Shown only on the W2-only ones. */
export const W2_ONLY_NOTE =
  "W2 borrowers only in this state.";

/**
 * Loan officers who may never be listed in a W2-only state. Matched on name
 * because that is the only stable handle across the roster; ids differ per
 * environment. Kept deliberately narrow — a loose pattern here would silently
 * strip states from someone who merely shares a first name.
 */
const PERMANENTLY_EXCLUDED = [
  /\bchris(topher)?\s+redoble\b/i,
];

export function isPermanentlyExcludedFromW2Only(fullName: unknown): boolean {
  const name = String(fullName ?? "").trim();
  if (!name) return false;
  return PERMANENTLY_EXCLUDED.some((re) => re.test(name));
}

/**
 * Strip the states this loan officer may never hold. Returns what should be
 * saved plus what was removed, so the caller can say so rather than silently
 * discarding the request.
 */
export function applyW2OnlyExclusions(
  fullName: unknown,
  states: string[],
): { states: string[]; removed: string[] } {
  const removed: string[] = [];
  // Applies to everyone, so it is checked first and needs no name at all.
  let kept = states.filter((s) => {
    if (isNoLicenseState(s)) { removed.push(String(s).toUpperCase()); return false; }
    return true;
  });
  if (!isPermanentlyExcludedFromW2Only(fullName)) return { states: kept, removed };
  kept = kept.filter((s) => {
    if (isW2OnlyState(s)) { removed.push(String(s).toUpperCase()); return false; }
    return true;
  });
  return { states: kept, removed };
}
