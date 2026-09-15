import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { isSharedOverdueAppointment, sharedOverdueAppointmentPatch } from "../server/appointment-permissions";
import { detectAppointmentMove, normalizeAppointmentTime, rescheduleStampIsStale } from "../server/tv-board";
import { summarizeCompleteness } from "../shared/transfer-completeness";
import { transferEditInitialValues, transferInformationChanges } from "../shared/transfer-edit";

// Execute the real handler without importing routes.ts, whose imports boot the
// application database and integrations. Storage and outbound work stay local.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const start = routes.indexOf('app.patch("/api/outcomes/:id"');
const end = routes.indexOf('app.delete("/api/outcomes/:id"', start);
assert.ok(start >= 0 && end > start, "the actual outcome PATCH must be present");
const handlerSource = ts.transpileModule(routes.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const ORIGINAL_VERSION = "2026-09-15T18:00:00.000Z";
const SAVED_VERSION = "2026-09-15T18:01:00.000Z";

function wire(overrides: Record<string, unknown> = {}) {
  let row: any = {
    id: 42, date: "2026-09-10", assistantId: 7, orgId: 1, outcomeType: "transfer",
    transferType: "direct", loId: 8, loaId: null, borrowerName: "Example",
    conversationNotes: "", notes: "", phoneNumber: "", leadSource: "",
    followUpDate: null, appointmentDatetime: null, rescheduleDatetime: null,
    bulkTexter: null, helperAssisted: null, updatedAt: ORIGINAL_VERSION,
    ...overrides,
  };
  const writes: Array<{ id: number; patch: any }> = [];
  const audits: any[] = [];
  const queued: Array<() => unknown> = [];
  const syncs: string[] = [];
  let reminderResets = 0;
  let handler: (req: any, res: any) => void;
  const sqlite = {
    prepare(sql: string) {
      if (/SELECT assistant_id/.test(sql)) {
        assert.match(sql, /updated_at/, "the conflict check must read the saved version");
        return { get: (id: number) => id === row.id ? {
          assistant_id: row.assistantId, outcome_type: row.outcomeType,
          follow_up_date: row.followUpDate, appointment_datetime: row.appointmentDatetime,
          reschedule_datetime: row.rescheduleDatetime, org_id: row.orgId, updated_at: row.updatedAt,
        } : undefined };
      }
      assert.match(sql, /UPDATE lead_outcomes SET reminder_sent_30m/);
      return { run() { reminderResets += 1; } };
    },
  };
  runInNewContext(handlerSource, {
    app: { patch(_path: string, _auth: unknown, fn: typeof handler) { handler = fn; } },
    requireAuth() {},
    storageExtra: { getRawSqlite: () => sqlite },
    storage: {
      updateLeadOutcome(id: number, patch: any) {
        writes.push({ id, patch: { ...patch } });
        row = { ...row, ...patch, updatedAt: SAVED_VERSION };
        return { ...row };
      },
      createLeadOutcome() { assert.fail("an edit must never create another outcome"); },
      getUserById: () => ({ name: "Test CLR" }),
      getLoanOfficerById: () => ({ fullName: "Test LO" }),
    },
    isSharedOverdueAppointment,
    sharedOverdueAppointmentPatch,
    businessTodayForRequest: () => "2026-09-15",
    detectAppointmentMove,
    normalizeAppointmentTime,
    rescheduleStampIsStale,
    audit: (entry: any) => audits.push(entry),
    setImmediate: (fn: () => unknown) => queued.push(fn),
    syncTransferToBonzo: async () => { syncs.push("transfer"); },
    syncAppointmentResultToBonzo: async () => { syncs.push("appointment-result"); },
    syncAppointmentNotesToBonzo: async () => { syncs.push("appointment-notes"); },
    transferCelebration: () => ({ headline: "Transfer logged" }),
    console,
  });
  return {
    writes, audits, queued, syncs,
    row: () => row,
    reminderResets: () => reminderResets,
    call(body: any, session: any = { userId: 7, orgId: 1, role: "clr" }) {
      const result: any = { status: 200, body: undefined };
      const res: any = {
        status(code: number) { result.status = code; return res; },
        json(value: unknown) { result.body = value; return res; },
      };
      handler!({ params: { id: "42" }, body, session_user: session }, res);
      return result;
    },
  };
}

test("a matching version edits the same transfer and refreshes its score without new-transfer side effects", () => {
  const api = wire();
  const original = { ...api.row() };
  const beforeScore = summarizeCompleteness([original]).pct!;
  const result = api.call({
    expectedUpdatedAt: ORIGINAL_VERSION,
    phoneNumber: "7025550100", leadSource: "Single Dialing", loaId: 9,
    bulkTexter: false, helperAssisted: true, notes: "Discussed refinancing",
    conversationNotes: "Owns Home: Yes\nBankruptcy Last 6 Months: No\nInvestment/2nd Home: No",
  });
  assert.equal(result.status, 200);
  assert.equal(api.writes.length, 1);
  assert.equal(api.writes[0].id, original.id);
  for (const key of ["id", "assistantId", "date", "outcomeType", "transferType", "loId"]) {
    assert.equal(result.body[key], original[key], `${key} stays with the original transfer`);
  }
  assert.equal(result.body.loaId, 9);
  assert.equal(result.body.bulkTexter, 0);
  assert.equal(result.body.helperAssisted, 1);
  assert.ok(summarizeCompleteness([api.row()]).pct! > beforeScore);
  assert.equal(result.body.celebrateTransfer, undefined);
  assert.equal(api.queued.length, 0, "an information edit queues no creation or conversion work");
  assert.equal(api.reminderResets(), 0);
  assert.equal(api.audits.length, 1);
  assert.equal(api.audits[0].action, "update");
  assert.equal("expectedUpdatedAt" in api.writes[0].patch, false);
  assert.equal("expectedUpdatedAt" in JSON.parse(api.audits[0].details), false);
});

test("a stale version returns 409 before persistence, auditing, reminders, or outbound work", () => {
  const api = wire({ updatedAt: SAVED_VERSION, conversationNotes: "Property Address: New correction" });
  const result = api.call({ expectedUpdatedAt: ORIGINAL_VERSION, conversationNotes: "Stale notes" });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /Reopen it/);
  assert.equal(api.row().conversationNotes, "Property Address: New correction");
  assert.equal(api.writes.length, 0);
  assert.equal(api.audits.length, 0);
  assert.equal(api.queued.length, 0);
  assert.equal(api.reminderResets(), 0);
});

