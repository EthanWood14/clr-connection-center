import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Smartphone, Monitor, Apple, Chrome, Share2,
  Download, CheckCircle2, PlusSquare, MoreVertical, ArrowDown,
} from "lucide-react";

// Detect platform
function getPlatform(): "ios" | "android" | "desktop-chrome" | "desktop-other" {
  if (typeof navigator === "undefined") return "desktop-other";
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream;
  if (isIOS) return "ios";
  const isAndroid = /Android/.test(ua);
  if (isAndroid) return "android";
  const isChrome = /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor);
  if (isChrome) return "desktop-chrome";
  return "desktop-other";
}

// Step block component
function Step({ number, icon: Icon, title, children }: {
  number: number;
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 border-2 border-primary/20 flex items-center justify-center font-bold text-primary text-sm">
        {number}
      </div>
      <div className="flex-1 pb-6 border-b border-border/50 last:border-0 last:pb-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="w-4 h-4 text-primary" />
          <p className="font-semibold text-sm">{title}</p>
        </div>
        <div className="text-sm text-muted-foreground leading-relaxed space-y-1">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function InstallPage() {
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop-chrome" | "desktop-other">("desktop-chrome");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const [activeTab, setActiveTab] = useState<"ios" | "android" | "desktop-chrome" | "desktop-other">("desktop-chrome");

  useEffect(() => {
    const detected = getPlatform();
    setPlatform(detected);
    setActiveTab(detected);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    window.addEventListener("appinstalled", () => setInstalled(true));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  };

  const tabs = [
    { id: "ios" as const,            icon: Apple,    label: "iPhone / iPad" },
    { id: "android" as const,        icon: Smartphone, label: "Android" },
    { id: "desktop-chrome" as const, icon: Chrome,   label: "Desktop (Chrome)" },
    { id: "desktop-other" as const,  icon: Monitor,  label: "Desktop (Other)" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      {/* Hero — inline gradient (Tailwind arbitrary-color stops weren't always emitting,
           which made the navy background drop out and left white text invisible on the
           light-mode page). Inline style is bulletproof. */}
      <div
        className="rounded-2xl overflow-hidden text-white p-6 sm:p-8"
        style={{ background: "linear-gradient(to bottom right, #0F182D, #1A3A6A)" }}
      >
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center shadow-lg">
            <img
              src="/wcl-logo.png"
              alt="WCL"
              className="w-10 h-10 object-contain brightness-0 invert"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">CLR Connection Center</h1>
            <p className="text-white/60 text-sm mt-0.5">WCL Team: Team Members Only</p>
          </div>
        </div>
        <p className="text-white/80 text-sm leading-relaxed mb-6">
          Install the CLR Connection Center as an app on your device for instant access — no browser needed.
          Works on phones, tablets, and desktop computers.
        </p>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 mb-6">
          {["Faster launch", "Full screen", "Works offline", "Home screen icon"].map(f => (
            <span key={f} className="px-3 py-1 rounded-full bg-white/10 text-white/80 text-xs font-medium border border-white/10">
              {f}
            </span>
          ))}
        </div>

        {/* One-click install (Chrome/Android only when prompt available) */}
        {deferredPrompt && !installed && (
          <Button
            size="lg"
            onClick={handleInstallClick}
            className="w-full bg-white text-[#0F182D] hover:bg-white/90 font-bold gap-2 shadow-lg"
          >
            <Download className="w-5 h-5" />
            Install App Now
          </Button>
        )}
        {installed && (
          <div className="flex items-center gap-2 text-emerald-300 font-semibold">
            <CheckCircle2 className="w-5 h-5" />
            App installed successfully!
          </div>
        )}
        {!deferredPrompt && !installed && (
          <div className="flex items-center gap-2 bg-white/10 rounded-xl px-4 py-3 border border-white/10">
            <ArrowDown className="w-4 h-4 text-white/60 flex-shrink-0" />
            <p className="text-white/70 text-sm">Follow the steps below for your device</p>
          </div>
        )}
      </div>

      {/* Platform tabs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-primary" />
            Install Instructions
            <Badge variant="secondary" className="ml-auto text-xs">
              {tabs.find(t => t.id === platform)?.label ?? "Your Device"} detected
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Tab selector */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {tabs.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border
                    ${activeTab === t.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* iOS */}
          {activeTab === "ios" && (
            <div className="space-y-0">
              <Step number={1} icon={Chrome} title="Open in Safari">
                <p>Open <strong className="text-foreground">CLR Connection Center</strong> in Safari on your iPhone or iPad. This only works from Safari — not Chrome or other browsers.</p>
              </Step>
              <Step number={2} icon={Share2} title='Tap the Share button'>
                <p>At the bottom of the screen, tap the <strong className="text-foreground">Share</strong> icon (the box with an arrow pointing up).</p>
              </Step>
              <Step number={3} icon={PlusSquare} title='"Add to Home Screen"'>
                <p>Scroll down in the share sheet and tap <strong className="text-foreground">"Add to Home Screen"</strong>. You may need to scroll right or down to find it.</p>
              </Step>
              <Step number={4} icon={CheckCircle2} title="Confirm & Done">
                <p>Tap <strong className="text-foreground">Add</strong> in the top-right corner. The WCLCC icon will appear on your home screen — tap it to open the app.</p>
              </Step>
            </div>
          )}

          {/* Android */}
          {activeTab === "android" && (
            <div className="space-y-0">
              <Step number={1} icon={Chrome} title="Open in Chrome">
                <p>Open <strong className="text-foreground">CLR Connection Center</strong> in Google Chrome on your Android device.</p>
              </Step>
              <Step number={2} icon={MoreVertical} title="Open the Chrome menu">
                <p>Tap the <strong className="text-foreground">three-dot menu</strong> (⋮) in the top-right corner of Chrome.</p>
              </Step>
              <Step number={3} icon={PlusSquare} title='"Add to Home screen" or "Install app"'>
                <p>Tap <strong className="text-foreground">"Add to Home screen"</strong> or <strong className="text-foreground">"Install app"</strong> from the menu. If Chrome detects the app automatically, a banner may appear at the bottom — tap it!</p>
              </Step>
              <Step number={4} icon={CheckCircle2} title="Confirm & Done">
                <p>Confirm the install. The WCLCC icon appears on your home screen and app drawer.</p>
              </Step>
            </div>
          )}

          {/* Desktop Chrome */}
          {activeTab === "desktop-chrome" && (
            <div className="space-y-0">
              <Step number={1} icon={Chrome} title="Look for the install icon">
                <p>In Chrome's address bar, look for a <strong className="text-foreground">computer + download icon</strong> (⊕) on the right side. If you see it, click it to install instantly.</p>
              </Step>
              <Step number={2} icon={MoreVertical} title="Or use the Chrome menu">
                <p>Click the <strong className="text-foreground">three-dot menu</strong> (⋮) in the top-right corner of Chrome and select <strong className="text-foreground">"Save and share" → "Install as app…"</strong></p>
              </Step>
              <Step number={3} icon={CheckCircle2} title="Confirm & Done">
                <p>Click <strong className="text-foreground">Install</strong> in the dialog. WCLCC opens in its own window and appears in your taskbar and Start menu / Dock.</p>
              </Step>
            </div>
          )}

          {/* Desktop Other */}
          {activeTab === "desktop-other" && (
            <div className="space-y-0">
              <Step number={1} icon={Chrome} title="Switch to Google Chrome">
                <p>PWA installation is best supported in <strong className="text-foreground">Google Chrome</strong> or <strong className="text-foreground">Microsoft Edge</strong>. Open the site in one of those browsers.</p>
              </Step>
              <Step number={2} icon={Download} title="Edge: Install via menu">
                <p>In Edge, click the <strong className="text-foreground">three-dot menu</strong> (…) → <strong className="text-foreground">Apps</strong> → <strong className="text-foreground">"Install this site as an app"</strong>.</p>
              </Step>
              <Step number={3} icon={CheckCircle2} title="Confirm & Done">
                <p>Click <strong className="text-foreground">Install</strong>. The app opens in its own window with a dedicated taskbar entry.</p>
              </Step>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Benefits */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Why Install?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { icon: "⚡", title: "Instant access", desc: "Launch directly from your home screen or taskbar without opening a browser." },
              { icon: "🖥️", title: "Distraction-free", desc: "Runs in its own window, no browser tabs or toolbar clutter." },
              { icon: "📵", title: "Offline shell", desc: "The app shell loads even when connectivity is spotty." },
              { icon: "🔔", title: "Stays in sync", desc: "Same data as the web app — no duplicate accounts needed." },
            ].map(b => (
              <div key={b.title} className="flex gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                <span className="text-xl flex-shrink-0">{b.icon}</span>
                <div>
                  <p className="text-sm font-semibold">{b.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{b.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Footer note */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        The CLR Connection Center PWA was developed for WCL Team: Team Members Only.
        © 2026 WCL Team: Team Members Only · Built by Chris Redoble & Ethan Wood
      </p>
    </div>
  );
}
