import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isUntouchedLoaNote, loaNoteHasContent, LOA_NOTE_TEMPLATE } from "../shared/lap-note-template";
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
  const filled = LOA_NOTE_TEMPLATE.replace("Credit score: ", "Credit score: 720");
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
  // "Borrower:" without the trailing space is the same bare label.
  assert.equal(isUntouchedLoaNote("Borrower:"), true);
  assert.equal(isUntouchedLoaNote(lines.map((line) => line.trimEnd()).join("\n")), true);
  // One free-text line beside a bare label is content.
  const withText = "Borrower: \nCalled the borrower, wants a HELOC";
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
  assert.match(routes, /import \{ isUntouchedLoaNote \} from "@shared\/lap-note-template"/);
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
