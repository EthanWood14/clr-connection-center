import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Users, CalendarCheck, ClipboardList,
  Trophy, Settings, Building2, MapPin, BedDouble,
  BarChart2, Bell, PhoneForwarded, LogOut, ScrollText, TrendingUp, MessageSquare, ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";

const mainItems = [
  { title: "Dashboard",         url: "/",            icon: LayoutDashboard },
  { title: "LO Directory",      url: "/directory",   icon: Users },
  { title: "Daily Assignments", url: "/assignments", icon: CalendarCheck },
  { title: "Lead Outcomes",     url: "/outcomes",    icon: ClipboardList },
  { title: "Appointments",   url: "/appointments",   icon: PhoneForwarded, badge: "appointments" },
  { title: "Team Stats",        url: "/leaderboard", icon: Trophy },
  { title: "Team Chat",         url: "/chat",        icon: MessageSquare, badge: "chat" },
];

const toolItems = [
  { title: "State Lookup",      url: "/state-lookup",    icon: MapPin },
  { title: "Snooze Manager",    url: "/snooze",          icon: BedDouble },
  { title: "NMLS Checks",       url: "/nmls-checks",     icon: ShieldCheck, badge: "nmls" },
  { title: "Reporting",         url: "/reporting",       icon: BarChart2 },
  { title: "LO Performance",    url: "/lo-performance",  icon: TrendingUp },
];

const adminItems: { title: string; url: string; icon: any; badge?: string }[] = [
  { title: "Settings",          url: "/settings",    icon: Settings },
  { title: "Audit Log",         url: "/audit-log",   icon: ScrollText },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  // Live appointment count — outcomes with followUpDate <= today
  const { data: outcomes = [] } = useQuery<any[]>({
    queryKey: ["/api/outcomes"],
    refetchInterval: 60000,
    select: (data) => {
      const today = new Date().toISOString().split("T")[0];
      return data.filter((o) => o.followUpDate && o.followUpDate <= today);
    },
  });

  // Pending NMLS checks badge
  const { data: nmlsData } = useQuery<any>({
    queryKey: ["/api/nmls-checks/my-pending"],
    refetchInterval: 60000,
    enabled: !!user,
  });
  const nmslPendingCount = nmlsData?.checks?.length ?? 0;

  // Unread notification count for bell badge
  const userId = user?.id ?? 1;
  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: [`/api/notifications/unread-count?userId=${userId}`],
    refetchInterval: 30000,
    enabled: !!user,
  });

  const appointmentCount = outcomes.length;

  // ── Chat unread badge ────────────────────────────────────────────────────────
  const storageKey = `lastSeenChatId_${user?.id ?? "guest"}`;
  const [lastSeenId, setLastSeenId] = useState<number>(() => {
    return parseInt(localStorage.getItem(storageKey) ?? "0") || 0;
  });

  const { data: chatData } = useQuery<{ messages: any[] }>({
    queryKey: ["/api/chat"],
    refetchInterval: 5000,
    enabled: !!user,
  });

  const latestChatId = chatData?.messages?.length
    ? Math.max(...chatData.messages.map((m: any) => m.id))
    : 0;

  // Messages newer than lastSeenId, but not sent by current user
  const unreadChatCount = chatData?.messages
    ? chatData.messages.filter(
        (m: any) => m.id > lastSeenId && m.user_id !== user?.id
      ).length
    : 0;

  // Clear badge when on /chat page
  useEffect(() => {
    if (location === "/chat" && latestChatId > 0) {
      setLastSeenId(latestChatId);
      localStorage.setItem(storageKey, String(latestChatId));
    }
  }, [location, latestChatId, storageKey]);

  // Derive initials from user name
  const initials = user
    ? user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "?";

  const roleLabel = user
    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
    : "";

  function isActive(url: string) {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  }

  function renderItems(items: typeof mainItems) {
    return items.map((item) => {
      const count = item.badge === "appointments" ? appointmentCount : item.badge === "chat" ? unreadChatCount : item.badge === "nmls" ? nmslPendingCount : 0;
      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild isActive={isActive(item.url)}>
            <Link
              href={item.url}
              data-testid={`nav-${item.title.toLowerCase().replace(/ /g, "-")}`}
              className="flex items-center justify-between w-full"
            >
              <span className="flex items-center gap-2">
                <item.icon className="w-4 h-4 shrink-0" />
                <span className={isActive(item.url) ? "font-bold" : ""}>{item.title}</span>
              </span>
              {count > 0 && (
                <Badge className="ml-auto h-4 min-w-4 px-1 text-[10px] bg-destructive text-destructive-foreground">
                  {count > 99 ? "99+" : count}
                </Badge>
              )}
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4 border-b border-sidebar-border">
        <div className="flex flex-col gap-1.5">
          <img
            src="/wcl-logo.png"
            alt="West Capital Lending"
            className="h-7 w-auto object-contain object-left dark:brightness-0 dark:invert opacity-90"
          />
          <p className="text-[11px] font-semibold text-sidebar-foreground/70 uppercase tracking-widest leading-tight">CLR Connection Center</p>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-widest">
            Main
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {renderItems(mainItems)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-widest">
            Tools
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {renderItems(toolItems)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-widest">
            Admin
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {renderItems(adminItems)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-sidebar-foreground/20 flex items-center justify-center text-xs font-bold text-sidebar-foreground flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-sidebar-foreground truncate">{user?.name ?? "—"}</p>
            <p className="text-xs text-sidebar-foreground/50 truncate">{roleLabel}</p>
          </div>
          <button
            onClick={logout}
            title="Sign out"
            className="ml-auto p-1.5 rounded hover:bg-sidebar-foreground/10 text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors flex-shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
