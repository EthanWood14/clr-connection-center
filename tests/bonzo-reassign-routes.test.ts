import { test } from "node:test";
import assert from "node:assert/strict";

import { registerBonzoReassignRoutes } from "../server/bonzo-reassign-routes";
import { canUseReassignTool } from "../server/clr-roster";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  peopleFromPayload, fallbackPeopleFromLos, normalizePerson,
  PEOPLE_TTL_MS, PEOPLE_STALE_MAX_MS,
} from "../server/leadvault-people";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The routes, driven through a stand-in Express and a fake Bonzo, so the rules
 * that stop somebody's client being moved by mistake are exercised without
 * touching a live CRM.
 */

type Handler = (req: any, res: any) => any;

const BILL = "bill@westcapitallending.com";
const CHRIS = "chris@westcapitallending.com";
const GARY = "gary@westcapitallending.com";

const held = (id: number, email: string | null, name = "Manuel Cruz") =>
  ({ id, name, assignedUserName: null, assignedUserEmail: email });

function harness(over: Partial<Parameters<typeof registerBonzoReassignRoutes>[1]> = {}) {
  const routes = new Map<string, Handler>();
  const calls: any[] = [];
  const audits: any[] = [];
  let holders = new Map<number, string | null>();

  const deps = {
    requireAuth: ((_q: any, _s: any, n: any) => n()) as any,
    requireAccess: () => true,
    bonzoConfigured: () => true,
    findProspectByPhone: async (_p: string) => ({ candidates: [] as any[] }),
    reassignProspectByEmail: async (prospectId: number, userEmail: string) => {
      calls.push({ prospectId, userEmail });
      holders.set(prospectId, userEmail);
      return { ok: true, verified: true, nowEmail: userEmail };
    },
    getProspectAssigneeEmail: async (id: number) => holders.get(id) ?? null,
    audit: (_req: any, entry: any) => { audits.push(entry); },
    people: async () => ({ people: [], source: "leadvault", fetchedAt: null, notice: null }),
    ...over,
  };

  registerBonzoReassignRoutes(
    {
      post(path: string, _auth: any, handler: Handler) { routes.set(path, handler); },
      get(path: string, _auth: any, handler: Handler) { routes.set(path, handler); },
    } as any,
    deps as any,
  );

  const call = async (path: string, body: any = {}) => {
    const out: any = { code: 200, body: null };
    const res: any = {
      status(c: number) { out.code = c; return res; },
      json(b: any) { out.body = b; return res; },
    };
    await routes.get(path)!({ body }, res);
    return out;
  };

  return {
    check: (body: any) => call("/api/bonzo/reassign/check", body),
    people: () => call("/api/bonzo/reassign/people"),
    move: (body: any) => call("/api/bonzo/reassign", body),
    calls, audits,
    setHolder: (id: number, email: string | null) => holders.set(id, email),
  };
}

const ASK = { phone: "(530) 736-5868", fromEmail: BILL, toEmail: CHRIS };

// ── the check looks and does not touch ──────────────────────────────────────

test("the check names the one record that would move", () => {
  return (async () => {
    const h = harness({
      findProspectByPhone: async () => ({ candidates: [held(11, GARY), held(22, BILL), held(33, CHRIS)] }),
    });
    const out = await h.check(ASK);
    assert.equal(out.code, 200);
    assert.equal(out.body.verdict.action, "move");
    assert.equal(out.body.verdict.prospectId, 22, "Bill's, not Gary's or Chris's");
    // Everyone on the phone is shown, so the person can see what they are choosing between.
    assert.equal(out.body.candidates.length, 3);
    assert.equal(h.calls.length, 0, "the check must not move anything");
  })();
});

test("a phone nobody on it is held by is refused with the holders named", async () => {
  const h = harness({ findProspectByPhone: async () => ({ candidates: [held(11, GARY)] }) });
  const out = await h.check(ASK);
  assert.equal(out.body.verdict.action, "refuse");
  assert.match(out.body.verdict.reason, /Nobody on that phone is assigned to/);
  assert.match(out.body.verdict.reason, /gary@/);
  assert.equal(h.calls.length, 0);
});

