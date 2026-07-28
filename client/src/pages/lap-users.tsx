import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Ban, CheckCircle2, Loader2, Mail, Pencil, Plus, RotateCcw, Search, ShieldCheck, UserCog, UsersRound,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePortalProduct, productLabel, productFullName } from "@/components/lap/lap-shell";

type PortalUser = {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  portal?: string | null;
  loanOfficerId?: number | null;
  createdAt?: string;
};
type LoanOfficer = { id: number; fullName?: string; full_name?: string; name?: string };

const loName = (lo: LoanOfficer) => lo.fullName ?? lo.full_name ?? lo.name ?? `LO #${lo.id}`;
const emailValid = (v: string) => /.+@.+\..+/.test(v.trim());

/**
 * Account management for a portal, standing on its own rather than borrowing
 * C3's Team page. These are ordinary C3 endpoints — the portal guard confines
 * accounts whose portal is lap/lop, and an administrator is a C3 account, so
 * nothing extra is exposed. Portal users never see this page.
 */
export default function LapUsers() {
  const product = usePortalProduct();
  const label = productLabel(product);
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin" || !!user?.superAdmin;

  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<PortalUser | null>(null);
  const [adding, setAdding] = useState(false);

  const usersQuery = useQuery<PortalUser[]>({ queryKey: ["/api/users"], enabled: isAdmin });
  const losQuery = useQuery<LoanOfficer[]>({ queryKey: ["/api/loan-officers"], enabled: isAdmin });

  const los = useMemo(
    () => [...(losQuery.data ?? [])].sort((a, b) => loName(a).localeCompare(loName(b))),
    [losQuery.data],
  );
  const loById = useMemo(() => new Map(los.map((lo) => [lo.id, loName(lo)])), [los]);
  const rows = useMemo(() => {
    const all = (usersQuery.data ?? []).filter((u) => String(u.portal ?? "").toLowerCase() === product);
    const needle = q.trim().toLowerCase();
    return needle
      ? all.filter((u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
      : all;
  }, [usersQuery.data, product, q]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/users"] });
  const fail = (title: string) => (e: any) =>
    toast({ title, description: e?.message, variant: "destructive" });

  const setActive = useMutation({
    mutationFn: (v: { id: number; isActive: boolean }) => apiRequest("PATCH", `/api/users/${v.id}`, { isActive: v.isActive }),
    onSuccess: (_d, v) => { invalidate(); toast({ title: v.isActive ? "Account reactivated" : "Account deactivated" }); },
    onError: fail("Could not update the account"),
  });
  const resend = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/users/${id}/resend-welcome`, {}),
    onSuccess: () => toast({ title: "Welcome email queued", description: "A fresh temporary password and sign-in link are on their way." }),
    onError: fail("Could not resend the welcome email"),
  });
  const relink = useMutation({
    mutationFn: (v: { id: number; loanOfficerId: number | null }) =>
      apiRequest("PATCH", `/api/users/${v.id}`, { loanOfficerId: v.loanOfficerId }),
    onSuccess: () => { invalidate(); toast({ title: "Loan officer updated" }); },
    onError: fail("Could not update"),
  });

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <Card><CardContent className="py-12 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">Administrators only</p>
          <p className="mt-1 text-xs text-muted-foreground">{label} accounts are managed by a West Capital administrator.</p>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{label} Users</h1>
        <p className="text-sm text-muted-foreground">
          Everyone who signs in to the {productFullName(product)}.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersRound className="h-4 w-4 text-primary" /> Accounts
                <Badge variant="outline" className="ml-1 font-normal">{rows.length}</Badge>
              </CardTitle>
              <CardDescription>
                {product === "lop"
                  ? "Each loan officer sees their own result packages plus those of the assistants linked to them."
                  : "Each assistant sees only their own result packages."}
              </CardDescription>
            </div>
            <Button className="gap-1.5" onClick={() => setAdding(true)} data-testid="lap-users-add">
              <Plus className="h-4 w-4" /> Add user
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" className="h-9 pl-8" />
          </div>

          <div className="divide-y rounded-xl border">
            {usersQuery.isLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-muted" />
            ) : rows.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {q ? "No match." : `No ${label} accounts yet.`}
              </p>
            ) : (
              rows.map((u) => (
                <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`lap-user-${u.id}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {u.name}
                      {!u.isActive && <Badge variant="outline" className="text-[10px] text-muted-foreground">Deactivated</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.email}
                      {u.loanOfficerId ? ` · ${loById.get(u.loanOfficerId) ?? `LO #${u.loanOfficerId}`}` : " · not linked to an LO"}
                    </p>
                  </div>
                  <Select
                    value={u.loanOfficerId ? String(u.loanOfficerId) : "none"}
                    onValueChange={(v) => relink.mutate({ id: u.id, loanOfficerId: v === "none" ? null : Number(v) })}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs" data-testid={`lap-user-lo-${u.id}`}>
                      <UserCog className="mr-1 h-3.5 w-3.5 shrink-0" />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not linked</SelectItem>
                      {los.map((lo) => <SelectItem key={lo.id} value={String(lo.id)}>{loName(lo)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs" onClick={() => setEditing(u)} data-testid={`lap-user-edit-${u.id}`}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs"
                      disabled={resend.isPending}
                      onClick={() => {
                        if (!window.confirm(`Send ${u.name} a new temporary password and sign-in link?`)) return;
                        resend.mutate(u.id);
                      }}
                      data-testid={`lap-user-resend-${u.id}`}
                    >
                      <Mail className="h-3.5 w-3.5" /> Resend
                    </Button>
                    <Button
                      size="sm" variant="ghost" className="h-8 gap-1 px-2 text-xs"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: u.id, isActive: !u.isActive })}
                      data-testid={`lap-user-active-${u.id}`}
                    >
                      {u.isActive ? <><Ban className="h-3.5 w-3.5" /> Disable</> : <><RotateCcw className="h-3.5 w-3.5" /> Enable</>}
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <UserDialog
        open={adding || !!editing}
        editUser={editing}
        product={product}
        los={los}
        onClose={() => { setAdding(false); setEditing(null); }}
      />
    </div>
  );
}

function UserDialog({
  open, editUser, product, los, onClose,
}: {
  open: boolean;
  editUser: PortalUser | null;
  product: "lap" | "lop";
  los: LoanOfficer[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const label = productLabel(product);
  const isEditing = !!editUser;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [lo, setLo] = useState("none");
  const [seeded, setSeeded] = useState<number | null>(null);

  // Seed the fields from whichever row was opened, without clobbering typing.
  const seedFor = editUser?.id ?? 0;
  if (open && seeded !== seedFor) {
    setSeeded(seedFor);
    setName(editUser?.name ?? "");
    setEmail(editUser?.email ?? "");
    setLo(editUser?.loanOfficerId ? String(editUser.loanOfficerId) : "none");
  }

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        name: name.trim(),
        email: email.trim(),
        loanOfficerId: lo === "none" ? null : Number(lo),
      };
      if (isEditing) return apiRequest("PATCH", `/api/users/${editUser!.id}`, body);
      return apiRequest("POST", "/api/users", { ...body, role: "assistant", portal: product, sendWelcome: true });
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({
        title: isEditing ? "Account updated" : `${label} login created`,
        description: isEditing
          ? undefined
          : res?.emailRequested === false
            ? "Welcome emails are switched off for this portal, so none was sent."
            : "The welcome email is queued and goes out shortly.",
      });
      onClose();
    },
    onError: (e: any) => toast({ title: isEditing ? "Could not update" : "Could not create the login", description: e?.message, variant: "destructive" }),
  });

  const canSave = name.trim().length >= 2 && emailValid(email) && !save.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{isEditing ? `Edit ${label} user` : `Add ${label} user`}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="lap-u-name">Full name</Label>
            <Input id="lap-u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" data-testid="lap-user-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lap-u-email">Email address</Label>
            <Input id="lap-u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" data-testid="lap-user-email" />
          </div>
          <div className="space-y-1.5">
            <Label>{product === "lop" ? "Which loan officer is this?" : "Assists which loan officer?"}</Label>
            <Select value={lo} onValueChange={setLo}>
              <SelectTrigger data-testid="lap-user-dialog-lo"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not linked yet</SelectItem>
                {los.map((o) => <SelectItem key={o.id} value={String(o.id)}>{loName(o)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {!isEditing && (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              They receive a {label}-branded welcome email with a sign-in link and set their own password on first login.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!canSave} onClick={() => save.mutate()} data-testid="lap-user-save">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : isEditing ? "Save" : "Create & invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
