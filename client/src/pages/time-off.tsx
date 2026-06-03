import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { CalendarOff, Check, X, Clock, Trash2, Plane, Construction } from "lucide-react";

interface TimeOffRequest {
  id: number;
  userId: number;
  userName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: "pending" | "approved" | "denied" | "cancelled";
  reviewedBy: number | null;
  reviewerName: string | null;
  reviewerNote: string;
  createdAt: string | null;
  reviewedAt: string | null;
}

function fmtDate(d: string) {
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return d; }
}

function dayCount(start: string, end: string) {
  try {
    const a = new Date(start + "T12:00:00").getTime();
    const b = new Date(end + "T12:00:00").getTime();
    return Math.max(1, Math.round((b - a) / 86400000) + 1);
  } catch { return 1; }
}

function StatusBadge({ status }: { status: TimeOffRequest["status"] }) {
  const map: Record<TimeOffRequest["status"], { label: string; cls: string }> = {
    pending: { label: "Pending", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
    approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300" },
    denied: { label: "Denied", cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
  };
  const cfg = map[status] ?? map.pending;
  return <Badge className={"text-xs px-2 py-0.5 " + cfg.cls}>{cfg.label}</Badge>;
}

export default function TimeOff() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = !!(user && (user.role === "admin" || (user as any).isManager));

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  const { data: myRequests = [], isLoading: myLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off", "mine"],
    queryFn: () => apiRequest("GET", "/api/time-off?scope=mine"),
  });

  const { data: teamRequests = [], isLoading: teamLoading } = useQuery<TimeOffRequest[]>({
    queryKey: ["/api/time-off", "team"],
    queryFn: () => apiRequest("GET", "/api/time-off"),
    enabled: isManager,
  });

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
  }

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/time-off", { startDate, endDate, reason }),
    onSuccess: () => {
      toast({ title: "Request submitted", description: "Your manager will review it shortly." });
      setStartDate(""); setEndDate(""); setReason("");
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not submit", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const decideMutation = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied"; reviewerNote: string }) =>
      apiRequest("PATCH", "/api/time-off/" + v.id, { status: v.status, reviewerNote: v.reviewerNote }),
    onSuccess: (_d, v) => {
      toast({ title: "Request " + v.status });
      refresh();
    },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", "/api/time-off/" + id),
    onSuccess: () => { toast({ title: "Request removed" }); refresh(); },
    onError: (e: any) => toast({ title: "Could not remove", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  const canSubmit = !!startDate && !!endDate && endDate >= startDate && !createMutation.isPending;
  const pendingCount = teamRequests.filter(r => r.status === "pending").length;

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Plane className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Time Off</h1>
          <p className="text-sm text-muted-foreground">Request days off and track approvals.</p>
        </div>
      </div>

      {/* Beta / under construction banner */}
      <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex items-center gap-2.5">
        <Construction className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Under construction — Beta</p>
          <p className="text-xs text-amber-700/80 dark:text-amber-400/80">This feature is still being built. Things may change and may not work perfectly yet.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarOff className="w-4 h-4" /> Request Time Off
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Start date</label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="input-timeoff-start" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">End date</label>
              <Input type="date" value={endDate} min={startDate || undefined} onChange={e => setEndDate(e.target.value)} data-testid="input-timeoff-end" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Reason (optional)</label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Vacation, appointment, personal day, etc."
              data-testid="textarea-timeoff-reason"
            />
          </div>
          {startDate && endDate && endDate < startDate && (
            <p className="text-xs text-red-600">End date cannot be before the start date.</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {startDate && endDate && endDate >= startDate ? dayCount(startDate, endDate) + " day(s)" : ""}
            </span>
            <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} data-testid="button-submit-timeoff">
              {createMutation.isPending ? "Submitting…" : "Submit Request"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isManager && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" /> Team Requests
              {pendingCount > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1.5">{pendingCount} pending</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {teamLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : teamRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No time-off requests yet.</p>
            ) : (
              teamRequests.map(r => (
                <div key={r.id} className="rounded-lg border px-4 py-3" data-testid={"team-request-" + r.id}>
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold">{r.userName}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-sm text-foreground mt-0.5">
                        {fmtDate(r.startDate)} &rarr; {fmtDate(r.endDate)}
                        <span className="text-muted-foreground"> &middot; {dayCount(r.startDate, r.endDate)} day(s)</span>
                      </p>
                      {r.reason && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{r.reason}</p>}
                      {r.status !== "pending" && r.reviewerName && (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          {r.status === "approved" ? "Approved" : "Denied"} by {r.reviewerName}
                          {r.reviewerNote ? " — " + r.reviewerNote : ""}
                        </p>
                      )}
                    </div>
                    {r.status === "pending" && (
                      <div className="flex flex-col gap-2 w-full sm:w-64">
                        <Input
                          placeholder="Note (optional)"
                          value={reviewNotes[r.id] ?? ""}
                          onChange={e => setReviewNotes(p => ({ ...p, [r.id]: e.target.value }))}
                          className="h-8 text-xs"
                          data-testid={"input-review-note-" + r.id}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-8 flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                            onClick={() => decideMutation.mutate({ id: r.id, status: "approved", reviewerNote: reviewNotes[r.id] ?? "" })}
                            disabled={decideMutation.isPending}
                            data-testid={"button-approve-" + r.id}
                          >
                            <Check className="w-3.5 h-3.5" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 border-red-300 text-red-700 hover:bg-red-50 gap-1"
                            onClick={() => decideMutation.mutate({ id: r.id, status: "denied", reviewerNote: reviewNotes[r.id] ?? "" })}
                            disabled={decideMutation.isPending}
                            data-testid={"button-deny-" + r.id}
                          >
                            <X className="w-3.5 h-3.5" /> Deny
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">My Requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {myLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : myRequests.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">You have not requested any time off yet.</p>
          ) : (
            myRequests.map(r => (
              <div key={r.id} className="rounded-lg border px-4 py-3 flex items-start justify-between gap-3" data-testid={"my-request-" + r.id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{fmtDate(r.startDate)} &rarr; {fmtDate(r.endDate)}</span>
                    <StatusBadge status={r.status} />
                    <span className="text-xs text-muted-foreground">{dayCount(r.startDate, r.endDate)} day(s)</span>
                  </div>
                  {r.reason && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{r.reason}</p>}
                  {r.status !== "pending" && r.reviewerName && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {r.status === "approved" ? "Approved" : "Denied"} by {r.reviewerName}
                      {r.reviewerNote ? " — " + r.reviewerNote : ""}
                    </p>
                  )}
                </div>
                {r.status !== "cancelled" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-muted-foreground hover:text-red-600 gap-1 shrink-0"
                    onClick={() => cancelMutation.mutate(r.id)}
                    disabled={cancelMutation.isPending}
                    data-testid={"button-cancel-" + r.id}
                    title={r.status === "approved" ? "Withdraw this approved time off" : undefined}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {r.status === "denied" ? "Remove" : "Cancel"}
                  </Button>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
