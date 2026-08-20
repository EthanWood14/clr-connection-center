import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "c3-lap-results-"));
process.env.DATABASE_PATH = join(tempDir, "lap-test.db");

const lap = await import("../server/storage");
const db = lap.getRawSqlite();

after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

function seedFixture() {
  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, company_name, plan)
    VALUES (?, ?, ?, ?, 'active')
  `).run(2, "Other Organization", "other-org", "Other Organization");
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, role, is_active, org_id, super_admin)
    VALUES (?, ?, ?, ?, 1, ?, 0)
  `).run(101, "LAP Assistant", "lap-assistant@example.test", "assistant", 1);
  db.prepare(`
    INSERT OR IGNORE INTO users (id, name, email, role, is_active, org_id, super_admin)
    VALUES (?, ?, ?, ?, 1, ?, 0)
  `).run(102, "Other Assistant", "other-assistant@example.test", "assistant", 2);
  db.prepare(`
    INSERT OR IGNORE INTO loan_officers
      (id, full_name, nmls_id, licensed_states, internal_status, org_id)
    VALUES (?, ?, ?, '[]', 'active', ?)
  `).run(201, "Test Loan Officer", "LAP-TEST-201", 1);
  db.prepare(`
    INSERT OR IGNORE INTO loan_officers
      (id, full_name, nmls_id, licensed_states, internal_status, org_id)
    VALUES (?, ?, ?, '[]', 'active', ?)
  `).run(202, "Other Loan Officer", "LAP-TEST-202", 2);
}

test("LAP storage keeps packages org-scoped and current files versioned", () => {
  seedFixture();
  const pdfV1 = Buffer.from("%PDF-1.7\ncredit-v1");
  const pdfV2 = Buffer.from("%PDF-1.7\ncredit-v2");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01]);

  assert.equal(lap.detectLapResultFileMime(pdfV1), "application/pdf");
  assert.equal(
    lap.detectLapResultFileMime(Buffer.from(`not-a-header ${pdfV1.toString()}`)),
    null,
    "PDF magic must start at byte zero",
  );

  const created = lap.createLapResultPackage({
    orgId: 1,
    actorUserId: 101,
    borrowerName: "Borrower One",
    dealReference: "DEAL-1",
    loanOfficerId: 201,
    notes: "Internal package note",
    resultDate: "2026-07-26",
  });
  assert.equal(created.complete, false);
  assert.equal(created.files.creditReport, null);
  assert.equal(lap.getLapResultPackage(2, created.id), null);
  assert.equal(lap.listLapResultPackages({ orgId: 2 }).total, 0);

  assert.throws(
    () => lap.createLapResultPackage({
      orgId: 1,
      actorUserId: 101,
      borrowerName: "Wrong LO",
      loanOfficerId: 202,
      resultDate: "2026-07-26",
    }),
    (error: any) => error instanceof lap.LapResultStorageError && error.status === 400,
  );

  assert.throws(
    () => lap.replaceLapResultFile({
      orgId: 1,
      packageId: created.id,
      actorUserId: 101,
      documentType: "credit_report",
      filename: "spoofed.pdf",
      mime: "application/pdf",
      data: Buffer.from("not a PDF"),
    }),
    (error: any) => error instanceof lap.LapResultStorageError && error.status === 415,
  );

  const creditV1 = lap.replaceLapResultFile({
    orgId: 1,
    packageId: created.id,
    actorUserId: 101,
    documentType: "credit_report",
    filename: "credit.pdf",
    mime: "application/pdf",
    data: pdfV1,
  });
  const creditV2 = lap.replaceLapResultFile({
    orgId: 1,
    packageId: created.id,
    actorUserId: 101,
    documentType: "credit_report",
    filename: "credit-new.pdf",
    mime: "application/pdf",
    data: pdfV2,
  });
  assert.equal(creditV1.version, 1);
  assert.equal(creditV2.version, 2);

  const currentCreditRows = db.prepare(`
    SELECT COUNT(*) AS count
    FROM lap_result_file_versions
    WHERE org_id = 1 AND package_id = ? AND document_type = 'credit_report'
      AND is_current = 1 AND removed_at IS NULL
  `).get(created.id) as any;
  assert.equal(Number(currentCreditRows.count), 1);

  lap.replaceLapResultFile({
    orgId: 1,
    packageId: created.id,
    actorUserId: 101,
    documentType: "aus",
    filename: "findings.png",
    mime: "image/png",
    data: png,
  });
  lap.replaceLapResultFile({
    orgId: 1,
    packageId: created.id,
    actorUserId: 101,
    documentType: "formal_quote",
    filename: "quote.jpg",
    mime: "image/jpeg",
    data: jpeg,
  });

  const complete = lap.getLapResultPackage(1, created.id)!;
  assert.equal(complete.complete, true);
  assert.equal(complete.status, "complete");
  assert.equal(complete.files.creditReport?.id, creditV2.id);
  assert.equal(JSON.stringify(complete).includes("credit-v2"), false, "JSON must not include BLOB bytes");

  const stats = lap.getLapResultStats({
    orgId: 1,
    today: "2026-07-26",
    weekStart: "2026-07-20",
    monthStart: "2026-07-01",
  });
  assert.deepEqual(stats.periods.today, {
    packages: 1,
    complete: 1,
    incomplete: 0,
    creditReports: 1,
    aus: 1,
    formalQuotes: 1,
  });
  assert.equal(lap.getLapTeamStats(1).totals.filesUploaded, 3);

  assert.throws(
    () => lap.softDeleteLapResultFile({
      orgId: 2,
      fileId: creditV2.id,
      actorUserId: 102,
    }),
    (error: any) => error instanceof lap.LapResultStorageError && error.status === 404,
  );
  const afterRemoval = lap.softDeleteLapResultFile({
    orgId: 1,
    fileId: creditV2.id,
    actorUserId: 101,
  });
  assert.equal(afterRemoval.complete, false);
  assert.equal(afterRemoval.files.creditReport, null);

  const eventColumns = db.prepare(`PRAGMA table_info(lap_result_events)`).all() as any[];
  assert.deepEqual(
    eventColumns.map((column) => String(column.name)),
    ["id", "org_id", "package_id", "file_id", "actor_user_id", "action", "created_at"],
    "LAP audit events must contain opaque identifiers only",
  );
  const eventOrgIds = db.prepare(`
    SELECT DISTINCT org_id FROM lap_result_events WHERE package_id = ?
  `).all(created.id) as any[];
  assert.deepEqual(eventOrgIds.map((row) => Number(row.org_id)), [1]);
});

