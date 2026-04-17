import { useState, useRef, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────
interface LoanOfficerRow {
  fullName: string;
  nmlsId: string;
  phone?: string;
  email?: string;
  licensedStates?: string;
  bonzoUsername?: string;
  bonzoPassword?: string;
  leadMailboxUsername?: string;
  leadMailboxPassword?: string;
  notes?: string;
  specialRequests?: string;
  boostScore?: string;
  priorityTier?: string;
  internalStatus?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ── CSV header → field mapping (case-insensitive) ────────────────────────────
const HEADER_MAP: Record<string, keyof LoanOfficerRow> = {
  "full name": "fullName",
  "fullname": "fullName",
  "nmls id": "nmlsId",
  "nmlsid": "nmlsId",
  "nmls": "nmlsId",
  "phone": "phone",
  "email": "email",
  "licensed states": "licensedStates",
  "licensedstates": "licensedStates",
  "states": "licensedStates",
  "bonzo username": "bonzoUsername",
  "bonzousername": "bonzoUsername",
  "bonzo password": "bonzoPassword",
  "bonzopassword": "bonzoPassword",
  "lead mailbox username": "leadMailboxUsername",
  "leadmailboxusername": "leadMailboxUsername",
  "lead mailbox password": "leadMailboxPassword",
  "leadmailboxpassword": "leadMailboxPassword",
  "notes": "notes",
  "special requests": "specialRequests",
  "specialrequests": "specialRequests",
  "boost score": "boostScore",
  "boostscore": "boostScore",
  "priority tier": "priorityTier",
  "prioritytier": "priorityTier",
  "tier": "priorityTier",
  "status": "internalStatus",
  "internalstatus": "internalStatus",
  "internal status": "internalStatus",
};

// ── Template ─────────────────────────────────────────────────────────────────
const TEMPLATE_HEADERS = [
  "Full Name",
  "NMLS ID",
  "Phone",
  "Email",
  "Licensed States",
  "Bonzo Username",
  "Bonzo Password",
  "Lead Mailbox Username",
  "Lead Mailbox Password",
  "Notes",
  "Special Requests",
  "Boost Score",
  "Priority Tier",
  "Status",
];

const TEMPLATE_EXAMPLE = [
  "Jane Smith",
  "1234567",
  "555-867-5309",
  "jane@example.com",
  "CA, TX, FL",
  "jsmith_bonzo",
  "secret123",
  "jsmith@leadmailbox.com",
  "mailpass456",
  "Prefers morning callbacks",
  "Do not call Fridays",
  "5",
  "1",
  "active",
];

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS.join(","), TEMPLATE_EXAMPLE.map(v => `"${v}"`).join(",")];
  const blob = new Blob([rows.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lo_import_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── CSV parser — handles quoted fields ───────────────────────────────────────
function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  // Normalize line endings
  const input = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          // Escaped quote
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(field.trim());
        field = "";
      } else if (ch === "\n") {
        row.push(field.trim());
        field = "";
        if (row.some(c => c !== "")) lines.push(row);
        row = [];
        i++;
        continue;
      } else {
        field += ch;
      }
    }
    i++;
  }

  // Flush last field/row
  row.push(field.trim());
  if (row.some(c => c !== "")) lines.push(row);

  return lines;
}

function csvToRows(text: string): { rows: LoanOfficerRow[]; parseErrors: string[] } {
  const matrix = parseCSV(text);
  if (matrix.length < 2) return { rows: [], parseErrors: ["CSV must have a header row and at least one data row."] };

  const headers = matrix[0].map(h => h.toLowerCase().trim());
  const fieldIndices: Record<keyof LoanOfficerRow, number> = {} as any;

  headers.forEach((h, idx) => {
    const field = HEADER_MAP[h];
    if (field) fieldIndices[field] = idx;
  });

  if (fieldIndices.fullName === undefined || fieldIndices.nmlsId === undefined) {
    return {
      rows: [],
      parseErrors: ["CSV must include 'Full Name' and 'NMLS ID' columns."],
    };
  }

  const rows: LoanOfficerRow[] = [];
  const parseErrors: string[] = [];

  for (let r = 1; r < matrix.length; r++) {
    const cols = matrix[r];
    const get = (field: keyof LoanOfficerRow): string | undefined => {
      const idx = fieldIndices[field];
      if (idx === undefined) return undefined;
      return cols[idx] || undefined;
    };

    const fullName = get("fullName") ?? "";
    const nmlsId = get("nmlsId") ?? "";

    if (!fullName || !nmlsId) {
      parseErrors.push(`Row ${r + 1}: Missing Full Name or NMLS ID — skipped.`);
      continue;
    }

    // Convert licensedStates comma-separated string to JSON array format
    const statesRaw = get("licensedStates");
    const licensedStates = statesRaw
      ? JSON.stringify(statesRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))
      : undefined;

    rows.push({
      fullName,
      nmlsId,
      phone: get("phone"),
      email: get("email"),
      licensedStates,
      bonzoUsername: get("bonzoUsername"),
      bonzoPassword: get("bonzoPassword"),
      leadMailboxUsername: get("leadMailboxUsername"),
      leadMailboxPassword: get("leadMailboxPassword"),
      notes: get("notes"),
      specialRequests: get("specialRequests"),
      boostScore: get("boostScore"),
      priorityTier: get("priorityTier"),
      internalStatus: get("internalStatus"),
    });
  }

  return { rows, parseErrors };
}

