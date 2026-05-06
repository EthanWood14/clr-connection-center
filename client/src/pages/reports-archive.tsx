import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
  Pencil, RotateCcw, Download,
} from "lucide-react";
import { businessTodayClient } from "@/lib/business-day";

type ReportType = "daily" | "weekly" | "monthly";

type PreviewResult = {
  type: ReportType;
  startDate: string;
  endDate: string;
  subject: string;
  html: string;
};

function todayISO(): string {
  return businessTodayClient();
}

// Returns the canonical { startDate, endDate } the server would resolve when
// given a single `picked` date for the chosen report type. Used to (a) show a
// read-only "Resolved range" hint, and (b) seed the editable range inputs.
function resolveRange(type: ReportType, picked: string): { startDate: string; endDate: string } {
  if (!picked) return { startDate: "", endDate: "" };
  if (type === "daily") return { startDate: picked, endDate: picked };
  if (type === "weekly") {
    const d = new Date(picked + "T00:00:00");
    const dow = d.getUTCDay();
    const sun = new Date(d); sun.setUTCDate(d.getUTCDate() - dow);
    const sat = new Date(sun); sat.setUTCDate(sun.getUTCDate() + 6);
    return {
      startDate: sun.toISOString().split("T")[0],
      endDate: sat.toISOString().split("T")[0],
    };
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
  return { startDate: fmt(startY, startM, 16), endDate: fmt(endY, endM, 15) };
}

export default function ReportsArchive() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [type, setType] = useState<ReportType>("weekly");
  const [picked, setPicked] = useState<string>(todayISO());
  const [recipients, setRecipients] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  // 0 means "All CLRs (whole team)"; otherwise a specific user id
  const [selectedClrId, setSelectedClrId] = useState<number>(0);
  // Custom range editing. When `editingRange` is false the server expands
  // `picked` to the natural window for the report type. When true, the user
  // can override the start/end dates directly.
  const [editingRange, setEditingRange] = useState(false);
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [downloadPending, setDownloadPending] = useState(false);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    document.title = "Report Archive · WCLCC";
  }, []);

  const isAuthorized = user?.role === "admin" || user?.role === "viewer";

  const resolved = useMemo(() => resolveRange(type, picked), [type, picked]);
  const hint = resolved.startDate && resolved.endDate
    ? (resolved.startDate === resolved.endDate
        ? resolved.startDate
        : `${resolved.startDate} → ${resolved.endDate}`)
    : "";

  // The dates we'll actually send to the server.
  const effectiveStart = editingRange ? customStart : picked;
  const effectiveEnd = editingRange ? customEnd : picked;

  // Reset the custom range whenever the user changes report type or picked
  // date — the natural window changes, and the previously-typed dates may no
  // longer make sense. Also exit edit mode so they see the new resolved range.
  useEffect(() => {
    setEditingRange(false);
    setCustomStart(resolved.startDate);
    setCustomEnd(resolved.endDate);
    setRangeError(null);
  }, [type, picked, resolved.startDate, resolved.endDate]);

  function validateCustomRange(): string | null {
    if (!editingRange) return null;
    if (!customStart || !customEnd) return "Both start and end dates are required.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(customStart) || !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
      return "Use YYYY-MM-DD dates.";
    }
    if (customStart > customEnd) return "Start date must be on or before end date.";
    return null;
  }

  // Fetch the list of CLRs to filter by
  const { data: clrs } = useQuery<{ id: number; name: string; email: string }[]>({
    queryKey: ["/api/reports/clrs"],
    queryFn: () => fetch("/api/reports/clrs", { credentials: "include" }).then((r) => r.json()),
    enabled: isAuthorized,
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const data = await apiRequest("POST", "/api/reports/preview", {
        type,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        clrId: selectedClrId,
      });
      return data as PreviewResult;
    },
    onSuccess: (data) => setPreview(data),
    onError: (e: any) => toast({ title: "Preview failed", description: e?.message ?? "", variant: "destructive" }),
  });

  const emailMutation = useMutation({
    mutationFn: async (toList: string[]) => {
      const data = await apiRequest("POST", "/api/reports/email", {
        type,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        recipients: toList,
        clrId: selectedClrId,
      });
      return data;
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
    const err = validateCustomRange();
    if (err) { setRangeError(err); toast({ title: "Invalid range", description: err, variant: "destructive" }); return; }
    setRangeError(null);
    setPreview(null);
    previewMutation.mutate();
  };

  const onEmailToMe = () => {
    if (!picked) return;
    const err = validateCustomRange();
    if (err) { setRangeError(err); toast({ title: "Invalid range", description: err, variant: "destructive" }); return; }
    setRangeError(null);
    emailMutation.mutate([]); // empty → server uses requester's email
  };

  // Triggers the browser's native print dialog on the report HTML, where the
  // user can choose "Save as PDF" as the destination. Works reliably across
  // Chrome, Edge, Safari, and Firefox without any server-side Chromium
  // dependency — the PDF is rendered by the user's browser from the same
  // HTML the email recipients see.
  const printHtml = (html: string, suggestedTitle: string) => {
    // Open a new tab and write the HTML into it. We use a blank tab + document.write
    // (rather than a data: URL) because data: URLs are increasingly blocked as the
    // top-level frame in modern browsers.
    const w = window.open("", "_blank");
    if (!w) {
      toast({
        title: "Pop-up blocked",
        description: "Allow pop-ups for this site to download the PDF, then try again.",
        variant: "destructive",
      });
      return;
    }
    // Inject a <title> so the saved-PDF filename suggestion is meaningful.
    let injected = html;
    const titleTag = `<title>${suggestedTitle.replace(/</g, "&lt;")}</title>`;
    if (/<head[^>]*>/i.test(injected)) {
      injected = injected.replace(/<head([^>]*)>/i, (m) => `${m}\n${titleTag}`);
    } else if (/<html[^>]*>/i.test(injected)) {
      injected = injected.replace(/<html([^>]*)>/i, (m) => `${m}<head>${titleTag}</head>`);
    } else {
      injected = `<!doctype html><html><head>${titleTag}</head><body>${injected}</body></html>`;
    }
    w.document.open();
    w.document.write(injected);
    w.document.close();
    // Give the new window a tick to lay out (images, fonts) before opening the
    // print dialog. Some browsers also need focus on the window first.
    const triggerPrint = () => {
      try {
        w.focus();
        w.print();
      } catch {
        // Best-effort — fall back to leaving the tab open so the user can print manually.
      }
    };
    if (w.document.readyState === "complete") {
      setTimeout(triggerPrint, 250);
    } else {
      w.addEventListener?.("load", () => setTimeout(triggerPrint, 250));
      // Belt-and-braces: also fire after a short delay in case the load event already passed.
      setTimeout(triggerPrint, 800);
    }
  };

  const reportTitle = () => {
    const range = effectiveStart === effectiveEnd ? effectiveStart : `${effectiveStart}_to_${effectiveEnd}`;
    return `CLR-${type}-report-${range}`;
  };

  // "Download PDF" path: if a preview is already loaded, print that. Otherwise
  // fetch a fresh render with the current selections and print it.
  const onDownloadPdf = async () => {
    if (!picked) return;
    const err = validateCustomRange();
    if (err) { setRangeError(err); toast({ title: "Invalid range", description: err, variant: "destructive" }); return; }
    setRangeError(null);
    if (preview?.html) {
      printHtml(preview.html, reportTitle());
      return;
    }
    try {
      setDownloadPending(true);
      const data = await apiRequest("POST", "/api/reports/preview", {
        type,
        startDate: effectiveStart,
        endDate: effectiveEnd,
        clrId: selectedClrId,
      }) as PreviewResult;
      setPreview(data);
      printHtml(data.html, reportTitle());
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message ?? "", variant: "destructive" });
    } finally {
      setDownloadPending(false);
    }
  };

  const onPrintPreview = () => {
    if (!preview?.html) return;
    printHtml(preview.html, reportTitle());
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
    const err = validateCustomRange();
    if (err) { setRangeError(err); toast({ title: "Invalid range", description: err, variant: "destructive" }); return; }
    setRangeError(null);
    emailMutation.mutate(list);
  };

  const onStartEdit = () => {
    setCustomStart(resolved.startDate);
    setCustomEnd(resolved.endDate);
    setEditingRange(true);
    setRangeError(null);
  };
  const onResetRange = () => {
    setCustomStart(resolved.startDate);
    setCustomEnd(resolved.endDate);
    setEditingRange(false);
    setRangeError(null);
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

          <div>
            <Label htmlFor="clr" className="text-xs uppercase tracking-wide text-muted-foreground">
              CLR (whose activity to include)
            </Label>
            <select
              id="clr"
              value={selectedClrId}
              onChange={(e) => { setSelectedClrId(Number(e.target.value)); setPreview(null); }}
              className="mt-1.5 w-full px-3 py-2 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="report-clr-select"
            >
              <option value={0}>All CLRs — full team report</option>
              {(clrs ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
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
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Resolved range
                </Label>
                {!editingRange ? (
                  <button
                    type="button"
                    onClick={onStartEdit}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
                    data-testid="btn-edit-range"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onResetRange}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
                    data-testid="btn-reset-range"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset to auto
                  </button>
                )}
              </div>
              {!editingRange ? (
                <div className="mt-1.5 flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/20 text-sm">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                  <span className="font-mono">{hint || "—"}</span>
                </div>
              ) : (
                <div className="mt-1.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={customStart}
                      max={customEnd || undefined}
                      onChange={(e) => { setCustomStart(e.target.value); setRangeError(null); setPreview(null); }}
                      className="text-sm"
                      data-testid="report-custom-start"
                      aria-label="Custom start date"
                    />
                    <span className="text-muted-foreground text-sm">→</span>
                    <Input
                      type="date"
                      value={customEnd}
                      min={customStart || undefined}
                      onChange={(e) => { setCustomEnd(e.target.value); setRangeError(null); setPreview(null); }}
                      className="text-sm"
                      data-testid="report-custom-end"
                      aria-label="Custom end date"
                    />
                  </div>
                  {rangeError ? (
                    <p className="text-xs text-red-600">{rangeError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Custom range overrides the auto window. Server still labels the report as <span className="font-medium">{type}</span>.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button onClick={onPreview} disabled={previewMutation.isPending} data-testid="btn-preview">
              {previewMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Eye className="w-4 h-4 mr-2" />}
              Preview
            </Button>
            <Button variant="secondary" onClick={onDownloadPdf} disabled={downloadPending || previewMutation.isPending} data-testid="btn-download-pdf">
              {downloadPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Download PDF
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
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={onPrintPreview} data-testid="btn-download-pdf-preview">
                <Download className="w-4 h-4 mr-1" /> Download PDF
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
                <ArrowLeft className="w-4 h-4 mr-1" /> Close preview
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <iframe
              ref={previewIframeRef}
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
