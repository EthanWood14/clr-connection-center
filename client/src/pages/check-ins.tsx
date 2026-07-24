import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import {
  UserCheck, ChevronLeft, ChevronRight, MapPin, CheckCircle2, XCircle, MinusCircle,
  Clock, AlertTriangle, CalendarOff, Copy, ExternalLink, RotateCcw, MessageSquareText,
  Send, ShieldCheck,
} from "lucide-react";
// Check-ins use the PLAIN local calendar date — deliberately NOT the shared
// business-day helper, which rolls forward at 7pm and would point the roster at
// tomorrow all evening.
const todayLocal = () => new Date().toLocaleDateString("en-CA");

type Mine = {
  id: number;
  checked_in_at: string;
  on_time: number | null;
  in_area: number | null;
  distance_m: number | null;
  minutes_late: number | null;
  expected_start: string | null;
  late_excused?: number | null;
  excuse_reason?: string | null;
  request?: ExcuseRequestSummary | null;
} | null;

type RequestStatus = "pending" | "approved" | "denied" | "cancelled";
type ExcuseRequestSummary = {
  id: number;
  status: RequestStatus;
  reason?: string | null;
  requestedAt?: string | null;
  reviewerNote?: string | null;
};
type LateRow = {
  id: number; date: string; checkedInAt: string; minutesLate: number | null; expectedStart: string | null;
  excused?: boolean; excusedBy?: string | null; excuseReason?: string | null;
  request?: ExcuseRequestSummary | null;
};
type LateStats = {
  allowance: number; windowDays: number; windowStart: string;
  count: number; remaining: number; overLimit: boolean; lates: LateRow[];
};
type MineResp = {
  enabled: boolean;
  start: string | null;
  startSource: "schedule" | "none";
  working: boolean;
  graceMin: number;
  officeSet: boolean;
  radiusM: number;
  date: string;
  mine: Mine;
  lateStats: LateStats;
};

type CheckinRow = {
  userId: number;
  name: string;
  checkin: Mine;
  expectedStart: string | null;
  scheduledOff: boolean;
  noSchedule?: boolean;
  lateCount: number;
  lateOverLimit: boolean;
  lateAtLimit: boolean;
  absenceExcused?: boolean;
  absenceExcuseId?: number | null;
  absenceExcuseSource?: "admin" | "time_off" | null;
  startPassed?: boolean;
  absenceEligible?: boolean;
};
type ExtRow = {
  type: "lo" | "loa"; id: number; name: string; loName: string | null;
  checkin: {
    id?: number;
    checked_in_at: string;
    on_time: number | null;
    minutes_late: number | null;
    expected_start: string | null;
    in_area: number | null;
    distance_m: number | null;
    late_excused?: number | null;
  } | null;
  expectedStart: string | null; scheduledOff: boolean; noSchedule: boolean;
  lateCount: number; lateOverLimit: boolean; lateAtLimit: boolean;
  absenceExcused?: boolean;
  absenceExcuseId?: number | null;
  absenceExcuseSource?: "admin" | "time_off" | null;
  startPassed?: boolean;
  absenceEligible?: boolean;
};
type AdminResp = {
  los?: ExtRow[]; loas?: ExtRow[];
  date: string;
  timeZone?: string;
  config: { enabled: boolean; start: string; graceMin: number; radiusM: number; lat: number | null; lng: number | null };
  clrs: CheckinRow[];
  policy: { allowance: number; windowDays: number; windowStart: string };
};

type AttendanceRequest = {
  id: number;
  subjectType: "user" | "lo" | "loa";
  subjectId: number;
  subjectName: string;
  attendanceDate: string;
  kind: "late" | "absence";
  checkinId: number | null;
  expectedStart: string | null;
  reason: string;
  status: RequestStatus;
  requestedVia: "app" | "portal" | "admin";
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
};

