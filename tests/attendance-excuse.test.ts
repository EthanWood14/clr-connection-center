import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "c3-attendance-excuse-"));
process.env.DATABASE_PATH = join(testDir, "attendance.db");

const storage = await import("../server/storage");
const sqlite = storage.getRawSqlite();

after(() => {
  sqlite.close();
  rmSync(testDir, { recursive: true, force: true });
});

function insertUser(name: string, email: string, role: string, orgId: number): number {
  return Number(sqlite.prepare(`
    INSERT INTO users (name, email, role, is_active, org_id, is_clr)
    VALUES (?, ?, ?, 1, ?, 1)
  `).run(name, email, role, orgId).lastInsertRowid);
}

function insertUserLate(userId: number, date: string, minutesLate = 15): number {
  return Number(sqlite.prepare(`
    INSERT INTO morning_checkins (
      org_id, user_id, date, checked_in_at, expected_start, on_time,
      minutes_late, late_excused, late_alert_sent
    )
    VALUES (1, ?, ?, ?, '09:00', 0, ?, 0, 1)
  `).run(userId, date, `${date}T16:15:00.000Z`, minutesLate).lastInsertRowid);
}

test("attendance excuses stay consistent across CLR, LO, and LOA workflows", () => {
  const otherOrgId = Number(
    (sqlite.prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS id FROM organizations`).get() as any).id,
  );
  sqlite.prepare(`
    INSERT INTO organizations (id, name, slug, company_name, plan)
    VALUES (?, 'Other Org', ?, 'Other Org', 'active')
  `).run(otherOrgId, `other-org-${otherOrgId}`);

  const clrId = insertUser("Test CLR", "attendance-clr@example.test", "clr", 1);
  const adminId = insertUser("Test Admin", "attendance-admin@example.test", "admin", 1);
  const otherAdminId = insertUser(
    "Other Admin",
    "attendance-other-admin@example.test",
    "admin",
    otherOrgId,
  );

  const clrDate = "2026-07-08";
  const clrCheckinId = insertUserLate(clrId, clrDate, 19);
  const submitted = storage.submitLateExcuseRequest({
    orgId: 1,
    subjectType: "user",
    subjectId: clrId,
    attendanceDate: clrDate,
    checkinId: clrCheckinId,
    reason: "Traffic accident delayed the commute.",
    requestedVia: "app",
    requestedByUserId: clrId,
  });
  assert.equal(submitted.created, true);
  assert.equal(submitted.request.status, "pending");

  const denied = storage.reviewAttendanceExcuseRequest({
    orgId: 1,
    requestId: submitted.request.id,
    status: "denied",
    reviewedByUserId: adminId,
    reviewerNote: "Please attach supporting detail.",
  });
  assert.equal(denied.request.status, "denied");
  assert.equal(storage.getCheckinById(clrCheckinId).late_excused, 0);

  const resubmitted = storage.submitLateExcuseRequest({
    orgId: 1,
    subjectType: "user",
    subjectId: clrId,
    attendanceDate: clrDate,
    checkinId: clrCheckinId,
    reason: "Traffic accident; manager was notified before arrival.",
    requestedVia: "app",
    requestedByUserId: clrId,
  });
  assert.equal(resubmitted.resubmitted, true);
  assert.equal(resubmitted.request.status, "pending");

  const approved = storage.reviewAttendanceExcuseRequest({
    orgId: 1,
    requestId: submitted.request.id,
    status: "approved",
    reviewedByUserId: adminId,
    reviewerNote: "Approved after review.",
    lateWindowStart: "2026-04-10",
    lateWindowEnd: "2026-07-08",
  });
  assert.equal(approved.request.status, "approved");
  assert.equal(storage.getCheckinById(clrCheckinId).late_excused, 1);
  assert.equal(storage.getLateCountsByUser(1, clrDate, clrDate).get(clrId), undefined);

  const reapplied = storage.setAdminUserLateExcuse({
    orgId: 1,
    userId: clrId,
    checkinId: clrCheckinId,
    attendanceDate: clrDate,
    excused: false,
    adminUserId: adminId,
    lateWindowStart: "2026-04-10",
    lateWindowEnd: "2026-07-08",
  });
  assert.equal(reapplied.checkin.late_excused, 0);
  assert.equal(reapplied.request?.status, "cancelled");
  assert.equal(storage.getLateCountsByUser(1, clrDate, clrDate).get(clrId), 1);

  // A direct manager decision must also reconcile an older cancelled request.
  const directlyExcused = storage.setAdminUserLateExcuse({
    orgId: 1,
    userId: clrId,
    checkinId: clrCheckinId,
    attendanceDate: clrDate,
    excused: true,
    adminUserId: adminId,
    reason: "Approved directly by an administrator.",
    lateWindowStart: "2026-04-10",
    lateWindowEnd: "2026-07-08",
  });
  assert.equal(directlyExcused.checkin.late_excused, 1);
  assert.equal(directlyExcused.request?.status, "approved");

  const isolatedDate = "2026-07-15";
  const isolatedCheckinId = insertUserLate(clrId, isolatedDate, 12);
  assert.throws(
    () => storage.setAdminUserLateExcuse({
      orgId: 1,
      userId: clrId,
      checkinId: isolatedCheckinId,
      attendanceDate: isolatedDate,
      excused: true,
      adminUserId: otherAdminId,
      reason: "Cross-org decision must fail.",
    }),
    /Reviewing user was not found in this organization/,
  );
  assert.equal(storage.getCheckinById(isolatedCheckinId).late_excused, 0);

  const loId = Number(sqlite.prepare(`
    INSERT INTO loan_officers (full_name, nmls_id, org_id)
    VALUES ('Test LO', 'TEST-ATTENDANCE-LO', 1)
  `).run().lastInsertRowid);
  const loaId = Number(sqlite.prepare(`
    INSERT INTO loan_officer_assistants (lo_id, full_name, active)
    VALUES (?, 'Test LOA', 1)
  `).run(loId).lastInsertRowid);

  for (const subject of [
    { type: "lo" as const, id: loId, date: "2026-07-09" },
    { type: "loa" as const, id: loaId, date: "2026-07-10" },
  ]) {
    const checkin = storage.saveExternalCheckin({
      orgId: 1,
      type: subject.type,
      id: subject.id,
      date: subject.date,
      checkedInAt: `${subject.date}T16:20:00.000Z`,
      expectedStart: "09:00",
      onTime: 0,
      minutesLate: 20,
      lat: null,
      lng: null,
      accuracyM: null,
      distanceM: null,
      inArea: null,
    });
    const request = storage.submitLateExcuseRequest({
      orgId: 1,
      subjectType: subject.type,
      subjectId: subject.id,
      attendanceDate: subject.date,
      checkinId: Number(checkin.id),
      reason: "External portal late reason.",
      requestedVia: "portal",
      requestedByUserId: null,
    });
    const decision = storage.reviewAttendanceExcuseRequest({
      orgId: 1,
      requestId: request.request.id,
      status: "approved",
      reviewedByUserId: adminId,
    });
    assert.equal(decision.request.status, "approved");
    assert.equal(storage.getExternalCheckinById(Number(checkin.id)).late_excused, 1);
    assert.equal(
      storage.getExternalLateCounts(1, "2026-07-01", "2026-07-31")
        .get(`${subject.type}:${subject.id}`),
      undefined,
    );
  }

  const clrAbsenceDate = "2026-07-21";
  const clrAbsence = storage.createAdminAbsenceExcuse({
    orgId: 1,
    subjectType: "user",
    subjectId: clrId,
    attendanceDate: clrAbsenceDate,
    expectedStart: "09:00",
    reason: "Approved absence.",
    adminUserId: adminId,
  });
  assert.equal(clrAbsence.request.status, "approved");
  storage.saveCheckin({
    orgId: 1,
    userId: clrId,
    date: clrAbsenceDate,
    checkedInAt: `${clrAbsenceDate}T16:00:00.000Z`,
    lat: null,
    lng: null,
    accuracyM: null,
    distanceM: null,
    inArea: null,
    onTime: 1,
    minutesLate: 0,
    expectedStart: "09:00",
  });
  assert.equal(
    storage.getAttendanceExcuseRequest(1, clrAbsence.request.id)?.status,
    "cancelled",
  );

  const loAbsenceDate = "2026-07-22";
  const loAbsence = storage.createAdminAbsenceExcuse({
    orgId: 1,
    subjectType: "lo",
    subjectId: loId,
    attendanceDate: loAbsenceDate,
    expectedStart: "09:00",
    reason: "Approved LO absence.",
    adminUserId: adminId,
  });
  storage.saveExternalCheckin({
    orgId: 1,
    type: "lo",
    id: loId,
    date: loAbsenceDate,
    checkedInAt: `${loAbsenceDate}T16:00:00.000Z`,
    expectedStart: "09:00",
    onTime: 1,
    minutesLate: 0,
    lat: null,
    lng: null,
    accuracyM: null,
    distanceM: null,
    inArea: null,
  });
  assert.equal(
    storage.getAttendanceExcuseRequest(1, loAbsence.request.id)?.status,
    "cancelled",
  );

  const loaAbsenceDate = "2026-07-23";
  storage.createAdminAbsenceExcuse({
    orgId: 1,
    subjectType: "loa",
    subjectId: loaId,
    attendanceDate: loaAbsenceDate,
    expectedStart: "09:00",
    reason: "Approved LOA absence.",
    adminUserId: adminId,
  });
  const cancelled = storage.cancelAdminAbsenceExcuse({
    orgId: 1,
    subjectType: "loa",
    subjectId: loaId,
    attendanceDate: loaAbsenceDate,
    adminUserId: adminId,
    note: "LOA will check in normally.",
  });
  assert.equal(cancelled.changed, true);
  assert.equal(cancelled.request?.status, "cancelled");
});
