import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const page = read("client/src/pages/team-summary.tsx");
const app = read("client/src/App.tsx");
const sidebar = read("client/src/components/app-sidebar.tsx");
const advanced = read("client/src/pages/manager-dashboard.tsx");
const routes = read("server/routes.ts");

test("the summary is reachable, and so is the advanced view it replaces at the top", () => {
  assert.match(app, /<Route path="\/team-summary" component=\{TeamSummary\} \/>/);
  assert.match(app, /<Route path="\/advanced-dashboard" component=\{ManagerDashboard\} \/>/);
  // The old path stays: it is what people have bookmarked, and what every
  // link written before today points at.
  assert.match(app, /<Route path="\/team-dashboard" component=\{ManagerDashboard\} \/>/);
  assert.match(sidebar, /url: "\/team-summary"/);
  assert.match(sidebar, /title: "Advanced Dashboard",\s+url: "\/advanced-dashboard"/);
  assert.ok(!/title: "Team Dashboard"/.test(sidebar), "the old name must not survive in the nav");
});

test("both pages read the same endpoint, so they cannot disagree", () => {
  // A second source would drift, and then neither number would be trusted.
  assert.match(page, /queryKey: \["\/api\/manager-dashboard"\]/);
  assert.match(advanced, /queryKey: \["\/api\/manager-dashboard"\]/);
  // That endpoint is already open to the internal team and closed to portal
  // accounts, so the summary adds no new access.
  const fn = routes.slice(routes.indexOf('app.get("/api/manager-dashboard"'), routes.indexOf('app.get("/api/manager-dashboard"') + 1_200);
  assert.match(fn, /const internal = !me\?\.portal \|\| me\.portal === "c3";/);
  assert.match(fn, /return res\.status\(403\)/);
});

test("the summary states a change in counts, never a percentage", () => {
  // "Up 12.5%" on a base of 8 is one transfer. Reading a percentage as a
  // number is the exact mistake this page exists to stop somebody making.
  const change = page.slice(page.indexOf("function change("), page.indexOf("function invert("));
  assert.match(change, /more \$\{word\} than last week/);
  assert.match(change, /fewer \$\{word\} than last week/);
  assert.match(change, /Same as last week/);
  assert.ok(!/%/.test(change), "no percentages in the change sentence");
  // Singular and plural both read as English.
  assert.match(change, /Math\.abs\(diff\) === 1 \? unit : `\$\{unit\}s`/);
});