test("a bad phone is refused before Bonzo is called at all", async () => {
  let looked = 0;
  const h = harness({ findProspectByPhone: async () => { looked += 1; return { candidates: [] }; } });
  const out = await h.check({ ...ASK, phone: "736-5868" });
  assert.equal(out.body.verdict.action, "refuse");
  assert.match(out.body.verdict.reason, /ten-digit/);
  assert.equal(looked, 0, "no round trip for an obviously wrong number");
});

test("Bonzo being down is said plainly rather than read as an empty result", async () => {
  const h = harness({ findProspectByPhone: async () => { throw new Error("ETIMEDOUT"); } });
  const out = await h.check(ASK);
  assert.equal(out.code, 502);
  assert.match(out.body.error, /did not answer/);
  // "No prospect has that phone" would be a lie here, and would send somebody
  // looking for a record that exists.
  assert.equal(out.body.verdict, undefined);
});

test("an unconfigured Bonzo says so instead of failing obscurely", async () => {
  const h = harness({ bonzoConfigured: () => false });
  assert.equal((await h.check(ASK)).code, 503);
  assert.equal((await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS })).code, 503);
});

// ── the move ────────────────────────────────────────────────────────────────

test("the move goes to the prospect the check named, by id", async () => {
  const h = harness();
  h.setHolder(22, BILL);
  const out = await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(out.code, 200);
  assert.equal(out.body.moved, true);
  assert.equal(out.body.verified, true);
  assert.deepEqual(h.calls, [{ prospectId: 22, userEmail: CHRIS }]);
});

test("a record that moved between the check and the confirm is refused", async () => {
  // Two people working the same list, or a check left open over lunch. Moving
  // it anyway would undo somebody's work without either of them knowing.
  const h = harness();
  h.setHolder(22, GARY);
  const out = await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(out.code, 409);
  assert.match(out.body.error, /now held by gary@/);
  assert.equal(h.calls.length, 0, "nothing was moved");
});

test("a record already at the destination reports done without moving it again", async () => {
  const h = harness();
  h.setHolder(22, CHRIS);
  const out = await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(out.code, 200);
  assert.equal(out.body.moved, false);
  assert.equal(out.body.alreadyThere, true);
  assert.equal(h.calls.length, 0);
});

test("a move Bonzo accepted but did not apply is reported as exactly that", async () => {
  // A 2xx is not proof. Saying "moved" here would send somebody away believing
  // a borrower changed hands when they did not.
  const h = harness({
    reassignProspectByEmail: async () => ({ ok: true, verified: false, nowEmail: BILL }),
  });
  h.setHolder(22, BILL);
  const out = await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(out.code, 200);
  assert.equal(out.body.verified, false);
  assert.match(out.body.message, /still shows bill@/);
  assert.match(out.body.message, /Check it in Bonzo/);
});

test("Bonzo refusing the move is surfaced with its reason", async () => {
  const h = harness({
    reassignProspectByEmail: async () => ({ ok: false, verified: false, nowEmail: null, error: "403 forbidden" }),
  });
  h.setHolder(22, BILL);
  const out = await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(out.code, 502);
  assert.match(out.body.error, /403 forbidden/);
});

test("the move cannot be called without a prospect the check found", async () => {
  const h = harness();
  for (const bad of [undefined, 0, -1, "abc", 1.5]) {
    const out = await h.move({ prospectId: bad, fromEmail: BILL, toEmail: CHRIS });
    assert.equal(out.code, 400, `prospectId ${JSON.stringify(bad)}`);
    assert.match(out.body.error, /Run the check first/);
  }
  assert.equal(h.calls.length, 0);
});

test("moving something to the person who already holds it is rejected", async () => {
  const h = harness();
  const out = await h.move({ prospectId: 22, fromEmail: BILL, toEmail: " BILL@WestCapitalLending.com " });
  assert.equal(out.code, 400);
  assert.match(out.body.error, /already assigned/);
});

