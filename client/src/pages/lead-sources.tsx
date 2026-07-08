import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ListFilter, Plus, Pencil, Trash2, Users } from "lucide-react";

type LeadSource = { id: number; name: string; notes: string; weight: number; loCount: number };

export default function LeadSources() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = !!(user && (user.role === "admin" || (user as any).superAdmin));

  const { data: sources = [], isLoading } = useQuery<LeadSource[]>({ queryKey: ["/api/lead-sources"] });

  const [editTarget, setEditTarget] = useState<LeadSource | "new" | null>(null);
  const [fName, setFName] = useState("");
  const [fNotes, setFNotes] = useState("");
  const [fWeight, setFWeight] = useState("1");
  const [deleteTarget, setDeleteTarget] = useState<LeadSource | null>(null);

  function openNew() { setEditTarget("new"); setFName(""); setFNotes(""); setFWeight("1"); }
  function openEdit(s: LeadSource) { setEditTarget(s); setFName(s.name); setFNotes(s.notes ?? ""); setFWeight(String(s.weight ?? 1)); }
  function refresh() { queryClient.invalidateQueries({ queryKey: ["/api/lead-sources"] }); }

  const saveMut = useMutation({
    mutationFn: () => {
      const body = { name: fName.trim(), notes: fNotes, weight: Math.max(1, parseInt(fWeight) || 1) };
      return editTarget === "new"
        ? apiRequest("POST", "/api/lead-sources", body)
        : apiRequest("PATCH", `/api/lead-sources/${(editTarget as LeadSource).id}`, body);
    },
    onSuccess: () => { toast({ title: "Source saved" }); setEditTarget(null); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/lead-sources/${id}`),
    onSuccess: () => { toast({ title: "Source deleted", description: "Its LOs moved back to General." }); setDeleteTarget(null); refresh(); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e?.message, variant: "destructive" }),
  });

  const totalWeight = sources.reduce((s, x) => s + Math.max(1, x.weight || 1), 0) + 1; // +1 for General

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><ListFilter className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <ListFilter className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Lead Sources</h1>
            <p className="text-sm text-white/60">
              Group LOs by where they came from. Weight controls each source's share of daily assignments; notes show on every assignment card.
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Assign an LO to a source from its edit dialog in the LO Directory. Unassigned LOs form the built-in <strong>General</strong> bucket (weight 1).
        </p>
        {isAdmin && (
          <Button size="sm" className="gap-1.5 shrink-0" onClick={openNew} data-testid="add-lead-source">
            <Plus className="w-3.5 h-3.5" /> Add source
          </Button>
        )}
      </div>

      {/* Sources */}
      <Card>
        <CardContent className="p-0 divide-y">
          {isLoading ? (
            <div className="p-4 space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : sources.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No sources yet. Add one, then set it on LOs in the Directory — their assignments will show the source and its notes.
            </p>
          ) : (
            sources.map((s) => (
              <div key={s.id} className="flex items-start gap-3 px-4 py-3" data-testid={`lead-source-row-${s.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <Badge variant="outline" className="gap-1 font-normal text-[11px]">
                      <Users className="w-3 h-3" /> {s.loCount} LO{s.loCount === 1 ? "" : "s"}
                    </Badge>
                    <Badge variant="outline" className="font-normal text-[11px]">
                      weight {s.weight} · ~{Math.round((Math.max(1, s.weight || 1) / totalWeight) * 100)}% of daily lists
                    </Badge>
                  </div>
                  {s.notes && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.notes}</p>}
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="p-1.5 rounded hover:bg-muted text-muted-foreground" title="Edit" onClick={() => openEdit(s)} data-testid={`edit-source-${s.id}`}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="Delete" onClick={() => setDeleteTarget(s)} data-testid={`delete-source-${s.id}`}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Add / edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={o => { if (!o) setEditTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editTarget === "new" ? "Add lead source" : "Edit lead source"}</DialogTitle>
            <DialogDescription>
              Weight is relative: a source with weight 2 gets twice the daily-assignment share of a weight-1 source.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <Input value={fName} onChange={e => setFName(e.target.value)} maxLength={80} placeholder="e.g. NMLS List, Referrals…" data-testid="source-name" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Weight</label>
              <Input type="number" min={1} max={100} value={fWeight} onChange={e => setFWeight(e.target.value)} data-testid="source-weight" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Notes <span className="font-normal">(shown on each assignment from this source)</span></label>
              <Textarea value={fNotes} onChange={e => setFNotes(e.target.value)} rows={3} maxLength={1000} placeholder="Calling context for this list…" data-testid="source-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setEditTarget(null)} disabled={saveMut.isPending}>Cancel</Button>
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={!fName.trim() || saveMut.isPending} data-testid="source-save">
              {saveMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={o => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.loCount ? `Its ${deleteTarget.loCount} LO${deleteTarget.loCount === 1 ? "" : "s"} move back to the General bucket. ` : ""}
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
