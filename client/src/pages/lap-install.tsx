import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  Download,
  FileCheck2,
  FolderLock,
  Laptop,
  Menu,
  MonitorDown,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const BENEFITS = [
  { icon: UploadCloud, title: "Faster document entry", copy: "Open directly to the workspace and drop in Credit, AUS, and Quote files." },
  { icon: FolderLock, title: "Controlled access", copy: "Stay inside the authenticated LAP experience instead of juggling borrower files across tabs." },
  { icon: BellRing, title: "Timely updates", copy: "Allow notifications for team communication and operational reminders." },
  { icon: FileCheck2, title: "One-tap package review", copy: "Return to current borrower packages from your home screen or desktop." },
];

function Step({ number, title, children, icon: Icon }: { number: number; title: string; children: React.ReactNode; icon: any }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-muted/15 p-4">
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
          {number}
        </span>
      </div>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
export default function LapInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  const platform = useMemo(() => {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/.test(ua)) return "ios";
    if (/Android/.test(ua)) return "android";
    return "desktop";
  }, []);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true;
    setInstalled(standalone);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) return;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
      setInstallPrompt(null);
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1250px] space-y-5 p-4 sm:p-6">
      <section className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-primary via-primary to-primary/70 px-5 py-10 text-primary-foreground shadow-xl sm:px-10 sm:py-12">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-28 left-1/4 h-64 w-64 rounded-full bg-black/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div>
            <Badge className="mb-4 border-white/20 bg-white/10 text-white">
              <Sparkles className="mr-1 h-3.5 w-3.5" /> Purpose-built for LO Assistants
            </Badge>
            <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">Put LAP where the work happens.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-primary-foreground/80 sm:text-base">
              Install the LO Assistant Portal for a focused, app-like workspace with faster access to result packages, team communication, schedules, and operational resources.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              {installed ? (
                <Button disabled className="bg-white text-primary">
                  <Check /> LAP is installed
                </Button>
              ) : installPrompt ? (
                <Button onClick={() => void install()} disabled={installing} className="bg-white text-primary hover:bg-white/90">
                  <Download /> {installing ? "Opening installer…" : "Install LAP"}
                </Button>
              ) : (
                <Button
                  className="bg-white text-primary hover:bg-white/90"
                  onClick={() => document.getElementById("lap-install-instructions")?.scrollIntoView({ behavior: "smooth" })}
                >
                  <Download /> Show install steps
                </Button>
              )}
              <Button
                asChild
                variant="outline"
                className="border-white/30 bg-white/5 text-white hover:bg-white/10"
              >
                <a href="/manifest-lap.json" target="_blank" rel="noreferrer"><ShieldCheck /> LAP app manifest</a>
              </Button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[330px]">
            <div className="rounded-[2rem] border border-white/20 bg-black/20 p-3 shadow-2xl backdrop-blur">
              <div className="rounded-[1.45rem] border border-white/10 bg-background p-4 text-foreground">
                <div className="flex items-center gap-3 border-b pb-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-black text-primary-foreground">LAP</div>
                  <div>
                    <p className="font-semibold">LO Assistant Portal</p>
                    <p className="text-[10px] text-muted-foreground">West Capital Lending</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2.5">
                  {["Credit Report", "AUS Findings", "Formal Quote"].map((label, index) => (
                    <div key={label} className="flex items-center gap-3 rounded-lg border bg-muted/20 px-3 py-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                      <span className="text-xs font-medium">{label}</span>
                      <Check className="ml-auto h-3.5 w-3.5 text-emerald-600" />
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-lg bg-primary/10 px-3 py-2 text-center text-[10px] font-semibold text-primary">PACKAGE COMPLETE</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {BENEFITS.map(({ icon: Icon, title, copy }) => (
          <Card key={title}>
            <CardContent className="p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{copy}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card id="lap-install-instructions">
        <CardHeader>
          <CardTitle className="text-xl">Install instructions</CardTitle>
          <CardDescription>LAP works as a Progressive Web App. Choose your device for the exact steps.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={platform}>
            <TabsList className="grid h-auto w-full grid-cols-3 p-1">
              <TabsTrigger value="ios" className="gap-1.5"><Smartphone className="h-4 w-4" /> iPhone / iPad</TabsTrigger>
              <TabsTrigger value="android" className="gap-1.5"><Smartphone className="h-4 w-4" /> Android</TabsTrigger>
              <TabsTrigger value="desktop" className="gap-1.5"><Laptop className="h-4 w-4" /> Computer</TabsTrigger>
            </TabsList>

            <TabsContent value="ios" className="mt-5 grid gap-3 lg:grid-cols-3">
              <Step number={1} title="Open LAP in Safari" icon={Smartphone}>
                Use Safari on the iPhone or iPad. Apple’s Add to Home Screen flow is not available from every other browser.
              </Step>
              <Step number={2} title="Open the Share menu" icon={Share2}>
                Tap the Share icon in Safari, then scroll until you see <strong className="text-foreground">Add to Home Screen</strong>.
              </Step>
              <Step number={3} title="Confirm the LAP name" icon={Check}>
                Tap Add. The burgundy LAP icon will appear on the Home Screen and open without normal browser chrome.
              </Step>
            </TabsContent>

            <TabsContent value="android" className="mt-5 grid gap-3 lg:grid-cols-3">
              <Step number={1} title="Open LAP in Chrome" icon={Smartphone}>
                Sign in through Chrome and remain on the LAP workspace.
              </Step>
              <Step number={2} title="Open Chrome’s menu" icon={Menu}>
                Tap the three-dot menu and choose <strong className="text-foreground">Install app</strong> or <strong className="text-foreground">Add to Home screen</strong>.
              </Step>
              <Step number={3} title="Confirm installation" icon={Check}>
                Accept the prompt. LAP will appear in the app drawer and on the Home Screen.
              </Step>
            </TabsContent>

            <TabsContent value="desktop" className="mt-5 grid gap-3 lg:grid-cols-3">
              <Step number={1} title="Use Chrome or Edge" icon={Laptop}>
                Open LAP in a current Chrome or Edge browser and sign in.
              </Step>
              <Step number={2} title="Choose Install" icon={MonitorDown}>
                Click the install icon in the address bar. You can also find Install LAP in the browser menu.
              </Step>
              <Step number={3} title="Pin it where you work" icon={Check}>
                Keep LAP in the taskbar, Dock, or Start menu for direct access to the portal.
              </Step>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="border-primary/25 bg-primary/5">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">The installed app uses the same secure LAP session</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Installing does not copy borrower documents onto the device as a local file library. Downloads still require an authenticated, authorized request.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
