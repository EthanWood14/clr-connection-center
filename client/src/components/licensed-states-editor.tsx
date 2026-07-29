import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, MapPin, Search } from "lucide-react";
import { US_STATE_OPTIONS, normalizeLicensedStates } from "@shared/licensed-states";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type LicensedStatesEditorProps = {
  loId: number;
  loName: string;
  states: string[];
  endpoint: string;
  queryKeys: string[];
  compact?: boolean;
};

export function LicensedStatesEditor({
  loId,
  loName,
  states,
  endpoint,
  queryKeys,
  compact = false,
}: LicensedStatesEditorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const sourceStateKey = states.join("|");

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeLicensedStates(states);
    setSelected(normalized.success ? normalized.states : []);
    setSearch("");
  }, [open, sourceStateKey]);

  const filteredStates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return US_STATE_OPTIONS;
    return US_STATE_OPTIONS.filter(([code, name]) =>
      code.toLowerCase().includes(needle) || name.toLowerCase().includes(needle),
    );
  }, [search]);

  const saveMutation = useMutation({
    mutationFn: () => apiRequest("PATCH", endpoint, { states: selected }),
    onSuccess: async () => {
      await Promise.all(queryKeys.map((queryKey) =>
        queryClient.invalidateQueries({ queryKey: [queryKey] }),
      ));
      setOpen(false);
      toast({
        title: "State permissions updated",
        description: `${loName} now has ${selected.length} licensed state${selected.length === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn’t update state permissions",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggle = (code: string) => {
    setSelected((current) =>
      current.includes(code)
        ? current.filter((state) => state !== code)
        : US_STATE_OPTIONS.map(([state]) => state).filter((state) =>
            state === code || current.includes(state),
          ),
    );
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={compact ? "h-7 gap-1.5 px-2 text-xs" : "gap-2"}
        onClick={() => setOpen(true)}
        data-testid={`button-edit-state-permissions-${loId}`}
      >
        <MapPin className="h-3.5 w-3.5" />
        {compact ? "Edit states" : "Edit state permissions"}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !saveMutation.isPending && setOpen(next)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>State permissions · {loName}</DialogTitle>
            <DialogDescription>
              Choose every state where this Loan Officer is licensed. Any signed-in user can keep this list current.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/25 p-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selected.length} selected</Badge>
                <span className="text-xs text-muted-foreground">Includes Washington, D.C.</span>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelected(US_STATE_OPTIONS.map(([code]) => code))}
                >
                  Select all
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>
                  Clear
                </Button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search states…"
                className="pl-9"
                aria-label="Search state permissions"
              />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {filteredStates.map(([code, name]) => {
                const checked = selected.includes(code);
                return (
                  <label
                    key={code}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors ${
                      checked ? "border-primary/45 bg-primary/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(code)}
                      aria-label={`${name} (${code})`}
                    />
                    <span className="flex-1 text-sm">{name}</span>
                    <span className="font-mono text-xs font-semibold text-muted-foreground">{code}</span>
                    {checked && <Check className="h-3.5 w-3.5 text-primary" />}
                  </label>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid={`button-save-state-permissions-${loId}`}
            >
              {saveMutation.isPending ? "Saving…" : "Save state permissions"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
