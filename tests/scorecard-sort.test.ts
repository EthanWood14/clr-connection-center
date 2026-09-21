import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { DEFAULT_SCORECARD_SORT, resolveScorecardSort, selectScorecardSort, sortScorecardRows } from "../client/src/lib/scorecard-sort";

const dash = readFileSync(new URL("../client/src/pages/manager-dashboard.tsx", import.meta.url), "utf8");
const columns = [
  { key: "transfers", get: (r: any) => r.transfers, better: true },
  { key: "priority", get: (r: any) => r.priority, better: true },
  { key: "claim", get: (r: any) => r.seconds, better: false },
  { key: "name", get: (r: any) => r.name, better: false },
];
const row = (name: string, transfers: number, appointments = 0, calls = 0, extra = {}) => ({ name, transfers, appointments, calls, ...extra });
const names = (rows: { name: string }[]) => rows.map(r => r.name);

test("default order preserves transfers, then appointments, then calls", () => {
  const rows = [row("fewer calls", 5, 3, 2), row("more calls", 5, 3, 80), row("fewer appts", 5, 1, 900), row("leader", 9, 0, 1)];
  assert.deepEqual(names(sortScorecardRows(rows, DEFAULT_SCORECARD_SORT, columns)), ["leader", "more calls", "fewer calls", "fewer appts"]);
});
test("numeric sorting preserves half credits and reverses without string ordering", () => {
  const rows = [row("nine", 9), row("ten", 10), row("half", 9.5)];
  assert.deepEqual(names(sortScorecardRows(rows, { key: "transfers", direction: "desc" }, columns)), ["ten", "half", "nine"]);
  assert.deepEqual(names(sortScorecardRows(rows, { key: "transfers", direction: "asc" }, columns)), ["nine", "half", "ten"]);
});
test("missing and non-finite scores stay last in both directions, while zero is a real score", () => {
  const rows = [row("missing", 1), row("null", 1, 0, 0, { priority: null }), row("NaN", 1, 0, 0, { priority: NaN }),
    row("infinite", 1, 0, 0, { priority: Infinity }), row("zero", 1, 0, 0, { priority: 0 }), row("best", 1, 0, 0, { priority: 90 })];
  assert.deepEqual(names(sortScorecardRows(rows, { key: "priority", direction: "asc" }, columns)), ["zero", "best", "missing", "null", "NaN", "infinite"]);
  assert.deepEqual(names(sortScorecardRows(rows, { key: "priority", direction: "desc" }, columns)), ["best", "zero", "missing", "null", "NaN", "infinite"]);
});
test("new categories start best-first, and repeated clicks reverse", () => {
  const priority = selectScorecardSort(DEFAULT_SCORECARD_SORT, columns[1]);
  assert.deepEqual(priority, { key: "priority", direction: "desc" });
  assert.deepEqual(selectScorecardSort(priority, columns[1]), { key: "priority", direction: "asc" });
  assert.deepEqual(selectScorecardSort(priority, columns[2]), { key: "claim", direction: "asc" });
  assert.deepEqual(selectScorecardSort(priority, columns[3]), { key: "name", direction: "asc" });
});
test("names sort naturally and input rows remain unchanged with stable ties", () => {
  const rows = Object.freeze([Object.freeze(row("Sam 10", 1)), Object.freeze(row("alex", 1)), Object.freeze(row("Sam 2", 1))]);
  assert.deepEqual(names(sortScorecardRows(rows, { key: "name", direction: "asc" }, columns)), ["alex", "Sam 2", "Sam 10"]);
  assert.deepEqual(names(sortScorecardRows(rows, { key: "name", direction: "desc" }, columns)), ["Sam 10", "Sam 2", "alex"]);
  assert.deepEqual(names(sortScorecardRows(rows, DEFAULT_SCORECARD_SORT, columns)), ["Sam 10", "alex", "Sam 2"]);
  assert.deepEqual(sortScorecardRows([], DEFAULT_SCORECARD_SORT, columns), []);
});
test("a hidden category falls back to visible transfer order", () => {
  assert.deepEqual(resolveScorecardSort({ key: "pace", direction: "asc" }, columns), DEFAULT_SCORECARD_SORT);
  assert.deepEqual(names(sortScorecardRows([row("low", 1), row("high", 5)], { key: "pace", direction: "asc" }, columns)), ["high", "low"]);
});

