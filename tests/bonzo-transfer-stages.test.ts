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
  assert.match(sync, /reassignProspect\(prospectId, bonzoUserId\)/);
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
  assert.match(sync, /const shouldMove = !advanced && !alreadyThere/);
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
  // /pipelines does not list every seat's pipeline — Chris's personal pipeline
  // (13553) is absent even though his prospects prove its HOT TRANSFER stage
  // (428447) exists. The seeded id sidesteps the listing entirely.
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
