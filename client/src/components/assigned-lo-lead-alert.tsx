import { useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BellRing, Clock3, Phone, X, Zap } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useDialpadCall } from "@/lib/dialpad-call";
import { activeLeadAlerts, collectLeadAlerts, feedWithFloor, leadAlertStorageKey, parseSeenLeadAlerts, renewAssignedLeadAlerts, leadAlertIsActionable, LEAD_ALERT_CHIME_INTERVAL_MS, LEAD_ALERT_SNOOZE_MS, type LoLeadAlert, type LoLeadFeed } from "@/lib/lead-alerts";
import { LO_NEW_LEAD_CLAIM_WINDOW_MS, loNewLeadSecondsLeft } from "@shared/lo-new-leads";
import { DailyReportGateActive } from "@/components/daily-report-gate";
import { EodLockGateActive } from "@/components/eod-lock-gate";
import { playShotgunChime } from "@/components/shotgun-offer-alert";
import { Button } from "@/components/ui/button";

/**
 * A new lead on one of this CLR's assigned loan officers, the moment
 * LeadVault sees it. It behaves like a Shotgun lead: a tap-to-call number,
 * a "got it" claim, and a three-minute window — a lead nobody claims goes to
 * the Shotgun rotation, where the twenty-second offer moves it on
 * (shared/lo-new-leads.ts).
 */
