import { Link } from "wouter";
import { ExternalLink, Mail } from "lucide-react";

const NAV_LINKS = [
  { label: "Dashboard", href: "/" },
  { label: "Script", href: "/call-script" },
  { label: "Assignments", href: "/assignments" },
  { label: "Directory", href: "/directory" },
  { label: "Call History", href: "/outcomes" },
  { label: "EOD Report", href: "/eod-report" },
  { label: "Appointments", href: "/appointments" },
  { label: "Stats", href: "/team-stats" },
  { label: "Chat", href: "/chat" },
  { label: "Forum", href: "/forum" },
];

const RESOURCE_LINKS = [
  { label: "Settings", href: "/settings" },
  { label: "Integrations", href: "/integrations" },
  { label: "Glossary", href: "/glossary" },
  { label: "Status", href: "/status" },
];

const LEGAL_LINKS = [
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Terms of Use", href: "/terms-of-use" },
];

export function AppFooter() {
  return (
    <footer className="border-t bg-background text-muted-foreground text-xs mt-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">

          {/* Brand column */}
          <div className="space-y-3">
            <img
              src="/wcl-logo.png"
              alt="West Capital Lending"
              className="h-7 object-contain object-left opacity-80 dark:brightness-0 dark:invert"
            />
            <p className="leading-relaxed text-[11px]">
              CLR Connection Center is a proprietary internal platform built for WCL Team members.
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

          {/* Resources column */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">Resources</p>
            <div className="flex flex-col gap-1.5">
              {RESOURCE_LINKS.map(({ label, href }) => (
                <Link
                  key={href}
                  href={href}
                  className="hover:text-foreground transition-colors"
                >
                  {label}
                </Link>
              ))}
            </div>
          </div>

          {/* Legal & External column */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-1">Legal</p>
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
                WCL Team <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t pt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-muted-foreground/70">
          <p>
            © 2026 WCL Team · Team Members Only. CLR Connection Center is proprietary software developed by{" "}
            <span className="text-muted-foreground">Chris Redoble &amp; Ethan Wood</span>.
            Unauthorized use, reproduction, or distribution is strictly prohibited.
          </p>
        </div>
      </div>
    </footer>
  );
}
