import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
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
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  PhoneCall, ArrowLeft, RotateCcw, Copy, Check, ChevronRight, ChevronDown,
  Pencil, Construction, Copy as CopyIcon, Trash2, User, Globe, RefreshCw, Send,
  Search, Plus, ArrowUp, ArrowDown, CornerDownRight, X, GitBranch, Lock, Users,
  Play, Square, Clock, Radio,
} from "lucide-react";
import { HelpIcon, PageTooltip, markStep } from "@/components/onboarding";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScriptResponse { id: number; node_id: number; label: string; color: string; next_node_id: number | null; response_order: number; }
interface ScriptNode { id: number; script_id: number; text: string; hint?: string | null; responses: ScriptResponse[]; }
interface CallScript { id: number; name: string; description?: string; is_active: number; owner_id: number | null; owner_name?: string | null; is_default?: boolean; }

// ─── Placeholder auto-fill ────────────────────────────────────────────────────
export interface PlaceholderValues {
  yourName: string;
  loName: string;
  company: string;
  borrowerName: string;
  timeOfDay: "morning" | "afternoon" | "evening";
}

const TIMEZONE_OPTIONS: { label: string; value: string }[] = [
  { label: "Pacific", value: "America/Los_Angeles" },
  { label: "Mountain", value: "America/Denver" },
  { label: "Arizona", value: "America/Phoenix" },
  { label: "Central", value: "America/Chicago" },
  { label: "Eastern", value: "America/New_York" },
  { label: "Alaska", value: "America/Anchorage" },
  { label: "Hawaii", value: "Pacific/Honolulu" },
];

function detectDefaultTimezone(): string {
  try {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const match = TIMEZONE_OPTIONS.find(tz => tz.value === browserTz);
    if (match) return match.value;
    if (browserTz?.startsWith("America/")) {
      if (/Phoenix/.test(browserTz)) return "America/Phoenix";
      if (/Denver|Boise|Edmonton/.test(browserTz)) return "America/Denver";
      if (/Chicago|Regina|Mexico_City/.test(browserTz)) return "America/Chicago";
      if (/New_York|Toronto|Detroit/.test(browserTz)) return "America/New_York";
      if (/Anchorage|Juneau|Sitka/.test(browserTz)) return "America/Anchorage";
      return "America/Los_Angeles";
    }
    if (browserTz?.startsWith("Pacific/Honolulu")) return "Pacific/Honolulu";
  } catch {}
  return "America/Los_Angeles";
}

function computeTimeOfDay(timezone: string, now: Date = new Date()): "morning" | "afternoon" | "evening" {
  let hour = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(now);
    const hourPart = parts.find(p => p.type === "hour");
    hour = hourPart ? parseInt(hourPart.value, 10) : now.getHours();
    if (hour === 24) hour = 0;
  } catch {
    hour = now.getHours();
  }
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "morning";
}

const PLACEHOLDER_REGEX = /\[(your name|lo name|company|borrower name|morning\/afternoon\/evening)\]/gi;

function resolvePlaceholderKey(key: string, values: PlaceholderValues): string | null {
  const k = key.toLowerCase();
  if (k === "your name") return values.yourName || "";
  if (k === "lo name") return values.loName || "";
  if (k === "company") return values.company || "";
  if (k === "borrower name") return values.borrowerName || "";
  if (k === "morning/afternoon/evening") return values.timeOfDay;
  return null;
}

function resolvePlaceholders(text: string, values: PlaceholderValues): React.ReactNode {
  if (!text) return text;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const regex = new RegExp(PLACEHOLDER_REGEX.source, "gi");
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
    const resolved = resolvePlaceholderKey(match[1], values);
    const display = resolved && resolved.trim() ? resolved : match[0];
    parts.push(
      <span key={`${match.index}-${match[0]}`} className="text-teal-500 font-medium">{display}</span>
    );
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length > 0 ? parts : text;
}

const PlaceholderContext = createContext<PlaceholderValues | null>(null);
const usePlaceholders = () => useContext(PlaceholderContext);

function resolvePlaceholdersPlain(text: string, values: PlaceholderValues): string {
  if (!text) return text;
  return text.replace(new RegExp(PLACEHOLDER_REGEX.source, "gi"), (full, key) => {
    const resolved = resolvePlaceholderKey(key, values);
    return resolved && resolved.trim() ? resolved : full;
  });
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

// ─── Transfer Win State ───────────────────────────────────────────────────────
function TransferWin({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-16 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="text-7xl">🎉</div>
      <div>
        <h2 className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">Transfer Complete!</h2>
        <p className="text-muted-foreground mt-2 text-sm">Great work — log this transfer in Bonzo with proper notation.</p>
      </div>
      <Button onClick={onReset} className="gap-2 mt-2"><RotateCcw className="w-4 h-4" /> Start New Call</Button>
    </div>
  );
}

function EndState({ isTransfer, onReset }: { isTransfer: boolean; onReset: () => void }) {
  if (isTransfer) return <TransferWin onReset={onReset} />;
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="text-5xl">📋</div>
      <div>
        <h2 className="text-xl font-semibold">End of script</h2>
        <p className="text-muted-foreground mt-1 text-sm">Log your outcome in Call Reports when ready.</p>
      </div>
      <Button variant="outline" onClick={onReset} className="gap-2 mt-2"><RotateCcw className="w-4 h-4" /> Start Over</Button>
    </div>
  );
}

