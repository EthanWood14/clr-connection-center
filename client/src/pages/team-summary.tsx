import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { dropWeekendRows } from "@/lib/weekday-date";

/**
 * The team's week, in words anybody can read.
 *
 * The dashboard we had is the Advanced one now: forty-odd tiles, nine range
 * selectors, stacked-percentage charts, a benchmark line with a documented
 * absence rule. It is the right page for somebody digging. It is the wrong
 * page for the other twenty-nine people, who open it, do not know whether
 * "conversion rate" is theirs or the team's, and close it.
 *
 * So this page answers four questions and stops: how many borrowers did we get
 * to a loan officer, is that better or worse than last week, how is the month
 * going, and who did it. Every number carries the sentence that says what it
 * means — an eighth grader is the bar (Ethan, 9 Sep 2026).
 *
 * SAME DATA, SAME ENDPOINT. It reads /api/manager-dashboard, which is already
 * open to the whole internal team and closed to portal accounts. A second
 * source would eventually disagree with the first, and then nobody would trust
 * either one. Nothing here is new maths: no rates, no percentages of
 * percentages, no pace-adjusted anything. Counts, and the difference between
 * two counts.
 */

type Period = { transfers: number; appointments: number; fellThrough: number; total: number };
type Calls = { calls: number; contacts: number; conversations: number };

