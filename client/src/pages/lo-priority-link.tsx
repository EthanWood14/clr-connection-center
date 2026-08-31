import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Pin, Check, Flag } from "lucide-react";

/**
 * Public page behind an LO pin share link — no C3 login.
 *
 * It moves exactly one flag: needs_transfers. That is the pin the state view
 * highlights and sorts to the top, and it is what builds the "prioritized loan
 * officers" list every CLR sees at the start of the day. It deliberately does
 * not touch priority_tier, which is a separate and slower-moving thing.
 *
 * It cannot read a phone number, a credential or a lead, because the endpoint
 * behind it returns names and the pin only. Every save is written to the audit
 * trail against the link.
 */

interface Lo {
  id: number;
  fullName: string;
  pinned: boolean;
  internalStatus: string;
}

export default function LoPriorityLink() {
  const [, params] = useRoute("/lo-priority/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<number, boolean>>({});
  const [who, setWho] = useState("");

  const { data, isLoading, error, refetch } = useQuery<{ label: string; expiresAt: string | null; los: Lo[] }>({
    queryKey: ["/api/lo-priority", token],
    queryFn: () => apiRequest("GET", `/api/lo-priority/${token}`),
    enabled: !!token,
    retry: false,
  });

  // Start from what is actually pinned right now, so an untouched loan officer
  // is never rewritten and the page always opens showing the truth.
  useEffect(() => {
    if (!data?.los) return;
    const next: Record<number, boolean> = {};
    for (const lo of data.los) next[lo.id] = !!lo.pinned;
    setDraft(next);
  }, [data?.los]);

  const changed = (data?.los ?? []).filter((lo) => (draft[lo.id] ?? lo.pinned) !== lo.pinned);
  const pinnedNow = (data?.los ?? []).filter((lo) => draft[lo.id] ?? lo.pinned);

  const save = useMutation({
    mutationFn: () => apiRequest("POST", `/api/lo-priority/${token}`, {
      who,
      changes: changed.map((lo) => ({ loId: lo.id, pinned: draft[lo.id] })),
    }),
    onSuccess: (r: any) => {
      toast({ title: "Saved", description: `${r?.applied ?? 0} loan officer${r?.applied === 1 ? "" : "s"} updated.` });
      void refetch();
    },
    onError: (e: any) => toast({ title: "Could not save", description: String(e?.message ?? e), variant: "destructive" }),
  });

  if (!token) return null;

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Flag className="h-5 w-5 text-amber-500" /> Pinned loan officers
            </CardTitle>
            <CardDescription>
              {data?.label
                ? data.label
                : "Pin the loan officers who need transfers. Pinned ones are highlighted at the top of the state view and are the list every CLR sees when they start the day."}
              {data?.expiresAt && (
                <> {" "}This link stops working on {new Date(data.expiresAt).toLocaleDateString()}.</>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!!error && (
              <p className="text-sm font-medium text-destructive" data-testid="lo-priority-dead">
                This link is no longer active. Ask whoever sent it for a new one.
              </p>
            )}

            {/* What is pinned right now, before anything is touched. */}
            {!isLoading && !error && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2" data-testid="lo-pinned-summary">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Pinned right now — {pinnedNow.length} of {(data?.los ?? []).length}
                </p>
                <p className="mt-1 text-sm">
                  {pinnedNow.length === 0
                    ? "Nobody is pinned. Every CLR will start the day with an empty list."
                    : pinnedNow.map((lo) => lo.fullName).join(", ")}
                </p>
              </div>
            )}

            {!isLoading && !error && (data?.los ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No active loan officers to show.</p>
            )}

            {(data?.los ?? []).map((lo) => {
              const on = draft[lo.id] ?? lo.pinned;
              const moved = on !== lo.pinned;
              return (
                <button
                  key={lo.id}
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, [lo.id]: !on }))}
                  className={
                    "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors "
                    + (on
                      ? "border-2 border-amber-400 bg-amber-50/60 dark:border-amber-500 dark:bg-amber-950/20"
                      : "hover:bg-muted")
                  }
                  data-testid={`lo-pin-${lo.id}`}
                  aria-pressed={on}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Pin className={"h-4 w-4 " + (on ? "text-amber-500" : "text-muted-foreground/40")} />
                    {lo.fullName}
                  </span>
                  <span className="flex items-center gap-2">
                    {moved && <span className="text-[11px] font-semibold text-primary">changed</span>}
                    <span className={"text-xs " + (on ? "font-semibold text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
                      {on ? "Pinned" : "Not pinned"}
                    </span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {(data?.los ?? []).length > 0 && (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <Input
                value={who}
                onChange={(e) => setWho(e.target.value)}
                placeholder="Your name (so the change is attributed)"
                className="h-9 flex-1 min-w-[220px]"
                data-testid="lo-priority-who"
              />
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground" data-testid="lo-priority-count">
                  {changed.length === 0 ? "No changes yet" : `${changed.length} change${changed.length === 1 ? "" : "s"}`}
                </span>
                <Button
                  disabled={save.isPending || changed.length === 0}
                  onClick={() => save.mutate()}
                  className="gap-1.5"
                  data-testid="lo-priority-save"
                >
                  <Check className="h-4 w-4" /> Save
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
