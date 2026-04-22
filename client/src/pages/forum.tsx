import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  MessageSquare, ArrowLeft, ArrowUp, Pin, Check, Bell, BellOff,
  Trash2, Pencil, Search, CheckCircle2,
} from "lucide-react";

function timeAgo(iso: string) {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    const secs = Math.floor((Date.now() - d.getTime()) / 1000);
    if (secs < 60) return "just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  } catch {
    return iso;
  }
}

interface ForumPost {
  id: number;
  title: string;
  body: string;
  author_id: number;
  author_name: string;
  upvotes: number;
  is_answered: number;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  answer_count?: number;
  has_accepted_answer?: boolean | number;
  is_subscribed?: number;
  has_upvoted?: number;
  answers?: ForumAnswer[];
}

interface ForumAnswer {
  id: number;
  post_id: number;
  body: string;
  author_id: number;
  author_name: string;
  upvotes: number;
  is_accepted: number;
  created_at: string;
  has_upvoted?: number;
}

export default function Forum() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    document.title = "Forum · WCLCC";
  }, []);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [askTitle, setAskTitle] = useState("");
  const [askBody, setAskBody] = useState("");
  const [editPostId, setEditPostId] = useState<number | null>(null);
  const [editPostTitle, setEditPostTitle] = useState("");
  const [editPostBody, setEditPostBody] = useState("");
  const [editAnswerId, setEditAnswerId] = useState<number | null>(null);
  const [editAnswerBody, setEditAnswerBody] = useState("");
  const [newAnswer, setNewAnswer] = useState("");

  const { data: listData, isLoading: loadingList } = useQuery<{ posts: ForumPost[] }>({
    queryKey: ["/api/forum/posts", search],
    queryFn: () => {
      const qs = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : "";
      return apiRequest("GET", `/api/forum/posts${qs}`);
    },
    refetchInterval: selectedId ? false : 30000,
  });

  const { data: detailData } = useQuery<{ post: ForumPost }>({
    queryKey: ["/api/forum/posts", selectedId],
    queryFn: () => apiRequest("GET", `/api/forum/posts/${selectedId}`),
    enabled: !!selectedId,
    refetchInterval: selectedId ? 30000 : false,
  });

  const posts = listData?.posts ?? [];
  const post = detailData?.post;

  const createPost = useMutation({
    mutationFn: (data: { title: string; body: string }) =>
      apiRequest("POST", "/api/forum/posts", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forum/posts"] });
      setAskOpen(false);
      setAskTitle("");
      setAskBody("");
      toast({ title: "Question posted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updatePost = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/forum/posts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forum/posts"] });
      setEditPostId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePost = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/forum/posts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forum/posts"] });
      setSelectedId(null);
      toast({ title: "Post deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const upvotePost = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/forum/posts/${id}/upvote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/forum/posts"] }),
  });

  const subscribePost = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/forum/posts/${id}/subscribe`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/forum/posts"] }),
  });

  const addAnswer = useMutation({
    mutationFn: ({ postId, body }: { postId: number; body: string }) =>
      apiRequest("POST", `/api/forum/posts/${postId}/answers`, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forum/posts"] });
      setNewAnswer("");
      toast({ title: "Answer posted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateAnswer = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/forum/answers/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forum/posts"] });
      setEditAnswerId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAnswer = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/forum/answers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/forum/posts"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const upvoteAnswer = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/forum/answers/${id}/upvote`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/forum/posts"] }),
  });

  const acceptAnswer = useMutation({
    mutationFn: ({ postId, answerId }: { postId: number; answerId: number }) =>
      apiRequest("POST", `/api/forum/posts/${postId}/accept-answer/${answerId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/forum/posts"] });
      toast({ title: "Answer accepted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Detail view ────────────────────────────────────────────────────────
  if (selectedId && post) {
    const canEditPost = isAdmin || post.author_id === user?.id;
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <Button
          variant="ghost"
          onClick={() => setSelectedId(null)}
          className="mb-4"
          data-testid="button-forum-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Forum
        </Button>

        <Card className="mb-4">
          <CardContent className="p-6">
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={() => upvotePost.mutate(post.id)}
                  className={`p-1.5 rounded border hover:bg-accent transition ${post.has_upvoted ? "bg-primary/10 border-primary text-primary" : ""}`}
                  data-testid={`button-upvote-post-${post.id}`}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold">{post.upvotes}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  {post.is_pinned ? <Pin className="w-4 h-4 text-amber-500" /> : null}
                  {editPostId === post.id ? (
                    <Input
                      value={editPostTitle}
                      onChange={(e) => setEditPostTitle(e.target.value)}
                      className="text-lg font-bold flex-1"
                    />
                  ) : (
                    <h1 className="text-2xl font-bold">{post.title}</h1>
                  )}
                  {post.is_answered ? (
                    <Badge className="bg-green-600 hover:bg-green-700">Answered</Badge>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground mb-3">
                  {post.author_name} · {timeAgo(post.created_at)}
                </div>
                {editPostId === post.id ? (
                  <Textarea
                    value={editPostBody}
                    onChange={(e) => setEditPostBody(e.target.value)}
                    rows={6}
                    className="mb-3"
                  />
                ) : (
                  <div className="whitespace-pre-wrap text-sm mb-4">{post.body}</div>
                )}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => subscribePost.mutate(post.id)}
                    data-testid="button-subscribe"
                  >
                    {post.is_subscribed ? (
                      <><BellOff className="w-4 h-4 mr-1" /> Unsubscribe</>
                    ) : (
                      <><Bell className="w-4 h-4 mr-1" /> Subscribe</>
                    )}
                  </Button>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updatePost.mutate({ id: post.id, data: { is_pinned: post.is_pinned ? 0 : 1 } })}
                    >
                      <Pin className="w-4 h-4 mr-1" />
                      {post.is_pinned ? "Unpin" : "Pin"}
                    </Button>
                  )}
                  {canEditPost && editPostId !== post.id && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditPostId(post.id);
                          setEditPostTitle(post.title);
                          setEditPostBody(post.body);
                        }}
                      >
                        <Pencil className="w-4 h-4 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Delete this post and all answers?")) {
                            deletePost.mutate(post.id);
                          }
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-1" /> Delete
                      </Button>
                    </>
                  )}
                  {editPostId === post.id && (
                    <>
                      <Button
                        size="sm"
                        onClick={() =>
                          updatePost.mutate({
                            id: post.id,
                            data: { title: editPostTitle, body: editPostBody },
                          })
                        }
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditPostId(null)}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="mb-4 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {post.answers?.length ?? 0} {post.answers?.length === 1 ? "Answer" : "Answers"}
        </div>

        <div className="space-y-3 mb-6">
          {(post.answers ?? []).map((a) => {
            const canEditAnswer = isAdmin || a.author_id === user?.id;
            const canAccept = isAdmin || post.author_id === user?.id;
            return (
              <Card key={a.id} className={a.is_accepted ? "border-green-500 border-2" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => upvoteAnswer.mutate(a.id)}
                        className={`p-1.5 rounded border hover:bg-accent transition ${a.has_upvoted ? "bg-primary/10 border-primary text-primary" : ""}`}
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <span className="text-sm font-bold">{a.upvotes}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      {a.is_accepted ? (
                        <Badge className="mb-2 bg-green-600 hover:bg-green-700">
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Accepted Answer
                        </Badge>
                      ) : null}
                      {editAnswerId === a.id ? (
                        <Textarea
                          value={editAnswerBody}
                          onChange={(e) => setEditAnswerBody(e.target.value)}
                          rows={4}
                          className="mb-2"
                        />
                      ) : (
                        <div className="whitespace-pre-wrap text-sm mb-2">{a.body}</div>
                      )}
                      <div className="text-xs text-muted-foreground mb-2">
                        {a.author_name} · {timeAgo(a.created_at)}
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {canAccept && !a.is_accepted && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => acceptAnswer.mutate({ postId: post.id, answerId: a.id })}
                          >
                            <Check className="w-3 h-3 mr-1" /> Accept Answer
                          </Button>
                        )}
                        {canEditAnswer && editAnswerId !== a.id && (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditAnswerId(a.id);
                                setEditAnswerBody(a.body);
                              }}
                            >
                              <Pencil className="w-3 h-3 mr-1" /> Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => {
                                if (confirm("Delete this answer?")) deleteAnswer.mutate(a.id);
                              }}
                            >
                              <Trash2 className="w-3 h-3 mr-1" /> Delete
                            </Button>
                          </>
                        )}
                        {editAnswerId === a.id && (
                          <>
                            <Button
                              size="sm"
                              onClick={() => updateAnswer.mutate({ id: a.id, data: { body: editAnswerBody } })}
                            >
                              Save
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setEditAnswerId(null)}>
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card>
          <CardContent className="p-4">
            <h3 className="font-semibold mb-2">Write an Answer</h3>
            <Textarea
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
              rows={5}
              placeholder="Share your answer..."
              className="mb-3"
              data-testid="textarea-new-answer"
            />
            <Button
              onClick={() => {
                if (newAnswer.trim()) addAnswer.mutate({ postId: post.id, body: newAnswer.trim() });
              }}
              disabled={!newAnswer.trim() || addAnswer.isPending}
              data-testid="button-post-answer"
            >
              Post Answer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Community Forum</h1>
        </div>
        <Button onClick={() => setAskOpen(true)} data-testid="button-ask-question">
          Ask a Question
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search questions..."
          className="pl-9"
          data-testid="input-forum-search"
        />
      </div>

      {loadingList && <div className="text-center text-muted-foreground py-8">Loading…</div>}

      {!loadingList && posts.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>{search.trim() ? "No results." : "No questions yet. Be the first to ask!"}</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {posts.map((p) => (
          <Card
            key={p.id}
            className="cursor-pointer hover:bg-accent/50 transition"
            onClick={() => setSelectedId(p.id)}
            data-testid={`card-post-${p.id}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    upvotePost.mutate(p.id);
                  }}
                  className={`flex flex-col items-center gap-0.5 p-1.5 rounded border hover:bg-accent transition ${p.has_upvoted ? "bg-primary/10 border-primary text-primary" : ""}`}
                  data-testid={`button-upvote-list-${p.id}`}
                >
                  <ArrowUp className="w-4 h-4" />
                  <span className="text-xs font-bold">{p.upvotes}</span>
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    {p.is_pinned ? <Pin className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : null}
                    <h3 className="font-semibold truncate">{p.title}</h3>
                    {p.has_accepted_answer ? (
                      <Badge className="bg-green-600 hover:bg-green-700 text-xs">Answered</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-2">{p.body}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>{p.author_name}</span>
                    <span>·</span>
                    <span>{timeAgo(p.created_at)}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> {p.answer_count ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={askOpen} onOpenChange={setAskOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask a Question</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Title</label>
              <Input
                value={askTitle}
                onChange={(e) => setAskTitle(e.target.value)}
                placeholder="What's your question?"
                data-testid="input-ask-title"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Details</label>
              <Textarea
                value={askBody}
                onChange={(e) => setAskBody(e.target.value)}
                rows={6}
                placeholder="Provide as much detail as possible..."
                data-testid="textarea-ask-body"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAskOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (askTitle.trim() && askBody.trim()) {
                  createPost.mutate({ title: askTitle.trim(), body: askBody.trim() });
                }
              }}
              disabled={!askTitle.trim() || !askBody.trim() || createPost.isPending}
              data-testid="button-submit-question"
            >
              Post Question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
