import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

import {
  approvedTimeOffUserIds,
  assignmentClrsForDate,
  resolveMonthlyClrAssignments,
} from "../server/clr-assignment-availability";

function vacationDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE time_off_requests (
      id INTEGER PRIMARY KEY, org_id INTEGER, user_id INTEGER,
      start_date TEXT, end_date TEXT, status TEXT
    );
    INSERT INTO time_off_requests VALUES
      (1,1,2,'2026-08-04','2026-08-08','approved'),
      (2,1,3,'2026-08-04','2026-08-08','pending'),
      (3,2,4,'2026-08-04','2026-08-08','approved');
    CREATE INDEX idx_time_off_assignment_dates
      ON time_off_requests(org_id, status, start_date, end_date, user_id);
  `);
  return db;
}

const users = [
  { id: 1, orgId: 1, role: "assistant", isActive: true, inDailyAssignments: true, excludeFromStats: false },
  { id: 2, orgId: 1, role: "assistant", isActive: true, inDailyAssignments: true, excludeFromStats: false },
  { id: 3, orgId: 1, role: "assistant", isActive: true, inDailyAssignments: true, excludeFromStats: false },
  { id: 4, orgId: 2, role: "assistant", isActive: true, inDailyAssignments: true, excludeFromStats: false },
];

test("approved CLR vacation excludes both boundary dates and restores afterward", () => {
  const db = vacationDb();
  assert.deepEqual([...approvedTimeOffUserIds(db, 1, "2026-08-04")], [2]);
  assert.deepEqual(assignmentClrsForDate(users, db, 1, "2026-08-08").map(user => user.id), [1, 3]);
  assert.deepEqual(assignmentClrsForDate(users, db, 1, "2026-08-09").map(user => user.id), [1, 2, 3]);
  const plan = db.prepare("EXPLAIN QUERY PLAN SELECT DISTINCT user_id FROM time_off_requests WHERE org_id=? AND status='approved' AND start_date<=? AND end_date>=?")
    .all(1, "2026-08-04", "2026-08-04") as any[];
  assert.match(plan.map(row => row.detail).join(" "), /idx_time_off_assignment_dates/);
  db.close();
});

test("fixed monthly assignments rebalance vacation work across available CLRs", () => {
  const rows = [
    { lo_id: 10, assistant_id: 2 },
    { lo_id: 11, assistant_id: 3 },
    { lo_id: 12, assistant_id: 2 },
  ];
  const resolved = resolveMonthlyClrAssignments(rows, [{ id: 1 }, { id: 3 }]);
  assert.deepEqual(resolved.map(item => item.assistantId), [1, 3, 1]);
  assert.deepEqual(resolved.map(item => item.row.lo_id), [10, 11, 12]);
});

test("vacation scheduling is wired into every daily assignment path", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../client/src/pages/time-off.tsx", import.meta.url), "utf8");
  assert.match(routes, /assignmentClrsForDate\(storage\.getUsers\(\), sqlite/);
  assert.match(routes, /assignmentClrsForDate\(storage\.getUsers\(\), storageExtra\.getRawSqlite\(\)/);
  assert.match(routes, /idx_time_off_assignment_dates/);
  assert.match(routes, /managerScheduled \? "approved" : "pending"/);
  assert.match(routes, /has approved time off on/);
  assert.match(routes, /reassignedAssignments/);
  assert.match(page, /Schedule CLR Vacation/);
  assert.match(page, /return automatically/);
});
