// The CLR floor SOP — the standing procedure, derived from the training manual.
//
// The manual (shared/clr-training.ts, and its live successor in
// training_manual_versions) is a SCHEDULE: "day three, spend an hour on
// objections". That is the right shape for onboarding and the wrong shape for
// Tuesday afternoon with a borrower on the line. This module holds the same
// content reorganised from "when you learn it" into "how you do it": before you
// dial, open, take the sheet, handle pushback, hand off, close out.
//
// ── Why the steps are authored rather than generated ─────────────────────────
// The manual is prose written to a trainer ("Be hellbent on THEM getting the
// information"). Turning that into an instruction addressed to the CLR ("get
// the information while you are on the call") is a rewrite, and no parser does
// it honestly. So the steps are written by hand, in the manual's own words
// wherever the words already work.
//
// ── Why that does not let it drift ───────────────────────────────────────────
// Every step carries `anchors`: the phrases that must still exist somewhere in
// the live manual for the step to stand. deriveSop() runs against whatever the
// manual says TODAY, not against the seed, and reports each step as grounded
// (with the manual lines it rests on), moved (the sentences are still there, on
// a different day), or drifted (at least one has gone). A drifted step is shown
// on the page as needing review and is counted by the API, so an edit to the
// manual surfaces here instead of quietly leaving the floor following a rule
// nobody stands behind any more.
//
// ── Why an anchor is a whole claim and not a keyword ─────────────────────────
// The binding is only worth anything if editing the FACT breaks it. An anchor
// like "top four objections" survives the manual being changed to "get past the
// top TWO objections without thinking" — the step would carry on asserting four
// and still report itself grounded, which is precisely the failure this module
// exists to prevent. So an anchor must be the span that WOULD change if the
// fact changed:
//
//   * not "14-day rule"  but "the 14-day rule with Chris's Bonzo and LOAs"
//   * not "(the topic)"  but the sentence that states the rule
//
// And where a step's claim genuinely spans more than one sentence of the manual
// — "the 14-day rule on LOAs, the 5-day rule on W2 LOs" is two rules taught on
// two days — the step carries one anchor per sentence and ALL of them must
// still match. One surviving phrase does not ground a two-part claim.
// Tests assert the seed grounds 100% of steps, and that editing a fact out of
// the manual drifts the step that asserted it.
import { TRAINING_DAYS, type TrainingDay } from "./clr-training";

export const SOP_TITLE = "The Call, Start to Finish";
export const SOP_SUBTITLE =
  "What a CLR does on every call, in order. Drawn from the trainer walkthrough — same rules, arranged by when you need them.";

export type SopStep = {
  /** The instruction, addressed to the CLR doing the work. */
  text: string;
  /** The training day it was taken from. */
  day: number;
  /**
   * The phrases that must ALL still be somewhere in the manual for this step to
   * stand. Matched after normalisation, so quotes, dashes and case are free —
   * but each one has to be wide enough to carry the part of the claim it is
   * standing behind, or an edit to the fact slips underneath it.
   */
  anchors: string[];
};

export type SopSection = {
  key: string;
  title: string;
  /** Where in the call you are. Short enough to scan down the left edge. */
  when: string;
  steps: SopStep[];
};

/**
 * The procedure.
 *
 * Order is the order of a real call. A step lands in the phase where you DO it,
 * which is often not the day you were taught it — licensing is day six and the
 * fourteen-day rule is day four, but both are things you settle before you
 * dial, so both sit in "Before you dial".
 */
