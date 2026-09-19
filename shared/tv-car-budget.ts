/**
 * How long anyone may spend in the car garage in a day.
 *
 * Ethan, 16 Sep 2026: "only allow someone to change their car for max of 15
 * mins a day on that tab and then lock it out." The garage is a nice thing to
 * have on a sales floor and a terrible thing to have open all afternoon, so it
 * gets a quarter of an hour and then closes until tomorrow.
 *
 * It is ACTIVE time, not a window from when the tab was first opened. The page
 * sends a tick while it is open and in front, and each tick can only ever buy
 * the time that actually passed since the last one — so stepping away from the
 * desk does not burn the budget, and neither does leaving the tab open behind
 * the dialer. What it cannot do is buy more time than has elapsed: the tick is
 * credited server-side from the stored clock, never from anything the browser
 * claims.
 *
 * Reading is always allowed. Locked means you cannot CHANGE the car — the
 * garage still shows you what you have.
 *
 * Pure, so the arithmetic is testable without a clock, a browser or a table.
 */

/** Fifteen minutes a day, per person. */
export const TV_CAR_DAILY_SECONDS = 15 * 60;
/** How often the open tab reports in. */
export const TV_CAR_TICK_MS = 15_000;
/**
 * The most one tick may ever credit. A tab that was backgrounded for an hour
 * comes back and reports once; without this it would spend the whole budget in
 * a single call. Generous enough to absorb a slow network, mean enough that a
 * gap has to be paid for in real ticks.
 */
export const TV_CAR_MAX_TICK_SECONDS = 30;
/** The office's day, not the viewer's: the budget rolls over at Pacific midnight. */
export const TV_CAR_BUDGET_TZ = "America/Los_Angeles";

export interface TvCarBudget {
  /** Seconds spent in the garage today. */
  used: number;
  /** Seconds left before it locks. Never negative. */
  remaining: number;
  /** True once the day's time is gone: no more changes until tomorrow. */
  locked: boolean;
  /** The Pacific day this budget belongs to, as YYYY-MM-DD. */
  day: string;
}

/**
 * The calendar day `nowMs` falls in, where the office is.
 *
 * Formatted from the zone rather than sliced off an ISO string: an ISO string
 * is UTC, so anything after 5 PM Pacific would be filed on tomorrow and hand
 * somebody a second fifteen minutes in the same afternoon.
 */
export function tvCarBudgetDay(nowMs: number, tz: string = TV_CAR_BUDGET_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(Number.isFinite(nowMs) ? nowMs : Date.now()));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * What a stored second count means, clamped so bad data cannot unlock anyone.
 *
 * `dailySeconds` defaults to the base fifteen minutes. The garage shop can
 * permanently add time (see shared/tv-car-shop.ts); the allowance is still
 * clamped so a corrupt bonus cannot invent an all-day session.
 */
export function tvCarBudget(usedSeconds: number, day: string, dailySeconds: number = TV_CAR_DAILY_SECONDS): TvCarBudget {
  const rawDaily = Number(dailySeconds);
  const allowance = Number.isFinite(rawDaily) && rawDaily > 0
    ? Math.min(TV_CAR_DAILY_SECONDS + 30 * 60, Math.max(TV_CAR_DAILY_SECONDS, Math.floor(rawDaily)))
    : TV_CAR_DAILY_SECONDS;
  const stored = Number(usedSeconds);
  // Anything that is not a real number is treated as nothing spent. A corrupt
  // row should not be able to lock somebody out of their own car.
  const used = Number.isFinite(stored) ? Math.min(allowance, Math.max(0, Math.floor(stored))) : 0;
  const remaining = Math.max(0, allowance - used);
  return { used, remaining, locked: remaining <= 0, day };
}

/**
 * What this tick is worth.
 *
 * `sinceMs` is the gap between the stored last tick and now, measured on the
 * server. A first tick of the day, a clock that went backwards, and a tab that
 * slept through lunch all settle to something sane.
 */
export function tvCarTickSeconds(sinceMs: number | null | undefined): number {
  const gap = Number(sinceMs);
  if (!Number.isFinite(gap) || gap <= 0) return 1;
  return Math.min(TV_CAR_MAX_TICK_SECONDS, Math.max(1, Math.round(gap / 1000)));
}

/** "12 min left today", for the page and for the lock notice. */
export function formatTvCarRemaining(remaining: number): string {
  const seconds = Math.max(0, Math.floor(Number(remaining) || 0));
  if (seconds <= 0) return "no time left today";
  if (seconds < 60) return `${seconds} sec left today`;
  return `${Math.ceil(seconds / 60)} min left today`;
}
