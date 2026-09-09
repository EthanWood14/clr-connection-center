import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isUntouchedLoaNote, loaNoteHasContent, LOA_NOTE_TEMPLATE,
  LOA_NOTE_TEMPLATE_LINES, LOA_NOTE_LABELS, parseLoaNote,
} from "../shared/lap-note-template";
import { foldLapNoteBatch, type LapNoteBatchEntry } from "../server/lap-note-batch";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const routes = read("server/routes.ts");
const storage = read("server/storage.ts");
const shell = read("client/src/components/lap/lap-shell.tsx");
const sidebar = read("client/src/components/lap/lap-sidebar.tsx");
const mobileNav = read("client/src/components/lap/lap-mobile-nav.tsx");
const notesPage = read("client/src/pages/lap-lead-notes.tsx");
const resultsPage = read("client/src/pages/lap-results.tsx");
const card = read("client/src/components/lap/lap-email-settings-card.tsx");
const thread = read("client/src/components/lap/package-notes-thread.tsx");

// Slices a source file between two anchors. The end is searched for AFTER the
// start, so a slice can never run backwards and pass vacuously as "".
function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `missing anchor: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `missing end anchor after ${start}: ${end}`);
  return source.slice(from, to);
}

// Position of an anchor in a source, failing loudly when it is absent. Every
// ordering check below goes through this: a bare indexOf returns -1 for a
// missing anchor, and -1 < anything let a "comes before" assertion pass with
// the anchor gone.
const at = (src: string, needle: string): number => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `missing: ${needle}`);
  return i;
};

// Every LOA note is emailed to Chris, so the composer pre-fills a template and
// both ends refuse to post it untouched.
test("an untouched template is blank; one filled line is content", () => {
  assert.equal(isUntouchedLoaNote(LOA_NOTE_TEMPLATE), true);
  assert.equal(isUntouchedLoaNote(""), true);
  assert.equal(isUntouchedLoaNote("   \n\n  "), true, "whitespace is blank");
  // A textarea on Windows hands back CRLF; that is still the bare template.
  assert.equal(isUntouchedLoaNote(LOA_NOTE_TEMPLATE.replace(/\n/g, "\r\n")), true);
  // Trailing spaces after a label are not content either.
  assert.equal(isUntouchedLoaNote(LOA_NOTE_TEMPLATE.split("\n").map((line) => `${line}   `).join("\n")), true);
  const filled = LOA_NOTE_TEMPLATE.replace("FICO Actual: ", "FICO Actual: 776");
  assert.equal(isUntouchedLoaNote(filled), false);
  assert.equal(loaNoteHasContent(filled), true);
  assert.equal(isUntouchedLoaNote("Called the borrower, wants a HELOC"), false, "free text is content too");
});

test("the guard judges lines, not the whole body", () => {
  const lines = LOA_NOTE_TEMPLATE.split("\n");
  // Nothing but labels is untouched however they are arranged. The old
  // whole-body compare called a template with one label deleted, or the labels
  // reordered, "filled in" — and emailed it.
  assert.equal(isUntouchedLoaNote(lines.slice(1).join("\n")), true, "template minus one line");
  assert.equal(isUntouchedLoaNote([...lines].reverse().join("\n")), true, "template lines reordered");
  // A label without its trailing space is the same bare label.
  assert.equal(isUntouchedLoaNote("FICO Actual:"), true);
  assert.equal(isUntouchedLoaNote(lines.map((line) => line.trimEnd()).join("\n")), true);
  // One free-text line beside a bare label is content.
  const withText = "FICO Actual: \nCalled the borrower, wants a HELOC";
  assert.equal(isUntouchedLoaNote(withText), false);
  assert.equal(loaNoteHasContent(withText), true);
});

test("a note folds into the pending batch only when it cancelled a queued email", () => {
  const a: LapNoteBatchEntry = { authorName: "Ana", body: "first", at: 0 };
  const b: LapNoteBatchEntry = { authorName: "Ben", body: "second", at: 29_000 };
  const c: LapNoteBatchEntry = { authorName: "Cy", body: "third", at: 36_000 };
  // cancelled > 0: the previous email never went out, so its notes ride along.
  assert.deepEqual(foldLapNoteBatch([a], 1, b), [a, b]);
  assert.deepEqual(foldLapNoteBatch([a, b], 1, c), [a, b, c], "the 0s/29s/36s case keeps all three");
  // cancelled = 0: the previous email already went out (or nothing was
  // queued), so the new note starts a fresh batch instead of re-sending it.
  assert.deepEqual(foldLapNoteBatch([a, b], 0, c), [c]);
  assert.deepEqual(foldLapNoteBatch(undefined, 0, a), [a]);
  assert.deepEqual(foldLapNoteBatch(undefined, 1, a), [a], "a cancel with no batch behind it is still just the note");
  // The prior batch is left alone: the map entry is swapped, never mutated.
  const prior = [a];
  foldLapNoteBatch(prior, 1, b);
  assert.deepEqual(prior, [a]);
});

// ── navigation ──────────────────────────────────────────────────────────────
test("Lead Notes sits in the sidebar workflow group and the mobile bar", () => {
  const workflow = between(sidebar, "const workflowItems: NavItem[] = [", "const personalItems");
  assert.match(workflow, /\{ title: "Lead Notes", href: "\/notes", icon: NotebookPen \}/);
  // Directly after Input Results: the note is the next thing an LOA does.
  assert.ok(at(workflow, 'href: "/results"') < at(workflow, 'href: "/notes"'));
  assert.match(mobileNav, /href: "\/notes"/);
});

test("the shell routes /notes and /notes/:resultId, and titles both", () => {
  assert.match(shell, /import LapLeadNotes from "@\/pages\/lap-lead-notes"/);
  const router = between(shell, '<Route path="/" component={LapDashboard} />', '<Route path="/settings"');
  // The deep-link route sits ahead of the list route, the same way
  // /results/:resultId sits ahead of /results just above it.
  const deep = at(router, '<Route path="/notes/:resultId" component={LapLeadNotes} />');
  const list = at(router, '<Route path="/notes" component={LapLeadNotes} />');
  assert.ok(list > deep, "the /notes list route must follow the deep-link route");
  const titles = between(shell, "const LAP_TITLES", "function lapTitle(");
  assert.match(titles, /"\/notes": "Lead Notes"/);
  assert.match(shell, /if \(location\.startsWith\("\/notes\/"\)\) return `Lead Notes · \$\{label\}`;/);
});

// ── the page ────────────────────────────────────────────────────────────────
test("the Lead Notes page searches packages and mounts the thread keyed by package", () => {
  assert.match(notesPage, /export default function LapLeadNotes/);
  assert.match(notesPage, /data-testid="lap-notes-search"/);
  assert.match(notesPage, /data-testid=\{`lap-notes-pick-\$\{result\.id\}`\}/);
  assert.match(notesPage, /useRoute<\{ resultId: string \}>\("\/notes\/:resultId"\)/);
  // The list is the same results endpoint Input Results reads.
  assert.match(notesPage, /\/api\/lap\/results\?\$\{resultQueryString\}/);
  // Same detail key as the package view, so a package opened there is already cached here.
  assert.match(notesPage, /queryKey: \["\/api\/lap\/results", "detail", requestedId\]/);
  // key= is what resets the composer draft between borrowers (see the component header).
  assert.match(notesPage, /<PackageNotesThread key=\{pkg\.id\} result=\{pkg\} isLoSide=\{isLoSide\} isAdmin=\{isAdmin\} \/>/);
  // The LO side is the server's rule — admins or the LO portal — not plain
  // isAdmin, which hid the reply box from every LO on /lop.
  assert.match(notesPage, /const isLoSide = isAdmin \|\| user\?\.portal === "lop";/);
  // A new search keeps the old list on screen instead of blanking it to skeletons.
  assert.match(notesPage, /import \{ keepPreviousData, useQuery \} from "@tanstack\/react-query"/);
  const results = between(notesPage, 'queryKey: ["/api/lap/results", "lead-notes", resultQueryString]', 'queryKey: ["/api/lap/results", "detail", requestedId]');
  assert.match(results, /placeholderData: keepPreviousData/);
  assert.match(notesPage, /data-testid="lap-notes-updating"/);
  assert.match(notesPage, /data-testid="lap-notes-open-package"/);
  assert.match(notesPage, /data-testid="lap-notes-empty"/);
});

test("the package view borrows the shared composer instead of keeping its own", () => {
  assert.doesNotMatch(resultsPage, /const LOA_NOTE_TEMPLATE\b/, "the template lives in shared/lap-note-template.ts");
  assert.doesNotMatch(resultsPage, /function PackageNotesThread/);
  assert.match(resultsPage, /import \{ PackageNotesThread \} from "@\/components\/lap\/package-notes-thread"/);
  assert.match(resultsPage, /<PackageNotesThread key=\{result\.id\} result=\{result\} isLoSide=\{isLoSide\} isAdmin=\{isAdmin\} \/>/);
  assert.match(resultsPage, /const isLoSide = isAdmin \|\| user\?\.portal === "lop";/);
  // Derived once in LapResults and threaded down; the editor does not re-derive it.
  assert.match(resultsPage, /<ResultEditor result=\{selected\} isAdmin=\{isAdmin\} isLoSide=\{isLoSide\}/);
});

test("the composer hides its LOA half from a plain LO and names the real recipient", () => {
  assert.match(thread, /isAdmin = false \}: \{ result: LapResult; isLoSide: boolean; isAdmin\?: boolean \}/);
  // An LO who is not an admin only replies; the LOA composer is for LOAs and admins.
  assert.match(thread, /const canPostLoaNote = isAdmin \|\| !isLoSide;/);
  assert.ok(at(thread, "{canPostLoaNote && (") < at(thread, 'data-testid="lap-note-loa"'));
  assert.ok(at(thread, 'data-testid="lap-note-loa"') < at(thread, "{isLoSide && ("));
  assert.ok(at(thread, "{isLoSide && (") < at(thread, 'data-testid="lap-lo-remarks"'));
  // The caption reads the Settings value instead of a hardcoded name.
  assert.match(thread, /lapRequest<\{ recipient: string \}>\("GET", "\/api\/lap\/notes-recipient"\)/);
  assert.match(thread, /data-testid="lap-note-recipients"/);
  assert.doesNotMatch(thread, /Chris/);
});

// ── who gets the email ──────────────────────────────────────────────────────
test("email_settings gains a notes recipient per portal, seeded with Chris exactly once", () => {
  const block = between(storage, "['lap_files_recipient', 'lop_files_recipient']", "['lap_send_welcome', 'lop_send_welcome']");
  assert.match(block, /\['lap_notes_recipient', "'credoble@westcapitallending\.com'"\]/);
  assert.match(block, /\['lop_notes_recipient', "''"\]/);
  assert.match(block, /ALTER TABLE email_settings ADD COLUMN \$\{col\} TEXT NOT NULL DEFAULT \$\{def\}/);
  // The seed is the column default, applied only when the column is first
  // added. An admin who blanks the address must not find Chris back after a
  // restart, so nothing in this block may write the value on boot.
  assert.match(block, /if \(!emailCols\.find\(c => c\.name === col\)\)/);
  // Checked over the whole of both server files, not just this block: a
  // per-boot UPDATE anywhere would put Chris back the same way.
  assert.doesNotMatch(storage, /UPDATE email_settings[^;]*notes_recipient/);
  assert.doesNotMatch(routes, /UPDATE email_settings[^;]*notes_recipient/);
});

test("the composer can ask the server who the notes recipient is", () => {
  const route = between(routes, 'app.get("/api/lap/notes-recipient"', 'app.get("/api/lap/results",');
  // Under /api/lap/ with the same guards as its neighbours, so a confined LAP
  // session can read it.
  assert.match(route, /requireAuth/);
  assert.match(route, /lapSessionContext\(req, res\)/);
  assert.match(route, /recipient: portalEmailIdentity\("lap"\)\.notesRecipient/);
});

test("the portal email settings read and write the notes recipient", () => {
  assert.match(routes, /notesRecipient: String\(s\[`\$\{portal\}_notes_recipient`\] \|\| ""\)\.trim\(\)/);
  const get = between(routes, 'app.get("/api/portal-email-settings/:portal"', 'app.patch("/api/portal-email-settings/:portal"');
  assert.match(get, /notesRecipient: id\.notesRecipient/);
  const patch = between(routes, 'app.patch("/api/portal-email-settings/:portal"', 'app.post("/api/portal-email-settings/:portal/test"');
  assert.match(patch, /notesRecipient: z\.union\(\[z\.string\(\)\.trim\(\)\.email\(\), z\.literal\(""\)\]\)\.optional\(\)/);
  assert.match(patch, /patch\[`\$\{portal\}NotesRecipient`\] = parsed\.data\.notesRecipient/);
  assert.match(patch, /\.strict\(\)/, "unknown keys are rejected, so a misspelt field cannot be silently dropped");
  assert.match(patch, /notesRecipient: id\.notesRecipient/);
});

test("admins can change the notes recipient from the portal email settings card", () => {
  assert.match(card, /data-testid="lap-notes-recipient"/);
  assert.match(card, /setNotesTo\(q\.data\.notesRecipient \?\? ""\)/);
  assert.match(card, /notesTo !== \(q\.data\.notesRecipient \?\? ""\)/, "editing the field marks the form dirty");
  assert.match(card, /notesRecipient: notesTo\.trim\(\)/);
  // Only LAP's LOA notes read this address: LOP hides the field and leaves it
  // out of the PATCH, so a LOP save cannot clobber a value it never showed.
  assert.match(card, /const hasNotesRecipient = product !== "lop";/);
  assert.ok(at(card, "{hasNotesRecipient && (") < at(card, 'data-testid="lap-notes-recipient"'));
  assert.match(card, /hasNotesRecipient && notesTo !== \(q\.data\.notesRecipient \?\? ""\)/);
  assert.match(card, /\.\.\.\(hasNotesRecipient \? \{ notesRecipient: notesTo\.trim\(\) \} : \{\}\)/);
});

// ── the send ────────────────────────────────────────────────────────────────
test("an LOA note emails the LO and the notes recipient, folded into one message per window", () => {
  // parseLoaNote joined it on 9 Sep so the email can render the sheet as a
  // sheet; the guard itself is the part that matters here.
  assert.match(routes, /import \{ isUntouchedLoaNote[^}]*\} from "@shared\/lap-note-template"/);
  const notify = between(routes, "function notifyLapPackageNote", 'app.get("/api/lap/results/:id/notes"');
  // The in-app bell rings for both kinds, before the email gate.
  assert.ok(at(notify, "storage.createNotification(") < at(notify, 'if (kind !== "loa") return;'));
  assert.match(notify, /const identity = portalEmailIdentity\("lap"\)/);
  assert.match(notify, /identity\.notesRecipient/);
  // A package with no LO still reaches the notes recipient; nobody at all means no email.
  assert.doesNotMatch(notify, /!pkg\?\.loanOfficerId\) return/);
  assert.match(notify, /if \(!to\.length\) return;/);
  assert.match(notify, /seen\.has\(addr\.toLowerCase\(\)\)/, "the LO and the recipient may be the same address");
  // The debounce folds notes together instead of dropping the earlier one.
  assert.match(notify, /pendingLapNoteBatches/);
  assert.match(notify, /EMAIL_SEND_DELAY_MS/);
  assert.match(notify, /cancelPendingEmails\(cancelKey\)/);
  assert.match(notify, /`lap-notes:\$\{orgId\}:\$\{packageId\}`/);
  assert.match(notify, /\(\$\{batch\.length\} notes\)/);
  // Which notes ride along is decided by whether a queued email was actually
  // cancelled (the pure rule in server/lap-note-batch.ts), not by note age:
  // the age filter dropped the first of 0s/29s/36s and re-sent a note that
  // landed 30-35s after a dispatch.
  assert.match(routes, /import \{ foldLapNoteBatch, type LapNoteBatchEntry \} from "\.\/lap-note-batch"/);
  assert.match(notify, /const cancelled = cancelPendingEmails\(cancelKey\)/);
  assert.match(notify, /foldLapNoteBatch\(pendingLapNoteBatches\.get\(cancelKey\), cancelled, /);
  assert.doesNotMatch(notify, /EMAIL_SEND_DELAY_MS \+ 5_000/);
  assert.ok(at(notify, "const cancelled = cancelPendingEmails(cancelKey)") < at(notify, "foldLapNoteBatch("));
  assert.ok(at(notify, "foldLapNoteBatch(") < at(notify, "void sendEmail("));
  // The entry is forgotten once its email has had time to go out, by a timer
  // that must not hold the process open and must not evict a newer batch.
  assert.ok(at(notify, "void sendEmail(") < at(notify, "const evict = setTimeout("));
  assert.match(notify, /if \(pendingLapNoteBatches\.get\(cancelKey\) === batch\) pendingLapNoteBatches\.delete\(cancelKey\)/);
  assert.match(notify, /\(evict as any\)\.unref\(\)/);
  // The batch map outlives the call: declared beside the function, not inside it.
  assert.match(routes, /const pendingLapNoteBatches = new Map<string, LapNoteBatchEntry\[\]>\(\)/);
  assert.ok(at(routes, "const pendingLapNoteBatches = new Map") < at(routes, "function notifyLapPackageNote"));
  // The send is fire-and-forget; a rejection must be logged, never left unhandled.
  assert.match(notify, /\.catch\(/);
  assert.match(notify, /\.catch\(\(err\) => console\.error\("\[lap-notes\] email failed", err\)\)/);
  assert.match(notify, /\/#\/lap\/results\/\$\{packageId\}/, "the email links straight to the package");
});

test("the server refuses a bare-template LOA note before anything is written", () => {
  const post = between(routes, 'app.post("/api/lap/results/:id/notes"', 'app.post("/api/lap/results",');
  assert.match(post, /if \(isUntouchedLoaNote\(body\)\) return res\.status\(400\)/);
  assert.ok(at(post, "isUntouchedLoaNote(body)") < at(post, "storageExtra.addLapPackageNote("));
  // The guard lives in the LOA branch, after the LO sections are assembled:
  // remarks are never held to the template.
  assert.ok(at(post, '["Opportunities"') < at(post, "isUntouchedLoaNote(body)"));
});

// ── the real deal sheet (Ethan, 9 Sep 2026) ────────────────────────────────

test("the template is Chris's actual fields, in the order he sent them", () => {
  // The old list was an explicit placeholder. Order is deliberate: value →
  // loan → pricing → credit → product → outcome → paperwork → notes, which is
  // how a deal is read and what the LOAs scan line by line.
  assert.equal(LOA_NOTE_TEMPLATE_LINES[0], "Estimated Value: ");
  assert.equal(LOA_NOTE_TEMPLATE_LINES[LOA_NOTE_TEMPLATE_LINES.length - 1], "Other Important Notes: ");
  for (const label of [
    "Proposed Loan Amount", "Current Rate", "Proposed Rate", "Origination Points",
    "Discount Points", "Revenue Estimate", "FICO Est", "FICO Actual",
    "Credit Pull (Y/N)", "Hard/Soft", "Total Proposed Comp", "Appraisal Needed (Y/N)",
    "1st MTG or HELOC", "Pitched Deal (Y/N)", "Deal Accepted Terms",
    "Deal Not Accepted Objections", "How Many Properties Do They Own",
    "Completed App in LendingPad (Y/N)", "Full 1003 (Y/N)", "Partial 1003 (Y/N)",
  ]) {
    assert.ok(LOA_NOTE_LABELS.includes(label), `${label} must be on the sheet`);
  }
  assert.equal(LOA_NOTE_LABELS.length, LOA_NOTE_TEMPLATE_LINES.length);
  // The placeholder wording must be gone.
  assert.equal(LOA_NOTE_LABELS.includes("Notes for Chris"), false);
});

test("TBD and N/A count as filled in, because they are real answers", () => {
  // A rate that is not priced yet and a comp figure that does not apply are
  // both states somebody deliberately recorded, not blanks.
  assert.equal(isUntouchedLoaNote(LOA_NOTE_TEMPLATE.replace("Proposed Rate: ", "Proposed Rate: TBD")), false);
  assert.equal(isUntouchedLoaNote(LOA_NOTE_TEMPLATE.replace("Total Proposed Comp: ", "Total Proposed Comp: N/A")), false);
});

test("a filled sheet parses back into fields, keeping what was written freehand", () => {
  // Ethan's real example, trimmed. The pasted email chain underneath must
  // survive — losing the part somebody wrote in their own words would defeat
  // the point of sending it.
  const note = [
    "Estimated Value: $860k",
    "Proposed Loan Amount: $660k",
    "Current Rate: 2.50%",
    "Proposed Rate: TBD",
    "FICO Est: 710",
    "FICO Actual: 776",
    "Credit Pull (Y/N): Y",
    "Hard/Soft: Soft",
    "1st MTG or HELOC: Cash out Refi or HELOC",
    "Other Important Notes: Spoke to Xee about a cash out or heloc maxing out his LTV.",
    "He owes $500k on his first paying $2400/monthly.",
    "",
    "From: Erik Wenning <ewenning@westcapitallending.com>",
  ].join("\n");
  const { fields, trailing } = parseLoaNote(note);
  const get = (l: string) => fields.find((f) => f.label === l)?.value;
  assert.equal(get("Estimated Value"), "$860k");
  assert.equal(get("Proposed Rate"), "TBD");
  assert.equal(get("FICO Actual"), "776");
  assert.equal(get("1st MTG or HELOC"), "Cash out Refi or HELOC");
  // A wrapped continuation belongs to the field above it, not to nowhere.
  assert.match(get("Other Important Notes")!, /maxing out his LTV\. He owes \$500k/);
  // The pasted chain came after the last label, so it rides along on that field
  // rather than being dropped.
  assert.match(get("Other Important Notes")!, /From: Erik Wenning/);
  assert.equal(trailing, "", "nothing before the first label in this example");
});

test("text before any label is kept as trailing, not thrown away", () => {
  const { fields, trailing } = parseLoaNote("Heads up — rush file\nEstimated Value: $860k");
  assert.equal(trailing, "Heads up — rush file");
  assert.equal(fields[0].value, "$860k");
  // Junk in, empty out, never a throw.
  assert.deepEqual(parseLoaNote(null), { fields: [], trailing: "" });
  assert.deepEqual(parseLoaNote(undefined).fields, []);
});

// ── the Send email button (Ethan, 9 Sep 2026) ──────────────────────────────

test("a file can be emailed on demand, with its documents attached", () => {
  const fn = routes.slice(
    routes.indexOf('app.post("/api/lap/results/:id/email"'),
    routes.indexOf('app.get("/api/lap/results"'),
  );
  assert.notEqual(fn.length, 0, "the route must exist");
  // Same builder as the automatic path, so the attachments and the layout
  // cannot drift into two versions.
  assert.match(fn, /emailLapSubmission\(ctx\.orgId, packageId, "lap", \{ to, onDone: finish \}\)/);
  assert.match(routes, /attachments: attach\s*$/m);
});

test("it addresses the pair that actually receives LAP mail", () => {
  // The automatic path uses lap_files_recipient, which is EMPTY on production —
  // relying on it would send the button's email to nobody.
  const fn = routes.slice(
    routes.indexOf('app.post("/api/lap/results/:id/email"'),
    routes.indexOf('app.get("/api/lap/results"'),
  );
  assert.match(fn, /pkg\.loanOfficerEmail \?\? "", identity\.notesRecipient, identity\.filesRecipient/);
  assert.match(fn, /if \(!to\.length\)/, "sending to nobody must be refused, not attempted");
  assert.match(fn, /No recipient is configured/);
  assert.match(storage, /loanOfficerEmail:/, "the LO's address has to reach the route");
});

test("it refuses the two sends that would waste the LO's attention", () => {
  const fn = routes.slice(
    routes.indexOf('app.post("/api/lap/results/:id/email"'),
    routes.indexOf('app.get("/api/lap/results"'),
  );
  // Nothing to attach.
  assert.match(fn, /no documents on this file to send yet/i);
  // A blank deal sheet is worse than silence: it says a deal was worked and
  // then shows twenty-two empty lines.
  assert.match(fn, /isUntouchedLoaNote\(pkg\.notes\)/);
  assert.match(fn, /Fill in the deal sheet before sending/);
});

test("the person pressing it is told what actually happened", () => {
  const fn = routes.slice(
    routes.indexOf('app.post("/api/lap/results/:id/email"'),
    routes.indexOf('app.get("/api/lap/results"'),
  );
  // The builder is fire-and-forget; a manual send must not report a hopeful
  // success it has not confirmed.
  assert.match(fn, /onDone: finish/);
  assert.match(fn, /res\.status\(502\)/, "a provider failure is not a success");
  assert.match(fn, /did not answer in time/, "and a hung provider still answers the caller");
  assert.match(fn, /if \(answered\) return;/, "the timeout must not double-answer");
  // Sending somebody's file out of the building is worth being able to look up.
  assert.match(fn, /entityType: "lap_result_email"/);
});

test("the deal sheet is emailed as a sheet, and free text survives", () => {
  assert.match(routes, /function dealSheetHtml\(/);
  assert.match(routes, /\$\{dealSheetHtml\(pkg\.notes, esc\)\}/);
  const fn = routes.slice(routes.indexOf("function dealSheetHtml("), routes.indexOf("function emailLapSubmission("));
  assert.match(fn, /parseLoaNote\(body\)/);
  assert.match(fn, /Deal sheet/);
  // A note that is not the sheet at all must not be lost to the parser.
  assert.match(fn, /if \(!filled\.length\)/);
  assert.match(fn, /trailing \?/, "the pasted chain under the sheet is kept");
});

test("the button sits on the file and asks before it sends", () => {
  const page = read("client/src/pages/lap-results.tsx");
  assert.match(page, /function SendFileEmail\(/);
  assert.match(page, /lap-send-email-\$\{result\.id\}/);
  assert.match(page, /Send email/);
  // It leaves the building and cannot be recalled.
  assert.match(page, /const \[confirming, setConfirming\] = useState\(false\)/);
  assert.match(page, /Send to the LO\?/);
  // The server's specific refusals must reach the person, not be flattened.
  assert.match(page, /description: String\(e\?\.message \?\? e\)/);
});

// ── the deal sheet is on the file, in the open (Ethan, 9 Sep 2026) ─────────

test("the sheet is its own section, not hidden behind Edit details", () => {
  const page = read("client/src/pages/lap-results.tsx");
  assert.match(page, /function DealSheet\(/);
  assert.match(page, /<DealSheet result=\{result\} \/>/);
  assert.match(page, /lap-deal-sheet-\$\{result\.id\}/);
  // It must sit OUTSIDE the editing branch — the whole complaint was that the
  // one field the handoff depends on took a button press to discover.
  const card = page.slice(page.indexOf("<DealSheet result={result} />"));
  assert.ok(card.length > 0);
  assert.ok(page.indexOf("<DealSheet result={result} />") > page.indexOf("editing ? ("),
    "the sheet renders after the edit form closes, not inside it");
  // And the old hidden copies are gone, so one field has one door. The label
  // survives only inside the DealSheet header comment, which explains why.
  const jsx = page.slice(page.indexOf("function DealSheet("));
  assert.doesNotMatch(jsx, /<Label[^>]*>Operational notes/);
  assert.doesNotMatch(page, /Add context another team member needs/);
  // Creating a file names the same field the same way, rather than inventing a
  // second name for it.
  assert.match(page, /htmlFor="lap-create-notes">Deal sheet/);
});

test("the sheet writes the field the email actually sends", () => {
  // THE BUG THIS FIXES: the template was pre-filled only in the notes thread,
  // which posts to lap_package_notes — a different table from the p.notes the
  // email reads. An LOA could fill all twenty-two fields and Send would still
  // refuse, correctly, because the field it checks was untouched.
  const page = read("client/src/pages/lap-results.tsx");
  const fn = page.slice(page.indexOf("function DealSheet("), page.indexOf("function SendFileEmail("));
  assert.match(fn, /apiRequest\("PATCH", `\/api\/lap\/results\/\$\{result\.id\}`/);
  assert.match(fn, /notes: draft\.trim\(\) \|\| null/);
  // Only the sheet goes in the patch: re-sending borrower/date/LO from a card
  // that has been open a while would clobber somebody else's edit.
  assert.doesNotMatch(fn, /borrowerName: result\.borrowerName/);
  // The email reads that same field.
  assert.match(storage, /notes: String\(pkg\.notes \?\? ""\)/);
});

test("an empty sheet cannot be saved, for the reason it cannot be emailed", () => {
  const page = read("client/src/pages/lap-results.tsx");
  const fn = page.slice(page.indexOf("function DealSheet("), page.indexOf("function SendFileEmail("));
  assert.match(fn, /disabled=\{save\.isPending \|\| isUntouchedLoaNote\(draft\)\}/);
  assert.match(fn, /an empty sheet cannot be emailed/i);
  // The template is OFFERED, not written: an untouched file reads as "not
  // started" rather than as a sheet somebody abandoned.
  assert.match(fn, /const startingDraft = started \? saved : stamp/);
  assert.match(fn, /Start the sheet/);
});

test("the auto-created stamp is provenance, not a deal sheet", () => {
  // Every package born from a C3 transfer carries this sentence in the very
  // field the email sends. It is not blank, so on the old test all 1,564
  // packages in production read as "filled in": the card offered Edit sheet
  // over a line nobody wrote, and the Send guard would have passed a file
  // with no sheet at all straight to the loan officer.
  const stamp = "Created automatically from Elleine Asuncion's C3 transfer on 2026-09-09. Documents are optional and may be added whenever available.";
  assert.equal(isUntouchedLoaNote(stamp), true);
  assert.equal(isUntouchedLoaNote(`${stamp}