export const SOP_SECTIONS: SopSection[] = [
  {
    key: "before",
    title: "Before you dial",
    when: "List built, rules checked",
    steps: [
      {
        text: "Build the day's list with your daily filters. For the most part you are working Responded and No Contact — that is where the work is.",
        day: 4,
        anchors: [
          "daily filters” should look like when making a list for Bulk Texter",
          "This should be “Responded” and “No Contact” for the most part",
        ],
      },
      {
        text: "Check that state's call window before the dial, every time. The borrower's state sets the hours, not your clock.",
        day: 4,
        anchors: [
          "the call times that are allowed for each state",
          "the importance of staying within these hours",
        ],
      },
      {
        text: "Respect DNC and STOP/No Text. They are two different restrictions — know which one you are looking at.",
        day: 4,
        anchors: [
          "what DNC and STOP/No Text are, how to use them, and what the difference is between the two",
        ],
      },
      {
        text: "Know whose lead it is before you touch it: the 14-day rule on Chris's Bonzo and LOAs, the 5-day lead rule on W2 LOs.",
        day: 4,
        anchors: [
          "the 14-day rule with Chris's Bonzo and LOAs",
          "the 5-day lead rule with W2 LOs",
        ],
      },
      {
        text: "Be able to search for and find a lead fast, without hunting for it. Freezing or taking too long will lose you a transfer.",
        day: 9,
        anchors: [
          "verify that they can search for and find a lead effectively",
          "Freezing or taking too long will lose you a transfer",
        ],
      },
    ],
  },
  {
    key: "open",
    title: "Open the call",
    when: "First thirty seconds",
    steps: [
      {
        text: "Lead with your opener, the one you drilled, the same way every time. This is the part of the call you never improvise.",
        day: 1,
        anchors: [
          "build their opening line",
          "have their opener down pat",
        ],
      },
      {
        text: "Sound happy to talk to them. If you don't, they won't want to talk.",
        day: 3,
        anchors: [
          "if you don't sound happy to talk to them, they won't want to talk",
        ],
      },
      {
        text: "Build rapport before you start collecting. Comfortable borrowers open up more.",
        day: 3,
        anchors: [
          "Building rapport with borrowers makes them feel comfortable, and they will open up more",
        ],
      },
      {
        text: "Ask open-ended questions. A closed-ended question gives the borrower a free out, and they will take it.",
        day: 3,
        anchors: [
          "Closed-ended questions give the borrower a free out, and they will take it",
          "Open-ended questions open the door for them to explain in detail",
        ],
      },
    ],
  },
  {
    key: "sheet",
    title: "Take the info sheet",
    when: "The body of the call",
    steps: [
      {
        text: "Start with the goal of the borrower. Everything else on the sheet only means something once you know what they are trying to do.",
        day: 2,
        anchors: [
          "Start with the “goal” of the borrower",
        ],
      },
      {
        text: "Get the information while you are on the call. Information promised for later is information you do not have.",
        day: 2,
        anchors: [
          "Be hellbent on them getting the information on the call; it is a very important step",
        ],
      },
      {
        // The manual says exceptionS, and gives the LO "Responded" pipeline as
        // an example of one. An SOP that promotes that example to "the only
        // exception" is asserting something the manual does not say, so the
        // step says what the manual says and leaves the judgement where the
        // manual leaves it.
        text: "There are exceptions to getting the information on the call. The LO “Responded” pipeline is the one the manual names, as an example rather than the whole list — so an exception is something you confirm, not something you decide mid-call.",
        day: 2,
        anchors: [
          "there are exceptions to not getting information on the call",
          "like when calling the LO “Responded” pipeline",
        ],
      },
      {
        text: "Work the Big 4 questions on the sheet, and write down which income type you are hearing — W2, 1099 or self-employed.",
        day: 7,
        anchors: [
          "Big 4” questions we have on the info call sheets",
          "the difference between W2, 1099, and self-employed",
        ],
      },
      {
        text: "Expect one of the Big Three: Refinance, HELOC or Reverse. Which one you are in decides what you ask next.",
        day: 2,
        anchors: [
          "Big Three scenarios (Refinance, HELOC, and Reverse)",
        ],
      },
      {
        text: "Know DTI and LTV when you hear them. They come up constantly, and asking a borrower to define their own loan costs you the call.",
        day: 7,
        anchors: [
          "Explain DTI and LTV",
          "important topics and words we hear constantly",
        ],
      },
      {
        text: "When the call goes somewhere you did not plan, adapt and keep going. Adapting on the phone is crucial.",
        day: 8,
        anchors: [
          "Adapting on the phone is crucial",
        ],
      },
    ],
  },
  {
    key: "pushback",
    title: "When they push back",
    when: "Objections and the rate question",
    steps: [
      {
        text: "Reframe it. The job is to flip the objection around, not to win the argument.",
        day: 3,
        anchors: [
          "reframe the objection",
          "how to flip an objection around",
        ],
      },
      {
        text: "The top four objections come out without thinking. If you have to search for one, that is the one to drill tonight.",
        day: 3,
        anchors: [
          "master responding to the top four objections",
          "top four objections without thinking about it",
        ],
      },
      {
        text: "Never quote. Legally, we as CLRs are NOT allowed to quote anyone — knowing the number has never been the issue, saying it is.",
        day: 8,
        anchors: [
          "Legally, we as CLRs are NOT allowed to quote anyone",
        ],
      },
      {
        // The manual offers these as examples ("Something like… etc."), so the
        // step offers them as examples too. Hardening them into the script is
        // the same error as hardening the info-sheet exception into a rule.
        text: "Have the language ready — something like “I'm just an assistant…” or “I'm not legally allowed…”. The manual gives those as examples, so the words can be yours; the position cannot.",
        day: 8,
        anchors: [
          "what language you use to get around the rate question",
          "I'm just an assistant",
          "I'm not legally allowed",
        ],
      },
      {
        text: "Position that the LO will be quoting them as soon as the transfer is made. You are routing the question, not dodging it.",
        day: 8,
        anchors: [
          "the LO will be quoting them as soon as the transfer is made",
        ],
      },
    ],
  },
  {
    key: "transfer",
    title: "Hand it to the LO",
    when: "The transfer itself",
    steps: [
      {
        text: "Find an LO licensed in the borrower's state first. An unlicensed LO cannot take that borrower at all.",
        day: 6,
        anchors: [
          "we must find what state the LO is licensed in during a transfer",
        ],
      },
      {
        text: "Tell the LO you are calling for them. You are not asking.",
        day: 5,
        anchors: [
          "telling the LOs that you are calling for them",
          "(NOT ASKING)",
        ],
      },
      {
        text: "Walk to the LO and give them your notes, so they pick up the conversation instead of restarting it in front of the borrower.",
        day: 2,
        anchors: [
          "walking to the LO, giving them notes",
        ],
      },
      {
        text: "Quality over quantity. A transfer that falls apart in front of the LO costs more than the dial you never made.",
        day: 5,
        anchors: [
          "Quality is important during transfers",
          "Quality over quantity",
        ],
      },
    ],
  },
  {
    key: "after",
    title: "After the call",
    when: "Before the next dial",
    steps: [
      {
        text: "Put the notes in Bonzo while the call is still in your head.",
        day: 2,
        anchors: [
          "how to put notes in Bonzo, log a transfer, and handle any other post-call responsibilities",
        ],
      },
      {
        text: "Log the transfer in C3 and reassign the lead in Bonzo. Both systems have to agree with what just happened in the room.",
        day: 5,
        anchors: [
          "the handoff, logging C3, and reassigning in Bonzo",
        ],
      },
      {
        text: "Disposition the lead correctly, transfer or not. A pipeline nobody dispositions is a list that lies to the next person who calls it.",
        day: 4,
        anchors: [
          "have them practice dispositioning people correctly",
          "show them a stage change in action, like on a live phone call",
        ],
      },
      {
        text: "Nothing is finished until it is logged, down to logging the transfer in C3.",
        day: 10,
        anchors: [
          "every step of the call is completed, down to logging the transfer in C3",
        ],
      },
    ],
  },
  {
    key: "never",
    title: "Never, on any call",
    when: "No exceptions",
    steps: [
      {
        text: "Never quote a rate, a payment or a term. That is the LO's job and it is a legal line, not a house style.",
        day: 8,
        anchors: [
          "Legally, we as CLRs are NOT allowed to quote anyone",
          "especially important for compliance reasons",
        ],
      },
      {
        text: "Never dial outside that state's allowed hours.",
        day: 4,
        anchors: [
          "the call times that are allowed for each state",
          "the importance of staying within these hours",
        ],
      },
      {
        text: "Never work a contact against DNC or STOP/No Text.",
        day: 4,
        anchors: [
          "what DNC and STOP/No Text are, how to use them, and what the difference is between the two",
        ],
      },
      {
        text: "Never transfer to an LO who is not licensed in the borrower's state — verify it, don't assume it.",
        day: 10,
        anchors: [
          "in what cases we can give a lead to another LO and how to verify state licensing",
          "we must find what state the LO is licensed in during a transfer",
        ],
      },
      {
        text: "Never count a call as done before it is logged in C3.",
        day: 10,
        anchors: [
          "every step of the call is completed, down to logging the transfer in C3",
        ],
      },
    ],
  },
];

