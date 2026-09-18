import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { transformSync } from "esbuild";

import {
  mondayOf, scorecardWindow, scorecardSnapshotLabel, SCORECARD_INTRADAY_CRON, rankScorecardRows, buildScorecardDigestHtml,
  isScorecardDigestHelperException,
  type ScorecardRow, type ScorecardDigestKind,
} from "../server/scorecard-digest";
import { formatTransferCount } from "../shared/transfer-credit";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

const row = (name: string, calls: number, transfers: number, appointments: number, fellThrough = 0): ScorecardRow =>
  ({ name, calls, transfers, appointments, fellThrough });

test("day windows cover the day, week windows run Monday to date", () => {
  // 2026-08-14 is a Friday.
  assert.deepEqual(scorecardWindow("intraday", "2026-08-14"), { from: "2026-08-14", to: "2026-08-14", label: "Today so far" });
  assert.deepEqual(scorecardWindow("midday", "2026-08-14"), { from: "2026-08-14", to: "2026-08-14", label: "Mid-Day" });
  assert.deepEqual(scorecardWindow("eod", "2026-08-14"), { from: "2026-08-14", to: "2026-08-14", label: "End of Day" });
  assert.equal(scorecardWindow("midweek", "2026-08-12").from, "2026-08-10", "Wednesday reaches back to Monday");
  assert.equal(scorecardWindow("eow", "2026-08-14").from, "2026-08-10", "Friday covers the whole week");
});

test("snapshot labels use the actual Pacific clock in winter, summer and DST transition days", () => {
  const cases = [
    ["2026-01-15T16:00:00Z", "8:00 AM PT · Today so far"],
    ["2026-01-16T02:00:00Z", "6:00 PM PT · Today so far"],
    ["2026-07-15T15:00:00Z", "8:00 AM PT · Today so far"],
    ["2026-07-16T01:00:00Z", "6:00 PM PT · Today so far"],
    ["2026-03-08T15:00:00Z", "8:00 AM PT · Today so far"],
    ["2026-11-01T16:00:00Z", "8:00 AM PT · Today so far"],
  ];
  for (const [instant, expected] of cases) assert.equal(scorecardSnapshotLabel(new Date(instant)), expected);
});

test("Monday resolution survives Sundays and month boundaries", () => {
  assert.equal(mondayOf("2026-08-10"), "2026-08-10", "a Monday is its own Monday");
  assert.equal(mondayOf("2026-08-16"), "2026-08-10", "Sunday belongs to the week that started six days back");
  assert.equal(mondayOf("2026-09-02"), "2026-08-31", "the week can start in the previous month");
});

test("the email ranks exactly like the dashboard scorecard", () => {
  // Transfers first, appointments break ties, calls only after that.
  const ranked = rankScorecardRows([
    row("Fewer appts, more calls", 500, 5, 1),
    row("More appts", 100, 5, 4),
    row("Most transfers", 10, 9, 0),
  ]);
  assert.deepEqual(ranked.map(r => r.name), ["Most transfers", "More appts", "Fewer appts, more calls"]);
});

test("the rendered table carries every column and a team total", () => {
  const html = buildScorecardDigestHtml("Mid-Day", "2026-08-14", [
    row("Alpha", 120, 4, 2, 1),
    row("Beta", 80, 6, 0, 0),
  ]);
  assert.match(html, /Transfer Scorecard — Mid-Day/);
  for (const col of ["CLR", "Calls", "Transfers", "Appts", "Fell Through", "C&gt;T%"]) {
    assert.ok(html.includes(col), `missing column ${col}`);
  }
  assert.match(html, />Team</);
  assert.match(html, />200</, "team calls total");
  assert.match(html, />10</, "team transfers total");
  // Beta leads on transfers despite fewer calls.
  assert.ok(html.indexOf("Beta") < html.indexOf("Alpha"));
  // C>T%: Beta 6/80 = 7.5%
  assert.match(html, /7\.5%/);
});

