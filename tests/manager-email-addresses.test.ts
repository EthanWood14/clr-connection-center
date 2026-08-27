import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const settings = readFileSync(join(root, "client/src/pages/settings.tsx"), "utf8");

// scott.petrie@ and chris.redoble@ were never real mailboxes. They hard-bounced
// on 2026-04-19, Resend suppressed them, and because Resend discards the whole
// message when any recipient is suppressed, every multi-recipient manager email
// was silently thrown away for four months.
const DEAD = ["scott.petrie@westcapitallending.com", "chris.redoble@westcapitallending.com"];

test("nothing seeds the dead manager addresses", () => {
  assert.match(storage, /const MANAGER_EMAIL_DEFAULTS = \["spetrie@westcapitallending\.com", "credoble@westcapitallending\.com"\]/);
  // Every seeder writes the shared constant, never a literal pair.
  const seeders = [
    storage.slice(storage.indexOf("INSERT OR IGNORE INTO organizations"), storage.indexOf("INSERT OR IGNORE INTO organizations") + 600),
    storage.slice(storage.indexOf("Seed default manager emails"), storage.indexOf("report_schedule_settings — per-type")),
    storage.slice(storage.indexOf("INSERT OR IGNORE INTO report_schedule_settings") - 200, storage.indexOf("INSERT OR IGNORE INTO report_schedule_settings") + 200),
  ];
  for (const block of seeders) for (const dead of DEAD) {
    assert.ok(!block.includes(dead), `a seeder still plants ${dead}`);
  }
  assert.ok(!settings.includes(DEAD[0]) && !settings.includes(DEAD[1]),
    "the Settings quick-add must not offer the dead addresses");
  assert.match(settings, /spetrie@westcapitallending\.com/);
  assert.match(settings, /credoble@westcapitallending\.com/);
});

test("boot never rewrites a corrected address back", () => {
  // The old code re-canonicalised on every start, so an admin's fix survived
  // only until the next deploy. Any repair must be guarded by migrations_applied.
  assert.ok(!/One-time alias cleanup: remove legacy short-form emails/.test(storage),
    "the every-boot alias strip must be gone");
  assert.ok(!storage.includes("users alias cleanup failed"),
    "the every-boot users email rewrite must be gone");
  const repair = storage.slice(
    storage.indexOf("Repair the dead manager addresses ONCE"),
    storage.indexOf("dead manager email repair failed"),
  );
  assert.ok(repair.length > 0, "the guarded repair must exist");
  assert.match(repair, /migrations_applied WHERE name = 'dead_manager_emails_v1'/);
  assert.match(repair, /UPDATE users SET email = 'spetrie@westcapitallending\.com'/);
  // The repair rewrites stored lists rather than stripping entries — the strip
  // is what emptied them and let the seeder refill with dead addresses.
  assert.match(repair, /UPDATE email_settings SET manager_emails = \? WHERE id = \?/);
  assert.match(repair, /UPDATE report_schedule_settings SET recipients = \?/);
  assert.match(repair, /out\.length \? out : MANAGER_EMAIL_DEFAULTS/);
  // Guarded means the write is inside the !done branch.
  assert.ok(repair.indexOf("if (!done)") < repair.indexOf("UPDATE users SET email"),
    "the rewrite must sit inside the run-once guard");
});
