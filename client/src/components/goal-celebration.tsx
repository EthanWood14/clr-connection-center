import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Trophy, X } from "lucide-react";
import { Button } from "@/components/ui/button";

// ─── Canvas confetti ─────────────────────────────────────────────────────────
// Lightweight, self-contained. No external deps. Runs ~3 seconds.
const COLORS = [
  "#C9A24A", // gold (CLR brand)
  "#0F182D", // navy (CLR brand)
  "#F8C461",
  "#3B82F6",
  "#16A34A",
  "#A855F7",
  "#EF4444",
  "#FFFFFF",
];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  shape: "rect" | "circle";
  life: number;
};

function spawnBurst(
  particles: Particle[],
  originX: number,
  originY: number,
  count: number,
  powerX = 14,
  powerY = 22,
) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 8;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed * (powerX / 14) + (Math.random() - 0.5) * 2,
      vy: Math.sin(angle) * speed * (powerY / 22) - Math.random() * 6,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.35,
      size: 6 + Math.random() * 7,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: Math.random() > 0.5 ? "rect" : "circle",
      life: 1,
    });
  }
}

function Confetti({ running }: { running: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!running) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    particlesRef.current = [];
    startRef.current = performance.now();

    // Three bursts: bottom-left cannon, bottom-right cannon, top
    const burstLeft = () => spawnBurst(particlesRef.current, 40, window.innerHeight - 40, 80, 20, 26);
    const burstRight = () => spawnBurst(particlesRef.current, window.innerWidth - 40, window.innerHeight - 40, 80, 20, 26);
    const burstCenter = () => spawnBurst(particlesRef.current, window.innerWidth / 2, window.innerHeight / 3, 60, 16, 18);

    burstLeft();
    burstRight();
    const centerTimer = setTimeout(burstCenter, 350);
    const extraLeft = setTimeout(burstLeft, 900);
    const extraRight = setTimeout(burstRight, 900);

    const GRAVITY = 0.45;
    const FRICTION = 0.99;

    const tick = () => {
      const now = performance.now();
      const elapsed = now - startRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const ps = particlesRef.current;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.vy += GRAVITY;
        p.vx *= FRICTION;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006;

        if (p.y > window.innerHeight + 40 || p.life <= 0) {
          ps.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (elapsed < 4500 || ps.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", resize);
      clearTimeout(centerTimer);
      clearTimeout(extraLeft);
      clearTimeout(extraRight);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [running]);

  if (!running) return null;
  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9998,
      }}
      aria-hidden="true"
    />
  );
}

// ─── Overlay ─────────────────────────────────────────────────────────────────
export function GoalCelebration({
  show,
  onClose,
  headline = "Weekly goals crushed!",
  subline = "You hit every target this week. Keep the momentum going.",
}: {
  show: boolean;
  onClose: () => void;
  headline?: string;
  subline?: string;
}) {
  const [mounted, setMounted] = useState(false);

  // Mount/unmount with a small delay to let confetti run even after overlay closes
  useEffect(() => {
    if (show) setMounted(true);
  }, [show]);

  // Auto-dismiss after 6s
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [show, onClose]);

  if (!mounted) return null;

  const node = (
    <>
      <Confetti running={show} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="celebration-headline"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: show ? "flex" : "none",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: show ? "auto" : "none",
        }}
        onClick={onClose}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative max-w-md w-[92%] rounded-2xl shadow-2xl"
          style={{
            background: "linear-gradient(135deg, #0F182D 0%, #1c2b4d 100%)",
            color: "white",
            padding: "40px 32px 32px",
            textAlign: "center",
            animation: show ? "celebration-pop 480ms cubic-bezier(.2,.9,.3,1.25) both" : undefined,
            boxShadow: "0 30px 80px rgba(0,0,0,.5), 0 0 0 1px rgba(201,162,74,.4)",
          }}
        >
          <button
            onClick={onClose}
            aria-label="Dismiss celebration"
            className="absolute top-3 right-3 text-white/60 hover:text-white transition"
            style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer" }}
          >
            <X className="w-5 h-5" />
          </button>

          <div
            className="mx-auto mb-4 flex items-center justify-center rounded-full"
            style={{
              width: 72,
              height: 72,
              background: "linear-gradient(135deg, #C9A24A 0%, #F8C461 100%)",
              boxShadow: "0 10px 30px rgba(201,162,74,.5)",
              animation: show ? "celebration-trophy 1.6s ease-in-out infinite" : undefined,
            }}
          >
            <Trophy className="w-9 h-9 text-[#0F182D]" />
          </div>

          <h2
            id="celebration-headline"
            className="text-2xl font-bold mb-2"
            style={{ color: "#F8C461", letterSpacing: "-.01em" }}
          >
            {headline}
          </h2>
          <p className="text-sm text-white/80 mb-6">{subline}</p>
          <Button onClick={onClose} className="bg-white/10 hover:bg-white/20 text-white border-0">
            Keep going
          </Button>
        </div>
      </div>
      <style>{`
        @keyframes celebration-pop {
          0% { opacity: 0; transform: scale(.8) translateY(16px); }
          60% { opacity: 1; transform: scale(1.02); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes celebration-trophy {
          0%, 100% { transform: rotate(-6deg); }
          50% { transform: rotate(6deg); }
        }
      `}</style>
    </>
  );

  return createPortal(node, document.body);
}

// ─── Hook ────────────────────────────────────────────────────────────────────
// Fires the celebration the first time all active weekly goals are met,
// once per ISO week per user. Persisted in localStorage.

export type GoalProgress = {
  goals: { calls?: number; transfers?: number; appointments?: number };
  weekToDate: {
    startDate: string;
    endDate: string;
    calls?: number;
    transfers?: number;
    appointments?: number;
    fellThrough?: number;
  };
};

function allGoalsMet(data: GoalProgress | undefined | null): boolean {
  if (!data?.goals || !data?.weekToDate) return false;
  const g = data.goals;
  const w = data.weekToDate;
  const active: boolean[] = [];

  if ((g.calls ?? 0) > 0) active.push((w.calls ?? 0) >= (g.calls ?? 0));
  if ((g.transfers ?? 0) > 0) active.push((w.transfers ?? 0) >= (g.transfers ?? 0));
  if ((g.appointments ?? 0) > 0) {
    const combined = (w.appointments ?? 0) + (w.transfers ?? 0) + (w.fellThrough ?? 0);
    active.push(combined >= (g.appointments ?? 0));
  }

  return active.length > 0 && active.every(Boolean);
}

export function useGoalCelebration(
  data: GoalProgress | undefined | null,
  userId: number | string | null | undefined,
) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!data || !userId) return;
    if (!allGoalsMet(data)) return;

    const weekStart = data.weekToDate?.startDate ?? "";
    if (!weekStart) return;

    const storageKey = `clrcc.goalCelebration.${userId}.${weekStart}`;
    try {
      if (localStorage.getItem(storageKey)) return; // already seen this week
      localStorage.setItem(storageKey, String(Date.now()));
    } catch {
      // if storage is disabled, still celebrate once per page load
    }

    // Brief delay so it doesn't flash immediately on mount
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, [data, userId]);

  return {
    show,
    dismiss: () => setShow(false),
  };
}
