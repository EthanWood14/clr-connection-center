import { test } from "node:test";
import assert from "node:assert/strict";
import { showsFieldRace } from "../shared/tv-field-race";

test("field-race selection stays stable and samples approximately 15%", () => {
  let picked = 0;
  for (let n = 0; n < 10000; n++) {
    const id = `transfer:${n}`;
    assert.equal(showsFieldRace(id), showsFieldRace(id));
    if (showsFieldRace(id)) picked++;
  }
  assert.ok(picked > 1300 && picked < 1700, String(picked));
});
