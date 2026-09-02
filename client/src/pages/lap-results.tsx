import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  Combine,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PackageNotesThread } from "@/components/lap/package-notes-thread";
import {
  deleteLapResultFile,
  downloadLapResultFile,
  formatLapBytes,
  formatLapDate,
  LAP_DOCUMENTS,
  lapRequest,
  type LapDocumentType,
  type LapFileKey,
  type LapResult,
  type LapResultFile,
  type LapResultPayload,
  unwrapLapResult,
  unwrapLapResults,
  uploadLapResultFile,
} from "@/lib/lap-api";

type FormState = {
  borrowerName: string;
  dealReference: string;
  loanOfficerId: string;
  notes: string;
  resultDate: string;
};

type CreateFileState = Record<LapFileKey, File | null>;

type CreatedPackageUploadError = Error & {
  createdResult: LapResult;
  failedDocumentLabel: string;
  uploadedCount: number;
};

const LAP_FILE_MAX_BYTES = 12 * 1024 * 1024;
const LAP_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";
const LAP_ALLOWED_FILE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);

const emptyForm = (): FormState => ({
  borrowerName: "",
  dealReference: "",
  loanOfficerId: "none",
  notes: "",
  resultDate: new Date().toLocaleDateString("en-CA"),
});

const emptyCreateFiles = (): CreateFileState => ({
  creditReport: null,
  aus: null,
  formalQuote: null,
});

function validateLapFile(file: File): { title: string; description: string } | null {
  const extensionAllowed = /\.(pdf|png|jpe?g)$/i.test(file.name);
  const mime = file.type.toLowerCase();
  const genericMime = mime === "" || mime === "application/octet-stream";
  if (!LAP_ALLOWED_FILE_TYPES.has(mime) && !(genericMime && extensionAllowed)) {
    return { title: "Unsupported file type", description: "Upload a PDF, PNG, or JPEG file." };
  }
  if (file.size <= 0) {
    return { title: "File is empty", description: "Choose a file that contains document data." };
  }
  if (file.size > LAP_FILE_MAX_BYTES) {
    return { title: "File is too large", description: "LAP files must be 12 MB or smaller." };
  }
  return null;
}

function formFromResult(result: LapResult): FormState {
  return {
    borrowerName: result.borrowerName ?? "",
    dealReference: result.dealReference ?? "",
    loanOfficerId: result.loanOfficerId ? String(result.loanOfficerId) : "none",
    notes: result.notes ?? "",
    resultDate: result.resultDate ?? "",
  };
}

function payloadFromForm(form: FormState): LapResultPayload {
  return {
    borrowerName: form.borrowerName.trim(),
    dealReference: form.dealReference.trim() || null,
    loanOfficerId: form.loanOfficerId === "none" ? null : Number(form.loanOfficerId),
    notes: form.notes.trim() || null,
    resultDate: form.resultDate,
  };
}

