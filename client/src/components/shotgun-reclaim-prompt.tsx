import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PhoneCall, RotateCcw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { playShotgunChime } from "@/components/shotgun-offer-alert";
import type { ShotgunPayload } from "@/pages/shotgun";

/**
 * Grab back a Shotgun lead this CLR already claimed, then lost — only while
 * they confirm they are on the phone with that borrower. Lives in the same
 * dock as the offer / presence cards so it shows on every page.
 */
export function ShotgunReclaimPrompt() {
  const { user } = useAuth();
  const eligible = !!user?.isClr;
  const { data } = useQuery<ShotgunPayload>({
    queryKey: ["/api/shotgun"],
    enabled: eligible,
    refetchInterval: (query) => ((query.state.data as ShotgunPayload | undefined)?.reclaimable?.length ? 3_000 : 15_000),
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
  const target = useMemo(() => data?.reclaimable?.[0] ?? null, [data?.reclaimable]);
  const reclaim = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/reclaim`, { onThePhone: true }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }),
  });
  useEffect(() => { reclaim.reset(); }, [target?.id]);
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!target) return;
    playShotgunChime(audioRef);
    const timer = setInterval(() => playShotgunChime(audioRef), 12_000);
    return () => clearInterval(timer);
  }, [target?.id]);
  if (!target) return null;
  return (
    <section aria-label="Grab Shotgun lead back" data-testid="shotgun-reclaim-prompt" className="pointer-events-auto relative rounded-2xl border-2 border-sky-400 bg-slate-950 p-4 text-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-4">
      <div className="flex items-center justify-between gap-2">
        <h2 role="alert" className="flex items-center gap-2 text-base font-black text-sky-300"><RotateCcw className="h-5 w-5" />Grab back?</h2>
        <PhoneCall className="h-5 w-5 text-sky-300" />
      </div>
      <p className="mt-1 text-xs text-sky-100">
        You already grabbed <strong className="break-words">{target.leadName}</strong>
        {target.status === "offered" && target.currentAssigneeName
          ? <> — it is offered to <strong>{target.currentAssigneeName}</strong> right now</>
          : <> and it went back to the rotation</>}.
        If you are on the phone with them, take it back without waiting in line.
      </p>
      {reclaim.isError && <p className="mt-2 text-sm text-red-200" role="alert">{(reclaim.error as any)?.message || "Could not grab this lead back."}</p>}
      <Button
        className="mt-3 min-h-12 w-full bg-white text-base font-bold text-slate-950 hover:bg-sky-100"
        disabled={reclaim.isPending}
        onClick={() => reclaim.mutate(target.id)}
        data-testid="shotgun-grab-back"
      >
        {reclaim.isPending ? "…" : "I AM ON THE PHONE — GRAB BACK"}
      </Button>
    </section>
  );
}
