import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  Bell,
  Check,
  Clock3,
  FileCheck2,
  FolderLock,
  Lock,
  MapPin,
  MessageCircle,
  MessagesSquare,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Smartphone,
  UserRound,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PushNotificationsCard } from "@/components/push-notifications-card";
import { lapRequest } from "@/lib/lap-api";
import { queryClient } from "@/lib/queryClient";

const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

function displayTimezone(value: string) {
  return value.replace("America/", "").replace("Pacific/", "").replace(/_/g, " ");
}

function currentTimeIn(timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return "Invalid timezone";
  }
}

export default function LapSettings() {
  const { user, refetchUser } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin" || !!user?.superAdmin;

  const [timezone, setTimezone] = useState(user?.timezone ?? "America/Los_Angeles");
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [chatNotifications, setChatNotifications] = useState(!user?.muteLapChatNotifications);
  const [forumNotifications, setForumNotifications] = useState(!user?.muteLapForumNotifications);
  const [notificationBusy, setNotificationBusy] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [checkinGrace, setCheckinGrace] = useState("5");
  const [checkinRadius, setCheckinRadius] = useState("400");
  const [checkinLat, setCheckinLat] = useState("");
  const [checkinLng, setCheckinLng] = useState("");
  const [locatingOffice, setLocatingOffice] = useState(false);

  const checkinConfigQuery = useQuery<any>({
    queryKey: ["/api/checkin/admin", "lap-settings"],
    queryFn: () => lapRequest<any>("GET", "/api/checkin/admin"),
    enabled: isAdmin,
  });

  useEffect(() => {
    setTimezone(user?.timezone ?? "America/Los_Angeles");
    setChatNotifications(!user?.muteLapChatNotifications);
    setForumNotifications(!user?.muteLapForumNotifications);
  }, [user?.timezone, user?.muteLapChatNotifications, user?.muteLapForumNotifications]);

  useEffect(() => {
    const config = checkinConfigQuery.data?.config;
    if (!config) return;
    setCheckinGrace(String(config.graceMin ?? 5));
    setCheckinRadius(String(config.radiusM ?? 400));
    setCheckinLat(config.lat == null ? "" : String(config.lat));
    setCheckinLng(config.lng == null ? "" : String(config.lng));
  }, [checkinConfigQuery.data]);

  const browserTimezone = useMemo(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
    catch { return "America/Los_Angeles"; }
  }, []);
  const timezoneOptions = useMemo(() =>
    Array.from(new Set([...COMMON_TIMEZONES, browserTimezone, timezone])).filter(Boolean),
  [browserTimezone, timezone]);

  async function saveTimezone() {
    setSavingTimezone(true);
    try {
      await lapRequest("PATCH", "/api/auth/profile", { timezone });
      await refetchUser();
      toast({ title: "Timezone saved", description: `LAP will display dates and times in ${displayTimezone(timezone)}.` });
    } catch (error: any) {
      toast({ title: "Could not save timezone", description: error?.message, variant: "destructive" });
    } finally {
      setSavingTimezone(false);
    }
  }

  async function setChannel(kind: "chat" | "forum", enabled: boolean) {
    const setter = kind === "chat" ? setChatNotifications : setForumNotifications;
    setter(enabled);
    setNotificationBusy(kind);
    try {
      await lapRequest("PATCH", `/api/users/me/mute-lap-${kind}`, { muted: !enabled });
      await refetchUser();
      toast({ title: `${kind === "chat" ? "Chat" : "Forum"} notifications ${enabled ? "enabled" : "muted"}` });
    } catch (error: any) {
      setter(!enabled);
      toast({ title: "Could not update notifications", description: error?.message, variant: "destructive" });
    } finally {
      setNotificationBusy(null);
    }
  }

  async function changePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast({ title: "Complete every password field", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Use at least 8 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "New passwords do not match", variant: "destructive" });
      return;
    }
    setPasswordBusy(true);
    try {
      await lapRequest("PUT", "/api/users/me/password", { currentPassword, newPassword, confirmPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated" });
    } catch (error: any) {
      toast({ title: "Could not change password", description: error?.message, variant: "destructive" });
    } finally {
      setPasswordBusy(false);
    }
  }

  const saveCheckinConfig = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      lapRequest<any>("POST", "/api/checkin/settings", body),
    onSuccess: async () => {
      await checkinConfigQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["/api/checkin"] });
      toast({ title: "Check-In settings saved" });
    },
    onError: (error: any) => {
      toast({
        title: "Could not save Check-In settings",
        description: error?.message,
        variant: "destructive",
      });
    },
  });

  function useOfficeLocation() {
    if (!navigator.geolocation) {
      toast({ title: "Location is unavailable in this browser", variant: "destructive" });
      return;
    }
    setLocatingOffice(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocatingOffice(false);
        setCheckinLat(position.coords.latitude.toFixed(6));
        setCheckinLng(position.coords.longitude.toFixed(6));
      },
      () => {
        setLocatingOffice(false);
        toast({ title: "LAP could not read this device's location", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 8_000 },
    );
  }

  function saveOfficeSettings() {
    const graceMin = Number.parseInt(checkinGrace, 10);
    const radiusM = Number.parseInt(checkinRadius, 10);
    const lat = checkinLat.trim() ? Number.parseFloat(checkinLat) : null;
    const lng = checkinLng.trim() ? Number.parseFloat(checkinLng) : null;
    if (!Number.isFinite(graceMin) || graceMin < 0 || graceMin > 120) {
      toast({ title: "Grace period must be between 0 and 120 minutes", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(radiusM) || radiusM < 25 || radiusM > 50_000) {
      toast({ title: "Office radius must be between 25 and 50,000 meters", variant: "destructive" });
      return;
    }
    if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) {
      toast({ title: "Enter a valid latitude between -90 and 90", variant: "destructive" });
      return;
    }
    if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) {
      toast({ title: "Enter a valid longitude between -180 and 180", variant: "destructive" });
      return;
    }
    if ((lat === null) !== (lng === null)) {
      toast({ title: "Enter both latitude and longitude, or leave both blank", variant: "destructive" });
      return;
    }
    saveCheckinConfig.mutate({
      graceMin,
      radiusM,
      lat,
      lng,
    });
  }

  return (
    <div className="mx-auto max-w-[1050px] space-y-5 p-4 sm:p-6">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary via-primary to-primary/75 px-5 py-7 text-primary-foreground shadow-lg sm:px-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <div className="relative">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
            <Settings2 className="h-4 w-4" /> Personal workspace
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">LAP Settings</h1>
          <p className="mt-2 max-w-2xl text-sm text-primary-foreground/80">
            Manage the profile, communication, and security settings that are relevant to the LO Assistant Portal.
          </p>
        </div>
      </section>

      <Tabs defaultValue="profile">
        <TabsList className="h-auto w-full justify-start overflow-x-auto p-1">
          <TabsTrigger value="profile" className="gap-1.5"><UserRound className="h-4 w-4" /> Profile</TabsTrigger>
          <TabsTrigger value="notifications" className="gap-1.5"><Bell className="h-4 w-4" /> Notifications</TabsTrigger>
          <TabsTrigger value="security" className="gap-1.5"><Lock className="h-4 w-4" /> Security</TabsTrigger>
          {isAdmin && <TabsTrigger value="workspace" className="gap-1.5"><FolderLock className="h-4 w-4" /> Workspace</TabsTrigger>}
        </TabsList>

        <TabsContent value="profile" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><UserRound className="h-4 w-4 text-primary" /> Your profile</CardTitle>
              <CardDescription>Your LAP identity comes from the same secure West Capital account.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-4 rounded-xl border bg-muted/15 p-4 sm:flex-row sm:items-center">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {(user?.name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{user?.name || "Loading…"}</p>
                  <p className="truncate text-sm text-muted-foreground">{user?.email || "—"}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="capitalize">{user?.role || "user"}</Badge>
                  <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Active</Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" /> Timezone</CardTitle>
              <CardDescription>Used by LAP attendance, schedules, package dates, and audit timestamps.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {timezoneOptions.map((zone) => <SelectItem key={zone} value={zone}>{displayTimezone(zone)}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={() => void saveTimezone()} disabled={savingTimezone || timezone === user?.timezone}>
                  {savingTimezone ? <RefreshCw className="animate-spin" /> : <Check />} Save timezone
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/20 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Preview</p>
                <p className="mt-1 text-sm font-medium">{currentTimeIn(timezone)}</p>
              </div>
              {browserTimezone && browserTimezone !== timezone && (
                <Button variant="ghost" size="sm" onClick={() => setTimezone(browserTimezone)}>
                  Use browser timezone ({displayTimezone(browserTimezone)})
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-5 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Bell className="h-4 w-4 text-primary" /> Communication notifications</CardTitle>
              <CardDescription>Choose which shared LAP communication channels can alert you.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              <div className="flex items-center justify-between gap-4 py-4 first:pt-0">
                <div className="flex items-start gap-3">
                  <MessageCircle className="mt-0.5 h-4 w-4 text-primary" />
                  <div><p className="text-sm font-medium">Team Chat</p><p className="text-xs text-muted-foreground">Alerts for team chat messages and mentions.</p></div>
                </div>
                <Switch checked={chatNotifications} disabled={notificationBusy === "chat"} onCheckedChange={(value) => void setChannel("chat", value)} />
              </div>
              <div className="flex items-center justify-between gap-4 py-4 last:pb-0">
                <div className="flex items-start gap-3">
                  <MessagesSquare className="mt-0.5 h-4 w-4 text-primary" />
                  <div><p className="text-sm font-medium">Forum</p><p className="text-xs text-muted-foreground">Alerts for subscribed topics and new answers.</p></div>
                </div>
                <Switch checked={forumNotifications} disabled={notificationBusy === "forum"} onCheckedChange={(value) => void setChannel("forum", value)} />
              </div>
            </CardContent>
          </Card>

          <PushNotificationsCard portal="lap" />

          <Card className="border-primary/25 bg-primary/5">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <p className="font-semibold">Install LAP for the best app experience</p>
                  <p className="mt-1 text-xs text-muted-foreground">Home-screen access makes communication and document workflows easier to reach.</p>
                </div>
              </div>
              <Button asChild variant="outline"><Link href="/install">Install guide</Link></Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><Lock className="h-4 w-4 text-primary" /> Change password</CardTitle>
              <CardDescription>Use a unique password of at least eight characters.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="lap-current-password">Current password</Label>
                <Input id="lap-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="lap-new-password">New password</Label>
                  <Input id="lap-new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lap-confirm-password">Confirm new password</Label>
                  <Input id="lap-confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </div>
              </div>
              <Button onClick={() => void changePassword()} disabled={passwordBusy}>
                {passwordBusy ? <RefreshCw className="animate-spin" /> : <ShieldCheck />} Update password
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="workspace" className="mt-5 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="h-4 w-4 text-primary" /> Check-In configuration
                </CardTitle>
                <CardDescription>
                  Set the office location, allowed radius, and grace period used by the shared LAP Check-In tool.
                  Expected start times still come from each person&apos;s Weekly Schedule.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {checkinConfigQuery.isLoading ? (
                  <div className="h-28 animate-pulse rounded-xl bg-muted" />
                ) : checkinConfigQuery.isError ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm">Check-In configuration could not be loaded.</p>
                    <Button variant="outline" size="sm" onClick={() => checkinConfigQuery.refetch()}>
                      <RefreshCw /> Retry
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/15 p-4">
                      <div>
                        <p className="text-sm font-semibold">Enable Check-In</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          When enabled, team members can record attendance from LAP or C3.
                        </p>
                      </div>
                      <Switch
                        checked={!!checkinConfigQuery.data?.config?.enabled}
                        disabled={saveCheckinConfig.isPending}
                        onCheckedChange={(enabled) => saveCheckinConfig.mutate({ enabled })}
                        data-testid="lap-toggle-checkin"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="lap-checkin-grace">Grace period (minutes)</Label>
                        <Input
                          id="lap-checkin-grace"
                          type="number"
                          min={0}
                          max={120}
                          value={checkinGrace}
                          onChange={(event) => setCheckinGrace(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lap-checkin-radius">Office radius (meters)</Label>
                        <Input
                          id="lap-checkin-radius"
                          type="number"
                          min={25}
                          max={50_000}
                          value={checkinRadius}
                          onChange={(event) => setCheckinRadius(event.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                        <Label>Office point</Label>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={useOfficeLocation}
                          disabled={locatingOffice}
                        >
                          {locatingOffice ? <RefreshCw className="animate-spin" /> : <MapPin />}
                          {locatingOffice ? "Locating…" : "Use my location"}
                        </Button>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lap-checkin-lat">Latitude</Label>
                        <Input
                          id="lap-checkin-lat"
                          inputMode="decimal"
                          value={checkinLat}
                          onChange={(event) => setCheckinLat(event.target.value)}
                          placeholder="33.6595"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="lap-checkin-lng">Longitude</Label>
                        <Input
                          id="lap-checkin-lng"
                          inputMode="decimal"
                          value={checkinLng}
                          onChange={(event) => setCheckinLng(event.target.value)}
                          placeholder="-117.9988"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="button"
                        onClick={saveOfficeSettings}
                        disabled={saveCheckinConfig.isPending}
                      >
                        {saveCheckinConfig.isPending ? <RefreshCw className="animate-spin" /> : <Save />}
                        Save Check-In settings
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><FolderLock className="h-4 w-4 text-primary" /> Result package access</CardTitle>
                <CardDescription>The LAP workspace follows a deliberately simple collaboration model.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {[
                  { icon: FileCheck2, title: "Team editing", copy: "Authenticated LAP users can create packages, edit details, and replace current files." },
                  { icon: ShieldCheck, title: "Admin downloads", copy: "Only admins receive direct document download controls in LAP." },
                  { icon: Archive, title: "Audited history", copy: "Package changes and document actions are attributable to a user and timestamp." },
                ].map(({ icon: Icon, title, copy }) => (
                  <div key={title} className="rounded-xl border bg-muted/15 p-4">
                    <Icon className="h-5 w-5 text-primary" />
                    <p className="mt-3 text-sm font-semibold">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Open the shared report archive</p>
                  <p className="mt-1 text-xs text-muted-foreground">Preview and download daily, weekly, or monthly operational reports.</p>
                </div>
                <Button asChild><Link href="/reports-archive">Open report archive</Link></Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      <p className="text-center text-[11px] text-muted-foreground">
        C3 assignment algorithms, call goals, script settings, NMLS schedules, and outbound-call configuration are intentionally excluded from LAP.
      </p>
    </div>
  );
}
