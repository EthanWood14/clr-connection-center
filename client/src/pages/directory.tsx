import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Plus, Copy, Eye, EyeOff, Edit2, Trash2,
  ChevronDown, ChevronUp, Star, BedDouble, AlertCircle, CalendarDays
} from "lucide-react";
import { LoAvailabilityEditor } from "@/components/lo-availability-editor";
import { Separator } from "@/components/ui/separator";

const TIER_LABELS: Record<number, string> = { 1: "VIP", 2: "Standard", 3: "Low" };
const TIER_COLORS: Record<number, string> = {
  1: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  2: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  3: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
};
const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  inactive: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  archived: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

const loFormSchema = z.object({
  fullName: z.string().min(2, "Name required"),
  nmlsId: z.string().min(1, "NMLS ID required"),
  phone: z.string().optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  licensedStates: z.string().optional(),
  bonzoUsername: z.string().optional(),
  bonzoPassword: z.string().optional(),
  leadMailboxUsername: z.string().optional(),
  leadMailboxPassword: z.string().optional(),
  notes: z.string().optional(),
  specialRequests: z.string().optional(),
  boostScore: z.coerce.number().min(0).max(10).default(0),
  priorityTier: z.coerce.number().min(1).max(3).default(2),
  internalStatus: z.string().default("active"),
  snoozeUntil: z.string().optional(),
  snoozeReason: z.string().optional(),
});
type LoFormValues = z.infer<typeof loFormSchema>;

function CopyButton({ value, label }: { value: string; label: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      toast({ title: `${label} copied` });
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
      title={`Copy ${label}`}
      data-testid={`button-copy-${label.toLowerCase().replace(/ /g, "-")}`}
    >
      <Copy className="w-3 h-3" />
    </button>
  );
}