export function AssignedLoLeadAlert() {
  const { user } = useAuth();
  const prepareDialpadCall = useDialpadCall();
  const dailyBlocked = useContext(DailyReportGateActive);
  const eodBlocked = useContext(EodLockGateActive);
  const blocked = dailyBlocked || eodBlocked;
  const eligible = !!user && user.portal !== "lap" && user.portal !== "lop" && !user.isDemo;
  const storageKey = leadAlertStorageKey(user?.orgId ?? 1, user?.id ?? 0);
  const seen = useRef<string[]>([]);
  const snoozedUntil = useRef<Record<string, number>>({});
  const resolved = useRef(new Set<string>());
  const [queue, setQueue] = useState<LoLeadAlert[]>([]);
  const identity = useRef(storageKey);
  identity.current = storageKey;
  const [queueIdentity, setQueueIdentity] = useState(storageKey);
  const { data, dataUpdatedAt } = useQuery<LoLeadFeed>({
    // The popup asks for a small burst, separately from the page's one-lead card.
    // Including the identity prevents cached results crossing account switches.
    queryKey: ["/api/lo-newest-leads", "popups", user?.orgId, user?.id],
    queryFn: () => apiRequest("GET", "/api/lo-newest-leads?hours=72&per=5"),
    enabled: eligible && !blocked,
    // Five seconds: the server answers from a floor-wide cache it refreshes
    // every five seconds with ONE upstream call, so this poll is cheap and a
    // lead is on screen within ten seconds of landing rather than forty.
    refetchInterval: 5_000,
    // A CLR lives in Bonzo and Dialpad, not in C3. Without this the poll
    // PAUSES the moment C3 is not the front tab — which is nearly always — and
    // the first test on the floor (Skyler, 14 Sep 2026) showed exactly that:
    // heartbeats arriving, zero feed polls. The browser still throttles a
    // hidden tab, so the push notification the server sends is the real
    // guarantee; this keeps the on-screen card as current as the tab allows.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: 1,
  });

  // A keyed dock normally remounts us, but account/organization changes must
  // also be safe in isolation. Hide the previous queue during this render,
  // then reset every in-memory acknowledgement before processing the new feed.
  useEffect(() => {
    identity.current = storageKey;
    seen.current = [];
    snoozedUntil.current = {};
    resolved.current = new Set();
    setQueue([]);
    setQueueIdentity(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!eligible || blocked || !data?.configured || data.stale) return;
    let remembered: string[] = [];
    try { remembered = parseSeenLeadAlerts(localStorage.getItem(storageKey)); } catch {}
    const fetchedAt = Date.parse(data.fetchedAt ?? "");
    const now = Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
    // Your own loan officers, plus anything the floor has been opened up on.
    const feed = feedWithFloor(data);
    const result = collectLeadAlerts(feed, [...seen.current, ...remembered], now);
    seen.current = result.seen;
    try { localStorage.setItem(storageKey, JSON.stringify(result.seen)); } catch {}
    setQueue(current => renewAssignedLeadAlerts(
      [...activeLeadAlerts(current, feed, now), ...result.alerts], feed, now, snoozedUntil.current, resolved.current,
    ));
  }, [data, dataUpdatedAt, blocked, eligible, storageKey]);

  // Server clock for the countdown, as the Shotgun cards do.
  const [now, setNow] = useState(Date.now());
  const serverTime = Date.parse(data?.fetchedAt ?? "");
  const clockNow = Math.max(now, dataUpdatedAt) + (Number.isFinite(serverTime) ? serverTime - dataUpdatedAt : 0);
  const lead = queueIdentity === storageKey && eligible && !blocked && data?.configured && !data.stale ? queue.find(alert => leadAlertIsActionable(alert, clockNow)) : undefined;
  useEffect(() => { if (!lead) return; const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, [lead?.key]);
  // Original assignments deserve the same repeated chime as a Shotgun offer.
  // Seen storage is arrival history, not an acknowledgement. Stop on claim,
  // snooze, a reporting lock, or expiry even if a later network poll fails.
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!eligible || blocked || !lead) return;
    const deadline = Date.parse(lead.claim?.escalateAt ?? "") || Date.parse(lead.landedAt) + LO_NEW_LEAD_CLAIM_WINDOW_MS;
    const expiresAt = Date.now() + deadline - clockNow;
    const chime = () => { if (Date.now() < expiresAt) playShotgunChime(audioRef); };
    chime();
    const timer = lead.openToFloor ? null : setInterval(chime, LEAD_ALERT_CHIME_INTERVAL_MS);
    // Browsers may initially refuse audio. The next intentional interaction
    // can enable it; never steal focus or claim a lead on that person's behalf.
    const unlockAudio = () => { if (audioRef.current?.state === "suspended") chime(); };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [lead?.key, lead?.claim?.escalateAt, lead?.openToFloor, blocked, eligible]);
  useEffect(() => () => {
    const context = audioRef.current;
    audioRef.current = null;
    void context?.close().catch(() => {});
  }, []);

  const claim = useMutation({
    mutationFn: (externalId: string) => apiRequest("POST", "/api/lo-new-leads/claim", { externalId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/lo-newest-leads"] }),
  });
  useEffect(() => { claim.reset(); }, [lead?.key]);

  if (!eligible || blocked || !lead) return null;
  const removeFromQueue = () => setQueue(current => current.filter(row => row.key !== lead.key));
  // Only a successful server claim resolves assigned work. Closing the card
  // or opening the call list is a short snooze, never a permanent dismissal.
  const dismiss = () => {
    if (identity.current !== storageKey) return;
    resolved.current.add(lead.key);
    removeFromQueue();
  };
  const remindLater = () => {
    if (identity.current !== storageKey) return;
    if (!lead.openToFloor) snoozedUntil.current[lead.key] = clockNow + LEAD_ALERT_SNOOZE_MS;
    removeFromQueue();
  };
  const escalateAt = lead.claim?.escalateAt ?? new Date(Date.parse(lead.landedAt) + LO_NEW_LEAD_CLAIM_WINDOW_MS).toISOString();
  const left = loNewLeadSecondsLeft(escalateAt, clockNow);
  const mm = Math.floor(left / 60);
  const ss = String(Math.floor(left % 60)).padStart(2, "0");
  const callLead = () => {
    const dialpad = prepareDialpadCall(lead.phone || "");
    if (!dialpad) return;
    // The promise survives the card disappearing after the successful refetch;
    // per-mutation onSuccess callbacks can be dropped when a card unmounts.
    void claim.mutateAsync(lead.externalId).then(() => {
      if (identity.current !== storageKey) { dialpad.cancel(); return; }
      dialpad.complete();
      dismiss();
    }).catch(() => dialpad.cancel());
  };
  return (
    <section className={lead.openToFloor
      ? "pointer-events-auto rounded-2xl border-2 border-sky-500 bg-background p-4 shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-4"
      : "pointer-events-auto relative rounded-2xl border-2 border-orange-400 bg-slate-950 p-4 text-white shadow-[0_0_36px_rgba(251,146,60,0.38)] motion-safe:animate-in motion-safe:slide-in-from-left-4"} aria-label="New lead for an assigned loan officer" data-testid="assigned-lo-lead-alert">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {lead.openToFloor
            ? <p role="status" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-sky-700 dark:text-sky-400" data-testid="assigned-lo-lead-floor"><BellRing className="h-4 w-4 shrink-0" />Unclaimed lead — anyone can take it</p>
            : <p role="alert" className="flex items-center gap-2 text-base font-black uppercase tracking-wide text-orange-300"><BellRing className="h-5 w-5 shrink-0 motion-safe:animate-pulse" />Your LO has a new lead!</p>}
          <h2 className="mt-2 break-words text-lg font-bold">{lead.loName}</h2>
          <p className="mt-1 break-words text-sm">{lead.borrowerName || "A new borrower"}</p>
          <p className={`mt-1 break-words text-xs ${lead.openToFloor ? "text-muted-foreground" : "text-orange-100"}`}>{[lead.state, lead.source].filter(Boolean).join(" · ")}</p>
        </div>
        <Button variant="ghost" size="icon" className="-mr-2 -mt-2 shrink-0" aria-label={lead.openToFloor ? "Dismiss new lead alert" : "Remind me in 10 seconds"} title={lead.openToFloor ? "Dismiss" : "Remind me in 10 seconds"} onClick={remindLater}>
          {lead.openToFloor ? <X className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
        </Button>
      </div>
      {!lead.openToFloor && <p className="mt-3 rounded-lg border border-orange-400/40 bg-orange-400/10 px-3 py-2 text-sm font-semibold text-orange-100">This lead is for your assigned LO. Confirm now to keep it — viewing this alert does not claim it.</p>}
      {lead.phone && (
        <Button type="button" disabled={claim.isPending || left <= 0} data-testid="assigned-lo-lead-call" className="mt-3 flex h-auto w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700"
          onClick={callLead}>
          <Phone className="h-5 w-5" /> {claim.isPending ? "Claiming…" : `Call in Dialpad · ${lead.phone}`}
        </Button>
      )}
      {/* The last thirty seconds are a warning, not a countdown: louder, so
          nobody loses a lead they meant to claim without being told. */}
      <p className={left > 0 && left <= 30 ? "mt-2 flex items-center gap-1.5 rounded-lg border border-orange-400 bg-orange-50 px-2 py-1.5 text-sm font-bold text-orange-800 dark:bg-orange-950/40 dark:text-orange-200" : `mt-2 flex items-center gap-1.5 text-sm ${lead.openToFloor ? "text-muted-foreground" : "text-orange-100"}`} data-testid="assigned-lo-lead-countdown" role={left > 0 && left <= 30 ? "alert" : undefined}>
        <Zap className="h-3.5 w-3.5 shrink-0 text-orange-500" />
        <span className="min-w-0">{left > 0 && left <= 30 ? <>Going to Shotgun in <span className="tabular-nums">{Math.ceil(left)}s</span> — claim it now to keep it</>
          : left > 0 ? <>Goes to Shotgun in <span className="font-black tabular-nums">{mm}:{ss}</span> unless somebody claims it</> : "Going to Shotgun now"}</span>
      </p>
      {claim.isError && <p className="mt-2 text-sm text-red-600" role="alert">{(claim.error as any)?.message || "Could not claim it — it may already be taken."}</p>}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button size="sm" variant="outline" className={!lead.openToFloor ? "border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white" : undefined} asChild><Link href="/assignments" onClick={remindLater}>Call list <ArrowUpRight className="ml-1 h-4 w-4" /></Link></Button>
        <Button size="sm" className={!lead.openToFloor ? "bg-white font-bold text-slate-950 hover:bg-orange-100" : undefined} disabled={claim.isPending || left <= 0} onClick={() => claim.mutate(lead.externalId, { onSuccess: dismiss })} data-testid="assigned-lo-lead-claim">
          {claim.isPending ? "Claiming…" : "I RECEIVED THIS LEAD"}
        </Button>
      </div>
      {!lead.openToFloor && <p className="mt-2 text-xs text-orange-200/80">Reminders repeat until claimed or the timer ends. The clock button gives you a 10-second pause.</p>}
      {queue.length > 1 && <p className={`mt-2 text-xs ${lead.openToFloor ? "text-muted-foreground" : "text-orange-100"}`}>{queue.length - 1} more waiting</p>}
    </section>
  );
}
