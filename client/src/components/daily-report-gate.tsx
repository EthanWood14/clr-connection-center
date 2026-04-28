import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardList, Coffee } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OutcomeBreakdown {
  transfer: number;
  appointment: number;
  fell_through: number;
  callback_requested: number;
  deferral: number;
  future_contact: number;
  no_answer: number;
  total: number;
}

interface CheckResult {
  hasLog: boolean;
  date: string;
  exempt?: boolean;
  outcomes?: OutcomeBreakdown;
  callsMadeLogged?: number;
}

const OUTCOME_LABELS: Array<{ label: string; keys: Array<keyof OutcomeBreakdown> }> = [
  { label: "Transfers",            keys: ["transfer"] },
  { label: "Appointments",         keys: ["appointment"] },
  { label: "Callbacks & Deferrals", keys: ["callback_requested", "deferral"] },
  { label: "Future Contacts",      keys: ["future_contact"] },
  { label: "Fell Throughs",        keys: ["fell_through"] },
  { label: "No Answers",           keys: ["no_answer"] },
];

function formatDate(dateStr: string) {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export function DailyReportGate({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [callsMade, setCallsMade] = useState("");
  const [notes, setNotes] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Admins and non-CLRs are exempt from the daily report gate.
  const isClr = !!(user && (user as any).isClr && user.role !== "admin");

  const { data: checkData, isLoading: checkLoading } = useQuery<CheckResult>({
    queryKey: ["/api/call-logs/check-previous-day"],
    enabled: !!user && !authLoading && isClr,
    staleTime: 60 * 1000, // 1 min — fresh enough across navigation, not every request
    retry: false,
  });

  const submitLog = useMutation({
    mutationFn: (payload: { callsMade: number; notes: string; didNotWork: boolean }) =>
      apiRequest("POST", "/api/call-logs", {
        logDate: checkData!.date,
        assistantId: user!.id,
        callsMade: payload.callsMade,
        notes: payload.notes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/call-logs/check-previous-day"] });
      setSubmitted(true);
      toast({ title: "Report submitted", description: "You're all set for today." });
    },
    onError: () => {
      toast({ title: "Failed to submit report", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    const count = parseInt(callsMade);
    if (isNaN(count) || count < 0) {
      toast({ title: "Enter a valid call count", variant: "destructive" });
      return;
    }
    submitLog.mutate({ callsMade: count, notes, didNotWork: false });
  };

  const handleDidNotWork = () => {
    submitLog.mutate({
      callsMade: 0,
      notes: "Did Not Work",
      didNotWork: true,
    });
  };

  // While loading auth or check, just show children (no flash)
  if (authLoading || checkLoading || !user) return <>{children}</>;

  // Admins / non-CLR users never see the gate.
  if (!isClr) return <>{children}</>;

  // Skip the gate entirely for brand-new users (they've never seen the intro yet)
  if (!user.hasSeenIntro) return <>{children}</>;

  // If the server says the user is exempt, already has a log, or was just submitted, show app normally.
  const gated = !submitted && checkData !== undefined && !checkData.exempt && !checkData.hasLog;

  if (!gated) return <>{children}</>;

  const todayLabel = checkData ? formatDate(checkData.date) : "today";

  return (
    <>
      {/* Blurred background */}
      <div className="pointer-events-none select-none blur-sm opacity-40 overflow-hidden h-screen">
        {children}
      </div>

      <Dialog open={true}>
        <DialogContent
          className="sm:max-w-md [&>button]:hidden"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <ClipboardList className="w-5 h-5" />
              </div>
              <DialogTitle className="text-lg">Daily Report Required</DialogTitle>
            </div>
            <DialogDescription className="text-sm text-muted-foreground">
              Please file your call report for{" "}
              <span className="font-medium text-foreground">{todayLabel}</span>{" "}
              before using the system.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {checkData?.outcomes && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                  Today's logged outcomes
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {OUTCOME_LABELS.map(({ label, keys }) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium tabular-nums">
                        {keys.reduce((sum, k) => sum + (checkData.outcomes![k] ?? 0), 0)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t flex items-center justify-between text-xs">
                  <span className="font-semibold">Total Logged</span>
                  <span className="font-semibold tabular-nums">{checkData.outcomes.total}</span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="calls-made">Calls Made</Label>
              <Input
                id="calls-made"
                type="number"
                min={0}
                placeholder="e.g. 45"
                value={callsMade}
                onChange={(e) => setCallsMade(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                id="notes"
                placeholder="Any notes about your day…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <Button
                onClick={handleSubmit}
                disabled={submitLog.isPending || !callsMade}
                className="w-full"
              >
                {submitLog.isPending ? "Submitting…" : "Submit Report"}
              </Button>

              <Button
                variant="outline"
                onClick={handleDidNotWork}
                disabled={submitLog.isPending}
                className="w-full text-muted-foreground"
              >
                <Coffee className="w-4 h-4 mr-2" />
                Did Not Work That Day
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
