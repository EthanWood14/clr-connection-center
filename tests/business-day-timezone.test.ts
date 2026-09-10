import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUSINESS_DAY_ROLLOVER_HOUR, businessTodayClient, businessTodayInTz,
  clientTimezone, setClientTimezone,
} from "../client/src/lib/business-day";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const auth = readFileSync(join(root, "client/src/lib/auth.tsx"), "utf8");

/**
 * The bug: businessTodayClient() read the DEVICE clock, and it stamps the
 * date on every outcome logged in Input Results. Elleine works Manila hours,
 * so 9:51pm her time is past the 7pm rollover and her whole shift was stamped
 * with TOMORROW's date — while the office and the wallboard were still on the
 * day before. She read as zero transfers on the TV every day, then arrived a
 * day late. Her C3 profile said America/Los_Angeles the entire time; nothing
 * was reading it.
 */

// 10 Sep 2026, 21:46 UTC — the instant one of her mis-stamped rows was
// created. 2:46pm in Los Angeles, 5:46am the NEXT DAY in Manila.
const AT = new Date("2026-09-10T21:46:09.965Z");

test("the office day and the Manila day genuinely differ at that moment", () => {
  assert.equal(businessTodayInTz("America/Los_Angeles", AT), "2026-09-10");
  assert.equal(businessTodayInTz("Asia/Manila", AT), "2026-09-11");
});

test("a configured timezone wins over the device", () => {
  setClientTimezone("America/Los_Angeles");
  assert.equal(clientTimezone(), "America/Los_Angeles");
  // Whatever this machine's clock says, the answer is the office's day.
  assert.equal(businessTodayClient(AT), "2026-09-10");
  setClientTimezone(null);
});

test("an evening in the configured zone still rolls over", () => {
  // The fix must not disable the rollover, only decide which clock it reads.
  // 03:00 UTC on the 11th is 8pm on the 10th in Los Angeles — past 7pm.
  setClientTimezone("America/Los_Angeles");
  assert.equal(businessTodayClient(new Date("2026-09-11T03:00:00Z")), "2026-09-11");
  assert.equal(businessTodayClient(new Date("2026-09-11T01:00:00Z")), "2026-09-10");
  setClientTimezone(null);
  assert.equal(BUSINESS_DAY_ROLLOVER_HOUR, 19);
});

test("no configured timezone falls back to the device, as before", () => {
  setClientTimezone(null);
  assert.equal(clientTimezone(), null);
  assert.equal(businessTodayClient(AT), businessTodayInTz(undefined, AT));
  // Blank and whitespace are "not set", not a timezone named "".
  setClientTimezone("");
  assert.equal(clientTimezone(), null);
  setClientTimezone("   ");
  assert.equal(clientTimezone(), null);
  setClientTimezone(undefined);
  assert.equal(clientTimezone(), null);
});

test("auth sets it on load and on refresh, and clears it on the way out", () => {
  // On load, before anything renders.
  assert.match(auth, /setUser\(data\.user \?\? null\);\s*\n[\s\S]{0,400}?setClientTimezone\(data\?\.user\?\.timezone\);/);
  // A shared machine must not keep the last person's zone: the next to sign
  // in would stamp their outcomes in it until auth resolved.
  assert.match(auth, /setUser\(null\);\s*\n[\s\S]{0,300}?setClientTimezone\(null\);/);
  // And a timezone changed in Settings takes effect without a reload.
  const refetch = auth.slice(auth.indexOf("const refetchUser"), auth.indexOf("const refetchUser") + 800);
  assert.match(refetch, /setClientTimezone\(data\?\.user\?\.timezone\)/);
});

test("the reason is written where the next person will find it", () => {
  const mod = readFileSync(join(root, "client/src/lib/business-day.ts"), "utf8");
  assert.match(mod, /USES THEIR CONFIGURED TIMEZONE, NOT THE DEVICE'S/);
  assert.match(mod, /Manila/);
});
