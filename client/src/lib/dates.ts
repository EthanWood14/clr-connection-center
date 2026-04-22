// Shared timestamp helpers for the client.
//
// SQLite's datetime('now') returns values like "2026-04-22 23:15:00" — UTC but
// without a trailing Z. JavaScript's Date constructor treats strings without a
// timezone designator as LOCAL time, which silently shifts everything by the
// viewer's UTC offset. Always normalize before parsing.

function normalizeToUtc(input: string): string {
  const s = input.trim();
  if (!s) return s;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return s.replace(" ", "T") + "Z";
}

export function parseServerTimestamp(input: string | number | Date | null | undefined): Date | null {
  if (input == null || input === "") return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input === "number") {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(normalizeToUtc(input));
  return isNaN(d.getTime()) ? null : d;
}

function resolveTimezone(tz?: string): string | undefined {
  if (tz && typeof tz === "string") return tz;
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
}

export function formatLocalTime(
  input: string | number | Date | null | undefined,
  timezoneOrOptions?: string | Intl.DateTimeFormatOptions,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = parseServerTimestamp(input);
  if (!d) return "";
  const tz = typeof timezoneOrOptions === "string" ? timezoneOrOptions : undefined;
  const opts = typeof timezoneOrOptions === "string" ? options : timezoneOrOptions;
  return d.toLocaleString("en-US", {
    timeZone: resolveTimezone(tz),
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
  });
}

export function formatLocalDate(
  input: string | number | Date | null | undefined,
  timezoneOrOptions?: string | Intl.DateTimeFormatOptions,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = parseServerTimestamp(input);
  if (!d) return "";
  const tz = typeof timezoneOrOptions === "string" ? timezoneOrOptions : undefined;
  const opts = typeof timezoneOrOptions === "string" ? options : timezoneOrOptions;
  return d.toLocaleDateString("en-US", {
    timeZone: resolveTimezone(tz),
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    ...opts,
  });
}

export function formatLocalClock(
  input: string | number | Date | null | undefined,
  timezone?: string,
): string {
  const d = parseServerTimestamp(input);
  if (!d) return "";
  return d.toLocaleTimeString("en-US", {
    timeZone: resolveTimezone(timezone),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
