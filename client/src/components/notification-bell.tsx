import { useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import { parseServerTimestamp } from "@/lib/dates";
import { useAuth } from "@/lib/auth";


// Map notification type → the route to navigate to when clicked
const typeRoutes: Record<string, string> = {
  assignment_ready: "/assignments",
  license_alert: "/directory",
  eod_reminder: "/assignments",
  appointment: "/outcomes",
  announcement: "/",
  chat: "/chat",
  forum: "/forum",
  schedule: "/my-schedule",
  missed_appointment: "/appointments",
  nmls_check: "/nmls-checks",
  nmls_escalation: "/nmls-checks",
};

const typeColors: Record<string, string> = {
  assignment_ready: "bg-primary/10 text-primary",
  license_alert: "bg-destructive/10 text-destructive",
  eod_reminder: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  appointment: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  announcement: "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400",
  chat: "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
  forum: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400",
  schedule: "bg-teal-100 text-teal-800 dark:bg-teal-900/20 dark:text-teal-400",
  missed_appointment: "bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400",
  nmls_check: "bg-orange-100 text-orange-800 dark:bg-orange-900/20 dark:text-orange-400",
  nmls_escalation: "bg-destructive/10 text-destructive",
};

const ACTION_REQUIRED_TYPES = ["nmls_check", "nmls_escalation"];

export function NotificationBell() {
  const { user } = useAuth();
  const uid = user?.id ?? 0;
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: [`/api/notifications?userId=${uid}`],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: [`/api/notifications/unread-count?userId=${uid}`],
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${uid}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications/unread-count?userId=${uid}`] });
    },
  });

  function handleNotificationClick(n: any) {
    // For NMLS notifications: navigate but DON'T mark read — only completing the task does that
    if (!ACTION_REQUIRED_TYPES.includes(n.type)) {
      if (!n.isRead) markRead.mutate(n.id);
    }
    const route = typeRoutes[n.type] ?? "/";
    navigate(route);
    setOpen(false);
  }

  const markAllRead = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/mark-all-read", { userId: uid }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${uid}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications/unread-count?userId=${uid}`] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs bg-destructive text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => markAllRead.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        <Separator />
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.slice(0, 20).map((n: any) => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}
                onClick={() => handleNotificationClick(n)}
                data-testid={`notification-${n.id}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${typeColors[n.type] || "bg-muted text-muted-foreground"}`}>
                    {n.type.replace(/_/g, " ")}
                  </span>
                  {ACTION_REQUIRED_TYPES.includes(n.type) && (
                    <span className="ml-auto text-[10px] font-semibold text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5">ACTION REQUIRED</span>
                  )}
                  {!n.isRead && !ACTION_REQUIRED_TYPES.includes(n.type) && <div className="w-2 h-2 rounded-full bg-primary mt-1 ml-auto flex-shrink-0" />}
                </div>
                <p className="text-sm font-medium mt-1">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                {ACTION_REQUIRED_TYPES.includes(n.type) && (
                  <p className="text-xs font-semibold text-orange-600 dark:text-orange-400 mt-1">→ Click to complete in NMLS Checks</p>
                )}
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {formatDistanceToNow(parseServerTimestamp(n.createdAt) ?? new Date(), { addSuffix: true })}
                </p>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
