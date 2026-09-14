/**
 * "Are you still there?" for a claimed Shotgun lead.
 *
 * A CLR who confirms a lead and then walks away holds it forever: the
 * rotation skips them while they hold it, and the lead — the hottest kind
 * there is — sits with nobody working it. So three minutes after the claim
 * C3 asks, on every page, whether they are still on it. One click keeps it.
 * No answer inside the window sends the lead back to the queue for the next
 * ready CLR. Asked once per claim: a CLR who has said "I'm here" is trusted
 * for the rest of the write-up.
 *
 * Pure so the timing can be tested without a database.
 */
export const SHOTGUN_PRESENCE_AFTER_MS = 3 * 60_000;
export const SHOTGUN_PRESENCE_RESPOND_MS = 60_000;

export type PresenceState =
  | { kind: "none" }
  | { kind: "prompt"; deadlineAt: string; secondsLeft: number }
  | { kind: "expired" };

/**
 * Where a claimed lead stands on the presence clock.
 *   none    — not yet three minutes in, or already answered
 *   prompt  — ask now; deadlineAt is when it goes back
 *   expired — the window closed with no answer: release it
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
