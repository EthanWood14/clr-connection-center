import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Clock, Search, AlertCircle, CheckCircle2, XCircle,
  Info, ExternalLink, Calendar, ShieldAlert, Filter
} from "lucide-react";
import { STATE_CALL_RULES, type StateCallRule } from "@/data/state-call-hours";
import { HelpIcon } from "@/components/onboarding";

// IANA timezone for each state's primary calling window. For multi-tz states
// (FL, KY, IN, MI, ND, SD, TN, TX, KS, NE, OR) this picks the most populous
// zone — local-time math is approximate near tz boundaries; the page surfaces
// a note about that. CLRs should always confirm with the lead's actual area
// code or address before calling close to the cutoff.
const STATE_TIMEZONE: Record<string, string> = {
  AL: "America/Chicago",     AK: "America/Anchorage",   AZ: "America/Phoenix",
  AR: "America/Chicago",     CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York",    DE: "America/New_York",    DC: "America/New_York",
  FL: "America/New_York",    GA: "America/New_York",    HI: "Pacific/Honolulu",
  ID: "America/Boise",       IL: "America/Chicago",     IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",     KS: "America/Chicago",     KY: "America/New_York",
  LA: "America/Chicago",     ME: "America/New_York",    MD: "America/New_York",
  MA: "America/New_York",    MI: "America/Detroit",     MN: "America/Chicago",
  MS: "America/Chicago",     MO: "America/Chicago",     MT: "America/Denver",
  NE: "America/Chicago",     NV: "America/Los_Angeles", NH: "America/New_York",
  NJ: "America/New_York",    NM: "America/Denver",      NY: "America/New_York",
  NC: "America/New_York",    ND: "America/Chicago",     OH: "America/New_York",
  OK: "America/Chicago",     OR: "America/Los_Angeles", PA: "America/New_York",
  RI: "America/New_York",    SC: "America/New_York",    SD: "America/Chicago",
  TN: "America/Chicago",     TX: "America/Chicago",     UT: "America/Denver",
  VT: "America/New_York",    VA: "America/New_York",    WA: "America/Los_Angeles",
  WV: "America/New_York",    WI: "America/Chicago",     WY: "America/Denver",
};

const MULTI_TZ_STATES = new Set(["FL", "KY", "IN", "MI", "ND", "SD", "TN", "TX", "KS", "NE", "OR", "AK", "ID"]);

// Returns hour, minute, day-of-week (0=Sun..6=Sat) for the given IANA tz
function localPartsFor(tz: string): { hour: number; minute: number; dow: number; label: string } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    });
    const parts = fmt.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
    const wd = parts.find(p => p.type === "weekday")?.value ?? "Mon";
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dow = dowMap[wd] ?? 1;
    const display = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      weekday: "short",
    }).format(new Date());
    return { hour, minute, dow, label: display };
  } catch {
    return { hour: 0, minute: 0, dow: 1, label: "—" };
  }
}

function parseHour(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(n => parseInt(n, 10));
  return h * 60 + (m || 0);
}

type CallStatus = "allowed" | "prohibited" | "unknown";
interface CallStatusResult {
  status: CallStatus;
  reason: string;
  localTime: string;
}

