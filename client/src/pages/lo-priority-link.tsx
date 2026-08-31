import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Star, Check } from "lucide-react";

/**
 * Public page behind an LO priority share link — no C3 login.
 *
 * It can do exactly one thing: move active loan officers between the three
 * priority tiers. It cannot read a phone number, a credential, a lead or a
 * person's pay, because the endpoint behind it only ever returns names and
 * tiers. Every save is written to the audit trail against the link.
 */

const TIERS = [
  { tier: 1, label: "Priority", hint: "Gets leads first", cls: "border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  { tier: 2, label: "Standard", hint: "Normal rotation", cls: "border-sky-500 bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  { tier: 3, label: "Last resort", hint: "Only if nobody else fits", cls: "border-slate-400 bg-slate-400/15 text-slate-600 dark:text-slate-300" },
] as const;

interface Lo { id: number; fullName: string; priorityTier: number | null; internalStatus: string }

export default function LoPriorityLink() {
  const [, params] = useRoute("/lo-priority/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<number, number>>({});
  const [who, setWho] = useState("");

  const { data, isLoading, error, refetch } = useQuery<{ label: string; expiresAt: string | null; los: Lo[] }>({
    queryKey: ["/api/lo-priority", token],
    queryFn: () => apiRequest("GET", `/api/lo-priority/${token}`),
    enabled: !!token,
    retry: false,
  });

  // Start from what is actually set, so an untouched LO is never rewritten.
  useEffect(() => {
    if (!data?.los) return;
    const next: Record<number, number> = {};
    for (const lo of data.los) next[lo.id] = Number(lo.priorityTier) || 2;
    setDraft(next);
  }, [data?.los]);

  const changed = (data?.los ?? []).filter((lo) => draft[lo.id] && draft[lo.id] !== (Number(lo.priorityTier) || 2));

  const save = useMutation({
    mutationFn: () => apiRequest("POST", `/api/lo-priority/${token}`, {
      who,
      changes: changed.map((lo) => ({ loId: lo.id, priorityTier: draft[lo.id] })),
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
              <Star className="h-5 w-5 text-amber-500" /> Loan officer priority
            </CardTitle>
            <CardDescription>
              {data?.label
                ? data.label
                : "Set which loan officers get leads first. This page can only change priority — nothing else."}
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
            {!isLoading && !error && (data?.los ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No active loan officers to show.</p>
            )}
            {(data?.los ?? []).map((lo) => (
              <div key={lo.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2" data-testid="lo-priority-row">
                <span className="text-sm font-medium">{lo.fullName}</span>
                <div className="flex gap-1">
                  {TIERS.map((t) => {
                    const active = (draft[lo.id] ?? Number(lo.priorityTier) ?? 2) === t.tier;
                    return (
                      <button
                        key={t.tier}
                        type="button"
                        title={t.hint}
                        onClick={() => setDraft((prev) => ({ ...prev, [lo.id]: t.tier }))}
                        className={
                          "rounded-md border px-2.5 py-1 text-xs transition-colors "
                          + (active ? t.cls + " font-semibold" : "hover:bg-muted")
                        }
                        data-testid={`lo-tier-${lo.id}-${t.tier}`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
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
