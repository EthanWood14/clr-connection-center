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

import Dashboard from "@/pages/dashboard";
import Directory from "@/pages/directory";
import Assignments from "@/pages/assignments";
import Outcomes from "@/pages/outcomes";
import Leaderboard from "@/pages/leaderboard";
import Settings from "@/pages/settings";
import StateLookup from "@/pages/state-lookup";
import FollowUps from "@/pages/followups";
import Snooze from "@/pages/snooze";
import Reporting from "@/pages/reporting";
import AuditLog from "@/pages/audit-log";
import LoPerformance from "@/pages/lo-performance";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";

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

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/directory" component={Directory} />
      <Route path="/assignments" component={Assignments} />
      <Route path="/outcomes" component={Outcomes} />
      <Route path="/followups" component={FollowUps} />
      <Route path="/leaderboard" component={Leaderboard} />
      <Route path="/state-lookup" component={StateLookup} />
      <Route path="/snooze" component={Snooze} />
      <Route path="/reporting" component={Reporting} />
      <Route path="/settings" component={Settings} />
      <Route path="/audit-log" component={AuditLog} />
      <Route path="/lo-performance" component={LoPerformance} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

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

  const style = {
    "--sidebar-width": "15rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between h-12 px-4 border-b bg-background/95 backdrop-blur-sm flex-shrink-0">
            <SidebarTrigger data-testid="button-sidebar-toggle" className="-ml-1" />
            <div className="flex items-center gap-1">
              <NotificationBell />
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <AppRouter />
          </main>
        </div>
      </div>
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
