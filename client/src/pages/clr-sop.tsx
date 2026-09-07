/**
 * CLR Floor SOP — "The Call, Start to Finish".
 *
 * The trainer walkthrough (/clr-training) is a ten-day SCHEDULE. This is the
 * same content arranged as the procedure you follow every day once you are
 * trained: before you dial, open, take the sheet, handle pushback, hand off,
 * close out, and the five things you never do.
 *
 * Two rules govern this page:
 *
 *  1. It is read on the floor, often mid-call. So: no tabs, no accordions,
 *     nothing to click before you can read a step. Phases down the page, steps
 *     down each phase, and the non-negotiables in red at the end. It prints on
 *     a couple of sheets for the desk.
 *
 *  2. It must not drift from the manual. Every step is bound to a sentence in
 *     the live training document, and the server re-checks that binding on every
 *     request (see deriveSop in shared/clr-sop.ts). "Where this comes from"
 *     shows the manual's own line under each step, and a step whose sentence has
 *     been edited away is flagged here rather than quietly surviving.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, BookOpen, ClipboardList, Eye, EyeOff, GraduationCap, Printer, ShieldAlert,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deriveSop, SOP_SUBTITLE, SOP_TITLE, type DerivedSop } from "@shared/clr-sop";
import { TRAINING_AUTHOR } from "@shared/clr-training";

type SopResp = DerivedSop & { authorName: string; savedAt: string | null; isSeed: boolean };

export default function ClrSop() {
  // Sources are off by default: on the floor you want the instruction, not the
  // footnote. A trainer arguing about a step turns them on.
  const [showSources, setShowSources] = useState(false);

  const { data } = useQuery<SopResp>({
    queryKey: ["/api/clr-sop"],
    queryFn: () => apiRequest("GET", "/api/clr-sop"),
  });

  // Same fallback rule as the walkthrough: a failed request must still show the
  // procedure to someone who is about to pick up the phone.
  const sop = data ?? { ...deriveSop(), authorName: TRAINING_AUTHOR, savedAt: null, isSeed: true };
  const authorName = sop.authorName || TRAINING_AUTHOR;
  const drifted = sop.drifted ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6 print:max-w-none" data-testid="clr-sop-page">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <ClipboardList className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">Standard operating procedure</span>
        </div>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{SOP_TITLE}</h1>
        <p className="text-lg text-muted-foreground">{SOP_SUBTITLE}</p>

        <div className="flex flex-wrap items-center gap-3 border-y py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" data-testid="sop-derivation">
              Derived from the CLR Trainer Walkthrough by {authorName}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="sop-grounding">
              {sop.grounded} of {sop.total} steps checked against the manual
              {sop.savedAt ? ` as it read on ${String(sop.savedAt).slice(0, 10)}` : ""}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 print:hidden">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setShowSources((v) => !v)}
              data-testid="sop-toggle-sources"
            >
              {showSources ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showSources ? "Hide sources" : "Show sources"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>
          </div>
        </div>
      </header>

      {/* The anti-drift alarm. A step whose sentence has been edited out of the
          manual is still on the wall until somebody decides what replaces it —
          so say so loudly rather than deleting it silently. */}
      {drifted.length > 0 && (
        <div
          className="flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30"
          data-testid="sop-drift-warning"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
              {drifted.length} {drifted.length === 1 ? "step no longer matches" : "steps no longer match"} the training manual
            </p>
            <p className="mt-0.5 text-sm text-amber-900/80 dark:text-amber-200/80">
              The manual has been edited and these steps have lost the sentence they came from. Someone should
              decide whether the procedure changed or the wording did.
            </p>
            <ul className="mt-2 space-y-1">
              {drifted.map((step) => (
                <li key={`${step.section}-${step.anchors.join("|")}`} className="text-xs text-amber-900/80 dark:text-amber-200/80">
                  <span className="font-semibold">{step.title}:</span> {step.text}
                  <span className="block pl-3 opacity-80">
                    Gone from the manual: {step.missing.map((m) => `“${m}”`).join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {sop.sections.map((section, sectionIndex) => {
        const isNever = section.key === "never";
        return (
          <Card
            key={section.key}
            id={`sop-${section.key}`}
            className={`scroll-mt-24 overflow-hidden ${isNever ? "border-red-300 dark:border-red-900" : ""}`}
            data-testid={`sop-section-${section.key}`}
          >
            <div
              className={`flex items-center gap-3 border-b px-4 py-2.5 ${
                isNever ? "bg-red-50 dark:bg-red-950/30" : "bg-muted/40"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  isNever ? "bg-red-600 text-white" : "bg-primary text-primary-foreground"
                }`}
              >
                {isNever ? <ShieldAlert className="h-4 w-4" /> : sectionIndex + 1}
              </span>
              <h2 className="text-base font-bold">{section.title}</h2>
              <Badge variant="outline" className="ml-auto text-[10px]">{section.when}</Badge>
            </div>

            <CardContent className="space-y-3 p-4 sm:p-5">
              {section.steps.map((step, stepIndex) => (
                <div key={`${section.key}-${stepIndex}`} className="flex gap-3">
                  <span
                    className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${
                      isNever ? "bg-red-500" : step.grounded ? "bg-primary/60" : "bg-amber-500"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-relaxed text-foreground/90">{step.text}</p>
                    {showSources && (
                      /* Every anchor, not just the first: a step that rests on
                         two sentences is only as grounded as its weaker one. */
                      <div className="mt-1 space-y-1 border-l-2 border-muted pl-2.5">
                        {step.bindings.map((binding) => (
                          <p
                            key={binding.anchor}
                            className={`text-xs italic leading-relaxed ${binding.line ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400"}`}
                          >
                            {binding.line
                              ? <>Day {binding.day} of the manual: “{binding.line}”</>
                              : <>No longer in the manual — was day {step.day}: “{binding.anchor}”</>}
                          </p>
                        ))}
                        {step.moved && (
                          <p className="text-xs text-muted-foreground">Moved from day {step.day}.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <div className="grid gap-3 sm:grid-cols-2 print:hidden">
        <Link
          href="/clr-training"
          className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4 transition-colors hover:bg-muted/60"
          data-testid="sop-link-walkthrough"
        >
          <BookOpen className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">The full walkthrough</p>
            <p className="text-xs text-muted-foreground">Where each of these rules is taught, day by day.</p>
          </div>
        </Link>
        <Link
          href="/clr-training/test"
          className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4 transition-colors hover:bg-muted/60"
          data-testid="sop-link-test"
        >
          <GraduationCap className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Certification test</p>
            <p className="text-xs text-muted-foreground">Sixty judgement calls drawn from this procedure.</p>
          </div>
        </Link>
      </div>

      <p className="pb-2 text-center text-xs text-muted-foreground">
        Derived from the CLR Trainer Walkthrough · West Capital Lending
      </p>
    </div>
  );
}
