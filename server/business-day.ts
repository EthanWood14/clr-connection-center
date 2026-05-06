// Business-day calendar helpers.
//
// The system uses a 10pm forward rollover: a moment after 10:00pm in the user's
// local timezone is already considered the *next* calendar day for reporting,
// dashboards, EOD reports, leaderboards, follow-ups, and any other "today" logic.
//
// All exported functions return ISO date strings ("YYYY-MM-DD"). They never
// touch wall-clock components other than to compute the date label \u2014 they do
// not return Date objects, to avoid downstream timezone bugs.

const ROLLOVER_HOUR = 22; // 10pm \u2014 first hour of the *next* business day
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

// Get the hour-of-day (0\u201323) of the given Date as observed in the given timezone.
function hourInTz(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const h = parts.find(p => p.type === "hour")?.value ?? "0";
  // hour12:false can return "24" at midnight in some locales \u2014 normalize.
  const n = parseInt(h, 10);
  return isNaN(n) ? 0 : (n === 24 ? 0 : n);
}

// Add `days` calendar days to an ISO "YYYY-MM-DD" string. Pure string math \u2014
// no timezone confusion possible.
export function addIsoDays(iso: string, days: number): string {
  // Treat as a date-only at noon UTC so DST shifts can't push the date.
  const [y, m, d] = iso.split("-").map(n => parseInt(n, 10));
  const t = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  t.setUTCDate(t.getUTCDate() + days);
  return formatDateInTz(t, "UTC");
}

/**
 * Business "today" in the given timezone, with 10pm forward rollover.
 *
 * Examples (TZ = America/Los_Angeles):
 *   2026-05-05 21:59 PT \u2192 "2026-05-05"
 *   2026-05-05 22:00 PT \u2192 "2026-05-06"
 *   2026-05-06 03:00 PT \u2192 "2026-05-06"
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
