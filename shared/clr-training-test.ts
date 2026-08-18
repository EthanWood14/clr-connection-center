// The 60-question certification test for Matt Lane's CLR training plan.
//
// Every question is answerable from the plan in shared/clr-training.ts and has
// exactly one defensible answer — a test whose answers are arguable teaches
// nothing and cannot be graded fairly. Each carries `why`, which is shown after
// submission so the review conversation the plan calls for has something to
// work from.
//
// `correct` is the index into `choices`. The answer key never reaches the
// browser before submission: the server strips it (see /api/training-test).

export type TestQuestion = {
  id: number;
  day: number;
  text: string;
  choices: string[];
  correct: number;
  why: string;
};

export const TEST_PASS_PERCENT = 90;

const RAW: Omit<TestQuestion, "id">[] = [
  // ── Day 1 — the role, the systems, the opener ─────────────────────────────
  { day: 1, text: "On a new CLR's first day, what happens before any training content?", choices: ["A tour of the office and introductions to the loan officers", "Their first live dial", "Setting up their computer", "Taking Quiz #1"], correct: 0, why: "Day 1 opens with a tour, introductions, and the seating chart." },
  { day: 1, text: "What is the trainee given to keep and memorise on day one?", choices: ["The seating chart", "The product list", "The state licensing map", "The objection list"], correct: 0, why: "Print out a seating chart sheet for them to have and memorize." },
  { day: 1, text: "Which is NOT one of the systems introduced on day one?", choices: ["Encompass", "Bonzo", "Dialpad", "CallTools"], correct: 0, why: "The plan names Bonzo, Dialpad, C3 and CallTools." },
  { day: 1, text: "What is the focus of the first roleplay session?", choices: ["Building their opening line", "Closing the transfer", "Filling out the info sheet", "Handling the rate question"], correct: 0, why: "The focus here is to build their opening line." },
  { day: 1, text: "How should objections be used in that first roleplay?", choices: ["A few common ones, giving them a minute to think", "Not at all on day one", "Continuously, with no pauses", "Only after Quiz #1"], correct: 0, why: "Throw in a few objections we frequently see and give them a minute to think through them." },
  { day: 1, text: "What should the trainee do during each live call they observe?", choices: ["Make one observation per call", "Take the call themselves", "Write the Bonzo notes", "Score the call out of ten"], correct: 0, why: "Have them make one observation per call, and patch them in to listen." },
  { day: 1, text: "By the end of day one, the trainee should be able to:", choices: ["Recite their opener and name each system", "Pass a live transfer unassisted", "Export a Bulk Texter list", "Explain DTI and LTV"], correct: 0, why: "By EOD: opener down pat, and able to name each system." },

  // ── Day 2 — product, the info sheet, the clean transfer ───────────────────
  { day: 2, text: "Where should the call info sheet conversation start?", choices: ["The borrower's goal", "The property value", "The credit score", "The interest rate"], correct: 0, why: "Start with the goal of the borrower." },
  { day: 2, text: "The plan says to be 'hellbent' on what?", choices: ["Getting the information while on the call", "Hitting the daily dial count", "Logging the transfer within five minutes", "Memorising the product list"], correct: 0, why: "Be hellbent on them getting the information on the call; it is a very important step." },
  { day: 2, text: "Which situation is named as an exception to getting all the information on the call?", choices: ["Calling the LO 'Responded' pipeline", "Any call after 5pm", "Calls to previous borrowers", "Calls where the borrower is driving"], correct: 0, why: "There are exceptions, like when calling the LO Responded pipeline." },
  { day: 2, text: "A clean transfer walkthrough should cover:", choices: ["Walking to the LO, giving notes, logging it, and post-call work", "Only the verbal handoff", "Only the Bonzo note", "Only the C3 log"], correct: 0, why: "Go through each step — walking to the LO, giving notes, Bonzo notes, logging the transfer, and other post-call responsibilities." },
  { day: 2, text: "The 'Big Three' scenarios to roleplay are:", choices: ["Refinance, HELOC, and Reverse", "Purchase, Refinance, and HELOC", "VA, FHA, and Conventional", "Refinance, DSCR, and Reverse"], correct: 0, why: "Go through each of the Big Three scenarios: Refinance, HELOC, and Reverse." },
  { day: 2, text: "How supervised are day two's live dials?", choices: ["Heavily — do not leave their side", "Lightly, to build independence", "Unsupervised, with a debrief after", "Supervised only for the first call"], correct: 0, why: "This session should be heavily supervised. Genuinely do not leave their side." },
  { day: 2, text: "By the end of day two, the trainee should:", choices: ["Be set up on every system and complete one smooth info-sheet roleplay", "Have passed the final certification call", "Have memorised the state list", "Be able to quote a rate"], correct: 0, why: "By EOD: set up on the computer and systems, and one smooth info-sheet roleplay call." },

  // ── Day 3 — questions, rapport, tone, objections ──────────────────────────
  { day: 3, text: "Why does the plan favour open-ended questions?", choices: ["Closed-ended questions give the borrower a free out, which they take", "They are faster to ask", "They are required for compliance", "They make the call shorter"], correct: 0, why: "Closed-ended questions give the borrower a free out, and they will take it." },
  { day: 3, text: "Why does tone matter on a call?", choices: ["If you don't sound happy to talk to them, they won't want to talk", "It affects recording quality", "It sets the transfer's compensation", "It is scored by CallTools"], correct: 0, why: "If you don't sound happy to talk to them, they won't want to talk." },
  { day: 3, text: "What does building rapport achieve?", choices: ["Borrowers feel comfortable and open up more", "It shortens the call", "It removes the need for the info sheet", "It satisfies a compliance requirement"], correct: 0, why: "Building rapport makes them feel comfortable, and they will open up more." },
  { day: 3, text: "How many objections should the trainee master on day three?", choices: ["The top four", "All of them", "The top two", "The top ten"], correct: 0, why: "Have them master responding to the top four objections on the list." },
  { day: 3, text: "What is the objection roleplay actually training?", choices: ["Reframing and flipping an objection around", "Ending the call politely", "Speed of dialling", "Note-taking accuracy"], correct: 0, why: "This part is all about having them understand how to flip an objection around." },
  { day: 3, text: "The open-ended question drill asks the trainee to:", choices: ["Hold a 10-minute conversation using only open-ended questions", "Ask twenty questions in five minutes", "Write out fifty questions", "Avoid questions entirely"], correct: 0, why: "Have them hold a 10-minute conversation by only using open-ended questions." },
  { day: 3, text: "By the end of day three, the trainee should:", choices: ["Get past the top four objections without thinking about it", "Run a Bulk Texter export", "Explain the loan lifecycle", "Dodge the rate question"], correct: 0, why: "By EOD: past the top four objections without thinking, plus two smooth roleplay calls." },

  // ── Day 4 — Bonzo, pipelines, compliance ──────────────────────────────────
  { day: 4, text: "Day four focuses on which system?", choices: ["Bonzo", "CallTools", "Dialpad", "C3"], correct: 0, why: "Today we are focusing on Bonzo." },
  { day: 4, text: "Which two pipeline stages do CLRs primarily work in?", choices: ["Responded and No Contact", "App Taken and Funded", "DNQ and Dead", "Hot Transfer and Nurture"], correct: 0, why: "This should be Responded and No Contact for the most part." },
  { day: 4, text: "Which rule applies to Chris's Bonzo and LOAs?", choices: ["The 14-day rule", "The 5-day rule", "The 30-day rule", "The 90-day rule"], correct: 0, why: "Explain the 14-day rule with Chris's Bonzo and LOAs." },
  { day: 4, text: "What must be memorised by the end of day four?", choices: ["The 14-day rule", "The product list", "The full state map", "The objection list"], correct: 0, why: "By EOD: Quiz #4, correct filters and exporting, and the 14-day rule memorized." },
  { day: 4, text: "Which two compliance concepts are taught on day four?", choices: ["DNC and STOP/No Text", "DTI and LTV", "W2 and 1099", "HELOC and Reverse"], correct: 0, why: "Explain what DNC and STOP/No Text are, and the difference between them." },
  { day: 4, text: "What else falls under day four's compliance section?", choices: ["The call times allowed for each state", "The maximum daily dial count", "The commission structure", "The seating chart"], correct: 0, why: "Go into detail about the call times allowed for each state and why staying within them matters." },
  { day: 4, text: "Daily filters in Bonzo are built for what purpose?", choices: ["Making a list for Bulk Texter", "Assigning LOs to CLRs", "Logging transfers", "Scoring call quality"], correct: 0, why: "Show them what their daily filters should look like when making a list for Bulk Texter." },

  // ── Day 5 — transfers, quality, KPIs ──────────────────────────────────────
  { day: 5, text: "When taking a lead to an LO, the CLR is:", choices: ["Telling them you are calling for them, not asking", "Asking permission first", "Emailing for approval", "Submitting a request in C3"], correct: 0, why: "Telling the LOs that you are calling for them — NOT ASKING." },
  { day: 5, text: "Which rule applies to W2 LOs?", choices: ["The 5-day lead rule", "The 14-day rule", "The 30-day rule", "The 24-hour rule"], correct: 0, why: "Explain the 5-day lead rule with W2 LOs." },
  { day: 5, text: "A live transfer walkthrough ends with which steps?", choices: ["The handoff, logging in C3, and reassigning in Bonzo", "The handoff only", "Logging in C3 only", "Emailing the borrower"], correct: 0, why: "Take them through the transfer, the handoff, logging C3, and reassigning in Bonzo." },
  { day: 5, text: "Who should explain why transfer quality matters?", choices: ["An experienced LO such as Dan, Derek, or Billy", "The trainee's peer CLR", "The compliance officer", "The office manager"], correct: 0, why: "Sit down with an experienced LO — Dan, Derek, or Billy would be good options." },
  { day: 5, text: "On day five's dial block, the trainer should:", choices: ["Back off slightly to gauge their edge, debriefing after every call", "Take over every call", "Leave the office", "Watch only the first call"], correct: 0, why: "Back off slightly to gauge their edge and responsiveness. Debrief after every call." },
  { day: 5, text: "What wraps up week one?", choices: ["KPIs, expectations, pay structure, and the promotion roadmap", "The final certification call", "The state licensing map", "A written exam"], correct: 0, why: "Go over daily and weekly KPIs, expectations, pay structure, and the promotion roadmap." },

  // ── Day 6 — lifecycle, states, career path ────────────────────────────────
  { day: 6, text: "Day six begins with:", choices: ["The lifecycle of a transfer, through to funding", "A written test", "Bulk Texter drills", "Objection roleplay"], correct: 0, why: "Walk them through the lifecycle of a transfer — what LOs do, the application process, funding." },
  { day: 6, text: "Who confirms the state list is correct?", choices: ["Ethan", "Matt", "Chris", "The trainee"], correct: 0, why: "Confirm that the states are correct with Ethan." },
  { day: 6, text: "Why must a CLR check state licensing during a transfer?", choices: ["The LO has to be licensed in the borrower's state", "It sets the interest rate", "It determines commission", "It decides the call window"], correct: 0, why: "We must find what state the LO is licensed in during a transfer." },
  { day: 6, text: "By the end of day six the trainee should be able to:", choices: ["Tell you each step of the loan process", "Pass the certification call", "Dodge the rate question", "Export a Bulk Texter list"], correct: 0, why: "By EOD: Quiz #6 and the ability to tell you each step of the loan process." },
  { day: 6, text: "What does day six revisit about the trainee's own future?", choices: ["The career path, comp expectations, and steps to LO or LOA", "Their probation terms", "Their shift pattern", "Their seating assignment"], correct: 0, why: "Walk them through the career path again, and be honest about compensation and wages." },

  // ── Day 7 — income types, DTI and LTV ─────────────────────────────────────
  { day: 7, text: "Which three income types are taught on day seven?", choices: ["W2, 1099, and self-employed", "Salary, bonus, and commission", "Fixed, variable, and passive", "W2, LOA, and CLR"], correct: 0, why: "Explain the difference between W2, 1099, and self-employed." },
  { day: 7, text: "Who is suggested as a good person to explain 1099 income?", choices: ["Devon", "Dan", "Chris", "Billy"], correct: 0, why: "Devon would be a good person for 1099." },
  { day: 7, text: "DTI and LTV are described as:", choices: ["Important topics and words we hear constantly", "Optional background knowledge", "Compliance-only terms", "Terms only LOs use"], correct: 0, why: "These are important topics and words we hear constantly." },
  { day: 7, text: "What does the plan call the core questions on the info call sheet?", choices: ["The Big 4", "The Big Three", "The Core Five", "The Opening Four"], correct: 0, why: "Drive home the point of the Big 4 questions on the info call sheets." },

  // ── Day 8 — quoting and rate deflection ───────────────────────────────────
  { day: 8, text: "May a CLR quote a borrower a rate?", choices: ["No — legally CLRs are not allowed to quote anyone", "Yes, if the LO approves first", "Yes, for refinances only", "Only within 0.25% of the real rate"], correct: 0, why: "Legally, we as CLRs are NOT allowed to quote anyone." },
  { day: 8, text: "Why is the no-quoting rule emphasised?", choices: ["Compliance", "It slows the call down", "It confuses the borrower", "It is an internal preference"], correct: 0, why: "This is especially important for compliance reasons." },
  { day: 8, text: "Which language does the plan suggest for the rate question?", choices: ["“I'm just an assistant…” / “I'm not legally allowed…”", "“Rates change too often to say”", "“Let me check and call you back”", "“That depends on your credit”"], correct: 0, why: "Something like “I'm just an assistant…” or “I'm not legally allowed…”." },
  { day: 8, text: "When deflecting the rate question, what should you position?", choices: ["That the LO will quote them as soon as the transfer is made", "That rates are published online", "That they should apply first", "That you will email the rate later"], correct: 0, why: "Position that the LO will be quoting them as soon as the transfer is made." },
  { day: 8, text: "Why throw 'random wrenches' into day eight's drills?", choices: ["Adapting on the phone is crucial", "To test their patience", "To fill the time", "Because the quiz includes them"], correct: 0, why: "Throw random wrenches at them to see how they adapt. Adapting on the phone is crucial." },
  { day: 8, text: "By the end of day eight, the trainee should:", choices: ["Dodge the rate question by heart", "Have memorised the state list", "Run an unsupervised dial block", "Have completed the final test"], correct: 0, why: "By EOD: Quiz #8 and the ability to dodge the rate question by heart." },

  // ── Day 9 — good vs bad calls, cadence, certification prep ────────────────
  { day: 9, text: "Day nine starts by establishing:", choices: ["What makes a call good versus bad, with examples", "The pay structure", "The state map", "Bulk Texter filters"], correct: 0, why: "Make sure they understand what a good call is and what a bad call is, with examples." },
  { day: 9, text: "Why do speed and cadence matter?", choices: ["They convey information correctly, and freezing loses the transfer", "They shorten the call", "They improve recording quality", "They are scored by CallTools"], correct: 0, why: "Freezing or taking too long will lose you a transfer." },
  { day: 9, text: "What must the trainee be able to do quickly during a live call?", choices: ["Search for and find a lead", "Calculate DTI", "Quote a rate", "Export a list"], correct: 0, why: "Verify they can search for and find a lead effectively, so they can finish each step live." },
  { day: 9, text: "Which pieces of language must be memorised by day nine?", choices: ["Opener, questions, objection responses, and the transfer/handoff", "Only the opener", "Only the objection responses", "Only the handoff"], correct: 0, why: "Have them recite their opener, questions, objection responses, and the transfer/handoff." },
  { day: 9, text: "What should the trainee produce while shadowing on day nine?", choices: ["Written observations and a good-or-bad judgement", "A recording", "A transfer log", "A Bonzo note"], correct: 0, why: "Have them make written observations and decide whether it was a good or bad call." },

  // ── Day 10 — review, final test, certification ────────────────────────────
  { day: 10, text: "How does day ten begin?", choices: ["Reviewing everything and reteaching weak spots", "The certification call", "The final test", "A dial block"], correct: 0, why: "Review everything, pull any weak spots, and reteach whatever needs work." },
  { day: 10, text: "When is the final test reviewed with the trainee?", choices: ["The same day, using the answer key", "The following week", "Only if they fail", "It is not reviewed"], correct: 0, why: "Review it using the answer key when they are finished, on the same day." },
  { day: 10, text: "What does the final certification call require?", choices: ["Calls until they land a transfer, with every step completed", "One perfect roleplay", "A passing written score only", "Three dials of any outcome"], correct: 0, why: "Have them make calls until they are able to make a transfer." },
  { day: 10, text: "During the certification call, the trainer should:", choices: ["Stand back and let them go, stepping in only if necessary", "Take over at the transfer", "Never intervene under any circumstances", "Make the call themselves"], correct: 0, why: "Stand back and let them go through the process. Step in if necessary." },
  { day: 10, text: "The certification call is only complete once:", choices: ["The transfer is logged in C3", "The borrower answers", "The LO confirms by email", "The quiz is marked"], correct: 0, why: "Every step of the call is completed, down to logging the transfer in C3." },
  { day: 10, text: "What is revisited on day ten about leads and licensing?", choices: ["When a lead can go to another LO, and how to verify state licensing", "The commission split", "The dial-count target", "The seating chart"], correct: 0, why: "They need to understand when we can give a lead to another LO and how to verify state licensing." },
];

