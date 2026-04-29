import { useEffect, useState, useCallback } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  LifeBuoy,
} from "lucide-react";

const NAVY = "#1A2B4A";
const GOLD = "#C49A3C";

type Slide = {
  title: string;
  body: string;
  image: string;
};

const SLIDES: Slide[] = [
  {
    title: "Welcome to CLR Connection Center",
    body: "Your home base. Track today's calls, transfers, and appointments at a glance, see weekly goal progress, and jump into your daily LO assignments.",
    image: "/walkthrough/01-dashboard.png",
  },
  {
    title: "Daily Assignments",
    body: "Each morning the smart algorithm picks today's LO list based on recency, frequency, availability, transfers, and priority tier. Locked until tomorrow so the focus stays clear.",
    image: "/walkthrough/02-assignments.png",
  },
  {
    title: "Guided Call Script",
    body: "Step-by-step script with branching responses for any direction the call goes. Placeholders like [borrower name] and [LO name] auto-fill. Tap a response and the call records automatically — no Start button.",
    image: "/walkthrough/03-call-script.png",
  },
  {
    title: "Call History",
    body: "Every outcome you log lands here. Filter by type, date, or LO. Edit after the fact if you mis-logged. Admins can view any CLR's history.",
    image: "/walkthrough/04-outcomes.png",
  },
  {
    title: "Appointments & Callbacks",
    body: "Upcoming, overdue, and completed appointments in one view. Reminders fire via email, SMS, and push. Mark each one Transferred or Fell Through to keep the pipeline accurate.",
    image: "/walkthrough/05-appointments.png",
  },
  {
    title: "LO Directory",
    body: "Every loan officer with contact info, NMLS, status, and personal preferences. See exactly when each LO was last worked. Admins manage credentials and availability here.",
    image: "/walkthrough/06-directory.png",
  },
  {
    title: "End-of-Day Report",
    body: "Submit a single summary at the end of the day. Auto-saves as a draft. Managers receive a detailed email with your stats, notes, and any extra LOs you worked off-list.",
    image: "/walkthrough/07-eod-report.png",
  },
  {
    title: "Team Stats",
    body: "Live leaderboard across all CLRs. Switch between Daily, Weekly, and All-Time views. \u201Cvs Goal\u201D shows progress against personal targets. Sortable by every metric.",
    image: "/walkthrough/08-stats.png",
  },
  {
    title: "LO Performance History",
    body: "Drill into any loan officer's full call history. Monthly trends across every outcome type — transfers, appointments, fell throughs, callbacks, and more.",
    image: "/walkthrough/09-lo-stats.png",
  },
  {
    title: "Team Chat",
    body: "Real-time team chat for quick coordination. See each other's messages live, scroll back through history, and stay in sync without leaving the app.",
    image: "/walkthrough/10-chat.png",
  },
  {
    title: "Personal Settings",
    body: "Tune your profile, script name, timezone, notification channels, and goals. Admins manage users, integrations, email reports, and exports from the same screen.",
    image: "/walkthrough/11-settings.png",
  },
  {
    title: "Help & Support",
    body: "Stuck on anything? The Support page has FAQs, the SOP manual, and a direct line to admins. Every page also has a help icon for in-context tips.",
    image: "/walkthrough/12-support.png",
  },
];