// ── who may do this, and what is written down ───────────────────────────────

test("both routes are gated, not just the one that writes", async () => {
  // The check reads a borrower's name and who holds them out of the CRM, so it
  // is not a free lookup just because it changes nothing.
  let refusedWith = 0;
  const h = harness({
    requireAccess: (_req: any, res: any) => { refusedWith += 1; res.status(403).json({ error: "CLRs, managers and admins only" }); return false; },
  });
  assert.equal((await h.check(ASK)).code, 403);
  assert.equal((await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS })).code, 403);
  assert.equal(refusedWith, 2);
  assert.equal(h.calls.length, 0);
});

test("every move is written to the audit trail", async () => {
  // Moving somebody's client is exactly the kind of thing that gets disputed
  // later, so who did it and what it did are recorded either way.
  const h = harness();
  h.setHolder(22, BILL);
  await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].action, "bonzo_prospect_reassigned");
  assert.deepEqual(
    { ...h.audits[0].details },
    { prospectId: 22, fromEmail: BILL, toEmail: CHRIS, ok: true, verified: true, nowEmail: CHRIS },
  );
});

test("a refused move is audited too, so a failure is not silent", async () => {
  const h = harness({
    reassignProspectByEmail: async () => ({ ok: false, verified: false, nowEmail: null, error: "403" }),
  });
  h.setHolder(22, BILL);
  await h.move({ prospectId: 22, fromEmail: BILL, toEmail: CHRIS });
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].details.ok, false);
});

// ── who the tool is open to ─────────────────────────────────────────────────

test("CLRs can use it, not only managers", () => {
  // Owner 9/7/26: a CLR working a list is usually the first to notice that a
  // prospect is sitting in the wrong book.
  assert.equal(canUseReassignTool({ role: "assistant" }), true);
  assert.equal(canUseReassignTool({ role: "assistant", isManager: 1 }), true);
  assert.equal(canUseReassignTool({ role: "admin" }), true);
  assert.equal(canUseReassignTool({ role: "assistant", superAdmin: true }), true);
  // An admin flagged as also doing CLR work is in on either count.
  assert.equal(canUseReassignTool({ role: "admin", isClr: true }), true);
});

test("viewers and the LOA portal stay out", () => {
  // A viewer is read-only by definition; the LAP/LOP portals are a different
  // product and their sessions resolve to a shared user row, so the portal has
  // to be checked rather than inferred from the role.
  assert.equal(canUseReassignTool({ role: "viewer" }), false);
  assert.equal(canUseReassignTool({ role: "assistant", portal: "lap" }), false);
  assert.equal(canUseReassignTool({ role: "admin", portal: "lap" }), false);
  assert.equal(canUseReassignTool({ role: "assistant", portal: "lop" }), false);
  assert.equal(canUseReassignTool(null), false);
  assert.equal(canUseReassignTool({}), false);
});

// ── the roster behind the dropdowns ─────────────────────────────────────────

test("LeadVault rows become pickable people", () => {
  const people = peopleFromPayload({
    users: [
      { full_name: "Chris Redoble", email: "Credoble@WestCapitalLending.com", role: "lo", bonzo_user_id: 1000 },
      { full_name: "Bill Neessen", email: "bill@westcapitallending.com", role: "lo", bonzo_user_id: 42 },
    ],
  });
  assert.deepEqual(people.map((p) => p.email),
    ["bill@westcapitallending.com", "credoble@westcapitallending.com"], "sorted by name, lowercased");
  assert.equal(people[1].name, "Chris Redoble");
  assert.equal(people[1].bonzoUserId, 1000);
});

test("a row with no usable address is left out, not shown broken", () => {
  // An option that cannot be moved to is worse than a shorter list: the person
  // picking it has no way to know it will fail.
  const people = peopleFromPayload({ users: [
    { full_name: "No Email", email: "", role: "lo" },
    { full_name: "Spaces", email: "a b@x.com" },
    { full_name: "No At", email: "nope" },
    { full_name: "Fine", email: "fine@x.com" },
  ]});
  assert.deepEqual(people.map((p) => p.email), ["fine@x.com"]);
  assert.equal(normalizePerson({ email: "  " }), null);
});

