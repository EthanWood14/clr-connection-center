import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Send, Trash2, MessageSquare, ArrowLeft, SmilePlus, Bell, BellOff, Image as ImageIcon, X, Sticker, Search } from "lucide-react";
import { HelpIcon } from "@/components/onboarding";
import { format, isToday, isYesterday, parseISO } from "date-fns";

const REACT_EMOJIS = ["👍", "❤️", "😂", "🎉", "😮", "👏", "🙏", "🔥", "✅"];
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
  const { user, refetchUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null);
  const chatMuted = !!(user as any)?.muteChatNotifications;
  const [muting, setMuting] = useState(false);
  async function toggleChatMute() {
    const nextMuted = !chatMuted;
    setMuting(true);
    try {
      const r = await fetch("/api/users/me/mute-chat", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ muted: nextMuted }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed");
      await refetchUser();
      toast({
        title: nextMuted ? "Chat notifications muted" : "Chat notifications on",
        description: nextMuted ? "No in-app, push, or email alerts for new chat messages." : "You'll be alerted about new chat messages again.",
      });
    } catch (e: any) {
      toast({ title: "Couldn't update", description: e?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setMuting(false);
    }
  }
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
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
    mutationFn: (payload: { message: string; image: { base64: string; mime: string } | null }) =>
      apiRequest("POST", "/api/chat", { message: payload.message, imageBase64: payload.image?.base64, imageMime: payload.image?.mime }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chat"] });
      setDraft("");
      setPendingImage(null);
      setAutoScroll(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Read an image file (from paste or the picker) into a pending attachment.
  function ingestImageFile(file: File | null | undefined) {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Image too large", description: "Max 5 MB.", variant: "destructive" }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      const comma = dataUrl.indexOf(",");
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
      setPendingImage({ dataUrl, base64, mime: file.type });
    };
    reader.readAsDataURL(file);
  }
  // Paste a screenshot/image from the clipboard straight into the composer.
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const f = items[i].getAsFile();
        if (f) { ingestImageFile(f); e.preventDefault(); }
        return;
      }
    }
  }

  // ── Meme picker (memegen.link catalog, no API key) ──────────────────────────
  const [memeOpen, setMemeOpen] = useState(false);
  const [memeSearch, setMemeSearch] = useState("");
  type MemeItem = { id: string; name: string; blank: string; keywords: string[] };
  const { data: memeData, isLoading: memesLoading } = useQuery<{ items: MemeItem[] }>({
    queryKey: ["/api/memes/catalog"],
    enabled: memeOpen,
    staleTime: 6 * 60 * 60 * 1000,
  });
  const sendMeme = useMutation({
    mutationFn: (url: string) => apiRequest("POST", "/api/chat/meme", { url }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/chat"] });
      setMemeOpen(false); setMemeSearch(""); setAutoScroll(true);
    },
    onError: (e: any) => toast({ title: "Couldn't send meme", description: e.message, variant: "destructive" }),
  });
  // Pin well-known templates to the top of the un-searched grid.
  // Quick-pick order (before search): a modern set up front, classics behind.
  // Every id is a real memegen.link template; the full library is still
  // searchable below.
  const MEME_POPULAR = [
    // modern
    "drake", "cheems", "stonks", "panik-kalm-panik", "midwit", "cmm", "woman-cat",
    "handshake", "spiderman", "pigeon", "khaby-lame", "saltbae", "bongo", "kombucha",
    // classics
    "fine", "db", "gru", "success", "doge", "mordor", "oprah", "grumpycat",
    "spongebob", "disastergirl", "rollsafe", "yodawg", "ds", "exit", "ll",
  ];
  const memes = useMemo(() => {
    const all = memeData?.items ?? [];
    const q = memeSearch.trim().toLowerCase();
    if (q) {
      return all.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.keywords || []).some(k => String(k).toLowerCase().includes(q))
      );
    }
    const rank = (id: string) => { const i = MEME_POPULAR.indexOf(id); return i === -1 ? 999 : i; };
    return [...all].sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  }, [memeData, memeSearch]);

  // ── Giphy GIF search (only shown when GIPHY_API_KEY is configured) ──────────
  type GifItem = { id: string; title: string; preview: string; full: string };
  const [memeMode, setMemeMode] = useState<"memes" | "gifs">("memes");
  const { data: gifCfg } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/memes/gif-enabled"],
    enabled: memeOpen,
    staleTime: 10 * 60 * 1000,
  });
  const gifEnabled = gifCfg?.enabled === true;
  const [gifQuery, setGifQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setGifQuery(memeSearch.trim()), 350);
    return () => clearTimeout(t);
  }, [memeSearch]);
  // Page through Giphy (50/page, empty query = trending) so the picker can
  // browse deep into the most-popular modern memes/GIFs — up to ~1500 via
  // "Load more" — instead of stopping at one page.
  const GIF_PAGE = 50;
  const GIF_MAX = 1500;
  const {
    data: gifPages, isFetching: gifsLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery<{ enabled: boolean; items: GifItem[] }>({
    queryKey: ["/api/memes/gif-search", gifQuery],
    queryFn: ({ pageParam = 0 }) =>
      apiRequest("GET", `/api/memes/gif-search?offset=${pageParam}` + (gifQuery ? "&q=" + encodeURIComponent(gifQuery) : "")),
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.length * GIF_PAGE;
      if ((lastPage?.items?.length ?? 0) < GIF_PAGE || loaded >= GIF_MAX) return undefined;
      return loaded;
    },
    initialPageParam: 0,
    enabled: memeOpen && memeMode === "gifs" && gifEnabled,
    staleTime: 60 * 1000,
  });
  // Flatten pages, de-duping by id (Giphy trending can repeat across offsets).
  const gifs = useMemo(() => {
    const seen = new Set<string>();
    const out: GifItem[] = [];
    for (const p of gifPages?.pages ?? []) for (const g of p.items ?? []) {
      if (!seen.has(g.id)) { seen.add(g.id); out.push(g); }
    }
    return out;
  }, [gifPages]);
  const sendGif = useMutation({
    mutationFn: (url: string) => apiRequest("POST", "/api/chat/gif", { url }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/chat"] }); setMemeOpen(false); setMemeSearch(""); setAutoScroll(true); },
    onError: (e: any) => toast({ title: "Couldn't send GIF", description: e.message, variant: "destructive" }),
  });

  const deleteMsg = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/chat/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const reactMsg = useMutation({
    mutationFn: (v: { id: number; emoji: string }) => apiRequest("POST", `/api/chat/${v.id}/react`, { emoji: v.emoji }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/chat"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  function react(id: number, emoji: string) { setPickerFor(null); reactMsg.mutate({ id, emoji }); }

  function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if ((!text && !pendingImage) || sendMsg.isPending) return;
    sendMsg.mutate({ message: text, image: pendingImage ? { base64: pendingImage.base64, mime: pendingImage.mime } : null });
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
        <button
          type="button"
          onClick={toggleChatMute}
          disabled={muting}
          aria-label={chatMuted ? "Unmute chat notifications" : "Mute chat notifications"}
          title={chatMuted ? "Chat notifications muted (in-app, push & email)" : "Mute chat notifications (in-app, push & email)"}
          className="flex items-center gap-1 text-sm font-medium px-2 py-1 -mr-1 rounded hover:bg-sidebar-foreground/10 transition-colors"
          data-testid="chat-mute-toggle-mobile"
        >
          {chatMuted ? <BellOff className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
        </button>
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
        <Button
          variant={chatMuted ? "default" : "outline"}
          size="sm"
          onClick={toggleChatMute}
          disabled={muting}
          className="gap-1.5 shrink-0"
          title={chatMuted ? "Chat notifications are muted (in-app, push & email). Click to unmute." : "Mute chat notifications (in-app, push & email)"}
          data-testid="chat-mute-toggle"
        >
          {chatMuted ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
          {chatMuted ? "Muted" : "Mute"}
        </Button>
      </div>
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
                          {m.image_mime && (
                            <a href={`/api/chat/${m.id}/image`} target="_blank" rel="noreferrer" className="block">
                              <img
                                src={`/api/chat/${m.id}/image`}
                                alt="shared image"
                                loading="lazy"
                                className={`rounded-lg max-w-[240px] max-h-[300px] object-contain ${m.message ? "mb-1.5" : ""}`}
                              />
                            </a>
                          )}
                          {m.message}
                        </div>
                        {/* React button + picker */}
                        <div className="relative">
                          <button
                            onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary"
                            data-testid={`chat-react-${m.id}`}
                            aria-label="React"
                          >
                            <SmilePlus className="w-3.5 h-3.5" />
                          </button>
                          {pickerFor === m.id && (
                            <div className={`absolute z-20 -top-9 ${isMe ? "right-0" : "left-0"} flex items-center gap-0.5 rounded-full border bg-popover px-1.5 py-1 shadow-md`}>
                              {REACT_EMOJIS.map(em => (
                                <button key={em} onClick={() => react(m.id, em)} className="text-base leading-none px-1 hover:scale-125 transition-transform" data-testid={`chat-emoji-${m.id}-${em}`}>{em}</button>
                              ))}
                            </div>
                          )}
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
                      {Array.isArray(m.reactions) && m.reactions.length > 0 && (
                        <div className={`flex flex-wrap gap-1 mt-0.5 ${isMe ? "justify-end" : ""}`}>
                          {m.reactions.map((r: any) => (
                            <button
                              key={r.emoji}
                              onClick={() => react(m.id, r.emoji)}
                              className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none transition-colors ${r.mine ? "bg-primary/15 border-primary/40 text-foreground" : "bg-muted/50 border-transparent text-muted-foreground hover:bg-muted"}`}
                              data-testid={`chat-reaction-${m.id}-${r.emoji}`}
                            >
                              <span>{r.emoji}</span><span>{r.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
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

      {/* Meme picker panel */}
      {memeOpen && (
        <div className="mt-2 rounded-xl border bg-background p-2 shadow-sm">
          {gifEnabled && (
            <div className="mb-2 flex gap-1 rounded-lg bg-muted/50 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMemeMode("memes")}
                className={`flex-1 rounded-md px-2 py-1 font-medium transition ${memeMode === "memes" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="meme-tab-memes"
              >Memes</button>
              <button
                type="button"
                onClick={() => setMemeMode("gifs")}
                className={`flex-1 rounded-md px-2 py-1 font-medium transition ${memeMode === "gifs" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                data-testid="meme-tab-gifs"
              >GIFs</button>
            </div>
          )}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <Input
              value={memeSearch}
              onChange={e => setMemeSearch(e.target.value)}
              placeholder={memeMode === "gifs" ? "Search GIFs on Giphy…" : "Search memes… (cheems, panik, midwit, change my mind…)"}
              className="h-8 pl-8 text-sm"
              autoFocus
              data-testid="meme-search"
            />
          </div>
          <div className="max-h-[38vh] overflow-y-auto">
            {memeMode === "gifs" ? (
              gifsLoading && gifs.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-video rounded-lg" />)}
                </div>
              ) : gifs.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">{memeSearch.trim() ? `No GIFs match "${memeSearch}".` : "No trending GIFs right now."}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {gifs.map(g => (
                      <button
                        key={g.id}
                        type="button"
                        title={g.title || "GIF"}
                        onClick={() => sendGif.mutate(g.full)}
                        disabled={sendGif.isPending}
                        className="group relative rounded-lg overflow-hidden border bg-muted/30 hover:ring-2 hover:ring-primary transition disabled:opacity-50"
                        data-testid={`gif-${g.id}`}
                      >
                        <img src={g.preview} alt={g.title || "GIF"} loading="lazy" className="w-full aspect-video object-cover" />
                      </button>
                    ))}
                  </div>
                  {hasNextPage && (
                    <button
                      type="button"
                      onClick={() => fetchNextPage()}
                      disabled={isFetchingNextPage}
                      className="mt-2 w-full rounded-md border py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition disabled:opacity-50"
                      data-testid="gif-load-more"
                    >
                      {isFetchingNextPage ? "Loading…" : `Load more (${gifs.length} shown)`}
                    </button>
                  )}
                </>
              )
            ) : memesLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
              </div>
            ) : memes.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No memes match "{memeSearch}".</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {memes.slice(0, 120).map(m => (
                  <button
                    key={m.id}
                    type="button"
                    title={m.name}
                    onClick={() => sendMeme.mutate(m.blank)}
                    disabled={sendMeme.isPending}
                    className="group relative rounded-lg overflow-hidden border bg-muted/30 hover:ring-2 hover:ring-primary transition disabled:opacity-50"
                    data-testid={`meme-${m.id}`}
                  >
                    <img src={m.blank} alt={m.name} loading="lazy" className="w-full aspect-square object-cover" />
                    <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[9px] leading-tight px-1 py-0.5 truncate opacity-0 group-hover:opacity-100">{m.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
            {memeMode === "gifs" ? "Tap a GIF to send · powered by GIPHY" : `Tap a meme to send · ${memes.length} available · powered by memegen`}
          </p>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSend} className="mt-3">
        {pendingImage && (
          <div className="mb-2 flex items-center gap-2">
            <div className="relative">
              <img src={pendingImage.dataUrl} alt="attachment preview" className="h-16 w-16 rounded-lg object-cover border" />
              <button
                type="button"
                onClick={() => setPendingImage(null)}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-background border shadow p-0.5 text-muted-foreground hover:text-destructive"
                aria-label="Remove image"
                data-testid="chat-remove-image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <span className="text-xs text-muted-foreground">Image ready — press Enter or Send</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => { ingestImageFile(e.target.files?.[0]); if (imgInputRef.current) imgInputRef.current.value = ""; }}
            data-testid="chat-image-input"
          />
          <Button
            type="button"
            variant={memeOpen ? "default" : "outline"}
            size="icon"
            className="rounded-full w-10 h-10 shrink-0"
            onClick={() => setMemeOpen(o => !o)}
            title="Send a meme"
            aria-label="Send a meme"
            data-testid="chat-meme-toggle"
          >
            <Sticker className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="rounded-full w-10 h-10 shrink-0"
            onClick={() => imgInputRef.current?.click()}
            title="Attach an image"
            aria-label="Attach an image"
            data-testid="chat-attach-image"
          >
            <ImageIcon className="w-4 h-4" />
          </Button>
          <Input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onPaste={handlePaste}
            placeholder="Message the team… (paste a screenshot too)"
            className="flex-1 rounded-full px-4"
            maxLength={1000}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            className="rounded-full w-10 h-10 shrink-0"
            disabled={(!draft.trim() && !pendingImage) || sendMsg.isPending}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </form>
      <p className="text-[10px] text-muted-foreground text-center mt-1.5">
        Press Enter to send · paste or attach a screenshot · {draft.length}/1000
      </p>
      </div>
    </div>
  );
}
