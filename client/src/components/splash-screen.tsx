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
    const fadeTimer = setTimeout(() => setFading(true), 2200);
    const unmountTimer = setTimeout(() => setShow(false), 2500);
    return () => { clearTimeout(fadeTimer); clearTimeout(unmountTimer); };
  }, [show]);

  if (!show) return null;

  const lines = Array.from({ length: 14 }, (_, i) => i);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "#0f1729",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column", opacity: fading ? 0 : 1,
        transition: "opacity 0.3s ease-out",
      }}
      aria-hidden="true"
    >
      <div style={{ position: "relative", width: 200, height: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {lines.map(i => (
          <span
            key={i}
            style={{
              position: "absolute", left: "50%", top: "50%",
              width: 2, height: 90,
              background: "linear-gradient(to top, rgba(96,165,250,0) 0%, rgba(96,165,250,0.85) 100%)",
              transformOrigin: "center bottom",
              transform: `translate(-50%, -100%) rotate(${(360 / lines.length) * i}deg)`,
              animation: `splash-burst 1.6s cubic-bezier(0.16, 1, 0.3, 1) forwards`,
              animationDelay: `${0.05 * i}s`,
              opacity: 0,
            }}
          />
        ))}
        <img
          src="/icon-512.png"
          alt=""
          style={{
            width: 120, height: 120, borderRadius: 24,
            boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
            animation: "splash-logo-in 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.15s forwards",
            opacity: 0, transform: "scale(0.8)",
            position: "relative", zIndex: 1,
          }}
        />
      </div>
      <div
        style={{
          marginTop: 28, color: "#e2e8f0", fontSize: 18, fontWeight: 600,
          letterSpacing: "0.18em", textTransform: "uppercase",
          opacity: 0,
          animation: "splash-text-in 0.7s ease-out 0.6s forwards",
        }}
      >
        CLR Connection Center
      </div>
      <div
        style={{
          marginTop: 8, color: "#94a3b8", fontSize: 13,
          opacity: 0,
          animation: "splash-text-in 0.7s ease-out 0.85s forwards",
        }}
      >
        West Capital Lending
      </div>
    </div>
  );
}