export default function IntroVideo() {
  const [index, setIndex] = useState(0);
  const total = SLIDES.length;
  const slide = SLIDES[index];
  const isFirst = index === 0;
  const isLast = index === total - 1;

  useEffect(() => {
    document.title = "Walkthrough · WCLCC";
  }, []);

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(SLIDES.length - 1, i + 1));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "ArrowRight") {
        goNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goPrev, goNext]);

  // Preload neighbor images for snappy transitions
  useEffect(() => {
    const next = SLIDES[index + 1];
    const prev = SLIDES[index - 1];
    [next, prev].forEach((s) => {
      if (s) {
        const img = new Image();
        img.src = s.image;
      }
    });
  }, [index]);

  return (
    <div
      className="min-h-full w-full flex flex-col"
      style={{ backgroundColor: NAVY }}
    >
      {/* Top bar */}
      <div className="px-6 sm:px-10 pt-6 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </Link>
        <img
          src="/wcl-logo.png"
          alt="West Capital Lending"
          className="h-8 w-auto object-contain opacity-90 brightness-0 invert"
        />
      </div>

      {/* Hero header */}
      <div className="max-w-6xl mx-auto w-full px-6 sm:px-10 pt-8 sm:pt-10 pb-4 text-center">
        <span
          className="text-xs uppercase tracking-widest font-semibold mb-3 inline-block"
          style={{ color: GOLD }}
        >
          Walkthrough
        </span>
        <h1 className="text-2xl sm:text-4xl font-bold text-white leading-tight">
          Welcome to CLR Connection Center
        </h1>
        <p className="text-white/60 text-sm sm:text-base mt-2">
          A quick tour of every page — use ← → keys or the buttons below.
        </p>
      </div>

      {/* Slide */}
      <div className="max-w-6xl mx-auto w-full px-6 sm:px-10 pb-6 flex-1">
        <div
          className="rounded-2xl overflow-hidden shadow-2xl border border-white/10"
          style={{ backgroundColor: "#0F182D" }}
        >
          <div className="grid md:grid-cols-[1fr_1.6fr]">
            {/* Caption side */}
            <div className="p-6 sm:p-8 md:p-10 flex flex-col justify-between">
              <div>
                <div
                  className="text-xs font-semibold uppercase tracking-widest mb-3"
                  style={{ color: GOLD }}
                >
                  Step {index + 1} of {total}
                </div>
                <h2 className="text-white text-2xl sm:text-3xl font-bold leading-tight mb-4">
                  {slide.title}
                </h2>
                <p className="text-white/75 text-sm sm:text-base leading-relaxed">
                  {slide.body}
                </p>
              </div>

              {/* Indicator dots */}
              <div className="flex flex-wrap gap-2 mt-8">
                {SLIDES.map((_, i) => {
                  const active = i === index;
                  return (
                    <button
                      key={i}
                      onClick={() => setIndex(i)}
                      aria-label={`Go to slide ${i + 1}`}
                      className="transition-all rounded-full"
                      style={{
                        width: active ? 24 : 8,
                        height: 8,
                        backgroundColor: active ? GOLD : "rgba(255,255,255,0.25)",
                      }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Image side */}
            <div
              className="relative bg-black/40 flex items-center justify-center p-3 sm:p-4 md:p-5"
              style={{ minHeight: 320 }}
            >
              <img
                key={slide.image}
                src={slide.image}
                alt={slide.title}
                className="w-full h-auto max-h-[60vh] object-contain rounded-lg shadow-lg"
                loading="eager"
              />
            </div>
          </div>

          {/* Footer controls */}
          <div className="flex items-center justify-between gap-3 px-6 sm:px-8 md:px-10 py-4 border-t border-white/10">
            <Button
              variant="ghost"
              onClick={goPrev}
              disabled={isFirst}
              className="text-white/80 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </Button>

            <div className="text-white/50 text-xs sm:text-sm">
              {index + 1} / {total}
            </div>

            {isLast ? (
              <Button
                asChild
                className="font-semibold"
                style={{ backgroundColor: GOLD, color: NAVY }}
              >
                <Link href="/">
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            ) : (
              <Button
                onClick={goNext}
                className="font-semibold"
                style={{ backgroundColor: GOLD, color: NAVY }}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Help link */}
      <div className="max-w-6xl mx-auto w-full px-6 sm:px-10 pb-10 flex flex-col items-center gap-3">
        <p className="text-white/50 text-sm">
          Stuck on anything? The full Help &amp; Support page has FAQs and a
          direct line to admins.
        </p>
        <Button
          asChild
          variant="outline"
          className="bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white"
        >
          <Link href="/support">
            <LifeBuoy className="w-4 h-4 mr-2" />
            Go to Help &amp; Support
          </Link>
        </Button>
      </div>
    </div>
  );
}
