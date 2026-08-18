import {
  Armchair, GraduationCap,
  BookOpenCheck,
  CalendarDays,
  Clock3,
  FileArchive,
  FileInput,
  Home,
  Landmark,
  LogOut,
  MapPin,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  Plane,
  Settings,
  Smartphone,
  Timer,
  UserCheck,
  UsersRound,
  FileWarning,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { APP_VERSION } from "@shared/version";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { LapBrand } from "./lap-brand";

type NavItem = {
  title: string;
  href: string;
  icon: typeof Home;
  external?: boolean;
};

const workflowItems: NavItem[] = [
  { title: "Home", href: "/", icon: Home },
  { title: "Input Results", href: "/results", icon: FileInput },
];

const personalItems: NavItem[] = [
  { title: "Check-In", href: "/check-ins", icon: UserCheck },
  { title: "Weekly Schedule", href: "/my-schedule", icon: CalendarDays },
];

const teamItems: NavItem[] = [
  { title: "Forum", href: "/forum", icon: MessagesSquare },
  { title: "Team Chat", href: "/chat", icon: MessageCircle },
  // Embedded rather than opened off-site — see pages/seating-chart.tsx.
  { title: "Seating Map", href: "/seating-map", icon: Armchair },
  { title: "CLR Training", href: "/clr-training", icon: GraduationCap },
  { title: "LO Profiles", href: "/lo-profiles", icon: UsersRound },
];

const resourceItems: NavItem[] = [
  { title: "State Lookup", href: "/state-lookup", icon: MapPin },
  { title: "Call Hours", href: "/call-hours", icon: Clock3 },
  { title: "Install", href: "/install", icon: Smartphone },
  { title: "LO Resources", href: "/resources", icon: BookOpenCheck },
];

export function LapSidebar() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const isAdmin = user?.role === "admin" || !!user?.superAdmin;
  const canViewArchive = isAdmin || user?.role === "viewer";

  const initials = user?.name
    ? user.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
    : "LO";

  function isActive(href: string) {
    if (href === "/") return location === "/";
    return location.startsWith(href);
  }

  function closeMobile() {
    if (isMobile) setOpenMobile(false);
  }

  function renderItems(items: NavItem[]) {
    return items.map((item) => {
      const inner = (
        <>
          <item.icon className="h-4 w-4 shrink-0" />
          <span>{item.title}</span>
        </>
      );

      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton
            asChild
            isActive={!item.external && isActive(item.href)}
            className="h-9 rounded-lg text-[13px]"
          >
            {item.external ? (
              <a
                href={item.href}
                target="_blank"
                rel="noreferrer"
                onClick={closeMobile}
                data-testid={`lap-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {inner}
              </a>
            ) : (
              <Link
                href={item.href}
                onClick={closeMobile}
                data-testid={`lap-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {inner}
              </Link>
            )}
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    });
  }

  return (
    <Sidebar
      collapsible="offcanvas"
      className="lap-sidebar glass-rail [&_[data-sidebar=sidebar]]:border-0 [&_[data-sidebar=sidebar]]:bg-transparent"
    >
      <SidebarHeader className="border-b border-sidebar-border/80 px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <LapBrand inverse className="h-10 max-w-[185px]" />
          <button
            type="button"
            onClick={toggleSidebar}
            className="hidden rounded-md p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground md:inline-flex"
            aria-label="Close navigation"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2 py-2">
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{renderItems(workflowItems)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>My Work</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{renderItems(personalItems)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Team</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{renderItems(teamItems)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Tools & Resources</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>{renderItems(resourceItems)}</SidebarMenu></SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>{canViewArchive ? "Administration" : "Account"}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {renderItems([{ title: "Transfer Documents", href: "/transfer-audit", icon: FileWarning }])}
              {isAdmin && renderItems([{ title: "Users", href: "/users", icon: UsersRound }])}
              {renderItems([{ title: "Settings", href: "/settings", icon: Settings }])}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border/80 p-3">
        <a
          href="/#/"
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 flex items-center gap-2 rounded-lg border border-sidebar-border/80 px-2.5 py-2 text-xs text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <Landmark className="h-3.5 w-3.5" />
          Open CLR Connection Center
        </a>
        <div className="flex items-center gap-2 rounded-lg bg-black/10 px-2 py-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-sidebar-foreground">{user?.name ?? "Team member"}</p>
            <p className="truncate text-[10px] uppercase tracking-wide text-sidebar-foreground/55">
              {isAdmin ? "Administrator" : user?.role === "viewer" ? "Viewer" : user?.isManager ? "Manager" : "LO Assistant"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md p-1.5 text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        <p className="pt-2 text-center text-[10px] text-sidebar-foreground/35">LAP v{APP_VERSION}</p>
      </SidebarFooter>
    </Sidebar>
  );
}
