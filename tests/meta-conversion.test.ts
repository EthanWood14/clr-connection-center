import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  META_CONVERSION_DEFAULT_DAYS,
  META_CONVERSION_STALE_MAX_MS,
  META_CONVERSION_TTL_MS,
  flowsFromPayload,
  metaConversion,
  parseMetaConversionDays,
  resetMetaConversionCache,
} from "../server/leadvault-meta-conversion";

const OK_PAYLOAD = {
  days: 28,
  generated_at: "2026-09-09T22:00:00.000Z",
  flows: [
    { flow: "established_meta", leads: 508, transferred: 183, rate: 36 },
    { flow: "desync_retail_meta", leads: 169, transferred: 45, rate: 26.6 },
  ],
};

function stubFetch(impl: (url: string, init?: any) => Promise<any>) {
  const original = globalThis.fetch;
  (globalThis as any).fetch = impl;
  return () => { (globalThis as any).fetch = original; };
}

const deps = (over: Partial<{ token: () => string; baseUrl: () => string; now: () => number }> = {}) => ({
  token: over.token ?? (() => "tok"),
  baseUrl: over.baseUrl ?? (() => "https://lv.example"),
  now: over.now,
});

test("window whitelist is the injection guard", () => {
  for (const d of [7, 14, 28, 30, 90]) {
    assert.equal(parseMetaConversionDays(d), d);
    assert.equal(parseMetaConversionDays(String(d)), d);
  }
  for (const bad of [null, undefined, "", "abc", 0, -1, 9999, "28; drop table leads"]) {
    assert.equal(parseMetaConversionDays(bad), META_CONVERSION_DEFAULT_DAYS);
  }
});

test("a flow with zero leads is real data, not a failed read", () => {
  // This is the one place this module deliberately differs from
  // leadvault-newest-leads.ts, which treats empty as failure. A Meta pipe that
  // has gone silent is exactly what this card should show.
  const flows = flowsFromPayload({
    flows: [
      { flow: "established_meta", leads: 0, transferred: 0, rate: 0 },
      { flow: "desync_retail_meta", leads: 169, transferred: 45, rate: 26.6 },
    ],
  });
  assert.ok(flows);
  assert.equal(flows!.length, 2);
  assert.equal(flows![0].leads, 0);
});

test("a missing or non-array flows field IS a failed read", () => {
  assert.equal(flowsFromPayload(null), null);
  assert.equal(flowsFromPayload({}), null);
  assert.equal(flowsFromPayload({ flows: "nope" }), null);
  assert.equal(flowsFromPayload({ flows: [] }), null);
});

test("unusable counts are dropped rather than rendered as NaN", () => {
  const flows = flowsFromPayload({
    flows: [
      { flow: "established_meta", leads: "oops", transferred: 1 },
      { flow: "desync_retail_meta", leads: 10, transferred: 3 },
    ],
  });
  assert.equal(flows!.length, 1);
  assert.equal(flows![0].flow, "desync_retail_meta");
  assert.equal(flows![0].rate, 30);
});

test("no token means the feature is off, not broken", async () => {
  resetMetaConversionCache();
  const restore = stubFetch(async () => { throw new Error("must not be called"); });
  try {
    const out = await metaConversion(28, deps({ token: () => "" }));
    assert.equal(out.configured, false);
    assert.deepEqual(out.flows, []);
  } finally { restore(); }
});

test("the token travels in the header, never the query string", async () => {
  resetMetaConversionCache();
  let seenUrl = "";
  let seenToken = "";
  const restore = stubFetch(async (url: string, init: any) => {
    seenUrl = url;
    seenToken = init?.headers?.["x-api-token"] ?? "";
    return { ok: true, json: async () => OK_PAYLOAD };
  });
  try {
    await metaConversion(28, deps());
    assert.equal(seenToken, "tok");
    assert.ok(!/[?&]token=/.test(seenUrl), "token must not appear in the URL");
    assert.ok(seenUrl.includes("/api/clr/meta-conversion?days=28"));
  } finally { restore(); }
});

test("serves from cache inside the TTL without calling upstream again", async () => {
  resetMetaConversionCache();
  let calls = 0;
  const restore = stubFetch(async () => { calls++; return { ok: true, json: async () => OK_PAYLOAD }; });
  try {
    const t0 = 1_000_000;
    await metaConversion(28, deps({ now: () => t0 }));
    const again = await metaConversion(28, deps({ now: () => t0 + META_CONVERSION_TTL_MS - 1 }));
    assert.equal(calls, 1);
    assert.equal(again.stale, false);
    assert.equal(again.flows.length, 2);
  } finally { restore(); }
});

test("past the TTL it serves stale immediately and refreshes behind", async () => {
  resetMetaConversionCache();
  let calls = 0;
  const restore = stubFetch(async () => { calls++; return { ok: true, json: async () => OK_PAYLOAD }; });
  try {
    const t0 = 2_000_000;
    await metaConversion(28, deps({ now: () => t0 }));
    const out = await metaConversion(28, deps({ now: () => t0 + META_CONVERSION_TTL_MS + 1 }));
    assert.equal(out.stale, true);
    assert.equal(out.flows.length, 2, "stale copy still renders");
  } finally { restore(); }
});

test("an upstream failure with no cache reports stale-empty, not zeroes", async () => {
  resetMetaConversionCache();
  const restore = stubFetch(async () => ({ ok: false, json: async () => ({}) }));
  try {
    const out = await metaConversion(28, deps());
    assert.equal(out.configured, true);
    assert.deepEqual(out.flows, []);
    // The card keys off exactly this to say "couldn't reach LeadVault" rather
    // than drawing a chart of zeroes, which would read as "Meta died".
    assert.equal(out.stale, true);
  } finally { restore(); }
});

