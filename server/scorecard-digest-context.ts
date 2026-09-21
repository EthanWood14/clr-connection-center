import { normalizeLeaveKind, LEAVE_KIND_LABELS } from "@shared/half-day";

export type ScorecardDigestContext = {
  attendance: Array<{ name: string; from: string; to: string; label: string }>;
  eodNotes: Array<{ name: string; date: string; notes: string }>;
};

/** Existing manager recipients only. No medical reasons, private reviews,
 * borrower details, or cross-organization records are selected here. */
export function loadScorecardDigestContext(db: any, orgId: number, from: string, to: string): ScorecardDigestContext {
  if (!Number.isSafeInteger(orgId) || orgId <= 0) throw new Error("Digest requires an organization");
  const leave = db.prepare(`
    SELECT u.name, r.start_date, r.end_date, r.day_portion, r.leave_kind
    FROM time_off_requests r JOIN users u ON u.id=r.user_id AND u.org_id=r.org_id
    WHERE r.org_id=? AND r.status='approved' AND r.start_date<=? AND r.end_date>=?
      AND (u.portal IS NULL OR u.portal='c3')
    ORDER BY u.name, r.start_date
  `).all(orgId, to, from) as any[];
  const absences = db.prepare(`
    SELECT u.name, a.attendance_date
    FROM attendance_excuse_requests a JOIN users u ON u.id=a.subject_id AND u.org_id=a.org_id
    WHERE a.org_id=? AND a.subject_type='user' AND a.kind='absence' AND a.status='approved'
      AND COALESCE(a.hide_from_digest,0)=0 AND a.attendance_date BETWEEN ? AND ?
      AND (u.portal IS NULL OR u.portal='c3')
      AND NOT EXISTS (SELECT 1 FROM time_off_requests r WHERE r.org_id=a.org_id AND r.user_id=a.subject_id
        AND r.status='approved' AND r.start_date<=a.attendance_date AND r.end_date>=a.attendance_date)
    ORDER BY u.name, a.attendance_date
  `).all(orgId, from, to) as any[];
  // EOD has no org_id: the owning user is the tenant boundary.
  const notes = db.prepare(`
    SELECT u.name, e.report_date, e.notes
    FROM eod_reports e JOIN users u ON u.id=e.assistant_id
    WHERE u.org_id=? AND e.report_date BETWEEN ? AND ? AND trim(COALESCE(e.notes,''))<>''
      AND (u.portal IS NULL OR u.portal='c3')
    ORDER BY e.report_date DESC, u.name
  `).all(orgId, from, to) as any[];
  return {
    attendance: [
      ...leave.map(r => ({ name: String(r.name), from: r.start_date < from ? from : r.start_date,
        to: r.end_date > to ? to : r.end_date,
        label: r.day_portion === "half" ? "Half day" : LEAVE_KIND_LABELS[normalizeLeaveKind(r.leave_kind)] })),
      ...absences.map(r => ({ name: String(r.name), from: r.attendance_date, to: r.attendance_date, label: "Excused absence" })),
    ],
    eodNotes: notes.map(r => ({ name: String(r.name), date: String(r.report_date), notes: String(r.notes).trim() })),
  };
}
