// Business-day calendar helpers.
//
// The business day rolls over at 7:00pm (19:00) in the user's local timezone:
// anything logged before 7pm counts toward the current calendar day, and from
// 7pm onward counts toward the NEXT day. This "today" logic drives reporting,
// dashboards, EOD reports, leaderboards, follow-ups, and anything else
// date-based, so a CLR can submit their EOD for "today" any time up to 7pm.
//
// All exported functions return ISO date strings ("YYYY-MM-DD"). They never
// touch wall-clock components other than to compute the date label - they do
// not return Date objects, to avoid downstream timezone bugs.

const ROLLOVER_HOUR = 19; // 7pm - first hour counted as the *next* business day
const DEFAULT_TZ = "America/Los_Angeles";

// Format any Date as "YYYY-MM-DD" *as observed in* the given IANA timezone.
function formatDateInTz(d: Date, tz: string): string {
  // en-CA gives us ISO-style YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Get the hour-of-day (0-23) of the given Date as observed in the given timezone.
function hourInTz(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find(p => p.type === "hour")?.value ?? "0";
  // hour12:false can return "24" at midnight in some locales - normalize.
  const n = parseInt(h, 10);
  return isNaN(n) ? 0 : (n === 24 ? 0 : n);
}

// Add `days` calendar days to an ISO "YYYY-MM-DD" string. Pure string math -
// no timezone confusion possible.
export function addIsoDays(iso: string, days: number): string {
  // Treat as a date-only at noon UTC so DST shifts can't push the date.
  const [y, m, d] = iso.split("-").map(n => parseInt(n, 10));
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + days);
  return formatDateInTz(t, "UTC");
}

/**
 * Return completed weekdays immediately before an effective business date.
 *
 * Callers should pass businessTodayInTz()/businessTodayForRequest() as the
 * anchor. At 6:59pm Friday that anchor is Friday, so Thursday is first. At
 * 7:00pm it is Saturday, so Friday becomes the first completed weekday.
 */
export function previousWeekdaysFromBusinessDate(
  businessDate: string,
  limit = 3,
  maxLookbackDays = 10,
): string[] {
  const weekdays: string[] = [];
  for (let daysBack = 1; daysBack <= maxLookbackDays && weekdays.length < limit; daysBack++) {
    const candidate = addIsoDays(businessDate, -daysBack);
    const [y, m, d] = candidate.split("-").map(n => parseInt(n, 10));
    const dow = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();
    if (dow !== 0 && dow !== 6) weekdays.push(candidate);
  }
  return weekdays;
}

/**
 * Dates whose EOD reports are due as of `now` in the given timezone.
 * This is the authoritative composition used by the required-report lock.
 */
export function requiredEodWeekdaysInTz(
  tz: string | null | undefined,
  now: Date = new Date(),
  limit = 3,
  maxLookbackDays = 10,
): string[] {
  return previousWeekdaysFromBusinessDate(
    businessTodayInTz(tz, now),
    limit,
    maxLookbackDays,
  );
}

/**
 * Business "today" in the given timezone, with a 7pm rollover.
 *
 * Examples (TZ = America/Los_Angeles):
 *   2026-05-05 18:59 PT -> "2026-05-05"  (before 7pm: still today)
 *   2026-05-05 19:00 PT -> "2026-05-06"  (7pm onward: counts as the next day)
 *   2026-05-06 08:00 PT -> "2026-05-06"
 */
export function businessTodayInTz(tz: string | null | undefined, now: Date = new Date()): string {
  const zone = tz || DEFAULT_TZ;
  const calendarDate = formatDateInTz(now, zone);
  const hour = hourInTz(now, zone);
  return hour >= ROLLOVER_HOUR ? addIsoDays(calendarDate, 1) : calendarDate;
}

/**
 * Same idea, but also returns yesterday/tomorrow business dates. Useful when
 * computing windows ("last 7 business days", "previous business day").
 */
export function businessDayInfo(tz: string | null | undefined, now: Date = new Date()) {
  const today = businessTodayInTz(tz, now);
  return {
    today,
    yesterday: addIsoDays(today, -1),
    tomorrow:  addIsoDays(today, 1),
    timezone: tz || DEFAULT_TZ,
    rolloverHour: ROLLOVER_HOUR,
  };
}

/**
 * Resolve a request's effective timezone. Prefers the authenticated user's
 * configured timezone, falls back to the system default. Accepts the full
 * Express request or just the user record.
 */