/** One anchor, resolved against the manual as it reads right now. */
export type AnchorBinding = {
  anchor: string;
  /** The manual line carrying it, or null once it has gone. */
  line: string | null;
  /** Which day that line is on today. */
  day: number | null;
};

/** One step, checked against the manual as it reads right now. */
export type DerivedStep = SopStep & {
  /** Every anchor and where it landed — the whole basis for the step. */
  bindings: AnchorBinding[];
  /** The anchors that no longer resolve. Empty means grounded. */
  missing: string[];
  /** The first manual line this step still rests on, or null once gone. */
  source: string | null;
  /** Which day that line is on today — a step survives being moved. */
  foundOnDay: number | null;
  /** Grounded only when EVERY anchor still resolves. */
  grounded: boolean;
  /** Grounded, but the day it cites no longer carries any of its anchors. */
  moved: boolean;
};

export type DerivedSection = Omit<SopSection, "steps"> & { steps: DerivedStep[] };

export type DerivedSop = {
  sections: DerivedSection[];
  total: number;
  grounded: number;
  /** Steps that lost at least one of the sentences they assert. */
  drifted: {
    section: string; title: string; text: string; day: number;
    anchors: string[];
    /** The specific anchors that have gone — what a human has to reconcile. */
    missing: string[];
  }[];
  /** Steps that survived, but on a different day than they were written against. */
  moved: { section: string; text: string; from: number; to: number }[];
};

