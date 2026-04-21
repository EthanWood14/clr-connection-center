import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Send, Trash2, MessageSquare, ArrowLeft } from "lucide-react";
import { HelpIcon, PageTooltip } from "@/components/onboarding";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import { Link } from "wouter";

function formatTime(iso: string) {
  try {
    const d = parseISO(iso + "Z"); // treat as UTC
    if (isToday(d)) return format(d, "h:mm a");
    if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
    return format(d, "MMM d, h:mm a");
  } catch {
    return iso;
  }
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).slice(0, 2).join("").toUpperCase();
}

// Stable color per user name
const AVATAR_COLORS = [
  "bg-blue-500", "bg-green-600", "bg-purple-600", "bg-orange-500",
  "bg-teal-600", "bg-pink-600", "bg-indigo-600", "bg-rose-500",
];
function avatarColor(name: string) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export default function Chat() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const { data, isLoading } = useQuery<{ messages: any[] }>({
    queryKey: ["/api/chat"],
    refetchInterval: 3000, // poll every 3s
  });

  const messages = data?.messages ?? [];

  // Auto-scroll to bottom on new messages (only if user hasn't scrolled up)
  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, autoScroll]);

  const sendMsg = useMutation({
    mutationFn: (message: string) => apiRequest("POST", "/api/chat", { message }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chat"] });
      setDraft("");
      setAutoScroll(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMsg = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || sendMsg.isPending) return;
    sendMsg.mutate(text);
  }

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(isAtBottom);
  }

  // Group messages by date
  const grouped: { date: string; msgs: any[] }[] = [];
  for (const m of messages) {
    const dateKey = m.created_at?.slice(0, 10) ?? "unknown";
    const label = (() => {
      try {
        const d = parseISO(dateKey);
        if (isToday(d)) return "Today";
        if (isYesterday(d)) return "Yesterday";
        return format(d, "MMMM d, yyyy");
      } catch { return dateKey; }
    })();
    if (!grouped.length || grouped[grouped.length - 1].date !== label) {
      grouped.push({ date: label, msgs: [m] });
    } else {
      grouped[grouped.length - 1].msgs.push(m);
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* Mobile sticky header with back button */}
      <div className="md:hidden sticky top-0 z-20 flex items-center justify-between h-12 px-3 border-b bg-sidebar text-sidebar-foreground flex-shrink-0">
        <Link
          href="/"
          data-testid="chat-mobile-back"
          className="flex items-center gap-1 text-sm font-medium px-2 py-1 -ml-1 rounded hover:bg-sidebar-foreground/10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Home</span>
        </Link>
        <h1 className="absolute left-1/2 -translate-x-1/2 text-sm font-semibold">Team Chat</h1>
        <div className="w-16" aria-hidden />
      </div>

      <div className="flex flex-col flex-1 min-h-0 max-w-3xl w-full mx-auto p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Header (desktop) */}
      <div className="hidden md:flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold leading-tight flex items-center gap-2">
            Team Chat
            <HelpIcon title="Team Chat">
              Team-wide chat channel. All users can send and receive messages.
            </HelpIcon>
          </h1>
          <p className="text-xs text-muted-foreground">All users · Updates every 3 seconds</p>
        </div>
      </div>
      <PageTooltip pageKey="chat" title="Team Chat">
        Team-wide chat channel. All users can send and receive messages.
      </PageTooltip>

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto rounded-xl border bg-muted/20 p-4 space-y-1"
        onScroll={handleScroll}
      >
        {isLoading ? (
          <div className="space-y-4 pt-2">
            {[1,2,3,4].map(i => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Be the first to say something to the team.</p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.date}>
              {/* Date divider */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground font-medium px-2">{group.date}</span>
                <div className="flex-1 h-px bg-border" />
              </div>

              {group.msgs.map((m, i) => {
                const isMe = m.user_id === user?.id;
                const prevMsg = i > 0 ? group.msgs[i - 1] : null;
                const sameAuthor = prevMsg && prevMsg.user_id === m.user_id;

                return (
                  <div
                    key={m.id}
                    className={`group flex items-start gap-2.5 ${isMe ? "flex-row-reverse" : ""} ${sameAuthor ? "mt-0.5" : "mt-3"}`}
                  >
                    {/* Avatar — only show on first message in a run */}
                    <div className={`shrink-0 w-8 ${sameAuthor ? "invisible" : ""}`}>
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${avatarColor(m.user_name)}`}>
                        {getInitials(m.user_name)}
                      </div>
                    </div>

                    {/* Bubble */}
                    <div className={`max-w-[75%] ${isMe ? "items-end" : "items-start"} flex flex-col gap-0.5`}>
                      {!sameAuthor && (
                        <div className={`flex items-baseline gap-2 ${isMe ? "flex-row-reverse" : ""}`}>
                          <span className="text-xs font-semibold text-foreground">{m.user_name}</span>
                          <span className="text-[10px] text-muted-foreground">{formatTime(m.created_at)}</span>
                        </div>
                      )}
                      <div className={`relative flex items-center gap-1.5 ${isMe ? "flex-row-reverse" : ""}`}>
                        <div className={`px-3 py-2 rounded-2xl text-sm leading-snug break-words whitespace-pre-wrap ${
                          isMe
                            ? "bg-primary text-primary-foreground rounded-tr-sm"
                            : "bg-white dark:bg-zinc-800 border rounded-tl-sm shadow-sm"
                        }`}>
                          {m.message}
                        </div>
                        {/* Delete button */}
                        {(isMe || user?.role === "admin") && (
                          <button
                            onClick={() => deleteMsg.mutate(m.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      {sameAuthor && (
                        <span className={`text-[10px] text-muted-foreground px-1 ${isMe ? "text-right" : ""}`}>
                          {formatTime(m.created_at)}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll-to-bottom nudge */}
      {!autoScroll && (
        <div className="flex justify-center -mt-2 mb-1">
          <button
            onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
            className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-full shadow hover:bg-primary/90 transition-colors"
          >
            ↓ New messages
          </button>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSend} className="flex items-center gap-2 mt-3">
        <Input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Message the team..."
          className="flex-1 rounded-full px-4"
          maxLength={1000}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          autoFocus
        />
        <Button
          type="submit"
          size="icon"
          className="rounded-full w-10 h-10 shrink-0"
          disabled={!draft.trim() || sendMsg.isPending}
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
      <p className="text-[10px] text-muted-foreground text-center mt-1.5">
        Press Enter to send · {draft.length}/1000
      </p>
      </div>
    </div>
  );
}
