// Chris Redoble's transfers, straight from C3, with document completeness.
//
// The transfer list is not entered here — it is whatever C3 logged. This screen
// exists to answer one question at a glance: for every transfer that went to
// Chris, did the three documents actually get submitted?
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { AlertTriangle, CheckCircle2, FilePlus2, FileWarning, Link2, RefreshCw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatLapDate, lapRequest } from "@/lib/lap-api";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const WINDOWS = [
  { value: 3, label: "3 days" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 0, label: "All time" },
];

const DOCS = [
  { key: "credit_report", label: "Credit report" },
  { key: "aus", label: "AUS" },
  { key: "formal_quote", label: "Formal quote" },
] as const;

type AuditRow = {
  outcomeId: number;
  date: string;
  borrowerName: string;
  clrName: string | null;
  loaName: string | null;
  packageId: number | null;
  docs: Record<string, boolean>;
  submittedCount: number;
  complete: boolean;
  matchType: "linked" | "suggested" | "none";
};

type AuditResponse = {
  window: number;
  label: string;
  loanOfficer: { id: number; name: string } | null;
  summary: { transfers: number; complete: number; partial: number; missing: number; completionPct: number };
  rows: AuditRow[];
};

function Tick({ ok }: { ok: boolean }) {
  return ok
    ? <CheckCircle2 className="w-4 h-4 text-emerald-600 mx-auto" aria-label="submitted" />
    : <XCircle className="w-4 h-4 text-muted-foreground/40 mx-auto" aria-label="not submitted" />;
}

export default function LapTransferAuditPage() {
  const [window, setWindow] = useState(7);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const query = useQuery<AuditResponse>({
    queryKey: ["/api/lap/transfer-audit", window],
    queryFn: () => lapRequest("GET", `/api/lap/transfer-audit?window=${window}`),
  });

  const data = query.data;
  const rows = data?.rows ?? [];
  // Client-side "connected LOA" filter — every row already carries loaName
  // from the C3 transfer, so no extra request is needed.
  const [loaFilter, setLoaFilter] = useState("all");
  const loaNames = Array.from(new Set(rows.map((r) => r.loaName).filter(Boolean))).sort() as string[];
  const visibleRows = loaFilter === "all" ? rows
    : loaFilter === "none" ? rows.filter((r) => !r.loaName)
    : rows.filter((r) => r.loaName === loaFilter);
  const packageMutation = useMutation({
    mutationFn: ({ outcomeId, packageId }: { outcomeId: number; packageId?: number }) =>
      lapRequest<any>("POST", `/api/lap/transfer-audit/${outcomeId}/package`, packageId ? { packageId } : {}),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/lap/transfer-audit"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/lap/results"] }),
      ]);
      const id = Number(response?.result?.id);
      toast({ title: "Transfer connected to LAP", description: "The borrower now has one package for notes and any optional documents." });
      if (id) navigate(`/results/${id}`);
    },
    onError: (error: any) => toast({ title: "Could not connect transfer", description: error?.message, variant: "destructive" }),
  });

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileWarning className="w-5 h-5 text-primary" />
            {data?.loanOfficer?.name ?? "Chris Redoble"} — Transfer Documents
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every transfer C3 logged to {data?.loanOfficer?.name ?? "Chris"}. Open one LAP package and add whichever documents are useful.
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="flex gap-2 flex-wrap" data-testid="audit-window-tabs">
        {WINDOWS.map((w) => (
          <Button
            key={w.value}
            size="sm"
            variant={window === w.value ? "default" : "outline"}
            onClick={() => setWindow(w.value)}
            data-testid={`audit-window-${w.value}`}
          >{w.label}</Button>
        ))}
      </div>

      {query.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Transfers", value: data?.summary.transfers ?? 0, tone: "text-foreground" },
              { label: "All 3 in", value: data?.summary.complete ?? 0, tone: "text-emerald-600" },
              { label: "Partial", value: data?.summary.partial ?? 0, tone: "text-amber-600" },
              { label: "Nothing in", value: data?.summary.missing ?? 0, tone: "text-red-600" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.tone}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{data?.label ?? ""}</CardTitle>
              <CardDescription>
                {data?.summary.transfers
                  ? `${data.summary.completionPct}% of transfers currently have all three optional document types attached.`
                  : "No transfers logged in this window."}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connected LOA</span>
                <Select value={loaFilter} onValueChange={setLoaFilter}>
                  <SelectTrigger className="h-8 w-56" data-testid="audit-loa-filter"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All LOAs</SelectItem>
                    {loaNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                    <SelectItem value="none">No LOA on the transfer</SelectItem>
                  </SelectContent>
                </Select>
                {loaFilter !== "all" && (
                  <span className="text-xs text-muted-foreground">{visibleRows.length} of {rows.length} transfers</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="audit-table">
                  <thead>
                    <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="text-left font-semibold px-3 py-2">Date</th>
                      <th className="text-left font-semibold px-3 py-2">Borrower</th>
                      <th className="text-left font-semibold px-3 py-2">CLR</th>
                      <th className="text-left font-semibold px-3 py-2">LOA</th>
                      {DOCS.map((d) => (
                        <th key={d.key} className="text-center font-semibold px-3 py-2 whitespace-nowrap">{d.label}</th>
                      ))}
                      <th className="text-left font-semibold px-3 py-2">Status</th>
                      <th className="text-left font-semibold px-3 py-2">LAP package</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.outcomeId} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">{formatLapDate(r.date)}</td>
                        <td className="px-3 py-2 font-medium">{r.borrowerName || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.clrName ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.loaName ?? "—"}</td>
                        {DOCS.map((d) => (
                          <td key={d.key} className="px-3 py-2"><Tick ok={!!r.docs?.[d.key]} /></td>
                        ))}
                        <td className="px-3 py-2">
                          {r.complete ? (
                            <Badge variant="outline" className="gap-1 text-xs border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" /> Complete
                            </Badge>
                          ) : r.submittedCount === 0 ? (
                            <Badge variant="outline" className="gap-1 text-xs border-red-300 text-red-700 dark:border-red-800 dark:text-red-400">
                              <AlertTriangle className="w-3 h-3" /> Nothing submitted
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">
                              {r.submittedCount} of 3
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {r.packageId ? (
                            <div className="flex items-center gap-1.5">
                              {r.matchType === "suggested" && <Button size="sm" variant="outline" className="h-7 gap-1" disabled={packageMutation.isPending} onClick={() => packageMutation.mutate({ outcomeId: r.outcomeId, packageId: r.packageId! })}><Link2 className="h-3 w-3" /> Connect existing</Button>}
                              <Button size="sm" variant={r.matchType === "linked" ? "default" : "ghost"} className="h-7" onClick={() => navigate(`/results/${r.packageId}`)}>Open</Button>
                            </div>
                          ) : (
                            <Button size="sm" className="h-7 gap-1" disabled={packageMutation.isPending} onClick={() => packageMutation.mutate({ outcomeId: r.outcomeId })}>
                              {packageMutation.isPending && packageMutation.variables?.outcomeId === r.outcomeId ? <RefreshCw className="h-3 w-3 animate-spin" /> : <FilePlus2 className="h-3 w-3" />} Start package
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {!rows.length && (
                      <tr><td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                        No transfers logged in this window.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <p className="text-[11px] text-muted-foreground">
            Transfers come from C3 automatically. A matching borrower name is shown as a suggestion; choose Connect existing
            to make the link exact. If two packages were started, open either one and use Merge package.
          </p>
        </>
      )}
    </div>
  );
}
