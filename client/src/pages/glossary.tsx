import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Search } from "lucide-react";
import { HelpIcon, PageTooltip, markStep } from "@/components/onboarding";
import { useAuth } from "@/lib/auth";

type Category = "Role" | "Loan Type" | "Program" | "Process" | "Financial";

type Term = {
  term: string;
  abbr?: string;
  category: Category;
  definition: string;
};

const TERMS: Term[] = [
  // Roles
  {
    term: "CLR",
    abbr: "Client Lending Representative",
    category: "Role",
    definition:
      "The team member responsible for calling leads, qualifying prospects, and routing them to the appropriate Loan Officer. CLRs are the first point of contact for potential borrowers.",
  },
  {
    term: "LO",
    abbr: "Loan Officer",
    category: "Role",
    definition:
      "Licensed mortgage professional who advises borrowers, structures loan products, and takes the application after a CLR transfer.",
  },
  {
    term: "Manager",
    category: "Role",
    definition:
      "A supervisor or team lead who receives report emails and oversees CLR performance.",
  },

  // Loan Types
  {
    term: "Conventional",
    category: "Loan Type",
    definition:
      "A standard mortgage loan not insured or guaranteed by the federal government. Typically requires a minimum 3–5% down payment and good credit. Conforming loans must meet Fannie Mae/Freddie Mac limits.",
  },
  {
    term: "FHA",
    abbr: "Federal Housing Administration",
    category: "Loan Type",
    definition:
      "A government-backed loan with lower credit and down payment requirements (as low as 3.5%). Popular with first-time homebuyers.",
  },
  {
    term: "VA",
    abbr: "Veterans Affairs",
    category: "Loan Type",
    definition:
      "A government-backed loan available to eligible military veterans, active-duty service members, and surviving spouses. Often requires no down payment and no PMI.",
  },
  {
    term: "Jumbo",
    category: "Loan Type",
    definition:
      "A loan that exceeds the conforming loan limits set by the FHFA (typically above $766,550 in most areas). Requires stronger credit and larger down payments.",
  },
  {
    term: "Non-QM",
    abbr: "Non-Qualified Mortgage",
    category: "Loan Type",
    definition:
      "Loans that don't meet standard qualified mortgage guidelines. Used for self-employed borrowers, investors, or those with unique income situations.",
  },
  {
    term: "HELOC",
    abbr: "Home Equity Line of Credit",
    category: "Loan Type",
    definition:
      "A revolving line of credit secured by the borrower's home equity. Functions like a credit card with a draw period and repayment period.",
  },

  // Programs
  {
    term: "DPA",
    abbr: "Down Payment Assistance",
    category: "Program",
    definition:
      "Programs that help borrowers cover their down payment or closing costs, often through grants or second loans. Varies by state and county.",
  },
  {
    term: "CalHFA",
    abbr: "California Housing Finance Agency",
    category: "Program",
    definition:
      "California's state housing finance agency offering down payment assistance and below-market interest rate programs for first-time homebuyers in California.",
  },

  // Process
  {
    term: "Transfer",
    category: "Process",
    definition:
      "When a CLR connects a qualified prospect to an LO, either live (Direct Transfer) or scheduled (Appointment Transfer).",
  },
  {
    term: "Direct Transfer",
    category: "Process",
    definition:
      "A live handoff where the CLR connects the prospect to an LO in real time during the call.",
  },
  {
    term: "Fell Through",
    category: "Process",
    definition:
      "A call or lead that did not result in a transfer or appointment; the prospect was not qualified or declined to move forward.",
  },
  {
    term: "Future Contact",
    category: "Process",
    definition:
      "A lead who is not ready now but has expressed interest in being contacted at a later date.",
  },
  {
    term: "Appointment / Callback",
    category: "Process",
    definition:
      "A scheduled time for an LO or CLR to follow up with a prospect who couldn't connect immediately.",
  },
  {
    term: "NMLS",
    abbr: "Nationwide Multistate Licensing System",
    category: "Process",
    definition:
      "The licensing system for mortgage professionals. Each LO has a unique NMLS ID that must be current and compliant.",
  },
  {
    term: "Pipeline",
    category: "Process",
    definition:
      "The collection of active leads and prospects a CLR or LO is currently working.",
  },
  {
    term: "Conversion Rate",
    category: "Process",
    definition:
      "The percentage of calls or contacts that result in a transfer to an LO.",
  },
  {
    term: "Lead",
    category: "Process",
    definition:
      "A potential borrower who has expressed interest in mortgage services, typically obtained through marketing or lead purchase platforms.",
  },
  {
    term: "Prospect",
    category: "Process",
    definition:
      "A lead who has been contacted and is being actively qualified by a CLR.",
  },
  {
    term: "Bonzo",
    category: "Process",
    definition:
      "The CRM and communication platform used by the team to manage leads and log interactions. CLRs must use proper Bonzo notation when recording transfers.",
  },

  // Financial
  {
    term: "PMI",
    abbr: "Private Mortgage Insurance",
    category: "Financial",
    definition:
      "Insurance required on conventional loans when the down payment is less than 20%. Protects the lender if the borrower defaults.",
  },
  {
    term: "DTI",
    abbr: "Debt-to-Income Ratio",
    category: "Financial",
    definition:
      "A borrower's monthly debt payments divided by gross monthly income. A key factor lenders use to qualify borrowers.",
  },
  {
    term: "LTV",
    abbr: "Loan-to-Value Ratio",
    category: "Financial",
    definition:
      "The loan amount divided by the appraised property value. Higher LTV = more risk for the lender.",
  },
  {
    term: "APR",
    abbr: "Annual Percentage Rate",
    category: "Financial",
    definition:
      "The true yearly cost of a loan, including interest rate and fees. More comprehensive than the interest rate alone.",
  },
  {
    term: "Rate Lock",
    category: "Financial",
    definition:
      "A lender's commitment to hold a specific interest rate for a set period while the loan is processed.",
  },
  {
    term: "Closing Costs",
    category: "Financial",
    definition:
      "Fees and expenses (beyond the purchase price) due at closing, typically 2–5% of the loan amount.",
  },
  {
    term: "Pre-Approval",
    category: "Financial",
    definition:
      "A lender's conditional commitment to loan a borrower a specific amount, based on verified financial information.",
  },
  {
    term: "Escrow",
    category: "Financial",
    definition:
      "A neutral third party that holds funds during a transaction. Also refers to the account that holds property tax and insurance payments collected monthly.",
  },
];

