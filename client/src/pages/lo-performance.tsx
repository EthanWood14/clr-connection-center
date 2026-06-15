import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  TrendingUp,
  PhoneForwarded,
  Calendar,
  Activity,
  BarChart2,
  ArrowUpDown,
  Award,
  Trophy,
  Search,
  Gauge,
  Percent,
} from "lucide-react";
import { LoStatusBadge } from "@/components/lo-status-badge";

// ─── constants ────────────────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell Through",
  no_answer: "No Answer",
  callback_requested: "Callback",
  deferral: "Deferral",
  future_contact: "Deferral",
  not_interested: "Not Interested",
  wrong_number: "Wrong Number",
  other: "Other",
};

const OUTCOME_BADGE_CLASSES: Record<string, string> = {
  transfer: "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-teal-200 dark:border-teal-700",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-700",
  fell_through: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-700",
  no_answer: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-400 border-gray-200 dark:border-gray-700",
  callback_requested: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300 border-purple-200 dark:border-purple-700",
  deferral: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  future_contact: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  not_interested: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-200 dark:border-rose-700",
  wrong_number: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-400 border-gray-200 dark:border-gray-700",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-400 border-gray-200 dark:border-gray-700",
};

const CHART_TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  background: "hsl(var(--card))",
  color: "hsl(var(--foreground))",
};

// Brand teal + efficiency thresholds (lower calls/transfer is better; higher
// fall-through is worse). Tunable in one place.
const TEAL = "#01696f";
const CPT_GOOD = 8;   // <= this many calls per transfer = excellent
const CPT_OK = 15;    // <= this = acceptable; above = poor
const FTR_GOOD = 10;  // fall-through rate % at/under this = good
const FTR_OK = 25;    // at/under this = watch; above = poor

const MIN_CALLS_OPTIONS = [10, 20, 50, 100];

type SortKey =
  | "fullName"
  | "totalOutcomes"
  | "transfers"
  | "callsPerTransfer"
  | "transferRate"
  | "fallThroughRate"
  | "appointments"
  | "appointmentRate"
  | "contactRate"
  | "lastOutcomeDate";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatMonthLabel(month: string): string {
  // month is "YYYY-MM", e.g. "2026-04" → "Apr '26"
  try {
    return format(parseISO(`${month}-01`), "MMM ''yy");
  } catch {
    return month;
  }
}

