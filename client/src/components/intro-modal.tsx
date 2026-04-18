import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Play, X } from "lucide-react";

export function IntroModal() {
  const { markIntroSeen } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    await markIntroSeen();
  };

  const handleStart = () => {
    setStarted(true);
    videoRef.current?.play();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div className="relative w-full max-w-4xl mx-4 rounded-2xl overflow-hidden shadow-2xl bg-[#0F182D] border border-white/10">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-white font-bold text-lg leading-tight">Welcome to CLR Connection Center</h2>
            <p className="text-white/50 text-sm mt-0.5">Watch this quick intro to get started</p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-white/40 hover:text-white/80 transition-colors p-1 rounded-lg hover:bg-white/10"
            title="Skip intro"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video container */}
        <div className="relative bg-black aspect-video">
          <video
            ref={videoRef}
            src="/videos/clr-intro-video.mp4"
            className="w-full h-full object-contain"
            controls
            playsInline
            onEnded={handleDismiss}
          />

          {/* Play overlay — only shown before first play */}
          {!started && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer bg-black/40"
              onClick={handleStart}
            >
              <div className="w-20 h-20 rounded-full bg-white/15 border-2 border-white/30 flex items-center justify-center hover:bg-white/25 transition-colors backdrop-blur-sm">
                <Play className="w-8 h-8 text-white ml-1" fill="white" />
              </div>
              <p className="text-white/70 text-sm mt-4 font-medium">Click to play · 3:31</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
          <p className="text-white/40 text-xs">
            You can rewatch this anytime from Settings
          </p>
          <Button
            onClick={handleDismiss}
            className="bg-white text-[#0F182D] hover:bg-white/90 font-semibold text-sm px-5"
          >
            Got it, let's go →
          </Button>
        </div>
      </div>
    </div>
  );
}