// ── Main component ────────────────────────────────────────────────────────────
interface LoCsvImportProps {
  onImportComplete?: () => void;
}

type Step = "upload" | "preview" | "result";

export function LoCsvImport({ onImportComplete }: LoCsvImportProps) {
  const [step, setStep] = useState<Step>("upload");
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<LoanOfficerRow[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setParseErrors(["Please upload a .csv file."]);
      setStep("upload");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows: parsed, parseErrors: errs } = csvToRows(text);
      setRows(parsed);
      setParseErrors(errs);
      if (parsed.length > 0 || errs.length > 0) {
        setStep("preview");
      }
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = "";
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const res: ImportResult = await apiRequest("POST", "/api/loan-officers/import", { rows });
      setResult(res);
      setStep("result");
      if (res.imported > 0 && onImportComplete) onImportComplete();
    } catch (e: any) {
      setResult({ imported: 0, skipped: 0, errors: [e.message ?? "Import failed"] });
      setStep("result");
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setStep("upload");
    setRows([]);
    setParseErrors([]);
    setResult(null);
  };

  // ── Step 1: Upload ──────────────────────────────────────────────────────────
  if (step === "upload") {
    return (
      <div className="space-y-4">
        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
            ${dragging
              ? "border-teal-500 bg-teal-50 dark:bg-teal-950/20"
              : "border-muted-foreground/30 hover:border-teal-400 hover:bg-muted/40"
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
            data-testid="input-csv-file"
          />
          <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-semibold text-sm">Drag and drop a CSV file here</p>
          <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
          <p className="text-xs text-muted-foreground mt-3">Only .csv files accepted</p>
        </div>

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          </div>
        )}

        {/* Download template */}
        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-muted-foreground">
            Need help? Download the template to see the expected format.
          </p>
          <Button variant="outline" size="sm" onClick={downloadTemplate} type="button">
            <FileText className="w-3.5 h-3.5 mr-1.5" />
            Download Template
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 2: Preview ─────────────────────────────────────────────────────────
  if (step === "preview") {
    const preview = rows.slice(0, 5);

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-sm">{rows.length} loan officer{rows.length !== 1 ? "s" : ""} ready to import</p>
            {parseErrors.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">{parseErrors.length} row{parseErrors.length !== 1 ? "s" : ""} skipped due to errors</p>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={reset} type="button">
            ← Change file
          </Button>
        </div>

        {/* Parse errors */}
        {parseErrors.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-xs border border-amber-200 dark:border-amber-800">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              {parseErrors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          </div>
        )}

        {/* Preview table */}
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Name</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">NMLS</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Email</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">States</th>
                  <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Tier</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => {
                  const statesArr: string[] = (() => {
                    try { return row.licensedStates ? JSON.parse(row.licensedStates) : []; }
                    catch { return []; }
                  })();
                  return (
                    <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2 font-medium">{row.fullName}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{row.nmlsId}</td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px] hidden sm:table-cell">
                        {row.email ?? <span className="text-muted-foreground/40">—</span>}
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        {statesArr.length > 0
                          ? statesArr.slice(0, 4).join(", ") + (statesArr.length > 4 ? ` +${statesArr.length - 4}` : "")
                          : <span className="text-muted-foreground/40">—</span>
                        }
                      </td>
                      <td className="px-3 py-2">
                        {row.priorityTier ? (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {row.priorityTier === "1" ? "VIP" : row.priorityTier === "3" ? "Low" : "Std"}
                          </Badge>
                        ) : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {rows.length > 5 && (
          <p className="text-xs text-muted-foreground text-center">
            Showing first 5 of {rows.length} rows
          </p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={reset} type="button">Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={importing || rows.length === 0}
            data-testid="button-import-los"
            className="bg-teal-600 hover:bg-teal-700 text-white"
            type="button"
          >
            {importing ? "Importing…" : `Import ${rows.length} LO${rows.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      </div>
    );
  }

  // ── Step 3: Result ──────────────────────────────────────────────────────────
  if (step === "result" && result) {
    const hasErrors = result.errors.length > 0;

    return (
      <div className="space-y-4">
        {/* Success summary */}
        <div className={`flex items-start gap-3 p-4 rounded-xl ${hasErrors ? "bg-amber-50 dark:bg-amber-950/20" : "bg-teal-50 dark:bg-teal-950/20"}`}>
          <CheckCircle2 className={`w-5 h-5 mt-0.5 flex-shrink-0 ${hasErrors ? "text-amber-600" : "text-teal-600"}`} />
          <div>
            <p className="font-semibold text-sm">
              {result.imported} LO{result.imported !== 1 ? "s" : ""} imported
              {result.skipped > 0 && `, ${result.skipped} skipped (already exist)`}
            </p>
            {result.skipped > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Skipped LOs already exist in the system (matched by NMLS ID).
              </p>
            )}
          </div>
        </div>

        {/* Errors */}
        {hasErrors && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
              <AlertCircle className="w-3.5 h-3.5" />
              {result.errors.length} error{result.errors.length !== 1 ? "s" : ""}
            </div>
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-1 max-h-40 overflow-y-auto">
              {result.errors.map((e, i) => (
                <p key={i} className="text-xs text-destructive">{e}</p>
              ))}
            </div>
          </div>
        )}

        {/* Reset */}
        <div className="flex justify-end pt-1">
          <Button variant="outline" onClick={reset} type="button">
            Import More
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
