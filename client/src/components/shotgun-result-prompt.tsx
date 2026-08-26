import { useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Mail, MapPin, Phone } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { DailyReportGateActive } from "@/components/daily-report-gate";
import { EodLockGateActive } from "@/components/eod-lock-gate";
import { ShotgunResultCard } from "@/components/shotgun-result-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ShotgunPayload } from "@/pages/shotgun";

const REMIND_MS = 10 * 60_000;

function savedSnooze(key: string) {
  if (!key) return 0;
  try {
    const saved = Number(window.localStorage.getItem(key) ?? 0);
    return Number.isFinite(saved) ? saved : 0;
  } catch { return 0; }
}

export function ShotgunResultPrompt() {
  const { user } = useAuth();
  const eligible = !!user?.isClr;
  const blocked = useContext(DailyReportGateActive) || useContext(EodLockGateActive);
  const { data } = useQuery<ShotgunPayload>({
    queryKey: ["/api/shotgun"],
    enabled: eligible && !blocked,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const claimed = useMemo(() => blocked ? null : data?.leads
    .filter((lead) => lead.status === "claimed" && lead.currentAssigneeId === user?.id)
    .sort((a, b) => String(a.claimedAt).localeCompare(String(b.claimedAt)))[0] ?? null, [blocked, data?.leads, user?.id]);
  const hasLiveOffer = !!data?.leads.some((lead) => lead.status === "offered" && lead.currentAssigneeId === user?.id);
  const [now, setNow] = useState(Date.now());
  const snoozeKey = claimed && user ? `c3-shotgun-result-snooze:${user.id}:${claimed.id}` : "";
  const [snoozeOverride, setSnoozeOverride] = useState({ key: "", until: 0 });
  const snoozedUntil = snoozeOverride.key === snoozeKey ? snoozeOverride.until : savedSnooze(snoozeKey);

  useEffect(() => {
    if (!claimed || snoozedUntil <= Date.now()) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(snoozedUntil - Date.now() + 50, REMIND_MS));
    return () => window.clearTimeout(timer);
  }, [claimed?.id, snoozedUntil]);

  const snooze = () => {
    if (!snoozeKey) return;
    const until = Date.now() + REMIND_MS;
    try { window.localStorage.setItem(snoozeKey, String(until)); } catch {}
    setSnoozeOverride({ key: snoozeKey, until });
  };
  const complete = () => {
    try { if (snoozeKey) window.localStorage.removeItem(snoozeKey); } catch {}
    setSnoozeOverride({ key: snoozeKey, until: 0 });
    setNow(Date.now());
  };
  const open = !!claimed && !blocked && !hasLiveOffer && now >= snoozedUntil;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) snooze(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-2 border-orange-300 sm:max-w-2xl" data-testid="shotgun-result-prompt">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-orange-700"><ClipboardCheck className="h-6 w-6" /><span className="text-xs font-black uppercase tracking-widest">Result required</span></div>
          <DialogTitle className="text-2xl">Log your Shotgun result</DialogTitle>
          <DialogDescription>This lead stays assigned to you until you record what happened. Finish it here or ask C3 to remind you in 10 minutes.</DialogDescription>
        </DialogHeader>
        {claimed && (
          <div>
            <div className="rounded-2xl border bg-orange-50/70 p-4 dark:bg-orange-950/15">
              <p className="text-xl font-black">{claimed.leadName}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {claimed.phone && <span className="flex items-center gap-1.5"><Phone className="h-4 w-4" />{claimed.phone}</span>}
                {claimed.email && <span className="flex items-center gap-1.5"><Mail className="h-4 w-4" />{claimed.email}</span>}
                {claimed.stateCode && <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" />{claimed.stateCode}</span>}
              </div>
              {claimed.managerNotes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground"><strong>Manager context:</strong> {claimed.managerNotes}</p>}
            </div>
            <ShotgunResultCard key={claimed.id} lead={claimed} onCompleted={complete} />
            <Button type="button" variant="ghost" className="mt-2 w-full text-muted-foreground" onClick={snooze}>Keep working — remind me in 10 minutes</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
