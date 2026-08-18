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
