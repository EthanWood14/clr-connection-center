/**
 * Picking the right Bonzo prospect when several share a phone number.
 *
 * The fixtures below are the real Bonzo records for Douglas Cawley, read from
 * the live API on 2026-08-24. A transfer for him was recorded in C3 against
 * Bill Neessen and ended up in Anthony Dimora's account, because the matcher
 * compared display names — Bill Neessen's Bonzo account is called "Billy" —
 * and, finding no match, fell through to whatever prospect Bonzo listed first.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { findProspectByPhone } from "../server/bonzo";

const PHONE = "+1 (231) 307-0906";

const DIMORA = {
  id: 130728614, full_name: "Douglas Frary-Cawley", phone: "+12313070906",
  assigned_to: 108533, created_at: "2026-07-14T20:55:58.000000Z",
  assigned_user: { id: 108533, name: "Anthony Dimora", email: "adimora@westcapitallending.com" },
};
const NEESSEN = {
  id: 76632369, full_name: "Douglas Cawley (CLR Skyler)", phone: "+12313070906",
  assigned_to: 20679, created_at: "2025-11-03T17:34:30.000000Z",
  // The whole bug in one line: the display name is "Billy", not "Bill Neessen".
  assigned_user: { id: 20679, name: "Billy", email: "bneessen@westcapitallending.com" },
};
const PHAN = {
  id: 75946201, full_name: "Douglas Cawley", phone: "+12313070906",
  assigned_to: 3001, created_at: "2025-10-29T16:16:49.000000Z",
  assigned_user: { id: 3001, name: "Andrew Phan", email: "aphan@westcapitallending.com" },
};
const REDOBLE = {
  id: 72733892, full_name: "Douglas Cawley", phone: "+12313070906",
  assigned_to: 4001, created_at: "2025-10-05T04:15:15.000000Z",
  assigned_user: { id: 4001, name: "Christopher Redoble", email: "credoble@westcapitallending.com" },
};

const realFetch = globalThis.fetch;
let requested: string[] = [];

/** Serve the given prospects, in the order Bonzo's search returned them. */
function stubBonzo(order: any[]) {
  requested = [];
  globalThis.fetch = (async (url: any) => {
    const u = String(url);
    requested.push(u);
    const json = (body: any) => new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    if (u.includes("/prospects?search=")) {
      return json({ data: order.map((p) => ({ id: p.id, phone: p.phone })) });
    }
    const m = /\/prospects\/(\d+)$/.exec(u);
    if (m) {
      const found = order.find((p) => String(p.id) === m[1]);
      return found ? json({ data: found }) : new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 404 });
  }) as any;
}

beforeEach(() => { requested = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test("the LO's Bonzo username wins over the name Bonzo happens to display", async () => {
  stubBonzo([DIMORA, NEESSEN, PHAN, REDOBLE]);
  const match = await findProspectByPhone(PHONE, {
    loName: "Bill Neessen",
    bonzoUsername: "Bneessen@westcapitallending.com", // stored with different case
  });
  assert.equal(match.prospect?.id, NEESSEN.id, "must land on Bill Neessen's record, not the first result");
  assert.equal(match.prospect?.matchedBy, "email");
  assert.equal(match.prospect?.loMatches, true);
  assert.notEqual(match.prospect?.id, DIMORA.id, "this is the record the transfer wrongly went to");
});

test("with no username to match on, it refuses to guess rather than picking a stranger", async () => {
  stubBonzo([DIMORA, NEESSEN, PHAN, REDOBLE]);
  // namesMatch("Billy", "Bill Neessen") is false, so nothing matches.
  const match = await findProspectByPhone(PHONE, { loName: "Bill Neessen", bonzoUsername: null });
  assert.equal(match.prospect, null, "silently writing to another LO's prospect is the bug");
  assert.equal(match.reason, "ambiguous");
  assert.equal(match.candidates.length, 4, "and it reports everyone it saw, for the log");
});

test("a matching record is found even when it is not in the first three results", async () => {
  // The old code sliced to 3, so a fourth-placed match was never even fetched.
  stubBonzo([DIMORA, PHAN, REDOBLE, NEESSEN]);
  const match = await findProspectByPhone(PHONE, {
    loName: "Bill Neessen", bonzoUsername: "bneessen@westcapitallending.com",
  });
  assert.equal(match.prospect?.id, NEESSEN.id);
  assert.ok(requested.some((u) => u.endsWith(`/prospects/${NEESSEN.id}`)), "the fourth candidate must be fetched");
});

test("a display name that does match is still honoured", async () => {
  stubBonzo([DIMORA, REDOBLE]);
  const match = await findProspectByPhone(PHONE, { loName: "Christopher Redoble", bonzoUsername: null });
  assert.equal(match.prospect?.id, REDOBLE.id);
  assert.equal(match.prospect?.matchedBy, "name");
});

test("one candidate is not a guess, so it still syncs", async () => {
  stubBonzo([DIMORA]);
  const match = await findProspectByPhone(PHONE, { loName: "Bill Neessen", bonzoUsername: "bneessen@westcapitallending.com" });
  assert.equal(match.prospect?.id, DIMORA.id, "nothing to choose wrongly between");
  assert.equal(match.prospect?.matchedBy, "only-candidate");
  assert.equal(match.prospect?.loMatches, false, "and the caller still warns about the mismatch");
});

test("with no LO named at all, the newest is taken — as documented", async () => {
  // Listed oldest-first to prove it sorts rather than trusting Bonzo's order.
  stubBonzo([REDOBLE, PHAN, NEESSEN, DIMORA]);
  const match = await findProspectByPhone(PHONE);
  assert.equal(match.prospect?.id, DIMORA.id, "2026-07-14 is the newest of the four");
  assert.equal(match.prospect?.matchedBy, "newest");
});

test("a phone nobody has reports none, not ambiguous", async () => {
  stubBonzo([]);
  const match = await findProspectByPhone(PHONE, { loName: "Bill Neessen", bonzoUsername: "bneessen@westcapitallending.com" });
  assert.equal(match.prospect, null);
  assert.equal(match.reason, "none");
});

test("an LO with no bonzo_username still matches on their email", () => {
  // 9 of 22 active LOs have only an email. Matching on bonzo_username alone
  // would drop them straight into "ambiguous" and stop syncing them.
  stubBonzo([DIMORA, NEESSEN, PHAN]);
  return findProspectByPhone(PHONE, { loName: "Andrew Phan", bonzoUsername: null, email: "aphan@westcapitallending.com" })
    .then((match) => {
      assert.equal(match.prospect?.id, PHAN.id);
      assert.equal(match.prospect?.matchedBy, "email");
    });
});

test("bonzo_username beats the contact email when they disagree", () => {
  // Chris Redoble's Bonzo seat is credoble+1@…, not his contact address, so
  // the seat has to win or his transfers land on the wrong record.
  const seat = {
    id: 99001, full_name: "Douglas Cawley", phone: "+12313070906",
    assigned_to: 4002, created_at: "2025-09-01T00:00:00.000000Z",
    assigned_user: { id: 4002, name: "Chris Redoble Retail", email: "credoble+1@westcapitallending.com" },
  };
  stubBonzo([REDOBLE, seat]);
  return findProspectByPhone(PHONE, {
    loName: "Christopher Redoble",
    bonzoUsername: "credoble+1@westcapitallending.com",
    email: "credoble@westcapitallending.com",
  }).then((match) => {
    assert.equal(match.prospect?.id, seat.id, "the Bonzo seat, not the contact email");
    assert.equal(match.prospect?.matchedBy, "email");
  });
});