function computeStatus(rule: StateCallRule): CallStatusResult {
  const tz = STATE_TIMEZONE[rule.state];
  if (!tz) return { status: "unknown", reason: "Timezone not configured", localTime: "—" };
  const { hour, minute, dow, label } = localPartsFor(tz);
  const minutesNow = hour * 60 + minute;
  const startMin = parseHour(rule.start_hour);
  const endMin = parseHour(rule.end_hour);

  // Sunday entirely prohibited?
  if (dow === 0 && rule.sunday_rule.toUpperCase().includes("PROHIBITED")) {
    return { status: "prohibited", reason: "Sunday calls prohibited in this state", localTime: label };
  }

  // Outside permitted window?
  if (minutesNow < startMin) {
    return {
      status: "prohibited",
      reason: `Too early — calls allowed starting ${rule.start_hour} local time`,
      localTime: label,
    };
  }
  if (minutesNow >= endMin) {
    return {
      status: "prohibited",
      reason: `Too late — calls must end by ${rule.end_hour} local time`,
      localTime: label,
    };
  }

  return {
    status: "allowed",
    reason: `Within permitted window (${rule.start_hour}–${rule.end_hour})`,
    localTime: label,
  };
}

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(n => parseInt(n, 10));
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, "0")}${ampm}`;
}

// ── State row card ───────────────────────────────────────────────────────────
function StateRow({ rule, tick }: { rule: StateCallRule; tick: number }) {
  // tick is just a re-render trigger — recomputes status every minute
  const status = useMemo(() => computeStatus(rule), [rule, tick]);
  const [expanded, setExpanded] = useState(false);

  const statusColor =
    status.status === "allowed" ? "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700" :
    status.status === "prohibited" ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700" :
    "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600";

  const StatusIcon =
    status.status === "allowed" ? CheckCircle2 :
    status.status === "prohibited" ? XCircle : AlertCircle;

  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="w-full text-left hover:bg-muted/30 transition-colors"
        data-testid={`state-row-${rule.state}`}
      >
        <div className="flex items-center gap-3 p-3">
          {/* State abbr pill */}
          <div className="w-12 h-12 rounded-lg bg-primary/10 flex flex-col items-center justify-center shrink-0">
            <span className="text-base font-bold text-primary leading-none">{rule.state}</span>
          </div>

          {/* Name + window */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold truncate">{rule.name}</span>
              {rule.stricter_than_tcpa && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-400 text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="w-2.5 h-2.5 mr-0.5" />
                  Stricter than TCPA
                </Badge>
              )}
              {MULTI_TZ_STATES.has(rule.state) && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-300 text-blue-700 dark:text-blue-400">
                  Multi-TZ
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
              <Clock className="w-3 h-3" />
              <span>{fmt12(rule.start_hour)}–{fmt12(rule.end_hour)} local</span>
              {rule.sunday_rule.toUpperCase().includes("PROHIBITED") && (
                <span className="text-red-600 dark:text-red-400 font-medium">· No Sundays</span>
              )}
              {rule.holidays_prohibited.length > 0 && (
                <span className="text-amber-700 dark:text-amber-400">· {rule.holidays_prohibited.length} holiday{rule.holidays_prohibited.length === 1 ? "" : "s"} blocked</span>
              )}
            </div>
          </div>

          {/* Right: status badge */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Badge className={`text-xs px-2 py-0.5 border flex items-center gap-1 ${statusColor}`}>
              <StatusIcon className="w-3 h-3" />
              {status.status === "allowed" ? "Allowed now" : status.status === "prohibited" ? "Do not call" : "Unknown"}
            </Badge>
            <span className="text-[10px] text-muted-foreground">{status.localTime}</span>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-3 space-y-3 text-xs">
          {/* Reason / current status */}
          <div className={`rounded p-2 ${status.status === "allowed" ? "bg-green-50 dark:bg-green-900/10" : "bg-red-50 dark:bg-red-900/10"}`}>
            <div className="font-semibold mb-0.5">Right now</div>
            <div className="text-muted-foreground">{status.reason} · Lead local time: {status.localTime}</div>
          </div>

          {/* Days of week */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Saturday</div>
              <div>{rule.saturday_rule}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Sunday</div>
              <div className={rule.sunday_rule.toUpperCase().includes("PROHIBITED") ? "text-red-700 dark:text-red-400 font-medium" : ""}>
                {rule.sunday_rule}
              </div>
            </div>
          </div>

          {/* Holidays */}
          {rule.holidays_prohibited.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Prohibited holidays
              </div>
              <div className="flex flex-wrap gap-1">
                {rule.holidays_prohibited.map(h => (
                  <span key={h} className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1">
              <Info className="w-3 h-3" /> Notes
            </div>
            <p className="text-muted-foreground leading-relaxed">{rule.notes}</p>
          </div>

          {/* Source link */}
          <div>
            <a
              href={rule.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
              data-testid={`source-link-${rule.state}`}
            >
              View statute / source <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CallHours() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "allowed" | "prohibited" | "stricter">("all");
  const [tick, setTick] = useState(0);

  // Re-render every 60 seconds so "Allowed now" badges update without refresh.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return STATE_CALL_RULES.filter(r => {
      if (q && !r.name.toLowerCase().includes(q) && !r.state.toLowerCase().includes(q)) return false;
      if (filter === "stricter" && !r.stricter_than_tcpa) return false;
      if (filter === "allowed" || filter === "prohibited") {
        const s = computeStatus(r).status;
        if (s !== filter) return false;
      }
      return true;
    });
  }, [search, filter, tick]);

  // Counts for filter buttons
  const counts = useMemo(() => {
    let allowed = 0, prohibited = 0;
    for (const r of STATE_CALL_RULES) {
      const s = computeStatus(r).status;
      if (s === "allowed") allowed++;
      else if (s === "prohibited") prohibited++;
    }
    return { allowed, prohibited };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const stricterCount = STATE_CALL_RULES.filter(r => r.stricter_than_tcpa).length;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Call Hours by State
            <HelpIcon title="Call Hours by State">
              Permitted call windows for every US state plus DC, in the lead's local time. Federal TCPA baseline is 8AM–9PM all days; many states are stricter. Status updates every minute. Always verify with the lead's actual area code or address before calling near a cutoff.
            </HelpIcon>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Federal TCPA baseline is 8AM–9PM in the lead's local time, every day. {stricterCount} states are stricter — check before calling.
          </p>
        </div>
      </div>

      {/* Compliance disclaimer */}
      <div className="rounded-lg border border-amber-300 bg-amber-50/70 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
          <span className="font-semibold">Reference only.</span> Call windows are computed from the state's primary timezone — multi-timezone states (Florida, Indiana, Michigan, Texas, etc.) may differ by a few minutes near boundaries. Some states have additional rules (frequency caps, established business relationship exemptions, state of emergency bans) summarized in each state's notes. Always confirm with West Capital's compliance team before relying on this for borderline calls. This tool does not constitute legal advice.
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search state or abbreviation…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-state-search"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
            className="text-xs h-9"
            data-testid="filter-all"
          >
            <Filter className="w-3 h-3 mr-1" />
            All ({STATE_CALL_RULES.length})
          </Button>
          <Button
            variant={filter === "allowed" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("allowed")}
            className="text-xs h-9"
            data-testid="filter-allowed"
          >
            <CheckCircle2 className="w-3 h-3 mr-1 text-green-600" />
            Allowed now ({counts.allowed})
          </Button>
          <Button
            variant={filter === "prohibited" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("prohibited")}
            className="text-xs h-9"
            data-testid="filter-prohibited"
          >
            <XCircle className="w-3 h-3 mr-1 text-red-600" />
            Off-hours ({counts.prohibited})
          </Button>
          <Button
            variant={filter === "stricter" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("stricter")}
            className="text-xs h-9"
            data-testid="filter-stricter"
          >
            <ShieldAlert className="w-3 h-3 mr-1 text-amber-600" />
            Stricter than TCPA ({stricterCount})
          </Button>
        </div>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No states match your filters.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {filtered.map(rule => (
            <StateRow key={rule.state} rule={rule} tick={tick} />
          ))}
        </div>
      )}

      {/* Source footer */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-primary" />
            About this data
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-2 pt-0 pb-4">
          <p>
            Sourced from state statutes (Justia Law, official legislative websites), state attorney general and DNC enforcement pages, and corroborated against ReadyMode (Nov 2025), CompliancePoint, ClickPoint, and TCPA Guide compliance summaries. Each state card links to its primary source.
          </p>
          <p>
            <strong>Updated:</strong> May 2026. State telemarketing rules change frequently — verify against current statute before relying on a borderline call.
          </p>
          <p>
            <strong>What this doesn't include:</strong> federal Do-Not-Call list checks, internal DNC list checks, prior-express-consent records, and frequency caps (some states cap calls per consumer per day or per topic). Run those checks separately.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
