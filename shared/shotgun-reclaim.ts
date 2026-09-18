/**
 * Grab-back for a Shotgun lead the CLR already claimed, then lost.
 *
 * Ethan (Sep 2026): "if you lose a shotgun lead after you grabbed it, you
 * should have the option to grab them back if you were on the phone with them."
 *
 * A claim can vanish via the three-minute presence release, a manager
 * requeue, or the lead being offered onward. The prior claimer — and only
 * they — may reclaim while the lead is still live (queued, or offered to
 * somebody who has not confirmed yet). Reclaim skips the floor rotation and
 * puts the lead straight back to claimed, with an explicit "I am on the
 * phone with them" confirmation on the button. CallTools/Dialpad linkage is
 * deliberately not required.
 *
 * Prior claim is proven from append-only shotgun_offer_events (response =
 * 'confirmed'): shotgun_offers is UNIQUE(lead_id,user_id) and a later lap
 * overwrites the compact row back to pending.
 */

export const SHOTGUN_RECLAIMABLE_STATUSES = ["queued", "offered"] as const;

export type ShotgunReclaimDecision =
  | { ok: true }
  | { ok: false; reason: string };

export function isShotgunReclaimableStatus(status: string): boolean {
  return status === "queued" || status === "offered";
}

/**
 * Pure guard for whether this CLR may reclaim this lead right now.
 * Server still re-checks inside the write transaction.
 */
export function canReclaimShotgunLead(input: {
  status: string;
  currentAssigneeId: number | null | undefined;
  requesterId: number;
  previouslyConfirmed: boolean;
  holdingOtherClaimed: boolean;
  onThePhone: boolean;
}): ShotgunReclaimDecision {
  if (!input.onThePhone) {
    return { ok: false, reason: "Confirm you are on the phone with this borrower before grabbing the lead back." };
  }
  if (!input.previouslyConfirmed) {
    return { ok: false, reason: "Only the CLR who previously grabbed this lead can grab it back." };
  }
  if (input.holdingOtherClaimed) {
    return { ok: false, reason: "Finish the lead you are already holding before grabbing another back." };
  }
  if (!isShotgunReclaimableStatus(input.status)) {
    if (input.status === "claimed") {
      return { ok: false, reason: "This lead is already claimed — it cannot be grabbed back." };
    }
    if (input.status === "done" || input.status === "cancelled") {
      return { ok: false, reason: "This lead is no longer in the rotation." };
    }
    return { ok: false, reason: "This lead cannot be grabbed back right now." };
  }
  // Offered back to the same CLR: use the normal confirm path, not reclaim.
  if (
    input.status === "offered"
    && input.currentAssigneeId != null
    && Number(input.currentAssigneeId) === Number(input.requesterId)
  ) {
    return { ok: false, reason: "This lead is already offered to you — confirm the offer instead." };
  }
  return { ok: true };
}
