import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  PhoneCall, ArrowLeft, RotateCcw, Copy, Check, ChevronRight, Sparkles,
  Wrench, Plus, Trash2, Pencil, Construction,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScriptResponse {
  id: number;
  node_id: number;
  label: string;
  color: string;
  next_node_id: number | null;
  response_order: number;
}

interface ScriptNode {
  id: number;
  script_id: number;
  text: string;
  hint?: string | null;
  responses: ScriptResponse[];
}

interface CallScript {
  id: number;
  name: string;
  description?: string;
  is_active: number;
}

// ─── Color maps ───────────────────────────────────────────────────────────────

const BUBBLE_COLORS: Record<string, string> = {
  green:   "bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600",
  red:     "bg-rose-500 hover:bg-rose-600 text-white border-rose-600",
  yellow:  "bg-amber-400 hover:bg-amber-500 text-amber-950 border-amber-500",
  blue:    "bg-blue-500 hover:bg-blue-600 text-white border-blue-600",
  gray:    "bg-zinc-400 hover:bg-zinc-500 text-white border-zinc-500",
  default: "bg-primary hover:bg-primary/90 text-primary-foreground border-primary",
};

const BUBBLE_NUMBERS: Record<number, string> = {
  1: "bg-white/25 text-white",
  2: "bg-white/25 text-white",
  3: "bg-white/25 text-white",
  4: "bg-white/25 text-white",
};

// ─── Transfer Win State ───────────────────────────────────────────────────────

function TransferWin({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="text-7xl">🎉</div>
      <div>
        <h2 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">Transfer Complete!</h2>
        <p className="text-muted-foreground mt-2 text-sm">Great work — log this transfer in Bonzo with proper notation.</p>
      </div>
      <Button onClick={onReset} className="gap-2 mt-2">
        <RotateCcw className="w-4 h-4" /> Start New Call
      </Button>
    </div>
  );
}

// ─── End State (no next node) ─────────────────────────────────────────────────

function EndState({ isTransfer, onReset }: { isTransfer: boolean; onReset: () => void }) {
  if (isTransfer) return <TransferWin onReset={onReset} />;
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="text-5xl">📋</div>
      <div>
        <h2 className="text-xl font-semibold">End of script</h2>
        <p className="text-muted-foreground mt-1 text-sm">Log your outcome in Call Reports when ready.</p>
      </div>
      <Button variant="outline" onClick={onReset} className="gap-2 mt-2">
        <RotateCcw className="w-4 h-4" /> Start Over
      </Button>
    </div>
  );
}

// ─── Script Runner ────────────────────────────────────────────────────────────