function initials(name?: string | null) {
  return (name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function ResultStatus({ result, compact = false }: { result: LapResult; compact?: boolean }) {
  const completed = LAP_DOCUMENTS.filter((document) => !!result.files?.[document.key]).length;
  return result.complete ? (
    <Badge className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
      <CheckCircle2 className="h-3 w-3" /> All 3 attached
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <FileSearch className="h-3 w-3" /> {compact ? `${completed}/3` : `${completed} of 3 optional documents`}
    </Badge>
  );
}

function DocumentIcon({ documentKey }: { documentKey: LapFileKey }) {
  if (documentKey === "creditReport") return <FileText className="h-5 w-5" />;
  if (documentKey === "aus") return <FileSearch className="h-5 w-5" />;
  return <FileCheck2 className="h-5 w-5" />;
}

function OptionalDocumentPicker({
  documentKey,
  label,
  description,
  file,
  disabled,
  onSelect,
}: {
  documentKey: LapFileKey;
  label: string;
  description: string;
  file: File | null;
  disabled: boolean;
  onSelect: (file: File | null) => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function acceptFile(nextFile?: File) {
    if (!nextFile || disabled) return;
    const validationError = validateLapFile(nextFile);
    if (validationError) {
      toast({ ...validationError, variant: "destructive" });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onSelect(nextFile);
    if (inputRef.current) inputRef.current.value = "";
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  return (
    <div
      className={`relative rounded-xl border p-4 transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-70"
          : dragging
            ? "cursor-pointer border-primary bg-primary/10"
            : file
              ? "cursor-pointer border-emerald-300/80 bg-emerald-50/40 hover:border-emerald-400 dark:border-emerald-900 dark:bg-emerald-950/10"
              : "cursor-pointer border-dashed bg-muted/20 hover:border-primary/60 hover:bg-primary/5"
      }`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={`${file ? "Replace" : "Attach"} ${label}`}
      onClick={openPicker}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openPicker();
        }
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        acceptFile(event.dataTransfer.files?.[0]);
      }}
      data-testid={`lap-create-document-${documentKey}`}
    >
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={LAP_FILE_ACCEPT}
        disabled={disabled}
        onChange={(event) => acceptFile(event.target.files?.[0])}
      />
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          file ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-primary/10 text-primary"
        }`}>
          {file ? <Check className="h-5 w-5" /> : <DocumentIcon documentKey={documentKey} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{label}</p>
            <Badge variant="outline" className="h-5 border-primary/30 text-[10px] text-primary">Optional</Badge>
          </div>
          {file ? (
            <>
              <p className="mt-1 truncate text-sm font-medium" title={file.name}>{file.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatLapBytes(file.size)} · Click or drop to replace
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              <p className="mt-2 text-[11px] font-medium text-primary">Click to choose or drop a PDF, PNG, or JPEG</p>
            </>
          )}
        </div>
        {file && !disabled && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            aria-label={`Remove selected ${label}`}
            onClick={(event) => {
              event.stopPropagation();
              if (inputRef.current) inputRef.current.value = "";
              onSelect(null);
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

function DocumentSlot({
  resultId,
  documentType,
  documentKey,
  label,
  description,
  file,
  isAdmin,
}: {
  resultId: number;
  documentType: LapDocumentType;
  documentKey: LapFileKey;
  label: string;
  description: string;
  file: LapResultFile | null;
  isAdmin: boolean;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<"upload" | "download" | "delete" | null>(null);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["/api/lap/results"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/lap/stats"] });
    await queryClient.invalidateQueries({ queryKey: ["/api/lap/team-stats"] });
  }

  async function acceptFile(nextFile?: File) {
    if (!nextFile) return;
    const validationError = validateLapFile(nextFile);
    if (validationError) {
      toast({ ...validationError, variant: "destructive" });
      return;
    }
    setBusy("upload");
    try {
      await uploadLapResultFile(resultId, documentType, nextFile);
      toast({ title: file ? `${label} replaced` : `${label} uploaded`, description: nextFile.name });
      await refresh();
    } catch (error: any) {
      toast({ title: `Could not upload ${label}`, description: error?.message, variant: "destructive" });
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function download() {
    if (!file) return;
    setBusy("download");
    try {
      await downloadLapResultFile(file);
    } catch (error: any) {
      toast({ title: "Download failed", description: error?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!file || !window.confirm(`Remove ${file.filename}? This action is recorded in the audit log.`)) return;
    setBusy("delete");
    try {
      await deleteLapResultFile(file.id);
      toast({ title: `${label} removed` });
      await refresh();
    } catch (error: any) {
      toast({ title: "Could not remove file", description: error?.message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={`group relative rounded-xl border p-4 transition-colors ${
        dragging
          ? "border-primary bg-primary/10"
          : file
            ? "border-emerald-300/80 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10"
            : "border-dashed bg-muted/20 hover:border-primary/60 hover:bg-primary/5"
      }`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void acceptFile(event.dataTransfer.files?.[0]);
      }}
      data-testid={`lap-document-slot-${documentType}`}
    >
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept={LAP_FILE_ACCEPT}
        onChange={(event) => void acceptFile(event.target.files?.[0])}
      />
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          file ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300" : "bg-primary/10 text-primary"
        }`}>
          {file ? <Check className="h-5 w-5" /> : <DocumentIcon documentKey={documentKey} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{label}</p>
            {file && <Badge variant="outline" className="h-5 text-[10px]">v{file.version ?? 1}</Badge>}
          </div>
          {file ? (
            <>
              <p className="mt-1 truncate text-sm font-medium" title={file.filename}>{file.filename}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatLapBytes(file.sizeBytes)}
                {file.uploadedByName ? ` · ${file.uploadedByName}` : ""}
                {(file.uploadedAt || file.createdAt) ? ` · ${formatLapDate(file.uploadedAt || file.createdAt, true)}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
              <p className="mt-2 text-[11px] font-medium text-primary">Drop a PDF or image here</p>
            </>
          )}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={file ? "outline" : "default"}
          onClick={() => inputRef.current?.click()}
          disabled={busy !== null}
          className="gap-1.5"
        >
          {busy === "upload" ? <RefreshCw className="animate-spin" /> : <UploadCloud />}
          {file ? "Replace" : "Choose file"}
        </Button>
        {file && isAdmin && (
          <Button type="button" size="sm" variant="secondary" onClick={() => void download()} disabled={busy !== null}>
            {busy === "download" ? <RefreshCw className="animate-spin" /> : <Download />} Download
          </Button>
        )}
        {file && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void remove()} disabled={busy !== null} className="text-destructive">
            {busy === "delete" ? <RefreshCw className="animate-spin" /> : <Trash2 />} Remove
          </Button>
        )}
      </div>
    </div>
  );
}

function ResultEditor({
  result,
  isAdmin,
  isLoSide,
  mergeCandidates,
}: {
  result: LapResult;
  isAdmin: boolean;
  isLoSide: boolean;
  mergeCandidates: LapResult[];
}) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [sourcePackageId, setSourcePackageId] = useState("");
  const [form, setForm] = useState<FormState>(() => formFromResult(result));

  useEffect(() => {
    setForm(formFromResult(result));
    setEditing(false);
  }, [result.id, result.updatedAt]);

  const updateMutation = useMutation({
    mutationFn: () => lapRequest("PATCH", `/api/lap/results/${result.id}`, payloadFromForm(form)),
    onSuccess: async () => {
      toast({ title: "Package updated" });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/lap/results"] });
    },
    onError: (error: any) => toast({ title: "Could not save changes", description: error?.message, variant: "destructive" }),
  });

  const mergeMutation = useMutation({
    mutationFn: () => lapRequest("POST", `/api/lap/results/${result.id}/merge`, { sourcePackageId: Number(sourcePackageId) }),
    onSuccess: async () => {
      toast({ title: "Packages merged", description: "Documents, transfer links, notes, and history now live in one package." });
      setMerging(false);
      setSourcePackageId("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/lap/results"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/lap/transfer-audit"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/lap/stats"] }),
      ]);
    },
    onError: (error: any) => toast({ title: "Could not merge packages", description: error?.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <ResultStatus result={result} />
            {result.dealReference && <Badge variant="outline">{result.dealReference}</Badge>}
          </div>
          <h2 className="truncate text-2xl font-bold tracking-tight">{result.borrowerName}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {formatLapDate(result.resultDate || result.createdAt)}</span>
          </div>
        </div>
        <Button variant={editing ? "ghost" : "outline"} size="sm" onClick={() => setEditing((current) => !current)}>
          {editing ? <X /> : <Pencil />} {editing ? "Cancel" : "Edit details"}
        </Button>
      </div>

      {editing ? (
        <div className="rounded-xl border bg-muted/20 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`lap-borrower-${result.id}`}>Borrower name</Label>
              <Input
                id={`lap-borrower-${result.id}`}
                value={form.borrowerName}
                onChange={(event) => setForm({ ...form, borrowerName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`lap-deal-${result.id}`}>Deal reference</Label>
              <Input
                id={`lap-deal-${result.id}`}
                value={form.dealReference}
                onChange={(event) => setForm({ ...form, dealReference: event.target.value })}
                placeholder="Loan number, CRM ID, or internal reference"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`lap-date-${result.id}`}>Result date</Label>
              <Input
                id={`lap-date-${result.id}`}
                type="date"
                required
                value={form.resultDate}
                onChange={(event) => setForm({ ...form, resultDate: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor={`lap-notes-${result.id}`}>Operational notes</Label>
              <Textarea
                id={`lap-notes-${result.id}`}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Add context another team member needs to understand this package."
                rows={3}
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!form.borrowerName.trim() || !form.resultDate || updateMutation.isPending}
            >
              {updateMutation.isPending ? <RefreshCw className="animate-spin" /> : <Check />} Save changes
            </Button>
          </div>
        </div>
      ) : (
        result.notes && (
          <div className="rounded-lg border bg-muted/20 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Operational notes</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{result.notes}</p>
          </div>
        )
      )}

      <div>
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="font-semibold">Documents</h3>
            <p className="text-xs text-muted-foreground">
              Every document is optional. Add a Credit Report, AUS, or Formal Quote whenever it is useful.
            </p>
          </div>
          {isAdmin && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Admin downloads are audited
            </span>
          )}
        </div>
        <div className="grid gap-3 xl:grid-cols-3">
          {LAP_DOCUMENTS.map((document) => (
            <DocumentSlot
              key={document.type}
              resultId={result.id}
              documentType={document.type}
              documentKey={document.key}
              label={document.label}
              description={document.description}
              file={result.files?.[document.key] ?? null}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      </div>

      <PackageNotesThread key={result.id} result={result} isLoSide={isLoSide} isAdmin={isAdmin} />

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-[11px] text-muted-foreground">
        <span>Created by {result.createdByName || "Unknown"} · {formatLapDate(result.createdAt, true)}</span>
        <span>Last updated by {result.updatedByName || result.createdByName || "Unknown"} · {formatLapDate(result.updatedAt, true)}</span>
      </div>
      <div className="rounded-xl border border-dashed p-3">
        {!merging ? (
          <div className="flex items-center justify-between gap-3">
            <div><p className="text-sm font-medium">Started this borrower twice?</p><p className="text-xs text-muted-foreground">Merge another package into this one without losing documents or history.</p></div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setMerging(true)} disabled={mergeCandidates.length === 0}><Combine /> Merge package</Button>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex-1 space-y-1"><Label>Package to merge into {result.borrowerName}</Label><Select value={sourcePackageId} onValueChange={setSourcePackageId}><SelectTrigger><SelectValue placeholder="Choose a duplicate package" /></SelectTrigger><SelectContent>{mergeCandidates.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.borrowerName} · {formatLapDate(candidate.resultDate)}</SelectItem>)}</SelectContent></Select></div>
            <Button variant="ghost" onClick={() => { setMerging(false); setSourcePackageId(""); }} disabled={mergeMutation.isPending}>Cancel</Button>
            <Button onClick={() => mergeMutation.mutate()} disabled={!sourcePackageId || mergeMutation.isPending}>{mergeMutation.isPending ? <RefreshCw className="animate-spin" /> : <Combine />} Merge</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LapResults() {
  const pageSize = 25;
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const isAdmin = user?.role === "admin" || !!user?.superAdmin;
  // Same rule the server uses for who may post LO remarks: admins, or anyone
  // signed into the LO portal. This used to be plain isAdmin, so an LO on
  // /lop never saw the reply box.
  const isLoSide = isAdmin || user?.portal === "lop";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loaId, setLoaId] = useState("all");
  const [page, setPage] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(() => emptyForm());
  const [createFiles, setCreateFiles] = useState<CreateFileState>(() => emptyCreateFiles());
  const detailRef = useRef<HTMLDivElement>(null);
  const deferredSearch = useDeferredValue(search.trim());
  const [matchesResultRoute, resultRouteParams] = useRoute<{ resultId: string }>("/results/:resultId");
  const requestedResultId = matchesResultRoute ? Number(resultRouteParams?.resultId) : 0;
  const hasValidRequestedResultId = Number.isInteger(requestedResultId) && requestedResultId > 0;

  useEffect(() => {
    setPage(0);
  }, [deferredSearch, status, loaId]);

  const loasQuery = useQuery({
    queryKey: ["/api/lap/loas"],
    queryFn: () => lapRequest<{ loas: { id: number; name: string; active: number }[] }>("GET", "/api/lap/loas"),
  });
  const loaOptions = loasQuery.data?.loas ?? [];

  const resultQueryString = useMemo(() => {
    const query = new URLSearchParams({
      limit: String(pageSize),
      offset: String(page * pageSize),
    });
    if (deferredSearch) query.set("q", deferredSearch);
    if (status !== "all") query.set("status", status);
    if (loaId !== "all") query.set("loaId", loaId);
    return query.toString();
  }, [deferredSearch, page, status, loaId]);

  const resultsQuery = useQuery({
    queryKey: ["/api/lap/results", "workspace", resultQueryString],
    queryFn: () => lapRequest<any>("GET", `/api/lap/results?${resultQueryString}`),
  });
  const requestedResultQuery = useQuery({
    queryKey: ["/api/lap/results", "detail", requestedResultId],
    queryFn: () => lapRequest<unknown>("GET", `/api/lap/results/${requestedResultId}`),
    enabled: hasValidRequestedResultId,
  });
  const mergeOptionsQuery = useQuery({
    queryKey: ["/api/lap/results", "merge-options"],
    queryFn: () => lapRequest<any>("GET", "/api/lap/results?limit=200"),
  });

  const results = useMemo(() => unwrapLapResults(resultsQuery.data), [resultsQuery.data]);
  const mergeOptions = useMemo(() => unwrapLapResults(mergeOptionsQuery.data), [mergeOptionsQuery.data]);
  const requestedResult = useMemo(() => {
    if (!requestedResultQuery.data) return null;
    try { return unwrapLapResult(requestedResultQuery.data); }
    catch { return null; }
  }, [requestedResultQuery.data]);
  const total = Number(resultsQuery.data?.total ?? results.length);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : page * pageSize + 1;
  const pageEnd = Math.min(total, page * pageSize + results.length);

  useEffect(() => {
    if (page > 0 && page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  useEffect(() => {
    if (matchesResultRoute) {
      if (requestedResult) setSelectedId(requestedResult.id);
      return;
    }
    if (requestedResult) {
      setSelectedId(requestedResult.id);
      return;
    }
    if (selectedId != null && results.some((result) => result.id === selectedId)) return;
    setSelectedId(results[0]?.id ?? null);
  }, [matchesResultRoute, requestedResult, results, selectedId]);

  useEffect(() => {
    if (!matchesResultRoute || !hasValidRequestedResultId) return;
    if (!window.matchMedia("(max-width: 1023px)").matches) return;
    const timer = window.setTimeout(() => {
      detailRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      detailRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [hasValidRequestedResultId, matchesResultRoute, requestedResultId]);

  const selected = matchesResultRoute
    ? requestedResult
    : results.find((result) => result.id === selectedId) ?? null;

  function resetCreateDialog() {
    setCreateForm(emptyForm());
    setCreateFiles(emptyCreateFiles());
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await lapRequest("POST", "/api/lap/results", payloadFromForm(createForm));
      const result = unwrapLapResult(response);

      for (let index = 0; index < LAP_DOCUMENTS.length; index += 1) {
        const document = LAP_DOCUMENTS[index];
        const file = createFiles[document.key];
        if (!file) continue;
        try {
          await uploadLapResultFile(result.id, document.type, file);
        } catch (error: any) {
          const uploadError = Object.assign(
            new Error(error?.message || `Could not upload ${document.label}.`),
            {
              createdResult: result,
              failedDocumentLabel: document.label,
              uploadedCount: index,
            },
          ) as CreatedPackageUploadError;
          throw uploadError;
        }
      }

      return result;
    },
    onSuccess: async (result) => {
      setCreating(false);
      resetCreateDialog();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/lap/results"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/lap/stats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/lap/team-stats"] }),
      ]);
      setSelectedId(result.id);
      navigate(`/results/${result.id}`);
      toast({
        title: "Result package created",
        description: "Add whichever documents are useful whenever they become available.",
      });
    },
    onError: async (error: any) => {
      const partialUploadError = error as Partial<CreatedPackageUploadError>;
      if (partialUploadError.createdResult && partialUploadError.failedDocumentLabel) {
        const result = partialUploadError.createdResult;
        const uploadedCount = Number(partialUploadError.uploadedCount ?? 0);
        setCreating(false);
        resetCreateDialog();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["/api/lap/results"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/lap/stats"] }),
          queryClient.invalidateQueries({ queryKey: ["/api/lap/team-stats"] }),
        ]);
        setSelectedId(result.id);
        navigate(`/results/${result.id}`);
        toast({
          title: `Package saved, but ${partialUploadError.failedDocumentLabel} did not upload`,
          description: `${uploadedCount} of 3 documents uploaded. Open the package and retry ${partialUploadError.failedDocumentLabel}. ${error?.message || ""}`.trim(),
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Could not create package", description: error?.message, variant: "destructive" });
    },
  });

  const completeCount = results.filter((result) => result.complete).length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary via-primary to-primary/75 px-5 py-6 text-primary-foreground shadow-lg sm:px-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
              <FileCheck2 className="h-4 w-4" /> LO Assistant Portal
            </div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Input Results</h1>
            <p className="mt-2 max-w-2xl text-sm text-primary-foreground/80">
              Build one clean package per borrower, then drop in the Credit Report, AUS findings, and Formal Quote.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-xl border border-white/15 bg-black/10 px-4 py-2.5">
              <p className="text-[10px] uppercase tracking-wider text-primary-foreground/65">Complete on page</p>
              <p className="text-xl font-bold tabular-nums">{completeCount}<span className="text-sm font-normal text-primary-foreground/60"> / {results.length}</span></p>
            </div>
            <Button className="bg-white text-primary hover:bg-white/90" onClick={() => setCreating(true)}>
              <Plus /> New package
            </Button>
          </div>
        </div>
      </section>

      <div className="grid min-h-[660px] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="space-y-4 border-b p-4">
            <div>
              <CardTitle className="text-base">Result packages</CardTitle>
              <CardDescription>{total} matching package{total === 1 ? "" : "s"} in the workspace</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Borrower, reference, LO…"
                className="pl-9"
                data-testid="lap-results-search"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All packages</SelectItem>
                <SelectItem value="incomplete">Fewer than 3 attached</SelectItem>
                <SelectItem value="complete">All 3 attached</SelectItem>
              </SelectContent>
            </Select>
            <Select value={loaId} onValueChange={setLoaId}>
              <SelectTrigger data-testid="lap-results-loa"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All LOAs</SelectItem>
                {loaOptions.map((loa) => (
                  <SelectItem key={loa.id} value={String(loa.id)}>
                    {loa.name}{loa.active ? "" : " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="max-h-[580px] overflow-y-auto p-2">
            {resultsQuery.isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />)}
              </div>
            ) : resultsQuery.isError ? (
              <div className="p-6 text-center">
                <p className="text-sm font-medium">Could not load packages</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => resultsQuery.refetch()}>
                  <RefreshCw /> Try again
                </Button>
              </div>
            ) : results.length === 0 ? (
              <div className="p-8 text-center">
                <FileSearch className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium">{deferredSearch || status !== "all" ? "No packages match" : "No result packages yet"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{deferredSearch || status !== "all" ? "Try a different search or filter." : "Create the first package to begin."}</p>
              </div>
            ) : (
              results.map((result) => (
                <button
                  key={result.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(result.id);
                    navigate(`/results/${result.id}`);
                  }}
                  className={`mb-1 w-full rounded-lg border px-3 py-3 text-left transition-colors ${
                    selectedId === result.id ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/60"
                  }`}
                  data-testid={`lap-result-row-${result.id}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {initials(result.borrowerName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{result.borrowerName}</p>
                        <ResultStatus result={result} compact />
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground">
                        {result.dealReference || "No reference"}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{formatLapDate(result.updatedAt, true)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </CardContent>
          {total > 0 && (
            <div className="flex items-center justify-between gap-2 border-t bg-muted/15 px-3 py-2.5 text-[11px] text-muted-foreground">
              <span className="tabular-nums">
                {pageStart}–{pageEnd} of {total}
                {resultsQuery.isFetching && !resultsQuery.isLoading ? " · Updating…" : ""}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Previous result page"
                  disabled={page === 0 || resultsQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(0, current - 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="min-w-[70px] text-center tabular-nums">Page {page + 1} of {pageCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-7 w-7"
                  aria-label="Next result page"
                  disabled={page >= pageCount - 1 || resultsQuery.isFetching}
                  onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        <div ref={detailRef} tabIndex={-1} className="scroll-mt-16 outline-none">
          <Card>
            <CardContent className="p-5 sm:p-6">
            {matchesResultRoute && hasValidRequestedResultId && requestedResultQuery.isLoading ? (
              <div className="flex min-h-[560px] flex-col items-center justify-center text-center">
                <RefreshCw className="h-7 w-7 animate-spin text-primary" />
                <p className="mt-3 text-sm font-medium">Opening result package…</p>
              </div>
            ) : matchesResultRoute && (
              !hasValidRequestedResultId
              || requestedResultQuery.isError
              || (!requestedResultQuery.isLoading && !requestedResult)
            ) ? (
              <div className="flex min-h-[560px] flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FileSearch className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">Result package unavailable</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  This package may have been archived, removed, or belongs to another workspace.
                </p>
                <Button variant="outline" className="mt-4" onClick={() => navigate("/results")}>
                  Return to result packages
                </Button>
              </div>
            ) : selected ? (
              <ResultEditor result={selected} isAdmin={isAdmin} isLoSide={isLoSide} mergeCandidates={mergeOptions.filter((candidate) => candidate.id !== selected.id)} />
            ) : (
              <div className="flex min-h-[560px] flex-col items-center justify-center text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <FileCheck2 className="h-7 w-7" />
                </div>
                <h2 className="mt-4 text-lg font-semibold">Select a result package</h2>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Choose a borrower on the left or create a package to start collecting documents.
                </p>
              </div>
            )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (createMutation.isPending) return;
          setCreating(open);
          if (!open) resetCreateDialog();
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[900px]">
          <DialogHeader>
            <DialogTitle>Create result package</DialogTitle>
            <DialogDescription>
              Enter the package details and attach whichever documents you have — you can add the rest later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="lap-create-borrower">Borrower name *</Label>
              <Input
                id="lap-create-borrower"
                value={createForm.borrowerName}
                onChange={(event) => setCreateForm({ ...createForm, borrowerName: event.target.value })}
                autoFocus
                placeholder="Borrower or household"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lap-create-deal">Deal reference</Label>
              <Input
                id="lap-create-deal"
                value={createForm.dealReference}
                onChange={(event) => setCreateForm({ ...createForm, dealReference: event.target.value })}
                placeholder="Loan number, CRM ID, or internal reference"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lap-create-date">Result date *</Label>
              <Input
                id="lap-create-date"
                type="date"
                required
                value={createForm.resultDate}
                onChange={(event) => setCreateForm({ ...createForm, resultDate: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="lap-create-notes">Operational notes</Label>
              <Textarea
                id="lap-create-notes"
                value={createForm.notes}
                onChange={(event) => setCreateForm({ ...createForm, notes: event.target.value })}
                placeholder="Optional context for the LO or another assistant"
                rows={3}
              />
            </div>
            <div className="space-y-3 border-t pt-4 sm:col-span-2">
              <div>
                <h3 className="text-sm font-semibold">Documents</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Every document is optional. Attach any files you have now or add them later. PDF, PNG, or JPEG · 12 MB maximum per file.
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {LAP_DOCUMENTS.map((document) => (
                  <OptionalDocumentPicker
                    key={document.type}
                    documentKey={document.key}
                    label={document.label}
                    description={document.description}
                    file={createFiles[document.key]}
                    disabled={createMutation.isPending}
                    onSelect={(file) => setCreateFiles((current) => ({ ...current, [document.key]: file }))}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={createMutation.isPending}
              onClick={() => {
                setCreating(false);
                resetCreateDialog();
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !createForm.borrowerName.trim()
                || !createForm.resultDate
                || createMutation.isPending
              }
            >
              {createMutation.isPending ? <RefreshCw className="animate-spin" /> : <UploadCloud />}
              {createMutation.isPending ? "Creating and uploading…" : "Create package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
