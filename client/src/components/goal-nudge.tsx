/**
 * GoalNudge — prompts every user who hasn't set a weekly goal to set one.
 *
 * Logic:
 * - Shows only for logged-in, non-viewer users whose effective weekly goals
 *   (admin-set clr_goals override OR their own profile goals) are all zero.
 * - "Later" snoozes for 3 days; it keeps coming back until a goal is set.
 * - Saving uses PUT /api/my-goals (the user's own weekly goals) and the
 *   dashboard Goal Stripe picks it up immediately.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Target, X, Loader2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";

const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const snoozeKey = (uid: number) => `clr_goal_nudge_snoozed_until_${uid}`;

export function GoalNudge() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [calls, setCalls] = useState("");
  const [transfers, setTransfers] = useState("");
  const [appointments, setAppointments] = useState("");

  const uid = user?.id ?? 0;
  const eligible = !!user && user.role !== "viewer" && !(user as any).mustChangePassword;

  const { data: goalData, isLoading } = useQuery<any>({
    queryKey: ["/api/goals", uid],
    queryFn: () => fetch(`/api/goals/${uid}`, { credentials: "include" }).then(r => r.json()),
    enabled: eligible && uid > 0,
    staleTime: 60_000,
  });

  const hasGoal = !!goalData?.goals && (
    Number(goalData.goals.calls ?? 0) > 0 ||
    Number(goalData.goals.transfers ?? 0) > 0 ||
    Number(goalData.goals.appointments ?? 0) > 0
  );

  useEffect(() => {
    if (!eligible || isLoading || hasGoal || !goalData) return;
    try {
      const until = parseInt(localStorage.getItem(snoozeKey(uid)) ?? "0", 10);
      if (Date.now() < until) return;
    } catch {}
    const t = setTimeout(() => setVisible(true), 1500);
    return () => clearTimeout(t);
  }, [eligible, isLoading, hasGoal, goalData, uid]);

  const save = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/my-goals", {
      goalCallsWeekly: parseInt(calls) || 0,
      goalTransfersWeekly: parseInt(transfers) || 0,
      goalAppointmentsWeekly: parseInt(appointments) || 0,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/goals", uid] });
      qc.invalidateQueries({ queryKey: ["/api/my-report", "week"] });
      toast({ title: "Goal set! 🎯", description: "Track your progress on the dashboard and in My Report." });
      setVisible(false);
    },
    onError: (e: any) => toast({ title: "Could not save goal", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  function snooze() {
    try { localStorage.setItem(snoozeKey(uid), String(Date.now() + SNOOZE_MS)); } catch {}
    setVisible(false);
  }

  const anyEntered = (parseInt(calls) || 0) + (parseInt(transfers) || 0) + (parseInt(appointments) || 0) > 0;

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed bottom-20 left-0 right-0 z-[9997] flex justify-center px-4 pointer-events-none
                 md:bottom-6 md:left-auto md:right-6 md:max-w-sm"
    >
      <div className="w-full pointer-events-auto rounded-xl border border-border bg-background/95 backdrop-blur-md shadow-2xl overflow-hidden">
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-primary" />

        <div className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Target className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">Set your weekly goal</p>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                You haven't set a goal yet. Pick your weekly targets — progress shows on your dashboard, and the whole team celebrates when you hit them.
              </p>
            </div>
            <button
              onClick={snooze}
              aria-label="Remind me later"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded flex-shrink-0 -mt-0.5 -mr-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Inline goal inputs */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Calls", val: calls, set: setCalls, ph: "150" },
              { label: "Transfers", val: transfers, set: setTransfers, ph: "10" },
              { label: "Appts", val: appointments, set: setAppointments, ph: "5" },
            ].map(f => (
              <div key={f.label}>
                <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{f.label}/wk</label>
                <Input
                  type="number" min={0} inputMode="numeric" placeholder={f.ph}
                  value={f.val} onChange={e => f.set(e.target.value)}
                  className="h-8 text-sm"
                  data-testid={"goal-nudge-" + f.label.toLowerCase()}
                />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <Button
              size="sm"
              className="h-8 text-xs gap-1.5 flex-1"
              onClick={() => save.mutate()}
              disabled={save.isPending || !anyEntered}
              data-testid="button-goal-nudge-save"
            >
              {save.isPending ? (
                <>Saving… <Loader2 className="w-3 h-3 animate-spin" /></>
              ) : (
                <>Set my goal <Check className="w-3 h-3" /></>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              onClick={snooze}
              data-testid="button-goal-nudge-later"
            >
              Later
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
