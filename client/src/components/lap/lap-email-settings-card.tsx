import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Mail, Send } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { usePortalProduct, productLabel } from "./lap-shell";

type Settings = { fromName: string; replyTo: string; sendWelcome: boolean };

/**
 * How this portal's own mail is addressed.
 *
 * The Resend key and the verified sending domain stay shared with C3 on
 * purpose — one credential, one place to rotate it. What is per portal is the
 * part recipients actually see: the sender name, the reply-to, and whether
 * creating an account mails a welcome at all.
 */
export function LapEmailSettingsCard() {
  const product = usePortalProduct();
  const label = productLabel(product);
  const { toast } = useToast();
  const key = ["/api/portal-email-settings", product];

  const q = useQuery<Settings>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/portal-email-settings/${product}`),
  });

  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  useEffect(() => {
    if (q.data) { setFromName(q.data.fromName ?? ""); setReplyTo(q.data.replyTo ?? ""); }
  }, [q.data]);

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => apiRequest("PATCH", `/api/portal-email-settings/${product}`, patch),
    onSuccess: (next: any) => { queryClient.setQueryData(key, next); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => apiRequest("POST", `/api/portal-email-settings/${product}/test`, {}),
    onSuccess: (r: any) => toast({ title: "Test email sent", description: `Check ${r?.to ?? "your inbox"}.` }),
    onError: (e: any) => toast({ title: "Test email failed", description: e?.message, variant: "destructive" }),
  });

  const dirty = !!q.data && (fromName !== (q.data.fromName ?? "") || replyTo !== (q.data.replyTo ?? ""));
  const replyToValid = replyTo === "" || /.+@.+\..+/.test(replyTo.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4 text-primary" /> {label} email
        </CardTitle>
        <CardDescription>
          How mail from {label} is addressed — welcome invites, password resets and notifications.
          The sending domain is shared with C3, so only the name and reply-to change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <div className="h-28 animate-pulse rounded-xl bg-muted" />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="lap-from-name">Sender name</Label>
                <Input
                  id="lap-from-name" className="h-9" value={fromName}
                  onChange={(e) => setFromName(e.target.value)}
                  placeholder={`${label} — West Capital Lending`}
                  data-testid="lap-email-from-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="lap-reply-to">Reply-to (optional)</Label>
                <Input
                  id="lap-reply-to" type="email" className="h-9" value={replyTo}
                  onChange={(e) => setReplyTo(e.target.value)}
                  placeholder="someone@westcapitallending.com"
                  data-testid="lap-email-reply-to"
                />
              </div>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/20 px-4 py-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Send a welcome email on new accounts</p>
                <p className="text-xs text-muted-foreground">
                  When off, accounts are still created but nobody is emailed — you hand out the sign-in details yourself.
                </p>
              </div>
              <Switch
                checked={!!q.data?.sendWelcome}
                disabled={save.isPending}
                onCheckedChange={(v) => save.mutate({ sendWelcome: v })}
                data-testid="lap-email-send-welcome"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline" size="sm" className="gap-1.5"
                disabled={test.isPending}
                onClick={() => test.mutate()}
                data-testid="lap-email-test"
              >
                {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send myself a test
              </Button>
              <Button
                size="sm"
                disabled={!dirty || !replyToValid || save.isPending}
                onClick={() => save.mutate({ fromName: fromName.trim(), replyTo: replyTo.trim() })}
                data-testid="lap-email-save"
              >
                Save
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
