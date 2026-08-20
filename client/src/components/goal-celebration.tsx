import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Trophy, X, Zap } from "lucide-react";
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

function Confetti({ running, dramatic = false }: { running: boolean; dramatic?: boolean }) {
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

    const multiplier = dramatic ? 2.1 : 1;
    const burstLeft = () => spawnBurst(particlesRef.current, 40, window.innerHeight - 40, Math.round(80 * multiplier), 22, 29);
    const burstRight = () => spawnBurst(particlesRef.current, window.innerWidth - 40, window.innerHeight - 40, Math.round(80 * multiplier), 22, 29);
    const burstCenter = () => spawnBurst(particlesRef.current, window.innerWidth / 2, window.innerHeight / 3, Math.round(60 * multiplier), 18, 21);

    burstLeft();
    burstRight();
    const centerTimer = setTimeout(burstCenter, 350);
    const extraLeft = setTimeout(burstLeft, 900);
    const extraRight = setTimeout(burstRight, 900);
    const finaleCenter = dramatic ? setTimeout(burstCenter, 1700) : undefined;
    const finaleLeft = dramatic ? setTimeout(burstLeft, 2400) : undefined;
    const finaleRight = dramatic ? setTimeout(burstRight, 2400) : undefined;

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
      if (finaleCenter) clearTimeout(finaleCenter);
      if (finaleLeft) clearTimeout(finaleLeft);
      if (finaleRight) clearTimeout(finaleRight);
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [running, dramatic]);

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
  buttonLabel = "Keep going",
  variant = "goal",
}: {
  show: boolean;
  onClose: () => void;
  headline?: string;
  subline?: string;
  buttonLabel?: string;
  variant?: "goal" | "transfer";
}) {
  const [mounted, setMounted] = useState(false);
  const dramatic = variant === "transfer";

  // Mount/unmount with a small delay to let confetti run even after overlay closes
  useEffect(() => {
    if (show) setMounted(true);
  }, [show]);

  // Auto-dismiss after 6s
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(onClose, dramatic ? 8500 : 6000);
    return () => clearTimeout(t);
  }, [show, onClose, dramatic]);

  if (!mounted) return null;

  const node = (
    <>
      <Confetti running={show} dramatic={dramatic} />
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
          background: show
            ? dramatic
              ? "radial-gradient(circle at 50% 42%, rgba(248,196,97,.26) 0%, rgba(79,70,229,.34) 25%, rgba(15,24,45,.91) 62%, rgba(2,6,23,.98) 100%)"
              : "radial-gradient(circle at center, rgba(59,130,246,.28) 0%, rgba(15,24,45,.76) 48%, rgba(2,6,23,.9) 100%)"
            : "transparent",
          backdropFilter: show ? "blur(3px)" : undefined,
          animation: show ? "celebration-backdrop-in 300ms ease-out both" : undefined,
        }}
        onClick={onClose}
      >
        {dramatic && <div className="celebration-rays" aria-hidden="true" />}
        {dramatic && <div className="celebration-orbit celebration-orbit-one" aria-hidden="true" />}
        {dramatic && <div className="celebration-orbit celebration-orbit-two" aria-hidden="true" />}
        <div
          onClick={(e) => e.stopPropagation()}
          className={`relative w-[92%] shadow-2xl ${dramatic ? "max-w-2xl rounded-[32px] celebration-transfer-card" : "max-w-md rounded-2xl"}`}
          style={{
            background: dramatic
              ? "linear-gradient(145deg, rgba(15,24,45,.96) 0%, rgba(31,42,77,.96) 48%, rgba(51,34,91,.96) 100%)"
              : "linear-gradient(135deg, #0F182D 0%, #1c2b4d 100%)",
            color: "white",
            padding: dramatic ? "58px 40px 44px" : "40px 32px 32px",
            textAlign: "center",
            animation: show ? "celebration-pop 480ms cubic-bezier(.2,.9,.3,1.25) both" : undefined,
            boxShadow: dramatic
              ? "0 40px 120px rgba(0,0,0,.72), 0 0 90px rgba(201,162,74,.28), 0 0 0 1px rgba(248,196,97,.65)"
              : "0 30px 80px rgba(0,0,0,.5), 0 0 0 1px rgba(201,162,74,.4)",
          }}
        >
          {dramatic && <div className="celebration-shine" aria-hidden="true" />}
          <button
            onClick={onClose}
            aria-label="Dismiss celebration"
            className="absolute top-3 right-3 text-white/60 hover:text-white transition"
            style={{ padding: 4, background: "transparent", border: "none", cursor: "pointer" }}
          >
            <X className="w-5 h-5" />
          </button>

          {dramatic && <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-4 py-1.5 text-[11px] font-black uppercase tracking-[.28em] text-amber-200"><Zap className="h-3.5 w-3.5 fill-current" /> Transfer secured <Sparkles className="h-3.5 w-3.5" /></div>}
          <div
            className="mx-auto mb-4 flex items-center justify-center rounded-full"
            style={{
              width: dramatic ? 106 : 72,
              height: dramatic ? 106 : 72,
              background: "linear-gradient(135deg, #C9A24A 0%, #F8C461 100%)",
              boxShadow: dramatic ? "0 0 0 12px rgba(248,196,97,.08), 0 18px 55px rgba(248,196,97,.62)" : "0 10px 30px rgba(201,162,74,.5)",
              animation: show ? "celebration-trophy 1.6s ease-in-out infinite" : undefined,
            }}
          >
            <Trophy className={dramatic ? "h-14 w-14 text-[#0F182D]" : "h-9 w-9 text-[#0F182D]"} />
          </div>

          <h2
            id="celebration-headline"
            className={dramatic ? "mb-3 text-4xl font-black uppercase tracking-tight sm:text-6xl" : "mb-2 text-2xl font-bold"}
            style={{ color: "#F8C461", letterSpacing: "-.01em" }}
          >
            {headline}
          </h2>
          <p className={dramatic ? "mx-auto mb-8 max-w-lg text-base font-medium leading-relaxed text-white/85 sm:text-lg" : "mb-6 text-sm text-white/80"}>{subline}</p>
          <Button onClick={onClose} className={dramatic ? "h-12 rounded-full border border-amber-200/30 bg-gradient-to-r from-amber-300 to-yellow-500 px-9 font-black text-slate-950 shadow-[0_12px_35px_rgba(248,196,97,.3)] hover:from-amber-200 hover:to-yellow-400" : "border-0 bg-white/10 text-white hover:bg-white/20"}>
            {buttonLabel}
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
        @keyframes celebration-backdrop-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .celebration-rays { position:absolute; width:min(105vw,1100px); aspect-ratio:1; opacity:.3; background:repeating-conic-gradient(from 0deg, rgba(248,196,97,.42) 0deg 3deg, transparent 3deg 18deg); mask-image:radial-gradient(circle, #000 0 44%, transparent 72%); animation:celebration-rays-spin 22s linear infinite; }
        .celebration-orbit { position:absolute; border:1px solid rgba(248,196,97,.28); border-radius:9999px; animation:celebration-orbit-pulse 2.2s ease-out infinite; }
        .celebration-orbit-one { width:min(74vw,760px); aspect-ratio:1; }
        .celebration-orbit-two { width:min(92vw,960px); aspect-ratio:1; animation-delay:.7s; }
        .celebration-transfer-card { overflow:hidden; }
        .celebration-transfer-card::before { content:""; position:absolute; inset:-2px; border-radius:inherit; padding:2px; background:linear-gradient(115deg,#f8c461,transparent 35%,#a78bfa 65%,#f8c461); -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; pointer-events:none; }
        .celebration-shine { position:absolute; inset:-80% -30%; background:linear-gradient(105deg,transparent 42%,rgba(255,255,255,.16) 49%,transparent 56%); transform:translateX(-55%); animation:celebration-shine 2.2s ease-in-out .45s both; pointer-events:none; }
        @keyframes celebration-rays-spin { to { transform:rotate(360deg); } }
        @keyframes celebration-orbit-pulse { 0% { transform:scale(.68); opacity:0; } 35% { opacity:.8; } 100% { transform:scale(1.12); opacity:0; } }
        @keyframes celebration-shine { to { transform:translateX(55%); } }
        @media (prefers-reduced-motion: reduce) {
          [role="dialog"] > div { animation: none !important; }
          .celebration-rays, .celebration-orbit, .celebration-shine { animation:none !important; }
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
