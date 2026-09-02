import { test } from "node:test";
import assert from "node:assert/strict";
import { detectOvertakes, type RankRow } from "../shared/tv-overtake";

const TODAY = "2026-09-02";

/** The feed hands back rows already sorted by today's transfers; so do we. */
const board = (...rows: Array<[number, string, number]>): RankRow[] =>
  rows.map(([id, name, transfersToday]) => ({ id, name, transfersToday }));

// The floor, for readable fixtures.
const ELLEINE = 1, LINDA = 2, TOMMY = 3, MARIA = 4, DEVON = 5;

test("the first poll after a load is silent", () => {
  // The board never replays history. A TV that boots at 4pm must not fire a
  // dozen cars for climbs that happened while nobody was watching it.
  const now = board([ELLEINE, "Elleine Asuncion", 9], [LINDA, "Linda Park", 6]);
  assert.deepEqual(detectOvertakes(null, now, TODAY), []);
  assert.deepEqual(detectOvertakes([], now, TODAY), [], "an empty previous poll is the same thing");
  assert.deepEqual(detectOvertakes(now, [], TODAY), [], "and an empty board has nobody to celebrate");
});

test("a CLR who scores past the person above them is a pass", () => {
  const before = board([LINDA, "Linda Park", 6], [ELLEINE, "Elleine Asuncion", 5]);
  const after = board([ELLEINE, "Elleine Asuncion", 7], [LINDA, "Linda Park", 6]);
  const out = detectOvertakes(before, after, TODAY);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    key: "overtake-2026-09-02-1-linda-park-7",
    passerId: ELLEINE,
    passerName: "Elleine Asuncion",
    passedName: "Linda Park",
    count: 7,
    rank: 1,
  });
});

test("a tie never fires, in either direction", () => {
  // Drawing level is not passing. It is the most common near-miss on the
  // board and the easiest one to fire by accident with a `>=`.
  const before = board([LINDA, "Linda Park", 6], [ELLEINE, "Elleine Asuncion", 4]);
  const level = board([LINDA, "Linda Park", 6], [ELLEINE, "Elleine Asuncion", 6]);
  assert.deepEqual(detectOvertakes(before, level, TODAY), [], "catching up is not passing");
  // Nor does the pair staying level fire anything, however the feed sorts them.
  assert.deepEqual(detectOvertakes(level, board([ELLEINE, "Elleine Asuncion", 6], [LINDA, "Linda Park", 6]), TODAY), []);
  // But breaking a tie upward IS a pass — the rule is "was at-or-behind, is
  // now strictly ahead", so equal-then-ahead counts.
  const ahead = detectOvertakes(level, board([ELLEINE, "Elleine Asuncion", 7], [LINDA, "Linda Park", 6]), TODAY);
  assert.equal(ahead.length, 1);
  assert.equal(ahead[0].passedName, "Linda Park");
});

test("rising because someone above was corrected downward is not a pass", () => {
  // Elleine did not touch the phone. Linda's 9 was two transfers logged to the
  // wrong CLR and a manager fixed it. Nobody gets a car for that.
  const before = board([LINDA, "Linda Park", 9], [ELLEINE, "Elleine Asuncion", 5]);
  const corrected = board([ELLEINE, "Elleine Asuncion", 5], [LINDA, "Linda Park", 3]);
  assert.deepEqual(detectOvertakes(before, corrected, TODAY), []);
});

test("a newcomer cannot overtake, and cannot be overtaken, on the poll they appear", () => {
  const before = board([LINDA, "Linda Park", 6], [ELLEINE, "Elleine Asuncion", 3]);
  // Tommy shows up at the top of the board out of nowhere (a shift starting, a
  // roster edit). He was not behind anyone, so he passed nobody.
  const arrives = board([TOMMY, "Tommy Le", 9], [ELLEINE, "Elleine Asuncion", 7], [LINDA, "Linda Park", 6]);
  const out = detectOvertakes(before, arrives, TODAY);
  assert.equal(out.length, 1, "only Elleine's climb is a pass");
  assert.equal(out[0].passerId, ELLEINE);
  assert.equal(out[0].passedName, "Linda Park");
  // And a newcomer landing BELOW a climber was not passed either — Elleine is
  // named against Linda, the person she was actually behind.
  const withRookie = detectOvertakes(before, [...arrives, { id: MARIA, name: "Maria Alvarez", transfersToday: 1 }], TODAY);
  assert.equal(withRookie.length, 1);
  assert.equal(withRookie[0].passedName, "Linda Park");
});

test("a CLR who left the board is neither passer nor passed", () => {
  // Devon went home; his row is gone from this poll. Linda's climb has nobody
  // left to have climbed over, so the board stays quiet.
  const before = board([DEVON, "Devon Ruiz", 6], [LINDA, "Linda Park", 2]);
  assert.deepEqual(detectOvertakes(before, board([LINDA, "Linda Park", 7]), TODAY), []);
});

