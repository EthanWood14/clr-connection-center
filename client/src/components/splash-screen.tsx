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
    const fadeTimer = setTimeout(() => setFading(true), 1850);
    const unmountTimer = setTimeout(() => setShow(false), 2200);
    return () => { clearTimeout(fadeTimer); clearTimeout(unmountTimer); };
  }, [show]);

  if (!show) return null;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background:
          "radial-gradient(ellipse at center, #1a2540 0%, #0d1520 55%, #080d14 100%)",
        backgroundColor: "#0d1520",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.35s ease-out",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {/* Faint HUD grid */}
      <div
        style={{
          position: "absolute", inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at center, black 25%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 25%, transparent 80%)",
          pointerEvents: "none",
        }}
      />

      {/* Rolling CC³ logo */}
      <img
        src="/logo-icon.png"
        alt=""
        style={{
          width: 180, height: 180,
          opacity: 0,
          transform: "translateX(-300px) rotate(-360deg)",
          animation: "splash-logo-roll 0.95s cubic-bezier(0.25, 0.46, 0.45, 0.94) 0.1s forwards",
          willChange: "transform",
          borderRadius: "50%",
          overflow: "hidden",
          boxShadow:
            "inset -4px -4px 12px rgba(0,0,0,0.4), inset 4px 4px 12px rgba(255,255,255,0.08), 0 8px 32px rgba(0,0,0,0.5)",
          filter: "drop-shadow(0 12px 36px rgba(0,0,0,0.55))",
          position: "relative", zIndex: 1,
        }}
      />

      {/* Title */}
      <div
        style={{
          marginTop: 36,
          color: "#ffffff",
          fontSize: 24,
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          opacity: 0,
          transform: "translateY(8px)",
          animation: "splash-text-in 0.55s ease-out 0.95s forwards",
          position: "relative", zIndex: 1,
        }}
      >
        CLR Connection Center
      </div>

      {/* Subtitle */}
      <div
        style={{
          marginTop: 12,
          color: "#8899aa",
          fontSize: 13,
          fontWeight: 500,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          opacity: 0,
          transform: "translateY(8px)",
          animation: "splash-text-in 0.5s ease-out 1.15s forwards",
          position: "relative", zIndex: 1,
        }}
      >
        WCL Team: Team Members Only
      </div>

      {/* Bottom progress bar */}
      <div
        style={{
          position: "absolute",
          left: 0, right: 0, bottom: 0,
          height: 2,
          background: "rgba(255,255,255,0.05)",
          overflow: "hidden",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: "100%", height: "100%",
            background: "linear-gradient(90deg, #3e5379 0%, #6b85b0 100%)",
            transformOrigin: "left center",
            transform: "scaleX(0)",
            animation: "splash-bar-fill 0.6s cubic-bezier(0.4, 0, 0.2, 1) 1.25s forwards",
          }}
        />
      </div>
    </div>
  );
}
