import { useMemo, useState } from "react";
import {
  BadgeCheck,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  CircleDollarSign,
  FileCheck2,
  FileSearch,
  FileText,
  Landmark,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DOCUMENT_GUIDES = [
  {
    title: "Credit Report",
    subtitle: "Credit and liability source document",
    icon: FileText,
    checks: [
      "Borrower and co-borrower names match the deal record.",
      "Report date, bureau data, and score summary are present and legible.",
      "The full report is attached—not a cropped score screenshot.",
      "Fraud alerts, freezes, disputes, and address variances are flagged for the licensed loan team.",
      "Material liabilities or payment amounts that differ from the application are called out in the package notes.",
    ],
  },
  {
    title: "AUS Findings",
    subtitle: "Current automated underwriting response",
    icon: FileSearch,
    checks: [
      "Borrower, property, loan amount, and program match the current scenario.",
      "The findings identify the engine used, case or submission ID, and run timestamp.",
      "Recommendation and eligibility language are visible on the first pages.",
      "Required documentation and conditions are included in full.",
      "A revised run replaces the prior current file; the portal retains the version history.",
    ],
  },
  {
    title: "Formal Quote",
    subtitle: "Controlled borrower-facing pricing summary",
    icon: FileCheck2,
    checks: [
      "Borrower and scenario are clearly identified, with the quote date and validity window.",
      "Loan program, term, amount, note rate, APR, points, and lender credits are explicit.",
      "Payment components, estimated closing costs, and cash-to-close assumptions are visible.",
      "Taxes, insurance, HOA, occupancy, credit, and property assumptions are disclosed where applicable.",
      "The quote was prepared or approved through the company’s authorized pricing workflow.",
    ],
  },
];

const TERMS = [
  { term: "AUS", category: "Underwriting", definition: "Automated Underwriting System. A rules and risk engine that evaluates loan data and returns a recommendation plus documentation requirements." },
  { term: "DU", category: "Underwriting", definition: "Desktop Underwriter, Fannie Mae’s automated underwriting system." },
  { term: "LPA", category: "Underwriting", definition: "Loan Product Advisor, Freddie Mac’s automated underwriting system. It is also commonly referred to by its former name, LP." },
  { term: "Findings", category: "Underwriting", definition: "The AUS response showing the submitted scenario, recommendation, eligibility messages, and required documentation." },
  { term: "Approve/Eligible", category: "Underwriting", definition: "A DU recommendation indicating the submitted loan appears to satisfy the engine’s credit-risk and eligibility assessment, subject to verification and all findings." },
  { term: "Accept/Eligible", category: "Underwriting", definition: "An LPA assessment indicating the submitted loan appears acceptable and eligible, subject to validation and all messages in the findings." },
  { term: "Refer", category: "Underwriting", definition: "An AUS response requiring additional review or a different underwriting path. It is not a final credit decision by itself." },
  { term: "Resubmission", category: "Underwriting", definition: "A new AUS run after material loan data changes. The current file should always reflect the latest submitted scenario." },
  { term: "Tri-merge", category: "Credit", definition: "A mortgage credit report combining consumer information from Equifax, Experian, and TransUnion." },
  { term: "Representative Credit Score", category: "Credit", definition: "The score selected under the applicable loan program’s rules for underwriting and pricing. Selection can differ for a single borrower and multiple borrowers." },
  { term: "Liability", category: "Credit", definition: "A debt or obligation considered in qualification, including revolving accounts, installment loans, leases, support obligations, and other recurring payments." },
  { term: "Credit Supplement", category: "Credit", definition: "A targeted update or verification added to a credit report, such as a corrected balance, payment, account status, or mortgage history." },
  { term: "Rapid Rescore", category: "Credit", definition: "An expedited bureau update requested through an approved provider after documented account changes. It is not a promise of a particular score increase." },
  { term: "Disputed Account", category: "Credit", definition: "A tradeline the consumer has formally challenged. Dispute indicators can affect how an AUS evaluates the report and must be handled under current guidelines." },
  { term: "Note Rate", category: "Pricing", definition: "The interest rate used to calculate scheduled principal and interest payments on the promissory note." },
  { term: "APR", category: "Pricing", definition: "Annual Percentage Rate. A standardized expression of the cost of credit that incorporates the note rate and certain finance charges." },
  { term: "Discount Points", category: "Pricing", definition: "Upfront charges expressed as a percentage of the loan amount, commonly associated with obtaining a particular interest rate." },
  { term: "Lender Credit", category: "Pricing", definition: "A credit from the lender applied toward eligible closing costs, typically associated with the selected pricing option." },
  { term: "LLPA", category: "Pricing", definition: "Loan-Level Price Adjustment. A pricing adjustment based on characteristics such as credit score, loan-to-value, occupancy, purpose, and property type." },
  { term: "Rate Lock", category: "Pricing", definition: "An agreement to hold specified loan pricing for a defined period, subject to the lock terms and unchanged qualifying assumptions." },
  { term: "Lock Period", category: "Pricing", definition: "The number of days for which locked pricing is protected. Longer periods can carry different pricing." },
  { term: "P&I", category: "Payment", definition: "Principal and interest, the core scheduled mortgage payment before taxes, insurance, HOA dues, and other housing expenses." },
  { term: "PITI", category: "Payment", definition: "Principal, interest, property taxes, and insurance. It may also be used informally to discuss the broader monthly housing expense." },
  { term: "Cash to Close", category: "Payment", definition: "The estimated funds the borrower must bring to closing after accounting for down payment, costs, credits, deposits, and other adjustments." },
  { term: "DTI", category: "Qualification", definition: "Debt-to-Income ratio. Qualifying monthly obligations divided by qualifying gross monthly income." },
  { term: "LTV", category: "Qualification", definition: "Loan-to-Value ratio. The loan amount divided by the applicable property value under the program’s rules." },
  { term: "CLTV", category: "Qualification", definition: "Combined Loan-to-Value ratio, incorporating the first mortgage and additional liens secured by the property." },
  { term: "Reserves", category: "Qualification", definition: "Eligible borrower assets remaining after closing, commonly expressed as a number of months of qualifying housing expense." },
  { term: "Formal Quote", category: "Operations", definition: "A controlled summary of a specific loan and pricing scenario, including material assumptions, costs, payments, and validity information." },
  { term: "Deal Reference", category: "Operations", definition: "A non-ambiguous internal identifier—such as a loan number or CRM ID—used to match portal documents to the correct borrower package." },
  { term: "Current Version", category: "Operations", definition: "The file presently designated for team use. Replacing a portal document makes the new upload current while retaining its audit history." },
];

const HANDOFF_GROUPS = [
  {
    title: "Identity and scenario",
    items: [
      "Borrower name and deal reference are consistent across all three files.",
      "The selected LO matches the package owner.",
      "Loan amount, purpose, occupancy, property, and program do not conflict across documents.",
    ],
  },
  {
    title: "Document currency",
    items: [
      "The Credit Report is the report intended for the current scenario.",
      "AUS findings reflect the latest material loan data.",
      "The Formal Quote reflects current approved pricing and assumptions.",
    ],
  },
  {
    title: "Quality and security",
    items: [
      "Files are readable, complete, correctly named, and in the correct portal slot.",
      "Sensitive borrower files were not copied into chat, forum, or package notes.",
      "Any mismatch or unresolved item is summarized without duplicating protected data.",
    ],
  },
  {
    title: "LO handoff",
    items: [
      "The package is marked Complete in LAP.",
      "Material assumptions and exceptions are concise and visible in operational notes.",
      "The LO knows which item requires follow-up and who owns the next action.",
    ],
  },
];

export default function LapResources() {
  const [search, setSearch] = useState("");
  const filteredTerms = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return TERMS.filter((item) => !needle || [item.term, item.category, item.definition].some((value) => value.toLowerCase().includes(needle)));
  }, [search]);
  const categories = useMemo(() =>
    Array.from(new Set(filteredTerms.map((item) => item.category))),
  [filteredTerms]);

  return (
    <div className="mx-auto max-w-[1350px] space-y-5 p-4 sm:p-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary via-primary to-primary/75 px-5 py-7 text-primary-foreground shadow-lg sm:px-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
            <BookOpenCheck className="h-4 w-4" /> Mortgage operations reference
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">LAP Resources</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-primary-foreground/80">
            Practical quality-control guidance and precise lending terminology for assembling a professional LO handoff.
          </p>
        </div>
      </section>

      <Tabs defaultValue="documents">
        <TabsList className="h-auto w-full justify-start overflow-x-auto p-1 sm:w-fit">
          <TabsTrigger value="documents">Document standards</TabsTrigger>
          <TabsTrigger value="reference">Terminology</TabsTrigger>
          <TabsTrigger value="handoff">Handoff checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-5 space-y-5">
          <div className="grid gap-4 lg:grid-cols-3">
            {DOCUMENT_GUIDES.map(({ title, subtitle, icon: Icon, checks }) => (
              <Card key={title} className="overflow-hidden">
                <CardHeader className="border-b bg-primary/5 pb-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="pt-2 text-lg">{title}</CardTitle>
                  <CardDescription>{subtitle}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-5">
                  {checks.map((check) => (
                    <div key={check} className="flex items-start gap-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-xs leading-relaxed text-muted-foreground">{check}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Handle borrower documents as protected information</AlertTitle>
            <AlertDescription>
              Keep Credit Reports, AUS findings, and Formal Quotes inside their designated LAP package. Do not paste sensitive values into Chat, Forum, filenames, or free-form notes.
            </AlertDescription>
          </Alert>
        </TabsContent>

        <TabsContent value="reference" className="mt-5 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search underwriting, credit, pricing, payment, or operations…"
                  className="pl-9"
                />
              </div>
            </CardContent>
          </Card>
          {filteredTerms.length === 0 ? (
            <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">No reference terms match “{search}”.</CardContent></Card>
          ) : (
            categories.map((category) => (
              <section key={category}>
                <div className="mb-2 flex items-center gap-2">
                  {category === "Underwriting" ? <Landmark className="h-4 w-4 text-primary" />
                    : category === "Pricing" || category === "Payment" ? <CircleDollarSign className="h-4 w-4 text-primary" />
                    : category === "Qualification" ? <Calculator className="h-4 w-4 text-primary" />
                    : <BadgeCheck className="h-4 w-4 text-primary" />}
                  <h2 className="text-sm font-semibold">{category}</h2>
                  <Badge variant="secondary">{filteredTerms.filter((item) => item.category === category).length}</Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {filteredTerms.filter((item) => item.category === category).map((item) => (
                    <Card key={item.term}>
                      <CardContent className="p-4">
                        <h3 className="font-semibold text-primary">{item.term}</h3>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.definition}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            ))
          )}
        </TabsContent>

        <TabsContent value="handoff" className="mt-5">
          <div className="grid gap-4 md:grid-cols-2">
            {HANDOFF_GROUPS.map((group, index) => (
              <Card key={group.title}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span>
                    <CardTitle className="text-base">{group.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {group.items.map((item) => (
                    <div key={item} className="flex items-start gap-2.5 rounded-lg bg-muted/25 px-3 py-2.5">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <p className="text-xs leading-relaxed">{item}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="mt-4 border-primary/25 bg-primary/5">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">The clean-package standard</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Another team member should be able to identify the scenario, open the current three files, understand any exception, and take the next action without searching another system.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <p className="text-center text-[11px] text-muted-foreground">
        Operational reference only. Current company policy, investor guidelines, and compliance direction control whenever they differ from this page.
      </p>
    </div>
  );
}
