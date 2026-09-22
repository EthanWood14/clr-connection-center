/**
 * When the Shotgun stops asking, and who counts as being there to ask.
 *
 * Measured on prod 22 Sep 2026, over ten days: 40,816 offers, 40,026 of them
 * expired, 255 confirmed. Between midnight and 5 AM Pacific the rotation was
 * dealing about 2,600 offers an hour and confirming exactly none of them, and
 * the quietest hour of the day was one in the afternoon — the Shotgun was
 * busiest precisely when nobody could act on it. Two faults, both here:
 *
 *   NOTHING EVER RETIRED A LEAD. An unclaimed lead went back in the queue for
 *   ever. Fifty-eight were still cycling, the oldest published a hundred and
 *   eleven hours earlier, and seven leads had been offered about fifteen
 *   hundred times each. A lead that nobody has taken in half an hour of
 *   full-screen cards and chimes is not going to be taken on the next lap
 *   (owner, 22 Sep 2026: "how do we have the shotgun feature calm down in the
 *   morning, it goes crazy?").
 *
 *   AN OPEN TAB COUNTED AS A PERSON. Readiness was a heartbeat from a loaded
 *   page, so a machine left on at an empty desk stayed in the rotation all
 *   night and absorbed the offers. Someone arriving in the morning sat down to
 *   a screen that had been chiming at an empty chair since they left (owner,
 *   22 Sep 2026: "only if someone is actively signed into C3 tho").
 *
 * The hours themselves are deliberately NOT restricted — a lead that comes in
 * at nine at night should still find whoever is working. What changes is that
 * it asks for half an hour and then stops, and that it only asks people who
 * are actually at the keyboard.
 *
 * Pure, so both rules can be walked in a test without a clock or a browser.
 */

/**
 * How long a published lead keeps being offered before it gives up.
 *
 * Thirty minutes: with a ten-second offer window and a five-minute per-person
 * cooldown that is about six full laps of the floor.
 */
export const SHOTGUN_NO_TAKERS_MS = 30 * 60_000;

/** What a lead becomes when its half hour is up. Parked, not cancelled. */
export const SHOTGUN_NO_TAKERS_STATUS = "no_takers";

/**
 * How long after someone's last real interaction their browser still counts as
 * a person sitting in front of C3.
 *
 * Fifteen minutes is long enough to read a lead card, take a call or write an
 * outcome without dropping out of the rotation, and short enough that a
 * machine left on overnight is gone within the quarter hour.
 */
export const SHOTGUN_ACTIVE_IDLE_MS = 15 * 60_000;

/** When a lead published at `createdAt` stops being offered. */
export function shotgunGiveUpAt(createdAt: string | number | Date): number {
  const published = createdAt instanceof Date ? createdAt.getTime()
    : typeof createdAt === "number" ? createdAt : Date.parse(String(createdAt));
  return Number.isFinite(published) ? published + SHOTGUN_NO_TAKERS_MS : Number.POSITIVE_INFINITY;
}

/**
 * Has this lead run out of road?
 *
 * A lead whose publication time we cannot read is never retired: a parsing
 * problem must not silently stop a real lead from reaching the floor.
 */
export function shotgunOutOfTime(createdAt: string | number | Date, now = Date.now()): boolean {
  const deadline = shotgunGiveUpAt(createdAt);
  return Number.isFinite(deadline) && now >= deadline;
}

/**
 * Is there a person at this browser?
 *
 * `lastInteractionAt` is the last pointer, key or focus event the page saw.
 * A page that has never seen one — freshly loaded, or restored into a
 * background tab — is not a person yet.
 */
export function shotgunPersonPresent(
  lastInteractionAt: number | null | undefined,
  now = Date.now(),
  visible = true,
): boolean {
  if (!visible) return false;
  const last = Number(lastInteractionAt);
  if (!Number.isFinite(last) || last <= 0) return false;
  // A clock that jumped backwards must not grant an infinite session.
  return now - last >= 0 && now - last < SHOTGUN_ACTIVE_IDLE_MS;
}
