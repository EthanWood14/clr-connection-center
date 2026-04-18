import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, LifeBuoy } from "lucide-react";

const NAVY = "#1A2B4A";
const GOLD = "#C49A3C";

export default function IntroVideo() {
  useEffect(() => {
    document.title = "Intro Video · WCLCC";
  }, []);

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

      {/* Hero */}
      <div className="max-w-4xl mx-auto w-full px-6 sm:px-10 pt-12 pb-16 flex flex-col items-center text-center">
        <span
          className="text-xs uppercase tracking-widest font-semibold mb-4"
          style={{ color: GOLD }}
        >
          Welcome
        </span>
        <h1 className="text-3xl sm:text-5xl font-bold text-white mb-4 leading-tight">
          Welcome to CLR Connection Center
        </h1>
        <p className="text-white/70 text-base sm:text-lg max-w-2xl mb-10">
          Your complete platform for lead distribution, appointment tracking,
          and team performance at West Capital Lending.
        </p>

        {/* Video */}
        <div className="w-full">
          <video
            controls
            className="w-full rounded-xl shadow-2xl bg-black"
            src="/videos/clr-intro-video.mp4"
          />
        </div>

        {/* Help link */}
        <div className="mt-10 flex flex-col items-center gap-3">
          <p className="text-white/60 text-sm">
            Having trouble? Visit the full Help &amp; Support page.
          </p>
          <Button
            asChild
            className="font-semibold"
            style={{ backgroundColor: GOLD, color: NAVY }}
          >
            <Link href="/support">
              <LifeBuoy className="w-4 h-4 mr-2" />
              Go to Help &amp; Support
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
