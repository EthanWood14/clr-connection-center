import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "client/src/pages/seating-chart.tsx"), "utf8");
const c3Nav = readFileSync(join(root, "client/src/components/app-sidebar.tsx"), "utf8");
const lapNav = readFileSync(join(root, "client/src/components/lap/lap-sidebar.tsx"), "utf8");
const app = readFileSync(join(root, "client/src/App.tsx"), "utf8");
const lapShell = readFileSync(join(root, "client/src/components/lap/lap-shell.tsx"), "utf8");

const URL = "https://seating-chart-production-1287.up.railway.app";

test("the chart is embedded, and still loads from its own app", () => {
  // It stays the single source of truth — this does not copy or rebuild it.
  assert.match(page, /const SEATING_CHART_URL = "https:\/\/seating-chart-production-1287\.up\.railway\.app"/);
  assert.match(page, /<iframe/);
  assert.match(page, /src=\{SEATING_CHART_URL\}/);
});

test("neither portal navigates away any more", () => {
  for (const [nav, name] of [[c3Nav, "C3 sidebar"], [lapNav, "LAP sidebar"]] as const) {
    assert.ok(!nav.includes(URL), `${name} must not link off-site`);
    assert.match(nav, /"\/seating-map"/, `${name} must point at the in-app route`);
    // The old entry opened a new tab; that flag must be gone with it.
    const line = nav.split("\n").find(l => l.includes("/seating-map"))!;
    assert.ok(!/external: true/.test(line), `${name} entry must not be marked external`);
  }
});

test("the route exists in both portals", () => {
  assert.match(app, /<Route path="\/seating-map" component=\{SeatingChart\} \/>/);
  assert.match(lapShell, /<Route path="\/seating-map" component=\{SeatingChart\} \/>/);
});

test("the embedded page cannot navigate the whole tab away from C3", () => {
  // allow-top-navigation would let the framed app redirect the parent, which
  // would defeat the point of embedding it.
  const sandbox = /sandbox="([^"]+)"/.exec(page)?.[1] ?? "";
  assert.ok(sandbox.includes("allow-scripts"), "the app needs to run");
  assert.ok(sandbox.includes("allow-same-origin"), "…and reach its own backend");
  assert.ok(!/allow-top-navigation/.test(sandbox), "must not be able to redirect the parent tab");
});

test("there is always a way out if the frame will not render", () => {
  // A blank iframe is not detectable from the parent, so the escape hatch is
  // permanent rather than shown on an error we cannot observe.
  assert.match(page, /data-testid="seating-open-new-tab"/);
  assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /data-testid="seating-reload"/);
  // Reload works by remounting: an iframe ignores a src it already has.
  assert.match(page, /key=\{reloadKey\}/);
});
