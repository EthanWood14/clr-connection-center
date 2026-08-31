import { lazy, Suspense } from "react";
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
import { useCallback, useContext, useState, useEffect } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { IntroModal } from "@/components/intro-modal";
import { PipelineSopModal, PIPELINE_SOP_INTERVAL_DAYS } from "@/components/pipeline-sop-modal";
import { DailyReportGate, DailyReportGateActive } from "@/components/daily-report-gate";
import { EodLockGate, EodLockGateActive } from "@/components/eod-lock-gate";
import { ManagerSummonsAlarm } from "@/components/manager-summons-alarm";
import { CookieNotice } from "@/components/cookie-notice";
import { PushNudge } from "@/components/push-nudge";
import { GoalNudge } from "@/components/goal-nudge";
import { TransferCelebration } from "@/components/transfer-celebration";
import { ShotgunOfferAlert } from "@/components/shotgun-offer-alert";
import { ShotgunResultPrompt } from "@/components/shotgun-result-prompt";
import { TaskOverduePopup } from "@/components/task-overdue-popup";
import { UpdatePrompt } from "@/components/update-prompt";
import { AppFooter } from "@/components/app-footer";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { DailyLoPrioritiesModal, dailyLoPrioritiesStorageKey } from "@/components/daily-lo-priorities-modal";
import { businessTodayInTz } from "@/lib/business-day";

const Dashboard = lazy(() => import("@/pages/dashboard"));
const Directory = lazy(() => import("@/pages/directory"));
const Assignments = lazy(() => import("@/pages/assignments"));
const Outcomes = lazy(() => import("@/pages/outcomes"));
const LoPriorityLink = lazy(() => import("@/pages/lo-priority-link"));
const Leaderboard = lazy(() => import("@/pages/leaderboard"));
const TeamStats = lazy(() => import("@/pages/team-stats"));
const Settings = lazy(() => import("@/pages/settings"));
const StateLookup = lazy(() => import("@/pages/state-lookup"));
const CallHours = lazy(() => import("@/pages/call-hours"));
const Appointments = lazy(() => import("@/pages/appointments"));
const FallThroughs = lazy(() => import("@/pages/fall-throughs"));
const Snooze = lazy(() => import("@/pages/snooze"));
const Reporting = lazy(() => import("@/pages/reporting"));
const AuditLog = lazy(() => import("@/pages/audit-log"));
const NmlsChecks = lazy(() => import("@/pages/nmls-checks"));
const NmlsStatus = lazy(() => import("@/pages/nmls-status"));
const LoPerformance = lazy(() => import("@/pages/lo-performance"));
const PrivacyPolicy = lazy(() => import("@/pages/privacy-policy"));
const TermsOfUse = lazy(() => import("@/pages/terms-of-use"));
const Chat = lazy(() => import("@/pages/chat"));
const EodReport = lazy(() => import("@/pages/eod-report"));
const EodAnalytics = lazy(() => import("@/pages/eod-analytics"));
const AppReview = lazy(() => import("@/pages/app-review"));
const ManagerDashboard = lazy(() => import("@/pages/manager-dashboard"));
const TimeOff = lazy(() => import("@/pages/time-off"));
const CompRequests = lazy(() => import("@/pages/comp-requests"));
const TimeClock = lazy(() => import("@/pages/time-clock"));
const WeeklySchedule = lazy(() => import("@/pages/weekly-schedule"));
const MyReport = lazy(() => import("@/pages/my-report"));
const ReportsArchive = lazy(() => import("@/pages/reports-archive"));
const InstallApp = lazy(() => import("@/pages/install"));
const Support = lazy(() => import("@/pages/support"));
const IntroVideo = lazy(() => import("@/pages/intro-video"));
const CallScript = lazy(() => import("@/pages/call-script"));
const GlossaryPage = lazy(() => import("@/pages/glossary"));
const LoVacation = lazy(() => import("@/pages/lo-vacation"));
const WebhookSettings = lazy(() => import("@/pages/webhook-settings"));
const Integrations = lazy(() => import("@/pages/integrations"));
const BonzoProspects = lazy(() => import("@/pages/bonzo-prospects"));
const MojoSessions = lazy(() => import("@/pages/mojo-sessions"));
const OutboundCalls = lazy(() => import("@/pages/outbound-calls"));
const Contacts = lazy(() => import("@/pages/contacts"));
const MojoImport = lazy(() => import("@/pages/mojo-import"));
const Forum = lazy(() => import("@/pages/forum"));
const LeadSources = lazy(() => import("@/pages/lead-sources"));
const CheckIns = lazy(() => import("@/pages/check-ins"));
const ClrProfiles = lazy(() => import("@/pages/clr-profiles"));
const ClrProfile = lazy(() => import("@/pages/clr-profile"));
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import ChangePassword from "@/pages/change-password";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
const SuperAdmin = lazy(() => import("@/pages/super-admin"));
import InviteAccept from "@/pages/invite";
const Portal = lazy(() => import("@/pages/portal"));
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { SplashScreen } from "@/components/splash-screen";
const SeatingChart = lazy(() => import("@/pages/seating-chart"));
const ClrTraining = lazy(() => import("@/pages/clr-training"));
const ClrTrainingTest = lazy(() => import("@/pages/clr-training-test"));
const ClrTasks = lazy(() => import("@/pages/clr-tasks"));
const Shotgun = lazy(() => import("@/pages/shotgun"));
const LapApp = lazy(() => import("@/components/lap/lap-shell").then((m) => ({ default: m.LapApp })));

