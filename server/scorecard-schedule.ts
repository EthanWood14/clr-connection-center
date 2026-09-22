import { isHalfDayPortion, normalizeLeaveKind, standingHalfDayUserIds } from "@shared/half-day";
import { isCompanyHoliday } from "@shared/company-holidays";
import { scorecardScheduleStatus, type ScorecardScheduleStatus } from "@shared/scorecard-schedule";
import { otherWorkRows } from "./other-work";

/** Read-only minimal schedule labels. Never select reasons or medical details. */
export function loadScorecardSchedules(db: any, orgId: number, date: string): Map<number, ScorecardScheduleStatus> {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) throw new Error("Schedule requires an organization");
  const parsed = new Date(date + "T12:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Schedule requires a calendar date");
  }
  const users = db.prepare(`
    SELECT id, name, is_active FROM users WHERE org_id=? AND (portal IS NULL OR portal='c3')
  `).all(orgId) as Array<{ id: number; name: string; is_active: number }>;
  const standing = standingHalfDayUserIds(users);
  const weekday = parsed.getUTCDay() >= 1 && parsed.getUTCDay() <= 5;
  const holiday = isCompanyHoliday(date);
  const result = new Map<number, ScorecardScheduleStatus>();
  const priority = new Map<number, number>();
  for (const user of users) {
    const kind = !user.is_active ? "inactive" : holiday ? "holiday" : !weekday ? "weekend" : standing.has(user.id) ? "half" : "full";
    result.set(user.id, scorecardScheduleStatus(date, kind));
    priority.set(user.id, kind === "inactive" ? 100 : kind === "half" ? 1 : 0);
  }
  const apply = (id: number, rank: number, status: ScorecardScheduleStatus) => {
    if (result.has(id) && rank > (priority.get(id) ?? 0)) {
      result.set(id, status);
      priority.set(id, rank);
    }
  };
  for (const row of otherWorkRows(db, orgId, date, date)) {
    apply(row.user_id, 4, scorecardScheduleStatus(date, "other_work"));
  }
  const leave = db.prepare(`
    SELECT r.user_id, r.day_portion, r.leave_kind
    FROM time_off_requests r JOIN users u ON u.id=r.user_id AND u.org_id=r.org_id
    WHERE r.org_id=? AND r.status='approved' AND r.start_date<=? AND r.end_date>=?
      AND (u.portal IS NULL OR u.portal='c3')
  `).all(orgId, date, date) as Array<{ user_id: number; day_portion: string | null; leave_kind: string | null }>;
  for (const row of leave) {
    const half = isHalfDayPortion(row.day_portion);
    const sick = normalizeLeaveKind(row.leave_kind).startsWith("sick_");
    // Full leave wins over standing/approved halves. For overlaps, a generic
    // sick label is more specific than PTO without exposing its documentation.
    apply(row.user_id, half ? (sick ? 3 : 2) : (sick ? 6 : 5),
      scorecardScheduleStatus(date, sick ? "sick" : half ? "half" : "time_off", half && sick));
  }
  const excuses = db.prepare(`
    SELECT a.subject_id FROM attendance_excuse_requests a
    JOIN users u ON u.id=a.subject_id AND u.org_id=a.org_id
    WHERE a.org_id=? AND a.subject_type='user' AND a.kind='absence' AND a.status='approved'
      AND a.attendance_date=? AND COALESCE(a.hide_from_digest,0)=0
      AND (u.portal IS NULL OR u.portal='c3')
  `).all(orgId, date) as Array<{ subject_id: number }>;
  for (const row of excuses) apply(row.subject_id, 4, scorecardScheduleStatus(date, "excused"));
  return result;
}