function ScriptRunner({ scriptId }: { scriptId: number }) {
  const [currentNode, setCurrentNode] = useState<ScriptNode | null>(null);
  const [history, setHistory] = useState<ScriptNode[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [wasTransfer, setWasTransfer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [animKey, setAnimKey] = useState(0);

  // Load root node
  const { data: rootNode, isLoading } = useQuery<ScriptNode>({
    queryKey: [`/api/call-scripts/${scriptId}/root`],
  });

  useEffect(() => {
    if (rootNode) {
      setCurrentNode(rootNode);
      setHistory([]);
      setEnded(false);
      setSelectedLabel(null);
      setAnimKey(k => k + 1);
    }
  }, [rootNode]);

  const fetchNode = useCallback(async (nodeId: number): Promise<ScriptNode> => {
    const res = await fetch(`/api/call-scripts/${scriptId}/node/${nodeId}`, { credentials: "include" });
    return res.json();
  }, [scriptId]);

  const handleResponse = async (resp: ScriptResponse) => {
    if (!currentNode) return;
    setSelectedLabel(resp.label);

    await new Promise(r => setTimeout(r, 350));

    if (!resp.next_node_id) {
      setEnded(true);
      setWasTransfer(resp.label.toLowerCase().includes("transfer"));
      return;
    }
    const next = await fetchNode(resp.next_node_id);
    setHistory(h => [...h, currentNode]);
    setCurrentNode(next);
    setSelectedLabel(null);
    setAnimKey(k => k + 1);
  };

  const handleBack = async () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    // reload with fresh responses
    const fresh = await fetchNode(prev.id);
    setCurrentNode(fresh);
    setHistory(h => h.slice(0, -1));
    setEnded(false);
    setSelectedLabel(null);
    setAnimKey(k => k + 1);
  };

  const handleReset = async () => {
    if (!rootNode) return;
    const fresh = await fetchNode(rootNode.id);
    setCurrentNode(fresh);
    setHistory([]);
    setEnded(false);
    setSelectedLabel(null);
    setAnimKey(k => k + 1);
  };

  const handleCopy = () => {
    if (!currentNode) return;
    navigator.clipboard.writeText(currentNode.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Keyboard shortcut 1–4
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (ended || !currentNode || selectedLabel) return;
      const n = parseInt(e.key);
      if (n >= 1 && n <= currentNode.responses.length) {
        handleResponse(currentNode.responses[n - 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentNode, ended, selectedLabel]);

  if (isLoading || !currentNode) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full rounded-2xl" />
        <div className="flex gap-3"><Skeleton className="h-12 flex-1 rounded-full" /><Skeleton className="h-12 flex-1 rounded-full" /></div>
      </div>
    );
  }

  if (ended) return <EndState isTransfer={wasTransfer} onReset={handleReset} />;

  return (
    <div className="space-y-6">
      {/* Breadcrumb trail */}
      {history.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
          {history.map((h, i) => (
            <span key={h.id} className="flex items-center gap-1">
              <span className="truncate max-w-[120px]">{h.text.slice(0, 40)}…</span>
              {i < history.length - 1 && <ChevronRight className="w-3 h-3 shrink-0" />}
            </span>
          ))}
          <ChevronRight className="w-3 h-3 shrink-0" />
          <span className="text-foreground font-medium truncate max-w-[120px]">You are here</span>
        </div>
      )}

      {/* Script card */}
      <div
        key={animKey}
        className="animate-in fade-in slide-in-from-bottom-4 duration-400"
      >
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-background to-primary/5 shadow-lg">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2">
                  <PhoneCall className="w-4 h-4 text-primary" />
                </div>
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">What to say</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>

            <p className="text-base leading-relaxed font-medium text-foreground">
              {currentNode.text}
            </p>

            {currentNode.hint && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                <p className="text-xs text-amber-700 dark:text-amber-400 italic">💡 {currentNode.hint}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Response bubbles */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          They say… <span className="font-normal normal-case">(press 1–{currentNode.responses.length} for quick select)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {currentNode.responses.map((resp, idx) => {
            const colorClass = BUBBLE_COLORS[resp.color] ?? BUBBLE_COLORS.default;
            const isSelected = selectedLabel === resp.label;
            return (
              <button
                key={resp.id}
                onClick={() => !selectedLabel && handleResponse(resp)}
                disabled={!!selectedLabel}
                className={`
                  relative flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold
                  border transition-all duration-200 shadow-sm
                  ${colorClass}
                  ${isSelected ? "scale-95 opacity-70 ring-2 ring-white/50" : "hover:scale-105 hover:shadow-md active:scale-95"}
                  ${selectedLabel && !isSelected ? "opacity-30" : ""}
                `}
              >
                <span className={`
                  inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold
                  bg-black/20 text-white shrink-0
                `}>
                  {idx + 1}
                </span>
                {resp.label}
                {isSelected && <span className="ml-1 text-xs opacity-80">✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Nav row */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={handleBack}
          disabled={history.length === 0}
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </Button>
        <span className="text-xs text-muted-foreground">Step {history.length + 1}</span>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={handleReset}>
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </Button>
      </div>
    </div>
  );
}

// ─── Admin Tree View (simple list, visual editor = Under Construction) ────────

function AdminEditor({ scriptId }: { scriptId: number }) {
  const { toast } = useToast();
  const { data: tree, isLoading } = useQuery<any>({
    queryKey: [`/api/call-scripts/${scriptId}/tree`],
  });

  const [editNode, setEditNode] = useState<any | null>(null);
  const [editText, setEditText] = useState("");
  const [editHint, setEditHint] = useState("");

  const updateNodeMut = useMutation({
    mutationFn: (data: { id: number; text: string; hint: string }) =>
      apiRequest("PATCH", `/api/script-nodes/${data.id}`, { text: data.text, hint: data.hint }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/tree`] });
      queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/root`] });
      setEditNode(null);
      toast({ title: "Node updated" });
    },
  });

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (!tree) return <p className="text-muted-foreground text-sm">No script data found.</p>;

  const responseMap = new Map<number, any[]>();
  (tree.responses ?? []).forEach((r: any) => {
    if (!responseMap.has(r.node_id)) responseMap.set(r.node_id, []);
    responseMap.get(r.node_id)!.push(r);
  });

  return (
    <div className="space-y-6">
      {/* Under construction: visual flow editor */}
      <div className="rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-700 p-6 flex flex-col items-center gap-3 text-center">
        <Construction className="w-8 h-8 text-amber-500" />
        <div>
          <p className="font-semibold text-amber-700 dark:text-amber-400">Visual Flow Editor</p>
          <p className="text-xs text-muted-foreground mt-1">Drag-and-drop node graph — ask for development</p>
        </div>
      </div>

      {/* Node list editor */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Script Nodes</h3>
        {tree.nodes?.map((node: any) => {
          const responses = responseMap.get(node.id) ?? [];
          return (
            <Card key={node.id} className="border border-border">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug flex-1">{node.text}</p>
                  <Button
                    size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0"
                    onClick={() => { setEditNode(node); setEditText(node.text); setEditHint(node.hint ?? ""); }}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {node.hint && <p className="text-xs text-amber-600 dark:text-amber-400 italic">💡 {node.hint}</p>}
                {responses.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {responses.sort((a: any, b: any) => a.response_order - b.response_order).map((r: any) => (
                      <Badge
                        key={r.id}
                        variant="outline"
                        className={`text-xs px-2 py-0.5 ${
                          r.color === "green" ? "border-emerald-400 text-emerald-700 dark:text-emerald-400" :
                          r.color === "red" ? "border-rose-400 text-rose-700 dark:text-rose-400" :
                          r.color === "yellow" ? "border-amber-400 text-amber-700 dark:text-amber-400" :
                          r.color === "blue" ? "border-blue-400 text-blue-700 dark:text-blue-400" :
                          "border-border text-muted-foreground"
                        }`}
                      >
                        {r.label} {r.next_node_id ? `→ #${r.next_node_id}` : "→ end"}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit node dialog */}
      <Dialog open={!!editNode} onOpenChange={o => !o && setEditNode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Script Node</DialogTitle>
            <DialogDescription>Update the CLR's line and coaching hint.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">Script text</label>
              <Textarea value={editText} onChange={e => setEditText(e.target.value)} rows={4} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Coaching hint (optional)</label>
              <Input value={editHint} onChange={e => setEditHint(e.target.value)} placeholder="Tips shown under the script line…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditNode(null)}>Cancel</Button>
            <Button
              onClick={() => updateNodeMut.mutate({ id: editNode.id, text: editText, hint: editHint })}
              disabled={updateNodeMut.isPending || !editText.trim()}
            >
              {updateNodeMut.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CallScriptPage() {
  const { user } = useAuth();
  const isAdmin = (user as any)?.isAdmin;
  const [view, setView] = useState<"run" | "admin">("run");
  const [selectedScriptId, setSelectedScriptId] = useState<number | null>(null);

  const { data: scripts = [], isLoading } = useQuery<CallScript[]>({
    queryKey: ["/api/call-scripts"],
  });

  const activeScripts = scripts.filter(s => s.is_active);

  // Auto-select first script
  useEffect(() => {
    if (activeScripts.length > 0 && !selectedScriptId) {
      setSelectedScriptId(activeScripts[0].id);
    }
  }, [activeScripts.length]);

  const selectedScript = scripts.find(s => s.id === selectedScriptId);

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Under Construction Banner */}
      <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-700 px-4 py-3">
        <Construction className="w-5 h-5 text-amber-500 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Under Construction</p>
          <p className="text-xs text-muted-foreground">This feature is still being developed. Some things may not work as expected.</p>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PhoneCall className="w-5 h-5 text-primary" />
            Call Script
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Step-by-step guided script with borrower response paths
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={view === "run" ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => setView("run")}
            >
              <PhoneCall className="w-3.5 h-3.5" /> Run
            </Button>
            <Button
              size="sm"
              variant={view === "admin" ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => setView("admin")}
            >
              <Wrench className="w-3.5 h-3.5" /> Edit Scripts
            </Button>
          </div>
        )}
      </div>

      {/* Script selector if multiple */}
      {activeScripts.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {activeScripts.map(s => (
            <button
              key={s.id}
              onClick={() => setSelectedScriptId(s.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                selectedScriptId === s.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:border-primary/50"
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="flex gap-3">
            <Skeleton className="h-12 flex-1 rounded-full" />
            <Skeleton className="h-12 flex-1 rounded-full" />
          </div>
        </div>
      )}

      {/* Main content */}
      {!isLoading && selectedScriptId && (
        <>
          {selectedScript && (
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{selectedScript.name}</span>
              {selectedScript.description && <span> · {selectedScript.description}</span>}
            </div>
          )}

          {view === "run" ? (
            <ScriptRunner key={selectedScriptId} scriptId={selectedScriptId} />
          ) : (
            <AdminEditor key={selectedScriptId} scriptId={selectedScriptId} />
          )}
        </>
      )}

      {!isLoading && activeScripts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <PhoneCall className="w-8 h-8 text-primary opacity-40" />
            </div>
            <div>
              <p className="font-semibold">No active scripts</p>
              <p className="text-sm text-muted-foreground mt-1">An admin needs to create one first.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