function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "dark") return true;
    if (stored === "light") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
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
  "/fall-throughs": "Fall-Throughs",
  "/leaderboard":  "Team Stats",
  "/seating-map":      "Seating Map",
  "/clr-training":     "CLR Training",
  "/clr-training/test": "Certification Test",
  "/tasks":            "CLR Task Center",
  "/shotgun":          "Shotgun Leads",
  "/state-lookup": "State Lookup",
  "/call-hours":   "Call Hours by State",
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
  "/eod-analytics":  "EOD Analytics",
  "/team-dashboard": "Team Dashboard",
  "/time-off":       "Time Off",
  "/comp-requests":  "Comp Requests",
  "/time-clock":     "Time Clock",
  "/my-schedule":    "Weekly Schedule",
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
  "/outbound-calls":   "Outbound CLR Calls",
  "/contacts":         "Contact Hub",
  "/mojo-import":      "Mojo Import",
  "/forum":            "Forum",
  "/lead-sources":     "Lead Sources",
  "/check-ins":        "Check-In",
  "/clr-profiles":     "CLR Profiles",
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
      <Route path="/fall-throughs" component={FallThroughs} />
      <Route path="/leaderboard" component={TeamStats} />
      <Route path="/team-stats" component={TeamStats} />
      <Route path="/leaderboard-classic" component={Leaderboard} />
      <Route path="/seating-map" component={SeatingChart} />
      <Route path="/clr-training" component={ClrTraining} />
      <Route path="/clr-training/test" component={ClrTrainingTest} />
      <Route path="/tasks" component={ClrTasks} />
      <Route path="/shotgun" component={Shotgun} />
      <Route path="/state-lookup" component={StateLookup} />
      <Route path="/call-hours" component={CallHours} />
      <Route path="/chat" component={Chat} />
      <Route path="/snooze" component={Snooze} />
      <Route path="/reporting" component={Reporting} />
      <Route path="/settings" component={Settings} />
      <Route path="/audit-log" component={AuditLog} />
      <Route path="/lo-performance" component={LoPerformance} />
      <Route path="/nmls-checks" component={NmlsChecks} />
      <Route path="/nmls-status" component={NmlsStatus} />
      <Route path="/eod-report" component={EodReport} />
      <Route path="/eod-analytics" component={EodAnalytics} />
      <Route path="/app-review" component={AppReview} />
      <Route path="/team-dashboard" component={ManagerDashboard} />
      <Route path="/time-off" component={TimeOff} />
      <Route path="/comp-requests" component={CompRequests} />
      <Route path="/time-clock" component={TimeClock} />
      <Route path="/my-schedule" component={WeeklySchedule} />
      <Route path="/my-report" component={MyReport} />
      <Route path="/reports-archive" component={ReportsArchive} />
      <Route path="/install" component={InstallApp} />
      <Route path="/support" component={Support} />
      <Route path="/call-script" component={CallScript} />
      <Route path="/glossary" component={GlossaryPage} />
      <Route path="/lo-vacation" component={LoVacation} />
      <Route path="/webhook-settings" component={Integrations} />
      <Route path="/integrations" component={Integrations} />
      <Route path="/bonzo-prospects" component={BonzoProspects} />
      <Route path="/mojo-sessions" component={MojoSessions} />
      <Route path="/outbound-calls" component={OutboundCalls} />
      <Route path="/contacts" component={Contacts} />
      <Route path="/mojo-import" component={MojoImport} />
      <Route path="/forum" component={Forum} />
      <Route path="/lead-sources" component={LeadSources} />
      <Route path="/check-ins" component={CheckIns} />
      <Route path="/clr-profiles" component={ClrProfiles} />
      <Route path="/clr-profiles/:id" component={ClrProfile} />
      <Route path="/super-admin" component={SuperAdmin} />
      <Route path="/intro-video" component={IntroVideo} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/terms-of-use" component={TermsOfUse} />
      <Route component={NotFound} />
    </Switch>
  );
}

