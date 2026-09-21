import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Crown, Flame, Maximize2, Medal, Timer, Trophy } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTransferCount } from "@shared/transfer-credit";
import { LAST_TOURNAMENT_DATE, TOURNAMENT_ENABLED, isTournamentExcluded, type TournamentPhase, type TournamentStanding } from "@shared/tournament";
import { useAuth } from "@/lib/auth";

/**
 * The Transfer Tournament: most transfers logged 12:30–5:30 PM Pacific today.
 * Lives as a Dashboard tab and, for the wall, as its own page at /tournament.
 * Polls every ten seconds — in a background tab too, because that is where
 * the wall's browser usually is.
 */

type Payload = {
  date: string;
  window: { startIso: string; endIso: string; startLabel: string; endLabel: string; tz: string };
  phase: TournamentPhase;
  serverNow: string;
  standings: TournamentStanding[];
  totalCredit: number;
};

const ptTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
const ptDate = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" });

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function TournamentBoard({ fullscreen = false, date }: { fullscreen?: boolean; date?: string }) {
  const { data, dataUpdatedAt, isLoading } = useQuery<Payload>({
    queryKey: [date ? `/api/tournament?date=${date}` : "/api/tournament"],
    // A past board is final; only a live one polls.
    refetchInterval: date ? false : 10_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
  // Server clock, so a wrong wall-PC clock cannot start or end the tournament early.
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const serverTime = Date.parse(data?.serverNow ?? "");
  const clockNow = Math.max(now, dataUpdatedAt) + (Number.isFinite(serverTime) ? serverTime - dataUpdatedAt : 0);

  if (isLoading || !data) {
    return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  const startMs = Date.parse(data.window.startIso);
  const endMs = Date.parse(data.window.endIso);
  const phase: TournamentPhase = clockNow < startMs ? "before" : clockNow >= endMs ? "over" : "live";
  const standings = data.standings;
  const scored = standings.filter((s) => s.credit > 0);
  const leader = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  const gap = leader && runnerUp ? leader.credit - runnerUp.credit : leader ? leader.credit : 0;
  const big = fullscreen;

  return (
    <div className={big ? "space-y-6" : "space-y-4"} data-testid="tournament-board">
      <Card className="overflow-hidden border-2 border-amber-400 bg-gradient-to-br from-amber-50 via-background to-orange-50 dark:from-amber-950/30 dark:via-background dark:to-orange-950/20">
        <CardContent className={big ? "p-6" : "p-4"}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-300"><Trophy className="h-4 w-4" /> Transfer Tournament</p>
              <h2 className={big ? "mt-1 text-4xl font-black" : "mt-1 text-2xl font-black"}>Most transfers, {data.window.startLabel}–{data.window.endLabel} PT</h2>
              <p className="mt-1 text-sm text-muted-foreground">{ptDate.format(new Date(startMs))} · counted the moment a transfer is logged in C3 · Shotgun transfers split half and half, like the leaderboard.</p>
            </div>
            <div className="text-right" data-testid="tournament-clock">
              {phase === "before" && <>
                <Badge variant="outline" className="border-sky-400 text-sky-700 dark:text-sky-300">Starts in</Badge>
                <p className={big ? "mt-1 text-4xl font-black tabular-nums" : "mt-1 text-2xl font-black tabular-nums"}>{clock(startMs - clockNow)}</p>
              </>}
              {phase === "live" && <>
                <Badge className="animate-pulse bg-red-600 text-white hover:bg-red-600"><Flame className="mr-1 h-3 w-3" /> LIVE</Badge>
                <p className={big ? "mt-1 text-4xl font-black tabular-nums" : "mt-1 text-2xl font-black tabular-nums"}>{clock(endMs - clockNow)}</p>
                <p className="text-xs text-muted-foreground">left</p>
              </>}
              {phase === "over" && <>
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Final</Badge>
                <p className="mt-1 text-sm text-muted-foreground">Ended {data.window.endLabel} PT</p>
              </>}
            </div>
          </div>
          {leader && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="tournament-leader">
              <Crown className="h-4 w-4 text-amber-500" />
              <strong>{leader.name}</strong> {phase === "over" ? "wins" : "leads"} with {formatTransferCount(leader.credit)}
              {runnerUp ? <> — {formatTransferCount(gap)} ahead of {runnerUp.name}</> : " — nobody else is on the board yet"}.
            </p>
          )}
          {!leader && <p className="mt-3 text-sm text-muted-foreground">{phase === "before" ? "The board opens at " + data.window.startLabel + " PT. First transfer in takes the lead." : "No transfers on the board yet. First one in takes the lead."}</p>}
        </CardContent>
      </Card>

      {scored.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3" data-testid="tournament-podium">
          {scored.slice(0, 3).map((s, i) => (
            <Card key={s.userId} className={i === 0 ? "border-2 border-amber-400 bg-amber-50/60 dark:bg-amber-950/20" : i === 1 ? "border-slate-300" : "border-orange-300"}>
              <CardContent className={big ? "p-5" : "p-4"}>
                <p className={big ? "text-4xl" : "text-3xl"}>{MEDALS[i]}</p>
                <p className={big ? "mt-1 truncate text-2xl font-black" : "mt-1 truncate text-lg font-black"}>{s.name}</p>
                <p className={big ? "text-5xl font-black tabular-nums" : "text-3xl font-black tabular-nums"}>{formatTransferCount(s.credit)}</p>
                <p className="text-xs text-muted-foreground">{s.latestAt ? `last at ${ptTime.format(new Date(s.latestAt))}` : ""}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm" data-testid="tournament-table">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 w-12">#</th>
                <th className="px-2 py-2">CLR</th>
                <th className="px-2 py-2 text-right">Transfers</th>
                <th className="hidden px-2 py-2 sm:table-cell">In the window</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => (
                <tr key={s.userId} className={s.credit > 0 && s.rank === 1 ? "border-b bg-amber-50/60 dark:bg-amber-950/20" : "border-b"} data-testid={`tournament-row-${s.userId}`}>
                  <td className={big ? "px-4 py-3 text-xl font-black tabular-nums" : "px-4 py-2 font-black tabular-nums"}>{s.credit > 0 ? s.rank : "—"}</td>
                  <td className={big ? "px-2 py-3 text-xl font-bold" : "px-2 py-2 font-semibold"}>
                    <span className="flex items-center gap-2">{s.credit > 0 && s.rank <= 3 ? <Medal className={s.rank === 1 ? "h-4 w-4 text-amber-500" : s.rank === 2 ? "h-4 w-4 text-slate-400" : "h-4 w-4 text-orange-600"} /> : null}{s.name}</span>
                  </td>
                  <td className={big ? "px-2 py-3 text-right text-2xl font-black tabular-nums" : "px-2 py-2 text-right text-lg font-black tabular-nums"}>{formatTransferCount(s.credit)}</td>
                  <td className="hidden px-2 py-2 sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {s.transfers.map((t) => (
                        <span key={`${t.id}-${s.userId}`} className="rounded-full border bg-muted/40 px-2 py-0.5 text-xs" title={`${t.transferType || "transfer"} · ${t.loName || "LO"} · ${ptTime.format(new Date(t.at))}`}>
                          {ptTime.format(new Date(t.at))} {t.borrowerName}{t.credit < 1 ? " (½)" : ""}
                        </span>
                      ))}
                      {s.transfers.length === 0 && <span className="text-xs text-muted-foreground">nothing yet</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {standings.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No CLRs on the roster.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {!fullscreen && (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm"><Link href="/tournament"><Maximize2 className="mr-1.5 h-4 w-4" /> Open full-screen board</Link></Button>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Timer className="h-3.5 w-3.5" /> Updates every 10 seconds. Times shown in Pacific.</p>
    </div>
  );
}

export default function TournamentPage() {
  const { user } = useAuth();
  // Excluded helpers (Elleine) stay off the live board and home surfaces.
  if (TOURNAMENT_ENABLED && isTournamentExcluded(user?.name)) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Card className="border-dashed"><CardContent className="p-4 text-sm text-muted-foreground" data-testid="tournament-excluded">
          You are not in this Transfer Tournament. <Link href="/" className="underline">Back to Home</Link>
        </CardContent></Card>
      </div>
    );
  }
  // No tournament on: the page is a record of the last one, not a live board.
  if (!TOURNAMENT_ENABLED) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
        <Card className="border-dashed"><CardContent className="p-4 text-sm text-muted-foreground" data-testid="tournament-off">
          No Transfer Tournament is running. Below is the final board from the last one, {ptDate.format(new Date(`${LAST_TOURNAMENT_DATE}T12:00:00-07:00`))}.
        </CardContent></Card>
        <TournamentBoard fullscreen date={LAST_TOURNAMENT_DATE} />
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <TournamentBoard fullscreen />
    </div>
  );
}
