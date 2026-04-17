import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Check } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface Props {
  loId: number;
  loName: string;
}

export function LoAvailabilityEditor({ loId, loName }: Props) {
  const { toast } = useToast();
  const [selected, setSelected] = useState<boolean[]>([false, true, true, true, true, true, false]);

  const { data: availability, isLoading } = useQuery<any[]>({
    queryKey: [`/api/loan-officers/${loId}/availability`],
    enabled: !!loId,
  });

  // Hydrate from server data
  useEffect(() => {
    if (availability && availability.length > 0) {
      const next = [false, false, false, false, false, false, false];
      availability.forEach((a: any) => {
        next[a.dayOfWeek] = !!a.isAvailable;
      });
      setSelected(next);
    }
  }, [availability]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/loan-officers/${loId}/availability`,
        selected.map((isAvailable, dayOfWeek) => ({ dayOfWeek, isAvailable }))
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/loan-officers/${loId}/availability`] });
      toast({ title: "Availability saved", description: `${loName}'s schedule updated.` });
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Select the days this LO is available for contact.
      </p>
      <div className="flex gap-1.5 flex-wrap">
        {DAYS.map((day, i) => (
          <button
            key={i}
            type="button"
            title={DAY_FULL[i]}
            onClick={() => setSelected((prev) => { const n = [...prev]; n[i] = !n[i]; return n; })}
            className={`
              relative w-10 h-10 rounded-full text-xs font-semibold transition-all border
              ${selected[i]
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : "bg-muted text-muted-foreground border-border hover:border-primary/40"}
            `}
          >
            {day}
            {selected[i] && (
              <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                <Check className="w-2 h-2 text-white" />
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? "Saving..." : "Save Availability"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={() => setSelected([false, true, true, true, true, true, false])}
        >
          Reset to M–F
        </Button>
      </div>
    </div>
  );
}
