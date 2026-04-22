import { Link, useLocation } from "wouter";
import { Home, ClipboardList, PhoneForwarded, MessageSquare, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

const items = [
  { title: "Home",         url: "/",             icon: Home },
  { title: "Outcomes",     url: "/outcomes",     icon: ClipboardList },
  { title: "Appointments", url: "/appointments", icon: PhoneForwarded },
  { title: "Chat",         url: "/chat",         icon: MessageSquare },
];

export function MobileBottomNav() {
  const [location] = useLocation();
  const { toggleSidebar } = useSidebar();

  function isActive(url: string) {
    if (url === "/") return location === "/";
    return location.startsWith(url);
  }

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-[#0F182D] border-t border-white/10 flex items-center justify-around py-2 px-2 md:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      data-testid="mobile-bottom-nav"
    >
      {items.map((item) => {
        const active = isActive(item.url);
        return (
          <Link
            key={item.title}
            href={item.url}
            data-testid={`mobile-nav-${item.title.toLowerCase()}`}
            className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 rounded text-white transition-colors ${
              active ? "bg-white/10 font-semibold" : "text-white/80"
            }`}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] leading-tight">{item.title}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={toggleSidebar}
        data-testid="mobile-nav-menu"
        className="flex flex-col items-center justify-center gap-0.5 flex-1 py-1 rounded text-white/80 hover:bg-white/10 transition-colors"
      >
        <Menu className="w-5 h-5" />
        <span className="text-[10px] leading-tight">Menu</span>
      </button>
    </nav>
  );
}
