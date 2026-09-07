/**
 * Certification test results — attempts, per-question review, and the aggregate.
 *
 * The `answers` blob has been recorded on every attempt since the test shipped
 * and shown to nobody, so a trainer could see that someone scored 78% and never
 * which eight questions they lost. This page is that missing half.
 *
 * Two audiences, one page, one rule:
 *
 *  - A CLR sees their own attempts and can open any of them. That is coaching:
 *    the review shows what they picked, what was right, and why.
 *  - A manager sees everybody's, plus "Where the training is failing" — the
 *    questions the team gets wrong most often. A per-person score says who
 *    struggled; that table says where the plan itself is thin, which is the
 *    only one of the two that can be fixed once for everyone.
 *
 * Authority is decided by the server on every request (isManager, and an
 * attempt you do not own is a 403). Nothing here is a permission check; the
 * page only avoids asking for what it will not be given.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, ArrowLeft, BarChart3, CheckCircle2, ChevronRight, History,
  Loader2, ShieldQuestion, TrendingDown, User, XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Attempt = {
  id: number; user_id: number; user_name: string; taken_at: string;
  correct_count: number; total: number; percent: number; passed: number;
};
type AttemptsResp = { attempts: Attempt[]; isManager: boolean };

type ReviewRow = {
  id: number; day: number; text: string; choices: string[];
  chosen: number; chosenText: string;
  correct: number; correctText: string; isCorrect: boolean; why: string;
};
type ReviewResp = {
  attempt: Attempt;
  /** Answered questions only — see reviewAnswers() for why. */
  review: ReviewRow[];
  missed: number[];
  /** Ids of questions left blank. No answer comes back for these, by design. */
  unanswered: number[];
  passPercent: number;
  passCorrect: number;
  isSelf: boolean;
};

type MissRow = {
  id: number; day: number; text: string; correct: number; correctText: string;
  attempts: number; missed: number; blank: number; missRate: number;
  topWrong: { index: number; text: string; count: number } | null;
  why: string;
};
type InsightsResp = {
  attempts: number; takers: number; passed: number;
  questions: MissRow[];
  byDay: { day: number; asked: number; missed: number; missRate: number }[];
};

