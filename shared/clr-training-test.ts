// The 60-question certification test for Matt Lane's CLR training plan.
//
// ── What this test is for ────────────────────────────────────────────────────
// It gates real people, so it asks whether they can DO the job, not whether
// they read the schedule. An earlier bank asked things like "how many
// objections should the trainee master on day three?" — a question about the
// training plan, answerable by someone who has never held a call. Every
// question here puts the trainee in a moment on the phone: the borrower says
// this, the sheet is half full, the LO is not licensed there — what do you do.
//
// Every question is still answerable from the plan in shared/clr-training.ts,
// and has exactly one defensible answer: a test whose answers are arguable
// teaches nothing and cannot be graded fairly. Each carries `why`, which is
// shown after submission — it is coaching, not a citation, so it says what the
// rule buys you on a live call, not just where the rule is written.
//
// `correct` is the index into `choices`. The answer key never reaches the
// browser before submission: the server strips it (see /api/training-test).
// After submission it is attached ONLY to questions that submission actually
// answered — see gradeTest() and reviewAnswers(). Returning a row per question
// let anybody file an empty attempt and read all sixty answers off their own
// review before sitting the test for real.

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
  {
    day: 1,
    text: "A borrower picks up and you have not said a word yet. What comes out of your mouth?",
    choices: [
      "Your opener, delivered the same way it always is",
      "Whatever feels natural on that particular call",
      "The rate they saw in the advertisement",
      "A question about their credit score",
    ],
    correct: 0,
    why: "Day one exists to build your opening line, and by day nine it is recited from memory. The opener is the one part of the call you never improvise — it is what buys you the next thirty seconds.",
  },
  {
    day: 1,
    text: "A borrower picks up and inside two minutes you need their record open, the call running, and somewhere to put your notes. Which systems are you moving between?",
    choices: [
      "Bonzo, Dialpad, C3 and CallTools — you should be able to say what each one is for without stopping to think",
      "Bonzo only; everything else happens after the call",
      "Whichever one the LO tells you to use for that borrower",
      "CallTools only, until the transfer happens",
    ],
    correct: 0,
    why: "Bonzo, Dialpad, C3 and CallTools are introduced together because all four of them show up inside a single call. Hunting for the right window while a live borrower waits is the same dead air that loses you the transfer.",
  },
  {
    day: 1,
    text: "Two borrowers get the same opener from you and react completely differently — one is chatty, the other is short with you. What has to change?",
    choices: [
      "How you run the call from there; the opener itself stays the same",
      "The opener, so it suits each personality",
      "Nothing — you run the identical call either way",
      "You should cut the short call and redial them later",
    ],
    correct: 0,
    why: "Bringing different personalities to each call is what shows you the requirement to adapt while on the phone. The opener is the one fixed part of the call; everything after it bends to the person you actually got.",
  },
  {
    day: 1,
    text: "You are not sure whether what you just did actually counts as a transfer, and the floor is busy. What do you do?",
    choices: [
      "Ask — what constitutes a transfer is covered, and no question is a dumb question",
      "Log it as a transfer and correct it later if anyone objects",
      "Leave it unlogged until you work it out for yourself",
      "Decide by whether the LO seemed pleased",
    ],
    correct: 0,
    why: "Day one covers what constitutes a transfer and explicitly invites questions. Guessing at the definition is how the transfer count stops meaning anything for everybody, not just for you.",
  },
  {
    day: 1,
    text: "You have a live borrower ready to be handed over and you are not sure where that LO actually sits. What has that cost you?",
    choices: [
      "Time you do not have — the seating chart is something you memorise, not something you work out mid-transfer",
      "Nothing, as long as you find them in the end",
      "Only the LO's patience",
      "Nothing — the handoff happens over Dialpad anyway",
    ],
    correct: 0,
    why: "The seating chart is handed over on the first day to be memorised, and the handoff is walked in person: you go to the LO and give them your notes. Wandering the floor with a borrower holding is the same dead air as freezing on the phone.",
  },

  // ── Day 2 — product, the info sheet, the clean transfer ───────────────────
  {
    day: 2,
    text: "You have the borrower talking. Which part of the info sheet do you go after first?",
    choices: [
      "Their goal — what they are actually trying to do",
      "Their property value",
      "Their credit score",
      "Their current interest rate",
    ],
    correct: 0,
    why: "Start with the goal of the borrower. Every other field on the sheet only means something once you know what they are trying to accomplish, and the LO opens with it too.",
  },
  {
    day: 2,
    text: "A friendly borrower is in a hurry and offers to \"send the rest of the details over later\". What do you do?",
    choices: [
      "Keep them on and get the information now — that is what the sheet is for",
      "Agree, and note that they will email it through",
      "Transfer them and let the LO collect the rest",
      "End the call and try them again tomorrow",
    ],
    correct: 0,
    why: "Be hellbent on getting the information on the call. Information promised for after the call is information you do not have, and the LO finds that out in front of the borrower.",
  },
  {
    day: 2,
    text: "Which call is the named exception to getting the information while you are on the phone?",
    choices: [
      "Calling the LO \"Responded\" pipeline",
      "Any call placed after 5pm",
      "A borrower who has spoken to us before",
      "A borrower who says they are driving",
    ],
    correct: 0,
    why: "There are exceptions to not getting information on the call, like when calling the LO Responded pipeline. One named exception — everything else is you deciding the rule does not apply today.",
  },
  {
    day: 2,
    text: "A borrower opens with \"I saw your ad — I want the one where you take cash out.\" What lets you follow that?",
    choices: [
      "Knowing our product list — plenty of our leads have seen the advertising and already have a product in mind",
      "Asking them to forward you the advertisement",
      "Transferring straight away, since they already know what they want",
      "Nothing; product questions belong to the LO",
    ],
    correct: 0,
    why: "You are walked through our product list precisely because some of our leads have seen our advertisements and already have an idea of what they are interested in. A borrower who names a product and gets a blank pause has just learned you are not the person to talk to.",
  },
  {
    day: 2,
    text: "The borrower's situation turns out to be a reverse mortgage — the one scenario you have drilled least. What does the plan expect?",
    choices: [
      "The same clean, smooth call; you drill all three until each one is clean",
      "Take the details and pass it to somebody else to call back",
      "Transfer immediately without the sheet",
      "Treat it as a refinance, which is close enough",
    ],
    correct: 0,
    why: "Don't stop until they each have a clean and smooth call. Refinance, HELOC and Reverse are all in scope — the Big Three scenario you like least is the one to drill hardest.",
  },
  {
    day: 2,
    text: "Three borrowers in a row tell you they can barely hear you. What is that, and when should it have been caught?",
    choices: [
      "Your gear — the headset and mic are checked before you are on live calls, not after a borrower tells you",
      "Bad lines on those particular leads",
      "Your pace; you are speaking too quickly",
      "Nothing to act on until it costs you a transfer",
    ],
    correct: 0,
    why: "The gear setup includes a mic check and a test of every piece of equipment before any of it matters on a call. A borrower who cannot hear you does not tell you twice, and the three calls it took to notice are three calls you do not get back.",
  },
  {
    day: 2,
    text: "You have walked the borrower over and the LO has taken the conversation. What is still yours?",
    choices: [
      "The Bonzo note, the log, and the rest of the post-call work",
      "Nothing — the handoff is the finish line",
      "Only the Bonzo note",
      "Only the C3 log",
    ],
    correct: 0,
    why: "A clean transfer is every step: walking to the LO, giving them notes, putting notes in Bonzo, logging the transfer, and any other post-call responsibilities. The handoff is the middle, not the end.",
  },
  {
    day: 2,
    text: "When you walk a borrower over, what does the LO get from you besides the borrower?",
    choices: [
      "Your notes on the conversation you just had",
      "The call recording",
      "Your Bonzo login",
      "Nothing — they take it from there",
    ],
    correct: 0,
    why: "Walking to the LO, giving them notes. Without them the LO restarts the conversation from zero in front of a borrower who has already answered those questions once.",
  },

  // ── Day 3 — questions, rapport, tone, objections ──────────────────────────
  {
    day: 3,
    text: "You ask \"are you looking to lower your payment?\" and the borrower says no. What went wrong?",
    choices: [
      "You asked a closed-ended question and handed them a free out",
      "Nothing — that is a clean disqualification",
      "You should have asked about their rate first",
      "Your tone was wrong",
    ],
    correct: 0,
    why: "Closed-ended questions give the borrower a free out, and they will take it. Asked open — what would you want to change about the payment? — the same borrower explains their situation instead of ending it.",
  },
  {
    day: 3,
    text: "You ask the same borrower the open version instead. What does that buy you?",
    choices: [
      "They explain in detail what they are actually looking for",
      "A shorter call",
      "A cleaner compliance record",
      "A guaranteed transfer",
    ],
    correct: 0,
    why: "Open-ended questions open the door for them to explain in detail what they are looking for. Detail is what the info sheet and the LO both run on — you cannot transfer a yes/no.",
  },
  {
    day: 3,
    text: "It is a flat afternoon and it is showing in your voice. Why does that cost you transfers?",
    choices: [
      "If you don't sound happy to talk to them, they won't want to talk",
      "It makes the recording harder to review later",
      "It slows down your dial count",
      "It doesn't — tone is not something we measure",
    ],
    correct: 0,
    why: "Tone is important because if you don't sound happy to talk to them, they won't want to talk. Tone is not decoration; it decides whether the conversation happens at all.",
  },
  {
    day: 3,
    text: "A borrower is guarded and answering in single words. What is the move?",
    choices: [
      "Build rapport first — comfortable borrowers open up more",
      "Push through the sheet faster before they go",
      "Ask for the transfer immediately",
      "End the call and try them another day",
    ],
    correct: 0,
    why: "Building rapport with borrowers makes them feel comfortable, and they will open up more. The information you want sits on the far side of them being comfortable, not before it.",
  },
  {
    day: 3,
    text: "An objection lands that is not one of the top four, and you have to stop and think about it. What does that tell you?",
    choices: [
      "The four that come automatically are the four you drilled — this one goes on the list to drill next",
      "Nothing; only the top four ever need a response",
      "You should have asked for the transfer before it came up",
      "Objections outside the top four are the LO's problem",
    ],
    correct: 0,
    why: "The top four are the ones you master until they come without thinking, but they are four off a longer list of the objections we actually get. The one you freeze on is the one you are guaranteed to meet again, so it is the one worth tonight.",
  },
  {
    day: 3,
    text: "An objection lands mid-call. What are you actually trying to do with it?",
    choices: [
      "Reframe it — flip the objection around",
      "Win the argument on the facts",
      "Acknowledge it and move on quickly",
      "Hand the call straight to an LO",
    ],
    correct: 0,
    why: "This part is all about having them understand how to flip an objection around. An objection tells you what they care about; reframed, it becomes the reason to speak to the LO.",
  },
  {
    day: 3,
    text: "The same objection comes at you from two very different borrowers. Does it get the same response?",
    choices: [
      "The reframe is the same; the language you use is picked for the person in front of you",
      "Yes — the response is scripted word for word",
      "No — a completely different objection response each time",
      "It depends which pipeline they came out of",
    ],
    correct: 0,
    why: "You learn how to get around each objection and what language would be beneficial in each scenario — two different things. The move is fixed; the words are the part you fit to the borrower, which is only possible once the move itself is automatic.",
  },
  {
    day: 3,
    text: "You filled the whole sheet, but the borrower never warmed to you and declines the transfer. Which part of the call decided that?",
    choices: [
      "Rapport and tone — both sway the call and decide whether you get a transfer at all",
      "The sheet, which you must have worked in the wrong order",
      "Nothing you control; some borrowers simply decline",
      "Your objection responses, since one of them clearly did not land",
    ],
    correct: 0,
    why: "Open-ended questions, rapport and tone each sway the call and determine whether you get a transfer or not. A complete sheet is not a warm borrower, and it is the warm borrower who agrees to be walked over to an LO.",
  },

  // ── Day 4 — Bonzo, pipelines, compliance ──────────────────────────────────
  {
    day: 4,
    text: "It is 8:05am where you are sitting and your next lead is two time zones east. What decides whether you dial?",
    choices: [
      "That state's allowed call hours, checked before you dial",
      "Your own local time",
      "Whether the lead sits in Responded",
      "Whether an LO is at their desk yet",
    ],
    correct: 0,
    why: "Go into detail about the call times allowed for each state, and the importance of staying within these hours. The borrower's state sets the window; your clock has no standing.",
  },
  {
    day: 4,
    text: "Why does the plan insist you know the difference between DNC and STOP/No Text rather than treating them as one rule?",
    choices: [
      "They are different restrictions — confusing them either breaks compliance or kills a lead you could still work",
      "Only one of them is recorded in Bonzo",
      "They apply to different pipelines",
      "One is a Bonzo rule and the other is a CallTools rule",
    ],
    correct: 0,
    why: "Explain what DNC and STOP/No Text are, how to use them, and what the difference is between the two. The difference is the whole point of teaching both.",
  },
  {
    day: 4,
    text: "Which two pipeline stages is your day actually spent in?",
    choices: [
      "Responded and No Contact",
      "App Taken and Funded",
      "DNQ and Dead",
      "Hot Transfer and Nurture",
    ],
    correct: 0,
    why: "We primarily reside in Responded and No Contact. Knowing where you live in the pipeline is what makes a daily filter mean anything.",
  },
  {
    day: 4,
    text: "A call ends and the borrower's situation is now clearly different from what the pipeline says. What has to happen?",
    choices: [
      "Disposition them correctly — the stage change is part of the call, not admin",
      "Nothing, unless it turned into a transfer",
      "Leave it for a manager to reconcile later",
      "Add a note and leave the stage alone",
    ],
    correct: 0,
    why: "Practise dispositioning people correctly, including a stage change on a live call. A pipeline nobody dispositions is a list that lies to the next person who calls it.",
  },
  {
    day: 4,
    text: "What are your daily filters actually for?",
    choices: [
      "Building the list you will work, including the Bulk Texter export",
      "Assigning LOs to CLRs",
      "Logging transfers at the end of the day",
      "Scoring the quality of your calls",
    ],
    correct: 0,
    why: "Show them what their daily filters should look like when making a list for Bulk Texter. The filter is how a whole database becomes one day's work.",
  },
  {
    day: 4,
    text: "A lead in Chris's Bonzo was last touched nine days ago. Which rule are you reasoning about?",
    choices: [
      "The 14-day rule",
      "The 5-day lead rule",
      "The 30-day rule",
      "The 90-day rule",
    ],
    correct: 0,
    why: "The 14-day rule applies to Chris's Bonzo and LOAs; the 5-day lead rule is the W2 LO one. Day four is not finished until the 14-day rule is memorised, precisely so this is not a guess.",
  },
  {
    day: 4,
    text: "You are about to export a list for Bulk Texter. What has to be true before you press it?",
    choices: [
      "It came out of the correct daily filters",
      "It contains at least fifty rows",
      "A manager has signed it off",
      "Every lead on it sits in Responded",
    ],
    correct: 0,
    why: "Day four's outcome is correct filters and exporting. A wrong filter texts the wrong people, which is a compliance problem rather than a tidiness one.",
  },

  // ── Day 5 — transfers, quality, KPIs ──────────────────────────────────────
  {
    day: 5,
    text: "You have a live borrower and you need an LO. How do you approach them?",
    choices: [
      "Tell them you are calling for them — you are not asking",
      "Ask whether they have a moment",
      "Send a Dialpad message and wait for a reply",
      "Email the request and stay on the line",
    ],
    correct: 0,
    why: "Telling the LOs that you are calling for them — NOT ASKING. A live borrower on hold does not survive a negotiation happening across the room.",
  },
  {
    day: 5,
    text: "Why is that posture in the plan at all?",
    choices: [
      "The borrower is live and waiting; hesitation at the handoff loses the transfer",
      "LOs simply prefer to be told",
      "It is a compliance requirement",
      "It speeds up the Bonzo reassignment afterwards",
    ],
    correct: 0,
    why: "The handoff is a live moment and the CLR runs it. It sits alongside the day-nine rule that freezing or taking too long will lose you a transfer — the same silence, a different part of the call.",
  },
  {
    day: 5,
    text: "You could send four rushed transfers today or two that hold up. Which does the plan want?",
    choices: [
      "The two — quality over quantity",
      "The four — volume is the KPI",
      "Whichever the receiving LO says they prefer",
      "The four, then tidy the notes afterwards",
    ],
    correct: 0,
    why: "Quality is important during transfers, and quality over quantity on the dial block. A transfer that falls apart in front of the LO costs more than the dial you never made.",
  },
  {
    day: 5,
    text: "The transfer is done and the borrower is with the LO. Which steps are still yours?",
    choices: [
      "Logging it in C3 and reassigning in Bonzo",
      "Logging it in C3 only",
      "Reassigning in Bonzo only",
      "Neither — the LO owns the record now",
    ],
    correct: 0,
    why: "Take them through the transfer, the handoff, logging C3, and reassigning in Bonzo. Both systems have to agree with what just happened in the room, or somebody calls that lead again tomorrow.",
  },
  {
    day: 5,
    text: "An LO tells you the last two borrowers you walked over arrived with no goal written down. What does that change?",
    choices: [
      "How you run the next transfer — the LO receiving them is the one who can tell you what a bad one costs",
      "Nothing; the sheet is your record, not theirs",
      "You send that LO fewer transfers from now on",
      "You ask a manager to reset the LO's expectations",
    ],
    correct: 0,
    why: "An experienced LO is sat down with every new CLR to explain why quality matters, because the person who receives your transfers is the only one who can tell you what a bad one actually costs. Feedback from that end is not a complaint; it is the measurement.",
  },
  {
    day: 5,
    text: "A W2 LO's lead came in six days ago. Which rule are you reasoning about?",
    choices: [
      "The 5-day lead rule",
      "The 14-day rule",
      "The 30-day rule",
      "The 24-hour rule",
    ],
    correct: 0,
    why: "The 5-day lead rule is the W2 LO rule; the 14-day rule is Chris's Bonzo and LOAs. Two rules for two situations — mixing them up is how a lead gets worked by the wrong person.",
  },
  {
    day: 5,
    text: "You have just come off a call that went badly, and the next lead is already up. What happens first?",
    choices: [
      "The debrief — every call gets one, and the next dial is worth less than knowing what went wrong on this one",
      "The next dial; you can review the whole block at the end of the day",
      "A note in Bonzo, and nothing else",
      "Nothing — bad calls are not worth going back over",
    ],
    correct: 0,
    why: "Debrief after every call, not at the end of the block. A mistake you carry into the next four dials costs you four calls; a mistake you name straight away costs you one.",
  },

  // ── Day 6 — lifecycle, states, licensing ──────────────────────────────────
  {
    day: 6,
    text: "You have a live borrower and the only LO free right now is not licensed in that state. What happens?",
    choices: [
      "It goes to an LO who is licensed there — you verify before you walk over",
      "Transfer anyway and let the LO sort the licensing out",
      "Take the information and call the borrower back tomorrow",
      "Transfer it to an LOA instead",
    ],
    correct: 0,
    why: "We must find what state the LO is licensed in during a transfer. Licensing is not a preference or a nicety — an unlicensed LO cannot take that borrower at all.",
  },
  {
    day: 6,
    text: "Where does the state list get confirmed as correct?",
    choices: [
      "With Ethan",
      "With the borrower on the call",
      "In CallTools",
      "In the Bonzo pipeline view",
    ],
    correct: 0,
    why: "Confirm that the states are correct with Ethan. The list is what you check licensing against, so a stale list is a compliance exposure rather than a small inconvenience.",
  },
  {
    day: 6,
    text: "A borrower asks what actually happens after they speak to the loan officer. What should you be able to say?",
    choices: [
      "The steps through application and funding — you were walked through the whole lifecycle",
      "That it is not your side of the business",
      "Only that the LO will call them back",
      "What rate they are likely to end up with",
    ],
    correct: 0,
    why: "Walk them through the lifecycle of a transfer: what the LOs do, the application process, funding. A borrower who knows what happens next is a borrower who stays on the phone for it.",
  },
  {
    day: 6,
    text: "Why does the plan keep separating LOs from LOAs?",
    choices: [
      "They are different roles under different rules, and which one you are handing to changes what you do",
      "Only their compensation differs",
      "LOAs cannot receive transfers at all",
      "It only matters for the seating chart",
    ],
    correct: 0,
    why: "The difference between LOs and LOAs is called out on day four and again on day six as very important. It drives the 14-day rule, licensing, and where a lead is allowed to go.",
  },
  {
    day: 6,
    text: "You have a borrower in a state you have never transferred to before and the clock is running. Where do you look?",
    choices: [
      "The state list — you have clicked through it yourself, so finding a state on it is not something you are learning now",
      "Ask the borrower which lenders work in their state",
      "Whichever LO is free, and let them tell you",
      "The Bonzo pipeline view",
    ],
    correct: 0,
    why: "You are walked through the state list and made to click through it yourself, exactly so that during a live transfer you are reading it rather than learning it. It is also the list that has to be confirmed as correct, so a state you cannot find on it is a question and not a guess.",
  },

  // ── Day 7 — income types, DTI and LTV ─────────────────────────────────────
  {
    day: 7,
    text: "A borrower says they own their own business and pay themselves out of it. Which income bucket is that conversation?",
    choices: [
      "Self-employed — one of W2, 1099 and self-employed",
      "W2, because they pay themselves a wage",
      "1099, because they invoice",
      "It does not need to be recorded on the sheet",
    ],
    correct: 0,
    why: "Explain the difference between W2, 1099, and self-employed. Which bucket the borrower is in changes what the LO has to document, so it belongs on the sheet correctly the first time.",
  },
  {
    day: 7,
    text: "You are unclear on how 1099 income actually works. Who does the plan point you at?",
    choices: [
      "Devon",
      "Dan",
      "Chris",
      "Billy",
    ],
    correct: 0,
    why: "Devon would be a good person for 1099. The plan names people for exactly this — asking the person sitting in the room beats guessing in front of a borrower.",
  },
  {
    day: 7,
    text: "The borrower uses the term LTV halfway through a sentence. What does the plan expect of you?",
    choices: [
      "To know it — DTI and LTV are words we hear constantly",
      "To ask them to explain what they mean by it",
      "To transfer immediately, since they are clearly informed",
      "To ignore it and carry on down the sheet",
    ],
    correct: 0,
    why: "Explain DTI and LTV. These are important topics and words we hear constantly. Asking a borrower to explain their own loan back to you costs you the standing the call needs.",
  },
  {
    day: 7,
    text: "What are the \"Big 4\"?",
    choices: [
      "The core questions on the info call sheet",
      "The four biggest objections",
      "The four income types",
      "The four highest-producing LOs",
    ],
    correct: 0,
    why: "Drive home the point of the Big 4 questions we have on the info call sheets. The Big Three are the scenarios and the Big 4 are the questions — two different lists that get confused constantly.",
  },
  {
    day: 7,
    text: "You have the borrower's income figure written down but not which type it is. Is that field finished?",
    choices: [
      "No — the type is what makes the number mean anything",
      "Yes, the number is what the LO needs",
      "Yes, if the transfer is happening today anyway",
      "Only if they said they were W2",
    ],
    correct: 0,
    why: "Make sure they know the difference between each kind of income on the info sheet. A number with no type attached is a number the LO cannot actually use.",
  },

  // ── Day 8 — quoting and rate deflection ───────────────────────────────────
  {
    day: 8,
    text: "\"So what rate can you do for me?\" What do you say?",
    choices: [
      "Deflect — you are not legally allowed to quote, and the LO will quote as soon as you transfer",
      "Give the rate you saw this morning, marked clearly as approximate",
      "Give them a range rather than a number",
      "Tell them rates move too often to discuss",
    ],
    correct: 0,
    why: "Legally, we as CLRs are NOT allowed to quote anyone, and you position that the LO will be quoting them as soon as the transfer is made. That is routing the question to whoever may answer it, not refusing it.",
  },
  {
    day: 8,
    text: "The LO has already told you the number and the borrower asks you to repeat it. May you now?",
    choices: [
      "No — the rule is about who may quote, not about who knows the number",
      "Yes, you are only repeating the LO",
      "Yes, as long as the LO is standing next to you",
      "Yes, if you add that it is subject to change",
    ],
    correct: 0,
    why: "Legally, we as CLRs are NOT allowed to quote anyone. Knowing the number was never the issue; you saying it is what crosses the line.",
  },
  {
    day: 8,
    text: "Which language does the plan actually put in your mouth for the rate question?",
    choices: [
      "\"I'm just an assistant…\" / \"I'm not legally allowed…\"",
      "\"Rates change too often for me to say\"",
      "\"Let me check on that and call you back\"",
      "\"That really depends on your credit\"",
    ],
    correct: 0,
    why: "Something like \"I'm just an assistant\" or \"I'm not legally allowed\". It is honest, it is short, and it sets the LO up as the person who can answer — which is the transfer.",
  },
  {
    day: 8,
    text: "Why is the no-quoting rule the one rule with no judgement call in it?",
    choices: [
      "It is a legal limit on what a CLR may say, not an internal preference",
      "Because it slows the call down",
      "Because it confuses borrowers",
      "Because rates are already published online",
    ],
    correct: 0,
    why: "This is especially important for compliance reasons. Every other rule in the plan is about being good at the job; this one is about being allowed to do it.",
  },
  {
    day: 8,
    text: "Halfway through the sheet the borrower changes their goal completely. What does the plan want to see?",
    choices: [
      "You adapt and keep going — adapting on the phone is crucial",
      "You restart the sheet from the top",
      "You end the call and redial once you have regrouped",
      "You transfer immediately before they change again",
    ],
    correct: 0,
    why: "Throw random wrenches at them to see how they can adapt. Adapting on the phone is crucial — the sheet is a floor to stand on, not a rail to be dragged along.",
  },
  {
    day: 8,
    text: "A rate shopper asks you for a number three times running and will not move past it. What are you doing while that happens?",
    choices: [
      "Deflecting without hesitating, every time, and putting the LO forward as the person who can answer it",
      "Giving a ballpark by the third ask, since they clearly will not stop",
      "Ending the call — they are not a real lead",
      "Telling them that nobody here is able to discuss rates",
    ],
    correct: 0,
    why: "Dodging the rate question has to be by heart, because a pause in front of it reads to the borrower as though you are hiding something. And the answer is never \"nobody can tell you\" — it is that the LO will be quoting them as soon as the transfer is made.",
  },

  // ── Day 9 — good vs bad calls, cadence, certification prep ────────────────
  {
    day: 9,
    text: "You spend a slow ten seconds hunting for the lead while the borrower waits. How does the plan read that?",
    choices: [
      "Freezing or taking too long will lose you a transfer",
      "It is fine as long as you apologise for the wait",
      "It only matters on Responded leads",
      "It affects call quality scoring and nothing else",
    ],
    correct: 0,
    why: "Verify they can search for and find a lead effectively, because freezing or taking too long will lose you a transfer. Dead air on a live call is not neutral — it is the borrower deciding you are not ready for them.",
  },
  {
    day: 9,
    text: "You listen back to a call that got a transfer but skipped half the sheet. Good call or bad call?",
    choices: [
      "Bad — a good outcome does not make the process right",
      "Good — a transfer is a transfer",
      "Good, as long as the LO did not complain",
      "Neither; only the LO who received it can judge that",
    ],
    correct: 0,
    why: "Day nine is about knowing what a good call is and what a bad call is, and every step of the call has to be completed. A lucky transfer teaches the wrong lesson twice — to you and to whoever copies you.",
  },
  {
    day: 9,
    text: "Which pieces of your language have to be memorised, not just written down somewhere?",
    choices: [
      "The opener, the questions, the objection responses, and the transfer/handoff",
      "The opener only",
      "The objection responses only",
      "The handoff only",
    ],
    correct: 0,
    why: "Have them recite their opener, questions, objection responses, and finally the transfer/handoff. All four — a call is only as smooth as the moment you have to stop and think.",
  },
  {
    day: 9,
    text: "You are word-perfect on your language, but the borrower keeps asking you to repeat things. What is going wrong?",
    choices: [
      "Your speed and cadence — the right words at the wrong pace do not land",
      "Your opener, which must be running too long",
      "The order of the sheet; you should be working it top to bottom",
      "Nothing you control — some borrowers just ask you to repeat things",
    ],
    correct: 0,
    why: "Speed and cadence are important on a call to correctly convey information to the borrower. The right words at the wrong pace do not land, and you do not get told that they did not — you get a borrower who quietly stops following you.",
  },
  {
    day: 9,
    text: "You get through the opener, the sheet and the objections cleanly, and then the handoff gets away from you. How does that call score?",
    choices: [
      "As a bad call — every step has to be finished on the live call, and the handoff is a step",
      "As a good call with one weak moment at the end",
      "As neutral; the handoff belongs to the LO",
      "It depends whether the borrower was ever going to transfer",
    ],
    correct: 0,
    why: "Being able to finish each step during a live call is what is being verified, and the transfer/handoff is on the list of language you have to have memorised. A call that dies at the last step is a call you lost, not a call you nearly won.",
  },

  // ── Day 10 — review, final test, certification ────────────────────────────
  {
    day: 10,
    text: "You pass the written certification test. Are you certified?",
    choices: [
      "No — the certification call still has to happen, ending in a logged transfer",
      "Yes, the written test is the certification",
      "Yes, provided you scored above 90%",
      "Yes, once somebody signs the sheet off",
    ],
    correct: 0,
    why: "Day ten ends with a certification call: dial until they land a transfer, every step completed, down to logging it in C3. The written test is the smaller half of the day.",
  },
  {
    day: 10,
    text: "Two weeks in, you are solid on everything except the reverse scenario — and you are the only one who knows it. What do you do?",
    choices: [
      "Say so, and work it until it is as clean as the other two",
      "Avoid reverse leads until you feel more confident",
      "Wait and see whether it actually costs you a transfer",
      "Nothing — it will come with practice on live calls",
    ],
    correct: 0,
    why: "The last day exists to pull any weak spots and rework whatever needs it, until every topic is understood and you can repeat it back. A gap you keep to yourself gets found by a borrower instead, which is the expensive way to find it.",
  },
  {
    day: 10,
    text: "You are about to start a dial block. What does somebody experienced do before the first number goes out?",
    choices: [
      "Run their own pre-dial routine — the list, the rules and the sheet are settled before anybody picks up",
      "Nothing; the first few calls are the warm-up",
      "Ask a manager which pipeline to work today",
      "Clear the previous day's Bonzo notes",
    ],
    correct: 0,
    why: "You watch somebody run their own pre-dial routine and then make calls, because everything you can settle in advance — the filters, the call window, whose lead it is — is one fewer thing to work out with a borrower already on the line.",
  },
  {
    day: 10,
    text: "A lead you have been working belongs to an LO who is out of the office. What do you have to settle before it moves?",
    choices: [
      "When a lead may go to another LO, and how to verify that LO's state licensing",
      "The commission split on the transfer",
      "Whether it helps your dial count",
      "Where that LO sits on the seating chart",
    ],
    correct: 0,
    why: "They need to understand in what cases we can give a lead to another LO and how to verify state licensing. Moving a lead is a licensing question first and a courtesy question second.",
  },
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

