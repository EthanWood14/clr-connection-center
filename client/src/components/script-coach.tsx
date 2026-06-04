import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Mic, Send, Sparkles, X, Volume2, VolumeX, Loader2, Bot, User as UserIcon, Check, Phone, PhoneOff,
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
  const [covLoading, setCovLoading] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [callState, setCallState] = useState<"speaking" | "listening" | "thinking" | "idle">("idle");
  const [caption, setCaption] = useState("");
  const callActiveRef = useRef(false);
  const [ttsProvider, setTtsProvider] = useState("browser");
  const ttsProviderRef = useRef("browser");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [draftName, setDraftName] = useState("");
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef(false);
  const voiceRef = useRef<any>(null);
  const messagesRef = useRef<Msg[]>([]);
  const thinkingRef = useRef(false);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const voiceSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function stopAudio() {
    try { if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; } } catch {}
    try { window.speechSynthesis?.cancel?.(); } catch {}
  }
  async function speakServer(text: string, onDone?: () => void) {
    try {
      stopAudio();
      const resp = await fetch("/api/script-coach/tts", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (!resp.ok) throw new Error("tts " + resp.status);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      const finish = () => { try { URL.revokeObjectURL(url); } catch {} if (audioRef.current === audio) audioRef.current = null; if (onDone) onDone(); };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch {
      browserSay(text, onDone);
    }
  }
  function browserSay(text: string, onDone?: () => void) {
    if (typeof window === "undefined" || !window.speechSynthesis) { if (onDone) onDone(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1;
      if (voiceRef.current) u.voice = voiceRef.current;
      if (onDone) { u.onend = () => onDone(); u.onerror = () => onDone(); }
      window.speechSynthesis.speak(u);
    } catch { if (onDone) onDone(); }
  }
  function say(text: string, onDone?: () => void) {
    const inCall = callActiveRef.current;
    if (!speak && !inCall) { if (onDone) onDone(); return; }
    if (ttsProviderRef.current && ttsProviderRef.current !== "browser") { speakServer(text, onDone); return; }
    browserSay(text, onDone);
  }

  // ── Phone-call mode: continuous speak <-> listen loop ──────────────────────
  function speakInCall(text: string) {
    setCallState("speaking");
    setCaption(text);
    say(text, () => { if (callActiveRef.current) startCallListen(); });
  }
  function startCallListen() {
    if (!callActiveRef.current) return;
    const rec = getRecognition();
    if (!rec) { setCallState("idle"); return; }
    recRef.current = rec;
    setCallState("listening");
    setCaption("");
    let finalText = "";
    rec.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t; else interim += t;
      }
      setCaption((finalText + " " + interim).trim());
    };
    rec.onerror = () => { if (callActiveRef.current) setTimeout(() => startCallListen(), 700); };
    rec.onend = () => {
      if (!callActiveRef.current) return;
      const said = finalText.trim();
      if (said) { setCallState("thinking"); setCaption(said); submit(said); }
      else { startCallListen(); }
    };
    try { rec.start(); } catch { setTimeout(() => { if (callActiveRef.current) startCallListen(); }, 600); }
  }
  function startCall() {
    if (!voiceSupported || typeof window === "undefined" || !window.speechSynthesis) {
      toast({ title: "Voice calls need Chrome", description: "Open this in Chrome for the call experience, or just type.", variant: "destructive" });
      return;
    }
    callActiveRef.current = true;
    setCallActive(true);
    setCaption("");
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    if (lastAssistant) speakInCall(lastAssistant.content);
    else { setCallState("thinking"); sendToCoach([]); }
  }
  function endCall() {
    callActiveRef.current = false;
    setCallActive(false);
    setCallState("idle");
    try { recRef.current?.stop?.(); } catch {}
    stopAudio();
  }

  async function refreshCoverage(msgs: Msg[]) {
    setCovLoading(true);
    try {
      const cov: any = await apiRequest("POST", "/api/script-coach/coverage", { messages: msgs });
      if (cov && Array.isArray(cov.stages)) setCoverage(cov);
    } catch {}
    finally { setCovLoading(false); }
  }

  async function sendToCoach(history: Msg[]) {
    setThinking(true);
    try {
      const data: any = await apiRequest("POST", "/api/script-coach/chat", { messages: history, mode });
      const reply = String(data?.reply ?? "");
      const updated: Msg[] = [...history, { role: "assistant", content: reply }];
      setMessages(updated);
      if (callActiveRef.current) speakInCall(reply); else say(reply);
    } catch (e: any) {
      const msg = e?.message ?? "The coach is unavailable right now.";
      setMessages(m => [...m, { role: "assistant", content: msg }]);
      if (callActiveRef.current) speakInCall(msg);
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
        if (!cancelled) {
          setEnabled(!!s?.enabled);
          const tp = s?.ttsProvider || "browser";
          setTtsProvider(tp);
          ttsProviderRef.current = tp;
        }
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
      stopAudio();
      setListening(false);
      setDraft(null);
      callActiveRef.current = false;
      setCallActive(false);
      setCallState("idle");
    }
  }, [open]);

  // Keep refs in sync for callbacks fired outside React render (speech onend).
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);
  useEffect(() => { handsFreeRef.current = handsFree; }, [handsFree]);

  // Pick the most natural available browser voice for the coach.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pick = () => {
      const vs = window.speechSynthesis.getVoices() || [];
      const pref =
        vs.find(v => /natural|google us english|samantha|aria|jenny|libby/i.test(v.name) && /^en/i.test(v.lang)) ||
        vs.find(v => v.lang === "en-US" && /google|samantha|female/i.test(v.name)) ||
        vs.find(v => v.lang === "en-US") ||
        vs.find(v => /^en/i.test(v.lang));
      if (pref) voiceRef.current = pref;
    };
    pick();
    try { window.speechSynthesis.onvoiceschanged = pick; } catch {}
    return () => { try { window.speechSynthesis.onvoiceschanged = null as any; } catch {} };
  }, []);

  function submit(text: string) {
    const t = (text || "").trim();
    if (!t || thinkingRef.current) return;
    const next: Msg[] = [...messagesRef.current, { role: "user", content: t }];
    setMessages(next);
    setInput("");
    sendToCoach(next);
  }
  function handleSend() { submit(input); }

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
    rec.onend = () => {
      setListening(false);
      if (handsFreeRef.current && finalText.trim()) submit(finalText);
    };
    rec.onerror = () => { setListening(false); };
    try { rec.start(); setListening(true); } catch {}
  }

  const generateMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/script-coach/build", { messages, mode }),
    onSuccess: (data: any) => {
      const spec = data?.spec;
      if (!spec || !Array.isArray(spec.nodes) || !spec.nodes.length) {
        toast({ title: "Nothing to build yet", description: "Chat a bit more, then try again.", variant: "destructive" });
        return;
      }
      try { window.speechSynthesis?.cancel?.(); } catch {}
      setDraft(spec);
      setDraftName(typeof spec.name === "string" && spec.name.trim() ? spec.name : "My Script");
    },
    onError: (e: any) => toast({ title: "Could not generate", description: e?.message ?? "Try chatting a bit more, then retry.", variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/script-coach/save", { spec: draft, name: draftName }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-scripts/mine"] });
      toast({ title: "Saved! 🎉", description: "Your script is ready. Opening it now." });
      onBuilt?.(data?.script);
      onClose();
    },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message ?? "Try again.", variant: "destructive" }),
  });

  if (!open) return null;
  const canBuild = messages.filter(m => m.role === "user").length >= 1 && !generateMut.isPending;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-lg h-[85vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl bg-[#0F182D] border border-white/10">
        {/* Preview / save panel */}
        {draft && (
          <div className="absolute inset-0 z-10 bg-[#0F182D] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
              <h2 className="text-white font-bold text-base">Review your script</h2>
              <button onClick={() => setDraft(null)} title="Back" className="text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/10"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 shrink-0">
              <label className="text-xs text-white/50">Script name</label>
              <input value={draftName} onChange={e => setDraftName(e.target.value)} className="w-full mt-1 rounded-lg bg-white/[0.06] border border-white/10 text-white text-sm px-3 py-2 focus:outline-none focus:border-[#C49A3C]/60" data-testid="coach-draft-name" />
              <p className="text-[11px] text-white/40 mt-1">Saved as a draft you can switch between on the Script picker — generate more to compare.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-2">
              {Array.isArray(draft.nodes) && draft.nodes.map((n: any, i: number) => (
                <div key={i} className="rounded-lg bg-white/[0.04] border border-white/5 px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-[#C49A3C] bg-[#C49A3C]/15 rounded px-1.5 py-0.5">{i + 1}</span>
                    <span className="text-white/90 text-sm font-medium">{n.key || ("Step " + (i + 1))}</span>
                  </div>
                  <p className="text-white/70 text-xs whitespace-pre-wrap leading-relaxed">{n.text}</p>
                  {Array.isArray(n.responses) && n.responses.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {n.responses.map((r: any, j: number) => (
                        <span key={j} className="text-[10px] rounded-full px-2 py-0.5 bg-white/[0.06] text-white/55">{r.label}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-white/10 p-3 shrink-0 flex gap-2">
              <Button variant="outline" className="flex-1 text-white border-white/20 hover:bg-white/10 bg-transparent" onClick={() => setDraft(null)}>Back to chat</Button>
              <Button className="flex-1 gap-2 font-semibold" style={{ backgroundColor: "#16a34a", color: "#fff" }} onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !draftName.trim()} data-testid="coach-save">
                {saveMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save this script</>}
              </Button>
            </div>
          </div>
        )}
        {/* Phone-call overlay */}
        {callActive && (
          <div className="absolute inset-0 z-20 bg-gradient-to-b from-[#0F182D] to-[#1A2B4A] flex flex-col items-center justify-center px-6 text-center">
            <button onClick={endCall} className="absolute top-3 right-3 text-white/50 hover:text-white p-2 rounded-lg hover:bg-white/10"><X className="w-5 h-5" /></button>
            <div className={"relative w-40 h-40 rounded-full flex items-center justify-center mb-8 " + (callState === "speaking" ? "animate-pulse" : "")} style={{ background: "radial-gradient(circle, rgba(196,154,60,0.30), rgba(196,154,60,0.04))" }}>
              {callState === "listening" && <span className="absolute inset-0 rounded-full border-2 border-[#C49A3C]/50 animate-ping" />}
              <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ backgroundColor: "rgba(196,154,60,0.22)" }}>
                {callState === "thinking" ? <Loader2 className="w-10 h-10 text-[#C49A3C] animate-spin" /> : callState === "listening" ? <Mic className="w-10 h-10 text-[#C49A3C]" /> : <Bot className="w-10 h-10 text-[#C49A3C]" />}
              </div>
            </div>
            <p className="text-[#C49A3C] text-xs font-semibold uppercase tracking-widest mb-3">
              {callState === "speaking" ? "Coach speaking" : callState === "listening" ? "Listening — speak now" : callState === "thinking" ? "Thinking" : "Connecting"}
            </p>
            <p className="text-white/85 text-base max-w-sm min-h-[3.5rem] leading-relaxed">{caption || (callState === "listening" ? "Go ahead, I am listening…" : "")}</p>
            <button onClick={endCall} className="mt-10 flex items-center gap-2 rounded-full bg-red-500 hover:bg-red-600 text-white font-semibold px-7 py-3">
              <PhoneOff className="w-5 h-5" /> End call
            </button>
            <p className="text-white/35 text-[11px] mt-4 max-w-xs">Tip: use headphones so the coach does not hear itself. End the call anytime to type or generate your script.</p>
          </div>
        )}
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
            {voiceSupported && (
              <button onClick={startCall} title="Start a hands-free voice call with the coach" className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" /> Call
              </button>
            )}
            {voiceSupported && (
              <button onClick={() => setHandsFree(h => !h)} title="Hands-free: auto-send right after you finish speaking" className={"text-[11px] px-2 py-1 rounded-lg transition-colors " + (handsFree ? "bg-[#C49A3C] text-[#1A2B4A] font-semibold" : "text-white/50 hover:text-white hover:bg-white/10")}>
                Hands-free
              </button>
            )}
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

        {/* Coverage / readiness (on-demand to keep AI cost low) */}
        {messages.some(m => m.role === "user") && (
          <div className="border-t border-white/10 px-4 py-2.5 shrink-0 bg-white/[0.02]">
            {coverage && Array.isArray(coverage.stages) ? (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Script readiness</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[#C49A3C]">{Math.round(coverage.score ?? 0)}%</span>
                    <button onClick={() => refreshCoverage(messages)} disabled={covLoading} className="text-[10px] text-white/40 hover:text-white/80 disabled:opacity-50">{covLoading ? "…" : "Refresh"}</button>
                  </div>
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
              </>
            ) : (
              <button onClick={() => refreshCoverage(messages)} disabled={covLoading} className="w-full flex items-center justify-center gap-1.5 text-xs text-white/55 hover:text-white disabled:opacity-50">
                {covLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {covLoading ? "Checking…" : "Check script readiness"}
              </button>
            )}
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
            onClick={() => generateMut.mutate()}
            disabled={!canBuild || enabled === false}
            className="w-full gap-2 font-semibold"
            style={{ backgroundColor: "#16a34a", color: "#fff" }}
            data-testid="coach-generate"
          >
            {generateMut.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating…</> : <><Sparkles className="w-4 h-4" /> Generate My Script</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
