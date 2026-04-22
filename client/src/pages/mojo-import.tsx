import { useEffect, useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Upload, FileSpreadsheet, CheckCircle2, Loader2, X } from "lucide-react";
import { InfoBanner } from "@/components/info-banner";

function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuote = false; }
        else cur += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ',') { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map(v => v.trim());
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const parts = parseLine(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = parts[i] ?? ""; });
    return obj;
  });
  return { headers, rows };
}

function UploadSection({
  title,
  description,
  type,
}: { title: string; description: string; type: 'calls' | 'contacts' }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [result, setResult] = useState<{ imported: number; matched: number; unmatched: number } | null>(null);

  const importMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/mojo/import/csv", body),
    onSuccess: (data) => {
      setResult(data);
      toast({ title: "Import complete", description: `Imported ${data.imported}, matched ${data.matched} CLRs` });
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const parsed = parseCSV(text);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const clear = () => {
    setFileName(""); setHeaders([]); setRows([]); setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><FileSpreadsheet className="w-4 h-4" /> {title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!fileName ? (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded p-8 text-center cursor-pointer transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'}`}
          >
            <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <div className="text-sm font-medium">Drop CSV file here or click to browse</div>
            <div className="text-xs text-muted-foreground mt-1">
              {type === 'calls'
                ? 'Expected columns: Date, Agent, Contact, Phone, Disposition, Notes, Duration, Group'
                : 'Expected columns: First Name, Last Name, Phone, Email, Group, Status'}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4" />
                <span className="font-medium">{fileName}</span>
                <Badge variant="outline">{rows.length} rows</Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={clear}><X className="w-4 h-4" /></Button>
            </div>

            {rows.length > 0 && (
              <>
                <div className="text-xs font-semibold">Preview (first 5 rows)</div>
                <div className="rounded border overflow-x-auto max-h-60">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>{headers.map(h => <th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 5).map((r, i) => (
                        <tr key={i} className="border-t">
                          {headers.map(h => <td key={h} className="p-2 whitespace-nowrap">{r[h]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => importMut.mutate({ type, rows })}
                    disabled={importMut.isPending}
                  >
                    {importMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                    Import {rows.length} {type === 'calls' ? 'Call Logs' : 'Contacts'}
                  </Button>
                  <Button variant="outline" onClick={clear}>Cancel</Button>
                </div>
              </>
            )}

            {result && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-3 text-sm flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                <div>
                  <div className="font-medium text-green-900 dark:text-green-200">Import complete</div>
                  <div className="text-xs text-green-700 dark:text-green-300 mt-1">
                    Imported {result.imported} rows · Matched {result.matched} to CLRs · Unmatched {result.unmatched}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function MojoImportPage() {
  useEffect(() => { document.title = "Mojo Import · WCLCC"; }, []);

  return (
    <div className="p-4 md:p-6 space-y-4 w-full max-w-4xl mx-auto">
      <InfoBanner storageKey="mojo_import_info" variant="info" title="Mojo CSV Import">
        Export your call logs or contacts from Mojo Dialer (Reports → Export), then drag and drop the CSV file below. Data will be matched to CLRs by phone number and name.
      </InfoBanner>
      <div>
        <h1 className="text-2xl font-bold">Mojo CSV Import</h1>
        <p className="text-muted-foreground text-sm">Drag-and-drop export files from Mojo to backfill call logs and contacts.</p>
      </div>
      <UploadSection
        type="calls"
        title="Import Call Logs"
        description="Aggregates call activity into mojo_sessions (grouped by date + agent) and matches CLRs by name."
      />
      <UploadSection
        type="contacts"
        title="Import Contacts"
        description="Creates mojo_contacts and unified_contacts. Matches CLR by normalized phone."
      />
    </div>
  );
}