test("malformed versions are conflicts and omitted versions remain backward compatible", () => {
  for (const version of [null, 0, {}, [ORIGINAL_VERSION]]) {
    const api = wire();
    assert.equal(api.call({ expectedUpdatedAt: version, notes: "No write" }).status, 409);
    assert.equal(api.writes.length, 0);
  }
  const legacy = wire();
  assert.equal(legacy.call({ notes: "Legacy caller" }).status, 200);
  assert.equal(legacy.row().notes, "Legacy caller");
});

test("the first save advances the version so a second editor cannot overwrite it", () => {
  const api = wire();
  assert.equal(api.call({ expectedUpdatedAt: ORIGINAL_VERSION, notes: "First editor" }).status, 200);
  assert.equal(api.call({ expectedUpdatedAt: ORIGINAL_VERSION, notes: "Second editor" }).status, 409);
  assert.equal(api.writes.length, 1);
  assert.equal(api.row().notes, "First editor");
});

test("reposting a terminal type does not let another CLR edit an existing transfer", () => {
  for (const outcomeType of ["transfer", "fell_through"]) {
    const api = wire();
    const result = api.call({ outcomeType, transferType: "direct", notes: "Not yours" }, {
      userId: 99, orgId: 1, role: "clr",
    });
    assert.equal(result.status, 403);
    assert.equal(api.writes.length, 0);
    assert.equal(api.audits.length, 0);
  }
});

test("authorization is checked before a conflict can disclose another organization's row", () => {
  const api = wire();
  const result = api.call({ expectedUpdatedAt: "stale", notes: "Not yours" }, {
    userId: 7, orgId: 2, role: "admin",
  });
  assert.equal(result.status, 404);
  assert.equal(api.writes.length, 0);
});

test("an administrator can still correct another CLR's transfer without another celebration", () => {
  const api = wire();
  const result = api.call({ expectedUpdatedAt: ORIGINAL_VERSION, outcomeType: "transfer", transferType: "appointment" }, {
    userId: 99, orgId: 1, role: "admin",
  });
  assert.equal(result.status, 200);
  assert.equal(api.row().transferType, "appointment");
  assert.equal(api.row().assistantId, 7);
  assert.equal(result.body.celebrateTransfer, undefined);
  assert.equal(api.queued.length, 0);
});

test("another CLR can still complete an appointment and only that conversion celebrates", async () => {
  const api = wire({ outcomeType: "appointment", transferType: null, followUpDate: "2026-09-16T10:00" });
  const result = api.call({
    expectedUpdatedAt: ORIGINAL_VERSION, outcomeType: "transfer", transferType: "appointment",
    conversationNotes: "Owns Home: Yes", assistantId: 99,
  }, { userId: 99, orgId: 1, role: "clr" });
  assert.equal(result.status, 200);
  assert.equal(api.writes.length, 1);
  assert.equal(api.row().assistantId, 7, "handoff keeps the established attribution rule");
  assert.equal(api.row().outcomeType, "transfer");
  assert.equal(api.row().followUpDate, null);
  assert.equal(result.body.celebrateTransfer, true);
  for (const job of api.queued) await job();
  assert.deepEqual(api.syncs, ["transfer", "appointment-result"]);
});

