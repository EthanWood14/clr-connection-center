import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClrTrainingBadge } from "@/components/clr-training-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  PhoneCall, Calendar, XCircle, ArrowUpRight, Trophy,
  CheckCircle2, AlertTriangle, ShieldCheck, Send, RefreshCw, TrendingUp,
  Download, Activity, MapPin, Target, Flame, ArrowDown, ArrowUp,
  Minus, AlertOctagon, Info, BarChart3, PieChart as PieIcon, Award, Users,
  Clock,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { useAuth } from "@/lib/auth";
import { businessTodayClient } from "@/lib/business-day";
import { dropWeekendRows, isWeekday } from "@/lib/weekday-date";
import { countNonSundaysInMonth } from "@shared/pace-days";

// Theme colors
const NAVY = "#0F182D";
const NAVY_2 = "#1A2B4A";
const GOLD = "#C9A24A";
const GOLD_2 = "#C49A3C";
const GREEN = "#16a34a";
const BLUE = "#2563eb";
const RED = "#dc2626";
const AMBER = "#d97706";
const PURPLE = "#7c3aed";
const CYAN = "#0891b2";

type RangeKey = "week" | "30d" | "3mo" | "all";
const RANGE_OPTIONS: { key: RangeKey; label: string; short: string }[] = [
  { key: "week", short: "Week", label: "Last 7 days" },
  { key: "30d",  short: "30d",  label: "Last 30 days" },
  { key: "3mo",  short: "3mo",  label: "Last 3 months" },
  { key: "all",  short: "All",  label: "All time" },
];

type ScorecardRange = "today" | "3d" | "7d" | "14d" | "30d" | "90d" | "mtd";
const SCORECARD_OPTIONS: { key: ScorecardRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "3d", label: "3 days" },
  { key: "7d", label: "7 days" },
  { key: "14d", label: "14 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  // Sits at the end rather than beside the rolling windows: it answers a
  // different question ("how is the month going") and its length changes
  // day by day.
  { key: "mtd", label: "MTD" },
];

type PipelineRange = "1d" | "3d" | "7d";
const PIPELINE_OPTIONS: { key: PipelineRange; label: string }[] = [
  { key: "1d", label: "1d" },
  { key: "3d", label: "3d" },
  { key: "7d", label: "7d" },
];

type Alert = { level: "warn" | "danger" | "info"; text: string; href?: string };
type RangeBlock = {
  window: { startDate: string; endDate: string; days: number; label: string };
  trend: { date: string; calls: number; transfers: number; appointments: number; fellThrough: number }[];
  outcomeBreakdown: { outcome_type: string; count: number }[];
  fellThroughReasons: { label: string; count: number }[];
  topLos: { id: number; name: string; transfers: number }[];
  leaderboard: {
    userId: number; name: string; activeWorkdays: number; inTraining: boolean;
    transfers: number; textTransfers?: number; appointments: number; fellThrough: number;
    totalOutcomes: number; calls: number; messages: number; dialpadTexts?: number; conversionRate: number;
    callToolsContacts?: number; callToolsConversations?: number; callToolsActiveSeconds?: number;
    transferPct: number; appointmentPct: number; fellThroughPct: number;
    callToTransferPct: number | null;
  }[];
  textTransfersTotal?: number;
  heatmap: { dates: string[]; rows: { userId: number; name: string; activeWorkdays: number; inTraining: boolean; cells: number[] }[] };
  callsHeatmap: { dates: string[]; rows: { userId: number; name: string; activeWorkdays: number; inTraining: boolean; cells: number[] }[] };
  topStates: { state: string; transfers: number }[];
  statesDiagnostics?: {
    phonesTotal: number;
    phonesParsed: number;
    phonesRejected: number;
    rejectedSamples: string[];
  };
  clrTrend?: {
    dates: string[];
    series: {
      userId: number;
      name: string;
      activeWorkdays: number;
      inTraining: boolean;
      transfers: number[];
      appointments: number[];
      fellThrough: number[];
      calls: number[];
    }[];
  };
};
type ManagerData = {
  generatedAt: string;
  today: string;
  ranges: { week: any; month: any; last30: any };
  stats: { today: any; week: any; month: any; priorWeek: any; priorMonth: any };
  callActivity: {
    today: { calls: number; contacts: number; conversations: number; activeSeconds: number };
    week: { calls: number; contacts: number; conversations: number; activeSeconds: number };
    month: { calls: number; contacts: number; conversations: number; activeSeconds: number };
    priorWeek: { calls: number; contacts: number; conversations: number; activeSeconds: number };
    priorMonth: { calls: number; contacts: number; conversations: number; activeSeconds: number };
  };
  clrCards: any[];
  eod: {
    date: string;
    total: number;
    submitted: number;
    missing: number;
    late: number;
    dueLabel: string;
    totals: Record<string, number>;
    checklistGaps: { key: string; label: string; no: string[] }[];
    extraWork?: { key: string; label: string; yes: string[] }[];
    rows: { userId: number; name: string; email: string; activeWorkdays: number; inTraining: boolean; submitted: boolean; submittedAt: string | null;
            late?: boolean; checklist?: Record<string, boolean | null> | null;
            calls?: number; messages?: number; conversations?: number; transfers?: number;
            appointments?: number; notes?: string | null; losCalled?: number }[];
  };
  pipeline: {
    todayTransfers: any[];
    transfers7d: any[];
    overdueAppointments: any[];
    overdueNmls: any[];
  };
  byRange: Record<RangeKey | ScorecardRange, RangeBlock>;
  activityFeed: any[];
  alerts: Alert[];
};

// Detect dark mode (reactive to class changes on <html>).
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(
    typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function deltaInfo(current: number, prior: number) {
  if (!prior && !current) return { dir: "flat" as const, pct: 0, label: "—" };
  if (!prior) return { dir: "up" as const, pct: 100, label: "new" };
  const pct = Math.round(((current - prior) / prior) * 100);
  return { dir: pct > 0 ? "up" as const : pct < 0 ? "down" as const : "flat" as const, pct: Math.abs(pct), label: `${pct > 0 ? "+" : ""}${pct}%` };
}

function DeltaArrow({ dir, pct, label, invert = false }: { dir: "up" | "down" | "flat"; pct: number; label: string; invert?: boolean }) {
  const isPositive = invert ? dir === "down" : dir === "up";
  const isNegative = invert ? dir === "up" : dir === "down";
  const color = dir === "flat" ? "#94a3b8" : isPositive ? GREEN : isNegative ? RED : "#94a3b8";
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums" style={{ color }}>
      <Icon className="w-3 h-3" />
      {label} <span className="text-muted-foreground font-normal">vs prior</span>
    </span>
  );
}

