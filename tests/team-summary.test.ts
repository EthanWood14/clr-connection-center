import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as dates from "date-fns";
import { managerDailyMetrics } from "../shared/manager-daily-metrics";
import { dropWeekendRows, isWeekday } from "../client/src/lib/weekday-date";
import { isClrTrendWorkday } from "../client/src/lib/clr-trend-workday";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const page = read("client/src/pages/team-summary.tsx");
const app = read("client/src/App.tsx");
const sidebar = read("client/src/components/app-sidebar.tsx");
const advanced = read("client/src/pages/manager-dashboard.tsx");
const routes = read("server/routes.ts");
const home = read("client/src/pages/dashboard.tsx");

test("new dashboard replaces the summary and manager Home; old dashboard/bookmarks remain", () => {
  assert.match(app, /<Route path="\/team-summary" component=\{TeamSummary\} \/>/);
  assert.match(app, /<Route path="\/advanced-dashboard" component=\{ManagerDashboard\} \/>/);
  assert.match(app, /<Route path="\/team-dashboard" component=\{ManagerDashboard\} \/>/);
  assert.match(page, /<ManagerDashboard view="overview" \/>/);
  assert.match(home, /import\("\.\/team-summary"\)/);
  assert.match(home, /_authUser\?\.role === "admin" \|\| _authUser\?\.isManager/);
  assert.match(home, /return <ClrDashboard \/>/);
  assert.match(sidebar, /title: "Dashboard",\s+url: "\/team-summary"/);
  assert.match(sidebar, /title: "Advanced Dashboard",\s+url: "\/advanced-dashboard"/);
  assert.doesNotMatch(sidebar, /title: "How we're doing"/);
});