// Execute the actual component using inert UI elements and state. No copied
// category/value map, backend imports, network or real user data.
function componentHarness() {
  let sort = DEFAULT_SCORECARD_SORT;
  const React = { createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }) };
  const code = dash.slice(dash.indexOf("function TransferScorecard"), dash.indexOf("// Range selector"));
  const js = ts.transpileModule(code + "\nexports.render = TransferScorecard;", { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  const exports: any = {};
  const scope: Record<string, any> = { React, exports, useState: () => [sort, (next: typeof sort) => { sort = next; }],
    DEFAULT_SCORECARD_SORT, resolveScorecardSort, selectScorecardSort, sortScorecardRows,
    Card: "Card", CardContent: "CardContent", Button: "Button", ClrTrainingBadge: "ClrTrainingBadge",
    ArrowUpDown: "ArrowUpDown", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
    heatColor: () => "", formatTransferCount: String, formatSlaSeconds: String, paceTier: () => null,
  };
  new Function(...Object.keys(scope), js)(...Object.values(scope));
  return { render: (rows: any[], pace?: object) => exports.render({ rows, rangeLabel: "Today", pace }) };
}
function all(node: any): any[] { return node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(all)] : []; }
function find(node: any, predicate: (n: any) => boolean) { const result = all(node).find(predicate); assert.ok(result, "rendered element exists"); return result; }
function displayedIds(node: any) { return find(node, n => n.type === "tbody").children.map((n: any) => n.props.key); }

test("actual header buttons and picker sort every category and expose accessible direction", () => {
  const h = componentHarness();
  const rows = [
    { ...row("Low", 1, 1, 1), userId: 1, messages: 1, dialpadTexts: 1, callToolsContacts: 1, callToolsConversations: 1, callToolsActiveSeconds: 59,
      transfersPerWorkedDay: 0.5, callsPerWorkedDay: 1, writeUpPct: 9, placementScore: 9,
      bonzoCalls: 1, bonzoContacts: 1, bonzoConversations: 1, slaClaimed: 1, slaUnclaimed: 9, slaClaimedPct: 10, slaMedianClaimSeconds: 9, slaAverageClaimSeconds: 9 },
    { ...row("High", 10, 10, 10), userId: 2, messages: 10, dialpadTexts: 10, callToolsContacts: 10, callToolsConversations: 10, callToolsActiveSeconds: 3600,
      transfersPerWorkedDay: 5, callsPerWorkedDay: 10, writeUpPct: 90, placementScore: 90,
      bonzoCalls: 10, bonzoContacts: 10, bonzoConversations: 10, slaClaimed: 9, slaUnclaimed: 1, slaClaimedPct: 90, slaMedianClaimSeconds: 90, slaAverageClaimSeconds: 90 },
  ];
  const pace = { daysElapsed: 2, daysInMonth: 20 };
  let view = h.render(rows, pace);
  const picker = find(view, n => n.type === "select" && n.props.id === "scorecard-sort-category");
  const keys = picker.children.map((n: any) => n.props.value);
  assert.equal(keys.length, 19);
  assert.equal(picker.children.find((n: any) => n.props.value === "placement").children[0], "Priority");
  for (const key of keys.filter((key: string) => key !== "transfers")) {
    find(view, n => n.props["data-testid"] === `scorecard-sort-${key}`).props.onClick();
    view = h.render(rows, pace);
    assert.deepEqual(displayedIds(view), key === "slaClaimTime" ? [1, 2] : [2, 1], key);
    const header = find(view, n => n.type === "th" && all(n).some(child => child.props?.["data-testid"] === `scorecard-sort-${key}`));
    assert.equal(header.props["aria-sort"], key === "slaClaimTime" || key === "name" ? "ascending" : "descending");
    find(view, n => n.props["aria-label"] === "Reverse scorecard sort direction").props.onClick();
    view = h.render(rows, pace);
    assert.deepEqual(displayedIds(view), key === "slaClaimTime" ? [2, 1] : [1, 2], `${key} reversed`);
  }
  find(view, n => n.type === "select").props.onChange({ target: { value: "calls" } });
  view = h.render(rows, pace);
  assert.deepEqual(displayedIds(view), [2, 1]);
  assert.equal(find(view, n => n.type === "select").props.value, "calls");
});
test("actual component handles empty rows and range changes without a hidden MTD sort", () => {
  const h = componentHarness();
  const rows = [{ ...row("A", 1), userId: 1 }, { ...row("B", 10), userId: 2 }];
  let view = h.render(rows, { daysElapsed: 2, daysInMonth: 20 });
  find(view, n => n.props["data-testid"] === "scorecard-sort-pace").props.onClick();
  view = h.render(rows);
  assert.equal(find(view, n => n.type === "select").props.value, "transfers");
  assert.deepEqual(displayedIds(view), [2, 1]);
  assert.equal(all(view).some(n => n.props["data-testid"] === "scorecard-sort-pace"), false);
  assert.doesNotThrow(() => h.render([]));
  assert.deepEqual(displayedIds(h.render(rows)), [2, 1]);
});
