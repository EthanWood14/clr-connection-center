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
