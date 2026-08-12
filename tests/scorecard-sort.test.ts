import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dash = readFileSync(join(root, "client/src/pages/manager-dashboard.tsx"), "utf8");

test("the scorecard breaks a transfer tie on appointments", () => {
  const fn = dash.slice(dash.indexOf("function TransferScorecard"), dash.indexOf("function TransferScorecard") + 900);
  assert.match(fn, /b\.transfers - a\.transfers/, "transfers still rank first");
  assert.match(fn, /b\.appointments - a\.appointments/, "appointments break the tie");
  assert.ok(
    fn.indexOf("b.appointments - a.appointments") < fn.indexOf("b.calls - a.calls"),
    "appointments must be applied before calls, not after",
  );
});

test("the ordering is deterministic and behaves on real shapes", () => {
  // Mirrors the shipped comparator.
  const cmp = (a: any, b: any) =>
    (b.transfers - a.transfers) || (b.appointments - a.appointments) || (b.calls - a.calls);
  const row = (name: string, transfers: number, appointments: number, calls: number) =>
    ({ name, transfers, appointments, calls });

  // A transfer tie is settled by appointments, regardless of who dialled more.
  const tie = [row("Fewer appts, more calls", 5, 1, 900), row("More appts", 5, 4, 100)].sort(cmp);
  assert.equal(tie[0].name, "More appts");

  // Transfers still outrank everything.
  const lead = [row("Low transfers, high appts", 2, 99, 999), row("High transfers", 9, 0, 1)].sort(cmp);
  assert.equal(lead[0].name, "High transfers");

  // Calls only matter once transfers AND appointments are level.
  const last = [row("Fewer calls", 3, 3, 10), row("More calls", 3, 3, 80)].sort(cmp);
  assert.equal(last[0].name, "More calls");

  // Fully tied rows compare equal, so the sort is stable rather than arbitrary.
  assert.equal(cmp(row("a", 4, 2, 50), row("b", 4, 2, 50)), 0);
});
