import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Mic, Send, Sparkles, X, Volume2, VolumeX, Loader2, Bot, User as UserIcon, Check,
} from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

// Browser speech recognition (Chrome/Edge). Gracefully absent elsewhere.
function getRecognition(): any {
  const w = window as any;
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!SR) return null;
  const r = new SR();
  r.continuous = false;
  r.interimResults = true;
  r.lang = "en-US";
  return r;
}

export function ScriptCoach({ open, onClose, onBuilt, mode = "create" }: { open: boolean; onClose: () => void; onBuilt?: (script: any) => void; mode?: "create" | "refine" }) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [speak, setSpeak] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function say(text: string) {
    if (!speak || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1;
      window.speechSynthesis.speak(u);
    } catch {}
  }

  async function refreshCoverage(msgs: Msg[]) {
    try {
      const cov: any = await apiRequest("POST", "/api/script-coach/coverage", { messages: msgs });
      if (cov && Array.isArray(cov.stages)) setCoverage(cov);
    } catch {}
  }

  async function sendToCoach(history: Msg[]) {
    setThinking(true);
    try {
      const data: any = await apiRequest("POST", "/api/script-coach/chat", { messages: history, mode });
      const reply = String(data?.reply ?? "");
      const updated: Msg[] = [...history, { role: "assistant", content: reply }];
      setMessages(updated);
      say(reply);
      refreshCoverage(updated);
    } catch (e: any) {
      const msg = e?.message ?? "The coach is unavailable right now.";
      setMessages(m => [...m, { role: "assistant", content: msg }]);
    } finally {
      setThinking(false);
    }
  }

  // Status + intro on open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s: any = await apiRequest("GET", "/api/script-coach/status");
        if (!cancelled) setEnabled(!!s?.enabled);
        if (!cancelled && s?.enabled && messages.length === 0) {
          await sendToCoach([]);
        }
      } catch { if (!cancelled) setEnabled(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, thinking]);

  // Stop voices when closing
  useEffect(() => {
    if (!open) {
      try { recRef.current?.stop?.(); } catch {}
      try { window.speechSynthesis?.cancel?.(); } catch {}
      setListening(false);
    }
  }, [open]);

  function handleSend() {
    const text = input.trim();
    if (!text || thinking) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    sendToCoach(next);
  }

  function toggleMic() {
    if (listening) { try { recRef.current?.stop?.(); } catch {} setListening(false); return; }
    const rec = getRecognition();
    if (!rec) return;
    recRef.current = rec;
    let finalText = "";
    rec.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      setInput((finalText + " " + interim).trim());
    };
    rec.onend = () => { setListening(false); };
    rec.onerror = () => { setListening(false); };
    try { rec.start(); setListening(true); } catch {}
  }

  const buildMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/script-coach/build", { messages, mode }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts/mine"] });
      toast({ title: "Your script is ready! 🎉", description: "We saved it as your personal script. Opening it now." });
      try { window.speechSynthesis?.cancel?.(); } catch {}
      onBuilt?.(data?.script);
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not generate", description: e?.message ?? "Try chatting a bit more, then retry.", variant: "destructive" }),
  });

  if (!open) return null;
  const canBuild = messages.filter(m => m.role === "user").length >= 1 && !buildMut.isPending;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg h-[85vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl bg-[#0F182D] border border-white/10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
              <Sparkles className="w-5 h-5" style={{ color: "#C49A3C" }} />
            </div>
            <div>
              <h2 className="text-white font-bold text-base leading-tight">Build Your Script with Coach</h2>
              <p className="text-white/50 text-xs">Talk it out — I will help you craft and polish it.</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setSpeak(s => !s)} title={speak ? "Mute coach voice" : "Unmute coach voice"} className="text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/10">
              {speak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button onClick={onClose} title="Close" className="text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/10">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {enabled === false && (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-amber-200 text-sm">
              The AI coach is not set up yet. An admin can add an Anthropic API key in Settings → Email/AI to enable it.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={"flex gap-2 " + (m.role === "user" ? "justify-end" : "justify-start")}>
              {m.role === "assistant" && (
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-[#C49A3C]" />
                </div>
              )}
              <div className={"max-w-[78%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap leading-relaxed " + (m.role === "user" ? "bg-[#C49A3C] text-[#1A2B4A] font-medium" : "bg-white/[0.07] text-white/90")}>
                {m.content}
              </div>
              {m.role === "user" && (
                <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                  <UserIcon className="w-4 h-4 text-white/70" />
                </div>
              )}
            </div>
          ))}
          {thinking && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4 text-[#C49A3C]" />
              </div>
              <div className="rounded-2xl px-3.5 py-2.5 bg-white/[0.07]">
                <Loader2 className="w-4 h-4 text-white/60 animate-spin" />
              </div>
            </div>
          )}
        </div>

        {/* Coverage / readiness */}
        {coverage && Array.isArray(coverage.stages) && (
          <div className="border-t border-white/10 px-4 py-2.5 shrink-0 bg-white/[0.02]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Script readiness</span>
              <span className="text-xs font-bold text-[#C49A3C]">{Math.round(coverage.score ?? 0)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-2">
              <div className="h-full bg-[#C49A3C] transition-all duration-500" style={{ width: Math.max(0, Math.min(100, coverage.score ?? 0)) + "%" }} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {coverage.stages.map((s: any) => (
                <span key={s.key} title={s.summary || ""} className={"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] " + (s.done ? "bg-emerald-500/20 text-emerald-300" : "bg-white/[0.06] text-white/40")}>
                  {s.done ? <Check className="w-2.5 h-2.5" /> : <span className="w-2.5 h-2.5 rounded-full border border-white/30 inline-block" />}
                  {s.label}
                </span>
              ))}
            </div>
            {coverage.nextGap && <p className="text-[11px] text-white/55 mt-1.5">👉 {coverage.nextGap}</p>}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-white/10 p-3 shrink-0 space-y-2">
          <div className="flex items-end gap-2">
            {voiceSupported && (
              <button
                onClick={toggleMic}
                disabled={thinking || enabled === false}
                title={listening ? "Stop" : "Speak"}
                className={"shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 " + (listening ? "bg-red-500 text-white animate-pulse" : "bg-white/10 text-white hover:bg-white/20")}
                data-testid="coach-mic"
              >
                <Mic className="w-5 h-5" />
              </button>
            )}
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              rows={1}
              placeholder={listening ? "Listening…" : (voiceSupported ? "Tap the mic or type…" : "Type your answer…")}
              disabled={enabled === false}
              className="flex-1 resize-none rounded-xl bg-white/[0.06] border border-white/10 text-white placeholder-white/40 text-sm px-3 py-2.5 max-h-28 focus:outline-none focus:border-[#C49A3C]/60"
              data-testid="coach-input"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || thinking || enabled === false}
              className="shrink-0 w-10 h-10 rounded-full bg-[#C49A3C] text-[#1A2B4A] flex items-center justify-center disabled:opacity-40 hover:opacity-90"
              data-testid="coach-send"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
          <Button
            onClick={() => buildMut.mutate()}
            disabled={!canBuild || enabled === false}
            className="w-full gap-2 font-semibold"
            style={{ backgroundColor: "#16a34a", color: "#fff" }}
            data-testid="coach-generate"
          >
            {buildMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate My Script</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
