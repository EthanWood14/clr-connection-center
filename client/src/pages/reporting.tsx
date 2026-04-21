import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ArrowUpRight,
  Calendar,
  Activity,
  TrendingUp,
  Download,
  BarChart2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { format, parseISO, startOfDay, isWithinInterval, subDays } from "date-fns";

// ─── helpers ────────────────────────────────────────────────────────────────

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

const OUTCOME_CHART_COLORS: Record<string, string> = {
  transfer: "#01696f",       // teal
  appointment: "#2563eb",    // blue
  fell_through: "#dc2626",   // red
  no_answer: "#6b7280",      // gray
  callback_requested: "#7c3aed", // purple
  future_contact: "#0891b2", // cyan
  not_interested: "#be123c", // rose
  wrong_number: "#6b7280",   // gray
  other: "#9ca3af",          // gray
};

/** Returns the default reporting period: 16th of last month → 15th of current month */
function defaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  const fromMonth = month === 0 ? 11 : month - 1;
  const fromYear = month === 0 ? year - 1 : year;
  const from = `${fromYear}-${String(fromMonth + 1).padStart(2, "0")}-16`;

  const toMonth = month;
  const toYear = year;
  const to = `${toYear}-${String(toMonth + 1).padStart(2, "0")}-15`;

  return { from, to };
}

function toDate(s: string): Date {
  return startOfDay(parseISO(s));
}

