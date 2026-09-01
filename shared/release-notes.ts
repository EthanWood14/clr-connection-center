/**
 * What changed, in each release, in language the people using C3 will
 * recognise — not commit messages.
 *
 * The update popup reads from here, so shipping a version without an entry
 * means telling everyone "something changed" and nothing more. A test asserts
 * the CURRENT APP_VERSION has notes, which is what keeps this honest: the
 * release fails before it reaches anyone.
 *
 * Guidelines that keep these useful:
 * - Say what a person can now DO, not what was refactored.
 * - Name the screen, so they know where to look.
 * - Include fixes when the old behaviour was visibly wrong; skip pure plumbing.
 * - `audience` records who a change is FOR. It no longer hides anything by role:
 *   everyone sees every note regardless of manager status, because knowing what
 *   changed in the tool you use should not depend on your permissions. The tag
 *   is kept because it still documents intent, and because the portal split
 *   below is a genuinely different axis.
 */

export type ReleaseAudience = "everyone" | "manager" | "lap";

export type ReleaseNote = {
  version: string;
  /** One line answering "why should I refresh?" */
  headline: string;
  items: { text: string; audience?: ReleaseAudience }[];
};

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "4.37.0",
    headline: "Four states nobody can be licensed in, marked red.",
    items: [
      { text: "Hawaii, Illinois, Massachusetts and New York now show red on the map: no one can be licensed in them. Illinois, Massachusetts and New York already had no licensed loan officer between them; Hawaii is new.", audience: "everyone" },
      { text: "Those four no longer show a licence count or a list of names, because there should not be one. They still carry the reminder that business purpose loans are okay everywhere — that is the lending those states still allow, since it needs no licence.", audience: "everyone" },
      { text: "Nobody can be added to them either. The block is applied wherever licensed states are saved, including the bulk import, so it cannot be worked around from another screen.", audience: "manager" },
      { text: "Illinois was one of the eleven W2-only states. Red wins over pink there — “nobody can be licensed” makes “W2 borrowers only” beside the point.", audience: "manager" },
    ],
  },
  {
    version: "4.36.1",
    headline: "The check-in rules, written down where you can read them.",
    items: [
      { text: "The Networks panel now states both rules in one line: on an approved address a check-in is accepted and the location check is skipped; anywhere else it has to be within the office radius. That was already how it worked and was not written down anywhere.", audience: "manager" },
    ],
  },
  {
    version: "4.36.0",
    headline: "See which networks people check in from.",
    items: [
      { text: "New Networks panel on the Check-In page: every address check-ins have come from, split into the office wifi and everywhere else, with how many check-ins, who, and when it was last used.", audience: "manager" },
      { text: "An address you recognise can be marked as the office right there, and every past check-in from it immediately reads as in-office. No need to go and edit a list of numbers in Settings.", audience: "manager" },
      { text: "It also says plainly when addresses are not being recorded at all — which they currently are not — with a button to start. Until then the panel is history only and today is not on it.", audience: "manager" },
      { text: "An approved address that nothing has ever come from is called out, since that usually means a typo or a network that has since changed.", audience: "manager" },
    ],
  },
  {
    version: "4.35.1",
    headline: "Two Bonzo calls that could only ever fail.",
    items: [
      { text: "The admin “push stage to Bonzo” tool used a request type Bonzo rejects outright, so it always failed. Corrected.", audience: "manager" },
    ],
  },
  {
    version: "4.35.0",
    headline: "Transfers are tagged and named in Bonzo again, including Chris’s.",
    items: [
      { text: "A transfer to a loan officer who has an assistant now gets the clrtransfer tag and the “(LOA I CLR)” name on the borrower in Bonzo, the same as every other transfer. Those two say who sent the lead over — they were being skipped along with everything else.", audience: "everyone" },
      { text: "The borrower’s stage and owner are still left alone for those loan officers, because the LO Assistant Portal is where that work happens.", audience: "manager" },
    ],
  },
  {
    version: "4.34.3",
    headline: "The Bonzo note no longer repeats what you already pasted.",
    items: [
      { text: "If you had already pasted part of a write-up into Bonzo yourself, the automatic note could still go up repeating it. Each part is now checked against the prospect separately, and only what is genuinely missing gets posted.", audience: "everyone" },
    ],
  },
  {
    version: "4.34.2",
    headline: "A transfer that missed Bonzo can be sent again.",
    items: [
      { text: "Re-pushing a transfer to Bonzo now runs the same sync a fresh transfer does, so a call that was logged before today can be sent across with its notes. It will not post twice if it is already there.", audience: "manager" },
    ],
  },
  {
    version: "4.34.1",
    headline: "Whichever box you typed the write-up into now reaches Bonzo.",
    items: [
      { text: "The transfer note sent to Bonzo used to carry only the Info Gathering block. Anything typed into Other Notes instead was left behind — which for most calls is where the detail actually is. Both now go.", audience: "everyone" },
    ],
  },
  {
    version: "4.34.0",
    headline: "Transfers to loan officers with an assistant now leave a note in Bonzo.",
    items: [
      { text: "If the loan officer you transfer to has an assistant, C3 used to write nothing to Bonzo at all \u2014 not your write-up, not even the fact that the transfer happened. It now posts your conversation notes to the borrower in Bonzo, so the loan officer can see them without anyone pasting by hand.", audience: "everyone" },
      { text: "Nothing else about the borrower is touched for those loan officers: C3 does not reassign them, move their pipeline stage, or rename them, because the LO Assistant Portal is still where that work happens. The note says so.", audience: "manager" },
      { text: "Every one of these syncs now records which mode it ran in, so a transfer that does not reach Bonzo can be traced instead of disappearing quietly.", audience: "manager" },
    ],
  },
  {
    version: "4.33.0",
    headline: "Write-up scoring now matches what a call is actually worth.",
    items: [
      { text: "The three qualification answers \u2014 owns a home, bankruptcy in the last six months, investment or second home \u2014 now count four times any other question. They decide whether the lead is workable at all, and a write-up missing one of them was being marked down as if it had skipped a phone number.", audience: "everyone" },
      { text: "Borrower email and the exact credit score no longer count toward the score. Both are still on the form and still worth getting; the credit band is what the loan officer prices against, so that is what is scored.", audience: "everyone" },
      { text: "New tickboxes on Info Gathering: No co-borrower, Free and clear, and No HELOC. Tick one and that whole section stops being asked of you \u2014 a blank co-borrower box used to look exactly the same whether there was no co-borrower or nobody asked, and you were marked down either way. It also writes the fact into the notes the loan officer reads.", audience: "everyone" },
      { text: "Ticking one of those clears the boxes it covers, so a half-typed answer cannot sit hidden behind it \u2014 it would have quietly gone missing from the handoff and could have blocked the form from submitting with an error on a box no longer on screen.", audience: "everyone" },
      { text: "The routing note for investment and second homes \u2014 give it to LOA Justin, Mateo, or John \u2014 now sits beside the question on both the Script page and Input Results, instead of appearing only after you answer Yes. You need to know where it goes before you decide.", audience: "everyone" },
      { text: "A CLR profile now marks the questions that count four times, so it is clear which gap is worth closing first.", audience: "manager" },
      { text: "Because the rules changed, Write-up percentages before and after today are not measured the same way and should not be compared across that line.", audience: "manager" },
    ],
  },
  {
    version: "4.32.1",
    headline: "W2-only states are pink on the map — and actually coloured in now.",
    items: [
      { text: "The eleven W2-only states are now pink instead of amber.", audience: "manager" },
      { text: "They are also, finally, coloured on the map itself. The last release only tinted the small state tags down the right hand side — Arkansas, Georgia, Illinois, Indiana, Maryland, Mississippi, Montana, New Jersey, North Carolina, South Carolina and Vermont were left looking like every other state on the map proper. All eleven are shaded now, in both light and dark.", audience: "manager" },
    ],
  },
  {
    version: "4.32.0",
    headline: "State Lookup shows exactly how many transfers each assistant has taken.",
    items: [
      { text: "Open a state and every loan officer who has assistants now lists them by name with their own transfer count beside the officer’s total, so you can see who is actually taking the work rather than guessing from the team figure.", audience: "everyone" },
      { text: "The counts follow the 7 day / 30 day / all time switch already on the page, and the heading says which window you are looking at, so a number is never ambiguous.", audience: "everyone" },
      { text: "Assistants who have left are still listed, crossed out — they kept the transfers they took, and hiding them would make the numbers stop adding up.", audience: "everyone" },
    ],
  },
  {
    version: "4.31.0",
    headline: "W2-only states are marked on the map, and Chris is off them for good.",
    items: [
      { text: "Eleven states — Arkansas, Georgia, Illinois, Indiana, Maryland, Mississippi, Montana, New Jersey, North Carolina, South Carolina and Vermont — now show in amber on the map as W2 only, with a legend so the colour explains itself. Amber rather than a darker blue on purpose: a darker blue would just look like more loan officers.", audience: "manager" },
      { text: "Every state, not just those eleven, now carries the reminder that business purpose loans are okay everywhere — the exception people most often forget is the one that applies to all of them.", audience: "manager" },
      { text: "Chris Redoble has been taken off the W2-only states he held (Arkansas, Maryland and North Carolina) and can no longer be added back to any of them. That block is applied wherever licensed states are saved, including the bulk import, so it cannot be worked around from another screen.", audience: "manager" },
    ],
  },
  {
    version: "4.30.0",
    headline: "Finishing a task now means signing for it.",
    items: [
      { text: "Marking a task done requires a short note saying what you actually did. Ticking a box left no record anyone could check later; now there is one, with your name and the time on it.", audience: "everyone" },
      { text: "Any task that starts with “Call” also asks how many calls you made, so the Meta Leads rounds have a real number against them rather than just a tick.", audience: "everyone" },
      { text: "New History button on the Task Center: every completion, who did it, when, the note, and the calls reported — with a running total. You see your own; managers see everyone’s.", audience: "everyone" },
    ],
  },
  {
    version: "4.29.0",
    headline: "Write-up now sits in the Transfer Scorecard, and counts the whole form.",
    items: [
      { text: "The Transfer Scorecard gains a Write-up figure per CLR, graded against the others like every other number there.", audience: "manager" },
      { text: "It now measures what it says: of every box a transfer could have had filled in, how many were. That includes the qualification answers and all twenty lead-capture questions, not just a handful of headline boxes — so expect a much lower number than before. Team-wide it is about 22%, because the capture questions are rarely answered.", audience: "manager" },
      { text: "A box that did not apply is still never counted against anyone, and somebody with no transfers in the range shows a dash instead of a zero.", audience: "manager" },
    ],
  },
  {
    version: "4.28.0",
    headline: "Write-up rate is now a line on the dashboard trend.",
    items: [
      { text: "The Team trend chart adds a gold Write-up line showing what share of each day’s transfers were filled in properly. It reads against a percentage scale on the right, so it sits alongside the transfer and appointment counts without squashing them.", audience: "manager" },
      { text: "On a day with no transfers the line breaks instead of dropping to zero — a quiet day is not a bad one.", audience: "manager" },
    ],
  },
  {
    version: "4.27.0",
    headline: "Transfer write-up now shows for the whole team at a glance.",
    items: [
      { text: "The CLR Profiles list now shows Write-up beside Transfers, Calls and Ratio, so you can see who is filling transfers in properly without opening each profile. Somebody with no transfers in the period shows a dash rather than a zero.", audience: "manager" },
    ],
  },
  {
    version: "4.26.0",
    headline: "New: how completely transfers are written up.",
    items: [
      { text: "A CLR’s profile now shows what share of the information a transfer asks for actually got filled in — borrower name, phone, lead source, the call summary, and the LOA — with a bar per field so you can see which one is pulling the number down.", audience: "manager" },
      { text: "Each transfer is only scored against the fields that applied to it. An LOA is counted solely on transfers whose loan officer has one, so nobody is marked down for a box that was never theirs to fill.", audience: "manager" },
      { text: "Fields the form no longer asks for are left out entirely — counting them would have put a ceiling on the score that no amount of effort could lift.", audience: "manager" },
    ],
  },
  {
    version: "4.25.0",
    headline: "The share link now pins the loan officers people actually see.",
    items: [
      { text: "The link was changing the wrong thing — a background tier nobody looks at — so pinning through it appeared to work and changed nothing. It now sets the same pin you use in the state view: pinned officers get the amber highlight, sort to the top, and are the list every CLR is shown when they start the day.", audience: "manager" },
      { text: "The page also opens by telling you who is pinned right now, before you touch anything, so you are never guessing at the current state.", audience: "manager" },
    ],
  },
  {
    version: "4.24.0",
    headline: "The call-in alarm now wakes a stalled C3 first.",
    items: [
      { text: "These tabs stay open all day — laptops sleep, pages get stuck, and a tab can still be running an old version. Any of those could have swallowed a call-in alarm. C3 now quietly refreshes itself the moment a call-in is raised, so the alarm fires on a fresh page every time.", audience: "everyone" },
      { text: "It refreshes once per call-in and never again for the same one, so it can never get stuck reloading over and over. It also refreshes on its own if your tab is running an out-of-date version.", audience: "manager" },
    ],
  },
  {
    version: "4.23.0",
    headline: "Call the whole floor in at once.",
    items: [
      { text: "Settings now has “Call everyone in”. It sets off the same alarm — video, siren, flashing screen — on every screen in the team at the same time, and one button stops it for everybody.", audience: "manager" },
      { text: "It behaves like the individual version: nobody can close it themselves, anyone mid-call can silence the sound for two minutes while the screen stays up, and pressing it twice will not start a second one.", audience: "manager" },
    ],
  },
  {
    version: "4.22.0",
    headline: "Being called in now comes with a video.",
    items: [
      { text: "The call-in alarm plays a clip on loop as its centrepiece. The siren drops to a low background growl while the clip is audible, so the two are not shouting over each other — and if the browser blocks the sound, the siren comes back up to full instead.", audience: "everyone" },
      { text: "Silencing for two minutes now mutes the clip as well as the siren, so the button does what it says. The screen keeps going, and it still takes a manager to stand it down.", audience: "everyone" },
    ],
  },
  {
    version: "4.21.0",
    headline: "Hand someone a link to set loan officer priority.",
    items: [
      { text: "In Settings you can create a share link that lets somebody set which loan officers get leads first — no C3 login needed. Give it a label, pick how long it should last, and it copies itself to your clipboard.", audience: "manager" },
      { text: "The page behind the link can do one thing only: move loan officers between Priority, Standard and Last resort. It shows names and priority — no phone numbers, no logins, no leads, nothing else — and it cannot touch anything outside your team.", audience: "manager" },
      { text: "Because this decides who gets leads, each link expires on its own (a week unless you say otherwise), you can revoke any of them instantly, and every change is written to the audit trail with the name the person types in.", audience: "manager" },
    ],
  },
  {
    version: "4.20.0",
    headline: "Managers can call someone in, and C3 will not let them miss it.",
    items: [
      { text: "From a CLR’s profile there is now a “Call them in” button. Their C3 takes over the whole screen, flashes red and sounds a siren until a manager marks them as checked in. They cannot close it, and it beats every other prompt in the app.", audience: "manager" },
      { text: "If you get called in, there is one button: silence the sound for two minutes. It stops the noise only — the screen keeps going and only a manager can stand it down — so you can finish a call with a borrower and then go.", audience: "everyone" },
      { text: "The flashing is kept to one flash a second, well under the rate that can trigger a seizure, and anyone whose device asks for reduced motion gets a steady red screen instead of a flashing one. It is every bit as hard to ignore.", audience: "everyone" },
      { text: "You cannot call yourself in, only one alarm can be running for a person at a time, and every call-in and check-in is recorded.", audience: "manager" },
    ],
  },
  {
    version: "4.19.2",
    headline: "Training requests can actually be submitted now.",
    items: [
      { text: "The Save button stayed greyed out on a training request no matter what you picked, because it was waiting on the description and amount boxes — the two things a training request fills in for you. It now unlocks as soon as you have picked a day.", audience: "everyone" },
      { text: "Verified end to end this time: picking two days at double time files an $80 request, and asking again for a day you already claimed is refused rather than paid twice.", audience: "manager" },
    ],
  },
  {
    version: "4.19.1",
    headline: "Fixed: the training day box wouldn’t accept a date.",
    items: [
      { text: "The date box on a training request cleared itself as you typed, so there was no way to put a day in at all. It now keeps what you enter, and there is an “Add day” button next to it as well. Both the comp page and the CLR profile were affected.", audience: "everyone" },
    ],
  },
  {
    version: "4.19.0",
    headline: "Trainers can claim their training days.",
    items: [
      { text: "Pick Training on a comp request and you get a day picker: add each day you spent training, choose “Standard” at $20 a day or “Double time” at $40, and the total works itself out. It files as an ordinary comp request and goes through the same approval as everything else.", audience: "everyone" },
      { text: "Managers can file the same thing straight from someone’s CLR profile, for that person — no need to switch pages.", audience: "manager" },
      { text: "A day that has already been claimed is dropped when the request is filed, and the total recalculated, so the same training day can never be paid twice. The amount is always worked out from the days themselves.", audience: "manager" },
      { text: "Approved training pay shows up in that CLR’s earnings on their profile alongside everything else they have earned.", audience: "manager" },
    ],
  },
  {
    version: "4.18.1",
    headline: "Input Results now uses the width it has.",
    items: [
      { text: "Fields that belong together sit on the same line instead of each taking a whole row — date beside who logged it, borrower beside phone, loan officer beside assistant, and the three qualification questions across one line. The window got wider last release but everything was still stacked, so it just meant more scrolling.", audience: "everyone" },
      { text: "Info Gathering, when you open it, is two side by side rather than twenty stacked — so you can take it in at a glance.", audience: "everyone" },
    ],
  },
  {
    version: "4.18.0",
    headline: "Input Results is built around the call you actually just had.",
    items: [
      { text: "The window is much wider, so you can see the form instead of scrolling a narrow strip.", audience: "everyone" },
      { text: "It opens ready for a transfer, set to Direct — that is nine out of ten calls, so that is two fewer clicks on almost every one.", audience: "everyone" },
      { text: "Info Gathering is tucked behind one button instead of twenty boxes you scroll past every time. It tells you how many are filled, so nothing hides from you, and it is one click away when a call needs it.", audience: "everyone" },
      { text: "New “Log & next” button: log the call and stay put, ready for the next one. It keeps the date, the result type and the loan officer, and clears the borrower, phone, notes and answers — so one call can never be recorded against another.", audience: "everyone" },
      { text: "The header shows how many calls you have logged today and the last few names, so you can see your own work adding up without closing anything.", audience: "everyone" },
    ],
  },
  {
    version: "4.17.0",
    headline: "C3 opens fast, and your EOD report asks for itself at 4pm.",
    items: [
      { text: "Opening C3 was waiting on an outside service that took three and a half seconds to answer, every time \u2014 the first load of the day, any load after a five-minute gap, and every load after an update. C3 now keeps that answer ready in advance and never makes you wait for it.", audience: "everyone" },
      { text: "The opening animation used to hold for 2.2 seconds no matter what, long after the app was ready. It now steps aside as soon as the app is up.", audience: "everyone" },
      { text: "Moving between pages no longer blanks the whole screen. The menu and header stay put and only the page changes, with a short fade.", audience: "everyone" },
      { text: "Your EOD report is now expected at 4:00 PM on the day it covers. From 4:00 a bar appears at the top of C3 and will not go away; at 4:30 it gets harder to ignore; at 5:00 it turns red and chimes; at 5:30 C3 locks until the report is in. Filing it makes all of that stop straight away.", audience: "everyone" },
      { text: "This does not change what counts as a late report \u2014 that is still 4:00 PM the next business day, and nothing already submitted has been re-marked.", audience: "manager" },
    ],
  },
  {
    version: "4.16.0",
    headline: "CLR Profiles: look back further than a month, and see why a quiet week was quiet.",
    items: [
      { text: "The timeframe now stretches to last month, 3 months, 6 months or all time. It still opens on this month. Longer ranges used to show an empty chart with \u201ctoo many days\u201d \u2014 now the bars simply widen to a week or a month so the shape stays readable.", audience: "manager" },
      { text: "The chart no longer draws days that have not happened yet. Looking at this month on the 28th used to leave three empty bars on the end that read like three days of doing nothing.", audience: "manager" },
      { text: "Quiet weekends are left off. A Saturday nobody was expected to work no longer looks like a failed day \u2014 but a weekend somebody did work still shows up.", audience: "manager" },
      { text: "Approved time off is shaded on the chart, so an empty bar reads as \u201caway\u201d instead of \u201cwasted day\u201d.", audience: "manager" },
      { text: "Over 3 months, 6 months or all time the chart adds a trend line, so you can see the direction rather than squinting at individual bars.", audience: "manager" },
      { text: "Manager notes can now be pinned to the chart. A pinned note shows as a marker above its bar and reads out when you hover it \u2014 so a dip has its explanation attached instead of living somewhere else. Every note is still kept whether or not it is pinned, and no note is ever counted in any figure.", audience: "manager" },
      { text: "A note can also be sent into that day\u2019s report emails \u2014 for instance why somebody was out \u2014 so the people reading the report get the context with the numbers. You can turn that section off in Settings like any other.", audience: "manager" },
      { text: "Weekly goals stop being multiplied out over long ranges. Comparing a month of work against a target scaled up 26 times told you nothing.", audience: "manager" },
      { text: "CLR Profiles load faster: the records behind the page had never been indexed, so every visit read the whole table.", audience: "manager" },
    ],
  },
  {
    version: "4.15.0",
    headline: "The Bonzo one-click Shotgun button works again.",
    items: [
      { text: "Bonzo moved its app to a new web address, so the ⚡ Shotgun button silently stopped appearing on prospects — with no error anywhere, because the extension could not tell it was on a Bonzo page at all. It now recognises the new address. Reload the extension and reopen your Bonzo tabs.", audience: "manager" },
      { text: "The link back to the prospect in a published lead’s notes was quietly falling back to just a prospect number for the same reason. Real links again.", audience: "manager" },
      { text: "Publishing the same person twice is properly blocked now. Bonzo stores a phone as +1 followed by the number while a typed one has no +1, and Shotgun treated those as two different people — so one person could be sent to two CLRs at once.", audience: "manager" },
    ],
  },
  {
    version: "4.14.0",
    headline: "CLR Profiles now show real phone activity, and take manager notes.",
    items: [
      { text: "The daily chart used to be dominated by the “Additional Calls” number a CLR types into their own EOD form — the least reliable figure on the page, and it disagreed with EOD Analytics. It now plots what the dialers actually recorded: call time, Dialpad calls, CallTools calls, conversations, transfers and appointments, with a button to switch between them.", audience: "manager" },
      { text: "Managers can add dated notes to a CLR — what was discussed, context for a rough week. Notes are commentary only: nothing on the page counts them, so a note can never move a statistic or a bar.", audience: "manager" },
      { text: "Off-network check-ins now require you to be within 200m of the office, using the office location C3 already had on file.", audience: "everyone" },
    ],
  },
  {
    version: "4.13.0",
    headline: "C3 opens much faster.",
    items: [
      { text: "Opening C3 used to download and start up the entire app — every screen, every chart, the whole portal — before showing you anything. It now loads only the screen you are on, so first entry is roughly a fifth of what it was. Pages you visit load in the background as you go.", audience: "everyone" },
      { text: "Releases are lighter too: the parts that rarely change are kept separately, so a new version no longer makes everyone re-download everything.", audience: "everyone" },
    ],
  },
  {
    version: "4.12.0",
    headline: "Late excuses answer themselves, and off-site check-ins prove they are here.",
    items: [
      { text: "Clear-cut late reasons are now decided straight away instead of waiting on a manager: already had permission, or forgot to clock in, is excused; traffic or a bare “personal matter” is not. Anything less clear-cut still goes to a manager exactly as before, and if a decision looks wrong you can ask a manager to take another look.", audience: "everyone" },
      { text: "Managers are no longer asked to approve the obvious ones — only the genuinely debatable ones, and anything an employee escalates.", audience: "manager" },
      { text: "New optional rule for checking in away from the office: if you are not on the office network, C3 asks your device for location and needs you within 200m of the office. It stays off until an admin sets the office location in Settings, and it never applies on the office network or to the LO Assistant Portal.", audience: "everyone" },
    ],
  },
  {
    version: "4.11.0",
    headline: "C3 now reviews itself and suggests improvements.",
    items: [
      { text: "New App Review page for admins: every 3 days — and more thoroughly every 4 weeks — Claude looks at how C3 is actually being used and proposes specific changes, each with the numbers behind it. Approve or deny each one, with a note.", audience: "manager" },
      { text: "Approving a suggestion records that you want it done; it never changes the app by itself. Every run shows which model produced it and roughly what it cost.", audience: "manager" },
    ],
  },
  {
    version: "4.10.1",
    headline: "Portal accounts are no longer treated as CLRs.",
    items: [
      { text: "The shared LO Assistant Portal login was being counted as a CLR: it was sent EOD reminders and escalating overdue notices for reports it can never file, at an address that is not a mailbox. Portal accounts are now excluded from every CLR list — reminders, daily assignments, rosters and stats.", audience: "manager" },
      { text: "The third overdue notice used to be titled “3th reminder”. It now reads “reminder #3”.", audience: "everyone" },
    ],
  },
  {
    version: "4.10.0",
    headline: "Paste a screenshot straight onto a comp request.",
    items: [
      { text: "Take a screenshot of a receipt and press Ctrl+V (Cmd+V on a Mac) anywhere on the Comp Requests page — it attaches to the request you are filling in, with a thumbnail so you can see what you grabbed. Pasting text still works normally everywhere. You can also paste onto the “Attach or paste receipt” link on a request you already filed.", audience: "everyone" },
      { text: "Receipts that fail to upload now say so. Until today a rejected receipt was thrown away silently while the confirmation still counted it, so a request could reach the approver with no receipt at all and nobody would know.", audience: "everyone" },
      { text: "Oversized files are now refused up front with the actual size and limit, instead of failing with an unreadable error mid-submit.", audience: "everyone" },
    ],
  },
  {
    version: "4.9.0",
    headline: "EOD reports are due at 4:00 PM the next business day.",
    items: [
      { text: "One deadline now decides lateness: 4:00 PM on the next working day. Filing the same evening or the next morning is on time, and Friday's report is due Monday at 4:00 PM. The old mix of a same-day 4:00 PM cutoff and a next-day allowance marked people late for filing at 4:31 PM while someone filing the following afternoon counted as on time — filing sooner can no longer score worse.", audience: "everyone" },
      { text: "You are still asked for a missing report as soon as you next open C3, before anything else — that prompt is unchanged and comes well before the deadline.", audience: "everyone" },
      { text: "Past reports were re-checked against the new deadline, so the EOD history reflects the current rule.", audience: "manager" },
    ],
  },
  {
    version: "4.8.1",
    headline: "Past EOD reports re-checked against the new rule.",
    items: [
      { text: "Reports filed before today were still marked late under the old same-day rule. Each one has been re-checked using when it was actually filed and the filer's own timezone, so the EOD history now matches the current rule instead of showing almost everyone late.", audience: "manager" },
    ],
  },
  {
    version: "4.8.0",
    headline: "Filing yesterday's EOD in the morning is no longer late.",
    items: [
      { text: "You now have until the end of the next working day to file an EOD report, so filing yesterday's first thing in the morning counts as on time. Friday's report is on time when filed Monday. Anything older than that still counts as late.", audience: "everyone" },
      { text: "EOD reports no longer copy managers. The report goes to the person who filed it; managers see the same numbers in the daily digest and the Transfer Scorecard.", audience: "manager" },
    ],
  },
  {
    version: "4.7.0",
    headline: "C3 now notices when an email reaches nobody.",
    items: [
      { text: "Every message C3 sends is now checked against the mail provider afterwards. If one is blocked or bounces — which quietly destroyed four months of manager mail — admins get an alert naming the message and the addresses, instead of silence.", audience: "manager" },
      { text: "The activity log used to record a message as “delivered” the moment the provider accepted it, which is what made the outage invisible. It now records it as accepted, and the true outcome is filled in once known.", audience: "manager" },
    ],
  },
  {
    version: "4.6.1",
    headline: "Manager emails are reaching managers again.",
    items: [
      { text: "Two manager addresses on file were never real mailboxes. They bounced back in April and our mail provider blocked them — and because it drops the entire message when one address is blocked, every manager email since then was thrown away: Transfer Scorecards, check-in digests, late-excuse requests and EOD reports. The correct addresses are now in place and the mail flows again.", audience: "manager" },
      { text: "Corrections used to be undone: a start-up step kept rewriting the fixed addresses back to the broken ones after every release. That step is gone, so an address you change in Settings now stays changed.", audience: "manager" },
      { text: "Scheduled daily, weekly and monthly reports had also been left with no recipients at all, and now have them back.", audience: "manager" },
    ],
  },
  {
    version: "4.6.0",
    headline: "Lead notes and LO replies now live on each package.",
    items: [
      { text: "Every package in Results has a notes thread: pick your name, fill in the pre-set lead-notes format, and post — Chris gets the note by email automatically, and it stays on the package for everyone.", audience: "lap" },
      { text: "Chris (or any admin) can reply on the same thread with Remarks, Notes, and Opportunities — the reply shows highlighted so it's easy to spot, and the portal bell announces it.", audience: "lap" },
    ],
  },
  {
    version: "4.5.0",
    headline: "Find your leads by LOA in the portal.",
    items: [
      { text: "Results now has a “Connected LOA” dropdown — pick a name and see just the packages for leads that CLR connected to that LOA. Transfer Documents got the same dropdown, and each transfer now shows which LOA it was connected to.", audience: "lap" },
      { text: "Fixed: LOA names on transfer lists were joined against the wrong table and could show the wrong person — they now come from the LOA directory itself.", audience: "lap" },
    ],
  },
  {
    version: "4.4.0",
    headline: "C3 transfers now land in the LAP portal by themselves.",
    items: [
      { text: "Every new transfer to Christopher Redoble automatically becomes a package in LAP Results within a minute — named for the borrower, dated, linked to the C3 transfer, with a note saying which CLR sent it. No more creating packages by hand from the Transfer Documents page.", audience: "lap" },
      { text: "If an LOA already started a package for that borrower in the last week, the transfer links to it instead of creating a duplicate. The portal bell announces each new package.", audience: "lap" },
      { text: "Transfers logged before today stay as they were — only new ones auto-flow.", audience: "manager" },
    ],
  },
  {
    version: "4.3.2",
    headline: "Fixed: the extension zip now unzips ready to load.",
    items: [
      { text: "If Chrome said “Manifest file is missing or unreadable”: re-download the extension from the Shotgun page — the zip no longer buries the files in a second folder, so the folder your unzip creates is the one Load unpacked wants.", audience: "everyone" },
    ],
  },
  {
    version: "4.3.1",
    headline: "The Bonzo extension now has a proper install window.",
    items: [
      { text: "On the Shotgun page, “Get the Chrome extension” opens a window with the download button and the four install steps — plus the key generator for browsers where the login cookie doesn't carry over.", audience: "everyone" },
    ],
  },
  {
    version: "4.3.0",
    headline: "One-click Shotgun straight from Bonzo.",
    items: [
      { text: "New Chrome extension: open any prospect in Bonzo and an orange ⚡ Shotgun button appears — one click sends that lead into the rotation. C3 pulls the prospect's name, phone, email, state, and source from the Bonzo API itself, so nothing is retyped and the usual duplicate and calling-hours checks still apply.", audience: "everyone" },
      { text: "Get it on the Shotgun page: Download the extension, load it via chrome://extensions → Developer mode → Load unpacked. Being logged in to C3 in the same browser is normally all it needs; if not, \"Get my key\" mints a one-time key to paste into the extension popup.", audience: "everyone" },
      { text: "Leads sent this way carry the Bonzo pipeline, stage, assigned user, and a link back to the prospect in the notes, and the audit trail marks them as one-click publishes.", audience: "manager" },
    ],
  },
  {
    version: "4.2.4",
    headline: "Shotgun publishers now see the whole board for the last 10 minutes.",
    items: [
      { text: "If you have Shotgun publish access, the Shotgun page now shows every lead published in the last 10 minutes — not just the ones assigned to you — so you can watch a lead you fired land with a CLR. Older leads still show only if they're yours.", audience: "everyone" },
      { text: "Publishers also see who published each lead. Requeue and cancel remain manager-only.", audience: "manager" },
    ],
  },
  {
    version: "4.2.3",
    headline: "Admins can grant Shotgun publishing to specific people.",
    items: [
      { text: "Settings → user list now has an \"Allow Shotgun\" button on each non-manager. Granted users get the publish form on the Shotgun page and can send prospects into the rotation — without any other manager rights.", audience: "manager" },
      { text: "Managers and admins can publish as always. Only an admin can grant or revoke the flag, and every change is recorded in the audit trail.", audience: "manager" },
    ],
  },
  {
    version: "4.2.2",
    headline: "Time Clock moved into Advanced Settings.",
    items: [
      { text: "Time Clock now lives under Advanced Settings in the sidebar, in a Personal group. The page itself is unchanged — just its spot in the menu." },
    ],
  },
  {
    version: "4.2.1",
    headline: "The expanded borrower profile now collects only the requested contact and loan details.",
    items: [
      { text: "Input Results and the live Lead Card no longer include Social Security number fields for either borrower." },
    ],
  },
  {
    version: "4.2.0",
    headline: "Input Results now captures a complete, clearly organized borrower and loan profile.",
    items: [
      { text: "Transfers can now include borrower contact and date-of-birth details, an exact credit score, co-borrower details, and separate first-mortgage and HELOC terms." },
      { text: "The form is grouped into borrower, co-borrower, property, first mortgage, HELOC, and income sections so the handoff is faster to complete and easier to read." },
    ],
  },
  {
    version: "4.1.0",
    headline: "Recurring tasks keep every deadline, and overdue work now follows up until it is done.",
    items: [
      { text: "Each recurring deadline is now its own task occurrence. If Monday is missed, it stays overdue when Tuesday's occurrence appears instead of blocking the schedule or disappearing when somebody completes it late. The saved local deadline also stays at the same clock time across daylight-saving changes." },
      { text: "An overdue task now opens a red reminder anywhere in C3, with a 30-minute snooze and a direct path to Task Center. Mandatory report screens and urgent Shotgun offers still take priority." },
      { text: "Overdue email is now accepted by Resend before C3 records it as sent. Failures retry automatically, and unresolved occurrences send one follow-up email per day to the assigned CLR and managers." },
    ],
  },
  {
    version: "4.0.3",
    headline: "Cookie and update dialogs now wait for each other instead of locking the browser.",
    items: [
      { text: "C3 now finishes the cookie notice before showing an available-update dialog, and smaller nudges wait until both are resolved. Every visible prompt stays clickable." },
      { text: "The read-only demo no longer repeats reminders that require saving changes, such as pipeline acknowledgements, goals, or push setup." },
    ],
  },
  {
    version: "4.0.2",
    headline: "The read-only C3 demo no longer gets trapped behind reporting screens.",
    items: [
      { text: "Demo CLR can now open and explore C3 without an impossible Daily Report or EOD requirement. The demo stays read-only, while required reporting remains fully enforced for real CLR accounts." },
    ],
  },
  {
    version: "4.0.1",
    headline: "C3 no longer freezes under several startup prompts at once.",
    items: [
      { text: "Required Daily Report and EOD screens now always go first. Today's prioritized loan officers, the pipeline refresher, and the cookie notice wait instead of covering one another." },
      { text: "After required reporting is complete, C3 presents the daily loan-officer priorities and other startup notices in a clear sequence so every visible button remains usable." },
    ],
  },
  {
    version: "4.0.0",
    headline: "Welcome to C3 v4: every claimed Shotgun lead now asks for a result and can become a real transfer.",
    items: [
      { text: "After a CLR accepts a Shotgun lead, a result prompt follows them across C3 until they finish the lead. They can keep working and ask for a 10-minute reminder without losing the assignment." },
      { text: "Shotgun results now include a Log as a transfer option with the receiving loan officer and Direct or Appointment transfer type. Logging it creates the same transfer record used by C3 analytics, reporting, credit, celebrations, and CRM sync." },
      { text: "Managers can see directly on the Shotgun board when a completed lead was logged as a transfer, who received it, and which transfer type was used.", audience: "manager" },
    ],
  },
  {
    version: "3.104.0",
    headline: "Shotgun now routes one visible offer at a time and protects the full lead workflow.",
    items: [
      { text: "A CLR can hold only one live Shotgun offer, so simultaneous publishes can no longer create a second hidden countdown. Ready CLRs now see offers within about two seconds, with email, state, source, and manager context on the offer." },
      { text: "Managers now get duplicate phone/email protection, validated contact details, a required state for phone leads, a confirmed Requeue action that clears prior work without erasing history, and a safe Cancel action.", audience: "manager" },
      { text: "Opening the phone now checks the state's calling window and requires an explicit local-time, DNC, consent, and policy acknowledgement. C3 clearly says which compliance checks still require a person." },
      { text: "Mandatory Daily Report and EOD locks now suspend Shotgun eligibility immediately, preserving the CLR's Ready preference while preventing an offer from appearing behind a blocking screen." },
    ],
  },
  {
    version: "3.103.0",
    headline: "Shotgun offers now chime, can be passed, and a missed one takes you out of the rotation.",
    items: [
      { text: "A Shotgun offer now plays a pleasant two-note chime when it lands, and repeats softly while it is on screen — you will hear it even if you are looking at another window." },
      { text: "New Pass button on the offer: not the right lead for you? Pass and it goes to the next CLR instantly instead of burning the rest of your 20 seconds. Passing keeps you in the rotation." },
      { text: "Letting the timer run out is different: a missed offer now takes you out of the rotation and leaves you a notification. Press Ready on the Shotgun page to rejoin. Being Ready means answering in 20 seconds — if you step away, C3 stops offering you leads instead of wasting them." },
    ],
  },
  {
    version: "3.102.0",
    headline: "Input Results asks for credit once, and employment, credit and military are now buttons.",
    items: [
      { text: "Credit score was asked twice — a yes/no \"over 500?\" in Qualification plus a separate Credit score box in Info Gathering. It is one field now, with bands: 500-580, 580-620, 620-720, 720+." },
      { text: "Employment is W2 / SE / Retired buttons, with a notes box beside it for anything that does not fit — a second job, 1099 work on the side." },
      { text: "Military is Yes / No with its own notes box." },
      { text: "Tapping the answer you already picked clears it, so a mistake does not mean starting the form over. The same buttons appear on the live-call Lead Card." },
    ],
  },
  {
    version: "3.101.1",
    headline: "A denied attendance request no longer pings you.",
    items: [
      { text: "Attendance excuse requests that are not approved are now silent — no notification and no push. An approval still tells you, because it changes something: the late stops counting toward your rolling total." },
      { text: "The decision and any manager note are still recorded, still audited, and still visible on the Check-Ins page." },
    ],
  },
  {
    version: "3.101.0",
    headline: "The dashboard call chart now shows every CallTools dial, not a fraction of them.",
    items: [
      { text: "The team trend chart was counting only the calls C3 hears about directly — 185 on a day the team actually dialed 8,729. It now reads the complete CallTools figure, so the bars reflect real dialing volume." },
      { text: "Manually logged calls and Dialpad are unchanged and still shown separately." },
    ],
  },
  {
    version: "3.100.0",
    headline: "The team dashboard is open to everyone, and the Transfer Scorecard opens on today.",
    items: [
      { text: "Team Dashboard is now in the sidebar for everyone, not just managers — the same view managers see, with team totals, the leaderboard, transfer trends and LO breakdowns. Your own dashboard is unchanged and still your home page." },
      { text: "The Transfer Scorecard now opens on Today instead of the last 7 days, so you see where the team stands right now." },
    ],
  },
  {
    version: "3.99.2",
    headline: "Fixes C3 freezing on a locked screen you could not click.",
    items: [
      { text: "If you were missing both yesterday's call report and an EOD report, C3 showed the \"App Access Locked\" screen on top of the Daily Report box — but nothing on it responded, and the box that would have let you continue was hidden behind it. The app was simply stuck." },
      { text: "The two now take turns: file the call report first, then the EOD prompt appears and works normally." },
    ],
  },
  {
    version: "3.99.1",
    headline: "Transfers and appointments now reach the right loan officer in Bonzo.",
    items: [
      { text: "When a borrower exists in more than one LO's Bonzo book, C3 now identifies the right record by the LO's Bonzo login rather than by their display name. A transfer to Bill Neessen was landing in another LO's account because his Bonzo account is named \"Billy\" and the names did not line up." },
      { text: "If none of the matching records belong to the LO you picked, C3 no longer guesses. It skips the sync and logs every candidate it saw, instead of writing your client into a stranger's CRM." },
      { text: "It also checks every record sharing the phone number, not just the first three." },
      { text: "Managers: an LO with no Bonzo username set falls back to their email. Filling in Bonzo usernames on the LO directory makes this exact." },
    ],
  },
  {
    version: "3.99.0",
    headline: "EOD Analytics now gives managers a clearer, more complete review workspace.",
    items: [
      { text: "The new accountability queue names every CLR with missing or late EOD reports and shows the exact dates that need follow-up.", audience: "manager" },
      { text: "Managers can review any historical 7-, 30-, or 90-day period, move directly between CLRs without resetting the page, and return to the whole-team view in one click.", audience: "manager" },
      { text: "CLR patterns now have focused accountability filters and a mobile-friendly layout, while report details can be searched, filtered, sorted, and exported to CSV.", audience: "manager" },
      { text: "Team trends now include conversation-to-transfer and conversation-to-appointment rates, plus an exact day-by-day breakdown behind the chart.", audience: "manager" },
    ],
  },
  {
    version: "3.98.3",
    headline: "Your check-in schedule now makes the attendance commitment unmistakable.",
    items: [
      { text: "Check-In, Weekly Schedule, and the LO/LOA check-in portal now clearly explain that saved days and start times are the schedule you will be accountable for keeping." },
      { text: "The notice reminds you to enter the least restrictive schedule permitted for your role and to commit only to hours you can reliably meet." },
    ],
  },
  {
    version: "3.98.2",
    headline: "Leaving the Shotgun rotation now works, and stays that way.",
    items: [
      { text: "Turning off Shotgun was being undone about ten seconds later by the background check that keeps you marked online, so it was effectively impossible to leave the rotation. It now sticks." },
      { text: "Your choice is saved to your account rather than to one browser, so opting out on your laptop no longer leaves your phone quietly putting you back in." },
    ],
  },
  {
    version: "3.98.1",
    headline: "Shotgun paces itself, and a claimed lead is locked to the CLR who took it.",
    items: [
      { text: "A Shotgun lead nobody picks up now waits five minutes before coming back to the same CLR. It still cycles round the team until someone takes it — it just stops re-offering every twenty seconds." },
      { text: "Fixes a case where a lone CLR with C3 open could be left under the offer pop-up continuously, with the rest of C3 unreachable behind it." },
      { text: "Once a lead is confirmed it belongs to that CLR alone: nobody else can claim it, it cannot be claimed twice, and the rotation will not hand it on." },
    ],
  },
  {
    version: "3.98.0",
    headline: "Shotgun keeps going until someone grabs the lead — and C3 stops signing you out.",
    items: [
      { text: "C3 was bouncing people to the login screen at random. A request that timed out or failed was being treated as \"you are signed out\", even though your session was still perfectly valid. Now only the server actually saying so signs you out, and a request that fails is retried instead." },
      { text: "Shotgun is ON by default for every CLR. Keep C3 open and you are in the rotation — there is nothing to press. You can still opt out from the Shotgun page whenever you need to." },
      { text: "A Shotgun lead no longer gets stranded. It used to stop for good once it had been offered to each Ready CLR once, so a lead nobody picked up just sat in the queue. It now keeps cycling round the team until somebody confirms it." },
      { text: "You get 20 seconds to confirm a Shotgun lead, up from 15." },
    ],
  },
  {
    version: "3.97.1",
    headline: "Shotgun now rallies the team when too few CLRs are ready.",
    items: [
      { text: "When a lead is published with only zero, one, or two CLRs in the Ready queue, every active CLR receives an email, push alert, and C3 notification prompting them to join Shotgun." },
      { text: "The CLR selected for the lead still receives the separate urgent 15-second confirmation alert." },
    ],
  },
  {
    version: "3.97.0",
    headline: "C3 introduces Shotgun—15-second live lead distribution for ready CLRs.",
    items: [
      { text: "Managers can publish a lead from the new Shotgun page; C3 offers it fairly to one ready CLR at a time." },
      { text: "CLRs press Ready to enter the rotation, receive a full-screen offer, and have 15 seconds to confirm before the lead moves automatically." },
      { text: "After claiming a lead, the CLR records whether they called and texted, writes result notes, saves progress, and marks the lead done." },
      { text: "Managers can watch the live queue, see who is ready and who owns each lead, review completed results, and requeue active leads." },
    ],
  },
  {
    version: "3.96.1",
    headline: "The 10:00 AM check-in email now explains excuses and reliably includes configured managers.",
    items: [
      { text: "Excused late arrivals and absences now show their recorded reason in the private 10:00 AM manager email." },
      { text: "Scott Petrie and every configured manager-email recipient are now included in the 10:00 AM digest and overdue-task manager emails without requiring extra C3 permissions." },
    ],
  },
  {
    version: "3.96.0",
    headline: "Transfer celebrations now show your totals—and race leaders across the screen.",
    items: [
      { text: "Every transfer celebration shows your updated daily and monthly transfer totals immediately after the transfer is saved." },
      { text: "When your transfer puts you in first place for the day—or you extend your lead—a race car speeds across the screen with a Daily Leader banner." },
    ],
  },
  {
    version: "3.95.1",
    headline: "Task assignments and overdue deadlines are much harder to miss.",
    items: [
      { text: "CLRs now receive an email, push alert, and C3 notification when a task is assigned to them." },
      { text: "When a task becomes overdue, both the assigned CLR and every manager receive alerts and email, and Task Center displays a prominent red overdue banner." },
    ],
  },
  {
    version: "3.95.0",
    headline: "Task Center now supports custom weekly schedules.",
    items: [
      { text: "Managers can choose any combination of weekdays for a recurring task, including schedules such as Monday, Wednesday, and Friday." },
      { text: "Transfer wins now use the upgraded cinematic full-screen celebration with eight times the confetti, animated light rays, energy rings, and a larger centerpiece." },
    ],
  },
  {
    version: "3.94.2",
    headline: "Transfer celebrations got a major visual upgrade.",
    items: [
      { text: "Your transfer win now fills the screen with layered confetti cannons, animated light rays, gold energy rings, a polished transfer banner, and a bigger cinematic centerpiece." },
    ],
  },
  {
    version: "3.94.1",
    headline: "Transfer celebrations now appear for the right person.",
    items: [
      { text: "After you successfully log a transfer, the full-screen animation and confetti now appear immediately in your browser—and only your browser." },
    ],
  },
  {
    version: "3.94.0",
    headline: "C3 adds a real task center, livelier transfers, and a better certification experience.",
    items: [
      { text: "Managers can assign one-time or recurring tasks to CLRs, set priorities and deadlines, track completion history, and automatically alert every manager when a deadline is missed." },
      { text: "Opted-in transfer alerts now fill the screen with confetti, a victory animation, and the celebration chime instead of appearing as a small corner message." },
      { text: "Celebrations arrive within a few seconds, queue cleanly when multiple transfers land together, and respect reduced-motion accessibility settings." },
      { text: "The morning activity popup now asks only about the most recent completed workday—it will never demand a report for the day that just started." },
    ],
  },
  {
    version: "3.93.0",
    headline: "The CLR certification test now feels like a game instead of a 60-question form.",
    items: [
      { text: "The test shows one question at a time, gives immediate right-or-wrong feedback with the explanation, celebrates streaks and checkpoints, and uses motion to keep the full 60-question run engaging." },
      { text: "Scoring still happens securely on the server, the full answer key stays hidden, and only completed attempts enter test history." },
    ],
  },
  {
    version: "3.92.1",
    headline: "Managers can reverse a time-off approval without deleting the request.",
    items: [
      { text: "An approved team time-off request now has a Deny approved time off action with confirmation, an optional note, requester notification, and a complete audit trail.", audience: "manager" },
    ],
  },
  {
    version: "3.92.0",
    headline: "Managers can now understand EOD reporting patterns across the whole team in one place.",
    items: [
      { text: "EOD Analytics shows submission and on-time rates, CallTools activity, conversations, transfers, appointments, checklist patterns, and every report's notes in a manager-friendly view.", audience: "manager" },
      { text: "Training workdays now recognize measurable work from EOD reports and Dialpad too, so calls, appointments, messages, and other real activity count even without a transfer.", audience: "manager" },
      { text: "Chris Redoble transfers logged in C3 can be opened as LAP packages, linked to a package that was started earlier, or merged when the borrower was accidentally entered twice.", audience: "lap" },
      { text: "LAP documents are optional: an LOA can start a borrower package before any file arrives and add any useful documents later.", audience: "lap" },
      { text: "Transfers for a loan officer with an active LOA stay in the LAP workflow instead of also changing that borrower in Bonzo." },
    ],
  },
  {
    version: "3.91.4",
    headline: "Every C3 workday now opens with the loan officers who need attention first.",
    items: [
      { text: "The first C3 screen of the day shows every loan officer marked as needing transfers, followed by your ranked daily LO assignment order." },
      { text: "The briefing appears at the start of each C3 business day and includes a direct button to open Daily Assignments." },
    ],
  },
  {
    version: "3.91.3",
    headline: "New CLRs are clearly marked while they complete their first 20 business workdays.",
    items: [
      { text: "Every C3 stats view now labels CLRs with fewer than 20 completed business workdays as In training.", audience: "manager" },
      { text: "In-training CLRs remain visible with their full results, but they are excluded from the manager dashboard's rolling team averages until day 20.", audience: "manager" },
    ],
  },
  {
    version: "3.91.2",
    headline: "There is no longer a limit on who can be marked as needing transfers.",
    items: [
      { text: "Managers can flag as many loan officers as needed from State Lookup. Every flagged LO remains highlighted and pinned to the top of the states they cover." },
    ],
  },
  {
    version: "3.91.1",
    headline: "Managers now receive the full set of attendance and time notices by email.",
    items: [
      { text: "Late-excuse requests, schedule changes and time-off requests now email the configured manager recipients, in addition to their existing C3 and push notifications." },
      { text: "Scott Petrie is included through the manager email list; this does not change his C3 permissions." },
    ],
  },
  {
    version: "3.91.0",
    headline: "A 60-question certification test, and a shorter sidebar.",
    items: [
      { text: "CLR Training now has a certification test: 60 questions from Matt Lane's two-week plan, 54 correct (90%) to pass. After you submit it shows every answer with a short explanation, so the review with your trainer has something to work from." },
      { text: "Attempts are saved, so you and your trainer can see your history. Trainers see everyone's." },
      { text: "Forum, CLR Training and CLR Profiles moved into Advanced Settings to keep the everyday sidebar short." },
      { text: "The app icon is transparent now, and adapts — navy on light backgrounds, white on dark. The installed-app icon keeps its tile, because iOS puts transparent icons on a black square." },
    ],
  },
  {
    version: "3.90.0",
    headline: "The CLR Trainer Walkthrough is now a page in C3, written by Matt Lane.",
    items: [
      { text: "Matt Lane's two-week training plan is under CLR Training — all ten days, split morning and afternoon, with each day's end-of-day checkpoint called out. No more hunting for the document." },
      { text: "Filter to Week 1 or Week 2, jump straight to a day, or print the whole thing for a trainee to keep at their desk." },
    ],
  },
  {
    version: "3.89.0",
    headline: "Up to three loan officers can be flagged as needing transfers.",
    items: [
      { text: "Flagged LOs are highlighted and pinned to the top of every state they're licensed in on State Lookup, so you can see who to send the next transfer to without checking the counts." },
      { text: "The current shortlist is shown at the top of the state panel, so you don't have to hunt for a highlight." },
      { text: "Managers set the list from State Lookup — three at a time, on purpose. Flagging a fourth is refused rather than quietly dropping someone, so you choose who comes off." },
    ],
  },
  {
    version: "3.88.0",
    headline: "C3 has its own app icon instead of the generic company W.",
    items: [
      { text: "The browser tab, taskbar and installed app now show the C³ mark. Your browser caches icons hard, so if you still see the old W, a hard refresh (Ctrl+Shift+R) or reopening the tab will pick it up." },
      { text: "At small sizes the icon drops the superscript and shows the C on its own, so it stays readable in a crowded tab strip." },
      { text: "The LO Assistant Portal keeps its own separate icon, so the two stay tellable apart when you have both open.", audience: "lap" },
    ],
  },
  {
    version: "3.87.0",
    headline: "Everyone now sees the full list of what changed in each update.",
    items: [
      { text: "Update notes are no longer filtered by whether you're a manager — every person sees every change, including the ones that land on screens they don't use." },
    ],
  },
  {
    version: "3.86.0",
    headline: "The two retail Bonzo questions on the EOD are only for when you're asked.",
    items: [
      { text: "The retail Bonzo questions (Meta leads, ungraduated/graduated) are not part of the standard day — they're for when a manager asks you to work it, or you ask to. Answering No is expected and is not counted against you." },
      { text: "Managers now see who DID pick up retail Bonzo work, rather than a list of everyone who didn't.", audience: "manager" },
    ],
  },
  {
    version: "3.85.0",
    headline: "Update notices now actually list what changed — the last version could not.",
    items: [
      { text: "What's new in each update is sent by the server rather than read from the tab you already have open, so the list is correct even for releases that happened after your tab loaded." },
    ],
  },
  {
    version: "3.84.0",
    headline: "The seating map opens inside C3 instead of throwing you out to another site.",
    items: [
      { text: "Seating Map now loads in place, so you stay signed in and keep your spot instead of bouncing to another tab. It is still the same seating chart app, just shown inside C3." },
      { text: "Open in new tab is still there if you want it full screen." },
    ],
  },
  {
    version: "3.83.0",
    headline: "Update notices now tell you what actually changed.",
    items: [
      { text: "This popup now lists what's new in the version you're updating to, instead of just saying an update exists." },
      { text: "Notes are written per release, so you can tell at a glance whether a refresh affects your work." },
    ],
  },
  {
    version: "3.82.0",
    headline: "Managers can read the day's EOD reports without opening a single email.",
    items: [
      { text: "The EOD card on the manager dashboard now shows what each CLR reported — calls, messages, conversations, transfers, appointments, LOs covered — with their notes inline and a team total.", audience: "manager" },
      { text: "Loan officer workload balance: the five lightest and five heaviest loaded LOs over 30 days, so transfers can be spread without checking state by state.", audience: "manager" },
    ],
  },
  {
    version: "3.81.0",
    headline: "EOD reports are due by 4:00 PM and now ask four daily questions.",
    items: [
      { text: "Your EOD report is due by 4:00 PM. Filing later still works — it's just marked late." },
      { text: "Four new questions: bulk text for all assigned LOs, responded/new contacts worked, retail Bonzo Meta leads, retail Bonzo ungraduated/graduated leads." },
      { text: "Notes are now required. Everything else on the report is counted for you, so the note is the only part that can't be reconstructed." },
      { text: "Managers see who filed late and which checklist items were skipped, by name.", audience: "manager" },
    ],
  },
  {
    version: "3.80.0",
    headline: "CLR profiles show an all-time record measured against the floor.",
    items: [
      { text: "Profiles now carry lifetime transfers, appointments, calls and active days, compared against the team on five rates.", audience: "manager" },
      { text: "Comparisons are per active day, not totals, so someone who started recently isn't buried by tenure. Under five active days the ranking is marked provisional.", audience: "manager" },
    ],
  },
  {
    version: "3.79.0",
    headline: "You can book an appointment before you know which LO will take it.",
    items: [
      { text: 'Input Results has a "No LO yet — assign later" option on appointments. Transfers still need an LO, since a transfer goes to someone.' },
      { text: "Unassigned appointments read as Unassigned everywhere, including the export." },
    ],
  },
  {
    version: "3.78.0",
    headline: "State Lookup leads with the LO who has taken the fewest transfers.",
    items: [
      { text: "Open a state and the licensed LOs are ordered fewest-transfers-first, each showing their count, with the lightest-loaded highlighted." },
      { text: "Switch the window between 7 days, 30 days and all time, or sort by priority tier instead." },
    ],
  },
  {
    version: "3.77.0",
    headline: "LAP opens with one shared password instead of individual logins.",
    items: [
      { text: "Enter LAP with the shared access password. Your work is recorded against your device rather than your name.", audience: "lap" },
      { text: "The transfer-documents screen is open to anyone in LAP, not just administrators.", audience: "lap" },
    ],
  },
  {
    version: "3.76.0",
    headline: "Input Results is a single page.",
    items: [
      { text: "Logging an outcome is one form instead of three screens. The appointment/transfer picker sits at the top and can be changed at any point." },
      { text: "No more Next and Back — everything you need is on the page." },
    ],
  },
  {
    version: "3.75.0",
    headline: "LAP: documents can be submitted one at a time.",
    items: [
      { text: "Create a document package with whatever you have — a credit report alone is enough — and attach the AUS and formal quote when they arrive.", audience: "lap" },
      { text: "A Transfer Documents screen lists every transfer to Chris Redoble over 3, 7 or 30 days or all time, showing which of the three documents came in.", audience: "lap" },
    ],
  },
  {
    version: "3.74.0",
    headline: "Transfer notes arrive in Bonzo readable instead of as one block of text.",
    items: [
      { text: "The notes C3 posts to Bonzo now have proper headings, one field per line and the LOA routing instruction called out, rather than running together into a wall of text." },
    ],
  },
];

