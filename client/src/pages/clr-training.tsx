/**
 * CLR Trainer Walkthrough — Matt Lane's two-week training plan, presented as a
 * readable article rather than a document someone has to download.
 *
 * The words are his and are rendered verbatim from shared/clr-training.ts. This
 * file only decides how they are laid out: grouped by week, each day split at
 * lunch, and the end-of-day outcome pulled out as the thing to measure against.
 */
import { useState } from "react";
import { Award, ClipboardCheck, Coffee, GraduationCap, Printer, Sun, Sunset } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TRAINING_DAYS, TRAINING_AUTHOR, type TrainingDay } from "@shared/clr-training";

function Step({ text }: { text: string }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
      <span className="text-sm text-foreground/90">{text}</span>
    </li>
  );
}

function DayCard({ d }: { d: TrainingDay }) {
  return (
    <Card id={`day-${d.day}`} className="scroll-mt-24 overflow-hidden" data-testid={`training-day-${d.day}`}>
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {d.day}
        </span>
        <h3 className="text-base font-bold">Day {d.day}</h3>
        <Badge variant="outline" className="ml-auto text-[10px]">Week {d.week}</Badge>
      </div>

      <CardContent className="space-y-4 p-4 sm:p-5">
        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sun className="h-3.5 w-3.5" /> Morning
          </p>
          <ul className="space-y-2">{d.morning.map((t, i) => <Step key={i} text={t} />)}</ul>
        </section>

        {/* The plan marks lunch explicitly, and the split is genuinely useful:
            it is how a trainer paces the day. */}
        <div className="flex items-center gap-2 py-0.5" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          <span className="flex items-center gap-1 text-[11px] italic text-muted-foreground">
            <Coffee className="h-3 w-3" /> {d.lunchNote}
          </span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <section>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sunset className="h-3.5 w-3.5" /> Afternoon
          </p>
          <ul className="space-y-2">{d.afternoon.map((t, i) => <Step key={i} text={t} />)}</ul>
        </section>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
          <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            <ClipboardCheck className="h-3.5 w-3.5" /> By end of day
          </p>
          <p className="text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">{d.eod}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ClrTraining() {
  const [week, setWeek] = useState<1 | 2 | "all">("all");
  const shown = TRAINING_DAYS.filter((d) => week === "all" || d.week === week);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 print:max-w-none">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <GraduationCap className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Training</span>
        </div>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">CLR Trainer Walkthrough</h1>
        <p className="text-lg text-muted-foreground">
          A two-week plan for taking a new CLR from their first office tour to a certified transfer.
        </p>

        {/* Attribution up front, where a byline belongs — this is his work. */}
        <div className="flex flex-wrap items-center gap-3 border-y py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            ML
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" data-testid="training-author">Written by {TRAINING_AUTHOR}</p>
            <p className="text-xs text-muted-foreground">10 days · {TRAINING_DAYS.length} end-of-day checkpoints · quizzes throughout</p>
          </div>
          <Button size="sm" variant="outline" className="ml-auto gap-1.5 print:hidden" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 print:hidden" data-testid="training-week-filter">
        {([["all", "All 10 days"], [1, "Week 1"], [2, "Week 2"]] as const).map(([v, label]) => (
          <Button key={String(v)} size="sm" variant={week === v ? "default" : "outline"} onClick={() => setWeek(v as any)}>
            {label}
          </Button>
        ))}
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          {TRAINING_DAYS.map((d) => (
            <a
              key={d.day}
              href={`#day-${d.day}`}
              className="flex h-7 w-7 items-center justify-center rounded-md border text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            >
              {d.day}
            </a>
          ))}
        </div>
      </div>

      {([1, 2] as const).map((w) =>
        shown.some((d) => d.week === w) ? (
          <section key={w} className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold">Week {w}</h2>
              <span className="text-xs text-muted-foreground">
                {w === 1 ? "Systems, language, and the first live transfers" : "Depth, compliance, and certification"}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {shown.filter((d) => d.week === w).map((d) => <DayCard key={d.day} d={d} />)}
          </section>
        ) : null,
      )}

      {/* The plan's day-10 final test, as an actual test. */}
      <a
        href="#/clr-training/test"
        className="flex items-center gap-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10 print:hidden"
        data-testid="link-certification-test"
      >
        <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Take the certification test</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            60 questions from these two weeks. 54 correct (90%) to pass.
          </p>
        </div>
        <span className="ml-auto text-sm font-medium text-primary">Start →</span>
      </a>

      <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
        <Award className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <p className="text-sm font-semibold">Day 10 ends with a certification call.</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The trainee dials until they land a transfer, unassisted, with every step completed — down to logging it in C3.
          </p>
        </div>
      </div>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        Written by {TRAINING_AUTHOR} · West Capital Lending
      </p>
    </div>
  );
}