/** Reveal feedback for exactly one answered question, never the whole key. */
export function checkTestAnswer(questionId: number, chosen: number): {
  id: number;
  chosen: number;
  correct: number;
  isCorrect: boolean;
  why: string;
} | null {
  if (!Number.isInteger(questionId) || !Number.isInteger(chosen) || chosen < 0 || chosen > 3) return null;
  const question = TEST_QUESTIONS.find((item) => item.id === questionId);
  if (!question) return null;
  return {
    id: question.id,
    chosen,
    correct: question.correct,
    isCorrect: chosen === question.correct,
    why: question.why,
  };
}

export type GradedAnswer = { id: number; chosen: number; correct: number; isCorrect: boolean; why: string };

/**
 * Grade a submission.
 *
 * `results` carries the key, so it covers ONLY the questions this submission
 * actually answered. A row per question would hand somebody who submitted an
 * empty paper all 60 answers — the same leak the review below had, on the way
 * in rather than on the way out. Unanswered questions still count as wrong
 * (see TEST_PASS_CORRECT, which is a share of the whole bank); they come back
 * as bare ids in `unanswered`, with nothing attached.
 */
export function gradeTest(answers: Record<string, number>): {
  correctCount: number; total: number; percent: number; passed: boolean;
  results: GradedAnswer[];
  /** Ids only. No choice, no answer, no explanation. */
  unanswered: number[];
} {
  const results: GradedAnswer[] = [];
  const unanswered: number[] = [];
  let correctCount = 0;
  for (const q of TEST_QUESTIONS) {
    const stored: unknown = answers ? answers[String(q.id)] : undefined;
    const chosen = typeof stored === "number" ? stored : NaN;
    // Out of range is not an answer. Treating it as one would leak the key for
    // a question the paper never really engaged with.
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= q.choices.length) {
      unanswered.push(q.id);
      continue;
    }
    const isCorrect = chosen === q.correct;
    if (isCorrect) correctCount += 1;
    results.push({ id: q.id, chosen, correct: q.correct, isCorrect, why: q.why });
  }
  const percent = Math.round((correctCount / TEST_QUESTIONS.length) * 100);
  return {
    correctCount, total: TEST_QUESTIONS.length, percent,
    passed: correctCount >= TEST_PASS_CORRECT, results, unanswered,
  };
}

