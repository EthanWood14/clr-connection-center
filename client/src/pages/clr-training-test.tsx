/**
 * One-question-at-a-time certification experience for Matt Lane's plan.
 *
 * The server checks only the answer the trainee just chose, so feedback can be
 * immediate without placing the complete answer key in the browser. A single
 * final submission records the completed attempt and remains authoritative.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft,
  GraduationCap, History, Loader2, RotateCcw, Sparkles, Target,
  Trophy, XCircle, Zap,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

type Question = { id: number; day: number; text: string; choices: string[] };
type TestPayload = { questions: Question[]; total: number; passCorrect: number; passPercent: number };
type QuestionFeedback = { id: number; chosen: number; correct: number; isCorrect: boolean; why: string };
type Result = {
  correctCount: number; total: number; percent: number; passed: boolean;
  passCorrect: number; passPercent: number;
  results: QuestionFeedback[];
};
type Attempt = { id: number; user_name: string; taken_at: string; correct_count: number; total: number; percent: number; passed: number };

const CORRECT_TITLES = ["Nailed it!", "That’s the move!", "Locked in!", "Exactly right!", "You know this!"];
const WRONG_TITLES = ["Good rep — lock this in", "Almost! Here’s the key", "That one was sneaky", "Now you’ll remember it"];
const CONFETTI = ["✨", "⭐", "🎉", "⚡", "🌟", "✨", "🏆", "⭐", "🎊", "⚡", "✨", "🌟"];

function Celebration({ active, big = false }: { active: boolean; big?: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-3xl" aria-hidden="true">
      {CONFETTI.map((piece, index) => (
        <span
          key={`${piece}-${index}`}
          className="quiz-confetti absolute"
          style={{
            left: `${7 + ((index * 19) % 88)}%`,
            top: `${big ? 35 : 55}%`,
            fontSize: `${big ? 22 + (index % 3) * 7 : 15 + (index % 3) * 5}px`,
            animationDelay: `${(index % 6) * 70}ms`,
          }}
        >
          {piece}
        </span>
      ))}
    </div>
  );
}

export default function ClrTrainingTest() {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [feedbackById, setFeedbackById] = useState<Record<number, QuestionFeedback>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  const { data, isLoading } = useQuery<TestPayload>({ queryKey: ["/api/training-test"] });
  const { data: history } = useQuery<{ attempts: Attempt[]; isManager: boolean }>({
    queryKey: ["/api/training-test/attempts"],
  });

  const questions = data?.questions ?? [];
  const currentQuestion = questions[currentIndex];
  const currentFeedback = currentQuestion ? feedbackById[currentQuestion.id] : undefined;
  const answered = Object.keys(feedbackById).length;
  const correctSoFar = Object.values(feedbackById).filter((item) => item.isCorrect).length;
  const progress = data?.total ? Math.round((answered / data.total) * 100) : 0;

  const streaks = useMemo(() => {
    let current = 0;
    let best = 0;
    for (const question of questions) {
      const feedback = feedbackById[question.id];
      if (!feedback) break;
      current = feedback.isCorrect ? current + 1 : 0;
      best = Math.max(best, current);
    }
    return { current, best };
  }, [questions, feedbackById]);

  const checkAnswer = useMutation({
    mutationFn: (input: { questionId: number; chosen: number }) =>
      apiRequest("POST", "/api/training-test/check", input),
    onSuccess: (feedback: QuestionFeedback) => {
      setFeedbackById((existing) => ({ ...existing, [feedback.id]: feedback }));
    },
    onError: (error: any, input) => {
      setAnswers((existing) => {
        const next = { ...existing };
        delete next[input.questionId];
        return next;
      });
      toast({
        title: "Could not check that answer",
        description: error?.message ?? "Try selecting it again.",
        variant: "destructive",
      });
    },
  });

  const submit = useMutation({
    mutationFn: () => apiRequest("POST", "/api/training-test/attempts", { answers }),
    onSuccess: (finalResult: Result) => {
      setResult(finalResult);
      setFeedbackById(Object.fromEntries(finalResult.results.map((item) => [item.id, item])));
      queryClient.invalidateQueries({ queryKey: ["/api/training-test/attempts"] });
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (error: any) => toast({
      title: "Could not save the test",
      description: error?.message ?? "Your answers are still here. Please try again.",
      variant: "destructive",
    }),
  });

  function moveTo(index: number) {
    setCurrentIndex(Math.max(0, Math.min(index, questions.length - 1)));
    window.setTimeout(() => document.getElementById("training-test-question")?.scrollIntoView({ behavior: "smooth", block: "center" }), 30);
  }

  function chooseAnswer(chosen: number) {
    if (!currentQuestion || currentFeedback || checkAnswer.isPending) return;
    setAnswers((existing) => ({ ...existing, [currentQuestion.id]: chosen }));
    checkAnswer.mutate({ questionId: currentQuestion.id, chosen });
  }

  function continueTest() {
    if (!currentFeedback) return;
    if (currentIndex === questions.length - 1) {
      if (answered === questions.length && !submit.isPending) submit.mutate();
      return;
    }
    moveTo(currentIndex + 1);
  }

  function restart() {
    setAnswers({});
    setFeedbackById({});
    setCurrentIndex(0);
    setResult(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (result || !currentQuestion) return;
      if (!currentFeedback && !checkAnswer.isPending) {
        const numberChoice = ["1", "2", "3", "4"].indexOf(event.key);
        const letterChoice = ["a", "b", "c", "d"].indexOf(event.key.toLowerCase());
        const index = numberChoice >= 0 ? numberChoice : letterChoice;
        if (index >= 0) {
          event.preventDefault();
          chooseAnswer(index);
        }
      } else if (currentFeedback && event.key === "Enter") {
        event.preventDefault();
        continueTest();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [result, currentQuestion, currentFeedback, currentIndex, answered, checkAnswer.isPending, submit.isPending]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <Skeleton className="h-44 w-full rounded-3xl" />
        <Skeleton className="h-[430px] w-full rounded-3xl" />
      </div>
    );
  }

  const chosen = currentQuestion ? answers[currentQuestion.id] : undefined;
  const milestone = answered > 0 && answered % 10 === 0 && currentFeedback && currentIndex + 1 === answered;
  const correctAnswerText = currentFeedback && currentQuestion ? currentQuestion.choices[currentFeedback.correct] : "";
  const feedbackTitle = currentFeedback?.isCorrect
    ? CORRECT_TITLES[currentQuestion.id % CORRECT_TITLES.length]
    : WRONG_TITLES[(currentQuestion?.id ?? 0) % WRONG_TITLES.length];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-violet-50/70 via-background to-sky-50/60 dark:from-violet-950/20 dark:via-background dark:to-sky-950/20">
      <style>{`
        @keyframes quiz-question-in { from { opacity: 0; transform: translateY(18px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes quiz-feedback-in { 0% { opacity: 0; transform: translateY(10px) scale(.96); } 70% { transform: translateY(-2px) scale(1.01); } 100% { opacity: 1; transform: none; } }
        @keyframes quiz-wrong-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-7px); } 50% { transform: translateX(6px); } 75% { transform: translateX(-3px); } }
        @keyframes quiz-confetti { 0% { opacity: 0; transform: translate(-50%, 0) scale(.3) rotate(0deg); } 20% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -155px) scale(1.15) rotate(240deg); } }
        @keyframes quiz-glow { 0%,100% { box-shadow: 0 0 0 rgba(124,58,237,0); } 50% { box-shadow: 0 0 34px rgba(124,58,237,.22); } }
        .quiz-question-in { animation: quiz-question-in .38s cubic-bezier(.22,1,.36,1) both; }
        .quiz-feedback-in { animation: quiz-feedback-in .4s cubic-bezier(.22,1,.36,1) both; }
        .quiz-wrong-shake { animation: quiz-wrong-shake .35s ease both; }
        .quiz-confetti { animation: quiz-confetti 1.2s cubic-bezier(.15,.7,.2,1) both; }
        .quiz-glow { animation: quiz-glow 2.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .quiz-question-in,.quiz-feedback-in,.quiz-wrong-shake,.quiz-confetti,.quiz-glow { animation: none !important; } }
      `}</style>

      <div className="pointer-events-none absolute -left-24 top-32 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl dark:bg-violet-700/10" />
      <div className="pointer-events-none absolute -right-24 top-[520px] h-80 w-80 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-700/10" />

      <div className="relative mx-auto max-w-4xl space-y-5 p-4 pb-12 sm:p-6 sm:pb-16">
        <header className="overflow-hidden rounded-3xl border border-violet-200/70 bg-gradient-to-br from-violet-700 via-indigo-700 to-sky-600 p-5 text-white shadow-xl shadow-violet-900/10 sm:p-7">
          <Link href="/clr-training" className="inline-flex items-center gap-1.5 text-xs text-white/70 transition hover:text-white">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to the walkthrough
          </Link>
          <div className="mt-3 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <Badge className="mb-3 border-white/20 bg-white/15 text-white hover:bg-white/20">Day 10 challenge</Badge>
              <h1 className="flex items-center gap-3 text-2xl font-black tracking-tight sm:text-4xl">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 shadow-inner sm:h-14 sm:w-14"><GraduationCap className="h-7 w-7" /></span>
                CLR Certification
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/75">
                One question at a time. Instant coaching. Build a streak and finish with at least {data?.passCorrect} of {data?.total} correct.
              </p>
            </div>
            {!result && (
              <div className="grid min-w-[240px] grid-cols-3 gap-2">
                <div className="rounded-2xl bg-black/15 px-3 py-2 text-center backdrop-blur"><p className="text-lg font-black tabular-nums">{correctSoFar}</p><p className="text-[10px] uppercase tracking-wide text-white/60">Correct</p></div>
                <div className="rounded-2xl bg-black/15 px-3 py-2 text-center backdrop-blur"><p className="flex items-center justify-center gap-1 text-lg font-black tabular-nums"><Zap className="h-4 w-4 text-amber-300" />{streaks.current}</p><p className="text-[10px] uppercase tracking-wide text-white/60">Current streak</p></div>
                <div className="rounded-2xl bg-black/15 px-3 py-2 text-center backdrop-blur"><p className="text-lg font-black tabular-nums">{progress}%</p><p className="text-[10px] uppercase tracking-wide text-white/60">Complete</p></div>
              </div>
            )}
          </div>
        </header>

        {!result && currentQuestion && (
          <>
            <Card className="border-violet-200/70 bg-background/85 shadow-sm backdrop-blur dark:border-violet-900/70">
              <CardContent className="space-y-2 p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">Question {currentIndex + 1} of {data?.total}</span>
                  <span>{answered} answered · best streak {streaks.best}</span>
                </div>
                <Progress value={progress} className="h-2.5 bg-violet-100 dark:bg-violet-950 [&>div]:bg-gradient-to-r [&>div]:from-violet-600 [&>div]:via-fuchsia-500 [&>div]:to-sky-500 [&>div]:duration-500" />
              </CardContent>
            </Card>

            <Card
              key={currentQuestion.id}
              id="training-test-question"
              data-testid="training-question-card"
              className={`quiz-question-in relative overflow-hidden border-2 bg-background/95 shadow-xl ${currentFeedback?.isCorrect ? "border-emerald-400 dark:border-emerald-700" : currentFeedback ? "quiz-wrong-shake border-amber-400 dark:border-amber-700" : "border-violet-200 dark:border-violet-900"}`}
            >
              <Celebration active={!!currentFeedback?.isCorrect} />
              <CardContent className="relative space-y-6 p-5 sm:p-8">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100 text-sm font-black text-violet-700 dark:bg-violet-950 dark:text-violet-300">{currentIndex + 1}</span>
                    <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300">Training day {currentQuestion.day}</Badge>
                  </div>
                  {streaks.current >= 3 && <Badge className="gap-1 border-0 bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm"><Zap className="h-3 w-3" /> {streaks.current} streak</Badge>}
                </div>

                <h2 className="text-xl font-bold leading-snug tracking-tight sm:text-2xl">{currentQuestion.text}</h2>

                <div className="grid gap-3">
                  {currentQuestion.choices.map((choice, index) => {
                    const isSelected = chosen === index;
                    const isCorrectChoice = currentFeedback?.correct === index;
                    const isWrongChoice = !!currentFeedback && isSelected && !currentFeedback.isCorrect;
                    return (
                      <button
                        key={choice}
                        type="button"
                        onClick={() => chooseAnswer(index)}
                        disabled={!!currentFeedback || checkAnswer.isPending}
                        aria-pressed={isSelected}
                        data-testid={`training-choice-${index}`}
                        className={`group flex min-h-16 w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left transition-all duration-200 sm:px-5 ${
                          isCorrectChoice ? "border-emerald-400 bg-emerald-50 text-emerald-950 shadow-md dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100"
                            : isWrongChoice ? "border-red-400 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950/35 dark:text-red-100"
                            : isSelected ? "border-violet-500 bg-violet-50 shadow-md dark:bg-violet-950/35"
                            : currentFeedback ? "border-border/60 opacity-55"
                            : "border-border bg-card hover:-translate-y-0.5 hover:border-violet-400 hover:bg-violet-50/60 hover:shadow-md dark:hover:bg-violet-950/25"
                        }`}
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-sm font-black transition ${isCorrectChoice ? "border-emerald-500 bg-emerald-500 text-white" : isWrongChoice ? "border-red-500 bg-red-500 text-white" : isSelected ? "border-violet-600 bg-violet-600 text-white" : "border-border bg-muted/40 text-muted-foreground group-hover:border-violet-400 group-hover:text-violet-700"}`}>{"ABCD"[index]}</span>
                        <span className="flex-1 text-sm font-medium leading-snug sm:text-base">{choice}</span>
                        {checkAnswer.isPending && isSelected && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-violet-600" />}
                        {isCorrectChoice && <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />}
                        {isWrongChoice && <XCircle className="h-5 w-5 shrink-0 text-red-600" />}
                      </button>
                    );
                  })}
                </div>

                {!currentFeedback && !checkAnswer.isPending && <p className="text-center text-xs text-muted-foreground">Choose an answer—or press A, B, C, or D on your keyboard.</p>}

                {currentFeedback && (
                  <div data-testid="training-feedback" aria-live="polite" className={`quiz-feedback-in rounded-2xl border p-4 sm:p-5 ${currentFeedback.isCorrect ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"}`}>
                    <div className="flex items-start gap-3">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${currentFeedback.isCorrect ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>
                        {currentFeedback.isCorrect ? <Sparkles className="h-5 w-5" /> : <Target className="h-5 w-5" />}
                      </span>
                      <div>
                        <p className="font-black">{feedbackTitle}</p>
                        {!currentFeedback.isCorrect && <p className="mt-0.5 text-sm font-semibold">Correct answer: {correctAnswerText}</p>}
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{currentFeedback.why}</p>
                      </div>
                    </div>
                    {milestone && <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm font-bold text-violet-700 dark:bg-black/20 dark:text-violet-300"><Trophy className="h-4 w-4 text-amber-500" /> Checkpoint unlocked — {answered} questions down!</div>}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 border-t pt-5">
                  <Button variant="ghost" onClick={() => moveTo(currentIndex - 1)} disabled={currentIndex === 0 || submit.isPending} className="gap-1.5"><ChevronLeft className="h-4 w-4" /> Previous</Button>
                  <Button data-testid="training-next" onClick={continueTest} disabled={!currentFeedback || submit.isPending} size="lg" className={`min-w-40 gap-2 font-bold ${currentIndex === questions.length - 1 ? "quiz-glow bg-gradient-to-r from-violet-600 to-sky-600" : ""}`}>
                    {submit.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : currentIndex === questions.length - 1 ? <><Trophy className="h-4 w-4" /> Finish & save</> : <>Next question <ArrowRight className="h-4 w-4" /></>}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {result && (
          <Card className={`quiz-feedback-in relative overflow-hidden border-2 shadow-2xl ${result.passed ? "border-emerald-400 bg-emerald-50/80 dark:border-emerald-700 dark:bg-emerald-950/30" : "border-amber-400 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/30"}`} data-testid="test-result">
            <Celebration active={result.passed} big />
            <CardContent className="relative flex flex-col items-center p-7 text-center sm:p-10">
              <div className={`flex h-20 w-20 items-center justify-center rounded-3xl shadow-lg ${result.passed ? "bg-emerald-500 text-white" : "bg-amber-500 text-white"}`}>{result.passed ? <Trophy className="h-10 w-10" /> : <AlertTriangle className="h-10 w-10" />}</div>
              <Badge className={`mt-5 ${result.passed ? "bg-emerald-600" : "bg-amber-600"}`}>{result.passed ? "CERTIFIED" : "KEEP TRAINING"}</Badge>
              <h2 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{result.percent}%</h2>
              <p className="mt-1 text-lg font-bold">{result.correctCount} of {result.total} correct</p>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{result.passed ? `You passed. Your best streak was ${streaks.best}—take that confidence into the certification call.` : `You need ${result.passCorrect} correct to pass. The instant feedback showed exactly what to review; give it another run when you’re ready.`}</p>
              <div className="mt-6 grid w-full max-w-lg grid-cols-3 gap-3">
                <div className="rounded-2xl border bg-background/70 p-3"><p className="text-xl font-black text-emerald-600">{result.correctCount}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Correct</p></div>
                <div className="rounded-2xl border bg-background/70 p-3"><p className="text-xl font-black text-red-500">{result.total - result.correctCount}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">To review</p></div>
                <div className="rounded-2xl border bg-background/70 p-3"><p className="text-xl font-black text-violet-600">{streaks.best}</p><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Best streak</p></div>
              </div>
              <Button size="lg" className="mt-7 gap-2" variant={result.passed ? "outline" : "default"} onClick={restart}><RotateCcw className="h-4 w-4" /> {result.passed ? "Run it again" : "Retake the challenge"}</Button>
            </CardContent>
          </Card>
        )}

        {history && history.attempts.length > 0 && (
          <Card className="bg-background/80 backdrop-blur">
            <CardContent className="p-4 sm:p-5">
              <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><History className="h-3.5 w-3.5" /> {history.isManager ? "Recent team attempts" : "Your previous runs"}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {history.attempts.slice(0, 12).map((attempt) => (
                  <div key={attempt.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2.5 text-xs">
                    <span className="min-w-0 truncate">{history.isManager ? attempt.user_name : new Date(attempt.taken_at).toLocaleString()}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                      {history.isManager && <span>{new Date(attempt.taken_at).toLocaleDateString()}</span>}
                      <strong className="text-foreground">{attempt.correct_count}/{attempt.total}</strong>
                      <Badge variant="outline" className={`text-[10px] ${attempt.passed ? "border-emerald-300 text-emerald-700 dark:text-emerald-400" : "border-amber-300 text-amber-700 dark:text-amber-400"}`}>{attempt.passed ? "Pass" : "Retry"}</Badge>
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
