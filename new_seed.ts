// Seed Ethan's real WCL script — runs once via migrations_applied table
function seedEthanScript() {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS migrations_applied (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = sqlite.prepare(`SELECT 1 FROM migrations_applied WHERE name = 'ethan_wcl_script_v2'`).get();
  if (done) return;

  // Wipe any previous version of this script
  sqlite.exec(`DELETE FROM script_responses; DELETE FROM script_nodes; DELETE FROM call_scripts;`);

  const node = (scriptId: number, parentId: number | null, text: string, hint: string, order: number) =>
    sqlite.prepare(`INSERT INTO script_nodes (script_id, parent_node_id, text, hint, node_order) VALUES (?,?,?,?,?)`)
      .run(scriptId, parentId, text, hint, order).lastInsertRowid as number;

  const resp = (nodeId: number, label: string, color: string, nextId: number | null, order: number) =>
    sqlite.prepare(`INSERT INTO script_responses (node_id, label, color, next_node_id, response_order) VALUES (?,?,?,?,?)`)
      .run(nodeId, label, color, nextId, order);

  // ── Script ────────────────────────────────────────────────────────────────
  const sid = sqlite.prepare(`INSERT INTO call_scripts (name, description, created_by) VALUES (?,?,?)`)
    .run("WCL Cold Call Script v2", "West Capital Lending official CLR script — comprehensive refi/HELOC/cash-out lead handling.", 1)
    .lastInsertRowid as number;

  // ══════════════════════════════════════════════════════════════════════════
  // OPENING
  // ══════════════════════════════════════════════════════════════════════════
  const nOpen = node(sid, null,
    `Hi, is this [Borrower Name]? Great — [Borrower Name], good [morning/afternoon/evening]! This is [Your Name] calling from West Capital Lending. How are you doing today?\n\n[PAUSE — let them respond]\n\nThe reason I'm reaching out is we received an inquiry under your name for either a refinance or a Home Equity Line of Credit. I just wanted to take a couple of minutes to learn more about what you're hoping to accomplish and see if we can point you in the right direction. Is now an okay time?`,
    `Warm, unhurried. Pause after their name — confidence. Always ask permission before diving in. If hesitant: "I promise I'll be quick and only stay on as long as it's worth your time."`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // GOAL DISCOVERY
  // ══════════════════════════════════════════════════════════════════════════
  const nGoalDisc = node(sid, nOpen,
    `Perfect. So first — help me understand what prompted you to fill out the inquiry. Are you looking to:\n\nA) Lower your monthly payment or interest rate (rate/term refi)\nB) Pull cash out of your home for a specific purpose — like home improvement, debt consolidation, or an investment (cash-out refi or HELOC)\nC) Both, or not sure yet?\n\n[LISTEN carefully — this determines your entire path]`,
    `Most important question on the call. "Lower payment" → refi path. "Cash out," "debt consolidation," "renovation," "investing" → HELOC/cash-out path. "Not sure" → ask: "What problem are you trying to solve?" and use their answer to route them.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // PATH A: RATE/TERM REFI — QUALIFYING
  // ══════════════════════════════════════════════════════════════════════════
  const nQualRefi = node(sid, nGoalDisc,
    `Great — so a lower rate or payment. Let me ask a few quick questions so we can see what we're working with:\n\n1. What's the property address?\n2. Roughly what do you think the home is worth today?\n3. What's your current loan balance?\n4. What's your current interest rate — do you know off the top of your head?\n5. What type of loan is it — conventional fixed, FHA, VA, or adjustable?\n6. Ballpark credit score — even a range is fine: excellent (740+), good (680–739), or fair (620–679)?\n\n[If they hesitate on credit]: Totally fine if you're not sure — it doesn't impact anything at this stage, I'm just trying to give you an accurate picture.`,
    `Work through conversationally — not as a checklist. You need: address, home value, loan balance, current rate, loan type, credit range. Derived math: LTV = balance / value. If current rate is sub-6.5%, pivot to HELOC — don't push a refi that won't save them money. Red flag: balance > 97% of value = very limited options.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // PATH B: HELOC / CASH-OUT — QUALIFYING
  // ══════════════════════════════════════════════════════════════════════════
  const nQualHeloc = node(sid, nGoalDisc,
    `Got it — so you're looking to tap into some of that equity. Makes a lot of sense given how much home values have gone up. Let me ask a few things:\n\n1. What's the property address?\n2. Any idea what the home might be worth today?\n3. What's your current mortgage balance?\n4. What's your current rate and loan type (fixed, FHA, VA)?\n5. How much were you thinking of pulling out, and what's the goal — home improvement, debt consolidation, or something else?\n6. Credit score range — excellent, good, or fair?\n\n[HELOC vs. cash-out note for you]: If their current rate is below 6.5%, a HELOC almost always beats cash-out refi — it preserves their low first mortgage. If their rate is above 7%, cash-out refi might make sense depending on the amount needed. Don't explain this on the call — just gather the data and hand to the LO.`,
    `Max cash available formula: (Home value × 80%) − current balance = available equity. Under 20% equity = limited HELOC options but FHA/VA streamline may still apply. Purpose matters: debt consolidation (high urgency, good candidate), renovation (warm), investment property (may need different product).`,
    2);

  // ══════════════════════════════════════════════════════════════════════════
  // DIRECT TRANSFER — REFI PATH
  // ══════════════════════════════════════════════════════════════════════════
  const nTransferDirect = node(sid, nQualRefi,
    `Perfect — I've got everything I need. I'm going to connect you right now with [LO Name], who is our specialist for your area and has access to all of our lender relationships to get you the sharpest pricing.\n\nI'm actually [LO Name]'s direct assistant — I won't even put you on hold. I have them right here. I'm going to hand the phone over right now. It was a pleasure, [Borrower Name] — good luck!\n\n[BEFORE YOU HAND OFF — brief the LO]: "Hey [LO Name], I've got [Borrower Name] — they're looking at a [refi/HELOC], home value approximately [value], balance [amount], current rate [rate], credit [range]."`,
    `Be smooth and confident — any hesitation kills the transfer. Pre-brief the LO EVERY time before handoff. Log the outcome in Bonzo immediately: transfer type (direct or appointment), LO name, and brief notes. If LO isn't available, pivot immediately to appointment — never leave the borrower hanging.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // DIRECT TRANSFER — HELOC PATH
  // ══════════════════════════════════════════════════════════════════════════
  const nTransferHeloc = node(sid, nQualHeloc,
    `Awesome — this is exactly what [LO Name] handles every day. They specialize in equity products and will walk you through the options in detail — HELOC vs. cash-out, what your rate would look like, and how much you'd realistically qualify for.\n\nLet me get you connected right now. I'll give them a quick brief so you don't have to repeat yourself.\n\n[BRIEF THE LO]: "[LO Name], I have [Borrower Name] — wants [HELOC/cash-out], home worth [value], current balance [amount], current rate [rate], looking to pull out [amount] for [purpose], credit [range]."`,
    `HELOCs: LO needs to know purpose (debt consolidation, renovation, investment) — it shapes the pitch significantly. If they're consolidating high-interest debt, the LO can do the math on monthly savings on the call. Always pre-brief. Log in Bonzo right after.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // APPOINTMENT (when direct transfer isn't possible or borrower prefers)
  // ══════════════════════════════════════════════════════════════════════════
  const nAppointment = node(sid, nQualRefi,
    `Totally understand — I can't connect you this very second, but I want to make sure [LO Name] can give you their full attention. Let me set up a quick call.\n\nWhat works better for you — mornings or afternoons? And are weekdays or weekends easier?\n\n[GET SPECIFIC]: "Perfect — so let's put you down for [Day] at [Time]. The best number to reach you is the one I called today?"\n\nYou'll get a confirmation and a reminder before the call. Does that work for you?`,
    `Appointment is always better than no outcome. Get a specific day AND time — "sometime this week" is not an appointment. Confirm their phone number. Log it in Upcoming Appointments immediately. If they're hesitant: "I'll only have [LO Name] call that one time — if the timing doesn't work, just text us and we'll reschedule, no problem."`,
    2);

  // ══════════════════════════════════════════════════════════════════════════
  // NOT READY — ROOT BRANCH
  // ══════════════════════════════════════════════════════════════════════════
  const nNotReady = node(sid, nQualRefi,
    `I completely understand — and I appreciate you being straight with me. Can I ask what's holding you back right now? Is it:\n\nA) Waiting for rates to come down more?\nB) Concerned about your credit situation?\nC) Need to talk it over with your spouse or partner first?\nD) Just not the right time financially right now?\n\nThe reason I ask is we work with people at every stage of the process — even if now isn't the right time, I want to make sure you have someone in your corner when it is.`,
    `Never accept "not ready" at face value. The four categories cover 90%+ of real objections. Listen carefully — their answer tells you exactly where to go. Stay warm and curious, never pushy.`,
    3);

  // ── Waiting for rates ──────────────────────────────────────────────────
  const nWaitRates = node(sid, nNotReady,
    `That's a very common feeling right now — and honestly, a reasonable one. Here's the thing though:\n\nWe work with 150+ lenders, including some that don't advertise publicly, and right now we're seeing rates that aren't showing up on Bankrate or Google. The only way to know what you'd actually qualify for is to have someone run your specific scenario.\n\nWhat I'd suggest is a no-obligation call with our specialist — no credit pull, no commitment — just a real number so you know exactly what you're dealing with. That way when rates hit your target, you can move the same day instead of scrambling.\n\nCan we set something up for this week?`,
    `Rate-waiters are warm leads — they've already decided they want to do this, they're just timing it. Emphasize: no credit pull, no commitment, just clarity. If they're comparing to 2021 rates, gently reframe: those rates were a historic anomaly. The question isn't "are rates good" — it's "is there savings available right now?"`,
    1);

  // ── Credit concerns ────────────────────────────────────────────────────
  const nCreditConcern = node(sid, nNotReady,
    `I really appreciate you being upfront about that. Here's the honest truth:\n\nWe work with borrowers across the full credit spectrum. Some of our lenders will go as low as 580 FICO for FHA products, and the check we'd run at this stage is a soft pull — it does not impact your score at all.\n\nEven if your score isn't where you want it, our specialists can give you a concrete roadmap: here's where you are, here's what needs to move, and here's how long it'll realistically take — whether that's 3 months or 6 months. That conversation costs you nothing and could save you a lot.\n\nWould it make sense to at least get that clarity today?`,
    `Credit-concern borrowers are closer than they think. 620+ qualifies for most refi products. 580+ for FHA. If score is very low (<580), be honest — don't over-promise — but still offer the roadmap call. A future contact today becomes a transfer in 6 months. Never shame them about their score.`,
    2);

  // ── Need spouse / decision maker ───────────────────────────────────────
  const nSpouse = node(sid, nNotReady,
    `Absolutely — this is a big decision and it completely makes sense to loop them in. A couple of easy options:\n\nOption 1: Is there any chance you could grab them right now? I'm happy to hold for just a minute, or I can call back in 20 minutes if that's easier.\n\nOption 2: Let's schedule a time when you're both available — that way [LO Name] can answer both of your questions at once, which is usually way more efficient than playing phone tag.\n\nWhich would work better for you?`,
    `"Talk to spouse" can be genuine or a soft brush-off — treat it as genuine. Offer both options. If they commit to a time with the spouse, log it as an appointment immediately. If vague: "When are you two usually both home together?" — this gets you a specific window without pressuring them.`,
    3);

  // ── Not the right time financially ────────────────────────────────────
  const nFinancialTiming = node(sid, nNotReady,
    `I hear you — life has a way of getting in the way sometimes, and I'm not here to push anything that doesn't make sense for your situation.\n\nI'll just say: sometimes a conversation like this helps people realize the timing is actually better than they thought. And sometimes it confirms that waiting makes complete sense. Either way, you walk away knowing.\n\nWould it be alright if I checked back in with you in [30/60/90 days] — just to see where things stand? I'll put a note in our system and it'll be a quick two-minute call, nothing more.`,
    `Respect genuine financial timing objections. Your only goal here is a specific future contact date. Be concrete: "So if I reach back out around mid-[Month], would that be a better window?" Log as future_contact with the specific follow-up date noted.`,
    4);

  // ══════════════════════════════════════════════════════════════════════════
  // ALREADY HANDLED / WENT WITH SOMEONE ELSE
  // ══════════════════════════════════════════════════════════════════════════
  const nAlready = node(sid, nOpen,
    `Oh, perfect — I'm glad you got it handled! Out of curiosity, did you end up with a solid rate? The reason I ask is we partner with over 150 lenders and we occasionally find options that even other brokers miss — sometimes by half a point or more on fees.\n\nI'm not trying to undo anything — but if you'd like, our pricing team can do a quick comparison at zero cost. Worst case, you'll know you got the best deal. Best case, we save you some money. Sound fair?`,
    `Don't roll over. Many people who "already took care of it" haven't actually closed yet — they just talked to one lender. Even if they have closed, plant a seed for future business. The free comparison offer is low-pressure and high-value: it reframes you as helpful rather than pushy.`,
    2);

  const nAlreadyClosed = node(sid, nAlready,
    `That's great — congratulations on getting it done! If you ever have questions down the road, or anything comes up with the home, don't hesitate to reach back out. We'd love to be your resource for anything mortgage-related in the future.\n\nI'll make a note so we don't bother you again. Have a great [morning/afternoon/evening], [Borrower Name]!`,
    `Exit with warmth and professionalism. Don't oversell when they're clearly done. A positive last impression matters — they may refer family or friends, or they'll come back in 2–3 years when they want to refi again.`,
    1);

  // ══════════════════════════════════════════════════════════════════════════
  // JUST SHOPPING / COMPARING OPTIONS
  // ══════════════════════════════════════════════════════════════════════════
  const nJustShopping = node(sid, nOpen,
    `That's exactly the right move — you should absolutely be shopping around. And honestly, that's where we shine.\n\nMost lenders give you one rate because they represent one bank. We work with 150+ lenders, so we're essentially doing the shopping for you — and because of the volume we do, we get access to pricing most people can't get on their own.\n\nIt takes about two minutes to give you a real number to compare. Would it be worth a quick conversation just to have us in the mix as you're evaluating your options?`,
    `"Just shopping" is a warm response — they're already in the market. Your goal: become the benchmark they compare everyone else to. Keep it effortless and low-commitment. Two minutes, real number, no pressure.`,
    3);

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECTION: NOT MY BUSINESS / TOO PUSHY / TOO MANY CALLS
  // ══════════════════════════════════════════════════════════════════════════
  const nPrivacy = node(sid, nOpen,
    `You know what — I completely respect that, and I get it. Can I ask — did you go through something like LendingTree or Bankrate? Because those platforms sell your info to 15–20 companies at once, and that flood of calls is on them, not you.\n\nI'm not trying to pry into your personal business — I'm just here because someone in your household looked into home financing options and I want to make sure that whoever has your information is actually using it to help you. That's it.\n\nSo let me ask one simple question: are you still interested in exploring options for your home, yes or no? If no, I'll take you off our list right now — no hard feelings.`,
    `Don't get defensive. Acknowledge the frustration, explain the lead aggregator problem (it's real and relatable), then cut to the chase with a yes/no close. This respects their time and actually re-engages more than a soft pitch does.`,
    4);

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECTION: I'M BUSY
  // ══════════════════════════════════════════════════════════════════════════
  const nBusy = node(sid, nOpen,
    `One hundred percent — I'll be two minutes, max.\n\n[PAUSE]\n\nJust two quick questions: Are you still interested in doing something with your home equity or rate? And what time works better for a proper call — mornings or afternoons?\n\nIf the answer to the first one is yes, let's find a time that actually works for you. If no, just say so and I'll remove you from our list entirely — completely your call.`,
    `Respect their time instantly. Two-question close is highly effective because it's low-commitment. If they give a yes, you've re-engaged them — pivot immediately to scheduling. If they give a no, log as fell_through and move on. Never drag it out.`,
    5);

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECTION: ANGRY / HOSTILE
  // ══════════════════════════════════════════════════════════════════════════
  const nAngry = node(sid, nOpen,
    `Hey — I completely hear you, and I'm sorry if this is the tenth call you've gotten today. That's genuinely frustrating and you don't deserve that.\n\nI'm [Your Name] from West Capital Lending. I have one specific reason I called, and if it doesn't apply to you I'll be gone in 30 seconds flat. You submitted an inquiry about your home equity — I'm just making sure someone actually helped you rather than everyone just blowing up your phone. Did anyone give you useful information yet, or has it just been a flood of calls with nothing to show for it?`,
    `Match their frustration briefly — acknowledge it first. Then immediately differentiate yourself from spam callers by being direct, honest, and fast. The closing question flips the script: they go from annoyed to potentially venting that no one has been helpful, which re-opens the conversation naturally.`,
    6);

  const nAngryCalmed = node(sid, nAngry,
    `I figured as much — and that's exactly why I wanted to call. Here's the difference between us and everyone else you talked to: we're a brokerage, not a bank. We don't push one product or one rate. We look at your specific situation and give you the honest answer — even if that answer is "wait six months."\n\nCan I ask you just two quick questions about the property?`,
    `Once they've calmed, move quickly to goal discovery. Don't give them time to re-cool. Two quick questions = low friction re-entry into the script. Stay upbeat and grateful — they chose to keep talking.`,
    1);

  const nAngryHungUp = node(sid, nAngry,
    `[Hung up or remained hostile — do not continue]\n\nLog as fell_through. Do not call back today. Note in Bonzo: "hostile disposition, do not re-engage for 48+ hours."`,
    `Some people will not talk today regardless. That's okay — log it accurately and move on. Never call back the same day after a hostile hang-up. Attempting follow-up too soon will get the number blocked.`,
    2);

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECTION: DON'T DO BUSINESS OVER THE PHONE
  // ══════════════════════════════════════════════════════════════════════════
  const nNoPhone = node(sid, nOpen,
    `That's completely fair — and I respect it. Here's what I'll tell you: everything we do is phone and digital by design, not just for convenience. The reason we can consistently beat most local lenders on rate is because we don't carry the overhead of physical branches — those savings go directly to you, typically 0.5 to 1% lower on fees.\n\nI'm not asking you to do anything over the phone today. What I'd love to do is have our specialist email you a personalized no-obligation quote so you can review it at your own pace, on your own terms. Would that feel more comfortable?`,
    `The email pivot works well for phone-averse borrowers. If they agree, get their email, pass to LO to send a rate sheet, and log as future_contact. Even non-immediate converts are in the pipeline. If they decline email too, wish them well and move on.`,
    7);

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECTION: RATES TOO HIGH / MARKET IS BAD
  // ══════════════════════════════════════════════════════════════════════════
  const nHighRates = node(sid, nOpen,
    `I hear you — rates are definitely higher than they were a couple years ago. But "higher than 2021" and "bad for your situation" aren't the same thing, and it really depends on what you're working with.\n\nA few things worth knowing:\n• We work with 150+ lenders including some that don't advertise publicly, so our pricing often beats what you see on Google\n• If your current rate is already above 7%, there may be refinance scenarios that make sense right now\n• For cash-out and HELOC products, the rate environment is actually favorable compared to personal loans (10–15%) or credit card debt (20%+)\n\nCould I ask — what's your current rate? Even if it turns out there's nothing we can do today, I'd rather tell you that honestly than waste your time with empty promises.`,
    `Rate objections usually come from people comparing to 2020–2021 rates. Reframe: compare to credit card rates, personal loan rates, or their existing rate if it's above 7%. The honest "there might be nothing we can do" line builds instant trust. Often they then tell you their rate, which re-engages the conversation.`,
    8);

  // ══════════════════════════════════════════════════════════════════════════
  // OBJECTION: ALREADY WORKING WITH SOMEONE
  // ══════════════════════════════════════════════════════════════════════════
  const nOtherLender = node(sid, nOpen,
    `Totally get it — and I'm not here to step on anyone's toes. Can I just ask: are you in the middle of the process, or still in early conversations?\n\nThe reason I ask is that until you've actually locked a rate, there's no commitment anywhere. And our brokers regularly save people meaningful money at the last minute because they have access to lender programs that smaller shops don't. It happens more often than you'd think.\n\nIf your quote comes back higher than expected, would it be worth a 10-minute call to us as a second opinion — just to make sure you're getting the best deal?`,
    `"Working with someone" is soft until they've rate-locked. Key question: locked or just in conversation? If in conversation: position as a free second opinion. If rate-locked: congratulate them and plant a seed for future business — next refi in 2–3 years, HELOC later, referrals.`,
    9);

  // ══════════════════════════════════════════════════════════════════════════
  // HELOC: LOW EQUITY SCENARIO
  // ══════════════════════════════════════════════════════════════════════════
  const nLowEquity = node(sid, nQualHeloc,
    `Got it — so the equity might be tighter than you'd hoped. That's more common than people think, and there are still a couple of paths depending on your situation:\n\n• FHA Streamline Refi: if it's an FHA loan, we can refi with minimal equity and no appraisal required\n• VA IRRRL: same concept for VA loans — extremely streamlined, low cost\n• Rate/Term Refi: if your rate is above 7%, even a low-equity refi can produce meaningful monthly savings\n• Personal HELOC programs: some lenders go up to 90% LTV for well-qualified borrowers\n\nLet me grab a couple more details to see which of these applies — what type of loan is it currently?`,
    `Low equity doesn't mean dead end. FHA Streamline and VA IRRRL are your best tools here. Even conventional refis can work if the rate savings are strong. Don't give up — ask loan type and current rate to find the angle. If truly no equity and no rate savings, be honest: future contact when their home value increases.`,
    3);

  // ══════════════════════════════════════════════════════════════════════════
  // SILENT / NO RESPONSE
  // ══════════════════════════════════════════════════════════════════════════
  const nSilent = node(sid, nOpen,
    `Hello? [Borrower Name]?\n\n[PAUSE 3 seconds]\n\nHey — just want to make sure I'm not talking to air here. If you're there, no pressure at all — I just wanted to follow up on the home equity inquiry and make sure you got the help you were looking for. Are you there?\n\n[PAUSE 3 seconds]\n\nNo worries — I'll try you again at a better time. Have a great day!`,
    `Wait 3 full seconds between each attempt. After 2 tries with no response, close politely and hang up. Log as no_answer. Never talk for more than 10 seconds into silence — it sounds desperate and unprofessional.`,
    10);

  // ══════════════════════════════════════════════════════════════════════════
  // VOICEMAIL
  // ══════════════════════════════════════════════════════════════════════════
  const nVoicemail = node(sid, nOpen,
    `[VOICEMAIL — keep under 25 seconds, smile while recording]:\n"Hey [Borrower Name], this is [Your Name] with West Capital Lending — I'm [LO Name]'s assistant. We received your inquiry about refinancing or a home equity option and I wanted to personally follow up. Give me a call back when you get a chance at [Phone Number] and I'll make sure [LO Name] has time set aside for you. Talk soon!"\n\n[IF THEY CALL BACK]:\n"Thanks so much for calling back — is this [Borrower Name]? Great. So I left you a message earlier — you had submitted an inquiry about your home and I wanted to make sure you got connected with the right person. Did you get a chance to think about what you were hoping to accomplish?"`,
    `Voicemail formula: name + company + reason + callback number. Under 25 seconds or they won't finish listening. Smile — it comes through in your voice. On callbacks: re-establish context immediately, thank them genuinely, then go straight to goal discovery. Never make them explain from scratch.`,
    11);

  // ══════════════════════════════════════════════════════════════════════════
  // OLD LEADS (60+ days since inquiry)
  // ══════════════════════════════════════════════════════════════════════════
  const nOldLead = node(sid, nOpen,
    `Hi [Borrower Name] — this is [Your Name] with West Capital Lending. A little while back, you had looked into options for your home — whether that was a refinance, a HELOC, or something else — and I wanted to circle back to see if you ever got what you were looking for, or if things changed.\n\n[PAUSE]\n\nAre you still exploring your options, or did you end up going a different direction?`,
    `Old leads need a softer re-entry — don't assume they remember the inquiry. Don't apologize for the time gap. Keep it curious and low-pressure. If they say they forgot: "Life gets busy! Well, since I have you — has anything changed with your home situation that might be worth a quick look?" This re-frames it as timely rather than stale.`,
    12);

  // ══════════════════════════════════════════════════════════════════════════
  // WRONG NUMBER / NOT THE RIGHT PERSON
  // ══════════════════════════════════════════════════════════════════════════
  const nWrongNumber = node(sid, nOpen,
    `Oh — I apologize for the confusion! Is there a better number I can reach [Borrower Name] at, or a better time to try?\n\n[IF NO]: No problem at all — I'll update our records so this doesn't happen again. Have a great day!`,
    `Don't push. If they have alternate contact info, great — note it. If not, log as no_answer with a note about the contact issue. If the person says [Borrower Name] doesn't live there or the number is wrong, mark as bad data in Bonzo so the lead doesn't get called again.`,
    13);

  // ══════════════════════════════════════════════════════════════════════════
  // RESPONSES
  // ══════════════════════════════════════════════════════════════════════════

  // ── Opening → first branches ─────────────────────────────────────────────
  resp(nOpen, "Yes, now is fine — tell me more", "green", nGoalDisc, 1);
  resp(nOpen, "Already handled / went with someone", "red", nAlready, 2);
  resp(nOpen, "Just shopping / comparing options", "yellow", nJustShopping, 3);
  resp(nOpen, "None of your business / too many calls", "yellow", nPrivacy, 4);
  resp(nOpen, "I'm busy right now", "yellow", nBusy, 5);
  resp(nOpen, "Angry / hostile", "red", nAngry, 6);
  resp(nOpen, "Don't do business over the phone", "yellow", nNoPhone, 7);
  resp(nOpen, "Rates are too high / bad market", "yellow", nHighRates, 8);
  resp(nOpen, "Already working with another lender", "yellow", nOtherLender, 9);
  resp(nOpen, "No response / silent", "gray", nSilent, 10);
  resp(nOpen, "No answer — leaving voicemail", "gray", nVoicemail, 11);
  resp(nOpen, "Old lead (60+ days since inquiry)", "blue", nOldLead, 12);
  resp(nOpen, "Wrong number / not them", "gray", nWrongNumber, 13);

  // ── Goal discovery → paths ───────────────────────────────────────────────
  resp(nGoalDisc, "Lower payment / rate (refi)", "green", nQualRefi, 1);
  resp(nGoalDisc, "Pull cash out / HELOC", "green", nQualHeloc, 2);
  resp(nGoalDisc, "Not sure / both options", "yellow", nQualRefi, 3);

  // ── Refi qual → outcomes ─────────────────────────────────────────────────
  resp(nQualRefi, "Fully qualified — ready to transfer now", "green", nTransferDirect, 1);
  resp(nQualRefi, "Qualified — set appointment (LO unavailable)", "blue", nAppointment, 2);
  resp(nQualRefi, "Not ready — dig into why", "yellow", nNotReady, 3);

  // ── HELOC qual → outcomes ────────────────────────────────────────────────
  resp(nQualHeloc, "Ready to transfer — HELOC / cash-out", "green", nTransferHeloc, 1);
  resp(nQualHeloc, "Set appointment — HELOC path", "blue", nAppointment, 2);
  resp(nQualHeloc, "Low equity concern", "yellow", nLowEquity, 3);
  resp(nQualHeloc, "Not ready — dig into why", "yellow", nNotReady, 4);

  // ── Not ready → sub-branches ─────────────────────────────────────────────
  resp(nNotReady, "Waiting for rates to come down", "yellow", nWaitRates, 1);
  resp(nNotReady, "Concerned about credit", "yellow", nCreditConcern, 2);
  resp(nNotReady, "Need to talk to spouse / partner", "yellow", nSpouse, 3);
  resp(nNotReady, "Not the right time financially", "yellow", nFinancialTiming, 4);

  // ── Not-ready sub-outcomes ───────────────────────────────────────────────
  resp(nWaitRates, "Agreed to no-obligation call", "green", nAppointment, 1);
  resp(nWaitRates, "Still not ready — set future contact", "yellow", null, 2);
  resp(nCreditConcern, "Open to soft-pull conversation", "green", nAppointment, 1);
  resp(nCreditConcern, "Score too low — future contact in 3–6 months", "yellow", null, 2);
  resp(nSpouse, "Can grab spouse right now", "green", nGoalDisc, 1);
  resp(nSpouse, "Set callback when both available", "blue", nAppointment, 2);
  resp(nFinancialTiming, "Agreed to future contact date", "yellow", null, 1);
  resp(nFinancialTiming, "Not interested — end call", "gray", null, 2);

  // ── Transfer outcomes ────────────────────────────────────────────────────
  resp(nTransferDirect, "Transfer complete!", "green", null, 1);
  resp(nTransferDirect, "LO not available — set appointment", "blue", nAppointment, 2);
  resp(nTransferDirect, "Borrower changed mind — dig in", "yellow", nNotReady, 3);
  resp(nTransferHeloc, "Transfer complete!", "green", null, 1);
  resp(nTransferHeloc, "LO not available — set appointment", "blue", nAppointment, 2);
  resp(nTransferHeloc, "Borrower changed mind", "yellow", nNotReady, 3);

  // ── Appointment outcomes ─────────────────────────────────────────────────
  resp(nAppointment, "Appointment confirmed and logged", "green", null, 1);
  resp(nAppointment, "Refused to commit to a time", "yellow", nFinancialTiming, 2);

  // ── Already handled ──────────────────────────────────────────────────────
  resp(nAlready, "Open to rate comparison", "green", nGoalDisc, 1);
  resp(nAlready, "Already closed — not interested", "gray", nAlreadyClosed, 2);
  resp(nAlreadyClosed, "Ended gracefully", "gray", null, 1);

  // ── Angry ────────────────────────────────────────────────────────────────
  resp(nAngry, "Calmed down — back to conversation", "green", nGoalDisc, 1);
  resp(nAngry, "Still hostile but still on the line", "yellow", nAngryCalmed, 2);
  resp(nAngry, "Hung up", "gray", nAngryHungUp, 3);
  resp(nAngryCalmed, "Re-engaged — proceed to qualifying", "green", nGoalDisc, 1);
  resp(nAngryCalmed, "Still not interested", "gray", null, 2);
  resp(nAngryHungUp, "Logged as fell through", "gray", null, 1);

  // ── No phone / high rates / other lender / shopping / privacy ────────────
  resp(nNoPhone, "Agreed to email quote", "green", null, 1);
  resp(nNoPhone, "Not interested", "gray", null, 2);
  resp(nHighRates, "Shared current rate — re-engage", "green", nGoalDisc, 1);
  resp(nHighRates, "Still not interested", "gray", null, 2);
  resp(nOtherLender, "Not locked yet — open to comparison", "green", nGoalDisc, 1);
  resp(nOtherLender, "Already locked — plant seed for later", "gray", nAlreadyClosed, 2);
  resp(nJustShopping, "Agreed to quick qualifying call", "green", nGoalDisc, 1);
  resp(nJustShopping, "Not ready to engage yet", "yellow", nFinancialTiming, 2);
  resp(nPrivacy, "Willing to continue", "green", nGoalDisc, 1);
  resp(nPrivacy, "Remove from list", "gray", null, 2);

  // ── Low equity ───────────────────────────────────────────────────────────
  resp(nLowEquity, "FHA / VA — streamline path applies", "green", nTransferHeloc, 1);
  resp(nLowEquity, "Conventional — explore rate savings", "yellow", nNotReady, 2);

  // ── Old lead / silent / voicemail / wrong number ─────────────────────────
  resp(nOldLead, "Still exploring — re-engage", "green", nGoalDisc, 1);
  resp(nOldLead, "Handled it / not interested", "gray", nAlreadyClosed, 2);
  resp(nVoicemail, "Voicemail left", "gray", null, 1);
  resp(nSilent, "Responded — continue to goal discovery", "green", nGoalDisc, 1);
  resp(nSilent, "Still no response — hang up", "gray", null, 2);
  resp(nWrongNumber, "Got alternate contact info", "yellow", null, 1);
  resp(nWrongNumber, "No info available — log bad data", "gray", null, 2);

  // ── Busy ─────────────────────────────────────────────────────────────────
  resp(nBusy, "Got specific callback time — set appointment", "blue", nAppointment, 1);
  resp(nBusy, "Not interested — remove from list", "gray", null, 2);

  sqlite.prepare(`INSERT INTO migrations_applied (name, applied_at) VALUES (?, datetime('now'))`)
    .run('ethan_wcl_script_v2');
}
seedEthanScript();
