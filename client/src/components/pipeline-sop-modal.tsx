import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { GitBranch, X, Info } from "lucide-react";

const NAVY = "#1A2B4A";
const GOLD = "#C49A3C";

// How often the popup reappears, in days.
export const PIPELINE_SOP_INTERVAL_DAYS = 14;

type Stage = { name: string; note: string };
type Group = { title: string; color: string; desc: string; stages: Stage[] };

// Pulled from the CLR pipeline SOP. One line per stage.
const GROUPS: Group[] = [
  {
    title: "Actively Worked",
    color: GOLD,
    desc: "These are yours to chase. Dial, text, and try to live-transfer them to a loan officer.",
    stages: [
      { name: "New", note: "Brand-new lead — call ASAP, several attempts day one plus a text." },
      { name: "Responded", note: "Replied in the last 3 days — hand-review, call fast, aim for a live transfer." },
      { name: "Ghosted", note: "Old Responded leads gone quiet — FOCUS: triple-dial, vary channels and times." },
      { name: "No Contact", note: "Never replied — triple-dial and keep working the cadence." },
      { name: "Rate-Watch", note: "Waiting on rates to drop — keep warm, reach out hard when rates fall." },
      { name: "Follow-Up", note: "Future lead with a task reminder — if past the task date it's abandoned: call and move to Ghosted." },
      { name: "No Text (STOP / Bad Number)", note: "Opted out of texts or bad number — email only, never text; don't touch unless they reach out." },
      { name: "No Longer Interested", note: "Declined for now — re-touch in 60–90 days, check notes first." },
      { name: "DNC", note: "Asked not to be contacted — never contact, suppress." },
    ],
  },
  {
    title: "In Process",
    color: "#2563eb",
    desc: "A loan officer is actively working these. Hands off unless the deal stalls or gets abandoned.",
    stages: [
      { name: "App Taken", note: "Application captured — don't touch unless abandoned." },
      { name: "Collecting Documents", note: "Gathering docs — support the chase; nudge or transfer if it stalls." },
      { name: "Pitched", note: "Options presented, awaiting decision — follow up to keep it moving." },
    ],
  },
  {
    title: "Closed",
    color: "#15803d",
    desc: "Done for now - won, in underwriting, or did not qualify. No active dialing needed.",
    stages: [
      { name: "Processing", note: "In underwriting — owned by the LO / processing team." },
      { name: "Funded", note: "Loan funded (won) — LO asks for referrals and reviews." },
      { name: "DNQ", note: "Did not qualify — closed for now, may re-nurture later." },
    ],
  },
];

// Plain-English glossary for jargon a new CLR may not know yet.
const TERMS: { term: string; def: string }[] = [
  { term: "CLR", def: "you - the rep who dials leads and connects them to a loan officer" },
  { term: "LO", def: "Loan Officer - the person you transfer a ready lead to" },
  { term: "Live transfer", def: "calling a lead and connecting them to an LO on the spot" },
  { term: "Triple-dial", def: "call 3 times in a row; people often pick up on the 2nd or 3rd" },
  { term: "Abandoned", def: "a follow-up task left past its date - it is fair game to call again" },
  { term: "DNC", def: "Do Not Contact - legally off-limits, never reach out" },
];

export function PipelineSopModal() {
  const { markPipelineSopSeen } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await markPipelineSopSeen();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-2xl mx-4 my-8 rounded-2xl overflow-hidden shadow-2xl bg-[#0F182D] border border-white/10 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(196, 154, 60, 0.15)" }}
            >
              <GitBranch className="w-5 h-5" style={{ color: GOLD }} />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg leading-tight">Pipeline Stages — Quick Reference</h2>
              <p className="text-white/50 text-sm mt-0.5">A refresher on what each stage means and how to work it</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white/80 transition-colors p-1 rounded-lg hover:bg-white/10 shrink-0"
            title="Dismiss"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="px-6 py-5 overflow-y-auto">

          {/* What this is - context for a new CLR */}
          <div className="rounded-lg border px-4 py-3 mb-5" style={{ backgroundColor: "rgba(196, 154, 60, 0.08)", borderColor: "rgba(196, 154, 60, 0.25)" }}>
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: GOLD }} />
              <div>
                <p className="text-white text-sm font-semibold mb-1">What is this?</p>
                <p className="text-white/70 text-[13px] leading-relaxed">
                  Every lead you work sits in a <span className="text-white font-medium">stage</span> that says how
                  warm it is and what to do next. As a lead progresses - or goes quiet - you move it to the right
                  stage so the team always knows where it stands. This reminder pops up every couple of weeks so the
                  stages and the play for each one stay fresh. Below they are grouped by how much attention they need.
                </p>
              </div>
            </div>
          </div>

          {GROUPS.map((group) => (
            <div key={group.title} className="mb-5 last:mb-0">
              <p
                className="text-[11px] font-bold uppercase tracking-wide mb-2"
                style={{ color: group.color }}
              >
                {group.title}
              </p>
              <p className="text-white/45 text-xs mb-2 leading-snug">{group.desc}</p>
              <div className="space-y-1.5">
                {group.stages.map((s) => (
                  <div key={s.name} className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                    <span className="text-white font-semibold text-sm">{s.name}</span>
                    <span className="text-white/60 text-sm"> — {s.note}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Glossary */}
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-[11px] font-bold uppercase tracking-wide mb-2 text-white/50">Quick Terms</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-1.5">
              {TERMS.map((t) => (
                <p key={t.term} className="text-[13px] leading-snug">
                  <span className="text-white font-semibold">{t.term}</span>
                  <span className="text-white/55"> - {t.def}</span>
                </p>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-white/10 shrink-0">
          <Button
            onClick={handleDismiss}
            className="font-semibold"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            Got it
          </Button>
        </div>
      </div>
    </div>
  );
}
