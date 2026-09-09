import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loEmailsFor, losFromPayload, newestLeadsCacheKey, newestLeadsForLos,
  resetNewestLeadsCache, NEWEST_LEADS_TTL_MS,
} from "../server/leadvault-newest-leads";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const routes = read("server/routes.ts");
const page = read("client/src/pages/assignments.tsx");

const payload = (emails: string[]) => ({
  los: emails.map((email, i) => ({
    email, name: `LO ${i}`,
    leads: [{ externalId: String(i), borrowerName: `Borrower ${i}`, landedAt: "2026-09-09T19:00:00Z" }],
  })),
});

function stubDeps(calls: { n: number }, body: unknown = payload(["a@wcl.com"])) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => {
    calls.n++;
    return { ok: true, json: async () => body } as any;
  };
  return () => { (globalThis as any).fetch = original; };
}

const deps = { token: () => "tok", baseUrl: () => "https://lv.example" };

test("the loan officer is matched by Bonzo login, never by contact email", () => {
  // Leads are owned by a BONZO user. An LO's contact address is frequently a
  // different one, and matching on it would find nothing — or somebody else's
  // leads, which is worse.
  const los = [
    { id: 1, bonzoUsername: "BNeessen@westcapitallending.com", email: "bill@personal.com" },
    { id: 2, bonzo_username: "smurphy@westcapitallending.com" },
    { id: 3, email: "only-contact@westcapitallending.com" },
    { id: 4, bonzoUsername: "  " },
    { id: 5, bonzoUsername: "not-an-address" },
    { id: 6, bonzoUsername: "bneessen@westcapitallending.com" },
  ];
  assert.deepEqual(loEmailsFor(los), [
    "bneessen@westcapitallending.com",
    "smurphy@westcapitallending.com",
  ], "lowercased, de-duplicated, and only Bonzo logins");
});

test("the cache key is the SET of loan officers, not their order", () => {
  // Two CLRs given the same three LOs must share one upstream call. A key that
  // varied with order would multiply the traffic by the number of arrangements.
  const a = newestLeadsCacheKey(["b@x.com", "a@x.com"], 72, 1);
  const b = newestLeadsCacheKey(["A@x.com", "b@x.com", "a@x.com"], 72, 1);
  assert.equal(a, b);
  // …but a different window, depth, or list is a different question.
  assert.notEqual(a, newestLeadsCacheKey(["b@x.com", "a@x.com"], 24, 1));
  assert.notEqual(a, newestLeadsCacheKey(["b@x.com", "a@x.com"], 72, 3));
  assert.notEqual(a, newestLeadsCacheKey(["b@x.com", "c@x.com"], 72, 1));
});

test("a poll from the whole floor is one upstream call", async () => {
  resetNewestLeadsCache();
  const calls = { n: 0 };
  const restore = stubDeps(calls);
  try {
    const emails = ["a@wcl.com"];
    await newestLeadsForLos(emails, { hours: 72, per: 1 }, deps);
    // Same set, asked ten more times inside the TTL.
    for (let i = 0; i < 10; i++) await newestLeadsForLos(emails, { hours: 72, per: 1 }, deps);
    assert.equal(calls.n, 1, "the cache must absorb the repeat polls");
  } finally { restore(); resetNewestLeadsCache(); }
});

test("concurrent cold callers share one request", async () => {
  resetNewestLeadsCache();
  const calls = { n: 0 };
  const restore = stubDeps(calls);
  try {
    await Promise.all(Array.from({ length: 8 }, () =>
      newestLeadsForLos(["a@wcl.com"], { hours: 72, per: 1 }, deps)));
    assert.equal(calls.n, 1, "eight CLRs opening the page together is still one fetch");
  } finally { restore(); resetNewestLeadsCache(); }
});

test("an unset token is off, not broken", async () => {
  resetNewestLeadsCache();
  const calls = { n: 0 };
  const restore = stubDeps(calls);
  try {
    const r = await newestLeadsForLos(["a@wcl.com"], { hours: 72, per: 1 }, { ...deps, token: () => "" });
    assert.equal(r.configured, false);
    assert.deepEqual(r.los, []);
    assert.equal(calls.n, 0, "nothing may be fetched without a credential");
  } finally { restore(); resetNewestLeadsCache(); }
});

test("a failed read is not an empty list", async () => {
  resetNewestLeadsCache();
  const original = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) }) as any;
  try {
    const r = await newestLeadsForLos(["a@wcl.com"], { hours: 72, per: 1 }, deps);
    // "Nothing landed" and "we could not ask" are different answers, and a CLR
    // would act on them differently.
    assert.equal(r.stale, true);
    assert.equal(r.fetchedAt, null);
  } finally { (globalThis as any).fetch = original; resetNewestLeadsCache(); }
});

test("a stale copy is served immediately rather than making anyone wait", async () => {
  resetNewestLeadsCache();
  const calls = { n: 0 };
  const restore = stubDeps(calls);
  try {
    const emails = ["a@wcl.com"];
    await newestLeadsForLos(emails, { hours: 72, per: 1 }, deps);
    // Past the TTL: the answer still comes back, and a refresh runs behind it.
    const later = { ...deps, now: () => Date.now() + NEWEST_LEADS_TTL_MS + 1_000 };
    const r = await newestLeadsForLos(emails, { hours: 72, per: 1 }, later);
    assert.equal(r.los.length, 1);
    assert.equal(r.stale, true);
  } finally { restore(); resetNewestLeadsCache(); }
});

test("a payload that changed shape is refused, not half-read", () => {
  assert.deepEqual(losFromPayload(null), []);
  assert.deepEqual(losFromPayload({ los: "nope" }), []);
  assert.deepEqual(losFromPayload({ los: [{ nope: 1 }] }), []);
  const ok = losFromPayload({ los: [{ email: "A@X.com", name: "N", leads: null }] });
  assert.deepEqual(ok, [{ email: "a@x.com", name: "N", leads: [] }]);
});

test("the route asks about the signed-in CLR's own assignments", () => {
  const fn = routes.slice(routes.indexOf('app.get("/api/lo-newest-leads"'), routes.indexOf("async function leadvaultCallToolsByDay"));
  assert.match(fn, /requireAuth/);
  assert.match(fn, /\(a\.assistantId \?\? a\.assistant_id\) === userId/, "their list, not the whole floor's");
  // The explicit override exists for the call-script page, and is capped so
  // one caller cannot ask about the whole company behind a poll.
  assert.match(fn, /explicit\.slice\(0, 40\)/);
  // The token never goes in the URL.
  const client = read("server/leadvault-newest-leads.ts");
  assert.match(client, /headers: \{ "x-api-token": token/);
  assert.ok(!/[?&]token=/.test(client), "the token must not travel in a query string");
});

test("the card says nothing when there is nothing to say", () => {
  const fn = page.slice(page.indexOf("function NewestLeadsCard()"), page.indexOf("/** \"12m ago\""));
  assert.match(fn, /if \(!data\?\.configured\) return null;/);
  assert.match(fn, /if \(rows\.length === 0\) return null;/);
  // Newest first — the whole point is which call to pick up.
  assert.match(fn, /sort\(\(a, b\) =>/);
  assert.match(fn, /refetchInterval: 20_000/);
  assert.match(page, /<NewestLeadsCard \/>/);
});