${LOA_NOTE_TEMPLATE}`), true, "stamp plus bare template is still nothing");
  // One real answer anywhere makes it a sheet again.
  assert.equal(isUntouchedLoaNote(`${stamp}
FICO Est: 704`), false);
  // A sentence a person wrote is never mistaken for the stamp.
  assert.equal(isUntouchedLoaNote("Created automatically from the borrower's own notes"), false);
  assert.equal(isUntouchedLoaNote("Spoke to him about the C3 transfer on 2026-09-09."), false);
});

test("starting a sheet keeps the stamp instead of overwriting it", () => {
  const page = read("client/src/pages/lap-results.tsx");
  const fn = page.slice(page.indexOf("function DealSheet("), page.indexOf("function SendFileEmail("));
  assert.match(fn, /const stamp = started \? "" : saved\.trim\(\)/);
  assert.match(fn, /\$\{LOA_NOTE_TEMPLATE\}\\n\\n\$\{stamp\}/, "the stamp moves below the fields");
});

test("a filled sheet is readable at a glance, and free text survives", () => {
  const page = read("client/src/pages/lap-results.tsx");
  const fn = page.slice(page.indexOf("function DealSheet("), page.indexOf("function SendFileEmail("));
  assert.match(fn, /parseLoaNote\(saved\)/);
  assert.match(fn, /filled\.length\} of \$\{LOA_NOTE_LABELS\.length\}/, "says how much is done");
  assert.match(fn, /\{trailing &&/, "the pasted chain under the sheet is shown, not dropped");
});