test("names are escaped on the way into the email", () => {
  const html = buildScorecardDigestHtml("Mid-Day", "2026-08-14", [row("<img src=x>", 1, 1, 0)]);
  assert.ok(!html.includes("<img src=x>"));
  assert.match(html, /&lt;img src=x&gt;/);
});

test("exactly six weekday snapshots replace daily noon/eod schedules while weekly sends remain", () => {
  assert.equal(SCORECARD_INTRADAY_CRON, "0 8,10,12,14,16,18 * * 1-5");
  const [minute, hours, dayOfMonth, month, weekdays] = SCORECARD_INTRADAY_CRON.split(" ");
  assert.deepEqual(hours.split(",").map(Number), [8, 10, 12, 14, 16, 18]);
  assert.deepEqual([minute, dayOfMonth, month, weekdays], ["0", "*", "*", "1-5"]);
  const schedules = [...routes.matchAll(/^\s*scheduleScorecardDigest\(([^\n]+?),\s*"([^"]+)"\);/gm)]
    .map(match => [match[1].trim(), match[2]]);
  assert.deepEqual(schedules, [
    ["SCORECARD_INTRADAY_CRON", "intraday"],
    ['"30 12 * * 3"', "midweek"],
    ['"10 19 * * 5"', "eow"],
  ], "no extra noon or 19:00 daily send remains scheduled");
  const fn = routes.slice(routes.indexOf("function scheduleScorecardDigest"), routes.indexOf("scheduleScorecardDigest(SCORECARD_INTRADAY_CRON"));
  assert.match(fn, /timezone: "America\/Los_Angeles"/, "container time is UTC; unpinned crons fire seven hours early");
});

test("snapshot date and label share one captured clock and calendar date, not rolled business day", () => {
  const fn = routes.slice(routes.indexOf("async function sendScorecardDigest"), routes.indexOf("function scheduleScorecardDigest"));
  assert.match(fn, /const now = new Date\(\)/);
  assert.match(fn, /toLocaleDateString\("en-CA", \{ timeZone: BUSINESS_DAY_DEFAULT_TZ \}\)/);
  assert.ok(!/businessTodayInTz/.test(fn), "businessToday would report tomorrow at 19:00");
  assert.match(fn, /scorecardSnapshotLabel\(now\)/);
  assert.match(fn, /scorecardManagerEmails\(orgId\)/, "use the configured, org-safe scorecard recipients, including Scott");
  assert.doesNotMatch(fn, /attendanceManagerUsers\(orgId\)/, "do not bypass configured manager email recipients");
});

test("the manual trigger is manager-gated and validates the kind", () => {
  const route = routes.slice(routes.indexOf(`app.post("/api/scorecard-digest/send-now"`), routes.indexOf(`app.post("/api/checkin/digest/send-now"`));
  assert.match(route, /requireManagerOrAdmin\(req, res\)/);
  const kinds = route.match(/if\s*\(!\[([^\]]+)\]\.includes\(kind\)\)/)?.[1].match(/"([^"]+)"/g)?.map(value => value.slice(1, -1));
  assert.deepEqual(kinds, ["intraday", "midday", "eod", "midweek", "eow"], "intraday is accepted and every legacy manual kind remains supported");
  assert.match(route, /res\.status\(400\)/);
  assert.match(route, /sendScorecardDigest\(orgId, kind as ScorecardDigestKind\)/);
});

