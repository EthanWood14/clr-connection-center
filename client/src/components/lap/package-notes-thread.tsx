// The LOA lead-note thread for one result package: the notes so far, the LOA
// composer (admins and LOAs only — a plain LO gets just the reply box, so they
// are never pushed to post as one of their own assistants), and (LO side
// only) the remarks reply. Rendered on the package
// view and on the Lead Notes page. Mount it with key={result.id} — the draft
// state has no reset effect, so without the key a note drafted for one
// borrower would follow the user to the next one.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatLapDate, lapRequest, type LapResult } from "@/lib/lap-api";
import { isUntouchedLoaNote, LOA_NOTE_TEMPLATE } from "@shared/lap-note-template";

export type PackageNote = { id: number; kind: "loa" | "lo"; authorName: string; body: string; createdAt: string };

export function PackageNotesThread({ result, isLoSide, isAdmin = false }: { result: LapResult; isLoSide: boolean; isAdmin?: boolean }) {
  const { toast } = useToast();
  const [loaId, setLoaId] = useState("");
  const [noteBody, setNoteBody] = useState(LOA_NOTE_TEMPLATE);
  const [remarks, setRemarks] = useState("");
  const [loNotes, setLoNotes] = useState("");
  const [opportunities, setOpportunities] = useState("");

  const notesQuery = useQuery({
    queryKey: ["/api/lap/results", "notes", result.id],
    queryFn: () => lapRequest<{ notes: PackageNote[] }>("GET", `/api/lap/results/${result.id}/notes`),
  });
  // An LO who is not an admin only replies; the composer is for LOAs and admins.
  const canPostLoaNote = isAdmin || !isLoSide;
  const loasQuery = useQuery({
    queryKey: ["/api/lap/loas"],
    queryFn: () => lapRequest<{ loas: { id: number; name: string; active: number }[] }>("GET", "/api/lap/loas"),
    enabled: canPostLoaNote,
  });
  // Who gets the note besides the loan officer — the Settings value, not a
  // hardcoded name. Comes back as "" when nothing is set.
  const recipientQuery = useQuery({
    queryKey: ["/api/lap/notes-recipient"],
    queryFn: () => lapRequest<{ recipient: string }>("GET", "/api/lap/notes-recipient"),
    enabled: canPostLoaNote,
  });
  const notes = notesQuery.data?.notes ?? [];
  const loaOptions = loasQuery.data?.loas ?? [];
  const notesRecipient = (recipientQuery.data?.recipient ?? "").trim();
  // Every LOA note goes out by email, so the bare template must never be posted.
  const untouched = isUntouchedLoaNote(noteBody);

  const postNote = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      lapRequest("POST", `/api/lap/results/${result.id}/notes`, payload),
    onSuccess: async () => {
      toast({ title: "Note posted" });
      setNoteBody(LOA_NOTE_TEMPLATE);
      setRemarks(""); setLoNotes(""); setOpportunities("");
      await queryClient.invalidateQueries({ queryKey: ["/api/lap/results", "notes", result.id] });
    },
    onError: (error: any) => toast({ title: "Could not post the note", description: error.message, variant: "destructive" }),
  });

  return (
    <div data-testid="lap-package-notes">
      <div className="mb-3">
        <h3 className="font-semibold">Lead notes & LO remarks</h3>
        <p className="text-xs text-muted-foreground">
          LOA notes and {result.loanOfficerName || "the loan officer"}'s replies stay with this package.
        </p>
      </div>
      <div className="space-y-2">
        {notes.map((note) => (
          <div
            key={note.id}
            className={note.kind === "lo"
              ? "rounded-lg border border-amber-300 bg-amber-50/70 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/20"
              : "rounded-lg border bg-muted/20 px-4 py-3"}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {note.kind === "lo" ? `${note.authorName} — LO remarks` : `LOA note — ${note.authorName}`}
              <span className="ml-2 normal-case tracking-normal">{formatLapDate(note.createdAt)}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{note.body}</p>
          </div>
        ))}
        {notesQuery.isLoading && (
          <p className="text-sm text-muted-foreground">Loading notes…</p>
        )}
        {notesQuery.isError && (
          <p className="text-sm text-destructive">Could not load the notes for this package.</p>
        )}
        {!notes.length && !notesQuery.isLoading && !notesQuery.isError && (
          <p className="text-sm text-muted-foreground">No notes yet — the thread starts below.</p>
        )}
      </div>

      {canPostLoaNote && (
        <div className="mt-3 space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label className="text-xs font-semibold">Add LOA note as</Label>
            <Select value={loaId} onValueChange={setLoaId}>
              <SelectTrigger className="h-8 w-52" data-testid="lap-note-loa"><SelectValue placeholder="Pick your name" /></SelectTrigger>
              <SelectContent>
                {loaOptions.map((loa) => (
                  <SelectItem key={loa.id} value={String(loa.id)}>{loa.name}{loa.active ? "" : " (inactive)"}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {loasQuery.isLoading && <span className="text-xs text-muted-foreground">Loading names…</span>}
            {loasQuery.isError && <span className="text-xs text-destructive">Could not load the LOA list.</span>}
          </div>
          <Textarea rows={8} value={noteBody} onChange={(event) => setNoteBody(event.target.value)} className="font-mono text-xs" data-testid="lap-note-body" />
          {loaId && untouched && (
            <p className="text-xs text-muted-foreground" data-testid="lap-note-untouched">Fill in at least one line.</p>
          )}
          <Button
            size="sm"
            disabled={postNote.isPending || !loaId || !noteBody.trim() || untouched}
            onClick={() => postNote.mutate({ kind: "loa", loaId: Number(loaId), body: noteBody })}
          >
            Post note &amp; email
          </Button>
          {recipientQuery.data && (
            <p className="text-xs text-muted-foreground" data-testid="lap-note-recipients">
              Goes to {result.loanOfficerName || "the loan officer"}{notesRecipient ? ` and ${notesRecipient}` : ""}.
            </p>
          )}
        </div>
      )}

      {isLoSide && (
        <div className="mt-3 space-y-2 rounded-lg border border-amber-300 p-3 dark:border-amber-700" data-testid="lap-lo-remarks">
          <p className="text-xs font-semibold">LO reply — any section is optional</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1"><Label className="text-xs">Remarks</Label><Textarea rows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Notes</Label><Textarea rows={3} value={loNotes} onChange={(event) => setLoNotes(event.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs">Opportunities</Label><Textarea rows={3} value={opportunities} onChange={(event) => setOpportunities(event.target.value)} /></div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-400"
            disabled={postNote.isPending || !(remarks.trim() || loNotes.trim() || opportunities.trim())}
            onClick={() => postNote.mutate({ kind: "lo", remarks, notes: loNotes, opportunities })}
          >
            Post reply
          </Button>
        </div>
      )}
    </div>
  );
}
