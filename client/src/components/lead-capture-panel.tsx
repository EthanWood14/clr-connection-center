// The live-call Lead Card: lead source, qualification checklist, and
// info-gathering fields, fillable while the script is running so nothing has
// to be retyped into Input Results after the call. Same definitions and the
// same serialized shape as the Input Results wizard, via lib/lead-capture.
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardCheck } from "lucide-react";
import {
  type LeadCapture, type QualAnswer,
  LEAD_SOURCE_OPTIONS, QUAL_QUESTIONS, INFO_FIELDS, INVESTMENT_ROUTING_HINT,
} from "@/lib/lead-capture";

export function LeadCapturePanel({
  capture,
  onChange,
}: {
  capture: LeadCapture;
  onChange: (next: LeadCapture) => void;
}) {
  const set = (k: keyof LeadCapture, v: string) => onChange({ ...capture, [k]: v });

  return (
    <Card data-testid="lead-capture-panel">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <ClipboardCheck className="w-4 h-4 text-primary" /> Lead Card
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">fills the outcome for you</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 space-y-3">
        {/* Lead source — one tap */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Lead source</p>
          <div className="flex flex-wrap gap-1">
            {LEAD_SOURCE_OPTIONS.map(opt => (
              <button
                key={opt}
                type="button"
                onClick={() => set("leadSource", capture.leadSource === opt ? "" : opt)}
                data-testid={`lead-source-${opt.replace(/\s+/g, "-").toLowerCase()}`}
                className={`text-[11px] px-2 py-1 rounded-full border font-medium ${capture.leadSource === opt ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
              >{opt}</button>
            ))}
            <button
              type="button"
              onClick={() => set("leadSource", capture.leadSource === "other" ? "" : "other")}
              className={`text-[11px] px-2 py-1 rounded-full border font-medium ${capture.leadSource === "other" ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
            >Other…</button>
          </div>
          {capture.leadSource === "other" && (
            <Input
              value={capture.leadSourceOther}
              onChange={e => set("leadSourceOther", e.target.value)}
              placeholder="Where did this lead come from?"
              className="h-8 text-xs mt-1.5"
              data-testid="lead-source-other-input"
            />
          )}
        </div>

        {/* Qualification checklist */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Qualification</p>
          <div className="space-y-1.5">
            {QUAL_QUESTIONS.map(q => (
              <div key={q.name} className="flex items-center justify-between gap-2">
                <span className="text-xs leading-snug">
                  {q.label}
                  {q.cue && <span className="ml-1 text-[10px] text-muted-foreground">({q.cue})</span>}
                </span>
                <div className="flex gap-1 shrink-0">
                  {(["yes", "no"] as QualAnswer[]).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => set(q.name, capture[q.name] === v ? "" : v)}
                      data-testid={`panel-${q.name}-${v}`}
                      className={`text-[11px] px-2.5 py-1 rounded-md border font-medium ${capture[q.name] === v ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"}`}
                    >{v === "yes" ? "Yes" : "No"}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {capture.qualInvestment === "yes" && (
            <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 mt-1.5" data-testid="panel-investment-hint">
              {INVESTMENT_ROUTING_HINT}
            </p>
          )}
          {capture.qualCredit500 === "yes" && (
            <Input
              value={capture.qualCreditEst}
              onChange={e => set("qualCreditEst", e.target.value)}
              placeholder="Estimated credit score"
              className="h-8 text-xs mt-1.5"
              data-testid="panel-credit-est"
            />
          )}
        </div>

        {/* Info gathering */}
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Info gathering</p>
          <div className="space-y-1">
            {INFO_FIELDS.map(f => (
              <div key={f.name} className="grid grid-cols-[7.5rem_1fr] items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground leading-tight">{f.label}</span>
                <Input
                  value={capture[f.name] as string}
                  onChange={e => set(f.name, e.target.value)}
                  className="h-7 text-xs"
                  data-testid={`panel-${f.name}`}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
