import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { notesToBonzoHtml, escapeHtml, notePlainText, transferNoteMarker } from "../server/bonzo-notes";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const bonzo = readFileSync(join(root, "server/bonzo.ts"), "utf8");

const CARD = [
  "Lead Source: Retail", "",
  "Owns Home: Yes",
  "Bankruptcy Last 6 Months: No",
  "Investment/2nd Home: Yes — give to LOA Justin, Mateo, or John",
  "Credit Over 500 (est): Yes (600)", "",
  "Address: 4417 Cedar Ridge Rd",
  "Goal: Debt consolidation",
].join("\n");

test("newlines become real markup, because Bonzo renders notes as HTML", () => {
  // The original bug: "\n" collapsed to a space and the whole card arrived as
  // one unreadable run-on paragraph.
  const html = notesToBonzoHtml(CARD);
  assert.ok(!html.includes("\n<"), "no raw newline should be load-bearing");
  assert.match(html, /<p>/);
  assert.match(html, /<br \/>/);
  // Each field ends up on its own line.
  const lines = html.split(/<br \/>|<\/p>/).filter(x => /\w/.test(x));
  assert.ok(lines.length >= 7, `expected each field on its own line, got ${lines.length}`);
  // Labels are emphasized so the eye can run down them.
  assert.match(html, /<strong>Address:<\/strong> 4417 Cedar Ridge Rd/);
});

test("the routing instruction is hoisted out, not buried mid-list", () => {
  const html = notesToBonzoHtml(CARD);
  // It keeps its label, so the instruction says what it is about…
  assert.match(html, /⚠️ Investment\/2nd Home — give to LOA Justin, Mateo, or John/);
  // …the list entry stays clean…
  assert.match(html, /<strong>Investment\/2nd Home:<\/strong> Yes<br \/>/);
  // …and it must not split the block: Credit Over 500 still sits with the
  // qualification list, not orphaned after the callout.
  const qualBlock = html.split("</p>").find(b => b.includes("Owns Home"))!;
  assert.match(qualBlock, /Credit Over 500/, "the callout must not cut the block in half");
});

test("sections are headed, and free-form prose is left alone", () => {
  const html = notesToBonzoHtml(CARD);
  assert.match(html, /<strong>QUALIFICATION<\/strong>/);
  assert.match(html, /<strong>BORROWER DETAILS<\/strong>/);
  const prose = notesToBonzoHtml("Borrower called back angry.\nWants a callback Monday.");
  assert.ok(!/QUALIFICATION|BORROWER DETAILS/.test(prose), "prose gets no invented headings");
  assert.match(prose, /Borrower called back angry\.<br \/>Wants a callback Monday\./);
});

test("CLR-typed values are escaped", () => {
  const html = notesToBonzoHtml("Goal: <script>alert(1)</script> & more");
  assert.ok(!html.includes("<script>"), "no raw script tag may reach the CRM");
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp; more/);
  assert.equal(escapeHtml('a"b<c>d&e'), "a&quot;b&lt;c&gt;d&amp;e");
});

test("re-syncing does not post the note twice", () => {
  // The marker survives reformatting; a text comparison would not, because the
  // rendered note deliberately no longer matches its plain source.
  const marker = transferNoteMarker(2871);
  const html = notesToBonzoHtml(CARD, { title: "t", subtitle: `Logged in C3 · 2026-08-14 · ${marker}` });
  assert.ok(html.includes(marker), "the posted note must carry its own marker");
  assert.match(routes, /n\.content\.includes\(marker\)/);
  assert.match(routes, /already_posted/);
  // …and a CLR's manual paste is still caught by content.
  assert.match(routes, /notePlainText\(n\.content\)\.includes\(notePlainText\(convo\)\)/);
  assert.ok(notePlainText(html).includes(notePlainText("Address: 4417 Cedar Ridge Rd")));
});

test("an over-long note is trimmed on a tag boundary, never mid-tag", () => {
  const fn = bonzo.slice(bonzo.indexOf("export async function addProspectNote"), bonzo.indexOf("export async function deleteProspectNote"));
  assert.match(fn, /lastIndexOf\("<\/p>", 2000\)/);
  assert.ok(!/content\.slice\(0, 2000\)/.test(fn), "the blind slice must be gone");
});

test("appointment notes get the same treatment", () => {
  const fn = routes.slice(routes.indexOf("async function syncAppointmentNotesToBonzo"), routes.indexOf("async function syncAppointmentResultToBonzo"));
  assert.match(fn, /notesToBonzoHtml\(text/, "the same collapsing-newline bug applied here too");
});
