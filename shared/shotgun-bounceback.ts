/**
 * Timed Shotgun bounceback (Ethan, 2026-09-18): for one Pacific calendar week,
 * 35 minutes after a new Shotgun lead is enqueued, if that lead still has no
 * transfer and no appointment, Ready CLRs get a bounceback popup to work it
 * again. One bounceback per lead. Auto-off after the end date.
 *
 * Window style matches Markus timed needs_transfers pin (America/Los_Angeles
 * inclusive calendar dates).
 */

/** Inclusive Pacific calendar day YYYY-MM-DD. */
export const SHOTGUN_BOUNCEBACK_START_DATE = "2026-09-18";
/** Inclusive Pacific calendar day YYYY-MM-DD — feature auto-off after this day. */
export const SHOTGUN_BOUNCEBACK_END_DATE = "2026-09-25";

export const SHOTGUN_BOUNCEBACK_AFTER_MS = 35 * 60_000;

export const SHOTGUN_BOUNCEBACK_REASON =
  "Ethan 2026-09-18: Shotgun bounceback popup 35m after new lead if no transfer/appt (one week)";

/** Pacific calendar date YYYY-MM-DD for `when` (defaults to now). */
export function pacificCalendarDate(when: Date = new Date()): string {
  return when.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** True while the one-week feature window is active (inclusive ends). */
export function isShotgunBouncebackWeekActive(
  ptDate: string = pacificCalendarDate(),
): boolean {
  const day = String(ptDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day >= SHOTGUN_BOUNCEBACK_START_DATE && day <= SHOTGUN_BOUNCEBACK_END_DATE;
}

/** ISO timestamp when bounceback becomes due for a lead created at `createdAt`. */
export function shotgunBouncebackDueAt(createdAt: string): string | null {
  const at = Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(at)) return null;
  return new Date(at + SHOTGUN_BOUNCEBACK_AFTER_MS).toISOString();
}

/** Normalize a phone the same way Shotgun phone_key is built. */
export function shotgunBouncebackPhoneKey(value: string | null | undefined): string {
  const d = String(value ?? "").replace(/\D+/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}

export type ShotgunBouncebackOutcomeHit = {
  outcomeType: string | null | undefined;
};

/**
 * True when a linked or phone-matched outcome counts as "first one transferred
 * or an appt scheduled" — skip bounceback.
 */
export function shotgunBouncebackHasTransferOrAppointment(
  hits: readonly ShotgunBouncebackOutcomeHit[],
): boolean {
  for (const hit of hits) {
    const kind = String(hit.outcomeType ?? "").trim().toLowerCase();
    if (kind === "transfer" || kind === "appointment") return true;
  }
  return false;
}

export type ShotgunBouncebackFireDecision =
  | { action: "skip_inactive" }
  | { action: "skip_not_due" }
  | { action: "skip_already_fired" }
  | { action: "skip_has_outcome" }
  | { action: "defer_claimed" }
  | { action: "skip_cancelled" }
  | { action: "fire"; requeue: boolean };

/**
 * Pure gate for whether to fire bounceback on this lead right now.
 * - Feature off after end date (and before start).
 * - Only leads whose created_at Pacific day falls in the week.
 * - One fire per lead (`firedAt` set).
 * - Skip when a transfer or appointment is already tied to the lead/borrower.
 * - Defer while someone still holds it claimed (do not interrupt).
 * - Cancelled leads never bounce.
 * - `done` / `queued` / `offered` → fire; requeue when not already queued.
 */
export function decideShotgunBouncebackFire(input: {
  nowMs?: number;
  createdAt: string;
  firedAt: string | null | undefined;
  status: string;
  hasTransferOrAppointment: boolean;
}): ShotgunBouncebackFireDecision {
  const nowMs = input.nowMs ?? Date.now();
  const nowPt = pacificCalendarDate(new Date(nowMs));
  if (!isShotgunBouncebackWeekActive(nowPt)) return { action: "skip_inactive" };

  const createdMs = Date.parse(String(input.createdAt ?? ""));
  if (!Number.isFinite(createdMs)) return { action: "skip_not_due" };
  const createdPt = pacificCalendarDate(new Date(createdMs));
  if (!isShotgunBouncebackWeekActive(createdPt)) return { action: "skip_inactive" };

  if (input.firedAt) return { action: "skip_already_fired" };
  if (nowMs < createdMs + SHOTGUN_BOUNCEBACK_AFTER_MS) return { action: "skip_not_due" };

  if (input.hasTransferOrAppointment) return { action: "skip_has_outcome" };

  const status = String(input.status ?? "");
  if (status === "cancelled") return { action: "skip_cancelled" };
  if (status === "claimed") return { action: "defer_claimed" };

  // done / queued / offered (and any other live non-claimed) → fire
  const requeue = status !== "queued";
  return { action: "fire", requeue };
}

export type ShotgunBouncebackAcceptDecision =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Ready CLR may accept a fired bounceback while the lead is queued or offered
 * to someone else — same live-status shape as reclaim, without prior-confirm
 * or on-the-phone requirements.
 */
export function canAcceptShotgunBounceback(input: {
  status: string;
  currentAssigneeId: number | null | undefined;
  requesterId: number;
  bouncebackFiredAt: string | null | undefined;
  hasTransferOrAppointment: boolean;
  holdingOtherClaimed: boolean;
  optedOut: boolean;
  weekActive: boolean;
}): ShotgunBouncebackAcceptDecision {
  if (!input.weekActive) {
    return { ok: false, reason: "Shotgun bounceback is only active this week." };
  }
  if (input.optedOut) {
    return { ok: false, reason: "You are opted out of the Shotgun rotation." };
  }
  if (!input.bouncebackFiredAt) {
    return { ok: false, reason: "This lead does not have an active bounceback." };
  }
  if (input.hasTransferOrAppointment) {
    return { ok: false, reason: "This lead already has a transfer or appointment." };
  }
  if (input.holdingOtherClaimed) {
    return { ok: false, reason: "Finish the lead you are already holding before taking a bounceback." };
  }
  if (input.status === "queued") return { ok: true };
  if (
    input.status === "offered"
    && input.currentAssigneeId != null
    && Number(input.currentAssigneeId) !== Number(input.requesterId)
  ) {
    return { ok: true };
  }
  if (
    input.status === "offered"
    && input.currentAssigneeId != null
    && Number(input.currentAssigneeId) === Number(input.requesterId)
  ) {
    return { ok: false, reason: "This lead is already offered to you — confirm the offer instead." };
  }
  if (input.status === "claimed") {
    return { ok: false, reason: "Someone is already working this lead." };
  }
  return { ok: false, reason: "This lead cannot be taken as a bounceback right now." };
}