/**
 * Choices are rotated so the correct answer is not always first. Authoring them
 * correct-first is the readable way to write a bank and the wrong way to ship
 * one: a trainee who always picks A would have scored 100%.
 *
 * The rotation is deterministic (driven by the question's position), so the
 * order is stable between rendering the test and grading it, and between one
 * trainee and the next — which is what makes the paper answer key usable.
 */
export const TEST_QUESTIONS: TestQuestion[] = RAW.map((q, i) => {
  const id = i + 1;
  const shift = id % q.choices.length;
  const choices = [...q.choices.slice(shift), ...q.choices.slice(0, shift)];
  return { ...q, id, choices, correct: (q.correct - shift + q.choices.length) % q.choices.length };
});

export const TEST_QUESTION_COUNT = TEST_QUESTIONS.length;
/**
 * Derived from the bank rather than hand-kept: an earlier version had a fixed
 * 60 here while the bank held 69, so the pass mark silently became 78%.
 */
export const TEST_PASS_CORRECT = Math.ceil((TEST_PASS_PERCENT / 100) * TEST_QUESTION_COUNT);

/** What the browser is allowed to see before the test is submitted. */
export function questionsWithoutAnswers(): Omit<TestQuestion, "correct" | "why">[] {
  return TEST_QUESTIONS.map(({ correct, why, ...rest }) => rest);
}

export function gradeTest(answers: Record<string, number>): {
  correctCount: number; total: number; percent: number; passed: boolean;
  results: { id: number; chosen: number | null; correct: number; isCorrect: boolean; why: string }[];
} {
  const results = TEST_QUESTIONS.map((q) => {
    const chosen = Number.isInteger(answers[String(q.id)]) ? answers[String(q.id)] : null;
    return { id: q.id, chosen, correct: q.correct, isCorrect: chosen === q.correct, why: q.why };
  });
  const correctCount = results.filter((r) => r.isCorrect).length;
  const percent = Math.round((correctCount / TEST_QUESTIONS.length) * 100);
  return { correctCount, total: TEST_QUESTIONS.length, percent, passed: correctCount >= TEST_PASS_CORRECT, results };
}
