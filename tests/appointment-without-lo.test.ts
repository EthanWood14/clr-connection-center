import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const schema = readFileSync(join(root, "shared/schema.ts"), "utf8");
const form = readFileSync(join(root, "client/src/pages/outcomes.tsx"), "utf8");
const appts = readFileSync(join(root, "client/src/pages/appointments.tsx"), "utf8");

test("lo_id is genuinely nullable, not pointed at a placeholder LO", () => {
  // A sentinel row would fold unassigned appointments into that LO's numbers
  // and into the assignment rotation. Absence has to be absence.
  const block = schema.slice(schema.indexOf('sqliteTable("lead_outcomes"'), schema.indexOf('borrowerName: text("borrower_name")'));
  assert.match(block, /loId: integer\("lo_id"\)\.references/);
  assert.ok(!/loId: integer\("lo_id"\)\.notNull\(\)/.test(block), "the column must not be NOT NULL");
  // Other tables keep their NOT NULL lo_id — only outcomes changed.
  assert.match(schema, /loId: integer\("lo_id"\)\.notNull\(\)/, "assignments etc. still require an LO");
});

test("the live table is rebuilt without losing rows, columns or indexes", () => {
  const mig = storage.slice(storage.indexOf("lead_outcomes.lo_id becomes nullable"), storage.indexOf("lap_gate_password_hash"));
  // DDL derived from the live table, not hand-written — this table has a long
  // tail of ALTER-added columns and hand-listing them drops one silently.
  assert.match(mig, /FROM sqlite_master WHERE type='table' AND name='lead_outcomes'/);
  assert.match(mig, /PRAGMA table_info\(lead_outcomes\)/);
  assert.match(mig, /type='index' AND tbl_name='lead_outcomes'/, "indexes must be replayed");
  assert.match(mig, /row count mismatch/, "must refuse to swap in an incomplete copy");
  assert.match(mig, /ROLLBACK/);
  assert.ok(mig.includes("NOT") && mig.includes("NULL/i.test(t.sql)"),
    "idempotent: only runs while NOT NULL is still set");
});

test("only appointments may go without an LO", () => {
  // Server is the authority; the form mirrors it.
  assert.match(routes, /loId is required for everything except appointments/);
  assert.match(routes, /body\.loId == null && body\.outcomeType !== "appointment"/);
  assert.match(form, /val\.outcomeType !== "appointment" && !val\.loId/);
  assert.match(form, /message: "Select a loan officer"/);
});

test("booking without an LO is a deliberate choice in the UI", () => {
  // Not an empty field someone forgot — an explicit option, and only for
  // appointments. Radix rejects "" as a value, hence the sentinel.
  assert.match(form, /const UNASSIGNED_LO = "__none__"/);
  assert.match(form, /No LO yet — assign later/);
  assert.match(form, /watchedType === "appointment" && \(\s*<SelectItem value=\{UNASSIGNED_LO\}/);
  assert.match(form, /v === UNASSIGNED_LO \? null : Number\(v\)/, "the sentinel must never be stored");
});

test("an unassigned appointment reads as unassigned everywhere it is shown", () => {
  assert.match(form, /o\.loId \? `LO #\$\{o\.loId\}` : "No LO assigned"/);
  assert.match(appts, /loId: number \| null;/);
  assert.match(appts, /o\.loId == null \? "Unassigned"/);
  assert.match(appts, /\(o\.loId != null \? loMap\.get\(o\.loId\) : null\) \?\? "Unassigned"/, "the export too");
  // The Bonzo mirror must not print "LO: ?" at a borrower.
  assert.ok(!/lo\?\.fullName \?\? "\?"/.test(routes));
  assert.match(routes, /lo\?\.fullName \?\? "unassigned"/);
});