const CATEGORY_STYLES: Record<Category, string> = {
  "Role": "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "Loan Type": "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  "Program": "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  "Process": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "Financial": "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
};

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "Role", label: "Roles" },
  { key: "Loan Type", label: "Loan Types" },
  { key: "Program", label: "Programs" },
  { key: "Process", label: "Process Terms" },
  { key: "Financial", label: "Financial Terms" },
];

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function slugCategory(c: Category) {
  return c.toLowerCase().replace(/\s+/g, "-");
}

export default function GlossaryPage() {
  const [query, setQuery] = useState("");
  const { user } = useAuth();

  useEffect(() => {
    document.title = "Glossary · WCLCC";
  }, []);

  useEffect(() => { markStep(user?.id, "read_glossary"); }, [user?.id]);

  const q = query.trim().toLowerCase();
  const isSearching = q.length > 0;

  const sortedTerms = useMemo(
    () => [...TERMS].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" })),
    []
  );

  const filtered = useMemo(() => {
    if (!isSearching) return sortedTerms;
    return sortedTerms.filter((t) =>
      t.term.toLowerCase().includes(q) ||
      (t.abbr?.toLowerCase().includes(q) ?? false) ||
      t.definition.toLowerCase().includes(q) ||
      t.category.toLowerCase().includes(q)
    );
  }, [sortedTerms, q, isSearching]);

  const byCategory = useMemo(() => {
    const map: Record<Category, Term[]> = { "Role": [], "Loan Type": [], "Program": [], "Process": [], "Financial": [] };
    for (const t of sortedTerms) map[t.category].push(t);
    return map;
  }, [sortedTerms]);

  const availableLetters = useMemo(() => {
    const set = new Set<string>();
    for (const t of sortedTerms) set.add(t.term[0].toUpperCase());
    return set;
  }, [sortedTerms]);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function TermCard({ t }: { t: Term }) {
    return (
      <Card
        id={`term-${t.term.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
        className="hover:shadow-md transition-shadow"
        data-testid={`glossary-term-${t.term}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
            <h2 className="text-lg font-bold leading-tight text-[#1A2B4A] dark:text-blue-100">
              {t.term}
              {t.abbr && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({t.abbr})
                </span>
              )}
            </h2>
            <Badge
              variant="secondary"
              className={`${CATEGORY_STYLES[t.category]} border-0 text-[11px] font-medium shrink-0`}
            >
              {t.category}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{t.definition}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full">
      <PageTooltip pageKey="glossary" title="Glossary">
        Definitions for mortgage and CLR industry terms.
      </PageTooltip>

      <div className="flex items-center gap-3 mb-1">
        <BookOpen className="w-6 h-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-[#1A2B4A] dark:text-blue-100">
          Glossary
          <HelpIcon title="Glossary">
            Definitions for mortgage and CLR industry terms.
          </HelpIcon>
        </h1>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Mortgage and CLR Connection Center terminology. Search, jump by letter, or pick a category.
      </p>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search terms, abbreviations, or definitions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          data-testid="glossary-search"
        />
      </div>

      {/* Alphabet jump (hidden while searching) */}
      {!isSearching && (
        <div className="flex flex-wrap gap-1 mb-5">
          {ALPHABET.map(letter => {
            const has = availableLetters.has(letter);
            return (
              <button
                key={letter}
                type="button"
                disabled={!has}
                onClick={() => {
                  const firstTerm = sortedTerms.find(t => t.term[0].toUpperCase() === letter);
                  if (firstTerm) scrollTo(`term-${firstTerm.term.toLowerCase().replace(/[^a-z0-9]/g, "-")}`);
                }}
                className={`w-7 h-7 text-xs font-semibold rounded transition-colors ${
                  has
                    ? "bg-muted hover:bg-primary hover:text-primary-foreground text-foreground cursor-pointer"
                    : "bg-muted/40 text-muted-foreground/40 cursor-not-allowed"
                }`}
                aria-label={`Jump to letter ${letter}`}
              >
                {letter}
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile category filter row (horizontal scroll) */}
      {!isSearching && (
        <div className="lg:hidden overflow-x-auto mb-4 -mx-4 px-4">
          <div className="flex gap-2 min-w-min">
            {CATEGORIES.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => scrollTo(`cat-${slugCategory(c.key)}`)}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-semibold rounded-full border ${CATEGORY_STYLES[c.key]} hover:opacity-80 transition-opacity`}
              >
                {c.label} ({byCategory[c.key].length})
              </button>
            ))}
          </div>
        </div>
      )}

      {isSearching ? (
        // Search results: flat list
        filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground text-center">
              No terms match "{query}".
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map(t => <TermCard key={t.term} t={t} />)}
          </div>
        )
      ) : (
        // Default view: sidebar + grouped categories
        <div className="grid grid-cols-1 lg:grid-cols-[200px_1fr] gap-6">
          {/* Desktop sidebar */}
          <aside className="hidden lg:block sticky top-4 self-start">
            <div className="space-y-1">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Categories</p>
              {CATEGORIES.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => scrollTo(`cat-${slugCategory(c.key)}`)}
                  className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors flex items-center justify-between group"
                >
                  <span className="font-medium">{c.label}</span>
                  <span className="text-xs text-muted-foreground group-hover:text-foreground">{byCategory[c.key].length}</span>
                </button>
              ))}
            </div>
          </aside>

          {/* Main content — grouped by category */}
          <div className="space-y-8">
            {CATEGORIES.map(c => (
              byCategory[c.key].length > 0 && (
                <section key={c.key} id={`cat-${slugCategory(c.key)}`} className="scroll-mt-4">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b">
                    <h2 className="text-lg font-bold text-[#1A2B4A] dark:text-blue-100">{c.label}</h2>
                    <Badge variant="secondary" className={`${CATEGORY_STYLES[c.key]} border-0 text-[10px]`}>
                      {byCategory[c.key].length}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {byCategory[c.key].map(t => <TermCard key={t.term} t={t} />)}
                  </div>
                </section>
              )
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center mt-8">
        {isSearching ? filtered.length : TERMS.length} of {TERMS.length} terms
      </p>
    </div>
  );
}
