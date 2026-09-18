/**
 * The Play-race button's day replay.
 *
 * Ethan: play today's race with cars on a clock of eight seconds per hour,
 * skip hours when nobody got a transfer, and leave Elleine off the field.
 *
 * Pure: the server supplies per-hour credits; the client builds frames and
 * walks them. Empty hours never become frames, so the wall does not sit still
 * for eight seconds of nothing.
 */
import type { RankRow } from "./tv-overtake";
import { officeClock } from "./tv-hourly-race";
import { isStatsExcluded } from "./stats-exclusions";

/** Wall time each non-empty office hour occupies on the replay. */
export const DAY_RACE_SECONDS_PER_HOUR = 8;

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
  userId: number;
  credit: number;
};

export type DayRaceFrame = {
  hour: number;
  people: RankRow[];
};

/** Office-local hour for an ISO stamp, or null when the stamp is unusable. */
export function officeHourFromIso(iso: string, tz: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return officeClock(ms, tz).hour;
}

function snapshot(roster: RankRow[], totals: Map<number, number>): RankRow[] {
  return roster.map((person) => ({
    id: person.id,
    name: person.name,
    transfersToday: totals.get(person.id) ?? 0,
    ...(person.car ? { car: person.car } : {}),
  }));
}

/**
 * Cumulative standings after each office hour that had any credit among the
 * included field. Hours with no transfers are omitted. Elleine is dropped
 * from the roster before any credit is applied.
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
  const byHour = new Map<number, Map<number, number>>();
  for (const row of hourCredits) {
    if (!ids.has(row.userId) || !(row.credit > 0) || !Number.isFinite(row.credit)) continue;
    if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
    let bucket = byHour.get(row.hour);
    if (!bucket) {
      bucket = new Map();
      byHour.set(row.hour, bucket);
    }
    bucket.set(row.userId, (bucket.get(row.userId) ?? 0) + row.credit);
  }

  const hours = Array.from(byHour.keys()).sort((a, b) => a - b);
  const totals = new Map(field.map((person) => [person.id, 0] as const));
  const frames: DayRaceFrame[] = [];
  for (const hour of hours) {
    for (const [userId, credit] of byHour.get(hour)!) {
      totals.set(userId, (totals.get(userId) ?? 0) + credit);
    }
    frames.push({ hour, people: snapshot(field, totals) });
  }
  return frames;
}

/** How long the 3D scene should keep drawing for a day replay. */
export function dayRaceRunSeconds(frameCount: number): number {
  if (frameCount <= 0) return DAY_RACE_SECONDS_PER_HOUR;
  return frameCount * DAY_RACE_SECONDS_PER_HOUR;
}

/** Overlay hold: scene length plus a short beat on the final order. */
export function dayRaceMomentMs(frameCount: number): number {
  return (dayRaceRunSeconds(frameCount) + 0.6) * 1000;
}

/** Zeroed copy of a roster — the grid the first hour accelerates away from. */
export function dayRaceStartingGrid(roster: readonly RankRow[], raceDate?: string | null): RankRow[] {
  return filterDayRaceField(roster, raceDate).map((person) => ({
    id: person.id,
    name: person.name,
    transfersToday: 0,
    ...(person.car ? { car: person.car } : {}),
  }));
}