function CredentialRow({ label, username, password }: { label: string; username?: string | null; password?: string | null }) {
  const [showPass, setShowPass] = useState(false);
  if (!username && !password) return null;
  return (
    <div className="text-xs space-y-0.5">
      <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px]">{label}</div>
      {username && (
        <div className="flex items-center gap-1">
          <span className="text-foreground font-mono">{username}</span>
          <CopyButton value={username} label={`${label} username`} />
        </div>
      )}
      {password && (
        <div className="flex items-center gap-1">
          <span className="text-foreground font-mono">{showPass ? password : "••••••••"}</span>
          <button
            onClick={() => setShowPass(s => !s)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            data-testid={`button-toggle-${label.toLowerCase().replace(/ /g, "-")}-password`}
          >
            {showPass ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </button>
          {showPass && <CopyButton value={password} label={`${label} password`} />}
        </div>
      )}
    </div>
  );
}

function LOCard({ lo, onEdit, onDelete }: { lo: any; onEdit: (lo: any) => void; onDelete: (id: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const states: string[] = (() => { try { return JSON.parse(lo.licensedStates || "[]"); } catch { return []; } })();

  const daysSince = lo.lastWorkedDate
    ? Math.floor((Date.now() - new Date(lo.lastWorkedDate).getTime()) / 86400000)
    : null;

  return (
    <Card className="overflow-hidden" data-testid={`card-lo-${lo.id}`}>
      <CardContent className="p-0">
        {/* Main row */}
        <div className="p-4 flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-sm font-semibold text-primary">
            {lo.fullName.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm" data-testid={`text-lo-name-${lo.id}`}>{lo.fullName}</span>
              <Badge className={`text-xs px-1.5 py-0 ${TIER_COLORS[lo.priorityTier]}`}>{TIER_LABELS[lo.priorityTier]}</Badge>
              <Badge className={`text-xs px-1.5 py-0 ${STATUS_COLORS[lo.internalStatus]}`}>{lo.internalStatus}</Badge>
              {lo.snoozeUntil && new Date(lo.snoozeUntil) > new Date() && (
                <Badge variant="outline" className="text-xs px-1.5 py-0 text-orange-600 border-orange-300">
                  <BedDouble className="w-3 h-3 mr-1" />Snoozed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
              <span>NMLS: <span className="font-mono text-foreground">{lo.nmlsId}</span></span>
              {lo.phone && <span>{lo.phone}</span>}
              {lo.email && <span className="truncate max-w-[180px]">{lo.email}</span>}
              {daysSince !== null && (
                <span className={daysSince > 14 ? "text-orange-500" : ""}>
                  Last worked: {daysSince}d ago
                </span>
              )}
            </div>
            {states.length > 0 && (
              <div className="flex gap-1 flex-wrap mt-1.5">
                {states.slice(0, 8).map((s: string) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">{s}</span>
                ))}
                {states.length > 8 && <span className="text-[10px] text-muted-foreground">+{states.length - 8}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Boost score */}
            <div className="flex items-center gap-0.5 text-xs text-muted-foreground mr-1">
              <Star className="w-3 h-3 text-yellow-400" />
              <span>{lo.boostScore.toFixed(1)}</span>
            </div>
            <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => onEdit(lo)} data-testid={`button-edit-lo-${lo.id}`}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="w-7 h-7 hover:text-destructive" onClick={() => onDelete(lo.id)} data-testid={`button-delete-lo-${lo.id}`}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="w-7 h-7" onClick={() => setExpanded(e => !e)} data-testid={`button-expand-lo-${lo.id}`}>
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* Expanded credentials */}
        {expanded && (
          <div className="px-4 pb-4 pt-0 border-t bg-muted/30">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-3">
              <CredentialRow label="Bonzo" username={lo.bonzoUsername} password={lo.bonzoPassword} />
              <CredentialRow label="Lead Mailbox" username={lo.leadMailboxUsername} password={lo.leadMailboxPassword} />
              {lo.notes && (
                <div className="text-xs">
                  <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-0.5">Notes</div>
                  <p className="text-foreground">{lo.notes}</p>
                </div>
              )}
              {lo.specialRequests && (
                <div className="text-xs">
                  <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-0.5">Special Requests</div>
                  <p className="text-foreground flex items-start gap-1">
                    <AlertCircle className="w-3 h-3 text-orange-500 mt-0.5 flex-shrink-0" />{lo.specialRequests}
                  </p>
                </div>
              )}
              {lo.snoozeUntil && (
                <div className="text-xs">
                  <div className="font-semibold text-muted-foreground uppercase tracking-wide text-[10px] mb-0.5">Snoozed Until</div>
                  <p className="text-foreground">{lo.snoozeUntil}{lo.snoozeReason ? ` — ${lo.snoozeReason}` : ""}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LOFormDialog({
  open,
  onClose,
  initialValues,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  initialValues?: Partial<LoFormValues> | null;
  onSubmit: (values: LoFormValues) => void;
  isPending: boolean;
}) {
  const form = useForm<LoFormValues>({
    resolver: zodResolver(loFormSchema),
    defaultValues: {
      fullName: initialValues?.fullName ?? "",
      nmlsId: initialValues?.nmlsId ?? "",
      phone: initialValues?.phone ?? "",
      email: initialValues?.email ?? "",
      licensedStates: Array.isArray(initialValues?.licensedStates)
        ? (initialValues.licensedStates as unknown as string[]).join(", ")
        : typeof initialValues?.licensedStates === "string"
        ? (() => { try { const p = JSON.parse(initialValues.licensedStates as string); return Array.isArray(p) ? p.join(", ") : initialValues.licensedStates as string; } catch { return initialValues.licensedStates as string ?? ""; } })()
        : "",
      bonzoUsername: initialValues?.bonzoUsername ?? "",
      bonzoPassword: initialValues?.bonzoPassword ?? "",
      leadMailboxUsername: initialValues?.leadMailboxUsername ?? "",
      leadMailboxPassword: initialValues?.leadMailboxPassword ?? "",
      notes: initialValues?.notes ?? "",
      specialRequests: initialValues?.specialRequests ?? "",
      boostScore: initialValues?.boostScore ?? 0,
      priorityTier: initialValues?.priorityTier ?? 2,
      internalStatus: initialValues?.internalStatus ?? "active",
      snoozeUntil: initialValues?.snoozeUntil ?? "",
      snoozeReason: initialValues?.snoozeReason ?? "",
    },
  });

  const handleSubmit = (values: LoFormValues) => {
    // Convert licensedStates string to JSON array
    const states = values.licensedStates
      ? values.licensedStates.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
      : [];
    onSubmit({ ...values, licensedStates: JSON.stringify(states) as unknown as string });
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initialValues ? "Edit Loan Officer" : "Add Loan Officer"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-lo-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="nmlsId" render={({ field }) => (
                <FormItem>
                  <FormLabel>NMLS ID</FormLabel>
                  <FormControl><Input {...field} data-testid="input-lo-nmls" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input {...field} data-testid="input-lo-phone" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} data-testid="input-lo-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="licensedStates" render={({ field }) => (
              <FormItem>
                <FormLabel>Licensed States (comma-separated, e.g. CA, TX, FL)</FormLabel>
                <FormControl><Input {...field} placeholder="CA, TX, FL, NY" data-testid="input-lo-states" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bonzo Credentials</div>
                <FormField control={form.control} name="bonzoUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Username</FormLabel>
                    <FormControl><Input {...field} data-testid="input-bonzo-username" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="bonzoPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Password</FormLabel>
                    <FormControl><Input type="text" {...field} data-testid="input-bonzo-password" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <div className="space-y-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lead Mailbox Credentials</div>
                <FormField control={form.control} name="leadMailboxUsername" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Username</FormLabel>
                    <FormControl><Input {...field} data-testid="input-mailbox-username" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="leadMailboxPassword" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Password</FormLabel>
                    <FormControl><Input type="text" {...field} data-testid="input-mailbox-password" /></FormControl>
                  </FormItem>
                )} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <FormField control={form.control} name="priorityTier" render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority Tier</FormLabel>
                  <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
                    <FormControl><SelectTrigger data-testid="select-priority-tier"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="1">Tier 1 — VIP</SelectItem>
                      <SelectItem value="2">Tier 2 — Standard</SelectItem>
                      <SelectItem value="3">Tier 3 — Low</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="boostScore" render={({ field }) => (
                <FormItem>
                  <FormLabel>Boost Score (0–10)</FormLabel>
                  <FormControl><Input type="number" min={0} max={10} step={0.5} {...field} data-testid="input-boost-score" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="internalStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger data-testid="select-status"><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="snoozeUntil" render={({ field }) => (
                <FormItem>
                  <FormLabel>Snooze Until (date)</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-snooze-until" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="snoozeReason" render={({ field }) => (
                <FormItem>
                  <FormLabel>Snooze Reason</FormLabel>
                  <FormControl><Input {...field} placeholder="On vacation, etc." data-testid="input-snooze-reason" /></FormControl>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} rows={2} data-testid="textarea-notes" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="specialRequests" render={({ field }) => (
              <FormItem>
                <FormLabel>Special Requests / Preferences</FormLabel>
                <FormControl><Textarea {...field} rows={2} data-testid="textarea-special-requests" /></FormControl>
              </FormItem>
            )} />
            {/* Availability section — only shown when editing an existing LO */}
            {initialValues && (initialValues as any).id && (
              <>
                <Separator />
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Weekly Availability</span>
                  </div>
                  <LoAvailabilityEditor
                    loId={(initialValues as any).id}
                    loName={(initialValues as any).fullName ?? ""}
                  />
                </div>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-lo">
                {isPending ? "Saving…" : "Save LO"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Directory() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);

  const { data: los = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/loan-officers", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setDialogOpen(false);
      toast({ title: "Loan officer added" });
    },
    onError: () => toast({ title: "Error saving LO", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/loan-officers/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      setDialogOpen(false);
      setEditTarget(null);
      toast({ title: "Loan officer updated" });
    },
    onError: () => toast({ title: "Error updating LO", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/loan-officers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/loan-officers"] });
      toast({ title: "Loan officer removed" });
    },
    onError: () => toast({ title: "Error deleting LO", variant: "destructive" }),
  });

  const filtered = los.filter((lo: any) => {
    const matchSearch = !search || lo.fullName.toLowerCase().includes(search.toLowerCase()) || lo.nmlsId.includes(search);
    const matchStatus = statusFilter === "all" || lo.internalStatus === statusFilter;
    const matchTier = tierFilter === "all" || String(lo.priorityTier) === tierFilter;
    return matchSearch && matchStatus && matchTier;
  });

  const handleEdit = (lo: any) => {
    setEditTarget(lo);
    setDialogOpen(true);
  };

  const handleSubmit = (values: any) => {
    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">LO Directory</h1>
          <p className="text-sm text-muted-foreground">{los.length} loan officers total</p>
        </div>
        <Button onClick={() => { setEditTarget(null); setDialogOpen(true); }} data-testid="button-add-lo">
          <Plus className="w-4 h-4 mr-2" />Add LO
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search by name or NMLS ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-lo"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-testid="select-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-36" data-testid="select-filter-tier">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="1">Tier 1 — VIP</SelectItem>
            <SelectItem value="2">Tier 2 — Standard</SelectItem>
            <SelectItem value="3">Tier 3 — Low</SelectItem>
          </SelectContent>
        </Select>
        {(search || statusFilter !== "all" || tierFilter !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatusFilter("all"); setTierFilter("all"); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Results count */}
      {(search || statusFilter !== "all" || tierFilter !== "all") && (
        <p className="text-sm text-muted-foreground">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</p>
      )}

      {/* LO List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm">
          {search ? "No loan officers match your search." : "No loan officers yet. Click \"Add LO\" to get started."}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((lo: any) => (
            <LOCard key={lo.id} lo={lo} onEdit={handleEdit} onDelete={id => deleteMutation.mutate(id)} />
          ))}
        </div>
      )}

      <LOFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditTarget(null); }}
        initialValues={editTarget}
        onSubmit={handleSubmit}
        isPending={isPending}
      />
    </div>
  );
}
