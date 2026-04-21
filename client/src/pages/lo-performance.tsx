import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TrendingUp, PhoneForwarded, Calendar, Activity, BarChart2 } from "lucide-react";

// ─── constants ────────────────────────────────────────────────────────────────

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer",
  appointment: "Appointment",
  fell_through: "Fell Through",
  no_answer: "No Answer",
  callback_requested: "Callback",
  future_contact: "Future Contact",
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
  future_contact: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-700",
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

  // LO list (globally cached)
  const { data: los = [], isLoading: losLoading } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

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

  // Chart data — format month labels
  const monthlyData: any[] = (perfData?.monthlyData ?? []).map((d: any) => ({
    ...d,
    label: formatMonthLabel(d.month),
  }));

  // KPI calculations
  const lo = perfData?.lo;
  const totalWorked = lo?.totalTimesWorked ?? 0;
  const totalTransfers = monthlyData.reduce((s: number, d: any) => s + (d.transfers ?? 0), 0);
  const totalAppointments = monthlyData.reduce((s: number, d: any) => s + (d.appointments ?? 0), 0);
  const totalOutcomes = perfData?.totalOutcomes ?? 0;
  const transferRate = pct(totalTransfers, totalOutcomes);

  const isPerformanceLoading = selectedLoId !== null && (perfLoading || outcomesLoading);

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 max-w-[1200px] mx-auto">
      {/* ── Page header ── */}
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary" />
          LO Performance History
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Full outcome history and monthly trends for any loan officer
        </p>
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
                    {los.map((lo: any) => (
                      <SelectItem key={lo.id} value={String(lo.id)}>
                        {lo.fullName}
                        <span className="ml-1.5 text-xs text-muted-foreground font-mono">
                          {lo.nmlsId ? `#${lo.nmlsId}` : ""}
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
                {lo.internalStatus !== "active" && (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {lo.internalStatus}
                  </Badge>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Empty state ── */}
      {selectedLoId === null && (
        <div className="py-24 text-center">
          <BarChart2 className="w-14 h-14 text-muted-foreground/20 mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Select a loan officer above to view their performance history.
          </p>
        </div>
      )}

      {/* ── Loading skeletons ── */}
      {isPerformanceLoading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Total Worked"
              value={totalWorked}
              icon={Activity}
              sub="times worked all-time"
            />
            <KpiCard
              title="Total Transfers"
              value={totalTransfers}
              icon={PhoneForwarded}
              accent
              sub="successful transfers"
            />
            <KpiCard
              title="Total Appointments"
              value={totalAppointments}
              icon={Calendar}
              accent
              sub="booked appointments"
            />
            <KpiCard
              title="Transfer Rate"
              value={transferRate}
              icon={TrendingUp}
              accent
              sub="transfers ÷ total outcomes"
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
                      <Legend
                        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                      />
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
                      <Bar
                        dataKey="transfers"
                        name="Transfers"
                        stackId="a"
                        fill="#01696f"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="appointments"
                        name="Appointments"
                        stackId="a"
                        fill="#2563eb"
                      />
                      <Bar
                        dataKey="fellThrough"
                        name="Fell Through"
                        stackId="a"
                        fill="#dc2626"
                      />
                      <Bar
                        dataKey="noAnswer"
                        name="No Answer"
                        stackId="a"
                        fill="#6b7280"
                        radius={[4, 4, 0, 0]}
                      />
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
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Date
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        CLR
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Outcome
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Borrower
                      </TableHead>
                      <TableHead className="text-xs uppercase tracking-wider font-medium">
                        Notes
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loOutcomes.map((o: any) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-sm whitespace-nowrap">
                          {o.date}
                        </TableCell>
                        <TableCell className="text-sm">
                          {o.assistant?.name ?? `CLR #${o.assistantId}`}
                        </TableCell>
                        <TableCell>
                          <OutcomeBadge type={o.outcomeType} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {o.borrowerName ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[240px] truncate">
                          {o.notes ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
