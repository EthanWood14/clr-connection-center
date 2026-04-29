import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Compass, X } from "lucide-react";

const NAVY = "#1A2B4A";
const GOLD = "#C49A3C";

export function IntroModal() {
  const { markIntroSeen } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await markIntroSeen();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-2xl mx-4 rounded-2xl overflow-hidden shadow-2xl bg-[#0F182D] border border-white/10">

        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">Welcome to CLR Connection Center</h2>
            <p className="text-white/50 text-sm mt-0.5">A quick walkthrough of the platform</p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white/80 transition-colors p-1 rounded-lg hover:bg-white/10"
            title="Skip walkthrough"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-8 sm:py-10 flex flex-col items-center text-center">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center mb-5"
            style={{ backgroundColor: "rgba(196, 154, 60, 0.15)" }}
          >
            <Compass className="w-10 h-10" style={{ color: GOLD }} />
          </div>
          <h3 className="text-white text-xl sm:text-2xl font-bold mb-3">
            Take the 12-step tour
          </h3>
          <p className="text-white/70 text-sm sm:text-base max-w-md leading-relaxed mb-2">
            See every page of CLR Connection Center — Dashboard, Daily Assignments,
            Call Script, Stats, and more — at your own pace. Takes about a minute.
          </p>
          <p className="text-white/40 text-xs">
            You can revisit this anytime from the sidebar.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-white/10">
          <button
            onClick={handleDismiss}
            className="text-white/50 hover:text-white/80 text-sm transition-colors"
          >
            Skip for now
          </button>
          <Button
            asChild
            onClick={handleDismiss}
            className="font-semibold"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            <Link href="/intro-video">
              Start the walkthrough →
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