function pct(num: number, denom: number): string {
  if (!denom) return "0.0%";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function fmtNum(n: number | null, suffix = ""): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}${suffix}`;
}

// Calls-per-transfer Badge class: lower is better. Low-volume LOs render gray.
function cptBadgeClass(cpt: number | null, rankable: boolean): string {
  if (cpt == null || !rankable) return OUTCOME_BADGE_CLASSES.other;
  if (cpt <= CPT_GOOD) return OUTCOME_BADGE_CLASSES.transfer; // teal
  if (cpt <= CPT_OK) return OUTCOME_BADGE_CLASSES.deferral; // amber
  return OUTCOME_BADGE_CLASSES.fell_through; // red
}

// Bar color for the efficiency chart (rankable rows only).
function cptColor(cpt: number): string {
  if (cpt <= CPT_GOOD) return TEAL;
  if (cpt <= CPT_OK) return "#d97706";
  return "#dc2626";
}

// Fall-through rate text color: higher is worse.
function ftrClass(ftr: number | null): string {
  if (ftr == null) return "text-muted-foreground";
  if (ftr <= FTR_GOOD) return "text-green-600 dark:text-green-400";
  if (ftr <= FTR_OK) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon: Icon,
  accent = false,
  sub,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
              {title}
            </p>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div
            className={`p-2 rounded-lg ${
              accent
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── outcome badge ────────────────────────────────────────────────────────────

function OutcomeBadge({ type }: { type: string }) {
  const classes = OUTCOME_BADGE_CLASSES[type] ?? OUTCOME_BADGE_CLASSES.other;
  return (
    <Badge
      variant="outline"
      className={`text-[10px] font-medium border ${classes}`}
    >
      {OUTCOME_LABELS[type] ?? type}
    </Badge>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function LoPerformance() {
  const [selectedLoId, setSelectedLoId] = useState<number | null>(null);
  const drillRef = useRef<HTMLDivElement>(null);

  // Comparison/ranking controls
  const [sortKey, setSortKey] = useState<SortKey>("callsPerTransfer");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc"); // asc = most efficient first
  const [search, setSearch] = useState("");
  const [rankableOnly, setRankableOnly] = useState(true);
  const [minCalls, setMinCalls] = useState(20);

  // LO list (globally cached)
  const { data: los = [], isLoading: losLoading } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

  // Cross-LO performance rollup (powers the comparison table + ranking)
  const { data: summary, isLoading: summaryLoading } = useQuery<{ minCalls: number; rows: any[] }>({
    queryKey: ["/api/loan-officers/performance-summary"],
  });
  const summaryRows: any[] = summary?.rows ?? [];

  // Performance data — only fetch when an LO is selected
  const { data: perfData, isLoading: perfLoading } = useQuery<any>({
    queryKey: [`/api/loan-officers/${selectedLoId}/performance`],
    enabled: selectedLoId !== null,
  });

  // Raw outcomes for the selected LO (all outcomes)
  const { data: allOutcomes = [], isLoading: outcomesLoading } = useQuery<any[]>({
    queryKey: ["/api/outcomes"],
  });

  const loOutcomes = selectedLoId
    ? allOutcomes
        .filter((o: any) => o.loId === selectedLoId)
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
        .slice(0, 50)
    : [];

  // ── Comparison: filter + sort ──
  const isRankable = (r: any) => r.totalOutcomes >= minCalls && r.transfers > 0;

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      // Calls-per-transfer & fall-through & name read best ascending.
      setSortDir(k === "callsPerTransfer" || k === "fallThroughRate" || k === "fullName" ? "asc" : "desc");
    }
  };

  const filteredSorted = useMemo(() => {
    let rows = [...summaryRows];
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(
        (r) => r.fullName.toLowerCase().includes(q) || String(r.nmlsId ?? "").includes(q),
      );
    }
    if (rankableOnly) rows = rows.filter((r) => r.totalOutcomes >= minCalls && r.transfers > 0);

    const nullsLast = (v: number | null, dir: "asc" | "desc") =>
      v == null ? (dir === "asc" ? Infinity : -Infinity) : v;

    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "fullName" || sortKey === "lastOutcomeDate") {
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
      }
      const an = nullsLast(av, sortDir);
      const bn = nullsLast(bv, sortDir);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return rows;
  }, [summaryRows, search, rankableOnly, minCalls, sortKey, sortDir]);

  // Most-efficient = lowest calls-per-transfer among rankable LOs.
  const mostEfficient = useMemo(() => {
    const r = summaryRows.filter((x) => x.totalOutcomes >= minCalls && x.transfers > 0);
    if (!r.length) return null;
    return r.reduce((best, cur) => (cur.callsPerTransfer < best.callsPerTransfer ? cur : best));
  }, [summaryRows, minCalls]);

  // Top-N efficiency bar chart data (always asc by CPT, rankable only).
  const chartData = useMemo(() => {
    return summaryRows
      .filter((x) => x.totalOutcomes >= minCalls && x.transfers > 0)
      .sort((a, b) => a.callsPerTransfer - b.callsPerTransfer)
      .slice(0, 8)
      .map((r) => ({ name: r.fullName, cpt: Number(r.callsPerTransfer.toFixed(1)), loId: r.loId }));
  }, [summaryRows, minCalls]);

  const selectLo = (id: number) => {
    setSelectedLoId(id);
    setTimeout(() => drillRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  // Chart data — format month labels
  const monthlyData: any[] = (perfData?.monthlyData ?? []).map((d: any) => ({
    ...d,
    label: formatMonthLabel(d.month),
  }));

  // KPI calculations (drill-down)
  const lo = perfData?.lo;
  const callsLogged = perfData?.callsLogged ?? lo?.totalTimesWorked ?? 0;
  const totalTransfers = monthlyData.reduce((s: number, d: any) => s + (d.transfers ?? 0), 0);
  const totalAppointments = monthlyData.reduce((s: number, d: any) => s + (d.appointments ?? 0), 0);
  const totalOutcomes = perfData?.totalOutcomes ?? 0;
  const transferRate = pct(totalTransfers, totalOutcomes);
  // New efficiency KPIs — computed from the drill-down's own data (includes
  // every CLR, consistent with the rest of this single-LO view).
  const fellThroughCount = perfData?.totalsByType?.fell_through ?? 0;
  const drillCPT = totalTransfers > 0 ? callsLogged / totalTransfers : null;
  const drillFTR =
    totalTransfers + fellThroughCount > 0
      ? (fellThroughCount / (totalTransfers + fellThroughCount)) * 100
      : null;

  const isPerformanceLoading = selectedLoId !== null && (perfLoading || outcomesLoading);

  const sortableCols: [SortKey, string][] = [
    ["fullName", "Loan Officer"],
    ["totalOutcomes", "Calls"],
    ["transfers", "Transfers"],
    ["callsPerTransfer", "Calls / Transfer"],
    ["transferRate", "Transfer Rate"],
    ["fallThroughRate", "Fall-Through"],
    ["appointments", "Appts"],
    ["appointmentRate", "Appt Rate"],
    ["contactRate", "Contact Rate"],
    ["lastOutcomeDate", "Last Activity"],
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary" />
          LO Stats
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Team-wide efficiency ranking and full performance history for every loan officer
        </p>
      </div>

      {/* ════════ SECTION 1 — All-LO comparison / ranking ════════ */}

      {summaryLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
          <Skeleton className="h-80" />
        </div>
      ) : summaryRows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No outcome data recorded yet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Most-efficient highlight banner ── */}
          {mostEfficient ? (
            <Card
              className="border-primary/30 bg-primary/5 cursor-pointer transition-colors hover:bg-primary/10"
              onClick={() => selectLo(mostEfficient.loId)}
              data-testid="most-efficient-banner"
            >
              <CardContent className="py-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <div className="p-2.5 rounded-xl bg-primary/15 text-primary shrink-0">
                    <Trophy className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                      Most efficient caller
                    </p>
                    <p className="text-lg font-bold truncate">
                      {mostEfficient.fullName}
                      {mostEfficient.nmlsId && (
                        <span className="ml-1.5 text-xs font-mono text-muted-foreground">
                          #{mostEfficient.nmlsId}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-2xl font-bold text-primary tabular-nums">
                      {mostEfficient.callsPerTransfer.toFixed(1)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      calls / transfer · {mostEfficient.transfers} transfers from{" "}
                      {mostEfficient.totalOutcomes} calls
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                Not enough volume to rank efficiency yet — need at least {minCalls} logged calls
                with a transfer.
              </CardContent>
            </Card>
          )}

          {/* ── Top-N efficiency bar chart ── */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">
                  Calls per Transfer — Most Efficient Callers{" "}
                  <span className="font-normal text-muted-foreground">(lower is better)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={Math.max(160, chartData.length * 34)}>
                  <BarChart
                    data={chartData}
                    layout="vertical"
                    margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      interval={0}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      formatter={(v: any) => [`${v} calls/transfer`, "Efficiency"]}
                    />
                    <Bar dataKey="cpt" radius={[0, 4, 4, 0]}>
                      {chartData.map((d) => (
                        <Cell key={d.loId} fill={cptColor(d.cpt)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* ── Controls + ranked table ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> All Loan Officers
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  {filteredSorted.length} shown
                </span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="relative flex-1 min-w-[200px] max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search LO by name or NMLS…"
                    className="h-9 pl-8"
                    data-testid="lo-search"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <Switch
                    checked={rankableOnly}
                    onCheckedChange={setRankableOnly}
                    data-testid="rankable-toggle"
                  />
                  <span className={rankableOnly ? "text-foreground font-medium" : "text-muted-foreground"}>
                    Rankable only (≥ {minCalls} calls)
                  </span>
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Min calls</span>
                  <Select value={String(minCalls)} onValueChange={(v) => setMinCalls(Number(v))}>
                    <SelectTrigger className="h-8 w-[80px]" data-testid="min-calls-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MIN_CALLS_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground pt-1">
                "Calls" = outcomes logged against the LO (not raw dials). Ranking excludes
                non-counted CLRs.
              </p>
            </CardHeader>
            <CardContent className="p-0">
              {filteredSorted.length === 0 ? (
                <div className="py-12 text-center text-sm text-muted-foreground">
                  No loan officers match your filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 border-b">
                      <tr className="text-left">
                        <th className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-12">
                          #
                        </th>
                        {sortableCols.map(([k, label]) => (
                          <th
                            key={k}
                            className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                            onClick={() => handleSort(k)}
                            data-testid={`th-${k}`}
                          >
                            <span className="inline-flex items-center gap-1">
                              {label}
                              <ArrowUpDown
                                className={`w-3 h-3 ${sortKey === k ? "text-foreground" : "opacity-40"}`}
                              />
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSorted.map((row, i) => {
                        const rankable = isRankable(row);
                        const isTop = mostEfficient && row.loId === mostEfficient.loId;
                        return (
                          <tr
                            key={row.loId}
                            className={`border-b last:border-0 hover:bg-muted/30 cursor-pointer ${
                              selectedLoId === row.loId ? "bg-primary/5" : ""
                            }`}
                            onClick={() => selectLo(row.loId)}
                            data-testid={`lo-row-${row.loId}`}
                          >
                            <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                              <span className="inline-flex items-center gap-1">
                                {i + 1}
                                {isTop && <Award className="w-3.5 h-3.5 text-primary" />}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{row.fullName}</span>
                                {row.nmlsId && (
                                  <span className="text-xs font-mono text-muted-foreground">
                                    #{row.nmlsId}
                                  </span>
                                )}
                                <LoStatusBadge status={row.internalStatus} hideWhenActive />
                              </div>
                            </td>
                            <td className={`px-4 py-2.5 tabular-nums ${rankable ? "" : "text-muted-foreground"}`}>
                              {row.totalOutcomes}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-green-600 dark:text-green-400 font-medium">
                              {row.transfers}
                            </td>
                            <td className="px-4 py-2.5">
                              {row.callsPerTransfer == null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5">
                                  <Badge
                                    variant="outline"
                                    className={`text-[11px] font-semibold border tabular-nums ${cptBadgeClass(
                                      row.callsPerTransfer,
                                      rankable,
                                    )}`}
                                  >
                                    {row.callsPerTransfer.toFixed(1)}
                                  </Badge>
                                  {!rankable && (
                                    <span className="text-[10px] text-muted-foreground">low vol</span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-blue-600 dark:text-blue-400">
                              {row.transferRate.toFixed(1)}%
                            </td>
                            <td className={`px-4 py-2.5 tabular-nums font-medium ${ftrClass(row.fallThroughRate)}`}>
                              {row.fallThroughRate == null ? "—" : `${row.fallThroughRate.toFixed(1)}%`}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-purple-600 dark:text-purple-400">
                              {row.appointments}
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                              {row.appointmentRate.toFixed(1)}%
                            </td>
                            <td className="px-4 py-2.5 tabular-nums text-teal-600 dark:text-teal-400">
                              {row.contactRate.toFixed(1)}%
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                              {row.lastOutcomeDate ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ════════ SECTION 2 — Single-LO drill-down ════════ */}

      <div ref={drillRef} className="space-y-4 sm:space-y-6 pt-2">
        <div className="flex items-center gap-2 pt-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">Loan Officer Detail</h2>
        </div>

        {/* ── LO Selector ── */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-end gap-4">
              <div className="space-y-1.5 flex-1 max-w-xs">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Select Loan Officer
                </label>
                {losLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select
                    value={selectedLoId !== null ? String(selectedLoId) : ""}
                    onValueChange={(val) => setSelectedLoId(Number(val))}
                  >
                    <SelectTrigger data-testid="select-lo-trigger">
                      <SelectValue placeholder="Choose an LO…" />
                    </SelectTrigger>
                    <SelectContent>
                      {los.map((opt: any) => (
                        <SelectItem key={opt.id} value={String(opt.id)}>
                          {opt.fullName}
                          <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                            {opt.nmlsId ? `#${opt.nmlsId}` : ""}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {lo && (
                <div className="text-sm text-muted-foreground pb-0.5">
                  <span className="font-medium text-foreground">{lo.fullName}</span>
                  {" · "}
                  {lo.nmlsId && <span className="font-mono">NMLS #{lo.nmlsId}</span>}
                  <LoStatusBadge status={lo.internalStatus} hideWhenActive className="ml-2" />
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Empty state ── */}
        {selectedLoId === null && (
          <div className="py-16 text-center">
            <BarChart2 className="w-14 h-14 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              Pick a loan officer above — or click any row in the ranking — to view their full
              history.
            </p>
          </div>
        )}

        {/* ── Loading skeletons ── */}
        {isPerformanceLoading && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-28" />
              ))}
            </div>
            <Skeleton className="h-72" />
            <Skeleton className="h-72" />
            <Skeleton className="h-64" />
          </div>
        )}

        {/* ── Content ── */}
        {selectedLoId !== null && !isPerformanceLoading && (
          <>
            {/* ── KPI row ── */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              <KpiCard
                title="Total Calls"
                value={callsLogged}
                icon={Activity}
                sub="outcomes logged all-time"
              />
              <KpiCard
                title="Total Transfers"
                value={totalTransfers}
                icon={PhoneForwarded}
                accent
                sub="successful transfers"
              />
              <KpiCard
                title="Calls / Transfer"
                value={drillCPT == null ? "—" : drillCPT.toFixed(1)}
                icon={Gauge}
                accent
                sub="lower is better"
              />
              <KpiCard
                title="Transfer Rate"
                value={transferRate}
                icon={TrendingUp}
                accent
                sub="transfers ÷ total outcomes"
              />
              <KpiCard
                title="Fall-Through Rate"
                value={drillFTR == null ? "—" : `${drillFTR.toFixed(1)}%`}
                icon={Percent}
                sub="fell-through ÷ (transfers + fell-through)"
              />
              <KpiCard
                title="Total Appointments"
                value={totalAppointments}
                icon={Calendar}
                sub="booked appointments"
              />
            </div>

            {/* ── No data state ── */}
            {monthlyData.length === 0 && (
              <div className="py-16 text-center">
                <Activity className="w-12 h-12 text-muted-foreground/20 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  No outcome history recorded for this loan officer yet.
                </p>
              </div>
            )}

            {monthlyData.length > 0 && (
              <>
                {/* ── Monthly Line Chart ── */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">
                      Monthly Trends — Transfers, Appointments &amp; Fell Through
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <LineChart
                        data={monthlyData}
                        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                        <Line
                          type="monotone"
                          dataKey="transfers"
                          name="Transfers"
                          stroke="#01696f"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#01696f" }}
                          activeDot={{ r: 5 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="appointments"
                          name="Appointments"
                          stroke="#2563eb"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#2563eb" }}
                          activeDot={{ r: 5 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="fellThrough"
                          name="Fell Through"
                          stroke="#dc2626"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#dc2626" }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* ── Monthly Stacked Bar Chart ── */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">
                      Monthly Volume — Stacked by Outcome Type
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart
                        data={monthlyData}
                        margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="hsl(var(--border))"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                        <Bar dataKey="transfers" name="Transfers" stackId="a" fill="#01696f" />
                        <Bar dataKey="appointments" name="Appointments" stackId="a" fill="#2563eb" />
                        <Bar dataKey="fellThrough" name="Fell Through" stackId="a" fill="#dc2626" />
                        <Bar dataKey="callbacks" name="Callbacks" stackId="a" fill="#9333ea" />
                        <Bar dataKey="futureContact" name="Future Contact" stackId="a" fill="#d97706" />
                        <Bar dataKey="notInterested" name="Not Interested" stackId="a" fill="#e11d48" />
                        <Bar dataKey="wrongNumber" name="Wrong Number" stackId="a" fill="#475569" />
                        <Bar dataKey="noAnswer" name="No Answer" stackId="a" fill="#6b7280" />
                        <Bar dataKey="other" name="Other" stackId="a" fill="#a3a3a3" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ── Full Outcome History Table ── */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span>Full Outcome History</span>
                  {loOutcomes.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">
                      Showing {loOutcomes.length} most recent
                      {totalOutcomes > 50 ? ` of ${totalOutcomes}` : ""}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {loOutcomes.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">
                    No outcomes logged for this loan officer yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 border-b">
                        <tr className="text-left">
                          <th className="px-4 py-2 text-xs uppercase tracking-wider font-medium text-muted-foreground">
                            Date
                          </th>
                          <th className="px-4 py-2 text-xs uppercase tracking-wider font-medium text-muted-foreground">
                            CLR
                          </th>
                          <th className="px-4 py-2 text-xs uppercase tracking-wider font-medium text-muted-foreground">
                            Outcome
                          </th>
                          <th className="px-4 py-2 text-xs uppercase tracking-wider font-medium text-muted-foreground">
                            Borrower
                          </th>
                          <th className="px-4 py-2 text-xs uppercase tracking-wider font-medium text-muted-foreground">
                            Notes
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {loOutcomes.map((o: any) => (
                          <tr key={o.id} className="border-b last:border-0">
                            <td className="px-4 py-2.5 font-mono text-sm whitespace-nowrap">
                              {o.date}
                            </td>
                            <td className="px-4 py-2.5 text-sm">
                              {o.assistant?.name ?? `CLR #${o.assistantId}`}
                            </td>
                            <td className="px-4 py-2.5">
                              <OutcomeBadge type={o.outcomeType} />
                            </td>
                            <td className="px-4 py-2.5 text-sm text-muted-foreground">
                              {o.borrowerName ?? "—"}
                            </td>
                            <td className="px-4 py-2.5 text-sm text-muted-foreground max-w-[240px] truncate">
                              {o.notes ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
