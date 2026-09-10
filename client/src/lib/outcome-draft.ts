/**
 * Keep what somebody has typed into Input Results.
 *
 * The form held everything in memory and nothing anywhere else, so a refresh,
 * a misplaced browser Back, a phone locking, or the tab being reloaded by an
 * update prompt threw away a half-finished write-up — twenty-odd fields of it
 * (Ethan, 10 Sep 2026). The EOD report has auto-saved a draft for months;
 * this is the same idea for the page CLRs are in all day.
 *
 * ── WHAT MUST NOT HAPPEN ──────────────────────────────────────────────────
 * A restored draft is only ever a rescue. It must never put one call's
 * details onto another call, which is a wrong record rather than a lost one,
 * and the worse failure of the two. So:
 *
 *   - Only a NEW outcome restores. Opening the form pre-filled from an
 *     assignment, a shotgun lead or an edit passes initialValues, and those
 *     must win outright.
 *   - "Log & next" clears it, the same as it clears the form. That button
 *     exists to start a fresh call.
 *   - A submitted outcome clears it.
 *   - A draft is only offered back on the DAY it was written, and only for
 *     the person who wrote it. A borrower's name surfacing on tomorrow's
 *     form, or on a colleague's, is exactly the wrong record this is meant
 *     to avoid.
 *
 * Everything here is best-effort. localStorage throws in private windows and
 * on browsers set to block site data, and a form that cannot save a draft
 * must still work perfectly — so every path swallows and carries on.
 */

const PREFIX = "clr.outcomeDraft";

/** Beyond this a draft is not a rescue, it is a stale record. */
export const DRAFT_MAX_AGE_MS = 12 * 60 * 60_000;

export type OutcomeDraft = {
  /** The business date the draft was written for. */
  date: string;
  savedAt: number;
  values: Record<string, unknown>;
};

export function draftKey(userId: unknown): string {
  const id = Number(userId);
  return `${PREFIX}.${Number.isFinite(id) && id > 0 ? id : "anon"}`;
}

/**
 * Is there anything here worth keeping?
 *
 * The form opens with a date, the signed-in CLR, "transfer" and "direct"
 * already chosen, so it is never truly empty. Saving that would mean every
 * visit leaves a draft and the next one "restores" a form identical to the
 * one it would have shown anyway — noise that teaches people to distrust the
 * feature. A draft has to contain something a person typed.
 */
export function draftWorthKeeping(values: Record<string, unknown>): boolean {
  const typed = [
    "borrowerName", "phoneNumber", "notes", "conversationNotes", "leadSource",
    "prequalificationNotes", "loActionPlan", "nextSteps", "leadGoal",
    "followupReason", "missedReason", "appointmentDatetime",
  ];
  for (const key of typed) {
    if (String((values as any)?.[key] ?? "").trim()) return true;
  }
  // A loan officer chosen by hand counts too: it is a real decision, and on a
  // long call it is often the first thing set.
  if (Number((values as any)?.loId ?? 0) > 0) return true;
  // So does any qualification or info-gathering answer.
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!/^(qual|info)/.test(key)) continue;
    if (String(value ?? "").trim()) return true;
  }
  return false;
}

export function saveDraft(userId: unknown, date: string, values: Record<string, unknown>): void {
  try {
    if (!draftWorthKeeping(values)) { clearDraft(userId); return; }
    const draft: OutcomeDraft = { date, savedAt: Date.now(), values };
    localStorage.setItem(draftKey(userId), JSON.stringify(draft));
  } catch { /* a form that cannot save a draft must still work */ }
}

export function clearDraft(userId: unknown): void {
  try { localStorage.removeItem(draftKey(userId)); } catch { /* as above */ }
}

/**
 * The draft to restore, or null.
 *
 * `today` is passed in rather than read here so this stays a pure decision:
 * the caller already knows the business date, and business days roll over at
 * 7pm, which is not something this file should have an opinion about.
 */
export function loadDraft(
  userId: unknown, today: string, now: number = Date.now(),
): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(draftKey(userId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as OutcomeDraft;
    if (!draft || typeof draft !== "object" || !draft.values) return null;
    // Wrong day, or too old to be a rescue. Drop it rather than leave it to
    // surprise somebody next week.
    if (String(draft.date) !== String(today)) { clearDraft(userId); return null; }
    if (!Number.isFinite(draft.savedAt) || now - draft.savedAt > DRAFT_MAX_AGE_MS) {
      clearDraft(userId);
      return null;
    }
    return draft.values;
  } catch {
    return null;
  }
}