type SummaryData = {
  today: string;
  stats: { today: any; week: Period; month: Period; priorWeek: Period; priorMonth: Period };
  callActivity: { week: Calls; priorWeek: Calls; month: Calls; priorMonth: Calls };
  eod: { submitted: number; total: number; missing: number; dueLabel: string };
  byRange: Record<string, {
    trend?: { date: string; calls: number; transfers: number; appointments: number; fellThrough: number }[];
    leaderboard: { userId: number; name: string; transfers: number; appointments: number; inTraining: boolean }[];
  }>;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/**
 * The change since last week, said the way a person would say it.
 *
 * Deliberately not a percentage. "Up 12.5%" on a base of 8 is one transfer,
 * and reading a percentage as a number is exactly the mistake this page exists
 * to stop somebody making.
 */
function change(now: number, before: number, unit: string): { text: string; tone: "up" | "down" | "flat" } {
  const diff = now - before;
  if (diff === 0) return { text: `Same as last week (${before}).`, tone: "flat" };
  const word = Math.abs(diff) === 1 ? unit : `${unit}s`;
  return diff > 0
    ? { text: `${diff} more ${word} than last week (${before}).`, tone: "up" }
    : { text: `${Math.abs(diff)} fewer ${word} than last week (${before}).`, tone: "down" };
}

/** Down is good for fell-through, so tone is decided by the caller, not the sign. */
function invert(tone: "up" | "down" | "flat"): "up" | "down" | "flat" {
  return tone === "up" ? "down" : tone === "down" ? "up" : "flat";
}

const TONE_CLASS: Record<string, string> = {
  up: "text-green-700 dark:text-green-400",
  down: "text-amber-700 dark:text-amber-400",
  flat: "text-muted-foreground",
};

function BigNumber({
  value, title, meaning, note, tone,
}: { value: number; title: string; meaning: string; note?: string; tone?: "up" | "down" | "flat" }) {
  return (
    <Card data-testid={`summary-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
      <CardContent className="p-5">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-4xl font-bold tabular-nums brand-text">{value.toLocaleString()}</p>
        <p className="mt-2 text-sm leading-snug text-muted-foreground">{meaning}</p>
        {note && <p className={`mt-2 text-sm font-medium ${TONE_CLASS[tone ?? "flat"]}`}>{note}</p>}
      </CardContent>
    </Card>
  );
}

const GOLD = "#C9A24A";
const GREEN = "#16a34a";
const BLUE = "#2563eb";
const AMBER = "#d97706";

/**
 * Two charts, and only two.
 *
 * The Advanced page has nine. That is the right number for somebody digging
 * and the wrong number for a page whose job is to be understood at a glance,
 * so these answer the two questions the numbers above raise and stop: is the
 * line going up, and how does this week compare with last.
 *
 * Both are bars. A line implies a continuous quantity between the points, and
 * there is no such thing as Tuesday-and-a-half — the bar says "this day, this
 * many" and cannot be misread. Weekends are dropped rather than drawn as
 * zeroes, because a fortnight of alternating spikes and troughs looks like a
 * problem and is only the calendar.
 */
function DailyChart({ rows }: { rows: { date: string; transfers: number }[] }) {
  if (rows.length < 2) return null;
  const busiest = Math.max(...rows.map((r) => r.transfers));
  return (
    <Card data-testid="summary-chart-daily">
      <CardContent className="p-5">
        <p className="text-sm font-semibold">Borrowers handed over, day by day</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The last {rows.length} working days. Weekends are left out.
          {busiest > 0 && ` The best day was ${busiest}.`}
        </p>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ opacity: 0.1 }}
                formatter={(value: any) => [`${value} handed over`, ""]}
                labelFormatter={(label: any) => String(label)}
              />
              {/* The best day is picked out, so the eye has somewhere to land. */}
              <Bar dataKey="transfers" radius={[3, 3, 0, 0]}>
                {rows.map((r) => (
                  <Cell key={r.date} fill={r.transfers === busiest && busiest > 0 ? GREEN : GOLD} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function WeekOverWeekChart({ week, priorWeek }: { week: Period; priorWeek: Period }) {
  const rows = [
    { label: "Handed over", "This week": n(week.transfers), "Last week": n(priorWeek.transfers) },
    { label: "Callbacks", "This week": n(week.appointments), "Last week": n(priorWeek.appointments) },
    { label: "Did not work out", "This week": n(week.fellThrough), "Last week": n(priorWeek.fellThrough) },
  ];
  if (rows.every((r) => r["This week"] === 0 && r["Last week"] === 0)) return null;
  return (
    <Card data-testid="summary-chart-week-over-week">
      <CardContent className="p-5">
        <p className="text-sm font-semibold">This week against last week</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Darker is this week. The two bars are counts, so a taller one is simply more.
        </p>
        <div className="mt-4 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ opacity: 0.1 }} />
              <Bar dataKey="Last week" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
              <Bar dataKey="This week" fill={BLUE} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TeamSummary() {
  const { data, isLoading } = useQuery<SummaryData>({
    queryKey: ["/api/manager-dashboard"],
    refetchInterval: 60_000,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-12 w-80" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      </div>
    );
  }

  const week = data.stats?.week ?? ({} as Period);
  const priorWeek = data.stats?.priorWeek ?? ({} as Period);
  const month = data.stats?.month ?? ({} as Period);
  const priorMonth = data.stats?.priorMonth ?? ({} as Period);
  const calls = data.callActivity?.week ?? ({} as Calls);
  const priorCalls = data.callActivity?.priorWeek ?? ({} as Calls);

  const transfers = n(week.transfers);
  const transferChange = change(transfers, n(priorWeek.transfers), "borrower");
  const monthDiff = n(month.transfers) - n(priorMonth.transfers);

  // Who did it. Training rows stay in — the point is who worked, not who is
  // being measured — but they are labelled so nobody reads a small number as
  // a bad one.
  const people = (data.byRange?.week?.leaderboard ?? [])
    .filter((r) => n(r.transfers) > 0)
    .sort((a, b) => n(b.transfers) - n(a.transfers));
  const most = n(people[0]?.transfers) || 1;

  const eod = data.eod ?? { submitted: 0, total: 0, missing: 0, dueLabel: "" };

  // Working days only, most recent twenty. The 30-day block is the widest the
  // endpoint returns without asking for more; twenty bars is about as many as
  // stay readable at phone width.
  const daily = dropWeekendRows(data.byRange?.["30d"]?.trend ?? [], "date")
    .slice(-20)
    .map((d) => ({ date: d.date, transfers: n(d.transfers), label: format(parseISO(d.date), "MMM d") }));

  return (
    <div className="space-y-6 p-4 md:p-6" data-testid="page-team-summary">
      <div>
        <h1 className="text-2xl font-bold brand-text md:text-3xl">How the team is doing</h1>
        <p className="text-sm text-muted-foreground">
          The last 7 days · {data.today ? format(parseISO(data.today), "EEEE, MMMM d, yyyy") : ""}
        </p>
      </div>

      {/* The one sentence. If somebody reads nothing else on this page, this. */}
      <Card className="border-2">
        <CardContent className="p-6">
          <p className="text-lg leading-relaxed">
            This week the team got{" "}
            <span className="text-3xl font-bold tabular-nums brand-text">{transfers}</span>{" "}
            {transfers === 1 ? "borrower" : "borrowers"} onto the phone with a loan officer.
          </p>
          <p className={`mt-2 text-base font-medium ${TONE_CLASS[transferChange.tone]}`} data-testid="summary-headline-change">
            {transferChange.text}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <BigNumber
          title="Calls made"
          value={n(calls.calls)}
          meaning="Every number we dialled this week."
          {...(() => { const c = change(n(calls.calls), n(priorCalls.calls), "call"); return { note: c.text, tone: c.tone }; })()}
        />
        <BigNumber
          title="People who picked up"
          value={n(calls.contacts)}
          meaning="Of those calls, the ones where somebody answered."
          {...(() => { const c = change(n(calls.contacts), n(priorCalls.contacts), "person"); return { note: c.text, tone: c.tone }; })()}
        />
        <BigNumber
          title="Handed to a loan officer"
          value={transfers}
          meaning="We had the borrower on the line and passed them straight over. This is the thing the team is here to do."
          note={transferChange.text}
          tone={transferChange.tone}
        />
        <BigNumber
          title="Callbacks booked"
          value={n(week.appointments)}
          meaning="The borrower could not talk right then, so we set a time for the loan officer to call them."
          {...(() => { const c = change(n(week.appointments), n(priorWeek.appointments), "callback"); return { note: c.text, tone: c.tone }; })()}
        />
        <BigNumber
          title="Did not work out"
          value={n(week.fellThrough)}
          meaning="We got them talking, and it went nowhere. Some of these are normal — nobody has a week without them."
          {...(() => {
            const c = change(n(week.fellThrough), n(priorWeek.fellThrough), "lead");
            return { note: c.text, tone: invert(c.tone) };
          })()}
        />
        <BigNumber
          title="End-of-day reports in"
          value={n(eod.submitted)}
          meaning={`${n(eod.submitted)} of ${n(eod.total)} ${n(eod.total) === 1 ? "person has" : "people have"} sent theirs${eod.dueLabel ? ` (due ${eod.dueLabel})` : ""}.`}
          note={n(eod.missing) === 0 ? "Everyone is in." : `${n(eod.missing)} still to come.`}
          tone={n(eod.missing) === 0 ? "up" : "flat"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyChart rows={daily} />
        <WeekOverWeekChart week={week} priorWeek={priorWeek} />
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold">This month so far</p>
          <p className="mt-1 text-base leading-relaxed">
            <span className="text-2xl font-bold tabular-nums brand-text">{n(month.transfers)}</span>{" "}
            borrowers handed over, and{" "}
            <span className="text-2xl font-bold tabular-nums brand-text">{n(month.appointments)}</span>{" "}
            callbacks booked.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {monthDiff === 0
              ? `Last month at the end we had ${n(priorMonth.transfers)}.`
              : monthDiff > 0
                ? `That is ${monthDiff} more than all of last month (${n(priorMonth.transfers)}) — and the month is not over.`
                : `All of last month came to ${n(priorMonth.transfers)}, so there are ${Math.abs(monthDiff)} to go to match it.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold">Who handed over the most this week</p>
          {people.length === 0 ? (
            // Only "nobody" when the headline agrees. A page saying five up
            // top and nobody down here is a page nobody trusts twice, and the
            // two numbers come from different parts of the payload, so they
            // can disagree — a training-only week does it.
            <p className="mt-2 text-sm text-muted-foreground">
              {transfers === 0
                ? "Nobody has handed a borrower over yet this week."
                : "The per-person breakdown is not available for this week."}
            </p>
          ) : (
            <div className="mt-3 space-y-2" data-testid="summary-people">
              {people.map((p) => (
                <div key={p.userId} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm">
                    {p.name}
                    {p.inTraining && <span className="ml-1 text-[11px] text-muted-foreground">· learning</span>}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                    <div
                      className="h-full rounded"
                      style={{ width: `${Math.round((n(p.transfers) / most) * 100)}%`, backgroundColor: "#C9A24A" }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums">{n(p.transfers)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold">What the words mean</p>
          <dl className="mt-2 space-y-2 text-sm">
            <div>
              <dt className="font-medium">Handed over / transfer</dt>
              <dd className="text-muted-foreground">The borrower was on the phone and we passed the call to a loan officer right then.</dd>
            </div>
            <div>
              <dt className="font-medium">Callback / appointment</dt>
              <dd className="text-muted-foreground">The borrower agreed to a time for the loan officer to ring them back.</dd>
            </div>
            <div>
              <dt className="font-medium">Did not work out / fell through</dt>
              <dd className="text-muted-foreground">The conversation happened and did not lead anywhere.</dd>
            </div>
            <div>
              <dt className="font-medium">Picked up / contact</dt>
              <dd className="text-muted-foreground">Somebody answered the phone. Most dialled numbers do not.</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3 pb-2">
        <p className="text-sm text-muted-foreground">Need the charts, the ranges and the per-person breakdowns?</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/advanced-dashboard" data-testid="link-advanced-dashboard">
            Open the Advanced Dashboard <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
