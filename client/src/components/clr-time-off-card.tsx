/**
 * Manager-facing time off on a CLR profile.
 * Writes approved rows to time_off_requests (same table scorecard / TV pace read)
 * so half/full/sick land in credit + denom immediately — no pending footgun.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Palmtree } from "lucide-react";
import { LEAVE_KIND_LABELS, type LeaveKind } from "@shared/half-day";

type TimeOffRow = {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  dayPortion: "full" | "half";
  leaveKind?: LeaveKind;
};

const KINDS: LeaveKind[] = ["half", "pto", "sick_documented", "sick_undocumented"];

export function ClrTimeOffCard({ userId, clrName }: { userId: number; clrName: string }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<LeaveKind>("half");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: rows = [], isLoading } = useQuery<TimeOffRow[]>({
    queryKey: ["/api/time-off", userId],
    queryFn: async () => {
      const all = await apiRequest("GET", "/api/time-off") as TimeOffRow[];
      return (Array.isArray(all) ? all : []).filter((r) => Number(r.userId) === Number(userId));
    },
    enabled: Number.isFinite(userId) && userId > 0,
  });

  const visible = useMemo(
    () => rows.filter((r) => r.status !== "cancelled" && r.status !== "canceled" && r.status !== "denied"),
    [rows],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new Error("Pick a start date");
      const end = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : startDate;
      if (end < startDate) throw new Error("End date cannot be before start");
      const body = {
        startDate,
        endDate: end,
        leaveKind: kind,
        reason: reason.trim() || LEAVE_KIND_LABELS[kind],
        onBehalfOf: userId,
      };
      if (editingId != null) {
        return apiRequest("PATCH", `/api/time-off/${editingId}`, body);
      }
      return apiRequest("POST", "/api/time-off", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      toast({
        title: editingId ? "Time off updated" : "Time off recorded",
        description: `${LEAVE_KIND_LABELS[kind]} for ${clrName} is approved and counts in transfers/day right away.`,
      });
      setEditingId(null);
      setReason("");
    },
    onError: (e: any) => toast({ title: "Could not save time off", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/time-off/${id}`, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      toast({ title: "Time off cancelled" });
    },
    onError: (e: any) => toast({ title: "Could not cancel", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/time-off/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      toast({ title: "Time off removed" });
    },
    onError: (e: any) => toast({ title: "Could not remove", description: String(e?.message ?? e), variant: "destructive" }),
  });

  function beginEdit(row: TimeOffRow) {
    setEditingId(row.id);
    setKind((row.leaveKind as LeaveKind) || (row.dayPortion === "half" ? "half" : "pto"));
    setStartDate(row.startDate);
    setEndDate(row.endDate);
    setReason(row.reason ?? "");
  }

  return (
    <Card data-testid="clr-time-off-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Palmtree className="w-4 h-4" /> Time off / sick
        </CardTitle>
        <CardDescription>
          Record half day, full PTO, documented sick, or undocumented sick for {clrName}.
          Manager entries are approved immediately so scorecard and TV pace pick them up —
          they never sit pending and block half-day seeds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={"rounded-md border px-2.5 py-1 text-xs transition-colors "
                + (kind === k ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
              data-testid={"clr-leave-kind-" + k}
            >
              {LEAVE_KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-40" data-testid="clr-leave-start" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={endDate || startDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-40" data-testid="clr-leave-end" />
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Note (optional)"
            className="h-9 flex-1 min-w-[160px]"
            data-testid="clr-leave-reason"
          />
          <Button size="sm" disabled={save.isPending || !startDate} onClick={() => save.mutate()} data-testid="clr-leave-save">
            {editingId != null ? "Save changes" : "Record (approved)"}
          </Button>
          {editingId != null && (
            <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setReason(""); }}>Clear edit</Button>
          )}
        </div>
        <div className="space-y-1.5">
          {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!isLoading && visible.length === 0 && (
            <p className="text-xs text-muted-foreground">No active time off on file for this CLR.</p>
          )}
          {visible.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs" data-testid={"clr-leave-row-" + r.id}>
              <div className="space-y-0.5">
                <div className="font-medium">
                  {LEAVE_KIND_LABELS[(r.leaveKind as LeaveKind) || (r.dayPortion === "half" ? "half" : "pto")]}
                  {" · "}{r.startDate}{r.endDate !== r.startDate ? ` → ${r.endDate}` : ""}
                  <span className="ml-1.5 text-muted-foreground">({r.status})</span>
                </div>
                {r.reason ? <div className="text-muted-foreground">{r.reason}</div> : null}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => beginEdit(r)} data-testid={"clr-leave-edit-" + r.id}>Edit</Button>
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)} data-testid={"clr-leave-cancel-" + r.id}>Cancel</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(r.id)} data-testid={"clr-leave-delete-" + r.id}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
