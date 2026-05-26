import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Search, Copy, Phone, Mail, User, ChevronRight, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { copyToClipboard } from "@/lib/utils";
import { businessTodayClient } from "@/lib/business-day";
import { useAuth } from "@/lib/auth";
import { UsStateTileMap } from "@/components/us-state-tile-map";

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

  const handleStateSelect = useCallback((state: { abbr: string; name: string }) => {
    setSelectedState(state);
    setTimeout(() => {
      resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  }, []);

  const { data: allLOs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

  // Treat missing/null internalStatus as "active" so newly-added LOs aren't
  // silently dropped just because the column wasn't filled in. We only
  // exclude rows explicitly marked archived or inactive.
  const today = businessTodayClient();
  const activeLOs = useMemo(
    () => allLOs.filter((lo) => {
      const status = lo.internalStatus ?? lo.internal_status ?? "active";
      if (status === "archived" || status === "inactive") return false;
      const snooze = lo.snoozeUntil ?? lo.snooze_until;
      if (snooze && snooze >= today) return false;
      return true;
    }),
    [allLOs, today]
  );

  // LOs that pass the active filter but have no licensed states yet. These
  // would silently fail to match any state click, so we surface them in a
  // dedicated section instead of hiding them entirely.
  const unmappedLOs = useMemo(
    () => activeLOs.filter((lo) => {
      try {
        const states: string[] = JSON.parse(lo.licensedStates || "[]");
        return states.length === 0;
      } catch { return true; }
    }),
    [activeLOs]
  );

  const { user } = useAuth();
  const myRole = (user as any)?.role ?? null;
  const isAdminOrManager = myRole === "admin" || myRole === "manager";

  // Filter state list by search
  const filteredStates = useMemo(() => {
    const q = stateSearch.toLowerCase();
    return ALL_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q)
    );
  }, [stateSearch]);

  // LOs licensed in selected state (active + not snoozed only)
  const licensedLOs = useMemo(() => {
    if (!selectedState) return [];
    return activeLOs.filter((lo) => {
      try {
        const states: string[] = JSON.parse(lo.licensedStates || "[]");
        return states.some(
          (s) =>
            s.trim().toUpperCase() === selectedState.abbr ||
            s.trim().toLowerCase() === selectedState.name.toLowerCase()
        );
      } catch {
        return false;
      }
    });
  }, [activeLOs, selectedState]);

  // Build coverage count map — active LOs only
  const coverageMap = useMemo(() => {
    const map: Record<string, number> = {};
    activeLOs.forEach((lo) => {
      try {
        const states: string[] = JSON.parse(lo.licensedStates || "[]");
        states.forEach((s) => {
          const abbr = s.trim().toUpperCase();
          map[abbr] = (map[abbr] || 0) + 1;
        });
      } catch {}
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

      {/* Data-hygiene banner: surface any active LOs that have no licensed
         states. Admins/managers see a Fix link; CLRs just see a notice. */}
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
          {isAdminOrManager && (
            <Link href="/directory">
              <Button variant="outline" size="sm" className="shrink-0">
                Open Directory
              </Button>
            </Link>
          )}
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
          <UsStateTileMap
            coverage={coverageMap}
            selectedAbbr={selectedState?.abbr ?? null}
            onSelect={handleStateSelect}
          />
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
                      isSelected ? "bg-primary/8 font-semibold" : ""
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
                      Update an LO's licensed states in the Directory.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {licensedLOs
                    .sort((a, b) => a.priorityTier - b.priorityTier)
                    .map((lo) => {
                      const allStates: string[] = (() => {
                        try { return JSON.parse(lo.licensedStates || "[]"); } catch { return []; }
                      })();
                      return (
                        <Card key={lo.id} className={lo.internalStatus !== "active" ? "opacity-60" : ""}>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm">{lo.fullName}</span>
                                  <Badge className={`text-xs ${TIER_COLORS[lo.priorityTier]}`}>
                                    {TIER_LABELS[lo.priorityTier]}
                                  </Badge>
                                  {lo.internalStatus !== "active" && (
                                    <Badge variant="outline" className="text-xs capitalize text-muted-foreground">
                                      {lo.internalStatus}
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
         LOs don’t silently disappear from the Directory → State Lookup link. */}
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
              These loan officers are active in the directory but have no states selected,
              so they won’t show up when CLRs click a state on the map. {isAdminOrManager && (
                <Link href="/directory">
                  <span className="text-primary underline cursor-pointer">Open Directory</span>
                </Link>
              )} to fill in their licenses.
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
