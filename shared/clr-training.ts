// The CLR trainer walkthrough, as written by Matt Lane.
//
// Held as data rather than as markup so the page can present it (group by week,
// split each day at lunch, pull out the end-of-day outcome) without the words
// being rewritten. The text is his; only the structure around it is ours.
export type TrainingDay = {
  day: number;
  week: 1 | 2;
  morning: string[];
  lunchNote: string;
  afternoon: string[];
  eod: string;
};

export const TRAINING_AUTHOR = "Matt Lane";

export const TRAINING_DAYS: TrainingDay[] = [
  {
    day: 1, week: 1,
    lunchNote: "Should be lunch time.",
    morning: [
      "First things first, give them a tour of the office. Introduce them to loan officers, show them the gym, kitchen, bathrooms, etc. Show them the seating chart (print out a sheet for them to have and memorize).",
      "Introduce them to the role: what we do, how a transfer goes, daily KPIs and goals, and what constitutes a transfer. Let them ask questions. No question is a dumb question.",
      "Introduce them to our systems: Bonzo, Dialpad, C3, CallTools, etc.",
      "Have them shadow you as you make some calls, get a transfer, and show them the process.",
      "Explain every system to them. It might not make sense to them immediately, but showing them early helps them later.",
    ],
    afternoon: [
      "Do some phone roleplay with them. Do some easy yeses, but don't make it a cakewalk. The focus here is to build their opening line. Emphasize that during the roleplay. Throw in a few objections that we frequently see and give them a minute to think through them during the roleplay. Not too long, but they are still building their language.",
      "Make more live calls and put the roleplay advice you gave them into action. Try to get a few transfers to show them how that goes. Show them your calling processes too. Anything to give them an idea of how to start goes a long way. Have them make one observation per call. Also, try and patch them into the call so they can listen.",
      "Do some more roleplay. Go a little harder this time. Throw in more objections and bring different personalities to each “call.” This will show them the requirement to adapt while on the phone.",
      "Afterward, have them take Quiz #1. Review it with them.",
    ],
    eod: "They should have their opener down pat and be able to name each system.",
  },
  {
    day: 2, week: 1,
    lunchNote: "Should be lunch time.",
    morning: [
      "They should have a computer, headphones, etc. by now. Take them through the gear setup and make sure they understand each system. Do a mic check and test each piece of equipment.",
      "Show them our product list. This will help them understand how the products work (obviously), but it will also give them base knowledge for the next step of their career. This also lets them know what some borrowers are talking about when they mention specific products. Some of our leads have seen our advertisements and already have an idea of what they are interested in.",
      "Go through the call info sheet with them next. Explain why we need each piece of information and why it is important. Start with the “goal” of the borrower. Be hellbent on them getting the information on the call; it is a very important step. Explain that there are exceptions to not getting information on the call, however, like when calling the LO “Responded” pipeline.",
      "Also, show them what a clean transfer would look like. Go through each step (walking to the LO, giving them notes, etc.) so they have an idea of what our day-to-day looks like. Show them how to put notes in Bonzo, log a transfer, and handle any other post-call responsibilities.",
    ],
    afternoon: [
      "Take them through the info sheet on a live call. Get someone on the phone, take all the information, and get the transfer. Explain each step again after the call. Show them what it looks like in action to help them better understand the process.",
      "Let them listen to a call and have them jot the information down on their own blank sheet. This builds muscle memory when they get on the phones.",
      "Roleplay some more with the trainee. Have them fill out the info sheet as you go along. Go through each of the Big Three scenarios (Refinance, HELOC, and Reverse). Don't stop until they each have a clean and smooth call.",
      "Finally, print and have them take Quiz #2.",
    ],
    eod: "They should be set up on the computer and systems and be able to complete one smooth info-sheet roleplay call.",
  },
  {
    day: 3, week: 1,
    lunchNote: "Should be lunch time.",
    morning: [
      "Emphasize the importance of asking borrowers open-ended questions, building rapport with borrowers, and using the right tone while on the phone. Each of these things can sway the call and determine whether you get a transfer or not.",
      "Closed-ended questions give the borrower a free out, and they will take it. Open-ended questions open the door for them to explain in detail what they are looking for. Building rapport with borrowers makes them feel comfortable, and they will open up more. Tone is important because if you don't sound happy to talk to them, they won't want to talk.",
      "Spend around an hour on this topic.",
      "Take them through our biggest objections. Teach them how to get around them and what language would be beneficial to use in each scenario. Have them master responding to the top four objections on the list. Spend about an hour here too.",
      "Follow that up with objection roleplay. Start doing mock calls with them and firing objections mid-call. See how they deal with them and reframe the objection. This part is all about having them understand how to flip an objection around. Do this until they have their responses down pat. Spend a lot of time on this.",
    ],
    afternoon: [
      "Come back to more roleplaying, this time focusing on open-ended questions. Have them try to hold a 10-minute conversation with you by only using open-ended questions.",
    ],
    eod: "Pass Quiz #3 and complete two smooth roleplay calls while getting over objections and asking open-ended questions. That 10-minute mock phone call is a good baseline for this. They should also be able to get past the top four objections without thinking about it.",
  },
  {
    day: 4, week: 1,
    lunchNote: "Should be lunch.",
    morning: [
      "Today we are focusing on Bonzo. Teach them pipelines and how to use the filter system. Explain the difference between LOAs and W2 LOs, plus explain the 14-day rule with Chris's Bonzo and LOAs. Show them what their “daily filters” should look like when making a list for Bulk Texter.",
      "Teach them what each pipeline stage means and where we primarily reside in pipelines. This should be “Responded” and “No Contact” for the most part.",
      "Show them how to change pipelines in Bonzo through the contact's page. Then, show them a stage change in action, like on a live phone call.",
    ],
    afternoon: [
      "Explain our compliance rules to the best of your knowledge. Explain what DNC and STOP/No Text are, how to use them, and what the difference is between the two. Also, go into detail about the call times that are allowed for each state. Emphasize the importance of staying within these hours and what happens if we don't.",
      "During this, also have them practice exporting lists for Bulk Texter.",
      "Run some pipeline drills with them and have them practice dispositioning people correctly. Then, do some more supervised dials.",
    ],
    eod: "Quiz #4, correct filters and exporting, and the 14-day rule memorized.",
  },
  {
    day: 5, week: 1,
    lunchNote: "Should be lunch.",
    morning: [
      "Explain what is and what isn't a transfer. Quality is important during transfers. Spend a good amount of time on this.",
      "Take them through the process of telling the LOs that you are calling for them (NOT ASKING). Bring them with you and show them a good way to do it. Explain the 5-day lead rule with W2 LOs and go over Chris's rules for transfers again. We don't want to mess it up again.",
      "Take them through a live transfer, the handoff, logging C3, and reassigning in Bonzo.",
      "Sit down with an experienced LO and have them explain why quality is important. Dan, Derek, or Billy would be good options for this. Maybe ping them on Dialpad beforehand so they are prepared.",
    ],
    afternoon: [
      "More supervised dials! This time, back off slightly to gauge their edge and responsiveness on the phone. This also lets you see what points of the process you need to touch on again. Debrief with them after every call. Quality over quantity here.",
      "Wrap up the week by going over daily and weekly KPIs, our expectations and numbers, pay structure, and the promotion roadmap.",
    ],
    eod: "Quiz #5, transfer process recalled from memory, and a completed dial block.",
  },
  {
    day: 6, week: 2,
    lunchNote: "Go to lunch.",
    morning: [
      "Walk them through the lifecycle of a transfer. Talk about what the LOs do when they get a transfer, what happens after that, the application process, funding, etc.",
      "Walk them through the state list and let them click through it. Confirm that the states are correct with Ethan. Explain how we must find what state the LO is licensed in during a transfer for that scenario. Also, explain the difference between LOs and LOAs here. This is very important.",
      "Walk them through the career path here again. Explain comp expectations and the steps to get to LO or LOA. Be honest with them about what to expect for compensation and wages.",
    ],
    afternoon: [
      "Dial time for the rest of the day. It does not have to be as supervised as previous sessions, but sit around with them and watch a few calls. We need to make sure they are doing everything correctly.",
    ],
    eod: "Quiz #6 and the ability to tell you each step of the loan process.",
  },
  {
    day: 7, week: 2,
    lunchNote: "Lunch.",
    morning: [
      "Explain the different types of income for each position. Explain the difference between W2, 1099, and self-employed. Point out people in the office who fall under these categories and let them know to ask each person if they would like further details. Devon would be a good person for 1099.",
      "Explain DTI and LTV. These are important topics and words we hear constantly. Drive home the point of the “Big 4” questions we have on the info call sheets.",
    ],
    afternoon: [
      "Another supervised dialing block for the rest of the day. Get after it!",
    ],
    eod: "Quiz #7 and the ability to tell you the differences between each income type.",
  },
  {
    day: 8, week: 2,
    lunchNote: "Lunch, perhaps.",
    morning: [
      "Go into depth about how we are not allowed to quote anyone. This is especially important for compliance reasons. Legally, we as CLRs are NOT allowed to quote anyone.",
      "Teach them what language you use to get around the rate question. Something like, “I'm just an assistant…,” “I'm not legally allowed…,” etc. You should be positioning that the LO will be quoting them as soon as the transfer is made. Incorporate that into your language as well.",
      "Run some drills (roleplay) having them fill out the info list. Throw random wrenches at them to see how they can adapt. Adapting on the phone is crucial.",
      "Make sure they know the difference between each kind of income on the info sheet. Do some roleplay as a rate shopper too. They should be able to “deflect” or dodge the rate question easily by the end of it. Have it practically memorized.",
    ],
    afternoon: [
      "Dial block for the end of the day. Should be supervised again, but get those transfers!",
    ],
    eod: "Quiz #8 and the ability to dodge the rate question by heart.",
  },
  {
    day: 9, week: 2,
    lunchNote: "Lunch.",
    morning: [
      "Start by making sure they understand what a good call is and what a bad call is. Run them through some examples as well. Have them make written observations on whether they think the call was good or bad.",
      "Next, you should be nailing down their cadence. Speed and cadence are important on a call to correctly convey information to the borrower. During this time, also verify that they can search for and find a lead effectively. This makes sure that they can finish each step during a live call, which is extremely important. Freezing or taking too long will lose you a transfer.",
      "Have them shadow you on some live calls now. This will refresh their memory and remind them of anything they forgot to do. Have them make written observations of the call and decide whether it was a good or bad call.",
    ],
    afternoon: [
      "Have them recite their language to you. Make sure it is memorized. If not, sit with them and have them memorize it. This goes for their opener, questions, objection responses, and finally, the transfer/handoff.",
      "More dials! Supervise again.",
    ],
    eod: "Quiz #9 and all call certifications passed (language memorization, asking the questions, objection responses, etc.).",
  },
  {
    day: 10, week: 2,
    lunchNote: "Lunch.",
    morning: [
      "Review everything that has been touched on during the past two weeks. Pull any weak spots and reteach whatever needs work. Make sure that every topic is understood and that they can repeat everything back to you.",
      "Go over KPIs again. Make sure they understand the path to becoming an LO.",
      "Explain the state map and licensing issues again. They need to understand in what cases we can give a lead to another LO and how to verify state licensing. Refresh them on Chris's Bonzo rules again.",
      "Do your own pre-dial routine and make some calls while they watch. Keep it to about an hour, tops.",
    ],
    afternoon: [
      "Have them take the final test. Review it using the answer key when they are finished, on the same day. Review it with them as well.",
      "Finally, do a final certification call. Have them make calls until they are able to make a transfer. Stand back and let them go through the process. Step in if necessary to ensure that nothing is screwed up or done incorrectly.",
      "Make sure that every step of the call is completed, down to logging the transfer in C3.",
    ],
    eod: "Test has been reviewed, call meets expectations, and everything goes smoothly.",
  },
];
