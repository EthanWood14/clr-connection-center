import { addIsoDays } from "./business-day";
import { buildTransferScorecardWindows } from "./manager-scorecard";
import { remainingPerformancePaceDays } from "@shared/performance-workday";

// Read-only, fictional fixtures. Never seed or query live team records to make
// a demo look populated; rolling dates keep the preview useful after launch.
const names = ["Morgan Brooks", "Avery Parker", "Jordan Lee", "Casey Taylor", "Riley Chen"];
const recipients = ["Alex Thompson", "Taylor Morgan", "Casey Bennett", "Sample Retail Team"];
const sum = (rows: any[], key: string) => rows.reduce((n, row) => n + Number(row[key] ?? 0), 0);
const weekday = (date: string) => ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

function sampleDays(today: string) {
  return Array.from({ length: 90 }, (_, index) => {
    const date = addIsoDays(today, index - 89);
    const people = names.map((name, i) => {
      const works = weekday(date) && (i !== 4 || index >= 80);
      const transfers = works ? 2 + ((index * 3 + i * 2) % 7) : 0;
      const ct = works ? 125 + ((index * 11 + i * 23) % 150) : 0;
      const dp = works ? 24 + ((index + i * 7) % 40) : 0;
      return { userId: 90001 + i, name, transfers, appointments: works ? 1 + ((index + i) % 3) : 0,
        calls: ct + dp, callToolsCalls: ct, dialpadCalls: dp, dialpadTexts: works ? 18 + ((index + i) % 35) : 0,
        callToolsContacts: works ? 45 + i * 4 : 0, callToolsConversations: works ? 20 + i * 3 : 0,
        callToolsActiveSeconds: works ? 10800 + i * 900 : 0, bonzoCalls: works ? 8 + i : 0,
        bonzoContacts: works ? 16 + i : 0, bonzoConversations: works ? 6 + i : 0,
        activeWorkdays: i === 4 ? 7 : 35 + i * 10, inTraining: i === 4, fellThrough: 0,
        workedDays: works ? 1 : 0 };
    });
    return { date, people };
  });
}

function rangeBlock(days: ReturnType<typeof sampleDays>, window: { startDate: string; endDate: string; days: number; label: string }) {
  const selected = days.filter(d => d.date >= window.startDate && d.date <= window.endDate);
  const leaderboard = names.map((_, i) => {
    const rows = selected.map(d => d.people[i]);
    const row: any = { ...days[89].people[i] };
    for (const key of ["transfers", "appointments", "calls", "callToolsCalls", "dialpadCalls", "dialpadTexts", "callToolsContacts", "callToolsConversations", "callToolsActiveSeconds", "bonzoCalls", "bonzoContacts", "bonzoConversations", "workedDays"]) row[key] = sum(rows, key);
    return { ...row, messages: row.dialpadTexts, totalOutcomes: row.transfers + row.appointments,
      remainingPaceDays: remainingPerformancePaceDays(row.userId, window.endDate),
      textTransfers: Math.floor(row.transfers / 4), transfersPerWorkedDay: row.workedDays ? row.transfers / row.workedDays : null,
      slaClaimed: row.transfers + 2, slaUnclaimed: 1, slaClaimedPct: 90, slaUnclaimedPct: 10,
      slaMedianClaimSeconds: 18 + i * 4, slaAverageClaimSeconds: 35 + i * 7,
      writeUpPct: 94 - i * 2, placementScore: 83 - i * 3, placementScored: row.transfers,
      placementMinScored: 5, placementInvestment: 0, placementBreaches: 0, placementUnplaced: 0,
      placementUnplacedValuedAt: null, placementUnscored: 0, placementRoutingProblem: null,
      conversionRate: row.calls ? row.transfers / row.calls * 100 : 0,
      transferPct: row.transfers + row.appointments ? row.transfers / (row.transfers + row.appointments) * 100 : 0,
      appointmentPct: row.transfers + row.appointments ? row.appointments / (row.transfers + row.appointments) * 100 : 0,
      callsPerWorkedDay: row.workedDays ? row.calls / row.workedDays : null,
      fellThroughPct: 0, callToTransferPct: row.calls ? row.transfers / row.calls * 100 : null };
  });
  const trend = selected.map(d => ({ date: d.date, calls: sum(d.people, "calls"),
    transfers: sum(d.people, "transfers"), appointments: sum(d.people, "appointments"), fellThrough: 0,
    callToolsCalls: sum(d.people, "callToolsCalls"), dialpadCalls: sum(d.people, "dialpadCalls"), writeUpRate: 91 }));
  const total = sum(leaderboard, "transfers");
  const topLos = recipients.map((name, i) => ({ id: 91001 + i, name,
    transfers: Math.floor(total / recipients.length) + (i < total % recipients.length ? 1 : 0) }));
  const dates = selected.map(d => d.date);
  return { window, leaderboard, trend, topLos,
    outcomeBreakdown: [{ outcome_type: "transfer", count: total }, { outcome_type: "appointment", count: sum(leaderboard, "appointments") }],
    fellThroughReasons: [], textTransfersTotal: sum(leaderboard, "textTransfers"),
    clrTrend: { dates, series: names.map((_, i) => ({ ...days[89].people[i],
      transfers: selected.map(d => d.people[i].transfers), appointments: selected.map(d => d.people[i].appointments),
      fellThrough: selected.map(() => 0), calls: selected.map(d => d.people[i].calls),
      callToolsActiveSeconds: selected.map(d => d.people[i].callToolsActiveSeconds) })) },
    heatmap: { dates, rows: leaderboard.map((p, i) => ({ ...p, cells: selected.map(d => d.people[i].transfers) })) },
    callsHeatmap: { dates, rows: leaderboard.map((p, i) => ({ ...p, cells: selected.map(d => d.people[i].calls) })) },
    topStates: [{ state: "CA", transfers: Math.floor(total * .6) }, { state: "WA", transfers: total - Math.floor(total * .6) }],
    placementRoutingProblem: null };
}

