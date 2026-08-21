/**
 * A failed request must not be mistaken for a signed-out user.
 *
 * The auth check was a bare fetch whose `.catch` cleared the user, so any
 * 502, timeout or dropped connection sent someone to the login screen with a
 * perfectly valid seven-day cookie still in the browser. Under the load of the
 * one-second Shotgun poll that happened all day, to everyone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const auth = readFileSync(join(root, "client/src/lib/auth.tsx"), "utf8");
const queryClient = readFileSync(join(root, "client/src/lib/queryClient.ts"), "utf8");

test("a failed request carries its HTTP status so callers can tell 401 from 502", () => {
  const block = queryClient.slice(queryClient.indexOf("export async function apiRequest"), queryClient.indexOf("export const queryClient"));
  assert.match(block, /failure\.status = res\.status/,
    "without the status every caller sees an indistinguishable Error");
  assert.match(block, /throw failure/);
});

test("only a 401 clears the session", () => {
  const start = auth.indexOf("const refetchUser");
  assert.notEqual(start, -1, "refetchUser must still exist");
  const refetch = auth.slice(start, auth.indexOf("<AuthContext.Provider", start));
  assert.ok(refetch.length > 0, "the slice must actually cover refetchUser");
  assert.match(refetch, /if \(error\?\.status === 401\) setUser\(null\)/,
    "a mid-session refresh that fails for any other reason must leave the user signed in");
  assert.doesNotMatch(refetch, /catch \{\s*setUser\(null\);\s*\}/,
    "an unconditional catch is what logged everybody out");
});

test("the auth check retries a transient failure instead of giving up on the first one", () => {
  const helper = auth.slice(auth.indexOf("async function fetchMe"), auth.indexOf("export function AuthProvider"));
  assert.match(helper, /if \(error\?\.status === 401\) throw error/, "a real 401 must not be retried");
  assert.match(helper, /attempt < attempts - 1/, "and every other failure must back off and try again");
  assert.match(helper, /setTimeout/);
});

test("both auth reads go through the retrying helper", () => {
  const provider = auth.slice(auth.indexOf("export function AuthProvider"));
  assert.match(provider, /fetchMe\(\)\s*\n?\s*\.then/, "the initial load");
  assert.match(provider, /await fetchMe\(\)/, "and the refresh");
  assert.doesNotMatch(
    provider.slice(0, provider.indexOf("const logout")),
    /apiRequest\("GET", "\/api\/auth\/me"\)/,
    "no raw unretried auth read may remain",
  );
});
