import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRightLeft, AlertTriangle, CheckCircle2, Search, Loader2, Info,
} from "lucide-react";

/**
 * Move one prospect between two books in Bonzo.
 *
 * You supply the phone, who holds it now, and who should hold it. The current
 * holder is not a nicety — it is the identifying half of the key: several
 * prospects routinely share one phone (the same borrower sitting in more than
 * one loan officer's book), so the phone alone cannot say which record is
 * meant, and picking wrong moves a stranger's client.
 *
 * Two steps on purpose. Check shows exactly what would move; Move it does that
 * one record and nothing else. One at a time, per Ethan — a bulk version would
 * turn a mistyped list into forty misplaced borrowers.
 */

type Verdict = {
  action: "move" | "already" | "refuse";
  prospectId: number | null;
  prospectName: string | null;
  reason: string | null;
};
type Candidate = {
  id: number; name: string;
  assignedUserName: string | null; assignedUserEmail: string | null;
};
type CheckResult = { verdict: Verdict; candidates: Candidate[] };

export default function BonzoReassign() {
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [result, setResult] = useState<CheckResult | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Any edit invalidates a check: the confirm button must never be able to act
  // on a record that was found for a different phone or a different holder.
  const edit = (set: (v: string) => void) => (v: string) => {
    set(v);
    setResult(null);
    setDone(null);
  };

  const check = useMutation<CheckResult>({
    mutationFn: () => apiRequest("POST", "/api/bonzo/reassign/check", { phone, fromEmail, toEmail }),
    onSuccess: (data) => { setResult(data); setDone(null); },
    onError: (e: any) => toast({ title: "Could not look it up", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const move = useMutation<{ moved: boolean; verified?: boolean; alreadyThere?: boolean; message: string }>({
    mutationFn: () => apiRequest("POST", "/api/bonzo/reassign", {
      prospectId: result?.verdict.prospectId, fromEmail, toEmail,
    }),
    onSuccess: (data) => {
      setDone(data.message);
      setResult(null);
      toast({
        title: data.moved && data.verified ? "Moved" : data.moved ? "Bonzo accepted it — check the result" : "Nothing to do",
        description: data.message,
        variant: data.moved && !data.verified ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Not moved", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const ready = phone.trim() && fromEmail.trim() && toEmail.trim();
  const verdict = result?.verdict;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ArrowRightLeft className="h-6 w-6" /> Reassign a Bonzo prospect
        </h1>
        <p className="text-sm text-muted-foreground">
          Move one prospect from one person's book to another's, knowing only the phone number.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Who is moving where</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Phone number</label>
            <Input
              value={phone}
              onChange={(e) => edit(setPhone)(e.target.value)}
              placeholder="(530) 736-5868"
              inputMode="tel"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Assigned to now</label>
              <Input
                value={fromEmail}
                onChange={(e) => edit(setFromEmail)(e.target.value)}
                placeholder="bill@westcapitallending.com"
                type="email"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Should be assigned to</label>
              <Input
                value={toEmail}
                onChange={(e) => edit(setToEmail)(e.target.value)}
                placeholder="chris@westcapitallending.com"
                type="email"
              />
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Email addresses, not names.</strong>{" "}
              Bonzo display names are not always the person they look like, so a name would move the
              wrong book. Use the address the person signs in with.
            </span>
          </div>

          <Button onClick={() => check.mutate()} disabled={!ready || check.isPending} className="w-full sm:w-auto">
            {check.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Looking…</>
              : <><Search className="mr-2 h-4 w-4" />Check</>}
          </Button>
        </CardContent>
      </Card>

      {done && (
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{done}</span>
          </CardContent>
        </Card>
      )}

      {verdict && (
        <Card className={`border-l-4 ${verdict.action === "move" ? "border-l-primary" : verdict.action === "already" ? "border-l-emerald-500" : "border-l-destructive"}`}>
          <CardContent className="space-y-3 p-4">
            {verdict.action === "move" ? (
              <>
                <div className="text-sm">
                  <span className="font-semibold">{verdict.prospectName || "This prospect"}</span>
                  {" "}<span className="font-mono text-xs text-muted-foreground">#{verdict.prospectId}</span>
                  {" "}will move from <span className="font-medium">{fromEmail}</span>
                  {" "}to <span className="font-medium">{toEmail}</span>.
                </div>
                <Button onClick={() => move.mutate()} disabled={move.isPending}>
                  {move.isPending
                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Moving…</>
                    : <><ArrowRightLeft className="mr-2 h-4 w-4" />Move it</>}
                </Button>
              </>
            ) : (
              <div className="flex items-start gap-2 text-sm">
                {verdict.action === "already"
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />}
                <span>{verdict.reason}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {result && result.candidates.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Everyone on that number ({result.candidates.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {/* Shown even on a refusal — usually the fastest way to see that the
                record already moved, or that the wrong address was typed. */}
            {result.candidates.map((c) => (
              <div key={c.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium">{c.name || "(no name)"}</span>
                <span className="font-mono text-xs text-muted-foreground">#{c.id}</span>
                <span className="text-xs text-muted-foreground">
                  {c.assignedUserEmail || "unassigned"}
                </span>
                {c.id === verdict?.prospectId && (
                  <Badge variant="outline" className="text-xs">this one</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