/**
 * Compare loosely on purpose.
 *
 * The manual is edited in a textarea by a human. Straight quotes become curly
 * ones, an ellipsis becomes three dots, someone fixes the capitalisation. None
 * of that is a change to the procedure, so none of it should be able to break
 * a step's grounding.
 */
export function normalizeForAnchor(input: string): string {
  return String(input ?? "")
    .replace(/[‘’“”'"`]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Every sentence of one day, in reading order. */
function linesOfDay(day: TrainingDay): string[] {
  return [...(day.morning ?? []), ...(day.afternoon ?? []), day.eod ?? ""].filter(Boolean);
}

/**
 * Bind the SOP to a training manual.
 *
 * Pass the LIVE document (what /api/training-manual would return), not the
 * seed. The result is the same procedure every time; what changes is whether
 * each step can still point at the sentences it came from.
 */
export function deriveSop(days: TrainingDay[] = TRAINING_DAYS): DerivedSop {
  const source = Array.isArray(days) && days.length ? days : TRAINING_DAYS;
  const dayLines = source.map((d) => ({ day: Number(d.day), lines: linesOfDay(d) }));

  const find = (anchor: string, preferredDay: number): { line: string; day: number } | null => {
    const needle = normalizeForAnchor(anchor);
    if (!needle) return null;
    const search = (lines: string[] | undefined) =>
      (lines ?? []).find((line) => normalizeForAnchor(line).includes(needle)) ?? null;
    const onDay = search(dayLines.find((d) => d.day === preferredDay)?.lines);
    if (onDay) return { line: onDay, day: preferredDay };
    // Content moved between days is still content. Report it, don't fail it.
    for (const entry of dayLines) {
      const hit = search(entry.lines);
      if (hit) return { line: hit, day: entry.day };
    }
    return null;
  };

  const drifted: DerivedSop["drifted"] = [];
  const moved: DerivedSop["moved"] = [];
  let grounded = 0;
  let total = 0;

  const sections = SOP_SECTIONS.map((section) => ({
    ...section,
    steps: section.steps.map((step): DerivedStep => {
      total += 1;
      const anchors = Array.isArray(step.anchors) ? step.anchors : [];
      const bindings: AnchorBinding[] = anchors.map((anchor) => {
        const hit = find(anchor, step.day);
        return { anchor, line: hit ? hit.line : null, day: hit ? hit.day : null };
      });
      // A step with no anchors asserts something nothing in the manual backs.
      const missing = anchors.length
        ? bindings.filter((b) => b.line === null).map((b) => b.anchor)
        : ["(no anchor)"];
      const isGrounded = missing.length === 0;

      if (!isGrounded) {
        drifted.push({
          section: section.key, title: section.title, text: step.text, day: step.day,
          anchors, missing,
        });
        const firstHit = bindings.find((b) => b.line !== null) ?? null;
        return {
          ...step, bindings, missing,
          source: firstHit ? firstHit.line : null,
          foundOnDay: firstHit ? firstHit.day : null,
          grounded: false, moved: false,
        };
      }

      grounded += 1;
      // A step is "moved" when the day it cites no longer carries ANY of its
      // anchors — a claim spanning two days is not moved just because its
      // second sentence has always lived elsewhere.
      const onCitedDay = bindings.find((b) => b.day === step.day) ?? null;
      const primary = onCitedDay ?? bindings[0];
      const didMove = !onCitedDay;
      if (didMove) moved.push({ section: section.key, text: step.text, from: step.day, to: Number(primary.day) });
      return {
        ...step, bindings, missing,
        source: primary.line, foundOnDay: primary.day, grounded: true, moved: didMove,
      };
    }),
  }));

  return { sections, total, grounded, drifted, moved };
}

/** Convenience for the client's offline fallback and for tests. */
export const SOP_STEP_COUNT = SOP_SECTIONS.reduce((n, s) => n + s.steps.length, 0);
