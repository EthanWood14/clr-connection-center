/**
 * The Play-race button's day replay.
 *
 * Ethan: play today's race 4× faster than the original eight seconds per hour
 * (two seconds per hour), advance by office minute so cars move on their own
 * transfer times instead of one shared hour tick, skip empty stretches, and
 * leave Elleine off the field.
 *
 * Pure: the server supplies per-minute credits; the client builds frames and
 * walks them. Empty minutes never become frames. Wall duration is still one
 * hour-slot (DAY_RACE_SECONDS_PER_HOUR) per non-empty office hour — minutes
 * inside that hour are spread across the slot so the day stays ~4× shorter
 * overall without reintroducing hour-synced jumps.
 */
import type { RankRow } from "./tv-overtake";
import { officeClock } from "./tv-hourly-race";
import { isStatsExcluded } from "./stats-exclusions";

/** Wall seconds each non-empty office hour occupies on the replay (was 8). */
export const DAY_RACE_SECONDS_PER_HOUR = 2;

/** Wall ms for one office minute inside an active hour slot. */
export const DAY_RACE_MS_PER_MINUTE = (DAY_RACE_SECONDS_PER_HOUR * 1000) / 60;

/**
 * Helpers who should not appear on the day-race field. Same whole-word match
 * the tournament uses ("Elleine Asuncion", "Elleine"), case-insensitive.
 */
export const DAY_RACE_EXCLUDED_NAME_RE = /\b(elleine|ellaine|eliane)\b/i;

export function isDayRaceExcluded(
  name: string | null | undefined,
  date?: string | null,
): boolean {
  const n = String(name ?? "").trim();
  if (DAY_RACE_EXCLUDED_NAME_RE.test(n)) return true;
  return isStatsExcluded(n, date);
}

export function filterDayRaceField<T extends { name: string }>(
  people: readonly T[],
  date?: string | null,
): T[] {
  return people.filter((person) => !isDayRaceExcluded(person.name, date));
}

export type DayRaceHourCredit = {
  /** Office-local hour 0–23 the credit landed in. */
  hour: number;
  /** Office-local minute 0–59 within that hour (0 when unknown). */
  minute: number;
  userId: number;
  credit: number;
};

export type DayRaceFrame = {
  hour: number;
  minute: number;
  people: RankRow[];
};

/** Office-local hour + minute for an ISO stamp, or null when unusable. */
export function officeStampFromIso(iso: string, tz: string): { hour: number; minute: number } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const { hour, minute } = officeClock(ms, tz);
  return { hour, minute };
}

/** Office-local hour for an ISO stamp, or null when the stamp is unusable. */
export function officeHourFromIso(iso: string, tz: string): number | null {
  return officeStampFromIso(iso, tz)?.hour ?? null;
}

function snapshot(roster: RankRow[], totals: Map<number, number>): RankRow[] {
  return roster.map((person) => ({
    id: person.id,
    name: person.name,
    transfersToday: totals.get(person.id) ?? 0,
    ...(person.car ? { car: person.car } : {}),
  }));
}

function creditMinute(row: DayRaceHourCredit): number {
  if (!Number.isInteger(row.minute) || row.minute < 0 || row.minute > 59) return 0;
  return row.minute;
}

/** Sorted unique office hours that have at least one field credit. */
export function dayRaceActiveHours(frames: readonly { hour: number }[]): number[] {
  return Array.from(new Set(frames.map((frame) => frame.hour))).sort((a, b) => a - b);
}

/**
 * Wall-clock ms when a minute-frame should apply, measured from race start.
 * Minutes are spread across the hour's DAY_RACE_SECONDS_PER_HOUR slot.
 */
export function dayRaceFrameOffsetMs(frame: { hour: number; minute: number }, activeHours: readonly number[]): number {
  const hourIndex = activeHours.indexOf(frame.hour);
  if (hourIndex < 0) return 0;
  const minute = Number.isInteger(frame.minute) && frame.minute >= 0 && frame.minute <= 59 ? frame.minute : 0;
  return (hourIndex * DAY_RACE_SECONDS_PER_HOUR + (minute / 60) * DAY_RACE_SECONDS_PER_HOUR) * 1000;
}

/**
 * Cumulative standings after each office minute that had any credit among the
 * included field. Empty minutes are omitted. Elleine is dropped from the roster
 * before any credit is applied.
 */
export function buildDayRaceTimeline(
  roster: readonly RankRow[],
  hourCredits: readonly DayRaceHourCredit[],
  raceDate?: string | null,
): DayRaceFrame[] {
  const field = filterDayRaceField(roster, raceDate).map((person) => ({
    id: person.id,
    name: person.name,
    transfersToday: 0,
    ...(person.car ? { car: person.car } : {}),
  }));
  if (!field.length) return [];

  const ids = new Set(field.map((person) => person.id));
  const byMinute = new Map<number, Map<number, number>>();
  for (const row of hourCredits) {
    if (!ids.has(row.userId) || !(row.credit > 0) || !Number.isFinite(row.credit)) continue;
    if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
    const minute = creditMinute(row);
    const key = row.hour * 60 + minute;
    let bucket = byMinute.get(key);
    if (!bucket) {
      bucket = new Map();
      byMinute.set(key, bucket);
    }
    bucket.set(row.userId, (bucket.get(row.userId) ?? 0) + row.credit);
  }

  const keys = Array.from(byMinute.keys()).sort((a, b) => a - b);
  const totals = new Map(field.map((person) => [person.id, 0] as const));
  const frames: DayRaceFrame[] = [];
  for (const key of keys) {
    for (const [userId, credit] of byMinute.get(key)!) {
      totals.set(userId, (totals.get(userId) ?? 0) + credit);
    }
    frames.push({
      hour: Math.floor(key / 60),
      minute: key % 60,
      people: snapshot(field, totals),
    });
  }
  return frames;
}

/** How long the 3D scene should keep drawing for a day replay. */
export function dayRaceRunSeconds(activeHourCount: number): number {
  if (activeHourCount <= 0) return DAY_RACE_SECONDS_PER_HOUR;
  return activeHourCount * DAY_RACE_SECONDS_PER_HOUR;
}

/** Overlay hold: scene length plus a short beat on the final order. */
export function dayRaceMomentMs(activeHourCount: number): number {
  return (dayRaceRunSeconds(activeHourCount) + 0.6) * 1000;
}

/** Zeroed copy of a roster — the grid the first transfer accelerates away from. */
export function dayRaceStartingGrid(roster: readonly RankRow[], raceDate?: string | null): RankRow[] {
  return filterDayRaceField(roster, raceDate).map((person) => ({
    id: person.id,
    name: person.name,
    transfersToday: 0,
    ...(person.car ? { car: person.car } : {}),
  }));
}
