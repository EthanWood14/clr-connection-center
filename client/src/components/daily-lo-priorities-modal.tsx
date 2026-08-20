import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Flag, ListOrdered, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { businessTodayInTz } from "@/lib/business-day";

const NAVY = "#1A2B4A";
const GOLD = "#C49A3C";

type DailyLoPrioritiesModalProps = {
  userId: number;
  orgId: number;
  timezone?: string;
  onDismiss: () => void;
};

export function dailyLoPrioritiesStorageKey(userId: number, orgId: number, businessDate: string) {
  return `c3:daily-lo-priorities:${orgId}:${userId}:${businessDate}`;
}

function isAvailableLoanOfficer(lo: any, now = Date.now()) {
  const status = String(lo?.internalStatus ?? lo?.internal_status ?? "active").toLowerCase();
  if (status !== "active") return false;
  const snoozeUntil = lo?.snoozeUntil ?? lo?.snooze_until;
  return !snoozeUntil || new Date(snoozeUntil).getTime() <= now;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map(part => part[0]).join("").slice(0, 2).toUpperCase() || "LO";
}

export function DailyLoPrioritiesModal({ userId, orgId, timezone, onDismiss }: DailyLoPrioritiesModalProps) {
  const businessDate = businessTodayInTz(timezone);
  const loanOfficersQuery = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });
  const assignmentsQuery = useQuery<any[]>({ queryKey: ["/api/assignments/today"] });

  const priorityLos = (loanOfficersQuery.data ?? [])
    .filter((lo: any) => !!(lo.needsTransfers ?? lo.needs_transfers) && isAvailableLoanOfficer(lo))
    .sort((a: any, b: any) => String(a.fullName ?? a.full_name ?? "").localeCompare(String(b.fullName ?? b.full_name ?? "")));
  const dailyAssignments = [...(assignmentsQuery.data ?? [])]
    .sort((a: any, b: any) => Number(a.assistantRank ?? a.assistant_rank ?? 9999) - Number(b.assistantRank ?? b.assistant_rank ?? 9999));
  const priorityIds = new Set(priorityLos.map((lo: any) => Number(lo.id)));
  const isLoading = loanOfficersQuery.isLoading || assignmentsQuery.isLoading;
  const hasError = loanOfficersQuery.isError || assignmentsQuery.isError;

  const dismiss = () => {
    try {
      localStorage.setItem(dailyLoPrioritiesStorageKey(userId, orgId, businessDate), "seen");
    } catch {
      // Storage is a convenience, not an authorization boundary. Continue even
      // when a locked-down browser refuses localStorage.
    }
    onDismiss();
  };

  const openAssignments = () => {
    dismiss();
    window.location.hash = "#/assignments";
  };

  const readableDate = new Date(`${businessDate}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/85 px-3 py-5 backdrop-blur-sm" data-testid="daily-lo-priorities-modal">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0F182D] shadow-2xl">
        <div className="border-b border-white/10 px-5 py-5 sm:px-7">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: "rgba(196, 154, 60, 0.16)" }}>
              <Flag className="h-5 w-5" style={{ color: GOLD }} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: GOLD }}>Start here today</p>
              <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">Today&apos;s prioritized loan officers</h2>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-white/55">
                <CalendarDays className="h-3.5 w-3.5" /> {readableDate}
              </p>
            </div>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-6 px-5 py-5 sm:px-7">
            {isLoading ? (
              <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading today&apos;s priorities…
              </div>
            ) : hasError ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 p-4 text-sm text-amber-100">
                C3 could not load the latest priorities. Open Daily Assignments after entering C3 to try again.
              </div>
            ) : (
              <>
                <section data-testid="team-priority-los">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                        <Users className="h-4 w-4" style={{ color: GOLD }} /> Team priorities
                      </h3>
                      <p className="mt-0.5 text-xs text-white/45">Loan officers currently marked as needing transfers</p>
                    </div>
                    <Badge className="border-amber-300/20 bg-amber-400/15 text-amber-200">{priorityLos.length}</Badge>
                  </div>
                  {priorityLos.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {priorityLos.map((lo: any) => {
                        const name = String(lo.fullName ?? lo.full_name ?? "Loan officer");
                        return (
                          <div key={lo.id} className="flex items-center gap-3 rounded-xl border border-amber-300/15 bg-amber-400/[0.07] px-3 py-2.5" data-testid={`daily-priority-lo-${lo.id}`}>
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-300/15 text-xs font-bold text-amber-200">{initials(name)}</div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{name}</p>
                              <p className="text-[11px] font-medium text-amber-200/75">Needs transfers today</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">No loan officers are marked as needing transfers right now.</p>
                  )}
                </section>

                <section data-testid="my-daily-lo-order">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="flex items-center gap-2 text-sm font-bold text-white">
                        <ListOrdered className="h-4 w-4 text-sky-300" /> Your daily LO order
                      </h3>
                      <p className="mt-0.5 text-xs text-white/45">Work the ranked list from top to bottom</p>
                    </div>
                    <Badge className="border-sky-300/20 bg-sky-400/15 text-sky-200">{dailyAssignments.length}</Badge>
                  </div>
                  {dailyAssignments.length > 0 ? (
                    <div className="space-y-1.5">
                      {dailyAssignments.map((assignment: any, index: number) => {
                        const lo = assignment.lo ?? {};
                        const name = String(lo.fullName ?? lo.full_name ?? "Loan officer");
                        const rank = Number(assignment.assistantRank ?? assignment.assistant_rank ?? index + 1);
                        const isTeamPriority = priorityIds.has(Number(assignment.loId ?? assignment.lo_id ?? lo.id));
                        return (
                          <div key={assignment.id ?? `${name}-${rank}`} className="flex items-center gap-3 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-2" data-testid={`daily-assignment-priority-${rank}`}>
                            <div className="w-7 shrink-0 text-right font-mono text-xs font-bold text-white/45">#{rank}</div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-white">{name}</p>
                            </div>
                            {isTeamPriority && <Badge className="border-amber-300/20 bg-amber-400/15 text-[10px] text-amber-200">Priority</Badge>}
                            {lo.priorityTier === 1 && <Badge className="border-yellow-300/20 bg-yellow-400/15 text-[10px] text-yellow-200">VIP</Badge>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white/50">Your daily assignments have not been generated yet.</p>
                  )}
                </section>
              </>
            )}
          </div>
        </ScrollArea>

        <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <Button variant="ghost" onClick={dismiss} className="text-white/60 hover:text-white" disabled={isLoading}>
            Continue to C3
          </Button>
          <Button onClick={openAssignments} className="font-semibold" style={{ backgroundColor: GOLD, color: NAVY }} disabled={isLoading} data-testid="open-daily-assignments">
            Open daily assignments <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
