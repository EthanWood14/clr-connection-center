import { useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * A pleasant two-note chime (E5 → A5, soft sine with a fast decay) so an offer
 * is heard, not just seen. Web Audio, no asset to load; browsers that refuse
 * audio before a user gesture just stay silent — the popup still shows.
 */
function playShotgunChime(ctxRef: { current: AudioContext | null }) {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!ctxRef.current) ctxRef.current = new Ctx();
    const ctx = ctxRef.current;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const note = (freq: number, at: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, ctx.currentTime + at);
      gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + 0.6);
    };
    note(659.25, 0);      // E5
    note(880.0, 0.18);    // A5
  } catch {}
}
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, Mail, MapPin, Phone, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { DailyReportGateActive } from "@/components/daily-report-gate";
import { EodLockGateActive } from "@/components/eod-lock-gate";
import { Button } from "@/components/ui/button";
import type { ShotgunPayload } from "@/pages/shotgun";

export function ShotgunOfferAlert() {
  const { user } = useAuth();
  const eligible = !!user?.isClr;
  const dailyBlocked = useContext(DailyReportGateActive);
  const eodBlocked = useContext(EodLockGateActive);
  const blocked = dailyBlocked || eodBlocked;
  // Ready CLRs check quickly enough to retain almost the whole 20-second
  // window. Opted-out CLRs check much less often, avoiding the traffic spike a
  // universal one-second poll caused. Window focus also refreshes immediately.
  const { data, dataUpdatedAt } = useQuery<ShotgunPayload>({
    queryKey: ["/api/shotgun"],
    enabled: eligible && !blocked,
    refetchInterval: (query) => (query.state.data as ShotgunPayload | undefined)?.isReady ? 2_000 : 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  // The server guarantees one live offer per CLR. Sorting is defensive: if old
  // production data ever violates that invariant, the earliest deadline is
  // still shown instead of an arbitrary hidden offer.
  const [now, setNow] = useState(Date.now());
  // Use the server clock for the deadline, even when a laptop clock is wrong.
  const serverTime = Date.parse(data?.serverNow ?? "");
  const clockNow = Math.max(now, dataUpdatedAt) + (Number.isFinite(serverTime) ? serverTime - dataUpdatedAt : 0);
  const offered = useMemo(() => blocked ? null : data?.leads
    .filter((lead) => lead.status === "offered" && lead.currentAssigneeId === user?.id && Date.parse(lead.offerExpiresAt ?? "") > clockNow)
    .sort((a, b) => String(a.offerExpiresAt).localeCompare(String(b.offerExpiresAt)))[0] ?? null, [blocked, data?.leads, user?.id, clockNow]);
  useEffect(() => { if (!offered) return; const timer = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(timer); }, [offered?.id]);
  useEffect(() => {
    // Shotgun is ON by default for every CLR: a CLR with C3 open is in the
    // rotation without having to press anything. Whether they are actually in
    // it is the SERVER's decision — this only reports that C3 is still open, so
    // it must send `heartbeat`, never `ready`. Gating this on a localStorage
    // opt-out could not work: the effect does not re-run when that value
    // changes, so the interval kept beating `ready: true` and undid the opt-out
    // within ten seconds — and localStorage is per-device, so opting out on a
    // laptop left a phone quietly re-enrolling them.
    if (!eligible || !user) return;
    if (blocked) {
      void apiRequest("POST", "/api/shotgun/readiness", { heartbeat: true, blocked: true }).catch(() => {});
      return;
    }
    // No invalidate on each beat — the poll above already refetches, and the
    // extra fetch per heartbeat doubled the request rate for no new data.
    const beat = () => apiRequest("POST", "/api/shotgun/readiness", { heartbeat: true }).catch(() => {});
    void beat(); const timer = setInterval(beat, 10_000); return () => clearInterval(timer);
  }, [blocked, eligible, user?.id]);
  const confirm = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/confirm`, {}), onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }) });
  const deny = useMutation({ mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/deny`, {}), onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }) });
  useEffect(() => { confirm.reset(); deny.reset(); }, [offered?.id, offered?.offerExpiresAt]);
  // Chime on arrival, then a gentle repeat while the offer is up. Denying or
  // claiming stops it. Expired offers never keep chiming during a failed poll.
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!offered) return;
    playShotgunChime(audioRef);
    const timer = setInterval(() => playShotgunChime(audioRef), 2_500);
    return () => clearInterval(timer);
  }, [offered?.id, offered?.offerExpiresAt]);
  const left = offered?.offerExpiresAt ? Math.max(0, (new Date(offered.offerExpiresAt).getTime() - clockNow) / 1000) : 0;
  if (!offered) return null;
  return (
    <section aria-label="Shotgun lead offer" data-testid="shotgun-offer-popup" className="pointer-events-auto relative rounded-2xl border-2 border-orange-400 bg-slate-950 p-4 text-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-4">
      <div className="flex items-center justify-between gap-2">
        <h2 role="alert" className="flex items-center gap-2 text-base font-black text-orange-300"><Zap className="h-5 w-5" />SHOTGUN LEAD!</h2>
        <span aria-label="Time remaining" className="flex items-center gap-1 text-lg font-bold tabular-nums"><Clock3 className="h-4 w-4" />{left.toFixed(1)}s</span>
      </div>
      <p className="mt-1 text-xs text-orange-100">Confirm before C3 sends it to the next ready CLR.</p>
      <div className="my-3 max-h-40 space-y-1 overflow-y-auto rounded-xl bg-white/10 p-3 text-sm">
        <p className="break-words text-lg font-bold">{offered.leadName}</p>
        {offered.phone && <p className="flex items-center gap-2"><Phone className="h-4 w-4 shrink-0" />{offered.phone}</p>}
        {offered.email && <p className="flex items-center gap-2 break-all"><Mail className="h-4 w-4 shrink-0" />{offered.email}</p>}
        {offered.stateCode && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0" />{offered.stateCode}</p>}
        {offered.source && <p className="break-words text-orange-100">Source: {offered.source}</p>}
        {offered.managerNotes && <p className="whitespace-pre-wrap break-words text-orange-100"><strong>Manager context:</strong> {offered.managerNotes}</p>}
      </div>
      {confirm.isError && <p className="mb-2 text-sm text-red-200" role="alert" data-testid="shotgun-confirm-error">{(confirm.error as any)?.message || "This lead already moved. The board will update automatically."}</p>}
      {deny.isError && <p className="mb-2 text-sm text-red-200" role="alert" data-testid="shotgun-deny-error">{(deny.error as any)?.message || "Could not pass this lead. Please try again."}</p>}
      <Button className="w-full bg-white font-bold text-slate-950 hover:bg-orange-100" disabled={confirm.isPending || deny.isPending || left <= 0} onClick={() => confirm.mutate(offered.id)}>{confirm.isPending ? "CONFIRMING…" : "I RECEIVED THIS LEAD"}</Button>
      <Button size="sm" variant="ghost" className="mt-1 w-full text-orange-100 hover:bg-white/10 hover:text-white" disabled={deny.isPending || confirm.isPending || left <= 0} onClick={() => deny.mutate(offered.id)} data-testid="shotgun-deny">{deny.isPending ? "Passing…" : "Pass — send to the next CLR"}</Button>
      <p className="mt-1 text-[11px] text-orange-200/80">Passing keeps you in the rotation. Letting the timer run out takes you out of it.</p>
    </section>
  );
}
