import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { applyProductMetadata } from "@/lib/product-metadata";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { UpdatePrompt } from "@/components/update-prompt";
import { LapSidebar } from "./lap-sidebar";
import { LapMobileNav } from "./lap-mobile-nav";
import { LapFooter } from "./lap-footer";
import { LapNotificationBell } from "./lap-notification-bell";
import { LapThemeToggle } from "./lap-theme-toggle";
import { LapPasswordGate } from "./lap-password-gate";
import LapLogin from "@/pages/lap-login";
import LapDashboard from "@/pages/lap-dashboard";
import LapResults from "@/pages/lap-results";
import LapLoProfiles from "@/pages/lap-lo-profiles";
import LapInstall from "@/pages/lap-install";
import LapResources from "@/pages/lap-resources";
import LapSettings from "@/pages/lap-settings";
import CheckIns from "@/pages/check-ins";
import TimeClock from "@/pages/time-clock";
import TimeOff from "@/pages/time-off";
import WeeklySchedule from "@/pages/weekly-schedule";
import CompRequests from "@/pages/comp-requests";
import Forum from "@/pages/forum";
import Chat from "@/pages/chat";
import StateLookup from "@/pages/state-lookup";
import CallHours from "@/pages/call-hours";
import TeamStats from "@/pages/team-stats";
import ReportsArchive from "@/pages/reports-archive";

const LAP_TITLES: Record<string, string> = {
  "/": "Home",
  "/results": "Input Results",
  "/input-results": "Input Results",
  "/check-ins": "Check-In",
  "/time-clock": "Time Clock",
  "/time-off": "Time Off",
  "/my-schedule": "Weekly Schedule",
  "/comp-requests": "Comp Requests",
  "/team-stats": "Team Stats",
  "/forum": "Forum",
  "/chat": "Team Chat",
  "/lo-profiles": "LO Profiles",
  "/state-lookup": "State Lookup",
  "/call-hours": "Call Hours",
  "/install": "Install LAP",
  "/resources": "LO Resources",
  "/reports-archive": "Report Archive",
  "/settings": "Settings",
};

function lapTitle(location: string) {
  const exact = LAP_TITLES[location];
  if (exact) return `${exact} · LAP`;
  if (location.startsWith("/results/")) return "Result Package · LAP";
  if (location.startsWith("/lo-profiles/")) return "LO Profile · LAP";
  return "LAP · LO Assistant Portal";
}

function useLapProductMetadata() {
  const [location] = useLocation();

  useEffect(() => {
    applyProductMetadata("lap");
  }, []);

  useEffect(() => {
    const expected = lapTitle(location);
    const apply = () => {
      if (document.title !== expected) document.title = expected;
    };
    apply();
    const timer = window.setTimeout(apply, 0);
    const observer = new MutationObserver(apply);
    const title = document.head.querySelector("title");
    if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [location]);
}

function LapNotFound() {
  const [, navigate] = useLocation();
  return (
    <div className="flex min-h-[55vh] items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">LAP</p>
        <h1 className="mt-3 text-3xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          That destination is not part of the LO Assistant Portal.
        </p>
        <button
          type="button"
          onClick={() => navigate("/")}
          className="mt-6 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Return home
        </button>
      </div>
    </div>
  );
}

function LapForum() {
  return <Forum portal="lap" />;
}

function LapChat() {
  return <Chat portal="lap" />;
}

function LapRouter() {
  return (
    <Switch>
      <Route path="/" component={LapDashboard} />
      <Route path="/results/:resultId" component={LapResults} />
      <Route path="/results" component={LapResults} />
      <Route path="/input-results" component={LapResults} />
      <Route path="/check-ins" component={CheckIns} />
      <Route path="/time-clock" component={TimeClock} />
      <Route path="/time-off" component={TimeOff} />
      <Route path="/my-schedule" component={WeeklySchedule} />
      <Route path="/comp-requests" component={CompRequests} />
      <Route path="/team-stats" component={TeamStats} />
      <Route path="/forum" component={LapForum} />
      <Route path="/chat" component={LapChat} />
      <Route path="/lo-profiles" component={LapLoProfiles} />
      <Route path="/state-lookup" component={StateLookup} />
      <Route path="/call-hours" component={CallHours} />
      <Route path="/install" component={LapInstall} />
      <Route path="/resources" component={LapResources} />
      <Route path="/reports-archive" component={ReportsArchive} />
      <Route path="/settings" component={LapSettings} />
      <Route component={LapNotFound} />
    </Switch>
  );
}

function LapAuthenticatedShell() {
  const style = { "--sidebar-width": "16.5rem" } as React.CSSProperties;

  return (
    <SidebarProvider defaultOpen style={style}>
      <UpdatePrompt portal="lap" />
      <div className="lap-shell flex h-screen w-full flex-col overflow-hidden">
        <ImpersonationBanner returnLabel="Exit organization view" />
        <div className="flex min-h-0 flex-1 overflow-hidden p-0 md:gap-3 md:p-3">
          <LapSidebar />
          <div className="flex min-w-0 flex-1 flex-col gap-2 md:gap-3">
            <header className="glass-header sticky top-0 z-40 flex h-12 shrink-0 items-center justify-between px-3">
              <div className="flex items-center gap-2">
                <SidebarTrigger data-testid="lap-sidebar-toggle" className="-ml-1" />
                <span className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:inline">
                  LO Assistant Portal
                </span>
              </div>
              <div className="flex items-center gap-1">
                <LapNotificationBell />
                <LapThemeToggle />
              </div>
            </header>

            <main className="glass-panel flex flex-1 flex-col overflow-auto pb-16 md:pb-0">
              <div className="flex-1"><LapRouter /></div>
              <LapFooter />
            </main>
            <LapMobileNav />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}

export function LapApp() {
  useLapProductMetadata();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="lap-login flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-xl">
          <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
          <span className="text-sm font-medium text-muted-foreground">Opening LAP…</span>
        </div>
      </div>
    );
  }

  if (!user) return <LapLogin />;
  if (user.mustChangePassword) return <LapPasswordGate />;
  return <LapAuthenticatedShell />;
}