/** Notes for a version, or null when that release shipped without any. */
export function notesFor(version: string): ReleaseNote | null {
  return RELEASE_NOTES.find((n) => n.version === version) ?? null;
}

/**
 * Everything a reader has missed between the build they are running and the one
 * that is live, newest first — so someone who skipped three deploys sees all
 * three rather than only the latest.
 */
export function notesBetween(fromVersion: string, toVersion: string): ReleaseNote[] {
  const cmp = (a: string, b: string) => {
    const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
    return 0;
  };
  if (cmp(fromVersion, toVersion) >= 0) return [];
  return RELEASE_NOTES
    .filter((n) => cmp(n.version, fromVersion) > 0 && cmp(n.version, toVersion) <= 0)
    .sort((a, b) => cmp(b.version, a.version));
}

/**
 * The notes a reader sees. Role is deliberately NOT a filter: a CLR seeing that
 * managers got a new dashboard costs them one line, while hiding it means the
 * people asking "did anything change?" are the least likely to be told.
 *
 * The portal split remains, because a LAP-only change genuinely has no meaning
 * inside C3 — it names screens that do not exist there.
 */
export function itemsForAudience(note: ReleaseNote, portal: "c3" | "lap"): string[] {
  return note.items
    .filter((i) => (i.audience ?? "everyone") !== "lap" || portal === "lap")
    .map((i) => i.text);
}
