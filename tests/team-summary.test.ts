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
