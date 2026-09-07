import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SOP_SECTIONS, SOP_STEP_COUNT, SOP_TITLE, deriveSop, normalizeForAnchor,
} from "../shared/clr-sop";
import { TRAINING_DAYS, type TrainingDay } from "../shared/clr-training";
import { parseTrainingDays } from "../shared/training-manual";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/clr-sop.tsx"), "utf8");
const trainingPage = readFileSync(join(root, "client/src/pages/clr-training.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const lapShell = readFileSync(join(root, "client/src/components/lap/lap-shell.tsx"), "utf8");

const clone = (): TrainingDay[] => JSON.parse(JSON.stringify(TRAINING_DAYS));

test("every SOP step is derived from a sentence that is really in the manual", () => {
  // This is the whole contract. The SOP is authored prose, so the only thing
  // stopping it becoming a generic sales script is that each step must point at
  // a line the trainer actually wrote.
  const sop = deriveSop(TRAINING_DAYS);
  assert.equal(sop.total, SOP_STEP_COUNT);
  assert.equal(sop.drifted.length, 0, `ungrounded steps: ${JSON.stringify(sop.drifted, null, 1)}`);
  assert.equal(sop.grounded, sop.total);
  assert.equal(sop.moved.length, 0, "against the seed, every step should be on the day it cites");
  for (const section of sop.sections) {
    for (const step of section.steps) {
      assert.ok(step.anchors.length >= 1, `step has no anchor at all: ${step.text}`);
      assert.equal(step.missing.length, 0, `step lost an anchor: ${step.text}`);
      assert.equal(step.bindings.length, step.anchors.length);
      assert.ok(step.source && step.source.length > 10, `step has no source line: ${step.text}`);
      // EVERY anchor has to land, not just the one the page happens to show.
      for (const binding of step.bindings) {
        assert.ok(binding.line, `anchor never resolved: ${binding.anchor}`);
        assert.ok(
          normalizeForAnchor(String(binding.line)).includes(normalizeForAnchor(binding.anchor)),
          `source does not contain the anchor: ${binding.anchor}`,
        );
      }
    }
  }
});

test("an anchor is wide enough to be the claim, not a keyword that survives the edit", () => {
  // The whole module rests on this. An anchor like "top four objections" is
  // still true after the manual is changed to "the top TWO objections", so a
  // step bound to it would keep asserting four and keep reporting itself
  // grounded. Anchors are spans of a sentence, not topic words.
  for (const section of SOP_SECTIONS) {
    for (const step of section.steps) {
      assert.ok(Array.isArray(step.anchors) && step.anchors.length >= 1,
        `${section.key}: step has no anchors: ${step.text}`);
      let words = 0;
      for (const anchor of step.anchors) {
        const n = normalizeForAnchor(anchor).split(" ").filter(Boolean).length;
        assert.ok(n >= 2, `${section.key}: anchor is a keyword, not a claim: "${anchor}"`);
        words += n;
      }
      assert.ok(words >= 5,
        `${section.key}: too little of the manual is holding this step up: ${JSON.stringify(step.anchors)}`);
    }
  }
  // A claim that spans two sentences of the manual carries two anchors, and a
  // meaningful share of the procedure is that shape.
  const multi = SOP_SECTIONS.flatMap((s) => s.steps).filter((s) => s.anchors.length > 1);
  assert.ok(multi.length >= 10, `only ${multi.length} steps bind more than one sentence`);
});

test("it is a procedure, not a repeat of the ten-day schedule", () => {
  // The failure mode being guarded against is somebody pasting the plan in and
  // calling it an SOP. A procedure is phased by the call, addresses the CLR,
  // and never mentions quizzes, trainers or day numbers.
  const steps = SOP_SECTIONS.flatMap((s) => s.steps.map((x) => x.text));
  assert.equal(steps.length, SOP_STEP_COUNT);
  assert.ok(steps.length >= 25, "an SOP that fits in twenty lines is not the job");
  for (const text of steps) {
    assert.doesNotMatch(text, /\bQuiz #\d/i, `schedule language in a procedure step: ${text}`);
    assert.doesNotMatch(text, /\bthe trainee\b|\btrainer\b|\bday (one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
      `step is written to the trainer, not the CLR: ${text}`);
    assert.doesNotMatch(text, /\bshadow\b|\broleplay\b/i, `onboarding activity in the daily procedure: ${text}`);
  }
  // Phased in the order a call actually happens, ending in the hard limits.
  assert.deepEqual(
    SOP_SECTIONS.map((s) => s.key),
    ["before", "open", "sheet", "pushback", "transfer", "after", "never"],
  );
  assert.equal(SOP_SECTIONS[SOP_SECTIONS.length - 1].key, "never");
  for (const section of SOP_SECTIONS) {
    assert.ok(section.steps.length > 0, `${section.key} has no steps`);
    assert.ok(section.when.length > 0, `${section.key} does not say when it applies`);
  }
});

test("the specifics survive — a generic sales SOP would be worthless here", () => {
  const all = SOP_SECTIONS.flatMap((s) => s.steps.map((x) => x.text)).join("\n");
  for (const phrase of [
    "14-day rule", "5-day lead rule", "Responded", "No Contact",
    "DNC", "STOP/No Text", "Big Three", "Big 4", "DTI", "LTV",
    "Bonzo", "C3", "not asking", "quote",
  ]) {
    assert.ok(all.includes(phrase), `the SOP lost a WCL specific: "${phrase}"`);
  }
});

test("the SOP does not harden an example into a rule, or a should into a must", () => {
  const steps = SOP_SECTIONS.flatMap((s) => s.steps);
  const find = (fragment: string) => steps.find((s) => s.text.includes(fragment))!;

  // The manual: "there are exceptionS … like when calling the LO 'Responded'
  // pipeline". The SOP used to say that was THE one exception and that
  // "everything else is not an exception", which is a rule the manual does not
  // contain — and the CLR reading it on the floor cannot tell the difference.
  const exception = find("exceptions to getting the information on the call");
  assert.match(exception.text, /exceptions/, "the manual says exceptionS, plural");
  assert.ok(!/the one exception|only exception|Everything else is not an exception/i.test(exception.text),
    `the SOP forecloses exceptions the manual leaves open: ${exception.text}`);
  assert.match(exception.text, /example/i, "the Responded pipeline is an example, and must read as one");

  // Same class of error: the rate-question language is offered by the manual as
  // "something like … etc.", so the SOP may not present it as the script.
  const language = find("I'm just an assistant");
  assert.match(language.text, /something like|example/i,
    `the SOP presents an example as the required wording: ${language.text}`);

  // And "for the most part" survives from the pipeline rule.
  assert.match(find("Responded and No Contact").text, /for the most part/i);

  // Everything each of those steps now claims is still bound to the manual.
  const sop = deriveSop(TRAINING_DAYS);
  assert.equal(sop.drifted.length, 0);
});

test("it is derived from the LIVE manual, not from the source file", () => {
  // The manual is DB-backed and editable. If the SOP only ever read the seed it
  // would be a snapshot of what the plan said the day it shipped.
  const edited = clone();
  edited[3].afternoon[0] = edited[3].afternoon[0].replace(
    "Emphasize the importance of staying within these hours",
    "ALSO check the federal list first. Emphasize the importance of staying within these hours",
  );
  const sop = deriveSop(edited);
  const step = sop.sections
    .find((s) => s.key === "before")!.steps
    .find((x) => x.anchors.includes("the call times that are allowed for each state"))!;
  assert.match(String(step.source), /check the federal list first/,
    "the step should quote the edited document, not the constant");
  assert.equal(sop.drifted.length, 0);
});

test("deleting the sentence a step rests on raises it as drift rather than hiding it", () => {
  const edited = clone();
  // Somebody rewrites the compliance paragraph and loses the call-hours rule.
  edited[3].afternoon[0] = "Explain our compliance rules to the best of your knowledge.";
  edited[3].afternoon[1] = "Practice exporting lists.";
  const sop = deriveSop(edited);
  const gone = sop.drifted.flatMap((d) => d.missing);
  assert.ok(gone.includes("the call times that are allowed for each state"), JSON.stringify(gone));
  assert.ok(gone.includes("the importance of staying within these hours"));
  assert.ok(sop.grounded < sop.total);
  // The step is still rendered — an unexplained rule stays on the wall until a
  // human decides what replaces it — but it is flagged, with no source line.
  const step = sop.sections.find((s) => s.key === "before")!.steps
    .find((x) => x.anchors.includes("the call times that are allowed for each state"))!;
  assert.equal(step.grounded, false);
  assert.equal(step.source, null);
  assert.deepEqual(step.missing, step.anchors, "both sentences went with the paragraph");
});

test("moving content between days keeps the step, and says it moved", () => {
  // Reordering the plan is an edit to the schedule, not to the procedure.
  const edited = clone();
  const line = edited[3].afternoon[0];
  edited[3].afternoon.splice(0, 1);
  edited[8].morning.push(line);
  const sop = deriveSop(edited);
  const step = sop.sections.find((s) => s.key === "before")!.steps
    .find((x) => x.anchors.includes("the call times that are allowed for each state"))!;
  assert.equal(step.grounded, true);
  assert.equal(step.foundOnDay, 9);
  assert.equal(step.moved, true);
  assert.ok(sop.moved.some((m) => m.from === 4 && m.to === 9));
  assert.equal(sop.drifted.length, 0);
});

test("a step whose claim spans two days is not reported as moved", () => {
  // "the 14-day rule on LOAs, the 5-day rule on W2 LOs" is two rules taught on
  // two days. Binding both is what makes the step honest; it must not therefore
  // read as drifting around the schedule.
  const sop = deriveSop(TRAINING_DAYS);
  const step = sop.sections.find((s) => s.key === "before")!.steps
    .find((x) => x.anchors.some((a) => a.includes("14-day rule")))!;
  assert.equal(step.anchors.length, 2);
  assert.equal(step.grounded, true);
  assert.equal(step.moved, false, "one anchor lives on day 5 by design, not by drift");
  assert.equal(step.foundOnDay, 4);
  assert.deepEqual(step.bindings.map((b) => b.day), [4, 5]);
});

// ── The binding has to bind ──────────────────────────────────────────────────
// The point of the anchors is that an ordinary edit to the manual cannot leave
// the SOP asserting the superseded fact while still reporting itself grounded.
// Each case below changes a FACT the SOP states, and each is chosen so that the
// narrow phrase the step used to be anchored on SURVIVES the edit — which is
// exactly how the old bindings let the change through. Every case must drift.

const manualText = (days: TrainingDay[]) =>
  days.flatMap((d) => [...(d.morning ?? []), ...(d.afternoon ?? []), d.eod ?? ""]).join("\n");

function editLine(
  days: TrainingDay[], dayIndex: number,
  where: "morning" | "afternoon" | "eod", index: number,
  from: string, to: string,
) {
  if (where === "eod") {
    assert.ok(days[dayIndex].eod.includes(from), `the seed no longer says: ${from}`);
    days[dayIndex].eod = days[dayIndex].eod.replace(from, to);
    return;
  }
  const lines = days[dayIndex][where];
  assert.ok(lines[index]?.includes(from), `the seed no longer says: ${from}`);
  lines[index] = lines[index].replace(from, to);
}

const DRIFT_CASES: {
  name: string;
  /** The keyword the step USED to be anchored on. It must survive the edit. */
  survivingKeyword: string;
  edit: (days: TrainingDay[]) => void;
  /** section key + a substring of one anchor, for the steps that must drift. */
  expect: { section: string; anchorLike: string }[];
}[] = [
  {
    name: "the pipelines a CLR lives in change",
    survivingKeyword: "daily filters",
    edit: (days) => editLine(days, 3, "morning", 1,
      "This should be “Responded” and “No Contact” for the most part.",
      "This should be “Nurture” and “No Contact” for the most part."),
    expect: [{ section: "before", anchorLike: "daily filters" }],
  },
  {
    name: "rapport stops being what opens a borrower up",
    survivingKeyword: "they will open up more",
    edit: (days) => editLine(days, 2, "morning", 1,
      "Building rapport with borrowers makes them feel comfortable, and they will open up more.",
      "Building rapport with borrowers is optional and rarely changes the call, though when it works they will open up more."),
    expect: [{ section: "open", anchorLike: "Building rapport with borrowers" }],
  },
  {
    name: "the objection bar drops from four to two",
    survivingKeyword: "top four objections",
    edit: (days) => editLine(days, 2, "eod",
      0, "top four objections without thinking about it", "top two objections without thinking about it"),
    expect: [{ section: "pushback", anchorLike: "without thinking about it" }],
  },
  {
    name: "the LO handoff becomes a request instead of a statement",
    survivingKeyword: "telling the LOs that you are calling for them",
    edit: (days) => editLine(days, 4, "morning", 1, "(NOT ASKING)", "(ASK FIRST)"),
    expect: [{ section: "transfer", anchorLike: "NOT ASKING" }],
  },
  {
    name: "the Big Three becomes a Big Four",
    survivingKeyword: "Refinance, HELOC, and Reverse",
    edit: (days) => editLine(days, 1, "afternoon", 2,
      "Big Three scenarios (Refinance, HELOC, and Reverse)",
      "Big Four scenarios (Refinance, HELOC, and Reverse, plus Purchase)"),
    expect: [{ section: "sheet", anchorLike: "Big Three scenarios" }],
  },
  {
    name: "\"every step\" is softened to \"most steps\"",
    survivingKeyword: "down to logging the transfer in C3",
    edit: (days) => editLine(days, 9, "afternoon", 2,
      "Make sure that every step of the call is completed",
      "Make sure that most steps of the call are completed"),
    expect: [
      { section: "after", anchorLike: "every step of the call is completed" },
      { section: "never", anchorLike: "every step of the call is completed" },
    ],
  },
];

for (const testCase of DRIFT_CASES) {
  test(`editing the manual so ${testCase.name} drifts the step that says otherwise`, () => {
    const edited = clone();
    testCase.edit(edited);

    // The old, narrower anchor is still sitting in the document. That is the
    // whole failure this test exists to catch: bound to it, the step would have
    // gone on asserting the superseded fact and still counted as grounded.
    assert.ok(
      normalizeForAnchor(manualText(edited)).includes(normalizeForAnchor(testCase.survivingKeyword)),
      `"${testCase.survivingKeyword}" should still be in the edited manual, or this case proves nothing`,
    );

    const before = deriveSop(TRAINING_DAYS);
    const after = deriveSop(edited);
    for (const target of testCase.expect) {
      const find = (sop: ReturnType<typeof deriveSop>) =>
        sop.sections.find((s) => s.key === target.section)!.steps
          .find((x) => x.anchors.some((a) => a.includes(target.anchorLike)))!;
      assert.ok(find(before).grounded, `${target.section}/${target.anchorLike} was not grounded to begin with`);

      const step = find(after);
      assert.equal(step.grounded, false,
        `${target.section}: the fact changed and the step still reports grounded — "${step.text}"`);
      assert.ok(step.missing.length > 0);
      assert.ok(
        after.drifted.some((d) => d.section === target.section && d.text === step.text),
        "a drifted step must be counted in the payload the page and the API read",
      );
    }
    assert.ok(after.grounded < before.grounded, "the grounded count has to fall");
  });
}

test("cosmetic edits to the manual cannot break a step", () => {
  // The manual is edited in a textarea by a human: curly quotes, an ellipsis
  // that becomes three dots, a capitalisation fix. None of that is a change of
  // procedure, so none of it may unground a step.
  const edited = clone();
  edited[7].morning[1] = edited[7].morning[1]
    .replace(/’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/…/g, "...")
    .toUpperCase();
  const sop = deriveSop(edited);
  assert.equal(sop.drifted.length, 0, JSON.stringify(sop.drifted));
  assert.equal(normalizeForAnchor("  “I'm  just an ASSISTANT…” "), "im just an assistant...");
});

test("an empty or broken document falls back to the seed rather than an empty SOP", () => {
  assert.equal(deriveSop([]).grounded, SOP_STEP_COUNT);
  assert.equal(deriveSop(undefined as any).grounded, SOP_STEP_COUNT);
  // And a day whose steps were cleared does not crash the derivation.
  const stripped = clone().map((d) => ({ ...d, morning: [], afternoon: [], eod: "" }));
  const sop = deriveSop(stripped as TrainingDay[]);
  assert.equal(sop.grounded, 0);
  assert.equal(sop.drifted.length, SOP_STEP_COUNT);
});

test("the manual the SOP is built on is still a manual the editor accepts", () => {
  // If deriveSop's input shape ever diverges from what a save produces, the SOP
  // would be reading a document nobody can actually write.
  const parsed = parseTrainingDays(TRAINING_DAYS);
  assert.equal(parsed.ok, true);
  assert.equal(deriveSop(parsed.days).drifted.length, 0);
});

test("the API derives on every request from the current document", () => {
  const sop = routes.slice(routes.indexOf('app.get("/api/clr-sop"'), routes.indexOf('app.get("/api/clr-sop"') + 1400);
  assert.match(sop, /requireAuth/);
  assert.match(sop, /training_manual_versions/, "it must read the live document");
  assert.match(sop, /readStoredManual\(row\.content\)/);
  assert.match(sop, /TRAINING_DAYS/, "and fall back to the seed on a fresh install");
  assert.match(sop, /org_id = \?/);
  assert.match(sop, /deriveSop\(days\)/, "derivation happens against the manual, not against a stored copy");
  // No second copy of the procedure in the database: nothing writes an SOP.
  assert.ok(!/INSERT INTO .*sop|CREATE TABLE .*sop/i.test(routes), "the SOP must not become a second editable document");
});

test("the page is readable at a glance and reachable from both portals", () => {
  assert.match(page, /queryKey: \["\/api\/clr-sop"\]/);
  // Same fallback rule as the walkthrough: a failed request still shows the
  // procedure to someone about to pick up the phone.
  assert.match(page, /data \?\? \{ \.\.\.deriveSop\(\)/);
  assert.match(page, /data-testid="sop-drift-warning"/, "drift has to be visible on the page, not only in the payload");
  assert.match(page, /data-testid="sop-grounding"/);
  assert.match(page, /window\.print\(\)/);
  assert.match(page, /print:hidden/);
  // Nothing to click before you can read a step.
  assert.ok(!/Accordion|Tabs|Collapsible/.test(page), "no disclosure widgets on a page read mid-call");
  assert.ok(!page.includes("Be hellbent"), "SOP text must live in shared/clr-sop.ts only");
  assert.match(app, /<Route path="\/clr-sop" component=\{ClrSop\} \/>/);
  assert.match(lapShell, /<Route path="\/clr-sop" component=\{ClrSop\} \/>/);
  assert.match(app, /"\/clr-sop":\s+"Call SOP"/);
  // And the schedule points at it, since that is where people already go.
  assert.match(trainingPage, /data-testid="link-clr-sop"/);
  assert.equal(SOP_TITLE.length > 0, true);
});