function shiftDate(d: string, days: number): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function fmtDist(m: number | null) {
  if (m == null) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtDay(d: string) {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtTime(iso: string, timeZone?: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  } catch {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}
// "08:00" → "8:00 AM"
function fmtHm(hm: string | null) {
  if (!hm) return "—";
  const [h, m] = hm.split(":").map((x) => parseInt(x, 10));
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

function requestStatusLabel(status: RequestStatus) {
  if (status === "approved") return "Approved";
  if (status === "denied") return "Not approved";
  if (status === "cancelled") return "Cancelled";
  return "Pending review";
}

function requestStatusClass(status: RequestStatus) {
  if (status === "approved") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (status === "denied") {
    return "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300";
  }
  return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300";
}

function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <Badge variant="outline" className={`shrink-0 font-normal ${requestStatusClass(status)}`}>
      {requestStatusLabel(status)}
    </Badge>
  );
}

function ManualLateExcuseAction({
  userId,
  currentlyExcused,
  pending,
  onExcuse,
  onUndo,
}: {
  userId: number;
  currentlyExcused: boolean;
  pending: boolean;
  onExcuse: (reason: string) => Promise<unknown>;
  onUndo: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (currentlyExcused) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-[11px]"
        disabled={pending}
        onClick={() => void onUndo()}
        data-testid={`excuse-${userId}`}
      >
        Undo
      </Button>
    );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReason("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={pending}
          data-testid={`excuse-${userId}`}
        >
          Excuse
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excuse this late?</AlertDialogTitle>
          <AlertDialogDescription>
            The arrival time stays on the record, but this late will no longer count toward the rolling allowance.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="space-y-1.5 text-sm font-medium">
          Manager note <span className="font-normal text-muted-foreground">(optional)</span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Add context for the attendance record"
            className="mt-1.5 min-h-24 resize-y"
            data-testid={`excuse-reason-${userId}`}
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={pending}
            onClick={async () => {
              try {
                await onExcuse(reason.trim());
                setOpen(false);
              } catch {}
            }}
          >
            {pending ? "Saving…" : "Excuse late"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AbsenceExcuseAction({
  subjectType,
  subjectId,
  date,
  excused,
  excuseId,
  excuseSource,
  pending,
  onCreate,
  onDelete,
}: {
  subjectType: "user" | "lo" | "loa";
  subjectId: number;
  date: string;
  excused: boolean;
  excuseId: number | null;
  excuseSource: "admin" | "time_off" | null;
  pending: boolean;
  onCreate: (reason: string) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const testId = `${subjectType}-${subjectId}-${date}`;

  if (excused) {
    if (excuseSource !== "admin" || !excuseId) return null;
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            disabled={pending}
            data-testid={`undo-absence-excuse-${testId}`}
          >
            Undo
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this absence excuse?</AlertDialogTitle>
            <AlertDialogDescription>
              The person will appear as missing again for {fmtDay(date)}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep excuse</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={pending}
              onClick={() => void onDelete()}
            >
              Remove excuse
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReason("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          disabled={pending}
          data-testid={`excuse-absence-${testId}`}
        >
          Excuse absence
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excuse this absence?</AlertDialogTitle>
          <AlertDialogDescription>
            Mark {fmtDay(date)} as excused without creating a check-in.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="space-y-1.5 text-sm font-medium">
          Reason
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Why is this absence excused?"
            className="mt-1.5 min-h-24 resize-y"
            data-testid={`absence-excuse-reason-${testId}`}
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={!reason.trim() || pending}
            onClick={async () => {
              try {
                await onCreate(reason.trim());
                setOpen(false);
              } catch {}
            }}
            data-testid={`save-absence-excuse-${testId}`}
          >
            {pending ? "Saving…" : "Excuse absence"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RollingLateCount({
  count,
  allowance,
  windowDays,
  overLimit,
  atLimit,
}: {
  count: number;
  allowance: number;
  windowDays: number;
  overLimit: boolean;
  atLimit: boolean;
}) {
  const tone = overLimit
    ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
    : atLimit
    ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    : count > 0
    ? "border-amber-200 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300"
    : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300";

  return (
    <div
      className={`min-w-[82px] shrink-0 rounded-lg border px-2.5 py-1.5 text-center ${tone}`}
      aria-label={`${count} of ${allowance} lates in the last ${windowDays} days`}
    >
      <p className="leading-none tabular-nums">
        <span className="text-xl font-bold">{count}</span>
        <span className="text-xs font-semibold opacity-70"> / {allowance}</span>
      </p>
      <p className="mt-1 text-[9px] font-semibold uppercase tracking-wider opacity-80">
        lates · {windowDays}d
      </p>
    </div>
  );
}

export default function CheckIns() {
  const { toast } = useToast();
  const { user } = useAuth();
  const isManager = user?.role === "admin" || (user as any)?.isManager || !!user?.superAdmin;
  const isAdmin = user?.role === "admin" || !!user?.superAdmin;

  const { data: me, isLoading: meLoading } = useQuery<MineResp>({ queryKey: ["/api/checkin"] });
  const [locating, setLocating] = useState(false);
  const [lateRequestReason, setLateRequestReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});

  const checkinMut = useMutation({
    mutationFn: (body: any) => apiRequest("POST", "/api/checkin", body),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      const ci = r?.checkin;
      toast({
        title: ci?.on_time === 1
          ? "Checked in — on time"
          : ci?.on_time === 0
          ? "Checked in — late"
          : "Check-in recorded",
        description: ci?.on_time === 1
          ? "Have a great day!"
          : ci?.on_time === 0
          ? `${ci?.minutes_late ?? 0} min past your ${fmtHm(ci?.expected_start ?? null)} start.`
          : "No scheduled start was on file, so this check-in was not scored.",
        variant: ci?.on_time === 0 ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Couldn't check in", description: e?.message, variant: "destructive" }),
  });

  function doCheckIn() {
    checkinMut.reset();
    const submit = (body: any) => { setLocating(false); checkinMut.mutate(body); };
    // No office point means there is nothing to verify, so check-in remains
    // usable without prompting for location.
    if (!me?.officeSet) return submit({});
    if (!navigator.geolocation) {
      toast({
        title: "Location is required",
        description: "This browser cannot provide your location. Use a device with Location Services enabled.",
        variant: "destructive",
      });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => submit({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      () => {
        setLocating(false);
        toast({
          title: "Couldn't verify your location",
          description: "Enable precise location access for this site, make sure Location Services are on, and try again.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  const stats = me?.lateStats;
  const mine = me?.mine ?? null;
  const mineLate = mine ? stats?.lates.find((late) => late.id === mine.id) : null;
  const mineRequest = mine?.request ?? mineLate?.request ?? null;

  const lateRequestMut = useMutation({
    mutationFn: (v: { id: number; reason: string }) =>
      apiRequest("POST", `/api/checkin/${v.id}/excuse-request`, { reason: v.reason }),
    onSuccess: () => {
      setLateRequestReason("");
      queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/attendance-requests"] });
      toast({ title: "Excuse request sent", description: "A manager will review your reason." });
    },
    onError: (e: any) => toast({ title: "Couldn't send request", description: e?.message, variant: "destructive" }),
  });

  // Managers can reverse a late (and undo the reversal). The row keeps its real
  // times; excusing only stops it counting toward the 90-day allowance.
  const excuseMut = useMutation({
    mutationFn: (v: { id: number; excused: boolean; reason: string }) =>
      apiRequest("POST", `/api/checkin/${v.id}/excuse`, { excused: v.excused, reason: v.reason }),
    onSuccess: (_d, v) => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      toast({ title: v.excused ? "Late excused" : "Late re-applied" });
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e?.message, variant: "destructive" }),
  });

  // ── Manager roster (below the personal card) ──
  const [date, setDate] = useState(() => todayLocal());
  const { data: portalLink } = useQuery<{ code: string; url: string }>({
    queryKey: ["/api/portal-link"],
    queryFn: () => apiRequest("GET", "/api/portal-link"),
    enabled: !!isManager,
    retry: false,
  });
  const rotatePortalLink = useMutation({
    mutationFn: () => apiRequest("POST", "/api/portal-link/rotate", {}),
    onSuccess: (next: { code: string; url: string }) => {
      queryClient.setQueryData(["/api/portal-link"], next);
      toast({ title: "Shared link rotated", description: "The old LO / LOA check-in link no longer works." });
    },
    onError: (e: any) => toast({ title: "Couldn't rotate link", description: e?.message, variant: "destructive" }),
  });
  async function copyPortalLink() {
    if (!portalLink?.url) return;
    try {
      await navigator.clipboard.writeText(portalLink.url);
      toast({ title: "Check-in link copied" });
    } catch {
      toast({ title: "Couldn't copy the link", description: "Select the address and copy it manually.", variant: "destructive" });
    }
  }
  const { data: adminData, isLoading: adminLoading } = useQuery<AdminResp>({
    queryKey: ["/api/checkin/admin", date],
    queryFn: () => apiRequest("GET", `/api/checkin/admin?date=${date}`),
  });
  const { data: attendanceRequestData, isLoading: attendanceRequestsLoading } = useQuery<{ requests: AttendanceRequest[] }>({
    queryKey: ["/api/checkin/attendance-requests"],
    queryFn: () => apiRequest("GET", "/api/checkin/attendance-requests"),
    enabled: !!isManager,
  });
  const reviewRequestMut = useMutation({
    mutationFn: (v: { id: number; status: "approved" | "denied"; reviewerNote?: string }) =>
      apiRequest("PATCH", `/api/checkin/attendance-requests/${v.id}`, {
        status: v.status,
        ...(v.reviewerNote ? { reviewerNote: v.reviewerNote } : {}),
      }),
    onSuccess: (_result, v) => {
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[v.id];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/attendance-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      toast({ title: v.status === "approved" ? "Request approved" : "Request denied" });
    },
    onError: (e: any) => toast({ title: "Couldn't review request", description: e?.message, variant: "destructive" }),
  });
  const absenceExcuseMut = useMutation({
    mutationFn: (v: { subjectType: "user" | "lo" | "loa"; subjectId: number; date: string; reason: string }) =>
      apiRequest("POST", "/api/checkin/absence-excuses", v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/attendance-requests"] });
      toast({ title: "Absence excused" });
    },
    onError: (e: any) => toast({ title: "Couldn't excuse absence", description: e?.message, variant: "destructive" }),
  });
  const removeAbsenceExcuseMut = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/checkin/absence-excuses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/checkin/attendance-requests"] });
      toast({ title: "Absence excuse removed" });
    },
    onError: (e: any) => toast({ title: "Couldn't remove excuse", description: e?.message, variant: "destructive" }),
  });
  const clrs = adminData?.clrs ?? [];
  const los = adminData?.los ?? [];
  const loas = adminData?.loas ?? [];
  const checkedIn = clrs.filter(c => c.checkin).length;
  const totalPeople = clrs.length + los.length + loas.length;
  const totalCheckedIn = checkedIn + los.filter((r) => r.checkin).length + loas.filter((r) => r.checkin).length;
  const onTimeCount = [...clrs, ...los, ...loas].filter(c => c.checkin && c.checkin.on_time === 1).length;
  const lateTodayCount = [...clrs, ...los, ...loas].filter(c => c.checkin && c.checkin.on_time === 0).length;
  const inAreaCount = clrs.filter(c => c.checkin && c.checkin.in_area === 1).length;
  const teamRows = [...clrs, ...los, ...loas];
  const peopleWithLates = teamRows.filter((r) => r.lateCount > 0).length;
  const peopleAtLimit = teamRows.filter((r) => r.lateAtLimit && !r.lateOverLimit).length;
  const peopleOverLimit = teamRows.filter((r) => r.lateOverLimit).length;
  const attendanceRequests = attendanceRequestData?.requests ?? [];
  const pendingAttendanceRequests = attendanceRequests.filter((request) => request.status === "pending");
  const resolvedAttendanceRequests = attendanceRequests.filter((request) => request.status !== "pending");

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#1A2B4A] via-[#22325a] to-[#0F182D] px-6 py-6 shadow-lg">
        <div className="absolute -right-8 -top-10 opacity-10"><UserCheck className="w-40 h-40" /></div>
        <div className="relative flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(196,154,60,0.18)" }}>
            <UserCheck className="w-6 h-6" style={{ color: "#C49A3C" }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Check-In</h1>
            <p className="text-sm text-white/60">
              Check in when you start. Your start time comes from your weekly schedule, and you're
              verified as being at the office.
            </p>
          </div>
        </div>
      </div>

      {me && !me.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 text-[13px] text-amber-900 dark:text-amber-200">
          Check-ins are currently disabled — an admin can enable them (and set the office location) in Settings → Morning Check-In.
        </div>
      )}

      {/* ── Your check-in ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" /> Today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Order matters: an existing check-in always wins (so a check-in on a
              day off is still shown), and a failed load must not masquerade as a
              scheduled day off. */}
          {meLoading || !me ? (
            <Skeleton className="h-20 w-full" />
          ) : mine ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                {mine.late_excused ? (
                  <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800" title={mine.excuse_reason || "Excused by a manager"}>
                    <CheckCircle2 className="w-3 h-3" /> Excused
                  </Badge>
                ) : mine.on_time === 1 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                    <CheckCircle2 className="w-3 h-3" /> On time
                  </Badge>
                ) : mine.on_time === 0 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                    <XCircle className="w-3 h-3" /> Late{mine.minutes_late ? ` by ${mine.minutes_late} min` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                    <UserCheck className="w-3 h-3" /> Recorded · not scored
                  </Badge>
                )}
                {mine.in_area === 1 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                    <MapPin className="w-3 h-3" /> At the office
                  </Badge>
                ) : mine.in_area === 0 ? (
                  <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                    <MapPin className="w-3 h-3" /> Outside{mine.distance_m != null ? ` · ${fmtDist(mine.distance_m)}` : ""}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                    <MinusCircle className="w-3 h-3" /> No location
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                Checked in at <strong className="text-foreground">{fmtTime(mine.checked_in_at)}</strong>
                {(mine.expected_start ?? me?.start)
                  ? ` · due ${fmtHm(mine.expected_start ?? me?.start ?? null)}${me?.graceMin ? ` (+${me.graceMin} min grace)` : ""}`
                  : " · not scored — no scheduled start"}
              </p>
              {mine.on_time === 0 && (mineRequest || !mine.late_excused) && (
                mineRequest ? (
                  <div
                    className={`rounded-xl border px-3 py-3 ${requestStatusClass(mineRequest.status)}`}
                    role="status"
                    data-testid={`attendance-request-status-${me.date}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <MessageSquareText className="h-4 w-4" />
                        Excuse request
                      </p>
                      <RequestStatusBadge status={mineRequest.status} />
                    </div>
                    <p className="mt-2 text-xs">
                      {mineRequest.status === "approved"
                        ? "This late was excused and no longer counts toward your rolling total."
                        : mineRequest.status === "denied"
                        ? "This request was not approved, so the late remains in your rolling total."
                        : "Your reason was sent privately to the attendance reviewers."}
                    </p>
                    {mineRequest.reason && (
                      <p className="mt-2 rounded-md bg-background/70 px-2.5 py-2 text-xs text-foreground">
                        <span className="font-semibold">Your reason:</span> {mineRequest.reason}
                      </p>
                    )}
                    {mineRequest.reviewerNote && (
                      <p className="mt-2 text-xs">
                        <span className="font-semibold">Reviewer note:</span> {mineRequest.reviewerNote}
                      </p>
                    )}
                    {(mineRequest.status === "denied" || mineRequest.status === "cancelled") && (
                      <div className="mt-3 border-t border-current/20 pt-3">
                        <label className="block text-xs font-medium">
                          Add context and request another review
                          <Textarea
                            value={lateRequestReason}
                            onChange={(event) => setLateRequestReason(event.target.value)}
                            maxLength={500}
                            placeholder="Share an updated reason"
                            className="mt-1.5 min-h-20 resize-y bg-background text-foreground"
                            data-testid={`attendance-request-reason-${me.date}`}
                          />
                        </label>
                        <Button
                          size="sm"
                          className="mt-2 w-full gap-1.5 sm:w-auto"
                          disabled={lateRequestReason.trim().length < 2 || lateRequestMut.isPending}
                          onClick={() => lateRequestMut.mutate({ id: mine.id, reason: lateRequestReason.trim() })}
                          data-testid={`attendance-request-submit-${me.date}`}
                        >
                          <Send className="h-3.5 w-3.5" />
                          {lateRequestMut.isPending ? "Sending…" : "Request another review"}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-3 dark:border-amber-900 dark:bg-amber-950/20"
                    data-testid={`attendance-request-form-${me.date}`}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200">
                      <MessageSquareText className="h-4 w-4" />
                      Need this late reviewed?
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Explain what happened. Your reason is private and will only be shown to attendance reviewers.
                    </p>
                    <label className="mt-3 block text-xs font-medium">
                      Reason
                      <Textarea
                        value={lateRequestReason}
                        onChange={(event) => setLateRequestReason(event.target.value)}
                        maxLength={500}
                        placeholder="Share the reason for arriving late"
                        className="mt-1.5 min-h-24 resize-y bg-background"
                        data-testid={`attendance-request-reason-${me.date}`}
                      />
                    </label>
                    <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[11px] text-muted-foreground">Submitting does not automatically excuse the late.</p>
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={lateRequestReason.trim().length < 2 || lateRequestMut.isPending}
                        onClick={() => lateRequestMut.mutate({ id: mine.id, reason: lateRequestReason.trim() })}
                        data-testid={`attendance-request-submit-${me.date}`}
                      >
                        <Send className="h-3.5 w-3.5" />
                        {lateRequestMut.isPending ? "Sending…" : "Request review"}
                      </Button>
                    </div>
                  </div>
                )
              )}
            </div>
          ) : me.startSource === "none" ? (
            // No schedule on file — they can still check in, it just isn't scored.
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-muted-foreground">
                <CalendarOff className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  No weekly schedule on file, so there's no start time to check you against. You can still check in —
                  it's recorded, but it won't be scored on time until you submit your <strong className="text-foreground">Weekly Schedule</strong>.
                </span>
              </div>
              <Button onClick={doCheckIn} disabled={!me.enabled || locating || checkinMut.isPending} className="gap-2" data-testid="btn-check-in">
                <UserCheck className="w-4 h-4" />
                {locating ? "Getting location…" : checkinMut.isPending ? "Checking in…" : "Check in now"}
              </Button>
              {me.officeSet && (
                <p className="text-[11px] text-muted-foreground">
                  Precise location is required. You must be within {me.radiusM} m of the office.
                </p>
              )}
            </div>
          ) : !me.working ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarOff className="w-4 h-4" />
              You're not scheduled to work today — no check-in needed.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your start today is <strong className="text-foreground">{fmtHm(me?.start ?? null)}</strong>
                {me?.graceMin ? ` (+${me.graceMin} min grace)` : ""}
                {" — from your weekly schedule."}
              </p>
              <Button onClick={doCheckIn} disabled={!me?.enabled || locating || checkinMut.isPending} className="gap-2" data-testid="btn-check-in">
                <UserCheck className="w-4 h-4" />
                {locating ? "Getting location…" : checkinMut.isPending ? "Checking in…" : "Check in now"}
              </Button>
              {me?.officeSet && (
                <p className="text-[11px] text-muted-foreground">
                  Precise location is required. You must be within {me.radiusM} m of the office.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Lates in the last 90 days ── */}
      {stats && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Late check-ins
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Rolling {stats.windowDays}-day standing</p>
              </div>
              <Badge
                variant="outline"
                className={stats.overLimit
                  ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                  : stats.count >= stats.allowance
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  : stats.count > 0
                  ? "border-amber-200 text-amber-800 dark:border-amber-900 dark:text-amber-300"
                  : "border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300"}
              >
                {stats.overLimit ? "Over limit" : stats.count >= stats.allowance ? "Limit reached" : stats.count > 0 ? "Within allowance" : "Clear"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border bg-muted/25 px-4 py-4">
              <div className="flex items-end justify-between gap-4">
                <div className="flex items-baseline gap-2">
                  <span
                    className={
                      "text-5xl font-bold leading-none tabular-nums " +
                      (stats.overLimit ? "text-red-600 dark:text-red-400" : stats.count > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")
                    }
                    data-testid="late-count"
                  >
                    {stats.count}
                  </span>
                  <span className="text-sm font-semibold">{stats.count === 1 ? "late" : "lates"}</span>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Allowance</p>
                  <p className="text-lg font-bold tabular-nums">{stats.count} / {stats.allowance}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {stats.overLimit
                  ? `${stats.count - stats.allowance} over the allowance`
                  : stats.count >= stats.allowance
                  ? "No lates remaining in this window"
                  : stats.count > 0
                  ? `${stats.remaining} late${stats.remaining === 1 ? "" : "s"} remaining`
                  : `All ${stats.allowance} lates remain available`}
              </p>
            </div>

            {/* allowance pips */}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.max(stats.allowance, stats.count) }).map((_, i) => (
                <span
                  key={i}
                  className={
                    "h-2 flex-1 rounded-full " +
                    (i < stats.count
                      ? (i >= stats.allowance ? "bg-red-600" : "bg-amber-500")
                      : "bg-muted")
                  }
                />
              ))}
            </div>

            {stats.count >= stats.allowance && (
              <div className={`rounded-lg border px-3 py-2 text-[12px] ${
                stats.overLimit
                  ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
                  : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
              }`}>
                {stats.overLimit
                  ? `You're over the ${stats.allowance}-late limit for this ${stats.windowDays}-day window, and your managers were notified when you reached it.`
                  : `You've used all ${stats.allowance} lates for this ${stats.windowDays}-day window — your managers have been notified. Any further late puts you over.`}
              </div>
            )}

            {stats.lates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No late check-ins in the last {stats.windowDays} days. Nice work.</p>
            ) : (
              <div className="rounded-md border divide-y">
                {stats.lates.map((l) => (
                  <div key={l.date} className={`flex items-start justify-between gap-3 px-3 py-2.5 ${l.excused ? "opacity-70" : ""}`} data-testid={`late-row-${l.date}`}>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${l.excused ? "line-through" : ""}`}>{fmtDay(l.date)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        In at {fmtTime(l.checkedInAt)} · due {fmtHm(l.expectedStart)}
                        {l.excused && ` · excused${l.excusedBy ? ` by ${l.excusedBy}` : ""}${l.excuseReason ? ` — ${l.excuseReason}` : ""}`}
                      </p>
                      {l.request?.reason && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground">Your request:</span> {l.request.reason}
                        </p>
                      )}
                      {l.request?.reviewerNote && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          <span className="font-semibold text-foreground">Reviewer note:</span> {l.request.reviewerNote}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {l.excused ? (
                        <Badge variant="outline" className="font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800 shrink-0">
                          Excused
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800 shrink-0">
                          {l.minutesLate != null ? `${l.minutesLate} min late` : "Late"}
                        </Badge>
                      )}
                      {l.request && l.request.status !== "approved" && <RequestStatusBadge status={l.request.status} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Rolling window since {fmtDay(stats.windowStart)}. Lates drop off automatically as they age past {stats.windowDays} days.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Request reasons are intentionally isolated from the team-wide board below. */}
      {isManager && (
        <Card data-testid="attendance-requests">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4" /> Attendance requests
                </CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">Private reasons requiring manager review</p>
              </div>
              <Badge
                variant="outline"
                className={pendingAttendanceRequests.length > 0
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                  : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"}
              >
                {pendingAttendanceRequests.length} pending
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {attendanceRequestsLoading ? (
              <div className="space-y-2">
                {[0, 1].map((key) => <Skeleton key={key} className="h-36 w-full" />)}
              </div>
            ) : pendingAttendanceRequests.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-6 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-600" />
                <p className="mt-2 text-sm font-medium">No requests waiting</p>
                <p className="mt-1 text-xs text-muted-foreground">New late-excuse requests will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingAttendanceRequests.map((request) => {
                  const isReviewing = reviewRequestMut.isPending && reviewRequestMut.variables?.id === request.id;
                  const reviewerNote = reviewNotes[request.id] ?? "";
                  return (
                    <section
                      key={request.id}
                      className="rounded-xl border bg-muted/20 p-3 sm:p-4"
                      data-testid={`attendance-request-${request.id}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{request.subjectName}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {request.subjectType === "user" ? "CLR" : request.subjectType.toUpperCase()}
                            {" · "}{fmtDay(request.attendanceDate)}
                            {request.expectedStart ? ` · due ${fmtHm(request.expectedStart)}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="font-normal">
                            {request.kind === "absence" ? "Absence" : "Late"}
                          </Badge>
                          <RequestStatusBadge status={request.status} />
                        </div>
                      </div>
                      <div className="mt-3 rounded-lg border bg-background px-3 py-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reason</p>
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{request.reason}</p>
                      </div>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Submitted via {request.requestedVia === "portal" ? "LO / LOA portal" : request.requestedVia}
                        {request.requestedAt ? ` · ${fmtTime(request.requestedAt, adminData?.timeZone)}` : ""}
                      </p>
                      <label className="mt-3 block">
                        <span className="sr-only">Optional reviewer note for {request.subjectName}</span>
                        <Input
                          value={reviewerNote}
                          onChange={(event) => setReviewNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                          maxLength={500}
                          placeholder="Reviewer note (optional)"
                          className="h-10"
                          data-testid={`attendance-request-note-${request.id}`}
                        />
                      </label>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                          disabled={reviewRequestMut.isPending}
                          onClick={() => reviewRequestMut.mutate({
                            id: request.id,
                            status: "denied",
                            reviewerNote: reviewerNote.trim() || undefined,
                          })}
                          data-testid={`attendance-deny-${request.id}`}
                        >
                          {isReviewing && reviewRequestMut.variables?.status === "denied" ? "Saving…" : "Deny"}
                        </Button>
                        <Button
                          className="gap-1.5"
                          disabled={reviewRequestMut.isPending}
                          onClick={() => reviewRequestMut.mutate({
                            id: request.id,
                            status: "approved",
                            reviewerNote: reviewerNote.trim() || undefined,
                          })}
                          data-testid={`attendance-approve-${request.id}`}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {isReviewing && reviewRequestMut.variables?.status === "approved" ? "Saving…" : "Approve"}
                        </Button>
                      </div>
                    </section>
                  );
                })}
              </div>
            )}

            {resolvedAttendanceRequests.length > 0 && (
              <details className="rounded-xl border">
                <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium">
                  Recently reviewed ({resolvedAttendanceRequests.length})
                </summary>
                <div className="divide-y border-t">
                  {resolvedAttendanceRequests.map((request) => (
                    <div key={request.id} className="px-3 py-3" data-testid={`attendance-request-${request.id}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{request.subjectName}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {request.kind === "absence" ? "Absence" : "Late"} · {fmtDay(request.attendanceDate)}
                          </p>
                        </div>
                        <RequestStatusBadge status={request.status} />
                      </div>
                      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{request.reason}</p>
                      {request.reviewerNote && (
                        <p className="mt-1.5 text-xs">
                          <span className="font-semibold">Reviewer note:</span> {request.reviewerNote}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* The one shared link LOs/LOAs use — managers hand this out. */}
      {isManager && portalLink?.url && (
        <div className="rounded-xl border bg-muted/40 px-4 py-3 flex items-center gap-2 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">LO / LOA daily check-in</p>
            <p className="text-xs text-muted-foreground mt-0.5">One shared, mobile-friendly link for your active Loan Officers and Assistants.</p>
            <p className="text-[11px] font-mono truncate">{portalLink.url}</p>
          </div>
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={copyPortalLink} data-testid="copy-portal-link">
            <Copy className="w-3.5 h-3.5" /> Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={() => window.open(portalLink.url, "_blank", "noopener,noreferrer")}
            data-testid="open-portal-link"
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open
          </Button>
          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" className="h-9 gap-1.5 text-muted-foreground" data-testid="rotate-portal-link">
                  <RotateCcw className="w-3.5 h-3.5" /> Rotate
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rotate the shared check-in link?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The current link will stop working immediately. You'll need to send the new link to every LO and LOA.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep current link</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    disabled={rotatePortalLink.isPending}
                    onClick={() => rotatePortalLink.mutate()}
                  >
                    {rotatePortalLink.isPending ? "Rotating…" : "Rotate link"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}

      {/* ── Team board — everyone can see attendance state, never private request reasons ── */}
      {(
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><UserCheck className="w-4 h-4" /> Team check-ins</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setDate(d => shiftDate(d, -1))}><ChevronLeft className="w-4 h-4" /></Button>
                <span className="w-36 text-center text-sm font-semibold sm:w-44">{fmtDay(date)}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={date >= todayLocal()} onClick={() => setDate(d => shiftDate(d, 1))}><ChevronRight className="w-4 h-4" /></Button>
              </div>
              <div className="text-xs text-muted-foreground">
                {totalCheckedIn}/{totalPeople} checked in · {onTimeCount} on time · {lateTodayCount} late
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
              <span className="rounded-full border bg-background px-2 py-1">CLRs {checkedIn}/{clrs.length}</span>
              <span className="rounded-full border bg-background px-2 py-1">LOs {los.filter((r) => r.checkin).length}/{los.length}</span>
              <span className="rounded-full border bg-background px-2 py-1">LOAs {loas.filter((r) => r.checkin).length}/{loas.length}</span>
              {inAreaCount > 0 && <span className="rounded-full border bg-background px-2 py-1">{inAreaCount} CLR{inAreaCount === 1 ? "" : "s"} in office</span>}
            </div>

            {adminData && (
              <section className="rounded-xl border bg-muted/25 p-3" aria-label="Team rolling late standing" data-testid="team-late-summary">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold">Rolling late standing</p>
                    <p className="text-[11px] text-muted-foreground">
                      {adminData.policy.allowance} allowed in the last {adminData.policy.windowDays} days
                    </p>
                  </div>
                  <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-3 grid grid-cols-3 divide-x rounded-lg border bg-background">
                  <div className="px-2 py-2.5 text-center">
                    <p className="text-2xl font-bold tabular-nums">{peopleWithLates}</p>
                    <p className="text-[10px] text-muted-foreground">with lates</p>
                  </div>
                  <div className="px-2 py-2.5 text-center">
                    <p className={`text-2xl font-bold tabular-nums ${peopleAtLimit > 0 ? "text-amber-600 dark:text-amber-400" : ""}`}>{peopleAtLimit}</p>
                    <p className="text-[10px] text-muted-foreground">at limit</p>
                  </div>
                  <div className="px-2 py-2.5 text-center">
                    <p className={`text-2xl font-bold tabular-nums ${peopleOverLimit > 0 ? "text-red-600 dark:text-red-400" : ""}`}>{peopleOverLimit}</p>
                    <p className="text-[10px] text-muted-foreground">over limit</p>
                  </div>
                </div>
              </section>
            )}

            <div className="rounded-md border divide-y">
              {adminLoading ? (
                <div className="p-4 space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : clrs.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground text-center">No active CLRs.</p>
              ) : (
                clrs.map((c) => {
                  const ci = c.checkin;
                  return (
                    <div key={c.userId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid={`checkin-row-${c.userId}`}>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {ci
                            ? `Checked in ${fmtTime(ci.checked_in_at)}${c.expectedStart ? ` · due ${fmtHm(c.expectedStart)}` : c.noSchedule ? " · no schedule" : ""}`
                            : c.noSchedule ? "No schedule on file — not scored"
                            : c.scheduledOff ? "Scheduled off"
                            : `${c.startPassed ? "No check-in" : "Not due yet"}${c.expectedStart ? ` · due ${fmtHm(c.expectedStart)}` : ""}`}
                        </p>
                      </div>
                      <div className="flex w-full items-start justify-between gap-2 sm:w-auto sm:items-center sm:justify-end">
                        <RollingLateCount
                          count={c.lateCount}
                          allowance={adminData?.policy?.allowance ?? 3}
                          windowDays={adminData?.policy?.windowDays ?? 90}
                          overLimit={c.lateOverLimit}
                          atLimit={c.lateAtLimit && !c.lateOverLimit}
                        />
                        {ci ? (
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {ci.on_time === 1 ? (
                            <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> On time
                            </Badge>
                          ) : ci.late_excused ? (
                            <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> Excused
                            </Badge>
                          ) : ci.on_time === 0 ? (
                            <Badge variant="outline" className="gap-1 font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                              <XCircle className="w-3 h-3" /> Late{ci.minutes_late ? ` ${ci.minutes_late}m` : ""}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                              <UserCheck className="w-3 h-3" /> In · not scored
                            </Badge>
                          )}
                          {/* Reverse a late (or put it back) — managers only. */}
                          {isManager && ci.on_time === 0 && (
                            <ManualLateExcuseAction
                              userId={c.userId}
                              currentlyExcused={!!ci.late_excused}
                              pending={excuseMut.isPending}
                              onExcuse={(reason) => excuseMut.mutateAsync({ id: ci.id, excused: true, reason })}
                              onUndo={() => excuseMut.mutateAsync({ id: ci.id, excused: false, reason: "" })}
                            />
                          )}
                          {ci.in_area === 1 ? (
                            <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                              <MapPin className="w-3 h-3" /> In area
                            </Badge>
                          ) : ci.in_area === 0 ? (
                            <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                              <MapPin className="w-3 h-3" /> Outside{ci.distance_m != null ? ` · ${fmtDist(ci.distance_m)}` : ""}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                              <MinusCircle className="w-3 h-3" /> No location
                            </Badge>
                          )}
                          </div>
                        ) : c.noSchedule ? (
                          <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                            <MinusCircle className="w-3 h-3" /> No schedule
                          </Badge>
                        ) : c.scheduledOff ? (
                          <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                            <CalendarOff className="w-3 h-3" /> Off
                          </Badge>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {c.absenceExcused ? (
                              <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" />
                                {c.absenceExcuseSource === "time_off" ? "Approved time off" : "Absence excused"}
                              </Badge>
                            ) : !c.startPassed ? (
                              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                                <Clock className="w-3 h-3" /> Not due yet
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                                <XCircle className="w-3 h-3" /> Missing
                              </Badge>
                            )}
                            {isAdmin && (c.absenceEligible || (c.absenceExcused && c.absenceExcuseSource === "admin")) && (
                              <AbsenceExcuseAction
                                subjectType="user"
                                subjectId={c.userId}
                                date={date}
                                excused={!!c.absenceExcused}
                                excuseId={c.absenceExcuseId ?? null}
                                excuseSource={c.absenceExcuseSource ?? null}
                                pending={absenceExcuseMut.isPending || removeAbsenceExcuseMut.isPending}
                                onCreate={(reason) => absenceExcuseMut.mutateAsync({
                                  subjectType: "user",
                                  subjectId: c.userId,
                                  date,
                                  reason,
                                })}
                                onDelete={() => removeAbsenceExcuseMut.mutateAsync(c.absenceExcuseId!)}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* LOs and LOAs check in through the shared public link. */}
            {(["lo", "loa"] as const).map((grp) => {
              const rows = (grp === "lo" ? adminData?.los : adminData?.loas) ?? [];
              if (!rows.length) return null;
              return (
                <div key={grp}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-1.5 mt-1">
                    {grp === "lo" ? "Loan Officers" : "Loan Officer Assistants"} ({rows.filter((r) => r.checkin).length}/{rows.length} in)
                  </p>
                  <div className="rounded-md border divide-y">
                    {rows.map((r) => (
                      <div key={`${r.type}-${r.id}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center" data-testid={`ext-row-${r.type}-${r.id}`}>
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-sm font-medium">{r.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {r.checkin
                              ? `Checked in ${fmtTime(r.checkin.checked_in_at, adminData?.timeZone)}${r.expectedStart ? ` · due ${fmtHm(r.expectedStart)}` : ""}`
                              : r.noSchedule ? "No schedule on file — not scored"
                              : r.scheduledOff ? "Not scheduled today"
                              : `${r.startPassed ? "Not checked in" : "Not due yet"}${r.expectedStart ? ` · due ${fmtHm(r.expectedStart)}` : ""}`}
                            {r.type === "loa" && r.loName ? ` · ${r.loName}` : ""}
                          </p>
                        </div>
                        <div className="flex w-full items-start justify-between gap-2 sm:w-auto sm:items-center sm:justify-end">
                          <RollingLateCount
                            count={r.lateCount}
                            allowance={adminData?.policy?.allowance ?? 3}
                            windowDays={adminData?.policy?.windowDays ?? 90}
                            overLimit={r.lateOverLimit}
                            atLimit={r.lateAtLimit && !r.lateOverLimit}
                          />
                          {r.checkin ? (
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {r.checkin.late_excused ? (
                              <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" /> Excused
                              </Badge>
                            ) : r.checkin.on_time === 0 ? (
                              <Badge variant="outline" className="gap-1 font-normal text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800">
                                <XCircle className="w-3 h-3" /> Late{r.checkin.minutes_late ? ` ${r.checkin.minutes_late}m` : ""}
                              </Badge>
                            ) : r.checkin.on_time === 1 ? (
                              <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                                <CheckCircle2 className="w-3 h-3" /> On time
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                                <UserCheck className="w-3 h-3" /> In · not scored
                              </Badge>
                            )}
                            {r.checkin.in_area === 1 ? (
                              <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                                <MapPin className="w-3 h-3" /> In area
                              </Badge>
                            ) : r.checkin.in_area === 0 ? (
                              <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                                <MapPin className="w-3 h-3" /> Outside{r.checkin.distance_m != null ? ` · ${fmtDist(r.checkin.distance_m)}` : ""}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                                <MinusCircle className="w-3 h-3" /> Legacy · no location
                              </Badge>
                            )}
                            </div>
                          ) : r.noSchedule ? (
                            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                              <MinusCircle className="w-3 h-3" /> No schedule
                            </Badge>
                          ) : r.scheduledOff ? (
                            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground"><CalendarOff className="w-3 h-3" /> Off</Badge>
                          ) : (
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              {r.absenceExcused ? (
                                <Badge variant="outline" className="gap-1 font-normal text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-800">
                                  <CheckCircle2 className="w-3 h-3" /> Absence excused
                                </Badge>
                              ) : !r.startPassed ? (
                                <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
                                  <Clock className="w-3 h-3" /> Not due yet
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="gap-1 font-normal text-red-700 dark:text-red-400 border-red-300 dark:border-red-800">
                                  <XCircle className="w-3 h-3" /> Missing
                                </Badge>
                              )}
                              {isAdmin && (r.absenceEligible || (r.absenceExcused && r.absenceExcuseSource === "admin")) && (
                                <AbsenceExcuseAction
                                  subjectType={r.type}
                                  subjectId={r.id}
                                  date={date}
                                  excused={!!r.absenceExcused}
                                  excuseId={r.absenceExcuseId ?? null}
                                  excuseSource={r.absenceExcuseSource ?? null}
                                  pending={absenceExcuseMut.isPending || removeAbsenceExcuseMut.isPending}
                                  onCreate={(reason) => absenceExcuseMut.mutateAsync({
                                    subjectType: r.type,
                                    subjectId: r.id,
                                    date,
                                    reason,
                                  })}
                                  onDelete={() => removeAbsenceExcuseMut.mutateAsync(r.absenceExcuseId!)}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
