import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Radio, Users } from "lucide-react";
import { formatSlaSeconds } from "@shared/shotgun-sla";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type SlaPayload = {
  range: "today" | "week";
  from: string;
  to: string;
  total: number;
  claimed: number;
  unclaimed: number;
  claimedPct: number | null;
  unclaimedPct: number | null;
  medianClaimSeconds: number | null;
  averageClaimSeconds: number | null;
};

function Tile({
  label, value, sub, icon: Icon, testId,
}: {
  label: string; value: string; sub?: string; icon: any; testId: string;
}) {
  return (
    <div
      className="min-w-0 rounded-xl border bg-background/80 p-3 shadow-sm"
      data-testid={testId}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 truncate text-xl font-black tabular-nums sm:text-2xl">{value}</p>
      {sub ? <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/**
 * Shotgun / fresh-lead speed scoreboard (Shotgun page).
 * Exactly two features: (1) unclaimed vs claimed as separate categories,
 * (2) median AND average claim time, including unclaimed at four minutes. No dial %.
 */
export function ShotgunSlaScoreboard({ className }: { className?: string }) {
  const [range, setRange] = useState<"today" | "week">("today");
  const { data, isLoading, isError } = useQuery<SlaPayload>({
    queryKey: ["/api/shotgun/sla", range],
    queryFn: async () => {
      const res = await fetch(`/api/shotgun/sla?range=${range}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  return (
    <Card className={cn("overflow-hidden", className)} data-testid="shotgun-sla-scoreboard">
      <CardHeader className="flex flex-col gap-3 space-y-0 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            <Radio className="h-5 w-5 shrink-0 text-orange-600" />
            Shotgun speed
            <Badge variant="secondary" className="font-normal">fresh leads</Badge>
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Claimed and unclaimed counts stay separate. Claim time includes unclaimed leads at 4 minutes each; claimed leads use their actual time.
          </p>
        </div>
        <div className="flex shrink-0 gap-1 rounded-lg border p-0.5" role="group" aria-label="Scoreboard range">
          {(["today", "week"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={cn(
                "min-h-9 rounded-md px-3 text-sm font-semibold capitalize",
                range === key ? "bg-orange-600 text-white" : "text-muted-foreground hover:bg-muted",
              )}
              data-testid={`shotgun-sla-range-${key}`}
            >
              {key === "today" ? "Today" : "Week"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && !data ? (
          <p className="text-sm text-muted-foreground">Loading speed…</p>
        ) : isError ? (
          <p className="text-sm text-red-600">Could not load Shotgun speed.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile
                testId="shotgun-sla-unclaimed"
                icon={Users}
                label="Unclaimed"
                value={String(data?.unclaimed ?? 0)}
                sub={data?.unclaimedPct != null ? `${data.unclaimedPct}% of ${data.total}` : `${data?.total ?? 0} total`}
              />
              <Tile
                testId="shotgun-sla-claimed"
                icon={Users}
                label="Claimed"
                value={String(data?.claimed ?? 0)}
                sub={data?.claimedPct != null ? `${data.claimedPct}% of ${data.total}` : undefined}
              />
              <Tile
                testId="shotgun-sla-median-claim"
                icon={Clock3}
                label="Median claim"
                value={formatSlaSeconds(data?.medianClaimSeconds)}
                sub="Unclaimed = 4 minutes"
              />
              <Tile
                testId="shotgun-sla-avg-claim"
                icon={Clock3}
                label="Avg claim"
                value={formatSlaSeconds(data?.averageClaimSeconds)}
                sub="Unclaimed = 4 minutes"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Window: {data?.from}
              {data?.from !== data?.to ? ` → ${data?.to}` : ""} (Pacific business day). exclude_from_stats claimants omitted from speed.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
