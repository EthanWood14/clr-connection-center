import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Building2, Plus, Shield, ExternalLink, Pause, Copy, AlertTriangle } from "lucide-react";

interface Org {
  id: number;
  name: string;
  slug: string;
  company_name: string;
  plan: string;
  logo_url: string | null;
  user_count: number;
  clr_count: number;
  created_at: string;
}

export default function SuperAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [createResult, setCreateResult] = useState<{
    adminEmail: string; tempPassword: string; name: string;
  } | null>(null);

  const { data: orgs = [], isLoading } = useQuery<Org[]>({
    queryKey: ["/api/super-admin/orgs"],
    enabled: !!user?.superAdmin,
  });

  const impersonate = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/super-admin/orgs/${id}/impersonate`),
    onSuccess: async (data: any) => {
      toast({ title: "Impersonating", description: `Now viewing ${data.orgName}` });
      await queryClient.invalidateQueries();
      window.location.hash = "#/";
      window.location.reload();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const suspend = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/super-admin/orgs/${id}/suspend`),
    onSuccess: () => {
      toast({ title: "Suspended", description: "Organization suspended" });
      queryClient.invalidateQueries({ queryKey: ["/api/super-admin/orgs"] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (!user?.superAdmin) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Shield className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>This page is only accessible to super administrators.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="w-6 h-6" /> Super Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage all organizations on CLR Connection Center
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="button-create-org">
          <Plus className="w-4 h-4 mr-2" /> Create Org
        </Button>
      </div>

      <div
        role="alert"
        className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-600/60 dark:bg-amber-950/40 dark:text-amber-200"
        data-testid="banner-sa-warning"
      >
        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="font-semibold">Not fully tested — proceed with caution.</div>
          <div>Actions taken here affect all organizations and cannot be undone.</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="w-5 h-5" /> Organizations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 text-xs text-muted-foreground px-3 py-2 border-b font-medium">
                <div className="col-span-4">Name</div>
                <div className="col-span-2">Plan</div>
                <div className="col-span-1 text-right">Users</div>
                <div className="col-span-1 text-right">CLRs</div>
                <div className="col-span-2">Created</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              {orgs.map(o => (
                <div key={o.id} className="grid grid-cols-12 items-center px-3 py-3 rounded-md border hover:bg-accent/30 text-sm">
                  <div className="col-span-4">
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-muted-foreground">{o.slug}</div>
                  </div>
                  <div className="col-span-2">
                    <Badge variant={o.plan === "active" ? "default" : o.plan === "suspended" ? "destructive" : "secondary"}>
                      {o.plan}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-right">{o.user_count}</div>
                  <div className="col-span-1 text-right">{o.clr_count}</div>
                  <div className="col-span-2 text-xs">{o.created_at?.slice(0, 10)}</div>
                  <div className="col-span-2 text-right flex gap-2 justify-end">
                    <Button size="sm" variant="outline"
                      onClick={() => impersonate.mutate(o.id)}
                      data-testid={`button-impersonate-${o.id}`}>
                      <ExternalLink className="w-3 h-3 mr-1" /> Impersonate
                    </Button>
                    {o.plan !== "suspended" && (
                      <Button size="sm" variant="ghost"
                        onClick={() => { if (confirm(`Suspend ${o.name}?`)) suspend.mutate(o.id); }}
                        data-testid={`button-suspend-${o.id}`}>
                        <Pause className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateOrgDialog open={createOpen} onOpenChange={setCreateOpen}
        onCreated={(r) => { setCreateResult(r); queryClient.invalidateQueries({ queryKey: ["/api/super-admin/orgs"] }); }}
      />

      <Dialog open={!!createResult} onOpenChange={(v) => !v && setCreateResult(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Organization Created</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p><strong>{createResult?.name}</strong> is ready.</p>
            <p>First admin login:</p>
            <div className="rounded-md border bg-muted/40 p-3 space-y-1 font-mono text-xs">
              <div>Email: {createResult?.adminEmail}</div>
              <div>Temp password: {createResult?.tempPassword}</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Copy this password now — it will not be shown again. The admin will be required to change it on first login.
            </p>
            <Button variant="outline" size="sm"
              onClick={() => {
                navigator.clipboard.writeText(`${createResult?.adminEmail} / ${createResult?.tempPassword}`);
                toast({ title: "Copied", description: "Credentials copied to clipboard" });
              }}>
              <Copy className="w-4 h-4 mr-2" /> Copy Credentials
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreateResult(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateOrgDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (r: { adminEmail: string; tempPassword: string; name: string }) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");

  const create = useMutation({
    mutationFn: () => apiRequest("POST", "/api/super-admin/orgs", {
      name, companyName: companyName || name, adminName, adminEmail,
    }),
    onSuccess: (data: any) => {
      onOpenChange(false);
      onCreated({ adminEmail: data.adminEmail, tempPassword: data.tempPassword, name: data.name });
      setName(""); setCompanyName(""); setAdminName(""); setAdminEmail("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Organization</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Organization Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Mortgage" data-testid="input-org-name" />
          </div>
          <div>
            <Label>Company Name (shown in app)</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Mortgage" data-testid="input-company-name" />
          </div>
          <div>
            <Label>Admin Name</Label>
            <Input value={adminName} onChange={(e) => setAdminName(e.target.value)} data-testid="input-admin-name" />
          </div>
          <div>
            <Label>Admin Email</Label>
            <Input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} data-testid="input-admin-email" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!name || !adminName || !adminEmail || create.isPending}
            data-testid="button-submit-create-org">
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
