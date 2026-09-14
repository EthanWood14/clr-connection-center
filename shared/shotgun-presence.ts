/**
 * "Are you still there?" for a claimed Shotgun lead.
 *
 * A CLR who confirms a lead and then walks away holds it forever: the
 * rotation skips them while they hold it, and the lead — the hottest kind
 * there is — sits with nobody working it. So a claim that has not been
 * written up is released back to the queue three minutes in — but never
 * without warning. Thirty seconds before the three-minute mark C3 asks, on
 * every page, whether they are still on it, with the seconds counting down
 * to the release. One click keeps it. No answer by the three-minute mark
 * sends the lead back to the queue for the next ready CLR. Asked once per
 * claim: a CLR who has said "I'm here" is trusted for the rest of the
 * write-up.
 *
 * Ethan, 14 Sep 2026: "a shotgun/new lead that is accepted should not be
 * dismissed without a 30 second warning that it's going to be dismissed
 * after 3 minutes." The release is at three minutes; the warning is the
 * thirty seconds before it.
 *
 * Pure so the timing can be tested without a database.
 */
/** The claim is released this long after it was made, unless kept. */
export const SHOTGUN_PRESENCE_RELEASE_AFTER_MS = 3 * 60_000;
/** How long the warning is on screen before the release. */
export const SHOTGUN_PRESENCE_RESPOND_MS = 30_000;
/** When the warning opens, measured from the claim. */
export const SHOTGUN_PRESENCE_AFTER_MS = SHOTGUN_PRESENCE_RELEASE_AFTER_MS - SHOTGUN_PRESENCE_RESPOND_MS;

export type PresenceState =
  | { kind: "none" }
  | { kind: "prompt"; deadlineAt: string; secondsLeft: number }
  | { kind: "expired" };

/**
 * Where a claimed lead stands on the presence clock.
 *   none    — not yet two and a half minutes in, or already answered
 *   prompt  — warn now; deadlineAt is the three-minute mark, when it goes back
 *   expired — the three-minute mark passed with no answer: release it
 */
export function presenceState(
  claimedAt: string | null | undefined,
  presenceConfirmedAt: string | null | undefined,
  nowMs: number = Date.now(),
): PresenceState {
  if (presenceConfirmedAt) return { kind: "none" };
  const claimed = Date.parse(String(claimedAt ?? ""));
  if (!Number.isFinite(claimed)) return { kind: "none" };
  const promptAt = claimed + SHOTGUN_PRESENCE_AFTER_MS;
  const deadline = promptAt + SHOTGUN_PRESENCE_RESPOND_MS;
  if (nowMs < promptAt) return { kind: "none" };
  if (nowMs >= deadline) return { kind: "expired" };
  return { kind: "prompt", deadlineAt: new Date(deadline).toISOString(), secondsLeft: Math.max(0, (deadline - nowMs) / 1000) };
}

/** The ISO instant before which a claim must have been made to be released now. */
export function presenceReleaseCutoff(nowMs: number = Date.now()): string {
  return new Date(nowMs - SHOTGUN_PRESENCE_AFTER_MS - SHOTGUN_PRESENCE_RESPOND_MS).toISOString();
}
