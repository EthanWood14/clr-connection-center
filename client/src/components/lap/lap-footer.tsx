import { Link } from "wouter";
import { LapBrand } from "./lap-brand";

const links = [
  { label: "Input Results", href: "/results" },
  { label: "LO Profiles", href: "/lo-profiles" },
  { label: "Team Chat", href: "/chat" },
  { label: "Resources", href: "/resources" },
  { label: "Settings", href: "/settings" },
];

export function LapFooter() {
  return (
    <footer className="mt-auto border-t border-border/70 bg-background/55 px-5 py-5 text-xs text-muted-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <LapBrand className="h-8" />
          <p className="max-w-md leading-relaxed">
            A focused workspace for LO assistants to organize results, support loan officers, and stay aligned with the team.
          </p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-foreground">
              {link.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-4 w-full max-w-6xl border-t border-border/60 pt-3 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
        © 2026 West Capital Lending · Internal team use only
      </div>
    </footer>
  );
}