test("shared dashboard keeps the existing data and internal-only security boundary", () => {
  assert.match(advanced, /queryKey: \["\/api\/manager-dashboard"\]/);
  assert.doesNotMatch(page, /useQuery|fetch\(/, "wrapper cannot introduce a competing data source");
  const fn = routes.slice(routes.indexOf('app.get("/api/manager-dashboard"'), routes.indexOf('app.get("/api/manager-dashboard"') + 1_200);
  assert.match(fn, /const internal = !me\?\.portal \|\| me\.portal === "c3";/);
  assert.match(fn, /return res\.status\(403\)/);
  assert.match(routes, /dialpadTextsByUser: storageExtra.getDialpadTextsByUser\(Number\(currentOrgId\(\) \?\? 1\), todayStr, todayStr\)/);
  assert.match(routes, /callToolsTotal: leadvaultCallTools.get\(todayStr\)/);
});

const input = {
  callToolsTotal: 8123, localCallTools: { calls: 201, conversations: 91 },
  transfers: 17, appointments: 6, dialpadCalls: 405,
  dialpadTextsByUser: new Map([[1, 30], [2, 12], [99, 8]]),
};
test("today's six totals remain source-separated and include mapped inactive staff SMS", () => {
  assert.deepEqual(managerDailyMetrics(input), {
    callToolsCalls: 8123, callToolsSource: "provider", transfers: 17,
    appointments: 6, callToolsConversations: 91, dialpadCalls: 405, dialpadMessages: 50,
  });
});
test("zero provider total is authoritative; missing provider total is explicitly partial", () => {
  assert.equal(managerDailyMetrics({ ...input, callToolsTotal: 0 }).callToolsCalls, 0);
  const local = managerDailyMetrics({ ...input, callToolsTotal: undefined });
  assert.equal(local.callToolsCalls, 201);
  assert.equal(local.callToolsSource, "local");
  assert.equal(managerDailyMetrics({ ...input, callToolsTotal: NaN }).callToolsSource, "local");
  assert.equal(managerDailyMetrics({ ...input, transfers: 1.5 }).transfers, 1.5);
  assert.equal(managerDailyMetrics({ ...input, dialpadTextsByUser: new Map() }).dialpadMessages, 0);
});

// Run the real page with inert UI elements and synthetic query data. This tests
// which sections actually render, not whether unused strings survive in source.
function harness(options: { fast?: any; full?: any; fastError?: boolean; fullError?: boolean; splitError?: boolean } = {}) {
  const queries: any[] = [];
  const refreshes: string[] = [];
  const React = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
    Fragment: "Fragment",
    useState: (initial: any) => [typeof initial === "function" ? initial() : initial, () => {}],
    useEffect: () => {}, useMemo: (fn: any) => fn(),
  };
  const defaults = fixture();
  const fast = Object.hasOwn(options, "fast") ? options.fast : defaults;
  const full = Object.hasOwn(options, "full") ? options.full : defaults;
  const ui = new Proxy({}, { get: (_, key) => String(key) });
  const modules: Record<string, any> = {
    react: React,
    "@tanstack/react-query": {
      useQuery: (config: any) => {
        queries.push(config);
        const key = config.queryKey[0];
        const data = key.includes("phase=fast") ? fast
          : key === "/api/manager-dashboard" ? full
          : key === "/api/lo-transfer-split" ? options.splitError ? undefined : { helperName: "Helper", windows: {}, loaWindows: {} } : undefined;
        const isError = key.includes("phase=fast") ? options.fastError
          : key === "/api/manager-dashboard" ? options.fullError
          : key === "/api/lo-transfer-split" ? options.splitError : false;
        return { data, isSuccess: !!data, isError: !!isError, isLoading: !data && !isError,
          refetch: () => { refreshes.push(key); } };
      },
      useMutation: () => ({ mutate: () => {} }),
    },
    "@/lib/auth": { useAuth: () => ({ user: { name: "Manager" } }) },
    "@/hooks/use-mobile": { useIsMobile: () => false },
    "@/hooks/use-toast": { useToast: () => ({ toast: () => {} }) },
    "@/lib/weekday-date": { dropWeekendRows, isWeekday },
    "@/lib/clr-trend-workday": { isClrTrendWorkday },
    "@shared/transfer-credit": { formatTransferCount: String },
    "date-fns": dates,
  };
  const compiled = ts.transpileModule(advanced, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  const exports: any = {};
  new Function("require", "exports", "React", compiled)((id: string) => modules[id] ?? ui, exports, React);
  return { render: (view?: string) => exports.default({ view }), queries, refreshes };
}
function fixture() {
  const block = { window: { label: "Last 30 days" }, trend: [], leaderboard: [], outcomeBreakdown: [], topLos: [], fellThroughReasons: [] };
  const activity = { calls: 201, contacts: 110, conversations: 91, activeSeconds: 3600 };
  return {
    generatedAt: "2026-09-21T18:00:00Z", today: "2026-09-21", phase: "full", dailyMetrics: managerDailyMetrics(input),
    stats: { today: {}, week: {}, month: {}, priorWeek: {}, priorMonth: {} },
    callActivity: { today: activity, week: activity, month: activity, priorWeek: activity, priorMonth: activity },
    clrCards: [], activityFeed: [], alerts: [],
    pipeline: { transfers7d: [], overdueAppointments: [], overdueNmls: [] },
    eod: { totals: {}, rows: [], checklistGaps: [], submitted: 0, total: 0, missing: 0 },
    byRange: { today: block, "30d": block, week: block },
  };
}
function all(node: any): any[] { return node && typeof node === "object" ? [node, ...(node.children ?? []).flatMap(all)] : []; }
function textOf(node: any): string { return node == null || node === false ? "" : typeof node === "object" ? (node.children ?? []).map(textOf).join(" ") : String(node); }

test("overview renders six daily tiles and exactly the requested shared reporting sections", () => {
  const h = harness();
  const node = h.render("overview");
  const elements = all(node);
  const labels = elements.filter(n => n.type?.name === "KpiTile").map(n => [n.props.label, n.props.value]);
  assert.deepEqual(labels, [
    ["CallTools calls", "8,123"], ["Transfers", "17"], ["Appointments", "6"],
    ["CT conversations", "91"], ["Dialpad calls", "405"], ["Dialpad messages", "50"],
  ]);
  const headings = elements.filter(n => n.type?.name === "SectionTitle").map(textOf);
  assert.equal(headings.length, 4);
  for (const name of ["Transfer Scorecard", "CLR trend comparison", "Top LOs by transfers", "Transfers by loan officer / LOA"]) {
    assert.ok(headings.some(s => s.includes(name)), name);
  }
  const types = elements.map(n => n.type?.name);
  assert.equal(types.filter(n => n === "TransferScorecard").length, 1);
  assert.deepEqual(elements.filter(n => n.type?.name === "SplitTable").map(n => n.props.testId), ["lo-split-table", "loa-split-table"]);
  assert.ok(!textOf(node).includes("Team trend —"));
  assert.ok(!textOf(node).includes("EOD Reports"));
  assert.ok(elements.some(n => n.props.href === "/advanced-dashboard"));
  assert.equal(h.queries.find(q => q.queryKey[0].startsWith("/api/meta-conversion")).enabled, false);
  elements.find(n => n.type === "Button" && textOf(n).trim() === "Refresh").props.onClick();
  assert.deepEqual(h.refreshes, ["/api/manager-dashboard?phase=fast", "/api/manager-dashboard", "/api/lo-transfer-split"]);
});
test("default advanced view retains the original sections and its Meta feed", () => {
  const h = harness();
  const node = h.render();
  assert.equal(node.props["data-testid"], "advanced-dashboard");
  assert.ok(textOf(node).includes("Team trend —"));
  assert.ok(textOf(node).includes("Pipeline —"));
  assert.equal(h.queries.find(q => q.queryKey[0].startsWith("/api/meta-conversion")).enabled, true);
  assert.equal(all(node).some(n => n.props["data-testid"] === "manager-daily-metrics"), false);
});
test("fast load, failures and missing breakdowns never masquerade as zero history", () => {
  const fast = fixture();
  fast.phase = "fast";
  delete (fast.byRange as any)["30d"];
  const loading = textOf(harness({ fast, full: undefined }).render("overview"));
  assert.ok(loading.includes("Loading CLR trend…"));
  assert.ok(loading.includes("Loading LO rankings…"));
  assert.ok(!loading.includes("No transfers in this range"));
  const failed = textOf(harness({ fast: undefined, full: undefined, fastError: true }).render("overview"));
  assert.ok(failed.includes("Dashboard couldn't load"));
  const partial = textOf(harness({ fast, full: undefined, fullError: true, splitError: true }).render("overview"));
  assert.ok(partial.includes("CLR trend unavailable"));
  assert.ok(partial.includes("LO rankings unavailable"));
  assert.ok(partial.includes("The LO/LOA breakdown couldn't refresh"));
});

test("the pages you do not touch every call live behind the Advanced fold", () => {
  // Owner, 10 Sep 2026. Main is what you touch on every call; these are not.
  // The script is read until it is known, Shotgun answers itself (the offer is
  // a full-screen alert wherever you are, and the write-up prompt follows
  // you), and the EOD report is once at the end of the day.
  for (const moved of ["/call-script", "/eod-report", "/shotgun", "/advanced-dashboard", "/app-review"]) {
    const main = sidebar.slice(sidebar.indexOf("const mainItems"), sidebar.indexOf("const personalItems"));
    assert.ok(!main.includes(moved), `${moved} must not be in Main`);
  }
  assert.match(sidebar, /const advancedWorkflowItems: NavItem\[\]/);
  assert.match(sidebar, /const advancedDashboardItems: NavItem\[\]/);
  // Both new groups render INSIDE the fold, which only exists under showAdvanced.
  const fold = sidebar.slice(sidebar.indexOf("{showAdvanced && <>"));
  assert.ok(fold.includes("renderItems(advancedWorkflowItems)"));
  assert.ok(fold.includes("renderItems(advancedDashboardItems)"));
  // App Review stays manager-gated: relocating a link must not turn it into a
  // 403 for a CLR, and must not hand it to one either.
  assert.match(fold, /isManagerOrAdmin && renderItems\(advancedDashboardManagerItems\)/);
});

test("moving a link does not move the page", () => {
  // Every route still resolves, so bookmarks, push notifications and every
  // link written before today land where they always did.
  for (const route of ["/call-script", "/eod-report", "/shotgun", "/team-summary", "/advanced-dashboard", "/app-review"]) {
    assert.ok(app.includes(`path="${route}"`), `${route} must still be routed`);
  }
});

test("a CLR has a link to their own settings", () => {
  // Settings sat in the ADMIN-ONLY group, so a CLR had no route to their own
  // profile, availability or notification preferences anywhere in the nav —
  // only a line in the page footer and one step of the onboarding checklist.
  // The page has always been built for them: it opens on Profile and pushes a
  // non-admin back there if they land on an admin tab.
  const personal = sidebar.slice(
    sidebar.indexOf("const advancedPersonalItems"),
    sidebar.indexOf("];", sidebar.indexOf("const advancedPersonalItems")));
  assert.match(personal, /url: "\/settings"/, "Settings belongs to the everyone list");
  const admin = sidebar.slice(
    sidebar.indexOf("const adminItems"),
    sidebar.indexOf("];", sidebar.indexOf("const adminItems")));
  assert.ok(!admin.includes("/settings"), "and must no longer be admin-gated");
  // Report Archive stays: that page refuses anyone who is not admin or viewer.
  assert.match(admin, /\/reports-archive/);
});

test("Glossary and the NMLS tracker moved out of Tools, not out of reach", () => {
  const tools = sidebar.slice(
    sidebar.indexOf("const toolItems"),
    sidebar.indexOf("];", sidebar.indexOf("const toolItems")));
  for (const gone of ["/glossary", "/nmls-checks"]) {
    assert.ok(!tools.includes(gone), `${gone} must have left Tools`);
  }
  const reference = sidebar.slice(
    sidebar.indexOf("const referenceItems"),
    sidebar.indexOf("];", sidebar.indexOf("const referenceItems")));
  for (const moved of ["/glossary", "/nmls-checks"]) {
    assert.ok(reference.includes(moved), `${moved} must be in the everyone Reference list`);
  }
  // Tools still has a reason to exist.
  assert.match(tools, /\/state-lookup/);
});