export function tzFromRequest(req: any, sqlite?: any): string {
  // 1) If middleware already attached a user object with timezone.
  const u = (req?.user ?? req?.session_user_obj) as any;
  if (u?.timezone) return u.timezone;
  // 2) Look it up by session_user.userId if a sqlite handle was passed.
  const uid = req?.session_user?.userId;
  if (uid && sqlite) {
    try {
      const row = sqlite.prepare("SELECT timezone FROM users WHERE id = ?").get(uid) as any;
      if (row?.timezone) return row.timezone;
    } catch { /* table may not exist in tests */ }
  }
  return DEFAULT_TZ;
}

/**
 * Convenience: business "today" for the authenticated requester.
 */
export function businessTodayForRequest(req: any, sqlite?: any, now: Date = new Date()): string {
  return businessTodayInTz(tzFromRequest(req, sqlite), now);
}

export const BUSINESS_DAY_ROLLOVER_HOUR = ROLLOVER_HOUR;
export const BUSINESS_DAY_DEFAULT_TZ = DEFAULT_TZ;

/**
 * Returns true if the given user has already submitted an EOD report for the
 * given business date. Used by the post-EOD rollover logic: any new activity
 * a CLR logs after submitting today's EOD should count toward tomorrow.
 */
export function hasEodSubmittedForDate(sqlite: any, userId: number | null | undefined, date: string): boolean {
  if (!sqlite || !userId || !date) return false;
  try {
    const row = sqlite
      .prepare(`SELECT 1 FROM eod_reports WHERE assistant_id = ? AND report_date = ?`)
      .get(userId, date);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Roll a target business date forward by one day if the user has already
 * submitted their EOD report for that date. Otherwise returns the date
 * unchanged. Use this anywhere a CLR is logging time-sensitive activity
 * (lead outcomes, call logs, EOD extra activities) so that anything done
 * after they wrap up today flows naturally into tomorrow's report.
 */
export function rolloverIfEodSubmitted(sqlite: any, userId: number | null | undefined, date: string): string {
  if (!date) return date;
  return hasEodSubmittedForDate(sqlite, userId, date) ? addIsoDays(date, 1) : date;
}

/**
 * Parse a wall-clock string (e.g. "2026-05-06T15:00" or "2026-05-06 15:00")
 * as if it were observed in the given IANA timezone, and return the
 * corresponding absolute Unix epoch in ms.
 *
 * Why this exists: HTML <input type="datetime-local"> values have NO timezone
 * suffix, so Date.parse() interprets them in the *runtime's* local timezone.
 * On a server running in UTC (e.g. Railway), that means "3:00 PM picked by a
 * Pacific user" gets parsed as 3:00 PM UTC, which is 8:00 AM Pacific — 7 hours
 * earlier than intended. This helper fixes the interpretation by resolving
 * the wall-clock time in the user's actual timezone.
 *
 * Strings already containing an explicit offset ("...Z", "...+05:00") are
 * passed straight through to Date.parse() and the tz argument is ignored.
 */
export function parseWallClockInTz(input: string | null | undefined, tz: string): number {
  if (!input) return NaN;
  const s = String(input).trim();
  if (!s) return NaN;
  // If the string already has an explicit timezone offset / Z, just parse it.
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s)) return Date.parse(s);
  // Match "YYYY-MM-DD" with optional time "HH:MM" or "HH:MM:SS" (separator T or space).
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return Date.parse(s); // give Date.parse a last shot, even if imperfect
  const [, y, mo, d, hh, mm, ss] = m;
  const yi  = parseInt(y, 10);
  const moi = parseInt(mo, 10);
  const di  = parseInt(d, 10);
  const hi  = hh != null ? parseInt(hh, 10) : 0;
  const mi  = mm != null ? parseInt(mm, 10) : 0;
  const si  = ss != null ? parseInt(ss, 10) : 0;
  // Strategy: pick the UTC instant that, when displayed in `tz`, yields the
  // requested wall-clock components. Start with a guess (the desired wall
  // clock interpreted as UTC), then correct by the timezone's offset at that
  // instant. Two iterations handle DST edge cases.
  let guess = Date.UTC(yi, moi - 1, di, hi, mi, si);
  for (let iter = 0; iter < 2; iter++) {
    const offsetMs = tzOffsetMsAt(guess, tz);
    guess = Date.UTC(yi, moi - 1, di, hi, mi, si) - offsetMs;
  }
  return guess;
}

// Returns the offset (ms) from UTC that the given timezone is observing at the
// given instant. East-of-UTC is positive, west-of-UTC is negative — same
// convention as date-fns / luxon. Used internally by parseWallClockInTz.
function tzOffsetMsAt(instantMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(instantMs));
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value || "0", 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - instantMs;
}
