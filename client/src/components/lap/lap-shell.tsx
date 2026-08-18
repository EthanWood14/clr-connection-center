import { createContext, useContext, useEffect, useState } from "react";
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
import { LapSharedGate } from "./lap-shared-gate";
import LapLogin from "@/pages/lap-login";
import LapDashboard from "@/pages/lap-dashboard";
import LapResults from "@/pages/lap-results";
import LapLoProfiles from "@/pages/lap-lo-profiles";
import LapInstall from "@/pages/lap-install";
import LapResources from "@/pages/lap-resources";
import LapSettings from "@/pages/lap-settings";
import LapUsers from "@/pages/lap-users";
import LapTransferAudit from "@/pages/lap-transfer-audit";
import SeatingChart from "@/pages/seating-chart";
import CheckIns from "@/pages/check-ins";
import WeeklySchedule from "@/pages/weekly-schedule";
import Forum from "@/pages/forum";
import Chat from "@/pages/chat";
import StateLookup from "@/pages/state-lookup";
import CallHours from "@/pages/call-hours";

// LAP and LOP are the same application with different audiences and data
// scope — the server narrows rows per portal, so the shell only differs in
// naming. One component avoids two copies drifting apart.
export type PortalProduct = "lap" | "lop";
const PortalProductContext = createContext<PortalProduct>("lap");
export const usePortalProduct = () => useContext(PortalProductContext);
export const productLabel = (p: PortalProduct) => (p === "lop" ? "LOP" : "LAP");
export const productFullName = (p: PortalProduct) =>
  p === "lop" ? "Loan Officer Portal" : "LO Assistant Portal";

const LAP_TITLES: Record<string, string> = {
  "/": "Home",
  "/results": "Input Results",
  "/input-results": "Input Results",
  "/check-ins": "Check-In",
  "/my-schedule": "Weekly Schedule",
  "/forum": "Forum",
  "/chat": "Team Chat",
  "/lo-profiles": "LO Profiles",
  "/state-lookup": "State Lookup",
  "/call-hours": "Call Hours",
  "/install": "Install LAP",
  "/resources": "LO Resources",
  "/users": "Users",
  "/settings": "Settings",
};

function lapTitle(location: string, product: PortalProduct = "lap") {
  const label = productLabel(product);
  const exact = LAP_TITLES[location];
  if (exact) return `${exact} · ${label}`;
  if (location.startsWith("/results/")) return `Result Package · ${label}`;
  if (location.startsWith("/lo-profiles/")) return `LO Profile · ${label}`;
  return `${label} · ${productFullName(product)}`;
}

function useLapProductMetadata(product: PortalProduct) {
  const [location] = useLocation();

  useEffect(() => {
    applyProductMetadata(product);
  }, [product]);

  useEffect(() => {
    const expected = lapTitle(location, product);
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
  }, [location, product]);
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
      <Route path="/my-schedule" component={WeeklySchedule} />
      <Route path="/forum" component={LapForum} />
      <Route path="/chat" component={LapChat} />
      <Route path="/lo-profiles" component={LapLoProfiles} />
      <Route path="/seating-map" component={SeatingChart} />
      <Route path="/state-lookup" component={StateLookup} />
      <Route path="/call-hours" component={CallHours} />
      <Route path="/install" component={LapInstall} />
      <Route path="/resources" component={LapResources} />
      <Route path="/transfer-audit" component={LapTransferAudit} />
      <Route path="/users" component={LapUsers} />
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

export function LapApp({ product = "lap" }: { product?: PortalProduct } = {}) {
  useLapProductMetadata(product);
  const { user, isLoading, refetchUser } = useAuth();
  // LAP is entered with one shared password rather than individual logins. The
  // server answers whether this browser is already through the gate; until it
  // does we show nothing, so the gate never flashes for an unlocked device.
  const [gate, setGate] = useState<{ configured: boolean; unlocked: boolean } | null>(null);
  const [staffLogin, setStaffLogin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/lap/gate", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setGate({ configured: !!d?.configured, unlocked: !!d?.unlocked }); })
      .catch(() => { if (!cancelled) setGate({ configured: false, unlocked: false }); });
    return () => { cancelled = true; };
  }, [user]);

  if (isLoading) {
    return (
      <div className="lap-login flex min-h-screen items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-xl">
          <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
          <span className="text-sm font-medium text-muted-foreground">Opening {productLabel(product)}…</span>
        </div>
      </div>
    );
  }

  // Not signed in and the shared password is configured -> the shared door.
  // Falls back to the old per-person login if the gate was never set up, so a
  // misconfiguration cannot lock everyone out of the portal.
  // The shared password is the ONLY door: no email, no per-person account. The
  // individual login survives solely as (a) the fallback when no shared password
  // has been configured, so a misconfiguration cannot lock the portal, and
  // (b) an opt-in escape hatch for an administrator who needs to act as
  // themselves — device revocation and password rotation are admin-only.
  const gateReady = gate !== null;
  const showSharedGate = gateReady && !user && !gate!.unlocked && gate!.configured && !staffLogin;
  const showAccountLogin = gateReady && !user && !gate!.unlocked && (!gate!.configured || staffLogin);

  // Nothing is rendered until the server has answered, so an already-unlocked
  // device never sees the door flash before its dashboard.
  if (!gateReady) {
    return (
      <PortalProductContext.Provider value={product}>
        <div className="lap-login flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-xl">
            <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
            <span className="text-sm font-medium text-muted-foreground">Opening {productLabel(product)}…</span>
          </div>
        </div>
      </PortalProductContext.Provider>
    );
  }

  return (
    <PortalProductContext.Provider value={product}>
      {showSharedGate
        ? <LapSharedGate
            onUnlocked={async () => { setGate({ configured: true, unlocked: true }); await refetchUser(); }}
            onStaffLogin={() => setStaffLogin(true)}
          />
        : showAccountLogin ? <LapLogin />
        : user?.mustChangePassword ? <LapPasswordGate />
        : <LapAuthenticatedShell />}
    </PortalProductContext.Provider>
  );
}
