import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Search, Copy, Phone, Mail, User, ChevronRight } from "lucide-react";

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
        navigator.clipboard.writeText(value).then(() => {
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

  const { data: allLOs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

  // Filter state list by search
  const filteredStates = useMemo(() => {
    const q = stateSearch.toLowerCase();
    return ALL_STATES.filter(
      (s) => s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q)
    );
  }, [stateSearch]);

  // LOs licensed in selected state
  const licensedLOs = useMemo(() => {
    if (!selectedState) return [];
    return allLOs.filter((lo) => {
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
  }, [allLOs, selectedState]);

  // Build coverage count map for all states
  const coverageMap = useMemo(() => {
    const map: Record<string, number> = {};
    allLOs.forEach((lo) => {
      try {
        const states: string[] = JSON.parse(lo.licensedStates || "[]");
        states.forEach((s) => {
          const abbr = s.trim().toUpperCase();
          map[abbr] = (map[abbr] || 0) + 1;
        });
      } catch {}
    });
    return map;
  }, [allLOs]);

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

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* ── Left panel: state list ── */}
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
                    onClick={() => setSelectedState(state)}
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
        <div className="space-y-4">
          {!selectedState ? (
            <Card>
              <CardContent className="py-16 text-center">
                <MapPin className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
                <p className="text-muted-foreground text-sm">Select a state to see licensed LOs</p>
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
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  NMLS #{lo.nmlsId}
                                </p>
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
    </div>
  );
}