// ─── Script Runner ────────────────────────────────────────────────────────────
function ScriptRunner({ scriptId }: { scriptId: number }) {
  const placeholders = usePlaceholders();
  const [currentNode, setCurrentNode] = useState<ScriptNode | null>(null);
  const [history, setHistory] = useState<ScriptNode[]>([]);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [wasTransfer, setWasTransfer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [animKey, setAnimKey] = useState(0);

  const { data: rootNode, isLoading } = useQuery<ScriptNode>({
    queryKey: [`/api/call-scripts/${scriptId}/root`],
  });

  useEffect(() => {
    if (rootNode) { setCurrentNode(rootNode); setHistory([]); setEnded(false); setSelectedLabel(null); setAnimKey(k => k + 1); }
  }, [rootNode]);

  const fetchNode = useCallback(async (nodeId: number): Promise<ScriptNode> => {
    const res = await fetch(`/api/call-scripts/${scriptId}/node/${nodeId}`, { credentials: "include" });
    return res.json();
  }, [scriptId]);

  const handleResponse = async (resp: ScriptResponse) => {
    if (!currentNode) return;
    setSelectedLabel(resp.label);
    await new Promise(r => setTimeout(r, 350));
    if (!resp.next_node_id) { setEnded(true); setWasTransfer(resp.label.toLowerCase().includes("transfer")); return; }
    const next = await fetchNode(resp.next_node_id);
    setHistory(h => [...h, currentNode]);
    setCurrentNode(next); setSelectedLabel(null); setAnimKey(k => k + 1);
  };

  const handleBack = async () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    const fresh = await fetchNode(prev.id);
    setCurrentNode(fresh); setHistory(h => h.slice(0, -1)); setEnded(false); setSelectedLabel(null); setAnimKey(k => k + 1);
  };

  const handleReset = async () => {
    if (!rootNode) return;
    const fresh = await fetchNode(rootNode.id);
    setCurrentNode(fresh); setHistory([]); setEnded(false); setSelectedLabel(null); setAnimKey(k => k + 1);
  };

  const handleCopy = () => {
    if (!currentNode) return;
    const plain = placeholders ? resolvePlaceholdersPlain(currentNode.text, placeholders) : currentNode.text;
    navigator.clipboard.writeText(plain);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (ended || !currentNode || selectedLabel) return;
      const n = parseInt(e.key);
      if (n >= 1 && n <= currentNode.responses.length) handleResponse(currentNode.responses[n - 1]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentNode, ended, selectedLabel]);

  if (isLoading || !currentNode) return (
    <div className="space-y-4">
      <Skeleton className="h-32 w-full rounded-2xl" />
      <div className="flex gap-3"><Skeleton className="h-12 flex-1 rounded-full" /><Skeleton className="h-12 flex-1 rounded-full" /></div>
    </div>
  );

  if (ended) return <EndState isTransfer={wasTransfer} onReset={handleReset} />;

  return (
    <div className="space-y-6">
      {history.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-xs text-muted-foreground">
          {history.map((h, i) => (
            <span key={h.id} className="flex items-center gap-1">
              <span className="truncate max-w-[120px]">{h.text.slice(0, 40)}…</span>
              {i < history.length - 1 && <ChevronRight className="w-3 h-3 shrink-0" />}
            </span>
          ))}
          <ChevronRight className="w-3 h-3 shrink-0" />
          <span className="text-foreground font-medium">You are here</span>
        </div>
      )}
      <div key={animKey} className="animate-in fade-in slide-in-from-bottom-4 duration-400">
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-background to-primary/5 shadow-lg">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-primary/10 p-2"><PhoneCall className="w-4 h-4 text-primary" /></div>
                <span className="text-xs font-semibold text-primary uppercase tracking-wide">What to say</span>
              </div>
              <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={handleCopy} title="Copy">
                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-base leading-relaxed font-medium whitespace-pre-line">
              {placeholders ? resolvePlaceholders(currentNode.text, placeholders) : currentNode.text}
            </p>
            {currentNode.hint && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                <p className="text-xs text-amber-700 dark:text-amber-400 italic">💡 {currentNode.hint}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-1">
          They say… <span className="font-normal normal-case">(press 1–{currentNode.responses.length} to select)</span>
        </p>
        <div className="flex flex-wrap gap-2">
          {currentNode.responses.map((resp, idx) => {
            const colorClass = BUBBLE_COLORS[resp.color] ?? BUBBLE_COLORS.default;
            const isSelected = selectedLabel === resp.label;
            return (
              <button key={resp.id} onClick={() => !selectedLabel && handleResponse(resp)} disabled={!!selectedLabel}
                className={`relative flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold border transition-all duration-200 shadow-sm ${colorClass} ${isSelected ? "scale-95 opacity-70 ring-2 ring-white/50" : "hover:scale-105 hover:shadow-md active:scale-95"} ${selectedLabel && !isSelected ? "opacity-30" : ""}`}>
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold bg-black/20 text-white shrink-0">{idx + 1}</span>
                {resp.label}
                {isSelected && <span className="ml-1 text-xs opacity-80">✓</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" onClick={handleBack} disabled={history.length === 0}>
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

// ─── Node type inference & color ──────────────────────────────────────────────
type NodeKind = "opening" | "objection" | "transfer" | "voicemail" | "dnc" | "default";

function inferNodeKind(text: string): NodeKind {
  const t = (text || "").toLowerCase();
  if (/\b(open|introdu|hi|hello|this is|calling from)/.test(t) && t.length < 220) return "opening";
  if (/objection|not interested|busy|no thank|don.?t want|remove me/.test(t)) return "objection";
  if (/transfer|warm transfer|hand off|loan officer/.test(t)) return "transfer";
  if (/voicemail|leave.*message|vm\b/.test(t)) return "voicemail";
  if (/\bdnc\b|do not call|remove.*list/.test(t)) return "dnc";
  return "default";
}

const NODE_KIND_STYLES: Record<NodeKind, { bar: string; badge: string; label: string }> = {
  opening:   { bar: "bg-blue-900",     badge: "border-blue-900 text-blue-900 dark:text-blue-300 dark:border-blue-300", label: "Opening" },
  objection: { bar: "bg-rose-500",     badge: "border-rose-500 text-rose-600 dark:text-rose-400", label: "Objection" },
  transfer:  { bar: "bg-emerald-500",  badge: "border-emerald-500 text-emerald-600 dark:text-emerald-400", label: "Transfer" },
  voicemail: { bar: "bg-zinc-400",     badge: "border-zinc-400 text-zinc-600 dark:text-zinc-400", label: "Voicemail" },
  dnc:       { bar: "bg-red-900",      badge: "border-red-900 text-red-900 dark:text-red-300 dark:border-red-300", label: "DNC" },
  default:   { bar: "bg-primary/40",   badge: "border-border text-muted-foreground", label: "Node" },
};

const RESPONSE_COLORS = [
  { value: "green",  label: "Green" },
  { value: "red",    label: "Red" },
  { value: "yellow", label: "Yellow" },
  { value: "blue",   label: "Blue" },
  { value: "gray",   label: "Gray" },
  { value: "default",label: "Default" },
];

function responseBadgeClass(color: string) {
  switch (color) {
    case "green":  return "border-emerald-400 text-emerald-700 dark:text-emerald-400";
    case "red":    return "border-rose-400 text-rose-700 dark:text-rose-400";
    case "yellow": return "border-amber-400 text-amber-700 dark:text-amber-400";
    case "blue":   return "border-blue-400 text-blue-700 dark:text-blue-400";
    case "gray":   return "border-zinc-400 text-zinc-700 dark:text-zinc-400";
    default:       return "border-border text-muted-foreground";
  }
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q.trim()) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={idx} className="bg-yellow-200 dark:bg-yellow-900/60 rounded px-0.5">{text.slice(idx, idx + needle.length)}</mark>);
    i = idx + needle.length;
  }
  return parts;
}

// Apply placeholder resolution to any string segments inside an existing React node array.
function applyPlaceholdersToNode(node: React.ReactNode, values: PlaceholderValues, keyPrefix = ""): React.ReactNode {
  if (typeof node === "string") return resolvePlaceholders(node, values);
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <span key={`${keyPrefix}${i}`}>{applyPlaceholdersToNode(child, values, `${keyPrefix}${i}-`)}</span>
    ));
  }
  return node;
}

function renderScriptText(text: string, searchQuery: string, values: PlaceholderValues | null): React.ReactNode {
  if (!values) return highlight(text, searchQuery);
  if (!searchQuery.trim()) return resolvePlaceholders(text, values);
  // When searching, run highlight then wrap raw-string segments with placeholder resolution.
  const highlighted = highlight(text, searchQuery);
  return applyPlaceholdersToNode(highlighted, values);
}

// ─── Inline Node Editor ───────────────────────────────────────────────────────
function InlineNodeBlock({
  node, responses, allNodes, depth, scriptId, expanded, onToggle, searchQuery, childNodesByParent, autoEdit,
  onEditStarted, onChildExpand, expandedIds, canEdit = true,
}: {
  node: any;
  responses: any[];
  allNodes: any[];
  depth: number;
  scriptId: number;
  expanded: boolean;
  onToggle: () => void;
  searchQuery: string;
  childNodesByParent: Map<number | null, any[]>;
  autoEdit: boolean;
  onEditStarted: () => void;
  onChildExpand: (id: number) => void;
  expandedIds: Set<number>;
  canEdit?: boolean;
}) {
  const { toast } = useToast();
  const placeholders = usePlaceholders();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(node.text);
  const [hint, setHint] = useState(node.hint ?? "");

  useEffect(() => { setText(node.text); setHint(node.hint ?? ""); }, [node.id, node.text, node.hint]);

  useEffect(() => {
    if (autoEdit) { setEditing(true); onEditStarted(); }
  }, [autoEdit, onEditStarted]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/tree`] });
    queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/root`] });
  };

  const updateNodeMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/script-nodes/${node.id}`, { text, hint }),
    onSuccess: () => { invalidate(); setEditing(false); toast({ title: "Node updated" }); },
  });

  const addResponseMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/script-nodes/${node.id}/responses`, {
      label: "New response", color: "default", nextNodeId: null,
      responseOrder: (responses[responses.length - 1]?.response_order ?? -1) + 1,
    }),
    onSuccess: () => invalidate(),
  });

  const createLinkedNodeMut = useMutation({
    mutationFn: async (responseId: number) => {
      const newNode = await apiRequest("POST", `/api/call-scripts/${scriptId}/nodes`, {
        text: "New script text…", hint: "", parentNodeId: node.id, parentResponseId: responseId,
        nodeOrder: (allNodes[allNodes.length - 1]?.node_order ?? -1) + 1,
      });
      await apiRequest("PATCH", `/api/script-responses/${responseId}`, { nextNodeId: (newNode as any).id });
      return newNode as any;
    },
    onSuccess: (newNode) => {
      invalidate();
      onChildExpand(newNode.id);
      toast({ title: "Branch created", description: "Edit the new node below." });
    },
  });

  const deleteNodeMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/script-nodes/${node.id}`, undefined),
    onSuccess: () => { invalidate(); toast({ title: "Node deleted" }); },
  });

  const kind = inferNodeKind(node.text);
  const style = NODE_KIND_STYLES[kind];
  const childNodes = childNodesByParent.get(node.id) ?? [];
  const otherNodes = allNodes.filter(n => n.id !== node.id);

  const hasSearchHit = !!searchQuery && (
    node.text.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (node.hint ?? "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    responses.some((r: any) => r.label.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="relative" style={{ marginLeft: depth === 0 ? 0 : 12 }}>
      {depth > 0 && (
        <div aria-hidden className="absolute left-[-12px] top-0 bottom-0 w-px bg-border" />
      )}
      <Card className={`border border-border overflow-hidden ${hasSearchHit ? "ring-2 ring-yellow-300 dark:ring-yellow-700" : ""}`}>
        <div className="flex">
          <div className={`w-1.5 shrink-0 ${style.bar}`} aria-hidden />
          <CardContent className="p-3 flex-1 space-y-2">
            <div className="flex items-start gap-2">
              <button onClick={onToggle} className="mt-0.5 shrink-0 rounded hover:bg-muted p-0.5" aria-label={expanded ? "Collapse" : "Expand"}>
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${style.badge}`}>{style.label}</Badge>
                  {node.parent_node_id === null && <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary text-primary">Root</Badge>}
                  <span className="text-[10px] text-muted-foreground">#{node.id}</span>
                </div>
                {!editing ? (
                  <p className="text-sm leading-snug mt-1 whitespace-pre-line">
                    {renderScriptText(node.text, searchQuery, placeholders)}
                  </p>
                ) : (
                  <div className="mt-2 space-y-2">
                    <Textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="What do you say at this step?" />
                    <Input value={hint} onChange={e => setHint(e.target.value)} placeholder="Coaching hint (optional)" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateNodeMut.mutate()} disabled={updateNodeMut.isPending || !text.trim()}>
                        {updateNodeMut.isPending ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setEditing(false); setText(node.text); setHint(node.hint ?? ""); }}>Cancel</Button>
                    </div>
                  </div>
                )}
                {!editing && node.hint && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 italic mt-1">💡 {renderScriptText(node.hint, searchQuery, placeholders)}</p>
                )}
              </div>
              {!editing && canEdit && (
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {node.parent_node_id !== null && (
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => { if (confirm("Delete this node and its descendants?")) deleteNodeMut.mutate(); }} title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {expanded && (
              <div className="pl-6 space-y-1.5 pt-1">
                {responses.map((r: any, idx: number) => (
                  <ResponseRow key={r.id} response={r} index={idx} total={responses.length}
                    siblings={responses}
                    otherNodes={otherNodes} scriptId={scriptId} searchQuery={searchQuery}
                    onCreateLinked={() => createLinkedNodeMut.mutate(r.id)}
                    creatingLinked={createLinkedNodeMut.isPending}
                    canEdit={canEdit}
                  />
                ))}
                {canEdit && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addResponseMut.mutate()} disabled={addResponseMut.isPending}>
                    <Plus className="w-3 h-3" /> {addResponseMut.isPending ? "Adding…" : "Add Response"}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </div>
      </Card>
      {expanded && childNodes.length > 0 && (
        <div className="pl-4 mt-2 space-y-2">
          {childNodes.map((child: any) => (
            <InlineNodeBlock
              key={child.id}
              node={child}
              responses={(child._responses as any[]) ?? []}
              allNodes={allNodes}
              depth={depth + 1}
              scriptId={scriptId}
              expanded={expandedIds.has(child.id)}
              onToggle={() => onChildExpand(child.id)}
              searchQuery={searchQuery}
              childNodesByParent={childNodesByParent}
              autoEdit={false}
              onEditStarted={() => {}}
              onChildExpand={onChildExpand}
              expandedIds={expandedIds}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ResponseRow({ response, index, total, siblings, otherNodes, scriptId, searchQuery, onCreateLinked, creatingLinked, canEdit = true }: {
  response: any; index: number; total: number; siblings: any[]; otherNodes: any[]; scriptId: number; searchQuery: string;
  onCreateLinked: () => void; creatingLinked: boolean; canEdit?: boolean;
}) {
  const { toast } = useToast();
  const [label, setLabel] = useState(response.label);
  const [color, setColor] = useState(response.color ?? "default");
  const [nextId, setNextId] = useState<string>(response.next_node_id == null ? "none" : String(response.next_node_id));
  const [edit, setEdit] = useState(false);

  useEffect(() => {
    setLabel(response.label); setColor(response.color ?? "default");
    setNextId(response.next_node_id == null ? "none" : String(response.next_node_id));
  }, [response.id, response.label, response.color, response.next_node_id]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/tree`] });
    queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/root`] });
  };

  const saveMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/script-responses/${response.id}`, {
      label, color, nextNodeId: nextId === "none" ? null : parseInt(nextId),
    }),
    onSuccess: () => { invalidate(); setEdit(false); },
  });

  const reorderPairMut = useMutation({
    mutationFn: async (opts: { aId: number; aOrder: number; bId: number; bOrder: number }) => {
      await apiRequest("PATCH", `/api/script-responses/${opts.aId}`, { responseOrder: opts.aOrder });
      await apiRequest("PATCH", `/api/script-responses/${opts.bId}`, { responseOrder: opts.bOrder });
    },
    onSuccess: () => invalidate(),
  });

  const deleteMut = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/script-responses/${response.id}`, undefined),
    onSuccess: () => { invalidate(); toast({ title: "Response deleted" }); },
  });

  const swap = (direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= total) return;
    const other = siblings[target];
    reorderPairMut.mutate({
      aId: response.id, aOrder: other.response_order,
      bId: other.id, bOrder: response.response_order,
    });
  };

  const targetNode = otherNodes.find(n => n.id === response.next_node_id);
  const targetLabel = response.next_node_id == null ? "— end of script —" : (targetNode ? `→ ${targetNode.text.slice(0, 40)}${targetNode.text.length > 40 ? "…" : ""}` : "→ (unknown)");

  if (!edit) {
    return (
      <div className="flex items-center gap-1.5 text-xs group">
        <CornerDownRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <Badge variant="outline" className={`text-[11px] px-2 py-0 ${responseBadgeClass(response.color)}`}>
          {highlight(response.label, searchQuery)}
        </Badge>
        <span className="text-muted-foreground truncate max-w-[180px]">{targetLabel}</span>
        {canEdit && (
        <div className="flex gap-0.5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Move up"
            onClick={() => swap(-1)} disabled={index === 0 || reorderPairMut.isPending}>
            <ArrowUp className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Move down"
            onClick={() => swap(1)} disabled={index === total - 1 || reorderPairMut.isPending}>
            <ArrowDown className="w-3 h-3" />
          </Button>
          {response.next_node_id == null && (
            <Button size="sm" variant="ghost" className="h-6 px-1.5 py-0 text-[10px] gap-0.5" title="Create new node and link"
              onClick={onCreateLinked} disabled={creatingLinked}>
              <Plus className="w-3 h-3" /> New Node
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Edit" onClick={() => setEdit(true)}>
            <Pencil className="w-3 h-3" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" title="Delete"
            onClick={() => { if (confirm("Delete this response?")) deleteMut.mutate(); }}>
            <X className="w-3 h-3" />
          </Button>
        </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-1.5 py-1 pl-4 border-l-2 border-primary/40">
      <Input value={label} onChange={e => setLabel(e.target.value)} className="h-7 text-xs w-40" placeholder="Response text" />
      <Select value={color} onValueChange={setColor}>
        <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
        <SelectContent>{RESPONSE_COLORS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={nextId} onValueChange={setNextId}>
        <SelectTrigger className="h-7 text-xs w-52"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">— end of script —</SelectItem>
          {otherNodes.map(n => (
            <SelectItem key={n.id} value={String(n.id)}>
              #{n.id} {n.text.slice(0, 40)}{n.text.length > 40 ? "…" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-1">
        <Button size="sm" className="h-7 text-xs" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !label.trim()}>
          {saveMut.isPending ? "…" : "Save"}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEdit(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Node Editor ──────────────────────────────────────────────────────────────
function NodeEditor({ scriptId, onClose, canEdit = true }: { scriptId: number; onClose: () => void; canEdit?: boolean }) {
  const { toast } = useToast();
  const { data: tree, isLoading } = useQuery<any>({ queryKey: [`/api/call-scripts/${scriptId}/tree`] });
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [rootsInitialized, setRootsInitialized] = useState(false);
  const [autoEditId, setAutoEditId] = useState<number | null>(null);

  const toggle = (id: number) => setExpanded(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const expandOne = (id: number) => setExpanded(s => new Set(s).add(id));

  const addNodeMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/call-scripts/${scriptId}/nodes`, {
      text: "New script text…", hint: "", parentNodeId: null, parentResponseId: null,
      nodeOrder: ((tree?.nodes ?? []).length),
    }),
    onSuccess: (n: any) => {
      queryClient.invalidateQueries({ queryKey: [`/api/call-scripts/${scriptId}/tree`] });
      setAutoEditId(n.id);
      expandOne(n.id);
      toast({ title: "Node added" });
    },
  });

  const nodes: any[] = tree?.nodes ?? [];
  const responses: any[] = tree?.responses ?? [];

  useEffect(() => {
    if (rootsInitialized || nodes.length === 0) return;
    const roots = nodes.filter((n: any) => n.parent_node_id == null);
    setExpanded(s => { const next = new Set(s); roots.forEach(r => next.add(r.id)); return next; });
    setRootsInitialized(true);
  }, [nodes, rootsInitialized]);

  if (isLoading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;

  const responseMap = new Map<number, any[]>();
  responses.forEach((r: any) => {
    if (!responseMap.has(r.node_id)) responseMap.set(r.node_id, []);
    responseMap.get(r.node_id)!.push(r);
  });
  responseMap.forEach(list => list.sort((a, b) => a.response_order - b.response_order));

  // Build child map: parent_node_id → children
  const childMap = new Map<number | null, any[]>();
  nodes.forEach((n: any) => {
    const parent = n.parent_node_id ?? null;
    if (!childMap.has(parent)) childMap.set(parent, []);
    childMap.get(parent)!.push({ ...n, _responses: responseMap.get(n.id) ?? [] });
  });
  childMap.forEach(list => list.sort((a, b) => (a.node_order ?? 0) - (b.node_order ?? 0)));

  // Root-level nodes are those with parent_node_id == null. In legacy data some nodes may be orphans; treat null-parent as roots.
  const rootNodes = childMap.get(null) ?? [];

  const searchLower = search.trim().toLowerCase();
  const searchFilter = (n: any) => {
    if (!searchLower) return true;
    if (n.text.toLowerCase().includes(searchLower)) return true;
    if ((n.hint ?? "").toLowerCase().includes(searchLower)) return true;
    return (responseMap.get(n.id) ?? []).some((r: any) => r.label.toLowerCase().includes(searchLower));
  };

  // When searching, show flat list of matches so nothing is hidden behind a collapsed parent
  const flatMatches = searchLower ? nodes.filter(searchFilter) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          Script Nodes
          {!canEdit && (
            <span className="inline-flex items-center gap-1 text-[11px] font-normal normal-case text-muted-foreground">
              <Lock className="w-3 h-3" /> read-only
            </span>
          )}
        </p>
        <div className="flex gap-2">
          {canEdit && (
            <Button size="sm" variant="outline" onClick={() => addNodeMut.mutate()} disabled={addNodeMut.isPending} className="text-xs gap-1">
              <Plus className="w-3 h-3" /> {addNodeMut.isPending ? "Adding…" : "Add Node"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} className="text-xs gap-1"><ArrowLeft className="w-3 h-3" /> Back</Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search nodes, hints, responses…"
          className="pl-8 h-9 text-sm"
        />
        {search && (
          <Button size="sm" variant="ghost" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0" onClick={() => setSearch("")}>
            <X className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      {searchLower ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {flatMatches.length} match{flatMatches.length === 1 ? "" : "es"} for "{search}"
          </p>
          {flatMatches.map((n: any) => (
            <InlineNodeBlock
              key={n.id}
              node={n}
              responses={responseMap.get(n.id) ?? []}
              allNodes={nodes}
              depth={0}
              scriptId={scriptId}
              expanded={true}
              onToggle={() => toggle(n.id)}
              searchQuery={search}
              childNodesByParent={childMap}
              autoEdit={autoEditId === n.id}
              onEditStarted={() => setAutoEditId(null)}
              onChildExpand={expandOne}
              expandedIds={expanded}
              canEdit={canEdit}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {rootNodes.length === 0 && (
            <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">
              No nodes yet. Click "Add Node" to get started.
            </CardContent></Card>
          )}
          {rootNodes.map((n: any) => (
            <InlineNodeBlock
              key={n.id}
              node={n}
              responses={responseMap.get(n.id) ?? []}
              allNodes={nodes}
              depth={0}
              scriptId={scriptId}
              expanded={expanded.has(n.id)}
              onToggle={() => toggle(n.id)}
              searchQuery=""
              childNodesByParent={childMap}
              autoEdit={autoEditId === n.id}
              onEditStarted={() => setAutoEditId(null)}
              onChildExpand={expandOne}
              expandedIds={expanded}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Flowchart (read-only visual tree) ────────────────────────────────────────
function ScriptFlowchart({ scriptId }: { scriptId: number }) {
  const { data: tree, isLoading } = useQuery<any>({ queryKey: [`/api/call-scripts/${scriptId}/tree`] });
  const placeholders = usePlaceholders();

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  }

  const nodes: any[] = tree?.nodes ?? [];
  const responses: any[] = tree?.responses ?? [];

  if (nodes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No nodes in this script yet. Add some in the Editor tab.
        </CardContent>
      </Card>
    );
  }

  const childMap = new Map<number | null, any[]>();
  nodes.forEach((n: any) => {
    const parent = n.parent_node_id ?? null;
    if (!childMap.has(parent)) childMap.set(parent, []);
    childMap.get(parent)!.push(n);
  });
  childMap.forEach(list => list.sort((a, b) => (a.node_order ?? 0) - (b.node_order ?? 0)));

  const responsesByParent = new Map<number, any[]>();
  responses.forEach((r: any) => {
    if (!responsesByParent.has(r.node_id)) responsesByParent.set(r.node_id, []);
    responsesByParent.get(r.node_id)!.push(r);
  });
  responsesByParent.forEach(list => list.sort((a, b) => (a.response_order ?? 0) - (b.response_order ?? 0)));

  const responseLabelFor = (parentId: number, childId: number): string => {
    const resps = responsesByParent.get(parentId) ?? [];
    const match = resps.find((r: any) => r.next_node_id === childId);
    return match?.label ?? "";
  };

  const NODE_KIND_HEX: Record<NodeKind, { bg: string; border: string; label: string }> = {
    opening:   { bg: "#1e3a8a", border: "#1e40af", label: "Opening" },
    objection: { bg: "#f43f5e", border: "#e11d48", label: "Objection" },
    transfer:  { bg: "#10b981", border: "#059669", label: "Transfer" },
    voicemail: { bg: "#9ca3af", border: "#6b7280", label: "Voicemail" },
    dnc:       { bg: "#7f1d1d", border: "#991b1b", label: "DNC" },
    default:   { bg: "#475569", border: "#334155", label: "Node" },
  };

  function truncate(s: string, n: number) {
    const t = (s || "").trim().replace(/\s+/g, " ");
    return t.length > n ? t.slice(0, n) + "…" : t;
  }

  const renderFlowText = (raw: string): React.ReactNode => {
    if (!placeholders) return raw;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const regex = new RegExp(PLACEHOLDER_REGEX.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      if (match.index > lastIndex) parts.push(raw.slice(lastIndex, match.index));
      const resolved = resolvePlaceholderKey(match[1], placeholders);
      const display = resolved && resolved.trim() ? resolved : match[0];
      parts.push(<span key={`${match.index}-${match[0]}`} className="text-teal-200 font-semibold">{display}</span>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < raw.length) parts.push(raw.slice(lastIndex));
    return parts.length > 0 ? parts : raw;
  };

  const NodeBox = ({ n }: { n: any }) => {
    const kind = inferNodeKind(n.text || "");
    const style = NODE_KIND_HEX[kind];
    const raw = truncate(n.text || "(empty)", 80);
    return (
      <div
        className="inline-block min-w-[190px] max-w-[240px] rounded-lg border-2 text-white shadow-sm overflow-hidden"
        style={{ background: style.bg, borderColor: style.border }}
      >
        <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-black/20">
          {style.label}
        </div>
        <div className="px-2.5 py-1.5 text-xs leading-snug">
          {renderFlowText(raw)}
        </div>
      </div>
    );
  };

  const renderSubtree = (n: any, parentId: number | null): React.ReactNode => {
    const children = childMap.get(n.id) ?? [];
    const label = parentId !== null ? responseLabelFor(parentId, n.id) : "";
    return (
      <div key={n.id} className="flex flex-col items-center">
        {label && (
          <div className="text-[10px] font-medium text-muted-foreground italic mb-1 px-2 py-0.5 rounded bg-muted border border-border max-w-[200px] truncate">
            ↳ "{truncate(label, 30)}"
          </div>
        )}
        <NodeBox n={n} />
        {children.length > 0 && (
          <>
            {/* vertical connector down */}
            <div className="w-0.5 h-4 bg-muted-foreground/40" />
            {/* horizontal bar across children */}
            {children.length > 1 && (
              <div className="relative flex justify-center">
                <div
                  className="absolute top-0 left-0 right-0 h-0.5 bg-muted-foreground/40"
                  style={{ margin: "0 3rem" }}
                />
              </div>
            )}
            <div className="flex items-start gap-6 pt-4 relative">
              {children.map((c: any, idx: number) => (
                <div key={c.id} className="flex flex-col items-center relative">
                  {/* vertical line up to horizontal bar */}
                  {children.length > 1 && (
                    <div className="absolute -top-4 w-0.5 h-4 bg-muted-foreground/40" />
                  )}
                  {renderSubtree(c, n.id)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };

  const roots = childMap.get(null) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <div>
              <p className="text-sm font-semibold">Visual Flowchart</p>
              <p className="text-xs text-muted-foreground">Read-only view. Edit in the Editor tab.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(["opening","objection","transfer","voicemail","dnc","default"] as NodeKind[]).map(k => (
                <span key={k} className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded" style={{ background: NODE_KIND_HEX[k].bg }} />
                  {NODE_KIND_HEX[k].label}
                </span>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto overflow-y-visible">
            <div className="min-w-max flex flex-col gap-8 items-start py-4">
              {roots.map((r: any) => (
                <div key={r.id} className="min-w-max">
                  {renderSubtree(r, null)}
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Call Recorder ────────────────────────────────────────────────────────────
type RecorderStep = "idle" | "recording" | "outcome_selected" | "wizard" | "verify" | "done";
type RecorderOutcomeKey =
  | "transfer_direct"
  | "transfer_appointment"
  | "appointment"
  | "callback_requested"
  | "fell_through"
  | "no_answer"
  | "future_contact";

const OUTCOME_CHOICES: {
  key: RecorderOutcomeKey;
  label: string;
  btn: string;
  outcomeType: string;
  transferType?: "direct" | "appointment";
}[] = [
  { key: "transfer_direct", label: "Transfer (Direct)", btn: "bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600", outcomeType: "transfer", transferType: "direct" },
  { key: "transfer_appointment", label: "Transfer (Appointment)", btn: "bg-teal-500 hover:bg-teal-600 text-white border-teal-600", outcomeType: "transfer", transferType: "appointment" },
  { key: "appointment", label: "Appointment Scheduled", btn: "bg-blue-500 hover:bg-blue-600 text-white border-blue-600", outcomeType: "appointment" },
  { key: "callback_requested", label: "Callback Requested", btn: "bg-amber-400 hover:bg-amber-500 text-amber-950 border-amber-500", outcomeType: "callback_requested" },
  { key: "fell_through", label: "Fell Through", btn: "bg-rose-500 hover:bg-rose-600 text-white border-rose-600", outcomeType: "fell_through" },
  { key: "no_answer", label: "No Answer", btn: "bg-zinc-400 hover:bg-zinc-500 text-white border-zinc-500", outcomeType: "no_answer" },
  { key: "future_contact", label: "Future Contact", btn: "bg-purple-500 hover:bg-purple-600 text-white border-purple-600", outcomeType: "future_contact" },
];

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function CallRecorder({
  borrowerName,
  onBorrowerNameChange,
  loDropdownOptions,
  currentLoName,
  onStartRecording,
  isRecording,
  recordingStartedAt,
}: {
  borrowerName: string;
  onBorrowerNameChange: (v: string) => void;
  loDropdownOptions: { name: string; source: "assigned" | "active" }[];
  currentLoName: string;
  onStartRecording: (started: boolean) => void;
  isRecording: boolean;
  recordingStartedAt: number | null;
}) {
  const { toast } = useToast();
  const [step, setStep] = useState<RecorderStep>("idle");
  const [chosenOutcome, setChosenOutcome] = useState<RecorderOutcomeKey | null>(null);
  const [wizardLoName, setWizardLoName] = useState<string>("");
  const [wizardScheduled, setWizardScheduled] = useState<string>("");
  const [wizardTransferType, setWizardTransferType] = useState<"direct" | "appointment" | "">("");
  const [wizardNotes, setWizardNotes] = useState<string>("");
  const [wizardBorrower, setWizardBorrower] = useState<string>("");
  const [durationTick, setDurationTick] = useState(0);

  const { data: loanOfficers = [] } = useQuery<any[]>({ queryKey: ["/api/loan-officers"] });

  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setDurationTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const durationMs = recordingStartedAt ? Date.now() - recordingStartedAt : 0;

  const handleStart = () => {
    if (!borrowerName.trim()) {
      toast({ title: "Enter borrower name first", variant: "destructive" });
      return;
    }
    onStartRecording(true);
    setStep("recording");
  };

  const handleCancel = () => {
    setStep("idle");
    setChosenOutcome(null);
    setWizardLoName("");
    setWizardScheduled("");
    setWizardTransferType("");
    setWizardNotes("");
    setWizardBorrower("");
    onStartRecording(false);
  };

  const handleOutcomePick = (key: RecorderOutcomeKey) => {
    setChosenOutcome(key);
    const choice = OUTCOME_CHOICES.find(c => c.key === key)!;
    // Pre-fill wizard state
    setWizardLoName(currentLoName || "");
    setWizardBorrower(borrowerName);
    setWizardTransferType(choice.transferType ?? "");
    setWizardScheduled("");
    setWizardNotes("");
    setStep("wizard");
  };

  const outcomeChoice = chosenOutcome ? OUTCOME_CHOICES.find(c => c.key === chosenOutcome)! : null;
  const needsLo = outcomeChoice && (outcomeChoice.outcomeType === "transfer" || outcomeChoice.outcomeType === "appointment");
  const needsScheduled = outcomeChoice && (outcomeChoice.outcomeType === "appointment" || outcomeChoice.outcomeType === "callback_requested" || outcomeChoice.key === "transfer_appointment");
  const needsTransferConfirm = outcomeChoice && outcomeChoice.outcomeType === "transfer";

  const resolvedLoId = useMemo(() => {
    if (!wizardLoName) return null;
    const name = wizardLoName.trim().toLowerCase();
    const match = (Array.isArray(loanOfficers) ? loanOfficers : []).find((lo: any) => {
      const full = (lo.fullName ?? lo.full_name ?? "").toLowerCase();
      return full === name;
    });
    return match?.id ?? null;
  }, [wizardLoName, loanOfficers]);

  const canProceedFromWizard = () => {
    if (needsLo && !resolvedLoId) return false;
    if (needsScheduled && !wizardScheduled) return false;
    if (needsTransferConfirm && wizardTransferType !== "direct" && wizardTransferType !== "appointment") return false;
    if (!wizardBorrower.trim()) return false;
    return true;
  };

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!outcomeChoice) throw new Error("No outcome selected");
      const payload: Record<string, unknown> = {
        date: new Date().toISOString().split("T")[0],
        assistantId: 1,
        outcomeType: outcomeChoice.outcomeType,
        borrowerName: wizardBorrower.trim(),
        notes: wizardNotes.trim(),
      };
      if (needsLo) {
        payload.loId = resolvedLoId;
      }
      if (needsTransferConfirm) {
        payload.transferType = wizardTransferType;
      }
      if (outcomeChoice.outcomeType === "appointment" && wizardScheduled) {
        payload.appointmentDatetime = wizardScheduled;
      }
      if (outcomeChoice.outcomeType === "callback_requested" && wizardScheduled) {
        // Preserve full datetime so reminders can trigger at the requested time.
        payload.followUpDate = wizardScheduled;
      }
      if (outcomeChoice.key === "transfer_appointment" && wizardScheduled) {
        payload.appointmentDatetime = wizardScheduled;
      }
      return apiRequest("POST", "/api/outcomes", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/outcomes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leaderboard"] });
      toast({ title: "Call logged to history" });
      setStep("idle");
      setChosenOutcome(null);
      setWizardLoName("");
      setWizardScheduled("");
      setWizardTransferType("");
      setWizardNotes("");
      setWizardBorrower("");
      onBorrowerNameChange("");
      onStartRecording(false);
    },
    onError: (e: any) => toast({ title: "Failed to log call", description: e?.message, variant: "destructive" }),
  });

  if (step === "idle") {
    return (
      <Card className="border-2 border-dashed border-primary/30">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-2"><Radio className="w-4 h-4 text-primary" /></div>
            <div>
              <p className="text-sm font-semibold">Ready to call</p>
              <p className="text-xs text-muted-foreground">Start the call to begin recording for call history.</p>
            </div>
          </div>
          <Button size="sm" className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleStart} data-testid="script-start-call">
            <Play className="w-3.5 h-3.5" /> Start Call
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === "verify") {
    const prettyOutcome = outcomeChoice?.label ?? "";
    return (
      <Card className="border-2 border-primary/40">
        <CardContent className="p-5 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Call Summary</p>
            <div className="my-2 h-px bg-border" />
            <dl className="text-sm space-y-1.5">
              <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Borrower:</dt><dd className="font-medium">{wizardBorrower}</dd></div>
              <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Outcome:</dt><dd className="font-medium">{prettyOutcome}</dd></div>
              {needsLo && (
                <div className="flex gap-2"><dt className="w-24 text-muted-foreground">LO:</dt><dd className="font-medium">{wizardLoName}</dd></div>
              )}
              {needsScheduled && (
                <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Scheduled:</dt><dd className="font-medium">{new Date(wizardScheduled).toLocaleString()}</dd></div>
              )}
              <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Duration:</dt><dd className="font-medium">{formatDuration(durationMs)}</dd></div>
              {wizardNotes.trim() && (
                <div className="flex gap-2"><dt className="w-24 text-muted-foreground">Notes:</dt><dd className="font-medium whitespace-pre-wrap">"{wizardNotes.trim()}"</dd></div>
              )}
            </dl>
            <div className="my-2 h-px bg-border" />
          </div>
          <div className="flex gap-2 justify-end flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setStep("wizard")} disabled={submitMut.isPending}>
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit
            </Button>
            <Button size="sm" onClick={() => submitMut.mutate()} disabled={submitMut.isPending} data-testid="script-confirm-log">
              <Check className="w-3.5 h-3.5 mr-1.5" /> {submitMut.isPending ? "Logging…" : "Confirm & Log"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "wizard") {
    return (
      <Card className="border-2 border-primary/30">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Complete call details</p>
            <span className="text-xs text-muted-foreground">{outcomeChoice?.label}</span>
          </div>
          <div className="space-y-2.5">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Borrower name</label>
              <Input value={wizardBorrower} onChange={e => setWizardBorrower(e.target.value)} className="h-9 text-sm mt-1" />
            </div>
            {needsLo && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  LO <span className="text-rose-500">*</span>
                </label>
                <Select value={wizardLoName || undefined} onValueChange={v => setWizardLoName(v)}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Select LO" /></SelectTrigger>
                  <SelectContent>
                    {loDropdownOptions.map(opt => (
                      <SelectItem key={opt.name} value={opt.name}>{opt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {wizardLoName && !resolvedLoId && (
                  <p className="text-[11px] text-rose-600 mt-1">Could not match "{wizardLoName}" to an active LO.</p>
                )}
              </div>
            )}
            {needsTransferConfirm && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Transfer type <span className="text-rose-500">*</span>
                </label>
                <Select value={wizardTransferType || undefined} onValueChange={v => setWizardTransferType(v as any)}>
                  <SelectTrigger className="h-9 text-sm mt-1"><SelectValue placeholder="Direct or Appointment" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="appointment">Appointment / Callback</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {needsScheduled && (
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Scheduled date/time <span className="text-rose-500">*</span>{" "}
                  <span className="normal-case font-normal text-[10px] text-muted-foreground/70">
                    ({Intl.DateTimeFormat().resolvedOptions().timeZone})
                  </span>
                </label>
                <Input type="datetime-local" value={wizardScheduled} onChange={e => setWizardScheduled(e.target.value)} className="h-9 text-sm mt-1" />
              </div>
            )}
            <div>
              <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes (optional)</label>
              <Textarea value={wizardNotes} onChange={e => setWizardNotes(e.target.value)} rows={2} className="text-sm mt-1" placeholder="Anything worth remembering…" />
            </div>
          </div>
          <div className="flex gap-2 justify-end flex-wrap pt-1">
            <Button size="sm" variant="ghost" onClick={handleCancel}>Cancel</Button>
            <Button size="sm" variant="outline" onClick={() => setStep("recording")}>Back</Button>
            <Button size="sm" disabled={!canProceedFromWizard()} onClick={() => setStep("verify")}>
              Review <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // step === "recording"
  return (
    <Card className="border-2 border-emerald-500/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Recording</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDuration(durationMs)}
            </span>
          </div>
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={handleCancel}>
            <Square className="w-3 h-3 mr-1" /> Cancel
          </Button>
        </div>
        <div>
          <p className="text-sm font-semibold mb-2">How did the call end?</p>
          <div className="flex flex-wrap gap-2">
            {OUTCOME_CHOICES.map(choice => (
              <button
                key={choice.key}
                onClick={() => handleOutcomePick(choice.key)}
                className={`px-3 py-2 rounded-full text-xs font-semibold border shadow-sm transition-all hover:scale-105 active:scale-95 ${choice.btn}`}
                data-testid={`script-outcome-${choice.key}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function CallScriptPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = (user as any)?.isAdmin;
  const userId = (user as any)?.id;

  const [view, setView] = useState<"run" | "edit" | "flowchart">("run");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => { markStep(userId, "view_script"); }, [userId]);
  useEffect(() => { document.title = "Scripts · WCLCC"; }, []);

  // ── Placeholder state ────────────────────────────────────────────────────
  const [timezone, setTimezone] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("clr_script_timezone");
      if (saved && TIMEZONE_OPTIONS.some(o => o.value === saved)) return saved;
    } catch {}
    return detectDefaultTimezone();
  });
  useEffect(() => {
    try { localStorage.setItem("clr_script_timezone", timezone); } catch {}
  }, [timezone]);

  const [borrowerName, setBorrowerName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);

  const handleStartRecording = (started: boolean) => {
    if (started) {
      setIsRecording(true);
      setRecordingStartedAt(Date.now());
    } else {
      setIsRecording(false);
      setRecordingStartedAt(null);
    }
  };

  // Re-compute time-of-day once per minute so it drifts between buckets mid-session
  const [timeTick, setTimeTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTimeTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch today's assignments to resolve [lo name]
  const { data: todayAssignments = [] } = useQuery<any[]>({
    queryKey: ["/api/assignments/today"],
    queryFn: () => fetch("/api/assignments/today", { credentials: "include" }).then(r => r.ok ? r.json() : []),
  });

  // Fallback: all active LOs if no assignments today
  const { data: allLoanOfficers = [] } = useQuery<any[]>({
    queryKey: ["/api/loan-officers"],
  });

  const loDropdownOptions: { name: string; source: "assigned" | "active" }[] = useMemo(() => {
    const assigned = (Array.isArray(todayAssignments) ? todayAssignments : [])
      .map((a: any) => a?.lo?.fullName ?? a?.lo?.full_name)
      .filter((n: string | undefined): n is string => !!n && n.trim().length > 0);
    if (assigned.length > 0) {
      return Array.from(new Set(assigned)).map(name => ({ name, source: "assigned" as const }));
    }
    const active = (Array.isArray(allLoanOfficers) ? allLoanOfficers : [])
      .filter((lo: any) => (lo.internalStatus ?? lo.internal_status) === "active")
      .map((lo: any) => lo.fullName ?? lo.full_name)
      .filter((n: string | undefined): n is string => !!n && n.trim().length > 0);
    return Array.from(new Set(active)).map(name => ({ name, source: "active" as const }));
  }, [todayAssignments, allLoanOfficers]);

  const hasAssignedToday = useMemo(
    () => Array.isArray(todayAssignments) && todayAssignments.some((a: any) => (a?.lo?.fullName ?? a?.lo?.full_name)),
    [todayAssignments],
  );

  // LO selection state. Initial value derives from stored override or first assignment.
  // Special sentinel "__manual__" means the user chose "Other (type manually)".
  const [loSelection, setLoSelection] = useState<string>("");
  const [manualLoName, setManualLoName] = useState<string>("");
  const [loInitialized, setLoInitialized] = useState(false);

  useEffect(() => {
    if (loInitialized) return;
    if (!user) return;
    const u = user as any;
    const stored = (u.scriptLoOverride ?? "").trim();
    if (stored && loDropdownOptions.some(o => o.name === stored)) {
      setLoSelection(stored);
    } else if (stored) {
      setLoSelection("__manual__");
      setManualLoName(stored);
    } else if (loDropdownOptions.length > 0) {
      setLoSelection(loDropdownOptions[0].name);
    }
    setLoInitialized(true);
  }, [user, loDropdownOptions, loInitialized]);

  // Persist LO override to server when it changes (debounced via mutation on commit)
  const loSaveMut = useMutation({
    mutationFn: (loName: string | null) =>
      apiRequest("PATCH", `/api/users/${(user as any)?.id}`, {
        scriptLoOverride: loName && loName.trim() ? loName.trim() : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const effectiveLoName: string = useMemo(() => {
    if (loSelection === "__manual__") return manualLoName.trim();
    if (loSelection) return loSelection;
    // fallback: first assignment → stored override
    const first = Array.isArray(todayAssignments) && todayAssignments.length > 0 ? todayAssignments[0] : null;
    const firstName = first?.lo?.fullName ?? first?.lo?.full_name ?? "";
    const stored = ((user as any)?.scriptLoOverride ?? "").trim();
    return firstName || stored || "";
  }, [loSelection, manualLoName, todayAssignments, user]);

  const handleLoSelect = (value: string) => {
    setLoSelection(value);
    if (value === "__manual__") {
      // don't save until manual text typed + committed
      return;
    }
    loSaveMut.mutate(value);
  };

  const handleManualCommit = () => {
    const v = manualLoName.trim();
    loSaveMut.mutate(v || null);
  };

  const placeholders: PlaceholderValues = useMemo(() => {
    const u = user as any;
    const scriptNameOverride = (u?.scriptNameOverride ?? "").trim();
    const scriptCompany = (u?.scriptCompanyName ?? "").trim();
    return {
      yourName: scriptNameOverride || u?.name || "",
      loName: effectiveLoName || "your loan officer",
      company: scriptCompany || "West Capital Lending",
      borrowerName: borrowerName.trim(),
      timeOfDay: computeTimeOfDay(timezone),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, effectiveLoName, borrowerName, timezone, timeTick]);

  // Load defaults, personal script, and all scripts (for browsing across CLRs)
  const { data: defaults = [], isLoading: loadingDefaults } = useQuery<CallScript[]>({
    queryKey: ["/api/call-scripts/defaults"],
  });
  const { data: myScript, isLoading: loadingMine } = useQuery<CallScript | null>({
    queryKey: ["/api/call-scripts/mine"],
  });
  const { data: allScripts = [], isLoading: loadingAll } = useQuery<CallScript[]>({
    queryKey: ["/api/call-scripts"],
  });

  const isLoading = loadingDefaults || loadingMine || loadingAll;
  const defaultScript = defaults[0] ?? null;

  // Selected script — defaults to personal copy if exists, else default
  const [selectedScriptId, setSelectedScriptId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedScriptId != null) return;
    const initial = myScript?.id ?? defaultScript?.id ?? null;
    if (initial != null) setSelectedScriptId(initial);
  }, [myScript?.id, defaultScript?.id, selectedScriptId]);

  // Resolve the active script from the selection
  const activeScript: CallScript | null = useMemo(() => {
    if (selectedScriptId == null) return myScript ?? defaultScript ?? null;
    return allScripts.find(s => s.id === selectedScriptId) ?? myScript ?? defaultScript ?? null;
  }, [selectedScriptId, allScripts, myScript, defaultScript]);

  const hasPersonalCopy = !!myScript;
  const isUsingDefault = activeScript ? activeScript.owner_id == null : !hasPersonalCopy;
  const isMine = !!(activeScript && myScript && activeScript.id === myScript.id);
  const canEditActive = !!activeScript && (isAdmin || isMine);

  // Clone default → personal copy
  const cloneMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/call-scripts/${defaultScript!.id}/clone`, {}),
    onSuccess: (newScript: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts/defaults"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts"] });
      if (newScript?.id) setSelectedScriptId(newScript.id);
      toast({ title: "Personal copy created", description: "You can now customize your own script." });
      setView("edit");
    },
    onError: () => toast({ title: "Failed to create copy", variant: "destructive" }),
  });

  // Reset personal copy → back to default
  const resetMut = useMutation({
    mutationFn: () => fetch("/api/call-scripts/mine", { method: "DELETE", credentials: "include" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts/mine"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts"] });
      if (defaultScript?.id) setSelectedScriptId(defaultScript.id);
      setConfirmReset(false);
      setView("run");
      toast({ title: "Reset to default script" });
    },
    onError: () => toast({ title: "Failed to reset", variant: "destructive" }),
  });

  return (
    <PlaceholderContext.Provider value={placeholders}>
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <PageTooltip pageKey="call-script" title="Call Script">
        Your personal call script with guided responses. Customize your own copy or use the default.
      </PageTooltip>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <PhoneCall className="w-5 h-5 text-primary" /> Call Script
            <HelpIcon title="Call Script">
              Your personal call script with guided responses. Customize your own copy or use the default.
            </HelpIcon>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Step-by-step guided script with borrower response paths</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant={view === "run" ? "default" : "outline"} className="gap-1.5" onClick={() => setView("run")}>
            <PhoneCall className="w-3.5 h-3.5" /> Run
          </Button>
          <Button size="sm" variant={view === "flowchart" ? "default" : "outline"} className="gap-1.5" onClick={() => setView("flowchart")}>
            <GitBranch className="w-3.5 h-3.5" /> Flowchart
          </Button>
          <Button
            size="sm"
            variant={view === "edit" ? "default" : "outline"}
            className="gap-1.5"
            onClick={() => {
              // If viewing the default and user has no personal copy, cloning gives them an editable script.
              if (!canEditActive && isUsingDefault && !isAdmin && !hasPersonalCopy) {
                cloneMut.mutate();
              } else {
                setView("edit");
              }
            }}
            disabled={cloneMut.isPending || (!canEditActive && !(isUsingDefault && !isAdmin && !hasPersonalCopy))}
            title={!canEditActive ? "You don't have permission to edit this script" : undefined}
          >
            {canEditActive ? <Pencil className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {cloneMut.isPending ? "Copying…" : canEditActive ? "Edit Script" : (isUsingDefault && !isAdmin && !hasPersonalCopy ? "Customize My Copy" : "View Only")}
          </Button>
        </div>
      </div>

      {/* Placeholder controls: timezone + borrower name */}
      <Card className="border-dashed">
        <CardContent className="p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Timezone:</label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger className="h-8 text-xs w-44" data-testid="script-timezone-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map(tz => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground">
              Greeting: <span className="text-teal-500 font-medium">{placeholders.timeOfDay}</span>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Borrower name:</label>
            <Input
              value={borrowerName}
              onChange={e => setBorrowerName(e.target.value)}
              placeholder="Enter borrower's first name"
              className={`h-8 text-sm w-56 ${isRecording && !borrowerName.trim() ? "ring-2 ring-emerald-500 border-emerald-500" : ""}`}
              data-testid="script-borrower-name"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">
              {hasAssignedToday ? "Today's LO:" : "LO (no assignments today):"}
            </label>
            {loDropdownOptions.length > 0 ? (
              <Select value={loSelection || undefined} onValueChange={handleLoSelect}>
                <SelectTrigger className="h-8 text-sm w-56" data-testid="script-lo-select">
                  <SelectValue placeholder="Select LO" />
                </SelectTrigger>
                <SelectContent>
                  {loDropdownOptions.map(opt => (
                    <SelectItem key={opt.name} value={opt.name}>{opt.name}</SelectItem>
                  ))}
                  <SelectItem value="__manual__">Other (type manually)…</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={manualLoName}
                onChange={e => setManualLoName(e.target.value)}
                onBlur={handleManualCommit}
                placeholder="Enter LO name"
                className="h-8 text-sm w-56"
                data-testid="script-lo-manual"
              />
            )}
            {loSelection === "__manual__" && (
              <Input
                value={manualLoName}
                onChange={e => setManualLoName(e.target.value)}
                onBlur={handleManualCommit}
                placeholder="Type LO name"
                className="h-8 text-sm w-48"
                data-testid="script-lo-manual-text"
              />
            )}
            <span className="text-[11px] text-muted-foreground">
              Fills <code>[lo name]</code> in script
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Script selector */}
      {!isLoading && allScripts.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide shrink-0">Script:</label>
              <Select
                value={selectedScriptId != null ? String(selectedScriptId) : ""}
                onValueChange={(v) => setSelectedScriptId(parseInt(v))}
              >
                <SelectTrigger className="h-8 text-xs w-full max-w-sm">
                  <SelectValue placeholder="Select a script" />
                </SelectTrigger>
                <SelectContent>
                  {(() => {
                    const mine = myScript ? [myScript] : [];
                    const defaultsGlobal = allScripts.filter(s => s.owner_id == null);
                    const others = allScripts.filter(s => s.owner_id != null && (!myScript || s.id !== myScript.id));
                    return (
                      <>
                        {mine.map(s => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            <span className="flex items-center gap-1.5">
                              <User className="w-3 h-3 text-emerald-600" />
                              <span>My Script — {s.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                        {defaultsGlobal.map(s => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            <span className="flex items-center gap-1.5">
                              <Globe className="w-3 h-3 text-blue-600" />
                              <span>Default — {s.name}</span>
                              {!isAdmin && <Lock className="w-3 h-3 text-muted-foreground" />}
                            </span>
                          </SelectItem>
                        ))}
                        {others.map(s => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            <span className="flex items-center gap-1.5">
                              <Users className="w-3 h-3 text-muted-foreground" />
                              <span>{s.owner_name ? `${s.owner_name}'s Script` : s.name}</span>
                              {!isAdmin && <Lock className="w-3 h-3 text-muted-foreground" />}
                            </span>
                          </SelectItem>
                        ))}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
              {!canEditActive && activeScript && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Lock className="w-3 h-3" /> read-only
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Script source badge + controls */}
      {!isLoading && activeScript && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            {isMine ? (
              <Badge variant="outline" className="gap-1 text-xs border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400">
                <User className="w-3 h-3" /> My Personal Script
              </Badge>
            ) : isUsingDefault ? (
              <Badge variant="outline" className="gap-1 text-xs border-blue-300 text-blue-600 dark:border-blue-700 dark:text-blue-400">
                <Globe className="w-3 h-3" /> Default Script
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-xs border-muted-foreground/40 text-muted-foreground">
                <Users className="w-3 h-3" /> {activeScript.owner_name ? `${activeScript.owner_name}'s Script` : "Other CLR's Script"}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">{activeScript.name}</span>
          </div>
          <div className="flex gap-2">
            {isUsingDefault && !isAdmin && !hasPersonalCopy && defaultScript && (
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => cloneMut.mutate()} disabled={cloneMut.isPending}>
                <CopyIcon className="w-3 h-3" /> {cloneMut.isPending ? "Copying…" : "Customize My Copy"}
              </Button>
            )}
            {hasPersonalCopy && isMine && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-destructive" onClick={() => setConfirmReset(true)}>
                <RotateCcw className="w-3 h-3" /> Reset to Default
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <div className="flex gap-3"><Skeleton className="h-12 flex-1 rounded-full" /><Skeleton className="h-12 flex-1 rounded-full" /></div>
        </div>
      )}

      {/* No script at all */}
      {!isLoading && !activeScript && (
        <Card className="border-dashed">
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <div className="rounded-full bg-primary/10 p-4"><PhoneCall className="w-8 h-8 text-primary opacity-40" /></div>
            <div>
              <p className="font-semibold">No script available</p>
              <p className="text-sm text-muted-foreground mt-1">An admin needs to create the default script first.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin editing the shared Default Script — warn that changes apply globally */}
      {!isLoading && activeScript && isAdmin && isUsingDefault && view === "edit" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 px-4 py-3 flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            You are editing the <strong>Default Script</strong> — changes apply to every user who hasn't made a personal copy.
          </span>
        </div>
      )}

      {/* Main content */}
      {!isLoading && activeScript && (
        view === "run"
          ? (
            <>
              <CallRecorder
                borrowerName={borrowerName}
                onBorrowerNameChange={setBorrowerName}
                loDropdownOptions={loDropdownOptions}
                currentLoName={effectiveLoName}
                onStartRecording={handleStartRecording}
                isRecording={isRecording}
                recordingStartedAt={recordingStartedAt}
              />
              <ScriptRunner key={activeScript.id} scriptId={activeScript.id} />
            </>
          )
          : view === "flowchart"
            ? <ScriptFlowchart key={activeScript.id} scriptId={activeScript.id} />
            : <NodeEditor key={activeScript.id} scriptId={activeScript.id} onClose={() => setView("run")} canEdit={canEditActive} />
      )}

      {isRecording && view === "run" && (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-1.5 bg-emerald-500/90 text-white text-xs font-semibold px-2.5 py-1 rounded-full shadow-lg">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
          Recording
        </div>
      )}

      {/* Reset confirmation */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default Script?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your personal script and restore the default WCL script. You can always customize it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetMut.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {resetMut.isPending ? "Resetting…" : "Yes, Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </PlaceholderContext.Provider>
  );
}
