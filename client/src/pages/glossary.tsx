import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BookOpen, Search, Plus, Pencil, Trash2 } from "lucide-react";
import { HelpIcon, PageTooltip, markStep } from "@/components/onboarding";

type GlossaryTerm = {
  id: number;
  org_id: number;
  term: string;
  definition: string;
  category: string | null;
};

const UNCATEGORIZED = "Uncategorized";
const NEW_CATEGORY_SENTINEL = "__new__";

function categoryColor(cat: string): string {
  // Deterministic color by category hash — keeps new categories visually stable.
  const palette = [
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
    "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200",
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
    "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  ];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = ((h << 5) - h + cat.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

export default function GlossaryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<GlossaryTerm | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<GlossaryTerm | null>(null);

  useEffect(() => { document.title = "Glossary · WCLCC"; }, []);
  useEffect(() => { markStep(user?.id, "read_glossary"); }, [user?.id]);

  const { data: terms = [], isLoading } = useQuery<GlossaryTerm[]>({
    queryKey: ["/api/glossary"],
  });

  const createMutation = useMutation({
    mutationFn: (data: { term: string; definition: string; category: string | null }) =>
      apiRequest("POST", "/api/glossary", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({ title: "Term added" });
      setAdding(false);
    },
    onError: (e: any) => toast({ title: "Failed to add term", description: e?.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { term: string; definition: string; category: string | null } }) =>
      apiRequest("PATCH", `/api/glossary/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({ title: "Term updated" });
      setEditing(null);
    },
    onError: (e: any) => toast({ title: "Failed to update term", description: e?.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/glossary/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({ title: "Term deleted" });
      setDeleting(null);
    },
    onError: (e: any) => toast({ title: "Failed to delete term", description: e?.message, variant: "destructive" }),
  });

  const q = query.trim().toLowerCase();
  const isSearching = q.length > 0;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of terms) set.add((t.category || UNCATEGORIZED).trim() || UNCATEGORIZED);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [terms]);

  const filtered = useMemo(() => {
    if (!isSearching) return terms;
    return terms.filter(t =>
      t.term.toLowerCase().includes(q) ||
      t.definition.toLowerCase().includes(q) ||
      (t.category ?? "").toLowerCase().includes(q)
    );
  }, [terms, q, isSearching]);

  const grouped = useMemo(() => {
    const map: Record<string, GlossaryTerm[]> = {};
    for (const t of filtered) {
      const cat = (t.category || UNCATEGORIZED).trim() || UNCATEGORIZED;
      (map[cat] ||= []).push(t);
    }
    for (const cat of Object.keys(map)) {
      map[cat].sort((a, b) => a.term.localeCompare(b.term, undefined, { sensitivity: "base" }));
    }
    return map;
  }, [filtered]);

  const groupedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  function toggleCategory(cat: string) {
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto w-full">
      <PageTooltip pageKey="glossary" title="Glossary">
        Definitions for mortgage and CLR industry terms.
      </PageTooltip>

      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 text-[#1A2B4A] dark:text-blue-100">
            Glossary
            <HelpIcon title="Glossary">Definitions for mortgage and CLR industry terms.</HelpIcon>
          </h1>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={() => setAdding(true)} className="gap-1.5" data-testid="glossary-add-term">
            <Plus className="w-4 h-4" /> Add Term
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        Mortgage and CLR Connection Center terminology. {isAdmin ? "Click the pencil or trash icons to manage terms." : ""}
      </p>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search terms, definitions, or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-9"
          data-testid="glossary-search"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : terms.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No glossary terms yet.{isAdmin && " Click \"Add Term\" to create the first one."}
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No terms match "{query}".
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {groupedCategories.map(cat => {
            const isCollapsed = !!collapsed[cat];
            const list = grouped[cat];
            return (
              <section key={cat} id={`cat-${slug(cat)}`} className="scroll-mt-4">
                <button
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center gap-2 mb-3 pb-2 border-b hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                  aria-expanded={!isCollapsed}
                >
                  <span className={`inline-block w-4 text-center text-muted-foreground text-xs`}>{isCollapsed ? "▶" : "▼"}</span>
                  <h2 className="text-lg font-bold text-[#1A2B4A] dark:text-blue-100">{cat}</h2>
                  <Badge variant="secondary" className={`${categoryColor(cat)} border-0 text-[10px]`}>
                    {list.length}
                  </Badge>
                </button>
                {!isCollapsed && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {list.map(t => (
                      <TermCard
                        key={t.id}
                        term={t}
                        isAdmin={isAdmin}
                        onEdit={() => setEditing(t)}
                        onDelete={() => setDeleting(t)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center mt-8">
        {filtered.length} of {terms.length} terms
      </p>

      {/* Add/Edit dialog */}
      {(adding || editing) && (
        <TermDialog
          initial={editing}
          categories={categories}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={(data) => {
            if (editing) updateMutation.mutate({ id: editing.id, data });
            else createMutation.mutate(data);
          }}
          saving={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.term}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the term from the glossary for everyone in your organization. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TermCard({
  term, isAdmin, onEdit, onDelete,
}: {
  term: GlossaryTerm;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const cat = (term.category || UNCATEGORIZED).trim() || UNCATEGORIZED;
  return (
    <Card
      id={`term-${slug(term.term)}`}
      className="hover:shadow-md transition-shadow"
      data-testid={`glossary-term-${term.term}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
          <h2 className="text-lg font-bold leading-tight text-[#1A2B4A] dark:text-blue-100">
            {term.term}
          </h2>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" className={`${categoryColor(cat)} border-0 text-[11px] font-medium`}>
              {cat}
            </Badge>
            {isAdmin && (
              <>
                <button
                  type="button"
                  onClick={onEdit}
                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Edit ${term.term}`}
                  data-testid={`glossary-edit-${term.term}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label={`Delete ${term.term}`}
                  data-testid={`glossary-delete-${term.term}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
          {term.definition}
        </p>
      </CardContent>
    </Card>
  );
}

function TermDialog({
  initial, categories, onClose, onSave, saving,
}: {
  initial: GlossaryTerm | null;
  categories: string[];
  onClose: () => void;
  onSave: (data: { term: string; definition: string; category: string | null }) => void;
  saving: boolean;
}) {
  const [term, setTerm] = useState(initial?.term ?? "");
  const [definition, setDefinition] = useState(initial?.definition ?? "");
  const initialCat = initial?.category ?? "";
  const [categorySelect, setCategorySelect] = useState<string>(
    initialCat && categories.includes(initialCat) ? initialCat
    : initialCat ? NEW_CATEGORY_SENTINEL
    : (categories[0] ?? NEW_CATEGORY_SENTINEL)
  );
  const [newCategory, setNewCategory] = useState(
    initialCat && !categories.includes(initialCat) ? initialCat : ""
  );

  function submit() {
    const t = term.trim();
    const d = definition.trim();
    if (!t || !d) return;
    const cat = categorySelect === NEW_CATEGORY_SENTINEL
      ? (newCategory.trim() || null)
      : categorySelect || null;
    onSave({ term: t, definition: d, category: cat });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Term" : "Add Term"}</DialogTitle>
          <DialogDescription>
            {initial ? "Update the term, definition, or category." : "Add a new glossary term for your organization."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="gloss-term">Term</Label>
            <Input
              id="gloss-term"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="e.g. APR"
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="gloss-def">Definition</Label>
            <Textarea
              id="gloss-def"
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="Clear, practical definition (2–4 sentences)."
              rows={5}
            />
          </div>
          <div className="space-y-1">
            <Label>Category</Label>
            <Select value={categorySelect} onValueChange={setCategorySelect}>
              <SelectTrigger>
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map(c => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
                <SelectItem value={NEW_CATEGORY_SENTINEL}>+ New category…</SelectItem>
              </SelectContent>
            </Select>
            {categorySelect === NEW_CATEGORY_SENTINEL && (
              <Input
                className="mt-2"
                placeholder="New category name"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
              />
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || !term.trim() || !definition.trim()}>
            {saving ? "Saving…" : (initial ? "Save Changes" : "Add Term")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