// Execute only this small function with in-memory dependencies. Importing the
// routes module itself would start unrelated app/DB work and is intentionally
// avoided; these tests cannot send mail or open a database.
function sendHarness(rows: ScorecardRow[], instant: string, recipients = ["manager@example.test", "scott@example.test"]) {
  const source = routes.slice(routes.indexOf("async function sendScorecardDigest"), routes.indexOf("function scheduleScorecardDigest"));
  const code = transformSync(source, { loader: "ts", target: "es2022" }).code;
  const mail: { to: string[]; subject: string; html: string }[] = [];
  const windows: { orgId: number; from: string; to: string }[] = [];
  const recipientOrgs: number[] = [];
  let clockReads = 0;
  class SnapshotDate extends Date {
    constructor(value?: string | number | Date) {
      if (value === undefined) clockReads++;
      super(value === undefined ? instant : value instanceof Date ? value.getTime() : value);
    }
  }
  const dependencies = {
    Date: SnapshotDate,
    BUSINESS_DAY_DEFAULT_TZ: "America/Los_Angeles",
    scorecardWindow, scorecardSnapshotLabel, formatTransferCount, buildScorecardDigestHtml,
    buildScorecardDigestRows: (orgId: number, from: string, to: string) => { windows.push({ orgId, from, to }); return rows; },
    scorecardDigestHelperAssistedCount: (_orgId: number, _from: string, _to: string) => 3,
    scorecardManagerEmails: (orgId: number) => { recipientOrgs.push(orgId); return recipients; },
    storageExtra: { getEmailSettings: () => ({ helper_name: "Elleine" }) },
    buildEmail: ({ body }: { body: string }) => body,
    sendEmail: async (message: typeof mail[number]) => { mail.push(message); },
    console: { log: () => {} },
  };
  const send = new Function(...Object.keys(dependencies), `${code}\nreturn sendScorecardDigest;`)(...Object.values(dependencies)) as
    (orgId: number, kind: ScorecardDigestKind) => Promise<"sent" | "skipped">;
  return { send, mail, windows, recipientOrgs, clockReads: () => clockReads };
}

test("intraday sends a useful zero-activity roster with its actual Pacific snapshot label", async () => {
  for (const [instant, date, label] of [
    ["2026-01-16T02:00:00Z", "2026-01-15", "6:00 PM PT · Today so far"],
    ["2026-07-15T15:00:00Z", "2026-07-15", "8:00 AM PT · Today so far"],
  ]) {
    const harness = sendHarness([row("Quiet CLR", 0, 0, 0)], instant);
    assert.equal(await harness.send(37, "intraday"), "sent");
    assert.equal(harness.clockReads(), 1, "date and snapshot title use the same instant");
    assert.deepEqual(harness.windows, [{ orgId: 37, from: date, to: date }]);
    assert.deepEqual(harness.recipientOrgs, [37]);
    assert.equal(harness.mail.length, 1);
    assert.deepEqual(harness.mail[0].to, ["manager@example.test", "scott@example.test"]);
    assert.ok(harness.mail[0].subject.includes(label));
    assert.ok(harness.mail[0].subject.includes(date));
    assert.ok(harness.mail[0].html.includes(label));
    assert.match(harness.mail[0].html, /Quiet CLR/);
    assert.match(harness.mail[0].html, />Team</);
  }
});

test("empty rosters never send, and legacy manual/weekly digests still skip zero activity", async () => {
  const kinds: ScorecardDigestKind[] = ["intraday", "midday", "eod", "midweek", "eow"];
  for (const kind of kinds) {
    const empty = sendHarness([], "2026-07-15T15:00:00Z");
    assert.equal(await empty.send(37, kind), "skipped");
    assert.equal(empty.mail.length, 0);
    if (kind !== "intraday") {
      const zero = sendHarness([row("Quiet CLR", 0, 0, 0)], "2026-07-15T15:00:00Z");
      assert.equal(await zero.send(37, kind), "skipped");
      assert.equal(zero.mail.length, 0);
    }
  }
});

test("no digest sends without recipients, and legacy activity sends remain compatible", async () => {
  const noRecipients = sendHarness([row("Active CLR", 12, .5, 1)], "2026-07-15T15:00:00Z", []);
  assert.equal(await noRecipients.send(37, "intraday"), "skipped");
  assert.equal(noRecipients.mail.length, 0);
  for (const kind of ["midday", "eod", "midweek", "eow"] as const) {
    const harness = sendHarness([row("Active CLR", 12, .5, 1)], "2026-07-16T01:00:00Z");
    assert.equal(await harness.send(37, kind), "sent");
    assert.equal(harness.mail.length, 1);
    assert.ok(harness.mail[0].subject.includes(scorecardWindow(kind, "2026-07-15").label));
  }
});

