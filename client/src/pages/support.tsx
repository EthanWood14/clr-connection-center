import { useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PlayCircle, FileText, Download, LifeBuoy, HelpCircle, Mail,
} from "lucide-react";

const NAVY = "#1A2B4A";
const GOLD = "#C49A3C";

type VideoCard = {
  title: string;
  badge: string;
  description: string;
  href?: string;
  disabled?: boolean;
  buttonLabel: string;
};

const videos: VideoCard[] = [
  {
    title: "Platform Walkthrough",
    badge: "All Users · ~1 min",
    description:
      "A 12-step screenshot tour of every page in CLR Connection Center — Dashboard, Assignments, Call Script, Stats, and more.",
    href: "/intro-video",
    buttonLabel: "Start Walkthrough",
  },
  {
    title: "CLR Deep-Dive Video",
    badge: "CLRs · 10 min · Ask for Development",
    description:
      "A full video walkthrough covering every tab and feature a CLR uses daily.",
    disabled: true,
    buttonLabel: "Ask for Development",
  },
  {
    title: "Full System Guide",
    badge: "Admins · 20 min · Ask for Development",
    description:
      "An in-depth video covering the entire platform including backend configuration, the algorithm, and admin controls.",
    disabled: true,
    buttonLabel: "Ask for Development",
  },
];

type DocCard = {
  title: string;
  pages: string;
  description: string;
  href: string;
  adminOnly?: boolean;
};

const documents: DocCard[] = [
  {
    title: "Why CLR Connection Center?",
    pages: "10 pages",
    description:
      "Understand the problems this platform solves, the business case, and the ROI for West Capital Lending.",
    href: "/docs/value-prop.pdf",
  },
  {
    title: "Standard Operating Procedures",
    pages: "30 pages",
    description:
      "Step-by-step SOPs for every daily workflow — for CLRs, managers, and admins. Your go-to operational reference.",
    href: "/docs/sop-manual.pdf",
  },
  {
    title: "Complete System Manual",
    pages: "250 pages",
    description:
      "The comprehensive reference covering every feature, the technical architecture, troubleshooting, and admin operations.",
    href: "/api/docs/complete-manual.pdf",
    adminOnly: true,
  },
];

const faqs: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do I generate today's calling list?",
    a: "Go to Settings (admin) and click Generate Daily Assignments. Only one generation per day is allowed.",
  },
  {
    q: "Can I change my assignment after it's locked?",
    a: "Only an admin can unlock and regenerate with a required reason. Find this in Settings.",
  },
  {
    q: "What if an LO is missing from my list?",
    a: "The LO may be archived or set to unavailable. Check LO Management.",
  },
  {
    q: "How do I submit my EOD report?",
    a: "Go to EOD Reporting in the Reports menu. Transfers and appointments auto-populate.",
  },
  {
    q: "How do I install the app on my phone?",
    a: "Go to Help → Install App in the sidebar menu.",
  },
  {
    q: "Who do I contact for help?",
    a: "Reach out to Ethan Wood (ethan.anthony.wood@gmail.com) or Chris Redoble.",
  },
];