// ── Review ───────────────────────────────────────────────────────────────────
// The stored `answers` blob is the only record of WHICH questions somebody got
// wrong. Everything below turns it back into something a trainer can read.
// Deliberately pure: no database, no session, so the authority rules live in
// exactly one place (the route) rather than being half-enforced here.

/** The stored blob is JSON text written by us, but it is still parsed input. */
export function parseStoredAnswers(raw: unknown): Record<string, number> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try { value = JSON.parse(raw); } catch { return {}; }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, choice] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(choice);
    if (Number.isInteger(n) && n >= 0 && n <= 3) out[key] = n;
  }
  return out;
}

/**
 * Who may read a stored attempt.
 *
 * Lives here rather than inline in the route so it can be tested from both
 * sides directly, and so there is exactly ONE rule: your own always, anybody
 * else's only as a manager. `isManager` is decided by the route from the same
 * check the attempt history has always used — this function deliberately does
 * not re-derive it, because two notions of authority is how a privacy rule
 * stops applying to one endpoint.
 */
export function canReviewAttempt(opts: { viewerId: number; isManager: boolean; attemptUserId: number }): boolean {
  const viewerId = Number(opts?.viewerId);
  if (!Number.isFinite(viewerId) || viewerId <= 0) return false;
  if (opts.isManager) return true;
  return Number(opts?.attemptUserId) === viewerId;
}

