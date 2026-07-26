import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileSearch,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  formatLapDate,
  getLapStatsPeriod,
  LAP_DOCUMENTS,
  lapRequest,
  type LapPeriodStats,
  type LapResult,
  unwrapLapResults,
} from "@/lib/lap-api";

type Period = "today" | "week" | "month" | "allTime";

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "allTime", label: "All time" },
];

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  emphasized = false,
}: {
  label: string;
  value: number;
  sub: string;
  icon: any;
  emphasized?: boolean;
}) {
  return (
    <Card className={emphasized ? "border-primary/30 bg-primary/5" : ""}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-bold tabular-nums">{value.toLocaleString()}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${emphasized ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ResultRow({ result }: { result: LapResult }) {
  const completeDocuments = LAP_DOCUMENTS.filter((document) => !!result.files?.[document.key]).length;
  return (
    <Link
      href={`/results/${result.id}`}
      className="flex items-center gap-3 rounded-lg border-b px-2 py-3 transition-colors last:border-0 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open result package for ${result.borrowerName}`}
    >
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
        result.complete
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-primary/10 text-primary"
      }`}>
        {result.complete ? <CheckCircle2 className="h-4 w-4" /> : <FileSearch className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{result.borrowerName}</p>
          {result.dealReference && <span className="hidden truncate text-[10px] text-muted-foreground sm:inline">#{result.dealReference}</span>}
        </div>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {result.loanOfficerName || "No LO selected"} · Updated {formatLapDate(result.updatedAt, true)}
        </p>
      </div>
      <Badge
        variant="outline"
        className={result.complete
          ? "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
          : "text-muted-foreground"}
      >
        {result.complete ? "Complete" : `${completeDocuments}/3`}
      </Badge>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function CoverageBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">{value} · {percent}%</span>
      </div>
      <Progress value={percent} className="h-2" />
    </div>
  );
}

export default function LapDashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>("week");
  const canViewArchive = user?.role === "admin" || user?.role === "viewer" || !!user?.superAdmin;

  const statsQuery = useQuery({
    queryKey: ["/api/lap/stats"],
    queryFn: () => lapRequest<any>("GET", "/api/lap/stats"),
    refetchInterval: 60_000,
  });
  const resultsQuery = useQuery({
    queryKey: ["/api/lap/results", "dashboard-recent"],
    queryFn: () => lapRequest<unknown>("GET", "/api/lap/results?limit=8"),
  });

  const stats = getLapStatsPeriod(statsQuery.data, period);
  const recent = useMemo(() => {
    const fromStats = Array.isArray(statsQuery.data?.recent) ? statsQuery.data.recent as LapResult[] : [];
    const fromResults = unwrapLapResults(resultsQuery.data);
    return (fromStats.length ? fromStats : fromResults)
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 6);
  }, [statsQuery.data, resultsQuery.data]);

  const completionRate = stats.total > 0 ? Math.round((stats.complete / stats.total) * 100) : 0;
  const firstName = user?.name?.split(" ")[0] || "there";

  return (
    <div className="mx-auto max-w-[1450px] space-y-5 p-4 sm:p-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary via-primary to-primary/75 px-5 py-7 text-primary-foreground shadow-lg sm:px-8 sm:py-8">
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 h-56 w-56 rounded-full bg-black/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
              <Sparkles className="h-4 w-4" /> LO Assistant Portal
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">Good to see you, {firstName}.</h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-primary-foreground/80">
              Keep borrower packages complete, current, and ready for the Loan Officer without chasing files across inboxes.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-white text-primary hover:bg-white/90">
              <Link href="/results"><Plus /> New result package</Link>
            </Button>
            {canViewArchive && (
              <Button asChild variant="outline" className="border-white/30 bg-white/5 text-white hover:bg-white/10">
                <Link href="/reports-archive">Open report archive <ArrowRight /></Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Operations overview</h2>
          <p className="text-xs text-muted-foreground">A focused view of document throughput and package readiness.</p>
        </div>
        <div className="inline-flex w-fit rounded-lg border bg-muted/30 p-1">
          {PERIODS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setPeriod(option.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                period === option.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {statsQuery.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading LAP summary">
          {[0, 1, 2, 3].map((item) => (
            <Card key={item}>
              <CardContent className="p-5">
                <div className="h-20 animate-pulse rounded-lg bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : statsQuery.isError ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="font-medium">The LAP summary could not be loaded.</p>
              <p className="text-xs text-muted-foreground">Your result packages are still available in Input Results.</p>
            </div>
            <Button variant="outline" onClick={() => statsQuery.refetch()}><RefreshCw /> Retry</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Result packages"
            value={stats.total}
            sub={period === "today" ? "created today" : `in ${PERIODS.find((item) => item.key === period)?.label.toLowerCase()}`}
            icon={FileText}
          />
          <SummaryCard
            label="Complete packages"
            value={stats.complete}
            sub={`${completionRate}% ready with all three documents`}
            icon={FileCheck2}
            emphasized
          />
          <SummaryCard
            label="Needs attention"
            value={stats.incomplete}
            sub="missing one or more documents"
            icon={FileSearch}
          />
          <SummaryCard
            label="Documents uploaded"
            value={stats.creditReports + stats.aus + stats.formalQuotes}
            sub="credit, AUS, and formal quote files"
            icon={UploadCloud}
          />
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Recent packages</CardTitle>
              <CardDescription>Most recently updated borrower work</CardDescription>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link href="/results">View all <ArrowRight /></Link>
            </Button>
          </CardHeader>
          <CardContent>
            {resultsQuery.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-muted" />)}
              </div>
            ) : resultsQuery.isError && recent.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center gap-2 py-8 text-center">
                <FileSearch className="h-8 w-8 text-destructive/70" />
                <p className="text-sm font-medium">Couldn&apos;t load recent packages</p>
                <p className="text-xs text-muted-foreground">Retry without leaving your dashboard.</p>
                <Button type="button" size="sm" variant="outline" className="mt-1 gap-1.5" onClick={() => resultsQuery.refetch()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Retry
                </Button>
              </div>
            ) : recent.length ? (
              recent.map((result) => <ResultRow key={result.id} result={result} />)
            ) : (
              <div className="py-12 text-center">
                <FileCheck2 className="mx-auto h-9 w-9 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium">No packages yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Create a borrower package to start the result workspace.</p>
                <Button asChild size="sm" className="mt-4"><Link href="/results"><Plus /> Create package</Link></Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Document coverage</CardTitle>
              <CardDescription>Uploaded files across the selected period</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {statsQuery.isLoading ? (
                [0, 1, 2].map((item) => <div key={item} className="h-9 animate-pulse rounded-lg bg-muted" />)
              ) : statsQuery.isError ? (
                <div className="py-4 text-center">
                  <p className="text-xs text-muted-foreground">Coverage is unavailable until the summary reconnects.</p>
                  <Button type="button" size="sm" variant="ghost" className="mt-2 gap-1.5" onClick={() => statsQuery.refetch()}>
                    <RefreshCw className="h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              ) : (
                <>
                  <CoverageBar label="Credit Reports" value={stats.creditReports} total={stats.total} />
                  <CoverageBar label="AUS findings" value={stats.aus} total={stats.total} />
                  <CoverageBar label="Formal Quotes" value={stats.formalQuotes} total={stats.total} />
                </>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardContent className="relative p-5">
              <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-primary/10 blur-2xl" />
              <div className="relative">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <CalendarCheck2 className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">Built for a clean handoff</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  A package marked Complete has all three required documents. Replace stale files in place so the current version is always obvious.
                </p>
                <div className="mt-4 flex items-center gap-2 text-[11px] font-medium text-primary">
                  <Clock3 className="h-3.5 w-3.5" /> Every change is timestamped
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