test("the same person twice collapses to one option", () => {
  const people = peopleFromPayload({ users: [
    { full_name: "Chris", email: "c@x.com" },
    { full_name: "Chris Redoble", email: "C@X.com" },
  ]});
  assert.equal(people.length, 1);
});

test("whatever envelope LeadVault uses, or none, is tolerated", () => {
  const rows = [{ full_name: "A", email: "a@x.com" }];
  for (const payload of [rows, { users: rows }, { los: rows }, { people: rows }]) {
    assert.equal(peopleFromPayload(payload).length, 1, JSON.stringify(payload).slice(0, 30));
  }
  // A shape change degrades to an empty list rather than throwing on a page
  // somebody is trying to use.
  for (const junk of [null, undefined, {}, "nope", 7, { users: "no" }]) {
    assert.deepEqual(peopleFromPayload(junk as any), []);
  }
});

test("the fallback prefers the address Bonzo actually knows them by", () => {
  // bonzo_username is the field that exists precisely because an LO's Bonzo
  // seat is not always their company email.
  const los = [
    { fullName: "Chris Redoble", email: "chris@wcl.com", bonzoUsername: "credoble@westcapitallending.com" },
    { fullName: "No Bonzo Seat", email: "solo@wcl.com", bonzoUsername: "" },
    { fullName: "Nothing", email: "", bonzoUsername: "" },
  ];
  const people = fallbackPeopleFromLos(los);
  assert.deepEqual(people.map((p) => p.email),
    ["credoble@westcapitallending.com", "solo@wcl.com"]);
  assert.equal(people.length, 2, "an LO with no address at all is not an option");
});

test("the fallback is a fallback, and the freshness rules are sane", () => {
  // Served stale for a while, but not so long that somebody who left is still
  // in the dropdown a day later.
  assert.ok(PEOPLE_TTL_MS > 0 && PEOPLE_TTL_MS <= 30 * 60_000);
  assert.ok(PEOPLE_STALE_MAX_MS > PEOPLE_TTL_MS);
  assert.ok(PEOPLE_STALE_MAX_MS <= 24 * 60 * 60_000);
});

test("the roster route is gated like the rest of the tool", async () => {
  let refused = 0;
  const h = harness({
    requireAccess: (_q: any, res: any) => { refused += 1; res.status(403).json({ error: "no" }); return false; },
    people: async () => ({ people: [], source: "none", fetchedAt: null, notice: null }),
  } as any);
  const out = await h.people();
  assert.equal(out.code, 403, "a staff roster with addresses is not a public list");
  assert.equal(refused, 1);
});

test("an empty LeadVault answer is never mistaken for 'nobody works here'", () => {
  // It is far likelier the endpoint changed shape than that the company has no
  // loan officers, so an empty read must fall through rather than cache.
  const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
  const fn = routes.slice(routes.indexOf("function fetchLeadVaultPeople"), routes.indexOf("async function reassignPeople"));
  assert.match(fn, /if \(!people\.length\) return null;/);
  // And the cache is only written on a real answer.
  assert.ok(fn.indexOf("peopleCache = ") > fn.indexOf("if (!people.length) return null;"));
});

test("the roster refreshes itself rather than waiting to be asked", () => {
  const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
  // A cron keeps it warm so the first person of the morning does not pay for
  // the fetch, and a hire reaches the dropdown without anyone asking. Both the
  // timer and the boot warm-up must call the fetch, not just define it.
  const warm = routes.slice(routes.indexOf("async function reassignPeople"));
  const cronAt = warm.indexOf('cron.schedule("*/10 * * * *"');
  const bootAt = warm.indexOf("setTimeout(() => { void fetchLeadVaultPeople");
  assert.ok(cronAt > 0, "refreshed on a timer");
  assert.ok(bootAt > 0, "and warmed shortly after boot");
  assert.match(warm.slice(cronAt, cronAt + 300), /void fetchLeadVaultPeople\(\)/);
});
