import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, Hand } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useShellPollsEnabled } from "@/lib/shell-ready";
import { Button } from "@/components/ui/button";
import { playShotgunChime } from "@/components/shotgun-offer-alert";
import { presenceState } from "@shared/shotgun-presence";
import type { ShotgunPayload } from "@/pages/shotgun";

/**
 * "Still working this lead?" — three minutes after a CLR claims a Shotgun
 * lead, on every page. One click keeps it; no answer inside the window and
 * the server puts the lead back in the rotation (shared/shotgun-presence.ts).
 * Rides the same poll as the offer card, so a claimed lead makes it poll
 * every few seconds and the prompt appears within seconds of being due.
 */
export function ShotgunPresencePrompt() {
  const { user } = useAuth();
  const shellReady = useShellPollsEnabled(!!user);
  const eligible = !!user?.isClr;
  const { data, dataUpdatedAt } = useQuery<ShotgunPayload>({
    queryKey: ["/api/shotgun"],
    enabled: eligible && shellReady,
    refetchInterval: (query) => ((query.state.data as ShotgunPayload | undefined)?.holding ? 3_000 : 15_000),
    // Hidden tabs stop polling; push covers presence while C3 is in the back.
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  const [now, setNow] = useState(Date.now());
  // Server clock, as the offer card does — a wrong laptop clock must not
  // fire the prompt early or hide it until the lead is already gone.
  const serverTime = Date.parse(data?.serverNow ?? "");
  const clockNow = Math.max(now, dataUpdatedAt) + (Number.isFinite(serverTime) ? serverTime - dataUpdatedAt : 0);
  const held = useMemo(() => data?.leads.find((lead) => lead.status === "claimed" && lead.currentAssigneeId === user?.id) ?? null, [data?.leads, user?.id]);
  const state = held ? presenceState(held.claimedAt, held.presenceConfirmedAt, clockNow) : { kind: "none" as const };
  useEffect(() => { if (!held) return; const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [held?.id]);
  const stillHere = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/shotgun/${id}/still-here`, {}),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/shotgun"] }),
  });
  useEffect(() => { stillHere.reset(); }, [held?.id]);
  // One chime when the question appears, a soft repeat while it waits.
  const audioRef = useRef<AudioContext | null>(null);
  const prompting = state.kind === "prompt";
  useEffect(() => {
    if (!prompting) return;
    playShotgunChime(audioRef);
    const timer = setInterval(() => playShotgunChime(audioRef), 10_000);
    return () => clearInterval(timer);
  }, [prompting, held?.id]);
  if (!held || state.kind !== "prompt") return null;
  return (
    <section aria-label="Still working this lead?" data-testid="shotgun-presence-prompt" className="pointer-events-auto relative rounded-2xl border-2 border-orange-400 bg-slate-950 p-4 text-white shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-left-4">
      <div className="flex items-center justify-between gap-2">
        <h2 role="alert" className="flex items-center gap-2 text-base font-black text-orange-300"><Hand className="h-5 w-5" />Still on this lead?</h2>
        <span aria-label="Time remaining" className="flex items-center gap-1 text-2xl font-black tabular-nums text-orange-300"><Clock3 className="h-5 w-5" />{Math.ceil(state.secondsLeft)}s</span>
      </div>
      <p className="mt-1 text-xs text-orange-100"><strong className="break-words">{held.leadName}</strong> goes back to the rotation in <strong>{Math.ceil(state.secondsLeft)} seconds</strong> — three minutes after you claimed it — unless you keep it. Nobody else is offered it until then.</p>
      {stillHere.isError && <p className="mt-2 text-sm text-red-200" role="alert">{(stillHere.error as any)?.message || "Could not confirm — the lead may already have moved."}</p>}
      <Button className="mt-3 min-h-12 w-full bg-white text-base font-bold text-slate-950 hover:bg-sky-100" disabled={stillHere.isPending} onClick={() => stillHere.mutate(held.id)} data-testid="shotgun-still-here">
        {stillHere.isPending ? "…" : "I'M HERE — KEEP IT"}
      </Button>
    </section>
  );
}
