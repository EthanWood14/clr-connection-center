import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { buildDemoManagerDashboard, buildDemoLoTransferSplit } from "../server/demo-manager-dashboard";
import { loadScorecardDigestContext } from "../server/scorecard-digest-context";
import { buildScorecardDigestHtml, SCORECARD_INTRADAY_CRON } from "../server/scorecard-digest";
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("manager demo uses rolling fictional data with reconciling KPI, scorecard, trend and LO totals", () => {
  for (const today of ["2026-09-21", "2027-01-06"]) {
    const d = buildDemoManagerDashboard(today);
    assert.equal(d.demo, true);
    const total = d.byRange.today.leaderboard.reduce((n,r)=>n+r.transfers,0);
    assert.ok(total > 0);
    assert.equal(d.dailyMetrics.transfers, total);
    assert.equal(d.byRange.today.topLos.reduce((n,r)=>n+r.transfers,0),total);
    assert.equal(d.byRange.today.clrTrend.dates[0],today);
    assert.equal(d.byRange.today.clrTrend.series.reduce((n,r)=>n+r.transfers[0],0),total);
    assert.ok(d.byRange.mtd.leaderboard.every(r => r.transferPct > 0 && r.transferPct <= 100));
    assert.ok(d.byRange.mtd.leaderboard.every(r => r.transfersPerWorkedDay === r.transfers / r.workedDays));
    const split = buildDemoLoTransferSplit(today);
    assert.equal(split.windows.today.reduce((n,r)=>n+r.total,0),total);
    assert.equal(split.loaWindows.today.reduce((n,r)=>n+r.total,0),split.windows.today[3].total);
  }
});

test("demo is a low-privilege, read-only preview, not a live organization or integration feed", () => {
  const fixture = read("server/demo-manager-dashboard.ts");
  assert.doesNotMatch(fixture, /from ["']\.\/storage|fetch\(|\.prepare\(|INSERT INTO/);
  const login = read("client/src/pages/login.tsx");
  assert.match(login, /Open Manager Demo/);
  assert.match(login, /email: "demo@clrconnection.com"/);
  assert.doesNotMatch(login, /demoadmin@/);
  const routes = read("server/routes.ts");
  assert.match(routes, /if \(isDemoOrg\(reportOrgId\)\) return res.json\(buildDemoManagerDashboard/);
  assert.match(routes, /if \(isDemoOrg\(orgId\)\) return "skipped"/);
  assert.match(read("client/src/pages/manager-dashboard.tsx"), /Manager demo · Sample data/);
});

test("email context is same-window, approved-only, tenant-scoped and respects hidden excuses", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users(id INTEGER,org_id INTEGER,name TEXT,portal TEXT);
    INSERT INTO users VALUES(1,1,'Sample CLR',NULL),(2,2,'Other org',NULL),(3,1,'Outside LOA','lap');
    CREATE TABLE time_off_requests(org_id INTEGER,user_id INTEGER,start_date TEXT,end_date TEXT,status TEXT,day_portion TEXT,leave_kind TEXT,reason TEXT);
    INSERT INTO time_off_requests VALUES(1,1,'2026-09-21','2026-09-22','approved','full','sick_documented','PRIVATE MEDICAL DETAIL'),
      (1,1,'2026-09-21','2026-09-21','pending','half','half','pending'),
      (2,2,'2026-09-21','2026-09-21','approved','full','pto','other org');
    CREATE TABLE attendance_excuse_requests(org_id INTEGER,subject_id INTEGER,subject_type TEXT,kind TEXT,status TEXT,hide_from_digest INTEGER,attendance_date TEXT);
    INSERT INTO attendance_excuse_requests VALUES(1,1,'user','absence','approved',0,'2026-09-21'),
      (1,1,'user','absence','approved',1,'2026-09-23');
    CREATE TABLE eod_reports(assistant_id INTEGER,report_date TEXT,notes TEXT);
    INSERT INTO eod_reports VALUES(1,'2026-09-21','Follow up <script>alert(1)</script> & check'),
      (1,'2026-09-20','OLD NOTE'),(2,'2026-09-21','OTHER ORG NOTE'),(3,'2026-09-21','OUTSIDE PORTAL NOTE');
  `);
  const context = loadScorecardDigestContext(db,1,"2026-09-21","2026-09-21");
  assert.deepEqual(context.attendance,[{name:"Sample CLR",from:"2026-09-21",to:"2026-09-21",label:"Documented sick"}]);
  assert.equal(context.eodNotes.length,1);
  const html = buildScorecardDigestHtml("10 AM", "2026-09-21", [], {context});
  assert.match(html,/Time off \/ sick/);
  assert.match(html,/EOD notes/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp;/);
  assert.doesNotMatch(html,/<script>|PRIVATE MEDICAL|OTHER ORG|OUTSIDE PORTAL|OLD NOTE|pending/);
  assert.deepEqual(loadScorecardDigestContext(db,1,"2026-09-23","2026-09-23").attendance,[]);
  assert.equal(SCORECARD_INTRADAY_CRON,"0 8,10,12,14,16,18 * * 1-5");
  db.close();
});

test("simpler script editor preserves permission checks, explicit saves, drafts and a branch-outline option", () => {
  const script = read("client/src/pages/call-script.tsx");
  assert.match(script,/useState<"steps" \| "outline">\("steps"\)/);
  assert.match(script,/Edit wording/);
  assert.match(script,/Save wording/);
  assert.match(script,/rows=\{8\}/);
  assert.match(script,/if \(!editing\) \{ setText\(node.text\)/);
  assert.match(script,/Couldn't save — your draft is still here/);
  assert.match(script,/Discard unsaved script wording/);
  assert.match(script,/disabled=\{dirtyIds.size > 0\}/);
  assert.match(script,/!editing && canEdit/);
  assert.match(script,/childNodesByParent=\{new Map\(\)\}/, "flat steps cannot duplicate descendants");
  assert.match(script,/Branch outline/);
});