function when(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function TrainingResults() {
  const [openId, setOpenId] = useState<number | null>(null);
  // Wrong answers first, because that is what anybody opened this to read.
  const [missesOnly, setMissesOnly] = useState(true);

  const { data: history, isLoading } = useQuery<AttemptsResp>({
    queryKey: ["/api/training-test/attempts"],
  });
  const isManager = !!history?.isManager;

  const { data: review, isFetching: reviewLoading } = useQuery<ReviewResp>({
    queryKey: [`/api/training-test/attempts/${openId}`],
    enabled: openId !== null,
  });

  const { data: insights } = useQuery<InsightsResp>({
    queryKey: ["/api/training-test/insights"],
    // Managers only — the server refuses everybody else, so don't ask.
    enabled: isManager,
  });

  const attempts = history?.attempts ?? [];
  const shownReview = review
    ? (missesOnly ? review.review.filter((r) => !r.isCorrect) : review.review)
    : [];

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6" data-testid="training-results-page">
      <header className="space-y-3">
        <Link href="/clr-training/test" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the test
        </Link>
        <h1 className="text-3xl font-bold leading-tight">Certification results</h1>
        <p className="text-muted-foreground" data-testid="training-results-scope">
          {isManager
            ? "Every attempt on the team, what each person answered, and the questions the group gets wrong most often."
            : "Your attempts, question by question — what you picked, what the answer was, and why."}
        </p>
      </header>

      {/* Where the training is failing. Managers only, and deliberately above
          the individual attempts: one bad question costs the whole team, one
          bad attempt costs one person. */}
      {isManager && insights && insights.attempts > 0 && (
        <Card data-testid="training-insights">
          <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
            <TrendingDown className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold">Where the training is failing</h2>
            <Badge variant="outline" className="ml-auto text-[10px]">
              {insights.attempts} attempts · {insights.takers} people
            </Badge>
          </div>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">
              Ranked by how often the question is missed. A question most of the team gets wrong is usually a gap
              in the training or a rule nobody explained twice — not ten separate people making the same mistake.
            </p>

            <div className="space-y-2">
              {insights.questions.slice(0, 10).map((q) => (
                <div key={q.id} className="rounded-lg border p-3" data-testid={`insight-question-${q.id}`}>
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-14 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-bold tabular-nums">
                      {q.missRate}%
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-snug">{q.text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Missed {q.missed} of {q.attempts} · Day {q.day} · Answer: {q.correctText}
                      </p>
                      {q.topWrong && (
                        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                          Most common wrong answer ({q.topWrong.count}×): {q.topWrong.text}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <BarChart3 className="h-3.5 w-3.5" /> Misses by training day
              </p>
              <div className="space-y-1.5" data-testid="insight-by-day">
                {insights.byDay.map((row) => (
                  <div key={row.day} className="flex items-center gap-3 text-xs">
                    <span className="w-14 shrink-0 text-muted-foreground">Day {row.day}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-primary/70"
                        style={{ width: `${Math.min(100, row.missRate)}%` }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
                      {row.missRate}% of {row.asked}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
          <History className="h-4 w-4 text-primary" />
          <h2 className="text-base font-bold">{isManager ? "Every attempt" : "Your attempts"}</h2>
        </div>
        <CardContent className="p-4 sm:p-5">
          {attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No attempts recorded yet. The certification test files one every time it is finished.
            </p>
          ) : (
            <div className="space-y-2">
              {attempts.map((attempt) => (
                <button
                  key={attempt.id}
                  type="button"
                  onClick={() => setOpenId(openId === attempt.id ? null : attempt.id)}
                  data-testid={`attempt-row-${attempt.id}`}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 ${
                    openId === attempt.id ? "border-primary bg-muted/40" : ""
                  }`}
                >
                  <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{attempt.user_name}</span>
                    <span className="block text-xs text-muted-foreground">{when(attempt.taken_at)}</span>
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums">
                    {attempt.correct_count}/{attempt.total}
                  </span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 text-[10px] ${
                      attempt.passed
                        ? "border-emerald-300 text-emerald-700 dark:text-emerald-400"
                        : "border-amber-300 text-amber-700 dark:text-amber-400"
                    }`}
                  >
                    {attempt.passed ? "Pass" : "Retry"}
                  </Badge>
                  <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${openId === attempt.id ? "rotate-90" : ""}`} />
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {openId !== null && (
        <Card data-testid="attempt-review">
          <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-2.5">
            <ShieldQuestion className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold">
              {review ? `${review.attempt.user_name} — ${review.attempt.percent}%` : "Loading review…"}
            </h2>
            {review && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={() => setMissesOnly((v) => !v)}
                data-testid="review-toggle-misses"
              >
                {missesOnly ? `Show all ${review.review.length}` : `Only the ${review.missed.length} missed`}
              </Button>
            )}
          </div>
          <CardContent className="space-y-3 p-4 sm:p-5">
            {reviewLoading && !review && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading the answers…
              </p>
            )}

            {review && shownReview.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing missed on this attempt — every question that was answered was answered correctly.
              </p>
            )}

            {/* Blanks are flagged, never answered. The answer key belongs to
                questions somebody actually sat; listing it for the ones they
                skipped would turn an empty attempt into a cheat sheet. */}
            {review && review.unanswered?.length > 0 && (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground" data-testid="review-unanswered">
                {review.unanswered.length} question{review.unanswered.length === 1 ? " was" : "s were"} left blank
                (Q{review.unanswered.join(", Q")}) and counted as wrong. Blank questions are not reviewed.
              </p>
            )}

            {shownReview.map((row) => (
              <div
                key={row.id}
                className={`rounded-lg border p-3 ${
                  row.isCorrect
                    ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20"
                    : "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
                }`}
                data-testid={`review-question-${row.id}`}
              >
                <div className="flex items-start gap-2.5">
                  {row.isCorrect
                    ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">
                      <span className="text-muted-foreground">Q{row.id} · Day {row.day} — </span>{row.text}
                    </p>
                    <p className="mt-1.5 text-sm" data-testid={`review-chosen-${row.id}`}>
                      <span className="text-muted-foreground">They chose: </span>
                      {row.chosenText}
                    </p>
                    {!row.isCorrect && (
                      <p className="mt-0.5 text-sm font-semibold" data-testid={`review-correct-${row.id}`}>
                        <span className="font-normal text-muted-foreground">Correct answer: </span>
                        {row.correctText}
                      </p>
                    )}
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{row.why}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {!isManager && (
        <div className="flex items-start gap-3 rounded-xl border bg-muted/30 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            You are seeing your own attempts only. Team-wide results are visible to managers.
          </p>
        </div>
      )}
    </div>
  );
}