type DeferredAppPromptsProps = {
  showDailyPriorities: boolean;
  showIntro: boolean;
  showPipelineSop: boolean;
  userId: number;
  orgId: number;
  timezone?: string;
  isDemo?: boolean;
  onDailyPrioritiesDismiss: () => void;
};

/**
 * Present startup prompts in a single, predictable queue.
 *
 * Mandatory daily/EOD reporting always goes first. Optional prompts are
 * descendants of both gates so they can see when either gate is holding the
 * screen and disappear instead of painting another clickable-looking layer on
 * top. Once the gates clear, onboarding-style modals run one at a time; only
 * then do the smaller notices and nudges mount.
 */
function DeferredAppPrompts({
  showDailyPriorities,
  showIntro,
  showPipelineSop,
  userId,
  orgId,
  timezone,
  isDemo,
  onDailyPrioritiesDismiss,
}: DeferredAppPromptsProps) {
  const dailyReportGateActive = useContext(DailyReportGateActive);
  const eodLockGateActive = useContext(EodLockGateActive);
  const [cookieNoticeResolved, setCookieNoticeResolved] = useState(false);
  const [updatePromptBlocking, setUpdatePromptBlocking] = useState(true);
  const resolveCookieNotice = useCallback(() => setCookieNoticeResolved(true), []);
  const trackUpdatePrompt = useCallback((blocking: boolean) => setUpdatePromptBlocking(blocking), []);

  if (dailyReportGateActive || eodLockGateActive) return null;

  return (
    <>
      {showDailyPriorities && (
        <DailyLoPrioritiesModal
          userId={userId}
          orgId={orgId}
          timezone={timezone}
          onDismiss={onDailyPrioritiesDismiss}
        />
      )}
      {!showDailyPriorities && showIntro && <IntroModal />}
      {!showDailyPriorities && !showIntro && showPipelineSop && <PipelineSopModal />}
      {!showDailyPriorities && !showIntro && !showPipelineSop && (
        <>
          <CookieNotice onResolved={resolveCookieNotice} />
          {cookieNoticeResolved && (
            <>
              <UpdatePrompt onBlockingChange={trackUpdatePrompt} />
              {!updatePromptBlocking && (
                <>
                  {!isDemo && <TaskOverduePopup />}
                  {!isDemo && <PushNudge />}
                  {!isDemo && <GoalNudge />}
                  <TransferCelebration />
                </>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const priorityBusinessDate = user ? businessTodayInTz(user.timezone) : "";
  const priorityStorageKey = user
    ? dailyLoPrioritiesStorageKey(user.id, user.orgId ?? 1, priorityBusinessDate)
    : "";
  const [dismissedPriorityKey, setDismissedPriorityKey] = useState("");
  const alreadySawDailyPriorities = (() => {
    if (!priorityStorageKey || dismissedPriorityKey === priorityStorageKey) return true;
    try { return localStorage.getItem(priorityStorageKey) === "seen"; } catch { return false; }
  })();
  const showDailyPriorities = !!user
    && user.portal !== "lap"
    && user.portal !== "lop"
    && !user.mustChangePassword
    && !alreadySawDailyPriorities;
  const showIntro = !!user && !user.hasSeenIntro && !user.mustChangePassword && !showDailyPriorities;
  // Pipeline-stages refresher: shown to CLRs every 14 days. Suppressed while the
  // intro/welcome flow or the change-password gate is active so they don't stack.
  const showPipelineSop = (() => {
    if (!user || user.isDemo || !user.isClr || user.mustChangePassword || showIntro || showDailyPriorities) return false;
    const last = user.lastSeenPipelineSop ? new Date(user.lastSeenPipelineSop).getTime() : 0;
    if (!last) return true; // never seen → show on first eligible load
    const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
    return daysSince >= PIPELINE_SOP_INTERVAL_DAYS;
  })();
  const [location, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

  // LAP accounts belong to outside assistants and have no business in the C3
  // shell. The server refuses their API calls either way; this keeps them from
  // landing on a broken-looking C3 page.
  useEffect(() => {
    if (!isLoading && (user?.portal === "lap" || user?.portal === "lop")) navigate(`/${user.portal}`);
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
  };

  return (
    <SidebarProvider defaultOpen={false} style={style as React.CSSProperties}>
      {/* Sits above every other gate — being called in outranks them. */}
      <ManagerSummonsAlarm />
      <DailyReportGate>
        <EodLockGate>
          <DeferredAppPrompts
            showDailyPriorities={showDailyPriorities}
            showIntro={showIntro}
            showPipelineSop={showPipelineSop}
            userId={user.id}
            orgId={user.orgId ?? 1}
            timezone={user.timezone}
            isDemo={user.isDemo}
            onDailyPrioritiesDismiss={() => setDismissedPriorityKey(priorityStorageKey)}
          />
          {/* Antigravity shell: ambient gradient already on <body>; floating panels above. */}
          <div className="flex h-screen w-full overflow-hidden flex-col">
            <ImpersonationBanner />
            <div className="flex flex-1 min-h-0 overflow-hidden md:gap-3 p-0 md:p-3">
              <AppSidebar />
              <div className="flex flex-col flex-1 min-w-0 gap-2 md:gap-3">
                {/* Floating glass header bar */}
                <header className="glass-header sticky top-0 z-40 flex items-center justify-between h-12 px-3 flex-shrink-0">
                  <SidebarTrigger data-testid="button-sidebar-toggle" className="-ml-1" />
                  <div className="flex items-center gap-1">
                    <NotificationBell />
                    <ThemeToggle />
                  </div>
                </header>
                {/* Floating glass main panel */}
                <main className="glass-panel flex-1 overflow-auto flex flex-col pb-16 md:pb-0">
                  <div className="flex-1">
                    <ShotgunOfferAlert />
                    <ShotgunResultPrompt />
                    {/* Only the page swaps on navigation — the shell around it
                        stays put, so a route change is not a full blank. */}
                    <Suspense fallback={<RouteFallback />}>
                      {/* Keyed on the route so each page fades in rather than
                          snapping into place. */}
                      <div key={location} className="animate-in fade-in duration-200">
                        <AppRouter />
                      </div>
                    </Suspense>
                  </div>
                  <AppFooter />
                </main>
                <MobileBottomNav />
              </div>
            </div>
          </div>
        </EodLockGate>
      </DailyReportGate>
    </SidebarProvider>
  );
}

/**
 * Shown only while a route's code is still arriving. Chunks are usually served
 * from the service worker in about 18ms, and a spinner that appears for 18ms
 * reads as a flicker — so this holds the space and fades in only if the wait
 * is long enough to notice.
 */
function RouteFallback() {
  return <div className="min-h-[60vh] animate-in fade-in duration-500 delay-200" />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SplashScreen />
      <TooltipProvider>
        <Router hook={useHashLocation}>
          <AuthProvider>
            {/* Outer boundary covers the logged-out pages and the portal
                shell. Inside the app, a nested boundary around the page keeps
                the sidebar and header mounted across a route change. */}
            <Suspense fallback={<div className="min-h-screen bg-background" />}>
            <Switch>
              <Route path="/login" component={Login} />
              <Route path="/change-password" component={ChangePassword} />
              <Route path="/forgot-password" component={ForgotPassword} />
              <Route path="/reset-password" component={ResetPassword} />
              <Route path="/invite/:token" component={InviteAccept} />
              <Route path="/portal/:code" component={Portal} />
              {/* Public share link: sets LO priority, needs no C3 login. */}
              <Route path="/lo-priority/:token" component={LoPriorityLink} />
              <Route path="/lap" nest>
                <LapApp product="lap" />
              </Route>
              {/* LOP — same application, loan-officer audience. The server
                  scopes what each account can see; the shell is shared. */}
              <Route path="/lop" nest>
                <LapApp product="lop" />
              </Route>
              <Route>
                <AuthenticatedApp />
              </Route>
            </Switch>
            </Suspense>
          </AuthProvider>
        </Router>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
