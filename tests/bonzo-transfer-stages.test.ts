import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const bonzo = readFileSync(join(root, "server/bonzo.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const sync = routes.slice(
  routes.indexOf("async function syncTransferToBonzo"),
  routes.indexOf(`app.post("/api/bonzo/test-transfer"`),
);

test("Chris is detected by surname, not a prefix that never matched", () => {
  // The C3 record is "Christopher Redoble"; /chris\s+redoble/ requires a space
  // after "chris" and so never matched it — his transfers were silently getting
  // the plain CLR suffix.
  assert.ok(!/chris\s\+redoble/.test(sync), "the broken prefix pattern must be gone");
  assert.match(sync, /\bredoble\b/, "surname detection");
  assert.equal(/\bredoble\b/i.test("Christopher Redoble"), true);
  assert.equal(/\bredoble\b/i.test("Chris Redoble"), true);
  assert.equal(/chris\s+redoble/i.test("Christopher Redoble"), false, "proof the old pattern was dead");
});

test("Chris's suffix uses the capital-I separator; others keep the CLR form", () => {
  assert.match(sync, /`\(\$\{loaFirst\} I \$\{clrFirst\}\)`/);
  assert.match(sync, /`\(CLR \$\{clrFirst\}\)`/);
  assert.ok(!/`\(\$\{loaFirst\} l \$\{clrFirst\}\)`/.test(routes), "the lowercase-l form must be gone everywhere");
});

test("transfers reassign the prospect to the C3 transferee", () => {
  assert.match(sync, /reassignProspect\(prospectId, bonzoUserId, bonzoUserEmail\)/);
  assert.match(sync, /snap\.assignedTo !== bonzoUserId/, "no-op when already assigned right");
  // The stage decision must see the post-reassignment pipeline, not the old one.
  assert.ok(
    sync.indexOf("reassignProspect(") < sync.indexOf("const wantStageRe"),
    "reassign before deciding the stage",
  );
  assert.match(sync, /snap = \(await getProspectSnapshot\(prospectId\)\) \?\? snap/, "re-snapshot after reassigning");
});

test("an LO without a stored id can be learned from a prospect on their seat", () => {
  assert.match(sync, /SET bonzo_user_id=\? WHERE id=\? AND bonzo_user_id IS NULL/,
    "learning must never overwrite a seeded id");
  assert.match(sync, /nameMatchesLo\(snap\.assignedUserName\)/, "gated on the display name matching the LO");
  assert.match(storage, /ALTER TABLE loan_officers ADD COLUMN bonzo_user_id INTEGER/);
});

test("Chris goes to Hot Transfers, everyone else to Responded", () => {
  assert.match(sync, /isChris \? HOT_TRANSFERS_STAGE_RE : RESPONDED_STAGE_RE/);
  assert.match(sync, /isChris \? CLR_MOVE_HOT_TAG : CLR_MOVE_RESPONDED_TAG/);
  assert.match(routes, /CLR_MOVE_HOT_TAG = "clrmovehottransfers"/);
  const hotRe = /hot\s*transfer/i;
  assert.equal(hotRe.test("Hot Transfers"), true);
  assert.equal(hotRe.test("HOT TRANSFER"), true);
  assert.equal(hotRe.test("Responded Hot Lead"), false, "a hot LEAD stage is not a hot TRANSFER stage");
});

test("the direct move is attempted first, the tag only as fallback", () => {
  assert.match(sync, /stages\.find\(\(s\) => wantStageRe\.test\(s\.name\)\)/, "resolve the stage by name in the prospect's pipeline");
  assert.match(sync, /moveProspectStage\(prospectId, target\.id\)/);
  assert.match(sync, /moved === "tagged" && !has\(moveTag\)/, "the tag lands only when no stage resolved");
});

test("advanced deals are still never dragged backwards", () => {
  assert.match(sync, /const advanced = isAdvancedStage\(snap\.stageName, stages, snap\.stageId\)/);
  assert.match(sync, /const shouldMove = .*!advanced && !disqualified && !alreadyThere/);
  assert.match(sync, /App Taken→Funded deals are not moved back/);
});

test("both new Bonzo writes verify by read-back", () => {
  // BrokerBot's hard-won rule: a 2xx from this API does not prove persistence.
  const re = bonzo.slice(bonzo.indexOf("export async function reassignProspect"), bonzo.indexOf("export async function moveProspectStage"));
  assert.match(re, /getProspectAssignee\(prospectId\)/);
  assert.match(re, /verified: now === bonzoUserId/);
  const mv = bonzo.slice(bonzo.indexOf("export async function moveProspectStage"));
  assert.match(mv, /pipeline-stage\/\$\{stageId\}/, "the one endpoint the 2026-07-21 probe missed");
  assert.match(mv.slice(0, 800), /verified: snap\?\.stageId === Number\(stageId\)/);
});

test("an explicit per-LO stage id beats name resolution", () => {
  // Pins the destination even if the stage is renamed. Chris's target is stage
  // 428447 "HOT TRANSFER" on pipeline 13553 "HOT LEADS & APPS" — resolvable by
  // name once the listing is paged (it sits on page 3), but the id is exact.
  assert.match(readFileSync(join(root, "server/storage.ts"), "utf8"),
    /ALTER TABLE loan_officers ADD COLUMN bonzo_transfer_stage_id INTEGER/);
  const mv = sync.slice(sync.indexOf('let moved = "none"'), sync.indexOf("// ── 3. Rename"));
  assert.match(mv, /bonzoTransferStageId \?\? lo\?\.bonzo_transfer_stage_id/);
  assert.ok(
    mv.indexOf("overrideStageId") < mv.indexOf("stages.find"),
    "the explicit id is consulted before name matching",
  );
  assert.match(mv, /snap\.stageId !== overrideStageId/, "already-in-target must not re-move");
  assert.match(mv, /already_in_target/);
});

test("cross-team reassignment falls back to the email endpoint", () => {
  // Verified live 2026-08-14: PUT assigned_to 422s across teams ("This person
  // doesn't belong to your team") on every token, and the 200s for other field
  // names were Bonzo silently ignoring unknown keys. The working route is
  // POST /prospects/{id}/reassign { user_email } under the org token — it moves
  // the business entity with the assignee, which also resets the pipeline.
  const fn = bonzo.slice(bonzo.indexOf("export async function reassignProspect"), bonzo.indexOf("export async function getProspectNotes"));
  assert.match(fn, /\/reassign`/);
  assert.match(fn, /user_email: userEmail/);
  assert.match(fn, /orgToken\(\)/, "the cross-team call runs under the org token");
  assert.ok(fn.indexOf("assigned_to: bonzoUserId") < fn.indexOf("/reassign`"),
    "same-team PUT stays the fast path");
  assert.match(fn, /now === bonzoUserId/, "both paths verify by read-back");
  // The sync learns the email the same way it learns the id.
  assert.match(sync, /SET bonzo_user_email=\? WHERE id=\? AND bonzo_user_email IS NULL/);
  assert.match(sync, /reassignProspect\(prospectId, bonzoUserId, bonzoUserEmail\)/);
});

test("transfer notes post to Bonzo once, never twice", () => {
  assert.match(sync, /getProspectNotes\(prospectId\)/);
  // Two checks: a formatting-independent marker for our own re-sync, and a
  // text comparison for a CLR who pasted the same content by hand. See
  // tests/bonzo-notes.test.ts for the rendering itself.
  assert.match(sync, /n\.content\.includes\(marker\)/);
  assert.match(sync, /notePlainText\(n\.content\)\.includes\(plain\)/,
    "a CLR's manual paste of the same text must suppress the auto-note");
  assert.match(sync, /CLR Transfer — /);
  assert.match(sync, /duplicate_skipped/);
  assert.match(sync, /already_posted/);
  // Empty conversation notes post nothing.
  assert.match(sync, /String\(o\.conversation_notes \?\? ""\)\.trim\(\),/);
});

test("stage lookup pages through every pipeline, not just the first 25", () => {
  // The account has 402 pipelines; /pipelines defaults to 25 per page (17
  // pages). Reading only page one hid 94% of them, so stage resolution found
  // nothing and transfers fell back to the tag. Verified live 2026-08-14: the
  // target pipelines for stuck transfers sat on pages 3 and 4.
  const fn = bonzo.slice(bonzo.indexOf("export async function getPipelineStages"), bonzo.indexOf("// PUT /prospects/{id}"));
  assert.match(fn, /per_page=100&page=\$\{page\}/, "must request large pages explicitly");
  assert.match(fn, /meta\?\.last_page/, "must follow pagination to the last page");
  assert.match(fn, /for \(let page = 1/, "must loop, not fetch once");
  assert.ok(!/req\("GET", `\/pipelines`\)/.test(fn), "the unpaginated single fetch must be gone");
  // Returns as soon as the pipeline is found — no need to read all 17 pages.
  assert.ok(fn.indexOf("if (p) {") < fn.indexOf("lastPage"), "early return before the page-advance check");
});

test("a disqualified lead is never revived into Responded", () => {
  // A CLR logging a transfer does not undo the LO's "does not qualify"
  // decision. This is separate from the advanced-deal guard: that protects
  // deals too far along, this protects deals deliberately ended.
  // Built from the SHIPPED pattern, not a copy of it — a copy silently stops
  // testing the real thing (and hid a mangled \b escape that would have shipped
  // a guard matching literal backspace characters).
  const m = /const DISQUALIFIED_STAGE_RE = \/(.+?)\/i;/.exec(routes);
  assert.ok(m, "DISQUALIFIED_STAGE_RE must be a plain /…/i literal");
  const re = new RegExp(m![1], "i");
  for (const name of ["DNQ", "DNQ - DEAD", "dnq", "Does Not Qualify", "Dead Lead",
                      "DNC", "Do Not Contact", "Opted Out", "No Text (STOP or Bad Number)"]) {
    assert.ok(re.test(name), `must be protected: ${name}`);
  }
  // …and stages that merely sound similar must still move normally.
  for (const name of ["Responded", "Follow-Up", "No Contact", "Deadline Review", "New Leads", "Nurture"]) {
    assert.ok(!re.test(name), `must NOT be blocked: ${name}`);
  }
  assert.match(routes, /const DISQUALIFIED_STAGE_RE = /);
  assert.match(sync, /const shouldMove = .*!advanced && !disqualified && !alreadyThere;/);
  // It blocks moves; it must never be used to pick a destination.
  const target = sync.slice(sync.indexOf('let moved = "none"'), sync.indexOf("// ── 3. Rename"));
  assert.ok(!/DISQUALIFIED_STAGE_RE/.test(target), "never a move target, only a blocker");
  assert.match(sync, /disqualified are never revived|disqualified leads are never revived/,
    "the LO gets a note explaining why the stage stands");
});

test("a LAP-covered transfer still leaves a note in Bonzo", () => {
  // The guard exists so C3 does not fight LAP over who owns the borrower's
  // workflow. Skipping the NOTE as well meant a transfer to any LO with an
  // active assistant left no trace in Bonzo at all -- Joy Crosett to
  // Christopher Redoble, 1 Sep 2026. A note changes no workflow state.
  assert.match(sync, /const lapCovered = !!\(o\.lo_id && storageExtra\.hasAvailableLapAssistant/);
  // It must NOT be an early return any more.
  const gate = sync.slice(sync.indexOf("lapCovered"), sync.indexOf("const clr ="));
  assert.doesNotMatch(gate, /\breturn;/, "LAP coverage must not abort the sync");
});

test("LAP coverage suppresses every write that mutates the borrower", () => {
  // Reassign, stage move and rename are the three that would create a second
  // destination for the same transfer. All three stay off.
  assert.match(sync, /if \(lapCovered\) \{\s*\r?\n\s*reassigned = "skipped_lap";/);
  assert.match(sync, /const shouldMove = !lapCovered &&/);
  assert.match(sync, /if \(lapCovered\) \{[\s\S]{0,200}?for \(const k of Object\.keys\(updates\)\) delete updates\[k\];/);
});

test("the conversation notes are what actually reach the LO", () => {
  // The write-up is the point of the note; posting only "a transfer happened"
  // would not have answered the complaint.
  assert.match(sync, /String\(o\.conversation_notes \?\? ""\)\.trim\(\),/);
  // Bonzo renders notes as HTML, so newlines have to be real markup or the
  // whole write-up collapses into one run-on line.
  assert.match(sync, /notesToBonzoHtml\(convo/);
  // And it is deduped, so a re-run cannot post it twice.
  assert.match(sync, /transferNoteMarker\(outcomeId\)/);
});

test("a LAP transfer says why nothing else moved", () => {
  assert.match(sync, /if \(lapCovered \|\| advanced \|\| disqualified\)/);
  assert.match(sync, /works through the LO Assistant Portal/);
});

test("the log says which mode ran", () => {
  // Silent skipping is how this went unnoticed; the mode has to be readable.
  assert.match(sync, /mode=\$\{lapCovered \? "notes_only_lap" : "full"\}/);
});

test("both halves of the write-up reach Bonzo, not just the structured one", () => {
  // A CLR who types the substance into Other Notes instead of the capture
  // fields must not have it silently dropped. Joy Crosett's whole file was in
  // Other Notes; her capture block was one line naming the lead source.
  assert.match(sync, /String\(o\.conversation_notes \?\? ""\)\.trim\(\),/);
  assert.match(sync, /String\(o\.notes \?\? ""\)\.trim\(\),/);
  assert.match(sync, /const halves = \[/);
  // Each half is checked against the prospect separately, so a CLR who
  // pasted one of them by hand does not get it posted a second time.
  assert.match(sync, /const fresh = already \? \[\] : halves\.filter/);
  assert.match(sync, /const convo = fresh\.join/);
});