export function buildDemoManagerDashboard(today: string) {
  const days = sampleDays(today);
  const windows: Record<string, any> = { ...buildTransferScorecardWindows(today),
    week: { startDate: addIsoDays(today, -6), endDate: today, days: 7, label: "Last 7 days" },
    "3mo": { startDate: addIsoDays(today, -89), endDate: today, days: 90, label: "Last 3 months" },
    all: { startDate: addIsoDays(today, -89), endDate: today, days: 0, label: "All sample history" } };
  const byRange: Record<string, ReturnType<typeof rangeBlock>> = {};
  for (const [key, window] of Object.entries(windows)) byRange[key] = rangeBlock(days, window);
  const stats = (key: string) => ({ totalCallsToday: sum(byRange[key].leaderboard, "calls"),
    transfers: sum(byRange[key].leaderboard, "transfers"), appointments: sum(byRange[key].leaderboard, "appointments"), fellThrough: 0 });
  const activity = (key: string) => ({ calls: sum(byRange[key].leaderboard, "callToolsCalls"),
    contacts: sum(byRange[key].leaderboard, "callToolsContacts"), conversations: sum(byRange[key].leaderboard, "callToolsConversations"),
    activeSeconds: sum(byRange[key].leaderboard, "callToolsActiveSeconds") });
  const todayRows = byRange.today.leaderboard;
  return { demo: true, generatedAt: new Date().toISOString(), phase: "full", today,
    dailyMetrics: { callToolsCalls: sum(todayRows, "callToolsCalls"), callToolsSource: "provider",
      transfers: sum(todayRows, "transfers"), appointments: sum(todayRows, "appointments"),
      callToolsConversations: sum(todayRows, "callToolsConversations"), dialpadCalls: sum(todayRows, "dialpadCalls"),
      dialpadMessages: sum(todayRows, "dialpadTexts") },
    ranges: { week: windows.week, month: windows.mtd, last30: windows["30d"] },
    stats: { today: stats("today"), week: stats("week"), month: stats("mtd"), priorWeek: stats("week"), priorMonth: stats("mtd") },
    callActivity: { today: activity("today"), week: activity("week"), month: activity("mtd"), priorWeek: activity("week"), priorMonth: activity("mtd") },
    clrCards: byRange.mtd.leaderboard.map(p => ({ ...p, email: "sample@example.invalid", goalCalls: 3000, goalTransfers: 70,
      goalAppts: 30, assigned: 40, completed: 30, completionPct: 75, callbacks: 0, noAnswer: 0, futureContact: 0 })),
    eod: { date: today, total: names.length, submitted: 3, missing: 2, late: 0, dueLabel: "4 PM PT", checklistGaps: [], extraWork: [],
      totals: { calls: 0, messages: 0, conversations: 0, transfers: 0, appointments: 0 },
      rows: todayRows.map((p, i) => ({ ...p, email: "sample@example.invalid", submitted: i < 3, submittedAt: i < 3 ? `${today}T22:00:00Z` : null,
        late: false, notes: i < 3 ? "Sample note: followed up with scheduled borrowers and confirmed tomorrow's appointments." : null })) },
    pipeline: { todayTransfers: [], transfers7d: [], overdueAppointments: [], overdueNmls: [] },
    byRange, activityFeed: [], alerts: [{ level: "info", text: "Sample data only — no live people or borrower records." }] };
}

export function buildDemoLoTransferSplit(today: string) {
  const data = buildDemoManagerDashboard(today);
  const windows: Record<string, any[]> = {};
  const loaWindows: Record<string, any[]> = {};
  for (const [key, range] of Object.entries({ today: "today", week: "week", month: "mtd", all: "all" })) {
    windows[key] = data.byRange[range].topLos.map(lo => ({ loId: lo.id, name: lo.name,
      helper: Math.floor(lo.transfers / 5), others: lo.transfers - Math.floor(lo.transfers / 5), total: lo.transfers }));
    const retail = windows[key][3];
    loaWindows[key] = ["Jamie Sample", "Quinn Sample"].map((name, i) => {
      const total = Math.floor(retail.total / 2) + (i === 0 ? retail.total % 2 : 0);
      return { loId: 92001 + i, name, helper: Math.floor(total / 5), others: total - Math.floor(total / 5), total };
    });
  }
  return { demo: true, today, helperName: "Sample helper", helperUserId: null, helperNotice: null, windows, loaWindows };
}
