import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// "Was <helper> part of this transfer?" — Elleine is paid a flat rate per
// transfer she assists on, so this flag is a payroll input, not a nice-to-have.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const storage = read("server/storage.ts");
const routes = read("server/routes.ts");
const schema = read("shared/schema.ts");

test("every Drizzle column on lead_outcomes is actually created in the database", () => {
  // Drizzle compiles SELECTs listing every column in the table definition, so a
  // column added to schema.ts with no matching CREATE/ALTER in storage.ts takes
  // the whole app down at boot with "no such column".
  const table = schema.slice(
    schema.indexOf('export const leadOutcomes = sqliteTable("lead_outcomes"'),
    schema.indexOf("export const insertLeadOutcomeSchema"),
  );
  const declared = [...table.matchAll(/\b(?:integer|text|real)\("([a-z0-9_]+)"\)/g)].map((m) => m[1]);
  assert.ok(declared.includes("helper_assisted"), "sanity: helper_assisted should be declared");

  const createBlock = storage.slice(
    storage.indexOf("CREATE TABLE IF NOT EXISTS lead_outcomes ("),
    storage.indexOf("CREATE TABLE IF NOT EXISTS lead_outcomes (") + 2000,
  );
  for (const col of declared) {
    const altered = storage.includes(`ALTER TABLE lead_outcomes ADD COLUMN ${col} `);
    const created = new RegExp(`^\\s*${col}\\s+(INTEGER|TEXT|REAL)\\b`, "m").test(createBlock);
    assert.ok(altered || created,
      `lead_outcomes.${col} is in the Drizzle schema but never created — the app will not boot`);
  }
});

test("the helper flag is only ever set on transfers", () => {
  // A non-transfer outcome carrying helper_assisted=1 would inflate her pay.
  const post = routes.slice(routes.indexOf(`app.post("/api/outcomes"`), routes.indexOf(`app.patch("/api/outcomes/:id"`));
  assert.match(post, /body\.helperAssisted = toBulk\(body\.helperAssisted\)/,
    "transfers must normalize the flag to 1/0/null");
  assert.match(post, /body\.helperAssisted = null/,
    "non-transfers must clear the flag");
});

test("editing an outcome away from transfer clears the helper flag", () => {
  const patch = routes.slice(routes.indexOf(`app.patch("/api/outcomes/:id"`));
  assert.match(patch, /body\.helperAssisted = null/,
    "changing outcomeType away from transfer must clear the flag");
  assert.match(patch, /if \("helperAssisted" in body\) body\.helperAssisted = toTriState/,
    "the flag must be coerced to 1/0/null, never a raw string");
  assert.ok(patch.includes('"helperAssisted"'), "the field must be in the PATCH allowlist or edits silently drop it");
});

test("the count is org-wide, not scoped to the viewing CLR", () => {
  // She assists on other CLRs' transfers; a per-user count would under-report
  // what she is owed.
  const dash = routes.slice(routes.indexOf("let helperTransfers = 0;"), routes.indexOf("// ── Team Stats"));
  assert.match(dash, /helperTransfers = countHelperSql\(""/,
    "personal scope must still count every helper transfer in the org");
  assert.match(dash, /helper_assisted=1/, "count must filter on the flag");
  assert.match(dash, /outcome_type='transfer'/, "count must only include transfers");
});

test("email settings updates cannot inject arbitrary SQL column names", () => {
  const fn = storage.slice(storage.indexOf("export function updateEmailSettings"), storage.indexOf("// ── Report schedule recipients"));
  assert.match(fn, /PRAGMA table_info\(email_settings\)/,
    "column names are interpolated into SQL, so they must be validated against the real table");
  assert.match(fn, /columns\.has\(col\)/);
});
