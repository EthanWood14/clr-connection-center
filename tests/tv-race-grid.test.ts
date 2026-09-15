import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { raceGrid, raceTrackPoint, type RaceDriver } from "../shared/tv-race-grid";

const close = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} should equal ${expected}`);

const driver = (id: number, transfersToday: number, name = `Driver ${String(id).padStart(3, "0")}`): RaceDriver =>
  ({ id, name, transfersToday });

test("an empty race has no invented drivers", () => {
  assert.deepEqual(raceGrid([]), []);
});

test("a singleton starts in first with no gap and a finite grid position", () => {
  for (const score of [0, 0.5, 1, 17.5]) {
    const [row] = raceGrid([driver(27, score, "Solo")]);
    assert.equal(row.id, 27);
    assert.equal(row.name, "Solo");
    assert.equal(row.transfersToday, score);
    assert.equal(row.rank, 1);
    assert.equal(row.gap, 0);
    assert.equal(row.distance, 0);
    assert.equal(row.lane, 0);
    assert.match(row.color, /^#[0-9a-f]{6}$/i);
  }
});

test("the race preserves actual credit and competition ranks, including half-credit ties", () => {
  const rows = raceGrid([
    driver(6, 0, "Finn"),
    driver(4, 4.5, "Dee"),
    driver(2, 8, "Bea"),
    driver(5, 4.5, "Eli"),
    driver(3, 7.5, "Cam"),
    driver(1, 8, "Ana"),
  ]);
  assert.deepEqual(rows.map(row => row.id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(rows.map(row => row.rank), [1, 1, 3, 4, 4, 6]);
  assert.deepEqual(rows.map(row => row.transfersToday), [8, 8, 7.5, 4.5, 4.5, 0]);
  assert.deepEqual(rows.map(row => row.gap), [0, 0, 0.5, 3.5, 3.5, 8]);
  assert.deepEqual(rows.map(row => row.index), [0, 1, 2, 3, 4, 5]);
});

test("building the grid neither sorts nor annotates the caller's objects", () => {
  const people = [driver(3, 1), driver(1, 4.5), driver(2, 4.5)];
  const original = people.map(row => ({ ...row }));
  people.forEach(row => Object.freeze(row));
  Object.freeze(people);
  const rows = raceGrid(people);
  assert.deepEqual(people, original);
  assert.notEqual(rows, people);
  for (const row of rows) assert.notEqual(row, people.find(person => person.id === row.id));
});

test("input ordering does not change a driver's rank, lane, color, or forward position", () => {
  const people = [driver(9, 6, "Zoe"), driver(1, 6, "Ana"), driver(7, 2.5), driver(4, 0)];
  assert.deepEqual(raceGrid(people), raceGrid([...people].reverse()));
  assert.deepEqual(raceGrid(people), raceGrid([people[2], people[0], people[3], people[1]]));
});

test("score gaps move cars backward without turning ties or name order into passes", () => {
  const rows = raceGrid([
    driver(1, 9), driver(2, 9), driver(3, 8.5), driver(4, 8), driver(5, 8), driver(6, 0),
  ]);
  for (let i = 1; i < rows.length; i++) {
    const ahead = rows[i - 1], behind = rows[i];
    if (ahead.transfersToday === behind.transfersToday) {
      assert.equal(ahead.distance, behind.distance);
      assert.equal(ahead.rank, behind.rank);
    } else {
      assert.ok(behind.distance > ahead.distance, "less credit must always place a car farther back");
      assert.ok(behind.distance - ahead.distance >= 4.8, "half-credit neighbors need readable separation");
    }
  }
});

test("ties fill bounded, symmetric lanes without changing their shared race progress", () => {
  for (const size of [2, 3, 5, 7, 12, 24, 48, 64]) {
    const rows = raceGrid(Array.from({ length: size }, (_, index) => driver(index + 1, 4.5)));
    assert.equal(rows.length, size);
    assert.equal(new Set(rows.map(row => row.lane)).size, size, "each tied car gets its own lateral center");
    close(rows.reduce((sum, row) => sum + row.lane, 0), 0, "a tied pack stays centered on the road");
    for (const row of rows) {
      assert.equal(row.rank, 1);
      assert.equal(row.distance, 0);
      assert.ok(Math.abs(row.lane) <= 8, "ties must not spill their centers beyond the lane bounds");
      close(row.lane, -rows[size - 1 - row.index].lane);
    }
  }
});

test("an all-zero field is tied rather than assigned fabricated starting positions", () => {
  const rows = raceGrid(Array.from({ length: 20 }, (_, index) => driver(index + 1, 0)));
  assert.equal(rows.length, 20);
  for (const row of rows) {
    assert.equal(row.transfersToday, 0);
    assert.equal(row.rank, 1);
    assert.equal(row.gap, 0);
    assert.equal(row.distance, 0);
  }
});

test("driver colors follow identity when scoring changes the order", () => {
  const before = raceGrid([driver(1, 8), driver(2, 7.5), driver(14, 1)]);
  const after = raceGrid([driver(1, 8), driver(2, 9), driver(14, 2)]);
  for (const row of before) assert.equal(after.find(next => next.id === row.id)?.color, row.color);
});

test("saved paint and livery follow the driver without changing credit or race position", () => {
  const base = [driver(1, 8), driver(2, 7.5), driver(3, 7.5)];
  const plain = raceGrid(base);
  const appearance = { bodyColor: "#123abc", accentColor: "#fedcba", livery: "double-stripe" as const };
  const custom = raceGrid(base.map(row => ({ ...row, car: appearance })));
  for (let i=0;i<custom.length;i++) {
    assert.deepEqual(custom[i].car, appearance);
    assert.equal(custom[i].color, appearance.bodyColor);
    for (const key of ["id", "name", "rank", "gap", "distance", "lane", "transfersToday"] as const) {
      assert.equal(custom[i][key], plain[i][key]);
    }
  }
});

test("legacy feeds and invalid appearance data fall back to stable default cars", () => {
  const [legacy] = raceGrid([driver(1, 2)]);
  const [invalid] = raceGrid([{ ...driver(1, 2), car: { bodyColor: "url(https://example.invalid)", accentColor: null, livery: "turbo" } as any }]);
  assert.deepEqual(invalid, legacy);
  assert.equal(legacy.color, "#49b8ec");
  assert.equal(legacy.car.livery, "stripe");
});

test("custom pictures follow their driver without affecting race credit, order, gaps or motion", () => {
  const base = [driver(1, 8), driver(2, 7.5), driver(3, 7.5)];
  const plain = raceGrid(base);
  const wrapUrl = `/api/tv/${"a".repeat(32)}/cars/2/wrap?v=${"b".repeat(64)}`;
  const wrapped = raceGrid(base.map(row => row.id === 2 ? { ...row, car: { bodyColor: "#123abc", accentColor: "#fedcba", livery: "stripe" as const, wrapUrl } } : row));
  assert.equal(wrapped.find(row => row.id === 2)?.car.wrapUrl, wrapUrl);
  for (let i = 0; i < plain.length; i++) {
    for (const key of ["id", "name", "rank", "gap", "distance", "lane", "transfersToday"] as const) {
      assert.equal(wrapped[i][key], plain[i][key]);
    }
  }
  const malicious = raceGrid([{ ...base[0], car: { ...plain[0].car, wrapUrl: "https://external.invalid/tracking.png" } }]);
  assert.equal(malicious[0].car.wrapUrl, undefined);
});

test("TV propagates org-scoped cosmetics into both manual and earned race scenes", () => {
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  const tv = readFileSync(new URL("../client/src/pages/tv.tsx", import.meta.url), "utf8");
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  assert.match(routes, /FROM tv_car_preferences WHERE org_id=\?[\s\S]{0,50}\.all\(orgId\)/);
  assert.match(routes, /car: normalizeTvCarAppearance\(\{\s*\.\.\.carPreferences\.get\(Number\(c\.id\)\)/);
  assert.match(routes, /FROM tv_car_wraps WHERE org_id=\?[\s\S]{0,50}\.all\(orgId\)/);
  assert.match(routes, /wrapUrl: displayTvCarWrapUrl\(req\.params\.token, Number\(c\.id\), carWrapVersions\.get\(Number\(c\.id\)\)!\)/);
  assert.match(tv, /const standings: RankRow\[\].*car: p\.car/);
  assert.match(scene, /accent=material\(driver\.car\.accentColor/);
  assert.match(scene, /driver\.car\.livery==="double-stripe"/);
  assert.match(scene, /driver\.car\.livery==="stripe"\?\[0\]:\[\]/);
});

test("track points follow the circular corner at the cardinal angles", () => {
  for (const [angle, x, z] of [
    [0, 42, 0],
    [Math.PI / 2, 0, 42],
    [Math.PI, -42, 0],
    [-Math.PI / 2, 0, -42],
  ]) {
    const point = raceTrackPoint(angle, 0);
    close(point.x, x);
    close(point.z, z);
    close(point.y, 0.795);
    close(point.yaw, -angle);
  }
});

test("lateral lanes preserve heading and angular progress while the outside of the corner rises", () => {
  for (const angle of [-2.2, -1, 0, 0.5, 1.4, 2.5]) {
    const inner = raceTrackPoint(angle, -8);
    const center = raceTrackPoint(angle, 0);
    const outer = raceTrackPoint(angle, 8);
    close(Math.hypot(inner.x, inner.z), 34);
    close(Math.hypot(center.x, center.z), 42);
    close(Math.hypot(outer.x, outer.z), 50);
    close(Math.atan2(inner.z, inner.x), angle);
    close(Math.atan2(outer.z, outer.x), angle);
    assert.equal(inner.yaw, center.yaw);
    assert.equal(outer.yaw, center.yaw);
    assert.ok(inner.y < center.y && center.y < outer.y, "the bank rises away from the infield");
  }
});

test("a complete turn repeats track position without a discontinuous heading reset", () => {
  const first = raceTrackPoint(0.37, 3.2);
  const next = raceTrackPoint(0.37 + Math.PI * 2, 3.2);
  close(first.x, next.x);
  close(first.y, next.y);
  close(first.z, next.z);
  close(next.yaw - first.yaw, -Math.PI * 2);
});

test("grid and track coordinates stay finite throughout the scene for varied field sizes", () => {
  for (const size of [1, 2, 8, 20, 48, 100]) {
    const rows = raceGrid(Array.from({ length: size }, (_, index) => driver(index + 1, (index % 17) * 0.5)));
    assert.equal(rows.length, size);
    for (const row of rows) {
      for (const value of [row.rank, row.gap, row.depth, row.index, row.distance, row.lane]) {
        assert.ok(Number.isFinite(value));
      }
      assert.ok(row.distance >= 0);
      assert.ok(Math.abs(row.lane) <= 8);
      for (const elapsed of [0, 2.5, 4.6, 7, 11.8]) {
        const point = raceTrackPoint(0.06 + elapsed * 0.115 - row.distance / 42, row.lane);
        for (const value of Object.values(point)) assert.ok(Number.isFinite(value));
        close(Math.hypot(point.x, point.z), 42 + row.lane);
        assert.ok(point.y > 0, "cars stay above the track origin");
      }
    }
  }
});

// These are source-level ownership contracts, not substitutes for browser QA.
// The TV clock rerenders every second and the overlay hard-unmounts after 12s;
// neither event may recreate a renderer or leave one running after the race.
test("the scene loads separately and a late import cannot mount after the overlay has gone", () => {
  const wrapper = readFileSync(new URL("../client/src/components/tv/field-race.tsx", import.meta.url), "utf8");
  assert.match(wrapper, /import\(["']\.\/race-scene["']\)/);
  assert.doesNotMatch(wrapper, /^import\s+[^\n]+\s+from\s+["']three(?:\/[^"']*)?["']/m);
  assert.match(wrapper, /useMemo\(\s*\(\)\s*=>\s*raceGrid\(people\),\s*\[people\]\s*\)/);
  assert.match(wrapper, /if\s*\(\s*cancelled\s*\|\|\s*!host\.current\s*\)\s*return/);
  assert.match(wrapper, /return\s*\(\)\s*=>\s*\{\s*cancelled\s*=\s*true;\s*cleanup\?\.\(\);?\s*\}/);
  assert.match(wrapper, /catch\(\s*error\s*=>\s*\{\s*sceneImport\s*=\s*undefined;\s*throw error;/,
    "a failed prefetch must not permanently poison later races");
});

test("scene resources have one idempotent cleanup, including failed initialization", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  const cleanup = scene.match(/const cleanup\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\};/)?.[1];
  assert.ok(cleanup, "the scene owns an explicit cleanup closure");
  assert.match(cleanup, /if\s*\(disposed\)\s*return/);
  assert.match(cleanup, /disposed\s*=\s*true/);
  assert.match(cleanup, /cancelAnimationFrame\(frame\)/);
  assert.match(cleanup, /observer\?\.disconnect\(\)/);
  assert.match(cleanup, /removeContextListener\(\)/);
  assert.match(cleanup, /tagElements\.forEach\(\s*\w+\s*=>\s*\w+\.remove\(\)\s*\)/);
  assert.match(cleanup, /resources\.forEach\(\s*\w+\s*=>\s*\w+\.dispose\(\)\s*\)/);
  assert.match(cleanup, /renderer\.dispose\(\)/);
  assert.match(cleanup, /renderer\.forceContextLoss\(\)/);
  assert.match(cleanup, /renderer\.domElement\.remove\(\)/);
  assert.ok(cleanup.indexOf("removeContextListener()") < cleanup.indexOf("renderer.forceContextLoss()"),
    "intentional teardown must not be reported as a display failure");
  assert.match(scene, /catch\s*\(error\)\s*\{\s*cleanup\(\);\s*throw error;\s*\}/);
  assert.match(scene, /addEventListener\(["']webglcontextlost["'],\s*contextLost\)/);
  assert.match(scene, /removeEventListener\(["']webglcontextlost["'],\s*contextLost\)/);
});

test("reduced motion uses a fixed pose, redraws on resize, and never starts a continuous loop", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  assert.match(scene, /const elapsed\s*=\s*options\.reduced\s*\?\s*[\d.]+\s*:/);
  assert.match(scene, /if\s*\(options\.reduced\s*&&\s*draw\)\s*draw\(performance\.now\(\)\)/);
  assert.match(scene, /if\s*\(!options\.reduced\s*&&\s*elapsed\s*<\s*[\d.]+\)\s*frame\s*=\s*requestAnimationFrame\(draw\)/);
});
