import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

// Emailed reports used to drop exclude_from_stats CLRs out of every total and
// list them in a section at the bottom. The one CLR carrying that flag is the
// highest-volume person on the team by roughly three to one, so the headline
// numbers described a materially smaller team than the one that did the work.

test("emailed summary reports count every active CLR", () => {
  const build = routes.slice(routes.indexOf("const isClrRow = (u: any) =>"), routes.indexOf("interface ClrStats"));
  assert.ok(!/!u\.excludeFromStats/.test(build),
    "the CLR list must no longer filter out non-counted CLRs");
  assert.match(build, /scopedClrId \? u\.id === scopedClrId : true/,
    "an unscoped report includes everyone; a scoped one still targets one CLR");
});

test("the separate 'Non-counted CLRs' section is gone from both emails", () => {
  // Leaving the section while also counting them in the totals would double
  // count them to the reader.
  assert.ok(!/nonCounted/.test(routes), "no non-counted split may remain in any builder");
  // Scoped to the emails on purpose. The dashboard and the EOD grid still honour
  // exclude_from_stats, and their comments still say so — that is deliberate,
  // and a blanket search would fail on those.
  const emailBuilders = routes.slice(routes.indexOf("const isClrRow = (u: any) =>"), routes.indexOf("const todayLabel"));
  assert.ok(!/Non-counted CLRs/.test(emailBuilders), "the section heading must be gone from the report email");
  const from = routes.indexOf("[eod-digest] no submissions today");
  const digest = routes.slice(from, routes.indexOf("await sendEmail(", from));
  assert.ok(!/Non-counted CLRs/.test(digest), "…and from the EOD digest");
});

test("team totals are summed from the same list the table renders", () => {
  const build = routes.slice(routes.indexOf("const clrStats: ClrStats[]"), routes.indexOf("const teamFellThrough"));
  assert.match(build, /clrStats\.reduce/, "totals derive from clrStats");
  // Sorted by transfers, so the busiest CLR leads the table rather than sitting
  // in a footnote underneath it.
  assert.match(build, /sort\(\(a, b\) => b\.transfers - a\.transfers\)/);
});

test("the EOD manager digest counts every submission too", () => {
  // Anchored forward from the digest itself — `const esc` appears in several
  // builders, so slicing to the first one would run backwards and yield "".
  const from = routes.indexOf("[eod-digest] no submissions today");
  const digest = routes.slice(from, routes.indexOf("const esc = (s: string)", from));
  assert.ok(digest.length > 0, "digest slice must not be empty");
  assert.match(digest, /const rows = allRows;/, "no submission is split out of the digest totals");
  assert.ok(!/r\.excluded/.test(digest), "the excluded flag must not gate the digest");
});
