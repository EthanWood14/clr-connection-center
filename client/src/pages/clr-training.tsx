/**
 * CLR Trainer Walkthrough — Matt Lane's two-week training plan, presented as a
 * readable article rather than a document someone has to download.
 *
 * The words are his. They used to be a constant in shared/clr-training.ts,
 * which meant the only way to fix a typo in his own plan was to open a pull
 * request; they now come from the server and he can edit them here. The
 * constant remains as the seed, so a fresh install and a failed request both
 * render the plan rather than an empty page.
 *
 * This file still only decides how the words are laid out: grouped by week,
 * each day split at lunch, and the end-of-day outcome pulled out as the thing
 * to measure against.
 */
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Award, ClipboardCheck, Coffee, GraduationCap, Pencil, Printer, RotateCcw, Sun, Sunset, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { TRAINING_DAYS, TRAINING_AUTHOR, type TrainingDay } from "@shared/clr-training";

interface ManualResp {
  days: TrainingDay[];
  authorName: string;
  savedAt: string | null;
  isSeed: boolean;
  canEdit: boolean;
}

/**
 * One day, editable.
 *
 * Steps are edited as lines in a textarea rather than as a list of inputs with
 * add/remove buttons. It is the same shape the writing already has — one
 * instruction per line — and it means reordering is a matter of moving a line
 * instead of clicking arrows.
 */
function DayEditor({ d, onChange }: { d: TrainingDay; onChange: (next: TrainingDay) => void }) {
  const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
  return (
    <Card className="overflow-hidden" data-testid={`training-edit-day-${d.day}`}>
      <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
          {d.day}
        </span>
        <h3 className="text-base font-bold">Day {d.day}</h3>
        <Badge variant="outline" className="ml-auto text-[10px]">Week {d.week}</Badge>
      </div>
      <CardContent className="space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Morning — one step per line
          </span>
          <Textarea
            rows={Math.max(4, d.morning.length + 1)}
            defaultValue={d.morning.join("\n")}
            onBlur={(e) => onChange({ ...d, morning: lines(e.target.value) })}
            data-testid={`training-edit-morning-${d.day}`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lunch note</span>
          <Input
            defaultValue={d.lunchNote}
            onBlur={(e) => onChange({ ...d, lunchNote: e.target.value })}
            data-testid={`training-edit-lunch-${d.day}`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Afternoon — one step per line
          </span>
          <Textarea
            rows={Math.max(4, d.afternoon.length + 1)}
            defaultValue={d.afternoon.join("\n")}
            onBlur={(e) => onChange({ ...d, afternoon: lines(e.target.value) })}
            data-testid={`training-edit-afternoon-${d.day}`}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">By end of day</span>
          <Textarea
            rows={2}
            defaultValue={d.eod}
            onBlur={(e) => onChange({ ...d, eod: e.target.value })}
            data-testid={`training-edit-eod-${d.day}`}
          />
        </label>
      </CardContent>
    </Card>
  );
}

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
  const { toast } = useToast();
  const [week, setWeek] = useState<1 | 2 | "all">("all");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<TrainingDay[] | null>(null);

  const { data } = useQuery<ManualResp>({
    queryKey: ["/api/training-manual"],
    queryFn: () => apiRequest("GET", "/api/training-manual"),
  });

  // The seed is the fallback, not a placeholder: a failed request should show
  // the plan rather than an empty page to someone trying to train a new hire.
  const days = data?.days?.length ? data.days : TRAINING_DAYS;
  const authorName = data?.authorName || TRAINING_AUTHOR;
  const canEdit = !!data?.canEdit;

  useEffect(() => { if (!editing) setDraft(null); }, [editing]);
  const working = draft ?? days;

  const save = useMutation({
    mutationFn: (next: TrainingDay[]) => apiRequest("PUT", "/api/training-manual", { days: next }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/training-manual"] });
      setEditing(false);
      setDraft(null);
      toast({ title: "Training plan saved", description: "Everyone sees the new version straight away." });
    },
    onError: (e: Error) => toast({ title: "Could not save", description: e.message, variant: "destructive" }),
  });

  const shown = working.filter((d) => week === "all" || d.week === week);

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
            <p className="text-xs text-muted-foreground">
              {working.length} days · quizzes throughout
              {data && !data.isSeed && data.savedAt
                ? ` · last edited by ${authorName} on ${String(data.savedAt).slice(0, 10)}`
                : ""}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 print:hidden">
            {canEdit && !editing && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)} data-testid="training-edit">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
            {canEdit && editing && (
              <>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setEditing(false)} data-testid="training-cancel">
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  disabled={save.isPending || !draft}
                  onClick={() => draft && save.mutate(draft)}
                  data-testid="training-save"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {save.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap gap-2 print:hidden" data-testid="training-week-filter">
        {([["all", "All 10 days"], [1, "Week 1"], [2, "Week 2"]] as const).map(([v, label]) => (
          <Button key={String(v)} size="sm" variant={week === v ? "default" : "outline"} onClick={() => setWeek(v as any)}>
            {label}
          </Button>
        ))}
        <div className="ml-auto hidden items-center gap-1 sm:flex">
          {working.map((d) => (
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

      {editing && (
        <div className="space-y-4" data-testid="training-editor">
          <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Each line is one step. Blank lines are dropped. Changes are saved for
            everyone the moment you press Save, and every previous version is kept.
          </p>
          {working.map((d) => (
            <DayEditor
              key={d.day}
              d={d}
              onChange={(next) => setDraft((prev) => (prev ?? days).map((x) => (x.day === next.day ? next : x)))}
            />
          ))}
        </div>
      )}

      {!editing && ([1, 2] as const).map((w) =>
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