test("one jump of several places is ONE car, naming the highest-ranked person passed", () => {
  // Six transfers land in one poll and Maria goes from last to second. That is
  // one story about passing Linda, not three cars in a row.
  const before = board(
    [TOMMY, "Tommy Le", 10], [LINDA, "Linda Park", 8], [ELLEINE, "Elleine Asuncion", 5], [MARIA, "Maria Alvarez", 3],
  );
  const after = board(
    [TOMMY, "Tommy Le", 10], [MARIA, "Maria Alvarez", 9], [LINDA, "Linda Park", 8], [ELLEINE, "Elleine Asuncion", 5],
  );
  const out = detectOvertakes(before, after, TODAY);
  assert.equal(out.length, 1, "one passer, one moment");
  assert.equal(out[0].passerName, "Maria Alvarez");
  assert.equal(out[0].passedName, "Linda Park", "the top of the group passed, not Elleine at the bottom of it");
  assert.equal(out[0].rank, 2);
  assert.equal(out[0].count, 9);
  // Tommy is still ahead at 10, so he is not in the story at all.
  assert.equal(out[0].passedName === "Tommy Le", false);
});

test("two CLRs passing in the same poll both come back, best rank first", () => {
  const before = board(
    [TOMMY, "Tommy Le", 9], [LINDA, "Linda Park", 7], [ELLEINE, "Elleine Asuncion", 6],
    [MARIA, "Maria Alvarez", 4], [DEVON, "Devon Ruiz", 2],
  );
  const after = board(
    [ELLEINE, "Elleine Asuncion", 10], [TOMMY, "Tommy Le", 9], [DEVON, "Devon Ruiz", 8],
    [LINDA, "Linda Park", 7], [MARIA, "Maria Alvarez", 4],
  );
  const out = detectOvertakes(before, after, TODAY);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.passerName), ["Elleine Asuncion", "Devon Ruiz"]);
  assert.deepEqual(out.map((o) => o.rank), [1, 3], "the caller plays one at a time, so the better rank leads");
  assert.equal(out[0].passedName, "Tommy Le");
  assert.equal(out[1].passedName, "Linda Park", "Devon passed Maria too, but Linda stood higher");
  // Every key is its own, so neither swallows the other in the played set.
  assert.equal(new Set(out.map((o) => o.key)).size, 2);
});

test("nobody at zero overtakes anybody, and nobody is overtaken at zero", () => {
  const zeros = board([LINDA, "Linda Park", 0], [ELLEINE, "Elleine Asuncion", 0]);
  assert.deepEqual(detectOvertakes(zeros, zeros, TODAY), []);
  // 0-0 reordered by the feed's own sort is still 0-0.
  assert.deepEqual(detectOvertakes(zeros, board([ELLEINE, "Elleine Asuncion", 0], [LINDA, "Linda Park", 0]), TODAY), []);
  // The first transfer of the day is a transfer, not a race. Without this,
  // every CLR breaking out of the 9am zero pack fires a car for passing people
  // who have not started — six cars before the coffee is cold.
  assert.deepEqual(detectOvertakes(zeros, board([LINDA, "Linda Park", 1], [ELLEINE, "Elleine Asuncion", 0]), TODAY), []);
  // Clearing someone who IS on the board still counts, and they are the one
  // named — the two CLRs still on nothing are not part of the story.
  const out = detectOvertakes(
    board([TOMMY, "Tommy Le", 2], [LINDA, "Linda Park", 0], [ELLEINE, "Elleine Asuncion", 0]),
    board([ELLEINE, "Elleine Asuncion", 3], [TOMMY, "Tommy Le", 2], [LINDA, "Linda Park", 0]),
    TODAY,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].passerName, "Elleine Asuncion");
  assert.equal(out[0].passedName, "Tommy Le");
});

test("the key is stable across identical polls, and changes with the day", () => {
  // The screen remembers played keys in localStorage. If this key wobbled, the
  // same car would play every ten seconds until the numbers moved again.
  const before = board([LINDA, "Linda Park", 6], [ELLEINE, "Elleine Asuncion", 5]);
  const after = board([ELLEINE, "Elleine Asuncion", 7], [LINDA, "Linda Park", 6]);
  const a = detectOvertakes(before, after, TODAY);
  const b = detectOvertakes(before, after, TODAY);
  assert.deepEqual(a, b);
  assert.equal(a[0].key, b[0].key);
  // Tomorrow the same pass is a new moment and plays again.
  const tomorrow = detectOvertakes(before, after, "2026-09-03");
  assert.notEqual(tomorrow[0].key, a[0].key);
  assert.match(tomorrow[0].key, /^overtake-2026-09-03-/);
  // And a name with punctuation still yields one clean, single word-run key.
  const odd = detectOvertakes(
    board([LINDA, "Mary-Jo O'Brien", 6], [ELLEINE, "Elleine Asuncion", 5]),
    board([ELLEINE, "Elleine Asuncion", 7], [LINDA, "Mary-Jo O'Brien", 6]),
    TODAY,
  );
  assert.equal(odd[0].key, "overtake-2026-09-02-1-mary-jo-o-brien-7");
});
