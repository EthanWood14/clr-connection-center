import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { RotateCcw, Zap } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { playShotgunChime } from "@/components/shotgun-offer-alert";
import type { ShotgunPayload } from "@/pages/shotgun";

/**
 * Timed bounceback: 35 minutes after a Shotgun lead arrived, if it still has
 * no transfer or appointment, Ready CLRs see this dock popup for one week
 * (shared/shotgun-bounceback.ts). Accept claims without a floor offer lap.
 */
export function ShotgunBouncebackPrompt() {
  const { user } = useAuth();
  const eligible = !!user?.isClr;
  const { data } = useQuery<ShotgunPayload>({
    queryKey: ["/api/shotgun"],
    enabled: eligible,
    refetchInterval: (query) => ((query.state.data as ShotgunPayload | undefined)?.bouncebacks?.length ? 3_000 : 15_000),
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const target = useMemo(() => {
    if (!data?.bouncebackWeekActive) return null;
    return data?.bouncebacks?.[0] ?? null;
  }, [data?.bouncebackWeekActive, data?.bouncebacks]);
  const accept = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/bounceback`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }),
  });
  useEffect(() => { accept.reset(); }, [target?.id]);
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!target) return;
    playShotgunChime(audioRef);
    const timer = setInterval(() => playShotgunChime(audioRef), 8_000);
    return () => clearInterval(timer);
  }, [target?.id]);
  if (!target) return null;
  return (
    <section aria-label="Shotgun bounceback" data-testid="shotgun-bounceback-prompt" className="pointer-events-auto relative rounded-2xl border-2 border-violet-400 bg-slate-950 p-4 text-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-4">
      <div className="flex items-center justify-between gap-2">
        <h2 role="alert" className="flex items-center gap-2 text-base font-black text-violet-300"><Zap className="h-5 w-5" />BOUNCEBACK</h2>
        <RotateCcw className="h-5 w-5 text-violet-300" />
      </div>
      <p className="mt-1 text-xs text-violet-100">
        <strong className="break-words">{target.leadName}</strong> came in about 35 minutes ago and still has no transfer or appointment.
        Work it again while it is fresh.
      </p>
      {target.phone && <p className="mt-2 text-sm text-violet-50">{target.phone}</p>}
      {target.source && <p className="mt-1 text-[11px] text-violet-200/80">Source: {target.source}</p>}
      {accept.isError && <p className="mt-2 text-sm text-red-200" role="alert">{(accept.error as any)?.message || "Could not take this bounceback."}</p>}
      <Button
        className="mt-3 min-h-12 w-full bg-white text-base font-bold text-slate-950 hover:bg-violet-100"
        disabled={accept.isPending}
        onClick={() => accept.mutate(target.id)}
        data-testid="shotgun-bounceback-take"
      >
        {accept.isPending ? "…" : "TAKE BOUNCEBACK — WORK IT AGAIN"}
      </Button>
    </section>
  );
}
