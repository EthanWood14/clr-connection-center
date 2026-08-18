import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { EOD_DUE_HOUR, EOD_DUE_LABEL, eodIsOverdue } from "../server/business-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bd = readFileSync(join(root, "server/business-day.ts"), "utf8");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const form = readFileSync(join(root, "client/src/pages/eod-report.tsx"), "utf8");
const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");

const PT = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);

test("the 4pm deadline is separate from the 7pm business-day rollover", () => {
  // Moving the rollover would redefine "today" for assignments, check-ins and
  // every report window. The deadline only decides whether a report is late.
  assert.equal(EOD_DUE_HOUR, 16);
  assert.equal(EOD_DUE_LABEL, "4:00 PM");
  assert.match(bd, /const ROLLOVER_HOUR = 19/, "the rollover must stay at 7pm");
});

test("today's report is on time until 4pm and late after", () => {
  // 2026-08-18 15:59 PT — still on time.
  assert.equal(eodIsOverdue("2026-08-18", PT, at("2026-08-18T22:59:00Z")), false);
  // 16:00 PT — late.
  assert.equal(eodIsOverdue("2026-08-18", PT, at("2026-08-18T23:00:00Z")), true);
  // An earlier day is late regardless of the clock.
  assert.equal(eodIsOverdue("2026-08-17", PT, at("2026-08-18T15:00:00Z")), true);
  // A future day is not owed yet.
  assert.equal(eodIsOverdue("2026-08-19", PT, at("2026-08-18T23:30:00Z")), false);
});

test("notes are mandatory on both sides", () => {
  assert.match(routes, /Notes are required — say how the day went/);
  assert.match(routes, /if \(!String\(notes \?\? ""\)\.trim\(\)\)/);
  assert.match(form, /!notes\.trim\(\) && "notes"/, "the form names notes as a blocker");
  assert.match(form, /disabled=\{saveMutation\.isPending \|\| \(!dirty && !!report\) \|\| !canSubmit\}/);
});

test("all four questions must be answered, and blank is not stored as No", () => {
  for (const q of ["bulk text for all assigned LOs", "responded/new contacts",
                   "retail Bonzo — Meta leads", "retail Bonzo — ungraduated/graduated leads"]) {
    assert.ok(routes.includes(q), `server must require: ${q}`);
  }
  assert.match(routes, /Answer required: \$\{label\}/);
  // Columns are nullable so reports filed before the questions existed read as
  // unanswered rather than as a silent "no".
  assert.match(storage, /bulk_text_all_los", "worked_responded_new", "retail_meta_leads", "retail_ungraduated_leads/);
  assert.ok(!/bulk_text_all_los INTEGER NOT NULL/.test(storage));
  assert.match(routes, /v === 1 \? true : v === 0 \? false : null/, "dashboard keeps null distinct from false");
});

test("lateness is stamped at submit, not derived later", () => {
  // It depends on the CLR's own timezone at that moment, which a later reader
  // cannot reconstruct.
  assert.match(routes, /const submittedLate = eodIsOverdue\(reportDate, tzFromRequest\(/);
  assert.match(storage, /ALTER TABLE eod_reports ADD COLUMN submitted_late/);
  assert.match(storage, /submitted_late=excluded\.submitted_late/, "a resubmit must update it");
});

test("managers see the answers, not just that a report exists", () => {
  // In the per-report email…
  assert.match(routes, /Daily checklist/);
  assert.match(routes, /Filed after the \$\{EOD_DUE_LABEL\} deadline/);
  // …and on the dashboard, as work they can chase: which task, and by whom.
  assert.match(routes, /eodChecklistGaps/);
  assert.match(routes, /no: eodStatus\.filter\(\(e: any\) => e\.checklist\?\.\[k\] === false\)\.map\(\(e: any\) => e\.name\)/);
  assert.match(dash, /data-testid="eod-checklist-gaps"/);
  assert.match(dash, /Checklist gaps today/);
  assert.match(dash, /\{g\.no\.join\(", "\)\}/, "name the people, not just a count");
  assert.match(dash, /eod\.late > 0 && ` · \$\{eod\.late\} late`/);
});

test("the dashboard shows what the reports SAY, not just that they arrived", () => {
  // The card used to answer "did it arrive", which is the least interesting
  // thing about a report. Managers were opening each email to read the day.
  for (const field of ["calls:", "messages:", "conversations:", "transfers:", "appointments:", "notes:", "losCalled:"]) {
    assert.ok(routes.includes(field), `dashboard row must carry ${field}`);
  }
  assert.match(routes, /const eodTotals = /, "a team row, so the floor's output reads at a glance");
  assert.match(dash, /data-testid="eod-digest-table"/);
  assert.match(dash, /\{r\.notes \|\| "—"\}/, "notes are shown inline — they are mandatory now");
  // The submission tracker survives underneath; the digest replaces nothing.
  assert.match(dash, /Submission status/);
});

test("conversations combine what the CLR typed with what the dialer recorded", () => {
  const fn = routes.slice(routes.indexOf("const eodStatus = allClrs.map"), routes.indexOf("const eodSubmittedCount"));
  assert.match(fn, /additionalConversations \?\? r\.additional_conversations/);
  assert.match(fn, /callToolsConversations \?\? r\.calltools_conversations/);
  // A CLR who filed nothing reads as zero, never as undefined in the totals.
  assert.match(fn, /r \? Number\(r\.callsMade \?\? r\.calls_made \?\? 0\) : 0/);
});

test("the retail Bonzo questions are ask-only, so No is not a failure", () => {
  // These two are not part of the standard day — a manager asks, or the CLR
  // asks to pick them up. Treating a No as a miss would have flagged nearly
  // the whole floor for doing exactly what was expected of them.
  assert.match(form, /Only when asked — No is normal/);
  assert.match(form, /answering No there is expected/);

  // Gaps are computed from the every-day questions ONLY.
  assert.match(routes, /const eodChecklistGaps = \(\["bulkText", "respondedNew"\] as const\)/);
  assert.ok(!/eodChecklistGaps[\s\S]{0,200}retailMeta/.test(routes),
    "retail Bonzo must not be able to produce a gap");

  // For ask-only work the reported answer is who DID it.
  assert.match(routes, /const eodExtraWork = \(\["retailMeta", "retailUngraduated"\] as const\)/);
  assert.match(routes, /yes: eodStatus\.filter\(\(e: any\) => e\.checklist\?\.\[k\] === true\)/);
  assert.match(dash, /data-testid="eod-extra-work"/);
  assert.match(dash, /Retail Bonzo worked today/);

  // The per-CLR "gap" badge ignores the ask-only answers.
  assert.match(dash, /row\.checklist\.bulkText === false \|\| row\.checklist\.respondedNew === false/);

  // The email neither reddens them nor lets them drive the header colour.
  assert.match(routes, /const anyNo = q\.some\(\(\[, v, askOnly\]\) => v === 0 && !askOnly\)/);
  assert.match(routes, /only when asked/);
});
