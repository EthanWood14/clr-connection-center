/** Schedule context only: these tags never establish a day worked or alter credit. */
export type ScorecardScheduleKind = "full" | "half" | "time_off" | "sick" | "excused" | "weekend" | "holiday" | "inactive" | "unknown";
export type ScorecardScheduleStatus = {
  date: string;
  kind: ScorecardScheduleKind;
  label: string;
  detail: string;
};

export function scorecardScheduleDate(now = new Date()): string {
  // Attendance uses the calendar date, not the 7 PM reporting rollover.
  return now.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

export function scheduleDateLabel(date: string): string {
  const parsed = new Date(date + "T12:00:00Z");
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
    : date;
}

export function scorecardScheduleStatus(date: string, kind: ScorecardScheduleKind, halfSick = false): ScorecardScheduleStatus {
  const descriptions: Record<ScorecardScheduleKind, [string, string]> = {
    full: ["Full day", "Standard full-day schedule; this does not confirm attendance or a qualifying workday."],
    half: ["Half day", "Approved or standing half-day schedule; qualifying workdays still use the existing 0.5 weight."],
    time_off: ["Time off", "Approved full day off."],
    sick: [halfSick ? "Sick · half day" : "Sick", halfSick ? "Approved half-day sick leave." : "Approved full-day sick leave."],
    excused: ["Excused absence", "Approved excused absence; no private reason is shown."],
    weekend: ["Weekend", "No standard weekday schedule inferred."],
    holiday: ["Holiday", "The office is closed for a configured company holiday."],
    inactive: ["Inactive", "This CLR is no longer on the active roster; no current schedule is assumed."],
    unknown: ["Schedule unavailable", "Schedule information could not be loaded; no full-day status is assumed."],
  };
  const [label, detail] = descriptions[kind];
  return { date, kind, label, detail };
}
