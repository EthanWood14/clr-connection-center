/**
 * The race the wall plays for everybody, at the top of every hour.
 *
 * Ethan, 16 Sep 2026: "at the top of every hour, show the entire race for the
 * day." The per-transfer race is about one person passing another; this one is
 * the whole field as it stands, dealt like any other moment so it cuts in over
 * whatever page is up and the deck resumes behind it.
 *
 * Keyed by the hour it belongs to, so the board's own "already played" set is
 * what stops it repeating — a reload, a second poll inside the same minute, or
 * a dwell that straddles the hour cannot deal it twice.
 *
 * Pure, so the timing is testable without a clock or a screen.
 */

/** How long after the hour it may still start, if the wall was busy. */
export const HOURLY_RACE_GRACE_MS = 4 * 60_000;
/** The first and last hour of the day it runs, in office local time. */
export const HOURLY_RACE_FROM_HOUR = 8;
export const HOURLY_RACE_TO_HOUR = 18;

export type HourlyRaceClock = { hour: number; minute: number; date: string };

/** Wall-clock hour, minute and calendar date as the office sees them. */
export function officeClock(nowMs: number, tz: string): HourlyRaceClock {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24;
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: parseInt(get("minute"), 10) || 0,
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/** The moment key for the hour `nowMs` falls in. */
export function hourlyRaceKey(nowMs: number, tz: string): string {
  const { date, hour } = officeClock(nowMs, tz);
  return `hourly-race:${date}T${String(hour).padStart(2, "0")}`;
}

/**
 * The key to deal now, or null.
 *
 * Inside the grace window after the hour, during the working day, and not
 * already played. The caller passes its own played set — the same one the
 * board keeps for every other moment.
 */
export function dueHourlyRaceKey(
  nowMs: number,
  tz: string,
  played: ReadonlySet<string>,
  opts: { from?: number; to?: number; graceMs?: number } = {},
): string | null {
  const from = opts.from ?? HOURLY_RACE_FROM_HOUR;
  const to = opts.to ?? HOURLY_RACE_TO_HOUR;
  const grace = opts.graceMs ?? HOURLY_RACE_GRACE_MS;
  const { hour, minute } = officeClock(nowMs, tz);
  if (hour < from || hour > to) return null;
  if (minute * 60_000 > grace) return null;
  const key = hourlyRaceKey(nowMs, tz);
  return played.has(key) ? null : key;
}
