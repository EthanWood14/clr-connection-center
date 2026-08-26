import { useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * A pleasant two-note chime (E5 → A5, soft sine with a fast decay) so an offer
 * is heard, not just seen. Web Audio, no asset to load; browsers that refuse
 * audio before a user gesture just stay silent — the modal still shows.
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ShotgunPayload } from "@/pages/shotgun";

export function ShotgunOfferAlert() {
  const { user } = useAuth();
  const eligible = !!user?.isClr;
  const blocked = useContext(DailyReportGateActive) || useContext(EodLockGateActive);
  // Ready CLRs check quickly enough to retain almost the whole 20-second
  // window. Opted-out CLRs check much less often, avoiding the traffic spike a
  // universal one-second poll caused. Window focus also refreshes immediately.
  const { data } = useQuery<ShotgunPayload>({
    queryKey: ["/api/shotgun"],
    enabled: eligible && !blocked,
    refetchInterval: (query) => (query.state.data as ShotgunPayload | undefined)?.isReady ? 2_000 : 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  // The server guarantees one live offer per CLR. Sorting is defensive: if old
  // production data ever violates that invariant, the earliest deadline is
  // still shown instead of an arbitrary hidden offer.
  const offered = useMemo(() => blocked ? null : data?.leads
    .filter((lead) => lead.status === "offered" && lead.currentAssigneeId === user?.id)
    .sort((a, b) => String(a.offerExpiresAt).localeCompare(String(b.offerExpiresAt)))[0] ?? null, [blocked, data?.leads, user?.id]);
  const [now, setNow] = useState(Date.now());
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
  const confirm = useMutation({ mutationFn: () => apiRequest("POST", `/api/shotgun/${offered!.id}/confirm`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }) });
  const deny = useMutation({ mutationFn: () => apiRequest("POST", `/api/shotgun/${offered!.id}/deny`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }) });
  // Chime on arrival, then a gentle repeat while the offer is up. Denying or
  // claiming unmounts the interval with the modal.
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!offered) return;
    playShotgunChime(audioRef);
    const timer = setInterval(() => playShotgunChime(audioRef), 2_500);
    return () => clearInterval(timer);
  }, [offered?.id]);
  const left = offered?.offerExpiresAt ? Math.max(0, (new Date(offered.offerExpiresAt).getTime() - now) / 1000) : 0;
  return <Dialog open={!!offered}><DialogContent className="overflow-hidden border-4 border-orange-400 bg-gradient-to-br from-slate-950 via-rose-950 to-orange-800 text-white shadow-2xl sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
    <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_center,white_1px,transparent_1px)] [background-size:18px_18px]" />
    <DialogHeader className="relative text-center"><div className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-orange-500 shadow-lg shadow-orange-500/50"><Zap className="h-10 w-10" /></div><DialogTitle className="mt-4 text-center text-3xl font-black">SHOTGUN LEAD!</DialogTitle><DialogDescription className="text-center text-orange-100">Confirm before C3 sends it to the next ready CLR.</DialogDescription></DialogHeader>
    {offered && <div className="relative space-y-4"><div className="rounded-2xl border border-white/20 bg-white/10 p-5 text-center backdrop-blur"><p className="text-2xl font-black">{offered.leadName}</p>{offered.phone && <p className="mt-2 flex items-center justify-center gap-2 text-lg"><Phone className="h-5 w-5" />{offered.phone}</p>}{offered.email && <p className="mt-1 flex items-center justify-center gap-2 text-sm text-orange-100"><Mail className="h-4 w-4" />{offered.email}</p>}{offered.stateCode && <p className="mt-1 flex items-center justify-center gap-2 text-sm text-orange-100"><MapPin className="h-4 w-4" />{offered.stateCode}</p>}{offered.source && <p className="mt-2 text-sm text-orange-100">Source: {offered.source}</p>}{offered.managerNotes && <p className="mt-3 whitespace-pre-wrap rounded-xl bg-black/20 p-3 text-left text-sm text-orange-50"><strong>Manager context:</strong> {offered.managerNotes}</p>}</div><div className="flex items-center justify-center gap-2 text-3xl font-black tabular-nums"><Clock3 className="h-7 w-7" />{left.toFixed(1)}s</div>{confirm.isError && <p className="text-center text-sm text-red-200">This lead already moved. The board will update automatically.</p>}<Button size="lg" className="h-16 w-full text-xl font-black bg-white text-rose-950 hover:bg-orange-100" disabled={confirm.isPending || left <= 0} onClick={() => confirm.mutate()}>{confirm.isPending ? "CONFIRMING…" : "I RECEIVED THIS LEAD"}</Button><Button size="sm" variant="ghost" className="w-full text-orange-100 hover:bg-white/10 hover:text-white" disabled={deny.isPending || confirm.isPending || left <= 0} onClick={() => deny.mutate()} data-testid="shotgun-deny">{deny.isPending ? "Passing…" : "Pass — send to the next CLR"}</Button><p className="text-center text-[11px] text-orange-200/80">Passing keeps you in the rotation. Letting the timer run out takes you out of it.</p></div>}
  </DialogContent></Dialog>;
}