export default function Support() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const visibleDocuments = documents.filter((d) => !d.adminOnly || isAdmin);

  useEffect(() => {
    document.title = "Help & Support · WCLCC";
  }, []);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div
        className="px-6 sm:px-10 py-12 text-white"
        style={{ backgroundColor: NAVY }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: GOLD }}
            >
              <LifeBuoy className="w-6 h-6 text-white" />
            </div>
            <span
              className="text-xs uppercase tracking-widest font-semibold"
              style={{ color: GOLD }}
            >
              Help Center
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            Help &amp; Support
          </h1>
          <p className="text-white/70 max-w-2xl text-sm sm:text-base">
            Everything you need to get the most out of CLR Connection Center —
            videos, documentation, and quick answers to common questions.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto w-full px-6 sm:px-10 py-10 space-y-14">
        {/* Videos Section */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <div
              className="h-1 w-6 rounded-full"
              style={{ backgroundColor: GOLD }}
            />
            <h2
              className="text-xs uppercase tracking-widest font-bold"
              style={{ color: NAVY }}
            >
              Videos
            </h2>
          </div>
          <h3 className="text-2xl font-bold mb-6 text-foreground">
            Watch &amp; Learn
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {videos.map((v) => (
              <Card
                key={v.title}
                className={v.disabled ? "opacity-60" : ""}
              >
                <CardContent className="p-6 flex flex-col h-full">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                    style={{
                      backgroundColor: v.disabled ? "#E5E7EB" : NAVY,
                    }}
                  >
                    <PlayCircle
                      className="w-6 h-6"
                      style={{
                        color: v.disabled ? "#9CA3AF" : GOLD,
                      }}
                    />
                  </div>
                  <Badge
                    variant="secondary"
                    className="self-start mb-3 text-[10px] uppercase tracking-wide"
                  >
                    {v.badge}
                  </Badge>
                  <h4 className="font-bold text-lg mb-2">{v.title}</h4>
                  <p className="text-sm text-muted-foreground mb-5 flex-1">
                    {v.description}
                  </p>
                  {v.disabled ? (
                    <Button
                      disabled
                      className="w-full"
                      variant="secondary"
                    >
                      {v.buttonLabel}
                    </Button>
                  ) : (
                    <Button asChild className="w-full" style={{ backgroundColor: NAVY }}>
                      <Link href={v.href!}>
                        <PlayCircle className="w-4 h-4 mr-2" />
                        {v.buttonLabel}
                      </Link>
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Documents Section */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <div
              className="h-1 w-6 rounded-full"
              style={{ backgroundColor: GOLD }}
            />
            <h2
              className="text-xs uppercase tracking-widest font-bold"
              style={{ color: NAVY }}
            >
              Documents
            </h2>
          </div>
          <h3 className="text-2xl font-bold mb-6 text-foreground">
            Read the Manuals
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {visibleDocuments.map((d) => (
              <Card key={d.title}>
                <CardContent className="p-6 flex flex-col h-full">
                  <div
                    className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                    style={{ backgroundColor: NAVY }}
                  >
                    <FileText className="w-6 h-6" style={{ color: GOLD }} />
                  </div>
                  <Badge
                    variant="secondary"
                    className="self-start mb-3 text-[10px] uppercase tracking-wide"
                  >
                    {d.pages}
                  </Badge>
                  <h4 className="font-bold text-lg mb-2">{d.title}</h4>
                  <p className="text-sm text-muted-foreground mb-5 flex-1">
                    {d.description}
                  </p>
                  <Button asChild variant="outline" className="w-full">
                    <a href={d.href} target="_blank" rel="noopener noreferrer">
                      <Download className="w-4 h-4 mr-2" />
                      Download PDF
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Quick Help Section */}
        <section>
          <div className="flex items-center gap-2 mb-1">
            <div
              className="h-1 w-6 rounded-full"
              style={{ backgroundColor: GOLD }}
            />
            <h2
              className="text-xs uppercase tracking-widest font-bold"
              style={{ color: NAVY }}
            >
              Quick Help
            </h2>
          </div>
          <h3 className="text-2xl font-bold mb-6 text-foreground">
            Common Questions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {faqs.map((f) => (
              <Card key={f.q}>
                <CardContent className="p-5">
                  <div className="flex items-start gap-3">
                    <HelpCircle
                      className="w-5 h-5 mt-0.5 shrink-0"
                      style={{ color: GOLD }}
                    />
                    <div>
                      <p className="font-semibold text-sm mb-1.5">{f.q}</p>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {f.a}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Contact Card */}
        <section>
          <Card style={{ backgroundColor: NAVY }} className="border-0">
            <CardContent className="p-8 text-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold mb-1">Still need help?</h3>
                <p className="text-white/70 text-sm">
                  Reach out to the team that built this platform.
                </p>
              </div>
              <Button
                asChild
                className="font-semibold"
                style={{ backgroundColor: GOLD, color: NAVY }}
              >
                <a href="mailto:ethan.anthony.wood@gmail.com">
                  <Mail className="w-4 h-4 mr-2" />
                  Contact Ethan Wood
                </a>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* Footer note */}
        <p className="text-center text-xs text-muted-foreground pt-4">
          CLR Connection Center · Built by Chris Redoble &amp; Ethan Wood · © 2026 West Capital Lending
        </p>
      </div>
    </div>
  );
}