export type AnswerReview = {
  id: number;
  day: number;
  text: string;
  choices: string[];
  /** Always a real choice: a question with no answer is not reviewed at all. */
  chosen: number;
  chosenText: string;
  correct: number;
  correctText: string;
  isCorrect: boolean;
  why: string;
};

/**
 * One attempt, question by question: what was asked, what they picked, what the
 * answer was, and why. This is the thing that was missing — a percentage tells
 * a trainer that somebody struggled, never with what.
 *
 * ONLY the questions this attempt answered.
 *
 * Returning a row per question looked harmless — a blank is worth coaching too
 * — but each row carries `correct`, `correctText` and `why`. So anybody who
 * had not sat the test could file an empty attempt, open its own review, and
 * read all 60 answers before taking it for real. A question with no answer on
 * it has nothing to review, so it is not reviewed; the ids come back separately
 * through unansweredQuestionIds(), bare.
 */
export function reviewAnswers(answers: unknown): AnswerReview[] {
  const picked = parseStoredAnswers(answers);
  const out: AnswerReview[] = [];
  for (const q of TEST_QUESTIONS) {
    if (!Object.prototype.hasOwnProperty.call(picked, String(q.id))) continue;
    const chosen = picked[String(q.id)];
    out.push({
      id: q.id,
      day: q.day,
      text: q.text,
      choices: q.choices,
      chosen,
      chosenText: q.choices[chosen] ?? "",
      correct: q.correct,
      correctText: q.choices[q.correct],
      isCorrect: chosen === q.correct,
      why: q.why,
    });
  }
  return out;
}

