import { useEffect, useState } from "react";

const SESSION_KEY = "splash_shown";

export function SplashScreen() {
  const [show, setShow] = useState(() => {
    try { return sessionStorage.getItem(SESSION_KEY) !== "1"; } catch { return true; }
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!show) return;
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
    const fadeTimer = setTimeout(() => setFading(true), 1500);
    const unmountTimer = setTimeout(() => setShow(false), 1850);
    return () => { clearTimeout(fadeTimer); clearTimeout(unmountTimer); };
  }, [show]);

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background:
          "radial-gradient(ellipse at center, #3e5379 0%, #1a2540 60%, #0e1729 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.35s ease-out",
      }}
      aria-hidden="true"
    >
      {/* Subtle grid overlay for premium feel */}
      <div
        style={{
          position: "absolute", inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          pointerEvents: "none",
        }}
      />

      {/* Logo lockup */}
      <img
        src="/logo-white-full.svg"
        alt=""
        style={{
          width: 320, maxWidth: "70vw", height: "auto",
          opacity: 0, transform: "scale(0.85)",
          animation: "splash-logo-in 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards",
          filter: "drop-shadow(0 8px 32px rgba(0,0,0,0.45))",
          position: "relative", zIndex: 1,
        }}
      />

      {/* Tagline */}
      <div
        style={{
          marginTop: 28,
          color: "rgba(226, 232, 240, 0.78)",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          opacity: 0,
          transform: "translateY(8px)",
          animation: "splash-text-in 0.6s ease-out 0.55s forwards",
          position: "relative", zIndex: 1,
        }}
      >
        West Capital Lending
      </div>

      {/* Loading bar */}
      <div
        style={{
          marginTop: 32,
          width: 180, height: 2,
          background: "rgba(255,255,255,0.08)",
          borderRadius: 999,
          overflow: "hidden",
          position: "relative", zIndex: 1,
          opacity: 0,
          animation: "splash-text-in 0.5s ease-out 0.7s forwards",
        }}
      >
        <div
          style={{
            position: "absolute", top: 0, left: 0, bottom: 0,
            width: "35%",
            background:
              "linear-gradient(90deg, rgba(96,165,250,0) 0%, rgba(147,197,253,0.95) 50%, rgba(96,165,250,0) 100%)",
            borderRadius: 999,
            animation: "splash-bar-slide 1.2s cubic-bezier(0.4, 0, 0.2, 1) 0.8s infinite",
          }}
        />
      </div>
    </div>
  );
}
