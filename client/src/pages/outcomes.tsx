import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, Filter, ClipboardList, Pencil } from "lucide-react";

const OUTCOME_TYPES = [
  "transfer", "appointment", "fell_through",
  "no_answer", "callback_requested", "not_interested",
  "wrong_number", "other"
] as const;

const OUTCOME_LABELS: Record<string, string> = {
  transfer: "Transfer", appointment: "Appointment", fell_through: "Fell Through",
  not_interested: "Not Interested", wrong_number: "Wrong Number", other: "Other",
};

const OUTCOME_COLORS: Record<string, string> = {
  transfer: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  fell_through: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  no_answer: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  callback_requested: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  not_interested: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  wrong_number: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  other: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
};

const outcomeFormSchema = z.object({
  date: z.string().min(1, "Date required"),
  assistantId: z.coerce.number().min(1, "Select an assistant"),
  loId: z.coerce.number().min(1, "Select a loan officer"),
  outcomeType: z.enum(OUTCOME_TYPES),
  borrowerName: z.string().optional(),
  journeyId: z.string().optional(),
  notes: z.string().optional(),
  followUpDate: z.string().optional(),
});
type OutcomeFormValues = z.infer<typeof outcomeFormSchema>;

function OutcomeFormDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  users,
  los,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: OutcomeFormValues) => void;
  isPending: boolean;
  users: any[];
  los: any[];
}) {
  const form = useForm<OutcomeFormValues>({
    resolver: zodResolver(outcomeFormSchema),
    defaultValues: {
      date: new Date().toISOString().split("T")[0],
      assistantId: 1, // default to Ethan
      loId: 0,
      outcomeType: "transfer",
      borrowerName: "",
      journeyId: "",
      notes: "",
      followUpDate: "",
    },
  });

  const [bonzoLogged, setBonzoLogged] = useState(false);
  const watchedType = form.watch("outcomeType");
  const isTransfer = watchedType === "transfer";

  useEffect(() => {
    if (open) setBonzoLogged(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Outcome</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-outcome-date" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="outcomeType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Outcome</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="select-outcome-type"><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {OUTCOME_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{OUTCOME_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="assistantId" render={({ field }) => (
              <FormItem>
                <FormLabel>CLR Assistant</FormLabel>
                <Select value={String(field.value)} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-assistant"><SelectValue placeholder="Select assistant" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {users.map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="loId" render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Officer</FormLabel>
                <Select value={String(field.value || "")} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-lo"><SelectValue placeholder="Select LO" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {los.filter((lo: any) => lo.internalStatus === "active").map((lo: any) => (
                      <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="borrowerName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Borrower Name</FormLabel>
                  <FormControl><Input {...field} placeholder="Optional" data-testid="input-borrower-name" /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="journeyId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Journey ID</FormLabel>
                  <FormControl><Input {...field} placeholder="Optional" data-testid="input-journey-id" /></FormControl>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="followUpDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Follow-up Date (optional)</FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-appointment-date" /></FormControl>
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} rows={2} placeholder="Any notes…" data-testid="textarea-outcome-notes" /></FormControl>
              </FormItem>
            )} />
            {isTransfer && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                <Checkbox
                  id="bonzo-logged"
                  checked={bonzoLogged}
                  onCheckedChange={v => setBonzoLogged(v === true)}
                  data-testid="checkbox-bonzo-logged"
                />
                <label htmlFor="bonzo-logged" className="text-sm leading-snug cursor-pointer select-none">
                  I have recorded this transfer in Bonzo using the appropriate notation.
                </label>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={isPending || (isTransfer && !bonzoLogged)}
                data-testid="button-save-outcome"
              >
                {isPending ? "Saving…" : "Log Outcome"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

const editOutcomeSchema = z.object({
  outcomeType: z.enum(OUTCOME_TYPES),
  loId: z.coerce.number().min(1, "Select a loan officer"),
  borrowerName: z.string().optional(),
  followUpDate: z.string().optional(),
  notes: z.string().optional(),
});
type EditOutcomeValues = z.infer<typeof editOutcomeSchema>;

const FOLLOWUP_TYPES = new Set(["appointment", "callback_requested"]);

function EditOutcomeDialog({
  outcome,
  open,
  onClose,
  onSubmit,
  isPending,
  los,
}: {
  outcome: any | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (values: EditOutcomeValues) => void;
  isPending: boolean;
  los: any[];
}) {
  const form = useForm<EditOutcomeValues>({
    resolver: zodResolver(editOutcomeSchema),
    defaultValues: {
      outcomeType: "transfer",
      loId: 0,
      borrowerName: "",
      followUpDate: "",
      notes: "",
    },
  });

  const [bonzoLogged, setBonzoLogged] = useState(false);
  const watchedType = form.watch("outcomeType");
  const isTransfer = watchedType === "transfer";
  const showFollowUp = FOLLOWUP_TYPES.has(watchedType);

  useEffect(() => {
    if (open && outcome) {
      form.reset({
        outcomeType: outcome.outcomeType,
        loId: outcome.loId,
        borrowerName: outcome.borrowerName ?? "",
        followUpDate: outcome.followUpDate ?? "",
        notes: outcome.notes ?? "",
      });
      setBonzoLogged(false);
    }
  }, [open, outcome, form]);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Outcome</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="outcomeType" render={({ field }) => (
              <FormItem>
                <FormLabel>Outcome</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-edit-outcome-type"><SelectValue /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {OUTCOME_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{OUTCOME_LABELS[t] ?? t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="loId" render={({ field }) => (
              <FormItem>
                <FormLabel>Loan Officer</FormLabel>
                <Select value={String(field.value || "")} onValueChange={v => field.onChange(Number(v))}>
                  <FormControl>
                    <SelectTrigger data-testid="select-edit-lo"><SelectValue placeholder="Select LO" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {los.filter((lo: any) => lo.internalStatus === "active").map((lo: any) => (
                      <SelectItem key={lo.id} value={String(lo.id)}>{lo.fullName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="borrowerName" render={({ field }) => (
              <FormItem>
                <FormLabel>Borrower Name</FormLabel>
                <FormControl><Input {...field} placeholder="Optional" data-testid="input-edit-borrower-name" /></FormControl>
              </FormItem>
            )} />
            {showFollowUp && (
              <FormField control={form.control} name="followUpDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Follow-up Date</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-edit-followup-date" /></FormControl>
                </FormItem>
              )} />
            )}
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl><Textarea {...field} rows={2} placeholder="Any notes…" data-testid="textarea-edit-notes" /></FormControl>
              </FormItem>
            )} />
            {isTransfer && (
              <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
                <Checkbox
                  id="edit-bonzo-logged"
                  checked={bonzoLogged}
                  onCheckedChange={v => setBonzoLogged(v === true)}
                  data-testid="checkbox-edit-bonzo-logged"
                />
                <label htmlFor="edit-bonzo-logged" className="text-sm leading-snug cursor-pointer select-none">
                  I have recorded this transfer in Bonzo using the appropriate notation.
                </label>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button
                type="submit"
                disabled={isPending || (isTransfer && !bonzoLogged)}
                data-testid="button-save-edit-outcome"
              >
                {isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Outcomes() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterAssistant, setFilterAssistant] = useState("all");
  const [search, setSearch] = useState("");

  const { data: outcomes = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/outcomes"] });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: los = [] } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/outcomes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      setDialogOpen(false);
      toast({ title: "Outcome logged" });
    },
    onError: () => toast({ title: "Error logging outcome", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditOutcomeValues }) => {
      const payload: Record<string, unknown> = {
        outcomeType: data.outcomeType,
        loId: data.loId,
        borrowerName: data.borrowerName ?? "",
        notes: data.notes ?? "",
        followUpDate: FOLLOWUP_TYPES.has(data.outcomeType) ? (data.followUpDate || null) : null,
      };
      return apiRequest("PATCH", `/api/outcomes/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      setEditTarget(null);
      toast({ title: "Outcome updated" });
    },
    onError: () => toast({ title: "Error updating outcome", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/outcomes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      toast({ title: "Outcome deleted" });
    },
    onError: () => toast({ title: "Error deleting outcome", variant: "destructive" }),
  });

  const filtered = outcomes.filter((o: any) => {
    const matchType = filterType === "all" || o.outcomeType === filterType;
    const matchAssistant = filterAssistant === "all" || String(o.assistantId) === filterAssistant;
    const matchSearch = !search || (o.borrowerName?.toLowerCase().includes(search.toLowerCase())) || o.lo?.fullName?.toLowerCase().includes(search.toLowerCase());
    return matchType && matchAssistant && matchSearch;
  });

  // Quick-count summary
  const countByType: Record<string, number> = {};
  filtered.forEach((o: any) => { countByType[o.outcomeType] = (countByType[o.outcomeType] || 0) + 1; });

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Lead Outcomes</h1>
          <p className="text-sm text-muted-foreground">{outcomes.length} outcomes logged</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} data-testid="button-log-outcome">
          <Plus className="w-4 h-4 mr-2" />Log Outcome
        </Button>
      </div>

      {/* Summary badges */}
      {filtered.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {Object.entries(countByType).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
            <button
              key={type}
              onClick={() => setFilterType(filterType === type ? "all" : type)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${filterType === type ? "border-primary bg-primary/10 text-primary" : "border-border"} ${OUTCOME_COLORS[type]}`}
              data-testid={`badge-outcome-${type}`}
            >
              {OUTCOME_LABELS[type]}: {count}
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            className="pl-9"
            placeholder="Search borrower or LO…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="input-search-outcomes"
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-44" data-testid="select-filter-type">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Outcomes</SelectItem>
            {OUTCOME_TYPES.map(t => (
              <SelectItem key={t} value={t}>{OUTCOME_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterAssistant} onValueChange={setFilterAssistant}>
          <SelectTrigger className="w-40" data-testid="select-filter-assistant">
            <SelectValue placeholder="All assistants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Assistants</SelectItem>
            {users.map((u: any) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(search || filterType !== "all" || filterAssistant !== "all") && (
          <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setFilterType("all"); setFilterAssistant("all"); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center">
          <ClipboardList className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {outcomes.length === 0 ? "No outcomes logged yet. Click \"Log Outcome\" to start." : "No results match your filters."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            {/* Table header */}
            <div className="hidden md:grid grid-cols-[80px_1fr_1fr_1fr_120px_80px] gap-3 px-4 py-2 border-b bg-muted/50 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              <span>Date</span><span>Outcome</span><span>LO</span><span>Assistant</span><span>Borrower</span><span></span>
            </div>
            {filtered.slice().reverse().map((o: any) => (
              <div
                key={o.id}
                className="grid grid-cols-1 md:grid-cols-[80px_1fr_1fr_1fr_120px_80px] gap-3 px-4 py-3 border-b last:border-0 hover:bg-muted/20 transition-colors items-center group"
                data-testid={`row-outcome-${o.id}`}
              >
                <span className="text-xs text-muted-foreground font-mono">{o.date}</span>
                <Badge className={`text-xs w-fit px-2 py-0.5 ${OUTCOME_COLORS[o.outcomeType]}`}>
                  {OUTCOME_LABELS[o.outcomeType]}
                </Badge>
                <span className="text-sm font-medium truncate" data-testid={`text-outcome-lo-${o.id}`}>
                  {o.lo?.fullName ?? `LO #${o.loId}`}
                </span>
                <span className="text-sm text-muted-foreground truncate">
                  {o.assistant?.name ?? `Assistant #${o.assistantId}`}
                </span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm text-muted-foreground truncate min-w-0 flex-1">
                    {o.borrowerName || <span className="text-muted-foreground/50">—</span>}
                  </span>
                </div>
                <div className="flex items-center gap-1 justify-end min-w-0">
                  {o.followUpDate && (
                    <Badge variant="outline" className="shrink-0 text-[10px] px-1 py-0 text-purple-600 border-purple-300">
                      Follow-up {o.followUpDate}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
                    onClick={() => setEditTarget(o)}
                    data-testid={`button-edit-outcome-${o.id}`}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                    onClick={() => deleteMutation.mutate(o.id)}
                    data-testid={`button-delete-outcome-${o.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {filtered.length > 0 && (
        <p className="text-xs text-muted-foreground text-right">
          Showing {filtered.length} of {outcomes.length} outcomes
        </p>
      )}

      <OutcomeFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={values => createMutation.mutate(values)}
        isPending={createMutation.isPending}
        users={users}
        los={los}
      />

      <EditOutcomeDialog
        outcome={editTarget}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={values => editTarget && updateMutation.mutate({ id: editTarget.id, data: values })}
        isPending={updateMutation.isPending}
        los={los}
      />
    </div>
  );
}
