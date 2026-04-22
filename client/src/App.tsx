import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { NotificationBell } from "@/components/notification-bell";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { IntroModal } from "@/components/intro-modal";
import { NmlsOverduePopup } from "@/components/nmls-overdue-popup";
import { DailyReportGate } from "@/components/daily-report-gate";
import { AppFooter } from "@/components/app-footer";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";

import Dashboard from "@/pages/dashboard";
import Directory from "@/pages/directory";
import Assignments from "@/pages/assignments";
import Outcomes from "@/pages/outcomes";
import Leaderboard from "@/pages/leaderboard";
import TeamStats from "@/pages/team-stats";
import Settings from "@/pages/settings";
import StateLookup from "@/pages/state-lookup";
import Appointments from "@/pages/appointments";
import Snooze from "@/pages/snooze";
import Reporting from "@/pages/reporting";
import AuditLog from "@/pages/audit-log";
import NmlsChecks from "@/pages/nmls-checks";
import NmlsStatus from "@/pages/nmls-status";
import LoPerformance from "@/pages/lo-performance";
import PrivacyPolicy from "@/pages/privacy-policy";
import TermsOfUse from "@/pages/terms-of-use";
import Chat from "@/pages/chat";
import EodReport from "@/pages/eod-report";
import MyReport from "@/pages/my-report";
import InstallApp from "@/pages/install";
import Support from "@/pages/support";
import IntroVideo from "@/pages/intro-video";
import CallScript from "@/pages/call-script";
import GlossaryPage from "@/pages/glossary";
import LoVacation from "@/pages/lo-vacation";
import WebhookSettings from "@/pages/webhook-settings";
import Integrations from "@/pages/integrations";
import BonzoProspects from "@/pages/bonzo-prospects";
import MojoSessions from "@/pages/mojo-sessions";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";

function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  return (
    <Button variant="ghost" size="icon" onClick={() => setDark(d => !d)} data-testid="button-theme-toggle">
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

const PAGE_TITLES: Record<string, string> = {
  "/":             "Dashboard",
  "/directory":    "LO Directory",
  "/assignments":  "Assignments",
  "/outcomes":     "Outcomes",
  "/appointments": "Appointments",
  "/leaderboard":  "Team Stats",
  "/state-lookup": "State Lookup",
  "/snooze":       "LO Vacation",
  "/nmls-checks":  "NMLS Checks",
  "/nmls-status":  "NMLS License Status",
  "/reporting":    "Reporting",
  "/settings":     "Settings",
  "/audit-log":    "Audit Log",
  "/lo-performance": "LO Performance",
  "/chat":           "Team Chat",
  "/call-script":    "Call Script",
  "/eod-report":     "EOD Reporting",
  "/my-report":      "My Report",
  "/install":         "Install App",
  "/privacy-policy": "Privacy Policy",
  "/terms-of-use": "Terms of Use",
  "/glossary":      "Glossary",
  "/lo-vacation":   "LO Vacation",
  "/webhook-settings": "Integrations",
  "/integrations":     "Integrations",
  "/bonzo-prospects":  "Bonzo Prospects",
  "/mojo-sessions":    "Mojo Sessions",
};

function usePageTitle() {
  const [location] = useLocation();
  useEffect(() => {
    const label = PAGE_TITLES[location] ?? "WCLCC";
    document.title = label === "WCLCC" ? "WCLCC" : `${label} · WCLCC`;
  }, [location]);
}

function AppRouter() {
  usePageTitle();
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/directory" component={Directory} />
      <Route path="/assignments" component={Assignments} />
      <Route path="/outcomes" component={Outcomes} />
      <Route path="/appointments" component={Appointments} />
      <Route path="/leaderboard" component={TeamStats} />
      <Route path="/team-stats" component={TeamStats} />
      <Route path="/leaderboard-classic" component={Leaderboard} />
      <Route path="/state-lookup" component={StateLookup} />
      <Route path="/chat" component={Chat} />
      <Route path="/snooze" component={Snooze} />
      <Route path="/reporting" component={Reporting} />
      <Route path="/settings" component={Settings} />
      <Route path="/audit-log" component={AuditLog} />
      <Route path="/lo-performance" component={LoPerformance} />
      <Route path="/nmls-checks" component={NmlsChecks} />
      <Route path="/nmls-status" component={NmlsStatus} />
      <Route path="/eod-report" component={EodReport} />
      <Route path="/my-report" component={MyReport} />
      <Route path="/install" component={InstallApp} />
      <Route path="/support" component={Support} />
      <Route path="/call-script" component={CallScript} />
      <Route path="/glossary" component={GlossaryPage} />
      <Route path="/lo-vacation" component={LoVacation} />
      <Route path="/webhook-settings" component={Integrations} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/bonzo-prospects" component={BonzoProspects} />
      <Route path="/mojo-sessions" component={MojoSessions} />
      <Route path="/intro-video" component={IntroVideo} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/terms-of-use" component={TermsOfUse} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const showIntro = !!user && !user.hasSeenIntro && !user.mustChangePassword;
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

  useEffect(() => {
    if (!isLoading && user?.mustChangePassword && location !== "/change-password") {
      navigate("/change-password");
    }
  }, [isLoading, user, location, navigate]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  if (!user) {
    // Will be redirected by the effect above; show nothing while redirecting
    return null;
  }

  if (user.mustChangePassword) {
    // Will be redirected by the effect above; show nothing while redirecting
    return null;
  }

  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      {showIntro && <IntroModal />}
      <NmlsOverduePopup />
      <DailyReportGate>
        <div className="flex h-screen w-full overflow-hidden">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="sticky top-0 z-40 flex items-center justify-between h-12 px-4 border-b bg-background/95 backdrop-blur-sm flex-shrink-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" className="-ml-1" />
              <div className="flex items-center gap-1">
                <NotificationBell />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 overflow-auto flex flex-col pb-16 md:pb-0">
              <div className="flex-1">
                <AppRouter />
              </div>
              <AppFooter />
            </main>
            <MobileBottomNav />
          </div>
        </div>
      </DailyReportGate>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <AuthProvider>
            <Switch>
              <Route path="/login" component={Login} />
              <Route path="/change-password" component={ChangePassword} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route>
                <AuthenticatedApp />
              </Route>
            </Switch>
          </AuthProvider>
        </Router>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
