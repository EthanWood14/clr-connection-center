import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface Loa { id: number; loId: number; fullName: string; }

function useLoas(loId?: number | null) {
  return useQuery<Loa[]>({
    queryKey: ["/api/loan-officer-assistants", loId ?? "all"],
    queryFn: async () => {
      const url = loId ? `/api/loan-officer-assistants?loId=${loId}` : "/api/loan-officer-assistants";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: loId == null || loId > 0,
  });
}

// Inline manager rendered inside each LO's directory card: list + add + remove LOAs.
export function LoaManager({ loId }: { loId: number }) {
  const { data: loas = [] } = useLoas(loId);
  const [name, setName] = useState("");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/loan-officer-assistants"] });
  const add = useMutation({
    mutationFn: () => apiRequest("POST", "/api/loan-officer-assistants", { loId, fullName: name.trim() }),
    onSuccess: () => { setName(""); invalidate(); },
  });
  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/loan-officer-assistants/${id}`),
    onSuccess: () => invalidate(),
  });
  return (
    <div className="w-full mt-1" data-testid={`loa-manager-${loId}`} onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-muted-foreground">Assistants (LOAs):</span>
        {loas.length === 0 && <span className="text-xs text-muted-foreground/60">none</span>}
        {loas.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5">
            {a.fullName}
            <button type="button" className="text-muted-foreground hover:text-red-500" onClick={() => del.mutate(a.id)} aria-label={`Remove ${a.fullName}`}>&times;</button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-1">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { e.preventDefault(); add.mutate(); } }}
          placeholder="Add LOA name"
          className="h-7 text-xs border rounded px-2 bg-background flex-1 min-w-0"
          data-testid={`loa-input-${loId}`}
        />
        <button type="button" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()} className="h-7 text-xs px-2 rounded bg-primary text-primary-foreground disabled:opacity-50">Add</button>
      </div>
    </div>
  );
}

// Optional picker shown under the LO select when logging an outcome.
// Selecting an LOA records the work to the parent LO (stats) while tagging the LOA.
export function LoaPicker({ loId, value, onChange }: { loId?: number | null; value: number | null; onChange: (v: number | null) => void }) {
  const { data: loas = [] } = useLoas(loId);
  if (!loId || loId <= 0) return null;
  return (
    <select
      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      data-testid="select-loa"
    >
      <option value="">&mdash; LO directly (no assistant) &mdash;</option>
      {loas.map((a) => (
        <option key={a.id} value={String(a.id)}>{a.fullName}</option>
      ))}
    </select>
  );
}