function KpiTile({
  label, value, sub, icon: Icon, color = NAVY, href, delta,
}: { label: string; value: string | number; sub?: React.ReactNode; icon: any; color?: string; href?: string; delta?: React.ReactNode }) {
  const inner = (
    <Card className="overflow-hidden h-full glass-accent-ring glass-hover">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
            <div className="text-3xl font-bold tabular-nums" style={{ color }}>{value}</div>
            {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
            {delta && <div className="mt-1">{delta}</div>}
          </div>
          <div className="rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function SectionTitle({ icon: Icon, children, action }: { icon: any; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
      <h2 className="text-lg font-semibold flex items-center gap-2 brand-text">
        <Icon className="w-5 h-5" style={{ color: GOLD }} />
        {children}
      </h2>
      {action}
    </div>
  );
}

// Heatmap cell color: grade `value` against the column's min/max. Green = strong,
// red = weak; pass higherIsBetter=false to invert (e.g. fall-throughs). Light
// pastel fills with dark text, like a producer scorecard.
function heatColor(value: number, min: number, max: number, higherIsBetter: boolean): string {
  if (max <= 0 && min <= 0) return "transparent";   // whole column is zero → no fill
  if (max === min) return "hsl(95, 55%, 88%)";       // no spread → mild green
  let t = (value - min) / (max - min);               // 0..1
  if (!higherIsBetter) t = 1 - t;
  const hue = Math.round(t * 130);                    // 0 = red → 130 = green
  return `hsl(${hue}, 78%, 88%)`;
}

/**
 * Month-to-date pace: what this month ends at if the rest of it looks like the
 * part already run. Only meaningful on the MTD window, and only once a couple
 * of days have passed — on the 1st a single transfer projects to thirty.
 */
const PACE_TIERS = [
  { at: 200, label: "200", color: "#D4A017", text: "#3F2D00" },  // gold
  { at: 150, label: "150", color: "#2F6FED", text: "#FFFFFF" },  // blue
  { at: 100, label: "100", color: "#1F9D55", text: "#FFFFFF" },  // green
  { at: 75,  label: "75",  color: "#D64545", text: "#FFFFFF" },  // red
];

function paceTier(projected: number) {
  return PACE_TIERS.find(t => projected >= t.at) ?? null;
}

// Weekly Scorecard — last-7-days per-CLR snapshot as a color-graded table.
function TransferScorecard({ rows, rangeLabel, pace }: {
  rows: any[];
  rangeLabel: string;
  /** Present only on the month-to-date window. */
  pace?: { daysElapsed: number; daysInMonth: number };
}) {
  // Transfers, then appointments, then calls. Appointments break a transfer tie
  // because they are the same kind of work as a transfer — a booked appointment
  // is a result, whereas call count only says who dialled more to get there.
  // Calls stay as the last resort so the order is still deterministic.
  const list = [...(rows ?? [])].sort((a, b) =>
    (b.transfers - a.transfers)
    || (b.appointments - a.appointments)
    || (b.calls - a.calls));
  if (list.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No CLR activity in this {rangeLabel.toLowerCase()} range.</CardContent></Card>;
  }
  /**
   * What the Placed cell is not saying out loud, in the cell's own tooltip.
   *
   * Two different jobs, and both are about a number that would otherwise be
   * read as something it is not.
   *
   * A DASH in a colour-graded table reads as a bug unless it says what it
   * means, and the three reasons are genuinely different: nobody transferred
   * anybody, nothing they transferred could be traced to a desk, or the sample
   * is too thin to judge. The last one is the common case on the short ranges,
   * and it has an answer the manager can act on — pick a longer one.
   *
   * A NUMBER with investment transfers behind it is the other job, and it is
   * the sharper one. Those transfers are not on the ramp at all: each is a flat
   * 100 for recording one of the three named assistants or a flat 0 for
   * anything else. So a 0% can mean "you fed the busiest desk in the building"
   * or it can mean "eleven investment leads went to the wrong people", and a
   * 100% can be a fortnight of feeding the starved or a fortnight of obeying
   * one routing rule. The percentage alone cannot tell a manager which, and the
   * difference is the whole of what they would do about it. The counts come
   * from the scan itself (see placementInvestment / placementBreaches in
   * server/routes.ts), so this is a reading of the number rather than a second
   * calculation that could disagree with it.
   */
  const placementNote = (r: any): string | undefined => {
    const scored = Number(r.placementScored ?? 0);
    const need = Number(r.placementMinScored ?? 0);
    const investment = Number(r.placementInvestment ?? 0);
    const breaches = Math.min(investment, Number(r.placementBreaches ?? 0));
    const followed = investment - breaches;
    const unplaced = Math.max(0, Number(r.placementUnplaced ?? 0));
    const valuedAt = r.placementUnplacedValuedAt == null ? null : Number(r.placementUnplacedValuedAt);
    const unscored = Math.max(0, Number(r.placementUnscored ?? 0));
    const ramped = Math.max(0, scored - investment);
    // An unreadable record only enters the share when the floor made ordinary
    // transfers to value it from. With none, the server leaves it out of the
    // mean entirely, and a breakdown that counted it would not add up.
    const filled = valuedAt == null ? 0 : unplaced;
    const dropped = unplaced - filled;
    const behind = scored + filled;

    // The rule that did not run answers first. The cell is a dash because of
    // it, and every other reason below would explain the wrong dash.
    if (unscored > 0) {
      return `The investment routing rule is not running: the roster cannot resolve Chris's`
        + ` Justin, Mateo or John, so ${unscored} of this CLR's transfers that the app recorded as`
        + ` Investment/2nd Home ${unscored === 1 ? "was" : "were"} not judged on routing at all.`
        + ` Each of those had to reach one desk, so reading them as ordinary placement would score`
        + ` obedience as 0% — no share is shown until the roster answers. The server log names what`
        + ` failed.`;
    }

    // WHAT THE NUMBER IS MADE OF, and it has to add up to every transfer
    // behind it. A breakdown taken over the readable half alone presented
    // arithmetic a manager could not reconcile with the percentage above it:
    // the mean's denominator is the scored transfers PLUS the unreadable ones
    // counted at the floor's average, so all three parts are named or none is.
    const pieces: string[] = [];
    if (investment > 0) {
      pieces.push(`${investment} recorded as Investment/2nd Home and judged on routing alone`
        + ` (${followed} recorded Justin, Mateo or John and scored 100%, ${breaches} did not and scored 0%)`);
    }
    if (ramped > 0) pieces.push(`${ramped} judged on ordinary placement`);
    if (filled > 0) {
      pieces.push(`${filled} that could not be traced to a loan officer, counted at the floor's own`
        + ` average of ${Math.round((valuedAt as number) * 100)}%`);
    }
    if (r.placementScore != null) {
      const breakdown = pieces.length
        ? `This share is the mean of ${behind} ${behind === 1 ? "transfer" : "transfers"}: ${pieces.join("; ")}.`
        : "";
      const left = dropped > 0
        ? `${dropped} more could not be traced to a loan officer, and with no ordinary placement on the`
          + ` floor to value them at they are left out of the share.`
        : "";
      return [breakdown, left].filter(Boolean).join(" ") || undefined;
    }

    // No number is shown, so nothing below describes one: breaking down a share
    // that is not on the screen is the same failure to reconcile, in the other
    // direction. The routing split is still worth saying, because it is the one
    // half of this a manager can act on.
    const why = !r.transfers
      ? "No transfers logged in this range, so there is no placement to judge."
      : !scored
        ? "None of this CLR's transfers in this range could be traced to a loan officer, so there is nothing to score."
        : !need
          ? "Too few of this CLR's transfers in this range could be read to judge placement."
          : `Only ${scored} of this CLR's transfers in this range could be read, and ${need} are needed before a placement share means anything. Try a longer range.`;
    const routing = investment > 0
      ? `${investment} of the ${scored} that could be read ${investment === 1 ? "was" : "were"} recorded as`
        + ` Investment/2nd Home and judged on routing alone: ${followed} recorded Justin, Mateo or John`
        + ` and scored 100%, ${breaches} did not and scored 0%.`
      : "";
    return [why, routing].filter(Boolean).join(" ");
  };
  /**
   * WHAT KIND OF NUMBER THIS IS, said in the cell itself.
   *
   * A 0% earned by breaching the investment routing rule and a 0% earned by
   * feeding the busiest desk in the building are the same two characters in the
   * same red box, and they are not the same accusation — one is "eleven leads
   * went to the wrong people", the other is "your placement was poor". Leaving
   * that to the tooltip meant the two were told apart only by whether somebody
   * happened to hover, which is not a thing a colour-graded table may rely on.
   * So the cell carries a second line and says it.
   *
   * Null on an ordinary number, so nothing is added to a cell with nothing extra
   * to say: an unmarked share is placement, all the way down.
   */
  const placementCellNote = (r: any): string | null => {
    if (Number(r.placementUnscored ?? 0) > 0) return "routing rule off";
    if (r.placementScore == null) return null;
    const investment = Number(r.placementInvestment ?? 0);
    if (investment <= 0) return null;
    const breaches = Math.min(investment, Number(r.placementBreaches ?? 0));
    return breaches > 0 ? `${breaches} mis-routed` : `${investment} on routing`;
  };
  // `get` may answer null, and null means "nothing to score" — never zero. It
  // is kept out of the heat range below and painted as a plain cell, because a
  // column whose minimum is a phantom 0 both paints the em dash the reddest
  // colour on the table — the exact verdict the null exists to avoid — and
  // stretches everybody else's spread against a floor nobody stands on.
  const cols: Array<{
    key: string; label: string; get: (r: any) => number | null; better: boolean;
    fmt: (r: any) => string; title?: string; cellTitle?: (r: any) => string | undefined;
    // A second line under the value, for a column whose number means different
    // things on different rows. Optional, and omitted everywhere it would be
    // decoration: see placementCellNote.
    cellNote?: (r: any) => string | null;
  }> = [
    { key: "calls",        label: "Calls",     get: r => r.calls ?? 0,             better: true,  fmt: r => String(r.calls ?? 0) },
    { key: "messages",     label: "Messages",  get: r => r.messages ?? 0,          better: true,  fmt: r => String(r.messages ?? 0) },
    { key: "dialpadTexts", label: "DP Texts",  get: r => r.dialpadTexts ?? 0,      better: true,  fmt: r => String(r.dialpadTexts ?? 0) },
    { key: "contacts",     label: "Contacts",  get: r => r.callToolsContacts ?? 0, better: true,  fmt: r => String(r.callToolsContacts ?? 0) },
    { key: "conversations", label: "Convos", get: r => r.callToolsConversations ?? 0, better: true, fmt: r => String(r.callToolsConversations ?? 0) },
    { key: "activeTime", label: "Active", get: r => r.callToolsActiveSeconds ?? 0, better: true, fmt: r => `${Math.floor((r.callToolsActiveSeconds ?? 0) / 3600)}h ${Math.floor(((r.callToolsActiveSeconds ?? 0) % 3600) / 60)}m` },
    { key: "transfers",    label: "Transfers", get: r => r.transfers ?? 0,         better: true,  fmt: r => String(r.transfers ?? 0) },
    { key: "appointments", label: "Appts",     get: r => r.appointments ?? 0,      better: true,  fmt: r => String(r.appointments ?? 0) },
    // Share of every field a transfer could have had filled in that was.
    { key: "writeUp",      label: "Write-up",  get: r => r.writeUpPct ?? null,     better: true,  fmt: r => r.writeUpPct == null ? "—" : `${r.writeUpPct}%` },
    // Not a second transfer count: where each one was PUT. Same shape as
    // Write-up above — a share, higher is better, a dash when there is nothing
    // to score, because 0% is a verdict and an empty week has not earned one.
    //
    // The tooltip has to say what the server ACTUALLY does, and a test pins
    // it, because a claim the code did not back has already been caught on
    // this column twice. Once it promised that each transfer was judged "only
    // against the LOs the CLR could have chosen", and no eligible set is ever
    // supplied. (Supplying state licensing as the eligible set is the
    // mechanism this stat was built for — see TransferRow.eligible — but it
    // needs a state per transfer, and most rows have no phone this app can
    // parse one out of.) Once it described the investment rule as a desk the
    // transfer had to reach, which is not the rule Ethan gave.
    //
    // So the tooltip below names the three assistants, because that is what
    // the rule is decided on, and it says out loud that a flagged transfer
    // with none of them recorded scores zero — the sharpest thing this column
    // does, and the last thing that should be a surprise. See
    // INVESTMENT_PROPERTY_LOAS in server/transfer-priority.ts.
    { key: "placement",    label: "Placed",    get: r => r.placementScore ?? null, better: true,
      fmt: r => r.placementScore == null ? "—" : `${r.placementScore}%`,
      title: "Where transfers were PUT, not how many. Each one is judged against the floor as it stood on the morning it was made: the lightest few loan officers actually taking work are worth 100%, the busiest is worth 0%, and everyone between them ramps. Transfers the app recorded as Investment/2nd Home are not ramped at all — they had to reach one of Chris's assistants Justin, Mateo or John, so they score 100% when the transfer records one of those three and 0% for anything else, however starved the loan officer was. A flagged transfer with a different assistant, or with no assistant recorded at all, scores zero. Everything else is compared with the WHOLE floor: nothing tells this stat which loan officers were licensed for the borrower's state. On any range longer than a day the floor is counted over a fortnight PLUS the range, so this column and the wall's Starved page can name different people as starved. If the roster cannot resolve those three, the rule stops for everybody and the column shows a dash rather than a 0% nobody earned. The cell itself says when a number came from that routing rule; hover it for the full breakdown of what the share is the mean of.",
      cellTitle: placementNote, cellNote: placementCellNote },
  ];
  // Nulls are excluded, and a column with nothing but nulls has no range at all.
  const ranges = cols.map(c => {
    const v = list.map(c.get).filter((n): n is number => n != null && Number.isFinite(n));
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: 0, max: 0 };
  });
  const project = (r: any) =>
    pace && pace.daysElapsed > 0 ? Math.round(((r.transfers ?? 0) / pace.daysElapsed) * pace.daysInMonth) : null;
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 font-medium w-8">#</th>
              <th className="text-left px-3 py-2 font-medium">CLR</th>
              {cols.map(c => <th key={c.key} title={c.title} className="text-center px-3 py-2 font-medium whitespace-nowrap">{c.label}</th>)}
              {pace && <th className="text-center px-3 py-2 font-medium whitespace-nowrap" title="Projected month-end transfers. Sundays are not counted as worked days.">Pace</th>}
            </tr>
          </thead>
          <tbody>
            {list.map((r, idx) => (
              <tr key={r.userId} className="border-t border-border">
                <td className="px-3 py-2 text-muted-foreground tabular-nums">{idx + 1}</td>
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {r.name}
                    <ClrTrainingBadge inTraining={r.inTraining} activeWorkdays={r.activeWorkdays} />
                  </span>
                </td>
                {cols.map((c, ci) => {
                  const v = c.get(r);
                  // No value, no verdict: an unpainted cell in the table's own
                  // muted ink, not the bottom of a red-to-green ramp.
                  const heat = v == null ? null : heatColor(v, ranges[ci].min, ranges[ci].max, c.better);
                  return (
                    <td
                      key={c.key}
                      title={c.cellTitle?.(r)}
                      className={"px-3 py-2 text-center tabular-nums font-semibold" + (heat ? "" : " text-muted-foreground")}
                      style={heat ? { backgroundColor: heat, color: "#1f2937" } : undefined}
                    >
                      {c.fmt(r)}
                      {(() => {
                        const note = c.cellNote?.(r);
                        return note ? (
                          <div className={"text-[10px] font-normal leading-tight whitespace-nowrap"
                            + (heat ? " opacity-75" : " text-muted-foreground")}>{note}</div>
                        ) : null;
                      })()}
                    </td>
                  );
                })}
                {pace && (() => {
                  const projected = project(r);
                  const tier = projected == null ? null : paceTier(projected);
                  return (
                    <td className="px-3 py-2 text-center tabular-nums font-semibold whitespace-nowrap">
                      {projected == null ? "—" : (
                        <span className="inline-flex items-center gap-2">
                          <span className="text-muted-foreground">{projected}</span>
                          {tier && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[11px] font-bold"
                              style={{ backgroundColor: tier.color, color: tier.text }}
                              title={`On pace for ${tier.label}+ transfers this month`}
                            >
                              {tier.label}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  );
                })()}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// Range selector — pill-button group. Compact & dark-mode aware via shadcn tokens.
function RangePills<K extends string>({
  options, value, onChange, ariaLabel,
}: {
  options: { key: K; label: string; short?: string }[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel}
         className="inline-flex items-center rounded-md border bg-muted/40 p-0.5 text-xs">
      {options.map(o => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={
              "px-2.5 py-1 rounded-[4px] font-medium transition-colors tabular-nums " +
              (active
                ? "bg-card shadow-sm brand-text"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            {o.short ?? o.label}
          </button>
        );
      })}
    </div>
  );
}

function AlertsBanner({ alerts }: { alerts: Alert[] }) {
  if (!alerts?.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a, i) => {
        const palette =
          a.level === "danger"
            ? { wrap: "bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-200", Icon: AlertOctagon } :
          a.level === "warn"
            ? { wrap: "bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:border-amber-900/60 dark:text-amber-200", Icon: AlertTriangle } :
              { wrap: "bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-900/60 dark:text-blue-200", Icon: Info };
        const Icon = palette.Icon;
        const inner = (
          <div className={"flex items-start gap-3 px-4 py-2.5 rounded-lg border text-sm " + palette.wrap}>
            <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">{a.text}</div>
            {a.href && <span className="text-xs font-medium underline">View →</span>}
          </div>
        );
        return a.href ? <Link key={i} href={a.href}>{inner}</Link> : <div key={i}>{inner}</div>;
      })}
    </div>
  );
}

function GoalBar({ label, value, goal, pct, color, weeklyGoal, weeksElapsed }: {
  label?: string;
  value: number;
  goal: number;
  pct: number | null;
  color: string;
  weeklyGoal?: number;
  weeksElapsed?: number;
}) {
  const width = pct == null ? 0 : Math.min(100, pct);
  const overflow = pct != null && pct > 100;
  const tip = weeklyGoal
    ? `${label ?? "Goal"}: ${weeklyGoal}/wk × ${weeksElapsed ?? "?"} wks elapsed = ${goal} this month`
    : pct == null
      ? `${label ?? "Goal"}: not set`
      : undefined;
  return (
    <div title={tip}>
      <div className="flex justify-between items-baseline text-xs mb-0.5">
        <span className="text-muted-foreground tabular-nums">
          {label ? <span className="font-medium brand-text-soft mr-1">{label}</span> : null}
          {value} / {goal || "—"}
        </span>
        <span className="tabular-nums font-medium" style={{ color: pct == null ? "#94a3b8" : overflow ? GREEN : color }}>
          {pct == null ? "no goal" : `${pct}%`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full transition-all"
          style={{
            width: `${width}%`,
            backgroundColor: pct == null ? "#cbd5e1" : overflow ? GREEN : color,
          }}
        />
      </div>
    </div>
  );
}

function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map(r => headers.map(h => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell through",
  callback_requested: "Callback",
  deferral: "Deferral",
  no_answer: "No answer",
  future_contact: "Future contact",
};
const OUTCOME_COLORS: Record<string, string> = {
  transfer: GREEN, appointment: BLUE, fell_through: RED, callback_requested: AMBER,
  deferral: PURPLE, no_answer: "#64748b", future_contact: CYAN,
};

const WEEKDAY_SHORT = ["S", "M", "T", "W", "T", "F", "S"]; // Sun..Sat

// Tiered intensity: returns 0..4 bucket index for a value given a max scale.
function intensityBucket(v: number, max: number): number {
  if (!v || v <= 0) return 0;
  if (max <= 1) return 4;
  const r = v / max;
  if (r <= 0.2) return 1;
  if (r <= 0.45) return 2;
  if (r <= 0.7) return 3;
  return 4;
}

// Concrete numeric thresholds that match intensityBucket(...) so the legend tells the truth.
function bucketRanges(max: number): string[] {
  if (max <= 0) return ["0", "—", "—", "—", "—"];
  if (max === 1) return ["0", "—", "—", "—", "1"];
  const t1 = Math.max(1, Math.round(max * 0.2));
  const t2 = Math.max(t1 + 1, Math.round(max * 0.45));
  const t3 = Math.max(t2 + 1, Math.round(max * 0.7));
  return [
    "0",
    `1–${t1}`,
    `${t1 + 1}–${t2}`,
    `${t2 + 1}–${t3}`,
    `${t3 + 1}+`,
  ];
}

// ──────────────────────────────────────────────────────────────────────────────
// Main component

export default function ManagerDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isDark = useIsDarkMode();
  const [showAllClrs, setShowAllClrs] = useState(false);
  // Today first: the scorecard is read during the day to see where the team is
  // right now, and a 7-day window buries that under last week's numbers.
  const [scorecardRange, setScorecardRange] = useState<ScorecardRange>("today");

  // Per-section range state
  const [rangeTrend, setRangeTrend] = useState<RangeKey>("30d");
  const [rangeMix, setRangeMix] = useState<RangeKey>("30d");
  const [rangeReasons, setRangeReasons] = useState<RangeKey>("30d");
  const [rangeLeaderboard, setRangeLeaderboard] = useState<RangeKey>("30d");
  const [rangeHeatmap, setRangeHeatmap] = useState<RangeKey>("30d");
  const [rangeTopLos, setRangeTopLos] = useState<RangeKey>("30d");
  const [rangeStates, setRangeStates] = useState<RangeKey>("30d");
  const [rangeCompare, setRangeCompare] = useState<RangeKey>("30d");
  type CompareSort = "transferPct" | "appointmentPct" | "fellThroughPct" | "totalOutcomes" | "name";
  const [compareSort, setCompareSort] = useState<CompareSort>("transferPct");
  // Per-CLR trend comparison chart
  const [rangeClrTrend, setRangeClrTrend] = useState<RangeKey>("30d");
  type ClrTrendMetric = "transfers" | "appointments" | "fellThrough" | "calls";
  const [clrTrendMetric, setClrTrendMetric] = useState<ClrTrendMetric>("transfers");
  const [clrTrendSelected, setClrTrendSelected] = useState<number[] | null>(null); // null = auto (top 5)
  // Rolling-average overlay: a dashed benchmark line smoothing the average across shown CLRs.
  const [clrTrendShowAvg, setClrTrendShowAvg] = useState(true);
  const [clrTrendAvgWindow, setClrTrendAvgWindow] = useState(7); // trailing window in business days
  const [pipelineRange, setPipelineRange] = useState<PipelineRange>("1d");

  const { data, isLoading, refetch, isFetching } = useQuery<ManagerData>({
    queryKey: ["/api/manager-dashboard"],
    refetchInterval: 60_000,
  });

  const sendEodReminders = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/eod-reminders/run-now", {}),
    onSuccess: () => toast({ title: "EOD reminders sent", description: "Reminder cron triggered." }),
    onError: (e: any) => toast({ title: "Failed to send reminders", description: e?.message ?? "Try again", variant: "destructive" }),
  });

  // Trend chart data with formatted labels — depends on range.
  // Weekends are excluded entirely from the daily trend chart so the x-axis
  // only shows business days (Mon–Fri).
  const trendData = useMemo(() => {
    const block = data?.byRange?.[rangeTrend];
    if (!block) return [];
    const weekdaysOnly = dropWeekendRows(block.trend as any[], "date");
    return weekdaysOnly.map((d: any) => ({ ...d, label: format(parseISO(d.date), "MMM d") }));
  }, [data?.byRange, rangeTrend]);

  const outcomePieData = useMemo(() => {
    const block = data?.byRange?.[rangeMix];
    if (!block) return [];
    return block.outcomeBreakdown.map(o => ({
      name: OUTCOME_LABELS[o.outcome_type] ?? o.outcome_type,
      value: Number(o.count) || 0,
      color: OUTCOME_COLORS[o.outcome_type] ?? "#94a3b8",
    }));
  }, [data?.byRange, rangeMix]);

  if (isLoading || !data) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const { stats, callActivity, clrCards, eod, pipeline, activityFeed, alerts, byRange } = data;

  // KPI summary numbers (pulled from week range trend so they match KPI tiles)
  const trend30 = byRange["30d"]?.trend ?? [];
  const todayCalls = stats.today?.totalCallsToday ?? 0;
  const last7Calls = trend30.slice(-7).reduce((s, d) => s + (d.calls || 0), 0);
  const last30Calls = trend30.reduce((s, d) => s + (d.calls || 0), 0);
  const priorLast7Calls = trend30.slice(-14, -7).reduce((s, d) => s + (d.calls || 0), 0);

  // WoW deltas
  const transferDeltaWk = deltaInfo(stats.week?.transfers ?? 0, stats.priorWeek?.transfers ?? 0);
  const apptDeltaWk = deltaInfo(stats.week?.appointments ?? 0, stats.priorWeek?.appointments ?? 0);
  const fellDeltaWk = deltaInfo(stats.week?.fellThrough ?? 0, stats.priorWeek?.fellThrough ?? 0);
  const callsDeltaWk = deltaInfo(last7Calls, priorLast7Calls);
  const contactsDeltaWk = deltaInfo(callActivity.week.contacts, callActivity.priorWeek.contacts);
  const conversationsDeltaWk = deltaInfo(callActivity.week.conversations, callActivity.priorWeek.conversations);
  const transferDeltaMo = deltaInfo(stats.month?.transfers ?? 0, stats.priorMonth?.transfers ?? 0);
  const apptDeltaMo = deltaInfo(stats.month?.appointments ?? 0, stats.priorMonth?.appointments ?? 0);
  const fellDeltaMo = deltaInfo(stats.month?.fellThrough ?? 0, stats.priorMonth?.fellThrough ?? 0);
  const contactsDeltaMo = deltaInfo(callActivity.month.contacts, callActivity.priorMonth.contacts);
  const conversationsDeltaMo = deltaInfo(callActivity.month.conversations, callActivity.priorMonth.conversations);

  const visibleClrs = showAllClrs ? clrCards : clrCards.slice(0, 6);

  // Pipeline transfers — slice to selected range
  const cutoffDate = (() => {
    const days = pipelineRange === "1d" ? 0 : pipelineRange === "3d" ? 2 : 6;
    const d = new Date(); d.setDate(d.getDate() - days);
    return d.toISOString().split("T")[0];
  })();
  const filteredTransfers = (pipeline.transfers7d ?? []).filter((t: any) => t.date >= cutoffDate);
  const filteredOverdueAppts = pipeline.overdueAppointments; // overdue is independent of range
  const filteredOverdueNmls = pipeline.overdueNmls;

  // Active range blocks
  const reasonsBlock = byRange[rangeReasons];
  const leaderboardBlock = byRange[rangeLeaderboard];
  const heatmapBlock = byRange[rangeHeatmap];
  const topLosBlock = byRange[rangeTopLos];
  const statesBlock = byRange[rangeStates];
  const compareBlock = byRange[rangeCompare];

  // Sorted CLR-comparison rows, filtered to CLRs with at least one logged outcome.
  const compareRows = (compareBlock?.leaderboard ?? [])
    .filter(r => r.totalOutcomes > 0)
    .sort((a, b) => {
      if (compareSort === "name") return a.name.localeCompare(b.name);
      const av = (a as any)[compareSort] ?? 0;
      const bv = (b as any)[compareSort] ?? 0;
      return bv - av;
    });
  // Chart data — stacked %s, ordered same as compareRows. Recharts uses one row per CLR.
  const compareChartData = compareRows.map(r => ({
    name: r.inTraining ? `${r.name} · In training` : r.name,
    transferPct: r.transferPct,
    appointmentPct: r.appointmentPct,
    fellThroughPct: r.fellThroughPct,
    otherPct: Math.max(0, Math.round((100 - r.transferPct - r.appointmentPct - r.fellThroughPct) * 10) / 10),
    transfers: r.transfers,
    appointments: r.appointments,
    fellThrough: r.fellThrough,
    totalOutcomes: r.totalOutcomes,
  }));

  // ── Per-CLR trend comparison ──
  const clrTrendBlock = byRange[rangeClrTrend];
  const clrTrendSeries = clrTrendBlock?.clrTrend?.series ?? [];
  const clrTrendDates = clrTrendBlock?.clrTrend?.dates ?? [];
  // Default selection: top 5 CLRs by current metric total (so the chart isn't empty/cluttered).
  const clrTrendTotals = clrTrendSeries
    .map((s: any) => ({
      userId: s.userId,
      name: s.name,
      activeWorkdays: s.activeWorkdays,
      inTraining: s.inTraining,
      total: (s[clrTrendMetric] as number[] | undefined)?.reduce((a, b) => a + (b || 0), 0) ?? 0,
    }))
    .sort((a: any, b: any) => b.total - a.total);
  const autoSelectedIds = clrTrendTotals.filter(t => t.total > 0).slice(0, 5).map(t => t.userId);
  const effectiveSelected = clrTrendSelected ?? autoSelectedIds;
  // Build chart rows: one row per date, one column per selected CLR.
  // Skip weekend dates so the per-CLR comparison only shows business days.
  const clrTrendRows = clrTrendDates.flatMap((d: string, i: number) => {
    if (!isWeekday(d)) return [];
    const row: any = { date: d, label: format(parseISO(d), "MMM d") };
    // Per-CLR columns: only the selected/shown CLRs get a plotted line.
    for (const s of clrTrendSeries) {
      if (!effectiveSelected.includes(s.userId)) continue;
      const arr = (s as any)[clrTrendMetric] as number[];
      row[`u${s.userId}`] = arr[i] ?? 0;
    }
    // Benchmark mean = average per CLR across the WHOLE team, not just the shown
    // lines, so the dashed line doesn't move when you toggle individual lines.
    //
    // Days a CLR did not work are excluded rather than counted as a zero. With
    // no calls AND no transfers there is nothing to average — they were out, and
    // folding that in drags the benchmark down until it measures attendance
    // instead of performance. A real zero (someone in the office who logged
    // calls but got no transfers) still counts.
    let teamSum = 0, teamN = 0, teamAbsent = 0, teamTrainingExcluded = 0;
    for (const s of clrTrendSeries) {
      if (s.inTraining) { teamTrainingExcluded++; continue; }
      const calls = ((s as any).calls as number[] | undefined)?.[i] ?? 0;
      const transfers = ((s as any).transfers as number[] | undefined)?.[i] ?? 0;
      if (calls === 0 && transfers === 0) { teamAbsent++; continue; }
      const arr = (s as any)[clrTrendMetric] as number[];
      teamSum += arr[i] ?? 0;
      teamN++;
    }
    row.__mean = teamN > 0 ? teamSum / teamN : 0; // avg metric per WORKING CLR
    row.__worked = teamN;
    row.__absent = teamAbsent;
    row.__trainingExcluded = teamTrainingExcluded;
    return row;
  });
  // Overlay a trailing rolling average of the per-day mean (window in business days,
  // partial window at the start so the line spans the whole chart). Same scale as the
  // CLR lines, so it reads as a "team average" benchmark.
  const clrTrendWindow = Math.max(1, clrTrendAvgWindow);
  const clrTrendChartData = clrTrendRows.map((row: any, i: number) => {
    const start = Math.max(0, i - clrTrendWindow + 1);
    let acc = 0, cnt = 0;
    for (let j = start; j <= i; j++) {
      // A day when nobody worked (holiday, closure) has no mean to contribute —
      // averaging its 0 in would dent the line for the rest of the window.
      if ((clrTrendRows[j].__worked ?? 0) === 0) continue;
      acc += clrTrendRows[j].__mean;
      cnt++;
    }
    return { ...row, __avg: cnt > 0 ? Math.round((acc / cnt) * 100) / 100 : 0 };
  });
  // Stable color palette for CLR lines.
  const CLR_LINE_COLORS = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#0ea5e9", "#f59e0b"];
  const colorForId = (uid: number) => {
    const idx = clrTrendSeries.findIndex((s: any) => s.userId === uid);
    return CLR_LINE_COLORS[(idx >= 0 ? idx : 0) % CLR_LINE_COLORS.length];
  };
  const clrTrendMetricLabel = ({
    transfers: "Transfers",
    appointments: "Appointments",
    fellThrough: "Fell through",
    calls: "Calls",
  } as Record<ClrTrendMetric, string>)[clrTrendMetric];
  const toggleClrSelection = (uid: number) => {
    const current = clrTrendSelected ?? autoSelectedIds;
    const next = current.includes(uid) ? current.filter(x => x !== uid) : [...current, uid];
    setClrTrendSelected(next);
  };

  const handleExportCsv = () => {
    const rows = clrCards.map(c => ({
      Name: c.name, Email: c.email,
      Calls: c.calls, "Calls goal (prorated)": c.goalCalls, "Calls %": c.callsPct ?? "",
      Transfers: c.transfers, "Transfer goal (prorated)": c.goalTransfers, "Transfer %": c.transfersPct ?? "",
      Appointments: c.appointments, "Appt goal (prorated)": c.goalAppts, "Appt %": c.apptsPct ?? "",
      "Fell through": c.fellThrough,
      Callbacks: c.callbacks, "No answer": c.noAnswer, "Future contact": c.futureContact,
      "Assigned": c.assigned, "Completed": c.completed, "Completion %": c.completionPct ?? "",
      "Call→Transfer %": c.callToTransferRatio ?? "",
    }));
    const dateTag = businessTodayClient();
    downloadCsv(`clr-team-report-${dateTag}.csv`, rows);
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider"
                  style={{ backgroundColor: NAVY, color: GOLD }}>
              Manager view
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mt-1 brand-text">
            Welcome back, {user?.name?.split(" ")[0] ?? "Manager"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Team overview · {format(parseISO(data.today), "EEEE, MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Alerts banner */}
      <AlertsBanner alerts={alerts} />

      {/* KPI tiles — Today */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Today</div>
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
          <KpiTile label="Calls" value={todayCalls.toLocaleString()} icon={PhoneCall} color={isDark ? GOLD : NAVY} />
          <KpiTile label="Contacts" value={callActivity.today.contacts} icon={Users} color={CYAN} />
          <KpiTile label="Conversations" value={callActivity.today.conversations} icon={Activity} color={AMBER} />
          <KpiTile label="Active Time" value={`${Math.floor(callActivity.today.activeSeconds / 3600)}h ${Math.floor((callActivity.today.activeSeconds % 3600) / 60)}m`} icon={Clock} color={CYAN} />
          <KpiTile label="Transfers" value={stats.today?.transfers ?? 0} icon={ArrowUpRight} color={GREEN} />
          <KpiTile label="Appointments" value={stats.today?.appointments ?? 0} icon={Calendar} color={BLUE} />
          <KpiTile label="Fell through" value={stats.today?.fellThrough ?? 0} icon={XCircle} color={RED} />
        </div>
      </div>

      {/* KPI tiles — This week with WoW deltas */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">This week</div>
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
          <KpiTile label="Calls (7d)" value={last7Calls.toLocaleString()} icon={PhoneCall} color={isDark ? GOLD : NAVY}
                   delta={<DeltaArrow {...callsDeltaWk} />} />
          <KpiTile label="Contacts" value={callActivity.week.contacts} icon={Users} color={CYAN}
                   delta={<DeltaArrow {...contactsDeltaWk} />} />
          <KpiTile label="Conversations" value={callActivity.week.conversations} icon={Activity} color={AMBER}
                   delta={<DeltaArrow {...conversationsDeltaWk} />} />
          <KpiTile label="Active Time" value={`${Math.floor(callActivity.week.activeSeconds / 3600)}h ${Math.floor((callActivity.week.activeSeconds % 3600) / 60)}m`} icon={Clock} color={CYAN} />
          <KpiTile label="Transfers" value={stats.week?.transfers ?? 0} icon={ArrowUpRight} color={GREEN}
                   delta={<DeltaArrow {...transferDeltaWk} />} />
          <KpiTile label="Appointments" value={stats.week?.appointments ?? 0} icon={Calendar} color={BLUE}
                   delta={<DeltaArrow {...apptDeltaWk} />} />
          <KpiTile label="Fell through" value={stats.week?.fellThrough ?? 0} icon={XCircle} color={RED}
                   delta={<DeltaArrow {...fellDeltaWk} invert />} />
        </div>
      </div>

      {/* KPI tiles — This month with MoM deltas */}
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">This month</div>
        <div className="grid grid-cols-2 lg:grid-cols-7 gap-3">
          <KpiTile label="Contacts" value={callActivity.month.contacts} icon={Users} color={CYAN}
                   delta={<DeltaArrow {...contactsDeltaMo} />} />
          <KpiTile label="Conversations" value={callActivity.month.conversations} icon={Activity} color={AMBER}
                   delta={<DeltaArrow {...conversationsDeltaMo} />} />
          <KpiTile label="Active Time" value={`${Math.floor(callActivity.month.activeSeconds / 3600)}h ${Math.floor((callActivity.month.activeSeconds % 3600) / 60)}m`} icon={Clock} color={CYAN} />
          <KpiTile label="Transfers" value={stats.month?.transfers ?? 0} sub={`Conv ${stats.month?.conversionRate ?? 0}%`}
                   icon={ArrowUpRight} color={GREEN} delta={<DeltaArrow {...transferDeltaMo} />} />
          <KpiTile label="Appointments" value={stats.month?.appointments ?? 0} icon={Calendar} color={BLUE}
                   delta={<DeltaArrow {...apptDeltaMo} />} />
          <KpiTile label="Fell through" value={stats.month?.fellThrough ?? 0} icon={XCircle} color={RED}
                   delta={<DeltaArrow {...fellDeltaMo} invert />} />
          <KpiTile label="Calls (30d)" value={last30Calls.toLocaleString()} sub={`${last7Calls.toLocaleString()} this wk`}
                   icon={TrendingUp} color={isDark ? GOLD_2 : NAVY_2} />
        </div>
      </div>

      {/* Weekly Scorecard — running last-7-days per-CLR snapshot (heatmap) */}
      <div>
        <SectionTitle
          icon={Award}
          action={<RangePills options={SCORECARD_OPTIONS} value={scorecardRange} onChange={setScorecardRange} ariaLabel="Transfer scorecard range" />}
        >
          Transfer Scorecard — {byRange[scorecardRange]?.window?.label ?? ""}
        </SectionTitle>
        {scorecardRange === "mtd" && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Pace projects the whole month from what has happened so far, Sundays not counted:</span>
            {[...PACE_TIERS].reverse().map(t => (
              <span key={t.at} className="rounded px-1.5 py-0.5 font-bold" style={{ backgroundColor: t.color, color: t.text }}>
                {t.label}+
              </span>
            ))}
          </div>
        )}
        <TransferScorecard
          pace={scorecardRange === "mtd" ? (() => {
            const w = byRange.mtd?.window;
            if (!w?.endDate) return undefined;
            const [y, m, d] = w.endDate.split("-").map(Number);
            // Sundays are not working days, so BOTH halves of the ratio count only
            // non-Sundays: divide by the ones already worked, multiply by the ones
            // the month will have. Feeding one half non-Sundays and the other raw
            // calendar days would inflate every projection by about a seventh.
            // (Deliberately not the comp estimate's rule — see shared/pace-days.ts.)
            return {
              daysElapsed: countNonSundaysInMonth(y, m, d),
              daysInMonth: countNonSundaysInMonth(y, m),
            };
          })() : undefined}
          rows={byRange[scorecardRange]?.leaderboard ?? []}
          rangeLabel={byRange[scorecardRange]?.window?.label ?? SCORECARD_OPTIONS.find(option => option.key === scorecardRange)?.label ?? "selected"}
        />
        <p className="text-[11px] text-muted-foreground mt-2">
          {scorecardRange === "today"
            ? "Today only, and still filling in as the day goes on."
            : scorecardRange === "mtd"
              ? "From the 1st of the month to today, so it grows as the month goes on. Pace projects the whole month at the rate so far — treat it lightly in the first few days."
              : "Includes today and the selected number of previous calendar days."}
          {" "}Each cell is graded against the column — green is strongest, red weakest. Fell-through is inverted (fewer is better). C&gt;T% = transfers per call.
        </p>
      </div>

      {/* Trend chart with range selector */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2 brand-text">
              <TrendingUp className="w-4 h-4" style={{ color: GOLD }} />
              Team trend — {byRange[rangeTrend]?.window?.label ?? ""}
            </CardTitle>
            <RangePills options={RANGE_OPTIONS} value={rangeTrend} onChange={setRangeTrend} ariaLabel="Trend range" />
          </div>
        </CardHeader>
        <CardContent>
          {trendData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data in this range</div>
          ) : (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} interval={Math.max(0, Math.floor(trendData.length / 8))} />
                    <YAxis yAxisId="count" tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} />
                    {/* Write-up is a percentage; on the counts axis it would be
                        either flattened or towering. Its own 0-100 scale. */}
                    <YAxis
                      yAxisId="pct" orientation="right" domain={[0, 100]} unit="%"
                      tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: isDark ? "#1f1d1c" : "#ffffff", border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`, color: isDark ? "#e4e4e7" : "#0f172a" }}
                      formatter={(v: any, n: any) => (n === "Write-up" ? (v == null ? "—" : `${v}%`) : v)}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line yAxisId="count" type="monotone" dataKey="transfers" stroke={GREEN} strokeWidth={2} dot={false} name="Transfers" />
                    <Line yAxisId="count" type="monotone" dataKey="appointments" stroke={BLUE} strokeWidth={2} dot={false} name="Appointments" />
                    <Line yAxisId="count" type="monotone" dataKey="fellThrough" stroke={RED} strokeWidth={2} dot={false} name="Fell through" />
                    {/* Breaks on a day with no transfers rather than dropping to
                        zero, which would read as a collapse instead of a quiet day. */}
                    <Line
                      yAxisId="pct" type="monotone" dataKey="writeUpRate" stroke={GOLD}
                      strokeWidth={2} strokeDasharray="5 4" dot={false}
                      name="Write-up" connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="h-32 mt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} interval={Math.max(0, Math.floor(trendData.length / 8))} />
                    <YAxis tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }} />
                    <Tooltip contentStyle={{ backgroundColor: isDark ? "#1f1d1c" : "#ffffff", border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`, color: isDark ? "#e4e4e7" : "#0f172a" }} />
                    {/* Stacked per request, so the bar height is the two feeds
                        combined. Read the total with care: on a given day most
                        CLRs appear in BOTH feeds with large counts, and nothing
                        available distinguishes the same call measured twice from
                        two genuinely separate calls — so the stack is an upper
                        bound, not a verified total. The segments stay separately
                        coloured and labelled for exactly that reason, and one
                        feed stalling still leaves the other visible. */}
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="calls" stackId="calls" fill={isDark ? GOLD : NAVY_2} name="CallTools + logged" />
                    <Bar dataKey="dialpadCalls" stackId="calls" fill={PURPLE} name="Dialpad" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Outcome mix + Fell-through reasons (each with own range) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={PieIcon}
            action={<RangePills options={RANGE_OPTIONS} value={rangeMix} onChange={setRangeMix} ariaLabel="Outcome mix range" />}
          >
            Outcome mix — {byRange[rangeMix]?.window?.label ?? ""}
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {outcomePieData.length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No outcomes in this range</div>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={outcomePieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                           label={(e: any) => `${e.name} ${Math.round((e.percent || 0) * 100)}%`}
                           stroke={isDark ? "#1f1d1c" : "#ffffff"}>
                        {outcomePieData.map((entry, idx) => (
                          <Cell key={idx} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: isDark ? "#1f1d1c" : "#ffffff", border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`, color: isDark ? "#e4e4e7" : "#0f172a" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <SectionTitle icon={Flame}
            action={<RangePills options={RANGE_OPTIONS} value={rangeReasons} onChange={setRangeReasons} ariaLabel="Reasons range" />}
          >
            Fell-through reasons — {byRange[rangeReasons]?.window?.label ?? ""}
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {(reasonsBlock?.fellThroughReasons ?? []).length === 0 ? (
                <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No fell-through reasons recorded</div>
              ) : (
                <ul className="space-y-2.5">
                  {reasonsBlock!.fellThroughReasons.map((r, i) => {
                    const max = reasonsBlock!.fellThroughReasons[0].count;
                    const pct = Math.round((r.count / max) * 100);
                    return (
                      <li key={r.label}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium brand-text">{r.label}</span>
                          <span className="tabular-nums text-muted-foreground">{r.count}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: RED, opacity: 0.7 }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="text-[11px] text-muted-foreground mt-4">
                Reasons inferred from EOD note keywords. Refine notes for tighter classification.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Per-CLR drilldown cards — month-to-date counts vs weekly-goal prorated to month-to-date. */}
      <div>
        <SectionTitle icon={Target} action={
          <Button variant="ghost" size="sm" className="px-0 h-auto brand-text underline-offset-4 hover:underline"
                  onClick={() => setShowAllClrs(s => !s)}>
            {showAllClrs ? "Show top 6" : `Show all ${clrCards.length}`} →
          </Button>
        }>
          Per-CLR performance — month to date
        </SectionTitle>
        <p className="text-xs text-muted-foreground mb-3 -mt-1">
          Counts cover the current calendar month so far. Each CLR’s goals are stored as <span className="font-medium brand-text-soft">weekly</span> targets and prorated by weeks elapsed{clrCards[0]?.weeksElapsed != null ? ` (${clrCards[0].weeksElapsed} wks)` : ""}. Hover a bar to see that CLR’s exact weekly goal.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleClrs.map(c => (
            <Card key={c.userId}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="font-semibold truncate brand-text">{c.name}</div>
                    <ClrTrainingBadge inTraining={c.inTraining} activeWorkdays={c.activeWorkdays} />
                  </div>
                  {c.completionPct != null && (
                    <Badge variant="outline" className="tabular-nums" style={{
                      borderColor: c.completionPct >= 80 ? GREEN : c.completionPct >= 50 ? AMBER : RED,
                      color: c.completionPct >= 80 ? GREEN : c.completionPct >= 50 ? AMBER : RED,
                    }}>
                      {c.completionPct}% list
                    </Badge>
                  )}
                </div>
                <div className="space-y-2.5">
                  <GoalBar label="Calls" value={c.calls} goal={c.goalCalls} pct={c.callsPct} color={isDark ? GOLD_2 : NAVY_2}
                           weeklyGoal={c.goalCallsWeekly} weeksElapsed={c.weeksElapsed} />
                  <GoalBar label="Transfers" value={c.transfers} goal={c.goalTransfers} pct={c.transfersPct} color={GREEN}
                           weeklyGoal={c.goalTransfersWeekly} weeksElapsed={c.weeksElapsed} />
                  <GoalBar label="Appointments" value={c.appointments} goal={c.goalAppts} pct={c.apptsPct} color={BLUE}
                           weeklyGoal={c.goalAppointmentsWeekly} weeksElapsed={c.weeksElapsed} />
                </div>
                <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Fell</div>
                    <div className="text-sm font-semibold tabular-nums" style={{ color: RED }}>{c.fellThrough}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Callbacks</div>
                    <div className="text-sm font-semibold tabular-nums" style={{ color: AMBER }}>{c.callbacks}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">C→T %</div>
                    <div className="text-sm font-semibold tabular-nums brand-text">
                      {c.callToTransferRatio == null ? "—" : `${c.callToTransferRatio}%`}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {clrCards.length === 0 && (
            <div className="col-span-full text-center text-muted-foreground py-6 text-sm">No CLRs found</div>
          )}
        </div>
      </div>

      {/* Heatmaps — outcomes + calls, shared range selector */}
      <div>
        <SectionTitle icon={BarChart3}
          action={<RangePills options={RANGE_OPTIONS} value={rangeHeatmap} onChange={setRangeHeatmap} ariaLabel="Heatmap range" />}
        >
          Activity by CLR — {byRange[rangeHeatmap]?.window?.label ?? ""}
        </SectionTitle>
        <div className="grid grid-cols-1 gap-4">
          <HeatmapCard
            title="Outcomes per day"
            tone="navy"
            block={heatmapBlock?.heatmap}
            isDark={isDark}
            valueLabel="outcome"
          />
          <HeatmapCard
            title="Calls per day"
            tone="green"
            block={heatmapBlock?.callsHeatmap}
            isDark={isDark}
            valueLabel="call"
          />
        </div>
      </div>

      {/* Adjustable Leaderboard */}
      <div>
        <SectionTitle icon={Trophy}
          action={
            <div className="flex items-center gap-2">
              <RangePills options={RANGE_OPTIONS} value={rangeLeaderboard} onChange={setRangeLeaderboard} ariaLabel="Leaderboard range" />
              <Link href="/leaderboard"><Button variant="ghost" size="sm" className="px-0 h-auto brand-text underline-offset-4 hover:underline">View all →</Button></Link>
            </div>
          }
        >
          Leaderboard — {byRange[rangeLeaderboard]?.window?.label ?? ""}
          {(leaderboardBlock?.textTransfersTotal ?? 0) > 0 && (
            <span className="ml-2 text-xs font-normal text-muted-foreground">· {leaderboardBlock?.textTransfersTotal} from texting</span>
          )}
        </SectionTitle>
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">CLR</th>
                  <th className="text-right px-2 py-2 font-medium">Transfers</th>
                  <th className="text-right px-2 py-2 font-medium" title="Transfers that came from texting (Bulk Texter)">Texting</th>
                  <th className="text-right px-4 py-2 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {(leaderboardBlock?.leaderboard ?? []).length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted-foreground py-6">No activity in this range</td></tr>
                )}
                {(leaderboardBlock?.leaderboard ?? []).slice(0, 10).map((row, idx) => (
                  <tr key={row.userId} className="border-t">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold"
                              style={{
                                backgroundColor: idx === 0 ? GOLD : isDark ? "#3f3d3a" : "#e5e7eb",
                                color: idx === 0 ? NAVY : isDark ? "#e4e4e7" : "#374151",
                              }}>
                          {idx + 1}
                        </span>
                        <span className="font-medium">{row.name ?? "—"}</span>
                        <ClrTrainingBadge inTraining={row.inTraining} activeWorkdays={row.activeWorkdays} />
                      </div>
                    </td>
                    <td className="text-right px-2 py-2 tabular-nums font-semibold" style={{ color: GREEN }}>{row.transfers ?? 0}</td>
                    <td className="text-right px-2 py-2 tabular-nums font-medium brand-text-soft" title="from texting">{row.textTransfers ?? 0}</td>
                    <td className="text-right px-4 py-2 tabular-nums font-medium brand-text-soft">
                      {(row.calls ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      {/* Per-CLR trend comparison — one line per selected CLR */}
      <div>
        <SectionTitle
          icon={TrendingUp}
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <RangePills options={RANGE_OPTIONS} value={rangeClrTrend} onChange={setRangeClrTrend} ariaLabel="CLR trend range" />
              <select
                value={clrTrendMetric}
                onChange={(e) => setClrTrendMetric(e.target.value as ClrTrendMetric)}
                aria-label="Trend metric"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium brand-text focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="transfers">Transfers</option>
                <option value="appointments">Appointments</option>
                <option value="fellThrough">Fell through</option>
                <option value="calls">Calls</option>
              </select>
              <select
                value={clrTrendShowAvg ? String(clrTrendAvgWindow) : "off"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "off") { setClrTrendShowAvg(false); return; }
                  setClrTrendShowAvg(true);
                  setClrTrendAvgWindow(Number(v));
                }}
                aria-label="Rolling average window"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium brand-text focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="off">No avg</option>
                <option value="3">3-day avg</option>
                <option value="5">5-day avg</option>
                <option value="7">7-day avg</option>
                <option value="14">14-day avg</option>
              </select>
            </div>
          }
        >
          CLR trend comparison — {clrTrendMetricLabel} · {clrTrendBlock?.window?.label ?? ""}
        </SectionTitle>
        <Card>
          <CardContent className="p-4">
            {/* CLR selection pills */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              {clrTrendTotals.length === 0 ? (
                <span className="text-xs text-muted-foreground">No CLRs available</span>
              ) : (
                <>
                  {clrTrendTotals.map((t: any) => {
                    const active = effectiveSelected.includes(t.userId);
                    const c = colorForId(t.userId);
                    return (
                      <button
                        key={t.userId}
                        type="button"
                        onClick={() => toggleClrSelection(t.userId)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          active
                            ? "font-semibold"
                            : "bg-transparent text-muted-foreground border-input hover:bg-muted/40"
                        }`}
                        style={active ? { backgroundColor: c, borderColor: c, color: "#fff" } : undefined}
                        aria-pressed={active}
                      >
                        {t.name}
                        {t.total > 0 ? <span className="ml-1 opacity-80">· {t.total}</span> : null}
                        {t.inTraining ? <span className="ml-1 opacity-90">· In training</span> : null}
                      </button>
                    );
                  })}
                  {clrTrendSelected !== null && (
                    <button
                      type="button"
                      onClick={() => setClrTrendSelected(null)}
                      className="text-xs px-2.5 py-1 rounded-full border border-input text-muted-foreground hover:bg-muted/40"
                    >
                      Reset
                    </button>
                  )}
                </>
              )}
            </div>

            {clrTrendChartData.length === 0 || effectiveSelected.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                {effectiveSelected.length === 0 ? "Select a CLR to display" : "No data in this range"}
              </div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={clrTrendChartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }}
                      interval={Math.max(0, Math.floor(clrTrendChartData.length / 8))}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDark ? "#1f1d1c" : "#ffffff",
                        border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`,
                        color: isDark ? "#e4e4e7" : "#0f172a",
                      }}
                      // Say how many CLRs the day's average was taken over, so a
                      // benchmark that moves because people were out is legible
                      // rather than mysterious.
                      labelFormatter={(label: any, payload: any) => {
                        const row = payload?.[0]?.payload;
                        const worked = row?.__worked;
                        const absent = row?.__absent ?? 0;
                        const training = row?.__trainingExcluded ?? 0;
                        if (worked == null) return label;
                        return `${label} · ${worked} averaged${absent ? `, ${absent} out` : ""}${training ? `, ${training} in training excluded` : ""}`;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {clrTrendSeries
                      .filter((s: any) => effectiveSelected.includes(s.userId))
                      .map((s: any) => (
                        <Line
                          key={s.userId}
                          type="monotone"
                          dataKey={`u${s.userId}`}
                          stroke={colorForId(s.userId)}
                          strokeWidth={2}
                          dot={false}
                          name={s.inTraining ? `${s.name} · In training` : s.name}
                        />
                      ))}
                    {clrTrendShowAvg && (
                      <Line
                        type="monotone"
                        dataKey="__avg"
                        stroke={isDark ? "#fafafa" : "#0f172a"}
                        strokeWidth={2.5}
                        strokeDasharray="6 4"
                        dot={false}
                        name={`Avg per non-training working CLR · ${clrTrendWindow}d`}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground mt-3">
              Click a CLR pill to toggle its line. Defaults to top 5 by {clrTrendMetricLabel.toLowerCase()} in this range.
              {clrTrendShowAvg ? ` Dashed line = ${clrTrendWindow}-business-day rolling average of ${clrTrendMetricLabel.toLowerCase()} per working CLR who has completed training. In-training CLRs stay visible but are excluded from that average.` : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* CLR conversion comparison — stacked %s by CLR */}
      <div>
        <SectionTitle
          icon={BarChart3}
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <RangePills options={RANGE_OPTIONS} value={rangeCompare} onChange={setRangeCompare} ariaLabel="Comparison range" />
              <select
                value={compareSort}
                onChange={(e) => setCompareSort(e.target.value as CompareSort)}
                aria-label="Sort comparison by"
                className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium brand-text focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="transferPct">Sort: Transfer %</option>
                <option value="appointmentPct">Sort: Appt %</option>
                <option value="fellThroughPct">Sort: Fell %</option>
                <option value="totalOutcomes">Sort: Total outcomes</option>
                <option value="name">Sort: Name (A–Z)</option>
              </select>
            </div>
          }
        >
          CLR conversion comparison — {compareBlock?.window?.label ?? ""}
        </SectionTitle>
        <Card>
          <CardContent className="p-4">
            {compareRows.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">
                No outcomes recorded in this range
              </div>
            ) : (
              <>
                <div style={{ height: Math.max(240, compareRows.length * 36 + 60) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={compareChartData}
                      layout="vertical"
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#27272a" : "#e5e7eb"} horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[0, 100]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 11, fill: isDark ? "#a1a1aa" : "#64748b" }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={130}
                        tick={{ fontSize: 11, fill: isDark ? "#e4e4e7" : "#0f172a" }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: isDark ? "#1f1d1c" : "#ffffff",
                          border: `1px solid ${isDark ? "#3f3d3a" : "#e5e7eb"}`,
                          color: isDark ? "#e4e4e7" : "#0f172a",
                        }}
                        formatter={(value: any, name: any, props: any) => {
                          const r = props?.payload ?? {};
                          if (name === "Transfer %") return [`${value}% (${r.transfers})`, name];
                          if (name === "Appt %") return [`${value}% (${r.appointments})`, name];
                          if (name === "Fell %") return [`${value}% (${r.fellThrough})`, name];
                          if (name === "Other %") return [`${value}%`, name];
                          return [value, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="transferPct" stackId="a" fill={GREEN} name="Transfer %" />
                      <Bar dataKey="appointmentPct" stackId="a" fill={BLUE} name="Appt %" />
                      <Bar dataKey="fellThroughPct" stackId="a" fill={RED} name="Fell %" />
                      <Bar dataKey="otherPct" stackId="a" fill="#94a3b8" name="Other %" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">#</th>
                        <th className="text-left px-3 py-2 font-medium">CLR</th>
                        <th className="text-right px-3 py-2 font-medium">Transfer %</th>
                        <th className="text-right px-3 py-2 font-medium">Appt %</th>
                        <th className="text-right px-3 py-2 font-medium">Fell %</th>
                        <th className="text-right px-3 py-2 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareRows.map((row, idx) => (
                        <tr key={row.userId} className="border-t hover:bg-muted/40">
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{idx + 1}</td>
                          <td className="px-3 py-2 font-medium brand-text">
                            <span className="inline-flex items-center gap-1.5">
                              {row.name ?? "—"}
                              <ClrTrainingBadge inTraining={row.inTraining} activeWorkdays={row.activeWorkdays} />
                            </span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            <span className="font-semibold" style={{ color: GREEN }}>{row.transferPct}%</span>
                            <span className="ml-1 text-xs text-muted-foreground">({row.transfers})</span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            <span className="font-semibold" style={{ color: BLUE }}>{row.appointmentPct}%</span>
                            <span className="ml-1 text-xs text-muted-foreground">({row.appointments})</span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">
                            <span className="font-semibold" style={{ color: RED }}>{row.fellThroughPct}%</span>
                            <span className="ml-1 text-xs text-muted-foreground">({row.fellThrough})</span>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums font-medium brand-text-soft">{row.totalOutcomes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* EOD reports row (full width on its own) */}
      <div>
        <SectionTitle
          icon={CheckCircle2}
          action={
            <Button variant="outline" size="sm" onClick={() => sendEodReminders.mutate()}
                    disabled={sendEodReminders.isPending || eod.missing === 0}>
              <Send className="w-4 h-4 mr-2" />
              {sendEodReminders.isPending ? "Sending..." : `Remind ${eod.missing}`}
            </Button>
          }
        >
          EOD reports — today
        </SectionTitle>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4 mb-3">
              <div className="text-2xl font-bold tabular-nums brand-text">
                {eod.submitted}<span className="text-muted-foreground font-normal">/{eod.total}</span>
              </div>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full transition-all" style={{
                    width: `${eod.total > 0 ? Math.round((eod.submitted / eod.total) * 100) : 0}%`,
                    backgroundColor: eod.missing === 0 ? GREEN : GOLD,
                  }} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {eod.missing === 0 ? "All reports submitted" : `${eod.missing} outstanding`}
                  {` · due ${eod.dueLabel}`}
                  {eod.late > 0 && ` · ${eod.late} late`}
                </div>
              </div>
            </div>
            {/* The checklist turned into work a manager can act on: which task
                got skipped, and by whom. A count alone ("3 gaps") tells them
                something is wrong without telling them what to chase. */}
            {eod.checklistGaps?.some(g => g.no.length > 0) && (
              <div className="mb-3 rounded-md border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/20 px-3 py-2 space-y-1" data-testid="eod-checklist-gaps">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Checklist gaps today</p>
                {eod.checklistGaps.filter(g => g.no.length > 0).map(g => (
                  <div key={g.key} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-foreground">{g.label}</span>
                    <span className="text-red-700 dark:text-red-400 text-right">{g.no.join(", ")}</span>
                  </div>
                ))}
              </div>
            )}

            {/* What the floor actually reported today. The submission tracker
                below still answers "did it arrive"; this answers "what does it
                say", which is the part a manager was opening each email for. */}
            <div className="mb-3 overflow-x-auto">
              <table className="w-full text-xs" data-testid="eod-digest-table">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left font-medium px-2 py-1.5">CLR</th>
                    <th className="text-right font-medium px-2 py-1.5">Calls</th>
                    <th className="text-right font-medium px-2 py-1.5">Msgs</th>
                    <th className="text-right font-medium px-2 py-1.5">Convos</th>
                    <th className="text-right font-medium px-2 py-1.5">Xfer</th>
                    <th className="text-right font-medium px-2 py-1.5">Appt</th>
                    <th className="text-right font-medium px-2 py-1.5">LOs</th>
                    <th className="text-left font-medium px-2 py-1.5 min-w-[14rem]">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {eod.rows.filter(r => r.submitted).map(r => (
                    <tr key={r.userId} className="border-b last:border-0 align-top hover:bg-muted/30">
                      <td className="px-2 py-1.5 font-medium whitespace-nowrap">
                        {r.name}
                        <ClrTrainingBadge inTraining={r.inTraining} activeWorkdays={r.activeWorkdays} className="ml-1" />
                        {r.late && <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">late</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.calls ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.messages ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.conversations ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold" style={{ color: GREEN }}>{r.transfers ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{r.appointments ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{r.losCalled ?? 0}</td>
                      <td className="px-2 py-1.5 text-muted-foreground leading-snug">{r.notes || "—"}</td>
                    </tr>
                  ))}
                  {eod.rows.some(r => r.submitted) && (
                    <tr className="bg-muted/40 font-semibold">
                      <td className="px-2 py-1.5">Team</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{eod.totals?.calls ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{eod.totals?.messages ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{eod.totals?.conversations ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums" style={{ color: GREEN }}>{eod.totals?.transfers ?? 0}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{eod.totals?.appointments ?? 0}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                  {!eod.rows.some(r => r.submitted) && (
                    <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground">No reports filed yet today.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Ask-only work: the interesting answer is who picked it up, not
                who didn't — nobody is expected to by default. */}
            {eod.extraWork?.some(w => w.yes.length > 0) && (
              <div className="mb-3 rounded-md border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 space-y-1" data-testid="eod-extra-work">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Retail Bonzo worked today</p>
                {eod.extraWork.filter(w => w.yes.length > 0).map(w => (
                  <div key={w.key} className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="text-foreground">{w.label}</span>
                    <span className="text-emerald-700 dark:text-emerald-400 text-right">{w.yes.join(", ")}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Submission status</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-3 gap-y-1 max-h-72 overflow-y-auto">
              {eod.rows.map(row => (
                <div key={row.userId} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/40">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.submitted ? (
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: GREEN }} />
                    ) : (
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: AMBER }} />
                    )}
                    <span className="text-sm truncate">{row.name}</span>
                    <ClrTrainingBadge inTraining={row.inTraining} activeWorkdays={row.activeWorkdays} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
                    {row.submitted && row.submittedAt
                      ? (<>
                          {format(new Date(row.submittedAt), "h:mm a")}
                          {row.late && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800/60 dark:bg-amber-950/30" title={`Filed after ${eod.dueLabel}`}>late</Badge>
                          )}
                          {/* Only the every-day questions can be a gap — a No on
                              the ask-only retail Bonzo work is the normal answer. */}
                          {row.checklist && (row.checklist.bulkText === false || row.checklist.respondedNew === false) && (
                            <Badge variant="outline" className="text-[10px] px-1 py-0 text-red-700 border-red-300 bg-red-50 dark:text-red-300 dark:border-red-800/60 dark:bg-red-950/30" title="Answered No on part of the daily checklist">gap</Badge>
                          )}
                        </>)
                      : <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-800/60 dark:bg-amber-950/30">Missing</Badge>}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top LOs + Top States (each with own range) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <SectionTitle icon={Award}
            action={
              <div className="flex items-center gap-2">
                <RangePills options={RANGE_OPTIONS} value={rangeTopLos} onChange={setRangeTopLos} ariaLabel="Top LOs range" />
                <Link href="/lo-stats"><Button variant="ghost" size="sm" className="px-0 h-auto brand-text underline-offset-4 hover:underline">LO stats →</Button></Link>
              </div>
            }
          >
            Top LOs by transfers — {byRange[rangeTopLos]?.window?.label ?? ""}
          </SectionTitle>
          <Card>
            <CardContent className="p-4">
              {(topLosBlock?.topLos ?? []).length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6">No transfers in this range</div>
              ) : (
                <ul className="space-y-2.5">
                  {topLosBlock!.topLos.map((lo, i) => {
                    const max = topLosBlock!.topLos[0].transfers;
                    const pct = Math.round((lo.transfers / max) * 100);
                    return (
                      <li key={lo.id}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium truncate brand-text">
                            <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
                            {lo.name ?? `LO #${lo.id}`}
                          </span>
                          <span className="tabular-nums font-semibold" style={{ color: GREEN }}>{lo.transfers}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: GREEN }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top states by NPA — render only if there's any data, otherwise hidden */}
        {(statesBlock?.topStates?.length ?? 0) > 0 ? (
          <div>
            <SectionTitle icon={MapPin}
              action={<RangePills options={RANGE_OPTIONS} value={rangeStates} onChange={setRangeStates} ariaLabel="States range" />}
            >
              Top states (by phone area code) — {byRange[rangeStates]?.window?.label ?? ""}
            </SectionTitle>
            <Card>
              <CardContent className="p-4">
                <ul className="space-y-2.5">
                  {statesBlock!.topStates.map(s => {
                    const max = statesBlock!.topStates[0].transfers;
                    const pct = Math.round((s.transfers / max) * 100);
                    return (
                      <li key={s.state}>
                        <div className="flex justify-between items-baseline mb-1 text-sm">
                          <span className="font-medium brand-text">{s.state}</span>
                          <span className="tabular-nums font-semibold" style={{ color: isDark ? GOLD : GOLD_2 }}>{s.transfers}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: GOLD }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[11px] text-muted-foreground mt-3">
                  Derived from caller area codes (NPA → state). Excludes non-US numbers.
                </p>
                {statesBlock?.statesDiagnostics && statesBlock.statesDiagnostics.phonesRejected > 0 ? (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {statesBlock.statesDiagnostics.phonesParsed} of {statesBlock.statesDiagnostics.phonesTotal} transfers had a parseable US area code
                    {statesBlock.statesDiagnostics.rejectedSamples.length > 0
                      ? ` — skipped formats: ${statesBlock.statesDiagnostics.rejectedSamples.map(s => `“${s}”`).join(", ")}`
                      : ""}
                    .
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </div>

      {/* Pipeline */}
      <div>
        <SectionTitle icon={ArrowUpRight}
          action={<RangePills options={PIPELINE_OPTIONS} value={pipelineRange} onChange={setPipelineRange} ariaLabel="Pipeline range" />}
        >
          Pipeline — last {pipelineRange}
        </SectionTitle>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: GREEN }}>
                  {pipelineRange === "1d" ? "Today's transfers" : `Transfers (${pipelineRange})`}
                </span>
                <Badge variant="outline" className="tabular-nums">{filteredTransfers.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {filteredTransfers.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">No transfers in this range</div>
              ) : (
                <ul className="space-y-2">
                  {filteredTransfers.slice(0, 20).map((t: any) => (
                    <li key={t.id} className="text-sm border-l-2 pl-2" style={{ borderColor: GREEN }}>
                      <div className="font-medium truncate">{t.borrower_name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.clr_name ?? "—"} → {t.lo_name ?? "—"}
                        {pipelineRange !== "1d" && t.date && (
                          <span className="ml-2 tabular-nums">· {format(parseISO(t.date), "MMM d")}</span>
                        )}
                        {t.transfer_type && <Badge variant="outline" className="ml-2 text-[10px] py-0 h-4">{t.transfer_type}</Badge>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: AMBER }}>Overdue appointments</span>
                <Badge variant="outline" className="tabular-nums">{filteredOverdueAppts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {filteredOverdueAppts.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">All appointments on track</div>
              ) : (
                <ul className="space-y-2">
                  {filteredOverdueAppts.slice(0, 12).map((a: any) => (
                    <li key={a.id} className="text-sm border-l-2 pl-2" style={{ borderColor: AMBER }}>
                      <div className="font-medium truncate">{a.borrower_name || "Unnamed"}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.clr_name ?? "—"} · due {a.follow_up_date ? format(parseISO(a.follow_up_date), "MMM d") : "—"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {filteredOverdueAppts.length > 0 && (
                <div className="text-right mt-2">
                  <Link href="/appointments">
                    <Button variant="ghost" size="sm" className="px-0 h-auto text-xs underline-offset-4 hover:underline">View all →</Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span style={{ color: RED }}>Overdue NMLS checks</span>
                <Badge variant="outline" className="tabular-nums">{filteredOverdueNmls.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 max-h-72 overflow-y-auto">
              {filteredOverdueNmls.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">No overdue checks</div>
              ) : (
                <ul className="space-y-2">
                  {filteredOverdueNmls.slice(0, 12).map((c: any) => (
                    <li key={c.id} className="text-sm border-l-2 pl-2" style={{ borderColor: RED }}>
                      <div className="font-medium truncate">{c.lo?.fullName ?? c.lo?.full_name ?? `LO #${c.lo_id}`}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.assignedTo?.name ?? "—"} · {c.daysOverdue}d overdue
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {filteredOverdueNmls.length > 0 && (
                <div className="text-right mt-2">
                  <Link href="/nmls-checks">
                    <Button variant="ghost" size="sm" className="px-0 h-auto text-xs underline-offset-4 hover:underline">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      View tracker →
                    </Button>
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent activity feed */}
      <div>
        <SectionTitle icon={Activity}>Recent team activity</SectionTitle>
        <Card>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              {activityFeed.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-6">No recent activity</div>
              ) : (
                <ul className="divide-y">
                  {activityFeed.map((a: any) => {
                    const type = a.outcome_type as string;
                    const color = OUTCOME_COLORS[type] ?? "#94a3b8";
                    const label = OUTCOME_LABELS[type] ?? type;
                    return (
                      <li key={a.id} className="px-4 py-2.5 hover:bg-muted/40">
                        <div className="flex items-start gap-3">
                          <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2" style={{ backgroundColor: color }} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap text-sm">
                              <span className="font-medium brand-text">{a.clr_name ?? "—"}</span>
                              <Badge variant="outline" className="text-[10px] py-0 h-4" style={{ borderColor: color, color }}>{label}</Badge>
                              <span className="text-muted-foreground">·</span>
                              <span className="truncate">{a.borrower_name || "Unnamed"}</span>
                              {a.lo_name && <>
                                <span className="text-muted-foreground">→</span>
                                <span className="truncate text-muted-foreground">{a.lo_name}</span>
                              </>}
                            </div>
                            {a.notes && (
                              <div className="text-xs text-muted-foreground mt-0.5 truncate">{a.notes}</div>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
                            {a.date ? format(parseISO(a.date), "MMM d") : "—"}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground text-center pt-2">
        Updated {format(new Date(data.generatedAt), "h:mm a")} · auto-refresh every 60s
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Heatmap card — clean, weekday-labeled, dark-mode aware, with concrete legend.

function HeatmapCard({
  title, tone, block, isDark, valueLabel,
}: {
  title: string;
  tone: "navy" | "green";
  block: { dates: string[]; rows: { userId: number; name: string; activeWorkdays: number; inTraining: boolean; cells: number[] }[] } | undefined;
  isDark: boolean;
  valueLabel: string;
}) {
  if (!block || block.dates.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm brand-text">{title}</CardTitle></CardHeader>
        <CardContent className="p-4 text-sm text-muted-foreground text-center py-6">No data</CardContent>
      </Card>
    );
  }

  const max = Math.max(1, ...block.rows.flatMap(r => r.cells));
  const ranges = bucketRanges(max);

  // Color stops per tone — five intensity levels (light → dark)
  // Light mode uses the brand color; dark mode swaps to a brighter ramp so cells stay visible.
  const STOPS_LIGHT = tone === "navy"
    ? ["#f1f5f9", "rgba(15,24,45,0.18)", "rgba(15,24,45,0.38)", "rgba(15,24,45,0.62)", "rgba(15,24,45,0.92)"]
    : ["#f1f5f9", "rgba(22,163,74,0.20)", "rgba(22,163,74,0.40)", "rgba(22,163,74,0.65)", "rgba(22,163,74,0.95)"];
  const STOPS_DARK  = tone === "navy"
    ? ["#1f1d1c", "rgba(201,162,74,0.22)", "rgba(201,162,74,0.42)", "rgba(201,162,74,0.66)", "rgba(232,217,168,0.92)"]
    : ["#1f1d1c", "rgba(74,222,128,0.22)", "rgba(74,222,128,0.42)", "rgba(74,222,128,0.66)", "rgba(74,222,128,0.95)"];
  const stops = isDark ? STOPS_DARK : STOPS_LIGHT;

  // Day-of-week label uses the JS day index of each date string (treat as local).
  const dowLabels = block.dates.map(d => {
    const dt = new Date(d + "T00:00:00");
    return WEEKDAY_SHORT[dt.getDay()];
  });
  const domLabels = block.dates.map(d => {
    const dt = new Date(d + "T00:00:00");
    return String(dt.getDate());
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm brand-text">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-4 overflow-x-auto">
        <table className="w-full text-xs border-separate" style={{ borderSpacing: "2px 2px" }}>
          <thead>
            <tr>
              <th className="text-left pr-3 pb-1 sticky left-0 bg-card z-10 brand-text">CLR</th>
              {dowLabels.map((dow, i) => (
                <th key={"dow-"+i} className="px-0 pb-0 font-medium text-muted-foreground tabular-nums text-center">
                  <div>{dow}</div>
                </th>
              ))}
            </tr>
            <tr>
              <th className="sticky left-0 bg-card z-10"></th>
              {domLabels.map((dom, i) => (
                <th key={"dom-"+i} className="px-0 pb-1 font-normal text-[10px] text-muted-foreground tabular-nums text-center"
                    title={block.dates[i]}>
                  {dom}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map(row => (
              <tr key={row.userId}>
                <td className="pr-3 py-0.5 truncate max-w-[140px] sticky left-0 bg-card font-medium brand-text">
                  <span className="inline-flex items-center gap-1.5">
                    {row.name}
                    <ClrTrainingBadge inTraining={row.inTraining} activeWorkdays={row.activeWorkdays} />
                  </span>
                </td>
                {row.cells.map((v, i) => {
                  const bucket = intensityBucket(v, max);
                  const bg = stops[bucket];
                  // Foreground: only bucket 4 needs inverted text; otherwise readable in either mode.
                  const fg = bucket === 0
                    ? (isDark ? "#52525b" : "#94a3b8")
                    : bucket >= 3
                      ? (isDark && tone === "navy" ? "#0f172a" : "#ffffff")
                      : (isDark ? "#e4e4e7" : "#0f172a");
                  return (
                    <td key={i} className="p-0">
                      <div className="w-7 h-7 rounded flex items-center justify-center text-[11px] font-medium tabular-nums"
                           style={{ backgroundColor: bg, color: fg }}
                           title={`${block.dates[i]} (${WEEKDAY_SHORT[new Date(block.dates[i] + "T00:00:00").getDay()]}): ${v} ${valueLabel}${v === 1 ? "" : "s"}`}>
                        {v || ""}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {/* Legend with concrete numeric tiers */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-3 flex-wrap">
          <span>Range:</span>
          {stops.map((bg, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-4 h-4 rounded" style={{ backgroundColor: bg, border: i === 0 ? "1px dashed currentColor" : "none" }} />
              <span className="tabular-nums">{ranges[i]}</span>
            </div>
          ))}
          <span className="ml-auto">Max in range: <span className="tabular-nums font-medium brand-text">{max}</span></span>
        </div>
      </CardContent>
    </Card>
  );
}
