import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, RefreshCw, Check, X, Clock3, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Suggestion = {
  id: number; title: string; area: string; problem: string; proposal: string;
  evidence: string; impact: string; effort: string; status: string;
  decision_note: string; decided_by_name: string | null; decided_at: string | null;
  cycle: string; model: string; created_at: string;
};
type Payload = {
  suggestions: Suggestion[];
  reviews: any[];
  counts: Record<string, number>;
  configured: boolean;
  nextRoutineDue: boolean;
  nextDeepDue: boolean;
};

const RANK: Record<string, string> = {
  high: "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export default function AppReviewPage() {
  const { toast } = useToast();
  const [status, setStatus] = useState("pending");
  const [notes, setNotes] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery<Payload>({
    queryKey: ["/api/app-review", status],
    queryFn: () => apiRequest("GET", `/api/app-review?status=${status}`),
  });

  const decide = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied" }) =>
      apiRequest("POST", `/api/app-review/suggestions/${v.id}/decision`, { status: v.status, note: notes[v.id] ?? "" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-review"] });
      toast({ title: "Recorded" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const runNow = useMutation({
    mutationFn: (cycle: "routine" | "deep") => apiRequest("POST", "/api/app-review/run", { cycle }),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/app-review"] });
      toast({ title: "Review complete", description: `${r.count} suggestion(s).` });
    },
    onError: (e: any) => toast({ title: "Review failed", description: e.message, variant: "destructive" }),
  });

  const list = data?.suggestions ?? [];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-5xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-violet-600" /> App Review
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Claude looks at how C3 is actually being used every 3 days, and more thoroughly every 4 weeks,
            then proposes changes. Nothing here changes the app on its own — approving records that you want it done.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-40" data-testid="app-review-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending ({data?.counts?.pending ?? 0})</SelectItem>
              <SelectItem value="approved">Approved ({data?.counts?.approved ?? 0})</SelectItem>
              <SelectItem value="denied">Denied ({data?.counts?.denied ?? 0})</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" disabled={runNow.isPending || !data?.configured}
            onClick={() => runNow.mutate("routine")} data-testid="app-review-run">
            <RefreshCw className={runNow.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Review now
          </Button>
        </div>
      </header>

      {data && !data.configured && (
        <Card className="border-amber-400">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
            <span>No Claude API key is configured, so reviews cannot run. Set <code>ANTHROPIC_API_KEY</code> in the server environment.</span>
          </CardContent>
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && !list.length && (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          Nothing here yet. The next review runs on its own; "Review now" runs one immediately.
        </CardContent></Card>
      )}

      {list.map((s) => (
        <Card key={s.id} data-testid="app-review-suggestion">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={RANK[s.impact] ?? RANK.low}>{s.impact} impact</Badge>
              <Badge variant="outline">{s.effort} effort</Badge>
              {s.area && <Badge variant="secondary">{s.area}</Badge>}
              {s.status !== "pending" && (
                <Badge variant={s.status === "approved" ? "default" : "destructive"}>
                  {s.status === "approved" ? "Approved" : "Denied"}
                  {s.decided_by_name ? " · " + s.decided_by_name : ""}
                </Badge>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground flex items-center gap-1">
                <Clock3 className="h-3 w-3" /> {s.cycle === "deep" ? "4-week review" : "3-day review"} · {s.model}
              </span>
            </div>
            <CardTitle className="text-base mt-2">{s.title}</CardTitle>
            <CardDescription className="whitespace-pre-wrap">{s.problem}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Proposal</p>
              <p className="text-sm whitespace-pre-wrap mt-0.5">{s.proposal}</p>
            </div>
            {s.evidence && (
              <div className="rounded-lg border bg-muted/20 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Evidence</p>
                <p className="text-sm whitespace-pre-wrap mt-0.5">{s.evidence}</p>
              </div>
            )}
            {s.status === "pending" ? (
              <div className="space-y-2">
                <Textarea rows={2} placeholder="Optional note — why, or what to do instead"
                  value={notes[s.id] ?? ""} onChange={(e) => setNotes((p) => ({ ...p, [s.id]: e.target.value }))} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: s.id, status: "approved" })}
                    data-testid={"approve-" + s.id}>
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: s.id, status: "denied" })}
                    data-testid={"deny-" + s.id}>
                    <X className="h-4 w-4" /> Deny
                  </Button>
                </div>
              </div>
            ) : s.decision_note ? (
              <p className="text-xs text-muted-foreground border-l-2 pl-2">{s.decision_note}</p>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {!!data?.reviews?.length && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Recent runs</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {data.reviews.map((r: any) => (
              <div key={r.id} className="flex flex-wrap gap-2">
                <span className="tabular-nums">{String(r.started_at).slice(0, 16).replace("T", " ")}</span>
                <span>{r.cycle}</span>
                <span>{r.status}</span>
                <span>{r.suggestion_count} suggestion(s)</span>
                {r.cost_cents ? <span>~${(r.cost_cents / 100).toFixed(2)}</span> : null}
                {r.error ? <span className="text-destructive">{r.error}</span> : null}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