function recipientHarness(configured: unknown, roles: { email?: unknown }[]) {
  const source = routes.slice(routes.indexOf("function scorecardManagerEmails"), routes.indexOf("async function sendScorecardDigest"));
  const code = transformSync(source, { loader: "ts", target: "es2022" }).code;
  const attendanceOrgs: number[] = [], roleOrgs: number[] = [], queries: { sql: string; orgId: number }[] = [];
  const dependencies = {
    attendanceManagerEmails: (orgId: number) => {
      attendanceOrgs.push(orgId);
      return ["wcl-manager@example.test", "scott@example.test"];
    },
    attendanceManagerUsers: (orgId: number) => { roleOrgs.push(orgId); return roles; },
    storageExtra: {
      getRawSqlite: () => ({
        prepare: (sql: string) => ({
          get: (orgId: number) => {
            queries.push({ sql, orgId });
            assert.match(sql, /^SELECT manager_emails FROM organizations WHERE id = \?$/i, "configured recipients must be read from that org only");
            return configured === undefined ? undefined : { manager_emails: configured };
          },
        }),
      }),
    },
  };
  const resolve = new Function(...Object.keys(dependencies), `${code}\nreturn scorecardManagerEmails;`)(...Object.values(dependencies)) as (orgId: number) => string[];
  return { resolve, attendanceOrgs, roleOrgs, queries };
}

test("WCL scorecard recipients include configured Scott through the attendance recipient helper", () => {
  const harness = recipientHarness('[]', []);
  assert.deepEqual(harness.resolve(1), ["wcl-manager@example.test", "scott@example.test"]);
  assert.deepEqual(harness.attendanceOrgs, [1]);
  assert.deepEqual(harness.roleOrgs, []);
  assert.deepEqual(harness.queries, []);
});

test("other organizations merge only their own recipients with case-insensitive deduplication", () => {
  const harness = recipientHarness(JSON.stringify([
    " MANAGER@TENANT.EXAMPLE ", "Configured@tenant.example", "configured@TENANT.example", "", null, "not-an-email",
  ]), [
    { email: " Manager@Tenant.Example " }, { email: "manager@tenant.example" }, { email: "Second@tenant.example" },
    { email: null }, {}, { email: "invalid" },
  ]);
  assert.deepEqual(harness.resolve(2), ["manager@tenant.example", "second@tenant.example", "configured@tenant.example"]);
  assert.deepEqual(harness.attendanceOrgs, [], "never load WCL's global configured recipients for another tenant");
  assert.deepEqual(harness.roleOrgs, [2]);
  assert.deepEqual(harness.queries.map(query => query.orgId), [2]);
});

test("malformed or empty tenant recipient settings cannot suppress managers or import WCL addresses", () => {
  for (const configured of [undefined, null, "", "[]", "not-json", '{"email":"foreign@example.test"}', '"foreign@example.test"']) {
    const harness = recipientHarness(configured, [{ email: " Manager@Tenant.Example " }]);
    assert.deepEqual(harness.resolve(2), ["manager@tenant.example"]);
    assert.deepEqual(harness.attendanceOrgs, []);
    assert.deepEqual(harness.queries.map(query => query.orgId), [2]);
  }
  const empty = recipientHarness("[]", []);
  assert.deepEqual(empty.resolve(2), []);
  assert.deepEqual(empty.attendanceOrgs, [], "an empty tenant stays empty; there is no fallback to WCL");
});

