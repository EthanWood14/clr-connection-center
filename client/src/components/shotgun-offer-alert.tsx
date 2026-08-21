import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, Phone, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ShotgunPayload } from "@/pages/shotgun";

export function ShotgunOfferAlert() {
  const { user } = useAuth();
  const eligible = !!user?.isClr;
  // Every Ready CLR polls this on every page, all day. At one second that was
  // ~70% of all traffic to the server and the timeouts it caused were being
  // read as "signed out" (see fetchMe in lib/auth). Five seconds still surfaces
  // a 20-second offer with at least 15 to spare.
  const { data } = useQuery<ShotgunPayload>({ queryKey: ["/api/shotgun"], enabled: eligible, refetchInterval: 5_000, staleTime: 0 });
  const offered = useMemo(() => data?.leads.find((lead) => lead.status === "offered" && lead.currentAssigneeId === user?.id) ?? null, [data?.leads, user?.id]);
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
    // No invalidate on each beat — the poll above already refetches, and the
    // extra fetch per heartbeat doubled the request rate for no new data.
    const beat = () => apiRequest("POST", "/api/shotgun/readiness", { heartbeat: true }).catch(() => {});
    void beat(); const timer = setInterval(beat, 10_000); return () => clearInterval(timer);
  }, [eligible, user?.id]);
  const confirm = useMutation({ mutationFn: () => apiRequest("POST", `/api/shotgun/${offered!.id}/confirm`, {}), onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }) });
  const left = offered?.offerExpiresAt ? Math.max(0, (new Date(offered.offerExpiresAt).getTime() - now) / 1000) : 0;
  return <Dialog open={!!offered}><DialogContent className="overflow-hidden border-4 border-orange-400 bg-gradient-to-br from-slate-950 via-rose-950 to-orange-800 text-white shadow-2xl sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
    <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_center,white_1px,transparent_1px)] [background-size:18px_18px]" />
    <DialogHeader className="relative text-center"><div className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full bg-orange-500 shadow-lg shadow-orange-500/50"><Zap className="h-10 w-10" /></div><DialogTitle className="mt-4 text-center text-3xl font-black">SHOTGUN LEAD!</DialogTitle><DialogDescription className="text-center text-orange-100">Confirm before C3 sends it to the next ready CLR.</DialogDescription></DialogHeader>
    {offered && <div className="relative space-y-4"><div className="rounded-2xl border border-white/20 bg-white/10 p-5 text-center backdrop-blur"><p className="text-2xl font-black">{offered.leadName}</p>{offered.phone && <p className="mt-2 flex items-center justify-center gap-2 text-lg"><Phone className="h-5 w-5" />{offered.phone}</p>}{offered.source && <p className="mt-2 text-sm text-orange-100">{offered.source}</p>}</div><div className="flex items-center justify-center gap-2 text-3xl font-black tabular-nums"><Clock3 className="h-7 w-7" />{left.toFixed(1)}s</div>{confirm.isError && <p className="text-center text-sm text-red-200">This lead already moved. The board will update automatically.</p>}<Button size="lg" className="h-16 w-full text-xl font-black bg-white text-rose-950 hover:bg-orange-100" disabled={confirm.isPending || left <= 0} onClick={() => confirm.mutate()}>{confirm.isPending ? "CONFIRMING…" : "I RECEIVED THIS LEAD"}</Button></div>}
  </DialogContent></Dialog>;
}