test("a thrown fetch is caught, not propagated to the dashboard", async () => {
  resetMetaConversionCache();
  const restore = stubFetch(async () => { throw new Error("network down"); });
  try {
    const out = await metaConversion(28, deps());
    assert.equal(out.flows.length, 0);
    assert.equal(out.stale, true);
  } finally { restore(); }
});

test("stale window is longer than the TTL", () => {
  assert.ok(META_CONVERSION_STALE_MAX_MS > META_CONVERSION_TTL_MS);
});

test("route is registered behind requireAuth and passes the shared token", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  assert.ok(routes.includes('app.get("/api/meta-conversion", requireAuth'));
  const start = routes.indexOf('app.get("/api/meta-conversion"');
  const body = routes.slice(start, start + 600);
  assert.ok(body.includes("metaConversion("));
  assert.ok(body.includes("token: leadvaultReportingToken"));
});

test("the dashboard card hides itself when LeadVault is unconfigured", () => {
  const page = readFileSync(new URL("../client/src/pages/manager-dashboard.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("metaConv.data?.configured ?"), "card must gate on configured");
  // Its own query — folding it into /api/manager-dashboard would put a
  // LeadVault round-trip on the whole page's critical path.
  assert.ok(page.includes('queryKey: [`/api/meta-conversion?days=${metaDays}`]'));
  assert.ok(page.includes("Couldn&apos;t reach LeadVault"), "must distinguish failure from zero");
});

// ── The Refresh button (owner 10 Sep 2026) ─────────────────────────────────
// A half-hour cache is the right default and the wrong answer when somebody
// has just changed something in Bonzo and wants to see it land.

test("Refresh reads upstream again even though the cache is fresh", async () => {
  resetMetaConversionCache();
  let calls = 0;
  const restore = stubFetch(async () => {
    calls++;
    return { ok: true, json: async () => OK_PAYLOAD } as any;
  });
  try {
    const t0 = 1_000_000;
    await metaConversion(28, deps({ now: () => t0 }));
    assert.equal(calls, 1);
    // Inside the TTL: an ordinary read must NOT go upstream…
    await metaConversion(28, deps({ now: () => t0 + 1_000 }));
    assert.equal(calls, 1, "the cache still absorbs ordinary reads");
    // …but a forced one must, once the force cooldown allows it.
    const forced = await metaConversion(28, deps({ now: () => t0 + 61_000 }), { force: true });
    assert.equal(calls, 2, "Refresh has to actually ask LeadVault");
    assert.equal(forced.stale, false);
    assert.equal(forced.throttled, undefined);
  } finally { restore(); resetMetaConversionCache(); }
});

test("holding the button down costs LeadVault nothing", async () => {
  resetMetaConversionCache();
  let calls = 0;
  const restore = stubFetch(async () => {
    calls++;
    return { ok: true, json: async () => OK_PAYLOAD } as any;
  });
  try {
    const t0 = 2_000_000;
    const first = await metaConversion(28, deps({ now: () => t0 }), { force: true });
    assert.equal(calls, 1);
    assert.equal(first.throttled, undefined);
    // Three more presses inside the minute: same answer, no round trips, and
    // the card is told so rather than being left to flash a spinner over an
    // unchanged number.
    for (const at of [t0 + 1_000, t0 + 30_000, t0 + 59_999]) {
      const again = await metaConversion(28, deps({ now: () => at }), { force: true });
      assert.equal(again.throttled, true);
      assert.equal(again.stale, false, "a throttled answer is current, not stale");
      assert.deepEqual(again.flows, first.flows);
    }
    assert.equal(calls, 1, "one forced read per window per minute");
  } finally { restore(); resetMetaConversionCache(); }
});

test("a failed Refresh falls back to the cached copy rather than blanking", async () => {
  resetMetaConversionCache();
  let calls = 0;
  const restore = stubFetch(async () => {
    calls++;
    if (calls === 1) return { ok: true, json: async () => OK_PAYLOAD } as any;
    return { ok: false, json: async () => ({}) } as any;
  });
  try {
    const t0 = 3_000_000;
    await metaConversion(28, deps({ now: () => t0 }));
    const forced = await metaConversion(28, deps({ now: () => t0 + 61_000 }), { force: true });
    assert.equal(calls, 2);
    assert.equal(forced.flows.length, 2, "the numbers must not vanish because a refresh failed");
    // Not "stale": the cached copy is a minute old and perfectly good. What
    // failed is the REFRESH, and that is the thing the person who pressed the
    // button needs told.
    assert.equal(forced.stale, false);
    assert.equal(forced.refreshFailed, true);
  } finally { restore(); resetMetaConversionCache(); }
});

test("Refresh is wired end to end: route, button, and no self-defeating invalidate", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../client/src/pages/manager-dashboard.tsx", import.meta.url), "utf8");
  const fn = routes.slice(routes.indexOf('app.get("/api/meta-conversion"'), routes.indexOf("async function leadvaultCallToolsByDay"));
  assert.match(fn, /req\.query\.refresh === "1"/);
  assert.match(fn, /\{ force \}/);
  assert.match(page, /data-testid="button-refresh-meta-conversion"/);
  assert.match(page, /days=\$\{metaDays\}&refresh=1/);
  // An invalidate here would re-fetch WITHOUT ?refresh=1 and could overwrite
  // the copy the button just pulled with the one it was getting past.
  const mutation = page.slice(page.indexOf("const refreshMeta = useMutation"), page.indexOf("const metaFetchedAgo"));
  assert.match(mutation, /queryClient\.setQueryData/);
  assert.ok(!/invalidateQueries/.test(mutation), "must not invalidate its own result away");
});
