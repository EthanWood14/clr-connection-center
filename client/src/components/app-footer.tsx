import { Link } from "wouter";
import { ExternalLink, Mail } from "lucide-react";

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Assignments", href: "/assignments" },
  { label: "Directory", href: "/directory" },
  { label: "Leaderboard", href: "/leaderboard" },
  { label: "Outcomes", href: "/outcomes" },
  { label: "Reporting", href: "/reporting" },
  { label: "Settings", href: "/settings" },
];

const LEGAL_LINKS = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Use", href: "/terms-of-use" },
];

export function AppFooter() {
  return (
    <footer className="border-t bg-background text-muted-foreground text-xs mt-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">

          {/* Brand column */}
          <div className="space-y-3">
            <img
              src="/wcl-logo.png"
              alt="West Capital Lending"
              className="h-7 object-contain object-left opacity-80 dark:brightness-0 dark:invert"
            />
            <p className="leading-relaxed text-[11px]">
              CLR Connection Center is a proprietary internal platform built for West Capital Lending's CLR team.
            </p>
            <div className="flex flex-col gap-1">
              <a
                href="mailto:ethan.anthony.wood@gmail.com"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Mail className="w-3 h-3" /> ethan.anthony.wood@gmail.com
              </a>
              <a
                href="mailto:credoble@westcapitallending.com"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                <Mail className="w-3 h-3" /> credoble@westcapitallending.com
              </a>
            </div>
          </div>

          {/* Navigation column */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">Navigation</p>
            <nav className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {NAV_LINKS.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="hover:text-foreground transition-colors"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          {/* Legal & External column */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">Legal & Resources</p>
            <div className="flex flex-col gap-1.5">
              {LEGAL_LINKS.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="hover:text-foreground transition-colors"
                >
                  {label}
                </Link>
              ))}
              <a
                href="https://westcapitallending.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
              >
                West Capital Lending <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-muted-foreground/70">
          <p>
            © 2026 West Capital Lending. All rights reserved. CLR Connection Center is proprietary software developed by{" "}
            <span className="text-muted-foreground">Chris Redoble &amp; Ethan Wood</span>.
            Unauthorized use, reproduction, or distribution is strictly prohibited.
          </p>
        </div>
      </div>
    </footer>
  );
}
