import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import {
  CalendarDays, Eye, Mail, FileText, Loader2, AlertCircle, Inbox, Clock, ArrowLeft,
} from "lucide-react";

type ReportType = "daily" | "weekly" | "monthly";

type PreviewResult = {
  type: ReportType;
  startDate: string;
  endDate: string;
  subject: string;
  html: string;
};

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function describeRange(type: ReportType, picked: string): { hint: string } {
  if (!picked) return { hint: "" };
  if (type === "daily") return { hint: `${picked}` };
  if (type === "weekly") {
    const d = new Date(picked + "T00:00:00");
    const dow = d.getUTCDay();
    const sun = new Date(d); sun.setUTCDate(d.getUTCDate() - dow);
    const sat = new Date(sun); sat.setUTCDate(sun.getUTCDate() + 6);
    return { hint: `${sun.toISOString().split("T")[0]} → ${sat.toISOString().split("T")[0]}` };
  }
  // monthly: 16th of prev month → 15th of containing month
  const d = new Date(picked + "T00:00:00Z");
  const day = d.getUTCDate();
  let endY = d.getUTCFullYear();
  let endM = d.getUTCMonth();
  if (day > 15) { endM += 1; if (endM > 11) { endM = 0; endY += 1; } }
  const startY = endM === 0 ? endY - 1 : endY;
  const startM = endM === 0 ? 11 : endM - 1;
  const fmt = (y: number, m: number, dd: number) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  return { hint: `${fmt(startY, startM, 16)} → ${fmt(endY, endM, 15)}` };
}

export default function ReportsArchive() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [type, setType] = useState<ReportType>("weekly");
  const [picked, setPicked] = useState<string>(todayISO());
  const [recipients, setRecipients] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  useEffect(() => {
    document.title = "Report Archive · WCLCC";
  }, []);

  const isAuthorized = user?.role === "admin" || user?.role === "viewer";

  const { hint } = useMemo(() => describeRange(type, picked), [type, picked]);

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/reports/preview", {
        type,
        startDate: picked,
        endDate: picked,
      });
      return (await res.json()) as PreviewResult;
    },
    onSuccess: (data) => setPreview(data),
    onError: (e: any) => toast({ title: "Preview failed", description: e?.message ?? "", variant: "destructive" }),
  });

  const emailMutation = useMutation({
    mutationFn: async (toList: string[]) => {
      const res = await apiRequest("POST", "/api/reports/email", {
        type,
        startDate: picked,
        endDate: picked,
        recipients: toList,
      });
      return await res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Report sent",
        description: `Sent to ${data?.recipients?.join(", ") ?? "recipients"}`,
      });
    },
    onError: (e: any) =>
      toast({ title: "Send failed", description: e?.message ?? "", variant: "destructive" }),
  });

  const onPreview = () => {
    if (!picked) return;
    setPreview(null);
    previewMutation.mutate();
  };

  const onEmailToMe = () => {
    if (!picked) return;
    emailMutation.mutate([]); // empty → server uses requester's email
  };

  const onEmailToList = () => {
    const list = recipients
      .split(/[,;\s]+/)
      .map((r) => r.trim())
      .filter(Boolean);
    if (!list.length) {
      toast({ title: "Enter at least one email", variant: "destructive" });
      return;
    }
    emailMutation.mutate(list);
  };

  if (!isAuthorized) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card>
          <CardContent className="py-10 text-center">
            <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
            <h2 className="text-lg font-semibold mb-1">Not available</h2>
            <p className="text-sm text-muted-foreground">
              The Report Archive is restricted to admin and viewer accounts.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Inbox className="w-5 h-5 text-primary" />
            Report Archive
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Re-generate any past daily, weekly, or monthly report and send it to your inbox.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-4 h-4" /> Choose a report
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Report type</Label>
            <div className="flex gap-2 mt-1.5">
              {(["daily", "weekly", "monthly"] as ReportType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setType(t); setPreview(null); }}
                  className={`px-3 py-1.5 rounded-md text-sm border transition ${
                    type === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background hover:bg-muted/50"
                  }`}
                  data-testid={`report-type-${t}`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="picked" className="text-xs uppercase tracking-wide text-muted-foreground">
                {type === "daily" ? "Date" : type === "weekly" ? "Any date in the week" : "Any date in the period"}
              </Label>
              <Input
                id="picked"
                type="date"
                value={picked}
                onChange={(e) => { setPicked(e.target.value); setPreview(null); }}
                className="mt-1.5"
                data-testid="report-date-picker"
              />
            </div>
            <div>
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Resolved range
              </Label>
              <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/20 text-sm">
                <CalendarDays className="w-4 h-4 text-muted-foreground" />
                <span className="font-mono">{hint || "—"}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={onPreview} disabled={previewMutation.isPending} data-testid="btn-preview">
              {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
              Preview
            </Button>
            <Button variant="secondary" onClick={onEmailToMe} disabled={emailMutation.isPending} data-testid="btn-email-me">
              {emailMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
              Email to me
            </Button>
          </div>

          <div className="pt-2 border-t">
            <Label htmlFor="recipients" className="text-xs uppercase tracking-wide text-muted-foreground">
              Or send to specific addresses
            </Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                id="recipients"
                type="text"
                placeholder="manager@example.com, ops@example.com"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                data-testid="report-recipients-input"
              />
              <Button onClick={onEmailToList} disabled={emailMutation.isPending} data-testid="btn-email-list">
                Send
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Comma- or space-separated. Won't change the saved Report Recipients list.
            </p>
          </div>
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4" /> Preview
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="font-mono">{preview.startDate}</span>
                <span className="mx-1">→</span>
                <span className="font-mono">{preview.endDate}</span>
                <span className="mx-2">·</span>
                <Badge variant="outline" className="text-xs">{preview.type}</Badge>
              </p>
              <p className="text-sm font-medium mt-1.5">{preview.subject}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              <ArrowLeft className="w-4 h-4 mr-1" /> Close preview
            </Button>
          </CardHeader>
          <CardContent>
            <iframe
              title="Report preview"
              srcDoc={preview.html}
              className="w-full rounded-md border bg-white"
              style={{ height: "70vh", minHeight: 520 }}
              sandbox="allow-same-origin"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