test("Elleine (and the configured helper) is an exclude_from_stats exception for digests only", () => {
  assert.equal(isScorecardDigestHelperException("Elleine Asuncion"), true);
  assert.equal(isScorecardDigestHelperException("elleine"), true);
  assert.equal(isScorecardDigestHelperException("Matthew Rosas"), false);
  assert.equal(isScorecardDigestHelperException("Elle"), false, "prefix must not claim Elleine");
  assert.equal(isScorecardDigestHelperException("Matthew Rosas", { userId: 9, helperUserId: 9, helperName: "Elleine" }), true, "resolved helper id wins");
  assert.equal(isScorecardDigestHelperException("Pat Helper", { helperName: "Pat" }), true);
  assert.equal(isScorecardDigestHelperException("Patricia Helper", { helperName: "Pat" }), false, "Pat must be a whole word");
});

test("digest HTML puts helpers in their own bottom section while keeping team totals", () => {
  const html = buildScorecardDigestHtml("Today so far", "2026-09-18", [
    row("Elleine Asuncion", 40, 8, 1, 2),
    row("Matthew Rosas", 50, 5, 0, 1),
  ], { helperAssisted: { name: "Elleine", count: 4 } });
  const helperIndex = html.indexOf(">Helper</p>");
  assert.ok(helperIndex > html.indexOf("Matthew Rosas"), "helper section is below the CLR table");
  assert.ok(html.indexOf("Matthew Rosas") < helperIndex, "Matthew remains in the ranked CLR table");
  assert.ok(html.indexOf("Elleine Asuncion", helperIndex) > helperIndex, "Elleine is shown in the helper section");
  assert.doesNotMatch(html.slice(helperIndex), /<th[^>]*>#<\/th>/, "helper section has no CLR rank column");
  assert.match(html, />90</, "team calls include helper");
  assert.match(html, />13</, "team transfers include helper");
  assert.match(html, />3</, "team fell-through total includes helper");
  assert.match(html, /Elleine assisted: 4/);
  assert.ok(!buildScorecardDigestHtml("Today so far", "2026-09-18", [row("A", 1, 1, 0)]).includes("assisted:"), "omit the line when not supplied");
});

test("configured helper names are separated from CLR ranking", () => {
  const html = buildScorecardDigestHtml("Today so far", "2026-09-18", [
    row("Pat Helper", 30, 9, 2),
    row("Regular CLR", 20, 1, 0),
  ], { helperName: "Pat" });
  const helperIndex = html.indexOf(">Helper</p>");
  assert.ok(helperIndex > html.indexOf("Regular CLR"));
  assert.ok(html.indexOf("Pat Helper", helperIndex) > helperIndex);
  assert.ok(html.indexOf("Pat Helper") > helperIndex, "configured helper is not ranked with CLRs");
});

test("buildScorecardDigestRows opts the helper back in despite exclude_from_stats", () => {
  const fn = routes.slice(routes.indexOf("function buildScorecardDigestRows"), routes.indexOf("function scorecardManagerEmails"));
  assert.match(fn, /isScorecardDigestHelperException/);
  assert.match(fn, /resolveHelperUserId/);
  assert.match(fn, /helper_name/);
  assert.match(fn, /excludeFromStats/);
  assert.ok(!/\.filter\(\(u\) => u\.isActive && !u\.excludeFromStats && clrRoleMatches\(u\)\)/.test(fn),
    "must not keep the blanket exclude_from_stats drop");
});

test("sendScorecardDigest passes helper-assisted count into the HTML builder", () => {
  const fn = routes.slice(routes.indexOf("async function sendScorecardDigest"), routes.indexOf("function scheduleScorecardDigest"));
  assert.match(fn, /scorecardDigestHelperAssistedCount\(orgId, w\.from, w\.to\)/);
  assert.match(fn, /buildScorecardDigestHtml\(windowLabel, dateLabel, rows, \{ helperAssisted, helperName \}\)/);
  assert.match(routes, /helper_assisted=1/);
});

test("intraday mail body includes the helper-assisted line from the harness", async () => {
  const harness = sendHarness([row("Elleine Asuncion", 10, 3, 0)], "2026-07-15T15:00:00Z");
  assert.equal(await harness.send(37, "intraday"), "sent");
  assert.match(harness.mail[0].html, /Elleine assisted: 3/);
});
