import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  PhoneCall, TrendingUp, Calendar, ClipboardList, Plus, Trash2,
  CheckCircle2, Clock, ChevronLeft, ChevronRight, FileText, Send,
} from "lucide-react";
import { format, subDays, addDays, parseISO } from "date-fns";

const ACTIVITY_TYPES = [
  { value: "follow_up", label: "Follow-Up Call" },
  { value: "email_sent", label: "Email Sent" },
  { value: "transfer_assisted", label: "Transfer Assisted" },
  { value: "appointment_set", label: "Appointment Set" },
  { value: "lo_contact", label: "LO Contact" },
  { value: "training", label: "Training / Meeting" },
  { value: "admin", label: "Admin Work" },
  { value: "other", label: "Other" },
];

const ACTIVITY_COLORS: Record<string, string> = {
  follow_up: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  email_sent: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  transfer_assisted: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  appointment_set: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300",
  lo_contact: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  training: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  admin: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  other: "bg-muted text-muted-foreground",
};

export default function EodReport() {
  const { user } = useAuth();
  const { toast } = useToast();
  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Report form state
  const [callsMade, setCallsMade] = useState("");
  const [transfers, setTransfers] = useState("");
  const [appointments, setAppointments] = useState("");
  const [notes, setNotes] = useState("");
  const [dirty, setDirty] = useState(false);

  // Activity form state
  const [activityType, setActivityType] = useState("follow_up");
  const [activityDesc, setActivityDesc] = useState("");

  const { data, isLoading, refetch } = useQuery<{ report: any; activities: any[] }>({
    queryKey: ["/api/eod-reports", selectedDate],
    queryFn: () => fetch(`/api/eod-reports?date=${selectedDate}`).then(r => r.json()),
  });

  const report = data?.report ?? null;
  const activities = data?.activities ?? [];

  // Sync form when report loads for selected date
  const reportKey = `${selectedDate}-${report?.id}`;
  useMemo(() => {
    if (report) {
      setCallsMade(String(report.calls_made ?? report.callsMade ?? ""));
      setTransfers(String(report.transfers ?? ""));
      setAppointments(String(report.appointments ?? ""));
      setNotes(report.notes ?? "");
    } else {
      setCallsMade("");
      setTransfers("");
      setAppointments("");
      setNotes("");
    }
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/eod-reports", {
        reportDate: selectedDate,
        callsMade: parseInt(callsMade) || 0,
        transfers: parseInt(transfers) || 0,
        appointments: parseInt(appointments) || 0,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/eod-reports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/call-logs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      refetch();
      setDirty(false);
      toast({ title: "EOD report saved", description: `Report for ${format(parseISO(selectedDate), "MMM d")} saved.` });
    },
    onError: () => toast({ title: "Failed to save", variant: "destructive" }),
  });

  const addActivityMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/eod-reports/activities", {
        reportDate: selectedDate,
        activityType,
        description: activityDesc.trim(),
      }),
    onSuccess: () => {
      refetch();
      setActivityDesc("");
      toast({ title: "Activity added" });
    },
    onError: () => toast({ title: "Failed to add activity", variant: "destructive" }),
  });

  const deleteActivityMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/eod-reports/activities/${id}`),
    onSuccess: () => { refetch(); toast({ title: "Activity removed" }); },
  });

  function navigateDate(dir: -1 | 1) {
    const d = parseISO(selectedDate);
    setSelectedDate(dir === -1 ? subDays(d, 1).toISOString().split("T")[0] : addDays(d, 1).toISOString().split("T")[0]);
  }

  const isToday = selectedDate === todayStr;
  const isFuture = selectedDate > todayStr;
  const displayDate = format(parseISO(selectedDate), "EEEE, MMMM d, yyyy");

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" /> EOD Report
          </h1>
          <p className="text-sm text-muted-foreground">
            {isToday ? "Complete before you log off for the day" : "Viewing a past report"}
          </p>
        </div>
        {/* Date navigator */}
        <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => navigateDate(-1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium px-2 min-w-[180px] text-center">{displayDate}</span>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => navigateDate(1)} disabled={isToday}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          {!isToday && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedDate(todayStr)}>
              Today
            </Button>
          )}
        </div>
      </div>

      {isFuture ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <Clock className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>No report for future dates.</p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <>
          {/* Summary card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ClipboardList className="w-4 h-4" /> Daily Summary
                </CardTitle>
                {report && !dirty && (
                  <Badge className="text-xs bg-green-600 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Submitted
                  </Badge>
                )}
                {dirty && (
                  <Badge variant="outline" className="text-xs text-orange-500 border-orange-300">Unsaved changes</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <PhoneCall className="w-3.5 h-3.5" /> Total Calls Made
                  </label>
                  <Input
                    type="number" min={0} placeholder="0"
                    value={callsMade}
                    onChange={e => { setCallsMade(e.target.value); setDirty(true); }}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Transfers
                  </label>
                  <Input
                    type="number" min={0} placeholder="0"
                    value={transfers}
                    onChange={e => { setTransfers(e.target.value); setDirty(true); }}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" /> Appointments Set
                  </label>
                  <Input
                    type="number" min={0} placeholder="0"
                    value={appointments}
                    onChange={e => { setAppointments(e.target.value); setDirty(true); }}
                    className="h-9"
                  />
                </div>
              </div>

              {/* Transfer/Call ratio preview */}
              {callsMade && parseInt(callsMade) > 0 && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                  <TrendingUp className="w-3.5 h-3.5 text-primary" />
                  <span>
                    Transfer/Call ratio:{" "}
                    <strong className="text-foreground">
                      {((parseInt(transfers || "0") / parseInt(callsMade)) * 100).toFixed(1)}%
                    </strong>
                    {" "}({transfers || 0} transfers / {callsMade} calls)
                  </span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Notes / Comments</label>
                <Textarea
                  placeholder="Anything notable about today? Challenges, wins, feedback from LOs..."
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setDirty(true); }}
                  className="min-h-[80px] resize-none text-sm"
                />
              </div>

              <Button
                className="w-full gap-2"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || (!dirty && !!report)}
              >
                {saveMutation.isPending ? (
                  <><Clock className="w-4 h-4 animate-spin" /> Saving…</>
                ) : report && !dirty ? (
                  <><CheckCircle2 className="w-4 h-4" /> Already submitted</>
                ) : (
                  <><Send className="w-4 h-4" /> {report ? "Update Report" : "Submit Report"}</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Plus className="w-4 h-4" /> Activity Log
                <span className="text-xs font-normal text-muted-foreground ml-1">— any other notable work today</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add activity form */}
              <div className="flex gap-2 flex-wrap">
                <Select value={activityType} onValueChange={setActivityType}>
                  <SelectTrigger className="w-48 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ACTIVITY_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Brief description..."
                  value={activityDesc}
                  onChange={e => setActivityDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && activityDesc.trim()) addActivityMutation.mutate(); }}
                  className="flex-1 min-w-[160px] h-9 text-sm"
                />
                <Button
                  size="sm" className="h-9 gap-1.5"
                  onClick={() => addActivityMutation.mutate()}
                  disabled={!activityDesc.trim() || addActivityMutation.isPending}
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </Button>
              </div>

              {/* Activity list */}
              {activities.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No activities logged yet — add anything notable above.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {activities.map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Badge className={`text-xs shrink-0 ${ACTIVITY_COLORS[a.activity_type] ?? ACTIVITY_COLORS.other}`}>
                          {ACTIVITY_TYPES.find(t => t.value === a.activity_type)?.label ?? a.activity_type}
                        </Badge>
                        <span className="text-sm truncate">{a.description}</span>
                      </div>
                      <Button
                        size="sm" variant="ghost"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => deleteActivityMutation.mutate(a.id)}
                        disabled={deleteActivityMutation.isPending}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Info callout */}
          <p className="text-xs text-muted-foreground text-center pb-2">
            Your EOD report feeds the daily, weekly, and monthly performance analytics visible in Team Stats.
          </p>
        </>
      )}
    </div>
  );
}
