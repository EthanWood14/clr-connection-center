import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Sun, Sunset, Clock } from "lucide-react";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type TimeSlot = "off" | "morning" | "afternoon" | "all";

interface DayState {
  slot: TimeSlot;
}

const SLOT_OPTIONS: { value: TimeSlot; label: string; icon: React.ReactNode; color: string }[] = [
  { value: "off",       label: "Off",       icon: null,                                            color: "bg-muted text-muted-foreground border-border" },
  { value: "morning",   label: "AM",        icon: <Sun className="w-3 h-3" />,                    color: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700" },
  { value: "afternoon", label: "PM",        icon: <Sunset className="w-3 h-3" />,                 color: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700" },
  { value: "all",       label: "Full",      icon: <Clock className="w-3 h-3" />,                  color: "bg-primary text-primary-foreground border-primary" },
];

function slotFromApi(isAvailable: boolean, timeSlot: string): TimeSlot {
  if (!isAvailable) return "off";
  if (timeSlot === "morning") return "morning";
  if (timeSlot === "afternoon") return "afternoon";
  return "all";
}

function slotToApi(slot: TimeSlot): { isAvailable: boolean; timeSlot: string } {
  if (slot === "off") return { isAvailable: false, timeSlot: "all" };
  return { isAvailable: true, timeSlot: slot };
}

interface Props {
  loId: number;
  loName: string;
}

export function LoAvailabilityEditor({ loId, loName }: Props) {
  const { toast } = useToast();
  // Default: Mon–Fri full day
  const [days, setDays] = useState<DayState[]>([
    { slot: "off" }, { slot: "all" }, { slot: "all" }, { slot: "all" }, { slot: "all" }, { slot: "all" }, { slot: "off" },
  ]);

  const { data: availability, isLoading } = useQuery<any[]>({
    queryKey: [`/api/loan-officers/${loId}/availability`],
    enabled: !!loId,
  });

  useEffect(() => {
    if (availability && availability.length > 0) {
      const next: DayState[] = [
        { slot: "off" }, { slot: "off" }, { slot: "off" }, { slot: "off" },
        { slot: "off" }, { slot: "off" }, { slot: "off" },
      ];
      availability.forEach((a: any) => {
        next[a.dayOfWeek] = { slot: slotFromApi(a.isAvailable, a.timeSlot ?? "all") };
      });
      setDays(next);
    }
  }, [availability]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = days.map((d, dayOfWeek) => ({
        dayOfWeek,
        ...slotToApi(d.slot),
      }));
      return apiRequest("PUT", `/api/loan-officers/${loId}/availability`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/loan-officers/${loId}/availability`] });
      toast({ title: "Availability saved", description: `${loName}'s schedule updated.` });
    },
  });

  // Cycle through slots on click: off → morning → afternoon → all → off
  const cycleSlot = (i: number) => {
    setDays(prev => {
      const n = [...prev];
      const order: TimeSlot[] = ["off", "morning", "afternoon", "all"];
      const cur = order.indexOf(n[i].slot);
      n[i] = { slot: order[(cur + 1) % order.length] };
      return n;
    });
  };

  const setAll = (slot: TimeSlot) => setDays(DAYS.map(() => ({ slot })));
  const setWeekdays = (slot: TimeSlot) =>
    setDays(prev => prev.map((d, i) => (i >= 1 && i <= 5 ? { slot } : { slot: "off" })));

  if (isLoading) return <Skeleton className="h-20 w-full" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Click a day to cycle: <span className="font-medium">Off → AM → PM → Full Day</span>
      </p>

      {/* Day buttons */}
      <div className="flex gap-2 flex-wrap">
        {DAYS.map((day, i) => {
          const opt = SLOT_OPTIONS.find(o => o.value === days[i].slot)!;
          return (
            <button
              key={i}
              type="button"
              title={`${DAY_FULL[i]} — click to cycle`}
              onClick={() => cycleSlot(i)}
              className={`
                flex flex-col items-center justify-center w-12 h-14 rounded-lg text-xs font-semibold
                transition-all border-2 gap-0.5 select-none
                ${opt.color}
              `}
            >
              <span className="text-[11px] font-bold">{day}</span>
              <div className="flex items-center gap-0.5 text-[10px]">
                {opt.icon}
                <span>{opt.label}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Quick-set presets */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="text-muted-foreground self-center mr-1">Quick set:</span>
        <button type="button" onClick={() => setWeekdays("all")}
          className="px-2 py-0.5 rounded border text-xs hover:bg-muted transition-colors">M–F Full</button>
        <button type="button" onClick={() => setWeekdays("morning")}
          className="px-2 py-0.5 rounded border text-xs hover:bg-muted transition-colors">M–F AM</button>
        <button type="button" onClick={() => setWeekdays("afternoon")}
          className="px-2 py-0.5 rounded border text-xs hover:bg-muted transition-colors">M–F PM</button>
        <button type="button" onClick={() => setAll("off")}
          className="px-2 py-0.5 rounded border text-xs hover:bg-muted transition-colors">Clear all</button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {SLOT_OPTIONS.map(o => (
          <span key={o.value} className="flex items-center gap-1">
            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border font-medium ${o.color}`}>
              {o.icon}<span>{o.label}</span>
            </span>
            {o.value === "off" && "— not available"}
            {o.value === "morning" && "— mornings only"}
            {o.value === "afternoon" && "— afternoons only"}
            {o.value === "all" && "— full day"}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save Availability"}
        </Button>
      </div>
    </div>
  );
}
