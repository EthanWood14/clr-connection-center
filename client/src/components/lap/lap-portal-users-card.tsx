import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Mail, Plus, UserCog, UsersRound } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePortalProduct, productLabel } from "./lap-shell";

type PortalUser = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  portal?: string | null;
  loanOfficerId?: number | null;
};
type LoanOfficer = { id: number; fullName?: string; full_name?: string; name?: string };

const loName = (lo: LoanOfficer) => lo.fullName ?? lo.full_name ?? lo.name ?? `LO #${lo.id}`;

/**
 * Admin-only management of LAP/LOP logins from inside the portal.
 *
 * These are ordinary C3 endpoints. The portal guard confines accounts whose
 * `portal` is lap/lop — an administrator is a C3 account, so nothing extra had
 * to be opened up for this card to work. A portal user never sees it.
 */
export function LapPortalUsersCard() {
  const product = usePortalProduct();
  const label = productLabel(product);
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [linkedLo, setLinkedLo] = useState<string>("none");

  const usersQuery = useQuery<PortalUser[]>({ queryKey: ["/api/users"] });
  const losQuery = useQuery<LoanOfficer[]>({ queryKey: ["/api/loan-officers"] });

  const portalUsers = useMemo(
    () => (usersQuery.data ?? []).filter((u) => String(u.portal ?? "").toLowerCase() === product),
    [usersQuery.data, product],
  );
  const los = useMemo(
    () => [...(losQuery.data ?? [])].sort((a, b) => loName(a).localeCompare(loName(b))),
    [losQuery.data],
  );
  const loById = useMemo(() => new Map(los.map((lo) => [lo.id, loName(lo)])), [los]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/users"] });

  const create = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/users", {
        name: name.trim(),
        email: email.trim(),
        role: "assistant",
        portal: product,
        loanOfficerId: linkedLo === "none" ? null : Number(linkedLo),
        sendWelcome: true,
      }),
    onSuccess: (res: any) => {
      invalidate();
      setName(""); setEmail(""); setLinkedLo("none");
      toast({
        title: res?.emailSent ? `${label} login created — invite sent` : `${label} login created`,
        description: res?.emailSent ? undefined : res?.emailError || "The welcome email did not send.",
        variant: res?.emailRequested && !res?.emailSent ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Could not create the login", description: e?.message, variant: "destructive" }),
  });

  const link = useMutation({
    mutationFn: (v: { id: number; loanOfficerId: number | null }) =>
      apiRequest("PATCH", `/api/users/${v.id}`, { loanOfficerId: v.loanOfficerId }),
    onSuccess: () => { invalidate(); toast({ title: "Loan officer updated" }); },
    onError: (e: any) => toast({ title: "Could not update", description: e?.message, variant: "destructive" }),
  });

  const canCreate = name.trim().length >= 2 && /.+@.+\..+/.test(email.trim()) && !create.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRound className="h-4 w-4 text-primary" /> {label} logins
        </CardTitle>
        <CardDescription>
          {product === "lop"
            ? "Loan officers who sign in here. Each one sees their own result packages plus those of the assistants linked to them."
            : "Assistants who sign in here. Each one sees only their own result packages; the loan officer they are linked to sees them too."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="portal-user-name">Full name</Label>
            <Input id="portal-user-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" className="h-9" data-testid="portal-user-name" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="portal-user-email">Email</Label>
            <Input id="portal-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" className="h-9" data-testid="portal-user-email" />
          </div>
          <Button className="h-9 gap-1.5" disabled={!canCreate} onClick={() => create.mutate()} data-testid="portal-user-create">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{product === "lop" ? "Which loan officer is this?" : "Assists which loan officer?"}</Label>
          <Select value={linkedLo} onValueChange={setLinkedLo}>
            <SelectTrigger className="h-9" data-testid="portal-user-lo"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not linked yet</SelectItem>
              {los.map((lo) => <SelectItem key={lo.id} value={String(lo.id)}>{loName(lo)}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            <Mail className="mr-1 inline h-3 w-3" />
            A welcome email with a sign-in link goes out on create. They set their own password on first login.
          </p>
        </div>

        <div className="rounded-xl border divide-y">
          {usersQuery.isLoading ? (
            <div className="h-20 animate-pulse rounded-xl bg-muted" />
          ) : portalUsers.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">No {label} logins yet.</p>
          ) : (
            portalUsers.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`portal-user-row-${u.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    {u.name}
                    {!u.isActive && <Badge variant="outline" className="text-[10px] text-muted-foreground">Inactive</Badge>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {u.email}
                    {u.loanOfficerId ? ` · ${loById.get(u.loanOfficerId) ?? `LO #${u.loanOfficerId}`}` : " · not linked to an LO"}
                  </p>
                </div>
                <Select
                  value={u.loanOfficerId ? String(u.loanOfficerId) : "none"}
                  onValueChange={(v) => link.mutate({ id: u.id, loanOfficerId: v === "none" ? null : Number(v) })}
                >
                  <SelectTrigger className="h-8 w-[190px] text-xs" data-testid={`portal-user-lo-${u.id}`}>
                    <UserCog className="mr-1 h-3.5 w-3.5 shrink-0" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not linked</SelectItem>
                    {los.map((lo) => <SelectItem key={lo.id} value={String(lo.id)}>{loName(lo)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
