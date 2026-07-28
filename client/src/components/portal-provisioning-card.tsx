import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Mail, MailWarning, Send, UserPlus } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Row = {
  type: "lo" | "loa";
  id: number;
  name: string;
  loName: string | null;
  email: string | null;
  userId: number | null;
  portal: "lap" | "lop";
  status: "has_login" | "ready" | "needs_email";
};
type Resp = {
  rows: Row[];
  summary: { total: number; hasLogin: number; ready: number; needsEmail: number };
};

const key = (r: Row) => `${r.type}:${r.id}`;

/**
 * Admin view over the check-in roster: who has a portal login, who can be
 * invited, and who cannot because no email address is on file.
 *
 * Inviting mails people outside the company, so there is no "invite everyone"
 * button — you tick the specific rows and confirm the count before sending.
 */
export function PortalProvisioningCard() {
  const { toast } = useToast();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [emails, setEmails] = useState<Record<string, string>>({});

  const q = useQuery<Resp>({ queryKey: ["/api/portal-provisioning"] });
  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary;

  const invitable = useMemo(() => rows.filter((r) => r.status === "ready"), [rows]);
  const selected = useMemo(() => invitable.filter((r) => picked.has(key(r))), [invitable, picked]);

  const toggle = (r: Row) =>
    setPicked((prev) => {
      const next = new Set(prev);
      next.has(key(r)) ? next.delete(key(r)) : next.add(key(r));
      return next;
    });

  const saveEmail = useMutation({
    mutationFn: (v: { row: Row; email: string }) =>
      v.row.type === "loa"
        ? apiRequest("PATCH", `/api/loan-officer-assistants/${v.row.id}`, { email: v.email })
        : apiRequest("PATCH", `/api/loan-officers/${v.row.id}`, { email: v.email }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-provisioning"] });
      toast({ title: "Email saved" });
    },
    onError: (e: any) => toast({ title: "Could not save the email", description: e?.message, variant: "destructive" }),
  });

  const invite = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/portal-provisioning/invite", {
        subjects: selected.map((r) => ({ type: r.type, id: r.id })),
      }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/portal-provisioning"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setPicked(new Set());
      const failed = (res?.results ?? []).filter((r: any) => !r.ok);
      toast({
        title: `${res?.invited ?? 0} login${res?.invited === 1 ? "" : "s"} created`,
        description: failed.length
          ? `${failed.length} skipped: ${failed.slice(0, 2).map((f: any) => `${f.name ?? f.id} (${f.reason})`).join("; ")}`
          : "Welcome emails are queued and go out shortly.",
        variant: failed.length ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Could not send invites", description: e?.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-muted-foreground" /> Portal Logins
        </CardTitle>
        <CardDescription>
          Everyone on the check-in roster. Loan officers get an LOP login, assistants get LAP.
          {summary && (
            <> {" "}<strong>{summary.hasLogin}</strong> have one, <strong>{summary.ready}</strong> ready to invite,{" "}
              <strong>{summary.needsEmail}</strong> missing an email.</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isLoading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : (
          <>
            <div className="rounded-md border divide-y max-h-[420px] overflow-y-auto">
              {rows.map((r) => (
                <div key={key(r)} className="flex flex-wrap items-center gap-3 px-3 py-2.5" data-testid={`prov-row-${r.type}-${r.id}`}>
                  {r.status === "ready" ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={picked.has(key(r))}
                      onChange={() => toggle(r)}
                      aria-label={`Invite ${r.name}`}
                      data-testid={`prov-pick-${r.type}-${r.id}`}
                    />
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {r.name}
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {r.portal}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.email ?? "no email on file"}{r.loName ? ` · ${r.loName}` : ""}
                    </p>
                  </div>
                  {r.status === "has_login" ? (
                    <Badge variant="outline" className="gap-1 font-normal text-emerald-700 border-emerald-300 dark:text-emerald-400 dark:border-emerald-800">
                      <CheckCircle2 className="w-3 h-3" /> Has login
                    </Badge>
                  ) : r.status === "ready" ? (
                    <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                      <Mail className="w-3 h-3" /> Ready
                    </Badge>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="email"
                        placeholder="add an email"
                        className="h-8 w-[190px] text-xs"
                        value={emails[key(r)] ?? ""}
                        onChange={(e) => setEmails((m) => ({ ...m, [key(r)]: e.target.value }))}
                        data-testid={`prov-email-${r.type}-${r.id}`}
                      />
                      <Button
                        size="sm" variant="outline" className="h-8"
                        disabled={saveEmail.isPending || !/.+@.+\..+/.test(emails[key(r)] ?? "")}
                        onClick={() => saveEmail.mutate({ row: r, email: (emails[key(r)] ?? "").trim() })}
                      >
                        Save
                      </Button>
                      <MailWarning className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {selected.length
                  ? `${selected.length} selected — this emails ${selected.length === 1 ? "a person" : "people"} outside the company.`
                  : "Tick the people you want to invite."}
              </p>
              <Button
                className="gap-1.5"
                disabled={!selected.length || invite.isPending}
                onClick={() => {
                  const names = selected.map((r) => r.name).join(", ");
                  if (!window.confirm(`Create logins and email ${selected.length} ${selected.length === 1 ? "person" : "people"}?\n\n${names}`)) return;
                  invite.mutate();
                }}
                data-testid="prov-invite"
              >
                {invite.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Invite {selected.length || ""}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
