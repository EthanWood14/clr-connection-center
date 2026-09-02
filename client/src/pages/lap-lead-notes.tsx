// Lead Notes — the LOA note composer as its own page. Search for the borrower,
// open their package's thread, post the note; the loan officer and the
// lead-notes inbox from Settings get every note by email.
// The package view still shows the same thread; this page just gets an LOA
// there in two taps without walking through Input Results.
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowRight, FileSearch, NotebookPen, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PackageNotesThread } from "@/components/lap/package-notes-thread";
import { formatLapDate, lapRequest, unwrapLapResult, unwrapLapResults } from "@/lib/lap-api";

export default function LapLeadNotes() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "admin" || !!user?.superAdmin;
  // Same rule the server uses for who may post LO remarks: admins, or anyone
  // signed into the LO portal. This used to be plain isAdmin, so an LO on
  // /lop never saw the reply box.
  const isLoSide = isAdmin || user?.portal === "lop";
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const composerRef = useRef<HTMLDivElement>(null);
  const [matchesNoteRoute, noteRouteParams] = useRoute<{ resultId: string }>("/notes/:resultId");
  const requestedId = matchesNoteRoute ? Number(noteRouteParams?.resultId) : 0;
  const hasValidRequestedId = Number.isInteger(requestedId) && requestedId > 0;

  const resultQueryString = useMemo(() => {
    const query = new URLSearchParams({ limit: "25" });
    if (deferredSearch) query.set("q", deferredSearch);
    return query.toString();
  }, [deferredSearch]);

  const resultsQuery = useQuery({
    queryKey: ["/api/lap/results", "lead-notes", resultQueryString],
    queryFn: () => lapRequest<any>("GET", `/api/lap/results?${resultQueryString}`),
    // Keep the last list on screen while a new search term loads; without it
    // every deferred keystroke blanked the list into skeletons.
    placeholderData: keepPreviousData,
  });
  // Same key as the package view, so a package opened there is already cached here.
  const packageQuery = useQuery({
    queryKey: ["/api/lap/results", "detail", requestedId],
    queryFn: () => lapRequest<unknown>("GET", `/api/lap/results/${requestedId}`),
    enabled: hasValidRequestedId,
  });

  const results = useMemo(() => unwrapLapResults(resultsQuery.data), [resultsQuery.data]);
  const pkg = useMemo(() => {
    if (!packageQuery.data) return null;
    try { return unwrapLapResult(packageQuery.data); }
    catch { return null; }
  }, [packageQuery.data]);
  const packageMissing = matchesNoteRoute && (
    !hasValidRequestedId || packageQuery.isError || (!packageQuery.isLoading && !pkg)
  );

  // On a phone the list sits above the thread; bring the thread into view once a borrower is picked.
  useEffect(() => {
    if (!hasValidRequestedId) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const timer = window.setTimeout(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [hasValidRequestedId, requestedId]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <NotebookPen className="h-5 w-5 text-primary" /> Lead Notes
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick the borrower, fill in the note. The loan officer and the lead-notes inbox get it by email.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-3 border-b p-4">
            <div>
              <CardTitle className="text-base">Find the borrower</CardTitle>
              <CardDescription>Packages filed under Input Results.</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Borrower name"
                className="pl-9"
                data-testid="lap-notes-search"
              />
            </div>
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-y-auto p-2 lg:max-h-[600px]">
            {resultsQuery.isFetching && !resultsQuery.isLoading && (
              <p className="px-2 pb-1 text-[11px] text-muted-foreground" data-testid="lap-notes-updating">Updating…</p>
            )}
            {/* isLoading only holds before the first list arrives; later searches keep the old list and just show the line above. */}
            {resultsQuery.isLoading ? (
              <div className="space-y-2 p-2" data-testid="lap-notes-loading">
                {[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-lg bg-muted" />)}
              </div>
            ) : resultsQuery.isError ? (
              <div className="p-6 text-center">
                <p className="text-sm font-medium">Could not load packages</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => resultsQuery.refetch()}>
                  <RefreshCw /> Try again
                </Button>
              </div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center" data-testid="lap-notes-empty">
                <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  No package for that borrower yet — start one under{" "}
                  <Link href="/results" className="font-medium text-primary underline-offset-4 hover:underline">Input Results</Link>.
                </p>
              </div>
            ) : (
              results.map((result) => {
                const active = hasValidRequestedId && result.id === requestedId;
                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => navigate(`/notes/${result.id}`)}
                    className={`mb-1 w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                      active ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60"
                    }`}
                    data-testid={`lap-notes-pick-${result.id}`}
                  >
                    <p className="truncate text-sm font-semibold">{result.borrowerName}</p>
                    <p className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{result.loanOfficerName || "No loan officer"}</span>
                      <span className="shrink-0">{formatLapDate(result.resultDate)}</span>
                    </p>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <div ref={composerRef} className="scroll-mt-16">
          <Card>
            <CardContent className="p-4 sm:p-6">
              {!matchesNoteRoute ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
                  <NotebookPen className="h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">Pick a borrower to open their notes</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">Search above, then tap the name.</p>
                </div>
              ) : hasValidRequestedId && packageQuery.isLoading ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
                  <RefreshCw className="h-6 w-6 animate-spin text-primary" />
                  <p className="mt-3 text-sm font-medium">Opening package…</p>
                </div>
              ) : packageMissing || !pkg ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center text-center">
                  <FileSearch className="h-7 w-7 text-muted-foreground/40" />
                  <h2 className="mt-3 text-base font-semibold">Package unavailable</h2>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                    It may have been merged, removed, or belongs to another workspace.
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" onClick={() => navigate("/notes")}>
                    Back to the search
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold" data-testid="lap-notes-borrower">{pkg.borrowerName}</h2>
                      <p className="text-xs text-muted-foreground">
                        {pkg.loanOfficerName || "No loan officer"} · {formatLapDate(pkg.resultDate)}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/results/${pkg.id}`} data-testid="lap-notes-open-package">Open the full package <ArrowRight /></Link>
                    </Button>
                  </div>
                  <PackageNotesThread key={pkg.id} result={pkg} isLoSide={isLoSide} isAdmin={isAdmin} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
