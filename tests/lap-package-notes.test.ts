import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/lap-results.tsx"), "utf8");

test("package notes are durable, org-scoped, and follow merges", () => {
  assert.match(storage, /CREATE TABLE IF NOT EXISTS lap_package_notes/);
  assert.match(storage, /FOREIGN KEY \(package_id\) REFERENCES lap_result_packages\(id\) ON DELETE CASCADE/);
  assert.match(storage, /idx_lap_package_notes_package/);
  // Merging two packages must carry the thread to the surviving package.
  assert.match(storage, /UPDATE lap_package_notes SET package_id=\? WHERE org_id=\? AND package_id=\?/);
  const add = storage.slice(storage.indexOf("export function addLapPackageNote"), storage.indexOf("export function linkLapTransferToPackage"));
  assert.match(add, /assertLapActorInOrg\(orgId, actorUserId\)/);
  assert.match(add, /LapResultStorageError\(404/);
  assert.match(add, /writeLapResultEvent\(/);
});

test("only the LO side can post remarks; LOA notes carry directory attribution", () => {
  const post = routes.slice(routes.indexOf('app.post("/api/lap/results/:id/notes"'), routes.indexOf('app.post("/api/lap/results",'));
  // Visibility guard keeps package ids unenumerable, matching every other LAP route.
  assert.match(post, /lapPackageVisible\(ctx, packageId\)/);
  assert.match(post, /ctx\.isAdmin \|\| portal === "lop"/);
  assert.match(post, /Only the loan officer \(or an admin\) can post remarks\./);
  // Remarks / Notes / Opportunities compose the LO reply.
  assert.match(post, /\["Remarks", String\(req\.body\?\.remarks/);
  assert.match(post, /\["Opportunities", String\(req\.body\?\.opportunities/);
  // Shared-gate sessions attribute LOA notes from the LOA directory.
  assert.match(post, /getLoanOfficerAssistant\(loaId\)/);
  const get = routes.slice(routes.indexOf('app.get("/api/lap/results/:id/notes"'), routes.indexOf('app.post("/api/lap/results/:id/notes"'));
  assert.match(get, /lapPackageVisible\(ctx, packageId\)/);
});

test("an LOA note rings the portal bell and emails the loan officer, debounced", () => {
  const notify = routes.slice(routes.indexOf("function notifyLapPackageNote"), routes.indexOf('app.get("/api/lap/results/:id/notes"'));
  assert.match(notify, /type: "lap_result"/);
  assert.match(notify, /portal: "lap"/);
  assert.match(notify, /lapSharedUserId\(orgId\)/);
  // Email goes to the package's LO — for LOA notes only, never remarks echoed back.
  assert.match(notify, /if \(kind !== "loa" \|\| !pkg\?\.loanOfficerId\) return;/);
  assert.match(notify, /getLoanOfficerById\(Number\(pkg\.loanOfficerId\)\)/);
  assert.match(notify, /cancelPendingEmails\(cancelKey\)/);
  assert.match(notify, /`lap-notes:\$\{orgId\}:\$\{packageId\}`/);
  // Note text is escaped before it becomes email HTML.
  assert.match(notify, /escapeHtml\(noteBody\)/);
});

test("the package view shows the thread with both composers", () => {
  assert.match(page, /data-testid="lap-package-notes"/);
  assert.match(page, /LOA_NOTE_TEMPLATE/);
  assert.match(page, /data-testid="lap-note-loa"/, "the LOA picks their name from the directory");
  assert.match(page, /data-testid="lap-lo-remarks"/);
  assert.match(page, /PackageNotesThread result=\{result\} isLoSide=\{isAdmin\}/);
});
