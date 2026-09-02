import { FileInput, Home, Menu, MessageCircle, NotebookPen, Timer } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useSidebar } from "@/components/ui/sidebar";

const items = [
  { title: "Home", href: "/", icon: Home },
  { title: "Results", href: "/results", icon: FileInput },
  { title: "Notes", href: "/notes", icon: NotebookPen },
  { title: "Clock", href: "/time-clock", icon: Timer },
  { title: "Chat", href: "/chat", icon: MessageCircle },
];

export function LapMobileNav() {
  const [location] = useLocation();
  const { toggleSidebar } = useSidebar();

  function active(href: string) {
    return href === "/" ? location === "/" : location.startsWith(href);
  }

  return (
    <nav
      className="lap-mobile-nav fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t px-2 py-2 md:hidden"
      style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      data-testid="lap-mobile-bottom-nav"
    >
      {items.map((item) => (
        <Link
          key={item.title}
          href={item.href}
          className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] transition-colors ${
            active(item.href) ? "bg-white/[0.12] font-semibold text-white" : "text-white/70"
          }`}
          data-testid={`lap-mobile-${item.title.toLowerCase()}`}
        >
          <item.icon className="h-5 w-5" />
          <span>{item.title}</span>
        </Link>
      ))}
      <button
        type="button"
        onClick={toggleSidebar}
        className="flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] text-white/70 transition-colors hover:bg-white/10 hover:text-white"
        data-testid="lap-mobile-menu"
      >
        <Menu className="h-5 w-5" />
        <span>Menu</span>
      </button>
    </nav>
  );
}
