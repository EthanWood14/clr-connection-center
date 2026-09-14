import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { appointmentNoteMarker, notesToBonzoHtml, transferNoteMarker } from "../server/bonzo-notes";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8").replace(/\r\n/g, "\n");

/**
 * The bug: an appointment's Bonzo note carried only the free-text "notes"
 * line. The capture block (conversation_notes — credit, address, value,
 * balance, cash needed, income) never left C3. Mike Kelly, 2026-09-14: Bonzo
 * got "asked about the rate on the HELOC"; C3 held fifteen fields. The
 * transfer note had already been fixed for this (Joy Crosett); this pins the
 * appointment note to the same rule.
 */

function appointmentSync(): string {
  const start = routes.indexOf("async function syncAppointmentToBonzo(");
  const end = routes.indexOf("async function syncAppointmentNotesToBonzo(");
  assert.ok(start > 0 && end > start);
  return routes.slice(start, end);
}

test("the appointment note is built from BOTH halves of the write-up, as real HTML", () => {
  const sync = appointmentSync();
  assert.match(sync, /const halves = \[String\(o\.conversation_notes \?\? ""\)\.trim\(\), String\(o\.notes \?\? ""\)\.trim\(\)\]\.filter\(Boolean\);/);
  assert.match(sync, /notesToBonzoHtml\(\[\.\.\.halves, mismatch\.trim\(\)\]\.filter\(Boolean\)\.join\("\\n\\n"\)/);
  // The old single-line note must be gone.
  assert.doesNotMatch(sync, /\(o\.notes \? `\\n\$\{o\.notes\}` : ""\) \+ mismatch/);
});

test("it carries a marker and checks for it first, so a re-sync never posts twice", () => {
  const sync = appointmentSync();
  assert.match(sync, /const marker = appointmentNoteMarker\(outcomeId\);/);
  assert.match(sync, /\(await getProspectNotes\(prospect\.id\)\)\.some\(\(n\) => n\.content\.includes\(marker\)\)/);
  assert.match(sync, /subtitle: `Logged in C3 · \$\{o\.date \?\? todayIso\(\)\} · \$\{marker\}`/);
});

test("the marker names the outcome and cannot collide with a transfer's", () => {
  assert.equal(appointmentNoteMarker(4451), "C3 appointment #4451");
  assert.notEqual(appointmentNoteMarker(4451), transferNoteMarker(4451));
});

test("Mike Kelly's write-up renders every field on its own line under the appointment title", () => {
  const capture = "Owns Home: Yes\nCredit Score: 620-720\nProperty Address: 57 Tall Oaks Court\nCash Needed / Take Out: 50k or so\nEstimated Home Value: 720k";
  const html = notesToBonzoHtml([capture, "asked about the rate on the HELOC"].join("\n\n"), {
    title: "📅 Appointment scheduled for 2026-09-14 at 12:30 pm — set in C3 by Ethan Wood (LO: unassigned)",
    subtitle: `Logged in C3 · 2026-09-14 · ${appointmentNoteMarker(4451)}`,
  });
  assert.match(html, /<strong>Property Address:<\/strong> 57 Tall Oaks Court<br \/>/);
  assert.match(html, /<strong>Cash Needed \/ Take Out:<\/strong> 50k or so/);
  assert.match(html, /<p>asked about the rate on the HELOC<\/p>/);
  assert.match(html, /C3 appointment #4451/);
  assert.ok(!html.includes("\n"), "no raw newlines — Bonzo would collapse them");
});
