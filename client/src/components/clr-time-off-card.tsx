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
type DayKind = LeaveKind | "other_work";
const DAY_LABELS = { ...LEAVE_KIND_LABELS, other_work: "Working on other things" };

type TimeOffRow = {
  id: number;
  userId: number;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  dayPortion: "full" | "half" | "work";
  leaveKind?: DayKind;
};

const KINDS: DayKind[] = ["half", "pto", "other_work", "sick_documented", "sick_undocumented"];

export function ClrTimeOffCard({ userId, clrName }: { userId: number; clrName: string }) {
  const { toast } = useToast();
  const [kind, setKind] = useState<DayKind>("half");
  const [editingOtherWork, setEditingOtherWork] = useState(false);
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

  const { data: otherWork = [] } = useQuery<TimeOffRow[]>({ queryKey: ["/api/clr-other-work"] });
  const visible = useMemo(
    () => [...rows, ...otherWork.filter(r => r.userId === userId)].filter((r) => r.status !== "cancelled" && r.status !== "canceled" && r.status !== "denied"),
    [rows, otherWork, userId],
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
        reason: reason.trim() || DAY_LABELS[kind],
        onBehalfOf: userId,
      };
      if (kind === "other_work") {
        return apiRequest(editingId != null ? "PATCH" : "POST", `/api/clr-other-work${editingId != null ? `/${editingId}` : ""}`, { ...body, userId });
      }
      if (editingId != null) {
        return apiRequest("PATCH", `/api/time-off/${editingId}`, body);
      }
      return apiRequest("POST", "/api/time-off", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      toast({
        title: editingId ? "Time off updated" : "Time off recorded",
        description: kind === "other_work" ? `${clrName} is working; these dates are excluded from call and transfer goal days.` : `${DAY_LABELS[kind]} for ${clrName} is approved and updates the scorecard.`,
      });
      setEditingId(null);
      setReason("");
    },
    onError: (e: any) => toast({ title: "Could not save time off", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const cancel = useMutation({
    mutationFn: (row: TimeOffRow) => row.leaveKind === "other_work" ? apiRequest("DELETE", `/api/clr-other-work/${row.id}`) : apiRequest("PATCH", `/api/time-off/${row.id}`, { status: "cancelled" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      toast({ title: "Time off cancelled" });
    },
    onError: (e: any) => toast({ title: "Could not cancel", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (row: TimeOffRow) => apiRequest("DELETE", `/api/${row.leaveKind === "other_work" ? "clr-other-work" : "time-off"}/${row.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/time-off"] });
      toast({ title: "Time off removed" });
    },
    onError: (e: any) => toast({ title: "Could not remove", description: String(e?.message ?? e), variant: "destructive" }),
  });

  function beginEdit(row: TimeOffRow) {
    setEditingId(row.id);
    setKind(row.leaveKind || (row.dayPortion === "half" ? "half" : "pto"));
    setEditingOtherWork(row.leaveKind === "other_work");
    setStartDate(row.startDate);
    setEndDate(row.endDate);
    setReason(row.reason ?? "");
  }

  return (
    <Card data-testid="clr-time-off-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Palmtree className="w-4 h-4" /> Day status
        </CardTitle>
        <CardDescription>
          Record time off or other work for {clrName}. Manager entries apply immediately.
          Other work keeps attendance unchanged and excludes the dates from call and transfer goal days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              disabled={editingId != null && editingOtherWork !== (k === "other_work")}
              onClick={() => setKind(k)}
              className={"rounded-md border px-2.5 py-1 text-xs transition-colors "
                + (kind === k ? "border-primary bg-primary/10 font-semibold text-primary" : "hover:bg-muted")}
              data-testid={"clr-leave-kind-" + k}
            >
              {DAY_LABELS[k]}
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
            <div key={`${r.leaveKind}:${r.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs" data-testid={"clr-leave-row-" + r.id}>
              <div className="space-y-0.5">
                <div className="font-medium">
                  {DAY_LABELS[r.leaveKind || (r.dayPortion === "half" ? "half" : "pto")]}
                  {" · "}{r.startDate}{r.endDate !== r.startDate ? ` → ${r.endDate}` : ""}
                  <span className="ml-1.5 text-muted-foreground">({r.status})</span>
                </div>
                {r.reason ? <div className="text-muted-foreground">{r.reason}</div> : null}
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => beginEdit(r)} data-testid={"clr-leave-edit-" + r.id}>Edit</Button>
                <Button size="sm" variant="outline" className="h-7 px-2" disabled={cancel.isPending} onClick={() => cancel.mutate(r)} data-testid={"clr-leave-cancel-" + r.id}>Cancel</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" disabled={remove.isPending} onClick={() => remove.mutate(r)} data-testid={"clr-leave-delete-" + r.id}>Remove</Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