/**
 * The questions this attempt left blank — ids and nothing else.
 *
 * A trainer still needs to know a paper was half finished; they do not need the
 * answers to the half that was skipped in order to know it.
 */
export function unansweredQuestionIds(answers: unknown): number[] {
  const picked = parseStoredAnswers(answers);
  return TEST_QUESTIONS
    .filter((q) => !Object.prototype.hasOwnProperty.call(picked, String(q.id)))
    .map((q) => q.id);
}

export type QuestionMissRate = {
  id: number;
  day: number;
  text: string;
  correct: number;
  correctText: string;
  /** How many attempts included this question at all. */
  attempts: number;
  missed: number;
  blank: number;
  /** 0–100, rounded. */
  missRate: number;
  /** The wrong answer the team reaches for most, which is usually the lesson. */
  topWrong: { index: number; text: string; count: number } | null;
  why: string;
};

/**
 * Across many attempts, which questions does the team get wrong?
 *
 * This is the report that says something about the TRAINING rather than about
 * one trainee: if eleven of thirteen people pick the same wrong answer, the
 * problem is upstream of all of them. Sorted worst-first, which is the order a
 * trainer wants to read it in.
 */
export function missRates(attempts: unknown[]): QuestionMissRate[] {
  const parsed = (attempts ?? []).map(parseStoredAnswers);
  return TEST_QUESTIONS.map((q) => {
    const key = String(q.id);
    let seen = 0, missed = 0, blank = 0;
    // Four choices, so a fixed array beats a Map and keeps tsc's baseline.
    const wrongCounts = [0, 0, 0, 0];
    for (const answers of parsed) {
      seen += 1;
      const has = Object.prototype.hasOwnProperty.call(answers, key);
      // A blank is a miss, not an abstention — the trainee did not know it.
      if (!has) { blank += 1; missed += 1; continue; }
      const chosen = answers[key];
      if (chosen === q.correct) continue;
      missed += 1;
      wrongCounts[chosen] = (wrongCounts[chosen] ?? 0) + 1;
    }
    let topWrong: QuestionMissRate["topWrong"] = null;
    for (let index = 0; index < wrongCounts.length; index++) {
      const count = wrongCounts[index];
      if (count > 0 && (!topWrong || count > topWrong.count)) {
        topWrong = { index, text: q.choices[index] ?? "", count };
      }
    }
    return {
      id: q.id,
      day: q.day,
      text: q.text,
      correct: q.correct,
      correctText: q.choices[q.correct],
      attempts: seen,
      missed,
      blank,
      missRate: seen ? Math.round((missed / seen) * 100) : 0,
      topWrong,
      why: q.why,
    };
  }).sort((a, b) => b.missed - a.missed || b.missRate - a.missRate || a.id - b.id);
}

/** Miss counts rolled up per training day — where the plan itself is thin. */
export function missRatesByDay(attempts: unknown[]): { day: number; asked: number; missed: number; missRate: number }[] {
  const perQuestion = missRates(attempts);
  const rows: { day: number; asked: number; missed: number; missRate: number }[] = [];
  for (const q of perQuestion) {
    let row = rows.find((r) => r.day === q.day);
    if (!row) { row = { day: q.day, asked: 0, missed: 0, missRate: 0 }; rows.push(row); }
    row.asked += q.attempts;
    row.missed += q.missed;
  }
  return rows
    .map((row) => ({ ...row, missRate: row.asked ? Math.round((row.missed / row.asked) * 100) : 0 }))
    .sort((a, b) => a.day - b.day);
}
