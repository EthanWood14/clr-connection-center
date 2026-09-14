import { useContext, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BellRing, X } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { activeLeadAlerts, collectLeadAlerts, leadAlertStorageKey, parseSeenLeadAlerts, type LoLeadAlert, type LoLeadFeed } from "@/lib/lead-alerts";
import { DailyReportGateActive } from "@/components/daily-report-gate";
import { EodLockGateActive } from "@/components/eod-lock-gate";
import { Button } from "@/components/ui/button";

export function AssignedLoLeadAlert() {
  const { user } = useAuth();
  const dailyBlocked = useContext(DailyReportGateActive);
  const eodBlocked = useContext(EodLockGateActive);
  const blocked = dailyBlocked || eodBlocked;
  const eligible = !!user && user.portal !== "lap" && user.portal !== "lop" && !user.isDemo;
  const storageKey = leadAlertStorageKey(user?.orgId ?? 1, user?.id ?? 0);
  const seen = useRef<string[]>([]);
  const [queue, setQueue] = useState<LoLeadAlert[]>([]);
  const { data, dataUpdatedAt } = useQuery<LoLeadFeed>({
    // The popup asks for a small burst, separately from the page's one-lead card.
    // Including the identity prevents cached results crossing account switches.
    queryKey: ["/api/lo-newest-leads", "popups", user?.orgId, user?.id],
    queryFn: () => apiRequest("GET", "/api/lo-newest-leads?hours=72&per=5"),
    enabled: eligible && !blocked,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  });

  useEffect(() => {
    if (!eligible || blocked || !data?.configured || data.stale) return;
    let remembered: string[] = [];
    try { remembered = parseSeenLeadAlerts(localStorage.getItem(storageKey)); } catch {}
    const fetchedAt = Date.parse(data.fetchedAt ?? "");
    const now = Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
    const result = collectLeadAlerts(data, [...seen.current, ...remembered], now);
    seen.current = result.seen;
    try { localStorage.setItem(storageKey, JSON.stringify(result.seen)); } catch {}
    setQueue(current => [...activeLeadAlerts(current, data, now), ...result.alerts].slice(-40));
  }, [data, dataUpdatedAt, blocked, eligible, storageKey]);

  const lead = queue[0];
  if (!eligible || blocked || !lead) return null;
  const dismiss = () => setQueue(current => current.filter(row => row.key !== lead.key));
  return (
    <section className="pointer-events-auto rounded-2xl border-2 border-emerald-500 bg-background p-4 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-4" aria-label="New lead for your assigned loan officer" data-testid="assigned-lo-lead-popup">
      <div className="flex items-start justify-between gap-3">
        <div role="status" aria-live="polite" className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400"><BellRing className="h-4 w-4 shrink-0" />New lead for your LO</p>
          <h2 className="mt-2 break-words text-lg font-bold">{lead.loName}</h2>
          <p className="mt-1 break-words text-sm">{lead.borrowerName || "A new borrower"}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{[lead.state, lead.source].filter(Boolean).join(" · ")}</p>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-2 shrink-0" aria-label="Dismiss new lead alert" onClick={dismiss}><X className="h-4 w-4" /></Button>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{queue.length > 1 ? `${queue.length - 1} more waiting` : "Live from LeadVault"}</span>
        <Button size="sm" asChild><Link href="/assignments" onClick={dismiss}>View call list <ArrowUpRight className="ml-1 h-4 w-4" /></Link></Button>
      </div>
    </section>
  );
}
