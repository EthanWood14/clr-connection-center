import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { MapPin, Search, Copy, Phone, Mail, User, ChevronRight, AlertTriangle, Flame } from "lucide-react";
import { Link } from "wouter";
import { copyToClipboard } from "@/lib/utils";
import { businessTodayClient } from "@/lib/business-day";
import { UsStateGeoMap } from "@/components/us-state-geo-map";

// Defensive parse of an LO's licensed_states JSON column (string[] or null).
function parseLicensedStates(raw: unknown): string[] {
  try {
    const arr = JSON.parse((raw as string) || "[]");
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

const ALL_STATES: { abbr: string; name: string }[] = [
  { abbr: "AL", name: "Alabama" }, { abbr: "AK", name: "Alaska" },
  { abbr: "AZ", name: "Arizona" }, { abbr: "AR", name: "Arkansas" },
  { abbr: "CA", name: "California" }, { abbr: "CO", name: "Colorado" },
  { abbr: "CT", name: "Connecticut" }, { abbr: "DE", name: "Delaware" },
  { abbr: "FL", name: "Florida" }, { abbr: "GA", name: "Georgia" },
  { abbr: "HI", name: "Hawaii" }, { abbr: "ID", name: "Idaho" },
  { abbr: "IL", name: "Illinois" }, { abbr: "IN", name: "Indiana" },
  { abbr: "IA", name: "Iowa" }, { abbr: "KS", name: "Kansas" },
  { abbr: "KY", name: "Kentucky" }, { abbr: "LA", name: "Louisiana" },
  { abbr: "ME", name: "Maine" }, { abbr: "MD", name: "Maryland" },
  { abbr: "MA", name: "Massachusetts" }, { abbr: "MI", name: "Michigan" },
  { abbr: "MN", name: "Minnesota" }, { abbr: "MS", name: "Mississippi" },
  { abbr: "MO", name: "Missouri" }, { abbr: "MT", name: "Montana" },
  { abbr: "NE", name: "Nebraska" }, { abbr: "NV", name: "Nevada" },
  { abbr: "NH", name: "New Hampshire" }, { abbr: "NJ", name: "New Jersey" },
  { abbr: "NM", name: "New Mexico" }, { abbr: "NY", name: "New York" },
  { abbr: "NC", name: "North Carolina" }, { abbr: "ND", name: "North Dakota" },
  { abbr: "OH", name: "Ohio" }, { abbr: "OK", name: "Oklahoma" },
  { abbr: "OR", name: "Oregon" }, { abbr: "PA", name: "Pennsylvania" },
  { abbr: "RI", name: "Rhode Island" }, { abbr: "SC", name: "South Carolina" },
  { abbr: "SD", name: "South Dakota" }, { abbr: "TN", name: "Tennessee" },
  { abbr: "TX", name: "Texas" }, { abbr: "UT", name: "Utah" },
  { abbr: "VT", name: "Vermont" }, { abbr: "VA", name: "Virginia" },
  { abbr: "WA", name: "Washington" }, { abbr: "WV", name: "West Virginia" },
  { abbr: "WI", name: "Wisconsin" }, { abbr: "WY", name: "Wyoming" },
  { abbr: "DC", name: "Washington D.C." },
];

const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={() => {
        copyToClipboard(value).then(() => {
          setCopied(true);
          toast({ title: `${label} copied` });
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <Copy className={`w-3 h-3 ${copied ? "text-green-500" : ""}`} />
    </Button>
  );
}

export default function StateLookup() {
  const [stateSearch, setStateSearch] = useState("");
  const [selectedState, setSelectedState] = useState<{ abbr: string; name: string } | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const isLapPortal = typeof window !== "undefined" && window.location.hash.startsWith("#/lap");
  // Referenced by the "LOs with no states" notice below, which threw a
  // ReferenceError on render because this was never declared. Same idiom the
  // other pages use (check-ins.tsx, assignments.tsx).
  const { user } = useAuth();
  const isAdminOrManager = user?.role === "admin" || !!(user as any)?.isManager || !!user?.superAdmin;
  const loanOfficersEndpoint = isLapPortal ? "/api/lap/loan-officers" : "/api/loan-officers";

  const handleStateSelect = useCallback((state: { abbr: string; name: string }) => {
    setSelectedState(state);
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);

  const { data: allLOs = [], isLoading } = useQuery<any[]>({
    queryKey: [loanOfficersEndpoint],
  });

  // Managers flag who needs volume. Capped at three server-side; a refusal is
  // surfaced rather than swallowed, so the manager picks who drops off.
  const { toast } = useToast();
  const flagMut = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) =>
      apiRequest("POST", `/api/loan-officers/${id}/needs-transfers`, { on }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [loanOfficersEndpoint] }),
    onError: (e: any) => toast({
      title: "Couldn't update", description: e?.message ?? "Try again.", variant: "destructive",
    }),
  });
  const flaggedNames = useMemo(
    () => allLOs.filter((l: any) => l.needsTransfers).map((l: any) => l.fullName),
    [allLOs],
  );

  // Transfer counts per LO, so a state's list can be ordered by who has taken
  // the least work rather than by tier alone. Several windows arrive together;
  // switching between them costs no request.
  const transferCountsEndpoint = isLapPortal
    ? "/api/lap/loan-officers/transfer-counts"
    : "/api/loan-officers/transfer-counts";
  const { data: transferData } = useQuery<{ counts: Record<string, { d7: number; d30: number; allTime: number }> }>({
    queryKey: [transferCountsEndpoint],
  });
  const transferCounts = transferData?.counts ?? {};
  // Ordering the panel by fewest transfers is the point of the feature, so it
  // is the default; tier order stays one click away.
  const [orderBy, setOrderBy] = useState<"fewest" | "tier">("fewest");
  const [countWindow, setCountWindow] = useState<"d7" | "d30" | "allTime">("d30");
  const transfersFor = useCallback(
    (loId: number | string) => transferCounts[String(loId)]?.[countWindow] ?? 0,
    [transferCounts, countWindow],
  );


  // Treat missing/null internalStatus as "active" so newly-added LOs aren't
  // silently dropped just because the column wasn't filled in. We only
  // exclude rows explicitly marked archived or inactive. Snoozed LOs are
  // still listed here — the State Lookup is about who is *licensed* in a
  // state, not who is currently in the call rotation; snooze state is
  // surfaced on the card itself.
  const today = businessTodayClient();
  const activeLOs = useMemo(
    () => allLOs.filter((lo) => {
      const status = lo.internalStatus ?? lo.internal_status ?? "active";
      if (status === "archived" || status === "inactive") return false;
      return true;
    }),
    [allLOs]
  );

  // LOs that pass the active filter but have no licensed states yet. These
  // would silently fail to match any state click, so we surface them in a
  // dedicated section instead of hiding them entirely.
  const unmappedLOs = useMemo(
    () => activeLOs.filter((lo) => parseLicensedStates(lo.licensedStates).length === 0),
    [activeLOs]
  );

  // Filter state list by search
  const filteredStates = useMemo(() => {
    const q = stateSearch.toLowerCase();
    return ALL_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q)
    );
  }, [stateSearch]);

  // LOs licensed in selected state (active, archived/inactive excluded).
  // Snoozed LOs are included but rendered with a Snoozed badge so admins know.
  const licensedLOs = useMemo(() => {
    if (!selectedState) return [];
    return activeLOs.filter((lo) =>
      parseLicensedStates(lo.licensedStates).some(
        (s) =>
          s.trim().toUpperCase() === selectedState.abbr ||
          s.trim().toLowerCase() === selectedState.name.toLowerCase()
      )
    );
  }, [activeLOs, selectedState]);
  // The lightest load among the LOs licensed in the selected state, so the
  // card for that LO (or LOs, on a tie) can be marked.
  const fewestInState = useMemo(
    () => (licensedLOs.length ? Math.min(...licensedLOs.map((lo: any) => transfersFor(lo.id))) : 0),
    [licensedLOs, transfersFor],
  );

  // Build coverage count map — active LOs only
  const coverageMap = useMemo(() => {
    const map: Record<string, number> = {};
    activeLOs.forEach((lo) => {
      parseLicensedStates(lo.licensedStates).forEach((s) => {
        const abbr = s.trim().toUpperCase();
        map[abbr] = (map[abbr] || 0) + 1;
      });
    });
    return map;
  }, [activeLOs]);

  // LO names per state for the map's hover tooltip.
  const namesByState = useMemo(() => {
    const map: Record<string, string[]> = {};
    activeLOs.forEach((lo) => {
      parseLicensedStates(lo.licensedStates).forEach((s) => {
        const abbr = s.trim().toUpperCase();
        (map[abbr] ??= []).push(lo.fullName);
      });
    });
    return map;
  }, [activeLOs]);

  const coverageStats = useMemo(() => {
    const counts = Object.values(coverageMap);
    return {
      statesWithCoverage: counts.filter((c) => c > 0).length,
      totalLicenses: counts.reduce((sum, c) => sum + c, 0),
    };
  }, [coverageMap]);

  function coverageColor(count: number) {
    if (count === 0) return "bg-muted text-muted-foreground border border-border";
    if (count === 1) return "bg-primary/10 text-primary border border-primary/20";
    if (count <= 3) return "bg-primary/25 text-primary border border-primary/30";
    return "bg-primary/50 text-primary-foreground border border-primary/60";
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">State License Lookup</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Find which Loan Officers are licensed in any state.
        </p>
      </div>

      {/* Data-hygiene banner: every signed-in user can open the appropriate
          profile screen and fix missing state permissions. */}
      {!isLoading && unmappedLOs.length > 0 && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <div className="flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {unmappedLOs.length} loan officer{unmappedLOs.length === 1 ? "" : "s"} {unmappedLOs.length === 1 ? "is" : "are"} missing licensed states
            </p>
            <p className="text-amber-900/80 dark:text-amber-200/80 text-xs mt-0.5">
              They’re listed below under “Needs state licensing”. Until their states are filled in, they won’t appear when you click a state on the map.
            </p>
          </div>
          <Link href={isLapPortal ? "/lo-profiles" : "/directory"}>
            <Button variant="outline" size="sm" className="shrink-0">
              Edit state permissions
            </Button>
          </Link>
        </div>
      )}

      {/* ── US map: click a state to filter LOs ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <MapPin className="w-4 h-4 text-muted-foreground" />
              Coverage map
              {selectedState && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  — viewing <span className="font-mono font-semibold text-foreground">{selectedState.abbr}</span> {selectedState.name}
                </span>
              )}
            </CardTitle>
            {selectedState && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => setSelectedState(null)}
              >
                ✕ Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <UsStateGeoMap
            coverage={coverageMap}
            selectedAbbr={selectedState?.abbr ?? null}
            onSelect={handleStateSelect}
            namesByState={namesByState}
          />
          {/* Coverage legend */}
          <div className="mt-3 flex items-center justify-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span>LOs licensed:</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3.5 h-3.5 rounded-sm border border-border" style={{ background: "hsl(var(--muted))" }} /> 0
            </span>
            {[
              { label: "1", op: 0.18 },
              { label: "2", op: 0.34 },
              { label: "3", op: 0.5 },
              { label: "4–5", op: 0.66 },
              { label: "6+", op: 0.82 },
            ].map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="inline-block w-3.5 h-3.5 rounded-sm border border-primary/30" style={{ background: `hsl(var(--primary) / ${s.op})` }} /> {s.label}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* ── Left panel: state list (still here for search-by-name) ── */}
        <Card className="sticky top-6">
          <CardHeader className="pb-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search state..."
                value={stateSearch}
                onChange={(e) => setStateSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[520px] overflow-y-auto">
              {filteredStates.length === 0 && (
                <p className="text-sm text-muted-foreground px-4 py-6 text-center">No states match.</p>
              )}
              {filteredStates.map((state) => {
                const count = coverageMap[state.abbr] || 0;
                const isSelected = selectedState?.abbr === state.abbr;
                return (
                  <button
                    key={state.abbr}
                    onClick={() => handleStateSelect(state)}
                    className={`w-full flex items-center justify-between px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/60 border-b last:border-0 ${
                      isSelected ? "bg-primary/10 font-semibold" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs text-muted-foreground w-6">{state.abbr}</span>
                      <span>{state.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {count > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${coverageColor(count)}`}>
                          {count}
                        </span>
                      )}
                      {isSelected && <ChevronRight className="w-3.5 h-3.5 text-primary" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* ── Right panel: LO results ── */}
        <div className="space-y-4" ref={resultsRef}>
          {!selectedState ? (
            <Card>
              <CardContent className="py-8 space-y-5">
                <div className="text-center">
                  <MapPin className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                  <p className="text-muted-foreground text-sm">Click a state on the map or list to view licensed LOs</p>
                </div>
                {!isLoading && coverageStats.statesWithCoverage > 0 && (
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">{coverageStats.statesWithCoverage}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">states covered</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-primary">{coverageStats.totalLicenses}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">total LO licenses</div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold">{selectedState.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {isLoading
                      ? "Loading..."
                      : licensedLOs.length === 0
                      ? "No LOs licensed in this state"
                      : `${licensedLOs.length} LO${licensedLOs.length !== 1 ? "s" : ""} licensed here`}
                  </p>
                </div>
                <Badge variant="outline" className="font-mono text-base px-3 py-1">
                  {selectedState.abbr}
                </Badge>
              </div>

              {/* Who in this state has taken the least work. The whole point of
                  the view: pick the next LO without guessing. */}
              {flaggedNames.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/25 px-3 py-2" data-testid="needs-transfers-summary">
                  <Flame className="w-3.5 h-3.5 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    <span className="font-semibold">Needs transfers:</span> {flaggedNames.join(", ")}
                    <span className="text-amber-700 dark:text-amber-400/80"> — pinned to the top of any state they cover.</span>
                  </p>
                </div>
              )}

              {licensedLOs.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap" data-testid="lo-workload-controls">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Order:</span>
                  {([["fewest", "Fewest transfers"], ["tier", "Priority tier"]] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setOrderBy(key)}
                      data-testid={`lo-order-${key}`}
                      className={`text-[11px] px-2 py-1 rounded-full border font-medium ${
                        orderBy === key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                      }`}
                    >{label}</button>
                  ))}
                  {orderBy === "fewest" && (
                    <>
                      <span className="text-[11px] text-muted-foreground ml-1">over</span>
                      {([["d7", "7d"], ["d30", "30d"], ["allTime", "All time"]] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setCountWindow(key)}
                          data-testid={`lo-window-${key}`}
                          className={`text-[11px] px-2 py-1 rounded-full border font-medium ${
                            countWindow === key ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
                          }`}
                        >{label}</button>
                      ))}
                    </>
                  )}
                </div>
              )}

              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Card key={i}>
                      <CardContent className="p-4">
                        <Skeleton className="h-5 w-48 mb-2" />
                        <Skeleton className="h-4 w-32" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : licensedLOs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <User className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No LOs are currently licensed in {selectedState.name}.
                    </p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      {isLapPortal
                        ? "Ask an administrator to update the Loan Officer's licensed states."
                        : "Update an LO's licensed states in the Directory."}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {[...licensedLOs]
                    .sort((a, b) =>
                      // Anyone flagged as needing transfers comes first, whatever
                      // the chosen order — that is the point of flagging them.
                      ((b.needsTransfers ? 1 : 0) - (a.needsTransfers ? 1 : 0)) ||
                      (orderBy === "fewest"
                        // Fewest transfers first; tier breaks ties so the
                        // ordering stays stable among LOs with equal counts.
                        ? (transfersFor(a.id) - transfersFor(b.id))
                          || ((a.priorityTier ?? 99) - (b.priorityTier ?? 99))
                        : ((a.priorityTier ?? 99) - (b.priorityTier ?? 99))))
                    .map((lo) => {
                      const allStates = parseLicensedStates(lo.licensedStates);
                      // Null/missing status is treated as active everywhere else, so
                      // don't dim those rows or show an empty status badge.
                      const status = lo.internalStatus ?? lo.internal_status ?? "active";
                      const tier = lo.priorityTier ?? lo.priority_tier;
                      return (
                        <Card
                          key={lo.id}
                          className={`${status !== "active" ? "opacity-60" : ""} ${
                            lo.needsTransfers ? "border-2 border-amber-400 dark:border-amber-500 bg-amber-50/60 dark:bg-amber-950/20" : ""
                          }`}
                          data-testid={lo.needsTransfers ? `lo-needs-transfers-${lo.id}` : undefined}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm">{lo.fullName}</span>
                                  {lo.needsTransfers && (
                                    <Badge className="text-xs bg-amber-500 text-white border-0 gap-1">
                                      <Flame className="w-3 h-3" /> Needs transfers
                                    </Badge>
                                  )}
                                  {isAdminOrManager && (
                                    <button
                                      type="button"
                                      onClick={() => flagMut.mutate({ id: lo.id, on: !lo.needsTransfers })}
                                      disabled={flagMut.isPending}
                                      data-testid={`toggle-needs-transfers-${lo.id}`}
                                      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium transition-colors ${
                                        lo.needsTransfers
                                          ? "border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-400"
                                          : "border-border text-muted-foreground hover:bg-muted"
                                      }`}
                                      title={lo.needsTransfers ? "Remove from the needs-transfers list" : "Flag as needing transfers"}
                                    >
                                      {lo.needsTransfers ? "unflag" : "flag"}
                                    </button>
                                  )}
                                  {/* The count itself, not just the ordering —
                                      "3 transfers" answers the question the
                                      sort only implies. Highlighted when this
                                      LO is the lightest-loaded in the state. */}
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${
                                      orderBy === "fewest" && transfersFor(lo.id) === fewestInState
                                        ? "border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
                                        : "text-muted-foreground"
                                    }`}
                                    data-testid={`lo-transfers-${lo.id}`}
                                  >
                                    {transfersFor(lo.id)} transfer{transfersFor(lo.id) === 1 ? "" : "s"}
                                    {countWindow !== "allTime" && ` · ${countWindow === "d7" ? "7d" : "30d"}`}
                                  </Badge>
                                  {TIER_LABELS[tier] && (
                                    <Badge className={`text-xs ${TIER_COLORS[tier]}`}>
                                      {TIER_LABELS[tier]}
                                    </Badge>
                                  )}
                                  {status !== "active" && (
                                    <Badge variant="outline" className="text-xs capitalize text-muted-foreground">
                                      {status}
                                    </Badge>
                                  )}
                                  {(lo.snoozeUntil ?? lo.snooze_until) && ((lo.snoozeUntil ?? lo.snooze_until) >= today) && (
                                    <Badge variant="outline" className="text-xs border-amber-500/60 text-amber-600 dark:text-amber-400">
                                      Snoozed until {lo.snoozeUntil ?? lo.snooze_until}
                                    </Badge>
                                  )}
                                </div>
                                {lo.nmlsId && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    NMLS #{lo.nmlsId}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 space-y-1.5">
                              {lo.phone && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                  <span className="font-mono text-xs">{lo.phone}</span>
                                  <CopyButton value={lo.phone} label="Phone" />
                                </div>
                              )}
                              {lo.email && (
                                <div className="flex items-center gap-2 text-sm">
                                  <Mail className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                                  <span className="text-xs truncate">{lo.email}</span>
                                  <CopyButton value={lo.email} label="Email" />
                                </div>
                              )}
                            </div>

                            {allStates.length > 0 && (
                              <div className="mt-3 flex flex-wrap gap-1">
                                {allStates.map((s) => (
                                  <span
                                    key={s}
                                    className={`text-xs px-1.5 py-0.5 rounded font-mono font-medium ${
                                      s.trim().toUpperCase() === selectedState.abbr
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {s.trim().toUpperCase()}
                                  </span>
                                ))}
                              </div>
                            )}

                            {lo.notes && (
                              <p className="text-xs text-muted-foreground mt-2 italic border-t pt-2">
                                {lo.notes}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Needs state licensing — always visible (when non-empty) so unmapped
         LOs do not silently disappear from state coverage. */}
      {!isLoading && unmappedLOs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300" />
              Needs state licensing ({unmappedLOs.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              {isLapPortal ? (
                <>
                  These Loan Officers are active but have no states recorded, so they will not appear
                  when a team member selects a state. {isAdminOrManager ? (
                    <>
                      <Link href="/lo-profiles">
                        <span className="text-primary underline cursor-pointer">Review LO Profiles</span>
                      </Link>
                      , then coordinate the licensing update through the approved administrator workflow.
                    </>
                  ) : "Ask an administrator to update their licensing coverage."}
                </>
              ) : (
                <>
                  These loan officers are active in the directory but have no states selected,
                  so they will not show up when CLRs click a state on the map. {isAdminOrManager && (
                    <Link href="/directory">
                      <span className="text-primary underline cursor-pointer">Open Directory</span>
                    </Link>
                  )} to fill in their licenses.
                </>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {unmappedLOs.map((lo) => (
                <div
                  key={lo.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-border bg-muted/40 text-xs"
                >
                  <User className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="font-medium">{lo.fullName}</span>
                  {lo.nmlsId && (
                    <span className="font-mono text-muted-foreground">#{lo.nmlsId}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