function pct(num: number, denom: number): string {
  if (!denom) return "0.0%";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

// ─── KPI card ───────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  icon: Icon,
  sub,
  accent = false,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider mb-1">
              {title}
            </p>
            <p className="text-2xl font-bold text-foreground">{value}</p>
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

// ─── main component ─────────────────────────────────────────────────────────

export default function Reporting() {
  const defaults = defaultPeriod();
  const [fromDate, setFromDate] = useState(defaults.from);
  const [toDate2, setToDate2] = useState(defaults.to);

  const { data: outcomes = [], isLoading: outcomesLoading } = useQuery<any[]>({
    queryKey: ["/api/outcomes"],
  });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: los = [] } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });
  // All call logs across all dates — we'll filter by range in the table
  // We fetch per-day lazily via a query that accepts a date range by scanning all logs
  // For now fetch for the selected period one day at a time would be expensive;
  // instead we store callsMade in a per-user aggregation from the /api/call-logs endpoint
  // which returns a single date. For range reporting we fetch all outcomes and
  // approximate calls from the daily_call_logs by making one summary call.
  const { data: callLogSummary = [] } = useQuery<any[]>({
    queryKey: ["/api/call-logs/summary", fromDate, toDate2],
    queryFn: () => apiRequest("GET", `/api/call-logs/summary?from=${fromDate}&to=${toDate2}`),
    retry: false,
  });

  // ── quick-select helpers ──
  function setThisMonth() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    setFromDate(`${y}-${m}-01`);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    setToDate2(format(last, "yyyy-MM-dd"));
  }

  function setLast30() {
    const now = new Date();
    setFromDate(format(subDays(now, 29), "yyyy-MM-dd"));
    setToDate2(format(now, "yyyy-MM-dd"));
  }

  function setAllTime() {
    setFromDate("2000-01-01");
    setToDate2(format(new Date(), "yyyy-MM-dd"));
  }

  // ── filtered outcomes ──
  const filtered = useMemo(() => {
    if (!fromDate || !toDate2) return outcomes;
    const start = toDate(fromDate);
    const end = toDate(toDate2);
    return outcomes.filter((o: any) => {
      try {
        const d = toDate(o.date);
        return isWithinInterval(d, { start, end });
      } catch {
        return false;
      }
    });
  }, [outcomes, fromDate, toDate2]);

  // ── KPI calculations ──
  const totalTransfers = filtered.filter(
    (o: any) => o.outcomeType === "transfer"
  ).length;
  const totalAppointments = filtered.filter(
    (o: any) => o.outcomeType === "appointment"
  ).length;
  const totalActivities = filtered.length;
  const convRate = pct(totalTransfers, totalActivities);

  // ── chart data ──
  const countsByType: Record<string, number> = {};
  filtered.forEach((o: any) => {
    countsByType[o.outcomeType] = (countsByType[o.outcomeType] || 0) + 1;
  });
  const chartData = Object.entries(countsByType)
    .map(([type, count]) => ({
      type,
      label: OUTCOME_LABELS[type] ?? type,
      count,
      color: OUTCOME_CHART_COLORS[type] ?? "#9ca3af",
    }))
    .sort((a, b) => b.count - a.count);

  // ── per-CLR breakdown ──
  const userMap: Record<number, string> = {};
  users.forEach((u: any) => { userMap[u.id] = u.name; });

  const clrStats: Record<
    number,
    { name: string; transfer: number; appointment: number; fell_through: number; total: number }
  > = {};
  filtered.forEach((o: any) => {
    const id = o.assistantId;
    if (!clrStats[id]) {
      clrStats[id] = {
        name: userMap[id] ?? `CLR #${id}`,
        transfer: 0,
        appointment: 0,
        fell_through: 0,
        total: 0,
      };
    }
    clrStats[id].total++;
    if (o.outcomeType === "transfer") clrStats[id].transfer++;
    else if (o.outcomeType === "appointment") clrStats[id].appointment++;
    else if (o.outcomeType === "fell_through") clrStats[id].fell_through++;

  });
  const clrRows = Object.values(clrStats).sort((a, b) => b.transfer - a.transfer);

  // ── per-LO breakdown ──
  const loMap: Record<number, { fullName: string; nmlsId: string }> = {};
  los.forEach((lo: any) => { loMap[lo.id] = { fullName: lo.fullName, nmlsId: lo.nmlsId }; });

  const loStats: Record<
    number,
    { name: string; nmls: string; transfer: number; appointment: number; total: number }
  > = {};
  filtered.forEach((o: any) => {
    const id = o.loId;
    if (!loStats[id]) {
      loStats[id] = {
        name: loMap[id]?.fullName ?? `LO #${id}`,
        nmls: loMap[id]?.nmlsId ?? "—",
        transfer: 0,
        appointment: 0,
        total: 0,
      };
    }
    loStats[id].total++;
    if (o.outcomeType === "transfer") loStats[id].transfer++;
    else if (o.outcomeType === "appointment") loStats[id].appointment++;
  });
  const loRows = Object.values(loStats)
    .filter((r) => r.total > 0)
    .sort((a, b) => b.transfer - a.transfer);

  // ── CSV export ──
  function exportCSV() {
    const headers = [
      "id",
      "date",
      "assistantId",
      "assistantName",
      "loId",
      "loName",
      "borrowerName",
      "outcomeType",
      "journeyId",
      "notes",
      "followUpDate",
      "tags",
    ];
    const rows = filtered.map((o: any) =>
      [
        o.id,
        o.date,
        o.assistantId,
        userMap[o.assistantId] ?? "",
        o.loId,
        loMap[o.loId]?.fullName ?? "",
        o.borrowerName ?? "",
        o.outcomeType,
        o.journeyId ?? "",
        (o.notes ?? "").replace(/"/g, '""'),
        o.followUpDate ?? "",
        Array.isArray(o.tags) ? o.tags.join(";") : (o.tags ?? ""),
      ]
        .map((v) => `"${v}"`)
        .join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outcomes-${fromDate}-to-${toDate2}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isLoading = outcomesLoading;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      {/* ── Page header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-primary" />
            Reporting &amp; Export
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Outcomes analysis for the selected date range
          </p>
        </div>
        <Button
          variant="outline"
          onClick={exportCSV}
          disabled={filtered.length === 0}
          data-testid="button-export-csv"
          className="gap-2"
        >
          <Download className="w-4 h-4" />
          Export CSV
        </Button>
      </div>

      {/* ── Date range selector ── */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex items-end gap-3 flex-1 min-w-[280px]">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  From
                </label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-40"
                  data-testid="input-date-from"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  To
                </label>
                <Input
                  type="date"
                  value={toDate2}
                  onChange={(e) => setToDate2(e.target.value)}
                  className="w-40"
                  data-testid="input-date-to"
                />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={setThisMonth}
                data-testid="button-this-month"
              >
                This Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={setLast30}
                data-testid="button-last-30"
              >
                Last 30 Days
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={setAllTime}
                data-testid="button-all-time"
              >
                All Time
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const d = defaultPeriod();
                  setFromDate(d.from);
                  setToDate2(d.to);
                }}
                data-testid="button-default-period"
              >
                Current Period
              </Button>
            </div>
            {!isLoading && (
              <p className="text-xs text-muted-foreground ml-auto self-center">
                {filtered.length} outcome{filtered.length !== 1 ? "s" : ""} in range
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── KPI cards ── */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            title="Total Transfers"
            value={totalTransfers}
            icon={ArrowUpRight}
            sub="successful transfers"
            accent
          />
          <KpiCard
            title="Total Appointments"
            value={totalAppointments}
            icon={Calendar}
            sub="booked appointments"
            accent
          />
          <KpiCard
            title="Total Activities"
            value={totalActivities}
            icon={Activity}
            sub="all outcome types"
          />
          <KpiCard
            title="Conversion Rate"
            value={convRate}
            icon={TrendingUp}
            sub="transfers ÷ total"
            accent
          />
        </div>
      )}

      {/* ── Bar chart ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Outcomes by Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : chartData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
              No outcomes in this date range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
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
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--card))",
                    color: "hsl(var(--foreground))",
                  }}
                  cursor={{ fill: "hsl(var(--muted))" }}
                />
                <Bar dataKey="count" name="Count" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, idx) => (
                    <Cell key={idx} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── Per-CLR table ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Per-CLR Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : clrRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No CLR activity in this date range
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    CLR Name
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Transfers
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Appointments
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Fell Through
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Calls Made
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Total
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Conv. Rate
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clrRows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-primary font-semibold">
                      {row.transfer}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.appointment}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-red-600 dark:text-red-400">
                      {row.fell_through}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">
                      {(callLogSummary as any[]).find(s => s.name === row.name)?.totalCalls ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {row.total}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {pct(row.transfer, row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Per-LO table ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Per-LO Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : loRows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No LO activity in this date range
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    LO Name
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium">
                    NMLS
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Transfers
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Appointments
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Total
                  </TableHead>
                  <TableHead className="text-xs uppercase tracking-wider font-medium text-right">
                    Conv. Rate
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loRows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">
                      {row.nmls}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-primary font-semibold">
                      {row.transfer}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row.appointment}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {row.total}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {pct(row.transfer, row.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