test("fewer fell-through leads is good news, and is coloured that way", () => {
  assert.match(page, /function invert\(/);
  assert.match(page, /tone: invert\(c\.tone\)/, "the fell-through card must invert the tone");
});

test("every number on the page says what it means", () => {
  // The point of the page. A tile reading "Contacts 412" is the dashboard we
  // already have.
  for (const phrase of [
    "onto the phone with a loan officer",
    "Every number we dialled this week",
    "the ones where somebody answered",
    "we set a time for the loan officer to call them",
    "What the words mean",
  ]) {
    assert.ok(page.includes(phrase), `missing plain-language line: ${phrase}`);
  }
  // And it points at the detail rather than pretending to replace it.
  assert.match(page, /Open the Advanced Dashboard/);
});

test("the advanced page no longer calls itself the manager's", () => {
  // It has been open to the whole team for a while. A CLR who follows a link
  // to a page badged "Manager view" reasonably assumes they are trespassing.
  assert.match(advanced, /Advanced view/);
  assert.ok(!/>\s*Manager view\s*</.test(advanced));
});

test("two charts, and only two", () => {
  // Owner, 9 Sep 2026: the summary was too simple; it should have two charts
  // and still be simple. Nine is the Advanced page's number and the reason
  // people bounce off it.
  assert.match(page, /data-testid="summary-chart-daily"/);
  assert.match(page, /data-testid="summary-chart-week-over-week"/);
  const charts = page.match(/data-testid="summary-chart-[a-z-]+"/g) ?? [];
  assert.equal(charts.length, 2, "a third chart needs a decision, not a commit");
});

test("the charts are bars, and weekends are dropped rather than drawn as zero", () => {
  // A line implies a quantity between the points and there is no such thing as
  // Tuesday-and-a-half. And a fortnight of alternating spikes and troughs
  // looks like a problem when it is only the calendar.
  assert.match(page, /dropWeekendRows\(data\.byRange\?\.\["30d"\]\?\.trend \?\? \[\], "date"\)/);
  assert.ok(!/<LineChart/.test(page), "bars, not lines");
  assert.match(page, /<BarChart/);
  // Counts on the axis, never a percentage: this page states differences in
  // whole things.
  assert.match(page, /allowDecimals=\{false\}/);
});

test("a chart with nothing to show does not draw an empty box", () => {
  assert.match(page, /if \(rows\.length < 2\) return null;/);
  assert.match(page, /if \(rows\.every\(\(r\) => r\["This week"\] === 0 && r\["Last week"\] === 0\)\) return null;/);
});

test("the pages you do not touch every call live behind the Advanced fold", () => {
  // Owner, 10 Sep 2026. Main is what you touch on every call; these are not.
  // The script is read until it is known, Shotgun answers itself (the offer is
  // a full-screen alert wherever you are, and the write-up prompt follows
  // you), and the EOD report is once at the end of the day.
  for (const moved of ["/call-script", "/eod-report", "/shotgun", "/team-summary", "/advanced-dashboard", "/app-review"]) {
    const main = sidebar.slice(sidebar.indexOf("const mainItems"), sidebar.indexOf("const personalItems"));
    assert.ok(!main.includes(moved), `${moved} must not be in Main`);
  }
  assert.match(sidebar, /const advancedWorkflowItems: NavItem\[\]/);
  assert.match(sidebar, /const advancedDashboardItems: NavItem\[\]/);
  // Both new groups render INSIDE the fold, which only exists under showAdvanced.
  const fold = sidebar.slice(sidebar.indexOf("{showAdvanced && <>"));
  assert.ok(fold.includes("renderItems(advancedWorkflowItems)"));
  assert.ok(fold.includes("renderItems(advancedDashboardItems)"));
  // App Review stays manager-gated: relocating a link must not turn it into a
  // 403 for a CLR, and must not hand it to one either.
  assert.match(fold, /isManagerOrAdmin && renderItems\(advancedDashboardManagerItems\)/);
});

test("moving a link does not move the page", () => {
  // Every route still resolves, so bookmarks, push notifications and every
  // link written before today land where they always did.
  for (const route of ["/call-script", "/eod-report", "/shotgun", "/team-summary", "/advanced-dashboard", "/app-review"]) {
    assert.ok(app.includes(`path="${route}"`), `${route} must still be routed`);
  }
});

test("a CLR has a link to their own settings", () => {
  // Settings sat in the ADMIN-ONLY group, so a CLR had no route to their own
  // profile, availability or notification preferences anywhere in the nav —
  // only a line in the page footer and one step of the onboarding checklist.
  // The page has always been built for them: it opens on Profile and pushes a
  // non-admin back there if they land on an admin tab.
  const personal = sidebar.slice(
    sidebar.indexOf("const advancedPersonalItems"),
    sidebar.indexOf("];", sidebar.indexOf("const advancedPersonalItems")));
  assert.match(personal, /url: "\/settings"/, "Settings belongs to the everyone list");
  const admin = sidebar.slice(
    sidebar.indexOf("const adminItems"),
    sidebar.indexOf("];", sidebar.indexOf("const adminItems")));
  assert.ok(!admin.includes("/settings"), "and must no longer be admin-gated");
  // Report Archive stays: that page refuses anyone who is not admin or viewer.
  assert.match(admin, /\/reports-archive/);
});

test("Glossary and the NMLS tracker moved out of Tools, not out of reach", () => {
  const tools = sidebar.slice(
    sidebar.indexOf("const toolItems"),
    sidebar.indexOf("];", sidebar.indexOf("const toolItems")));
  for (const gone of ["/glossary", "/nmls-checks"]) {
    assert.ok(!tools.includes(gone), `${gone} must have left Tools`);
  }
  const reference = sidebar.slice(
    sidebar.indexOf("const referenceItems"),
    sidebar.indexOf("];", sidebar.indexOf("const referenceItems")));
  for (const moved of ["/glossary", "/nmls-checks"]) {
    assert.ok(reference.includes(moved), `${moved} must be in the everyone Reference list`);
  }
  // Tools still has a reason to exist.
  assert.match(tools, /\/state-lookup/);
});
