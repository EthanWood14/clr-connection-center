import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plane, CheckCircle2, PauseCircle, ShieldAlert } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LoStatusBadge } from "@/components/lo-status-badge";

type Action = { status: "active" | "inactive" | "vacation"; lo: any } | null;

const ACTION_COPY: Record<string, { title: string; desc: string; verb: string }> = {
  active: {
    title: "Mark as Active?",
    desc: "They will be included in daily assignment generation again.",
    verb: "Mark Active",
  },
  inactive: {
    title: "Mark as Inactive?",
    desc: "They will be excluded from daily assignments until re-activated.",
    verb: "Mark Inactive",
  },
  vacation: {
    title: "Mark as On Vacation?",
    desc: "They will be excluded from daily assignments while on vacation.",
    verb: "Mark On Vacation",
  },
};

export default function LoVacation() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "vacation">("all");
  const [pending, setPending] = useState<Action>(null);

  const isAdmin = user?.role === "admin";

  const { data: los = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/loan-officers/${id}/status`, { status }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setPending(null);
      toast({ title: `Status updated to ${vars.status}` });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to update status",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  const filtered = useMemo(() => {
    return los
      .filter((lo: any) => lo.internalStatus !== "archived")
      .filter((lo: any) => {
        if (statusFilter === "all") return true;
        return (lo.internalStatus ?? "active") === statusFilter;
      })
      .filter((lo: any) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          lo.fullName.toLowerCase().includes(q) ||
          (lo.nmlsId ?? "").includes(search)
        );
      })
      .sort((a: any, b: any) => a.fullName.localeCompare(b.fullName));
  }, [los, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, inactive: 0, vacation: 0 };
    los.forEach((lo: any) => {
      const s = lo.internalStatus ?? "active";
      if (s === "active") c.active++;
      else if (s === "inactive") c.inactive++;
      else if (s === "vacation") c.vacation++;
    });
    return c;
  }, [los]);

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-[1100px] mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Plane className="w-5 h-5" />
            LO Status
          </h1>
          <p className="text-sm text-muted-foreground">
            {counts.active} active · {counts.inactive} inactive · {counts.vacation} on vacation
          </p>
        </div>
      </div>

      {!isAdmin && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-800">
          <CardContent className="p-3 flex items-center gap-2 text-sm text-amber-800 dark:text-amber-300">
            <ShieldAlert className="w-4 h-4" />
            Only administrators can change LO status. You can still view current statuses below.
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search by name or NMLS…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-vacation"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "active", "inactive", "vacation"] as const).map(s => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter(s)}
              data-testid={`button-filter-${s}`}
              className="capitalize"
            >
              {s === "vacation" ? "🏖 Vacation" : s}
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          No loan officers match your filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((lo: any) => {
            const status = lo.internalStatus ?? "active";
            const isInactive = status !== "active";
            return (
              <Card
                key={lo.id}
                className={`overflow-hidden ${isInactive ? "bg-muted/40" : ""}`}
                data-testid={`card-vacation-lo-${lo.id}`}
              >
                <CardContent className="p-3 flex items-center gap-3 flex-wrap">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">
                    {lo.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm" data-testid={`text-vacation-lo-${lo.id}`}>{lo.fullName}</span>
                      <LoStatusBadge status={status} />
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {lo.nmlsId ? `NMLS ${lo.nmlsId}` : "No NMLS on file"}
                      {lo.email ? ` · ${lo.email}` : ""}
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {status !== "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPending({ status: "active", lo })}
                          data-testid={`button-mark-active-${lo.id}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          Active
                        </Button>
                      )}
                      {status !== "inactive" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPending({ status: "inactive", lo })}
                          data-testid={`button-mark-inactive-${lo.id}`}
                        >
                          <PauseCircle className="w-3.5 h-3.5 mr-1" />
                          Inactive
                        </Button>
                      )}
                      {status !== "vacation" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPending({ status: "vacation", lo })}
                          data-testid={`button-mark-vacation-${lo.id}`}
                        >
                          <Plane className="w-3.5 h-3.5 mr-1" />
                          Vacation
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={v => !v && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending ? `${ACTION_COPY[pending.status].title.replace("?", "")} ${pending.lo.fullName}?` : ""}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? ACTION_COPY[pending.status].desc : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pending) return;
                mutation.mutate({ id: pending.lo.id, status: pending.status });
              }}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving…" : pending ? ACTION_COPY[pending.status].verb : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