test("overdue shared appointment edits still work with a matching version", () => {
  const api = wire({ outcomeType: "appointment", transferType: null, followUpDate: "2026-09-14T10:00" });
  const result = api.call({ expectedUpdatedAt: ORIGINAL_VERSION, borrowerName: "Corrected", assistantId: 99 }, {
    userId: 99, orgId: 1, role: "clr",
  });
  assert.equal(result.status, 200);
  assert.equal(api.row().borrowerName, "Corrected");
  assert.equal(api.row().assistantId, 7);
  assert.equal(result.body.celebrateTransfer, undefined);
});

test("GET outcomes exposes saved intake fields and the conflict version from raw database rows", () => {
  const getStart = routes.indexOf('app.get("/api/outcomes"');
  const getEnd = routes.indexOf("const transferCelebration =", getStart);
  assert.ok(getStart >= 0 && getEnd > getStart);
  const getSource = ts.transpileModule(routes.slice(getStart, getEnd), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const raw = {
    id: 42, org_id: 1, assistant_id: 7, lo_id: 8, loa_id: 9, date: "2026-09-10",
    outcome_type: "transfer", transfer_type: "direct", borrower_name: "Example",
    phone_number: "7025550100", notes: "Other notes", lead_source: "Custom referral",
    conversation_notes: "Owns Home: Yes\nProperty Address: 123 Example Street",
    prequalification_notes: "Additional qualifications", lo_action_plan: "Review file",
    lead_timeframe: "This month", lead_goal: "Refinance", next_steps: "Call borrower",
    requires_followup: 1, followup_reason: "Requested a call", followup_date: "2026-09-17",
    follow_up_date: null, appointment_datetime: null, lead_type: "appointment_transfer",
    missed_reason: null, rescheduled: 0, reschedule_datetime: null,
    bulk_texter: 0, helper_assisted: 1,
    created_at: "2026-09-10T18:00:00.000Z", updated_at: ORIGINAL_VERSION,
  };
  let handler: (req: any, res: any) => void;
  let storageFilter: any;
  runInNewContext(getSource, {
    app: { get(_path: string, fn: typeof handler) { handler = fn; } },
    storage: {
      getLeadOutcomes(filters: any) { storageFilter = filters; return [raw]; },
      getLoanOfficers: () => [{ id: 8, full_name: "Test LO" }],
      getUsers: () => [{ id: 7, name: "Test CLR" }],
    },
  });
  let result: any[] = [];
  handler!({ query: { startDate: "2026-09-01", endDate: "2026-09-30", assistantId: "7", outcomeType: "transfer" } }, {
    json(value: any[]) { result = value; },
  });
  assert.equal(result.length, 1);
  assert.equal(storageFilter.assistantId, 7, "the existing storage filter remains in force");
  assert.equal(storageFilter.outcomeType, "transfer");
  const saved = result[0];
  for (const [camel, snake] of [
    ["conversationNotes", "conversation_notes"], ["leadSource", "lead_source"],
    ["prequalificationNotes", "prequalification_notes"], ["loActionPlan", "lo_action_plan"],
    ["leadTimeframe", "lead_timeframe"], ["leadGoal", "lead_goal"], ["nextSteps", "next_steps"],
    ["followupReason", "followup_reason"], ["followupDate", "followup_date"],
    ["leadType", "lead_type"], ["updatedAt", "updated_at"], ["createdAt", "created_at"],
  ]) {
    assert.equal(saved[camel], (raw as any)[snake], `${camel} must be available to the form`);
    assert.equal(saved[snake], (raw as any)[snake], "legacy snake_case fields remain available");
  }
  assert.equal(saved.requiresFollowup, true);
  assert.equal(saved.rescheduled, 0, "existing raw fields retain their established types");
  assert.equal(saved.bulkTexter, false);
  assert.equal(saved.helperAssisted, true);
  const initial = transferEditInitialValues(saved);
  assert.equal(initial.qualOwnHome, "yes");
  assert.equal(initial.infoAddress, "123 Example Street");
  assert.equal(initial.leadSourceOther, "Custom referral");
  assert.equal(initial.prequalificationNotes, raw.prequalification_notes);
  assert.deepEqual(transferInformationChanges(saved, initial), {}, "opening a saved row must be a no-op");
  assert.deepEqual(transferInformationChanges(saved, { ...initial, phoneNumber: "7025550199" }), {
    phoneNumber: "7025550199", expectedUpdatedAt: ORIGINAL_VERSION,
  });
});
