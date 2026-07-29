import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  ExternalLink,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LicensedStatesEditor } from "@/components/licensed-states-editor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { lapRequest } from "@/lib/lap-api";

interface LoanOfficerProfile {
  id: number;
  fullName: string;
  nmlsId: string | null;
  phone: string | null;
  email: string | null;
  internalStatus: string;
  licensedStates: string[];
  notes: string | null;
  tags: string[];
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {}
  return value.split(/[,;|]/).map((item) => item.trim()).filter(Boolean);
}

function normalizeLoanOfficer(value: any): LoanOfficerProfile {
  return {
    id: Number(value?.id ?? 0),
    fullName: String(value?.fullName ?? value?.full_name ?? value?.name ?? "Unnamed Loan Officer"),
    nmlsId: value?.nmlsId ?? value?.nmls_id ?? null,
    phone: value?.phone ?? null,
    email: value?.email ?? null,
    internalStatus: String(value?.internalStatus ?? value?.internal_status ?? "active").toLowerCase(),
    licensedStates: parseList(value?.licensedStates ?? value?.licensed_states ?? value?.nmlsStates ?? value?.nmls_states),
    notes: value?.notes ?? value?.specialRequests ?? value?.special_requests ?? null,
    tags: parseList(value?.tags),
  };
}

function statusLabel(status: string) {
  if (status === "vacation" || status === "unavailable") return "Unavailable";
  if (status === "archived") return "Archived";
  if (status === "inactive") return "Inactive";
  return "Active";
}

function statusClass(status: string) {
  if (status === "active") return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  if (status === "vacation" || status === "unavailable") return "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
  return "text-muted-foreground";
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

export default function LapLoProfiles() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const [state, setState] = useState("all");

  const query = useQuery({
    queryKey: ["/api/lap/loan-officers"],
    queryFn: async () => {
      const response = await lapRequest<any>("GET", "/api/lap/loan-officers");
      const values = Array.isArray(response) ? response : (response?.loanOfficers ?? response?.items ?? []);
      return values.map(normalizeLoanOfficer) as LoanOfficerProfile[];
    },
  });

  const profiles = query.data ?? [];
  const states = useMemo(() =>
    Array.from(new Set(profiles.flatMap((profile) => profile.licensedStates))).sort(),
  [profiles]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return profiles
      .filter((profile) => status === "all" || profile.internalStatus === status)
      .filter((profile) => state === "all" || profile.licensedStates.includes(state))
      .filter((profile) => !needle || [
        profile.fullName,
        profile.email,
        profile.phone,
        profile.nmlsId,
        profile.licensedStates.join(" "),
      ].some((value) => value?.toLowerCase().includes(needle)))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [profiles, search, status, state]);

  const activeCount = profiles.filter((profile) => profile.internalStatus === "active").length;

  return (
    <div className="mx-auto max-w-[1450px] space-y-5 p-4 sm:p-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary via-primary to-primary/75 px-5 py-7 text-primary-foreground shadow-lg sm:px-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
              <Building2 className="h-4 w-4" /> Lending team
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">LO Profiles</h1>
            <p className="mt-2 max-w-2xl text-sm text-primary-foreground/80">
              A clean reference for Loan Officer contact details, licensing coverage, and current availability. State permissions can be maintained by every signed-in user.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl border border-white/15 bg-black/10 px-4 py-2">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">Active LOs</p>
              <p className="text-xl font-bold tabular-nums">{activeCount}</p>
            </div>
            <div className="rounded-xl border border-white/15 bg-black/10 px-4 py-2">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/60">States covered</p>
              <p className="text-xl font-bold tabular-nums">{states.length}</p>
            </div>
          </div>
        </div>
      </section>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(260px,1fr)_180px_180px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, NMLS, contact, or state…"
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="unavailable">Unavailable</SelectItem>
              <SelectItem value="vacation">Vacation</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger><SelectValue placeholder="Every state" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every state</SelectItem>
              {states.map((abbr) => <SelectItem key={abbr} value={abbr}>{abbr}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {query.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((item) => <div key={item} className="h-72 animate-pulse rounded-xl bg-muted" />)}
        </div>
      ) : query.isError ? (
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-sm font-medium">LO profiles could not be loaded.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}><RefreshCw /> Retry</Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Users className="mx-auto h-9 w-9 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium">No Loan Officers match these filters.</p>
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setSearch(""); setStatus("all"); setState("all"); }}>Clear filters</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((profile) => (
            <Card key={profile.id} className="overflow-hidden transition-colors hover:border-primary/35">
              <CardHeader className="border-b bg-muted/15 pb-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                    {initials(profile.fullName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="truncate text-base">{profile.fullName}</CardTitle>
                      <Badge variant="outline" className={statusClass(profile.internalStatus)}>{statusLabel(profile.internalStatus)}</Badge>
                    </div>
                    <CardDescription className="mt-1 flex items-center gap-1">
                      <UserRound className="h-3.5 w-3.5" /> Loan Officer
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                <div className="space-y-2.5">
                  {profile.email ? (
                    <a href={`mailto:${profile.email}`} className="flex items-center gap-2 text-sm hover:text-primary">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{profile.email}</span>
                    </a>
                  ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Mail className="h-4 w-4" /> No email on file</p>}
                  {profile.phone ? (
                    <a href={`tel:${profile.phone}`} className="flex items-center gap-2 text-sm hover:text-primary">
                      <Phone className="h-4 w-4 shrink-0 text-muted-foreground" /> {profile.phone}
                    </a>
                  ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><Phone className="h-4 w-4" /> No phone on file</p>}
                  {profile.nmlsId ? (
                    <a
                      href={`https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/${encodeURIComponent(profile.nmlsId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm hover:text-primary"
                    >
                      <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                      NMLS {profile.nmlsId} <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : <p className="flex items-center gap-2 text-sm text-muted-foreground"><ShieldCheck className="h-4 w-4" /> No NMLS ID on file</p>}
                </div>

                <div className="border-t pt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" /> Licensed states
                    </div>
                    <LicensedStatesEditor
                      loId={profile.id}
                      loName={profile.fullName}
                      states={profile.licensedStates}
                      endpoint={`/api/lap/loan-officers/${profile.id}/licensed-states`}
                      queryKeys={["/api/lap/loan-officers"]}
                      compact
                    />
                  </div>
                  {profile.licensedStates.length ? (
                    <div className="flex flex-wrap gap-1.5">
                      {profile.licensedStates.map((abbr) => <Badge key={abbr} variant="secondary">{abbr}</Badge>)}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No state coverage has been recorded.</p>
                  )}
                </div>

                {(profile.tags.length > 0 || profile.notes) && (
                  <div className="border-t pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Additional context</p>
                    {profile.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{profile.notes}</p>}
                    {profile.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {profile.tags.map((tag) => <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{tag}</span>)}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-center text-[11px] text-muted-foreground">
        Profiles are an operational reference. Confirm current licensing and compliance requirements through approved company channels.
      </p>
    </div>
  );
}
