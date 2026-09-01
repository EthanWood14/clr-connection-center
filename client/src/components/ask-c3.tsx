/**
 * ask-c3.tsx — the "Ask C3" assistant: a floating launcher plus a dialog that
 * streams answers from POST /api/ask-c3 over SSE.
 *
 * Ported from LeadVault's Ask bar. The stream reader treats an error-status
 * result frame as the ApiError it would have been on a plain JSON response —
 * parsing one as an answer collapses every real error into nonsense. History
 * is kept client-side (last few turns) and replayed with each question.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Send, X, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";

// ── The Ask C3 mark ──────────────────────────────────────────────────────────
// A custom-drawn spark: one large concave four-point star with two satellites.
// White glyph on the gradient tiles below; drawn inline so it needs no asset.
function AskC3Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M11 2c.4 5.4 2.9 7.9 8.3 8.3-5.4.4-7.9 2.9-8.3 8.3-.4-5.4-2.9-7.9-8.3-8.3C8.1 9.9 10.6 7.4 11 2Z"
        fill="currentColor"
      />
      <path
        d="M18.6 14.6c.24 2.86 1.44 4.06 4.3 4.3-2.86.24-4.06 1.44-4.3 4.3-.24-2.86-1.44-4.06-4.3-4.3 2.86-.24 4.06-1.44 4.3-4.3Z"
        fill="currentColor"
        opacity=".8"
      />
      <path
        d="M5.2 16.4c.17 2 1.01 2.84 3 3-2 .17-2.84 1.01-3 3-.17-2-1.01-2.84-3-3 2-.17 2.84-1.01 3-3Z"
        fill="currentColor"
        opacity=".55"
      />
    </svg>
  );
}

// The gradient tile behind the mark — one look everywhere Ask C3 appears.
const ASK_TILE = "bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-600 text-white";

// ── Stream protocol ──────────────────────────────────────────────────────────

type ProgressEvent =
  | { type: "run"; tier: string; model: string }
  | { type: "iteration"; iteration: number; maxIterations: number }
  | { type: "generating"; approxTokens: number }
  | { type: "tool"; name: string; ok: boolean; durationMs: number }
  | { type: "working"; elapsedMs: number };

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readAskResponse(response: globalThis.Response, onProgress: (event: ProgressEvent) => void): Promise<any> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, String(body?.message ?? body?.error ?? `Request failed (${response.status}).`));
    return body;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: any = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let eventName = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      let parsed: any;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (eventName === "progress") onProgress(parsed);
      else if (eventName === "result") {
        const status = Number(parsed?.status ?? 200);
        const body = parsed?.body ?? parsed;
        if (status >= 400) throw new ApiError(status, String(body?.message ?? body?.error ?? `Request failed (${status}).`));
        result = body;
      }
    }
  }
  if (!result) throw new Error("The answer stream ended before a result arrived.");
  return result;
}

function progressLine(event: ProgressEvent): string | null {
  switch (event.type) {
    case "run": return `Started on ${event.model}`;
    case "iteration": return event.iteration === 1
      ? "Reading your question and planning lookups…"
      : `Reasoning over the results (step ${event.iteration} of ${event.maxIterations})…`;
    case "generating": return event.approxTokens >= 50 ? `Writing the answer (~${event.approxTokens} tokens)…` : null;
    case "tool": return `${event.ok ? "Checked" : "Retried"} ${event.name.replace(/_/g, " ")} (${(event.durationMs / 1000).toFixed(1)}s)`;
    case "working": return `Still working… ${Math.round(event.elapsedMs / 1000)}s elapsed`;
    default: return null;
  }
}

// ── Markdown answer renderer (token walk, never HTML injection) ──────────────

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // No underscore-italics: snake_case identifiers (user_id) would be mangled.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      out.push(<strong key={`${keyPrefix}-b${key++}`} className="font-semibold text-foreground">{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      out.push(<code key={`${keyPrefix}-c${key++}`} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{token.slice(1, -1)}</code>);
    } else {
      out.push(<em key={`${keyPrefix}-i${key++}`}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length || out.length === 0) out.push(text.slice(cursor));
  return out;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function AnswerText({ content }: { content: string }) {
  const lines = String(content ?? "").split(/\r?\n/);
  const nodes: JSX.Element[] = [];
  let bullets: string[] = [];
  let numbered: string[] = [];

  const flushBullets = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    nodes.push(
      <ul key={`list-${nodes.length}`} className="list-disc space-y-1 pl-5">
        {items.map((item, index) => <li key={`${index}-${item.slice(0, 30)}`}>{renderInlineMarkdown(item, `ul-${nodes.length}-${index}`)}</li>)}
      </ul>,
    );
  };
  const flushNumbered = () => {
    if (!numbered.length) return;
    const items = numbered;
    numbered = [];
    nodes.push(
      <ol key={`olist-${nodes.length}`} className="list-decimal space-y-1 pl-5">
        {items.map((item, index) => <li key={`${index}-${item.slice(0, 30)}`}>{renderInlineMarkdown(item, `ol-${nodes.length}-${index}`)}</li>)}
      </ol>,
    );
  };
  const flushLists = () => { flushBullets(); flushNumbered(); };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (line.trim().startsWith("|") && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      flushLists();
      const headers = splitTableRow(line);
      const rows: string[][] = [];
      let rowIndex = index + 2;
      while (rowIndex < lines.length && lines[rowIndex].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[rowIndex]));
        rowIndex++;
      }
      nodes.push(
        <div key={`table-${index}`} className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                {headers.map((cell, cellIndex) => <th key={cellIndex} className="py-1.5 pr-3 font-medium">{renderInlineMarkdown(cell, `th-${index}-${cellIndex}`)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="border-b border-border/30 last:border-0">
                  {headers.map((_, cellIndex) => (
                    <td key={cellIndex} className="py-1.5 pr-3 align-top">{renderInlineMarkdown(row[cellIndex] ?? "", `td-${index}-${rowIdx}-${cellIndex}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      index = rowIndex - 1;
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet) { flushNumbered(); bullets.push(bullet[1]); continue; }
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) { flushBullets(); numbered.push(ordered[1]); continue; }
    flushLists();
    if (!line.trim()) {
      nodes.push(<div key={`space-${index}`} aria-hidden="true" className="h-2" />);
      continue;
    }
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      nodes.push(<h3 key={`heading-${index}`} className="font-semibold text-foreground">{renderInlineMarkdown(heading[1], `h-${index}`)}</h3>);
      continue;
    }
    nodes.push(<p key={`line-${index}`} className="whitespace-pre-wrap">{renderInlineMarkdown(line, `p-${index}`)}</p>);
  }
  flushLists();
  return <div className="space-y-1.5 text-sm leading-relaxed">{nodes}</div>;
}

// ── The dialog ───────────────────────────────────────────────────────────────

type Tier = { id: string; label: string; blurb: string };
type Turn = { question: string; answer?: string; error?: string; model?: string; stoppedReason?: string };

const FALLBACK_TIERS: Tier[] = [
  { id: "medium", label: "Sonnet 5", blurb: "Balanced (default)" },
  { id: "opus", label: "Opus 5", blurb: "Deep analysis" },
  { id: "max", label: "Fable 5", blurb: "Deepest analysis" },
  { id: "low", label: "Haiku 4.5", blurb: "Quick" },
];

export function AskC3() {
  const { user } = useAuth() as any;
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [tier, setTier] = useState("medium");
  const [tiers, setTiers] = useState<Tier[]>(FALLBACK_TIERS);
  const [tierMenuOpen, setTierMenuOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState(0);
  const [activityLog, setActivityLog] = useState<Array<{ t: string; line: string }>>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/ask-c3/tiers", { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (Array.isArray(data?.tiers) && data.tiers.length) setTiers(data.tiers); })
      .catch(() => {});
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    // Follow the stream only while the user is already at the bottom -
    // yanking the view on every progress frame makes scrollback impossible.
    if (autoScrollRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, pending, liveStatus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Demo orgs are read-only server-side (every POST 403s), so the launcher
  // would only produce error bubbles there - hide it.
  if (!user || (user as any).isDemo) return null;

  const close = () => {
    abortRef.current?.abort();
    setTierMenuOpen(false);
    setOpen(false);
  };

  const submit = async () => {
    const q = question.trim();
    if (!q || pending) return;
    setQuestion("");
    setPending(true);
    setLiveStatus(null);
    setToolCount(0);
    setActivityLog([]);
    setTurns((prev) => [...prev, { question: q }]);

    // Replay the last few completed turns as history.
    const history = turns
      .filter((turn) => turn.answer)
      .slice(-3)
      .flatMap((turn) => [
        { role: "user" as const, content: turn.question },
        { role: "assistant" as const, content: turn.answer as string },
      ]);

    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const response = await fetch("/api/ask-c3", {
        method: "POST",
        signal: abort.signal,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, tier, history, requestId: window.crypto?.randomUUID?.() ?? String(Date.now()) }),
      });
      const result = await readAskResponse(response, (event) => {
        if (event.type === "tool") setToolCount((count) => count + 1);
        const line = progressLine(event);
        if (line) {
          setLiveStatus(line);
          setActivityLog((log) => (log.length && log[log.length - 1].line === line)
            ? log
            : [...log.slice(-59), { t: new Date().toLocaleTimeString(), line }]);
        }
      });
      setTurns((prev) => prev.map((turn, index) => index === prev.length - 1
        ? { ...turn, answer: String(result?.answer ?? ""), model: String(result?.model ?? ""), stoppedReason: String(result?.stoppedReason ?? "end_turn") }
        : turn));
    } catch (error: any) {
      const message = error?.name === "AbortError"
        ? "Stopped."
        : String(error?.message ?? "Ask C3 could not finish this request.");
      setTurns((prev) => prev.map((turn, index) => index === prev.length - 1
        ? { ...turn, error: message }
        : turn));
    } finally {
      abortRef.current = null;
      setPending(false);
      setLiveStatus(null);
    }
  };

  const activeTier = tiers.find((entry) => entry.id === tier) ?? tiers[0];

  const dialog = open ? createPortal(
    <div className="fixed inset-0 z-[10000] flex items-end justify-center p-2 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Ask C3" data-testid="ask-c3-dialog">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div className="relative flex h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:h-[75vh]">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg shadow-sm ${ASK_TILE}`}>
            <AskC3Mark className="h-4 w-4" />
          </span>
          <div className="flex-1 font-semibold">Ask C3</div>
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              onClick={() => setTierMenuOpen((state) => !state)}
              data-testid="ask-c3-tier-button"
            >
              {activeTier?.label ?? "Model"}
              <ChevronDown className="h-3 w-3" />
            </button>
            {tierMenuOpen && (
              <div className="fixed inset-0 z-[5]" onClick={() => setTierMenuOpen(false)} aria-hidden="true" />
            )}
            {tierMenuOpen && (
              <div className="absolute right-0 top-8 z-10 w-52 rounded-md border bg-popover p-1 shadow-md">
                {tiers.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted ${entry.id === tier ? "bg-muted" : ""}`}
                    onClick={() => { setTier(entry.id); setTierMenuOpen(false); }}
                    data-testid={`ask-c3-tier-${entry.id}`}
                  >
                    <span className="font-medium text-foreground">{entry.label}</span>
                    <span className="text-muted-foreground">{entry.blurb}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close} data-testid="ask-c3-close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3"
          onScroll={() => {
            const el = scrollRef.current;
            if (el) autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          }}
        >
          {turns.length === 0 && !pending && (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <span className={`flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg shadow-indigo-500/25 ${ASK_TILE}`}>
                <AskC3Mark className="h-8 w-8" />
              </span>
              <div className="text-sm font-medium text-foreground">Ask anything about C3 data</div>
              <div className="max-w-sm text-xs">
                Transfers, appointments, the leaderboard, EOD reports, check-ins, LO performance, assignments, prospects, comp requests…
              </div>
            </div>
          )}
          <div className="space-y-4">
            {turns.map((turn, index) => (
              <div key={index} className="space-y-2">
                <div className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {turn.question}
                  </div>
                </div>
                {turn.answer != null && (
                  <div className="rounded-2xl rounded-tl-sm border bg-card px-3 py-2.5 shadow-sm">
                    <AnswerText content={turn.answer} />
                    {turn.stoppedReason && turn.stoppedReason !== "end_turn" && (
                      <div className="mt-2 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-600 dark:text-amber-400">
                        {turn.stoppedReason === "max_iterations" ? "Stopped at the lookup limit - this answer may be partial."
                          : turn.stoppedReason === "deadline" ? "Ran out of time - this answer may be partial."
                          : turn.stoppedReason === "max_output_tokens" ? "Hit the length limit - this answer may be cut off."
                          : `Stopped early (${turn.stoppedReason}) - this answer may be partial.`}
                      </div>
                    )}
                    {turn.model ? <div className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{turn.model}</div> : null}
                  </div>
                )}
                {turn.error != null && (
                  <div className="rounded-2xl rounded-tl-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {turn.error}
                  </div>
                )}
              </div>
            ))}
            {pending && (
              <div className="space-y-2" data-testid="ask-c3-progress">
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border bg-card px-3 py-2.5 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{liveStatus ?? "Checking C3 data…"}</span>
                  {toolCount > 0 && <span className="text-xs">· {toolCount} lookup{toolCount === 1 ? "" : "s"} done</span>}
                </div>
                {activityLog.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                    {activityLog.map((entry, index) => (
                      <div key={index} className="flex gap-2">
                        <span className="shrink-0 tabular-nums opacity-60">{entry.t}</span>
                        <span>{entry.line}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div ref={bottomRef} />
        </div>

        <form
          className="flex items-end gap-2 border-t px-3 py-3"
          onSubmit={(event) => { event.preventDefault(); void submit(); }}
        >
          <Textarea
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="e.g. Who has the most transfers this month?"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none"
            rows={1}
            data-testid="ask-c3-input"
          />
          {pending ? (
            <Button type="button" size="icon" variant="destructive" onClick={() => abortRef.current?.abort()} title="Stop" data-testid="ask-c3-stop">
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" size="icon" disabled={!question.trim()} data-testid="ask-c3-send">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group fixed bottom-20 right-4 z-[80] flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-white/25 shadow-lg shadow-indigo-500/40 transition-all duration-200 hover:scale-105 hover:shadow-xl hover:shadow-indigo-500/50 active:scale-95 md:bottom-6 md:right-6 ${ASK_TILE}`}
        title="Ask C3"
        data-testid="ask-c3-launcher"
      >
        {/* top sheen so the tile reads as glass, matching the app shell */}
        <span className="pointer-events-none absolute inset-x-1 top-0.5 h-1/3 rounded-t-[14px] bg-gradient-to-b from-white/40 to-transparent" aria-hidden="true" />
        <AskC3Mark className="h-6 w-6 drop-shadow-sm transition-transform duration-200 group-hover:rotate-12" />
      </button>
      {dialog}
    </>
  );
}
