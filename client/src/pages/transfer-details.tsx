import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronDown, ChevronRight, FileText, Search, AlertTriangle, Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { businessTodayClient } from "@/lib/business-day";

/**
 * What was actually written on each transfer.
 *
 * The score has been visible for a while; the write-up behind it has not, so
 * "76%" has been a number nobody could check. Every row here opens to the
 * answers as they were entered, with the blanks left visible — the gaps are
 * what a manager came to look at.
 *
 * Read-only on purpose. Nothing on this page edits a transfer.
 */

type DetailField = {
  label: string; value: string | null; expected: boolean;
  qualification: boolean; applicable: boolean;
};
type Detail = {
  fields: DetailField[];
  extras: DetailField[];
  narrative: { label: string; value: string }[];
  score: { percent: number | null; filled: number; expected: number; missing: string[] };
  missing: string[];
};
type Row = {
  id: number; date: string; borrowerName: string; phoneNumber: string;
  leadSource: string; transferType: string; clrName: string; loName: string;
  loaName: string; shotgunSenderName: string; summary: string; detail: Detail;
};

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "This month" },
  { key: "quarter", label: "Last 90 days" },
] as const;

function rangeDates(key: string): { from: string; to: string } {
  const to = businessTodayClient();
  const d = new Date(`${to}T12:00:00`);
  const back = (n: number) => {
    const x = new Date(d); x.setDate(x.getDate() - n);
    return x.toISOString().slice(0, 10);
  };
  if (key === "today") return { from: to, to };
  if (key === "week") return { from: back(6), to };
  if (key === "quarter") return { from: back(89), to };
  return { from: `${to.slice(0, 7)}-01`, to };
}

/** Green when a write-up is complete, red when the basics are missing. */
function scoreTone(percent: number): string {
  if (percent >= 90) return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (percent >= 70) return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
}

function FieldGrid({ fields }: { fields: DetailField[] }) {
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.label} className="flex items-baseline gap-2 text-sm">
          <span className={`shrink-0 text-xs ${f.qualification && f.applicable ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
            {f.label}
          </span>
          {f.value !== null ? (
            <span className="min-w-0 break-words">{f.value}</span>
          ) : !f.applicable ? (
            // A section marked n/a is not a gap — the marker line in "Also
            // entered" says why, and the score already excused it.
            <span className="text-xs italic text-muted-foreground/50">not applicable</span>
          ) : (
            // The blank is the point. A missing qualification answer is the one
            // an LO needed first, so it is called out rather than greyed away.
            <span className={`text-xs italic ${f.qualification ? "text-red-600 dark:text-red-400" : "text-muted-foreground/60"}`}>
              {f.qualification ? "never answered" : "blank"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function TransferCard({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const d = row.detail;
  const missingQuals = d.fields.filter((f) => f.qualification && f.applicable && f.value === null).length;
  const percent = d.score.percent;

  return (
    <Card>
      <CardContent className="p-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/40"
        >
          {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.borrowerName || "(no name)"}</span>
              {percent !== null && (
                <Badge className={`text-xs ${scoreTone(percent)}`}>{percent}%</Badge>
              )}
              {missingQuals > 0 && (
                <Badge variant="destructive" className="gap-1 text-xs">
                  <AlertTriangle className="h-3 w-3" />
                  {missingQuals} qualification {missingQuals === 1 ? "answer" : "answers"} missing
                </Badge>
              )}
              {row.shotgunSenderName && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Users className="h-3 w-3" />off {row.shotgunSenderName}'s shotgun
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {row.date} · {row.clrName || "—"} → {row.loName || "no LO"}
              {row.loaName ? ` (LOA ${row.loaName})` : ""}
              {row.leadSource ? ` · ${row.leadSource}` : ""}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">{row.summary}</div>
          </div>
        </button>

        {open && (
          <div className="space-y-4 border-t px-4 pb-4 pt-3">
            <FieldGrid fields={d.fields} />

            {d.extras.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Also entered</div>
                <FieldGrid fields={d.extras} />
              </div>
            )}

            {d.narrative.map((n) => (
              <div key={n.label}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{n.label}</div>
                <p className="whitespace-pre-wrap text-sm">{n.value}</p>
              </div>
            ))}

            {d.narrative.length === 0 && (
              <p className="text-xs italic text-muted-foreground">Nothing was written in their own words on this one.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TransferDetails() {
  const { user } = useAuth();
  const isManager = !!(user?.isManager || user?.role === "admin");
  const [range, setRange] = useState<string>("week");
  const [who, setWho] = useState<string>("all");
  const [term, setTerm] = useState("");

  const { from, to } = rangeDates(range);

  // The window is fetched once and the person filter is applied here, so the
  // dropdown still lists everybody after you pick one of them — filtering
  // server-side would narrow the list to the person already chosen.
  const { data, isLoading } = useQuery<{ transfers: Row[]; truncated?: boolean }>({
    queryKey: ["/api/transfers/written", from, to],
    queryFn: async () => {
      const res = await fetch(`/api/transfers/written?from=${from}&to=${to}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load transfers");
      return res.json();
    },
  });

  const rows = data?.transfers ?? [];
  const people = useMemo(
    () => Array.from(new Set(rows.map((r) => r.clrName).filter(Boolean))).sort(),
    [rows],
  );

  // Search covers what was written, not just the borrower's name — the point of
  // the page is the text, so looking something up in it should work too.
  const shown = useMemo(() => {
    const q = term.trim().toLowerCase();
    const mine = who === "all" ? rows : rows.filter((r) => r.clrName === who);
    if (!q) return mine;
    return mine.filter((r) => {
      const hay = [
        r.borrowerName, r.phoneNumber, r.clrName, r.loName, r.loaName, r.leadSource,
        ...r.detail.fields.map((f) => f.value ?? ""),
        ...r.detail.extras.map((f) => `${f.label} ${f.value ?? ""}`),
        ...r.detail.narrative.map((n) => n.value),
      ].join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [rows, term, who]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FileText className="h-6 w-6" /> Transfer write-ups
        </h1>
        <p className="text-sm text-muted-foreground">
          {isManager
            ? "Everything entered on each transfer. Open a row to read it."
            : "Everything you entered on each of your transfers."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RANGES.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>

        {isManager && (
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Everyone" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              {people.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search names, numbers, or anything written"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : shown.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">
          {rows.length === 0 ? "No transfers in this window." : "Nothing written matches that."}
        </CardContent></Card>
      ) : (
        <>
          <div className="text-xs text-muted-foreground">
            {shown.length} transfer{shown.length === 1 ? "" : "s"}
            {rows.length !== shown.length ? ` of ${rows.length}` : ""}
            {data?.truncated ? " · showing the most recent only — narrow the dates to see the rest" : ""}
          </div>
          <div className="space-y-2">
            {shown.map((r) => <TransferCard key={r.id} row={r} />)}
          </div>
        </>
      )}
    </div>
  );
}