test("LAP packages merge without losing files, versions, or C3 transfer links", () => {
  seedFixture();
  const pdf = Buffer.from("%PDF-1.7\ntarget-credit");
  const sourcePdf = Buffer.from("%PDF-1.7\nsource-credit");
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
  const target = lap.createLapResultPackage({ orgId: 1, actorUserId: 101, borrowerName: "Merge Borrower", loanOfficerId: 201, resultDate: "2026-08-20" });
  const source = lap.createLapResultPackage({ orgId: 1, actorUserId: 101, borrowerName: "Merge Borrower", loanOfficerId: 201, notes: "Started before C3 logged it", resultDate: "2026-08-19" });
  const targetCredit = lap.replaceLapResultFile({ orgId: 1, packageId: target.id, actorUserId: 101, documentType: "credit_report", filename: "target.pdf", mime: "application/pdf", data: pdf });
  lap.replaceLapResultFile({ orgId: 1, packageId: source.id, actorUserId: 101, documentType: "credit_report", filename: "source.pdf", mime: "application/pdf", data: sourcePdf });
  const sourceAus = lap.replaceLapResultFile({ orgId: 1, packageId: source.id, actorUserId: 101, documentType: "aus", filename: "aus.png", mime: "image/png", data: png });
  const now = new Date().toISOString();
  const outcome = db.prepare(`INSERT INTO lead_outcomes (date, assistant_id, lo_id, borrower_name, outcome_type, org_id, created_at, updated_at) VALUES ('2026-08-20', 101, 201, 'Merge Borrower', 'transfer', 1, ?, ?)`).run(now, now);
  lap.linkLapTransferToPackage({ orgId: 1, outcomeId: Number(outcome.lastInsertRowid), packageId: source.id, actorUserId: 101 });

  const merged = lap.mergeLapResultPackages({ orgId: 1, targetPackageId: target.id, sourcePackageId: source.id, actorUserId: 101 });
  assert.equal(merged.files.creditReport?.id, targetCredit.id, "the destination current file wins a same-slot conflict");
  assert.equal(merged.files.aus?.id, sourceAus.id, "a missing destination slot inherits the source current file");
  assert.match(merged.notes, /Started before C3 logged it/);
  assert.equal(lap.getLapResultPackage(1, source.id), null, "the duplicate package is archived");
  const link = db.prepare(`SELECT package_id FROM lap_result_transfer_links WHERE outcome_id=?`).get(Number(outcome.lastInsertRowid)) as any;
  assert.equal(Number(link.package_id), target.id, "the C3 transfer follows the surviving package");
  const histories = db.prepare(`SELECT COUNT(*) AS n FROM lap_result_file_versions WHERE package_id=? AND document_type='credit_report'`).get(target.id) as any;
  assert.equal(Number(histories.n), 2, "both document histories survive the merge");
});
