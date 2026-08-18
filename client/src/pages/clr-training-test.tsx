/**
 * The 60-question certification test for Matt Lane's training plan.
 *
 * Grading happens on the server — the answer key never reaches this page before
 * submission. Afterwards the server returns the key with an explanation per
 * question, which is what the day-10 review conversation works from.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, GraduationCap, History, RotateCcw, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Question = { id: number; day: number; text: string; choices: string[] };
type TestPayload = { questions: Question[]; total: number; passCorrect: number; passPercent: number };
type Result = {
  correctCount: number; total: number; percent: number; passed: boolean;
  passCorrect: number; passPercent: number;
  results: { id: number; chosen: number | null; correct: number; isCorrect: boolean; why: string }[];
};
type Attempt = { id: number; user_name: string; taken_at: string; correct_count: number; total: number; percent: number; passed: number };

export default function ClrTrainingTest() {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<Result | null>(null);

  const { data, isLoading } = useQuery<TestPayload>({ queryKey: ["/api/training-test"] });
  const { data: history } = useQuery<{ attempts: Attempt[]; isManager: boolean }>({
    queryKey: ["/api/training-test/attempts"],
  });

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", "/api/training-test/attempts", { answers }),
    onSuccess: (r: Result) => {
      setResult(r);
      queryClient.invalidateQueries({ queryKey: ["/api/training-test/attempts"] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const questions = data?.questions ?? [];
  const answered = Object.keys(answers).length;
  const unanswered = useMemo(
    () => questions.filter((q) => answers[q.id] === undefined).map((q) => q.id),
    [questions, answers],
  );
  const byId = useMemo(() => new Map(result?.results.map((r) => [r.id, r])), [result]);

  function restart() {
    setAnswers({});
    setResult(null);
    window.scrollTo({ top: 0 });
  }

  if (isLoading) return <div className="mx-auto max-w-3xl space-y-3 p-6"><Skeleton className="h-40 w-full rounded-xl" /><Skeleton className="h-96 w-full rounded-xl" /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div>
        <Link href="/clr-training" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the walkthrough
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold sm:text-3xl">
          <GraduationCap className="h-6 w-6 text-primary" /> CLR Certification Test
        </h1>
        <p className="mt-1 text-muted-foreground">
          {data?.total} questions drawn from the two-week walkthrough. You need {data?.passCorrect} correct
          ({data?.passPercent}%) to pass.
        </p>
      </div>

      {result && (
        <Card
          className={`border-2 ${result.passed ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/25" : "border-amber-400 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/25"}`}
          data-testid="test-result"
        >
          <CardContent className="flex flex-wrap items-center gap-4 p-5">
            {result.passed
              ? <CheckCircle2 className="h-9 w-9 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-9 w-9 shrink-0 text-amber-600" />}
            <div className="min-w-0">
              <p className="text-xl font-bold">
                {result.correctCount} of {result.total} — {result.percent}%
              </p>
              <p className="text-sm text-muted-foreground">
                {result.passed
                  ? "Passed. Review the ones you missed below with your trainer."
                  : `Not passed — ${result.passCorrect} correct needed. Go through the misses below, then retake it.`}
              </p>
            </div>
            <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={restart}>
              <RotateCcw className="h-3.5 w-3.5" /> Retake
            </Button>
          </CardContent>
        </Card>
      )}

      {!result && (
        <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-all" style={{ width: `${(answered / (data?.total || 1)) * 100}%` }} />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{answered}/{data?.total}</span>
        </div>
      )}

      <div className="space-y-3">
        {questions.map((q, i) => {
          const r = byId.get(q.id);
          return (
            <Card key={q.id} id={`q-${q.id}`} className={r ? (r.isCorrect ? "border-emerald-300 dark:border-emerald-800" : "border-red-300 dark:border-red-800") : ""}>
              <CardContent className="space-y-2.5 p-4">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}.</span>
                  <p className="flex-1 text-sm font-medium leading-snug">{q.text}</p>
                  <Badge variant="outline" className="shrink-0 text-[10px]">Day {q.day}</Badge>
                </div>

                <div className="space-y-1.5 pl-6">
                  {q.choices.map((c, ci) => {
                    const picked = answers[q.id] === ci;
                    const isKey = r && r.correct === ci;
                    const wrongPick = r && r.chosen === ci && !r.isCorrect;
                    return (
                      <button
                        key={ci}
                        type="button"
                        disabled={!!result}
                        onClick={() => setAnswers((a) => ({ ...a, [q.id]: ci }))}
                        data-testid={`q${q.id}-choice-${ci}`}
                        className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                          isKey ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                          : wrongPick ? "border-red-400 bg-red-50 dark:bg-red-950/30"
                          : picked ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/60"
                        } ${result ? "cursor-default" : ""}`}
                      >
                        <span className="mt-0.5 text-xs font-semibold text-muted-foreground">{"ABCD"[ci]}</span>
                        <span className="flex-1">{c}</span>
                        {isKey && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
                        {wrongPick && <XCircle className="h-4 w-4 shrink-0 text-red-600" />}
                      </button>
                    );
                  })}
                </div>

                {r && (
                  <p className="ml-6 rounded-md bg-muted/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {r.chosen === null && <span className="font-semibold">Left blank. </span>}
                    {r.why}
                  </p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!result && (
        <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {unanswered.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {unanswered.length} unanswered — a blank counts as wrong.{" "}
              <a href={`#q-${unanswered[0]}`} className="underline">Jump to the first</a>
            </p>
          )}
          <Button
            className="w-full"
            size="lg"
            disabled={submit.isPending}
            onClick={() => submit.mutate()}
            data-testid="submit-test"
          >
            {submit.isPending ? "Grading…" : "Submit test"}
          </Button>
        </div>
      )}

      {history && history.attempts.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <History className="h-3.5 w-3.5" /> {history.isManager ? "All attempts" : "Your attempts"}
            </p>
            <div className="space-y-1">
              {history.attempts.slice(0, 12).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="truncate">{history.isManager ? a.user_name : new Date(a.taken_at).toLocaleString()}</span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                    {history.isManager && <span>{new Date(a.taken_at).toLocaleDateString()}</span>}
                    <span>{a.correct_count}/{a.total}</span>
                    <Badge variant="outline" className={`text-[10px] ${a.passed ? "border-emerald-300 text-emerald-700 dark:text-emerald-400" : "border-amber-300 text-amber-700 dark:text-amber-400"}`}>
                      {a.passed ? "Pass" : "Fail"}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
