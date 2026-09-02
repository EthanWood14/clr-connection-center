import { useEffect, useRef, useState, type ChangeEvent } from "react";
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

type Settings = { fromName: string; replyTo: string; sendWelcome: boolean; filesRecipient: string; notesRecipient: string };

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
  const [filesTo, setFilesTo] = useState("");
  const [notesTo, setNotesTo] = useState("");
  // Set on the first keystroke, cleared when a Save of the text fields lands.
  // The welcome switch saves on its own and drops the server reply into the
  // cache; without this guard that re-ran the hydrate below and wiped a
  // typed-but-unsaved recipient.
  const edited = useRef(false);
  useEffect(() => {
    if (!q.data || edited.current) return;
    setFromName(q.data.fromName ?? "");
    setReplyTo(q.data.replyTo ?? "");
    setFilesTo(q.data.filesRecipient ?? "");
    setNotesTo(q.data.notesRecipient ?? "");
  }, [q.data]);
  const edit = (set: (value: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    edited.current = true;
    set(e.target.value);
  };
  // Only LAP's LOA lead notes read this address; LOP has no note thread, so
  // the field is hidden there and left out of the PATCH.
  const hasNotesRecipient = product !== "lop";

  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => apiRequest("PATCH", `/api/portal-email-settings/${product}`, patch),
    onSuccess: (next: any, patch) => {
      // Only a Save that carried the text fields makes the local copies current.
      if ("fromName" in patch) edited.current = false;
      queryClient.setQueryData(key, next);
      toast({ title: "Saved" });
    },
    onError: (e: any) => toast({ title: "Could not save", description: e?.message, variant: "destructive" }),
  });
  const test = useMutation({
    mutationFn: () => apiRequest("POST", `/api/portal-email-settings/${product}/test`, {}),
    onSuccess: (r: any) => toast({ title: "Test email sent", description: `Check ${r?.to ?? "your inbox"}.` }),
    onError: (e: any) => toast({ title: "Test email failed", description: e?.message, variant: "destructive" }),
  });

  const dirty = !!q.data && (
    fromName !== (q.data.fromName ?? "")
    || replyTo !== (q.data.replyTo ?? "")
    || filesTo !== (q.data.filesRecipient ?? "")
    || (hasNotesRecipient && notesTo !== (q.data.notesRecipient ?? ""))
  );
  const emailish = (v: string) => v === "" || /.+@.+\..+/.test(v.trim());
  const replyToValid = emailish(replyTo);
  const filesToValid = emailish(filesTo);
  const notesToValid = !hasNotesRecipient || emailish(notesTo);

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
                  onChange={edit(setFromName)}
                  placeholder={`${label} — West Capital Lending`}
                  data-testid="lap-email-from-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs" htmlFor="lap-reply-to">Reply-to (optional)</Label>
                <Input
                  id="lap-reply-to" type="email" className="h-9" value={replyTo}
                  onChange={edit(setReplyTo)}
                  placeholder="someone@westcapitallending.com"
                  data-testid="lap-email-reply-to"
                />
              </div>
            </div>
            <div className="space-y-1.5 rounded-xl border bg-muted/20 px-4 py-3">
              <Label className="text-xs" htmlFor="lap-files-to">Email submitted documents to</Label>
              <Input
                id="lap-files-to" type="email" className="h-9" value={filesTo}
                onChange={edit(setFilesTo)}
                placeholder="nobody@westcapitallending.com"
                data-testid="lap-email-files-recipient"
              />
              <p className="text-[11px] text-muted-foreground">
                When a result package's documents are submitted, this person receives them attached,
                as one email per package. Leave blank to send nothing.
              </p>
            </div>
            {hasNotesRecipient && (
              <div className="space-y-1.5 rounded-xl border bg-muted/20 px-4 py-3">
                <Label className="text-xs" htmlFor="lap-notes-to">Lead notes recipient</Label>
                <Input
                  id="lap-notes-to" type="email" className="h-9" value={notesTo}
                  onChange={edit(setNotesTo)}
                  placeholder="credoble@westcapitallending.com"
                  data-testid="lap-notes-recipient"
                />
                <p className="text-[11px] text-muted-foreground">
                  Every LOA lead note is emailed here, on top of the loan officer. Leave blank to send only to the loan officer.
                </p>
              </div>
            )}
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
                disabled={!dirty || !replyToValid || !filesToValid || !notesToValid || save.isPending}
                onClick={() => save.mutate({
                  fromName: fromName.trim(), replyTo: replyTo.trim(), filesRecipient: filesTo.trim(),
                  ...(hasNotesRecipient ? { notesRecipient: notesTo.trim() } : {}),
                })}
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
